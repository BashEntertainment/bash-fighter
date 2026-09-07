# Contributing to Bash Fighter

Bash Fighter is an open-source (AGPL-3.0), web-based platform fighter built
for massive, chaotic party brawls (up to 20 players in a match). The engine
is a workspace monorepo; see `README.md` for the package layout and the
Bash Entertainment wiki pages "Engine Architecture" and "Engine
Architecture: Input, Netplay, and Content Pipeline" for the design.

## Dev environment setup

Requirements: Node 24+ (we rely on native TypeScript type-stripping for
`npm test`; see "Known limitations" in `README.md`).

```sh
git clone https://github.com/BashEntertainment/bash-fighter.git
cd bash-fighter
npm install
npm test          # node --test, runs packages/*/test
npm run typecheck # tsc --noEmit
npm run lint      # eslint .
```

There is no build step for the packages under active development yet
(`packages/app` will eventually own the Vite app shell). Work inside a
single package where possible and run that package's tests before opening
a PR.

## Coding standards

- TypeScript, strict mode (`tsconfig.base.json`: `strict`,
  `noUncheckedIndexedAccess`). Keep new code passing `npm run typecheck`.
- `packages/sim` has extra restrictions enforced by `eslint.config.js`: no
  `Math.random`, `Date.now`, `performance.now`, `window`, or `document` —
  the sim must stay a deterministic, pure function of state + input. Don't
  work around the lint rule; ask in the PR if you think an exception is
  needed.
- Fix `npm run lint` warnings you touch; don't let a PR add new ones.
- Match the existing file's style (naming, module layout) rather than
  introducing a new convention in one corner of the codebase.

## Pull request process

1. Open an issue first for anything non-trivial (new feature, behavior
   change, new package) so design gets discussed before code — use the
   issue templates under `.github/ISSUE_TEMPLATE/`.
2. Keep PRs focused: one logical change per PR. Large mechanical
   refactors should be their own PR, separate from behavior changes.
3. Fill in the PR template (`.github/PULL_REQUEST_TEMPLATE.md`) — what
   changed, why, and how you tested it.
4. CI (`.github/workflows/ci.yml`) must pass: install, typecheck, lint,
   test. A maintainer reviews and merges; community PRs are not merged
   without review and a passing CI run, per project policy.
5. Be responsive to review comments — PRs that go quiet for a long time
   may be closed and can be reopened later.

## Reporting bugs / requesting features

Use the templates in `.github/ISSUE_TEMPLATE/`: `bug_report.md` or
`feature_request.md`.
