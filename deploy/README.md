# deploy/

Version-controlled server configuration for the Hetzner production box
(`135.181.45.254`). Nothing in here is a secret; real config values
(env vars, TLS certs, domain names) live only on the box.

- `systemd/bash-fighter.service` -- unit for the game server. Runs as
  the unprivileged `bashgame` user, restarts on failure, reads runtime
  config from `/srv/bash-fighter/shared/bash-fighter.env` (not
  committed). Installed at `/etc/systemd/system/bash-fighter.service`.
- `nginx/bash-fighter.conf` -- reverse proxy: serves the static client
  build and proxies `/socket` (WebSocket upgrade) and `/api` to the
  Node process on `127.0.0.1:8081`. Plain HTTP for now by design; a
  commented HTTPS server block is ready for when a domain + certbot
  cert exist. Installed at `/etc/nginx/sites-available/bash-fighter`,
  symlinked from `sites-enabled`.
- `static/index.html` -- placeholder holding page shown until the real
  client build is deployed. Lives at `/srv/bash-fighter/static/` on
  the box until the first real deploy replaces it.
- `deploy.sh` -- idempotent deploy script. See its header comment for
  usage; run on the box as root (or as `bashgame` with sudo for the
  systemctl restart step).
- `bash-fighter.env.example` -- shape of the runtime env file the unit
  expects. Copy to `/srv/bash-fighter/shared/bash-fighter.env` on the
  box and edit; never commit the real file.

See the shared wiki pages "Hetzner Production Server" and "Hetzner
Deployment Plan" for the full rationale and change history.
