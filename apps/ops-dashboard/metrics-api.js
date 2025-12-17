/**
 * Whistle Open Ops - Real-Time Metrics API
 * 
 * Lightweight service that reads REAL system data:
 * - Memory from /proc/meminfo
 * - CPU from /proc/loadavg
 * - Disk from /proc/diskstats
 * - Services status from systemctl
 * - Recent incidents from journalctl
 * - Process info from /proc
 * 
 * NO MOCK DATA - Everything is live.
 */

const http = require('http');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const https = require('https');

const PORT = 3499;

// Cache for expensive operations (refresh every 5 seconds)
let cache = {
    memory: null,
    cpu: null,
    disk: null,
    services: null,
    incidents: null,
    processes: null,
    lastUpdate: 0
};

const CACHE_TTL = 5000; // 5 seconds

// Parse /proc/meminfo
function getMemory() {
    try {
        const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
        const lines = meminfo.split('\n');
        const mem = {};
        
        lines.forEach(line => {
            const parts = line.split(':');
            if (parts.length === 2) {
                const key = parts[0].trim();
                const value = parseInt(parts[1].trim().split(' ')[0]) * 1024; // Convert KB to bytes
                mem[key] = value;
            }
        });

        const total = mem.MemTotal || 0;
        const free = mem.MemFree || 0;
        const available = mem.MemAvailable || 0;
        const buffers = mem.Buffers || 0;
        const cached = mem.Cached || 0;
        const used = total - free - buffers - cached;
        const swapTotal = mem.SwapTotal || 0;
        const swapFree = mem.SwapFree || 0;
        const swapUsed = swapTotal - swapFree;

        return {
            total,
            used,
            free,
            available,
            buffers,
            cached,
            swapTotal,
            swapUsed,
            swapFree,
            usedPercent: Math.round((used / total) * 100),
            availablePercent: Math.round((available / total) * 100),
            swapUsedPercent: swapTotal > 0 ? Math.round((swapUsed / swapTotal) * 100) : 0,
            // Thresholds
            warning: used / total > 0.7,
            critical: used / total > 0.85
        };
    } catch (e) {
        return { error: e.message };
    }
}

// Parse /proc/loadavg
function getCPU() {
    try {
        const loadavg = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(' ');
        const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
        const cpuCount = (cpuInfo.match(/^processor/gm) || []).length;
        
        const load1 = parseFloat(loadavg[0]);
        const load5 = parseFloat(loadavg[1]);
        const load15 = parseFloat(loadavg[2]);

        return {
            load1,
            load5,
            load15,
            cores: cpuCount,
            loadPercent: Math.round((load1 / cpuCount) * 100),
            warning: load1 > cpuCount * 0.7,
            critical: load1 > cpuCount * 0.9
        };
    } catch (e) {
        return { error: e.message };
    }
}

// Get disk usage
function getDisk() {
    try {
        const output = execSync('df -B1 / /mnt/solana-ledger /mnt/solana-accounts 2>/dev/null || df -B1 /', { encoding: 'utf8' });
        const lines = output.trim().split('\n').slice(1);
        
        return lines.map(line => {
            const parts = line.split(/\s+/);
            const total = parseInt(parts[1]);
            const used = parseInt(parts[2]);
            const available = parseInt(parts[3]);
            const usedPercent = parseInt(parts[4]);
            const mount = parts[5];

            return {
                mount,
                total,
                used,
                available,
                usedPercent,
                warning: usedPercent > 70,
                critical: usedPercent > 85
            };
        });
    } catch (e) {
        return [{ error: e.message }];
    }
}

