// One shared visual language for the whole game: dark, high-contrast,
// slightly austere. No gradients, no neon glow — flat fills, crisp edges.
export const PALETTE = {
  background: 0x0b0d10,
  stageFill: 0x1c2026,
  stageEdge: 0xe8e6df,
  blastZone: 0x3a1418,
  gridLine: 0x14171b,
  hud: 0xe8e6df,
  hudDim: 0x8a8f98,
  danger: 0xd7593f,
  fighters: [0xe8b23c, 0x4fa3c4] as const, // P1 amber, P2 cyan-blue
  fighterOutline: 0x0b0d10,
  hitbox: 0xd7593f,
  hurtbox: [0xf0cf7c, 0x9cc9de] as const, // per-owner, dimmer than fill
  debugText: 0xe8e6df,
  // Items/hazards (this task): kept in the same austere flat-fill
  // vocabulary as everything else -- distinct per item type by silhouette
  // first, colour second, never by colour alone.
  itemThrown: 0xc9c3b4, // Debug Rock: pale stone
  itemBat: 0xb7803e, // wood-brown bat
  itemBomb: 0x2c2f33, // dark shell, danger stripe drawn separately
  itemHeal: 0x6fae72, // muted green cross
  itemOutline: 0x0b0d10,
  hazardFill: 0x5a5f66, // falling debris: cold grey rock
  hazardOutline: 0x0b0d10,
  hazardWarning: 0xe8b23c, // telegraph marker, reuses the amber accent (not danger red, which means "already hurts you")
} as const;

export const FONT_FAMILY = '"Iosevka", "JetBrains Mono", ui-monospace, monospace';
export const UI_FONT_FAMILY = '"Inter", "Segoe UI", system-ui, sans-serif';
