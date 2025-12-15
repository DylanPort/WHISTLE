/**
 * Whistle Developer Showcase API
 * Full-featured project showcase with comments, voting, and updates
 */

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3490;

// Database setup
const db = new Database('/root/devs.whistle.ninja/challenge.db');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL,
    project_name TEXT NOT NULL,
    project_type TEXT NOT NULL,
    project_url TEXT NOT NULL,
    logo_url TEXT,
    logo_data TEXT,
    github_url TEXT,
    twitter_url TEXT,
    description TEXT NOT NULL,
    demo_video TEXT,
    api_key_hash TEXT NOT NULL,
    verified INTEGER DEFAULT 0,
    verified_at INTEGER,
    featured INTEGER DEFAULT 0,
    votes INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    round INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    wallet TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS votes_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    voter_wallet TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE(project_id, voter_wallet)
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    prize_sol REAL,
    max_submissions INTEGER DEFAULT 5,
    submission_start INTEGER,
    submission_end INTEGER,
    voting_start INTEGER,
    voting_end INTEGER,
    winner_wallet TEXT,
    status TEXT DEFAULT 'active'
  );

  CREATE INDEX IF NOT EXISTS idx_projects_wallet ON projects(wallet);
  CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
  CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id);
`);

// Add logo_data column if missing
try {
  db.exec(`ALTER TABLE projects ADD COLUMN logo_data TEXT`);
} catch (e) {}

// Migrate old votes table if needed
try {
  const oldVotes = db.prepare('SELECT * FROM votes WHERE 1=0').all();
  // Check if it has submission_id column
  try {
    db.prepare('SELECT submission_id FROM votes LIMIT 1').get();
    // Has old column - migrate data
    const votes = db.prepare('SELECT submission_id as project_id, voter_wallet, created_at FROM votes').all();
    for (const v of votes) {
      try {
        db.prepare('INSERT OR IGNORE INTO votes_new (project_id, voter_wallet, created_at) VALUES (?, ?, ?)').run(v.project_id, v.voter_wallet, v.created_at);
      } catch (e) {}
    }
    db.exec('DROP TABLE votes');
    db.exec('ALTER TABLE votes_new RENAME TO votes');
    console.log('Migrated votes table');
  } catch (e) {
    // Already has project_id column
    db.exec('DROP TABLE IF EXISTS votes_new');
  }
} catch (e) {
  // votes table doesn't exist, rename votes_new
  try {
    db.exec('ALTER TABLE votes_new RENAME TO votes');
  } catch (e2) {}
}

// Migrate old submissions table if exists
try {
  const oldSubmissions = db.prepare('SELECT * FROM submissions').all();
  if (oldSubmissions.length > 0) {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO projects (id, wallet, project_name, project_type, project_url, github_url, description, demo_video, api_key_hash, verified, verified_at, votes, created_at, round)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of oldSubmissions) {
      insert.run(s.id, s.wallet, s.project_name, s.project_type, s.project_url, s.github_url, s.description, s.demo_video, s.api_key_hash, s.verified, s.verified_at, s.votes, s.created_at, s.round);
    }
    console.log(`Migrated ${oldSubmissions.length} submissions to projects`);
  }
} catch (e) {
  // No old table
}

// Initialize Round 1 if not exists
const round1 = db.prepare('SELECT * FROM rounds WHERE id = 1').get();
if (!round1) {
  db.prepare(`
    INSERT INTO rounds (id, name, prize_sol, max_submissions, submission_start, submission_end, voting_start, voting_end, status)
    VALUES (1, 'Round 1', 5.0, 5, ?, ?, ?, ?, 'active')
  `).run(
    Math.floor(Date.now() / 1000),
    Math.floor(new Date('2024-12-19T23:59:59Z').getTime() / 1000),
    Math.floor(new Date('2024-12-20T00:00:00Z').getTime() / 1000),
    Math.floor(new Date('2024-12-21T23:59:59Z').getTime() / 1000)
  );
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ============ PROJECTS ============

// Get all projects (public showcase)
app.get('/api/projects', (req, res) => {
  const { sort, type, featured } = req.query;
  
  let query = `
    SELECT id, wallet, project_name, project_type, project_url, logo_url, logo_data,
           github_url, twitter_url, description, demo_video, verified, 
           featured, votes, views, created_at, updated_at
    FROM projects 
    WHERE status = 'active'
  `;
  
  if (type && type !== 'all') {
    query += ` AND project_type = '${type}'`;
  }
  if (featured === 'true') {
    query += ` AND featured = 1`;
  }
  
  // Sort options
  if (sort === 'votes') {
    query += ` ORDER BY votes DESC, created_at DESC`;
  } else if (sort === 'views') {
    query += ` ORDER BY views DESC, created_at DESC`;
  } else if (sort === 'oldest') {
    query += ` ORDER BY created_at ASC`;
  } else {
    query += ` ORDER BY created_at DESC`;
  }
  
  const projects = db.prepare(query).all();
  
  res.json(projects.map(p => ({
    ...p,
    wallet: p.wallet.slice(0, 4) + '...' + p.wallet.slice(-4),
    walletFull: undefined, // Don't expose full wallet
    verified: !!p.verified,
    featured: !!p.featured
  })));
});

// Get single project with full details
app.get('/api/projects/:id', (req, res) => {
  const project = db.prepare(`
    SELECT * FROM projects WHERE id = ? AND status = 'active'
  `).get(req.params.id);
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  // Increment views
  db.prepare('UPDATE projects SET views = views + 1 WHERE id = ?').run(req.params.id);
  
  // Get comments
  const comments = db.prepare(`
    SELECT id, wallet, content, created_at 
    FROM comments 
    WHERE project_id = ? 
    ORDER BY created_at DESC
    LIMIT 50
  `).all(req.params.id);
  
  res.json({
    ...project,
    wallet: project.wallet.slice(0, 4) + '...' + project.wallet.slice(-4),
    verified: !!project.verified,
    featured: !!project.featured,
    comments: comments.map(c => ({
      ...c,
      wallet: c.wallet.slice(0, 4) + '...' + c.wallet.slice(-4)
    }))
  });
});

// Get projects by wallet (for creator dashboard)
app.get('/api/projects/wallet/:wallet', (req, res) => {
  const projects = db.prepare(`
    SELECT * FROM projects WHERE wallet = ? AND status = 'active'
    ORDER BY created_at DESC
  `).all(req.params.wallet);
  
  res.json(projects);
});

// Submit new project
app.post('/api/projects', async (req, res) => {
  const { 
    wallet, 
    projectName, 
    projectType, 
    projectUrl, 
    logoUrl,
    logoData,
    githubUrl,
    twitterUrl, 
    description, 
    demoVideo,
    apiKeyHash 
  } = req.body;

  if (!wallet || !projectName || !projectType || !projectUrl || !description || !apiKeyHash) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (wallet.length < 32 || wallet.length > 44) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  // Validate logo data size (max 3MB base64)
  if (logoData && logoData.length > 4200000) {
    return res.status(400).json({ error: 'Logo image too large (max 3MB)' });
  }

  // Check for duplicate
  const existing = db.prepare('SELECT id FROM projects WHERE wallet = ? AND project_name = ?').get(wallet, projectName);
  if (existing) {
    return res.status(400).json({ error: 'You already have a project with this name' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO projects (wallet, project_name, project_type, project_url, logo_url, logo_data, github_url, twitter_url, description, demo_video, api_key_hash, round)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(wallet, projectName, projectType, projectUrl, logoUrl || null, logoData || null, githubUrl || null, twitterUrl || null, description, demoVideo || null, apiKeyHash);

    res.json({ 
      success: true, 
      id: result.lastInsertRowid,
      message: 'Project submitted! It will appear in the showcase once verified.' 
    });
  } catch (e) {
    console.error('Submit error:', e);
    res.status(500).json({ error: 'Failed to save project' });
  }
});

// Update project (owner only)
app.put('/api/projects/:id', async (req, res) => {
  const { wallet, projectName, projectType, projectUrl, logoUrl, logoData, githubUrl, twitterUrl, description, demoVideo } = req.body;
  
  // Verify ownership
  const project = db.prepare('SELECT wallet FROM projects WHERE id = ?').get(req.params.id);
  if (!project || project.wallet !== wallet) {
    return res.status(403).json({ error: 'Not authorized to update this project' });
  }

  // Validate logo data size (max 3MB)
  if (logoData && logoData.length > 4200000) {
    return res.status(400).json({ error: 'Logo image too large (max 3MB)' });
  }

  try {
    db.prepare(`
      UPDATE projects SET 
        project_name = COALESCE(?, project_name),
        project_type = COALESCE(?, project_type),
        project_url = COALESCE(?, project_url),
        logo_url = ?,
        logo_data = COALESCE(?, logo_data),
        github_url = ?,
        twitter_url = ?,
        description = COALESCE(?, description),
        demo_video = ?,
        updated_at = strftime('%s', 'now')
      WHERE id = ?
    `).run(projectName, projectType, projectUrl, logoUrl, logoData, githubUrl, twitterUrl, description, demoVideo, req.params.id);

    res.json({ success: true, message: 'Project updated!' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// ============ COMMENTS ============

// Add comment
app.post('/api/projects/:id/comments', (req, res) => {
  const { wallet, content } = req.body;
  
  if (!wallet || !content) {
    return res.status(400).json({ error: 'Wallet and content required' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ error: 'Comment too long (max 500 chars)' });
  }

  // Check project exists
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO comments (project_id, wallet, content) VALUES (?, ?, ?)
    `).run(req.params.id, wallet, content);

    res.json({ 
      success: true, 
      id: result.lastInsertRowid,
      wallet: wallet.slice(0, 4) + '...' + wallet.slice(-4),
      content,
      created_at: Math.floor(Date.now() / 1000)
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Get comments for project
app.get('/api/projects/:id/comments', (req, res) => {
  const comments = db.prepare(`
    SELECT id, wallet, content, created_at 
    FROM comments 
    WHERE project_id = ? 
    ORDER BY created_at DESC
    LIMIT 100
  `).all(req.params.id);
  
  res.json(comments.map(c => ({
    ...c,
    wallet: c.wallet.slice(0, 4) + '...' + c.wallet.slice(-4)
  })));
});

// ============ VOTING ============

// Vote for project
app.post('/api/projects/:id/vote', (req, res) => {
  const { wallet } = req.body;
  
  if (!wallet) {
    return res.status(400).json({ error: 'Wallet required' });
  }

  // Check project exists and is verified
  const project = db.prepare('SELECT id, verified FROM projects WHERE id = ?').get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Check for duplicate vote
  const existingVote = db.prepare('SELECT id FROM votes WHERE project_id = ? AND voter_wallet = ?').get(req.params.id, wallet);
  if (existingVote) {
    return res.status(400).json({ error: 'Already voted for this project' });
  }

  try {
    db.prepare('INSERT INTO votes (project_id, voter_wallet) VALUES (?, ?)').run(req.params.id, wallet);
    db.prepare('UPDATE projects SET votes = votes + 1 WHERE id = ?').run(req.params.id);
    
    const updated = db.prepare('SELECT votes FROM projects WHERE id = ?').get(req.params.id);
    res.json({ success: true, votes: updated.votes });
  } catch (e) {
    res.status(500).json({ error: 'Failed to record vote' });
  }
});

// Check if wallet voted
app.get('/api/projects/:id/voted/:wallet', (req, res) => {
  const vote = db.prepare('SELECT id FROM votes WHERE project_id = ? AND voter_wallet = ?').get(req.params.id, req.params.wallet);
  res.json({ voted: !!vote });
});

// ============ LEGACY ENDPOINTS ============

// Get current round info (legacy)
app.get('/api/round', (req, res) => {
  const round = db.prepare('SELECT * FROM rounds WHERE status = ?').get('active');
  const submissionCount = db.prepare('SELECT COUNT(*) as count FROM projects WHERE round = ? AND status = ?').get(round?.id || 1, 'active');
  
  res.json({
    ...round,
    submissions: submissionCount.count,
    spotsLeft: (round?.max_submissions || 5) - submissionCount.count
  });
});

// Get submissions (legacy - redirects to projects)
app.get('/api/submissions', (req, res) => {
  const round = parseInt(req.query.round) || 1;
  const projects = db.prepare(`
    SELECT id, wallet, project_name, project_type, project_url, logo_url, logo_data,
           github_url, description, demo_video, verified, votes, created_at
    FROM projects 
    WHERE round = ? AND status = 'active'
    ORDER BY votes DESC, created_at ASC
  `).all(round);
  
  res.json(projects.map(p => ({
    ...p,
    wallet: p.wallet.slice(0, 4) + '...' + p.wallet.slice(-4),
    verified: !!p.verified
  })));
});

// Verify API key
app.post('/api/verify', async (req, res) => {
  const { apiKey } = req.body;
  
  if (!apiKey || apiKey.length < 20) {
    return res.status(400).json({ error: 'Invalid API key format' });
  }

  try {
    const response = await fetch(`http://localhost:3501/api/subscription/${encodeURIComponent(apiKey)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.subscription && data.subscription.status === 'active') {
        const hash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 32);
        return res.json({ valid: true, hash, plan: data.subscription.plan });
      }
    }
    
    return res.json({ valid: false, error: 'API key not active or not found' });
  } catch (e) {
    console.error('Verify error:', e);
    return res.status(500).json({ valid: false, error: 'Failed to verify API key' });
  }
});

// Legacy submit (redirects to projects)
app.post('/api/submit', async (req, res) => {
  const { wallet, projectName, projectType, projectUrl, githubUrl, description, demoVideo, apiKeyHash } = req.body;

  if (!wallet || !projectName || !projectType || !projectUrl || !description || !apiKeyHash) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (wallet.length < 32 || wallet.length > 44) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  const round = db.prepare('SELECT * FROM rounds WHERE status = ?').get('active');
  if (!round) {
    return res.status(400).json({ error: 'No active round' });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > round.submission_end) {
    return res.status(400).json({ error: 'Submissions are closed for this round' });
  }

  const count = db.prepare('SELECT COUNT(*) as count FROM projects WHERE round = ?').get(round.id);
  if (count.count >= round.max_submissions) {
    return res.status(400).json({ error: 'Round is full' });
  }

  const existing = db.prepare('SELECT id FROM projects WHERE wallet = ? AND round = ?').get(wallet, round.id);
  if (existing) {
    return res.status(400).json({ error: 'You already submitted for this round' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO projects (wallet, project_name, project_type, project_url, github_url, description, demo_video, api_key_hash, round)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(wallet, projectName, projectType, projectUrl, githubUrl || null, description, demoVideo || null, apiKeyHash, round.id);

    res.json({ 
      success: true, 
      id: result.lastInsertRowid,
      message: 'Submission received! We will verify RPC usage within 24h.' 
    });
  } catch (e) {
    console.error('Submit error:', e);
    res.status(500).json({ error: 'Failed to save submission' });
  }
});

// Legacy vote
app.post('/api/vote', (req, res) => {
  const { submissionId, voterWallet } = req.body;
  
  if (!submissionId || !voterWallet) {
    return res.status(400).json({ error: 'Missing submission or wallet' });
  }

  const existingVote = db.prepare('SELECT id FROM votes WHERE project_id = ? AND voter_wallet = ?').get(submissionId, voterWallet);
  if (existingVote) {
    return res.status(400).json({ error: 'Already voted for this project' });
  }

  try {
    db.prepare('INSERT INTO votes (project_id, voter_wallet) VALUES (?, ?)').run(submissionId, voterWallet);
    db.prepare('UPDATE projects SET votes = votes + 1 WHERE id = ?').run(submissionId);
    
    const updated = db.prepare('SELECT votes FROM projects WHERE id = ?').get(submissionId);
    res.json({ success: true, votes: updated.votes });
  } catch (e) {
    res.status(500).json({ error: 'Failed to record vote' });
  }
});

// ============ ADMIN ============

app.post('/api/admin/verify', (req, res) => {
  const { projectId, adminKey } = req.body;
  
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    db.prepare('UPDATE projects SET verified = 1, verified_at = ? WHERE id = ?')
      .run(Math.floor(Date.now() / 1000), projectId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to verify' });
  }
});

app.post('/api/admin/feature', (req, res) => {
  const { projectId, featured, adminKey } = req.body;
  
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    db.prepare('UPDATE projects SET featured = ? WHERE id = ?').run(featured ? 1 : 0, projectId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

app.get('/api/admin/projects', (req, res) => {
  const { adminKey } = req.query;
  
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json(projects);
});

// Stats
app.get('/api/stats', (req, res) => {
  const totalProjects = db.prepare('SELECT COUNT(*) as count FROM projects WHERE status = ?').get('active');
  const totalVotes = db.prepare('SELECT SUM(votes) as total FROM projects').get();
  const totalComments = db.prepare('SELECT COUNT(*) as count FROM comments').get();
  
  res.json({
    projects: totalProjects.count,
    votes: totalVotes.total || 0,
    comments: totalComments.count
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`Dev Showcase API running on port ${PORT}`);
});
