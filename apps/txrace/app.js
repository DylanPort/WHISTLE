/**
 * TX RACE - Game Logic
 * Whistle Network
 */

const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, Keypair } = solanaWeb3;

// Base58 encoding/decoding for keypair storage
const bs58 = {
    alphabet: '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
    encode: function(buffer) {
        const digits = [0];
        for (let i = 0; i < buffer.length; i++) {
            let carry = buffer[i];
            for (let j = 0; j < digits.length; j++) {
                carry += digits[j] << 8;
                digits[j] = carry % 58;
                carry = (carry / 58) | 0;
            }
            while (carry > 0) {
                digits.push(carry % 58);
                carry = (carry / 58) | 0;
            }
        }
        let str = '';
        for (let i = 0; buffer[i] === 0 && i < buffer.length - 1; i++) str += '1';
        for (let i = digits.length - 1; i >= 0; i--) str += this.alphabet[digits[i]];
        return str;
    },
    decode: function(str) {
        const bytes = [0];
        for (let i = 0; i < str.length; i++) {
            const value = this.alphabet.indexOf(str[i]);
            if (value < 0) throw new Error('Invalid base58 character');
            let carry = value;
            for (let j = 0; j < bytes.length; j++) {
                carry += bytes[j] * 58;
                bytes[j] = carry & 0xff;
                carry >>= 8;
            }
            while (carry > 0) {
                bytes.push(carry & 0xff);
                carry >>= 8;
            }
        }
        for (let i = 0; str[i] === '1' && i < str.length - 1; i++) bytes.push(0);
        return new Uint8Array(bytes.reverse());
    }
};

// Buffer polyfill for browser
const BufferPolyfill = {
    from: (data) => {
        if (typeof data === 'string') {
            return new TextEncoder().encode(data);
        }
        return new Uint8Array(data);
    },
    alloc: (size) => new Uint8Array(size),
};

// ============= BURNER WALLET =============
let burnerKeypair = null;
let useBurnerWallet = false;

function generateBurnerWallet() {
    // Generate a new keypair
    const keypair = Keypair.generate();
    
    // Store in localStorage (base58 encoded secret key)
    const secretKeyBase58 = bs58.encode(keypair.secretKey);
    localStorage.setItem('txrace_burner_key', secretKeyBase58);
    
    burnerKeypair = keypair;
    useBurnerWallet = true;
    
    console.log('🔥 Burner wallet created:', keypair.publicKey.toString());
    return keypair;
}

function loadBurnerWallet() {
    const stored = localStorage.getItem('txrace_burner_key');
    if (stored) {
        try {
            const secretKey = bs58.decode(stored);
            burnerKeypair = Keypair.fromSecretKey(secretKey);
            console.log('🔥 Burner wallet loaded:', burnerKeypair.publicKey.toString());
            return burnerKeypair;
        } catch (e) {
            console.error('Failed to load burner wallet:', e);
            localStorage.removeItem('txrace_burner_key');
        }
    }
    return null;
}

function getBurnerBalance() {
    if (!burnerKeypair) return 0;
    return connection.getBalance(burnerKeypair.publicKey)
        .then(bal => bal / 1e9)
        .catch(() => 0);
}

async function fundBurnerWallet(amount) {
    if (!burnerKeypair || !wallet) {
        showToast('Connect main wallet first', 'error');
        return;
    }
    
    const lamports = Math.floor(amount * 1e9);
    
    const transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: new PublicKey(publicKey),
            toPubkey: burnerKeypair.publicKey,
            lamports,
        })
    );
    
    transaction.feePayer = new PublicKey(publicKey);
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    
    const signed = await wallet.signTransaction(transaction);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, 'confirmed');
    
    showToast(`Funded burner with ${amount} SOL!`, 'success');
    updateBurnerDisplay();
}

async function withdrawFromBurner(toAddress, amount) {
    if (!burnerKeypair) {
        showToast('No burner wallet', 'error');
        return;
    }
    
    const lamports = Math.floor(amount * 1e9);
    const destination = new PublicKey(toAddress);
    
    const transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: burnerKeypair.publicKey,
            toPubkey: destination,
            lamports: lamports - 5000, // Leave some for tx fee
        })
    );
    
    transaction.feePayer = burnerKeypair.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    
    // Sign with burner keypair - NO POPUP!
    transaction.sign(burnerKeypair);
    
    const sig = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(sig, 'confirmed');
    
    showToast('Withdrawn from burner!', 'success');
    updateBurnerDisplay();
}

function exportBurnerKey() {
    if (!burnerKeypair) {
        showToast('No burner wallet', 'error');
        return null;
    }
    return bs58.encode(burnerKeypair.secretKey);
}

function deleteBurnerWallet() {
    localStorage.removeItem('txrace_burner_key');
    burnerKeypair = null;
    useBurnerWallet = false;
    showToast('Burner wallet deleted', 'info');
    updateBurnerDisplay();
}

async function updateBurnerDisplay() {
    const burnerSection = document.getElementById('burnerSection');
    const burnerAddress = document.getElementById('burnerAddress');
    const burnerBal = document.getElementById('burnerBalance');
    
    if (burnerKeypair && burnerSection) {
        burnerSection.classList.remove('hidden');
        burnerAddress.textContent = burnerKeypair.publicKey.toString().slice(0, 8) + '...' + burnerKeypair.publicKey.toString().slice(-8);
        const bal = await getBurnerBalance();
        burnerBal.textContent = bal.toFixed(4) + ' SOL';
    } else if (burnerSection) {
        burnerSection.classList.add('hidden');
    }
}

// Sign transaction with burner wallet (NO POPUP!)
function signWithBurner(transaction) {
    if (!burnerKeypair) throw new Error('No burner wallet');
    transaction.sign(burnerKeypair);
    return transaction;
}

// ============= BURNER WALLET UI =============
async function createBurnerWallet() {
    generateBurnerWallet();
    updateBurnerUI();
    showToast('🔥 Burner wallet created! Fund it to start racing without popups.', 'success');
}

function updateBurnerUI() {
    const notCreated = document.getElementById('burnerNotCreated');
    const created = document.getElementById('burnerCreated');
    const linkedSection = document.getElementById('linkedWalletSection');
    const linkedDisplay = document.getElementById('linkedWalletDisplay');
    
    if (burnerKeypair) {
        notCreated?.classList.add('hidden');
        created?.classList.remove('hidden');
        document.getElementById('burnerAddressDisplay').textContent = burnerKeypair.publicKey.toString();
        
        refreshBurnerBalance();
        updateSettingsGameBalance();
        
        // Show linked wallet if exists
        const linkedWallet = localStorage.getItem('txrace_linked_wallet');
        if (linkedWallet && linkedSection && linkedDisplay) {
            linkedSection.classList.remove('hidden');
            linkedDisplay.textContent = linkedWallet.slice(0, 6) + '...' + linkedWallet.slice(-6);
        }
    } else {
        notCreated?.classList.remove('hidden');
        created?.classList.add('hidden');
    }
}

function updateSettingsGameBalance() {
    const el = document.getElementById('settingsGameBalance');
    if (el) {
        el.textContent = gameBalance.toFixed(4);
    }
}

async function refreshBurnerBalance() {
    if (!burnerKeypair) return;
    const bal = await getBurnerBalance();
    burnerBalance = bal; // Store in global variable
    
    // Update settings display
    const display = document.getElementById('burnerBalanceDisplay');
    if (display) display.textContent = bal.toFixed(4) + ' SOL';
    
    // Update header display
    const headerDisplay = document.getElementById('headerBurnerBalance');
    if (headerDisplay) headerDisplay.textContent = bal.toFixed(4) + ' SOL';
}

function toggleBurnerWallet(enabled) {
    // Burner is mandatory now - always enabled
    useBurnerWallet = true;
    if (!enabled) {
        showToast('Burner wallet is required for TX Race!', 'info');
    }
}

function copyBurnerAddress() {
    if (!burnerKeypair) return;
    navigator.clipboard.writeText(burnerKeypair.publicKey.toString());
    showToast('Address copied!', 'success');
}

function showFundBurner() {
    fundFromMainWallet();
}

async function fundFromMainWallet() {
    if (!window.solana || !window.solana.isConnected) {
        showToast('Connect your main wallet first! Click "Connect Wallet" button.', 'error');
        // Try to connect
        try {
            await window.solana.connect();
            wallet = window.solana;
        } catch (e) {
            return;
        }
    }
    
    if (!burnerKeypair) {
        showToast('Game wallet not ready', 'error');
        return;
    }
    
    // Get the connected main wallet pubkey
    const mainWalletPubkey = window.solana.publicKey;
    
    if (!mainWalletPubkey) {
        showToast('Main wallet not connected. Please connect Phantom first.', 'error');
        return;
    }
    
    // Check main wallet balance first
    let mainBalance = 0;
    try {
        mainBalance = await connection.getBalance(mainWalletPubkey) / 1e9;
    } catch (e) {
        showToast('Could not fetch wallet balance', 'error');
        return;
    }
    
    if (mainBalance < 0.001) {
        showToast('Insufficient balance in Phantom wallet: ' + mainBalance.toFixed(4) + ' SOL', 'error');
        return;
    }
    
    // Show balance in prompt
    const maxSend = Math.max(0, mainBalance - 0.001).toFixed(4); // Leave some for fees
    const amount = prompt(`How much SOL to send? (Balance: ${mainBalance.toFixed(4)} SOL, Max: ${maxSend} SOL)`, '0.1');
    if (!amount || parseFloat(amount) <= 0) return;
    
    const amountNum = parseFloat(amount);
    
    // Validate amount against balance
    if (amountNum > mainBalance - 0.0005) {
        showToast('Not enough SOL! You have ' + mainBalance.toFixed(4) + ' SOL (need to keep some for fees)', 'error');
        return;
    }
    
    const lamports = Math.floor(amountNum * 1e9);
    
    try {
        showToast('Sending ' + amount + ' SOL to game wallet...', 'info');
        
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: mainWalletPubkey,
                toPubkey: burnerKeypair.publicKey,
                lamports,
            })
        );
        
        transaction.feePayer = mainWalletPubkey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        
        // This is the ONE popup - funding from main wallet
        const signed = await window.solana.signTransaction(transaction);
        const sig = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(sig, 'confirmed');
        
        showToast('✅ ' + amount + ' SOL sent to game wallet!', 'success');
        await refreshBurnerBalance();
        
    } catch (err) {
        console.error('Fund failed:', err);
        showToast('Failed: ' + (err.message || err), 'error');
    }
}

function showWithdrawBurner() {
    withdrawAll();
}

async function withdrawAll() {
    if (!burnerKeypair) {
        showToast('No game wallet', 'error');
        return;
    }
    
    const toAddress = prompt('Withdraw ALL funds to address:');
    if (!toAddress) return;
    
    try {
        new PublicKey(toAddress); // Validate address
    } catch {
        showToast('Invalid Solana address', 'error');
        return;
    }
    
    showToast('Withdrawing all funds...', 'info');
    
    try {
        // Step 1: Withdraw from game balance to burner (if any)
        if (gameBalance > 0) {
            showToast('Withdrawing from game balance...', 'info');
            try {
                await withdrawGameBalance(gameBalance);
                await new Promise(r => setTimeout(r, 2000)); // Wait for confirmation
                await refreshBurnerBalance();
            } catch (withdrawErr) {
                if (withdrawErr.message?.includes('active races')) {
                    showToast('⚠️ Cannot withdraw game balance while in active races. Withdrawing burner balance only...', 'warning');
                    // Skip game balance, just withdraw burner
                } else {
                    throw withdrawErr;
                }
            }
        }
        
        // Step 2: Send from burner to external address
        const burnerBal = await getBurnerBalance();
        if (burnerBal < 0.001) {
            showToast('No funds to withdraw', 'error');
            return;
        }
        
        showToast('Sending to ' + toAddress.slice(0, 8) + '...', 'info');
        await withdrawFromBurner(toAddress, burnerBal);
        
        showToast('✅ Withdrawal complete!', 'success');
        await refreshBurnerBalance();
        await loadPlayerData();
        
    } catch (err) {
        console.error('Withdraw failed:', err);
        showToast('Withdraw failed: ' + (err.message || err), 'error');
    }
}

