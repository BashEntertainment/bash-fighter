# TLS setup (once a domain exists)

Bash Fighter currently serves plain HTTP/WS on port 80 (see
`deploy/nginx/bash-fighter.conf`) because there is no domain yet --
browsers require a hostname, not a bare IP, for a Let's Encrypt cert.
This doc is the checklist for the maintainer who buys/points a domain
at `135.181.45.254` and wants to flip the switch to HTTPS/WSS.

Closes GitHub issue #2 ("No HTTPS on the production deployment").

## Prerequisites

- A domain (or subdomain) with an A/AAAA record pointing at
  `135.181.45.254`. Give DNS a few minutes to propagate before the
  next step -- certbot's HTTP-01 challenge needs it resolving already.
- Port 80 and 443 reachable from the internet (already the case for
  this box).

## Steps

1. SSH in: `ssh root@135.181.45.254`.
2. Install certbot's nginx plugin if not already present:
   ```
   apt-get update && apt-get install -y certbot python3-certbot-nginx
   ```
3. Confirm the domain resolves to this box: `dig +short your.domain`.
4. Run certbot against the existing site config:
   ```
   certbot --nginx -d your.domain
   ```
   Certbot edits `/etc/nginx/sites-enabled/bash-fighter.conf` in place:
   it adds the `listen 443 ssl` block with real cert paths and, if you
   accept the redirect prompt, adds the `80 -> 443` redirect. This ends
   up equivalent to `deploy/nginx-tls.conf` in this repo (kept here as
   a reference/reviewable copy of the intended end state -- replace
   `your.domain` in both places once you know the real name).
5. Reload nginx (certbot does this automatically, but to double check):
   ```
   nginx -t && systemctl reload nginx
   ```
6. Verify:
   ```
   curl -Iv https://your.domain/api/health
   ```
   should return `200` over TLS. Also open the site in a browser and
   confirm the client's websocket connects as `wss://` (check the
   Network tab -- the client currently derives the scheme from
   `window.location.protocol`, so no client code change is needed).
7. Certbot installs a systemd timer for auto-renewal
   (`systemctl list-timers | grep certbot`); no cron entry needed.
8. Update `deploy/nginx/bash-fighter.conf` in this repo to match the
   live server config (or replace it with `deploy/nginx-tls.conf`,
   filled in with the real domain) so the repo reflects reality, and
   note the change in the wiki Hetzner Server Change Log.

## Rollback

If something goes wrong, the plain-HTTP config this repo already
ships (`deploy/nginx/bash-fighter.conf`) is still valid and can be
restored with `systemctl reload nginx` after copying it back to
`/etc/nginx/sites-enabled/`. Certbot does not remove the ability to
serve plain HTTP unless you explicitly chose the "redirect" option in
step 4.
