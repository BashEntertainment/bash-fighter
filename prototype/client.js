"use strict";
(() => {
  // client/input.ts
  var InputHandler = class {
    keys = /* @__PURE__ */ new Set();
    constructor() {
      window.addEventListener("keydown", (e) => {
        this.keys.add(e.key.toLowerCase());
        if (e.key === " ")
          e.preventDefault();
      });
      window.addEventListener("keyup", (e) => {
        this.keys.delete(e.key.toLowerCase());
      });
      window.addEventListener("blur", () => {
        this.keys.clear();
      });
    }
    getInput() {
      return {
        left: this.keys.has("a") || this.keys.has("arrowleft"),
        right: this.keys.has("d") || this.keys.has("arrowright"),
        jump: this.keys.has("w") || this.keys.has(" ") || this.keys.has("arrowup"),
        attack1: this.keys.has("j"),
        attack2: this.keys.has("k"),
        block: this.keys.has("l")
      };
    }
  };

  // client/main.ts
  var canvas = document.getElementById("gameCanvas");
  var ctx = canvas.getContext("2d");
  var joinScreen = document.getElementById("join-screen");
  var joinBtn = document.getElementById("join-btn");
  var nameInput = document.getElementById("playerName");
  var heroButtons = document.querySelectorAll(".hero-btn");
  var winnerBanner = document.getElementById("winner-banner");
  var winnerName = document.getElementById("winner-name");
  var winnerCountdown = document.getElementById("winner-countdown");
  var winnerLobbyBtn = document.getElementById("winner-lobby-btn");
  var deathBanner = document.getElementById("death-banner");
  var deathLobbyBtn = document.getElementById("death-lobby-btn");
  var keepWatchingBtn = document.getElementById("keep-watching-btn");
  var spectateLeaveBtn = document.getElementById("spectate-leave");
  var gameState = null;
  var myPlayerId = null;
  var selectedHero = "ninja";
  var wasDeadLastFrame = false;
  var isSpectating = false;
  var winnerCountdownValue = 10;
  var winnerCountdownInterval = null;
  var input = new InputHandler();
  var socket = io();
  heroButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      heroButtons.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedHero = btn.getAttribute("data-hero");
    });
  });
  joinBtn.addEventListener("click", () => {
    const name = nameInput.value.trim() || `Player${Math.floor(Math.random() * 1e3)}`;
    socket.emit("join", { name, hero: selectedHero });
  });
  function backToLobby() {
    socket.emit("leave");
    myPlayerId = null;
    wasDeadLastFrame = false;
    isSpectating = false;
    winnerBanner.classList.add("hidden");
    deathBanner.classList.add("hidden");
    spectateLeaveBtn.classList.add("hidden");
    joinScreen.classList.remove("hidden");
  }
  winnerLobbyBtn.addEventListener("click", backToLobby);
  deathLobbyBtn.addEventListener("click", backToLobby);
  spectateLeaveBtn.addEventListener("click", backToLobby);
  keepWatchingBtn.addEventListener("click", () => {
    deathBanner.classList.add("hidden");
    isSpectating = true;
    spectateLeaveBtn.classList.remove("hidden");
  });
  socket.on("joined", (data) => {
    myPlayerId = data.playerId;
    wasDeadLastFrame = false;
    isSpectating = false;
    joinScreen.classList.add("hidden");
    winnerBanner.classList.add("hidden");
    deathBanner.classList.add("hidden");
    spectateLeaveBtn.classList.add("hidden");
  });
  socket.on("state", (state) => {
    const prevState = gameState;
    gameState = state;
    if (myPlayerId) {
      const myPlayer = state.players.find((p) => p.id === myPlayerId);
      if (myPlayer && myPlayer.isDead && !wasDeadLastFrame && state.phase === "playing") {
        deathBanner.classList.remove("hidden");
        wasDeadLastFrame = true;
      }
    }
    if (state.phase === "ended" && prevState?.phase !== "ended") {
      winnerName.textContent = state.winner || "Nobody";
      deathBanner.classList.add("hidden");
      spectateLeaveBtn.classList.add("hidden");
      winnerBanner.classList.remove("hidden");
      winnerCountdownValue = 10;
      winnerCountdown.textContent = "10";
      if (winnerCountdownInterval)
        clearInterval(winnerCountdownInterval);
      winnerCountdownInterval = window.setInterval(() => {
        winnerCountdownValue--;
        winnerCountdown.textContent = String(winnerCountdownValue);
        if (winnerCountdownValue <= 0 && winnerCountdownInterval) {
          clearInterval(winnerCountdownInterval);
          winnerCountdownInterval = null;
        }
      }, 1e3);
    }
    if (state.phase === "lobby" && prevState?.phase === "ended") {
      winnerBanner.classList.add("hidden");
      wasDeadLastFrame = false;
      isSpectating = false;
      if (winnerCountdownInterval) {
        clearInterval(winnerCountdownInterval);
        winnerCountdownInterval = null;
      }
    }
  });
  var HERO_COLORS = {
    tank: { body: "#ff6b9d", outline: "#ff2e63", eye: "#fff" },
    ninja: { body: "#52d681", outline: "#27ae60", eye: "#fff" },
    mage: { body: "#74b9ff", outline: "#0984e3", eye: "#fff" }
  };
  function drawPlatform(plat) {
    const gradient = ctx.createLinearGradient(plat.x, plat.y, plat.x, plat.y + plat.height);
    gradient.addColorStop(0, "#3d3d5c");
    gradient.addColorStop(1, "#2a2a40");
    ctx.fillStyle = gradient;
    ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
    ctx.fillStyle = "#5a5a8a";
    ctx.fillRect(plat.x, plat.y, plat.width, 4);
    ctx.fillStyle = "#1a1a2a";
    ctx.fillRect(plat.x, plat.y + plat.height - 3, plat.width, 3);
  }
  function drawPlayer(player) {
    const colors = HERO_COLORS[player.hero];
    const isMe = player.id === myPlayerId;
    const w = player.hero === "tank" ? 60 : player.hero === "ninja" ? 40 : 45;
    let h = player.hero === "tank" ? 70 : player.hero === "ninja" ? 60 : 65;
    const status = player.status || { stunned: 0, flattened: 0, poisoned: 0, poisonTimer: 0 };
    const isFlattened = status.flattened > 0;
    const flattenScale = isFlattened ? 0.3 : 1;
    ctx.save();
    ctx.translate(player.x + w / 2, player.y + h / 2);
    if (player.facing === -1)
      ctx.scale(-1, 1);
    if (isFlattened) {
      ctx.scale(1.5, flattenScale);
    }
    if (status.stunned > 0) {
      ctx.fillStyle = "rgba(150, 220, 255, 0.5)";
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(w, h) * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    if (status.poisoned > 0) {
      ctx.fillStyle = "rgba(80, 200, 80, 0.3)";
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(w, h) * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (player.isBlocking) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(w, h) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    if (player.isAttacking) {
      drawAttackEffect(player, w, h);
    }
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fillRect(-w / 2 + 5, h / 2 - 10, w, 15);
    if (player.hero === "tank") {
      drawTank(ctx, w, h, colors, player.isAttacking, player.attackType);
    } else if (player.hero === "ninja") {
      drawNinja(ctx, w, h, colors, player.isAttacking, player.attackType);
    } else {
      drawMage(ctx, w, h, colors, player.isAttacking, player.attackType);
    }
    ctx.restore();
    const barWidth = w + 20;
    const barHeight = 8;
    const barX = player.x + w / 2 - barWidth / 2;
    const barY = player.y - 20;
    ctx.fillStyle = "#333";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    const healthPercent = player.hp / player.maxHp;
    const healthColor = healthPercent > 0.5 ? "#4ade80" : healthPercent > 0.25 ? "#fbbf24" : "#ef4444";
    ctx.fillStyle = healthColor;
    ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
    ctx.strokeStyle = isMe ? "#fff" : "#666";
    ctx.lineWidth = isMe ? 2 : 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = isMe ? "#ffd166" : "#fff";
    ctx.font = "bold 14px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(player.name, player.x + w / 2, barY - 5);
  }
  function drawAttackEffect(player, w, h) {
    if (player.hero === "tank") {
      if (player.attackType === 1) {
        ctx.fillStyle = "rgba(255, 150, 100, 0.5)";
        ctx.beginPath();
        ctx.ellipse(0, h / 2, 120, 20, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "rgba(255, 100, 100, 0.6)";
        ctx.fillRect(w / 2 - 20, -h / 2 - 20, 50, 60);
      }
    } else if (player.hero === "ninja") {
      if (player.attackType === 1) {
        ctx.fillStyle = "rgba(100, 200, 100, 0.4)";
        ctx.beginPath();
        ctx.arc(w / 2 + 10, 0, 15, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(200, 200, 200, 0.8)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(w / 2, -15);
        ctx.lineTo(w / 2 + 40, 0);
        ctx.lineTo(w / 2, 15);
        ctx.stroke();
      }
    } else if (player.hero === "mage") {
      if (player.attackType === 1) {
        ctx.fillStyle = "rgba(150, 220, 255, 0.6)";
        ctx.beginPath();
        ctx.ellipse(w / 2 + 50, h / 2 - 10, 50, 15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(200, 240, 255, 0.9)";
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
    }
  }
  function drawTank(ctx2, w, h, colors, attacking, attackType) {
    ctx2.fillStyle = colors.body;
    ctx2.fillRect(-w / 2, -h / 2, w, h);
    ctx2.strokeStyle = colors.outline;
    ctx2.lineWidth = 3;
    ctx2.strokeRect(-w / 2, -h / 2, w, h);
    ctx2.fillStyle = colors.outline;
    ctx2.fillRect(-w / 2 - 5, -h / 2, w + 10, 15);
    ctx2.fillStyle = colors.eye;
    ctx2.fillRect(5, -h / 4, 12, 10);
    ctx2.fillStyle = "#000";
    ctx2.fillRect(10, -h / 4 + 2, 5, 6);
    const armX = attacking ? attackType === 2 ? w / 2 : w / 2 + 5 : w / 2;
    const armY = attacking && attackType === 2 ? -15 : 0;
    ctx2.fillStyle = colors.body;
    ctx2.fillRect(armX - 10, armY, 25, 20);
    ctx2.strokeStyle = colors.outline;
    ctx2.strokeRect(armX - 10, armY, 25, 20);
  }
  function drawNinja(ctx2, w, h, colors, attacking, attackType) {
    ctx2.fillStyle = colors.body;
    ctx2.beginPath();
    ctx2.moveTo(0, -h / 2);
    ctx2.lineTo(w / 2, h / 2);
    ctx2.lineTo(-w / 2, h / 2);
    ctx2.closePath();
    ctx2.fill();
    ctx2.strokeStyle = colors.outline;
    ctx2.lineWidth = 2;
    ctx2.stroke();
    ctx2.fillStyle = colors.outline;
    ctx2.fillRect(-w / 2 - 5, -h / 3, w + 10, 8);
    ctx2.fillStyle = colors.eye;
    ctx2.fillRect(3, -h / 4, 8, 6);
    ctx2.fillStyle = "#000";
    ctx2.fillRect(6, -h / 4 + 1, 4, 4);
    if (attacking) {
      if (attackType === 1) {
        ctx2.fillStyle = "#8B4513";
        ctx2.fillRect(w / 2 - 5, -3, 35, 6);
      } else {
        ctx2.fillStyle = "#c0c0c0";
        ctx2.fillRect(w / 2, -12, 35, 5);
        ctx2.fillRect(w / 2, 7, 35, 5);
        ctx2.fillStyle = "#ffd700";
        ctx2.fillRect(w / 2 - 5, -15, 8, 11);
        ctx2.fillRect(w / 2 - 5, 4, 8, 11);
      }
    }
  }
  function drawMage(ctx2, w, h, colors, attacking, attackType) {
    ctx2.fillStyle = colors.body;
    ctx2.beginPath();
    ctx2.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.strokeStyle = colors.outline;
    ctx2.lineWidth = 2;
    ctx2.stroke();
    ctx2.fillStyle = colors.outline;
    ctx2.beginPath();
    ctx2.moveTo(0, -h / 2 - 25);
    ctx2.lineTo(w / 2 + 5, -h / 3);
    ctx2.lineTo(-w / 2 - 5, -h / 3);
    ctx2.closePath();
    ctx2.fill();
    ctx2.fillStyle = colors.eye;
    ctx2.beginPath();
    ctx2.arc(8, -5, 6, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.fillStyle = "#000";
    ctx2.beginPath();
    ctx2.arc(10, -4, 3, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.fillStyle = "#8B4513";
    ctx2.fillRect(w / 2 - 5, -10, 8, 40);
    if (attacking) {
      if (attackType === 1) {
        ctx2.fillStyle = "rgba(150, 220, 255, 0.8)";
        ctx2.beginPath();
        ctx2.arc(w / 2, -15, 12, 0, Math.PI * 2);
        ctx2.fill();
      } else {
        ctx2.fillStyle = "#ff6b00";
        ctx2.beginPath();
        ctx2.arc(w / 2, -15, 15, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.fillStyle = "#ffcc00";
        ctx2.beginPath();
        ctx2.arc(w / 2, -15, 8, 0, Math.PI * 2);
        ctx2.fill();
      }
    }
  }
  function drawProjectile(proj) {
    const cx = proj.x + proj.width / 2;
    const cy = proj.y + proj.height / 2;
    if (proj.type === "fireball" || !proj.type) {
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, proj.width);
      gradient.addColorStop(0, "#fff");
      gradient.addColorStop(0.3, "#ffd700");
      gradient.addColorStop(0.7, "#ff6b6b");
      gradient.addColorStop(1, "rgba(255, 100, 100, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, proj.width, 0, Math.PI * 2);
      ctx.fill();
    } else if (proj.type === "blowdart") {
      ctx.save();
      ctx.translate(cx, cy);
      if (proj.vx < 0)
        ctx.scale(-1, 1);
      ctx.fillStyle = "#8B4513";
      ctx.fillRect(-15, -2, 20, 4);
      ctx.fillStyle = "#50c878";
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-2, -4);
      ctx.lineTo(-2, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#228B22";
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
  function drawUI(state) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(canvas.width / 2 - 150, 10, 300, 50);
    ctx.strokeStyle = "#08d9d6";
    ctx.lineWidth = 2;
    ctx.strokeRect(canvas.width / 2 - 150, 10, 300, 50);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 20px Bangers, cursive";
    ctx.textAlign = "center";
    if (state.phase === "lobby") {
      ctx.fillStyle = "#ffd166";
      ctx.fillText(`NEXT BATTLE IN: ${state.countdown}s`, canvas.width / 2, 42);
    } else if (state.phase === "playing") {
      const alive = state.players.filter((p) => !p.isDead).length;
      ctx.fillText(`FIGHTERS REMAINING: ${alive}`, canvas.width / 2, 42);
    } else if (state.phase === "ended") {
      ctx.fillStyle = "#4ade80";
      ctx.fillText(`\u{1F3C6} ${state.winner} WINS! \u{1F3C6}`, canvas.width / 2, 42);
    }
    ctx.fillStyle = "#aaa";
    ctx.font = "14px Outfit, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`Players: ${state.players.length}`, 20, 30);
  }
  function draw() {
    ctx.fillStyle = "#0f0f1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
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
      ctx.fillStyle = "#fff";
      ctx.font = "24px Outfit, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Connecting...", canvas.width / 2, canvas.height / 2);
      return;
    }
    gameState.platforms.forEach(drawPlatform);
    if (gameState.projectiles) {
      gameState.projectiles.forEach(drawProjectile);
    }
    gameState.players.forEach((player) => {
      if (!player.isDead) {
        drawPlayer(player);
      }
    });
    gameState.players.forEach((player) => {
      if (player.isDead) {
        ctx.globalAlpha = 0.3;
        drawPlayer(player);
        ctx.globalAlpha = 1;
      }
    });
    drawUI(gameState);
  }
  function gameLoop() {
    if (myPlayerId && gameState?.phase === "playing") {
      socket.emit("input", input.getInput());
    }
    draw();
    requestAnimationFrame(gameLoop);
  }
  gameLoop();
})();
