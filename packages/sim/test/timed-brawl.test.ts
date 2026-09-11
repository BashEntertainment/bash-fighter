// Timed Brawl ('timedKO') mode: mode selection/defaults, the match clock
// ending the match, respawn behaviour, KO scoring (including the
// self-destruct rationale below), and tie resolution. See wiki "Timed
// Brawl Mode 2026-09-11".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, FighterField } from '../src/sim.ts';
import { makeInputFrame } from '../src/types.ts';
import * as fx from '../src/math/fixed.ts';
import { resolveMatchSettings, respawnsEnabled, DEFAULT_MATCH_SETTINGS } from '../src/match-settings.ts';
import { FighterStateId } from '../src/entities/fighter.ts';
import { PLACEHOLDER_CHARACTER } from '../../content/src/characters/placeholder/data.ts';

const CHARACTERS = [PLACEHOLDER_CHARACTER, PLACEHOLDER_CHARACTER] as const;
const NEUTRAL = makeInputFrame(0, 0, 0);

describe('Timed Brawl: mode selection and defaults', () => {
  it('battleRoyale is still the default win condition (production default unchanged)', () => {
    assert.equal(DEFAULT_MATCH_SETTINGS.winCondition, 'battleRoyale');
    assert.equal(resolveMatchSettings({}).winCondition, 'battleRoyale');
  });

  it('timedKO enables respawns; battleRoyale and stocks do not', () => {
    assert.equal(respawnsEnabled(resolveMatchSettings({ winCondition: 'timedKO' })), true);
    assert.equal(respawnsEnabled(resolveMatchSettings({ winCondition: 'battleRoyale' })), false);
    assert.equal(respawnsEnabled(resolveMatchSettings({ winCondition: 'stocks' })), false);
  });

  it('timedKO does not shrink the arena by default (no funneling ring in a respawn mode)', () => {
    assert.equal(resolveMatchSettings({ winCondition: 'timedKO' }).arenaShrink, false);
  });
});

describe('Timed Brawl: the match clock ends the match', () => {
  it('isMatchOver becomes true exactly at timeLimitTicks, not before', () => {
    const sim = new Sim(1, 2, CHARACTERS, undefined, {
      winCondition: 'timedKO',
      timeLimitTicks: 50,
    });
    for (let t = 0; t < 50; t++) {
      assert.equal(sim.isMatchOver(), false, `should still be running at tick ${t}`);
      sim.advance([NEUTRAL, NEUTRAL]);
    }
    assert.equal(sim.isMatchOver(), true);
  });
});

describe('Timed Brawl: respawn behaviour', () => {
  it('a KO in timedKO respawns the loser (RESPAWN then back to IDLE) instead of eliminating them', () => {
    const sim = new Sim(2, 2, CHARACTERS, undefined, {
      winCondition: 'timedKO',
      timeLimitTicks: 6000,
      respawnDelayTicks: 10,
      respawnInvulnTicks: 20,
    });
    // Land a hit hard enough to KO fighter 1 immediately by driving its
    // percent up via direct state poke (isolates respawn behaviour from
    // needing a full combat sequence) then forcing a blast-zone exit.
    const buf = sim.createStateBuffer();
    sim.saveState(buf);
    const base1 = 1 * FighterField.FIELD_COUNT;
    buf[base1 + FighterField.POS_Y] = fx.fromInt(-500) as number; // far below the floor
    buf[base1 + FighterField.GROUNDED] = 0;
    buf[base1 + FighterField.LAST_ATTACKER] = 0;
    sim.loadState(buf);
    sim.advance([NEUTRAL, NEUTRAL]);
    const f1AfterKO = sim.getFighter(1);
    assert.equal(f1AfterKO.state, FighterStateId.RESPAWN, 'loser enters RESPAWN, not DEAD');
    assert.equal(sim.isMatchOver(), false, 'match keeps going -- respawn, not elimination');
    for (let t = 0; t < 10; t++) sim.advance([NEUTRAL, NEUTRAL]);
    const f1Respawned = sim.getFighter(1);
    assert.equal(f1Respawned.state, FighterStateId.IDLE, 'respawned fighter is back to IDLE and controllable');
    assert.equal(f1Respawned.percent, 0, 'respawned fighter starts back at 0%');
    assert.ok(f1Respawned.deathCount >= 1, 'death is counted for scoring/tie-break purposes');
  });

  it('a respawning fighter is briefly invulnerable', () => {
    const sim = new Sim(3, 2, CHARACTERS, undefined, {
      winCondition: 'timedKO',
      timeLimitTicks: 6000,
      respawnDelayTicks: 5,
      respawnInvulnTicks: 30,
    });
    const buf = sim.createStateBuffer();
    sim.saveState(buf);
    const base1 = 1 * FighterField.FIELD_COUNT;
    buf[base1 + FighterField.POS_Y] = fx.fromInt(-500) as number;
    buf[base1 + FighterField.GROUNDED] = 0;
    sim.loadState(buf);
    sim.advance([NEUTRAL, NEUTRAL]);
    for (let t = 0; t < 5; t++) sim.advance([NEUTRAL, NEUTRAL]);
    const base1After = 1 * FighterField.FIELD_COUNT;
    const buf2 = sim.createStateBuffer();
    sim.saveState(buf2);
    assert.ok((buf2[base1After + FighterField.INVULN_TIMER] as number) > 0, 'invulnerability window is active right after respawn');
  });
});

