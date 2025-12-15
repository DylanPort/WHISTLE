/**
 * SQLite Database Module for Relay Server
 * Persists wallet stats, global stats, and session logs
 */

import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || '/root/cache-node-system/relay.db';

let db: Database.Database;

export interface WalletStats {
  wallet: string;
  requestsHandled: number;
  avgLatencyMs: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
  totalUptime: number;
  lastDisconnect: number;
  firstConnect: number;
}

export interface GlobalStats {
  totalDataServed: number;
  totalRequests: number;
  totalErrors: number;
  startedAt: number;
}

export function initDatabase(): void {
  db = new Database(DB_PATH);
  
  // Ensure tables exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_stats (
      wallet TEXT PRIMARY KEY,
      requests_handled INTEGER DEFAULT 0,
      avg_latency_ms INTEGER DEFAULT 0,
      cache_hits INTEGER DEFAULT 0,
      cache_misses INTEGER DEFAULT 0,
      errors INTEGER DEFAULT 0,
      total_uptime INTEGER DEFAULT 0,
      last_disconnect INTEGER DEFAULT 0,
      first_connect INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS global_stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total_data_served INTEGER DEFAULT 0,
      total_requests INTEGER DEFAULT 0,
      total_errors INTEGER DEFAULT 0,
      started_at INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS session_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      connected_at INTEGER NOT NULL,
      disconnected_at INTEGER NOT NULL,
      session_uptime INTEGER NOT NULL,
      requests_handled INTEGER DEFAULT 0,
      avg_latency_ms INTEGER DEFAULT 0,
      relay_region TEXT DEFAULT 'EU'
    );
  `);
  
  console.log('[DB] SQLite database initialized:', DB_PATH);
}

// ============= WALLET STATS =============

export function getWalletStats(wallet: string): WalletStats | null {
  const row = db.prepare(`
    SELECT wallet, requests_handled as requestsHandled, avg_latency_ms as avgLatencyMs,
           cache_hits as cacheHits, cache_misses as cacheMisses, errors,
           total_uptime as totalUptime, last_disconnect as lastDisconnect, first_connect as firstConnect
    FROM wallet_stats WHERE wallet = ?
  `).get(wallet) as WalletStats | undefined;
  
  return row || null;
}

export function getAllWalletStats(): Map<string, WalletStats> {
  const rows = db.prepare(`
    SELECT wallet, requests_handled as requestsHandled, avg_latency_ms as avgLatencyMs,
           cache_hits as cacheHits, cache_misses as cacheMisses, errors,
           total_uptime as totalUptime, last_disconnect as lastDisconnect, first_connect as firstConnect
    FROM wallet_stats
  `).all() as WalletStats[];
  
  const map = new Map<string, WalletStats>();
  for (const row of rows) {
    map.set(row.wallet, row);
  }
  return map;
}

export function saveWalletStats(stats: WalletStats): void {
  db.prepare(`
    INSERT OR REPLACE INTO wallet_stats 
    (wallet, requests_handled, avg_latency_ms, cache_hits, cache_misses, errors, total_uptime, last_disconnect, first_connect, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    stats.wallet,
    stats.requestsHandled,
    stats.avgLatencyMs,
    stats.cacheHits,
    stats.cacheMisses,
    stats.errors,
    stats.totalUptime,
    stats.lastDisconnect,
    stats.firstConnect,
    Date.now()
  );
}

export function updateWalletUptime(wallet: string, sessionUptime: number, disconnectTime: number): void {
  db.prepare(`
    UPDATE wallet_stats 
    SET total_uptime = total_uptime + ?, last_disconnect = ?, updated_at = ?
    WHERE wallet = ?
  `).run(sessionUptime, disconnectTime, Date.now(), wallet);
}

export function updateWalletStats(wallet: string, updates: Partial<WalletStats>): void {
  const existing = getWalletStats(wallet);
  if (!existing) return;
  
  const merged = { ...existing, ...updates };
  saveWalletStats(merged);
}

// ============= GLOBAL STATS =============

export function getGlobalStats(): GlobalStats {
  const row = db.prepare(`
    SELECT total_data_served as totalDataServed, total_requests as totalRequests,
           total_errors as totalErrors, started_at as startedAt
    FROM global_stats WHERE id = 1
  `).get() as GlobalStats | undefined;
  
  return row || { totalDataServed: 0, totalRequests: 0, totalErrors: 0, startedAt: Date.now() };
}

export function updateGlobalStats(bytes: number, isError: boolean = false): void {
  db.prepare(`
    INSERT OR REPLACE INTO global_stats (id, total_data_served, total_requests, total_errors, started_at)
    VALUES (1,
      COALESCE((SELECT total_data_served FROM global_stats WHERE id = 1), 0) + ?,
      COALESCE((SELECT total_requests FROM global_stats WHERE id = 1), 0) + 1,
      COALESCE((SELECT total_errors FROM global_stats WHERE id = 1), 0) + ?,
      COALESCE((SELECT started_at FROM global_stats WHERE id = 1), ?)
    )
  `).run(bytes, isError ? 1 : 0, Date.now());
}

export function saveGlobalStats(stats: GlobalStats): void {
  db.prepare(`
    INSERT OR REPLACE INTO global_stats (id, total_data_served, total_requests, total_errors, started_at)
    VALUES (1, ?, ?, ?, ?)
  `).run(stats.totalDataServed, stats.totalRequests, stats.totalErrors, stats.startedAt);
}

// ============= SESSION LOG =============

export function logSession(wallet: string, connectedAt: number, disconnectedAt: number, 
                          sessionUptime: number, requestsHandled: number, avgLatencyMs: number,
                          relayRegion: string = 'EU'): void {
  db.prepare(`
    INSERT INTO session_log (wallet, connected_at, disconnected_at, session_uptime, requests_handled, avg_latency_ms, relay_region)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(wallet, connectedAt, disconnectedAt, sessionUptime, requestsHandled, avgLatencyMs, relayRegion);
}

export function getRecentSessions(wallet: string, limit: number = 10): any[] {
  return db.prepare(`
    SELECT * FROM session_log WHERE wallet = ? ORDER BY disconnected_at DESC LIMIT ?
  `).all(wallet, limit);
}

// ============= CLEANUP =============

export function closeDatabase(): void {
  if (db) {
    db.close();
    console.log('[DB] Database closed');
  }
}

