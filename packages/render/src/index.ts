// packages/render: PixiJS/WebGL2 renderer. Reads sim state (already
// interpolated by the caller) and draws it; never mutates sim state.
// Built for N fighters — the sim milestone is fixed at 2, but nothing
// here hardcodes that so the renderer isn't what blocks 20-player FFA.
import { Application, Container, Graphics, Text } from 'pixi.js';
import { fixed as fx, FighterStateId, findMove, windowAtFrame, type CharacterData, type FighterStateValue } from '@bash-fighter/sim';
import { PALETTE, FONT_FAMILY } from './palette.ts';
import { computeCamera, worldToScreen, type ArenaBounds, type CameraConfig, type CameraView } from './camera.ts';
import { drawStage, type StageBounds } from './stage.ts';
import { FighterSprite } from './fighter-sprite.ts';
import { ItemSprite } from './item-sprite.ts';
import { HazardSprite } from './hazard-sprite.ts';
import { drawDebugBoxes, makeDebugText, formatDebugText, type DebugFighterInput } from './debug-overlay.ts';
import { EffectsLayer } from './effects.ts';
import { resolveAnimation } from '@bash-fighter/content';

export { RenderItemTypeId } from './item-sprite.ts';
export { EffectsLayer, type HitEffectInput, setReducedMotion, isReducedMotion } from './effects.ts';

export type { StageBounds, StagePlatform } from './stage.ts';
export { arenaDataToStageBounds } from './arena-adapter.ts';
export type { ArenaBounds, CameraView, CameraConfig } from './camera.ts';
export { computeCamera, worldToScreen } from './camera.ts';
export { computeFollowCamera, computeOverviewCamera, SmoothedCamera, type FollowConfig } from './spectator-camera.ts';
export { PALETTE, FONT_FAMILY, UI_FONT_FAMILY } from './palette.ts';
export { renderCharacterIcon } from './character-icon.ts';

/** One fighter's render-ready state: world-space floats, already
 * interpolated between the two most recent sim ticks by the app layer. */
export interface RenderFighterState {
  x: number;
  y: number;
  facing: 1 | -1;
  state: FighterStateValue;
  moveId: number;
  moveFrame: number;
  percent: number; // Fixed
  stocks: number;
  shieldHealth: number; // Fixed
  hitstun: number;
  /** Match-level elimination (battle-royale "out"), distinct from the
   * sim's per-life DEAD state. An eliminated fighter is never drawn. */
  eliminated?: boolean;
  /** Taking ring (out-of-bounds) damage this tick -- the 2026-09-10 pressure
   * redesign. Drives the red pulse overlay in drawFighters. */
  inRingDanger?: boolean;
}

/** One item's render-ready state: world-space floats, already read from
 * sim.getItem(slot) by the app layer. `active: false` slots are skipped
 * by the renderer (pool entry hidden), same convention as fighters. */
export interface RenderItemState {
  active: boolean;
  typeId: number;
  x: number;
  y: number;
  held: boolean;
  holderFacing: 1 | -1;
  armed: boolean;
  fuseTicks: number;
}

/** One hazard's render-ready state, from sim.getHazard(slot). halfWidth
 * is a stylized world-unit marker size chosen by the app layer for
 * legibility, same convention as FighterSprite's BODY_WIDTH (not a
 * pixel-exact readout of the sim's hazard hitbox). */
export interface RenderHazardState {
  active: boolean;
  x: number;
  y: number;
  halfWidth: number;
}

/** A hit/elimination the app layer observed this tick, queued for the
 * renderer to translate from world to screen space using this frame's own
 * camera (the app layer does not know the camera, on purpose -- the
 * renderer stays the only thing that computes it). Presentation-only:
 * consumed once per render() call and never fed back into the sim. */
export interface PendingHitEffect {
  fighterIndex: number;
  worldX: number;
  worldY: number;
  dirX: number; // world-space direction (Y-up), need not be normalized
  dirY: number;
  strength: number; // 0..1
  strong: boolean; // true = heavy hit, drives longer flash + optional freeze
}

export interface PendingEliminationEffect {
  worldX: number;
  worldY: number;
}

