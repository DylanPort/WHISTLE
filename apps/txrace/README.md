# TX Race (fun.whistle.ninja)

A provably fair racing game where your RPC speed determines the winner. The fastest transaction wins!

## Concept

TX Race is a unique game that showcases RPC performance:

1. **Create or Join**: Players create races with entry fees or join existing ones
2. **Countdown**: When full, race enters countdown
3. **GO!**: At target slot, all players submit transactions
4. **Winner**: First transaction to land wins 95% of the pot
5. **Creator Fee**: Race creator gets 5%

## Why TX Race?

- **Showcase RPC Speed**: Compare different RPC providers
- **Provably Fair**: All results verifiable on-chain
- **No House Edge**: 100% of pot goes to players/creators
- **Fun Utility**: Real use case for fast RPC

## Tech Stack

- **Frontend**: HTML/CSS/JavaScript
- **Smart Contract**: Native Solana program
- **Wallet**: Burner wallet system (no popups during race)
- **Profiles API**: Node.js + Express for avatars/names

## Smart Contract

**Program ID**: `H5XrfmdaXNuzd74SBDA6nhVVFSMEDVPQVtpoBHR378jv`

### Race Flow

```
createRace() → Open
     ↓
joinRace() × maxPlayers → Countdown (auto-start)
     ↓
Target slot reached → Live
     ↓
raceEntry() → First TX wins!
     ↓
Auto-settle → 95% to winner, 5% to creator
```

### Account Structure

```typescript
interface Race {
  id: u64;
  entryFee: u64;
  maxPlayers: u8;
  playerCount: u8;
  players: PublicKey[20];
  status: RaceStatus;
  targetSlot: u64;
  prizePool: u64;
  winner: PublicKey;
  winnerSlot: u64;
  winnerTxIndex: u32;
  createdAt: i64;
  startedAt: i64;
  finishedAt: i64;
}

enum RaceStatus {
  Open,
  Countdown,
  Live,
  Finished,
  Settled,
  Cancelled
}
```

## Features

### Burner Wallet System
- No Phantom popups during gameplay
- Auto-generated on first visit
- Fund from main wallet
- Withdraw anytime

### Player Profiles
- Custom avatars (40 options)
- Display names
- Persistent across sessions
- Server-side storage

### Race Creation
- Set entry fee (0.01, 0.1, 1 SOL)
- Max 20 players per race
- Automatic countdown when full
- Shareable links

### Real-Time Updates
- Live player count
- Countdown timer
- Transaction proof display
- Winner announcement

## Local Development

```bash
# Start profiles API
node profiles-api.js

# Serve frontend
npx serve .
```

## Profiles API

Simple REST API for player profiles:

```
GET  /api/profile/:wallet    - Get player profile
POST /api/profile/:wallet    - Update profile
POST /api/profiles/batch     - Get multiple profiles
GET  /api/avatars            - List available avatars
GET  /api/leaderboard        - Top players
```

## Proving Fairness

Every race result is verifiable:

1. **Target Slot**: Set in advance, visible to all
2. **Transaction Order**: Determined by Solana validators
3. **On-Chain Proof**: Winner's slot and tx index recorded
4. **Solscan Links**: Every result links to explorer

### Verification Steps

1. Note the race's `targetSlot`
2. After race, check winner's `winnerSlot` and `winnerTxIndex`
3. View transactions on Solscan
4. Verify the winning TX landed first at target slot

## Game Instructions

### Creating a Race
1. Fund your game wallet
2. Click "Create Race"
3. Select entry fee
4. Share the link with friends

### Joining a Race
1. Fund your game wallet
2. Browse open races
3. Click "Join" on desired race
4. Wait for countdown

### Racing
1. When countdown hits "GO!"
2. Your transaction auto-sends
3. Fastest RPC wins!
4. Winnings added to game balance

### Withdrawing
1. Click settings icon
2. Click "Withdraw All"
3. Funds sent to main wallet

## Deployment

### Nginx Config

```nginx
server {
    listen 443 ssl;
    server_name fun.whistle.ninja;
    
    root /var/www/fun.whistle.ninja;
    index index.html;
    
    location /api/ {
        proxy_pass http://localhost:3491/api/;
    }
    
    location / {
        try_files $uri $uri/ =404;
    }
}
```

### Systemd Service

```ini
[Unit]
Description=TX Race Profiles API
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/fun.whistle.ninja
ExecStart=/usr/bin/node profiles-api.js
Restart=always

[Install]
WantedBy=multi-user.target
```

## Security Notes

- Burner wallets are client-side only
- Never store large amounts in game wallet
- Contract is trustless and non-custodial
- All transactions require user signature

