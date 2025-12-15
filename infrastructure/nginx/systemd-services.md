# Systemd Service Files

Place these in `/etc/systemd/system/` and run:
```bash
sudo systemctl daemon-reload
sudo systemctl enable <service-name>
sudo systemctl start <service-name>
```

## Relay Server

`/etc/systemd/system/whistle-relay.service`

```ini
[Unit]
Description=Whistle Network Relay Server
After=network.target

[Service]
Type=simple
User=whistle
Group=whistle
WorkingDirectory=/opt/whistle/infrastructure/relay-server
ExecStart=/usr/bin/node dist/relay-server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3480
Environment=RPC_URL=https://api.mainnet-beta.solana.com

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/whistle/data

[Install]
WantedBy=multi-user.target
```

## Developer Showcase API

`/etc/systemd/system/whistle-showcase.service`

```ini
[Unit]
Description=Whistle Developer Showcase API
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/devs.whistle.ninja
ExecStart=/usr/bin/node api.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3490

[Install]
WantedBy=multi-user.target
```

## TX Race Profiles API

`/etc/systemd/system/whistle-txrace.service`

```ini
[Unit]
Description=Whistle TX Race Profiles API
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/fun.whistle.ninja
ExecStart=/usr/bin/node profiles-api.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3491

[Install]
WantedBy=multi-user.target
```

## Cache Node Client (User Service)

For node operators running their own nodes:

`~/.config/systemd/user/whistle-node.service`

```ini
[Unit]
Description=Whistle Cache Node Client
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/whistle-node
ExecStart=/usr/bin/node node.js
Restart=always
RestartSec=30
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

Enable with:
```bash
systemctl --user enable whistle-node
systemctl --user start whistle-node
```

## Checking Status

```bash
# View status
sudo systemctl status whistle-relay

# View logs
sudo journalctl -u whistle-relay -f

# Restart service
sudo systemctl restart whistle-relay
```

