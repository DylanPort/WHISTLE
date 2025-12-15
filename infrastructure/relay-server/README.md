# Whistle Relay Server

The central relay server that routes RPC requests to cache nodes and manages the distributed network.

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                    Relay Server                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌─────────────┐    ┌─────────────┐    ┌───────────┐ │
│  │  WebSocket  │    │    HTTP     │    │  On-Chain │ │
│  │   Server    │    │    API      │    │   Sync    │ │
│  └──────┬──────┘    └──────┬──────┘    └─────┬─────┘ │
│         │                  │                 │        │
│         ▼                  ▼                 ▼        │
│  ┌──────────────────────────────────────────────────┐│
│  │              SQLite Database                     ││
│  │  • Node registry  • Stats  • Persistence        ││
│  └──────────────────────────────────────────────────┘│
│                                                        │
└────────────────────────────────────────────────────────┘
         │                  │
         ▼                  ▼
    ┌─────────┐        ┌─────────┐
    │ Cache   │        │ Cache   │
    │ Node 1  │   ...  │ Node N  │
    └─────────┘        └─────────┘
```

## Features

- **WebSocket Hub**: Manages connections to all cache nodes
- **Load Balancing**: Round-robin distribution of RPC requests
- **Health Monitoring**: Tracks node uptime and performance
- **On-Chain Sync**: Reads node data from Solana contract
- **Persistent Stats**: SQLite database for metrics
- **Multi-Region**: Deploy multiple relays globally

## Requirements

- Node.js 18+
- SQLite3
- Authority keypair (for reward distribution)
- Stable server with good bandwidth

## Installation

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Initialize database
npm run setup-db

# Start server
npm start
```

## Configuration

```env
# Server port
PORT=3480

# Solana RPC endpoint
RPC_URL=https://api.mainnet-beta.solana.com

# Authority keypair (for signing distributions)
AUTHORITY_KEYPAIR=/path/to/authority.json

# Database path
DATABASE_PATH=./data/relay.db

# Program ID
PROGRAM_ID=whttByewzTQzAz3VMxnyJHdKsd7AyNRdG2tDHXVTksr
```

## API Endpoints

### GET /nodes
List all connected cache nodes.

```json
{
  "nodes": [
    {
      "wallet": "ABC...",
      "endpoint": "https://node1.example.com",
      "location": "Germany",
      "requestsHandled": 12345,
      "avgLatency": 45,
      "bondAmount": 100000000,
      "totalEarned": 150000000,
      "uptime": 86400
    }
  ]
}
```

### GET /node/:wallet
Get specific node details (includes on-chain data).

### GET /stats
Global network statistics.

```json
{
  "totalDataServed": 1073741824,
  "totalRequests": 50000,
  "totalNodes": 15,
  "startedAt": 1734000000000
}
```

### GET /health
Health check endpoint.

## WebSocket Protocol

Cache nodes connect via WebSocket:

```javascript
// Node connects
ws.connect('wss://relay.example.com');

// Node sends registration
ws.send(JSON.stringify({
  type: 'register',
  wallet: 'ABC...',
  endpoint: 'https://mynode.com',
  location: 'USA'
}));

// Relay sends heartbeat request
// Node responds with heartbeat

// Relay routes RPC request to node
// Node processes and returns result
```

## Deployment

### Systemd Service

```ini
[Unit]
Description=Whistle Relay Server
After=network.target

[Service]
Type=simple
User=whistle
WorkingDirectory=/opt/whistle-relay
ExecStart=/usr/bin/node dist/relay-server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Nginx Reverse Proxy

```nginx
server {
    listen 443 ssl http2;
    server_name rpc.whistle.ninja;

    ssl_certificate /etc/letsencrypt/live/rpc.whistle.ninja/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rpc.whistle.ninja/privkey.pem;

    location / {
        proxy_pass http://localhost:3480;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Multi-Region Setup

For global coverage, deploy relays in multiple regions:

1. **Primary** (Germany): `rpc.whistle.ninja`
2. **US East**: `us.rpc.whistle.ninja`
3. **Asia**: `asia.rpc.whistle.ninja`

Each relay operates independently but shares the same on-chain state.

## Monitoring

Key metrics to monitor:

- Connected node count
- Requests per second
- Average latency
- Error rate
- Database size

## Security

- Run behind reverse proxy with SSL
- Use firewall to restrict direct access
- Rotate authority keys periodically
- Monitor for suspicious activity
- Keep dependencies updated

## Development

```bash
# Run in development mode
npm run dev

# Run tests
npm test

# Lint code
npm run lint
```

## Source Structure

```
src/
├── relay-server.ts    # Main server entry
├── database.ts        # SQLite operations
├── websocket.ts       # WS connection handling
├── rpc-router.ts      # Request routing logic
├── on-chain.ts        # Solana contract reads
└── types.ts           # TypeScript interfaces
```

