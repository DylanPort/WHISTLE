# Node Operator Dashboard (earn.whistle.ninja)

Dashboard for cache node operators to monitor their nodes, view earnings, and manage their bond.

## Features

- **Multi-Region Status**: View all relay servers globally
- **Node Statistics**: Real-time request counts and earnings
- **On-Chain Transparency**: Direct blockchain data display
- **Earnings Management**: Claim rewards, deregister nodes
- **Leaderboard**: See top performing operators

## Tech Stack

- **Frontend**: Single HTML file with vanilla JS
- **Styling**: Custom CSS with glassmorphism effects
- **Data Sources**: 
  - Relay API (`/nodes`, `/node/:wallet`)
  - On-chain data (Solana RPC)

## Running Locally

Simply open `index.html` in a browser or serve with any static server:

```bash
npx serve .
# or
python -m http.server 8080
```

## Data Flow

```
┌──────────────────────────────────────────────────────┐
│                  earn.whistle.ninja                  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────┐    ┌────────────┐    ┌───────────┐ │
│  │ Relay APIs │    │  Solana    │    │  Wallet   │ │
│  │  /nodes    │    │   RPC      │    │  Adapter  │ │
│  └─────┬──────┘    └─────┬──────┘    └─────┬─────┘ │
│        │                 │                 │        │
│        ▼                 ▼                 ▼        │
│  ┌──────────────────────────────────────────────┐  │
│  │              Frontend Display                │  │
│  │  • Network Overview    • Node Operators     │  │
│  │  • Earnings Stats      • Claim/Deregister   │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## Sections

### Network Overview
- Total data served across all nodes
- Total requests handled
- Active node count per region
- Network uptime

### Global Relay Network
- Germany (Primary)
- USA (East)
- Poland (EU)

Each relay shows:
- Connection status
- Connected nodes
- Traffic statistics

### On-Chain Transparency
Direct from Solana blockchain:
- Total claimed rewards
- Total pending rewards
- Pool balance
- Individual node data

### Node Operators Table
| Column | Description |
|--------|-------------|
| Operator | Wallet address (shortened) |
| Requests | Total RPC requests handled |
| Latency | Average response time |
| Bond | WHISTLE tokens bonded |
| Earned | Total SOL earned |
| Uptime | Time online |

## Wallet Integration

Connect wallet to:
- View your node's detailed stats
- Claim pending earnings
- Deregister and recover bond

### Claim Earnings
```javascript
// Instruction discriminator: 35
const instruction = new TransactionInstruction({
  keys: [
    { pubkey: operator, isSigner: true, isWritable: true },
    { pubkey: cacheNodeAccount, isWritable: true },
    { pubkey: cacheRewardsPool, isWritable: true },
    { pubkey: SystemProgram.programId },
  ],
  programId: PROGRAM_ID,
  data: Buffer.from([35]),
});
```

### Deregister Node
```javascript
// Instruction discriminator: 38
const instruction = new TransactionInstruction({
  keys: [
    { pubkey: operator, isSigner: true, isWritable: true },
    { pubkey: cacheNodeAccount, isWritable: true },
    { pubkey: tokenVault, isWritable: true },
    { pubkey: operatorTokenAccount, isWritable: true },
    { pubkey: cacheRewardsPool, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID },
    { pubkey: stakingPool },
  ],
  programId: PROGRAM_ID,
  data: Buffer.from([38]),
});
```

## Styling

Modern dark theme with:
- Glassmorphism cards
- Gradient accents
- Responsive design
- Smooth animations

## Deployment

Static files served via Nginx:

```nginx
server {
    listen 443 ssl;
    server_name earn.whistle.ninja;
    
    root /var/www/earn.whistle.ninja;
    index index.html;
    
    location / {
        try_files $uri $uri/ =404;
    }
}
```

