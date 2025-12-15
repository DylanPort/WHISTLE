const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = 3500;

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// CORS for API endpoints
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-API-Key');
  next();
});

// API Keys storage (in production, use database)
const API_KEYS_FILE = path.join(__dirname, 'data', 'api_keys.json');

function loadApiKeys() {
  if (!fs.existsSync(path.dirname(API_KEYS_FILE))) {
    fs.mkdirSync(path.dirname(API_KEYS_FILE), { recursive: true });
  }
  if (fs.existsSync(API_KEYS_FILE)) {
    return JSON.parse(fs.readFileSync(API_KEYS_FILE, 'utf8'));
  }
  return {};
}

function saveApiKeys(keys) {
  fs.writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2));
}

let apiKeys = loadApiKeys();

// Generate API key
function generateApiKey() {
  return 'wsk_' + crypto.randomBytes(24).toString('hex');
}

// Plans
const PLANS = {
  basic: {
    name: 'Basic',
    price_monthly: 40,
    price_yearly: 400,
    rate_limit: 10, // req/sec
    monthly_requests: 10000000,
    widgets: false,
    geyser: false
  },
  advanced: {
    name: 'Advanced',
    price_monthly: 200,
    price_yearly: 2000,
    rate_limit: 20,
    monthly_requests: 30000000,
    widgets: true,
    geyser: false
  },
  premium: {
    name: 'Premium',
    price_monthly: 400,
    price_yearly: 4000,
    rate_limit: -1, // unlimited
    monthly_requests: -1, // unlimited
    widgets: true,
    geyser: true
  }
};

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// API: Get plans
app.get('/api/plans', (req, res) => {
  res.json(PLANS);
});

// API: Create API key (after payment)
app.post('/api/keys/create', (req, res) => {
  const { plan, email, payment_id } = req.body;
  
  if (!plan || !PLANS[plan]) {
    return res.status(400).json({ error: 'Invalid plan' });
  }
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }
  
  const apiKey = generateApiKey();
  const now = new Date();
  
  apiKeys[apiKey] = {
    email,
    plan,
    created: now.toISOString(),
    expires: new Date(now.setMonth(now.getMonth() + 1)).toISOString(),
    requests_used: 0,
    payment_id: payment_id || null,
    active: true
  };
  
  saveApiKeys(apiKeys);
  
  res.json({
    success: true,
    api_key: apiKey,
    plan: PLANS[plan],
    expires: apiKeys[apiKey].expires
  });
});

// API: Validate API key
app.get('/api/keys/validate', (req, res) => {
  const apiKey = req.query.key || req.headers['x-api-key'];
  
  if (!apiKey || !apiKeys[apiKey]) {
    return res.status(401).json({ valid: false, error: 'Invalid API key' });
  }
  
  const keyData = apiKeys[apiKey];
  
  if (!keyData.active) {
    return res.status(401).json({ valid: false, error: 'API key deactivated' });
  }
  
  if (new Date(keyData.expires) < new Date()) {
    return res.status(401).json({ valid: false, error: 'API key expired' });
  }
  
  const plan = PLANS[keyData.plan];
  
  res.json({
    valid: true,
    plan: keyData.plan,
    rate_limit: plan.rate_limit,
    requests_remaining: plan.monthly_requests === -1 ? 'unlimited' : plan.monthly_requests - keyData.requests_used,
    expires: keyData.expires
  });
});

// API: Get usage stats
app.get('/api/keys/usage', (req, res) => {
  const apiKey = req.query.key || req.headers['x-api-key'];
  
  if (!apiKey || !apiKeys[apiKey]) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  const keyData = apiKeys[apiKey];
  const plan = PLANS[keyData.plan];
  
  res.json({
    plan: keyData.plan,
    requests_used: keyData.requests_used,
    requests_limit: plan.monthly_requests,
    percentage: plan.monthly_requests === -1 ? 0 : Math.round((keyData.requests_used / plan.monthly_requests) * 100),
    resets: keyData.expires
  });
});

// Webhook for Stripe payments (placeholder)
app.post('/webhook/stripe', (req, res) => {
  // TODO: Implement Stripe webhook handling
  console.log('[STRIPE WEBHOOK]', req.body);
  res.json({ received: true });
});

// Webhook for crypto payments (placeholder)
app.post('/webhook/crypto', (req, res) => {
  // TODO: Implement crypto payment verification
  console.log('[CRYPTO WEBHOOK]', req.body);
  res.json({ received: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║   WHISTLE RPC API - Landing Page Server                     ║
║   Running on port ${PORT}                                        ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

