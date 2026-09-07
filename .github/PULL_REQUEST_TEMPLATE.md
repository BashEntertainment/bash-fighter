## What this changes

A short description of the change and why it's needed. Link the issue it
closes, if any (`Closes #123`).

## How I tested it

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes (no new warnings)
- [ ] `npm test` passes
- Manual testing notes (what you ran, what you saw), if applicable.

## Scope

Which package(s) does this touch (`sim`, `render`, `input`, `net`,
`content`, `app`, docs/config)? If it touches `packages/sim`, does it
preserve determinism (no `Math.random`/`Date.now`/`performance.now`, no
float ops outside the fixed-point helpers)?

## Breaking changes

Does this change a public API, save format, or content format that
existing community content/tools would depend on? If yes, explain the
migration.
