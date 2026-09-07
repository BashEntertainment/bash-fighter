// Hero types
export type HeroType = 'tank' | 'ninja' | 'mage';

// Player input state
export interface PlayerInput {
  left: boolean;
  right: boolean;
  jump: boolean;
  attack1: boolean;
  attack2: boolean;
  block: boolean;
}

// Status effects
export interface StatusEffects {
  stunned: number;    // frames remaining
  flattened: number;  // frames remaining
  poisoned: number;   // seconds remaining (ticks once per second)
  poisonTimer: number; // frames until next poison tick
}

// Player state (server authoritative)
export interface Player {
  id: string;
  name: string;
  hero: HeroType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  facing: 1 | -1; // 1 = right, -1 = left
  isBlocking: boolean;
  isAttacking: boolean;
  attackType: 0 | 1 | 2; // 0 = none, 1 = attack1, 2 = attack2
  attackFrame: number;
  isGrounded: boolean;
  isDead: boolean;
  status: StatusEffects;
}

// Platform
export interface Platform {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Attack hitbox (active during attack)
export interface Hitbox {
  playerId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  damage: number;
}

// Game state sent to clients
export interface GameState {
  players: Player[];
  platforms: Platform[];
  projectiles: Projectile[];
  phase: 'lobby' | 'playing' | 'ended';
  countdown: number; // seconds until next game starts (in lobby)
  winner: string | null;
}

// Hero stats
export interface HeroStats {
  speed: number;
  jumpForce: number;
  width: number;
  height: number;
  maxHp?: number;  // Optional, defaults to 100
  attack1: AttackStats;
  attack2: AttackStats;
}

export interface AttackStats {
  damage: number;
  range: number;
  width: number;
  height: number;
  duration: number; // frames
  cooldown: number; // frames
  knockback: number;
  isRanged?: boolean;
  projectileSpeed?: number;
}

// Messages from client to server
export interface ClientMessage {
  type: 'join' | 'input' | 'select_hero';
  name?: string;
  hero?: HeroType;
  input?: PlayerInput;
}

// Messages from server to client
export interface ServerMessage {
  type: 'state' | 'joined' | 'error';
  state?: GameState;
  playerId?: string;
  error?: string;
}

// Projectile types
export type ProjectileType = 'fireball' | 'blowdart';

// Projectile (for ranged attacks)
export interface Projectile {
  id: string;
  playerId: string;
  x: number;
  y: number;
  vx: number;
  damage: number;
  width: number;
  height: number;
  type: ProjectileType;
  maxRange?: number;    // for blowdart - limited range
  startX?: number;      // to track distance traveled
}

