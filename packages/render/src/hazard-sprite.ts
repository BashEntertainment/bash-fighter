// Falling-debris hazard silhouette (this task): must be TELEGRAPHED, not
// just drawn, or a stage hazard reads as a bug rather than a threat.
//
// The sim (packages/sim/src/hazards) has no separate "warning" state --
// a hazard is ACTIVE and already falling the instant it spawns, dropped
// from the top of the current blast rect (see HazardSnapshot: active,
// posX, posY, velY, timer). There is no sim field that means "this is
// still just a warning, not yet dangerous".
//
// So the warning here is an honest approximation built only from state
// the sim already exposes, not invented sim behaviour: the fall itself,
// from the top of the arena to the ground, IS the wind-up window (it
// takes real time to arrive). While the rock is above a "danger
// altitude" near the ground we draw only a ground-level marker at its
// landing X (a hollow ring that pulses) -- a shadow/target reticle -- so
// a fighter sees exactly where it will land before it is close enough to
// hurt them. Once it crosses into the danger band near the ground, the
// rock itself becomes the visible threat: filled shadow, solid danger
// outline. This never changes when or where the hazard actually deals
// damage -- it only chooses when to draw the calm marker vs. the alarmed
// one, both computed from posY/groundY which the sim already reports.
import { Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';

export interface HazardVisualState {
  posX: number; // world
  posY: number; // world
  groundY: number; // world, from StageBounds
  /** World-space half-extent, matches the sim's hazard boxWidth/2 so the
   * shadow/impact marker lines up with where the hitbox actually is. */
  halfWidth: number;
}

// Below this height above the ground the rock is close enough that its
// own falling silhouette becomes the primary read, on top of the marker.
const DANGER_ALTITUDE_WORLD = 40;

export class HazardSprite {
  readonly root = new Graphics();
  private pulseT = 0;

  draw(state: HazardVisualState): void {
    const g = this.root;
    g.clear();
    this.pulseT += 1;

    const heightAboveGround = state.posY - state.groundY;
    const inWarningPhase = heightAboveGround > DANGER_ALTITUDE_WORLD;

    // Ground-level landing marker: always shown once falling, position
    // fixed under the rock's current X (it falls straight down, so this
    // already tells a fighter exactly where to not stand). Pulses to draw
    // the eye; the pulse speeds up as danger gets closer.
    const pulseSpeed = inWarningPhase ? 0.05 : 0.12;
    const pulse = 0.55 + 0.45 * Math.sin(this.pulseT * pulseSpeed);
    const markerY = state.groundY; // drawn in the hazard's own local space, see index.ts placement
    const dy = markerY - state.posY; // offset from rock to ground, local units

    g.ellipse(0, dy, state.halfWidth, state.halfWidth * 0.35);
    g.stroke({ color: PALETTE.hazardWarning, width: 2, alpha: inWarningPhase ? pulse : 0.9 });
    if (!inWarningPhase) {
      g.ellipse(0, dy, state.halfWidth, state.halfWidth * 0.35);
      g.fill({ color: PALETTE.danger, alpha: 0.25 });
    }

    // The rock itself: only drawn once it is close enough to the ground
    // to be the imminent threat, not from the moment it spawns off the
    // top of the screen -- keeps the warning marker as the thing a
    // fighter reacts to first.
    if (!inWarningPhase) {
      const r = state.halfWidth * 0.9;
      g.poly([-r, r * 0.5, -r * 0.4, -r, r * 0.5, -r * 0.7, r, r * 0.2, r * 0.2, r]);
      g.fill({ color: PALETTE.hazardFill });
      g.stroke({ color: PALETTE.hazardOutline, width: 1.5 });
    } else {
      // Small dot far above so the object itself is still faintly visible
      // approaching, not just its marker.
      g.circle(0, 0, 3);
      g.fill({ color: PALETTE.hazardFill, alpha: 0.8 });
    }
  }
}
