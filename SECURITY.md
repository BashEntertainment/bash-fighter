# Security Policy

## Current state

Bash Fighter has **no public deployment yet**. The engine (`packages/sim`,
`packages/content`, and the in-progress renderer/input/app packages) runs
only in development containers and local checkouts; there is no live
server, database, or user-facing endpoint to disclose. This document will
be expanded with infrastructure-specific details (scope, bounty policy, PGP
key if warranted) once a live deployment exists.

## Reporting a vulnerability

If you find a security issue in this codebase — including but not limited
to: a flaw in the sim that could be exploited once netplay exists, a
supply-chain risk in a dependency, or a design flaw in the planned
authoritative server model — please report it privately rather than
opening a public issue.

- Open a private security advisory on the GitHub repository once it exists
  under `BashEntertainment` (GitHub Security Advisories, "Report a
  vulnerability" under the repo's Security tab), **or**
- If that isn't available yet, open a regular issue titled generically
  (e.g. "Security contact needed") without vulnerability details, and a
  maintainer will follow up with a private channel.

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce, or a minimal proof of concept.
- The affected package/file and, if known, the commit or version.

## Response process

There is no dedicated security team yet — this is a small open-source
project. A maintainer will acknowledge reports within a reasonable time
and work with the reporter on a fix before any public disclosure. Please
give us the opportunity to patch before disclosing publicly.

## Scope notes

- Determinism bugs in `packages/sim` that could desync a future rollback
  match are a legitimate security-adjacent concern (they undermine
  competitive integrity) and are welcome here, not just as regular bug
  reports.
- Once a live server exists on the Bash Entertainment Hetzner
  infrastructure, this document will gain a scope section covering that
  deployment specifically.
