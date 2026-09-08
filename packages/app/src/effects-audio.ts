// Bridges detected EffectEvents to (a) renderer-facing PendingHitEffect/
// PendingEliminationEffect queues in world space, and (b) AudioManager
// playback. One instance per Match/NetMatch. Presentation-only: consumes
// events, never mutates sim state.
import { fixed as fx, type FighterSnapshot } from '@bash-fighter/sim';
import type { PendingHitEffect, PendingEliminationEffect } from '@bash-fighter/render';
import { AudioManager } from '@bash-fighter/audio';
import type { EffectEvent } from './effects-events.ts';

export class EffectsAudioBridge {
  constructor(private readonly audio: AudioManager) {}

  /** Consumes this tick/snapshot's events against the *current* fighter
   * snapshots (for world position) and returns what the renderer should
   * draw. Also fires the matching sounds, each event exactly once. */
  consume(
    events: readonly EffectEvent[],
    currFighters: readonly FighterSnapshot[],
  ): { hitEffects: PendingHitEffect[]; eliminationEffects: PendingEliminationEffect[] } {
    const hitEffects: PendingHitEffect[] = [];
    const eliminationEffects: PendingEliminationEffect[] = [];

    for (const ev of events) {
      if (ev.type === 'hit') {
        const f = currFighters[ev.fighterIndex];
        if (!f) continue;
        hitEffects.push({
          fighterIndex: ev.fighterIndex,
          worldX: fx.toFloat(f.posX),
          worldY: fx.toFloat(f.posY),
          dirX: ev.dirX,
          dirY: ev.dirY,
          strength: ev.strength,
          strong: ev.strong,
        });
        this.audio.play(ev.strong ? 'hit_heavy' : ev.medium ? 'hit_medium' : 'hit_light', {
          gain: 0.5 + ev.strength * 0.5,
        });
      } else if (ev.type === 'block') {
        this.audio.play('shield_block');
      } else if (ev.type === 'eliminated') {
        const f = currFighters[ev.fighterIndex];
        if (f) eliminationEffects.push({ worldX: fx.toFloat(f.posX), worldY: fx.toFloat(f.posY) });
        this.audio.play('elimination');
      } else if (ev.type === 'itemPickup') {
        this.audio.play('item_pickup');
      } else if (ev.type === 'itemUse') {
        this.audio.play('item_use_explosion');
      } else if (ev.type === 'jump') {
        this.audio.play('jump', { gain: 0.55 });
      }
    }

    return { hitEffects, eliminationEffects };
  }
}
