// Unit tests for the pure reducer and logic helpers. No sockets, no timers.
// Run:  node test-reducer.mjs
import { reducer, initGameState } from '../shared/reducer.js';
import { blocksOnTrack, legalTokens, applyMove, resolveCell } from '../shared/logic.js';
import { STEPS_TO_FINISH } from '../shared/constants.js';

function assert(cond, msg) {
  if (!cond) { console.error('  ✗', msg); process.exit(1); }
  console.log('  ✓', msg);
}
const seats = [
  { playerId: 'a', color: 'yellow', name: 'A' },
  { playerId: 'b', color: 'blue',   name: 'B' },
  { playerId: 'c', color: 'red',    name: 'C' },
  { playerId: 'd', color: 'green',  name: 'D' },
];

// ---- blocks + legalTokens ----------------------------------------------
console.log('\n# block rule');
{
  const g = initGameState(seats);
  // Yellow has two tokens on the same non-safe track cell: put both at steps=4
  // (trackIndex = (0 + 4 - 1) % 52 = 3, which is NOT a safe cell).
  g.players.yellow.tokens = [4, 4, 0, 0];
  const bl = blocksOnTrack(g.players);
  assert(bl[3] === 'yellow', 'yellow forms a block at track index 3');

  // Blue sits at steps=1 (trackIndex 13). Roll=6 would land at step 7 via idx 18.
  // Blue steps from 1 to 7 passes through absolute track indices 13..18 which
  // does NOT include yellow's block at idx 3. So blue should be legal.
  g.players.blue.tokens = [1, 0, 0, 0];
  const legalBlue = legalTokens('blue', 6, g.players);
  assert(legalBlue.includes(0), 'blue can move when block is off-path');

  // Put yellow's block directly on blue's path: blue at step 1 (trackIdx 13),
  // roll = 4 targets trackIdx 16. Park yellow tokens at trackIdx 15 (absolute).
  // For yellow, steps -> absolute: (0 + s - 1) % 52. So s=16 -> absolute 15.
  g.players.yellow.tokens = [16, 16, 0, 0];
  g.players.blue.tokens   = [1, 0, 0, 0];
  const blocks = blocksOnTrack(g.players);
  assert(blocks[15] === 'yellow', 'yellow block at absolute track index 15');
  const legalBlue2 = legalTokens('blue', 4, g.players);
  assert(!legalBlue2.includes(0), 'blue cannot traverse yellow block');

  // Yellow itself can traverse its own block.
  const legalYellow = legalTokens('yellow', 1, g.players);
  // yellow token 0 at step 16 -> 17. Target absolute 16. Block at 15 - doesn't
  // matter; traversal from 16 to 17 only visits idx 16 (not 15). Legal.
  assert(legalYellow.length > 0, 'yellow can continue past its own tokens');
}

// ---- stats tracking ----------------------------------------------------
console.log('\n# stats');
{
  let g = initGameState(seats);
  // yellow rolls a 6
  g = reducer(g, { type: 'ROLL', color: 'yellow', dice: 6 });
  assert(g.players.yellow.stats.sixes === 1, 'six counter increments');
  // yellow moves token 0 from yard to start (steps 0 -> 1)
  g = reducer(g, { type: 'MOVE', color: 'yellow', tokenIndex: 0 });
  assert(g.players.yellow.stats.steps === 1, 'steps counter increments');
  assert(g.lastMove?.color === 'yellow', 'lastMove marker populated');
  assert(g.lastMove.fromSteps === 0 && g.lastMove.toSteps === 1, 'lastMove fromSteps/toSteps correct');
}

// ---- capture stats -----------------------------------------------------
console.log('\n# capture bumps stats + lastMove.captured');
{
  let g = initGameState(seats);
  // Yellow about to capture Blue.
  // Place blue at trackIndex = 1 (step = 1 for blue means absolute 13, so
  // pick blue steps=41 which gives (13 + 40) % 52 = 1).
  g.players.yellow.tokens = [1, 0, 0, 0];  // yellow token at absolute idx 0 (its start - safe)
  g.players.blue.tokens   = [41, 0, 0, 0]; // blue token at absolute idx 1
  g.current = 'yellow';
  g.phase = 'rolled';
  g.lastRoll = 1;
  g.legal = [0];
  g = reducer(g, { type: 'MOVE', color: 'yellow', tokenIndex: 0 });
  assert(g.players.yellow.stats.captures === 1, 'capture stat bumped');
  assert(g.lastMove.captured.length === 1, 'lastMove.captured populated');
  assert(g.players.blue.tokens[0] === 0, 'captured blue token sent home');
}

// ---- three-sixes forfeit ------------------------------------------------
console.log('\n# three-sixes forfeit still works');
{
  let g = initGameState(seats);
  g = reducer(g, { type: 'ROLL', color: 'yellow', dice: 6 });
  g = reducer(g, { type: 'MOVE', color: 'yellow', tokenIndex: 0 });
  g = reducer(g, { type: 'ROLL', color: 'yellow', dice: 6 });
  g = reducer(g, { type: 'MOVE', color: 'yellow', tokenIndex: 0 });
  // Now a third 6 should forfeit
  g = reducer(g, { type: 'ROLL', color: 'yellow', dice: 6 });
  assert(g.current === 'blue', 'third 6 forfeits turn to blue');
  assert(g.sixStreak === 0, 'streak reset after forfeit');
}

// ---- FORCE_SKIP ---------------------------------------------------------
console.log('\n# FORCE_SKIP');
{
  const g0 = initGameState(seats);
  const g1 = reducer(g0, { type: 'FORCE_SKIP', color: 'yellow' });
  assert(g1.current === 'blue', 'FORCE_SKIP advances turn');
}

// ---- FINISH ------------------------------------------------------------
console.log('\n# finishing a token bumps stats.finished');
{
  let g = initGameState(seats);
  g.players.yellow.tokens = [56, 0, 0, 0];
  g.current = 'yellow';
  g.phase = 'rolled';
  g.lastRoll = 1;
  g.legal = [0];
  g = reducer(g, { type: 'MOVE', color: 'yellow', tokenIndex: 0 });
  assert(g.players.yellow.stats.finished === 1, 'finished counter increments');
  assert(g.players.yellow.tokens[0] === STEPS_TO_FINISH, 'token reaches finish');
}

console.log('\nReducer tests passed ✅');