async function withdrawGameBalance(amount) {
    if (!burnerKeypair) return;
    
    const lamports = Math.floor(amount * 1e9);
    const playerPDA = getPlayerPDA(burnerKeypair.publicKey);
    const programId = new PublicKey(CONFIG.PROGRAM_ID);
    const gameState = new PublicKey(CONFIG.GAME_STATE_PDA);

    const data = new Uint8Array(9);
    data[0] = INSTRUCTIONS.WITHDRAW;
    const view = new DataView(data.buffer);
    view.setBigUint64(1, BigInt(lamports), true);

    const instruction = new TransactionInstruction({
        keys: [
            { pubkey: burnerKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: playerPDA, isSigner: false, isWritable: true },
            { pubkey: gameState, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId,
        data,
    });

    const transaction = new Transaction().add(instruction);
    transaction.feePayer = burnerKeypair.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    transaction.sign(burnerKeypair);
    
    try {
        const signature = await connection.sendRawTransaction(transaction.serialize());
        await connection.confirmTransaction(signature, 'confirmed');
    } catch (err) {
        // Check for "in a race" error
        const errStr = err.toString() + (err.logs ? err.logs.join(' ') : '');
        if (errStr.includes('Cannot withdraw while in a race') || errStr.includes('in a race')) {
            throw new Error('Cannot withdraw while in active races. Wait for your races to settle first, then try again.');
        }
        throw err;
    }
}

function showExportKey() {
    const key = exportBurnerKey();
    if (key) {
        if (confirm('⚠️ WARNING: Anyone with this key can access your burner wallet funds!\n\nCopy to clipboard?')) {
            navigator.clipboard.writeText(key);
            showToast('Private key copied! Keep it safe!', 'warning');
        }
    }
}

function generateNewBurner() {
    const currentBalance = burnerBalance || 0;
    
    let confirmMsg = '🔄 Generate New Game Wallet?\n\n';
    if (currentBalance > 0) {
        confirmMsg += `⚠️ WARNING: You have ${currentBalance.toFixed(4)} SOL in current wallet!\nWithdraw first or it will be lost.\n\n`;
    }
    confirmMsg += 'This creates a fresh wallet address.\nUseful if your current wallet is stuck.';
    
    if (!confirm(confirmMsg)) return;
    
    // Clear all burner data
    localStorage.removeItem('txrace_burner');
    const linkedWallet = localStorage.getItem('txrace_linked_wallet');
    if (linkedWallet) {
        localStorage.removeItem('txrace_burner_for_' + linkedWallet);
    }
    
    // Generate new burner
    burnerKeypair = null;
    generateBurnerWallet();
    
    // Reset game state
    currentRaceId = 0;
    gameBalance = 0;
    
    // Update UI
    updateBurnerUI();
    refreshBurnerBalance();
    loadPlayerData();
    
    showToast('🔥 New game wallet created!', 'success');
    
    // Show the new address
    const newAddr = burnerKeypair.publicKey.toString();
    alert('New Game Wallet:\n\n' + newAddr + '\n\nSend SOL to this address to play!');
}

function deleteBurnerConfirm() {
    getBurnerBalance().then(bal => {
        if (bal > 0.001) {
            if (!confirm(`⚠️ Your burner has ${bal.toFixed(4)} SOL!\n\nWithdraw first or funds will be LOST!\n\nDelete anyway?`)) {
                return;
            }
        }
        if (confirm('Are you sure you want to delete the burner wallet?')) {
            deleteBurnerWallet();
            updateBurnerUI();
        }
    });
}

// Load burner wallet on startup - MANDATORY for gameplay
function initBurnerWallet() {
    loadBurnerWallet();
    
    // Auto-create if no burner exists
    if (!burnerKeypair) {
        console.log('🔥 No burner wallet - creating one automatically...');
        generateBurnerWallet();
        showToast('🔥 Game wallet created! Connect your main wallet to link it.', 'success');
    }
    
    // Always use burner for gameplay
    useBurnerWallet = true;
    
    // Set the publicKey to burner for game operations
    publicKey = burnerKeypair.publicKey.toString();
    
    updateBurnerUI();
    refreshBurnerBalance();
    
    // Load player profile
    loadMyProfile();
    
    // Show balance display
    document.getElementById('balanceDisplay')?.classList.remove('hidden');
    
    // Load player data for the burner wallet
    loadPlayerData();
    
    // Check if main wallet is already connected
    const linkedWallet = localStorage.getItem('txrace_linked_wallet');
    if (linkedWallet) {
        updateConnectButton(linkedWallet);
    }
}

// Link burner wallet to main wallet for identity/recovery
function linkBurnerToMainWallet(mainWalletAddress) {
    localStorage.setItem('txrace_linked_wallet', mainWalletAddress);
    localStorage.setItem('txrace_burner_for_' + mainWalletAddress, bs58.encode(burnerKeypair.secretKey));
    console.log('🔗 Linked burner to main wallet:', mainWalletAddress);
}

// Recover burner from main wallet
function recoverBurnerFromMainWallet(mainWalletAddress) {
    const storedKey = localStorage.getItem('txrace_burner_for_' + mainWalletAddress);
    if (storedKey) {
        try {
            const secretKey = bs58.decode(storedKey);
            burnerKeypair = Keypair.fromSecretKey(secretKey);
            localStorage.setItem('txrace_burner_key', storedKey);
            publicKey = burnerKeypair.publicKey.toString();
            console.log('🔄 Recovered burner for wallet:', mainWalletAddress);
            return true;
        } catch (e) {
            console.error('Failed to recover burner:', e);
        }
    }
    return false;
}

function updateConnectButton(walletAddress) {
    const btn = document.getElementById('connectBtn');
    if (btn && walletAddress) {
        btn.textContent = walletAddress.slice(0, 4) + '...' + walletAddress.slice(-4);
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        btn.onclick = () => showSettings();
    }
}

// ============= CONFIGURATION =============
const CONFIG = {
    DEFAULT_RPC_URL: 'https://rpc.whistle.ninja',
    WS_URL: 'wss://fun.whistle.ninja/ws', // WebSocket server for real-time updates
    PROFILES_API: 'https://fun.whistle.ninja/api', // Profiles API
    PROGRAM_ID: 'H5XrfmdaXNuzd74SBDA6nhVVFSMEDVPQVtpoBHR378jv',
    GAME_STATE_PDA: 'GVa4swJpR2Tuqw1Q5VehtSt6fP3GjWyBet3HV8vDt9Ya',
    AUTHORITY: '6BNdVMgx2JZJPvkRCLyV2LLxft4S1cwuqoX2BS9eFyvh',
    HOUSE_VAULT: '6BNdVMgx2JZJPvkRCLyV2LLxft4S1cwuqoX2BS9eFyvh',
    HOUSE_FEE: 0.05, // 5%
    RACE_TIERS: [0.01, 0.05, 0.1, 0.5, 1],
    MAX_PLAYERS: 10,
};

// Available avatars
const AVATARS = [
    '🏎️', '🚀', '⚡', '🔥', '💎', '🎮', '👾', '🤖', 
    '🦊', '🐺', '🦁', '🐯', '🦅', '🐉', '🦈', '🐙',
    '💀', '👻', '🎃', '🌟', '☄️', '🌙', '🌈', '⭐',
    '🗡️', '🛡️', '⚔️', '🏆', '🥇', '💰', '💵', '🎯'
];

// Player profiles cache
let playerProfiles = {};
let myProfile = { name: null, avatar: '🏎️' };

// Profile functions
async function loadMyProfile() {
    if (!burnerKeypair) return;
    const wallet = burnerKeypair.publicKey.toString();
    try {
        const res = await fetch(`${CONFIG.PROFILES_API}/profile/${wallet}`);
        if (res.ok) {
            myProfile = await res.json();
            // Also check localStorage for local override
            const localProfile = localStorage.getItem('txrace_profile');
            if (localProfile) {
                const local = JSON.parse(localProfile);
                myProfile = { ...myProfile, ...local };
            }
        }
    } catch (e) {
        console.log('Failed to load profile, using local');
        const localProfile = localStorage.getItem('txrace_profile');
        if (localProfile) myProfile = JSON.parse(localProfile);
    }
    updateProfileDisplay();
}

async function saveMyProfile(name, avatar) {
    if (!burnerKeypair) return;
    const wallet = burnerKeypair.publicKey.toString();
    
    // Save locally first
    myProfile = { ...myProfile, name, avatar };
    localStorage.setItem('txrace_profile', JSON.stringify(myProfile));
    
    // Try to save to server
    try {
        const res = await fetch(`${CONFIG.PROFILES_API}/profile/${wallet}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, avatar })
        });
        if (res.ok) {
            myProfile = await res.json();
            showToast('Profile saved!', 'success');
        } else {
            const err = await res.json();
            showToast(err.error || 'Failed to save profile', 'error');
        }
    } catch (e) {
        showToast('Profile saved locally', 'info');
    }
    updateProfileDisplay();
}

async function fetchPlayerProfiles(wallets) {
    try {
        const res = await fetch(`${CONFIG.PROFILES_API}/profiles/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallets })
        });
        if (res.ok) {
            const profiles = await res.json();
            playerProfiles = { ...playerProfiles, ...profiles };
        }
    } catch (e) {
        // Use cache or defaults
    }
    return playerProfiles;
}

function getPlayerDisplay(walletAddr) {
    // Check if it's the current user's wallet
    const myWallet = burnerKeypair ? burnerKeypair.publicKey.toString() : publicKey;
    if (walletAddr === myWallet) {
        return {
            avatar: myProfile.avatar || '🏎️',
            name: myProfile.name || walletAddr.slice(0, 4) + '...' + walletAddr.slice(-4),
            isNamed: !!myProfile.name
        };
    }
    
    const profile = playerProfiles[walletAddr] || {};
    const shortAddr = walletAddr.slice(0, 4) + '...' + walletAddr.slice(-4);
    return {
        avatar: profile.avatar || '🏎️',
        name: profile.name || shortAddr,
        isNamed: !!profile.name
    };
}

function updateProfileDisplay() {
    const avatarEl = document.getElementById('myAvatar');
    const nameEl = document.getElementById('myName');
    if (avatarEl) avatarEl.textContent = myProfile.avatar || '🏎️';
    if (nameEl) nameEl.textContent = myProfile.name || 'Set Name';
}

function showProfileEditor() {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'profileModal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
            <h2 style="margin-bottom: 1rem; text-align: center;">🎮 Your Race Profile</h2>
            
            <div style="text-align: center; margin-bottom: 1.5rem;">
                <div id="profilePreviewAvatar" style="font-size: 5rem; margin-bottom: 0.5rem;">${myProfile.avatar || '🏎️'}</div>
                <div id="profilePreviewName" style="font-size: 1.5rem; font-weight: bold; color: var(--accent);">${myProfile.name || 'Anonymous Racer'}</div>
            </div>
            
            <div style="margin-bottom: 1.5rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Choose Avatar:</label>
                <div id="avatarGrid" style="display: grid; grid-template-columns: repeat(8, 1fr); gap: 0.5rem;">
                    ${AVATARS.map(a => `
                        <button class="avatar-btn ${a === myProfile.avatar ? 'selected' : ''}" 
                                onclick="selectAvatar('${a}')"
                                style="font-size: 1.5rem; padding: 0.5rem; background: ${a === myProfile.avatar ? 'var(--accent)' : 'rgba(255,255,255,0.1)'}; border: 2px solid ${a === myProfile.avatar ? 'var(--accent)' : 'transparent'}; border-radius: 8px; cursor: pointer;">
                            ${a}
                        </button>
                    `).join('')}
                </div>
            </div>
            
            <div style="margin-bottom: 1.5rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Display Name:</label>
                <input type="text" id="profileNameInput" value="${myProfile.name || ''}" 
                       placeholder="2-16 chars, letters/numbers/_/-" 
                       maxlength="16"
                       style="width: 100%; padding: 0.75rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 1rem;"
                       onkeyup="updateProfilePreview()">
                <p style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.25rem;">Leave empty to use wallet address</p>
            </div>
            
            <div style="display: flex; gap: 1rem;">
                <button class="btn btn-secondary" style="flex: 1;" onclick="document.getElementById('profileModal').remove()">Cancel</button>
                <button class="btn btn-primary" style="flex: 1;" onclick="saveProfile()">Save Profile</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

let selectedAvatar = myProfile.avatar || '🏎️';

function selectAvatar(avatar) {
    selectedAvatar = avatar;
    document.getElementById('profilePreviewAvatar').textContent = avatar;
    document.querySelectorAll('.avatar-btn').forEach(btn => {
        btn.style.background = btn.textContent.trim() === avatar ? 'var(--accent)' : 'rgba(255,255,255,0.1)';
        btn.style.borderColor = btn.textContent.trim() === avatar ? 'var(--accent)' : 'transparent';
    });
}

function updateProfilePreview() {
    const name = document.getElementById('profileNameInput')?.value || 'Anonymous Racer';
    document.getElementById('profilePreviewName').textContent = name || 'Anonymous Racer';
}

async function saveProfile() {
    const name = document.getElementById('profileNameInput')?.value?.trim() || null;
    await saveMyProfile(name, selectedAvatar);
    document.getElementById('profileModal')?.remove();
}

// ============= CUSTOM RPC =============
function getRpcUrl() {
    const customRpc = localStorage.getItem('txrace_custom_rpc');
    return customRpc || CONFIG.DEFAULT_RPC_URL;
}

function setCustomRpc(url) {
    if (url && url.trim()) {
        localStorage.setItem('txrace_custom_rpc', url.trim());
    } else {
        localStorage.removeItem('txrace_custom_rpc');
    }
    // Reinitialize connection
    connection = new Connection(getRpcUrl(), 'confirmed');
    updateRpcDisplay();
    showToast('RPC updated: ' + (url ? 'Custom' : 'Default'), 'success');
}

function updateRpcDisplay() {
    const rpcDisplay = document.getElementById('currentRpcDisplay');
    const rpcInput = document.getElementById('customRpcInput');
    const settingsRpc = document.getElementById('settingsCurrentRpc');
    const customRpc = localStorage.getItem('txrace_custom_rpc');
    if (rpcDisplay) {
        rpcDisplay.textContent = customRpc ? '(Custom)' : '';
        rpcDisplay.style.color = customRpc ? '#00ff88' : 'var(--text-dim)';
    }
    if (rpcInput) {
        rpcInput.value = customRpc || '';
    }
    if (settingsRpc) {
        settingsRpc.textContent = getRpcUrl();
    }
}

function showSettings() {
    updateRpcDisplay();
    document.getElementById('settingsModal').classList.add('active');
}

// ============= STATE =============
let wallet = null;
let publicKey = null;
let connection = null;
let ws = null;
let gameBalance = 0;
let burnerBalance = 0;
let currentRace = null;
let playerStats = { races: 0, wins: 0, profit: 0 };
let myRaceEntry = null; // Store local player's TX slot data
let profileCache = {}; // Cache profiles for avatars

// Mock data for development (replace with real data from server)
let races = [];
let leaderboard = [];

// ============= PDA HELPERS =============
function getGameStatePDA() {
    const programId = new PublicKey(CONFIG.PROGRAM_ID);
    const [pda] = PublicKey.findProgramAddressSync(
        [BufferPolyfill.from('game_state')],
        programId
    );
    return pda;
}

function getPlayerPDA(walletPubkey) {
    const programId = new PublicKey(CONFIG.PROGRAM_ID);
    const [pda] = PublicKey.findProgramAddressSync(
        [BufferPolyfill.from('player'), walletPubkey.toBytes()],
        programId
    );
    return pda;
}

function getRacePDA(raceId) {
    const programId = new PublicKey(CONFIG.PROGRAM_ID);
    const raceIdBuffer = new Uint8Array(8);
    const view = new DataView(raceIdBuffer.buffer);
    view.setBigUint64(0, BigInt(raceId), true); // true = little endian
    const [pda] = PublicKey.findProgramAddressSync(
        [BufferPolyfill.from('race'), raceIdBuffer],
        programId
    );
    return pda;
}

// ============= CONTRACT INSTRUCTIONS =============
// Simple instruction indices (Native Solana program, not Anchor)
const INSTRUCTIONS = {
    INITIALIZE: 0,
    DEPOSIT: 1,
    WITHDRAW: 2,
    CREATE_RACE: 3,
    JOIN_RACE: 4,
    LEAVE_RACE: 5,
    START_RACE: 6,
    RACE_ENTRY: 7,
    SETTLE_RACE: 8,
    CANCEL_RACE: 9,
    UPDATE_HOUSE_FEE: 10,
    TRANSFER_AUTHORITY: 11,
    CLEAR_RACE_STATUS: 12,
    FORCE_FINISH_RACE: 13,
};

// RaceStatus enum
const RaceStatus = {
    Open: 0,
    Countdown: 1,
    Live: 2,
    Finished: 3,
    Settled: 4,
    Cancelled: 5,
};

// Helper to build Anchor instruction data
function buildInstructionData(discriminator, ...args) {
    // Calculate total size: 8 (discriminator) + args
    let size = 8;
    for (const arg of args) {
        size += arg.length;
    }
    
    const data = new Uint8Array(size);
    data.set(discriminator, 0);
    
    let offset = 8;
    for (const arg of args) {
        data.set(arg, offset);
        offset += arg.length;
    }
    
    return data;
}

// Helper to encode u64 as little-endian bytes
function encodeU64(value) {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);
    view.setBigUint64(0, BigInt(value), true);
    return buffer;
}

