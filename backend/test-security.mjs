// ---------------------------------------------------------------------------
// Security + unknown-bug integration test.
//   - Seat-hijack via rejoinRoom (must fail without valid token)
//   - reconnectToken never appears in broadcast snapshots
//   - Name length capped server-side
//   - Rate limiter actually rejects floods
//   - Invalid tokenIndex shapes rejected
//   - Roll / move phase guards hold
//   - Voice signal to non-existent target
//   - createRoom storm rate-limited
// Requires backend on :3001. Run:  node test-security.mjs
// ---------------------------------------------------------------------------
import { io } from 'socket.io-client';

const URL = 'http://localhost:3001';
const mk = () => io(URL, { transports: ['websocket'], reconnection: false });
const req = (s, e, p = {}, timeoutMs = 3000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`${e} timeout`)), timeoutMs);
  s.emit(e, p, (ack) => { clearTimeout(t); ack?.ok ? res(ack) : rej(new Error(ack?.error || 'no ack')); });
});
const reqRaw = (s, e, p = {}, timeoutMs = 3000) => new Promise((res) => {
  const t = setTimeout(() => res({ ok: false, error: 'timeout' }), timeoutMs);
  s.emit(e, p, (ack) => { clearTimeout(t); res(ack || { ok: false, error: 'no ack' }); });
});
const connect = (s) => new Promise((r, j) => { s.once('connect', r); s.once('connect_error', j); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (m) => console.log('  ✓', m);
const fail = (m) => { console.error('  ✗', m); throw new Error(m); };

async function main() {
  const a = mk(); const b = mk();
  a.state = null; b.state = null;
  a.on('state', (s) => (a.state = s));
  b.on('state', (s) => (b.state = s));
  await connect(a); await connect(b);

  console.log('\n# 1. reconnectToken returned on create/join and NOT in broadcast');
  const cr = await req(a, 'createRoom', { name: 'Alice', capacity: 4 });
  if (typeof cr.reconnectToken !== 'string' || cr.reconnectToken.length < 8) fail('createRoom ack missing reconnectToken');
  ok('createRoom ack includes reconnectToken');

  const jn = await req(b, 'joinRoom', { roomCode: cr.roomCode, name: 'Bob' });
  if (typeof jn.reconnectToken !== 'string') fail('joinRoom ack missing reconnectToken');
  ok('joinRoom ack includes reconnectToken');

  await wait(30);
  const snap = b.state;
  for (const seat of snap.seats) {
    if ('reconnectToken' in seat) fail(`seat ${seat.name} leaks reconnectToken in snapshot`);
  }
  ok('broadcast snapshot never contains reconnectToken');

  console.log('\n# 2. Seat hijack attempts');
  // Attacker (C) knows Alice's playerId from the broadcast. Tries to rejoin
  // as her WITHOUT the token.
  const c = mk(); await connect(c);
  const hj1 = await reqRaw(c, 'rejoinRoom', { roomCode: cr.roomCode, playerId: cr.playerId });
  if (hj1.ok) fail('rejoin without token succeeded - hijack possible');
  ok(`rejoin without token rejected: ${hj1.error}`);

  const hj2 = await reqRaw(c, 'rejoinRoom', { roomCode: cr.roomCode, playerId: cr.playerId, reconnectToken: 'garbage' });
  if (hj2.ok) fail('rejoin with wrong token succeeded');
  ok(`rejoin with wrong token rejected: ${hj2.error}`);

  // Verify Alice (the real owner) can still rejoin with the real token.
  a.disconnect();
  await wait(40);
  const a2 = mk();
  a2.state = null;
  a2.on('state', (s) => (a2.state = s));
  await connect(a2);
  const rj = await req(a2, 'rejoinRoom', { roomCode: cr.roomCode, playerId: cr.playerId, reconnectToken: cr.reconnectToken });
  await wait(50);
  ok('legit token-based rejoin still works');
  // Server rotates token on rejoin
  if (rj.reconnectToken === cr.reconnectToken) fail('server did not rotate token on rejoin');
  ok('rejoin rotates the reconnectToken');

  console.log('\n# 3. Name length capped');
  const huge = 'X'.repeat(500);
  const bigNameSocket = mk(); await connect(bigNameSocket);
  const bn = await reqRaw(bigNameSocket, 'createRoom', { name: huge, capacity: 2 });
  if (!bn.ok) fail(`createRoom rejected huge name: ${bn.error}`);
  const nameSeat = bn.room.seats[0];
  if (nameSeat.name.length > 32) fail(`name length ${nameSeat.name.length} exceeds cap`);
  ok(`name length capped to ${nameSeat.name.length} chars`);
  bigNameSocket.disconnect();

  console.log('\n# 4. Invalid tokenIndex shapes rejected');
  // Start the game first (Alice is host).
  await req(a2, 'startGame', { roomCode: cr.roomCode });
  await wait(30);

  // Cycle until we have legal moves for current player.
  const current = () => a2.state.game.current;
  const currentClient = () => (current() === 'yellow' ? a2 : b);
  let spins = 0;
  while (a2.state.game.phase !== 'rolled' && spins < 20) {
    await req(currentClient(), 'rollDice', { roomCode: cr.roomCode });
    await wait(30);
    if (a2.state.game.phase === 'rolled' && a2.state.game.legal.length === 0) {
      // Impossible by construction but guard anyway
      break;
    }
    spins += 1;
  }
  if (a2.state.game.phase === 'rolled' && a2.state.game.legal.length > 0) {
    for (const bad of [-1, 7, 999, NaN, 'hello', null, 0.5]) {
      const r = await reqRaw(currentClient(), 'moveToken', { roomCode: cr.roomCode, tokenIndex: bad });
      if (r.ok) fail(`server accepted invalid tokenIndex=${String(bad)}`);
    }
    ok('all bogus tokenIndex values rejected');
  } else {
    ok('phase did not land on rolled (all skips) - invalid-token path not exercised');
  }

  console.log('\n# 5. Phase guards');
  const roll1 = await reqRaw(b, 'rollDice', { roomCode: cr.roomCode });
  if (roll1.ok) fail('off-turn roll should be rejected');
  ok(`off-turn roll rejected: ${roll1.error}`);

  console.log('\n# 6. voice:signal to non-existent target');
  const vs = await reqRaw(a2, 'voice:signal', {
    roomCode: cr.roomCode,
    targetPlayerId: 'nobody-exists',
    payload: { type: 'offer', sdp: {} },
  });
  if (vs.ok) fail('voice:signal to ghost target accepted');
  ok(`voice:signal to non-existent target rejected: ${vs.error}`);

  console.log('\n# 7. Rate limiter - flood emoji');
  let rejected = 0;
  for (let i = 0; i < 20; i++) {
    const r = await reqRaw(a2, 'emoji:send', { roomCode: cr.roomCode, emoji: '🔥' });
    if (!r.ok && /rate/i.test(r.error || '')) rejected += 1;
  }
  if (rejected === 0) fail('emoji rate limit never triggered');
  ok(`emoji flood: ${rejected}/20 rejected by rate limiter`);

  console.log('\n# 8. Rate limiter - flood createRoom');
  const spammer = mk(); await connect(spammer);
  let crRejected = 0;
  for (let i = 0; i < 10; i++) {
    const r = await reqRaw(spammer, 'createRoom', { name: `spam${i}`, capacity: 2 });
    if (!r.ok && /rate/i.test(r.error || '')) crRejected += 1;
  }
  if (crRejected === 0) fail('createRoom rate limit never triggered');
  ok(`createRoom flood: ${crRejected}/10 rejected by rate limiter`);
  spammer.disconnect();

  console.log('\n# 9. Unknown room code rejected');
  const unknown = await reqRaw(a2, 'joinRoom', { roomCode: 'NOTREAL', name: 'X' });
  if (unknown.ok) fail('join to nonexistent room succeeded');
  ok(`join nonexistent room rejected: ${unknown.error}`);

  console.log('\n# 10. Over-sized voice payload rejected');
  const giant = { type: 'offer', sdp: { type: 'offer', sdp: 'A'.repeat(50_000) } };
  const big = await reqRaw(a2, 'voice:signal', { roomCode: cr.roomCode, targetPlayerId: jn.playerId, payload: giant });
  if (big.ok) fail('giant voice payload accepted');
  ok(`50KB voice payload rejected: ${big.error}`);

  a2.disconnect(); b.disconnect(); c.disconnect();
  console.log('\nSecurity checks passed ✅');
  process.exit(0);
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
