# Security Policy

## Current state

Bash Fighter is live in production at **https://bashfighter.com/** — a
game client, an authoritative WebSocket match server, and the `/api/*`
HTTP endpoints backing it, all serving real public traffic over HTTPS
(the bare IP `http://135.181.45.254/` still works as a fallback, over
plain HTTP). This is in scope for reports: hardening gaps in the live
deployment, not a deployment that doesn't exist. `packages/sim`, `packages/content`, `packages/render`,
`packages/input`, `packages/net`, and `packages/app` build into the
client served there; `server/` is what runs as the production process on
the Hetzner host behind nginx.

## Reporting a vulnerability

Please do not open a public GitHub issue for a security vulnerability.
Use GitHub's private vulnerability reporting instead:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** to open a private advisory.

This reaches maintainers privately without disclosing details publicly
before a fix is available.

If private reporting is not available to you for some reason, open a
regular issue with a generic title (e.g. "Security contact needed") and no
vulnerability details, and a maintainer will follow up with a private
channel. We do not have a public email address for security reports.

Please include, where you can:

- A description of the issue and its potential impact.
- Steps to reproduce, or a minimal proof of concept.
- The affected package/file and, if known, the commit or version.

## Response process

There is no dedicated security team; this is a small open-source project.
A maintainer will acknowledge reports within a reasonable time and work
with the reporter on a fix before any public disclosure. Please give us
the opportunity to patch before disclosing publicly.

## Scope notes

- Determinism bugs in `packages/sim` that could let a client desync from
  the authoritative server, or diverge from other clients, are a
  legitimate security-adjacent concern (they undermine match integrity)
  and are welcome here, not just as regular bug reports.
- Anything that would let a client affect another client's or the
  server's state outside the documented wire protocol (see
  `docs/ARCHITECTURE.md` and `docs/PROTOCOL.md`) is in scope.
- The production host is a single Hetzner server behind nginx, running
  the match server over plain HTTP/WS (no TLS yet). Man-in-the-middle
  concerns tied specifically to the lack of TLS are known and already
  tracked internally as a pending domain/certificate purchase, but a
  concrete exploitable consequence beyond "no TLS" is still a welcome
  report.
