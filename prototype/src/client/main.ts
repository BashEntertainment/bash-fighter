import { GameState, Player, HeroType, Platform, Projectile, StatusEffects } from '../shared/types.js';
import { InputHandler } from './input.js';

declare const io: any;

// Canvas setup
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const joinScreen = document.getElementById('join-screen')!;
const joinBtn = document.getElementById('join-btn')!;
const nameInput = document.getElementById('playerName') as HTMLInputElement;
const heroButtons = document.querySelectorAll('.hero-btn');

// Banner elements
const winnerBanner = document.getElementById('winner-banner')!;
const winnerName = document.getElementById('winner-name')!;
const winnerCountdown = document.getElementById('winner-countdown')!;
const winnerLobbyBtn = document.getElementById('winner-lobby-btn')!;
const deathBanner = document.getElementById('death-banner')!;
const deathLobbyBtn = document.getElementById('death-lobby-btn')!;
const keepWatchingBtn = document.getElementById('keep-watching-btn')!;
const spectateLeaveBtn = document.getElementById('spectate-leave')!;

// Game state
let gameState: GameState | null = null;
let myPlayerId: string | null = null;
let selectedHero: HeroType = 'ninja';
let wasDeadLastFrame = false;
let isSpectating = false;
let winnerCountdownValue = 10;
let winnerCountdownInterval: number | null = null;
const input = new InputHandler();

// Socket connection
const socket = io();

// Hero selection
heroButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    heroButtons.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedHero = btn.getAttribute('data-hero') as HeroType;
  });
});

// Join game
joinBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || `Player${Math.floor(Math.random() * 1000)}`;
  socket.emit('join', { name, hero: selectedHero });
});

// Back to lobby function
function backToLobby() {
  socket.emit('leave');
  myPlayerId = null;
  wasDeadLastFrame = false;
  isSpectating = false;
  winnerBanner.classList.add('hidden');
  deathBanner.classList.add('hidden');
  spectateLeaveBtn.classList.add('hidden');
  joinScreen.classList.remove('hidden');
}

// Banner button handlers
winnerLobbyBtn.addEventListener('click', backToLobby);
deathLobbyBtn.addEventListener('click', backToLobby);
spectateLeaveBtn.addEventListener('click', backToLobby);

keepWatchingBtn.addEventListener('click', () => {
  deathBanner.classList.add('hidden');
  isSpectating = true;
  spectateLeaveBtn.classList.remove('hidden');
});

// Socket events
socket.on('joined', (data: { playerId: string }) => {
  myPlayerId = data.playerId;
  wasDeadLastFrame = false;
  isSpectating = false;
  joinScreen.classList.add('hidden');
  winnerBanner.classList.add('hidden');
  deathBanner.classList.add('hidden');
  spectateLeaveBtn.classList.add('hidden');
});

socket.on('state', (state: GameState) => {
  const prevState = gameState;
  gameState = state;
  
  // Check if we just died
  if (myPlayerId) {
    const myPlayer = state.players.find(p => p.id === myPlayerId);
    if (myPlayer && myPlayer.isDead && !wasDeadLastFrame && state.phase === 'playing') {
      deathBanner.classList.remove('hidden');
      wasDeadLastFrame = true;
    }
  }
  
  // Check for game end (winner)
  if (state.phase === 'ended' && prevState?.phase !== 'ended') {
    winnerName.textContent = state.winner || 'Nobody';
    deathBanner.classList.add('hidden');
    spectateLeaveBtn.classList.add('hidden');
    winnerBanner.classList.remove('hidden');
    
    // Start countdown timer
    winnerCountdownValue = 10;
    winnerCountdown.textContent = '10';
    if (winnerCountdownInterval) clearInterval(winnerCountdownInterval);
    winnerCountdownInterval = window.setInterval(() => {
      winnerCountdownValue--;
      winnerCountdown.textContent = String(winnerCountdownValue);
      if (winnerCountdownValue <= 0 && winnerCountdownInterval) {
        clearInterval(winnerCountdownInterval);
        winnerCountdownInterval = null;
      }
    }, 1000);
  }
  
  // Hide winner banner when back to lobby
  if (state.phase === 'lobby' && prevState?.phase === 'ended') {
    winnerBanner.classList.add('hidden');
    wasDeadLastFrame = false;
    isSpectating = false;
    if (winnerCountdownInterval) {
      clearInterval(winnerCountdownInterval);
      winnerCountdownInterval = null;
    }
  }
});

