# Whistle Network Smart Contract

**Program ID**: `whttByewzTQzAz3VMxnyJHdKsd7AyNRdG2tDHXVTksr`

Native Solana program (non-Anchor) implementing staking, provider registry, cache node system, and X402 payment processing.

## Overview

The Whistle staking contract provides:

1. **WHISTLE Token Staking** - Stake tokens to earn rewards and access tokens
2. **Provider Registry** - Register as an RPC data provider with bonds
3. **Cache Node System** - Run RPC cache nodes and earn from traffic
4. **Developer Accounts** - Stake for rebates on RPC usage
5. **X402 Payment Processing** - Collect and distribute revenue

## Token Information

| Property | Value |
|----------|-------|
| Token | WHISTLE |
| Mint | `6Hb2xgEhyN9iVVH3cgSxYjfN774ExzgiCftwiWdjpump` |
| Decimals | 6 |
| Max Supply | Variable |

## Account Structures

### StakingPool (155 bytes)
Main pool configuration and statistics.

```typescript
interface StakingPool {
  authority: PublicKey;        // Pool admin
  whistleMint: PublicKey;      // Token mint
  tokenVault: PublicKey;       // Token storage
  totalStaked: u64;            // Total tokens staked
  totalAccessTokens: u64;      // Access tokens issued
  minStakeAmount: u64;         // Minimum to stake
  tokensPerWhistle: u64;       // Exchange rate
  isActive: boolean;           // Pool status
  createdAt: i64;              // Unix timestamp
  cooldownPeriod: i64;         // Unstake delay (seconds)
  maxStakePerUser: u64;        // Cap per user
  rateLocked: boolean;         // Rate immutable
  bump: u8;                    // PDA bump
}
```

### StakerAccount (82 bytes)
Individual staker data.

```typescript
interface StakerAccount {
  staker: PublicKey;           // Owner wallet
  stakedAmount: u64;           // Tokens staked
  accessTokens: u64;           // Access tokens held
  lastStakeTime: i64;          // Last action time
  nodeOperator: boolean;       // Can run nodes
  votingPower: u64;            // Repurposed: reward_debt
  dataEncrypted: u64;          // Usage metric
  pendingRewards: u64;         // Unclaimed rewards
  bump: u8;
}
```

### CacheNodeAccount (~378 bytes)
Cache node operator account.

```typescript
interface CacheNodeAccount {
  operator: PublicKey;         // Operator wallet
  endpoint: string;            // RPC URL (max 256)
  bondAmount: u64;             // WHISTLE bonded
  registeredAt: i64;           // Registration time
  isActive: boolean;           // Node status
  totalEarned: u64;            // Lifetime earnings
  pendingEarnings: u64;        // Unclaimed SOL
  lastHeartbeat: i64;          // Last heartbeat
  requestsServed: u64;         // Total requests
  cacheHitRate: u64;           // Hit rate (bps)
  avgLatencyMs: u64;           // Repurposed: reward_debt
  reputationScore: u64;        // Score (0-10000)
  slashedAmount: u64;          // Slashed tokens
  penaltyCount: u32;           // Penalty count
  bump: u8;
}
```

### CacheRewardsPool (86 bytes)
Pool for cache node rewards.

```typescript
interface CacheRewardsPool {
  authority: PublicKey;
  totalPoolBalance: u64;       // SOL available
  totalDistributed: u64;       // Lifetime distributed
  totalNodes: u32;             // Active node count
  minBondAmount: u64;          // Min bond required
  lastDistribution: i64;       // Last distro time
  accumulatedPerNode: u128;    // Per-node accumulator
  isActive: boolean;
  bump: u8;
}
```

## PDA Derivation

```typescript
import { PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('whttByewzTQzAz3VMxnyJHdKsd7AyNRdG2tDHXVTksr');

// Staking Pool
const [stakingPool] = PublicKey.findProgramAddressSync(
  [Buffer.from('staking_pool'), authority.toBuffer()],
  PROGRAM_ID
);

// Token Vault
const [tokenVault] = PublicKey.findProgramAddressSync(
  [Buffer.from('token_vault'), authority.toBuffer()],
  PROGRAM_ID
);

// Staker Account
const [stakerAccount] = PublicKey.findProgramAddressSync(
  [Buffer.from('staker'), wallet.toBuffer()],
  PROGRAM_ID
);

// Cache Node Account
const [cacheNodeAccount] = PublicKey.findProgramAddressSync(
  [Buffer.from('cache_node_account'), operator.toBuffer()],
  PROGRAM_ID
);

// Cache Rewards Pool
const [cacheRewardsPool] = PublicKey.findProgramAddressSync(
  [Buffer.from('cache_rewards_pool')],
  PROGRAM_ID
);

// X402 Payment Wallet
const [x402Wallet] = PublicKey.findProgramAddressSync(
  [Buffer.from('x402_payment_wallet')],
  PROGRAM_ID
);

// Rewards Accumulator
const [rewardsAccumulator] = PublicKey.findProgramAddressSync(
  [Buffer.from('rewards_accumulator')],
  PROGRAM_ID
);
```

