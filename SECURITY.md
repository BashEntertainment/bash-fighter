# Security Policy

## Current state

Bash Fighter has no public deployment yet. `packages/sim`, `packages/content`,
`packages/render`, `packages/input`, `packages/net`, `packages/app`, and
`server/` run in development containers and local checkouts today; there
is no live server or user-facing endpoint on the public internet to
disclose against yet. This document will be expanded with
infrastructure-specific scope once a live deployment exists.

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
- Once a live server exists on Bash Entertainment's infrastructure, this
  document will gain a scope section covering that deployment
  specifically.