// Helper to encode u16 as little-endian bytes
function encodeU16(value) {
    const buffer = new Uint8Array(2);
    const view = new DataView(buffer.buffer);
    view.setUint16(0, value, true);
    return buffer;
}

// Helper to encode u8
function encodeU8(value) {
    return new Uint8Array([value]);
}

// ============= CREATE RACE (Anyone can create - earn 5% of pot!) =============
async function createRace(entryFeeSol, maxPlayers) {
    if (!burnerKeypair) {
        showToast('Game wallet not ready', 'error');
        return;
    }

    if (entryFeeSol < 0.001) {
        showToast('Minimum entry fee is 0.001 SOL', 'error');
        return;
    }

    if (maxPlayers < 2 || maxPlayers > 20) {
        showToast('Players must be between 2-20', 'error');
        return;
    }

    // Check burner has enough SOL for rent
    const burnerBal = await getBurnerBalance();
    if (burnerBal < 0.01) {
        showToast('Need at least 0.01 SOL to create a race', 'error');
        showSettings();
        return;
    }

    try {
        showToast('Creating race... (You earn 5% of prize pool!)', 'success');

        // Get next race ID from GameState
        const gameState = await fetchGameState();
        const raceId = (gameState?.totalRaces || 0) + 1;

        const programId = new PublicKey(CONFIG.PROGRAM_ID);
        const gameStatePDA = getGameStatePDA();
        const racePDA = getRacePDA(raceId);
        const entryFeeLamports = Math.floor(entryFeeSol * 1e9);

        // Build createRace instruction: [instruction_index(1), raceId(8), entryFee(8), maxPlayers(1)]
        const data = new Uint8Array(18);
        data[0] = INSTRUCTIONS.CREATE_RACE;
        const dataView = new DataView(data.buffer);
        dataView.setBigUint64(1, BigInt(raceId), true);
        dataView.setBigUint64(9, BigInt(entryFeeLamports), true);
        data[17] = maxPlayers;

        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: burnerKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: gameStatePDA, isSigner: false, isWritable: true },
                { pubkey: racePDA, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const transaction = new Transaction().add(instruction);
        transaction.feePayer = burnerKeypair.publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        // Sign with burner - NO POPUP!
        transaction.sign(burnerKeypair);
        const signature = await connection.sendRawTransaction(transaction.serialize());
        await connection.confirmTransaction(signature, 'confirmed');
        
        showToast('Race #' + raceId + ' created! Joining...', 'success');
        closeModals();
        
        // Refresh races first
        await loadGameData();
        
        // Auto-join the race we just created
        await joinRace(raceId);
        
    } catch (err) {
        console.error('Create race failed:', err);
        showToast('Failed to create race: ' + (err.message || err), 'error');
    }
}

function showCreateRaceModal() {
    document.getElementById('createRaceModal').classList.add('active');
    // Reset button state
    const btn = document.getElementById('createRaceBtn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Create Race';
    }
}

async function handleCreateRace() {
    const btn = document.getElementById('createRaceBtn');
    const cancelBtn = document.getElementById('createRaceCancelBtn');
    const entryFee = parseFloat(document.getElementById('createRaceEntryFee').value);
    const maxPlayers = parseInt(document.getElementById('createRaceMaxPlayers').value);
    
    // Disable buttons and show loading
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span style="animation: pulse 1s infinite;">Creating...</span>';
    }
    if (cancelBtn) cancelBtn.disabled = true;
    
    try {
        await createRace(entryFee, maxPlayers);
    } finally {
        // Re-enable buttons
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Create Race';
        }
        if (cancelBtn) cancelBtn.disabled = false;
    }
}

// Leave a race (before it starts)
async function leaveRaceTransaction(raceId) {
    if (!burnerKeypair) {
        showToast('Game wallet not ready', 'error');
        return;
    }
    
    try {
        showToast('Leaving race...', 'success');

        const programId = new PublicKey(CONFIG.PROGRAM_ID);
        const playerPDA = getPlayerPDA(burnerKeypair.publicKey);
        const racePDA = getRacePDA(raceId);
        const gameStatePDA = getGameStatePDA();

        // Build leaveRace instruction: [index(1), raceId(8)]
        const data = new Uint8Array(9);
        data[0] = INSTRUCTIONS.LEAVE_RACE;
        const view = new DataView(data.buffer);
        view.setBigUint64(1, BigInt(raceId), true);

        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: burnerKeypair.publicKey, isSigner: true, isWritable: false },
                { pubkey: playerPDA, isSigner: false, isWritable: true },
                { pubkey: racePDA, isSigner: false, isWritable: true },
                { pubkey: gameStatePDA, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const transaction = new Transaction().add(instruction);
        transaction.feePayer = burnerKeypair.publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        // Sign with burner - NO POPUP!
        transaction.sign(burnerKeypair);
        const signature = await connection.sendRawTransaction(transaction.serialize());
        await connection.confirmTransaction(signature, 'confirmed');

        showToast('Left race! Checking refund...', 'info');
        currentRaceId = 0;
        
        // Wait a moment for blockchain to update
        await new Promise(r => setTimeout(r, 1500));
        
        // Refresh player data and balance
        await loadPlayerData();
        await refreshBurnerBalance();
        
        // Show refund confirmation with withdraw reminder
        showToast(`✅ Refunded to game balance: ${gameBalance.toFixed(4)} SOL`, 'success');
        
        // Show reminder about withdrawal
        setTimeout(() => {
            showToast('💡 Use Settings → Withdraw to move funds to your wallet', 'info');
        }, 2000);
        
        closeModals();
        backToLobby();
        
    } catch (err) {
        console.error('Leave race failed:', err);
        const errStr = err.toString() + (err.logs ? err.logs.join(' ') : '');
        if (errStr.includes('RaceNotOpen') || errStr.includes('not open')) {
            showToast('Cannot leave - race has started or is not open', 'error');
        } else if (errStr.includes('NotInRace')) {
            showToast('You are not in this race', 'error');
        } else {
            showToast('Failed to leave: ' + (err.message || err), 'error');
        }
    }
}

// Clear race status (if stuck in a race - race must be Settled/Cancelled)
async function clearRaceStatus(raceId) {
    if (!burnerKeypair) {
        showToast('Game wallet not ready', 'error');
        return;
    }
    
    // Check race status first
    try {
        const raceData = await fetchRaceAccount(raceId);
        if (raceData) {
            console.log('Race status:', raceData.status, '(4=Settled, 5=Cancelled)');
            if (raceData.status !== RaceStatus.Settled && raceData.status !== RaceStatus.Cancelled) {
                showToast('Race must be Settled or Cancelled first. Current status: ' + 
                    ['Open', 'Countdown', 'Live', 'Finished', 'Settled', 'Cancelled'][raceData.status], 'error');
                return;
            }
        }
    } catch (e) {
        console.error('Failed to check race:', e);
    }
    
    try {
        showToast('Clearing race status...', 'success');

        const programId = new PublicKey(CONFIG.PROGRAM_ID);
        const playerPDA = getPlayerPDA(burnerKeypair.publicKey);
        const racePDA = getRacePDA(raceId);

        // Build clearRaceStatus instruction: [index(1), raceId(8)]
        const data = new Uint8Array(9);
        data[0] = INSTRUCTIONS.CLEAR_RACE_STATUS;
        const view = new DataView(data.buffer);
        view.setBigUint64(1, BigInt(raceId), true);

        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: burnerKeypair.publicKey, isSigner: true, isWritable: false },
                { pubkey: playerPDA, isSigner: false, isWritable: true },
                { pubkey: racePDA, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const transaction = new Transaction().add(instruction);
        transaction.feePayer = burnerKeypair.publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        // Sign with burner - NO POPUP!
        transaction.sign(burnerKeypair);
        const signature = await connection.sendRawTransaction(transaction.serialize());
        await connection.confirmTransaction(signature, 'confirmed');

        showToast('Race status cleared!', 'success');
        currentRaceId = 0;
        await loadPlayerData();
        closeModals();
        updateWithdrawButton();
        
    } catch (err) {
        console.error('Clear race status failed:', err);
        showToast('Failed: ' + (err.message || err), 'error');
    }
}

// Show admin panel - no longer needed, all users can create races
function showAdminPanel() {
    // All users can create races via the Create Race button
}

async function fetchGameState() {
    try {
        const gameStatePDA = getGameStatePDA();
        const accountInfo = await connection.getAccountInfo(gameStatePDA);

        if (!accountInfo) return null;

        const data = new Uint8Array(accountInfo.data);
        const view = new DataView(data.buffer);

        // GameState layout from IDL:
        // discriminator(8) + authority(32) + houseFeeBps(2) + totalRaces(8) + totalVolume(8) + totalFeesCollected(8) + houseVault(32) + bump(1) + isInitialized(1)
        return {
            authority: new PublicKey(data.slice(8, 40)).toString(),
            houseFeeBps: view.getUint16(40, true),
            totalRaces: Number(view.getBigUint64(42, true)),
            totalVolume: Number(view.getBigUint64(50, true)) / 1e9,
            totalFeesCollected: Number(view.getBigUint64(58, true)) / 1e9,
            houseVault: new PublicKey(data.slice(66, 98)).toString(),
            bump: data[98],
            isInitialized: data[99] === 1,
        };
    } catch (e) {
        console.error('Failed to fetch game state:', e);
        return null;
    }
}


async function fetchPlayerAccount(walletPubkey) {
    try {
        const playerPDA = getPlayerPDA(new PublicKey(walletPubkey));
        const accountInfo = await connection.getAccountInfo(playerPDA);
        
        if (!accountInfo) return null;
        
        const data = new Uint8Array(accountInfo.data);
        const view = new DataView(data.buffer);
        
        // PlayerAccount layout from IDL:
        // discriminator(8) + owner(32) + balance(8) + racesPlayed(4) + racesWon(4) + totalWinnings(8) + totalWagered(8) + totalDeposited(8) + totalWithdrawn(8) + bump(1) + isInitialized(1) + currentRaceId(8)
        return {
            owner: new PublicKey(data.slice(8, 40)).toString(),
            balance: Number(view.getBigUint64(40, true)) / 1e9,
            racesPlayed: view.getUint32(48, true),
            racesWon: view.getUint32(52, true),
            totalWinnings: Number(view.getBigUint64(56, true)) / 1e9,
            totalWagered: Number(view.getBigUint64(64, true)) / 1e9,
            totalDeposited: Number(view.getBigUint64(72, true)) / 1e9,
            totalWithdrawn: Number(view.getBigUint64(80, true)) / 1e9,
            bump: data[88],
            isInitialized: data[89] === 1,
            currentRaceId: Number(view.getBigUint64(90, true)),
        };
    } catch (e) {
        console.error('Failed to fetch player account:', e);
        return null;
    }
}

async function fetchRaceAccount(raceId) {
    try {
        const racePDA = getRacePDA(raceId);
        console.log('Fetching race', raceId, 'at PDA:', racePDA.toString());
        
        const accountInfo = await connection.getAccountInfo(racePDA);
        
        if (!accountInfo) {
            console.log('Race', raceId, 'account not found at', racePDA.toString());
            return null;
        }
        
        console.log('Race', raceId, 'account found, size:', accountInfo.data.length);
        
        const data = new Uint8Array(accountInfo.data);
        const view = new DataView(data.buffer);
        
        // Race layout from IDL:
        // discriminator(8) + id(8) + entryFee(8) + maxPlayers(1) + playerCount(1) + players(20*32=640) + status(1) + targetSlot(8) + prizePool(8) + winner(32) + winnerSlot(8) + winnerTxIndex(4) + createdAt(8) + startedAt(8) + finishedAt(8) + bump(1) + isInitialized(1)
        
        const raceIdFromData = Number(view.getBigUint64(8, true));
        const entryFee = Number(view.getBigUint64(16, true)) / 1e9;
        const maxPlayers = data[24];
        const playerCount = data[25];
        const status = data[666]; // After players array (26 + 640)
        
        console.log('Race', raceId, 'parsed: id=', raceIdFromData, 'entryFee=', entryFee, 'maxPlayers=', maxPlayers, 'playerCount=', playerCount, 'status=', status);
        
        // Parse players array
        const players = [];
        for (let i = 0; i < playerCount; i++) {
            const playerStart = 26 + (i * 32);
            const playerPubkey = new PublicKey(data.slice(playerStart, playerStart + 32));
            if (!playerPubkey.equals(PublicKey.default)) {
                players.push(playerPubkey.toString());
            }
        }
        
        // Creator is stored at offset 753 (in reserved area after contract update)
        // If not set, use authority as fallback
        let creator;
        try {
            const creatorBytes = data.slice(753, 785);
            const creatorPubkey = new PublicKey(creatorBytes);
            creator = creatorPubkey.equals(PublicKey.default) ? CONFIG.AUTHORITY : creatorPubkey.toString();
        } catch {
            creator = CONFIG.AUTHORITY;
        }
        
        return {
            id: raceIdFromData,
            entryFee,
            maxPlayers,
            playerCount,
            players,
            status,
            targetSlot: Number(view.getBigUint64(667, true)),
            prizePool: Number(view.getBigUint64(675, true)) / 1e9,
            winner: new PublicKey(data.slice(683, 715)).toString(),
            winnerSlot: Number(view.getBigUint64(715, true)),
            winnerTxIndex: view.getUint32(723, true),
            createdAt: Number(view.getBigInt64(727, true)),
            creator,
            startedAt: Number(view.getBigInt64(735, true)),
            finishedAt: Number(view.getBigInt64(743, true)),
            bump: data[751],
            isInitialized: data[752] === 1,
            pubkey: racePDA.toString(),
        };
    } catch (e) {
        console.error('Failed to fetch race account:', e);
        return null;
    }
}

// ============= INITIALIZATION =============
document.addEventListener('DOMContentLoaded', () => {
    connection = new Connection(getRpcUrl(), 'confirmed');
    updateRpcDisplay();

    // Initialize burner wallet if exists
    initBurnerWallet();

    loadGameData();

    // Check if wallet is already connected
    if (window.solana?.isConnected) {
        handleWalletConnect();
    }

    // Refresh data periodically
    setInterval(refreshRaces, 5000);
    
    // Refresh burner balance periodically
    setInterval(refreshBurnerBalance, 10000);
    
    // Handle URL race parameter (shared links)
    handleUrlRace();
});

