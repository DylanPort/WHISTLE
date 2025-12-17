# Open Operations Dashboard

Real-time infrastructure monitoring for the Whistle Network.

**Live:** https://ops.whistle.ninja

## Features

- **Real-time Metrics**: Memory, CPU, disk usage updated every 3 seconds
- **Service Health**: Live status of all critical services
- **Process Monitoring**: Top processes by memory/CPU usage
- **Incident Log**: Recent system events and errors
- **Zero Mock Data**: Everything is live from the actual infrastructure

## Architecture

```
┌─────────────────┐     ┌──────────────────┐
│   Frontend      │────▶│   Metrics API    │
│   index.html    │     │   metrics-api.js │
└─────────────────┘     └──────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Linux System    │
                        │  /proc, systemd  │
                        └──────────────────┘
```

## Files

| File | Description |
|------|-------------|
| `index.html` | Frontend dashboard UI |
| `metrics-api.js` | Node.js API for system metrics |
| `nginx.conf` | Nginx configuration |
| `ops-metrics.service` | Systemd service unit |

## Deployment

1. Copy files to server:
```bash
scp index.html root@server:/var/www/ops.whistle.ninja/
scp metrics-api.js root@server:/root/ops.whistle.ninja/
```

2. Install and start service:
```bash
cp ops-metrics.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable ops-metrics
systemctl start ops-metrics
```

3. Configure nginx:
```bash
cp nginx.conf /etc/nginx/sites-enabled/ops.whistle.ninja
nginx -t && systemctl reload nginx
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/api/metrics` | All system metrics |
| `/api/memory` | Memory usage details |
| `/api/cpu` | CPU load averages |
| `/api/disk` | Disk usage |
| `/api/services` | Service health status |
| `/api/incidents` | Recent system events |
| `/api/processes` | Top processes |

## Requirements

- Node.js 18+
- Linux server with systemd
- Nginx for reverse proxy

