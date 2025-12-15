# Developer Showcase (devs.whistle.ninja)

A platform for developers to showcase projects built using Whistle RPC, compete for rewards, and engage with the community.

## Features

- **Project Showcase**: Display your dApps, bots, and tools
- **API Verification**: Verify you're using Whistle RPC
- **Community Voting**: Vote for your favorite projects
- **Comments**: Engage with project creators
- **Developer Challenge**: Compete for SOL rewards

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Backend**: Node.js + Express
- **Database**: SQLite (better-sqlite3)
- **Wallet**: Solana wallet adapter (Phantom/Solflare)

## Local Development

```bash
# Install dependencies
npm install

# Start API server
node api.js

# Serve frontend (use any static server)
npx serve .
```

## API Endpoints

### Projects

```
GET    /api/projects          - List all projects
GET    /api/projects/:id      - Get project details
POST   /api/projects          - Submit new project
PUT    /api/projects/:id      - Update project (owner only)
POST   /api/projects/:id/vote - Vote for project
POST   /api/projects/:id/comments - Add comment
```

### Verification

```
POST   /api/verify            - Verify API key is active
```

### Stats

```
GET    /api/stats             - Get platform statistics
GET    /api/round             - Get current round info
```

## Database Schema

```sql
-- Projects table
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  wallet TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  project_url TEXT,
  twitter_url TEXT,
  logo_data TEXT,
  type TEXT DEFAULT 'dapp',
  votes INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  featured INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Votes table
CREATE TABLE votes (
  id INTEGER PRIMARY KEY,
  project_id INTEGER,
  voter_wallet TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, voter_wallet)
);

-- Comments table
CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  project_id INTEGER,
  wallet TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## Configuration

```env
PORT=3490
DATABASE_PATH=./challenge.db
API_VERIFY_URL=https://api.whistle.ninja/api/subscription
```

## Deployment

Uses Nginx reverse proxy:

```nginx
server {
    listen 443 ssl;
    server_name devs.whistle.ninja;
    
    root /var/www/devs.whistle.ninja;
    index index.html;
    
    location /api/ {
        proxy_pass http://localhost:3490/api/;
    }
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Features Breakdown

### Project Submission
1. Connect wallet
2. Enter valid Whistle API key
3. Fill project details (name, URL, description)
4. Upload logo (base64, max 3MB)
5. Submit for verification

### Voting System
- One vote per wallet per project
- Requires connected wallet
- Real-time vote counts

### Developer Challenge
- Weekly rounds
- Community voting period
- SOL prizes from treasury

