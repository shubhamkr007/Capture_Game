require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const next = require('next');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL in environment');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const GRID_LIMIT = 1000;
const COLORS = Array.from({ length: 100 }, (_, index) => `hsl(${Math.round((index * 360) / 100)}, 82%, 52%)`);
const users = new Map();
const blocks = new Map();

function getCellKey(x, y) {
  return `${x},${y}`;
}

function computeLeaderboard() {
  const totals = {};
  blocks.forEach((block) => {
    totals[block.ownerName] = (totals[block.ownerName] || 0) + 1;
  });
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

function isValidCell(x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && Math.abs(x) <= GRID_LIMIT && Math.abs(y) <= GRID_LIMIT;
}

function getAvailableColor() {
  const usedColors = new Set(Array.from(users.values()).map((user) => user.color));
  const step = 37;

  for (let i = 0; i < COLORS.length; i += 1) {
    const color = COLORS[(i * step) % COLORS.length];
    if (!usedColors.has(color)) {
      return color;
    }
  }

  return COLORS[0];
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_users (
      name TEXT PRIMARY KEY,
      socket_id TEXT,
      color TEXT NOT NULL,
      connected BOOLEAN NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL,
      last_seen TIMESTAMPTZ NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS captured_blocks (
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      owner_id TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      color TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (x, y)
    );
  `);

  const { rows } = await pool.query('SELECT x, y, owner_id, owner_name, color FROM captured_blocks;');
  rows.forEach((row) => {
    blocks.set(getCellKey(row.x, row.y), {
      x: row.x,
      y: row.y,
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      color: row.color,
    });
  });
}

io.on('connection', (socket) => {
  socket.on('join', async (payload, callback) => {
    const rawName = typeof payload?.name === 'string' ? payload.name.trim().slice(0, 20) : '';
    const name = rawName || `Player-${Math.floor(1000 + Math.random() * 9000)}`;

    const existing = await pool.query('SELECT color FROM game_users WHERE name = $1;', [name]);
    const color = existing.rows[0]?.color || getAvailableColor() || '#a8b5ff';

    // Replace any stale user with the same name and keep online user list unique.
    for (const [existingSocketId, existingUser] of users.entries()) {
      if (existingUser.name === name) {
        users.delete(existingSocketId);
      }
    }

    const user = {
      id: socket.id,
      name,
      color,
      connectedAt: new Date().toISOString(),
    };

    users.set(socket.id, user);

    try {
      await pool.query(
        `INSERT INTO game_users (name, socket_id, color, connected, joined_at, last_seen)
         VALUES ($1, $2, $3, true, NOW(), NOW())
         ON CONFLICT (name)
         DO UPDATE SET socket_id = $2, color = $3, connected = true, last_seen = NOW();`,
        [user.name, user.id, user.color]
      );
    } catch (error) {
      console.error('Failed to save user:', error);
    }

    const board = Array.from(blocks.values());
    const leaderboard = computeLeaderboard();
    const userList = Array.from(users.values());

    callback({ ok: true, player: user, board, leaderboard, users: userList });
    socket.broadcast.emit('user_joined', user);
    io.emit('user_list', userList);
  });

  socket.on('capture_block', async (payload, callback) => {
    const user = users.get(socket.id);
    if (!user) {
      return callback?.({ ok: false, error: 'Join the game before capturing blocks.' });
    }

    const x = Number(payload?.x);
    const y = Number(payload?.y);
    if (!isValidCell(x, y)) {
      return callback?.({ ok: false, error: 'Invalid cell coordinates.' });
    }

    const key = getCellKey(x, y);
    const existing = blocks.get(key);
    if (existing?.ownerId === socket.id) {
      return callback?.({ ok: false, error: 'You already own this block.' });
    }

    const block = {
      x,
      y,
      ownerId: socket.id,
      ownerName: user.name,
      color: user.color,
      updatedAt: new Date().toISOString(),
    };

    blocks.set(key, block);
    try {
      await pool.query(
        `INSERT INTO captured_blocks (x, y, owner_id, owner_name, color, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (x, y)
         DO UPDATE SET owner_id = $3, owner_name = $4, color = $5, updated_at = $6;`,
        [x, y, block.ownerId, block.ownerName, block.color, block.updatedAt]
      );
    } catch (error) {
      console.error('Failed to persist block:', error);
    }

    const leaderboard = computeLeaderboard();
    io.emit('block_updated', block);
    io.emit('leaderboard', leaderboard);

    callback?.({ ok: true, block });
  });

  socket.on('disconnect', async () => {
    const user = users.get(socket.id);
    if (!user) {
      return;
    }

    users.delete(socket.id);
    try {
      await pool.query('UPDATE game_users SET connected = false, last_seen = NOW(), socket_id = NULL WHERE name = $1;', [user.name]);
    } catch (error) {
      console.error('Failed to mark user disconnected:', error);
    }

    socket.broadcast.emit('user_left', { id: socket.id, name: user.name });
    io.emit('user_list', Array.from(users.values()));
  });
});

app.post('/reset-game', async (req, res) => {
  try {
    await pool.query('DELETE FROM captured_blocks; DELETE FROM game_users;');
    blocks.clear();
    users.clear();
    io.emit('game_reset');
    return res.json({ ok: true });
  } catch (error) {
    console.error('Failed to reset game:', error);
    return res.status(500).json({ ok: false, error: 'Failed to reset game.' });
  }
});

// Integrate Next.js to serve the frontend in production.
const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev, dir: path.join(__dirname, '..') });
const handle = nextApp.getRequestHandler();

async function start() {
  try {
    await initDatabase();

    // Prepare Next.js app (build must be run beforehand)
    await nextApp.prepare();

    // Let Next handle any remaining routes (after API/socket routes)
    app.all('*', (req, res) => {
      return handle(req, res);
    });

    const port = process.env.PORT || 4000;
    server.listen(port, () => {
      console.log(`Realtime game server running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Server startup failed:', error);
    process.exit(1);
  }
}

start();
