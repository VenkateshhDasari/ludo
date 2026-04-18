// Unit test for: sessionWins increments exactly once per win,
// accumulates across rematches, wantsRematch resets on restart.
// Pure: constructs a Room directly with a stub io.
//   node test-rematch.mjs
import { Room } from './src/room.js';
import { STEPS_TO_FINISH } from '../shared/constants.js';

function assert(cond, msg) {
  if (!cond) { console.error('  ✗', msg); process.exit(1); }
  console.log('  ✓', msg);
}

const fakeIo = { to: () => ({ emit: () => {} }) };

function setup() {
  const room = new Room({ code: 'TEST01', capacity: 2, io: fakeIo });
  const a = room.addPlayer({ name: 'Alice', socketId: 's1' });
  const b = room.addPlayer({ name: 'Bob',   socketId: 's2' });
  room.startGame(a.playerId);
  // Seed yellow close to winning: 3 tokens home, 1 one step away.
  room.game.players.yellow.tokens = [
    STEPS_TO_FINISH - 1,
    STEPS_TO_FINISH,
    STEPS_TO_FINISH,
    STEPS_TO_FINISH,
  ];
  return { room, a, b };
}

console.log('\n# 1. Winning bumps sessionWins exactly once');
{
  const { room, a } = setup();
  room.game.current = 'yellow';
  room.game.phase = 'rolled';
  room.game.lastRoll = 1;
  room.game.legal = [0];
  room.dispatch({ type: 'MOVE', color: 'yellow', tokenIndex: 0 });
  assert(room.game.winner === 'yellow', 'yellow is the winner');
  assert(a.sessionWins === 1, `Alice sessionWins = 1 (got ${a.sessionWins})`);

  // Dispatching more actions after the game has ended must NOT re-increment.
  room.dispatch({ type: 'ROLL', color: 'yellow', dice: 4 });
  assert(a.sessionWins === 1, 'sessionWins not double-counted');
}

console.log('\n# 2. Rematch restarts game, preserves seats + sessionWins');
{
  const { room, a } = setup();
  room.game.current = 'yellow';
  room.game.phase = 'rolled';
  room.game.lastRoll = 1;
  room.game.legal = [0];
  room.dispatch({ type: 'MOVE', color: 'yellow', tokenIndex: 0 });
  assert(room.phase === 'finished', 'phase finished');

  // Both seats vote; vote sets flag, full vote starts countdown.
  room.voteRematch(a.playerId);
  const b = room.seats[1];
  room.voteRematch(b.playerId);
  assert(room._rematchStartsAt != null, 'rematch countdown armed');
  assert(a.wantsRematch === true, 'Alice voted');
  assert(b.wantsRematch === true, 'Bob voted');

  // Simulate countdown firing immediately (bypass 3s wait).
  room._cancelRematchCountdown();
  room._restartNow();
  assert(room.phase === 'playing', 'rematch moved phase back to playing');
  assert(room.game.winner === null, 'new game has no winner');
  assert(a.wantsRematch === false, 'Alice vote reset');
  assert(b.wantsRematch === false, 'Bob vote reset');
  assert(a.sessionWins === 1, 'Alice wins persist through rematch');

  // Win the rematch too.
  room.game.players.yellow.tokens = [
    STEPS_TO_FINISH - 1,
    STEPS_TO_FINISH,
    STEPS_TO_FINISH,
    STEPS_TO_FINISH,
  ];
  room.game.current = 'yellow';
  room.game.phase = 'rolled';
  room.game.lastRoll = 1;
  room.game.legal = [0];
  room.dispatch({ type: 'MOVE', color: 'yellow', tokenIndex: 0 });
  assert(a.sessionWins === 2, 'sessionWins accumulates across rematches');
}

console.log('\n# 3. voteRematch outside finished phase is rejected');
{
  const { room, a } = setup();
  // phase is 'playing' after setup
  let threw = false;
  try { room.voteRematch(a.playerId); } catch { threw = true; }
  assert(threw, 'voteRematch throws while still playing');
}

console.log('\n# 4. Snapshot exposes sessionWins + wantsRematch, hides reconnectToken');
{
  const { room, a } = setup();
  const snap = room.snapshot();
  for (const seat of snap.seats) {
    assert('sessionWins' in seat, `snap seat ${seat.name} has sessionWins`);
    assert('wantsRematch' in seat, `snap seat ${seat.name} has wantsRematch`);
    assert(!('reconnectToken' in seat), `snap seat ${seat.name} hides reconnectToken`);
  }
}

// Cleanup any in-flight timers (otherwise the process would linger 5 min).
process.exit(0);