describe('Timed Brawl: KO scoring', () => {
  it('a genuine knockout credits the attacker with a KO', () => {
    const sim = new Sim(4, 2, CHARACTERS, undefined, {
      winCondition: 'timedKO',
      timeLimitTicks: 6000,
    });
    const buf = sim.createStateBuffer();
    sim.saveState(buf);
    const base1 = 1 * FighterField.FIELD_COUNT;
    buf[base1 + FighterField.LAST_ATTACKER] = 0;
    buf[base1 + FighterField.LAST_HIT_TICK] = 100; // "recent" once tick advances past this minus a small delta below
    sim.loadState(buf);
    // Bring tick close to the recorded hit so recentlyHit attribution holds.
    for (let t = 0; t < 100; t++) sim.advance([NEUTRAL, NEUTRAL]);
    const buf3 = sim.createStateBuffer();
    sim.saveState(buf3);
    buf3[base1 + FighterField.POS_Y] = fx.fromInt(-500) as number;
    buf3[base1 + FighterField.GROUNDED] = 0;
    buf3[base1 + FighterField.LAST_ATTACKER] = 0;
    buf3[base1 + FighterField.LAST_HIT_TICK] = sim.getTick();
    sim.loadState(buf3);
    sim.advance([NEUTRAL, NEUTRAL]);
    assert.equal(sim.getFighter(0).koCount, 1, 'attacker credited for a real knockout');
  });

  it('rationale: a self-destruct (falling with no recent hit) scores nobody -- not the victim as a self-penalty, and not '
    + 'whoever is nearby, since ring/fall causes have no real attacker (see EliminationEvent.attacker doc in sim.ts). '
    + 'A fighter who falls on their own therefore neither loses nor grants a point.', () => {
    const sim = new Sim(5, 2, CHARACTERS, undefined, {
      winCondition: 'timedKO',
      timeLimitTicks: 6000,
    });
    const buf = sim.createStateBuffer();
    sim.saveState(buf);
    const base1 = 1 * FighterField.FIELD_COUNT;
    buf[base1 + FighterField.POS_Y] = fx.fromInt(-500) as number; // walks/falls off with no attacker
    buf[base1 + FighterField.GROUNDED] = 0;
    buf[base1 + FighterField.LAST_ATTACKER] = -1;
    buf[base1 + FighterField.LAST_HIT_TICK] = -1;
    sim.loadState(buf);
    sim.advance([NEUTRAL, NEUTRAL]);
    assert.equal(sim.getFighter(0).koCount, 0, 'nobody else is credited for a self-destruct');
    assert.equal(sim.getFighter(1).koCount, 0, 'the fighter who self-destructed does not lose a point either -- deaths are tracked separately (deathCount) for tie-breaks, but koCount only ever goes up on a genuine knockout of someone else');
    assert.ok(sim.getFighter(1).deathCount >= 1);
  });
});

describe('Timed Brawl: tie resolution', () => {
  it('getWinner returns null (an explicit draw) when the top two are tied on KOs and deaths', () => {
    const sim = new Sim(6, 2, CHARACTERS, undefined, {
      winCondition: 'timedKO',
      timeLimitTicks: 10,
    });
    const buf = sim.createStateBuffer();
    sim.saveState(buf);
    const base0 = 0 * FighterField.FIELD_COUNT;
    const base1 = 1 * FighterField.FIELD_COUNT;
    buf[base0 + FighterField.KO_COUNT] = 2;
    buf[base1 + FighterField.KO_COUNT] = 2;
    buf[base0 + FighterField.DEATH_COUNT] = 1;
    buf[base1 + FighterField.DEATH_COUNT] = 1;
    sim.loadState(buf);
    while (!sim.isMatchOver()) sim.advance([NEUTRAL, NEUTRAL]);
    assert.equal(sim.getWinner(), null, 'a genuine tie is a draw, not silently awarded to the lower index');
    const board = sim.getLeaderboard();
    assert.equal(board.length, 2);
  });

  it('getWinner breaks a KO tie by fewer deaths, then returns a real winner', () => {
    const sim = new Sim(7, 2, CHARACTERS, undefined, {
      winCondition: 'timedKO',
      timeLimitTicks: 10,
    });
    const buf = sim.createStateBuffer();
    sim.saveState(buf);
    const base0 = 0 * FighterField.FIELD_COUNT;
    const base1 = 1 * FighterField.FIELD_COUNT;
    buf[base0 + FighterField.KO_COUNT] = 2;
    buf[base1 + FighterField.KO_COUNT] = 2;
    buf[base0 + FighterField.DEATH_COUNT] = 3;
    buf[base1 + FighterField.DEATH_COUNT] = 1; // fighter 1 died less: tie-break winner
    sim.loadState(buf);
    while (!sim.isMatchOver()) sim.advance([NEUTRAL, NEUTRAL]);
    assert.equal(sim.getWinner(), 1);
    assert.deepEqual(sim.getLeaderboard()[0], 1);
  });

  it('a clear KO-count leader wins outright', () => {
    const sim = new Sim(8, 2, CHARACTERS, undefined, {
      winCondition: 'timedKO',
      timeLimitTicks: 10,
    });
    const buf = sim.createStateBuffer();
    sim.saveState(buf);
    const base0 = 0 * FighterField.FIELD_COUNT;
    buf[base0 + FighterField.KO_COUNT] = 5;
    sim.loadState(buf);
    while (!sim.isMatchOver()) sim.advance([NEUTRAL, NEUTRAL]);
    assert.equal(sim.getWinner(), 0);
  });
});
