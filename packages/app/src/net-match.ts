// Online play: connects to the authoritative server, predicts only the
// local fighter between snapshots, reconciles it against server state on
// every snapshot, and interpolates every remote fighter between the last
// two received snapshots. See docs/PROTOCOL.md for the wire format this
// implements against.
import {
  Sim,
  fixed as fx,
  makeInputFrame,
  MAX_ITEMS,
  MAX_HAZARDS,
  DEFAULT_ARENA,
  type FighterSnapshot,
  type InputFrame,
} from '@bash-fighter/sim';
import { PLACEHOLDER_CHARACTER, createMatchSim, resolveCharacterId, DEFAULT_CHARACTER_ID } from '@bash-fighter/content';
import type { CharacterData } from '@bash-fighter/sim';
import { InputManager } from '@bash-fighter/input';
import {
  Renderer,
  arenaDataToStageBounds,
  type RenderFighterState,
  type RenderItemState,
  type RenderHazardState,
  type RenderFrame,
  type StageBounds,
} from '@bash-fighter/render';

// See packages/app/src/match.ts for why these mirror the sim's private
// ItemState enum and the stylized hazard marker size instead of importing
// them from @bash-fighter/sim (not part of its public surface).
const NET_ITEM_STATE_HELD = 1;
const NET_ITEM_STATE_ARMED = 3;
const NET_HAZARD_MARKER_HALF_WIDTH = 11;
import {
  PROTOCOL_VERSION,
  SNAPSHOT_HZ,
  encodeInput,
  decodeSnapshot,
  type ServerControlMessage,
} from '@bash-fighter/net';
import { FixedTimestepLoop } from './loop.ts';
import { AudioManager } from '@bash-fighter/audio';
import { detectFighterEvents, detectItemEvents } from './effects-events.ts';
import { EffectsAudioBridge } from './effects-audio.ts';
import type { PendingHitEffect, PendingEliminationEffect } from '@bash-fighter/render';

// Placeholder used only until the real match arena is known (see
// startMatch, which calls renderer.setStageBounds(...) with the actual
// arena from createMatchSim as soon as the local prediction Sim exists).
export const STAGE_BOUNDS: StageBounds = arenaDataToStageBounds(DEFAULT_ARENA);

export type ConnectionState =
  | 'connecting'
  | 'waiting'
  | 'in-match'
  | 'spectating'
  | 'disconnected'
  | 'reconnecting'
  | 'error';

// Resume-token storage: sessionStorage, not localStorage, so a token never
// outlives the browser tab -- a stale token surviving into a brand new tab
// would be a seat nobody is coming back for. One slot is enough (a tab
// plays at most one match at a time).
const RESUME_TOKEN_KEY = 'bash-fighter:resumeToken';
function loadResumeToken(): string | null {
  try {
    return sessionStorage.getItem(RESUME_TOKEN_KEY);
  } catch {
    return null; // sessionStorage unavailable (privacy mode, SSR, etc.)
  }
}
function saveResumeToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(RESUME_TOKEN_KEY, token);
    else sessionStorage.removeItem(RESUME_TOKEN_KEY);
  } catch {
    // best-effort only
  }
}

export interface NetMatchEvents {
  onStateChange?(state: ConnectionState, detail?: string): void;
  onLobby?(players: number, capacity: number, countdownTicks: number): void;
  onMatchOver?(winnerIndex: number | null): void;
}

const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_HZ;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function snapshotToRenderFighter(s: FighterSnapshot): RenderFighterState {
  return {
    x: fx.toFloat(s.posX),
    y: fx.toFloat(s.posY),
    facing: s.facing,
    state: s.state,
    moveId: s.moveId,
    moveFrame: s.moveFrame,
    percent: s.percent,
    stocks: s.stocks,
    shieldHealth: s.shieldHealth,
    hitstun: s.hitstun,
    eliminated: s.eliminated,
  } as RenderFighterState;
}

/** Owns the WebSocket connection, the local-prediction sim, and rendering
 * for one online match. Mirrors Match (local-match.ts's local mode) in
 * shape so main.ts can switch between the two without them knowing about
 * each other. */
