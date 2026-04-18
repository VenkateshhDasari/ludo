// ---------------------------------------------------------------------------
// Post-game summary + rematch voting UI.
//
// Every connected seat sees a "Rematch" button. Votes are broadcast; when
// all connected seats have voted, the server starts a 3s countdown and
// auto-restarts the game with seats + sessionWins preserved. Host also has
// a "Restart now" shortcut that bypasses the vote.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { COLOR_HEX, COLOR_HEX_DARK, STEPS_TO_FINISH } from '@shared/constants.js';

function rank(players, seatsByColor) {
  return Object.entries(players)
    .map(([color, p]) => ({
      color,
      name: p.name,
      finished: p.tokens.filter((s) => s === STEPS_TO_FINISH).length,
      stats: p.stats || { sixes: 0, captures: 0, finished: 0, steps: 0 },
      sessionWins: seatsByColor[color]?.sessionWins ?? 0,
    }))
    .sort((a, b) => b.finished - a.finished || b.stats.steps - a.stats.steps);
}

function useRematchCountdown(rematchStartsAt) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!rematchStartsAt) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [rematchStartsAt]);
  if (!rematchStartsAt) return null;
  return Math.max(0, Math.ceil((rematchStartsAt - now) / 1000));
}

export default function PostGame({ room, session, isHost, onRestart, onLeave, onVoteRematch }) {
  const game = room.game;
  const seatsByColor = {};
  for (const s of room.seats) seatsByColor[s.color] = s;
  const rows = rank(game.players, seatsByColor);

  const mySeat = room.seats.find((s) => s.playerId === session.playerId);
  const iVoted = !!mySeat?.wantsRematch;

  const connected = room.seats.filter((s) => s.connected);
  const votes = connected.filter((s) => s.wantsRematch).length;
  const needed = connected.length;

  const countdown = useRematchCountdown(room.rematchStartsAt);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-chrome-900 p-6 md:p-8 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)]">
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-[0.35em] text-gold-400 font-display">
            {countdown != null ? `New game in ${countdown}…` : 'Game over'}
          </div>
          <h2 className="font-display font-bold text-white text-3xl mt-1">
            {game.players[game.winner]?.name} wins!
          </h2>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-chrome-800/80 text-[11px] uppercase tracking-widest text-white/60 font-display">
                <th className="py-2 px-3 text-left">#</th>
                <th className="py-2 px-3 text-left">Player</th>
                <th className="py-2 px-3 text-right">Home</th>
                <th className="py-2 px-3 text-right">★</th>
                <th className="py-2 px-3 text-right">6s</th>
                <th className="py-2 px-3 text-right">Caps</th>
                <th className="py-2 px-3 text-right">Dist</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.color}
                  className={`border-t border-white/5 ${i === 0 ? 'bg-gold-400/10' : ''}`}
                >
                  <td className="py-2 px-3 text-white/70 font-display">{i + 1}</td>
                  <td className="py-2 px-3 text-white font-display">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full border"
                        style={{
                          background: COLOR_HEX[row.color],
                          borderColor: COLOR_HEX_DARK[row.color],
                        }}
                      />
                      {row.name}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right text-white">{row.finished}/4</td>
                  <td className="py-2 px-3 text-right text-gold-400 font-display">{row.sessionWins}</td>
                  <td className="py-2 px-3 text-right text-white/80">{row.stats.sixes}</td>
                  <td className="py-2 px-3 text-right text-white/80">{row.stats.captures}</td>
                  <td className="py-2 px-3 text-right text-white/80">{row.stats.steps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Rematch voting row */}
        <div className="mt-6 rounded-2xl border border-white/10 bg-chrome-800/60 p-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-white/60 font-display">
              Rematch
            </div>
            <div className="text-sm text-white">
              {countdown != null ? (
                <>Starting in <span className="font-display font-bold text-gold-400">{countdown}s</span></>
              ) : (
                <>{votes}/{needed} ready</>
              )}
            </div>
          </div>
          <button
            onClick={onVoteRematch}
            disabled={iVoted || countdown != null}
            className="btn-primary text-sm py-2 px-4"
          >
            {iVoted ? '✓ Ready' : 'Rematch'}
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={onLeave} className="btn-ghost flex-1">Leave room</button>
          {isHost && (
            <button onClick={onRestart} className="btn-ghost flex-1" title="Host-only instant restart">
              Restart (host)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
