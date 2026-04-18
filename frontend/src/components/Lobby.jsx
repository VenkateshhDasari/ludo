// ---------------------------------------------------------------------------
// Pre-game waiting room. Shows the room code, a copyable share link, the
// seat list (with connection status), and the host-only Start control.
// ---------------------------------------------------------------------------

import { useState, useSyncExternalStore } from 'react';
import { COLOR_HEX, COLOR_HEX_DARK } from '@shared/constants.js';
import { socket } from '../net/socket.js';

function subscribeSocket(cb) {
  socket.on('connect', cb);
  socket.on('disconnect', cb);
  return () => { socket.off('connect', cb); socket.off('disconnect', cb); };
}
function useSocketConnected() {
  return useSyncExternalStore(subscribeSocket, () => socket.connected, () => false);
}

function LobbyConnectionDot() {
  const online = useSocketConnected();
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-display uppercase tracking-widest ${online ? 'text-emerald-300' : 'text-rose-300'}`}
    >
      <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'}`} />
      {online ? 'server online' : 'reconnecting'}
    </span>
  );
}

function SeatCard({ seat, isYou, isHost }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-chrome-800/60 px-3 py-2.5">
      <div
        className={`w-10 h-10 rounded-full border shrink-0 transition ${seat.connected ? '' : 'grayscale opacity-50'}`}
        style={{
          background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.75) 0%, ${COLOR_HEX[seat.color]} 45%, ${COLOR_HEX_DARK[seat.color]} 100%)`,
          borderColor: COLOR_HEX_DARK[seat.color],
        }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-widest text-white/50 font-display">
          {seat.color}
        </div>
        <div className="text-white font-display truncate flex items-center gap-1.5">
          {seat.name}
          {isYou && <span className="text-[10px] uppercase tracking-widest text-gold-400">you</span>}
          {isHost && <span className="text-[10px] uppercase tracking-widest text-white/50">host</span>}
          {!seat.connected && (
            <span className="text-[10px] uppercase tracking-widest text-rose-300">offline</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Lobby({ room, session, onStart, onLeave }) {
  const [copied, setCopied] = useState(false);
  const isHost = room.hostId === session.playerId;
  const canStart = isHost && room.seats.filter((s) => s.connected).length >= 2;

  const link = `${window.location.origin}${window.location.pathname}?room=${room.code}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard may be blocked, ignore */ }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-chrome-900/80 backdrop-blur-xl p-6 md:p-8 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)]">
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-[0.35em] text-gold-400 font-display">
            Room
          </div>
          <div className="mt-1 font-display font-bold text-white text-4xl tracking-[0.4em]">
            {room.code}
          </div>
          <p className="mt-2 text-xs text-white/60">
            {room.seats.length}/{room.capacity} players · waiting{isHost ? ' — you are host' : ''}
          </p>
          <div className="mt-2">
            <LobbyConnectionDot />
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <input
            readOnly
            value={link}
            className="flex-1 rounded-xl bg-chrome-800/60 border border-white/10 px-3 py-2 text-sm text-white/80 font-sans"
            onFocus={(e) => e.target.select()}
          />
          <button onClick={copyLink} className="btn-primary text-sm py-2 px-3">
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          {room.seats.map((seat) => (
            <SeatCard
              key={seat.playerId}
              seat={seat}
              isYou={seat.playerId === session.playerId}
              isHost={seat.playerId === room.hostId}
            />
          ))}
          {Array.from({ length: room.capacity - room.seats.length }, (_, i) => (
            <div
              key={`empty-${i}`}
              className="rounded-2xl border border-dashed border-white/10 px-3 py-2.5 text-white/40 text-sm italic"
            >
              Waiting for player…
            </div>
          ))}
        </div>

        <div className="mt-6 flex gap-2">
          <button onClick={onLeave} className="btn-ghost flex-1">Leave</button>
          <button onClick={onStart} className="btn-primary flex-1" disabled={!canStart}>
            {isHost ? (canStart ? 'Start game' : 'Need 2+ players') : 'Waiting for host'}
          </button>
        </div>
      </div>
    </div>
  );
}
