## What this changes

A short description of the change and why it's needed. Link the issue it
closes, if any (`Closes #123`).

## How I tested it

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes (no new warnings)
- [ ] `npm test` passes
- [ ] `npm run test:server` passes (separate from `npm test` — covers the
      match server, only needed if you touched `server/` or protocol code
      it depends on)
- Manual testing notes (what you ran, what you saw), if applicable.

## Scope

Which package(s) does this touch (`sim`, `render`, `input`, `net`,
`content`, `app`, `server`, docs/config)?

## Determinism checklist (only if this touches `packages/sim`)

- [ ] No `Math.random` — uses the seeded PRNG instead.
- [ ] No `Date.now()` / `performance.now()` — uses tick count instead.
- [ ] No `Math.sin`/`Math.cos`/other transcendental `Math.*` at runtime —
      uses the precomputed trig LUT instead.
- [ ] No floats introduced into sim state — Q16.16 fixed-point only.
- [ ] No new allocation inside `Sim.advance()` or other hot-path methods.
- [ ] Entity iteration order is stable (integer ID), not Map/Set/object
      insertion order.
- [ ] If sim behavior intentionally changed, the golden hash file was
      regenerated and that's called out explicitly below (not just in the
      diff).

## Breaking changes

Does this change a public API, save format, or content format that
existing community content/tools would depend on? If yes, explain the
migration.