export interface RenderFrame {
  fighters: readonly RenderFighterState[];
  characters: readonly CharacterData[];
  items?: readonly RenderItemState[];
  hazards?: readonly RenderHazardState[];
  tick: number;
  hash: string;
  /** Live arena bounds (e.g. a shrinking battle-royale blast zone) to
   * draw and frame instead of the static stage bounds. Falls back to the
   * Renderer's static StageBounds-derived arena when omitted. */
  liveArenaBounds?: ArenaBounds;
  /** Where the blast-zone boundary will be at a fixed lookahead (app
   * layer decides how far ahead -- see PREVIEW_LOOKAHEAD_TICKS in
   * packages/app). Drawn as a fainter amber preview line/band so a
   * player can see the boundary they need to react to, not just the one
   * they're already at. Omit or null when the mode has no shrink, or
   * once the shrink has already fully closed. */
  previewArenaBounds?: ArenaBounds | null;
  /** When set, the renderer paints with this exact camera instead of
   * computing its own fit-everyone camera. This is how the app layer's
   * spectator camera (follow / overview / smoothed) takes over — the
   * renderer stays a dumb painter and never decides spectate policy. */
  cameraOverride?: CameraView;
  /** Hit/block/elimination effects observed since the last render() call. */
  hitEffects?: readonly PendingHitEffect[];
  eliminationEffects?: readonly PendingEliminationEffect[];
  /** Index into `fighters` of this client's own fighter, if any (absent
   * while spectating). Draws a persistent above-head marker so the local
   * player stays findable in a 20-fighter crowd. Presentation-only. */
  localPlayerIndex?: number;
  /** Wall-clock ms to hold the previous frame's drawing before applying
   * new positions this call -- a presentation-only "freeze frame" on a
   * strong hit. Renderer decides internally how long based on strength;
   * the app layer only tells it a strong hit happened via hitEffects. */
}

// How far above the tallest platform / below the ground a fighter can
// still meaningfully go (double-jump apex, a hard landing) and therefore
// still needs to stay on screen. Derived from packages/sim's jump
// constants (JUMP_VELOCITY/DOUBLE_JUMP_VELOCITY vs GRAVITY give an apex
// a little under 200 world units above a jump's start), not guessed —
// rounded up for headroom. This is presentation framing only; it never
// changes where a fighter can actually stand or die.
const JUMP_HEADROOM_WORLD = 200;
const FALL_HEADROOM_WORLD = 90;

/** The camera's "always show at least this much" floor used to be the
 * *entire* blast zone — a battle-royale arena's blast zone is sized with
 * a huge margin above/below the platforms specifically so a shrinking
 * arena has room to close (see battle-royale-20/data.ts), which meant
 * the baseline camera permanently framed a stage-sized band of empty sky
 * and empty pit that no fighter ever legibly occupies. The actual
 * fought-over space is the platforms plus enough headroom to see a jump
 * or a hard fall coming — that is what the camera should never zoom
 * tighter than. Intersected with the *live* (possibly shrunk) blast rect
 * so the floor honestly shrinks as the collapsing arena does, instead of
 * permanently reserving room for a blast zone that no longer exists. */
function framingFloor(stage: StageBounds, viewWidth: number, viewHeight: number): ArenaBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of stage.platforms) {
    minX = Math.min(minX, p.minX);
    maxX = Math.max(maxX, p.maxX);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) {
    // No platform data (e.g. a bare test fixture) — fall back to the
    // full blast rect rather than an empty/inverted floor.
    return { minX: stage.blastMinX, maxX: stage.blastMaxX, minY: stage.blastMinY, maxY: stage.blastMaxY };
  }
  minY -= FALL_HEADROOM_WORLD;
  maxY += JUMP_HEADROOM_WORLD;

  // The "fought-over space plus jump/fall headroom" box computed above
  // has whatever aspect ratio the stage's own geometry happens to
  // produce, which on every current stage does not match the viewport's
  // (see wiki "Camera Framing and Start Screen Composition 2026-09-10"):
  // battle-royale-20 and the-undercroft are wide relative to their
  // headroom (viewport ends up X-bound, leaving a dead band above or
  // below the action), while the-spire is comparatively tall (viewport
  // ends up Y-bound, leaving dead bands left and right). Pad whichever
  // axis is short so the box's aspect ratio matches the viewport's
  // before it is ever handed to computeCamera — that is what actually
  // fills the screen with the arena instead of leaving letterboxing,
  // without ever changing what a fighter can reach (presentation only).
  // Vertical padding keeps the existing fall:jump ratio (a hard landing
  // needs less warning room than a rising jump); horizontal padding is
  // split evenly since there's no equivalent asymmetry left-to-right.
  const viewportAspect = viewWidth / viewHeight;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const naturalAspect = spanX / spanY;
  if (naturalAspect > viewportAspect) {
    // Wider than the viewport needs — the viewport will be X-bound;
    // grow the vertical span to match so there's no dead band top/bottom.
    const desiredSpanY = spanX / viewportAspect;
    const extra = Math.max(0, desiredSpanY - spanY);
    const fallShare = FALL_HEADROOM_WORLD / (FALL_HEADROOM_WORLD + JUMP_HEADROOM_WORLD);
    minY -= extra * fallShare;
    maxY += extra * (1 - fallShare);
  } else if (naturalAspect < viewportAspect) {
    // Taller than the viewport needs — the viewport will be Y-bound;
    // grow the horizontal span to match so there's no dead band left/right.
    const desiredSpanX = spanY * viewportAspect;
    const extra = Math.max(0, desiredSpanX - spanX);
    minX -= extra / 2;
    maxX += extra / 2;
  }

  // Never claim more than the live blast rect actually covers — this is
  // what makes the floor shrink correctly as the collapsing arena closes
  // in, rather than permanently framing the arena's original footprint.
  return {
    minX: Math.max(minX, stage.blastMinX),
    maxX: Math.min(maxX, stage.blastMaxX),
    minY: Math.max(minY, stage.blastMinY),
    maxY: Math.min(maxY, stage.blastMaxY),
  };
}

