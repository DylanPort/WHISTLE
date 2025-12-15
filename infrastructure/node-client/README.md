# Whistle Cache Node Client

Run a cache node to earn rewards by serving RPC requests to the Whistle Network.

## Requirements

- Node.js 18+
- Solana wallet with WHISTLE tokens
- Stable internet connection
- Minimum 100 WHISTLE for bond

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template
cp ../../env.example .env
# Edit .env with your configuration

# Start the node
npm start
```

## Configuration

Edit `.env` file:

```env
# Your operator wallet keypair path
OPERATOR_KEYPAIR=/path/to/your/keypair.json

# Primary relay URL
RELAY_URL=wss://rpc.whistle.ninja

# Backup relays (automatic failover)
BACKUP_RELAYS=wss://us.rpc.whistle.ninja,wss://pl.rpc.whistle.ninja

# Your public endpoint (if you're running your own RPC)
NODE_ENDPOINT=https://your-rpc.example.com

# Bond amount (100 WHISTLE = 100000000 with 6 decimals)
BOND_AMOUNT=100000000
```

## Features

### Multi-Relay Failover
The node client automatically connects to the nearest relay and fails over to backups if disconnected:

1. **Germany** (Primary): `rpc.whistle.ninja`
2. **USA**: `us.rpc.whistle.ninja`
3. **Poland**: `pl.rpc.whistle.ninja`

### Never-Crash Mode
Built-in exception handlers ensure the node keeps running:
- Automatic reconnection on disconnect
- Graceful error handling
- Persistent uptime tracking

### Geo-Detection
On startup, the client detects your location and connects to the nearest relay for optimal latency.

## Commands

```bash
# Start node
npm start

# Start with debug logging
DEBUG=true npm start

# Check registration status
npm run status

# Claim earnings
npm run claim
```

## Terminal UI

The node displays real-time statistics:

```
╔═══════════════════════════════════════════════════════╗
║           WHISTLE CACHE NODE v2.4.0                  ║
╠═══════════════════════════════════════════════════════╣
║  Status: 🟢 CONNECTED                                ║
║  Relay:  rpc.whistle.ninja (Germany)                 ║
║  Uptime: 4h 23m 15s                                  ║
╠═══════════════════════════════════════════════════════╣
║  Requests:     1,234                                 ║
║  Pending:      0.0234 SOL                            ║
║  Total Earned: 0.1523 SOL                            ║
╚═══════════════════════════════════════════════════════╝
```

## Earning Rewards

1. **Register**: Bond WHISTLE tokens to register on-chain
2. **Connect**: Connect to relay and receive RPC traffic
3. **Serve**: Handle requests and maintain uptime
4. **Earn**: Receive 25% of X402 payments proportionally
5. **Claim**: Claim accumulated earnings to your wallet

## Troubleshooting

### "Insufficient bond"
Ensure your wallet has at least 100 WHISTLE tokens.

### "Connection refused"
Check firewall settings and relay URL.

### "Heartbeat timeout"
Network instability - the client will auto-reconnect.

### "Already registered"
Your wallet is already registered as a cache node.

## Deregistering

To deregister and recover your bond:

1. Claim any pending earnings first
2. Run the deregister script or use the earn.whistle.ninja UI
3. Bond (minus any slashing) will be returned

## Security

- Never share your keypair file
- Use a dedicated wallet for node operation
- Keep your system and Node.js updated
- Monitor logs for suspicious activity

## Support

- Discord: [Join our server](https://discord.gg/whistle)
- Twitter: [@WhistleNetwork](https://twitter.com/WhistleNetwork)
- Docs: [docs.whistle.ninja](https://docs.whistle.ninja)