## Instructions

### Cache Node Operations

#### RegisterCacheNode (discriminator: 33)
Register as a cache node operator.

```typescript
// Accounts
const accounts = [
  { pubkey: operator, isSigner: true, isWritable: true },
  { pubkey: cacheNodeAccount, isSigner: false, isWritable: true },
  { pubkey: operatorTokenAccount, isSigner: false, isWritable: true },
  { pubkey: tokenVault, isSigner: false, isWritable: true },
  { pubkey: cacheRewardsPool, isSigner: false, isWritable: true },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
  { pubkey: stakingPool, isSigner: false, isWritable: false },
];

// Data: [discriminator(1), endpoint_len(4), endpoint(N), bond_amount(8)]
const data = Buffer.concat([
  Buffer.from([33]),
  // Borsh-encoded endpoint string + u64 bond_amount
]);
```

#### CacheNodeHeartbeat (discriminator: 34)
Send heartbeat to prove online status.

```typescript
const accounts = [
  { pubkey: operator, isSigner: true, isWritable: false },
  { pubkey: cacheNodeAccount, isSigner: false, isWritable: true },
  { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
];
const data = Buffer.from([34]);
```

#### ClaimCacheNodeEarnings (discriminator: 35)
Claim accumulated earnings.

```typescript
const accounts = [
  { pubkey: operator, isSigner: true, isWritable: true },
  { pubkey: cacheNodeAccount, isSigner: false, isWritable: true },
  { pubkey: cacheRewardsPool, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
];
const data = Buffer.from([35]);
```

#### DeregisterCacheNode (discriminator: 38)
Deregister and return bond.

```typescript
const accounts = [
  { pubkey: operator, isSigner: true, isWritable: true },
  { pubkey: cacheNodeAccount, isSigner: false, isWritable: true },
  { pubkey: tokenVault, isSigner: false, isWritable: true },
  { pubkey: operatorTokenAccount, isSigner: false, isWritable: true },
  { pubkey: cacheRewardsPool, isSigner: false, isWritable: true },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: stakingPool, isSigner: false, isWritable: false },
];
const data = Buffer.from([38]);
```

### Staking Operations

#### Stake (discriminator: 1)
Stake WHISTLE tokens.

```typescript
const accounts = [
  { pubkey: staker, isSigner: true, isWritable: true },
  { pubkey: stakingPool, isSigner: false, isWritable: true },
  { pubkey: stakerAccount, isSigner: false, isWritable: true },
  { pubkey: stakerTokenAccount, isSigner: false, isWritable: true },
  { pubkey: tokenVault, isSigner: false, isWritable: true },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
];

// Data: [1, amount(8 bytes LE)]
const data = Buffer.alloc(9);
data.writeUInt8(1, 0);
data.writeBigUInt64LE(BigInt(amount), 1);
```

#### Unstake (discriminator: 2)
Unstake WHISTLE tokens.

```typescript
// Same account structure as Stake
// Data: [2, amount(8 bytes LE)]
const data = Buffer.alloc(9);
data.writeUInt8(2, 0);
data.writeBigUInt64LE(BigInt(amount), 1);
```

#### ClaimStakerRewards (discriminator: 20)
Claim staking rewards.

```typescript
const accounts = [
  { pubkey: staker, isSigner: true, isWritable: true },
  { pubkey: stakerAccount, isSigner: false, isWritable: true },
  { pubkey: stakingPool, isSigner: false, isWritable: false },
  { pubkey: paymentVault, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: rewardsAccumulator, isSigner: false, isWritable: true }, // Optional
];
const data = Buffer.from([20]);
```

## Revenue Distribution

### X402 Payment Split
When X402 payments are processed:

