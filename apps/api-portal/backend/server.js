const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Pool } = require('pg');
const { Connection, PublicKey } = require('@solana/web3.js');

const app = express();
app.use(cors());
app.use(express.json());

// ============ CONFIGURATION ============
const RPC_URL = 'http://127.0.0.1:8899'; // Use local validator for verification
const WHTT_PROGRAM_ID = 'whttByewzTQzAz3VMxnyJHdKsd7AyNRdG2tDHXVTksr';
const FACILITATOR_WALLET = 'GwtbzDh6QHwVan4DVyUR11gzBVcBT92KjnaPdk43fMG5';
const X402_WALLET = 'BMiSBoT5aPCrFcxaTrHuzXMkfrtzCLMcDYqrPTVymNbU';

// Plan configurations
const PLANS = {
  basic: {
    name: 'Basic',
    monthly: { sol: 0.2, requests: 10000000, rateLimit: 10 },
    yearly: { sol: 2.0, requests: 10000000, rateLimit: 10 }
  },
  advanced: {
    name: 'Advanced',
    monthly: { sol: 1.0, requests: 30000000, rateLimit: 20 },
    yearly: { sol: 10.0, requests: 30000000, rateLimit: 20 }
  },
  premium: {
    name: 'Premium',
    monthly: { sol: 2.0, requests: -1, rateLimit: -1 }, // -1 = unlimited
    yearly: { sol: 20.0, requests: -1, rateLimit: -1 }
  }
};

// PostgreSQL connection
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'whistle_api',
  user: 'whistle',
  password: process.env.DB_PASSWORD || 'whistle_secure_2024'
});

// ============ DATABASE SETUP ============
async function initDB() {
  const client = await pool.connect();
  try {
    // Subscriptions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        api_key VARCHAR(64) UNIQUE NOT NULL,
        wallet_address VARCHAR(64) NOT NULL,
        plan VARCHAR(20) NOT NULL,
        billing VARCHAR(10) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        tx_signature VARCHAR(128),
        requests_limit BIGINT,
        rate_limit INT,
        requests_used BIGINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        cancelled_at TIMESTAMP
      )
    `);

    // Usage tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id SERIAL PRIMARY KEY,
        api_key VARCHAR(64) NOT NULL,
        endpoint VARCHAR(255),
        response_time INT,
        status_code INT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Quotes table for x402
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_quotes (
        id SERIAL PRIMARY KEY,
        nonce VARCHAR(64) UNIQUE NOT NULL,
        wallet_address VARCHAR(64) NOT NULL,
        plan VARCHAR(20) NOT NULL,
        billing VARCHAR(10) NOT NULL,
        amount DECIMAL(10,4) NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      )
    `);

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_api_key ON subscriptions(api_key)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_wallet ON subscriptions(wallet_address)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_usage_api_key ON usage_logs(api_key)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at)`);

    console.log('✅ Database initialized');
  } finally {
    client.release();
  }
}

// ============ HELPER FUNCTIONS ============
function generateApiKey() {
  return 'wsk_' + crypto.randomBytes(24).toString('hex');
}

function generateNonce() {
  return crypto.randomBytes(32).toString('hex');
}

// ============ X402 ENDPOINTS ============

// Generate quote for payment
app.post('/api/x402/quote', async (req, res) => {
  try {
    const { walletAddress, plan, billing } = req.body;
    
    if (!walletAddress || !plan || !billing) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const planConfig = PLANS[plan];
    if (!planConfig) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const billingConfig = planConfig[billing];
    if (!billingConfig) {
      return res.status(400).json({ error: 'Invalid billing period' });
    }

    const nonce = generateNonce();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await pool.query(
      `INSERT INTO payment_quotes (nonce, wallet_address, plan, billing, amount, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [nonce, walletAddress, plan, billing, billingConfig.sol, expiresAt]
    );

    res.json({
      success: true,
      quote: {
        amount: billingConfig.sol,
        recipient: X402_WALLET,
        facilitator: FACILITATOR_WALLET,
        facilitatorFee: 0.001,
        plan,
        billing,
        expiresAt: expiresAt.getTime()
      },
      nonce
    });
  } catch (err) {
    console.error('Quote error:', err);
    res.status(500).json({ error: 'Failed to generate quote' });
  }
});

