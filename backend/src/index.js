// ---------------------------------------------------------------------------
// Server bootstrap. Express serves a tiny health check and shares a
// CORS-enabled HTTP server with Socket.io.
//
// Socket event contract (client -> server):
//   createRoom   {name, capacity}                    ack({ok, playerId, roomCode, room}|{ok:false,error})
//   joinRoom     {roomCode, name}                    ack({ok, playerId, room}|{ok:false,error})
//   rejoinRoom   {roomCode, playerId}                ack({ok, room}|{ok:false,error})
//   startGame    {roomCode}                          ack({ok}|{ok:false,error})
//   rollDice     {roomCode}                          ack({ok}|{ok:false,error})
//   moveToken    {roomCode, tokenIndex}              ack({ok}|{ok:false,error})
//   restartGame  {roomCode}                          ack({ok}|{ok:false,error})
//   leaveRoom    {roomCode}                          ack({ok})
//
// Socket event (server -> client, broadcast to room):
//   state        <RoomSnapshot>
//   error        {message}
// ---------------------------------------------------------------------------

import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { Server as IOServer } from 'socket.io';

import { createRoom, findRoom, restoreRoomsFromPersistence } from './rooms.js';
import { persistenceEnabled } from './persistence.js';
import { EMOJI_REACTIONS } from '../../shared/constants.js';

const PORT = Number(process.env.PORT || 3001);
const ORIGIN = process.env.CLIENT_ORIGIN || '*';

const app = express();
app.use(cors({ origin: ORIGIN }));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: 'in-memory' }));

const httpServer = http.createServer(app);
const io = new IOServer(httpServer, {
  cors: { origin: ORIGIN, methods: ['GET', 'POST'] },
});

// socket.id -> { playerId, roomCode } so we can resolve on disconnect.
const sessions = new Map();

// ---------------------------------------------------------------------------
// Simple token-bucket rate limiter, per socket, per event. Prevents a
// malicious or runaway client from flooding signaling / emoji / roll events.
// ---------------------------------------------------------------------------
const RATE_LIMITS = {
  'voice:signal': { capacity: 60,  refillMs: 1000  },  // ICE candidates can be rapid
  'emoji:send':   { capacity: 6,   refillMs: 2000  },
  'rollDice':     { capacity: 8,   refillMs: 2000  },
  'moveToken':    { capacity: 8,   refillMs: 2000  },
  'createRoom':   { capacity: 5,   refillMs: 60000 },
  'joinRoom':     { capacity: 10,  refillMs: 60000 },
  'rejoinRoom':   { capacity: 20,  refillMs: 60000 },
  'startGame':    { capacity: 5,   refillMs: 10000 },
  'restartGame':  { capacity: 5,   refillMs: 10000 },
  'voteRematch':  { capacity: 5,   refillMs: 10000 },
  'leaveRoom':    { capacity: 5,   refillMs: 10000 },
};
const buckets = new Map(); // socketId -> Map<event, {tokens, last}>

