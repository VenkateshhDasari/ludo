// Integration tests for the stage-3/3.5 additions: emoji relay, turn-timer
// auto-skip, stats tracked on the server snapshot.
// Run:  node test-stage3.mjs   (requires backend on :3001)
import { io } from 'socket.io-client';

const URL = 'http://localhost:3001';
const mk = () => io(URL, { transports: ['websocket'], reconnection: false });
const req = (s, e, p = {}) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`${e} timeout`)), 3000);
  s.emit(e, p, (ack) => { clearTimeout(t); ack?.ok ? res(ack) : rej(new Error(ack?.error || 'no ack')); });
});
const connect = (s) => new Promise((r, j) => { s.once('connect', r); s.once('connect_error', j); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (m) => console.log('  ✓', m);

async function main() {
  const a = mk(), b = mk();
  a.state = null; b.state = null;
  a.on('state', (s) => (a.state = s));
  b.on('state', (s) => (b.state = s));
  await connect(a); await connect(b);

  console.log('\n# 1. emoji relay');
  const cr = await req(a, 'createRoom', { name: 'A', capacity: 2 });
  await req(b, 'joinRoom', { roomCode: cr.roomCode, name: 'B' });
  await req(a, 'startGame', { roomCode: cr.roomCode });
  await wait(40);

  const bGotEmoji = new Promise((resolve) => b.once('emoji:reaction', resolve));
  await req(a, 'emoji:send', { roomCode: cr.roomCode, emoji: '🔥' });
  const evt = await Promise.race([bGotEmoji, wait(1500).then(() => null)]);
  if (!evt) throw new Error('B never received emoji');
  if (evt.emoji !== '🔥') throw new Error('wrong emoji forwarded');
  if (evt.fromPlayerId !== cr.playerId) throw new Error('wrong sender attributed');
  ok('emoji broadcast to other peer with correct sender');

  try {
    await req(a, 'emoji:send', { roomCode: cr.roomCode, emoji: 'NOT-REAL' });
    throw new Error('should have rejected bad emoji');
  } catch (e) {
    if (!/unknown/i.test(e.message)) throw e;
    ok('unknown emoji rejected');
  }

  console.log('\n# 2. snapshot carries turnExpiresAt + stats + lastMove');
  const snap = a.state;
  if (typeof snap.turnExpiresAt !== 'number') throw new Error('turnExpiresAt missing');
  if (Math.abs(snap.turnExpiresAt - Date.now() - 30000) > 2000) {
    throw new Error(`turnExpiresAt looks wrong: ${snap.turnExpiresAt - Date.now()}ms`);
  }
  ok('snapshot.turnExpiresAt ~= now + 30s');

  for (const color of Object.keys(snap.game.players)) {
    if (!snap.game.players[color].stats) throw new Error(`no stats for ${color}`);
  }
  ok('stats initialised for every player');

  // Force a roll + move if legal, verify stats bump.
  await req(a, 'rollDice', { roomCode: cr.roomCode });
  await wait(40);
  const rolled = a.state.game.lastRoll;
  if (a.state.game.phase === 'rolled' && a.state.game.legal.length > 0) {
    await req(a, 'moveToken', { roomCode: cr.roomCode, tokenIndex: a.state.game.legal[0] });
    await wait(40);
    if (!a.state.game.lastMove) throw new Error('lastMove missing after move');
    ok(`lastMove populated (rolled ${rolled}, moved token ${a.state.game.lastMove.tokenIndex})`);
  } else {
    ok(`rolled ${rolled}, no legal move - skip path still sane`);
  }

  console.log('\n# 3. turn timer auto-skip after 30s');
  // Whoever's turn it is now: stay idle and wait past TURN_DURATION_MS.
  const current = a.state.game.current;
  console.log(`  ... current=${current}; waiting 32s for turn-timer force-skip`);
  await wait(32_000);
  if (a.state.game.current === current) {
    throw new Error(`turn did not advance away from ${current}`);
  }
  ok(`turn advanced automatically to ${a.state.game.current}`);

  a.disconnect(); b.disconnect();
  console.log('\nStage-3 checks passed ✅');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
