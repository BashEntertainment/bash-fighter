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
