// ---------------------------------------------------------------------------
// The one place randomness is allowed. The reducer is pure; any dice value
// or room code originates here and is passed in as a payload.
// ---------------------------------------------------------------------------

import { randomInt, randomUUID } from 'node:crypto';

/** 1..6 inclusive. */
export function rollDice() {
  return randomInt(1, 7);
}

/** 6-char room code from an unambiguous alphabet (no 0/O/1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(0, ALPHABET.length)];
  return s;
}

/** Stable per-player identifier for reconnect by session, not by socket. */
export function makePlayerId() {
  return randomUUID();
}