export class NetMatch {
  readonly renderer: Renderer;
  readonly input = new InputManager();
  private ws: WebSocket | null = null;
  private loop: FixedTimestepLoop | null = null;
  private name = '';
  // Set from every 'welcome' for a real seat (never for a pure spectator).
  // Persisted to sessionStorage (not localStorage) so it survives a page
  // reload within the same tab -- a refresh is treated the same as any
  // other drop, and the server still honours the token within
  // RECONNECT_GRACE_MS regardless of which socket presents it -- but never
  // outlives the tab, so a seat can't be reclaimed from a stale token left
  // lying around after the tab is closed.
  private resumeToken: string | null = loadResumeToken();
  private setResumeToken(token: string | null): void {
    this.resumeToken = token;
    saveResumeToken(token);
  }
  // True once stop() is called deliberately (leaving the match / navigating
  // away): close/error handlers must not try to auto-reconnect after that.
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private localSim: Sim | null = null;
  private renderSim: Sim | null = null; // scratch sim used only to decode remote snapshot buffers
  private numFighters = 0;
  private characterId = DEFAULT_CHARACTER_ID;
  private characters: CharacterData[] = [];
  private mySlot = -1;
  private spectating = false;
  private matchStarted = false;
  private over = false;

  private localTick = 0;
  private readonly inputHistory = new Map<number, InputFrame>();

  private prevSnapState: Int32Array | null = null;
  private currSnapState: Int32Array | null = null;
  private currSnapAt = 0;
  private currSnapTick = 0;

  readonly audio: AudioManager;
  private readonly effectsBridge: EffectsAudioBridge;
  // Set once per received snapshot (handleBinary), consumed once by the
  // next render() call. This is the ONLY source of hit/elimination
  // effects for online play -- deliberately driven off confirmed server
  // snapshots (20Hz), never off localSim's per-tick prediction/replay in
  // tick()/handleBinary's reconciliation loop, so a mispredicted hit that
  // gets rolled back on reconciliation never plays a phantom sound: it
  // was never observed here in the first place.
  private pendingHitEffects: PendingHitEffect[] = [];
  private pendingEliminationEffects: PendingEliminationEffect[] = [];

  constructor(private readonly url: string, private readonly events: NetMatchEvents = {}, audio: AudioManager = new AudioManager()) {
    this.renderer = new Renderer(STAGE_BOUNDS);
    this.audio = audio;
    this.effectsBridge = new EffectsAudioBridge(audio);
  }

  async init(parent: HTMLElement): Promise<void> {
    await this.renderer.init(parent);
    this.input.attach(window);
  }

  connect(name: string, characterId: string = DEFAULT_CHARACTER_ID): void {
    this.name = name;
    this.characterId = characterId;
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.events.onStateChange?.('connecting');
    this.openSocket();
  }

