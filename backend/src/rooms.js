// ---------------------------------------------------------------------------
// In-memory room registry, optionally backed by Upstash Redis (see
// persistence.js). Without persistence configured, rooms vanish when the
// Node process exits. With it, rooms survive deploys + restarts: clients
// auto-rejoin into the same seats via reconnectToken.
// ---------------------------------------------------------------------------

import { Room } from './room.js';
import { makeRoomCode } from './rng.js';
import {
  loadAllRoomBlobs,
  deleteRoomBlob,
  persistenceEnabled,
} from './persistence.js';

const rooms = new Map(); // code -> Room

export function createRoom({ capacity, io }) {
  let code;
  do { code = makeRoomCode(); } while (rooms.has(code));

  const room = new Room({ code, capacity, io });
  room._onEmptyTimeout = (r) => {
    rooms.delete(r.code);
    deleteRoomBlob(r.code).catch(() => {});
  };
  rooms.set(code, room);
  return room;
}

export function findRoom(code) {
  if (!code) return null;
  return rooms.get(code.toUpperCase()) ?? null;
}

export function removeRoom(code) {
  rooms.delete(code);
  deleteRoomBlob(code).catch(() => {});
}

export function roomCount() {
  return rooms.size;
}

/** Restore rooms from Redis on server boot. Called once from index.js. */
export async function restoreRoomsFromPersistence(io) {
  if (!persistenceEnabled) return 0;
  try {
    const blobs = await loadAllRoomBlobs();
    let restored = 0;
    for (const { code, blob } of blobs) {
      try {
        const room = Room.fromBlob(blob, io);
        room._onEmptyTimeout = (r) => {
          rooms.delete(r.code);
          deleteRoomBlob(r.code).catch(() => {});
        };
        rooms.set(code, room);
        restored += 1;
      } catch (e) {
        console.warn(`[persistence] could not restore ${code}:`, e.message);
      }
    }
    return restored;
  } catch (e) {
    console.warn('[persistence] restore failed:', e.message);
    return 0;
  }
}
