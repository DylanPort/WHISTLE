# Whistle Network Scripts

Utility scripts for managing the Whistle Network.

## distribute-rewards.js

Distributes rewards from the X402 payment wallet to stakers and cache nodes.

### Usage

```bash
# Set environment variables
export RPC_URL=https://api.mainnet-beta.solana.com
export AUTHORITY_KEYPAIR=/path/to/authority.json

# Run distribution
node distribute-rewards.js
```

### What it does

1. Reads balance from X402 payment wallet PDA
2. Calls `processX402Payment` instruction
3. Distributes: 60% stakers, 25% cache nodes, 10% treasury, 5% bonus

### Requirements

- Authority keypair (multi-sig recommended)
- Sufficient SOL for transaction fees
- X402 wallet must have balance to distribute

## setup-db.js

Initializes the SQLite database for the relay server.

### Usage

```bash
cd infrastructure/relay-server
node ../scripts/setup-db.js
```

### Tables Created

- `wallet_stats` - Per-wallet statistics
- `global_stats` - Network-wide metrics
- `nodes` - Cache node registry

## Cron Jobs

For automated reward distribution, set up a cron job:

```bash
# Every hour
0 * * * * cd /opt/whistle && node scripts/distribute-rewards.js >> /var/log/whistle-distribute.log 2>&1
```

## Security Notes

- Never commit keypair files
- Use environment variables for sensitive data
- Run scripts with minimal privileges
- Monitor logs for errors