// ============= WALLET =============
async function connectWallet() {
    try {
        if (!window.solana) {
            showToast('Please install Phantom wallet', 'error');
            return;
        }

        const resp = await window.solana.connect();
        wallet = window.solana;
        const mainWalletAddress = resp.publicKey.toString();

        // Check if we should recover an existing burner for this wallet
        if (recoverBurnerFromMainWallet(mainWalletAddress)) {
            showToast('🔄 Recovered your game wallet!', 'success');
        } else {
            // Link current burner to this main wallet
            linkBurnerToMainWallet(mainWalletAddress);
            showToast('🔗 Game wallet linked to ' + mainWalletAddress.slice(0, 4) + '...', 'success');
        }
        
        // Keep publicKey as burner for gameplay
        publicKey = burnerKeypair.publicKey.toString();
        
        handleWalletConnect(mainWalletAddress);

    } catch (err) {
        console.error('Wallet connection failed:', err);
        showToast('Failed to connect wallet', 'error');
    }
}

function handleWalletConnect(mainWalletAddress) {
    document.getElementById('welcomeScreen').style.display = 'none';
    document.getElementById('gameScreen').classList.add('active');
    document.getElementById('balanceDisplay').classList.remove('hidden');
    
    // Show main wallet address on button
    updateConnectButton(mainWalletAddress);

    // Keep using burner publicKey for game data
    loadPlayerData();
    refreshBurnerBalance();
    updateBurnerUI();
    connectWebSocket();
    
    // Show game wallet address immediately for funding
    showFundingPrompt();
}

function showFundingPrompt() {
    if (!burnerKeypair) return;
    
    const gameWalletAddress = burnerKeypair.publicKey.toString();
    
    // Create funding prompt modal
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'fundingPromptModal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px; text-align: center;">
            <h2 style="color: #ff6600; margin-bottom: 1rem;">🔥 Your Game Wallet</h2>
            <p style="color: var(--text-dim); margin-bottom: 1.5rem;">Send SOL to this address to start playing (no popups during gameplay!)</p>
            
            <div style="padding: 1.5rem; background: linear-gradient(135deg, rgba(255,102,0,0.2), rgba(255,102,0,0.05)); border: 2px solid #ff6600; border-radius: 12px; margin-bottom: 1.5rem;">
                <p style="font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; word-break: break-all; cursor: pointer; padding: 1rem; background: rgba(0,0,0,0.4); border-radius: 8px;" onclick="copyBurnerAddress(); showToast('Address copied!', 'success');">${gameWalletAddress}</p>
                <p style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.5rem;">👆 Click to copy</p>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                <button class="btn btn-primary" onclick="fundFromMainWallet(); document.getElementById('fundingPromptModal').remove();">
                    💰 Fund from Phantom
                </button>
                <button class="btn btn-secondary" onclick="copyBurnerAddress(); showToast('Address copied! Send SOL from any wallet.', 'success');">
                    📋 Copy Address
                </button>
            </div>
            
            <button class="btn btn-secondary" onclick="document.getElementById('fundingPromptModal').remove();" style="width: 100%;">
                Skip for now
            </button>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// ============= WEBSOCKET =============
function connectWebSocket() {
    // For development, we'll use polling instead of WebSocket
    // Uncomment below when WebSocket server is ready
    
    /*
    ws = new WebSocket(CONFIG.WS_URL);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        ws.send(JSON.stringify({ type: 'auth', wallet: publicKey }));
    };
    
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        setTimeout(connectWebSocket, 3000);
    };
    */
}

function handleServerMessage(msg) {
    switch (msg.type) {
        case 'race_created':
            races.push(msg.race);
            renderRaces();
            break;
            
        case 'race_updated':
            updateRace(msg.race);
            break;
            
        case 'player_joined':
            if (currentRace && currentRace.id === msg.raceId) {
                currentRace.players.push(msg.player);
                renderCurrentRace();
            }
            break;
            
        case 'countdown':
            if (currentRace && currentRace.id === msg.raceId) {
                startCountdown(msg.targetSlot, msg.seconds);
            }
            break;
            
        case 'go':
            if (currentRace && currentRace.id === msg.raceId) {
                triggerGo();
            }
            break;
            
        case 'race_finished':
            if (currentRace && currentRace.id === msg.raceId) {
                showResults(msg.results, msg.winner);
            }
            break;
            
        case 'balance_update':
            gameBalance = msg.balance;
            updateBalanceDisplay();
            break;
    }
}

// ============= PLAYER DATA =============
let currentRaceId = 0; // Track if player is in a race

async function loadPlayerData() {
    try {
        const playerAccount = await fetchPlayerAccount(publicKey);
        
        if (playerAccount) {
            gameBalance = playerAccount.balance;
            playerStats = {
                races: playerAccount.racesPlayed,
                wins: playerAccount.racesWon,
                profit: playerAccount.totalWinnings - playerAccount.totalWagered,
            };
            currentRaceId = playerAccount.currentRaceId || 0;
            
            console.log('Player loaded: balance=', gameBalance, 'currentRaceId=', currentRaceId);
            
            // If player is in a race, show that race automatically
            if (currentRaceId > 0) {
                const raceData = await fetchRaceAccount(currentRaceId);
                if (raceData && (raceData.status === RaceStatus.Open || 
                                 raceData.status === RaceStatus.Countdown || 
                                 raceData.status === RaceStatus.Live)) {
                    // Player is in an active race - show it
                    currentRace = {
                        id: raceData.id,
                        raceId: currentRaceId,
                        entryFee: raceData.entryFee,
                        maxPlayers: raceData.maxPlayers,
                        players: raceData.players.map(p => p.slice(0, 4) + '...' + p.slice(-4)),
                        pool: raceData.prizePool,
                        status: ['open', 'countdown', 'live', 'finished', 'settled', 'cancelled'][raceData.status],
                        pubkey: raceData.pubkey,
                        creator: raceData.creator || CONFIG.AUTHORITY,
                    };
                    showRaceView();
                    startRacePolling(currentRaceId);
                    showToast('Rejoined race #' + currentRaceId, 'success');
                }
            }
        } else {
            // Player has no account yet (needs to deposit first)
            gameBalance = 0;
            playerStats = { races: 0, wins: 0, profit: 0 };
            currentRaceId = 0;
        }
    } catch (e) {
        console.error('Failed to load player data:', e);
        gameBalance = 0;
        playerStats = { races: 0, wins: 0, profit: 0 };
        currentRaceId = 0;
    }
    
    updateBalanceDisplay();
    updateStatsDisplay();
    updateWithdrawButton();
}

function updateBalanceDisplay() {
    const gameBalanceEl = document.getElementById('gameBalance');
    if (gameBalanceEl) {
        gameBalanceEl.textContent = gameBalance.toFixed(4) + ' SOL';
    }
    // Show max withdrawable (minus tx fee buffer)
    const maxWithdraw = Math.max(0, gameBalance - 0.001);
    const withdrawAvailEl = document.getElementById('withdrawAvailable');
    if (withdrawAvailEl) {
        withdrawAvailEl.textContent = maxWithdraw.toFixed(4);
    }
    // Also update header balance
    const headerBalance = document.getElementById('headerBurnerBalance');
    if (headerBalance) {
        headerBalance.textContent = (burnerBalance || 0).toFixed(4) + ' SOL';
    }
    // Update settings modal game balance
    updateSettingsGameBalance();
}

function setMaxWithdraw() {
    const maxWithdraw = Math.max(0, gameBalance - 0.001);
    document.getElementById('withdrawAmount').value = maxWithdraw.toFixed(4);
}

async function updateWithdrawButton() {
    const withdrawBtn = document.querySelector('#withdrawModal .btn-primary');
    let withdrawNote = document.getElementById('withdrawNote');
    
    if (currentRaceId > 0) {
        // Player is in a race - disable withdraw
        if (withdrawBtn) {
            withdrawBtn.disabled = true;
            withdrawBtn.textContent = 'In Race #' + currentRaceId;
        }
        
        // Check race status to show appropriate action
        let raceStatus = 0;
        try {
            const raceData = await fetchRaceAccount(currentRaceId);
            if (raceData) raceStatus = raceData.status;
        } catch (e) {}
        
        // Remove old note
        if (withdrawNote) withdrawNote.remove();
        
        // Show appropriate action
        const noteDiv = document.createElement('div');
        noteDiv.id = 'withdrawNote';
        noteDiv.style.cssText = 'margin-top: 1rem; padding: 0.75rem; background: rgba(255,170,0,0.1); border: 1px solid var(--warning); border-radius: 6px; font-size: 0.85rem;';
        
        if (raceStatus === RaceStatus.Open) {
            noteDiv.innerHTML = `
                <p style="color: var(--warning); margin-bottom: 0.5rem;">⚠️ In race #${currentRaceId} (Open)</p>
                <button class="btn btn-secondary btn-small" onclick="leaveRaceTransaction(${currentRaceId})" style="width: 100%;">Leave Race (Get Refund)</button>
            `;
        } else if (raceStatus === RaceStatus.Settled || raceStatus === RaceStatus.Cancelled) {
            noteDiv.innerHTML = `
                <p style="color: var(--warning); margin-bottom: 0.5rem;">⚠️ In race #${currentRaceId} (${raceStatus === 4 ? 'Settled' : 'Cancelled'})</p>
                <button class="btn btn-secondary btn-small" onclick="clearRaceStatus(${currentRaceId})" style="width: 100%;">Clear Race Status</button>
            `;
        } else {
            noteDiv.innerHTML = `
                <p style="color: var(--warning); margin-bottom: 0.5rem;">⚠️ In race #${currentRaceId} (${['Open','Countdown','Live','Finished','Settled','Cancelled'][raceStatus]})</p>
                <p style="color: var(--text-dim); font-size: 0.75rem;">Wait for race to finish or be cancelled.</p>
            `;
        }
        
        document.querySelector('#withdrawModal .deposit-input-group').appendChild(noteDiv);
    } else {
        // Not in race - enable withdraw
        if (withdrawBtn) {
            withdrawBtn.disabled = false;
            withdrawBtn.textContent = 'Withdraw';
        }
        if (withdrawNote) {
            withdrawNote.remove();
        }
    }
}

function updateStatsDisplay() {
    document.getElementById('userRaces').textContent = playerStats.races;
    document.getElementById('userWins').textContent = playerStats.wins;
    document.getElementById('userWinRate').textContent = playerStats.races > 0 
        ? Math.round(playerStats.wins / playerStats.races * 100) + '%' 
        : '0%';
    
    const profitEl = document.getElementById('userProfit');
    profitEl.textContent = (playerStats.profit >= 0 ? '+' : '') + playerStats.profit.toFixed(2);
    profitEl.classList.toggle('positive', playerStats.profit >= 0);
    profitEl.classList.toggle('negative', playerStats.profit < 0);
}

// ============= RACES =============
async function loadGameData() {
    // Set defaults immediately
    document.getElementById('statRaces').textContent = '0';
    document.getElementById('statPlayers').textContent = '0';
    races = [];
    leaderboard = [];

    try {
        // Fetch GameState for stats
        const gameState = await fetchGameState();
        if (gameState) {
            document.getElementById('statRaces').textContent = gameState.totalRaces.toString();
        }
        
        // Fetch active races and leaderboard
        await fetchActiveRaces();
        await fetchLeaderboard();
        
        // Update player count from leaderboard
        document.getElementById('statPlayers').textContent = leaderboard.length.toString();
        
    } catch (e) {
        console.error('Failed to load game data:', e);
    }
    
    renderRaces();
    renderLeaderboard();
}

async function fetchActiveRaces() {
    races = [];

    try {
        // First get totalRaces from GameState
        const gameState = await fetchGameState();
        const totalRaces = gameState ? Number(gameState.totalRaces) : 0;
        console.log('Total races from GameState:', totalRaces);
        
        // Fetch all races from 1 to totalRaces
        const raceIds = [];
        for (let i = 1; i <= Math.max(totalRaces, 10); i++) {
            raceIds.push(i);
        }
        
        for (const raceId of raceIds) {
            try {
                const raceData = await fetchRaceAccount(raceId);
                if (!raceData) {
                    console.log('Race', raceId, 'not found');
                    continue;
                }
                
                console.log('Race', raceId, 'status:', raceData.status, 'players:', raceData.playerCount);
                
                // Show open, countdown, and live races
                if (raceData.status === RaceStatus.Open || 
                    raceData.status === RaceStatus.Countdown ||
                    raceData.status === RaceStatus.Live) {
                    const statusName = ['open', 'countdown', 'live', 'finished', 'settled', 'cancelled'][raceData.status] || 'unknown';
                    races.push({
                        id: raceData.id,
                        entryFee: raceData.entryFee,
                        maxPlayers: raceData.maxPlayers,
                        players: raceData.players.map(p => p.slice(0, 4) + '...' + p.slice(-4)),
                        fullPlayers: raceData.players,
                        pool: raceData.prizePool,
                        status: statusName,
                        pubkey: raceData.pubkey,
                        creator: raceData.creator || CONFIG.AUTHORITY,
                        createdAt: raceData.createdAt,
                    });
                }
            } catch (e) {
                console.error('Failed to fetch race', raceId, e);
            }
        }
        
        // Sort by entry fee
        races.sort((a, b) => a.entryFee - b.entryFee);
        
        console.log('Total races loaded:', races.length, races);
        
        // Update welcome screen stats
        document.getElementById('statRaces').textContent = races.length.toString();
        
    } catch (e) {
        console.error('Failed to fetch races:', e);
    }
}

function timeAgo(timestamp) {
    if (!timestamp) return 'Just now';
    const seconds = Math.floor(Date.now() / 1000 - timestamp);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return Math.floor(seconds / 86400) + 'd ago';
}

function renderRaces() {
    const container = document.getElementById('raceList');
    
    console.log('Rendering races:', races.length);
    
    if (!container) {
        console.error('Race list container not found!');
        return;
    }
    
    if (races.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-dim);">No races available. Create one!</p>';
        return;
    }
    
    container.innerHTML = races.map(race => {
        const creatorShort = race.creator ? race.creator.slice(0, 4) + '...' + race.creator.slice(-4) : '???';
        const creatorProfile = profileCache[race.creator] || {};
        const creatorAvatar = creatorProfile.avatar || '🎮';
        const creatorName = creatorProfile.name || creatorShort;
        const timeStr = timeAgo(race.createdAt);
        
        // Get player avatars (first 5)
        const playerAvatars = (race.fullPlayers || []).slice(0, 5).map(p => {
            const profile = profileCache[p] || {};
            return profile.avatar || '👤';
        });
        
        return `
        <div class="race-item ${race.status}" style="cursor: pointer; padding: 0.75rem;" onclick="joinRace(${race.id})">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-size: 1.1rem; font-weight: bold; color: var(--accent);">#${race.id}</span>
                    <span style="font-weight: bold;">${race.entryFee} SOL</span>
                </div>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="color: ${race.players.length >= race.maxPlayers ? '#ff6600' : 'var(--accent)'}; font-weight: bold;">${race.players.length}/${race.maxPlayers}</span>
                    <button class="btn btn-small" onclick="event.stopPropagation(); shareRace(${race.id})" style="padding: 0.25rem 0.4rem; font-size: 0.75rem;">🔗</button>
                    <span class="race-status ${race.status}" style="padding: 0.25rem 0.5rem; font-size: 0.7rem;">${race.status.toUpperCase()}</span>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem; font-size: 0.75rem; color: var(--text-dim);">
                <span>${creatorAvatar}</span>
                <span>${creatorName}</span>
                <span style="opacity: 0.5;">•</span>
                <span>⏱️ ${timeStr}</span>
            </div>
        </div>
    `}).join('');
    
    console.log('Races rendered');
    
    // Fetch profiles for creators to update avatars
    fetchProfilesForRaces();
}