  /** (Re)opens the websocket and sends either a fresh 'hello' or, if we
   * hold a resume token from a previous session, 'hello' with `resume`
   * set so the server reattaches us to our existing fighter slot instead
   * of putting us in a new lobby. Either way the client does NOT try to
   * keep playing from local state across the gap: startMatch() always
   * rebuilds localSim/renderSim from scratch and waits for the next
   * authoritative snapshot, so a resumed session is byte-for-byte
   * indistinguishable from a fresh join except which slot it lands in. */
  private openSocket(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      const hello: Record<string, unknown> = { t: 'hello', protocolVersion: PROTOCOL_VERSION, name: this.name };
      if (this.resumeToken) hello.resume = this.resumeToken;
      if (this.characterId) hello.characterId = this.characterId;
      ws.send(JSON.stringify(hello));
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') {
        this.handleControl(JSON.parse(ev.data) as ServerControlMessage);
      } else {
        this.handleBinary(new Uint8Array(ev.data as ArrayBuffer));
      }
    });
    ws.addEventListener('close', () => {
      this.loop?.stop();
      if (this.stopped) return;
      // Mid-match drop with a resume token in hand: try to get back in
      // automatically instead of dumping the player to an error screen.
      // A drop before ever reaching an in-progress match (still in lobby,
      // or never got a token) has nothing useful to resume -- surface it
      // as a plain disconnect instead of retrying forever.
      if (this.resumeToken && this.matchStarted && !this.over) {
        this.scheduleReconnect();
      } else {
        this.events.onStateChange?.('disconnected');
      }
    });
    ws.addEventListener('error', () => {
      if (!this.resumeToken || !this.matchStarted || this.over) {
        this.events.onStateChange?.('error', 'connection error');
      }
    });
  }

  /** Exponential backoff (1s, 2s, 4s, 8s, capped at 10s) up to the
   * server's RECONNECT_GRACE_MS window, so a brief wifi blip retries fast
   * while a longer outage doesn't hammer the server. Shows the
   * 'reconnecting' banner for the whole window; a successful 'welcome'
   * with resumed=true clears it (see handleControl). */
  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    this.events.onStateChange?.('reconnecting', `attempt ${this.reconnectAttempt}`);
    const delayMs = Math.min(1000 * 2 ** (this.reconnectAttempt - 1), 10_000);
    this.reconnectTimer = setTimeout(() => {
      if (this.stopped) return;
      this.openSocket();
    }, delayMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.loop?.stop();
    this.input.detach(window);
    this.ws?.close();
  }

  toggleDebug(): void {
    this.renderer.setDebug(!this.renderer.isDebug());
  }

  private handleControl(msg: ServerControlMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.mySlot = msg.slot;
        this.spectating = msg.slot < 0;
        this.setResumeToken(msg.resumeToken ?? null);
        this.reconnectAttempt = 0;
        if (msg.resumed) {
          // Reattached to our old slot; matchStart follows immediately
          // (or, if the match already ended, matchEnd does) and rebuilds
          // sim state from scratch either way -- see startMatch/handleControl.
          this.events.onStateChange?.(this.spectating ? 'spectating' : 'in-match', 'reconnected');
        } else {
          this.events.onStateChange?.(this.spectating ? 'spectating' : 'waiting');
        }
        break;
      case 'lobby':
        this.events.onLobby?.(msg.players, msg.capacity, msg.countdownTicks);
        break;
      case 'matchStart':
        this.startMatch(msg.numFighters, msg.seed, msg.slot, msg.characterIds);
        break;
      case 'eliminated':
        if (msg.slot === this.mySlot && !this.spectating) {
          this.spectating = true;
          this.events.onStateChange?.('spectating', `placement ${msg.placement}`);
        }
        break;
      case 'matchEnd':
        this.over = true;
        this.events.onMatchOver?.(msg.winner);
        break;
      case 'error':
        if (msg.code === 'resume_invalid' || msg.code === 'resume_expired') {
          // Our token no longer gets us back in (grace period lapsed, or
          // someone/something else already reclaimed the seat) -- stop
          // retrying that seat and surface a plain disconnect rather than
          // looping on a token that will never work again.
          this.setResumeToken(null);
        }
        this.events.onStateChange?.('error', `${msg.code}: ${msg.message}`);
        this.ws?.close();
        break;
      default:
        break;
    }
  }

  private startMatch(numFighters: number, seed: number, slot: number, characterIds?: string[]): void {
    this.numFighters = numFighters;
    this.mySlot = slot;
    this.spectating = slot < 0;
    this.matchStarted = true;
    // Per-seat characters as resolved server-side (characterIds is a
    // parallel array to slot index). Falls back to placeholder-for-all if
    // an older server ever omits the field, matching createMatchSim's own
    // default. Must match the server's construction exactly, or
    // prediction silently diverges from authority -- see createMatchSim.
    this.characters = (characterIds ?? []).map((id) => resolveCharacterId(id));
    if (this.characters.length !== numFighters) {
      this.characters = new Array(numFighters).fill(PLACEHOLDER_CHARACTER);
    }
    this.localSim = createMatchSim(seed, numFighters, undefined, this.characters);
    this.renderSim = createMatchSim(seed, numFighters, undefined, this.characters);
    // The server always builds matches via createMatchSim too (see
    // server/src/*), so this.localSim.getArena() is the arena actually
    // being played on -- feed the renderer that, not a default guess.
    this.renderer.setStageBounds(arenaDataToStageBounds(this.localSim.getArena()));
    this.localTick = 0;
    this.inputHistory.clear();
    this.events.onStateChange?.(this.spectating ? 'spectating' : 'in-match');

    this.loop = new FixedTimestepLoop(
      () => this.tick(),
      () => this.render(),
    );
    this.loop.start();
  }

  private tick(): void {
    if (this.over || !this.localSim) return;
    this.localTick++;
    const inputs: InputFrame[] = new Array(this.numFighters).fill(null).map(() => makeInputFrame());
    if (!this.spectating && this.mySlot >= 0) {
      const local = this.input.poll()[0] ?? makeInputFrame();
      inputs[this.mySlot] = local;
      this.inputHistory.set(this.localTick, local);
      const ws = this.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          encodeInput({
            tick: this.localTick,
            buttons: local.buttons,
            stickX: local.stickX,
            stickY: local.stickY,
          }),
        );
      }
    }
    // Only the local fighter is predicted; every other slot advances with
    // neutral input in this local sim. That is fine because remote
    // fighters are never rendered from this sim — see render().
    this.localSim.advance(inputs);
  }

  private handleBinary(bytes: Uint8Array): void {
    const snap = decodeSnapshot(bytes);
    if (!snap || !this.localSim) return;

    const previousSnapState = this.currSnapState;
    this.prevSnapState = this.currSnapState;
    this.currSnapState = snap.state;
    this.currSnapAt = performance.now();
    this.currSnapTick = snap.tick;

    // Confirmed-state-only event detection (see field comment above): both
    // sides of this diff come from decoded server snapshots via
    // renderSim, never from localSim's prediction.
    if (this.renderSim) {
      this.renderSim.loadState(snap.state);
      const currF: FighterSnapshot[] = [];
      const currItems = [];
      for (let i = 0; i < this.numFighters; i++) currF.push(this.renderSim.getFighter(i));
      for (let i = 0; i < MAX_ITEMS; i++) currItems.push(this.renderSim.getItem(i));

      if (previousSnapState) {
        this.renderSim.loadState(previousSnapState);
        const prevF: FighterSnapshot[] = [];
        const prevItems = [];
        for (let i = 0; i < this.numFighters; i++) prevF.push(this.renderSim.getFighter(i));
        for (let i = 0; i < MAX_ITEMS; i++) prevItems.push(this.renderSim.getItem(i));

        const fighterEvents = detectFighterEvents(prevF, currF, this.numFighters);
        const itemEvents = detectItemEvents(prevItems, currItems, MAX_ITEMS);
        const { hitEffects, eliminationEffects } = this.effectsBridge.consume(
          [...fighterEvents, ...itemEvents],
          currF,
        );
        this.pendingHitEffects.push(...hitEffects);
        this.pendingEliminationEffects.push(...eliminationEffects);
      }
      this.renderSim.loadState(snap.state); // leave renderSim pointed at latest, as callers below expect
    }

    // Reconciliation: adopt the authoritative state, then replay every
    // locally-buffered input newer than what the server has acked, so the
    // local fighter's predicted position stays correct instead of
    // snapping backwards every time a snapshot arrives.
    this.localSim.loadState(snap.state);
    for (const tick of Array.from(this.inputHistory.keys())) {
      if (tick <= snap.ackedInputTick) this.inputHistory.delete(tick);
    }
    const replayInputs: InputFrame[] = new Array(this.numFighters).fill(null).map(() => makeInputFrame());
    for (let t = snap.tick + 1; t <= this.localTick; t++) {
      const recorded = this.inputHistory.get(t);
      if (!this.spectating && this.mySlot >= 0 && recorded) replayInputs[this.mySlot] = recorded;
      else if (!this.spectating && this.mySlot >= 0) replayInputs[this.mySlot] = makeInputFrame();
      this.localSim.advance(replayInputs);
    }
  }

  /** FighterSnapshots for the HUD -- same shape as Match.currentSnapshots()
   * so main.ts can drive Hud.update() identically for local and online
   * matches. Mirrors render()'s fighter resolution: predicted local sim
   * for the local slot, decoded latest snapshot for everyone else, falling
   * back to localSim before any snapshot has arrived. eliminated/placement
   * come straight from the sim's own FighterSnapshot fields -- no separate
   * bookkeeping needed. */
  /** True once startMatch() has run and there is a real sim/arena to show a
   * HUD for -- guards main.ts from showing fighter cards during lobby wait. */
  /** Index of this client's own fighter, or -1 while unassigned/spectating.
   * Used by the HUD to mark the local player's card distinctly. */
  localSlot(): number {
    return !this.spectating && this.mySlot >= 0 ? this.mySlot : -1;
  }

  hasStarted(): boolean {
    return this.localSim !== null;
  }

  currentSnapshots(): readonly FighterSnapshot[] {
    if (!this.localSim) return [];
    const out: FighterSnapshot[] = new Array(this.numFighters);
    const source = this.currSnapState && this.renderSim ? this.renderSim : this.localSim;
    if (this.currSnapState && this.renderSim) this.renderSim.loadState(this.currSnapState);
    for (let i = 0; i < this.numFighters; i++) out[i] = source.getFighter(i);
    if (!this.spectating && this.mySlot >= 0) out[this.mySlot] = this.localSim.getFighter(this.mySlot);
    return out;
  }

  private render(): void {
    if (!this.localSim || !this.renderSim) return;
    const fighters: RenderFighterState[] = new Array(this.numFighters);

    // Remote fighters: interpolate between the last two received snapshots.
    if (this.currSnapState) {
      const alpha = Math.min(1, Math.max(0, (performance.now() - this.currSnapAt) / SNAPSHOT_INTERVAL_MS));
      this.renderSim.loadState(this.currSnapState);
      const currF: FighterSnapshot[] = [];
      for (let i = 0; i < this.numFighters; i++) currF.push(this.renderSim.getFighter(i));

      let prevF: FighterSnapshot[] = currF;
      if (this.prevSnapState) {
        this.renderSim.loadState(this.prevSnapState);
        prevF = [];
        for (let i = 0; i < this.numFighters; i++) prevF.push(this.renderSim.getFighter(i));
        this.renderSim.loadState(this.currSnapState); // leave renderSim pointed at latest
      }

      for (let i = 0; i < this.numFighters; i++) {
        const c = currF[i] as FighterSnapshot;
        const p = prevF[i] as FighterSnapshot;
        fighters[i] = {
          ...snapshotToRenderFighter(c),
          x: lerp(fx.toFloat(p.posX), fx.toFloat(c.posX), alpha),
          y: lerp(fx.toFloat(p.posY), fx.toFloat(c.posY), alpha),
        };
      }
    } else {
      for (let i = 0; i < this.numFighters; i++) fighters[i] = snapshotToRenderFighter(this.localSim.getFighter(i));
    }

    // Local fighter: predicted position from localSim overrides the
    // interpolated/authoritative one above.
    if (!this.spectating && this.mySlot >= 0) {
      fighters[this.mySlot] = snapshotToRenderFighter(this.localSim.getFighter(this.mySlot));
    }

    // Items/hazards: read straight from renderSim's decoded snapshot, no
    // separate prev/curr interpolation like fighters get -- renderSim is
    // left pointed at the latest snapshot above. This is a simplification
    // versus the local-match path (see match.ts): between snapshots these
    // will hold their last-known position rather than smoothly
    // interpolating, same coarseness the un-interpolated fallback fighter
    // path already has when no snapshot has arrived yet.
    const items: RenderItemState[] = [];
    const hazards: RenderHazardState[] = [];
    if (this.currSnapState) {
      for (let i = 0; i < MAX_ITEMS; i++) {
        const it = this.renderSim.getItem(i);
        if (!it.active) {
          items.push({ active: false, typeId: 0, x: 0, y: 0, held: false, holderFacing: 1, armed: false, fuseTicks: 0 });
          continue;
        }
        const held = it.state === NET_ITEM_STATE_HELD;
        let x = fx.toFloat(it.posX);
        let y = fx.toFloat(it.posY);
        let holderFacing: 1 | -1 = 1;
        if (held && it.holder >= 0 && it.holder < this.numFighters) {
          const hf = fighters[it.holder] as RenderFighterState;
          x = hf.x;
          y = hf.y;
          holderFacing = hf.facing;
        }
        items.push({
          active: true,
          typeId: it.typeId,
          x,
          y,
          held,
          holderFacing,
          armed: it.state === NET_ITEM_STATE_ARMED,
          fuseTicks: it.fuse,
        });
      }
      for (let i = 0; i < MAX_HAZARDS; i++) {
        const hz = this.renderSim.getHazard(i);
        hazards.push({
          active: hz.active,
          x: fx.toFloat(hz.posX),
          y: fx.toFloat(hz.posY),
          halfWidth: NET_HAZARD_MARKER_HALF_WIDTH,
        });
      }
    }

    const frame: RenderFrame = {
      fighters,
      characters:
        this.characters.length === this.numFighters
          ? this.characters
          : new Array(this.numFighters).fill(PLACEHOLDER_CHARACTER),
      items,
      hazards,
      tick: this.currSnapTick,
      hash: '',
      hitEffects: this.pendingHitEffects,
      eliminationEffects: this.pendingEliminationEffects,
      localPlayerIndex: !this.spectating && this.mySlot >= 0 ? this.mySlot : undefined,
    };
    this.pendingHitEffects = [];
    this.pendingEliminationEffects = [];
    this.renderer.render(frame);
  }
}
