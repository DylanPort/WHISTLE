const http = require('http');
const https = require('https');
const { Pool } = require('pg');
const WebSocket = require('ws');
const url = require('url');

// ============ CONFIGURATION ============
const VALIDATOR_HOST = '127.0.0.1';
const VALIDATOR_PORT = 8899;
const API_PORT = 3333;  // /v1/ endpoints
const PROXY_PORT = 8901;

const WHITELISTED_DOMAINS = [
  'whistle.ninja',
  'dex.whistle.ninja',
  'api.whistle.ninja',
  'provider.whistle.ninja',
  'ai.whistle.ninja',
  'localhost',
  '127.0.0.1'
];

// Internal keys that bypass everything (for AI agent, etc)
const INTERNAL_KEYS = new Set([
  'wsk_internal_ai_whistle_2024',
  'wsk_internal_system_2024'
]);

// PostgreSQL connection
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'whistle_api',
  user: 'whistle',
  password: process.env.DB_PASSWORD || 'whistle_secure_2024'
});

// Rate limit tracking (in-memory)
const rateLimitMap = new Map(); // apiKey -> { count, resetTime }

// ============ HELPER FUNCTIONS ============

function isWhitelisted(req) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  
  for (const domain of WHITELISTED_DOMAINS) {
    if (origin.includes(domain) || referer.includes(domain)) {
      return true;
    }
  }
  return false;
}

function extractApiKey(req) {
  // Check query params
  const parsedUrl = url.parse(req.url, true);
  if (parsedUrl.query.api_key) {
    return parsedUrl.query.api_key;
  }
  
  // Check headers
  if (req.headers['x-api-key']) {
    return req.headers['x-api-key'];
  }
  
  if (req.headers.authorization) {
    const auth = req.headers.authorization;
    if (auth.startsWith('Bearer ')) {
      return auth.slice(7);
    }
  }
  
  return null;
}

function isInternalKey(apiKey) {
  return INTERNAL_KEYS.has(apiKey);
}

async function validateApiKey(apiKey) {
  try {
    const result = await pool.query(
      `SELECT * FROM subscriptions 
       WHERE api_key = $1 AND expires_at > NOW()`,
      [apiKey]
    );
    
    if (result.rows.length === 0) {
      return { valid: false, error: 'Invalid or expired API key' };
    }
    
    const sub = result.rows[0];
    
    // Check request limit
    if (sub.requests_limit > 0 && sub.requests_used >= sub.requests_limit) {
      return { valid: false, error: 'Monthly request limit exceeded' };
    }
    
    return {
      valid: true,
      plan: sub.plan,
      rateLimit: sub.rate_limit,
      requestsRemaining: sub.requests_limit > 0 ? sub.requests_limit - sub.requests_used : -1
    };
  } catch (err) {
    console.error('DB error:', err);
    return { valid: false, error: 'Validation error' };
  }
}

function checkRateLimit(apiKey, limit) {
  if (limit < 0) return true; // Unlimited
  
  const now = Date.now();
  const key = apiKey;
  
  let bucket = rateLimitMap.get(key);
  if (!bucket || bucket.resetTime < now) {
    bucket = { count: 0, resetTime: now + 1000 };
    rateLimitMap.set(key, bucket);
  }
  
  if (bucket.count >= limit) {
    return false;
  }
  
  bucket.count++;
  return true;
}

async function logUsage(apiKey, method, responseTime, statusCode) {
  try {
    // Log to usage_logs
    await pool.query(
      `INSERT INTO usage_logs (api_key, endpoint, response_time, status_code)
       VALUES ($1, $2, $3, $4)`,
      [apiKey, method || 'unknown', responseTime, statusCode]
    );
    
    // Increment request count
    await pool.query(
      `UPDATE subscriptions SET requests_used = requests_used + 1 WHERE api_key = $1`,
      [apiKey]
    );
  } catch (err) {
    console.error('Log error:', err);
  }
}

function sendError(res, code, message) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, solana-client'
  });
  res.end(JSON.stringify({ error: message, code }));
}

// ============ HTTP PROXY ============