async function fetchProfilesForRaces() {
    const wallets = new Set();
    races.forEach(race => {
        if (race.creator) wallets.add(race.creator);
        (race.fullPlayers || []).forEach(p => wallets.add(p));
    });
    
    const toFetch = [...wallets].filter(w => !profileCache[w]);
    if (toFetch.length === 0) return;
    
    try {
        const res = await fetch(`${CONFIG.PROFILES_API}/profiles/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallets: toFetch })
        });
        if (res.ok) {
            const profiles = await res.json();
            Object.assign(profileCache, profiles);
            // Re-render with updated profiles
            renderRacesWithoutFetch();
        }
    } catch (e) {
        console.log('Could not fetch profiles for races');
    }
}

function renderRacesWithoutFetch() {
    const container = document.getElementById('raceList');
    if (!container || races.length === 0) return;
    
    container.innerHTML = races.map(race => {
        const creatorShort = race.creator ? race.creator.slice(0, 4) + '...' + race.creator.slice(-4) : '???';
        const creatorProfile = profileCache[race.creator] || {};
        const creatorAvatar = creatorProfile.avatar || '🎮';
        const creatorName = creatorProfile.name || creatorShort;
        const timeStr = timeAgo(race.createdAt);
        
        const playerAvatars = (race.fullPlayers || []).slice(0, 5).map(p => {
            const profile = profileCache[p] || {};
            return profile.avatar || '👤';
        });
        
        return `
        <div class="race-item ${race.status}" style="cursor: pointer; padding: 0.75rem;" onclick="joinRace(${race.id})">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-size: 1.1rem; font-weight: bold; color: var(--accent);">#${race.id}</span>
                    <span style="font-weight: bold;">${race.entryFee} SOL</span>
                </div>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="color: ${race.players.length >= race.maxPlayers ? '#ff6600' : 'var(--accent)'}; font-weight: bold;">${race.players.length}/${race.maxPlayers}</span>
                    <button class="btn btn-small" onclick="event.stopPropagation(); shareRace(${race.id})" style="padding: 0.25rem 0.4rem; font-size: 0.75rem;">🔗</button>
                    <span class="race-status ${race.status}" style="padding: 0.25rem 0.5rem; font-size: 0.7rem;">${race.status.toUpperCase()}</span>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem; font-size: 0.75rem; color: var(--text-dim);">
                <span>${creatorAvatar}</span>
                <span>${creatorName}</span>
                <span style="opacity: 0.5;">•</span>
                <span>⏱️ ${timeStr}</span>
            </div>
        </div>
    `}).join('');
}

async function fetchLeaderboard() {
    // Note: getProgramAccounts not available for this program
    // Leaderboard requires a separate indexer service
    // For now, extract winners from recent races
    
    leaderboard = [];
    
    try {
        const gameState = await fetchGameState();
        if (!gameState) return;
        
        const totalRaces = gameState.totalRaces;
        const winnerMap = new Map(); // wallet -> { wins, profit }
        
        // Check last 50 races for winners
        const startId = Math.max(1, totalRaces - 50 + 1);
        
        for (let i = totalRaces; i >= startId; i--) {
            try {
                const raceData = await fetchRaceAccount(i);
                if (!raceData) continue;
                
                // Only count settled races
                if (raceData.status === RaceStatus.Settled && raceData.winner) {
                    const existing = winnerMap.get(raceData.winner) || { wins: 0, profit: 0 };
                    existing.wins++;
                    existing.profit += raceData.prizePool * 0.95; // Prize minus house fee estimate
                    winnerMap.set(raceData.winner, existing);
                }
            } catch (e) {
                // Skip failed fetches
            }
        }
        
        // Convert to array
        for (const [wallet, stats] of winnerMap) {
            leaderboard.push({
                wallet: wallet.slice(0, 4) + '...' + wallet.slice(-4),
                fullWallet: wallet,
                wins: stats.wins,
                profit: stats.profit,
            });
        }
        
        // Sort by wins
        leaderboard.sort((a, b) => b.wins - a.wins);
        leaderboard = leaderboard.slice(0, 10);
        
    } catch (e) {
        console.error('Failed to fetch leaderboard:', e);
    }
}

async function refreshRaces() {
    await fetchActiveRaces();
    renderRaces();
}

function renderLeaderboard() {
    const container = document.getElementById('leaderboard');
    
    container.innerHTML = leaderboard.slice(0, 5).map((player, i) => {
        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        return `
            <div class="leaderboard-item ${rankClass}">
                <div class="leaderboard-rank">#${i + 1}</div>
                <div class="leaderboard-wallet">${player.wallet}</div>
                <div class="leaderboard-wins">${player.wins} wins</div>
            </div>
        `;
    }).join('');
}

// ============= JOIN RACE =============
let joiningRace = false;

function showJoiningOverlay(raceId) {
    // Create overlay if doesn't exist
    let overlay = document.getElementById('joiningOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'joiningOverlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.85);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        `;
        document.body.appendChild(overlay);
    }
    
    overlay.innerHTML = `
        <div style="text-align: center;">
            <div style="font-size: 4rem; margin-bottom: 1rem; animation: pulse 1s infinite;">⚡</div>
            <h2 style="color: var(--accent); margin-bottom: 0.5rem;">Joining Race #${raceId}</h2>
            <p style="color: var(--text-dim);">Processing transaction...</p>
            <div style="margin-top: 1.5rem; width: 200px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                <div style="width: 100%; height: 100%; background: var(--accent); animation: loading 1.5s infinite;"></div>
            </div>
        </div>
        <style>
            @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
            @keyframes loading { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        </style>
    `;
    overlay.style.display = 'flex';
}

function hideJoiningOverlay() {
    const overlay = document.getElementById('joiningOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    joiningRace = false;
}

async function joinRace(raceId) {
    // Prevent double-clicks
    if (joiningRace) {
        showToast('Already joining...', 'info');
        return;
    }
    
    // Check if we have a wallet (main or burner)
    const hasBurner = useBurnerWallet && burnerKeypair;
    if (!publicKey && !hasBurner) {
        showToast('Please connect wallet first', 'error');
        return;
    }

    // Show loading state
    joiningRace = true;
    showJoiningOverlay(raceId);

    // Determine signer
    const signerPubkey = hasBurner ? burnerKeypair.publicKey : new PublicKey(publicKey);
    console.log('Joining race with:', signerPubkey.toString(), hasBurner ? '(BURNER - no popup!)' : '(Main)');

    // Players can now join multiple races simultaneously!
    // Just check if already in THIS specific race
    let race = races.find(r => r.id === raceId);
    if (race && race.players.some(p => p.includes(publicKey?.slice(0, 4)) || p.includes(burnerKeypair?.publicKey.toString().slice(0, 4)))) {
        showToast('Already in this race!', 'success');
        currentRace = race;
        currentRace.raceId = raceId;
        hideJoiningOverlay();
        showRaceView();
        startRacePolling(raceId);
        return;
    }

    race = races.find(r => r.id === raceId);
    if (!race) {
        showToast('Race not found', 'error');
        hideJoiningOverlay();
        return;
    }

    if (race.status !== 'open') {
        showToast('Race is not open', 'error');
        hideJoiningOverlay();
        return;
    }

    if (race.players.length >= race.maxPlayers) {
        showToast('Race is full', 'error');
        hideJoiningOverlay();
        return;
    }

    // Auto-deposit if game balance insufficient
    if (gameBalance < race.entryFee) {
        const burnerBal = await getBurnerBalance();
        const needed = race.entryFee - gameBalance + 0.001; // Add buffer for tx fee
        
        if (burnerBal < needed) {
            showToast(`Need ${needed.toFixed(3)} SOL. Send SOL to your game wallet first!`, 'error');
            hideJoiningOverlay();
            showSettings(); // Show settings to copy address
            return;
        }
        
        // Auto-deposit
        showToast('Auto-depositing ' + needed.toFixed(3) + ' SOL...', 'info');
        await autoDeposit(needed);
        await loadPlayerData(); // Refresh balance
    }

    try {
        showToast('Joining race #' + raceId + '...' + (hasBurner ? ' (no popup!)' : ''), 'success');

        const programId = new PublicKey(CONFIG.PROGRAM_ID);
        const playerPDA = getPlayerPDA(signerPubkey);
        const racePDA = getRacePDA(raceId);
        const gameStatePDA = getGameStatePDA();

        // Build joinRace instruction: [instruction_index(1), raceId(8)]
        const data = new Uint8Array(9);
        data[0] = INSTRUCTIONS.JOIN_RACE;
        const dataView = new DataView(data.buffer);
        dataView.setBigUint64(1, BigInt(raceId), true);

        // Clock sysvar required for auto-start when race is full
        const SYSVAR_CLOCK_PUBKEY = new PublicKey('SysvarC1ock11111111111111111111111111111111');

        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: signerPubkey, isSigner: true, isWritable: false },
                { pubkey: playerPDA, isSigner: false, isWritable: true },
                { pubkey: racePDA, isSigner: false, isWritable: true },
                { pubkey: gameStatePDA, isSigner: false, isWritable: false },
                { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false }, // Required for auto-start
            ],
            programId,
            data,
        });

        const transaction = new Transaction().add(instruction);
        transaction.feePayer = signerPubkey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        let signed;
        if (hasBurner) {
            // 🔥 BURNER - sign directly, NO POPUP!
            transaction.sign(burnerKeypair);
            signed = transaction;
        } else {
            // Main wallet - Phantom popup
            signed = await wallet.signTransaction(transaction);
        }
        
        const signature = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(signature, 'confirmed');

        // Refresh data
        await loadPlayerData();

        // Update local race data
        const playerAddr = signerPubkey.toString().slice(0, 4) + '...' + signerPubkey.toString().slice(-4);
        race.players.push(playerAddr);
        race.pool += race.entryFee;
        
        // Set current race and show race view
        currentRace = race;
        currentRace.raceId = raceId;
        
        // Hide loading overlay
        hideJoiningOverlay();
        
        showRaceView();

        showToast('Joined race #' + raceId + '!', 'success');

        // Start polling for race status changes
        startRacePolling(raceId);

    } catch (err) {
        console.error('Failed to join race:', err);
        hideJoiningOverlay();
        showToast('Failed to join race: ' + (err.message || err), 'error');
    }
}

// Poll for race status updates
let racePollingInterval = null;
async function startRacePolling(raceId) {
    if (racePollingInterval) clearInterval(racePollingInterval);
    
    racePollingInterval = setInterval(async () => {
        try {
            const raceData = await fetchRaceAccount(raceId);
            if (!raceData || !currentRace) {
                clearInterval(racePollingInterval);
                return;
            }
            
            // Update current race with latest data
            const onChainStatus = ['open', 'countdown', 'live', 'finished', 'settled', 'cancelled'][raceData.status];
            // Don't override local 'live' status if we triggered GO (contract stays at 'countdown')
            if (!(currentRace.status === 'live' && onChainStatus === 'countdown')) {
                currentRace.status = onChainStatus;
            }
            currentRace.pool = raceData.prizePool;
            currentRace.players = raceData.players.map(p => p.slice(0, 4) + '...' + p.slice(-4));
            currentRace.winner = raceData.winner;

            renderCurrentRace();
            
            // Handle status changes
            if (raceData.status === RaceStatus.Countdown && !countdownStarted) {
                countdownStarted = true;
                startCountdown(raceData.targetSlot);
            } else if (raceData.status === RaceStatus.Live && !goTriggered) {
                goTriggered = true;
                triggerGo();
            } else if (raceData.status === RaceStatus.Finished || raceData.status === RaceStatus.Settled) {
                clearInterval(racePollingInterval);
                showRaceResults(raceData);
            }
            
            // Also check if race settled while we were in "live" mode (someone won!)
            if (currentRace.status === 'live' && (raceData.status === RaceStatus.Finished || raceData.status === RaceStatus.Settled)) {
                clearInterval(racePollingInterval);
                showRaceResults(raceData);
            }
        } catch (e) {
            console.error('Race polling error:', e);
        }
    }, 1000);
}

let countdownStarted = false;
let goTriggered = false;
let autoRaceInProgress = false; // Flag to prevent manual mode override

function showRaceView() {
    document.getElementById('lobbyView').style.display = 'none';
    document.getElementById('raceView').classList.add('active');
    myRaceEntry = null; // Reset for new race
    renderCurrentRace();
}

