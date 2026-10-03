# Deploy To jpclawhq

Production host: `jpclawhq` (`46.225.177.225`)

Domain:

- `griffins1884.org`
- `www.griffins1884.org`

App runtime:

- GitHub repo: `https://github.com/FRC1884/frc1884-strategy.git`
- repo path: `/srv/frc1884-strategy`
- current live branch: `deploy/jpclawhq-prod`
- intended auto-deploy branch: `main`
- app port: `3010`
- service: `frc1884-strategy.service`
- webhook port: `3013`
- webhook service: `frc1884-strategy-webhook.service`
- nginx site: `/etc/nginx/sites-available/griffins1884.org.conf`
- TLS cert path: `/etc/letsencrypt/live/griffins1884.org/`
- Cloudflare SSL mode: `Full (strict)`

## First-time setup

1. Clone `https://github.com/FRC1884/frc1884-strategy.git` to `/srv/frc1884-strategy`
2. Check out `deploy/jpclawhq-prod`
3. Run `npm ci`
4. Run `npm run build`
5. Install `deploy/systemd/frc1884-strategy.service` to `/etc/systemd/system/`
6. Install `deploy/systemd/frc1884-strategy-webhook.service` to `/etc/systemd/system/`
7. Install `deploy/nginx/griffins1884.org.conf` to `/etc/nginx/sites-available/`
8. Install `deploy/nginx/frc1884-strategy.locations.conf` to `/etc/nginx/snippets/`
9. Symlink the nginx site into `/etc/nginx/sites-enabled/`
10. Create `/etc/frc1884-strategy/webhook.env` with `GITHUB_WEBHOOK_SECRET=...`
11. `sudo systemctl daemon-reload`
12. `sudo systemctl enable --now frc1884-strategy.service frc1884-strategy-webhook.service`
13. `sudo ufw allow 80/tcp`
14. `sudo ufw allow 443/tcp`
15. Issue a Let's Encrypt cert for `griffins1884.org` and `www.griffins1884.org`
16. `sudo nginx -t && sudo systemctl reload nginx`

The nginx site binds public `443` on `46.225.177.225` and
`2a01:4f8:1c19:171c::1` explicitly. That avoids a bind conflict with
`tailscaled`, which owns port `443` on the tailnet addresses.

## Future deploys

Run this on `jpclawhq`:

```bash
cd /srv/frc1884-strategy && ./scripts/deploy-jpclawhq.sh
```

That performs the one-command deploy flow on the production checkout:

- `git pull --ff-only`
- `npm ci`
- `npm run build`
- `sudo systemctl restart frc1884-strategy.service`

For `main`-based production deploys, use:

```bash
cd /srv/frc1884-strategy && ./scripts/deploy-jpclawhq-main.sh
```

## Local publish step

Push updates from your local machine with:

```bash
git push origin deploy/jpclawhq-prod
```

Then deploy on the server with:

```bash
cd /srv/frc1884-strategy && ./scripts/deploy-jpclawhq.sh
```

## GitHub Hook

`POST /github-webhook/frc1884-strategy` triggers a detached deploy when GitHub
sends a signed `push` event for `refs/heads/main`.

Runtime requirements:

- `/etc/frc1884-strategy/webhook.env` with `GITHUB_WEBHOOK_SECRET=...`
- `/srv/frc1884-strategy/log/` writable by the app user
- a GitHub repository webhook pointed at
  `https://griffins1884.org/github-webhook/frc1884-strategy`

## Griffins Hub

The hub at `/hub` is built by the same `npm run build` the deploy script already runs, so no change to the deploy steps is needed. It needs these in the service environment (for example in a drop-in at `/etc/systemd/system/frc1884-strategy.service.d/hub.conf`, readable only by root):

```ini
[Service]
Environment=SCOUT_CODE=...
Environment=MANAGER_CODE=...
Environment=STRATEGIST_CODE=...
Environment=LEAD_CODE=...
Environment=SESSION_SECRET=...   # at least 16 random characters
Environment=TBA_API_KEY=...
Environment=ANTHROPIC_API_KEY=...
```

Then `sudo systemctl daemon-reload && sudo systemctl restart frc1884-strategy.service`. The hub's Admin page shows which settings the server can see.

The live stream is plain HTTP (server-sent events) and passes through the existing nginx config unchanged. The database gains new tables on first start; existing tables and data are kept.
