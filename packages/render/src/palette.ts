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
} as const;

export const FONT_FAMILY = '"Iosevka", "JetBrains Mono", ui-monospace, monospace';
export const UI_FONT_FAMILY = '"Inter", "Segoe UI", system-ui, sans-serif';
