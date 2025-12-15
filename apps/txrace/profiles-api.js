// Simple Profile Storage API for TX Race
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PROFILES_FILE = path.join(__dirname, 'profiles.json');

// Load profiles
function loadProfiles() {
    try {
        if (fs.existsSync(PROFILES_FILE)) {
            return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Failed to load profiles:', e);
    }
    return {};
}

// Save profiles
function saveProfiles(profiles) {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

// Available avatars
const AVATARS = [
    '🏎️', '🚀', '⚡', '🔥', '💎', '🎮', '👾', '🤖', 
    '🦊', '🐺', '🦁', '🐯', '🦅', '🐉', '🦈', '🐙',
    '💀', '👻', '🎃', '🌟', '☄️', '🌙', '🌈', '⭐',
    '🗡️', '🛡️', '⚔️', '🏆', '🥇', '💰', '💵', '🎯'
];

// Get profile
app.get('/api/profile/:wallet', (req, res) => {
    const profiles = loadProfiles();
    const profile = profiles[req.params.wallet] || {
        name: null,
        avatar: '🏎️',
        wins: 0,
        races: 0,
        joined: Date.now()
    };
    res.json(profile);
});

// Update profile
app.post('/api/profile/:wallet', (req, res) => {
    const { name, avatar } = req.body;
    const wallet = req.params.wallet;
    
    // Validate
    if (name && (name.length < 2 || name.length > 16)) {
        return res.status(400).json({ error: 'Name must be 2-16 characters' });
    }
    if (name && !/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({ error: 'Name can only contain letters, numbers, _ and -' });
    }
    if (avatar && !AVATARS.includes(avatar)) {
        return res.status(400).json({ error: 'Invalid avatar' });
    }
    
    const profiles = loadProfiles();
    
    // Check if name is taken by another wallet
    if (name) {
        const nameTaken = Object.entries(profiles).some(([w, p]) => 
            w !== wallet && p.name?.toLowerCase() === name.toLowerCase()
        );
        if (nameTaken) {
            return res.status(400).json({ error: 'Name already taken' });
        }
    }
    
    profiles[wallet] = {
        ...profiles[wallet],
        name: name || profiles[wallet]?.name,
        avatar: avatar || profiles[wallet]?.avatar || '🏎️',
        updated: Date.now()
    };
    
    saveProfiles(profiles);
    res.json(profiles[wallet]);
});

// Get multiple profiles (for race display)
app.post('/api/profiles/batch', (req, res) => {
    const { wallets } = req.body;
    const profiles = loadProfiles();
    
    const result = {};
    for (const wallet of wallets || []) {
        result[wallet] = profiles[wallet] || {
            name: null,
            avatar: '🏎️'
        };
    }
    res.json(result);
});

// Get available avatars
app.get('/api/avatars', (req, res) => {
    res.json(AVATARS);
});

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
    const profiles = loadProfiles();
    const leaderboard = Object.entries(profiles)
        .map(([wallet, profile]) => ({
            wallet: wallet.slice(0, 4) + '...' + wallet.slice(-4),
            fullWallet: wallet,
            name: profile.name,
            avatar: profile.avatar || '🏎️',
            wins: profile.wins || 0,
            races: profile.races || 0
        }))
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 50);
    res.json(leaderboard);
});

const PORT = 3847;
app.listen(PORT, () => {
    console.log(`TX Race Profiles API running on port ${PORT}`);
});