function allow(socketId, event) {
  const limit = RATE_LIMITS[event];
  if (!limit) return true;
  let m = buckets.get(socketId);
  if (!m) { m = new Map(); buckets.set(socketId, m); }
  let b = m.get(event);
  const now = Date.now();
  if (!b) { b = { tokens: limit.capacity, last: now }; m.set(event, b); }
  // Refill proportional to elapsed time.
  const refill = ((now - b.last) / limit.refillMs) * limit.capacity;
  b.tokens = Math.min(limit.capacity, b.tokens + refill);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/**
 * Wrap a socket handler. Rate-check the event first; bubble thrown errors
 * back through the client ack as { ok:false, error }. Events without an ack
 * still execute but get silently dropped when rate-limited.
 */
function wrap(event, handler) {
  return async (...args) => {
    const socket = this; // not used; we rely on socket.id from closure
    const ack = args[args.length - 1];
    const hasAck = typeof ack === 'function';
    // `arguments[0]` is a payload for most handlers. The socket instance is
    // captured below via wrapOn() since arrow-free .on() doesn't give us
    // `this`. See wrapOn.
    try {
      const result = await handler(...args);
      if (hasAck) ack({ ok: true, ...(result || {}) });
    } catch (err) {
      const message = err?.message || 'Server error';
      if (hasAck) ack({ ok: false, error: message });
    }
  };
}

/**
 * Attach a rate-limited, ack-wrapped handler to a socket event. The handler
 * receives (socket, payload, ack?) so it has access to socket.id.
 */
function register(socket, event, handler) {
  socket.on(event, async (payload, ack) => {
    if (!allow(socket.id, event)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Rate limited' });
      return;
    }
    try {
      const result = await handler(socket, payload || {});
      if (typeof ack === 'function') ack({ ok: true, ...(result || {}) });
    } catch (err) {
      const message = err?.message || 'Server error';
      if (typeof ack === 'function') ack({ ok: false, error: message });
    }
  });
}

io.on('connection', (socket) => {
  // ---------- Room lifecycle -------------------------------------------

  register(socket, 'createRoom', async (s, { name, capacity } = {}) => {
    const room = createRoom({ capacity: Number(capacity) || 4, io });
    const seat = room.addPlayer({ name, socketId: s.id });
    s.join(room.code);
    sessions.set(s.id, { playerId: seat.playerId, roomCode: room.code });
    room.broadcast();
    return {
      playerId: seat.playerId,
      reconnectToken: seat.reconnectToken,
      roomCode: room.code,
      room: room.snapshot(),
    };
  });

  register(socket, 'joinRoom', async (s, { roomCode, name } = {}) => {
    const room = findRoom(roomCode);
    if (!room) throw new Error('Room not found');

    if (room.phase !== 'lobby') {
      const reclaimed = room.reclaimSeatByName(name, s.id);
      if (!reclaimed) throw new Error('Game already started');
      s.join(room.code);
      sessions.set(s.id, { playerId: reclaimed.playerId, roomCode: room.code });
      room.broadcast();
      return {
        playerId: reclaimed.playerId,
        reconnectToken: reclaimed.reconnectToken,
        room: room.snapshot(),
      };
    }

    if (room.isFull()) throw new Error('Room is full');
    const seat = room.addPlayer({ name, socketId: s.id });
    s.join(room.code);
    sessions.set(s.id, { playerId: seat.playerId, roomCode: room.code });
    room.broadcast();
    return {
      playerId: seat.playerId,
      reconnectToken: seat.reconnectToken,
      room: room.snapshot(),
    };
  });

  register(socket, 'rejoinRoom', async (s, { roomCode, playerId, reconnectToken } = {}) => {
    const room = findRoom(roomCode);
    if (!room) throw new Error('Room not found');
    const seat = room.reconnect(playerId, s.id, reconnectToken);
    if (!seat) throw new Error('Seat not found or invalid token');
    s.join(room.code);
    sessions.set(s.id, { playerId: seat.playerId, roomCode: room.code });
    room.broadcast();
    return { room: room.snapshot(), reconnectToken: seat.reconnectToken };
  });

  register(socket, 'leaveRoom', async (s, { roomCode } = {}) => {
    const room = findRoom(roomCode);
    const entry = sessions.get(s.id);
    if (room && entry) room.markDisconnected(entry.playerId);
    sessions.delete(s.id);
    s.leave(roomCode);
    if (room) room.broadcast();
    return {};
  });

  // ---------- Gameplay -------------------------------------------------

  register(socket, 'startGame', async (s, { roomCode } = {}) => {
    const room = findRoom(roomCode);
    if (!room) throw new Error('Room not found');
    const entry = sessions.get(s.id);
    if (!entry) throw new Error('No session');
    room.startGame(entry.playerId);
    room.broadcast();
  });

  register(socket, 'rollDice', async (s, { roomCode } = {}) => {
    const room = findRoom(roomCode);
    if (!room) throw new Error('Room not found');
    const entry = sessions.get(s.id);
    if (!entry) throw new Error('No session');
    room.requestRoll(entry.playerId);
    room.broadcast();
  });

  register(socket, 'moveToken', async (s, { roomCode, tokenIndex } = {}) => {
    const room = findRoom(roomCode);
    if (!room) throw new Error('Room not found');
    const entry = sessions.get(s.id);
    if (!entry) throw new Error('No session');
    // Pass tokenIndex through raw; requestMove enforces strict type rules.
    room.requestMove(entry.playerId, tokenIndex);
    room.broadcast();
  });

  register(socket, 'restartGame', async (s, { roomCode } = {}) => {
    const room = findRoom(roomCode);
    if (!room) throw new Error('Room not found');
    const entry = sessions.get(s.id);
    if (!entry) throw new Error('No session');
    room.requestRestart(entry.playerId);
    room.broadcast();
  });

  register(socket, 'voteRematch', async (s, { roomCode } = {}) => {
    const room = findRoom(roomCode);
    if (!room) throw new Error('Room not found');
    const entry = sessions.get(s.id);
    if (!entry) throw new Error('No session');
    room.voteRematch(entry.playerId);
    room.broadcast();
  });

  // ---------- Emoji reactions (server relays, never stores) ------------
  register(socket, 'emoji:send', async (s, { roomCode, emoji } = {}) => {
    const entry = sessions.get(s.id);
    if (!entry) throw new Error('No session');
    if (entry.roomCode !== roomCode) throw new Error('Wrong room');
    if (!EMOJI_REACTIONS.includes(emoji)) throw new Error('Unknown emoji');
    const room = findRoom(roomCode);
    if (!room) throw new Error('Room not found');
    io.to(room.code).emit('emoji:reaction', {
      fromPlayerId: entry.playerId,
      emoji,
      t: Date.now(),
    });
  });

  // ---------- Voice signaling (Stage 3) --------------------------------
  // Pass-through relay. Rate-limited to 60/s/socket to prevent flooding.
  // Never touches game state; never inspects the payload.
  register(socket, 'voice:signal', async (s, { roomCode, targetPlayerId, payload } = {}) => {
    const entry = sessions.get(s.id);
    if (!entry) throw new Error('No session');
    if (entry.roomCode !== roomCode) throw new Error('Wrong room');
    const room = findRoom(roomCode);
    if (!room) throw new Error('Room not found');
    const target = room.findSeat(targetPlayerId);
    if (!target || !target.socketId) throw new Error('Target offline');
    // Defensive: reject payloads that are obviously oversized. Legit SDPs
    // are a few KB; anything past 32KB is almost certainly abuse.
    let approxSize = 0;
    try { approxSize = JSON.stringify(payload || {}).length; } catch { /* unstringifiable */ }
    if (approxSize > 32_000) throw new Error('Signal payload too large');
    io.to(target.socketId).emit('voice:signal', {
      fromPlayerId: entry.playerId,
      payload,
    });
  });

  // ---------- Disconnect ----------------------------------------------

  socket.on('disconnect', () => {
    // Clean up the rate-limiter bucket for this socket.
    buckets.delete(socket.id);

    const entry = sessions.get(socket.id);
    if (!entry) return;
    sessions.delete(socket.id);
    const room = findRoom(entry.roomCode);
    if (!room) return;
    // Tell peers the voice side is gone too (best-effort; peer connections
    // will also notice via ICE timeout, but this is instant).
    for (const seat of room.seats) {
      if (seat.playerId === entry.playerId) continue;
      if (!seat.socketId) continue;
      io.to(seat.socketId).emit('voice:signal', {
        fromPlayerId: entry.playerId,
        payload: { type: 'bye' },
      });
    }
    room.markDisconnected(entry.playerId);
    room.broadcast();
  });
});

httpServer.listen(PORT, async () => {
  console.log(`[ludo] listening on :${PORT}  (CLIENT_ORIGIN=${ORIGIN})`);
  console.log(`[ludo] persistence: ${persistenceEnabled ? 'Upstash Redis' : 'in-memory only'}`);
  if (persistenceEnabled) {
    const n = await restoreRoomsFromPersistence(io);
    console.log(`[ludo] restored ${n} room(s) from Redis`);
  }
});

// Graceful shutdown so PaaS (Render, Fly, etc.) rolling deploys don't drop
// active sockets uncleanly. Close the HTTP server (which waits for in-flight
// requests) and tell Socket.io to stop accepting new connections.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[ludo] received ${signal}, shutting down`);
  io.close(() => console.log('[ludo] socket.io closed'));
  httpServer.close(() => {
    console.log('[ludo] http server closed');
    process.exit(0);
  });
  // Hard-exit if something hangs.
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