| Recipient | Share | Description |
|-----------|-------|-------------|
| Stakers | 60% | Proportional to stake |
| Cache Nodes | 25% | Only active nodes |
| Treasury | 10% | Development fund |
| Bonus Pool | 5% | Top performers |

### Query Payment Split (Legacy)
For direct query payments:

| Recipient | Share |
|-----------|-------|
| Provider | 70% |
| Bonus Pool | 20% |
| Treasury | 5% |
| Stakers | 5% |

## Security Considerations

1. **Bond Requirements**: Cache nodes must bond minimum 100 WHISTLE
2. **Heartbeat Timeout**: Nodes must heartbeat every 5 minutes
3. **Slashing**: Bad actors can lose up to 50% of bond
4. **PDA Validation**: All accounts verified against expected PDAs
5. **Authority**: Critical operations require multi-sig authority

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 0 | InsufficientBalance | Not enough funds |
| 1 | InvalidAccountData | Data validation failed |
| 2 | InvalidSeeds | PDA mismatch |
| 3 | AccountAlreadyInitialized | Already exists |
| 4 | IncorrectProgramId | Wrong program owner |
| 5 | MissingRequiredSignature | Signer missing |
| 6 | InvalidInstructionData | Bad input data |
| 7 | InsufficientFunds | Underfunded operation |

## Constants

```rust
const MAX_STAKE_PER_USER: u64 = 10_000_000_000_000_000;  // 10M WHISTLE
const MIN_PROVIDER_BOND: u64 = 1_000_000_000;            // 1000 WHISTLE
const MIN_CACHE_NODE_BOND: u64 = 100_000_000;            // 100 WHISTLE
const HEARTBEAT_TIMEOUT: i64 = 300;                      // 5 minutes
const MIN_HEARTBEAT_INTERVAL: i64 = 30;                  // 30 seconds
const MIN_ENDPOINT_LENGTH: usize = 10;
const MAX_ENDPOINT_LENGTH: usize = 256;
```

## Example: Register Cache Node (JavaScript)

```javascript
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';

const PROGRAM_ID = new PublicKey('whttByewzTQzAz3VMxnyJHdKsd7AyNRdG2tDHXVTksr');
const WHISTLE_MINT = new PublicKey('6Hb2xgEhyN9iVVH3cgSxYjfN774ExzgiCftwiWdjpump');

async function registerCacheNode(connection, operator, endpoint, bondAmount) {
  const authority = new PublicKey('YOUR_AUTHORITY');
  
  // Derive PDAs
  const [stakingPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool'), authority.toBuffer()],
    PROGRAM_ID
  );
  
  const [tokenVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_vault'), authority.toBuffer()],
    PROGRAM_ID
  );
  
  const [cacheNodeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('cache_node_account'), operator.publicKey.toBuffer()],
    PROGRAM_ID
  );
  
  const [cacheRewardsPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('cache_rewards_pool')],
    PROGRAM_ID
  );
  
  const operatorTokenAccount = await getAssociatedTokenAddress(
    WHISTLE_MINT,
    operator.publicKey
  );
  
  // Build instruction data
  const endpointBytes = Buffer.from(endpoint, 'utf8');
  const data = Buffer.alloc(1 + 4 + endpointBytes.length + 8);
  let offset = 0;
  
  data.writeUInt8(33, offset); offset += 1; // Discriminator
  data.writeUInt32LE(endpointBytes.length, offset); offset += 4;
  endpointBytes.copy(data, offset); offset += endpointBytes.length;
  data.writeBigUInt64LE(BigInt(bondAmount), offset);
  
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: operator.publicKey, isSigner: true, isWritable: true },
      { pubkey: cacheNodeAccount, isSigner: false, isWritable: true },
      { pubkey: operatorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: tokenVault, isSigner: false, isWritable: true },
      { pubkey: cacheRewardsPool, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: stakingPool, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
  
  const tx = new Transaction().add(instruction);
  const signature = await connection.sendTransaction(tx, [operator]);
  
  return signature;
}
```

## Resources

- [Full IDL](./whistle_staking.json) - Complete instruction set in JSON
- [Solscan](https://solscan.io/account/whttByewzTQzAz3VMxnyJHdKsd7AyNRdG2tDHXVTksr) - View on explorer
- [Token](https://solscan.io/token/6Hb2xgEhyN9iVVH3cgSxYjfN774ExzgiCftwiWdjpump) - WHISTLE token

