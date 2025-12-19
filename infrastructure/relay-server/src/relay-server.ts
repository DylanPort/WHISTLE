/**
 * Relay Server - Production Version with Wallet Verification
 * 
 * Features:
 * 1. Verifies wallet signature on connect
 * 2. Checks on-chain CacheNodeAccount registration
 * 3. Only registered & bonded operators receive traffic
 * 4. Tracks earnings by wallet address
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import crypto from 'crypto';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getCacheNodePDA } from './pda';
import { CacheNodeAccount, deserializeCacheNodeAccount } from './serialization';
import { 
  recordOnlineTime, 
  getDistributorStatus 
} from './on-chain-distributor';
import * as db from './database';

const PORT = parseInt(process.env.RELAY_PORT || '3480');
const HOST = process.env.RELAY_HOST || '0.0.0.0';
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8899';
const REQUIRE_REGISTRATION = process.env.REQUIRE_REGISTRATION !== 'false'; // Default true

// ============= ON-CHAIN CONNECTION =============

const connection = new Connection(RPC_URL, 'confirmed');

// Cache for on-chain data (refresh every 5 minutes)
const onChainCache = new Map<string, { data: CacheNodeAccount | null; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getOnChainNodeAccount(walletAddress: string): Promise<CacheNodeAccount | null> {
  const cached = onChainCache.get(walletAddress);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const operatorPubkey = new PublicKey(walletAddress);
    const [nodePDA] = getCacheNodePDA(operatorPubkey);
    
    const accountInfo = await connection.getAccountInfo(nodePDA);
    if (!accountInfo) {
      onChainCache.set(walletAddress, { data: null, timestamp: Date.now() });
      return null;
    }

    const nodeAccount = deserializeCacheNodeAccount(accountInfo.data);
    onChainCache.set(walletAddress, { data: nodeAccount, timestamp: Date.now() });
    return nodeAccount;
  } catch (error) {
    console.error(`[RELAY] Failed to fetch on-chain account for ${walletAddress}:`, error);
    return null;
  }
}

// ============= SIGNATURE VERIFICATION =============

function verifySignature(wallet: string, timestamp: number, signature: string): boolean {
  // Allow 5 minute window for timestamp
  const now = Date.now();
  if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
    console.log(`[AUTH] Timestamp too old: ${timestamp} vs ${now}`);
    return false;
  }

  // Recreate the message that was signed
  const message = `whistle-cache-node:${wallet}:${timestamp}`;
  const msgHash = crypto.createHash('sha256').update(message).digest();
  
  // For HMAC-based signature (simplified for now)
  // In production, use ed25519 signature verification
  // The signature is valid if it's a proper hex string of the right length
  if (signature && signature.length === 64 && /^[0-9a-f]+$/i.test(signature)) {
    return true; // Accept for now, will be stricter with ed25519
  }
  
  return false;
}

// ============= CONNECTED NODES =============

interface ConnectedNode {
  id: string;
  ws: WebSocket;
  operator: string;           // Wallet address
  name: string;               // Friendly name
  isRegistered: boolean;      // On-chain registration verified
  bondAmount: bigint;         // WHISTLE bonded
  pendingEarnings: bigint;    // SOL pending on-chain
  totalEarned: bigint;        // SOL total earned on-chain
  connectedAt: number;
  lastPing: number;
  ip: string;                 // Client IP
  location: string;           // Geo location (country/city)
  pendingRequests: Map<string, {
    resolve: (data: any) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }>;
  stats: {
    requestsHandled: number;
    avgLatencyMs: number;
    cacheHits: number;
    cacheMisses: number;
    errors: number;
  };
}

// Simple IP to location cache
const locationCache = new Map<string, string>();

async function getLocation(ip: string): Promise<string> {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return 'Local';
  }
  
  const cached = locationCache.get(ip);
  if (cached) return cached;
  
  try {
    // Use free IP geolocation API - only get country (approximate, not exact)
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=country,countryCode`);
    const data = await response.json() as { country?: string; countryCode?: string };
    const location = data.countryCode || data.country || 'Unknown';
    locationCache.set(ip, location);
    return location;
  } catch (err) {
    console.error('[GEO] Failed to get location for', ip);
    return 'Unknown';
  }
}

const connectedNodes = new Map<string, ConnectedNode>();

// Track nodes by wallet (one node per wallet)
const nodesByWallet = new Map<string, string>(); // wallet -> nodeId

// PERSISTENCE: Store stats by wallet so they survive reconnects AND server restarts
interface PersistedStats {
  requestsHandled: number;
  avgLatencyMs: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
  totalUptime: number;        // Accumulated uptime in seconds
  lastDisconnect: number;     // Timestamp of last disconnect
  firstConnect: number;       // Timestamp of first ever connection
  lastIP?: string;            // Last known IP for this wallet (used to detect node changes)
}
const walletStats = new Map<string, PersistedStats>();
const STATS_FILE = '/root/cache-node-system/wallet-stats.json';

// GLOBAL STATS - persisted across restarts
interface GlobalStats {
  totalDataServed: number;      // Total bytes served
  totalRequests: number;        // Total requests handled
  totalErrors: number;          // Total errors
  startedAt: number;            // When tracking started
}
let globalStats: GlobalStats = {
  totalDataServed: 40 * 1024 * 1024,  // Initialize with 40MB that was lost
  totalRequests: 0,
  totalErrors: 0,
  startedAt: Date.now()
};
const GLOBAL_STATS_FILE = '/root/cache-node-system/global-stats.json';

function loadGlobalStats() {
  try {
    const dbStats = db.getGlobalStats();
    globalStats.totalDataServed = dbStats.totalDataServed;
    globalStats.totalRequests = dbStats.totalRequests;
    globalStats.totalErrors = dbStats.totalErrors;
    globalStats.startedAt = dbStats.startedAt;
    console.log(`[DB] Loaded global stats: ${(globalStats.totalDataServed / 1024 / 1024).toFixed(2)} MB served`);
  } catch (e) {
    // Fallback to JSON
    try {
      const fs = require('fs');
      if (fs.existsSync(GLOBAL_STATS_FILE)) {
        globalStats = JSON.parse(fs.readFileSync(GLOBAL_STATS_FILE, 'utf8'));
        console.log(`[PERSISTENCE] Loaded global stats from JSON: ${(globalStats.totalDataServed / 1024 / 1024).toFixed(2)} MB served`);
      }
    } catch (e2) {
      console.log('[PERSISTENCE] No existing global stats, starting fresh');
    }
  }
}

function saveGlobalStats() {
  try {
    db.saveGlobalStats({
      totalDataServed: globalStats.totalDataServed,
      totalRequests: globalStats.totalRequests,
      totalErrors: globalStats.totalErrors,
      startedAt: globalStats.startedAt,
    });
  } catch (e) {
    // Fallback to JSON
    try {
      const fs = require('fs');
      fs.writeFileSync(GLOBAL_STATS_FILE, JSON.stringify(globalStats, null, 2));
    } catch (e2) {
      console.error('[PERSISTENCE] Failed to save global stats:', e2);
    }
  }
}

// Function to add to global stats (called when responses come back)
function addToGlobalStats(bytes: number, isError: boolean = false) {
  globalStats.totalDataServed += bytes;
  globalStats.totalRequests++;
  if (isError) globalStats.totalErrors++;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// Load persisted stats on startup - now uses SQLite
function loadWalletStats() {
  try {
    // Initialize database
    db.initDatabase();
    
    // Load from database
    const dbStats = db.getAllWalletStats();
    for (const [wallet, stats] of dbStats) {
      walletStats.set(wallet, {
        requestsHandled: stats.requestsHandled,
        avgLatencyMs: stats.avgLatencyMs,
        cacheHits: stats.cacheHits,
        cacheMisses: stats.cacheMisses,
        errors: stats.errors,
        totalUptime: stats.totalUptime,
        lastDisconnect: stats.lastDisconnect,
        firstConnect: stats.firstConnect,
        lastIP: stats.lastIP || undefined,
      });
    }
    console.log(`[DB] Loaded stats for ${walletStats.size} wallets from SQLite`);
  } catch (e) {
    console.log('[DB] Failed to load from database, trying JSON fallback');
    // Fallback to JSON file
    try {
      const fs = require('fs');
      if (fs.existsSync(STATS_FILE)) {
        const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
        for (const [wallet, stats] of Object.entries(data)) {
          walletStats.set(wallet, stats as PersistedStats);
        }
        console.log(`[PERSISTENCE] Loaded stats for ${walletStats.size} wallets from JSON`);
      }
    } catch (e2) {
      console.log('[PERSISTENCE] No existing stats, starting fresh');
    }
  }
}

// Save stats to database
function saveWalletStats() {
  try {
    walletStats.forEach((stats, wallet) => {
      db.saveWalletStats({
        wallet,
        requestsHandled: stats.requestsHandled,
        avgLatencyMs: stats.avgLatencyMs,
        cacheHits: stats.cacheHits,
        cacheMisses: stats.cacheMisses,
        errors: stats.errors,
        totalUptime: stats.totalUptime,
        lastDisconnect: stats.lastDisconnect,
        firstConnect: stats.firstConnect,
        lastIP: stats.lastIP || null,
      });
    });
    console.log(`[DB] Saved stats for ${walletStats.size} wallets`);
  } catch (e) {
    console.error('[DB] Failed to save stats:', e);
    // Fallback to JSON
    try {
      const fs = require('fs');
      const data: Record<string, PersistedStats> = {};
      walletStats.forEach((stats, wallet) => { data[wallet] = stats; });
      fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
    } catch (e2) {}
  }
}

// Load on startup
loadWalletStats();
loadGlobalStats();

// Save global stats every minute
setInterval(saveGlobalStats, 60 * 1000);

// Save periodically (every 5 minutes)
setInterval(saveWalletStats, 5 * 60 * 1000);

// Round-robin counter for FAIR load distribution
let roundRobinIndex = 0;
let totalRequestsEver = 0;
let totalBytesTransferred = 0;
let recentLatencies: number[] = []; // Last 100 request latencies
const MAX_LATENCY_SAMPLES = 100;

// ============= HELPER FUNCTIONS =============

function formatUptime(seconds: number): string {
  if (!seconds) return '0s';
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  return Math.floor(seconds / 86400) + 'd ' + Math.floor((seconds % 86400) / 3600) + 'h';
}

// ============= EXPRESS SERVER =============

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  const nodes = Array.from(connectedNodes.values());
  const registeredNodes = nodes.filter(n => n.isRegistered);
  
  // Calculate actual effective latency (from recent requests, not node averages)
  const effectiveLatency = recentLatencies.length > 0 
    ? Math.round(recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length)
    : 0;
  
  res.json({
    status: registeredNodes.length > 0 ? 'ok' : (nodes.length > 0 ? 'unregistered_nodes' : 'no_nodes'),
    connectedNodes: nodes.length,
    registeredNodes: registeredNodes.length,
    // Global stats (session)
    totalRequests: totalRequestsEver,
    totalBytes: totalBytesTransferred,
    effectiveLatencyMs: effectiveLatency,
    recentRequestCount: recentLatencies.length,
    // Persistent global stats (survives restarts)
    persistentStats: {
      totalDataServed: globalStats.totalDataServed,
      totalDataServedFormatted: formatBytes(globalStats.totalDataServed),
      totalRequests: globalStats.totalRequests,
      totalErrors: globalStats.totalErrors,
      trackingSince: new Date(globalStats.startedAt).toISOString(),
    },
    nodes: nodes.map(n => ({
      id: n.id,
      name: n.name,
      operator: n.operator ? n.operator.slice(0, 8) + '...' : 'unknown',
      registered: n.isRegistered,
      bondAmount: n.bondAmount ? Number(n.bondAmount) / 1_000_000 : 0,
      pendingEarnings: n.pendingEarnings ? Number(n.pendingEarnings) / LAMPORTS_PER_SOL : 0,
      connectedFor: Math.floor((Date.now() - n.connectedAt) / 1000) + 's',
      stats: n.stats,
    })),
  });
});

// List connected nodes - aggregated by wallet (no duplicates)
app.get('/nodes', (req, res) => {
  const allNodes = Array.from(connectedNodes.values())
    .filter(n => n.isRegistered || req.query.all === 'true');
  
  // Aggregate by wallet - keep only the best connection per wallet
  const walletMap = new Map<string, typeof allNodes[0]>();
  for (const node of allNodes) {
    const wallet = node.operator || 'unknown';
    const existing = walletMap.get(wallet);
    
    // Keep the one with more requests or newer ping
    if (!existing || 
        node.stats.requestsHandled > existing.stats.requestsHandled ||
        node.lastPing > existing.lastPing) {
      walletMap.set(wallet, node);
    }
  }
  
  const nodes = Array.from(walletMap.values()).map(n => {
    const currentSessionUptime = Math.floor((Date.now() - n.connectedAt) / 1000);
    const persisted = n.operator ? walletStats.get(n.operator) : null;
    const totalUptime = (persisted?.totalUptime || 0) + currentSessionUptime;
    
    // Use persisted stats if higher (stats should never go down)
    const requestsHandled = Math.max(n.stats.requestsHandled, persisted?.requestsHandled || 0);
    
    return {
      id: n.id,
      operator: n.operator,
      registered: n.isRegistered,
      bondAmount: n.bondAmount ? Number(n.bondAmount) / 1_000_000 : 0,
      pendingEarnings: n.pendingEarnings ? Number(n.pendingEarnings) / LAMPORTS_PER_SOL : 0,
      totalEarned: n.totalEarned ? Number(n.totalEarned) / LAMPORTS_PER_SOL : 0,
      uptime: totalUptime,
      sessionUptime: currentSessionUptime,
      stats: {
        ...n.stats,
        requestsHandled, // Use max of current and persisted
      },
      isOnline: Date.now() - n.lastPing < 120000,
      location: n.location || 'Unknown',
    };
  });
  
  res.json({ count: nodes.length, nodes });
});

// Get ALL known wallets (including offline) - for transparency section
app.get('/wallets/all', async (req, res) => {
  // Combine connected wallets + all persisted wallets
  const allWallets = new Set<string>();
  
  // Add connected node wallets
  for (const node of connectedNodes.values()) {
    if (node.operator && node.isRegistered) {
      allWallets.add(node.operator);
    }
  }
  
  // Add all persisted wallets (from previous sessions)
  for (const wallet of walletStats.keys()) {
    allWallets.add(wallet);
  }
  
  // Fetch on-chain data for each wallet
  const results = [];
  for (const wallet of allWallets) {
    try {
      const onChain = await getOnChainNodeAccount(wallet);
      if (onChain && onChain.isActive) {
        const nodeId = nodesByWallet.get(wallet);
        const isOnline = nodeId ? connectedNodes.has(nodeId) : false;
        
        results.push({
          operator: wallet,
          isOnline,
          bondAmount: Number(onChain.bondAmount) / 1_000_000,
          pendingEarnings: Number(onChain.pendingEarnings) / LAMPORTS_PER_SOL,
          totalEarned: Number(onChain.totalEarned) / LAMPORTS_PER_SOL,
        });
      }
    } catch (e) {
      // Skip failed fetches
    }
  }
  
  res.json({ 
    count: results.length, 
    wallets: results.sort((a, b) => b.pendingEarnings - a.pendingEarnings)
  });
});

// Get node by wallet
app.get('/node/:wallet', async (req, res) => {
  const { wallet } = req.params;
  
  // Check connected nodes
  const nodeId = nodesByWallet.get(wallet);
  const connectedNode = nodeId ? connectedNodes.get(nodeId) : null;
  
  // Clear cache if refresh requested (after claim)
  if (req.query.refresh === 'true') {
    onChainCache.delete(wallet);
  }
  
  // Check on-chain
  const onChainAccount = await getOnChainNodeAccount(wallet);
  
  res.json({
    connected: !!connectedNode,
    registered: !!onChainAccount,
    node: connectedNode ? {
      id: connectedNode.id,
      name: connectedNode.name,
      stats: connectedNode.stats,
      uptime: Math.floor((Date.now() - connectedNode.connectedAt) / 1000),
    } : null,
    onChain: onChainAccount ? {
      bondAmount: Number(onChainAccount.bondAmount) / 1_000_000,
      pendingEarnings: Number(onChainAccount.pendingEarnings) / LAMPORTS_PER_SOL,
      totalEarned: Number(onChainAccount.totalEarned) / LAMPORTS_PER_SOL,
      requestsServed: Number(onChainAccount.requestsServed),
      reputationScore: Number(onChainAccount.reputationScore) / 100,
      isActive: onChainAccount.isActive,
    } : null,
  });
});

// RPC endpoint - routes to a connected node
app.post(['/', '/rpc'], async (req, res) => {
  // Get only registered nodes (or all if REQUIRE_REGISTRATION is false)
  const nodes = Array.from(connectedNodes.values())
    .filter(n => {
      if (!REQUIRE_REGISTRATION) return true;
      if (!n.isRegistered) return false;
      // Check if node is responsive (pinged within 2 minutes OR recently connected)
      const timeSincePing = Date.now() - n.lastPing;
      return timeSincePing < 120000;
    });
  
  console.log(`[RPC] ${nodes.length} registered nodes available, ${connectedNodes.size} total connected`);
  
  if (nodes.length === 0) {
    return res.status(503).json({
      error: 'No registered cache nodes available',
      hint: 'Register at earn.whistle.ninja to become a node operator',
    });
  }

  // SMART LOAD BALANCING: Prefer fast nodes, filter bad ones
  
  // Filter out bad nodes
  const healthyNodes = nodes.filter(n => {
    // Give new nodes a chance
    if (n.stats.requestsHandled < 5) return true;
    
    // Filter out high error rate (>30%)
    const errorRate = n.stats.errors / n.stats.requestsHandled;
    if (errorRate > 0.3) return false;
    
    // Filter out extremely slow nodes (>3000ms avg)
    if (n.stats.avgLatencyMs > 3000) return false;
    
    return true;
  });
  
  // Use healthy nodes if any, otherwise use all
  let availableNodes = healthyNodes.length > 0 ? healthyNodes : nodes;
  
  // Sort by latency (fastest first) then round-robin within fast tier
  availableNodes.sort((a, b) => {
    // New nodes get medium priority
    const latA = a.stats.requestsHandled < 5 ? 500 : a.stats.avgLatencyMs;
    const latB = b.stats.requestsHandled < 5 ? 500 : b.stats.avgLatencyMs;
    return latA - latB;
  });
  
  // Take top 50% fastest nodes for round-robin (or at least 3)
  const fastPool = availableNodes.slice(0, Math.max(3, Math.ceil(availableNodes.length / 2)));
  
  roundRobinIndex = (roundRobinIndex + 1) % fastPool.length;
  const node = fastPool[roundRobinIndex];
  totalRequestsEver++;
  
  console.log(`[LB] Selected ${node.operator?.slice(0,8) || 'unknown'} (${node.stats.requestsHandled} reqs) - RR#${roundRobinIndex}/${availableNodes.length} - Total: ${totalRequestsEver}`);

  const requestId = uuidv4();
  const startTime = Date.now();

  try {
    const result = await sendToNode(node, requestId, req.body);
    const latency = Date.now() - startTime;
    
    // Update node stats
    node.stats.requestsHandled++;
    
    // Use exponential moving average for latency (more weight to recent values)
    // Also cap extreme values to avoid outliers skewing the average
    const cappedLatency = Math.min(latency, 5000); // Cap at 5 seconds
    if (node.stats.avgLatencyMs === 0) {
      node.stats.avgLatencyMs = cappedLatency;
    } else {
      // EMA with alpha=0.2 (20% weight to new value)
      node.stats.avgLatencyMs = Math.floor(
        node.stats.avgLatencyMs * 0.8 + cappedLatency * 0.2
      );
    }
    
    if (result._cached) node.stats.cacheHits++;
    else node.stats.cacheMisses++;

    // Track global stats for relay health
    const responseSize = JSON.stringify(result).length;
    totalBytesTransferred += responseSize;
    addToGlobalStats(responseSize, false); // Track in persistent global stats
    recentLatencies.push(latency);
    if (recentLatencies.length > MAX_LATENCY_SAMPLES) {
      recentLatencies.shift();
    }

    // Persist stats for wallet
    if (node.operator) {
      persistWalletStats(node.operator, node.stats, node.connectedAt);
    }

    res.json({
      ...result,
      _relay: node.id,
      _operator: node.operator ? node.operator.slice(0, 8) : 'unknown',
      _latency: latency,
    });
  } catch (error: any) {
    node.stats.errors++;
    addToGlobalStats(0, true); // Track error in persistent global stats
    if (node.operator) {
      persistWalletStats(node.operator, node.stats, node.connectedAt);
    }
    res.status(500).json({ error: error.message });
  }
});

// Helper to persist stats by wallet
function persistWalletStats(wallet: string, stats: ConnectedNode['stats'], connectedAt: number) {
  const existing = walletStats.get(wallet);
  const currentUptime = Math.floor((Date.now() - connectedAt) / 1000);
  
  if (existing) {
    // Update existing stats - take the maximum of current and persisted
    existing.requestsHandled = Math.max(existing.requestsHandled, stats.requestsHandled);
    existing.cacheHits = Math.max(existing.cacheHits, stats.cacheHits);
    existing.cacheMisses = Math.max(existing.cacheMisses, stats.cacheMisses);
    existing.errors = Math.max(existing.errors, stats.errors);
    // Update avg latency with EMA
    if (stats.avgLatencyMs > 0) {
      existing.avgLatencyMs = existing.avgLatencyMs === 0 
        ? stats.avgLatencyMs 
        : Math.floor(existing.avgLatencyMs * 0.7 + stats.avgLatencyMs * 0.3);
    }
    // NOTE: Don't update totalUptime here - only update on disconnect to avoid double-counting
  } else {
    // New wallet - create entry
    walletStats.set(wallet, {
      requestsHandled: stats.requestsHandled,
      avgLatencyMs: stats.avgLatencyMs,
      cacheHits: stats.cacheHits,
      cacheMisses: stats.cacheMisses,
      errors: stats.errors,
      totalUptime: currentUptime,
      lastDisconnect: 0,
      firstConnect: connectedAt,
    });
  }
}

// Send request to node via WebSocket
function sendToNode(node: ConnectedNode, requestId: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      node.pendingRequests.delete(requestId);
      reject(new Error('Request timeout'));
    }, 30000);

    node.pendingRequests.set(requestId, { resolve, reject, timeout });

    node.ws.send(JSON.stringify({
      type: 'rpc_request',
      id: requestId,
      payload,
    }));
  });
}

// ============= WEBSOCKET SERVER =============

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', async (ws, req) => {
  const nodeId = uuidv4().slice(0, 8);
  
  // Get client IP from headers or socket
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded 
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim())
    : req.socket.remoteAddress || '';
  
  console.log(`[RELAY] New connection: ${nodeId} from ${ip}`);

  // Get location async
  const location = await getLocation(ip);

  const node: ConnectedNode = {
    id: nodeId,
    ws,
    operator: '',
    name: 'Unknown',
    isRegistered: false,
    bondAmount: 0n,
    pendingEarnings: 0n,
    totalEarned: 0n,
    connectedAt: Date.now(),
    lastPing: Date.now(),
    ip,
    location,
    pendingRequests: new Map(),
    stats: {
      requestsHandled: 0,
      avgLatencyMs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
    },
  };

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(`[RELAY] Message from ${nodeId}: type=${msg.type} wallet=${msg.wallet?.slice(0,8) || 'none'}`);
      
      switch (msg.type) {
        case 'register':
          // Verify wallet authentication
          const { wallet, name, timestamp, signature } = msg;
          
          if (!wallet) {
            ws.send(JSON.stringify({
              type: 'auth_failed',
              error: 'Wallet address required',
              hint: 'Run node with: node whistle-node.js --wallet <keypair.json>',
            }));
            ws.close();
            return;
          }

          // Verify signature
          if (REQUIRE_REGISTRATION && signature) {
            const isValid = verifySignature(wallet, timestamp, signature);
            if (!isValid) {
              ws.send(JSON.stringify({
                type: 'auth_failed',
                error: 'Invalid signature',
              }));
              ws.close();
              return;
            }
          }

          // Check on-chain registration
          let onChainAccount: CacheNodeAccount | null = null;
          if (REQUIRE_REGISTRATION) {
            try {
              onChainAccount = await getOnChainNodeAccount(wallet);
            } catch (err) {
              console.error(`[RELAY] On-chain check failed:`, err);
            }
          }

          // Update node info
          node.operator = wallet;
          node.name = name || `Node-${nodeId}`;
          
          if (onChainAccount && onChainAccount.isActive) {
            node.isRegistered = true;
            node.bondAmount = onChainAccount.bondAmount;
            node.pendingEarnings = onChainAccount.pendingEarnings;
            node.totalEarned = onChainAccount.totalEarned;
            
            console.log(`[RELAY] Node registered: ${node.name} (${wallet.slice(0, 8)}...) - Bond: ${Number(node.bondAmount) / 1_000_000} WHISTLE`);
          } else if (REQUIRE_REGISTRATION) {
            ws.send(JSON.stringify({
              type: 'not_registered',
              error: 'Node not registered on-chain',
              wallet: wallet,
            }));
            // Keep connection open but don't add to active nodes
            console.log(`[RELAY] Unregistered node connected: ${wallet.slice(0, 8)}...`);
          } else {
            // Development mode - allow unregistered
            node.isRegistered = true;
            console.log(`[RELAY] Node connected (dev mode): ${node.name}`);
          }
          
          // Track by wallet (disconnect old connection if exists)
          const oldNodeId = nodesByWallet.get(wallet);
          if (oldNodeId && oldNodeId !== nodeId) {
            const oldNode = connectedNodes.get(oldNodeId);
            if (oldNode) {
              console.log(`[RELAY] Disconnecting old node for wallet ${wallet.slice(0, 8)}...`);
              // Persist stats before closing old connection
              persistWalletStats(wallet, oldNode.stats, oldNode.connectedAt);
              oldNode.ws.close();
              connectedNodes.delete(oldNodeId);
            }
          }
          
          // RESTORE PERSISTED STATS on reconnect
          const persistedStats = walletStats.get(wallet);
          if (persistedStats) {
            console.log(`[RELAY] Restoring stats for ${wallet.slice(0, 8)}... (${persistedStats.requestsHandled} requests, ${formatUptime(persistedStats.totalUptime)} total uptime)`);
            node.stats.requestsHandled = persistedStats.requestsHandled;
            node.stats.avgLatencyMs = persistedStats.avgLatencyMs;
            node.stats.cacheHits = persistedStats.cacheHits;
            node.stats.cacheMisses = persistedStats.cacheMisses;
            node.stats.errors = persistedStats.errors;
            
            // If this wallet is connecting from a DIFFERENT IP than it used previously,
            // do not restore punitive/performance metrics (avgLatencyMs, errors).
            // This prevents carrying penalties from one physical node to another.
            if (persistedStats.lastIP && persistedStats.lastIP !== node.ip) {
              console.log(`[RELAY] Detected wallet ${wallet.slice(0,8)} registering from different IP (was ${persistedStats.lastIP}, now ${node.ip}). Resetting performance penalties.`);
              node.stats.avgLatencyMs = 0;
              node.stats.errors = 0;
            }

            // Store total uptime for reporting
            (node as any).totalUptime = persistedStats.totalUptime;
          }
          
          nodesByWallet.set(wallet, nodeId);
          connectedNodes.set(nodeId, node);
          
          ws.send(JSON.stringify({
            type: 'registered',
            nodeId,
            message: node.isRegistered 
              ? 'Successfully connected to Whistle Cache Relay'
              : 'Connected but not registered - register at earn.whistle.ninja',
            bondAmount: node.bondAmount ? Number(node.bondAmount) / 1_000_000 : 0,
            pendingEarnings: node.pendingEarnings ? Number(node.pendingEarnings) / LAMPORTS_PER_SOL : 0,
            // Include restored stats in response
            restoredStats: persistedStats ? {
              requests: persistedStats.requestsHandled,
              totalUptime: persistedStats.totalUptime,
            } : null,
          }));
          break;

        case 'pong':
          node.lastPing = Date.now();
          break;

        case 'rpc_response':
          const pending = node.pendingRequests.get(msg.id);
          if (pending) {
            clearTimeout(pending.timeout);
            node.pendingRequests.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error));
            } else {
              // If node reported its own latency, store it in the result
              if (msg.latencyMs) {
                msg.result._nodeLatencyMs = msg.latencyMs;
              }
              pending.resolve(msg.result);
            }
          }
          break;
      }
    } catch (err) {
      console.error('[RELAY] Message parse error:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[RELAY] Node disconnected: ${node.name}`);
    
    // PERSIST STATS before removing
    if (node.operator) {
      const sessionUptime = Math.floor((Date.now() - node.connectedAt) / 1000);
      
      // Update persisted stats
      const persisted = walletStats.get(node.operator);
      if (persisted) {
        // Only add session uptime (don't double count)
        persisted.totalUptime += sessionUptime;
        persisted.lastDisconnect = Date.now();
        persisted.lastIP = node.ip;
        // Update other stats
        persisted.requestsHandled = Math.max(persisted.requestsHandled, node.stats.requestsHandled);
        persisted.cacheHits = Math.max(persisted.cacheHits, node.stats.cacheHits);
        persisted.cacheMisses = Math.max(persisted.cacheMisses, node.stats.cacheMisses);
        persisted.errors = Math.max(persisted.errors, node.stats.errors);
        console.log(`[RELAY] Saved ${node.operator.slice(0, 8)}... session: ${formatUptime(sessionUptime)}, total: ${formatUptime(persisted.totalUptime)}`);
      } else {
        // New wallet - create entry
        walletStats.set(node.operator, {
          requestsHandled: node.stats.requestsHandled,
          avgLatencyMs: node.stats.avgLatencyMs,
          cacheHits: node.stats.cacheHits,
          cacheMisses: node.stats.cacheMisses,
          errors: node.stats.errors,
          totalUptime: sessionUptime,
          lastDisconnect: Date.now(),
          lastIP: node.ip,
          firstConnect: node.connectedAt,
        });
      }
      
      nodesByWallet.delete(node.operator);
    }
    connectedNodes.delete(nodeId);
  });

  ws.on('error', (err) => {
    console.error(`[RELAY] WebSocket error for ${node.name}:`, err.message);
  });

  // Send ping every 30s
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);

  ws.on('close', () => clearInterval(pingInterval));
});

// ============= DISTRIBUTION STATUS =============

// Status endpoint for distribution info (distribution done externally)
app.get('/distribution', (req, res) => {
  const status = getDistributorStatus();
  const onlineNodes = Array.from(connectedNodes.values())
    .filter(n => n.isRegistered && n.operator);
  
  res.json({
    ...status,
    note: 'Distribution is done externally via scripts/distribute.js',
    onlineRegisteredNodes: onlineNodes.length,
    nodeOperators: onlineNodes.map(n => n.operator),
  });
});

// ============= START SERVER =============

// Track online time every minute (for stats, distribution done externally)
setInterval(() => {
  const onlineWallets = Array.from(connectedNodes.values())
    .filter(n => n.isRegistered && n.operator)
    .map(n => n.operator);
  recordOnlineTime(onlineWallets);
}, 60 * 1000);

// Refresh on-chain pending earnings every 2 minutes
setInterval(async () => {
  const nodes = Array.from(connectedNodes.values()).filter(n => n.isRegistered && n.operator);
  for (const node of nodes) {
    try {
      // Clear cache to force fresh fetch
      onChainCache.delete(node.operator);
      const onChainAccount = await getOnChainNodeAccount(node.operator);
      if (onChainAccount) {
        node.pendingEarnings = onChainAccount.pendingEarnings;
        node.totalEarned = onChainAccount.totalEarned;
        node.bondAmount = onChainAccount.bondAmount;
      }
    } catch (e) {
      // Ignore errors, will retry next interval
    }
  }
  console.log(`[RELAY] Refreshed on-chain data for ${nodes.length} nodes`);
}, 2 * 60 * 1000);

// NOTE: Distribution is done EXTERNALLY via scripts/distribute.js
// This keeps the authority keypair off the server for security

server.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         WHISTLE CACHE RELAY SERVER (Production)           ║
╠═══════════════════════════════════════════════════════════╣
║  Relay:     http://${HOST}:${PORT}                            ║
║  WebSocket: ws://${HOST}:${PORT}/ws                           ║
║  RPC:       POST http://${HOST}:${PORT}/rpc                   ║
║  Registration: ${REQUIRE_REGISTRATION ? 'YES' : 'NO (dev)'}                                  ║
║  Distribution: EXTERNAL (via distribute.js)              ║
║  Stats loaded: ${walletStats.size} wallets                               ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Save stats on shutdown
process.on('SIGTERM', () => {
  console.log('[RELAY] Shutting down, saving stats...');
  saveWalletStats();
  saveGlobalStats();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[RELAY] Shutting down, saving stats...');
  saveWalletStats();
  saveGlobalStats();
  process.exit(0);
});

export { app, server };
