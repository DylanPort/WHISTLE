# Whistle RPC API Portal (api.whistle.ninja)

The main API portal where developers subscribe to Whistle RPC and manage their API keys.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    API Portal                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │   Frontend  │    │   Backend   │    │  RPC Proxy  │    │
│  │ index.html  │    │  server.js  │    │  proxy.js   │    │
│  │ dashboard   │    │ (subs/keys) │    │ (routing)   │    │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    │
│         │                  │                  │            │
│         ▼                  ▼                  ▼            │
│  ┌──────────────────────────────────────────────────┐     │
│  │                   SQLite Database                │     │
│  │  • Subscriptions  • API Keys  • Usage Stats     │     │
│  └──────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ Cache Nodes │
                    │  (Relays)   │
                    └─────────────┘
```

## Components

### Frontend (`index.html`, `dashboard.html`)
- Landing page with pricing tiers
- Interactive API playground
- User dashboard for key management
- Usage analytics display

### Backend (`backend/server.js`)
Main API server handling:
- Subscription creation
- API key generation
- Usage tracking
- Webhook management

### RPC Proxy (`rpc-proxy/proxy.js`)
Routes RPC requests:
- Validates API keys
- Rate limiting
- Routes to cache nodes or upstream RPC
- X402 payment integration

## Features

### Subscription Tiers

| Tier | Requests/Month | Price | Features |
|------|---------------|-------|----------|
| Free | 10,000 | $0 | Basic RPC |
| Pro | 1,000,000 | Pay-per-use | Priority routing |
| Enterprise | Unlimited | Custom | Dedicated nodes |

### X402 Protocol Integration
Pay-per-request using the x402 payment protocol:
- Micropayments per RPC call
- Automatic billing
- No upfront commitment

### API Playground
Interactive testing interface:
- Test all RPC methods
- View responses
- Copy code snippets

## Local Development

```bash
# Install dependencies
npm install

# Start all services
npm start              # Frontend server
npm run start:backend  # Backend API
npm run start:proxy    # RPC proxy
```

## API Endpoints

### Subscriptions

```
POST   /api/subscribe          - Create subscription
GET    /api/subscription/:key  - Get subscription details
DELETE /api/subscription/:key  - Cancel subscription
```

### API Keys

```
POST   /api/keys              - Generate new API key
GET    /api/keys/:id          - Get key details
DELETE /api/keys/:id          - Revoke key
```

### Usage

```
GET    /api/usage/:key        - Get usage stats
GET    /api/usage/:key/daily  - Daily breakdown
```

### RPC Proxy

```
POST   /rpc                   - RPC endpoint (requires API key)
WS     /ws                    - WebSocket endpoint
```

## Configuration

```env
# Backend
PORT=3000
DATABASE_PATH=./data/subscriptions.db
RPC_UPSTREAM=https://api.mainnet-beta.solana.com

# Proxy
PROXY_PORT=3001
RELAY_URL=wss://rpc.whistle.ninja
RATE_LIMIT_PER_MINUTE=100

# X402
X402_WALLET=<X402_PAYMENT_WALLET_PDA>
X402_PRICE_PER_REQUEST=0.00001
```

## Database Schema

```sql
-- Subscriptions
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  tier TEXT DEFAULT 'free',
  api_key TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  status TEXT DEFAULT 'active'
);

-- Usage tracking
CREATE TABLE usage (
  id INTEGER PRIMARY KEY,
  api_key TEXT NOT NULL,
  method TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  latency_ms INTEGER,
  success INTEGER DEFAULT 1
);

-- Webhooks
CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  subscription_id TEXT,
  url TEXT NOT NULL,
  events TEXT,
  active INTEGER DEFAULT 1
);
```

## Deployment

### Nginx Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name api.whistle.ninja;

    # Frontend
    location / {
        root /var/www/api.whistle.ninja;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3000/api/;
    }

    # RPC Proxy
    location /rpc {
        proxy_pass http://localhost:3001/rpc;
        proxy_http_version 1.1;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:3001/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Security

- API keys are hashed before storage
- Rate limiting per key
- Request validation
- CORS configuration
- SQL injection protection

## X402 Client

The `x402-client.js` handles payment processing:

```javascript
import { X402Client } from './x402-client.js';

const client = new X402Client({
  rpcUrl: 'https://api.whistle.ninja/rpc',
  paymentWallet: '<YOUR_WALLET>'
});

// Automatic micropayments per request
const response = await client.call('getBalance', [address]);
```

