import { Game, HERO_STATS, GAME_WIDTH, GAME_HEIGHT } from './server/game.js';
import { HeroType, PlayerInput } from './shared/types.js';

const PLAYER_COUNT = 10;
const GAME_COUNT = 1000;
const MAX_FRAMES = 60 * 60 * 5; // 5 minutes max per game

// Simple AI that moves toward nearest enemy and attacks
function getAIInput(game: Game, playerId: string): PlayerInput {
  const player = game.players.get(playerId);
  if (!player || player.isDead) {
    return { left: false, right: false, jump: false, attack1: false, attack2: false, block: false };
  }

  const stats = HERO_STATS[player.hero];
  
  // Find nearest alive enemy
  let nearestEnemy = null;
  let nearestDist = Infinity;
  for (const other of game.players.values()) {
    if (other.id === playerId || other.isDead) continue;
    const dist = Math.abs(other.x - player.x);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestEnemy = other;
    }
  }

  if (!nearestEnemy) {
    return { left: false, right: false, jump: false, attack1: false, attack2: false, block: false };
  }

  const input: PlayerInput = {
    left: false,
    right: false,
    jump: false,
    attack1: false,
    attack2: false,
    block: false,
  };

  // Move toward enemy
  const dx = nearestEnemy.x - player.x;
  if (dx > 50) input.right = true;
  else if (dx < -50) input.left = true;

  // Jump if enemy is above or randomly to be unpredictable
  if (nearestEnemy.y < player.y - 50 || Math.random() < 0.02) {
    input.jump = true;
  }

  // Attack logic based on distance and hero type
  const attackRange = player.hero === 'mage' ? 300 : player.hero === 'ninja' ? 150 : 100;
  
  if (nearestDist < attackRange) {
    // Choose attack based on situation
    if (Math.random() < 0.5) {
      input.attack1 = true;
    } else {
      input.attack2 = true;
    }
  }

  // Occasionally block
  if (nearestDist < 80 && Math.random() < 0.1) {
    input.block = true;
    input.attack1 = false;
    input.attack2 = false;
  }

  return input;
}

function runSimulation() {
  const wins: Record<HeroType, number> = { tank: 0, ninja: 0, mage: 0 };
  const heroes: HeroType[] = ['tank', 'ninja', 'mage'];

  console.log(`Running ${GAME_COUNT} games with ${PLAYER_COUNT} players each...\n`);

  for (let gameNum = 0; gameNum < GAME_COUNT; gameNum++) {
    const game = new Game();
    game.phase = 'playing';

    // Create balanced player distribution (3-4 of each hero)
    const playerHeroes: HeroType[] = [];
    for (let i = 0; i < PLAYER_COUNT; i++) {
      playerHeroes.push(heroes[i % 3]);
    }
    // Shuffle
    for (let i = playerHeroes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playerHeroes[i], playerHeroes[j]] = [playerHeroes[j], playerHeroes[i]];
    }

    // Add players
    for (let i = 0; i < PLAYER_COUNT; i++) {
      game.addPlayer(`p${i}`, `Player${i}`, playerHeroes[i]);
    }

    // Run game loop
    let frames = 0;
    while (frames < MAX_FRAMES) {
      // Process AI inputs for all players
      for (const player of game.players.values()) {
        if (!player.isDead) {
          const input = getAIInput(game, player.id);
          game.handleInput(player.id, input);
        }
      }

      game.update();
      frames++;

      // Check if game ended
      const alivePlayers = [...game.players.values()].filter(p => !p.isDead);
      if (alivePlayers.length <= 1) {
        if (alivePlayers.length === 1) {
          const winner = alivePlayers[0];
          wins[winner.hero]++;
        }
        break;
      }
    }

    if (frames >= MAX_FRAMES) {
      // Timeout - pick player with most HP as winner
      const alive = [...game.players.values()].filter(p => !p.isDead);
      if (alive.length > 0) {
        alive.sort((a, b) => b.hp - a.hp);
        wins[alive[0].hero]++;
      }
    }

    // Progress indicator
    if ((gameNum + 1) % 10 === 0) {
      process.stdout.write(`Completed ${gameNum + 1}/${GAME_COUNT} games\r`);
    }
  }

  console.log('\n\n=== RESULTS ===\n');
  const total = wins.tank + wins.ninja + wins.mage;
  
  for (const hero of heroes) {
    const count = wins[hero];
    const pct = ((count / total) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(count / total * 30));
    console.log(`${hero.toUpperCase().padEnd(6)} ${String(count).padStart(3)} wins (${pct.padStart(5)}%) ${bar}`);
  }
  
  console.log(`\nTotal games: ${total}`);
  
  // Balance assessment
  const expected = total / 3;
  const maxDev = Math.max(
    Math.abs(wins.tank - expected),
    Math.abs(wins.ninja - expected),
    Math.abs(wins.mage - expected)
  );
  const devPct = (maxDev / expected * 100).toFixed(1);
  
  console.log(`\nBalance check: Max deviation from expected is ${devPct}%`);
  if (parseFloat(devPct) < 15) {
    console.log('✓ Heroes appear reasonably balanced!');
  } else if (parseFloat(devPct) < 30) {
    console.log('⚠ Some imbalance detected, might need tuning.');
  } else {
    console.log('✗ Significant imbalance - heroes need rebalancing.');
  }
}

runSimulation();

