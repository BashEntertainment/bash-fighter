import {
  Player, Platform, GameState, HeroType, HeroStats,
  PlayerInput, Projectile, ProjectileType, StatusEffects
} from '../shared/types.js';

// Status effect durations (in frames, ~60fps)
const STUN_DURATION = 90;      // 1.5 seconds (mage ice)
const FLATTEN_DURATION = 60;   // 1 second
const POISON_DAMAGE = 2;       // Poison tick damage
const POISON_DURATION = 5;     // 5 ticks (seconds)

// Hero configurations
const HERO_STATS: Record<HeroType, HeroStats> = {
  tank: {
    speed: 3.5,
    jumpForce: 12,
    width: 60,
    height: 70,
    maxHp: 85,
    attack1: { // Ground slam (AoE push)
      damage: 2,
      range: 80,
      width: 120,
      height: 50,
      duration: 50,
      cooldown: 70,
      knockback: 8,
    },
    attack2: { // Big smash (flattens enemy)
      damage: 4,
      range: 60,
      width: 60,
      height: 50,
      duration: 60,
      cooldown: 95,
      knockback: 5,
    },
  },
  ninja: {
    speed: 6,
    jumpForce: 17,
    width: 45,
    height: 60,
    maxHp: 130,         // HP bonus for melee class
    attack1: { // Blowdart (poison projectile)
      damage: 6,
      range: 250,
      width: 18,
      height: 10,
      duration: 16,
      cooldown: 25,
      knockback: 4,
      isRanged: true,
      projectileSpeed: 20,
    },
    attack2: { // Double knife slice
      damage: 14,
      range: 80,
      width: 90,
      height: 55,
      duration: 18,
      cooldown: 18,
      knockback: 9,
    },
  },
  mage: {
    speed: 5,
    jumpForce: 15,
    width: 45,
    height: 65,
    attack1: { // Ice patch (ground, stuns)
      damage: 3,
      range: 80,
      width: 100,
      height: 30,
      duration: 25,
      cooldown: 45,
      knockback: 2,
    },
    attack2: { // Fireball (travels until hit)
      damage: 7,
      range: 1200,      // Goes across whole screen
      width: 35,
      height: 35,
      duration: 30,
      cooldown: 60,
      knockback: 10,
      isRanged: true,
      projectileSpeed: 8,
    },
  },
};

const GRAVITY = 0.6;
const BLOCK_DAMAGE_REDUCTION = 0.7;
const GAME_WIDTH = 1200;
const GAME_HEIGHT = 700;
const LOBBY_DURATION = 5; // seconds

// Stage platforms
const PLATFORMS: Platform[] = [
  { x: 0, y: GAME_HEIGHT - 40, width: GAME_WIDTH, height: 40 }, // Ground
  { x: 200, y: 450, width: 250, height: 25 }, // Left platform
  { x: 750, y: 450, width: 250, height: 25 }, // Right platform
  { x: 475, y: 300, width: 250, height: 25 }, // Top middle platform
];

export class Game {
  players: Map<string, Player> = new Map();
  projectiles: Projectile[] = [];
  phase: 'lobby' | 'playing' | 'ended' = 'lobby';
  countdown: number = LOBBY_DURATION;
  winner: string | null = null;
  lastUpdate: number = Date.now();
  attackCooldowns: Map<string, { attack1: number; attack2: number }> = new Map();
  hitPlayers: Set<string> = new Set(); // Track who got hit this attack frame

  addPlayer(id: string, name: string, hero: HeroType): Player {
    const spawnX = 100 + Math.random() * (GAME_WIDTH - 200);
    const stats = HERO_STATS[hero];
    const heroMaxHp = stats.maxHp || 100;
    const player: Player = {
      id,
      name: name || `Player${this.players.size + 1}`,
      hero,
      x: spawnX,
      y: 100,
      vx: 0,
      vy: 0,
      hp: heroMaxHp,
      maxHp: heroMaxHp,
      facing: 1,
      isBlocking: false,
      isAttacking: false,
      attackType: 0,
      attackFrame: 0,
      isGrounded: false,
      isDead: false,
      status: { stunned: 0, flattened: 0, poisoned: 0, poisonTimer: 0 },
    };
    this.players.set(id, player);
    this.attackCooldowns.set(id, { attack1: 0, attack2: 0 });
    return player;
  }

  removePlayer(id: string) {
    this.players.delete(id);
    this.attackCooldowns.delete(id);
  }