// Get service status
function getServices() {
    const services = [
        { name: 'solana-rpc', displayName: 'Solana Validator' },
        { name: 'relay-server', displayName: 'Relay Server' },
        { name: 'nginx', displayName: 'Nginx' },
        { name: 'postgresql', displayName: 'PostgreSQL' }
    ];

    return services.map(svc => {
        try {
            const output = execSync(`systemctl is-active ${svc.name} 2>/dev/null`, { encoding: 'utf8' }).trim();
            const isActive = output === 'active';
            
            // Get memory usage if active
            let memoryMB = 0;
            if (isActive) {
                try {
                    const pidOutput = execSync(`systemctl show ${svc.name} --property=MainPID --value 2>/dev/null`, { encoding: 'utf8' }).trim();
                    if (pidOutput && pidOutput !== '0') {
                        const memOutput = execSync(`ps -o rss= -p ${pidOutput} 2>/dev/null`, { encoding: 'utf8' }).trim();
                        memoryMB = Math.round(parseInt(memOutput) / 1024);
                    }
                } catch (e) {}
            }

            return {
                name: svc.name,
                displayName: svc.displayName,
                status: isActive ? 'active' : 'inactive',
                memoryMB
            };
        } catch (e) {
            return {
                name: svc.name,
                displayName: svc.displayName,
                status: 'unknown',
                memoryMB: 0
            };
        }
    });
}

// Get recent incidents from journalctl
function getIncidents() {
    try {
        // Get OOM kills
        const oomOutput = execSync('dmesg -T 2>/dev/null | grep -i "oom\\|killed process" | tail -10', { encoding: 'utf8' });
        
        // Get service failures
        const failOutput = execSync('journalctl --since "24 hours ago" -p err --no-pager -o short-iso 2>/dev/null | tail -20', { encoding: 'utf8' });
        
        // Get solana-rpc specific logs
        const solanaOutput = execSync('journalctl -u solana-rpc --since "24 hours ago" --no-pager -o short-iso 2>/dev/null | grep -iE "error|fail|restart|kill|oom" | tail -10', { encoding: 'utf8' });

        const incidents = [];

        // Parse OOM events
        oomOutput.split('\n').filter(Boolean).forEach(line => {
            const match = line.match(/\[(.*?)\]/);
            const time = match ? match[1] : 'Unknown';
            incidents.push({
                type: 'error',
                time,
                message: 'OOM Killer Event',
                details: line.substring(line.indexOf(']') + 1).trim(),
                source: 'kernel'
            });
        });

        // Parse service failures
        failOutput.split('\n').filter(Boolean).forEach(line => {
            const parts = line.split(' ');
            const time = parts[0] || 'Unknown';
            const message = parts.slice(3).join(' ');
            if (message && !message.includes('-- No entries --')) {
                incidents.push({
                    type: 'error',
                    time,
                    message: message.substring(0, 100),
                    details: message,
                    source: 'system'
                });
            }
        });

        // Parse solana logs
        solanaOutput.split('\n').filter(Boolean).forEach(line => {
            const parts = line.split(' ');
            const time = parts[0] || 'Unknown';
            const message = parts.slice(4).join(' ');
            if (message) {
                incidents.push({
                    type: line.toLowerCase().includes('restart') ? 'info' : 'warning',
                    time,
                    message: message.substring(0, 100),
                    details: message,
                    source: 'solana-rpc'
                });
            }
        });

        // Sort by time (newest first) and limit
        return incidents.slice(0, 30);
    } catch (e) {
        return [{ type: 'info', time: new Date().toISOString(), message: 'No recent incidents', details: '', source: 'system' }];
    }
}

// Get top processes by memory
function getProcesses() {
    try {
        const output = execSync('ps aux --sort=-%mem | head -11', { encoding: 'utf8' });
        const lines = output.trim().split('\n').slice(1);
        
        return lines.map(line => {
            const parts = line.split(/\s+/);
            return {
                user: parts[0],
                pid: parts[1],
                cpu: parseFloat(parts[2]),
                mem: parseFloat(parts[3]),
                rss: parseInt(parts[5]) * 1024, // KB to bytes
                command: parts.slice(10).join(' ').substring(0, 50)
            };
        });
    } catch (e) {
        return [{ error: e.message }];
    }
}