// Fighters spread by roughly a screen-width during normal play; a
// paddingWorld a bit smaller than the arena keeps the baseline "whole
// fought-over space" framing as the default rather than the exception.
// minScale keeps fighters legible even on a wide arena; maxScale stops
// the camera slamming in when fighters stand still.
function cameraConfig(stage: StageBounds, viewWidth: number, viewHeight: number): CameraConfig {
  return {
    viewWidth,
    viewHeight,
    minScale: 1.6,
    maxScale: 5.5,
    paddingWorld: 20,
    arena: framingFloor(stage, viewWidth, viewHeight),
  };
}

function mainGroundY(stage: StageBounds): number {
  return stage.platforms[0]?.y ?? 0;
}

/** A badge's screen-space vertical offset above its fighter's head
 * scales with camera zoom (so it still reads as "attached" whether the
 * camera is pulled back for a 20-fighter spread or zoomed in for a
 * final-two showdown), but is clamped so it can never balloon into the
 * "floating 50-60px above everyone, disconnected from any body" defect
 * this replaces. */
const BADGE_OFFSET_MIN_PX = 12;
const BADGE_OFFSET_MAX_PX = 22;
function clampHeadOffsetPx(px: number): number {
  return Math.min(BADGE_OFFSET_MAX_PX, Math.max(BADGE_OFFSET_MIN_PX, px));
}

interface BadgeCandidate {
  slot: number;
  isLocalPlayer: boolean;
  headX: number;
  headY: number;
}