  selectHero(id: string, hero: HeroType) {
    const player = this.players.get(id);
    if (player && this.phase === 'lobby') {
      player.hero = hero;
      const stats = HERO_STATS[hero];
      const heroMaxHp = stats.maxHp || 100;
      player.hp = heroMaxHp;
      player.maxHp = heroMaxHp;
    }
  }

  handleInput(id: string, input: PlayerInput) {
    const player = this.players.get(id);
    if (!player || player.isDead || this.phase !== 'playing') return;

    // Can't do anything while stunned or flattened
    if (player.status.stunned > 0 || player.status.flattened > 0) {
      player.vx = 0;
      return;
    }

    const stats = HERO_STATS[player.hero];
    const cooldowns = this.attackCooldowns.get(id)!;

    // Movement
    if (!player.isAttacking) {
      if (input.left) {
        player.vx = -stats.speed;
        player.facing = -1;
      } else if (input.right) {
        player.vx = stats.speed;
        player.facing = 1;
      } else {
        player.vx = 0;
      }

      // Jump
      if (input.jump && player.isGrounded) {
        player.vy = -stats.jumpForce;
        player.isGrounded = false;
      }
    }

    // Blocking
    player.isBlocking = input.block && !player.isAttacking;

    // Attacks
    if (!player.isAttacking && !player.isBlocking) {
      if (input.attack1 && cooldowns.attack1 <= 0) {
        player.isAttacking = true;
        player.attackType = 1;
        player.attackFrame = 0;
        cooldowns.attack1 = stats.attack1.cooldown;
        
        // Spawn projectile for ranged attacks (ninja blowdart)
        if (stats.attack1.isRanged && player.hero === 'ninja') {
          this.spawnProjectile(player, stats.attack1, 'blowdart');
        }
      } else if (input.attack2 && cooldowns.attack2 <= 0) {
        player.isAttacking = true;
        player.attackType = 2;
        player.attackFrame = 0;
        cooldowns.attack2 = stats.attack2.cooldown;
        
        // Spawn projectile for ranged attacks (mage fireball)
        if (stats.attack2.isRanged && player.hero === 'mage') {
          this.spawnProjectile(player, stats.attack2, 'fireball');
        }
      }
    }
  }

  spawnProjectile(player: Player, attackStats: typeof HERO_STATS.mage.attack1, type: ProjectileType) {
    const startX = player.x + (player.facing > 0 ? HERO_STATS[player.hero].width : 0);
    const proj: Projectile = {
      id: `${player.id}-${Date.now()}`,
      playerId: player.id,
      x: startX,
      y: player.y + HERO_STATS[player.hero].height / 2 - attackStats.height / 2,
      vx: (attackStats.projectileSpeed || 10) * player.facing,
      damage: attackStats.damage,
      width: attackStats.width,
      height: attackStats.height,
      type,
      startX,
      maxRange: type === 'blowdart' ? attackStats.range : undefined,
    };
    this.projectiles.push(proj);
  }

  update() {
    const now = Date.now();
    const delta = (now - this.lastUpdate) / 1000;
    this.lastUpdate = now;

    if (this.phase === 'lobby') {
      this.countdown -= delta;
      if (this.countdown <= 0) {
        this.startGame();
      }
      return;
    }

    if (this.phase === 'ended') return;

    // Clear hit tracking for new frame
    this.hitPlayers.clear();

    // Update each player
    for (const player of this.players.values()) {
      if (player.isDead) continue;
      this.updatePlayer(player);
      this.updateStatusEffects(player);
    }

    // Update projectiles
    this.updateProjectiles();

    // Check melee attacks
    this.checkMeleeAttacks();

    // Update cooldowns
    for (const [id, cd] of this.attackCooldowns) {
      if (cd.attack1 > 0) cd.attack1--;
      if (cd.attack2 > 0) cd.attack2--;
    }

    // Check win condition
    const alivePlayers = [...this.players.values()].filter(p => !p.isDead);
    if (alivePlayers.length <= 1 && this.players.size > 1) {
      this.phase = 'ended';
      this.winner = alivePlayers[0]?.name || 'No one';
      // Start next game after 5 seconds
      setTimeout(() => {
        this.winner = null;
        this.startGame();
      }, 5000);
    }
  }