async function renderCurrentRace() {
    if (!currentRace) return;
    
    document.getElementById('currentRaceId').textContent = '#' + currentRace.id;
    document.getElementById('raceEntryFee').textContent = currentRace.entryFee;
    document.getElementById('racePool').textContent = currentRace.pool.toFixed(2) + ' SOL';
    
    // Get my address for comparison
    const myWallet = burnerKeypair ? burnerKeypair.publicKey.toString() : publicKey;
    const myAddr = myWallet ? myWallet.slice(0, 4) + '...' + myWallet.slice(-4) : '';
    
    // Fetch profiles for all players
    const fullWallets = currentRace.fullWallets || [];
    if (fullWallets.length > 0) {
        await fetchPlayerProfiles(fullWallets);
    }
    
    // Render player slots with metallic game styling
    const grid = document.getElementById('playersGrid');
    
    let slots = '';
    for (let i = 0; i < currentRace.maxPlayers; i++) {
        const playerShort = currentRace.players[i];
        const playerFull = fullWallets[i] || '';
        const isYou = playerShort === myAddr || playerFull === myWallet;
        const filled = !!playerShort;
        
        // Use myProfile for current user, otherwise fetch from cache
        let profile;
        if (isYou) {
            profile = {
                avatar: myProfile.avatar || '🏎️',
                name: myProfile.name || myAddr,
                isNamed: !!myProfile.name
            };
        } else {
            profile = playerFull ? getPlayerDisplay(playerFull) : { avatar: '⏳', name: 'Waiting...', isNamed: false };
        }
        
        if (filled) {
            slots += `
                <div class="player-slot filled ${isYou ? 'you' : ''}" style="
                    background: linear-gradient(145deg, rgba(40,44,52,0.9), rgba(25,28,35,0.95));
                    border: 1px solid rgba(255,255,255,0.1);
                    box-shadow: 
                        inset 0 1px 0 rgba(255,255,255,0.1),
                        inset 0 -1px 0 rgba(0,0,0,0.3),
                        0 4px 12px rgba(0,0,0,0.4);
                    border-radius: 12px;
                    padding: 1rem;
                    position: relative;
                    overflow: hidden;
                ">
                    ${isYou ? `<div style="position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, var(--accent), transparent);"></div>` : ''}
                    <div style="font-size: 2.5rem; margin-bottom: 0.5rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">${profile.avatar}</div>
                    <div class="player-addr" style="
                        font-weight: 600; 
                        font-size: 0.9rem;
                        color: ${isYou ? '#00ff88' : '#e0e0e0'};
                        text-shadow: 0 1px 2px rgba(0,0,0,0.5);
                    ">
                        ${profile.name}${isYou ? '' : ''}
                    </div>
                    ${isYou ? `<div style="font-size: 0.7rem; color: #00ff88; margin-top: 0.25rem; font-weight: 500;">YOU</div>` : ''}
                    <div style="font-size: 0.65rem; color: rgba(255,255,255,0.4); margin-top: 0.25rem; font-family: 'JetBrains Mono', monospace;">
                        ${playerShort}
                    </div>
                    ${isYou && preppedTxSignature ? `
                        <div style="
                            margin-top: 0.75rem; 
                            padding: 0.3rem 0.6rem; 
                            background: linear-gradient(135deg, rgba(0,255,136,0.2), rgba(0,200,100,0.1)); 
                            border: 1px solid rgba(0,255,136,0.3);
                            border-radius: 6px; 
                            font-size: 0.7rem; 
                            color: #00ff88;
                            font-weight: 600;
                        ">
                            ⚡ TX LOADED
                        </div>
                    ` : ''}
                </div>
            `;
        } else {
            slots += `
                <div class="player-slot" style="
                    background: linear-gradient(145deg, rgba(30,33,40,0.6), rgba(20,22,28,0.7));
                    border: 1px dashed rgba(255,255,255,0.1);
                    border-radius: 12px;
                    padding: 1rem;
                    opacity: 0.6;
                ">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem; animation: pulse 2s ease-in-out infinite; opacity: 0.5;">⏳</div>
                    <div class="player-addr" style="color: rgba(255,255,255,0.3); font-size: 0.85rem;">Waiting...</div>
                </div>
            `;
        }
    }
    
    grid.innerHTML = slots;
    
    // Update status with dynamic messaging
    const goButton = document.getElementById('goButton');
    const statusText = document.getElementById('raceStatus');
    
    if (currentRace.status === 'open') {
        goButton.textContent = '⏳';
        goButton.disabled = true;
        const remaining = currentRace.maxPlayers - currentRace.players.length;
        if (remaining === 1) {
            statusText.innerHTML = `<span style="color: #ffaa00; animation: pulse 1s infinite;">🔥 1 MORE PLAYER NEEDED!</span>`;
        } else if (remaining > 1) {
            statusText.innerHTML = `
                <span style="color: var(--text-dim);">Waiting for racers...</span>
                <span style="color: var(--accent); font-weight: bold;">${currentRace.players.length}/${currentRace.maxPlayers}</span>
            `;
        } else {
            statusText.innerHTML = `<span style="color: var(--accent); animation: pulse 0.5s infinite;">🚀 RACE FULL! STARTING...</span>`;
        }
    } else if (currentRace.status === 'countdown') {
        goButton.textContent = '⚡';
        goButton.disabled = true;
        // Status updated by countdown function
    } else if (currentRace.status === 'live') {
        if (!autoRaceInProgress) {
            goButton.textContent = 'GO!';
            goButton.disabled = false;
            goButton.onclick = () => submitRaceEntry();
            statusText.innerHTML = '<span style="color: #ff0000; animation: pulse 0.2s infinite;">🏎️ RACE LIVE! GO GO GO!</span>';
        }
    } else if (currentRace.status === 'finished' || currentRace.status === 'settled') {
        goButton.textContent = '🏁';
        goButton.disabled = true;
        statusText.innerHTML = currentRace.winner ? `<span style="color: #ffd700;">🏆 Winner: ${currentRace.winner}</span>` : 'Race complete!';
    }
}

// Track pre-signed TX
let preppedTxSignature = null;

async function startRaceOnChain(raceId) {
    if (!burnerKeypair) {
        showToast('Game wallet not ready', 'error');
        return;
    }
    
    try {
        showToast('Starting race #' + raceId + '...', 'success');
        
        const programId = new PublicKey(CONFIG.PROGRAM_ID);
        const gameStatePDA = getGameStatePDA();
        const racePDA = getRacePDA(raceId);
        
        console.log('StartRace - Race ID:', raceId);
        console.log('StartRace - Race PDA:', racePDA.toString());
        console.log('StartRace - GameState PDA:', gameStatePDA.toString());
        console.log('StartRace - Authority:', CONFIG.AUTHORITY);
        
        // Build instruction data: instruction index (6 = startRace) + raceId
        const data = new Uint8Array(9);
        data[0] = 6; // startRace instruction index
        const view = new DataView(data.buffer);
        view.setBigUint64(1, BigInt(raceId), true);
        
        // Check if user is game authority
        const isAuthority = publicKey === CONFIG.AUTHORITY;
        console.log('Is game authority:', isAuthority, 'wallet:', publicKey, 'authority:', CONFIG.AUTHORITY);
        
        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: new PublicKey(publicKey), isSigner: true, isWritable: false }, // caller (must be authority or race creator)
                { pubkey: gameStatePDA, isSigner: false, isWritable: false },
                { pubkey: racePDA, isSigner: false, isWritable: true },
                { pubkey: new PublicKey('SysvarC1ock11111111111111111111111111111111'), isSigner: false, isWritable: false }, // clock
            ],
            programId,
            data,
        });
        
        const transaction = new Transaction().add(instruction);
        transaction.feePayer = new PublicKey(publicKey);
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        
        const signed = await wallet.signTransaction(transaction);
        const sig = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(sig, 'confirmed');
        
        showToast('Race started! Get ready...', 'success');
        
        // Race status will update via polling
        
    } catch (err) {
        console.error('Failed to start race:', err);
        showToast('Failed to start race: ' + (err.message || err), 'error');
    }
}

async function leaveRace() {
    if (!currentRace) {
        backToLobby();
        return;
    }

    const raceId = currentRace.raceId || currentRace.id;
    
    // Check race status to determine action
    try {
        const raceData = await fetchRaceAccount(raceId);
        
        if (!raceData) {
            // Race doesn't exist - just clear local state
            showToast('Race not found, clearing status...', 'info');
            currentRaceId = 0;
            backToLobby();
            return;
        }
        
        if (raceData.status === RaceStatus.Open) {
            // Race is open - call leaveRace to get refund
            await leaveRaceTransaction(raceId);
        } else if (raceData.status === RaceStatus.Settled || raceData.status === RaceStatus.Cancelled || raceData.status === RaceStatus.Finished) {
            // Race is finished - call clearRaceStatus
            await clearRaceStatus(raceId);
        } else {
            // Race is in countdown/live - can't leave
            showToast('Cannot leave during countdown or live race!', 'error');
            return;
        }
        
        // Refresh and go back
        await loadPlayerData();
        backToLobby();
        
    } catch (e) {
        console.error('Leave race failed:', e);
        showToast('Failed to leave race: ' + e.message, 'error');
    }
}

// ============= COUNTDOWN & GO =============
async function startCountdown(targetSlot) {
    if (!currentRace) return;

    console.log('🏁 Starting countdown! Target slot:', targetSlot);

    const countdownEl = document.getElementById('countdownDisplay');
    const statusText = document.getElementById('raceStatus');
    const goButton = document.getElementById('goButton');

    currentRace.status = 'countdown';
    currentRace.targetSlot = targetSlot;
    
    // Get RPC name for display
    const rpcUrl = getRpcUrl();
    let rpcName = 'whistle.ninja';
    try {
        const url = new URL(rpcUrl);
        rpcName = url.hostname.replace('api.', '').replace('rpc.', '');
    } catch(e) {}
    
    // Show signing prompt with dynamic styling
    statusText.innerHTML = `<span style="animation: pulse 1s infinite;">⚡ PREPARING AUTO-RACE...</span>`;
    goButton.textContent = '⏳';
    goButton.style.background = 'linear-gradient(135deg, #ff6600, #ff9900)';
    showToast('Preparing auto-race transaction...', 'info');

    // PRE-BUILD and PRE-SIGN the transaction NOW
    let preppedTx = null;
    try {
        console.log('📝 Pre-building race entry TX...');
        preppedTx = await prepareRaceEntryTx();
        console.log('✅ TX pre-signed and ready!');
        statusText.innerHTML = `<span style="color: var(--accent);">✅ TX LOADED</span> <span style="color: var(--text-dim); font-size: 0.8rem;">via ${rpcName}</span>`;
        goButton.textContent = '🚀';
        goButton.style.background = 'linear-gradient(135deg, #00ff88, #00cc66)';
        showToast('🚀 TX ready! Auto-sends at GO!', 'success');
    } catch (e) {
        console.error('❌ Failed to prepare race TX:', e);
        statusText.innerHTML = `<span style="color: #ff4444;">❌ AUTO FAILED</span> <span style="color: var(--text-dim);">- Click GO!</span>`;
        goButton.textContent = 'GO!';
        goButton.style.background = '#ff4444';
        goButton.disabled = false;
        goButton.onclick = () => submitRaceEntry();
        showToast('Pre-sign failed. Click GO manually when ready.', 'error');
    }

    // Calculate seconds until target slot
    const currentSlot = await connection.getSlot();
    const slotsRemaining = Math.max(0, targetSlot - currentSlot);
    let seconds = Math.ceil(slotsRemaining * 0.4);
    
    console.log('⏱️ Countdown:', seconds, 'seconds. Current slot:', currentSlot, 'Target:', targetSlot);

    const interval = setInterval(async () => {
        // Dynamic countdown display
        if (seconds > 3) {
            countdownEl.textContent = seconds;
            countdownEl.style.color = 'var(--accent)';
            countdownEl.style.fontSize = '6rem';
            countdownEl.style.textShadow = '0 0 20px rgba(0,255,136,0.5)';
        } else if (seconds === 3) {
            countdownEl.innerHTML = '<span style="color: #ffaa00; animation: pulse 0.3s infinite;">3</span>';
            countdownEl.style.fontSize = '8rem';
        } else if (seconds === 2) {
            countdownEl.innerHTML = '<span style="color: #ff6600; animation: pulse 0.2s infinite;">2</span>';
            countdownEl.style.fontSize = '9rem';
        } else if (seconds === 1) {
            countdownEl.innerHTML = '<span style="color: #ff0000; animation: pulse 0.1s infinite;">1</span>';
            countdownEl.style.fontSize = '10rem';
        }

        if (seconds <= 0) {
            clearInterval(interval);
            console.log('🚀 GO TIME!');
            
            if (preppedTx) {
                // AUTO MODE - Don't enable manual button!
                console.log('🚀 Auto-sending race entry (no manual mode)...');
                autoRaceInProgress = true; // Set flag!
                countdownEl.textContent = 'GO!';
                countdownEl.classList.add('go');
                goButton.textContent = '🚀 AUTO';
                goButton.disabled = true; // Keep disabled!
                goButton.onclick = null; // Remove onclick!
                currentRace.status = 'live';
                autoSendRaceEntry(preppedTx, targetSlot);
            } else {
                // MANUAL MODE - Pre-sign failed
                console.log('⚠️ No prepped TX - manual mode');
                triggerGo(); // Enable button for manual click
            }
        }
        seconds--;
    }, 1000);
}

