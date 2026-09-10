# Adding a new character: a worked example

This walks through adding one new, simple character end to end: the data
file, the validator, a render shape, and the roster registration that
makes it selectable. It complements the short summary in
[`CONTRIBUTING.md`](../CONTRIBUTING.md#adding-a-new-character) — read
that first for the ground rules (characters are data, not sim code; copy
the closest archetype rather than starting blank).

We'll add a placeholder-weight character called **Scout**. It won't be
balanced or original — the goal is to show every file you touch and every
command you run, using real paths.

## 1. Pick a template and copy its data

Every character lives in `packages/content/src/characters/<name>/`, with
two files: `data.ts` (stats + moveset) and `animation.ts` (pose
parameters). `placeholder` is the simplest reference:

```sh
mkdir -p packages/content/src/characters/scout
cp packages/content/src/characters/placeholder/data.ts \
   packages/content/src/characters/scout/data.ts
cp packages/content/src/characters/placeholder/animation.ts \
   packages/content/src/characters/scout/animation.ts
```

Edit `scout/data.ts`:

- Rename the exported constant to `SCOUT_CHARACTER` and set
  `name: 'Scout'`.
- Adjust `weight`, `hurtboxWidth`, `hurtboxHeight`, and the four moves'
  hitboxes (`damage`, `baseKnockback`, `knockbackGrowth`, `offsetX/Y`,
  `width`/`height`, `angleIdx`) to fit the character you're building. Every
  numeric value goes through `fromFloat`/`fromInt` from
  `packages/sim/src/math/fixed.ts` — never a raw float — because sim state
  is fixed-point (Q16.16) for determinism.
- `moves` needs exactly the four slots the sim expects: `MoveId.JAB`,
  `MoveId.FTILT`, `MoveId.UAIR`, `MoveId.DAIR` (see
  `packages/sim/src/moves/types.ts` for the enum).

Edit `scout/animation.ts` similarly — tune `AnimationParams` (windup,
swing, run cycle, hitstun shake) to match Scout's feel; the placeholder
values are a reasonable neutral starting point.

## 2. Run the content validator

`packages/content/src/validate.ts` exports `validateCharacter` (returns a
list of `ValidationError`) and `assertValidCharacter` (throws on the
first one) — this is the schema/frame-data sanity check CI runs on every
content PR. The fastest way to run it against your new character while
iterating is a one-off script:

```sh
node --experimental-strip-types -e "
import { assertValidCharacter } from './packages/content/src/validate.ts';
import { SCOUT_CHARACTER } from './packages/content/src/characters/scout/data.ts';
assertValidCharacter(SCOUT_CHARACTER);
console.log('Scout: valid');
"
```

It checks things like: non-empty name, positive weight/hurtbox
dimensions, at least one move, no duplicate hitbox ids within a move,
`width`/`height` > 0, non-negative damage/knockback, and integer
`angleIdx` (an index into the sim's trig lookup table, not a raw degree
value). Fix whatever it reports before moving on.

You'll also want a real test, not just the one-off script — add
`packages/content/test/scout.test.ts` following the pattern in
`ballast.test.ts` or `anchor.test.ts`: assert `validateCharacter(...)`
returns `[]`, assert `assertValidCharacter` doesn't throw, and add one or
two assertions about the character's identity (e.g. its weight relative
to another fighter in the cast, or a move's knockback growth) so a future
change that accidentally breaks Scout's numbers gets caught.

## 3. Give it a render shape

Rendering is separate from sim data. Each character needs a
`drawXSilhouette` function so it looks like something at 20-fighter zoom
instead of falling back to the placeholder capsule shape. Create
`packages/render/src/fighter-shape-scout.ts`, modeled on
`fighter-shape-reed.ts` or `fighter-shape-wisp.ts` (pick whichever's
proportions are closest to what you're building) — it takes a PixiJS
`Graphics`, a tint, a facing direction, and the current `Pose`, and draws
a silhouette. See `docs/ARCHITECTURE.md` for the readability constraint
this exists to satisfy: new characters need to read as a distinct
silhouette from the rest of the roster with color stripped, not just be a
different color of an existing shape.

Then register it in
[`packages/render/src/silhouette-dispatch.ts`](../packages/render/src/silhouette-dispatch.ts) —
the single place that maps a character's `name` string to its draw
function, shared by live-match rendering (`FighterSprite`) and the
character-select thumbnail (`character-icon.ts`) so they can never show
different shapes for the same character:

```ts
import { drawScoutSilhouette } from './fighter-shape-scout.ts';
// ...
} else if (characterName === 'Scout') {
  drawScoutSilhouette(g, tint, facing, pose);
```

## 4. Add it to the roster

The roster is one file, `packages/content/src/characters.ts` — this is
the only place a new character needs to be wired up for the character
select screen, local bot-fill, and the online join protocol to see it:

```ts
import { SCOUT_CHARACTER } from './characters/scout/data.ts';
// ...
export const ALL_CHARACTERS: readonly CharacterEntry[] = [
  { id: 'placeholder', character: PLACEHOLDER_CHARACTER },
  // ...
  { id: 'scout', character: SCOUT_CHARACTER },
];
```

Also re-export `SCOUT_CHARACTER` from `packages/content/src/index.ts`
alongside the other characters, so other packages can import it directly
if they need to (tests, tools) without reaching into the characters
subfolder.

## 5. Verify and open the PR

```sh
npm run typecheck
npm run lint
npm test    # includes your new packages/content/test/scout.test.ts
```

Play it locally (see the "Running it locally" section of `README.md`) and
check Scout appears on the character-select screen with its own
silhouette, not the placeholder capsule. Then open a PR following the
process in `CONTRIBUTING.md` — fill in the PR template, and note in the
description that this adds a new character (not a sim behavior change),
so the determinism checklist doesn't apply.

## If the validator's errors are confusing

If you hit a validator error message that doesn't tell you enough to fix
the problem, that's a real gap worth reporting — please open an issue
describing the message you got and what you actually needed to know,
rather than trying to guess your way past it. Don't try to fix the
validator's messages in the same PR as your character; keep the two
changes separate.
