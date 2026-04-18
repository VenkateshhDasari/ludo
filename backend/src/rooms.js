// ---------------------------------------------------------------------------
// In-memory room registry. The room "database" for Stage 2. Rooms are
// cleaned up after 5 minutes of no connected players.
// ---------------------------------------------------------------------------

import { Room } from './room.js';
import { makeRoomCode } from './rng.js';

const rooms = new Map(); // code -> Room

export function createRoom({ capacity, io }) {
  // Vanishingly unlikely, but guarantee uniqueness anyway.
  let code;
  do { code = makeRoomCode(); } while (rooms.has(code));

  const room = new Room({ code, capacity, io });
  room._onEmptyTimeout = (r) => rooms.delete(r.code);
  rooms.set(code, room);
  return room;
}

export function findRoom(code) {
  if (!code) return null;
  return rooms.get(code.toUpperCase()) ?? null;
}

export function removeRoom(code) {
  rooms.delete(code);
}

export function roomCount() {
  return rooms.size;
}
