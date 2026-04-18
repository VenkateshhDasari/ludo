// ---------------------------------------------------------------------------
// Pure, deterministic game-logic helpers. No randomness, no time, no
// side effects - callable from the reducer or the client renderer.
// The server's anti-cheat guarantee rests on these functions being pure.
// ---------------------------------------------------------------------------

import {
  TRACK,
  START_INDEX,
  HOME_COLUMN,
  CENTER,
  YARD,
  SAFE_TRACK_INDICES,
  STEPS_TO_FINISH,
} from './constants.js';

/** Resolve a token's current visual cell on the 15x15 board. */
export function resolveCell(color, tokenIndex, steps) {
  if (steps === 0) {
    return { kind: 'yard', rc: YARD[color][tokenIndex] };
  }
  if (steps <= 51) {
    const trackIndex = (START_INDEX[color] + steps - 1) % 52;
    return { kind: 'track', rc: TRACK[trackIndex], trackIndex };
  }
  if (steps < STEPS_TO_FINISH) {
    return { kind: 'home', rc: HOME_COLUMN[color][steps - 52] };
  }
  return { kind: 'finish', rc: CENTER };
}

/**
 * Compute blocks on the outer track: a "block" forms when 2+ tokens of the
 * SAME color sit on the SAME outer-track cell. Returns {trackIndex: color}.
 * Home-column cells are color-specific so blocks never apply there.
 */
export function blocksOnTrack(players) {
  const count = {}; // trackIndex -> { color: n }
  for (const color of Object.keys(players)) {
    for (let i = 0; i < 4; i++) {
      const steps = players[color].tokens[i];
      const cell = resolveCell(color, i, steps);
      if (cell.kind !== 'track') continue;
      const idx = cell.trackIndex;
      if (SAFE_TRACK_INDICES.has(idx)) continue; // safe cells don't "block"
      count[idx] = count[idx] || {};
      count[idx][color] = (count[idx][color] || 0) + 1;
    }
  }
  const blocks = {};
  for (const [idx, colors] of Object.entries(count)) {
    for (const [c, n] of Object.entries(colors)) {
      if (n >= 2) blocks[idx] = c;
    }
  }
  return blocks;
}

/** True if `color` can traverse every step from fromSteps+1..toSteps. */
function canTraverse(color, fromSteps, toSteps, blocks) {
  for (let s = fromSteps + 1; s <= toSteps; s++) {
    if (s > 51) continue; // home column / finish cannot be blocked
    const trackIdx = (START_INDEX[color] + s - 1) % 52;
    const blocker = blocks[trackIdx];
    if (blocker && blocker !== color) return false;
  }
  return true;
}

/** Which tokens of `color` can legally move given `roll`? */
export function legalTokens(color, roll, players) {
  const blocks = blocksOnTrack(players);
  const tokens = players[color].tokens;
  const legal = [];
  for (let i = 0; i < tokens.length; i++) {
    const steps = tokens[i];
    if (steps === STEPS_TO_FINISH) continue;
    if (steps === 0) {
      if (roll !== 6) continue;
      // Exiting the yard lands on the start square (steps=1). Start squares
      // are in SAFE_TRACK_INDICES so blocksOnTrack skips them; a starting
      // token is always allowed to exit.
      legal.push(i);
      continue;
    }
    const to = steps + roll;
    if (to > STEPS_TO_FINISH) continue;
    if (!canTraverse(color, steps, to, blocks)) continue;
    legal.push(i);
  }
  return legal;
}

/** Apply a move. Returns new players map + metadata. Pure. */
export function applyMove(color, tokenIndex, roll, players) {
  const next = {};
  for (const c of Object.keys(players)) {
    next[c] = { ...players[c], tokens: [...players[c].tokens] };
  }

  const fromSteps = next[color].tokens[tokenIndex];
  // Classic Ludo: rolling a 6 to exit the yard places the token on the
  // START square (step 1). The 6 is "spent" on the exit; the extra turn
  // granted by rolling 6 is what gives the player the chance to advance.
  const newSteps = fromSteps === 0 ? 1 : fromSteps + roll;
  next[color].tokens[tokenIndex] = newSteps;
  const cell = resolveCell(color, tokenIndex, newSteps);

  const captured = [];
  if (cell.kind === 'track' && !SAFE_TRACK_INDICES.has(cell.trackIndex)) {
    for (const otherColor of Object.keys(next)) {
      if (otherColor === color) continue;
      const otherTokens = next[otherColor].tokens;
      for (let i = 0; i < otherTokens.length; i++) {
        const s = otherTokens[i];
        if (s === 0 || s === STEPS_TO_FINISH) continue;
        const oc = resolveCell(otherColor, i, s);
        if (oc.kind === 'track' && oc.trackIndex === cell.trackIndex) {
          otherTokens[i] = 0;
          captured.push({ color: otherColor, tokenIndex: i });
        }
      }
    }
  }

  const finished = newSteps === STEPS_TO_FINISH;
  const grantsExtraTurn = roll === 6 || captured.length > 0 || finished;

  return {
    players: next,
    captured,
    finished,
    grantsExtraTurn,
    fromSteps,
    toSteps: newSteps,
  };
}

/** True if this color has all 4 tokens finished. */
export function hasWon(playerState) {
  return playerState.tokens.every((s) => s === STEPS_TO_FINISH);
}