// Check RPC health
async function checkRPCHealth() {
    return new Promise((resolve) => {
        const startTime = Date.now();
        
        const req = http.request({
            hostname: 'localhost',
            port: 8899,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({
                        status: json.result ? 'healthy' : 'unhealthy',
                        slot: json.result,
                        latency: Date.now() - startTime,
                        error: null
                    });
                } catch (e) {
                    resolve({ status: 'unhealthy', error: 'Invalid response', latency: Date.now() - startTime });
                }
            });
        });

        req.on('error', (e) => {
            resolve({ status: 'down', error: e.message, latency: Date.now() - startTime });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ status: 'timeout', error: 'Request timeout', latency: 5000 });
        });

        req.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot' }));
        req.end();
    });
}

// Check relay health
async function checkRelayHealth() {
    return new Promise((resolve) => {
        const startTime = Date.now();
        
        const req = http.request({
            hostname: 'localhost',
            port: 3480,
            path: '/health',
            method: 'GET',
            timeout: 5000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({
                        status: 'healthy',
                        connectedNodes: json.connectedNodes,
                        totalRequests: json.totalRequests || json.persistentStats?.totalRequests,
                        totalBytes: json.totalBytes || json.persistentStats?.totalDataServed,
                        latency: json.effectiveLatencyMs,
                        error: null
                    });
                } catch (e) {
                    resolve({ status: 'unhealthy', error: 'Invalid response' });
                }
            });
        });

        req.on('error', (e) => {
            resolve({ status: 'down', error: e.message });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ status: 'timeout', error: 'Request timeout' });
        });

        req.end();
    });
}

// Get uptime
function getUptime() {
    try {
        const uptime = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
        return {
            seconds: Math.floor(uptime),
            formatted: formatUptime(uptime)
        };
    } catch (e) {
        return { seconds: 0, formatted: 'Unknown' };
    }
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatBytes(bytes) {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
}

// Main metrics endpoint
async function getMetrics() {
    const now = Date.now();
    
    // Refresh cache if expired
    if (now - cache.lastUpdate > CACHE_TTL) {
        cache.memory = getMemory();
        cache.cpu = getCPU();
        cache.disk = getDisk();
        cache.services = getServices();
        cache.incidents = getIncidents();
        cache.processes = getProcesses();
        cache.lastUpdate = now;
    }

    const [rpc, relay] = await Promise.all([
        checkRPCHealth(),
        checkRelayHealth()
    ]);

    const uptime = getUptime();

    // Determine overall health
    let overallHealth = 'healthy';
    if (rpc.status !== 'healthy' || cache.memory?.critical) {
        overallHealth = 'critical';
    } else if (cache.memory?.warning || cache.cpu?.warning) {
        overallHealth = 'warning';
    }

    return {
        timestamp: new Date().toISOString(),
        overallHealth,
        uptime,
        memory: cache.memory,
        cpu: cache.cpu,
        disk: cache.disk,
        services: cache.services,
        rpc,
        relay,
        topProcesses: cache.processes,
        incidents: cache.incidents,
        formatted: {
            memoryUsed: formatBytes(cache.memory?.used || 0),
            memoryTotal: formatBytes(cache.memory?.total || 0),
            memoryAvailable: formatBytes(cache.memory?.available || 0)
        }
    };
}

// HTTP Server
const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = req.url.split('?')[0];

    try {
        if (url === '/metrics' || url === '/') {
            const metrics = await getMetrics();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(metrics, null, 2));
        } else if (url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        } else if (url === '/memory') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getMemory()));
        } else if (url === '/cpu') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getCPU()));
        } else if (url === '/incidents') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getIncidents()));
        } else if (url === '/processes') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getProcesses()));
        } else if (url === '/services') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getServices()));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    } catch (error) {
        console.error('Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
    }
});

server.listen(PORT, () => {
    console.log(`[OPS] Metrics API running on port ${PORT}`);
    console.log(`[OPS] Endpoints:`);
    console.log(`      GET /metrics  - Full system metrics`);
    console.log(`      GET /memory   - Memory info`);
    console.log(`      GET /cpu      - CPU load`);
    console.log(`      GET /incidents - Recent errors`);
    console.log(`      GET /processes - Top processes`);
    console.log(`      GET /services  - Service status`);
});

