# Whistle Network

**Decentralized RPC Infrastructure with Token-Based Economics**

Whistle Network is a decentralized RPC caching and distribution system built on Solana. It enables developers to access fast, reliable RPC endpoints while rewarding node operators and stakers who contribute to the network.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Whistle Network                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│  │   Stakers   │    │ Cache Nodes │    │ Developers  │          │
│  │ (WHISTLE)   │    │  (Relays)   │    │  (API Keys) │          │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘          │
│         │                  │                  │                 │
│         ▼                  ▼                  ▼                 │
│  ┌──────────────────────────────────────────────────────┐       │
│  │              Smart Contract (Solana)                 │       │
│  │  • Staking Pool    • Cache Node Registry             │       │
│  │  • Payment Vault   • Developer Accounts              │       │
│  │  • X402 Payments   • Rewards Distribution            │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 📦 Repository Structure

```
whistle-network/
├── contracts/                    # Smart contract IDL & documentation
│   ├── whistle_staking.json     # Complete IDL (41 instructions)
│   └── README.md                # Contract docs + code examples
│
├── apps/
│   ├── api-portal/              # api.whistle.ninja - RPC subscriptions
│   │   ├── backend/             # Subscription management API
│   │   └── rpc-proxy/           # RPC request routing
│   ├── showcase/                # devs.whistle.ninja - Developer showcase
│   ├── earn/                    # earn.whistle.ninja - Node operator dashboard
│   └── txrace/                  # fun.whistle.ninja - TX Race game
│
├── infrastructure/
│   ├── relay-server/            # Main relay server (routes to cache nodes)
│   ├── node-client/             # Cache node software for operators
│   └── nginx/                   # Example Nginx configurations
│
├── scripts/                     # Utility scripts (rewards distribution)
│
├── env.example                  # Environment variables template
├── .gitignore                   # Git ignore rules
└── README.md                    # This file
```

## 🔗 Live Deployments

| Service | URL | Description |
|---------|-----|-------------|
| Main Site | [whistle.ninja](https://whistle.ninja) | Staking interface |
| API Portal | [api.whistle.ninja](https://api.whistle.ninja) | RPC subscriptions |
| Earn | [earn.whistle.ninja](https://earn.whistle.ninja) | Node operator dashboard |
| Developer Showcase | [devs.whistle.ninja](https://devs.whistle.ninja) | Developer challenge |
| TX Race | [fun.whistle.ninja](https://fun.whistle.ninja) | RPC speed game |

## 🪙 Token Economics

**WHISTLE Token**: `6Hb2xgEhyN9iVVH3cgSxYjfN774ExzgiCftwiWdjpump`

### Revenue Distribution (X402 Payments)
- **60%** → Stakers (proportional to stake)
- **25%** → Cache Node Operators
- **10%** → Treasury (development fund)
- **5%** → Bonus Pool (top performers)

### Staking Tiers
| Tier | WHISTLE Required | Benefits |
|------|-----------------|----------|
| Hobbyist | 10,000 | 10% rebate |
| Builder | 100,000 | 25% rebate |
| Pro | 500,000 | 50% rebate |
| Enterprise | 2,500,000 | 75% rebate |
| Whale | 10,000,000 | 100% rebate |

## 🖥️ Running a Cache Node

### Requirements
- Node.js 18+
- Solana wallet with WHISTLE tokens (minimum 100 WHISTLE bond)

### Quick Start
```bash
cd infrastructure/node-client
npm install
cp .env.example .env
# Edit .env with your wallet and configuration
npm start
```

See [Node Client README](./infrastructure/node-client/README.md) for detailed setup.

## 🔐 Smart Contract

**Program ID**: `whttByewzTQzAz3VMxnyJHdKsd7AyNRdG2tDHXVTksr`

### Key PDAs
| Account | Seeds | Description |
|---------|-------|-------------|
| Staking Pool | `["staking_pool", authority]` | Main staking pool |
| Token Vault | `["token_vault", authority]` | WHISTLE token vault |
| Staker | `["staker", wallet]` | Individual staker account |
| Provider | `["provider", wallet]` | RPC provider account |
| Developer | `["developer", wallet]` | Developer account |
| Cache Node | `["cache_node_account", operator]` | Cache node operator |
| Cache Pool | `["cache_rewards_pool"]` | Cache node rewards |
| X402 Wallet | `["x402_payment_wallet"]` | Payment collection |
| Rewards Accumulator | `["rewards_accumulator"]` | Fair distribution |

See [Contract README](./contracts/README.md) for full IDL documentation.

## 🛠️ Development

### Prerequisites
- Node.js 18+
- npm or yarn
- Solana CLI (for contract interaction)

### Local Setup
```bash
# Clone the repository
git clone https://github.com/whistle-network/whistle-network.git
cd whistle-network

# Install dependencies for all apps
cd apps/showcase && npm install
cd ../earn && npm install
cd ../txrace && npm install

# Install relay server dependencies
cd ../../infrastructure/relay-server && npm install
```

### Environment Variables
Copy `.env.example` to `.env` in each service directory and configure:

```env
# Common
RPC_URL=https://api.mainnet-beta.solana.com
PROGRAM_ID=whttByewzTQzAz3VMxnyJHdKsd7AyNRdG2tDHXVTksr

# Relay Server
PORT=3480
AUTHORITY_KEYPAIR=/path/to/authority.json

# Node Client
OPERATOR_KEYPAIR=/path/to/operator.json
RELAY_URL=wss://rpc.whistle.ninja
```

## 📚 Documentation

- [Contract IDL](./contracts/whistle_staking.json) - Full instruction set (41 instructions)
- [API Portal](./apps/api-portal/README.md) - RPC subscriptions & proxy
- [Relay Server](./infrastructure/relay-server/README.md) - Running a relay
- [Node Client](./infrastructure/node-client/README.md) - Running a cache node
- [Developer Showcase](./apps/showcase/README.md) - Developer challenge portal
- [TX Race](./apps/txrace/README.md) - RPC speed game

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request


## 🔗 Links

- **Website**: [whistle.ninja](https://links.whistle.ninja)
- **Twitter**: [@WhistleNetwork](https://twitter.com/whistleninja)
- **$WHISTLE**: [View on Solscan](https://solscan.io/token/6Hb2xgEhyN9iVVH3cgSxYjfN774ExzgiCftwiWdjpump)



