// Targeted test for the "host left mid-game, came back via same name" fix.
import { io } from 'socket.io-client';

const URL = 'http://localhost:3001';
const mk = () => io(URL, { transports: ['websocket'], reconnection: false });
const req = (s, e, p = {}) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`${e} timeout`)), 3000);
  s.emit(e, p, (ack) => { clearTimeout(t); ack?.ok ? res(ack) : rej(new Error(ack?.error || 'no ack')); });
});
const connect = (s) => new Promise((r, j) => { s.once('connect', r); s.once('connect_error', j); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (msg) => console.log(`  ✓ ${msg}`);

async function main() {
  const a = mk(); const b = mk();
  a.state = null; b.state = null;
  a.on('state', (s) => (a.state = s));
  b.on('state', (s) => (b.state = s));
  await connect(a); await connect(b);

  const cr = await req(a, 'createRoom', { name: 'Venky', capacity: 2 });
  await req(b, 'joinRoom',   { roomCode: cr.roomCode, name: 'Bob' });
  await req(a, 'startGame',  { roomCode: cr.roomCode });
  await wait(60);
  ok('room started with Venky (host) + Bob');

  // Venky "leaves" - simulate Leave button: tell server, then drop socket.
  await req(a, 'leaveRoom', { roomCode: cr.roomCode });
  a.disconnect();
  await wait(80);
  const venkySeat = b.state.seats.find((s) => s.name === 'Venky');
  if (!venkySeat || venkySeat.connected) throw new Error('expected Venky seat disconnected');
  ok('Venky seat marked disconnected');

  // Venky tries to joinRoom again with same name. Should reclaim seat.
  const a2 = mk();
  await connect(a2);
  const rejoin = await req(a2, 'joinRoom', { roomCode: cr.roomCode, name: 'Venky' });
  ok(`reclaim succeeded, playerId=${rejoin.playerId === cr.playerId ? 'SAME' : 'DIFFERENT'}`);
  if (rejoin.playerId !== cr.playerId) throw new Error('reclaimed seat should retain original playerId');
  ok('reclaimed the ORIGINAL playerId (not a new seat)');

  // Case-insensitive match
  await req(a2, 'leaveRoom', { roomCode: cr.roomCode });
  a2.disconnect();
  await wait(60);
  const a3 = mk();
  await connect(a3);
  const r2 = await req(a3, 'joinRoom', { roomCode: cr.roomCode, name: 'venky' });
  if (r2.playerId !== cr.playerId) throw new Error('case-insensitive reclaim failed');
  ok('case-insensitive reclaim works');

  // Different name is still rejected
  await req(a3, 'leaveRoom', { roomCode: cr.roomCode });
  a3.disconnect();
  await wait(60);
  const c = mk(); await connect(c);
  try {
    await req(c, 'joinRoom', { roomCode: cr.roomCode, name: 'Stranger' });
    throw new Error('stranger should not join mid-game');
  } catch (e) {
    if (!/already started/i.test(e.message)) throw e;
    ok('unknown name still rejected with "Game already started"');
  }

  b.disconnect(); c.disconnect();
  console.log('\nReclaim checks passed ✅');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
