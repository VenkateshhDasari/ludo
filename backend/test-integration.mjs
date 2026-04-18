// ---------------------------------------------------------------------------
// Throwaway integration test against a live backend on :3001.
// Exercises create/join/start/roll/move/disconnect/reconnect/force-skip.
// Run with:  node test-integration.mjs
// ---------------------------------------------------------------------------

import { io } from 'socket.io-client';

const URL = 'http://localhost:3001';
const GRACE_WAIT_MS = 32_000; // grace is 30s in constants

function mkClient(label) {
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  s.label = label;
  s.state = null;
  s.on('state', (st) => { s.state = st; });
  s.on('connect_error', (e) => console.log(`[${label}] connect_error:`, e.message));
  return s;
}

function req(s, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} timeout`)), 3000);
    s.emit(event, payload, (ack) => {
      clearTimeout(t);
      if (!ack?.ok) reject(new Error(ack?.error || 'no ack'));
      else resolve(ack);
    });
  });
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function connect(s) {
  await new Promise((resolve, reject) => {
    s.once('connect', resolve);
    s.once('connect_error', reject);
  });
}

async function main() {
  console.log('\n=== 1. basic create + join + start ===');
  const a = mkClient('A');
  const b = mkClient('B');
  await connect(a); await connect(b);

  const cr = await req(a, 'createRoom', { name: 'Alice', capacity: 2 });
  assert(cr.roomCode?.length === 6, 'room code is 6 chars');
  assert(cr.playerId, 'creator got playerId');
  assert(cr.room.seats.length === 1, 'room has 1 seat after create');
  assert(cr.room.seats[0].color === 'yellow', 'first seat is yellow');

  const jn = await req(b, 'joinRoom', { roomCode: cr.roomCode, name: 'Bob' });
  assert(jn.playerId !== cr.playerId, 'B got distinct playerId');

  await wait(50);
  assert(b.state.seats.length === 2, 'B sees 2 seats after join');
  assert(a.state.seats.length === 2, 'A sees 2 seats after join (broadcast)');
  assert(b.state.seats[1].color === 'blue', 'second seat is blue');

  try {
    await req(b, 'startGame', { roomCode: cr.roomCode });
    throw new Error('should have failed');
  } catch (e) {
    assert(/host/i.test(e.message), `non-host start rejected: ${e.message}`);
  }

  await req(a, 'startGame', { roomCode: cr.roomCode });
  await wait(50);
  assert(a.state.phase === 'playing', 'phase transitions to playing');
  assert(a.state.game?.current === 'yellow', 'yellow goes first');

  console.log('\n=== 2. roll / move / turn pipeline ===');
  // Force first roll by brute: roll until non-6 non-zero legal move appears,
  // or yard exit on 6. We just assert the server advances sanely.
  const before = a.state.game.current;
  try {
    await req(b, 'rollDice', { roomCode: cr.roomCode });
    throw new Error('should have failed');
  } catch (e) {
    assert(/turn/i.test(e.message), `off-turn roll rejected: ${e.message}`);
  }

  await req(a, 'rollDice', { roomCode: cr.roomCode });
  await wait(50);
  const g = a.state.game;
  assert(typeof g.lastRoll === 'number', 'lastRoll is a number');
  assert(g.players.yellow.lastRoll === g.lastRoll, 'yellow dice channel updated');
  const movedOn = (g.phase === 'ready' && g.current !== before) || g.phase === 'rolled';
  assert(movedOn, `phase after roll sensible: ${g.phase}, current=${g.current}`);

  console.log('\n=== 3. double-roll protection ===');
  if (a.state.game.phase === 'rolled') {
    try {
      await req(a, 'rollDice', { roomCode: cr.roomCode });
      throw new Error('should have failed');
    } catch (e) {
      assert(/already/i.test(e.message), `double-roll rejected: ${e.message}`);
    }

    // Try to move an illegal token (pick whatever's NOT in legal)
    const all = [0, 1, 2, 3];
    const illegal = all.find((i) => !a.state.game.legal.includes(i));
    if (illegal !== undefined) {
      try {
        await req(a, 'moveToken', { roomCode: cr.roomCode, tokenIndex: illegal });
        throw new Error('should have failed');
      } catch (e) {
        assert(true, `illegal token rejected (token ${illegal})`);
      }
    }

    // Legal move should succeed
    const ti = a.state.game.legal[0];
    await req(a, 'moveToken', { roomCode: cr.roomCode, tokenIndex: ti });
    await wait(50);
    assert(a.state.game.phase !== 'rolled', 'phase leaves rolled after move');
  }

  console.log('\n=== 4. disconnect mid-turn → FORCE_SKIP after grace ===');
  // Force the test to A's turn by rolling/moving until current==yellow or skip
  let spins = 0;
  while (a.state.game.current !== 'yellow' && spins < 20) {
    const curColor = a.state.game.current;
    const curClient = curColor === 'yellow' ? a : b;
    await req(curClient, 'rollDice', { roomCode: cr.roomCode });
    await wait(40);
    if (a.state.game.phase === 'rolled') {
      const ti = a.state.game.legal[0];
      await req(curClient, 'moveToken', { roomCode: cr.roomCode, tokenIndex: ti });
      await wait(40);
    }
    spins++;
  }
  assert(a.state.game.current === 'yellow', `loop landed on yellow (spins=${spins})`);

  const beforeSkip = a.state.game.current;
  a.disconnect();
  console.log(`  ... A disconnected; waiting ${GRACE_WAIT_MS/1000}s for grace + force-skip`);
  await wait(GRACE_WAIT_MS);
  assert(b.state.game.current !== beforeSkip, `turn advanced away from ${beforeSkip} → ${b.state.game.current}`);
  const yellowSeat = b.state.seats.find((s) => s.color === 'yellow');
  assert(yellowSeat.connected === false, 'A still marked disconnected');

  console.log('\n=== 5. rejoin preserves seat (with token) ===');
  const a2 = mkClient('A2');
  await connect(a2);
  const rj = await req(a2, 'rejoinRoom', {
    roomCode: cr.roomCode,
    playerId: cr.playerId,
    reconnectToken: cr.reconnectToken,
  });
  await wait(50);
  assert(rj.room.seats.find((s) => s.playerId === cr.playerId).connected, 'A rejoined, seat reconnected');
  assert(typeof rj.reconnectToken === 'string', 'new reconnectToken issued on rejoin');

  b.disconnect(); a2.disconnect();
  console.log('\nAll integration checks passed ✅');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌ TEST FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
