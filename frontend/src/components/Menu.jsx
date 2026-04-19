// ---------------------------------------------------------------------------
// Stage-2 menu. Three panes:
//   1. Home       - enter name + Create or Join
//   2. Create     - pick capacity
//   3. Join       - enter room code (prefilled if ?room= was in the URL)
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { COLORS, COLOR_HEX, COLOR_HEX_DARK } from '@shared/constants.js';
import { loadProfile } from '../net/useRoom.js';

function DecoPawn({ color, delay }) {
  return (
    <div
      className="w-10 h-10 rounded-full border shadow-token animate-bob"
      style={{
        background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.85) 0%, ${COLOR_HEX[color]} 40%, ${COLOR_HEX_DARK[color]} 100%)`,
        borderColor: COLOR_HEX_DARK[color],
        animationDelay: `${delay}ms`,
      }}
    />
  );
}

function getRoomFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('room')?.toUpperCase() ?? '';
  } catch {
    return '';
  }
}

export default function Menu({ onCreate, onJoin, error, connected }) {
  const initialRoomCode = getRoomFromUrl();
  const initialProfile = loadProfile();
  const initialName = initialProfile?.name || '';

  const [pane, setPane] = useState(initialRoomCode ? 'join' : 'home');
  const [name, setName] = useState(initialName);
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [capacity, setCapacity] = useState(4);
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState(null);

  useEffect(() => setLocalErr(error), [error]);

  // Frictionless join: if the URL carries ?room=... AND we already know
  // the user's name from a previous session, skip the menu entirely and
  // fire the join immediately. Guarded against double-fires with a ref.
  const autoJoinRef = useRef(false);
  useEffect(() => {
    if (autoJoinRef.current) return;
    if (!connected) return;
    if (!initialRoomCode || !initialName.trim()) return;
    autoJoinRef.current = true;
    setBusy(true);
    onJoin({ name: initialName.trim(), roomCode: initialRoomCode })
      .catch((e) => {
        // Auto-join failed (room gone, full, etc). Fall back to manual form.
        setLocalErr(e.message);
        setBusy(false);
        autoJoinRef.current = false;
      });
  }, [connected, initialRoomCode, initialName, onJoin]);

  const finalName = name.trim();

  const doCreate = async () => {
    if (!finalName) return setLocalErr('Enter a name first');
    setBusy(true); setLocalErr(null);
    try { await onCreate({ name: finalName, capacity }); }
    catch (e) { setLocalErr(e.message); }
    finally { setBusy(false); }
  };

  const doJoin = async () => {
    if (!finalName) return setLocalErr('Enter a name first');
    if (!roomCode.trim()) return setLocalErr('Enter a room code');
    setBusy(true); setLocalErr(null);
    try { await onJoin({ name: finalName, roomCode: roomCode.trim().toUpperCase() }); }
    catch (e) { setLocalErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="relative w-full max-w-md">
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 flex gap-3">
          {COLORS.map((c, i) => <DecoPawn key={c} color={c} delay={i * 150} />)}
        </div>

        <div className="rounded-3xl p-8 pt-14 border border-white/10 bg-chrome-900/80 backdrop-blur-xl shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)]">
          <div className="text-center">
            <div className="text-xs tracking-[0.35em] text-gold-400 font-display font-semibold mb-2">
              THE FRIENDS GAME
            </div>
            <h1 className="font-display font-bold text-white text-5xl leading-none">LUDO</h1>
            <p className="mt-3 text-white/70 text-sm">
              Create a room, share the link, roll the dice.
            </p>
            <div className="mt-3 inline-flex items-center gap-2 text-[11px] uppercase tracking-widest">
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'}`} />
              <span className={connected ? 'text-emerald-300' : 'text-rose-300'}>
                {connected ? 'server online' : 'connecting…'}
              </span>
            </div>
          </div>

          {/* Name field - always visible */}
          <label className="mt-6 block">
            <span className="text-[11px] uppercase tracking-widest text-white/50 font-display">
              Your name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Venky"
              maxLength={20}
              className="mt-1 w-full bg-transparent border-b border-white/20 focus:border-gold-400 outline-none py-2 text-white font-display placeholder:text-white/30"
            />
          </label>

          {pane === 'home' && (
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button onClick={() => setPane('create')} className="btn-primary py-5 flex-col gap-0">
                <span className="font-display">Create</span>
                <span className="text-[11px] uppercase tracking-widest opacity-70">new room</span>
              </button>
              <button onClick={() => setPane('join')} className="btn-ghost py-5 flex-col gap-0">
                <span className="font-display">Join</span>
                <span className="text-[11px] uppercase tracking-widest opacity-70">with code</span>
              </button>
            </div>
          )}

          {pane === 'create' && (
            <div className="mt-6">
              <div className="text-[11px] uppercase tracking-widest text-white/50 font-display mb-2">
                Room size
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setCapacity(n)}
                    className={`rounded-2xl border py-3 font-display transition
                      ${capacity === n
                        ? 'border-gold-400 bg-gold-400/10 text-white'
                        : 'border-white/10 bg-chrome-800/40 text-white/70'}`}
                  >
                    <div className="text-xl font-bold">{n}</div>
                    <div className="text-[10px] uppercase tracking-widest opacity-60">players</div>
                  </button>
                ))}
              </div>

              <div className="mt-6 flex gap-2">
                <button onClick={() => setPane('home')} className="btn-ghost flex-1" disabled={busy}>Back</button>
                <button onClick={doCreate} className="btn-primary flex-1" disabled={busy || !connected}>
                  {busy ? '…' : 'Create room'}
                </button>
              </div>
            </div>
          )}

          {pane === 'join' && (
            <div className="mt-6">
              <label className="block">
                <span className="text-[11px] uppercase tracking-widest text-white/50 font-display">
                  Room code
                </span>
                <input
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  maxLength={6}
                  className="mt-1 w-full tracking-[0.4em] text-center text-2xl bg-chrome-800/40 border border-white/10 rounded-xl py-3 font-display text-white placeholder:text-white/20 focus:border-gold-400 outline-none"
                />
              </label>

              <div className="mt-6 flex gap-2">
                <button onClick={() => setPane('home')} className="btn-ghost flex-1" disabled={busy}>Back</button>
                <button onClick={doJoin} className="btn-primary flex-1" disabled={busy || !connected}>
                  {busy ? '…' : 'Join room'}
                </button>
              </div>
            </div>
          )}

          {localErr && (
            <div className="mt-4 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
              {localErr}
            </div>
          )}

          <div className="mt-6 text-center text-[11px] text-white/40 uppercase tracking-widest">
            Stage 2 · Online rooms
          </div>
        </div>
      </div>
    </div>
  );
}
