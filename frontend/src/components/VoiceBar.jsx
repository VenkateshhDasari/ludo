// ---------------------------------------------------------------------------
// VoiceBar - mic button + per-peer connection dots + a small debug drawer.
// The dots are a diagnostic surface: one glance tells you which layer is
// unhealthy if audio cuts out mid-game (signaling/ICE/peer/track/media).
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { COLOR_HEX } from '@shared/constants.js';

function dotColor(peer) {
  if (!peer) return '#64748b';
  if (peer.iceState === 'failed' || peer.connectionState === 'failed') return '#ef4444';
  if (peer.streaming && (peer.iceState === 'connected' || peer.iceState === 'completed')) return '#22c55e';
  if (peer.iceState === 'checking' || peer.connectionState === 'connecting') return '#eab308';
  return '#64748b';
}

function PeerDot({ seat, peer }) {
  const color = dotColor(peer);
  const title = peer
    ? `${seat.name} · ice:${peer.iceState ?? '?'} · conn:${peer.connectionState ?? '?'} · stream:${peer.streaming ? 'yes' : 'no'}`
    : `${seat.name} · no peer`;
  return (
    <div
      title={title}
      className="flex items-center gap-1.5 rounded-full px-2 py-1 bg-chrome-800/70 border border-white/10"
    >
      <span
        className="w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}80` }}
      />
      <span
        className="text-[11px] font-display uppercase tracking-wider"
        style={{ color: COLOR_HEX[seat.color] }}
      >
        {seat.name}
      </span>
    </div>
  );
}

export default function VoiceBar({ seats, myPlayerId, voice }) {
  const { muted, toggleMute, micReady, micError, peerStates } = voice;
  const [open, setOpen] = useState(false);

  const peers = (seats || []).filter((s) => s.playerId !== myPlayerId);

  return (
    <div className="rounded-2xl border border-white/10 bg-chrome-900/70 backdrop-blur p-3">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleMute}
          disabled={!micReady}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl font-display text-sm transition
            ${muted
              ? 'bg-chrome-800 border border-white/10 text-white/80'
              : 'bg-emerald-500 text-chrome-900 shadow-[0_4px_0_0_#047857]'}
            disabled:opacity-40 disabled:cursor-not-allowed`}
          aria-pressed={!muted}
        >
          <span aria-hidden className="text-lg leading-none">
            {muted ? '🔇' : '🎤'}
          </span>
          {muted ? 'Muted' : 'Live'}
        </button>

        <div className="flex-1 flex flex-wrap gap-1.5 min-w-0">
          {peers.length === 0 && (
            <span className="text-xs text-white/40 italic">No peers yet</span>
          )}
          {peers.map((seat) => (
            <PeerDot key={seat.playerId} seat={seat} peer={peerStates[seat.playerId]} />
          ))}
        </div>

        <button
          onClick={() => setOpen((o) => !o)}
          className="text-[10px] uppercase tracking-widest text-white/50 hover:text-white px-2 py-1 rounded border border-white/10"
          title="WebRTC debug panel"
        >
          {open ? 'hide' : 'debug'}
        </button>
      </div>

      {micError && (
        <div className="mt-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2 py-1.5">
          Mic: {micError}. Grant permission and reload to enable voice.
        </div>
      )}

      {open && (
        <div className="mt-3 border-t border-white/5 pt-3 text-[11px] font-mono text-white/70 space-y-1 max-h-48 overflow-auto">
          {peers.length === 0 && <div className="opacity-60">no peer stats</div>}
          {peers.map((seat) => {
            const p = peerStates[seat.playerId] || {};
            return (
              <div key={seat.playerId} className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="text-white/90">{seat.name}</span>
                <span>ice:<span className="text-white">{p.iceState ?? '—'}</span></span>
                <span>conn:<span className="text-white">{p.connectionState ?? '—'}</span></span>
                <span>sig:<span className="text-white">{p.signalingState ?? '—'}</span></span>
                <span>stream:<span className="text-white">{p.streaming ? 'yes' : 'no'}</span></span>
                <span>pkts:<span className="text-white">{p.packetsReceived ?? 0}</span></span>
                <span>jitter:<span className="text-white">{p.jitter != null ? p.jitter.toFixed(3) : '—'}</span></span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
