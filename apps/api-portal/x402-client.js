// x402 Client v3 - NLx402 Based Implementation
// Enhanced security with nonce-locked, hash-bound, single-use payment quotes

(function () {
  function waitForSolanaWeb3() {
    return new Promise((resolve) => {
      if (window.solanaWeb3) {
        resolve(window.solanaWeb3);
        return;
      }
      let attempts = 0;
      const checkInterval = setInterval(() => {
        attempts++;
        if (window.solanaWeb3) {
          clearInterval(checkInterval);
          resolve(window.solanaWeb3);
        } else if (attempts > 100) {
          clearInterval(checkInterval);
          resolve(null);
        }
      }, 100);
    });
  }
  
  // ============ CONFIGURATION ============
  const WHTT_PROGRAM_ID = 'whttByewzTQzAz3VMxnyJHdKsd7AyNRdG2tDHXVTksr';
  const RPC_URL = 'https://rpc.whistle.ninja';
  const API_BASE_URL = 'https://api.whistle.ninja';
  
  const FACILITATOR_FEE_SOL = 0.001;
  const FACILITATOR_WALLET = 'GwtbzDh6QHwVan4DVyUR11gzBVcBT92KjnaPdk43fMG5';
  
  // Plan configurations
  const PLANS = {
    basic: {
      monthly: { amount: 0.2, duration: 30 * 24 },    // 0.2 SOL = $40/mo
      yearly: { amount: 2.0, duration: 365 * 24 }     // 2.0 SOL = $400/yr
    },
    advanced: {
      monthly: { amount: 1.0, duration: 30 * 24 },    // 1 SOL = $200/mo
      yearly: { amount: 10.0, duration: 365 * 24 }    // 10 SOL = $2000/yr
    },
    premium: {
      monthly: { amount: 2.0, duration: 30 * 24 },    // 2 SOL = $400/mo
      yearly: { amount: 20.0, duration: 365 * 24 }    // 20 SOL = $4000/yr
    }
  };
  // ========================================
  
  let solanaWeb3 = null;
  
  // X402 Wallet PDA - pre-computed
  const X402_WALLET_PDA = 'BMiSBoT5aPCrFcxaTrHuzXMkfrtzCLMcDYqrPTVymNbU';
  
  function deriveX402WalletPDA() {
    return X402_WALLET_PDA;
  }

  async function connectWallet() {
    console.log('[X402] Detecting wallets...');
    console.log('[X402] window.phantom:', !!window.phantom);
    console.log('[X402] window.solana:', !!window.solana);
    console.log('[X402] window.solflare:', !!window.solflare);
    
    // Try Phantom first
    const phantom = window.phantom?.solana || window.solana;
    if (phantom?.isPhantom) {
      console.log('[X402] Phantom detected, checking if already connected...');
      
      // Check if already connected
      if (phantom.isConnected && phantom.publicKey) {
        console.log('[X402] Already connected:', phantom.publicKey.toBase58());
        return { provider: phantom, publicKey: phantom.publicKey };
      }
      
      try {
        console.log('[X402] Requesting Phantom connection...');
        const resp = await phantom.connect({ onlyIfTrusted: false });
        console.log('[X402] Phantom connected:', resp.publicKey.toBase58());
        return { provider: phantom, publicKey: resp.publicKey };
      } catch (err) {
        console.error('[X402] Phantom error:', err);
        if (err.code === 4001) throw new Error('Connection rejected by user');
        throw new Error('Phantom connection failed: ' + (err.message || err));
      }
    }
    
    // Try Solflare
    if (window.solflare?.isSolflare) {
      console.log('[X402] Solflare detected...');
      if (window.solflare.isConnected && window.solflare.publicKey) {
        console.log('[X402] Solflare already connected');
        return { provider: window.solflare, publicKey: window.solflare.publicKey };
      }
      
      try {
        await window.solflare.connect();
        console.log('[X402] Solflare connected:', window.solflare.publicKey.toBase58());
        return { provider: window.solflare, publicKey: window.solflare.publicKey };
      } catch (err) {
        console.error('[X402] Solflare error:', err);
        if (err.code === 4001) throw new Error('Connection rejected by user');
        throw new Error('Solflare connection failed: ' + (err.message || err));
      }
    }
    
    throw new Error('No Solana wallet found. Please install Phantom or Solflare.');
  }

  async function purchasePlanWithWallet(plan, billing, provider, publicKey) {
    console.log('[X402] Starting purchase with wallet:', plan, billing);
    
    if (!solanaWeb3) {
      solanaWeb3 = await waitForSolanaWeb3();
      if (!solanaWeb3) throw new Error('Solana Web3.js failed to load');
    }
    
    const planConfig = PLANS[plan];
    if (!planConfig) throw new Error('Invalid plan');
    
    const { amount, duration } = planConfig[billing];
    const x402Amount = amount - FACILITATOR_FEE_SOL;
    const walletAddress = publicKey.toBase58();
    console.log('[X402] Config:', { amount, duration, x402Amount, walletAddress });
    
    try {
      // Get quote from backend
      console.log('[X402] Requesting quote...');
      const quoteResponse = await fetch(`${API_BASE_URL}/api/x402/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          plan,
          billing
        })
      });

      if (!quoteResponse.ok) {
        const error = await quoteResponse.json();
        throw new Error(error.error || 'Failed to generate quote');
      }

      const { quote, nonce } = await quoteResponse.json();
      console.log('[X402] Quote received:', quote.amount);

      // Make payment
      const connection = new solanaWeb3.Connection(RPC_URL, 'confirmed');
      
      const balance = await connection.getBalance(publicKey);
      const requiredLamports = Math.floor(amount * 1e9);
      console.log('[X402] Balance:', balance / 1e9, 'SOL, need:', amount);
      
      if (balance < requiredLamports + 10000) {
        throw new Error(`Insufficient SOL: need ${amount} SOL + fees`);
      }

      const transaction = new solanaWeb3.Transaction();
      
      // Memo instruction
      const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
      const memoText = `nlx402:${nonce}:rpc-${plan}`;
      const memoData = new TextEncoder().encode(memoText);
      transaction.add(new solanaWeb3.TransactionInstruction({
        programId: new solanaWeb3.PublicKey(MEMO_PROGRAM_ID),
        keys: [],
        data: memoData
      }));
      
      // X402 transfer
      transaction.add(solanaWeb3.SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: new solanaWeb3.PublicKey(quote.recipient),
        lamports: Math.floor(x402Amount * 1e9)
      }));
      
      // Facilitator transfer
      transaction.add(solanaWeb3.SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: new solanaWeb3.PublicKey(FACILITATOR_WALLET),
        lamports: Math.floor(FACILITATOR_FEE_SOL * 1e9)
      }));
      
      const { blockhash } = await connection.getLatestBlockhash('finalized');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;
      
      console.log('[X402] Requesting signature...');
      const signed = await provider.signTransaction(transaction);
      console.log('[X402] Sending transaction...');
      const txSig = await connection.sendRawTransaction(signed.serialize());
      console.log('[X402] TX sent:', txSig);
      
      // Confirm
      await connection.confirmTransaction(txSig, 'confirmed');
      console.log('[X402] TX confirmed');

      // Verify payment and get API key
      console.log('[X402] Verifying payment...');
      const verifyResponse = await fetch(`${API_BASE_URL}/api/x402/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txSignature: txSig,
          nonce,
          walletAddress
        })
      });

      if (!verifyResponse.ok) {
        const error = await verifyResponse.json();
        throw new Error(error.error || 'Failed to verify payment');
      }

      const verifyData = await verifyResponse.json();
      
      if (!verifyData.success || !verifyData.apiKey) {
        throw new Error('Failed to obtain API key');
      }

      console.log('[X402] API Key received!');

      // Store locally
      localStorage.setItem('whistle_api_key', verifyData.apiKey);

      return {
        success: true,
        apiKey: verifyData.apiKey,
        plan: verifyData.plan,
        billing: verifyData.billing,
        txSig: txSig,
        expiresAt: verifyData.expiresAt
      };
      
    } catch (error) {
      console.error('[X402] Payment failed:', error);
      throw error;
    }
  }

  async function purchasePlan(plan, billing = 'monthly') {
    console.log('[X402] Starting purchase:', plan, billing);
    
    if (!solanaWeb3) {
      console.log('[X402] Waiting for Solana Web3...');
      solanaWeb3 = await waitForSolanaWeb3();
      if (!solanaWeb3) throw new Error('Solana Web3.js failed to load');
    }
    console.log('[X402] Solana Web3 loaded');
    
    const planConfig = PLANS[plan];
    if (!planConfig) throw new Error('Invalid plan');
    
    const { amount, duration } = planConfig[billing];
    const x402Amount = amount - FACILITATOR_FEE_SOL;
    console.log('[X402] Plan config:', { amount, duration, x402Amount });
    
    // Connect wallet
    console.log('[X402] Connecting wallet...');
    const { provider, publicKey } = await connectWallet();
    const walletAddress = publicKey.toBase58();
    console.log('[X402] Wallet connected:', walletAddress);
    
    try {
      // Get quote from backend
      console.log('[X402] Requesting quote from:', NLX402_BASE_URL);
      const quoteResponse = await fetch(`${NLX402_BASE_URL}/api/nlx402/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          feature: `rpc-${plan}-${billing}`,
          amount: amount,
          duration: duration
        })
      });

      console.log('[X402] Quote response status:', quoteResponse.status);
      if (!quoteResponse.ok) {
        const error = await quoteResponse.json();
        console.error('[X402] Quote error:', error);
        throw new Error(error.error || 'Failed to generate quote');
      }

      const { quote, nonce } = await quoteResponse.json();
      console.log('[X402] Quote received:', { quote, nonce });

      // Verify quote
      console.log('[X402] Verifying quote...');
      const verifyResponse = await fetch(`${NLX402_BASE_URL}/api/nlx402/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote, nonce, walletAddress })
      });

      if (!verifyResponse.ok) throw new Error('Quote verification failed');

      // Make payment
      const connection = new solanaWeb3.Connection(RPC_URL, 'confirmed');
      
      const balance = await connection.getBalance(publicKey);
      const requiredLamports = Math.floor(amount * 1e9);
      
      if (balance < requiredLamports + 10000) {
        throw new Error(`Insufficient SOL: need ${amount} SOL + fees`);
      }

      const transaction = new solanaWeb3.Transaction();
      
      // Memo instruction
      const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
      const memoText = `nlx402:${nonce}:rpc-${plan}`;
      const memoData = new TextEncoder().encode(memoText);
      transaction.add(new solanaWeb3.TransactionInstruction({
        programId: new solanaWeb3.PublicKey(MEMO_PROGRAM_ID),
        keys: [],
        data: memoData
      }));
      
      // X402 transfer
      transaction.add(solanaWeb3.SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: new solanaWeb3.PublicKey(quote.recipient),
        lamports: Math.floor(x402Amount * 1e9)
      }));
      
      // Facilitator transfer
      transaction.add(solanaWeb3.SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: new solanaWeb3.PublicKey(FACILITATOR_WALLET),
        lamports: Math.floor(FACILITATOR_FEE_SOL * 1e9)
      }));
      
      const { blockhash } = await connection.getLatestBlockhash('finalized');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;
      
      // Sign and send
      const signed = await provider.signTransaction(transaction);
      const txSig = await connection.sendRawTransaction(signed.serialize());
      
      // Confirm
      await connection.confirmTransaction(txSig, 'confirmed');

      // Unlock access and get API key
      const unlockResponse = await fetch(`${NLX402_BASE_URL}/api/nlx402/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx: txSig,
          nonce,
          walletAddress,
          feature: `rpc-${plan}-${billing}`
        })
      });

      if (!unlockResponse.ok) throw new Error('Failed to unlock access');

      const unlockData = await unlockResponse.json();
      
      if (!unlockData.success || !unlockData.accessToken) {
        throw new Error('Failed to obtain API key');
      }

      // Store locally
      const subscriptionData = {
        apiKey: unlockData.accessToken,
        plan: plan,
        billing: billing,
        txSig: txSig,
        walletAddress: walletAddress,
        expiresAt: Date.now() + (duration * 60 * 60 * 1000),
        createdAt: Date.now()
      };
      
      localStorage.setItem('whistle_rpc_subscription', JSON.stringify(subscriptionData));
      localStorage.setItem('whistle_api_key', unlockData.accessToken);

      return {
        success: true,
        apiKey: unlockData.accessToken,
        plan: plan,
        billing: billing,
        txSig: txSig,
        expiresAt: subscriptionData.expiresAt
      };
      
    } catch (error) {
      console.error('X402 payment failed:', error);
      throw error;
    }
  }

  function getSubscription() {
    try {
      const data = localStorage.getItem('whistle_rpc_subscription');
      if (!data) return null;
      
      const subscription = JSON.parse(data);
      if (subscription.expiresAt < Date.now()) {
        localStorage.removeItem('whistle_rpc_subscription');
        localStorage.removeItem('whistle_api_key');
        return null;
      }
      
      return subscription;
    } catch {
      return null;
    }
  }

  function getApiKey() {
    const subscription = getSubscription();
    return subscription ? subscription.apiKey : null;
  }

  function getTimeRemaining() {
    const subscription = getSubscription();
    if (!subscription) return 0;
    return Math.max(0, subscription.expiresAt - Date.now());
  }

  async function init() {
    solanaWeb3 = await waitForSolanaWeb3();
    
    window.x402 = {
      purchasePlan,
      purchasePlanWithWallet,
      getSubscription,
      getApiKey,
      getTimeRemaining,
      connectWallet,
      PLANS,
      X402_WALLET: X402_WALLET_PDA,
      version: '3.0-rpc'
    };
    
    console.log('✅ X402 RPC Client loaded');
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