  updatePlayer(player: Player) {
    const stats = HERO_STATS[player.hero];

    // Apply gravity
    player.vy += GRAVITY;

    // Update position
    player.x += player.vx;
    player.y += player.vy;

    // Dash attack movement for ninja
    if (player.isAttacking && player.attackType === 2 && player.hero === 'ninja') {
      player.x += player.facing * 8;
    }

    // Platform collision
    player.isGrounded = false;
    for (const plat of PLATFORMS) {
      if (this.checkPlatformCollision(player, plat, stats)) {
        player.isGrounded = true;
      }
    }

    // Keep in bounds
    player.x = Math.max(0, Math.min(GAME_WIDTH - stats.width, player.x));
    if (player.y > GAME_HEIGHT) {
      player.hp = 0;
      player.isDead = true;
    }

    // Update attack frames
    if (player.isAttacking) {
      player.attackFrame++;
      const attackStats = player.attackType === 1 ? stats.attack1 : stats.attack2;
      if (player.attackFrame >= attackStats.duration) {
        player.isAttacking = false;
        player.attackType = 0;
        player.attackFrame = 0;
      }
    }
  }

  checkPlatformCollision(player: Player, plat: Platform, stats: HeroStats): boolean {
    const playerBottom = player.y + stats.height;
    const playerRight = player.x + stats.width;
    
    // Check if player is above platform and falling
    if (player.vy >= 0 &&
        playerRight > plat.x &&
        player.x < plat.x + plat.width &&
        playerBottom >= plat.y &&
        playerBottom <= plat.y + plat.height + player.vy) {
      player.y = plat.y - stats.height;
      player.vy = 0;
      return true;
    }
    return false;
  }

  updateStatusEffects(player: Player) {
    // Decrease stun timer
    if (player.status.stunned > 0) {
      player.status.stunned--;
    }
    
    // Decrease flatten timer
    if (player.status.flattened > 0) {
      player.status.flattened--;
    }
    
    // Handle poison damage (ticks once per second = 60 frames)
    if (player.status.poisoned > 0) {
      player.status.poisonTimer--;
      if (player.status.poisonTimer <= 0) {
        // Apply poison damage (can't kill, leaves at 1 HP)
        player.hp = Math.max(1, player.hp - POISON_DAMAGE);
        player.status.poisoned--;
        player.status.poisonTimer = 60; // Reset timer for next tick
      }
    }
  }

  updateProjectiles() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.x += proj.vx;

      // Remove if out of bounds
      if (proj.x < -50 || proj.x > GAME_WIDTH + 50) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // Remove blowdart if exceeded max range
      if (proj.type === 'blowdart' && proj.maxRange && proj.startX !== undefined) {
        if (Math.abs(proj.x - proj.startX) > proj.maxRange) {
          this.projectiles.splice(i, 1);
          continue;
        }
      }

      // Fireball collides with platforms
      if (proj.type === 'fireball') {
        let hitPlatform = false;
        for (const plat of PLATFORMS) {
          if (this.boxCollision(
            proj.x, proj.y, proj.width, proj.height,
            plat.x, plat.y, plat.width, plat.height
          )) {
            hitPlatform = true;
            break;
          }
        }
        if (hitPlatform) {
          this.projectiles.splice(i, 1);
          continue;
        }
      }