// Verify payment and create subscription
app.post('/api/x402/verify', async (req, res) => {
  try {
    const { txSignature, nonce, walletAddress } = req.body;

    if (!txSignature || !nonce || !walletAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get quote from database
    const quoteResult = await pool.query(
      `SELECT * FROM payment_quotes WHERE nonce = $1 AND wallet_address = $2`,
      [nonce, walletAddress]
    );

    if (quoteResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired quote' });
    }

    const quote = quoteResult.rows[0];

    if (quote.used) {
      return res.status(400).json({ error: 'Quote already used' });
    }

    if (new Date() > new Date(quote.expires_at)) {
      return res.status(400).json({ error: 'Quote expired' });
    }

    // Verify transaction on-chain
    const connection = new Connection(RPC_URL, 'confirmed');
    
    let txDetails;
    let retries = 0;
    while (retries < 10) {
      try {
        txDetails = await connection.getParsedTransaction(txSignature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        });
        if (txDetails) break;
      } catch (e) {
        console.log('Waiting for tx confirmation...');
      }
      await new Promise(r => setTimeout(r, 2000));
      retries++;
    }

    if (!txDetails || txDetails.meta?.err) {
      return res.status(400).json({ error: 'Transaction not confirmed or failed' });
    }

    // Mark quote as used
    await pool.query(
      `UPDATE payment_quotes SET used = TRUE WHERE nonce = $1`,
      [nonce]
    );

    // Calculate expiration
    const plan = quote.plan;
    const billing = quote.billing;
    const planConfig = PLANS[plan][billing];
    
    const durationDays = billing === 'yearly' ? 365 : 30;
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    // Generate API key
    const apiKey = generateApiKey();

    // Create subscription
    await pool.query(
      `INSERT INTO subscriptions 
       (api_key, wallet_address, plan, billing, tx_signature, requests_limit, rate_limit, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [apiKey, walletAddress, plan, billing, txSignature, planConfig.requests, planConfig.rateLimit, expiresAt]
    );

    res.json({
      success: true,
      apiKey,
      plan,
      billing,
      expiresAt: expiresAt.getTime(),
      requestsLimit: planConfig.requests,
      rateLimit: planConfig.rateLimit
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// Unlock endpoint (alias for verify with retry logic)
app.post('/api/x402/unlock', async (req, res) => {
  try {
    const { txSignature, tx, nonce, walletAddress, plan, billing } = req.body;
    const actualTxSig = txSignature || tx; // Support both field names
    
    console.log('[UNLOCK] Request:', { txSignature: actualTxSig, nonce, walletAddress, plan, billing });

    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing required field: walletAddress' });
    }
    
    // If no txSignature, try to find recent subscription for this wallet
    if (!actualTxSig) {
      const existing = await pool.query(
        `SELECT api_key, plan, billing, expires_at FROM subscriptions 
         WHERE wallet_address = $1 AND status = 'active' AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [walletAddress]
      );
      if (existing.rows.length > 0) {
        console.log('[UNLOCK] Found existing subscription for wallet');
        return res.json({
          success: true,
          apiKey: existing.rows[0].api_key,
          plan: existing.rows[0].plan,
          billing: existing.rows[0].billing,
          expiresAt: new Date(existing.rows[0].expires_at).getTime()
        });
      }
      return res.status(400).json({ error: 'No transaction signature provided and no existing subscription found' });
    }

    // Check if subscription already exists for this tx
    const existingTx = await pool.query(
      `SELECT api_key, plan, billing, expires_at FROM subscriptions WHERE tx_signature = $1`,
      [actualTxSig]
    );
    
    if (existingTx.rows.length > 0) {
      console.log('[UNLOCK] Subscription already exists for this tx');
      return res.json({
        success: true,
        apiKey: existingTx.rows[0].api_key,
        plan: existingTx.rows[0].plan,
        billing: existingTx.rows[0].billing,
        expiresAt: new Date(existingTx.rows[0].expires_at).getTime()
      });
    }

    // Try to get quote from database if nonce provided
    let quotePlan = plan || 'basic';
    let quoteBilling = billing || 'monthly';
    
    if (nonce) {
      const quoteResult = await pool.query(
        `SELECT * FROM payment_quotes WHERE nonce = $1`,
        [nonce]
      );
      if (quoteResult.rows.length > 0) {
        quotePlan = quoteResult.rows[0].plan;
        quoteBilling = quoteResult.rows[0].billing;
        // Mark as used
        await pool.query(`UPDATE payment_quotes SET used = TRUE WHERE nonce = $1`, [nonce]);
      }
    }

    // Verify transaction on-chain
    const connection = new Connection(RPC_URL, 'confirmed');
    
    let txDetails;
    let retries = 0;
    while (retries < 15) {
      try {
        txDetails = await connection.getParsedTransaction(actualTxSig, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        });
        if (txDetails) break;
      } catch (e) {
        console.log('[UNLOCK] Waiting for tx confirmation... attempt', retries + 1);
      }
      await new Promise(r => setTimeout(r, 2000));
      retries++;
    }

    if (!txDetails) {
      return res.status(400).json({ error: 'Transaction not found after 30 seconds' });
    }
    
    if (txDetails.meta?.err) {
      return res.status(400).json({ error: 'Transaction failed on-chain' });
    }

    // Calculate expiration
    const planConfig = PLANS[quotePlan]?.[quoteBilling];
    if (!planConfig) {
      return res.status(400).json({ error: 'Invalid plan configuration' });
    }
    
    const durationDays = quoteBilling === 'yearly' ? 365 : 30;
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    // Generate API key
    const apiKey = generateApiKey();

    // Create subscription
    await pool.query(
      `INSERT INTO subscriptions 
       (api_key, wallet_address, plan, billing, tx_signature, requests_limit, rate_limit, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [apiKey, walletAddress, quotePlan, quoteBilling, actualTxSig, planConfig.requests, planConfig.rateLimit, expiresAt]
    );

    console.log('[UNLOCK] Subscription created:', { apiKey, plan: quotePlan, billing: quoteBilling });

    res.json({
      success: true,
      apiKey,
      plan: quotePlan,
      billing: quoteBilling,
      expiresAt: expiresAt.getTime(),
      requestsLimit: planConfig.requests,
      rateLimit: planConfig.rateLimit
    });
  } catch (err) {
    console.error('[UNLOCK] Error:', err);
    res.status(500).json({ error: 'Failed to unlock subscription: ' + err.message });
  }
});

// ============ DASHBOARD ENDPOINTS ============

// Get subscription by API key
app.get('/api/subscription/:apiKey', async (req, res) => {
  try {
    const { apiKey } = req.params;
    
    const result = await pool.query(
      `SELECT * FROM subscriptions WHERE api_key = $1`,
      [apiKey]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const sub = result.rows[0];
    res.json({
      success: true,
      subscription: {
        apiKey: sub.api_key,
        plan: sub.plan,
        billing: sub.billing,
        status: sub.status,
        requestsLimit: parseInt(sub.requests_limit),
        requestsUsed: parseInt(sub.requests_used),
        rateLimit: sub.rate_limit,
        createdAt: sub.created_at,
        expiresAt: sub.expires_at,
        cancelledAt: sub.cancelled_at
      }
    });
  } catch (err) {
    console.error('Get subscription error:', err);
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

// Get subscription by wallet
app.get('/api/subscription/wallet/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    
    const result = await pool.query(
      `SELECT * FROM subscriptions 
       WHERE wallet_address = $1 AND status = 'active' AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [wallet]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const sub = result.rows[0];
    res.json({
      success: true,
      subscription: {
        apiKey: sub.api_key,
        plan: sub.plan,
        billing: sub.billing,
        status: sub.status,
        requestsLimit: parseInt(sub.requests_limit),
        requestsUsed: parseInt(sub.requests_used),
        rateLimit: sub.rate_limit,
        createdAt: sub.created_at,
        expiresAt: sub.expires_at
      }
    });
  } catch (err) {
    console.error('Get wallet subscription error:', err);
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

// Get usage stats
app.get('/api/usage/:apiKey', async (req, res) => {
  try {
    const { apiKey } = req.params;
    const { days = 30 } = req.query;

    // Daily usage for chart
    const dailyResult = await pool.query(
      `SELECT 
         DATE(created_at) as date,
         COUNT(*) as requests,
         AVG(response_time) as avg_response_time,
         COUNT(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 END) as success,
         COUNT(CASE WHEN status_code >= 400 THEN 1 END) as errors
       FROM usage_logs
       WHERE api_key = $1 AND created_at > NOW() - INTERVAL '${parseInt(days)} days'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [apiKey]
    );

    // Endpoint breakdown
    const endpointResult = await pool.query(
      `SELECT 
         endpoint,
         COUNT(*) as count,
         AVG(response_time) as avg_time
       FROM usage_logs
       WHERE api_key = $1 AND created_at > NOW() - INTERVAL '7 days'
       GROUP BY endpoint
       ORDER BY count DESC
       LIMIT 10`,
      [apiKey]
    );

    // Today's stats
    const todayResult = await pool.query(
      `SELECT 
         COUNT(*) as requests,
         AVG(response_time) as avg_time,
         COUNT(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 END)::float / 
         NULLIF(COUNT(*), 0) * 100 as success_rate
       FROM usage_logs
       WHERE api_key = $1 AND created_at > DATE_TRUNC('day', NOW())`,
      [apiKey]
    );

    res.json({
      success: true,
      usage: {
        daily: dailyResult.rows,
        endpoints: endpointResult.rows,
        today: todayResult.rows[0] || { requests: 0, avg_time: 0, success_rate: 100 }
      }
    });
  } catch (err) {
    console.error('Get usage error:', err);
    res.status(500).json({ error: 'Failed to get usage stats' });
  }
});

// Log API usage (called by RPC proxy)
app.post('/api/usage/log', async (req, res) => {
  try {
    const { apiKey, endpoint, responseTime, statusCode } = req.body;

    await pool.query(
      `INSERT INTO usage_logs (api_key, endpoint, response_time, status_code)
       VALUES ($1, $2, $3, $4)`,
      [apiKey, endpoint, responseTime, statusCode]
    );

    // Update subscription usage count
    await pool.query(
      `UPDATE subscriptions SET requests_used = requests_used + 1 WHERE api_key = $1`,
      [apiKey]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Log usage error:', err);
    res.status(500).json({ error: 'Failed to log usage' });
  }
});

// Cancel subscription
app.post('/api/subscription/:apiKey/cancel', async (req, res) => {
  try {
    const { apiKey } = req.params;

    const result = await pool.query(
      `UPDATE subscriptions 
       SET status = 'cancelled', cancelled_at = NOW()
       WHERE api_key = $1 AND status = 'active'
       RETURNING *`,
      [apiKey]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription not found or already cancelled' });
    }

    res.json({
      success: true,
      message: 'Subscription cancelled. Access continues until expiration.',
      expiresAt: result.rows[0].expires_at
    });
  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Get subscription statistics (public)
app.get('/api/stats', async (req, res) => {
  try {
    // Total active subscriptions
    const activeSubs = await pool.query(
      `SELECT COUNT(*) as count FROM subscriptions 
       WHERE status = 'active' AND expires_at > NOW()`
    );
    
    // Total subscriptions (all time)
    const totalSubs = await pool.query(
      `SELECT COUNT(*) as count FROM subscriptions`
    );
    
    // Subscriptions by plan
    const byPlan = await pool.query(
      `SELECT plan, COUNT(*) as count 
       FROM subscriptions 
       WHERE status = 'active' AND expires_at > NOW()
       GROUP BY plan`
    );
    
    // Recent subscriptions (last 24h)
    const recent24h = await pool.query(
      `SELECT COUNT(*) as count FROM subscriptions 
       WHERE created_at > NOW() - INTERVAL '24 hours'`
    );
    
    // Calculate total revenue (estimate from plan prices)
    const planPrices = {
      'basic': { monthly: 0.2, yearly: 2.0 },
      'advanced': { monthly: 1.0, yearly: 10.0 },
      'premium': { monthly: 2.0, yearly: 20.0 }
    };
    
    const revenueResult = await pool.query(
      `SELECT plan, billing, COUNT(*) as count
       FROM subscriptions
       WHERE status = 'active' AND expires_at > NOW()
       GROUP BY plan, billing`
    );
    
    let totalRevenueSOL = 0;
    revenueResult.rows.forEach(row => {
      const price = planPrices[row.plan]?.[row.billing] || 0;
      totalRevenueSOL += price * parseInt(row.count);
    });
    
    res.json({
      success: true,
      stats: {
        activeSubscriptions: parseInt(activeSubs.rows[0].count),
        totalSubscriptions: parseInt(totalSubs.rows[0].count),
        recent24h: parseInt(recent24h.rows[0].count),
        byPlan: byPlan.rows.reduce((acc, row) => {
          acc[row.plan] = parseInt(row.count);
          return acc;
        }, {}),
        totalRevenueSOL: totalRevenueSOL.toFixed(2),
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Validate API key (for RPC proxy)
app.get('/api/validate/:apiKey', async (req, res) => {
  try {
    const { apiKey } = req.params;

    const result = await pool.query(
      `SELECT * FROM subscriptions 
       WHERE api_key = $1 AND expires_at > NOW()`,
      [apiKey]
    );

    if (result.rows.length === 0) {
      return res.json({ valid: false, error: 'Invalid or expired API key' });
    }

    const sub = result.rows[0];
    
    // Check if within limits
    if (sub.requests_limit > 0 && sub.requests_used >= sub.requests_limit) {
      return res.json({ valid: false, error: 'Request limit exceeded' });
    }

    res.json({
      valid: true,
      plan: sub.plan,
      rateLimit: sub.rate_limit,
      requestsRemaining: sub.requests_limit > 0 ? sub.requests_limit - sub.requests_used : -1
    });
  } catch (err) {
    console.error('Validate error:', err);
    res.status(500).json({ valid: false, error: 'Validation failed' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    service: 'Whistle API Backend'
  });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3501;

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Whistle API Backend running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