async function handleRequest(req, res) {
  const startTime = Date.now();
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, solana-client',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }
  
  let apiKey = null;
  let shouldLog = false;
  
  // 1. Check whitelist first
  if (isWhitelisted(req)) {
    // Whitelisted - forward directly
  } else {
    // 2. Extract and validate API key
    apiKey = extractApiKey(req);
    
    if (!apiKey) {
      return sendError(res, 401, 'API key required. Get one at api.whistle.ninja');
    }
    
    // 3. Check internal keys
    if (isInternalKey(apiKey)) {
      // Internal key - forward without limits
    } else {
      // 4. Validate against database
      const validation = await validateApiKey(apiKey);
      
      if (!validation.valid) {
        return sendError(res, 403, validation.error);
      }
      
      // 5. Check rate limit
      if (!checkRateLimit(apiKey, validation.rateLimit)) {
        return sendError(res, 429, 'Rate limit exceeded. Upgrade your plan for higher limits.');
      }
      
      shouldLog = true;
    }
  }
  
  // 6. Collect request body
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    // Parse RPC method for logging
    let rpcMethod = 'unknown';
    try {
      const parsed = JSON.parse(body);
      rpcMethod = parsed.method || 'unknown';
    } catch {}
    
    // Determine target based on path
    const isApiPath = req.url.startsWith('/v1/') || req.url.startsWith('/api/') || req.url.startsWith('/ws');
    const targetPort = isApiPath ? API_PORT : VALIDATOR_PORT;
    
    // 7. Forward to appropriate backend
    const proxyReq = http.request({
      hostname: VALIDATOR_HOST,
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Real-IP': req.headers['x-real-ip'] || req.socket.remoteAddress,
        'X-Forwarded-For': req.headers['x-forwarded-for'] || req.socket.remoteAddress
      }
    }, (proxyRes) => {
      const responseTime = Date.now() - startTime;
      
      // Copy headers
      const headers = {
        ...proxyRes.headers,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, solana-client'
      };
      
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
      
      // 8. Log usage (async)
      if (shouldLog && apiKey) {
        logUsage(apiKey, rpcMethod, responseTime, proxyRes.statusCode);
      }
    });
    
    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err);
      sendError(res, 502, 'RPC node unavailable');
    });
    
    proxyReq.write(body);
    proxyReq.end();
  });
}

// ============ WEBSOCKET PROXY ============

function setupWebSocketProxy(server) {
  const wss = new WebSocket.Server({ server });
  
  wss.on('connection', async (clientWs, req) => {
    let apiKey = null;
    let shouldLog = false;
    
    // Check whitelist
    if (!isWhitelisted(req)) {
      apiKey = extractApiKey(req);
      
      if (!apiKey) {
        clientWs.close(4001, 'API key required');
        return;
      }
      
      if (!isInternalKey(apiKey)) {
        const validation = await validateApiKey(apiKey);
        if (!validation.valid) {
          clientWs.close(4003, validation.error);
          return;
        }
        shouldLog = true;
      }
    }
    
    // Connect to validator WebSocket
    const validatorWs = new WebSocket(`ws://${VALIDATOR_HOST}:${VALIDATOR_PORT}`);
    
    validatorWs.on('open', () => {
      console.log('WebSocket connected to validator');
    });
    
    validatorWs.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data);
      }
    });
    
    validatorWs.on('close', () => {
      clientWs.close();
    });
    
    validatorWs.on('error', (err) => {
      console.error('Validator WS error:', err);
      clientWs.close(4002, 'RPC unavailable');
    });
    
    clientWs.on('message', (data) => {
      if (validatorWs.readyState === WebSocket.OPEN) {
        validatorWs.send(data);
        
        // Log WebSocket requests
        if (shouldLog && apiKey) {
          try {
            const parsed = JSON.parse(data);
            logUsage(apiKey, `ws:${parsed.method || 'unknown'}`, 0, 200);
          } catch {}
        }
      }
    });
    
    clientWs.on('close', () => {
      validatorWs.close();
    });
    
    clientWs.on('error', (err) => {
      console.error('Client WS error:', err);
      validatorWs.close();
    });
  });
  
  return wss;
}

// ============ START SERVER ============

const server = http.createServer(handleRequest);
setupWebSocketProxy(server);

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`🔒 RPC Proxy running on port ${PROXY_PORT}`);
  console.log(`📡 Forwarding to validator at ${VALIDATOR_HOST}:${VALIDATOR_PORT}`);
  console.log(`✅ Whitelisted domains: ${WHITELISTED_DOMAINS.join(', ')}`);
});

// Cleanup old rate limit entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitMap) {
    if (bucket.resetTime < now - 60000) {
      rateLimitMap.delete(key);
    }
  }
}, 60000);
