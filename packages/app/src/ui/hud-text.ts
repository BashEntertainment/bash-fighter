// Pure survivors-line text logic, split out of hud.ts so it can be unit
// tested without pulling in @bash-fighter/render's barrel export (which
// hud.ts needs for PALETTE, but which also re-exports spectator-camera.ts
// -- a module with TypeScript parameter-property syntax that Node's
// built-in --test type-stripping cannot parse). Keeping this text logic
// import-free means its regression test (packages/app/test/hud-survivors.test.ts)
// doesn't depend on that unrelated module loading cleanly.
export function survivorsLineText(survivors: number, total: number, timedBrawl: boolean): string {
  return !timedBrawl && total > 2 ? `${survivors} / ${total} remaining` : '';
}
