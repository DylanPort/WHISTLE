#!/usr/bin/env node
/**
 * LOCAL DISTRIBUTION SCRIPT
 * 
 * Run this from YOUR machine to distribute rewards.
 * Keypair never leaves your computer.
 * 
 * Usage:
 *   set AUTHORITY_KEYPAIR=C:\path\to\keypair.json
 *   node distribute.js
 */

const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const https = require('https');

// ============= CONFIG =============

const PROGRAM_ID = new PublicKey('whttByewzTQzAz3VMxnyJHdKsd7AyNRdG2tDHXVTksr');
const CACHE_REWARDS_POOL = new PublicKey('GC6sMFWLgm2ziEhtreQSCiVLsWkeQeLif5zdFqff6NGo');
const RPC_URL = 'https://api.mainnet-beta.solana.com'; // or your RPC
const RELAY_URL = 'https://earn.whistle.ninja/nodes';
const DISTRIBUTE_INSTRUCTION = 40;

// ============= HELPERS =============

function getCacheNodePDA(operator) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('cache_node_account'), operator.toBuffer()],
    PROGRAM_ID
  );
}

async function fetchOnlineNodes() {
  return new Promise((resolve, reject) => {
    https.get(RELAY_URL, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.nodes || []);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// ============= MAIN =============

async function main() {
  console.log('\n🌐 WHISTLE CACHE NODE DISTRIBUTION\n');

  // Load keypair
  const keypairPath = process.env.AUTHORITY_KEYPAIR;
  if (!keypairPath) {
    console.error('❌ Set AUTHORITY_KEYPAIR environment variable to your keypair path');
    console.error('   Example: set AUTHORITY_KEYPAIR=C:\\Users\\you\\.config\\solana\\id.json');
    process.exit(1);
  }

  if (!fs.existsSync(keypairPath)) {
    console.error(`❌ Keypair file not found: ${keypairPath}`);
    process.exit(1);
  }

  const keyData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keyData));
  console.log(`✅ Authority: ${authority.publicKey.toBase58()}`);

  // Connect to Solana
  const connection = new Connection(RPC_URL, 'confirmed');

  // Get pool balance
  const poolBalance = await connection.getBalance(CACHE_REWARDS_POOL);
  console.log(`💰 Pool Balance: ${(poolBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

  if (poolBalance < 0.001 * LAMPORTS_PER_SOL) {
    console.log('⚠️  Pool balance too low, nothing to distribute');
    process.exit(0);
  }

  // Get online nodes from relay
  console.log('\n📡 Fetching online nodes from relay...');
  const nodes = await fetchOnlineNodes();
  const onlineNodes = nodes.filter(n => n.registered && n.isOnline);
  
  console.log(`   Total nodes: ${nodes.length}`);
  console.log(`   Online & registered: ${onlineNodes.length}`);

  if (onlineNodes.length === 0) {
    console.log('⚠️  No online registered nodes');
    process.exit(0);
  }

  // Show nodes
  console.log('\n📋 Distributing to:');
  for (const node of onlineNodes) {
    const uptime = node.uptime ? `${Math.floor(node.uptime / 3600)}h ${Math.floor((node.uptime % 3600) / 60)}m` : 'N/A';
    console.log(`   ${node.operator.slice(0, 8)}... - ${uptime} uptime`);
  }

  // Calculate distribution (90% of pool)
  const distributionAmount = BigInt(Math.floor(poolBalance * 0.9));
  const perNode = Number(distributionAmount) / onlineNodes.length / LAMPORTS_PER_SOL;
  
  console.log(`\n💸 Distribution:`);
  console.log(`   Total: ${(Number(distributionAmount) / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`   Per node: ~${perNode.toFixed(6)} SOL`);

  // Confirm
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  const answer = await new Promise(resolve => {
    rl.question('\n🔑 Proceed with distribution? (y/n): ', resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    process.exit(0);
  }

  // Build transaction
  console.log('\n⏳ Building transaction...');

  const amountBytes = Buffer.alloc(8);
  amountBytes.writeBigUInt64LE(distributionAmount, 0);

  const keys = [
    { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    { pubkey: CACHE_REWARDS_POOL, isSigner: false, isWritable: true },
  ];

  for (const node of onlineNodes) {
    const operatorPubkey = new PublicKey(node.operator);
    const [nodePDA] = getCacheNodePDA(operatorPubkey);
    keys.push({ pubkey: nodePDA, isSigner: false, isWritable: true });
  }

  const instruction = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: Buffer.from([DISTRIBUTE_INSTRUCTION, ...amountBytes]),
  });

  const transaction = new Transaction().add(instruction);

  // Send
  console.log('📤 Sending transaction...');
  
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [authority],
      { commitment: 'confirmed' }
    );

    console.log(`\n✅ SUCCESS!`);
    console.log(`   Signature: ${signature}`);
    console.log(`   Explorer: https://solscan.io/tx/${signature}`);
    
  } catch (error) {
    console.error('\n❌ Transaction failed:', error.message);
    if (error.logs) {
      console.error('Logs:', error.logs);
    }
    process.exit(1);
  }
}

main().catch(console.error);

