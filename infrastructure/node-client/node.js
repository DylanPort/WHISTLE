#!/usr/bin/env node
/**
 * WHISTLE CACHE NODE v2.1
 * Professional-grade cache node with blockchain status
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const VERSION = '2.5.0'; // Smart caching + geo-detection
const WALLET = process.env.WALLET;

// Relay servers by region
const RELAYS = {
  EU: { url: 'wss://earn.whistle.ninja/ws', name: 'Germany' },
  US: { url: 'wss://us.relay.whistle.ninja/ws', name: 'USA' },
  PL: { url: 'wss://pl.relay.whistle.ninja/ws', name: 'Poland' },
};

// Region mapping - which relay to prefer based on continent/country
const REGION_MAP = {
  // North America → US relay
  'NA': 'US', 'US': 'US', 'CA': 'US', 'MX': 'US',
  // Europe → EU or PL relay
  'EU': 'EU', 'DE': 'EU', 'FR': 'EU', 'GB': 'EU', 'NL': 'EU', 'IT': 'EU', 'ES': 'EU',
  'PL': 'PL', 'CZ': 'PL', 'SK': 'PL', 'HU': 'PL', 'RO': 'PL', 'UA': 'PL', 'BY': 'PL',
  // South America → US relay (closer than EU)
  'SA': 'US', 'BR': 'US', 'AR': 'US', 'CL': 'US', 'CO': 'US',
  // Asia/Oceania → EU for now (will add Asia relay later)
  'AS': 'EU', 'OC': 'EU', 'AU': 'EU', 'JP': 'EU', 'KR': 'EU', 'SG': 'EU', 'IN': 'EU',
  // Africa → EU relay
  'AF': 'EU', 'ZA': 'EU', 'NG': 'EU', 'EG': 'EU',
};

// Will be set after geo-detection
let RELAY_URLS = [RELAYS.EU.url, RELAYS.US.url, RELAYS.PL.url];
let currentRelayIndex = 0;
let detectedRegion = 'Unknown';
const MAX_FAILS_BEFORE_SWITCH = 3;

// Detect region using free IP geolocation API
async function detectRegion() {
  try {
    const response = await new Promise((resolve, reject) => {
      const req = https.get('https://ipapi.co/json/', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
    
    const country = response.country_code || response.country;
    const continent = response.continent_code;
    detectedRegion = `${country} (${response.city || 'Unknown'})`;
    
    // Find best relay for this region
    const preferredRelay = REGION_MAP[country] || REGION_MAP[continent] || 'EU';
    
    // Reorder relays - put preferred first
    if (preferredRelay === 'US') {
      RELAY_URLS = [RELAYS.US.url, RELAYS.EU.url, RELAYS.PL.url];
      console.log(`  \x1b[36mRegion: ${detectedRegion} → Using US relay\x1b[0m`);
    } else if (preferredRelay === 'PL') {
      RELAY_URLS = [RELAYS.PL.url, RELAYS.EU.url, RELAYS.US.url];
      console.log(`  \x1b[36mRegion: ${detectedRegion} → Using Poland relay\x1b[0m`);
    } else {
      RELAY_URLS = [RELAYS.EU.url, RELAYS.PL.url, RELAYS.US.url];
      console.log(`  \x1b[36mRegion: ${detectedRegion} → Using Germany relay\x1b[0m`);
    }
    
    return preferredRelay;
  } catch (err) {
    console.log(`  \x1b[33mCould not detect region, using default (Germany)\x1b[0m`);
    return 'EU';
  }
}
const RPC_URL = 'https://rpc.whistle.ninja/direct';
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const DATA_DIR = path.join(os.homedir(), '.whistle-node');
const DATA_FILE = path.join(DATA_DIR, 'node-data.json');

// Program addresses
const PROGRAM_ID = 'whttByewzTQzAz3VMxnyJHdKsd7AyNRdG2tDHXVTksr';
const CACHE_POOL = 'GC6sMFWLgm2ziEhtreQSCiVLsWkeQeLif5zdFqff6NGo';

if (!WALLET) {
  console.error('\x1b[31mError: WALLET environment variable required!\x1b[0m');
  console.error('Usage: WALLET=YourAddress node whistle-node.js');
  process.exit(1);
}

// CRITICAL: Never crash on errors - always reconnect
process.on('uncaughtException', (err) => {
  console.error('\x1b[31m[ERROR] Uncaught exception:\x1b[0m', err.message);
  // Don't exit - try to reconnect
  setTimeout(() => { try { connect(); } catch(e) {} }, 5000);
});

process.on('unhandledRejection', (err) => {
  console.error('\x1b[31m[ERROR] Unhandled rejection:\x1b[0m', err?.message || err);
  // Don't exit - continue running
});

let WebSocket;
if (typeof globalThis.WebSocket !== 'undefined') WebSocket = globalThis.WebSocket;
else try { WebSocket = require('ws'); } catch (e) { console.error('\x1b[31mRun: npm install -g ws\x1b[0m'); process.exit(1); }

const NAME = `${os.hostname().slice(0, 10)}-${WALLET.slice(0, 4)}`;
let ws = null, connected = false, reconnectAttempts = 0, sessionStart = Date.now(), lastPing = Date.now();

// Session stats
const session = { requests: 0, hits: 0, errors: 0, latencySum: 0, peak: 0, bytes: 0, bypassedCache: 0 };
const requestLog = [];
const MAX_LOG = 15;

// Smart Cache System
const cache = new Map();
const CACHE_MAX_SIZE = 5000; // Allow more cached items

// TTLs in milliseconds - tuned for Solana's ~400ms slot time
const CACHE_TTL = {
  // Slot-level data (changes every 400ms, but 500ms cache is fine for most uses)
  'getSlot': 500,
  'getBlockHeight': 500,
  'getRecentBlockhash': 500,
  'getLatestBlockhash': 500,
  
  // Account data (short cache - balance can change quickly)
  'getAccountInfo': 800,           // ~2 slots - good for reads
  'getBalance': 1500,              // 1.5 sec - balances don't change that fast
  'getTokenAccountBalance': 1500,
  'getTokenAccountsByOwner': 3000, // 3 sec - token lists rarely change
  'getProgramAccounts': 5000,      // 5 sec - expensive call, cache longer
  'getMultipleAccounts': 800,
  
  // Block/transaction data (immutable once confirmed)
  'getBlock': 60000,               // 1 min - blocks don't change
  'getTransaction': 300000,        // 5 min - confirmed txs are immutable
  'getSignaturesForAddress': 5000, // 5 sec
  'getConfirmedTransaction': 300000,
  
  // Network/epoch data (slow-changing)
  'getEpochInfo': 30000,           // 30 sec
  'getEpochSchedule': 300000,      // 5 min
  'getHealth': 5000,
  'getVersion': 300000,            // 5 min
  'getGenesisHash': 3600000,       // 1 hour - never changes
  'getMinimumBalanceForRentExemption': 60000, // 1 min
  'getClusterNodes': 60000,
  'getVoteAccounts': 30000,
  'getSupply': 30000,
  'getInflationRate': 60000,
  
  'default': 1000                  // 1 sec default
};

// NEVER cache these methods - they must always hit the validator
const NO_CACHE_METHODS = new Set([
  'sendTransaction',
  'sendRawTransaction', 
  'simulateTransaction',
  'requestAirdrop',
  'getSignatureStatuses',  // Need real-time confirmation status
  'getRecentPerformanceSamples',
  'getFeeForMessage',
]);

// Blockchain data
let blockchain = {
  poolBalance: 0,
  nodeEarnings: 0,
  bondAmount: 0,
  totalEarned: 0,
  isRegistered: false,
  lastUpdate: 0
};

// Persisted data
let persisted = { totalRequests: 0, totalUptime: 0, sessions: 0, totalEarnings: 0 };
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

// Colors
const C = {
  r: '\x1b[0m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[36m', 
  d: '\x1b[90m', B: '\x1b[1m', red: '\x1b[31m', m: '\x1b[35m'
};

// ============= DATA PERSISTENCE =============

function loadData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DATA_FILE)) persisted = { ...persisted, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch (e) {}
}

function saveData() {
  try {
    persisted.totalUptime += Math.floor((Date.now() - sessionStart) / 1000);
    sessionStart = Date.now();
    fs.writeFileSync(DATA_FILE, JSON.stringify(persisted, null, 2));
  } catch (e) {}
}

// ============= FORMATTING =============

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h < 24) return h + 'h ' + m + 'm';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}

function fmtBytes(b) {
  if (b > 1048576) return (b / 1048576).toFixed(1) + 'MB';
  if (b > 1024) return (b / 1024).toFixed(1) + 'KB';
  return b + 'B';
}

function fmtSOL(lamports) {
  const sol = lamports / 1e9;
  if (sol >= 1) return sol.toFixed(4) + ' SOL';
  if (sol >= 0.001) return sol.toFixed(6) + ' SOL';
  return sol.toFixed(9) + ' SOL';
}

function pad(str, len, char = ' ') {
  str = String(str);
  return str.length >= len ? str.slice(0, len) : str + char.repeat(len - str.length);
}

function padL(str, len, char = ' ') {
  str = String(str);
  return str.length >= len ? str.slice(0, len) : char.repeat(len - str.length) + str;
}

// ============= BLOCKCHAIN DATA FETCHING =============

function solanaRPC(method, params = []) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const url = new URL(SOLANA_RPC);
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 10000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json.result);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

async function fetchBlockchainData() {
  // Fetch node data from relay (which fetches on-chain)
  try {
    const relayUrl = 'https://earn.whistle.ninja/relay/node/' + WALLET;
    const nodeData = await new Promise((resolve, reject) => {
      https.get(relayUrl, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      }).on('error', reject);
    });
    if (nodeData && nodeData.onChain) {
      blockchain.bondAmount = (nodeData.onChain.bondAmount || 0) * 1e6;
      blockchain.nodeEarnings = nodeData.onChain.pendingEarnings || 0;
      blockchain.totalEarned = nodeData.onChain.totalEarned || 0;
      blockchain.isRegistered = nodeData.onChain.isActive || nodeData.registered;
    }
  } catch (e) {}
  
  // Also get pool balance
  try {
    const poolInfo = await solanaRPC('getBalance', [CACHE_POOL]);
    if (poolInfo && poolInfo.value !== undefined) {
      blockchain.poolBalance = poolInfo.value;
    }
    blockchain.lastUpdate = Date.now();
  } catch (e) {}
}

// ============= TERMINAL UI =============

function render() {
  const W = process.stdout.columns || 100;
  const H = process.stdout.rows || 30;
  const COL1 = 38;
  const COL2 = W - COL1 - 3;
  
  console.clear();
  
  // Header
  console.log('');
  console.log(`${C.b}  ╦ ╦╦ ╦╦╔═╗╔╦╗╦  ╔═╗  ${C.g}╔═╗╔═╗╔═╗╦ ╦╔═╗  ${C.B}╔╗╔╔═╗╔╦╗╔═╗${C.r}`);
  console.log(`${C.b}  ║║║╠═╣║╚═╗ ║ ║  ║╣   ${C.g}║  ╠═╣║  ╠═╣║╣   ${C.B}║║║║ ║ ║║║╣ ${C.r}`);
  console.log(`${C.b}  ╚╩╝╩ ╩╩╚═╝ ╩ ╩═╝╚═╝  ${C.g}╚═╝╩ ╩╚═╝╩ ╩╚═╝  ${C.B}╝╚╝╚═╝═╩╝╚═╝${C.r}  ${C.d}v${VERSION}${C.r}`);
  console.log('');
  
  // Status bar
  const status = connected ? `${C.g}● ONLINE${C.r}` : `${C.y}○ CONNECTING${C.r}`;
  const uptime = fmtTime(Date.now() - sessionStart + (persisted.totalUptime * 1000));
  const currentRelay = RELAY_URLS[currentRelayIndex] || 'Unknown';
  const relayName = currentRelay.includes('us.relay') ? '🇺🇸 USA' : 
                    currentRelay.includes('pl.relay') ? '🇵🇱 Poland' : '🇩🇪 Germany';
  
  console.log(`  ${C.d}Wallet:${C.r} ${WALLET.slice(0,8)}...${WALLET.slice(-4)}  ${C.d}|${C.r}  ${status}  ${C.d}|${C.r}  ${C.d}Uptime:${C.r} ${C.g}${uptime}${C.r}`);
  console.log(`  ${C.d}Region:${C.r} ${C.b}${detectedRegion}${C.r}  ${C.d}|${C.r}  ${C.d}Relay:${C.r} ${C.b}${relayName}${C.r}  ${C.d}|${C.r}  ${C.d}Failover:${C.r} ${C.g}${RELAY_URLS.length} servers${C.r}`);
  console.log(`  ${C.b}${'─'.repeat(Math.min(W - 4, 80))}${C.r}`);
  console.log('');
  
  // Two columns
  const line1L = `  ${C.B}BLOCKCHAIN${C.r}`;
  const line1R = `${C.B}PERFORMANCE${C.r}`;
  console.log(`${pad(line1L, COL1)}│ ${line1R}`);
  console.log(`  ${C.d}${'─'.repeat(COL1 - 3)}${C.r}┼${C.d}${'─'.repeat(Math.min(COL2, 50))}${C.r}`);
  
  // Pool Balance
  const poolSOL = blockchain.poolBalance / 1e9;
  const poolStr = poolSOL > 0 ? `${C.g}${poolSOL.toFixed(4)} SOL${C.r}` : `${C.d}Loading...${C.r}`;
  console.log(`${pad(`  ${C.d}Rewards Pool:${C.r} ${poolStr}`, COL1 + 15)}│ ${C.d}Requests:${C.r}  ${C.B}${session.requests}${C.r}`);
  
  // Pending Earnings
  const earnStr = blockchain.nodeEarnings > 0 ? `${C.g}${fmtSOL(blockchain.nodeEarnings)}${C.r}` : `${C.d}0.0000 SOL${C.r}`;
  const avgLat = session.requests > 0 ? Math.round(session.latencySum / session.requests) : 0;
  const latColor = avgLat < 100 ? C.g : avgLat < 300 ? C.y : C.red;
  console.log(`${pad(`  ${C.d}Your Pending:${C.r} ${earnStr}`, COL1 + 15)}│ ${C.d}Avg Latency:${C.r} ${latColor}${avgLat}ms${C.r}`);
  
  // Total Earned
  const totalStr = blockchain.totalEarned > 0 ? `${C.m}${fmtSOL(blockchain.totalEarned)}${C.r}` : `${C.d}0.0000 SOL${C.r}`;
  const hitRate = session.requests > 0 ? Math.round((session.hits / session.requests) * 100) : 0;
  const hitColor = hitRate > 50 ? C.g : hitRate > 20 ? C.y : C.d;
  console.log(`${pad(`  ${C.d}Total Earned:${C.r} ${totalStr}`, COL1 + 15)}│ ${C.d}Cache Hit:${C.r}   ${hitColor}${hitRate}% (${session.hits}/${session.requests})${C.r}`);
  
  // Bond Amount
  const bondStr = blockchain.bondAmount > 0 ? `${C.b}${(blockchain.bondAmount / 1e6).toFixed(0)} WHISTLE${C.r}` : `${C.d}Not bonded${C.r}`;
  console.log(`${pad(`  ${C.d}Bond Amount:${C.r}  ${bondStr}`, COL1 + 15)}│ ${C.d}Peak:${C.r}        ${C.y}${session.peak}ms${C.r}`);
  
  // Registration status
  const regStr = blockchain.isRegistered ? `${C.g}Registered${C.r}` : `${C.y}Unregistered${C.r}`;
  const errRate = session.requests > 0 ? ((session.errors / session.requests) * 100).toFixed(1) : '0.0';
  console.log(`${pad(`  ${C.d}Status:${C.r}       ${regStr}`, COL1 + 15)}│ ${C.d}Errors:${C.r}      ${session.errors > 0 ? C.red : C.g}${session.errors} (${errRate}%)${C.r}`);
  
  // Cache size
  console.log(`${pad(`  ${C.d}Last Update:${C.r}  ${C.d}${blockchain.lastUpdate ? fmtTime(Date.now() - blockchain.lastUpdate) + ' ago' : 'Never'}${C.r}`, COL1 + 15)}│ ${C.d}Cache:${C.r}       ${C.b}${cache.size} items${C.r}`);
  
  // Data transferred
  console.log(`${pad(`  `, COL1)}│ ${C.d}Data:${C.r}        ${C.b}${fmtBytes(session.bytes)}${C.r}`);
  
  console.log(`  ${C.d}${'─'.repeat(COL1 - 3)}${C.r}┴${C.d}${'─'.repeat(Math.min(COL2, 50))}${C.r}`);
  console.log('');
  
  // Request Log Header
  console.log(`  ${C.B}RECENT REQUESTS${C.r}`);
  console.log(`  ${C.d}${'─'.repeat(Math.min(W - 4, 75))}${C.r}`);
  
  if (requestLog.length === 0) {
    console.log(`  ${C.d}Waiting for requests...${C.r}`);
  } else {
    // Show recent requests
    const toShow = requestLog.slice(-MAX_LOG);
    for (const req of toShow) {
      const time = `${C.d}${req.time}${C.r}`;
      const method = pad(req.method, 22);
      const status = req.error ? `${C.red}ERR${C.r}` : `${C.g}OK ${C.r}`;
      const latColor = req.latency < 100 ? C.g : req.latency < 300 ? C.y : C.red;
      const lat = `${latColor}${padL(req.latency, 4)}ms${C.r}`;
      const source = req.cached ? `${C.b}CACHE${C.r}` : `${C.d}RPC  ${C.r}`;
      console.log(`  ${time}  ${method} ${status} ${lat}  ${source}`);
    }
  }
  
  // Footer
  console.log('');
  console.log(`  ${C.d}Press Ctrl+C to stop${C.r}`);
}

// ============= RPC HANDLING =============

function fetchRPC(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const url = new URL(RPC_URL);
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-Cache-Node': 'true' },
      agent: httpsAgent, timeout: 15000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ data: JSON.parse(body), size: Buffer.byteLength(body) }); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

async function handleRequest(msg) {
  const start = Date.now();
  const method = msg.payload?.method || 'unknown';
  
  // Build cache key - method + stringified params
  const key = method + ':' + JSON.stringify(msg.payload?.params || []);
  
  let result = null, error = null, cached = false, size = 0;
  
  // Check if this method should be cached
  const shouldCache = !NO_CACHE_METHODS.has(method);
  const ttl = CACHE_TTL[method] || CACHE_TTL['default'];
  
  if (!shouldCache) session.bypassedCache++;
  
  // Try cache first (only for cacheable methods)
  if (shouldCache) {
    const cachedData = cache.get(key);
    if (cachedData && Date.now() - cachedData.ts < ttl) {
      result = cachedData.data;
      cached = true;
      size = cachedData.size;
      session.hits++;
    }
  }
  
  // If not cached, fetch from RPC
  if (!cached) {
    try {
      const res = await fetchRPC(msg.payload);
      result = res.data;
      size = res.size;
      
      // Only cache successful responses for cacheable methods
      if (shouldCache && result && !result.error) {
        cache.set(key, { data: result, ts: Date.now(), size });
        
        // Evict old entries if cache is too large
        if (cache.size > CACHE_MAX_SIZE) {
          // Delete oldest 10% of entries
          const toDelete = Math.floor(CACHE_MAX_SIZE * 0.1);
          const keys = cache.keys();
          for (let i = 0; i < toDelete; i++) {
            const k = keys.next().value;
            if (k) cache.delete(k);
          }
        }
      }
    } catch (e) {
      error = e.message;
      session.errors++;
    }
  }
  
  const lat = Date.now() - start;
  session.requests++;
  session.latencySum += lat;
  session.bytes += size;
  if (lat > session.peak) session.peak = lat;
  
  // Log request
  requestLog.push({
    time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
    method,
    latency: lat,
    cached,
    error: !!error
  });
  if (requestLog.length > 50) requestLog.shift();
  
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'rpc_response', id: msg.id, result: error ? undefined : result, error: error || undefined, latencyMs: lat, cached }));
  }
  
  render();
}

// ============= WEBSOCKET CONNECTION =============

function connect() {
  if (ws) try { ws.close(); } catch (e) {}
  
  // Cycle to next relay after too many failures
  if (reconnectAttempts >= MAX_FAILS_BEFORE_SWITCH) {
    currentRelayIndex = (currentRelayIndex + 1) % RELAY_URLS.length;
    reconnectAttempts = 0;
    console.log(`  Switching to relay: ${RELAY_URLS[currentRelayIndex]}`);
  }
  
  const relayUrl = RELAY_URLS[currentRelayIndex];
  
  try {
    ws = new WebSocket(relayUrl);
  } catch (err) {
    console.log(`  \x1b[31mFailed to connect to ${relayUrl}: ${err.message}\x1b[0m`);
    reconnectAttempts++;
    setTimeout(connect, 5000);
    return;
  }
  
  const onOpen = () => {
    // Don't set connected yet - wait for 'registered' response
    reconnectAttempts = 0;
    console.log(`  Connected to: ${relayUrl}`);
    lastPing = Date.now();
    console.log(`  ${C.d}WebSocket opened, sending register...${C.r}`);
    try {
      const msg = JSON.stringify({ type: 'register', wallet: WALLET, name: NAME, timestamp: Date.now(), signature: 'v2' });
      console.log(`  ${C.d}Sending: ${msg.slice(0, 80)}...${C.r}`);
      ws.send(msg);
      console.log(`  ${C.g}✓ Register message sent${C.r}`);
    } catch (err) {
      console.error(`  ${C.red}✗ Failed to send register:${C.r}`, err.message);
    }
  };
  
  const onMessage = async (event) => {
    try {
      const raw = event.data !== undefined ? event.data : event;
      const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      
      if (msg.type === 'registered') {
        connected = true;
        persisted.sessions++;
        console.log(`  ${C.g}✓ Registered with relay!${C.r} Node ID: ${msg.nodeId || 'unknown'}`);
        // Store on-chain data if provided
        if (msg.bondAmount) blockchain.bondAmount = msg.bondAmount * 1e6;
        if (msg.pendingEarnings) blockchain.nodeEarnings = msg.pendingEarnings * 1e9;
        render();
      } else if (msg.type === 'not_registered') {
        console.log(`  ${C.y}! Not registered on-chain:${C.r} ${msg.error || 'Unknown'}`);
        connected = false;
        render();
      } else if (msg.type === 'auth_failed') {
        console.log(`  ${C.red}✗ Auth failed:${C.r} ${msg.error || 'Unknown'}`);
        connected = false;
      } else if (msg.type === 'ping') {
        lastPing = Date.now();
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (msg.type === 'rpc_request') {
        await handleRequest(msg);
      }
    } catch (e) {}
  };
  
  const onClose = () => {
    connected = false;
    reconnectAttempts++;
    render();
    setTimeout(connect, Math.min(2000 * Math.pow(2, reconnectAttempts - 1), 30000));
  };
  
  if (typeof ws.on === 'function') {
    ws.on('open', onOpen);
    ws.on('message', onMessage);
    ws.on('close', onClose);
    ws.on('error', () => {});
  } else {
    ws.onopen = onOpen;
    ws.onmessage = onMessage;
    ws.onclose = onClose;
    ws.onerror = () => {};
  }
}

// ============= INTERVALS =============

// Health check & proactive failover
setInterval(() => {
  const timeSincePing = Date.now() - lastPing;
  
  // If no ping in 60 seconds, connection is stale - proactively switch relay
  if (connected && timeSincePing > 60000) {
    console.log(`  \x1b[33mNo ping for ${Math.floor(timeSincePing/1000)}s - switching relay...\x1b[0m`);
    connected = false;
    reconnectAttempts = MAX_FAILS_BEFORE_SWITCH; // Force switch to next relay
    try { ws.close(); } catch (e) {}
    connect();
  }
  // If not connected and no activity for 2 min, force reconnect
  else if (!connected && timeSincePing > 120000) {
    console.log(`  \x1b[33mForcing reconnect...\x1b[0m`);
    connect();
  }
  
  saveData();
}, 30000);

// Fetch blockchain data every 60 seconds
setInterval(fetchBlockchainData, 60000);

// Refresh display every 5 seconds (even without requests)
setInterval(() => {
  if (connected) render();
}, 5000);

// ============= SHUTDOWN =============

process.on('SIGINT', () => {
  console.clear();
  console.log(`\n  ${C.b}WHISTLE CACHE NODE - Session Summary${C.r}`);
  console.log(`  ${C.d}${'─'.repeat(40)}${C.r}`);
  console.log(`  ${C.d}Requests:${C.r}    ${C.B}${session.requests}${C.r}`);
  console.log(`  ${C.d}Cache Hits:${C.r}  ${C.g}${session.hits}${C.r}`);
  console.log(`  ${C.d}Errors:${C.r}      ${session.errors > 0 ? C.red : C.g}${session.errors}${C.r}`);
  console.log(`  ${C.d}Data:${C.r}        ${C.b}${fmtBytes(session.bytes)}${C.r}`);
  console.log(`  ${C.d}${'─'.repeat(40)}${C.r}`);
  
  persisted.totalRequests += session.requests;
  saveData();
  
  console.log(`  ${C.g}✓${C.r} Data saved to ${DATA_FILE}`);
  console.log('');
  process.exit(0);
});

// ============= START =============

async function start() {
  loadData();
  
  // Detect region and pick nearest relay
  console.log(`  \x1b[36mDetecting your region...\x1b[0m`);
  await detectRegion();
  
  fetchBlockchainData();
  render();
  connect();
}

start();
