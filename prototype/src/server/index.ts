import { createServer } from 'http';
import { readFileSync } from 'fs';
import { Server } from 'socket.io';
import { Game } from './game.js';
import { ClientMessage, HeroType } from '../shared/types.js';

const config = JSON.parse(readFileSync('./config.json', 'utf-8'));
if (!config.port) throw new Error('Missing "port" in config.json');
if (!config.host) throw new Error('Missing "host" in config.json');
const PORT = config.port;
const HOST = config.host;
const TICK_RATE = 60;

const game = new Game();

// Simple HTTP server to serve static files
const httpServer = createServer((req, res) => {
  let filePath: string;
  let contentType: string;

  if (req.url === '/client.js') {
    filePath = './dist/client.js';
    contentType = 'application/javascript';
  } else {
    filePath = './public/index.html';
    contentType = 'text/html';
  }

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Socket.io server
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('join', (data: { name: string; hero: HeroType }) => {
    const player = game.addPlayer(socket.id, data.name, data.hero);
    socket.emit('joined', { playerId: player.id });
    console.log(`${player.name} joined as ${player.hero}`);
  });

  socket.on('select_hero', (data: { hero: HeroType }) => {
    game.selectHero(socket.id, data.hero);
  });

  socket.on('input', (input) => {
    game.handleInput(socket.id, input);
  });

  socket.on('leave', () => {
    const player = game.players.get(socket.id);
    if (player) {
      console.log(`${player.name} left the game`);
    }
    game.removePlayer(socket.id);
  });

  socket.on('disconnect', () => {
    const player = game.players.get(socket.id);
    if (player) {
      console.log(`${player.name} disconnected`);
    }
    game.removePlayer(socket.id);
  });
});

// Game loop
setInterval(() => {
  game.update();
  io.emit('state', game.getState());
}, 1000 / TICK_RATE);

httpServer.listen(PORT, HOST, () => {
  console.log(`🎮 Super Bash server running on ${HOST}:${PORT}`);
});