interface BadgeBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function boxesOverlap(a: BadgeBox, b: BadgeBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

const BADGE_FONT_SIZE = 13;
// Rough monospace glyph width at BADGE_FONT_SIZE, used only to build an
// approximate collision box -- no need for exact text metrics here.
const BADGE_CHAR_WIDTH_PX = 8;
const BADGE_BOX_HEIGHT_PX = 16;
const BADGE_BOX_MARGIN_PX = 3;

function badgeBox(x: number, y: number, digits: number): BadgeBox {
  const halfWidth = (digits * BADGE_CHAR_WIDTH_PX) / 2 + BADGE_BOX_MARGIN_PX;
  return {
    left: x - halfWidth,
    right: x + halfWidth,
    top: y - BADGE_BOX_HEIGHT_PX - BADGE_BOX_MARGIN_PX,
    bottom: y + BADGE_BOX_MARGIN_PX,
  };
}

const PLAYER_COLOR_COUNT = PALETTE.playerColors.length;

// How far inside the current blast-zone boundary the local player's own
// edge-danger ring (fighter-sprite.ts's drawEdgeWarning) starts ramping
// up. World units, not pixels, so it scales correctly as the boundary
// shrinks. Picked against the default arena's ~260/120-unit half-extents
// and the ~55%-of-original final shrink size (packages/sim/src/
// arena-shrink.ts's FINAL_SHRINK_FRACTION): 55 units is close enough to
// the edge that it doesn't fire mid-stage, but far enough to give a
// player time to react even once the arena has mostly closed.
const EDGE_WARN_DISTANCE_WORLD = 55;

/** 0 = comfortably inside the boundary, 1 = at or past it. Distance is to
 * the *nearest* edge of the current (not preview) blast rect, since a
 * player standing near a corner is close to two edges. Cheap: four
 * subtractions and a min/max, called once per frame for the local
 * player only (never for the other 19 fighters). */
export function computeEdgeDangerFrac(x: number, y: number, stage: StageBounds): number {
  const distLeft = x - stage.blastMinX;
  const distRight = stage.blastMaxX - x;
  const distBottom = y - stage.blastMinY;
  const distTop = stage.blastMaxY - y;
  const nearest = Math.min(distLeft, distRight, distBottom, distTop);
  if (nearest <= 0) return 1; // already outside on at least one axis
  return Math.max(0, 1 - nearest / EDGE_WARN_DISTANCE_WORLD);
}

export class Renderer {
  readonly app = new Application();
  private ready = false;
  private debugOn = false;

  private readonly world = new Container();
  private readonly stageLayer = new Graphics();
  private readonly debugLayer = new Graphics();
  private readonly sprites: FighterSprite[] = [];
  private readonly spriteContainer = new Container();
  private readonly itemSprites: ItemSprite[] = [];
  private readonly itemContainer = new Container();
  private readonly hazardSprites: HazardSprite[] = [];
  private readonly hazardContainer = new Container();
  // Slot-number badges live in screen space, as direct children of
  // app.stage rather than `world` -- world-space text scales with camera
  // zoom (unreadably tiny zoomed out, absurdly offset zoomed in) and
  // cannot be selectively hidden to avoid overlap without knowing final
  // screen positions first. See layoutBadges() below.
  private readonly badgeContainer = new Container();
  private readonly badgeTexts: Text[] = [];
  private readonly debugText = makeDebugText();
  private stageBounds: StageBounds;
  private readonly effects = new EffectsLayer();
  private lastFrameTimeMs: number | null = null;
  // Freeze-frame ("hitstop") state: purely a rendering hold -- the sim
  // keeps advancing at 60Hz underneath regardless. See render()'s early
  // return. Duration is short and capped so it reads as a punch landing,
  // not as lag.
  private freezeRemainingMs = 0;

  constructor(stageBounds: StageBounds) {
    this.stageBounds = stageBounds;
  }

  /** Swap the static arena the renderer draws, e.g. once an online match's
   * real arena (createMatchSim's BATTLE_ROYALE_20_ARENA) is known, after
   * the Renderer had to be constructed earlier with a placeholder. */
  setStageBounds(stageBounds: StageBounds): void {
    this.stageBounds = stageBounds;
  }

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: parent,
      background: PALETTE.background,
      antialias: true,
      preference: 'webgl',
    });
    parent.appendChild(this.app.canvas);

    this.world.addChild(this.stageLayer);
    this.world.addChild(this.hazardContainer);
    this.world.addChild(this.spriteContainer);
    this.world.addChild(this.itemContainer);
    this.world.addChild(this.effects.root);
    this.world.addChild(this.debugLayer);
    this.app.stage.addChild(this.world);

    this.debugText.position.set(10, 130);
    this.debugText.visible = false;
    this.app.stage.addChild(this.debugText);
    this.app.stage.addChild(this.badgeContainer);

    this.ready = true;
  }

  setDebug(on: boolean): void {
    this.debugOn = on;
    this.debugText.visible = on;
  }

  isDebug(): boolean {
    return this.debugOn;
  }

  get viewSize(): { width: number; height: number } {
    return { width: this.app.renderer.width, height: this.app.renderer.height };
  }

  /** Pool a sprite per fighter slot — created once, reused every frame so
   * a 20-fighter FFA doesn't allocate PIXI objects per tick. */
  private ensureSpritePool(count: number): void {
    while (this.sprites.length < count) {
      const sprite = new FighterSprite(this.sprites.length % PLAYER_COLOR_COUNT);
      this.sprites.push(sprite);
      this.spriteContainer.addChild(sprite.root);
    }
    for (let i = count; i < this.sprites.length; i++) {
      (this.sprites[i] as FighterSprite).root.visible = false;
    }
  }

  private ensureItemPool(count: number): void {
    while (this.itemSprites.length < count) {
      const sprite = new ItemSprite();
      this.itemSprites.push(sprite);
      this.itemContainer.addChild(sprite.root);
    }
    for (let i = count; i < this.itemSprites.length; i++) {
      (this.itemSprites[i] as ItemSprite).root.visible = false;
    }
  }

  private ensureHazardPool(count: number): void {
    while (this.hazardSprites.length < count) {
      const sprite = new HazardSprite();
      this.hazardSprites.push(sprite);
      this.hazardContainer.addChild(sprite.root);
    }
    for (let i = count; i < this.hazardSprites.length; i++) {
      (this.hazardSprites[i] as HazardSprite).root.visible = false;
    }
  }

  private ensureBadgePool(count: number): void {
    while (this.badgeTexts.length < count) {
      const text = new Text({
        text: '',
        style: { fontFamily: FONT_FAMILY, fontSize: BADGE_FONT_SIZE, fill: PALETTE.hud, fontWeight: '700' },
      });
      text.anchor.set(0.5, 1);
      text.resolution = 2;
      this.badgeTexts.push(text);
      this.badgeContainer.addChild(text);
    }
    for (let i = count; i < this.badgeTexts.length; i++) {
      (this.badgeTexts[i] as Text).visible = false;
    }
  }

  /** Places the slot-number badges in screen space, attached directly
   * above each fighter's own head, and greedily drops any badge that
   * would overlap one already placed.
   *
   * This is the fix for the "1714 6" defect: in the old world-space
   * version every badge was always drawn, so a bunched-up crowd produced
   * overlapping runs of digits that read as garbage. Text is unreadable
   * once it overlaps -- there is no useful partial state between "clear"
   * and "illegible" -- so once two badges would collide, showing only
   * one of them is strictly more informative than showing a smear of
   * both. The local player's own badge is exempt from being dropped (it
   * is the one identity cue this player actually needs every frame) and
   * is placed first, reserving its space so nearby badges yield to it
   * rather than the other way around. Remaining badges are placed in
   * order of distance to the local player, so in a crowded scrum the
   * badges that survive are the ones for whoever is actually nearby --
   * exactly the fighters this player is about to fight or be hit by. */
  private layoutBadges(candidates: BadgeCandidate[]): void {
    this.ensureBadgePool(candidates.length);

    const local = candidates.find((c) => c.isLocalPlayer);
    const ordered = [...candidates].sort((a, b) => {
      if (a.isLocalPlayer !== b.isLocalPlayer) return a.isLocalPlayer ? -1 : 1;
      const da = local ? Math.hypot(a.headX - local.headX, a.headY - local.headY) : 0;
      const db = local ? Math.hypot(b.headX - local.headX, b.headY - local.headY) : 0;
      return da - db;
    });

    const placedBoxes: BadgeBox[] = [];
    let textIndex = 0;
    for (const c of ordered) {
      const label = String(c.slot + 1);
      const box = badgeBox(c.headX, c.headY, label.length);
      const overlaps = !c.isLocalPlayer && placedBoxes.some((p) => boxesOverlap(p, box));
      if (overlaps) continue;
      placedBoxes.push(box);
      const text = this.badgeTexts[textIndex] as Text;
      textIndex += 1;
      text.text = label;
      text.position.set(c.headX, c.headY);
      text.visible = true;
      // The local player's own badge gets the same bright fill as the
      // rest for consistency, but a slightly larger size so it is the
      // one badge a player can find at a glance without reading digits.
      text.style.fontSize = c.isLocalPlayer ? BADGE_FONT_SIZE + 3 : BADGE_FONT_SIZE;
    }
    for (let i = textIndex; i < this.badgeTexts.length; i++) {
      (this.badgeTexts[i] as Text).visible = false;
    }
  }

  render(frame: RenderFrame): void {
    if (!this.ready) return;

    const now = performance.now();
    const dtMs = this.lastFrameTimeMs === null ? 16.6667 : Math.min(50, now - this.lastFrameTimeMs);
    this.lastFrameTimeMs = now;

    const { width: vw, height: vh } = this.viewSize;
    const liveFighters = frame.fighters.filter((f) => !f.eliminated);
    this.ensureSpritePool(frame.fighters.length);

    const stageForDraw: StageBounds = frame.liveArenaBounds
      ? {
          ...this.stageBounds,
          blastMinX: frame.liveArenaBounds.minX,
          blastMaxX: frame.liveArenaBounds.maxX,
          blastMinY: frame.liveArenaBounds.minY,
          blastMaxY: frame.liveArenaBounds.maxY,
        }
      : this.stageBounds;

    const cam =
      frame.cameraOverride ??
      computeCamera(
        liveFighters.map((f) => ({ x: f.x, y: f.y })),
        cameraConfig(stageForDraw, vw, vh),
      );

    // Translate any hit/elimination effects the app layer observed since
    // the last render() call into screen space using *this* frame's
    // camera, then hand them to the effects layer. This is the only place
    // world coordinates ever get turned into shake/particle positions.
    // DEV-ONLY debug hook, inert unless a developer explicitly sets
    // window.__debugFreezeOnNextEffect = true from the console/devtools
    // (e.g. via a browser_batch javascript step right before landing a
    // hit while testing). Lets you screenshot a live flash/spark/shake
    // frame despite screenshot round-trip latency exceeding the effect's
    // natural lifetime. Ships inert: this block only ever does anything
    // if that global was set, which nothing in the app does on its own.
    const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : undefined;
    if (win?.__debugUnfreeze) {
      this.freezeRemainingMs = 0;
      win.__debugUnfreeze = false;
    }

    for (const hit of frame.hitEffects ?? []) {
      const screen = worldToScreen(hit.worldX, hit.worldY, cam, vw, vh);
      // Direction is a vector, not a point: flip Y (world Y-up -> screen
      // Y-down) without translating.
      this.effects.spawnHit({ x: screen.x, y: screen.y, dirX: hit.dirX, dirY: -hit.dirY, strength: hit.strength });
      this.effects.flashFighter(hit.fighterIndex, hit.strong);
      if (hit.strong) this.freezeRemainingMs = Math.max(this.freezeRemainingMs, 55);
    }
    for (const elim of frame.eliminationEffects ?? []) {
      const screen = worldToScreen(elim.worldX, elim.worldY, cam, vw, vh);
      this.effects.spawnElimination(screen.x, screen.y);
    }

    // Freeze-frame: hold the last drawn picture for a few milliseconds on
    // a strong hit. This never touches the sim -- it just skips this
    // render() call's redraw, so whatever was on screen a moment ago
    // stays there. Shake/particle timers still advance underneath so the
    // freeze blends into the shake rather than looking like a stall.
    if (this.freezeRemainingMs > 0) {
      this.freezeRemainingMs -= dtMs;
      this.effects.update(dtMs);
      return;
    }

    const shake = this.effects.update(dtMs);
    this.world.position.set(shake.x, shake.y);

    drawStage(this.stageLayer, stageForDraw, cam, vw, vh, frame.previewArenaBounds);

    const badgeCandidates: BadgeCandidate[] = [];
    for (let i = 0; i < frame.fighters.length; i++) {
      const f = frame.fighters[i] as RenderFighterState;
      const sprite = this.sprites[i] as FighterSprite;
      if (f.eliminated) {
        sprite.root.visible = false;
        continue;
      }
      sprite.root.visible = true;
      const screen = worldToScreen(f.x, f.y, cam, vw, vh);
      sprite.root.position.set(screen.x, screen.y);
      sprite.root.scale.set(cam.scale); // silhouette is drawn in world units
      const char = frame.characters[i] as CharacterData | undefined;
      const isLocalPlayer = frame.localPlayerIndex === i;
      sprite.draw({
        facing: f.facing,
        hitstun: f.hitstun,
        shieldActive: f.state === FighterStateId.SHIELD,
        shieldHealthFrac: fx.toFloat(f.shieldHealth) / 100,
        isDead: f.state === FighterStateId.DEAD,
        flashAmount: this.effects.flashAmount(i),
        characterName: char?.name,
        state: f.state,
        moveId: f.moveId,
        moveFrame: f.moveFrame,
        character: char,
        anim: char ? resolveAnimation(char.name) : undefined,
        isLocalPlayer,
        edgeDangerFrac: isLocalPlayer ? computeEdgeDangerFrac(f.x, f.y, stageForDraw) : undefined,
      });
      badgeCandidates.push({
        slot: i,
        isLocalPlayer,
        headX: screen.x,
        headY: screen.y - clampHeadOffsetPx(FighterSprite.HEAD_TOP_OFFSET_WORLD * cam.scale),
      });
    }
    this.layoutBadges(badgeCandidates);

    const hazards = frame.hazards ?? [];
    this.ensureHazardPool(hazards.length);
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i] as RenderHazardState;
      const sprite = this.hazardSprites[i] as HazardSprite;
      if (!h.active) {
        sprite.root.visible = false;
        continue;
      }
      sprite.root.visible = true;
      const screen = worldToScreen(h.x, h.y, cam, vw, vh);
      sprite.root.position.set(screen.x, screen.y);
      sprite.root.scale.set(cam.scale);
      sprite.draw({
        posX: h.x,
        posY: h.y,
        groundY: mainGroundY(stageForDraw),
        halfWidth: h.halfWidth,
      });
    }

    const items = frame.items ?? [];
    this.ensureItemPool(items.length);
    for (let i = 0; i < items.length; i++) {
      const it = items[i] as RenderItemState;
      const sprite = this.itemSprites[i] as ItemSprite;
      if (!it.active) {
        sprite.root.visible = false;
        continue;
      }
      sprite.root.visible = true;
      const screen = worldToScreen(it.x, it.y, cam, vw, vh);
      sprite.root.position.set(screen.x, screen.y);
      sprite.root.scale.set(cam.scale);
      sprite.draw({
        typeId: it.typeId,
        held: it.held,
        facing: it.holderFacing,
        armed: it.armed,
        fuseTicks: it.fuseTicks,
      });
    }

    if (this.debugOn) {
      const debugInputs: DebugFighterInput[] = frame.fighters
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => !f.eliminated)
        .map(({ f, i }) => ({
          x: f.x,
          y: f.y,
          facing: f.facing,
          state: f.state,
          moveId: f.moveId,
          moveFrame: f.moveFrame,
          percent: f.percent,
          character: frame.characters[i] as CharacterData,
        }));
      drawDebugBoxes(this.debugLayer, debugInputs, cam, vw, vh);
      this.debugText.text = formatDebugText(debugInputs, frame.tick, frame.hash);
    } else {
      this.debugLayer.clear();
    }

    // DEV-ONLY debug freeze trigger: only arms *after* this frame -- which
    // just drew the flash/spark/shake/elimination-ring -- has been fully
    // rendered, so the frozen picture is the effect itself, not the frame
    // before it. See the __debugUnfreeze check near the top of render().
    if (win?.__debugFreezeOnNextEffect && ((frame.hitEffects?.length ?? 0) > 0 || (frame.eliminationEffects?.length ?? 0) > 0)) {
      win.__debugFreezeOnNextEffect = false;
      this.freezeRemainingMs = Number.POSITIVE_INFINITY; // held until __debugUnfreeze is set
    }

    // DEV-ONLY debug freeze trigger: window.__debugFreezeOnAttackActive = true
    // arms a freeze for the first frame, from now on, where any fighter is
    // in the ATTACK state with moveFrame inside that move's real 'active'
    // (hitbox-live) window -- read via the sim's own findMove/windowAtFrame,
    // the exact lookup fighter-pose.ts uses to pose the swing. Exists only
    // to let a slow remote screenshot tool land on the one frame that
    // proves (or disproves) that the animated swing is on-screen while the
    // hitbox is actually live, not before or after it. Inert unless a
    // developer sets the flag from devtools/a debug console; reads frame
    // state only, never writes to the sim, and does not touch the fixed
    // 60Hz advance() cadence -- it only ever holds *rendering* of already-
    // simulated frames, same mechanism as __debugFreezeOnNextEffect above.
    if (win?.__debugFreezeOnAttackActive) {
      for (let i = 0; i < frame.fighters.length; i++) {
        const f = frame.fighters[i];
        if (!f || f.eliminated || f.state !== FighterStateId.ATTACK) continue;
        const character = frame.characters[i] as CharacterData | undefined;
        if (!character) continue;
        const move = findMove(character, f.moveId as never);
        if (!move) continue;
        // sim.ts's resolveHitsFor: moveFrame was already incremented for
        // this tick before hit resolution runs, so the window that was
        // actually live is at (moveFrame - 1), not moveFrame. Match that
        // convention here too or this debug trigger fires one frame late.
        const found = windowAtFrame(move, f.moveFrame - 1);
        if (found?.window.kind === 'active') {
          win.__debugFreezeOnAttackActive = false;
          this.freezeRemainingMs = Number.POSITIVE_INFINITY;
          break;
        }
      }
    }
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
