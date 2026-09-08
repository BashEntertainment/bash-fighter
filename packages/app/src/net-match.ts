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
  STAGE_MIN_X,
  STAGE_MAX_X,
  BLAST_MIN_X,
  BLAST_MAX_X,
  BLAST_MIN_Y,
  BLAST_MAX_Y,
  GROUND_Y,
  type FighterSnapshot,
  type InputFrame,
} from '@bash-fighter/sim';
import { PLACEHOLDER_CHARACTER } from '@bash-fighter/content';
import { InputManager } from '@bash-fighter/input';
import {
  Renderer,
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

export const STAGE_BOUNDS: StageBounds = {
  stageMinX: fx.toFloat(STAGE_MIN_X),
  stageMaxX: fx.toFloat(STAGE_MAX_X),
  groundY: fx.toFloat(GROUND_Y),
  blastMinX: fx.toFloat(BLAST_MIN_X),
  blastMaxX: fx.toFloat(BLAST_MAX_X),
  blastMinY: fx.toFloat(BLAST_MIN_Y),
  blastMaxY: fx.toFloat(BLAST_MAX_Y),
};

export type ConnectionState =
  | 'connecting'
  | 'waiting'
  | 'in-match'
  | 'spectating'
  | 'disconnected'
  | 'error';

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

  private localSim: Sim | null = null;
  private renderSim: Sim | null = null; // scratch sim used only to decode remote snapshot buffers
  private numFighters = 0;
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

  constructor(private readonly url: string, private readonly events: NetMatchEvents = {}) {
    this.renderer = new Renderer(STAGE_BOUNDS);
  }

  async init(parent: HTMLElement): Promise<void> {
    await this.renderer.init(parent);
    this.input.attach(window);
  }

  connect(name: string): void {
    this.events.onStateChange?.('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, name }));
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') {
        this.handleControl(JSON.parse(ev.data) as ServerControlMessage);
      } else {
        this.handleBinary(new Uint8Array(ev.data as ArrayBuffer));
      }
    });
    ws.addEventListener('close', () => {
      this.events.onStateChange?.('disconnected');
      this.loop?.stop();
    });
    ws.addEventListener('error', () => {
      this.events.onStateChange?.('error', 'connection error');
    });
  }

  stop(): void {
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
        this.events.onStateChange?.(this.spectating ? 'spectating' : 'waiting');
        break;
      case 'lobby':
        this.events.onLobby?.(msg.players, msg.capacity, msg.countdownTicks);
        break;
      case 'matchStart':
        this.startMatch(msg.numFighters, msg.seed, msg.slot);
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
        this.events.onStateChange?.('error', `${msg.code}: ${msg.message}`);
        this.ws?.close();
        break;
      default:
        break;
    }
  }

  private startMatch(numFighters: number, seed: number, slot: number): void {
    this.numFighters = numFighters;
    this.mySlot = slot;
    this.spectating = slot < 0;
    this.matchStarted = true;
    this.localSim = new Sim(seed, numFighters);
    this.renderSim = new Sim(seed, numFighters);
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

    this.prevSnapState = this.currSnapState;
    this.currSnapState = snap.state;
    this.currSnapAt = performance.now();
    this.currSnapTick = snap.tick;

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
      characters: new Array(this.numFighters).fill(PLACEHOLDER_CHARACTER),
      items,
      hazards,
      tick: this.currSnapTick,
      hash: '',
    };
    this.renderer.render(frame);
  }
}