      // Check collision with players
      for (const player of this.players.values()) {
        if (player.id === proj.playerId || player.isDead) continue;
        // Flattened players are invulnerable
        if (player.status.flattened > 0) continue;
        
        const stats = HERO_STATS[player.hero];
        if (this.boxCollision(
          proj.x, proj.y, proj.width, proj.height,
          player.x, player.y, stats.width, stats.height
        )) {
          this.dealDamage(player, proj.damage, proj.vx > 0 ? 1 : -1, 8);
          
          // Blowdart applies poison
          if (proj.type === 'blowdart') {
            player.status.poisoned = POISON_DURATION;
            player.status.poisonTimer = 60; // First tick in 1 second
          }
          
          this.projectiles.splice(i, 1);
          break;
        }
      }
    }
  }

  checkMeleeAttacks() {
    for (const attacker of this.players.values()) {
      if (!attacker.isAttacking || attacker.isDead) continue;
      
      const stats = HERO_STATS[attacker.hero];
      const attackStats = attacker.attackType === 1 ? stats.attack1 : stats.attack2;
      
      // Skip ranged attacks (handled by projectiles)
      if (attackStats.isRanged) continue;

      // Only check hitbox at certain frames of the attack
      const hitFrameStart = Math.floor(attackStats.duration * 0.3);
      const hitFrameEnd = Math.floor(attackStats.duration * 0.6);
      if (attacker.attackFrame < hitFrameStart || attacker.attackFrame > hitFrameEnd) continue;

      // Calculate hitbox position
      let hitboxX: number;
      let hitboxY: number;
      
      // Tank ground slam (attack1) is AoE around the tank
      if (attacker.hero === 'tank' && attacker.attackType === 1) {
        hitboxX = attacker.x + stats.width / 2 - attackStats.width / 2;
        hitboxY = attacker.y + stats.height - attackStats.height;
      } 
      // Mage ice (attack1) is on the ground in front
      else if (attacker.hero === 'mage' && attacker.attackType === 1) {
        hitboxX = attacker.facing > 0 
          ? attacker.x + stats.width 
          : attacker.x - attackStats.width;
        hitboxY = attacker.y + stats.height - attackStats.height; // On ground level
      }
      // Normal directional attack
      else {
        hitboxX = attacker.facing > 0 
          ? attacker.x + stats.width 
          : attacker.x - attackStats.width;
        hitboxY = attacker.y + (stats.height - attackStats.height) / 2;
      }

      // Check collision with other players
      for (const target of this.players.values()) {
        if (target.id === attacker.id || target.isDead) continue;
        
        // Flattened players are invulnerable
        if (target.status.flattened > 0) continue;
        
        const hitKey = `${attacker.id}-${target.id}-${attacker.attackFrame}`;
        if (this.hitPlayers.has(hitKey)) continue;

        const targetStats = HERO_STATS[target.hero];
        if (this.boxCollision(
          hitboxX, hitboxY, attackStats.width, attackStats.height,
          target.x, target.y, targetStats.width, targetStats.height
        )) {
          this.hitPlayers.add(hitKey);
          
          // Apply special effects based on attack type
          if (attacker.hero === 'mage' && attacker.attackType === 1) {
            // Ice attack stuns
            this.dealDamage(target, attackStats.damage, attacker.facing, attackStats.knockback);
            target.status.stunned = STUN_DURATION;
          } else if (attacker.hero === 'tank' && attacker.attackType === 2) {
            // Tank smash flattens
            this.dealDamage(target, attackStats.damage, attacker.facing, attackStats.knockback);
            target.status.flattened = FLATTEN_DURATION;
          } else if (attacker.hero === 'tank' && attacker.attackType === 1) {
            // Ground slam pushes away from tank center
            const pushDir = target.x > attacker.x ? 1 : -1;
            this.dealDamage(target, attackStats.damage, pushDir, attackStats.knockback);
            target.vy -= 4; // Gentle launch (reduced from 8)
          } else {
            // Normal damage
            this.dealDamage(target, attackStats.damage, attacker.facing, attackStats.knockback);
          }
        }
      }
    }
  }

  dealDamage(player: Player, damage: number, direction: number, knockback: number) {
    let actualDamage = damage;
    let actualKnockback = knockback;

    if (player.isBlocking) {
      actualDamage *= (1 - BLOCK_DAMAGE_REDUCTION);
      actualKnockback *= 0.3;
    }

    player.hp -= actualDamage;
    player.vx += direction * actualKnockback;
    player.vy -= knockback * 0.3;

    if (player.hp <= 0) {
      player.hp = 0;
      player.isDead = true;
    }
  }

  boxCollision(
    x1: number, y1: number, w1: number, h1: number,
    x2: number, y2: number, w2: number, h2: number
  ): boolean {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  startGame() {
    this.phase = 'playing';
    // Reset all players
    for (const player of this.players.values()) {
      const spawnX = 100 + Math.random() * (GAME_WIDTH - 200);
      const stats = HERO_STATS[player.hero];
      const heroMaxHp = stats.maxHp || 100;
      player.x = spawnX;
      player.y = 100;
      player.vx = 0;
      player.vy = 0;
      player.hp = heroMaxHp;
      player.maxHp = heroMaxHp;
      player.isDead = false;
      player.isAttacking = false;
      player.isBlocking = false;
      player.status = { stunned: 0, flattened: 0, poisoned: 0, poisonTimer: 0 };
    }
    this.projectiles = [];
  }

  resetToLobby() {
    this.phase = 'lobby';
    this.countdown = LOBBY_DURATION;
    this.winner = null;
    this.projectiles = [];
    // Reset players for next round
    for (const player of this.players.values()) {
      const stats = HERO_STATS[player.hero];
      const heroMaxHp = stats.maxHp || 100;
      player.isDead = false;
      player.hp = heroMaxHp;
      player.maxHp = heroMaxHp;
      player.status = { stunned: 0, flattened: 0, poisoned: 0, poisonTimer: 0 };
    }
  }

  getState(): GameState {
    return {
      players: [...this.players.values()],
      platforms: PLATFORMS,
      projectiles: this.projectiles,
      phase: this.phase,
      countdown: Math.ceil(this.countdown),
      winner: this.winner,
    };
  }
}

export { HERO_STATS, GAME_WIDTH, GAME_HEIGHT };

