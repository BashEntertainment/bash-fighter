// Deliberately zero-dependency module (task #28231). resyncLocalTickAfterSnapshot
// is used by net-match.ts's reconciliation step, but net-match.ts transitively
// pulls in packages/render (which uses TS parameter properties, unsupported by
// Node's strip-only loader that `npm test` runs under) -- so this guard lives
// in its own file to stay unit-testable without a browser/DOM.
//
// startMatch() resets the prediction clock (`localTick`) to 0 on every
// matchStart, including a resumed reconnect's -- but a resume's first
// snapshot carries the real, large mid-match server tick. Without resyncing
// forward here, localTick stays permanently behind snap.tick, so
// handleBinary's replay loop (`for t = snap.tick+1; t <= localTick`) never
// runs again for the rest of the match: the local player's own prediction
// goes silently dead after any reconnect, worse with each subsequent one.
// Measured with scripts/reconnect-divergence-harness.mjs (replay window
// drifted to -52, -123, -192 ticks over three reconnect cycles without this
// guard; pinned at 0 with it).
export function resyncLocalTickAfterSnapshot(localTick: number, snapshotTick: number): number {
  return snapshotTick > localTick ? snapshotTick : localTick;
}