// Colors for each hero
const HERO_COLORS = {
  tank: { body: '#ff6b9d', outline: '#ff2e63', eye: '#fff' },
  ninja: { body: '#52d681', outline: '#27ae60', eye: '#fff' },
  mage: { body: '#74b9ff', outline: '#0984e3', eye: '#fff' },
};

// Draw functions
function drawPlatform(plat: Platform) {
  // Platform body
  const gradient = ctx.createLinearGradient(plat.x, plat.y, plat.x, plat.y + plat.height);
  gradient.addColorStop(0, '#3d3d5c');
  gradient.addColorStop(1, '#2a2a40');
  ctx.fillStyle = gradient;
  ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
  
  // Platform top highlight
  ctx.fillStyle = '#5a5a8a';
  ctx.fillRect(plat.x, plat.y, plat.width, 4);
  
  // Platform edge shadows
  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(plat.x, plat.y + plat.height - 3, plat.width, 3);
}

function drawPlayer(player: Player) {
  const colors = HERO_COLORS[player.hero];
  const isMe = player.id === myPlayerId;
  
  // Hero dimensions
  const w = player.hero === 'tank' ? 60 : player.hero === 'ninja' ? 40 : 45;
  let h = player.hero === 'tank' ? 70 : player.hero === 'ninja' ? 60 : 65;
  
  // Default status if not present
  const status = player.status || { stunned: 0, flattened: 0, poisoned: 0, poisonTimer: 0 };
  
  // Flattened players are squished
  const isFlattened = status.flattened > 0;
  const flattenScale = isFlattened ? 0.3 : 1;
  
  ctx.save();
  ctx.translate(player.x + w / 2, player.y + h / 2);
  if (player.facing === -1) ctx.scale(-1, 1);
  
  // Apply flatten transformation
  if (isFlattened) {
    ctx.scale(1.5, flattenScale); // Wider and shorter
  }
  
  // Stunned effect (ice/frozen tint)
  if (status.stunned > 0) {
    ctx.fillStyle = 'rgba(150, 220, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(w, h) * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Poison effect (green aura)
  if (status.poisoned > 0) {
    ctx.fillStyle = 'rgba(80, 200, 80, 0.3)';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(w, h) * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Blocking effect
  if (player.isBlocking) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(w, h) * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Attack effect - different per hero/attack
  if (player.isAttacking) {
    drawAttackEffect(player, w, h);
  }
  
  // Body shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(-w / 2 + 5, h / 2 - 10, w, 15);
  
  // Draw based on hero type
  if (player.hero === 'tank') {
    drawTank(ctx, w, h, colors, player.isAttacking, player.attackType);
  } else if (player.hero === 'ninja') {
    drawNinja(ctx, w, h, colors, player.isAttacking, player.attackType);
  } else {
    drawMage(ctx, w, h, colors, player.isAttacking, player.attackType);
  }
  
  ctx.restore();
  
  // Health bar
  const barWidth = w + 20;
  const barHeight = 8;
  const barX = player.x + w / 2 - barWidth / 2;
  const barY = player.y - 20;
  
  // Background
  ctx.fillStyle = '#333';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  
  // Health
  const healthPercent = player.hp / player.maxHp;
  const healthColor = healthPercent > 0.5 ? '#4ade80' : healthPercent > 0.25 ? '#fbbf24' : '#ef4444';
  ctx.fillStyle = healthColor;
  ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
  
  // Border
  ctx.strokeStyle = isMe ? '#fff' : '#666';
  ctx.lineWidth = isMe ? 2 : 1;
  ctx.strokeRect(barX, barY, barWidth, barHeight);
  
  // Name
  ctx.fillStyle = isMe ? '#ffd166' : '#fff';
  ctx.font = 'bold 14px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(player.name, player.x + w / 2, barY - 5);
}

function drawAttackEffect(player: Player, w: number, h: number) {
  if (player.hero === 'tank') {
    if (player.attackType === 1) {
      // Ground slam - shockwave effect
      ctx.fillStyle = 'rgba(255, 150, 100, 0.5)';
      ctx.beginPath();
      ctx.ellipse(0, h / 2, 120, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Big smash - overhead swing
      ctx.fillStyle = 'rgba(255, 100, 100, 0.6)';
      ctx.fillRect(w / 2 - 20, -h / 2 - 20, 50, 60);
    }
  } else if (player.hero === 'ninja') {
    if (player.attackType === 1) {
      // Blowdart - small puff
      ctx.fillStyle = 'rgba(100, 200, 100, 0.4)';
      ctx.beginPath();
      ctx.arc(w / 2 + 10, 0, 15, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Double knife slice
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(w / 2, -15);
      ctx.lineTo(w / 2 + 40, 0);
      ctx.lineTo(w / 2, 15);
      ctx.stroke();
    }
  } else if (player.hero === 'mage') {
    if (player.attackType === 1) {
      // Ice patch on ground
      ctx.fillStyle = 'rgba(150, 220, 255, 0.6)';
      ctx.beginPath();
      ctx.ellipse(w / 2 + 50, h / 2 - 10, 50, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      // Ice crystals
      ctx.fillStyle = 'rgba(200, 240, 255, 0.9)';
      for (let i = 0; i < 5; i++) {
        const cx = w / 2 + 20 + i * 15;
        ctx.beginPath();
        ctx.moveTo(cx, h / 2 - 25);
        ctx.lineTo(cx - 5, h / 2 - 10);
        ctx.lineTo(cx + 5, h / 2 - 10);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Fireball effect handled by projectile drawing
  }
}

function drawTank(ctx: CanvasRenderingContext2D, w: number, h: number, colors: typeof HERO_COLORS.tank, attacking: boolean, attackType: number) {
  // Body (bulky rectangle)
  ctx.fillStyle = colors.body;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = colors.outline;
  ctx.lineWidth = 3;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  
  // Helmet
  ctx.fillStyle = colors.outline;
  ctx.fillRect(-w / 2 - 5, -h / 2, w + 10, 15);
  
  // Eyes
  ctx.fillStyle = colors.eye;
  ctx.fillRect(5, -h / 4, 12, 10);
  ctx.fillStyle = '#000';
  ctx.fillRect(10, -h / 4 + 2, 5, 6);
  
  // Arm/fist - position depends on attack type
  const armX = attacking ? (attackType === 2 ? w / 2 : w / 2 + 5) : w / 2;
  const armY = attacking && attackType === 2 ? -15 : 0; // Raised for smash
  ctx.fillStyle = colors.body;
  ctx.fillRect(armX - 10, armY, 25, 20);
  ctx.strokeStyle = colors.outline;
  ctx.strokeRect(armX - 10, armY, 25, 20);
}

function drawNinja(ctx: CanvasRenderingContext2D, w: number, h: number, colors: typeof HERO_COLORS.ninja, attacking: boolean, attackType: number) {
  // Body (slim triangle)
  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(w / 2, h / 2);
  ctx.lineTo(-w / 2, h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = colors.outline;
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Headband
  ctx.fillStyle = colors.outline;
  ctx.fillRect(-w / 2 - 5, -h / 3, w + 10, 8);
  
  // Eye
  ctx.fillStyle = colors.eye;
  ctx.fillRect(3, -h / 4, 8, 6);
  ctx.fillStyle = '#000';
  ctx.fillRect(6, -h / 4 + 1, 4, 4);
  
  // Blowpipe or knives
  if (attacking) {
    if (attackType === 1) {
      // Blowpipe
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(w / 2 - 5, -3, 35, 6);
    } else {
      // Two knives
      ctx.fillStyle = '#c0c0c0';
      ctx.fillRect(w / 2, -12, 35, 5);
      ctx.fillRect(w / 2, 7, 35, 5);
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(w / 2 - 5, -15, 8, 11);
      ctx.fillRect(w / 2 - 5, 4, 8, 11);
    }
  }
}

function drawMage(ctx: CanvasRenderingContext2D, w: number, h: number, colors: typeof HERO_COLORS.mage, attacking: boolean, attackType: number) {
  // Body (circle/oval)
  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colors.outline;
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Hat
  ctx.fillStyle = colors.outline;
  ctx.beginPath();
  ctx.moveTo(0, -h / 2 - 25);
  ctx.lineTo(w / 2 + 5, -h / 3);
  ctx.lineTo(-w / 2 - 5, -h / 3);
  ctx.closePath();
  ctx.fill();
  
  // Eye
  ctx.fillStyle = colors.eye;
  ctx.beginPath();
  ctx.arc(8, -5, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(10, -4, 3, 0, Math.PI * 2);
  ctx.fill();
  
  // Staff - always visible, glowing when attacking
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(w / 2 - 5, -10, 8, 40);
  
  if (attacking) {
    if (attackType === 1) {
      // Ice magic at staff tip
      ctx.fillStyle = 'rgba(150, 220, 255, 0.8)';
      ctx.beginPath();
      ctx.arc(w / 2, -15, 12, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Fire magic at staff tip
      ctx.fillStyle = '#ff6b00';
      ctx.beginPath();
      ctx.arc(w / 2, -15, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.arc(w / 2, -15, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawProjectile(proj: Projectile) {
  const cx = proj.x + proj.width / 2;
  const cy = proj.y + proj.height / 2;
  
  if (proj.type === 'fireball' || !proj.type) {
    // Fireball effect
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, proj.width);
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(0.3, '#ffd700');
    gradient.addColorStop(0.7, '#ff6b6b');
    gradient.addColorStop(1, 'rgba(255, 100, 100, 0)');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, proj.width, 0, Math.PI * 2);
    ctx.fill();
  } else if (proj.type === 'blowdart') {
    // Blowdart - small poison dart
    ctx.save();
    ctx.translate(cx, cy);
    if (proj.vx < 0) ctx.scale(-1, 1);
    
    // Dart body
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(-15, -2, 20, 4);
    
    // Dart tip (poison green)
    ctx.fillStyle = '#50c878';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-2, -4);
    ctx.lineTo(-2, 4);
    ctx.closePath();
    ctx.fill();
    
    // Feathers
    ctx.fillStyle = '#228B22';
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.lineTo(-20, -5);
    ctx.lineTo(-12, 0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.lineTo(-20, 5);
    ctx.lineTo(-12, 0);
    ctx.closePath();
    ctx.fill();
    
    ctx.restore();
  }
}

function drawUI(state: GameState) {
  // Phase indicator
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(canvas.width / 2 - 150, 10, 300, 50);
  ctx.strokeStyle = '#08d9d6';
  ctx.lineWidth = 2;
  ctx.strokeRect(canvas.width / 2 - 150, 10, 300, 50);
  
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px Bangers, cursive';
  ctx.textAlign = 'center';
  
  if (state.phase === 'lobby') {
    ctx.fillStyle = '#ffd166';
    ctx.fillText(`NEXT BATTLE IN: ${state.countdown}s`, canvas.width / 2, 42);
  } else if (state.phase === 'playing') {
    const alive = state.players.filter(p => !p.isDead).length;
    ctx.fillText(`FIGHTERS REMAINING: ${alive}`, canvas.width / 2, 42);
  } else if (state.phase === 'ended') {
    ctx.fillStyle = '#4ade80';
    ctx.fillText(`🏆 ${state.winner} WINS! 🏆`, canvas.width / 2, 42);
  }
  
  // Player count
  ctx.fillStyle = '#aaa';
  ctx.font = '14px Outfit, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Players: ${state.players.length}`, 20, 30);
}

function draw() {
  // Clear
  ctx.fillStyle = '#0f0f1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Background grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  
  if (!gameState) {
    ctx.fillStyle = '#fff';
    ctx.font = '24px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Connecting...', canvas.width / 2, canvas.height / 2);
    return;
  }
  
  // Draw platforms
  gameState.platforms.forEach(drawPlatform);
  
  // Draw projectiles
  if (gameState.projectiles) {
    gameState.projectiles.forEach(drawProjectile);
  }
  
  // Draw players
  gameState.players.forEach(player => {
    if (!player.isDead) {
      drawPlayer(player);
    }
  });
  
  // Draw dead players as ghosts
  gameState.players.forEach(player => {
    if (player.isDead) {
      ctx.globalAlpha = 0.3;
      drawPlayer(player);
      ctx.globalAlpha = 1;
    }
  });
  
  // Draw UI
  drawUI(gameState);
}

// Game loop
function gameLoop() {
  // Send input to server
  if (myPlayerId && gameState?.phase === 'playing') {
    socket.emit('input', input.getInput());
  }
  
  draw();
  requestAnimationFrame(gameLoop);
}

// Start
gameLoop();