// Pre-build and pre-sign the race entry transaction
async function prepareRaceEntryTx() {
    if (!currentRace) return null;
    
    // Determine which wallet to use
    const signerPubkey = useBurnerWallet && burnerKeypair 
        ? burnerKeypair.publicKey 
        : new PublicKey(publicKey);
    
    if (!useBurnerWallet && (!publicKey || !wallet)) return null;

    const programId = new PublicKey(CONFIG.PROGRAM_ID);
    const playerPDA = getPlayerPDA(signerPubkey);
    const racePDA = getRacePDA(currentRace.raceId || currentRace.id);
    const SYSVAR_CLOCK_PUBKEY = new PublicKey('SysvarC1ock11111111111111111111111111111111');
    
    // Get race creator - they receive 5% fee!
    const raceCreator = currentRace.creator ? new PublicKey(currentRace.creator) : new PublicKey(CONFIG.AUTHORITY);
    console.log('Race creator for fee:', raceCreator.toString());
    console.log('Using wallet:', signerPubkey.toString(), useBurnerWallet ? '(BURNER - no popup!)' : '(Main wallet)');

    // Build raceEntry instruction
    const data = new Uint8Array(9);
    data[0] = INSTRUCTIONS.RACE_ENTRY;
    const dataView = new DataView(data.buffer);
    dataView.setBigUint64(1, BigInt(currentRace.raceId || currentRace.id), true);

    const instruction = new TransactionInstruction({
        keys: [
            { pubkey: signerPubkey, isSigner: true, isWritable: false },
            { pubkey: playerPDA, isSigner: false, isWritable: true },  // Writable - balance updates!
            { pubkey: racePDA, isSigner: false, isWritable: true },
            { pubkey: raceCreator, isSigner: false, isWritable: true }, // Creator gets 5% fee!
            { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        ],
        programId,
        data,
    });

    const transaction = new Transaction().add(instruction);
    transaction.feePayer = signerPubkey;
    
    // Get fresh blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    let signedTx;
    if (useBurnerWallet && burnerKeypair) {
        // 🔥 BURNER WALLET - Sign directly, NO POPUP!
        console.log('🔥 Signing with burner wallet - NO POPUP!');
        transaction.sign(burnerKeypair);
        signedTx = transaction;
    } else {
        // Main wallet - Phantom popup
        console.log('📱 Signing with main wallet - popup required');
        signedTx = await wallet.signTransaction(transaction);
    }
    
    return { signedTx, lastValidBlockHeight };
}

// Auto-send race entry at the exact target slot
async function autoSendRaceEntry(preppedTx, targetSlot) {
    const countdownEl = document.getElementById('countdownDisplay');
    const statusText = document.getElementById('raceStatus');
    const goButton = document.getElementById('goButton');

    goButton.textContent = '🚀 RACING';
    goButton.disabled = true;
    
    try {
        // Get current slot
        let currentSlot = await connection.getSlot();
        console.log('📍 Current slot:', currentSlot, 'Target:', targetSlot);
        
        // If we're already past target, send immediately
        if (currentSlot >= targetSlot) {
            console.log('⚡ Already at/past target slot - sending NOW!');
        } else {
            // Poll until target slot (fast!)
            statusText.textContent = `Waiting for slot ${targetSlot}...`;
            while (currentSlot < targetSlot) {
                await new Promise(r => setTimeout(r, 20)); // 20ms polling for speed
                currentSlot = await connection.getSlot();
            }
        }

        countdownEl.textContent = 'GO!';
        countdownEl.classList.add('go');
        statusText.textContent = '🚀 SENDING TX...';
        
        const sendStartTime = Date.now();
        
        // 🚀 SEND IMMEDIATELY - skip preflight for maximum speed!
        console.log('🚀 Sending race entry TX at slot', currentSlot);
        const sig = await connection.sendRawTransaction(preppedTx.signedTx.serialize(), {
            skipPreflight: true,
            maxRetries: 5,
        });

        console.log('✅ TX sent:', sig);
        statusText.textContent = '✅ TX sent! Checking slot...';
        
        // Get the slot our TX landed in
        try {
            await connection.confirmTransaction(sig, 'confirmed');
            const txInfo = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
            const landedSlot = txInfo?.slot || currentSlot;
            const landedMs = Date.now() - sendStartTime;
            
            myRaceEntry = {
                signature: sig,
                slot: landedSlot,
                ms: landedMs,
                targetSlot: targetSlot,
                slotDiff: landedSlot - targetSlot
            };
            console.log('📊 My TX landed:', myRaceEntry);
        } catch (e) {
            console.log('Could not get TX slot, using estimate');
            myRaceEntry = {
                signature: sig,
                slot: currentSlot,
                ms: Date.now() - sendStartTime,
                targetSlot: targetSlot,
                slotDiff: 0,
                estimated: true
            };
        }
        
        statusText.textContent = '✅ TX confirmed! Slot: ' + myRaceEntry.slot;
        showToast('Race TX landed in slot ' + myRaceEntry.slot + '!', 'success');

        // Poll for race results
        pollForRaceResult();

    } catch (e) {
        console.error('❌ Auto race entry failed:', e);
        showToast('TX failed: ' + (e.message || e), 'error');
        autoRaceInProgress = false; // Reset flag - allow manual mode
        statusText.textContent = '❌ Failed - click GO to retry';
        goButton.textContent = 'GO!';
        goButton.disabled = false;
        goButton.onclick = () => submitRaceEntry();
    }
}

// Poll the race account to check if it settled
async function pollForRaceResult() {
    const statusText = document.getElementById('raceStatus');
    const countdownEl = document.getElementById('countdownDisplay');
    
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max
    
    const pollInterval = setInterval(async () => {
        attempts++;
        try {
            const raceData = await fetchRaceAccount(currentRace.raceId || currentRace.id);
            
            if (raceData && (raceData.status === RaceStatus.Finished || raceData.status === RaceStatus.Settled)) {
                clearInterval(pollInterval);
                console.log('🏆 Race settled! Winner:', raceData.winner);
                showRaceResults(raceData);
                return;
            }
            
            if (attempts >= maxAttempts) {
                clearInterval(pollInterval);
                statusText.textContent = 'Race timed out - check results manually';
                countdownEl.textContent = '⏳';
            }
        } catch (e) {
            console.error('Poll error:', e);
        }
    }, 1000);
}

function triggerGo() {
    if (!currentRace) return;
    
    currentRace.status = 'live';
    
    const countdownEl = document.getElementById('countdownDisplay');
    const goButton = document.getElementById('goButton');
    const statusText = document.getElementById('raceStatus');
    
    // Epic GO! animation
    countdownEl.innerHTML = `
        <span style="
            font-size: 12rem;
            font-weight: 900;
            color: #00ff88;
            text-shadow: 
                0 0 20px #00ff88,
                0 0 40px #00ff88,
                0 0 60px #00ff88,
                0 0 80px #00ff88;
            animation: go-pulse 0.2s ease-in-out infinite;
        ">GO!</span>
        <style>
            @keyframes go-pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
            }
        </style>
    `;
    countdownEl.classList.add('go');
    
    goButton.innerHTML = '⚡ RACING ⚡';
    goButton.disabled = true;
    goButton.style.background = 'linear-gradient(135deg, #00ff88, #00ffff)';
    goButton.style.animation = 'go-pulse 0.3s ease-in-out infinite';
    
    statusText.innerHTML = '<span style="color: #00ff88; animation: pulse 0.5s infinite;">🏎️ TX SENT! RACING...</span>';
    
    // Race window - show waiting states
    setTimeout(() => {
        if (currentRace && currentRace.status === 'live') {
            countdownEl.innerHTML = `
                <span style="font-size: 4rem; animation: spin 1s linear infinite;">⏳</span>
                <style>@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
            `;
            goButton.innerHTML = 'WAITING...';
            goButton.style.animation = 'none';
            statusText.innerHTML = '<span style="color: var(--text-dim);">📡 Checking blockchain for winner...</span>';
        }
    }, 3000);
    
    setTimeout(() => {
        if (currentRace && currentRace.status === 'live') {
            statusText.innerHTML = '<span style="color: var(--warning);">🔍 Verifying results on-chain...</span>';
        }
    }, 6000);
}

async function submitRaceEntry() {
    if (!currentRace || currentRace.status !== 'live') return;
    
    const goButton = document.getElementById('goButton');
    goButton.disabled = true;
    goButton.classList.add('submitting');
    goButton.textContent = '...';
    
    const startTime = performance.now();
    
    try {
        const programId = new PublicKey(CONFIG.PROGRAM_ID);
        const playerPDA = getPlayerPDA(new PublicKey(publicKey));
        const racePDA = getRacePDA(currentRace.raceId || currentRace.id);
        const SYSVAR_CLOCK_PUBKEY = new PublicKey('SysvarC1ock11111111111111111111111111111111');
        
        // Get race creator - they receive 5% fee!
        const raceCreator = currentRace.creator ? new PublicKey(currentRace.creator) : new PublicKey(CONFIG.AUTHORITY);

        // Build raceEntry instruction: [instruction_index(1), raceId(8)]
        const data = new Uint8Array(9);
        data[0] = INSTRUCTIONS.RACE_ENTRY;
        const dataView = new DataView(data.buffer);
        dataView.setBigUint64(1, BigInt(currentRace.raceId || currentRace.id), true);

        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: new PublicKey(publicKey), isSigner: true, isWritable: false },
                { pubkey: playerPDA, isSigner: false, isWritable: true },  // Writable!
                { pubkey: racePDA, isSigner: false, isWritable: true },
                { pubkey: raceCreator, isSigner: false, isWritable: true }, // Creator gets 5%!
                { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });
        
        const transaction = new Transaction().add(instruction);
        transaction.feePayer = new PublicKey(publicKey);
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        
        const signed = await wallet.signTransaction(transaction);
        const signature = await connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: true, // Speed is critical!
            maxRetries: 0,
        });
        
        const endTime = performance.now();
        const latency = Math.round(endTime - startTime);
        
        goButton.classList.remove('submitting');
        goButton.textContent = latency + 'ms';
        
        showToast('TX submitted! ' + latency + 'ms', 'success');
        
        // Don't wait for confirmation - speed matters!
        connection.confirmTransaction(signature, 'confirmed').then(() => {
            console.log('Race entry confirmed:', signature);
        }).catch(e => {
            console.error('Race entry failed to confirm:', e);
        });
        
    } catch (err) {
        console.error('Race entry failed:', err);
        goButton.classList.remove('submitting');
        goButton.textContent = 'FAIL';
        showToast('TX failed: ' + (err.message || err), 'error');
    }
}

// ============= RESULTS =============
async function showRaceResults(raceData) {
    if (!currentRace) return;
    
    // Reset auto-race flag
    autoRaceInProgress = false;
    countdownStarted = false;
    goTriggered = false;
    
    const countdownEl = document.getElementById('countdownDisplay');
    const statusText = document.getElementById('raceStatus');
    const resultsList = document.getElementById('resultsList');
    const playersGrid = document.getElementById('playersGrid');
    
    currentRace.status = 'finished';
    
    const myAddr = burnerKeypair ? burnerKeypair.publicKey.toString() : publicKey;
    const playerAddr = myAddr ? myAddr.slice(0, 4) + '...' + myAddr.slice(-4) : '';
    const winnerFull = raceData.winner;
    const winnerAddr = winnerFull.slice(0, 4) + '...' + winnerFull.slice(-4);
    const isWinner = winnerFull === myAddr;
    
    // Get RPC name (hide if contains 'api')
    const rpcUrl = getRpcUrl();
    let rpcName = 'Unknown RPC';
    try {
        const url = new URL(rpcUrl);
        rpcName = url.hostname;
        if (rpcName.includes('api.')) rpcName = rpcName.replace('api.', '');
        if (rpcName.includes('rpc.')) rpcName = rpcName.replace('rpc.', '');
    } catch(e) {}
    
    // Calculate timing
    const targetSlot = raceData.targetSlot || currentRace.targetSlot;
    const winnerSlot = raceData.winnerSlot;
    const slotDiff = winnerSlot - targetSlot;
    const estimatedMs = slotDiff * 400; // ~400ms per slot
    
    // Dynamic winner/loser display
    if (isWinner) {
        countdownEl.innerHTML = '<span style="animation: winner-pulse 0.5s ease-in-out infinite;">🏆 YOU WON! 🏆</span>';
        countdownEl.style.color = '#ffd700';
        countdownEl.style.textShadow = '0 0 20px rgba(255,215,0,0.8)';
        showToast('🎉 VICTORY! You won the race!', 'success');
    } else {
        countdownEl.innerHTML = '💀 DEFEATED';
        countdownEl.style.color = '#ff4444';
        countdownEl.style.textShadow = '0 0 10px rgba(255,0,0,0.5)';
    }
    
    // Refresh player data to get updated balance
    await loadPlayerData();
    updateStatsDisplay();
    
    // Highlight winner in grid
    playersGrid.querySelectorAll('.player-slot').forEach(slot => {
        const addr = slot.querySelector('.player-addr')?.textContent;
        if (addr === winnerAddr) {
            slot.classList.add('winner');
            slot.style.animation = 'winner-glow 1s ease-in-out infinite';
        } else {
            slot.style.opacity = '0.5';
        }
    });
    
    // Calculate prize and time - use entry fee * players if prizePool is 0 (already distributed)
    const totalPrize = raceData.prizePool > 0 
        ? raceData.prizePool 
        : (currentRace.entryFee * currentRace.players.length);
    const prizeAmount = (totalPrize * 0.95).toFixed(4);
    const creatorFee = (totalPrize * 0.05).toFixed(4);
    const finishedTime = raceData.finishedAt ? new Date(raceData.finishedAt * 1000).toLocaleString() : new Date().toLocaleString();
    const racePDA = getRacePDA(currentRace.raceId || currentRace.id);
    
    // Build player results with details
    const allPlayers = currentRace.players || [];
    const losers = allPlayers.filter(p => p !== winnerAddr);
    
    // Show results with proof
    resultsList.classList.remove('hidden');
    resultsList.innerHTML = `
        <style>
            @keyframes winner-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
            @keyframes winner-glow { 0%, 100% { box-shadow: 0 0 10px rgba(255,215,0,0.5); } 50% { box-shadow: 0 0 25px rgba(255,215,0,0.9); } }
            @keyframes loser-fade { from { opacity: 1; } to { opacity: 0.6; } }
        </style>
        
        <h3 style="margin-bottom: 1rem; color: var(--text-dim); text-align: center;">⚡ RACE #${currentRace.raceId || currentRace.id} COMPLETE ⚡</h3>
        
        <!-- Winner Card -->
        <div style="padding: 1.5rem; background: linear-gradient(135deg, rgba(255,215,0,0.3), rgba(255,215,0,0.05)); border: 3px solid #ffd700; border-radius: 16px; margin-bottom: 1rem; text-align: center; animation: winner-glow 2s ease-in-out infinite;">
            <p style="font-size: 0.9rem; color: #ffd700; text-transform: uppercase; letter-spacing: 2px;">🏆 WINNER 🏆</p>
            <p style="font-size: 1.8rem; font-weight: bold; color: #fff; margin: 0.5rem 0; text-shadow: 0 0 10px rgba(255,215,0,0.5);">${winnerAddr}${isWinner ? ' <span style="color:#00ff88">(YOU!)</span>' : ''}</p>
            <p style="font-size: 1.5rem; color: var(--accent); font-weight: bold;">+${prizeAmount} SOL</p>
            <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,215,0,0.3);">
                <span style="font-size: 0.85rem; color: var(--text-dim);">TX landed in slot </span>
                <span style="font-family: 'JetBrains Mono', monospace; color: #ffd700; font-weight: bold;">${winnerSlot}</span>
                <span style="font-size: 0.85rem; color: var(--text-dim);"> • </span>
                <span style="color: ${estimatedMs <= 400 ? '#00ff88' : estimatedMs <= 800 ? '#ffaa00' : '#ff4444'}; font-weight: bold;">~${estimatedMs}ms</span>
                <span style="font-size: 0.85rem; color: var(--text-dim);"> after GO!</span>
            </div>
            <p style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.5rem;">RPC: <span style="color: var(--accent);">${rpcName}</span></p>
        </div>
        
        <!-- Losers with Stats -->
        ${losers.length > 0 ? `
        <div style="margin-bottom: 1rem;">
            <p style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 1px;">💀 Defeated</p>
            ${losers.map((p, i) => {
                const isYou = p === playerAddr;
                const myStats = isYou && myRaceEntry ? myRaceEntry : null;
                const slotBehind = myStats ? (myStats.slot - winnerSlot) : null;
                const msBehind = myStats ? myStats.ms : null;
                return `
                <div style="padding: 0.75rem; background: rgba(255,0,0,0.1); border: 1px solid rgba(255,0,0,0.3); border-radius: 8px; margin-bottom: 0.5rem; ${isYou ? 'border: 2px solid rgba(255,100,100,0.8);' : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <span style="background: rgba(255,0,0,0.3); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; color: #ff6666;">#${i + 2}</span>
                            <span style="color: #ff6666;">${p}${isYou ? ' <span style="color:#ff9999">(You)</span>' : ''}</span>
                        </div>
                        <span style="color: #ff4444; font-weight: bold;">-${currentRace.entryFee} SOL</span>
                    </div>
                    ${myStats ? `
                    <div style="margin-top: 0.75rem; padding: 0.5rem; background: rgba(0,0,0,0.3); border-radius: 6px;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.8rem;">
                            <div>
                                <span style="color: var(--text-dim);">Your Slot:</span>
                                <span style="font-family: 'JetBrains Mono', monospace; color: #ff6666; font-weight: bold;"> ${myStats.slot}</span>
                            </div>
                            <div>
                                <span style="color: var(--text-dim);">Your Time:</span>
                                <span style="font-family: 'JetBrains Mono', monospace; color: #ff6666; font-weight: bold;"> ${msBehind}ms</span>
                            </div>
                            <div>
                                <span style="color: var(--text-dim);">Winner Slot:</span>
                                <span style="font-family: 'JetBrains Mono', monospace; color: #ffd700;"> ${winnerSlot}</span>
                            </div>
                            <div>
                                <span style="color: var(--text-dim);">Behind by:</span>
                                <span style="font-family: 'JetBrains Mono', monospace; color: #ff4444; font-weight: bold;"> ${slotBehind > 0 ? '+' + slotBehind : slotBehind} slots</span>
                            </div>
                        </div>
                        <a href="https://solscan.io/tx/${myStats.signature}" target="_blank" rel="noopener" 
                           style="display: block; margin-top: 0.5rem; font-size: 0.75rem; color: var(--accent); text-decoration: none;">
                            🔍 View Your TX on Solscan →
                        </a>
                    </div>
                    ` : `
                    <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--text-dim);">
                        TX landed after winner in slot ${winnerSlot}
                    </div>
                    `}
                </div>
            `}).join('')}
        </div>
        ` : ''}
        
        <!-- Proof Section -->
        <div style="padding: 1rem; background: rgba(0,0,0,0.4); border-radius: 8px; margin-bottom: 1rem; border: 1px solid var(--border);">
            <p style="font-size: 0.8rem; color: var(--accent); margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 1px;">📜 On-Chain Proof</p>
            
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 0.5rem 1rem; font-size: 0.85rem;">
                <span style="color: var(--text-dim);">Target Slot:</span>
                <span style="font-family: 'JetBrains Mono', monospace;">${targetSlot}</span>
                
                <span style="color: var(--text-dim);">Winner Slot:</span>
                <span style="font-family: 'JetBrains Mono', monospace; color: #ffd700;">${winnerSlot}</span>
                
                <span style="color: var(--text-dim);">TX Index in Block:</span>
                <span style="font-family: 'JetBrains Mono', monospace;">#${raceData.winnerTxIndex}</span>
                
                <span style="color: var(--text-dim);">Response Time:</span>
                <span style="font-family: 'JetBrains Mono', monospace; color: ${estimatedMs <= 400 ? '#00ff88' : '#ffaa00'};">~${estimatedMs}ms (${slotDiff} slots)</span>
                
                <span style="color: var(--text-dim);">Prize Pool:</span>
                <span style="font-family: 'JetBrains Mono', monospace;">${raceData.prizePool.toFixed(4)} SOL</span>
                
                <span style="color: var(--text-dim);">Creator Fee (5%):</span>
                <span style="font-family: 'JetBrains Mono', monospace;">${creatorFee} SOL</span>
                
                <span style="color: var(--text-dim);">Finished:</span>
                <span>${finishedTime}</span>
            </div>
            
            <div style="display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap;">
                <a href="https://solscan.io/account/${racePDA.toString()}" target="_blank" rel="noopener" 
                   style="flex: 1; text-align: center; padding: 0.6rem 1rem; background: var(--accent); color: #000; border-radius: 6px; text-decoration: none; font-size: 0.85rem; font-weight: 600;">
                    🔍 Race Account
                </a>
                <a href="https://solscan.io/account/${winnerFull}" target="_blank" rel="noopener" 
                   style="flex: 1; text-align: center; padding: 0.6rem 1rem; background: #ffd700; color: #000; border-radius: 6px; text-decoration: none; font-size: 0.85rem; font-weight: 600;">
                    🏆 Winner Wallet
                </a>
            </div>
        </div>
        
        <!-- Other Players -->
        <div style="margin-bottom: 1rem;">
            <p style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.5rem;">Other Players:</p>
            ${currentRace.players.filter(p => p !== winnerAddr).map((p, i) => `
                <div style="padding: 0.5rem; background: rgba(255,255,255,0.05); border-radius: 4px; margin-bottom: 0.25rem; display: flex; justify-content: space-between;">
                    <span>#${i + 2} ${p}${p === playerAddr ? ' (You)' : ''}</span>
                    <span style="color: var(--error);">-${currentRace.entryFee} SOL</span>
                </div>
            `).join('')}
        </div>
        
        <div style="text-align: center;">
            <button class="btn btn-primary" onclick="backToLobby()" style="min-width: 200px;">Back to Lobby</button>
        </div>
    `;

    statusText.textContent = 'Winner: ' + winnerAddr;
}

