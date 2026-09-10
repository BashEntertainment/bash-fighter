// Registry of recorded replay fixtures available to the in-app replay
// viewer. These are the exact same deterministic input-stream fixtures
// packages/sim's determinism/golden tests already replay
// (packages/sim/test/fixtures/replay-input-stream*.ts) -- deep-imported
// read-only rather than duplicated, so the viewer can never drift from
// what the tests actually exercise. This file adds no simulation logic
// and does not modify anything under packages/sim.
import { buildReplayInputStream, REPLAY_SEED, REPLAY_CHARACTERS, REPLAY_SETTINGS } from '../../../sim/test/fixtures/replay-input-stream.ts';
import {
  buildReplayInputStream20,
  REPLAY_20_SEED,
  REPLAY_20_CHARACTERS,
  REPLAY_20_SETTINGS,
  REPLAY_20_ARENA,
} from '../../../sim/test/fixtures/replay-input-stream-20.ts';
import type { ReplayFixture } from './replay-viewer.ts';

export const REPLAY_FIXTURES: ReplayFixture[] = [
  {
    id: 'duel',
    label: '1v1 duel (recorded)',
    description: 'The 2-fighter determinism fixture: a scripted pressure/shield exchange to a full stock-loss match.',
    seed: REPLAY_SEED,
    characters: REPLAY_CHARACTERS,
    settings: REPLAY_SETTINGS,
    buildInputStream: buildReplayInputStream,
  },
  {
    id: 'battle-royale-20',
    label: '20-fighter battle royale (recorded)',
    description: 'The N=20 golden fixture: every fighter walks, attacks and shields on a staggered schedule as the arena shrinks.',
    seed: REPLAY_20_SEED,
    characters: REPLAY_20_CHARACTERS,
    arena: REPLAY_20_ARENA,
    settings: REPLAY_20_SETTINGS,
    buildInputStream: buildReplayInputStream20,
  },
];
