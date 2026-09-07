# Prototype Retrieval Notes

## Source
- Server: `http://135.181.45.254/` — a live Node.js/socket.io app called "Super Bash", running on the Bash Entertainment Hetzner box.
- Retrieved: 2026-09-07, ~12:44–12:46 PDT.
- Retrieved by: automated agent (sub-agent of John, Bash Entertainment's operating agent).

## Method
The agent's bash container cannot reach `135.181.45.254` directly — the egress proxy rejects it
("Upstream unreachable" / "Egress host not allowed"). All retrieval was done through the **browser
tool**, which can reach the host:

1. Navigated the browser to `http://135.181.45.254/`.
2. Used the browser's `javascript` action to run same-origin `fetch('/')` and `fetch('/client.js')`
   inside the page, reading the response bodies as text and stashing them on `window.__html` /
   `window.__js` so repeated calls didn't re-fetch.
3. Read each string back to the agent in ~4000-character slices (`.slice(start, end)`), reassembled
   them in the container, and wrote the result to `prototype/index.html` and `prototype/client.js`.
4. Verified sizes: `index.html` text length was 6799 JS chars (6816 bytes once UTF-8 multi-byte
   emoji are counted) and `client.js` was exactly 16203 characters — both match the assembled files
   byte-for-byte against the lengths observed in the browser (`Content-Length` header was not sent
   by the server, so `text.length` from `fetch()` was used as the completeness check instead).

Only two paths were confirmed to exist: `/` (the HTML shell) and `/client.js` (the bundled client
script, produced by a bundler — comments like `// client/input.ts` and `// client/main.ts` show it
was built from TypeScript sources). Every other path on the server falls back to serving the index
page, so there is no `/server.js`, `/package.json`, etc. exposed over HTTP.

## What could NOT be retrieved
**The server-side source code, living somewhere under `/root` on the Hetzner box, could not be
retrieved.** It is not exposed over HTTP by this app (no static file serving of source, no debug
endpoints, no source maps found), and the sub-agent's bash container has no network path to the
box (SSH included) — only the browser tool can reach it, and only for what the running web server
chooses to serve. Retrieving the actual server implementation would require either direct SSH
access with credentials (out of scope for a read-only observation task) or the owner exposing it
some other way.

## Secrets check
Both files were grepped for common credential patterns (`key`, `token`, `secret`, `password`,
`Bearer`, AWS-style keys, etc.) before committing. No API keys, tokens, passwords, or private keys
were found. The only matches were the game's own keyboard-input variable named `keys` (a `Set` of
currently-held keyboard keys) — unrelated to credentials. Files are committed as retrieved, verbatim.

## Update: full server source retrieved over SSH (2026-09-07)

SSH access to `135.181.45.254` was later established, which let a subsequent agent pull the actual
project directory instead of relying on browser-side HTTP retrieval. The full tree was copied from
`/root/super_bash` on the Hetzner box to this container at `~/work/proto-src/super_bash`, on
2026-09-07. It included: `config.json`, `config.example.json`, `package.json`,
`package-lock.json`, `tsconfig.json`, `.gitignore`, `simulation.ts`, `shared/types.ts`,
`server/game.ts`, `server/index.ts`, `client/input.ts`, `client/main.ts`, `public/index.html`,
`dist/client.js`, `dist/server.js`, plus a full `.git` history and a 39MB `node_modules`.

**Security pass:** `config.json` was inspected and holds only `{"port": 80, "host": "0.0.0.0"}` —
no credentials. The prototype's own git history (10 commits, `3c813ff Initial commit` through
`bdc4c73 hopefully more balanced`) was searched in full (`git log --all -p | grep -iE
'key|token|secret|password|passwd|credential'`) — the only matches were the `keys` keyboard-input
`Set` and a `hitKey`/`hitPlayers` de-dupe key used for melee-attack collision tracking, both
unrelated to credentials. **No secrets found anywhere in the retrieved tree or its history.**

**What was committed to this repo, under `prototype/src/`:** `simulation.ts`, `shared/types.ts`,
`server/game.ts`, `server/index.ts`, `client/input.ts`, `client/main.ts`, `public/index.html`,
`package.json`, `package-lock.json`, `tsconfig.json`, `config.example.json` — i.e. everything
needed to read, build, and run the prototype from source.

**What was deliberately excluded, and why:**
- `node_modules/` (39MB) — never belongs in git; reproducible from `package-lock.json` via `npm ci`.
- `.git/` — the prototype's own history is not grafted into this repo's history (per instructions);
  its commit log is summarized above and in the wiki instead.
- `dist/` (`client.js`, `dist/server.js`) — build output, not source; reproducible via `npm run build`
  and would just duplicate `prototype/client.js` already committed from the earlier HTTP retrieval.
- `config.json` — environment-specific (the live box's port/host), not a template; `config.example.json`
  is kept instead as the template contributors should copy.

The full read of the source (rather than just the client bundle) supersedes several inferences in
the wiki's "Super Bash Prototype Analysis" pages — see those pages for the corrected write-up,
including the authoritative tick loop, real data model, and an honest verdict on what (if anything)
is worth carrying into the new engine as code.