function showResults(results, winner, isWinner) {
    const countdownEl = document.getElementById('countdownDisplay');
    const statusText = document.getElementById('raceStatus');
    const resultsList = document.getElementById('resultsList');
    const playersGrid = document.getElementById('playersGrid');
    
    currentRace.status = 'finished';
    
    if (isWinner) {
        countdownEl.textContent = '🏆 YOU WON!';
        countdownEl.style.color = '#ffd700';
        
        const prize = currentRace.pool * (1 - CONFIG.HOUSE_FEE);
        gameBalance += prize;
        updateBalanceDisplay();
        
        playerStats.wins++;
        playerStats.profit += prize - currentRace.entryFee;
        showToast('You won ' + prize.toFixed(2) + ' SOL!', 'success');
    } else {
        countdownEl.textContent = 'RACE OVER';
        countdownEl.style.color = 'var(--text-dim)';
        playerStats.profit -= currentRace.entryFee;
    }
    
    playerStats.races++;
    updateStatsDisplay();
    
    // Highlight winner in grid
    const playerAddr = publicKey.slice(0, 4) + '...' + publicKey.slice(-4);
    playersGrid.querySelectorAll('.player-slot').forEach(slot => {
        if (slot.querySelector('.player-addr').textContent === winner.wallet) {
            slot.classList.add('winner');
        }
    });
    
    // Show results list
    resultsList.classList.remove('hidden');
    resultsList.innerHTML = `
        <h3 style="margin-bottom: 1rem; color: var(--text-dim);">Results</h3>
        ${results.map(r => {
            const rankClass = r.rank === 1 ? 'first' : r.rank === 2 ? 'second' : r.rank === 3 ? 'third' : '';
            const isYou = r.wallet === playerAddr;
            return `
                <div class="result-item" style="${isYou ? 'background: var(--accent-dim);' : ''}">
                    <div class="result-rank ${rankClass}">#${r.rank}</div>
                    <div class="result-wallet">${r.wallet}${isYou ? ' (You)' : ''}</div>
                    <div class="result-slot">Slot ${r.slot}</div>
                    <div class="result-tx">TX #${r.txIndex}</div>
                </div>
            `;
        }).join('')}
        <div style="margin-top: 1.5rem; text-align: center;">
            <button class="btn btn-primary" onclick="backToLobby()">Back to Lobby</button>
        </div>
    `;
    
    statusText.textContent = 'Winner: ' + winner.wallet;
}

function backToLobby() {
    // Stop polling
    if (racePollingInterval) {
        clearInterval(racePollingInterval);
        racePollingInterval = null;
    }
    countdownStarted = false;
    goTriggered = false;
    currentRace = null;
    
    // Reset UI
    document.getElementById('countdownDisplay').textContent = '--';
    document.getElementById('countdownDisplay').style.color = '';
    document.getElementById('countdownDisplay').classList.remove('go');
    document.getElementById('resultsList').classList.add('hidden');
    document.getElementById('goButton').textContent = 'WAIT';
    document.getElementById('goButton').disabled = true;
    document.getElementById('goButton').style.background = '';
    
    document.getElementById('raceView').classList.remove('active');
    document.getElementById('lobbyView').style.display = 'block';
    
    loadGameData(); // Refresh races
}

// ============= DEPOSIT / WITHDRAW =============
function showDeposit() {
    document.getElementById('depositModal').classList.add('active');
}

function showWithdraw() {
    document.getElementById('withdrawModal').classList.add('active');
    updateWithdrawButton();
}

function closeModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

function setDeposit(amount) {
    document.getElementById('depositAmount').value = amount;
}

// Auto-deposit from burner wallet to game balance
async function autoDeposit(amount) {
    if (!burnerKeypair) return;
    
    const lamports = Math.floor(amount * 1e9);
    const playerPDA = getPlayerPDA(burnerKeypair.publicKey);
    const programId = new PublicKey(CONFIG.PROGRAM_ID);
    const gameState = new PublicKey(CONFIG.GAME_STATE_PDA);

    const data = new Uint8Array(9);
    data[0] = INSTRUCTIONS.DEPOSIT;
    const view = new DataView(data.buffer);
    view.setBigUint64(1, BigInt(lamports), true);

    const instruction = new TransactionInstruction({
        keys: [
            { pubkey: burnerKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: playerPDA, isSigner: false, isWritable: true },
            { pubkey: gameState, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId,
        data,
    });

    const transaction = new Transaction().add(instruction);
    transaction.feePayer = burnerKeypair.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // Sign with burner - NO POPUP!
    transaction.sign(burnerKeypair);
    
    const signature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(signature, 'confirmed');
    
    console.log('Auto-deposit complete:', signature);
}

async function deposit() {
    const amount = parseFloat(document.getElementById('depositAmount').value);

    if (!amount || amount <= 0) {
        showToast('Enter a valid amount', 'error');
        return;
    }

    // Determine which wallet to use
    const signerPubkey = useBurnerWallet && burnerKeypair 
        ? burnerKeypair.publicKey 
        : new PublicKey(publicKey);
    
    console.log('Depositing with:', signerPubkey.toString(), useBurnerWallet ? '(BURNER)' : '(Main)');

    try {
        showToast('Depositing ' + amount + ' SOL...', 'success');

        const lamports = Math.floor(amount * 1e9);
        const playerPDA = getPlayerPDA(signerPubkey);
        const programId = new PublicKey(CONFIG.PROGRAM_ID);
        const gameState = new PublicKey(CONFIG.GAME_STATE_PDA);

        // Build deposit instruction data: [instruction_index(1), amount(8)]
        const data = new Uint8Array(9);
        data[0] = INSTRUCTIONS.DEPOSIT;
        const view = new DataView(data.buffer);
        view.setBigUint64(1, BigInt(lamports), true);
        console.log('Deposit instruction:', INSTRUCTIONS.DEPOSIT, 'Amount:', lamports, 'PlayerPDA:', playerPDA.toString());

        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: signerPubkey, isSigner: true, isWritable: true },   // playerWallet
                { pubkey: playerPDA, isSigner: false, isWritable: true },                  // playerAccount
                { pubkey: gameState, isSigner: false, isWritable: false },                 // gameState (read-only)
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },   // systemProgram
            ],
            programId,
            data,
        });

        const transaction = new Transaction().add(instruction);
        transaction.feePayer = signerPubkey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        let signed;
        if (useBurnerWallet && burnerKeypair) {
            // 🔥 BURNER - sign directly, NO POPUP!
            transaction.sign(burnerKeypair);
            signed = transaction;
        } else {
            // Main wallet - Phantom popup
            signed = await wallet.signTransaction(transaction);
        }
        
        const signature = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(signature, 'confirmed');
        
        // Refresh balance from contract
        await loadPlayerData();
        closeModals();
        
        showToast('Deposited ' + amount + ' SOL!', 'success');
        
    } catch (err) {
        console.error('Deposit failed:', err);
        showToast('Deposit failed: ' + (err.message || err), 'error');
    }
}

async function withdraw() {
    let amount = parseFloat(document.getElementById('withdrawAmount').value);
    
    if (!amount || amount <= 0) {
        showToast('Enter a valid amount', 'error');
        return;
    }
    
    if (amount > gameBalance) {
        showToast('Insufficient balance', 'error');
        return;
    }
    
    // If withdrawing full balance, leave some for tx fee (0.001 SOL)
    const TX_FEE_BUFFER = 0.001;
    if (amount >= gameBalance - TX_FEE_BUFFER) {
        amount = Math.max(0, gameBalance - TX_FEE_BUFFER);
        if (amount <= 0) {
            showToast('Balance too low to withdraw (need ~0.001 SOL for fees)', 'error');
            return;
        }
        showToast('Adjusted to ' + amount.toFixed(4) + ' SOL (keeping 0.001 for fees)', 'success');
    }
    
    try {
        showToast('Withdrawing ' + amount + ' SOL...', 'success');
        
        const lamports = Math.floor(amount * 1e9);
        const playerPDA = getPlayerPDA(new PublicKey(publicKey));
        const programId = new PublicKey(CONFIG.PROGRAM_ID);
        const gameState = new PublicKey(CONFIG.GAME_STATE_PDA);
        
        // Build withdraw instruction data: [instruction_index(1), amount(8)]
        const data = new Uint8Array(9);
        data[0] = INSTRUCTIONS.WITHDRAW;
        const view = new DataView(data.buffer);
        view.setBigUint64(1, BigInt(lamports), true);
        
        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: new PublicKey(publicKey), isSigner: true, isWritable: true },   // playerWallet
                { pubkey: playerPDA, isSigner: false, isWritable: true },                  // playerAccount
                { pubkey: gameState, isSigner: false, isWritable: false },                 // gameState (read-only)
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },   // systemProgram
            ],
            programId,
            data,
        });
        
        const transaction = new Transaction().add(instruction);
        transaction.feePayer = new PublicKey(publicKey);
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        
        const signed = await wallet.signTransaction(transaction);
        const signature = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(signature, 'confirmed');
        
        // Refresh balance from contract
        await loadPlayerData();
        closeModals();
        
        showToast('Withdrew ' + amount + ' SOL!', 'success');
        
    } catch (err) {
        console.error('Withdrawal failed:', err);
        showToast('Withdrawal failed: ' + (err.message || err), 'error');
    }
}

// ============= SHARE & URL HANDLING =============
function shareRace(raceId) {
    const url = `${window.location.origin}${window.location.pathname}?race=${raceId}`;
    navigator.clipboard.writeText(url);
    showToast('🔗 Race link copied! Share with friends.', 'success');
}

function shareCurrentRace() {
    if (currentRace && currentRace.id) {
        shareRace(currentRace.id);
    }
}

function getUrlRaceId() {
    const params = new URLSearchParams(window.location.search);
    const raceId = params.get('race');
    return raceId ? parseInt(raceId) : null;
}

async function handleUrlRace() {
    const raceId = getUrlRaceId();
    if (!raceId) return;
    
    console.log('URL race param detected:', raceId);
    
    // Wait for races to load
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Find the race
    const race = races.find(r => r.id === raceId);
    if (race) {
        showToast(`Opening race #${raceId}...`, 'info');
        joinRace(raceId);
    } else {
        showToast(`Race #${raceId} not found or already finished`, 'error');
    }
    
    // Clear URL param
    window.history.replaceState({}, '', window.location.pathname);
}

// ============= UTILITIES =============
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type + ' show';
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Close modals on outside click
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModals();
        }
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Space bar to submit race entry
    if (e.code === 'Space' && currentRace && currentRace.status === 'live') {
        e.preventDefault();
        submitRaceEntry();
    }
    
    // Escape to close modals
    if (e.code === 'Escape') {
        closeModals();
    }
});

