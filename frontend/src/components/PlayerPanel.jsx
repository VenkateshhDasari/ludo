// ---------------------------------------------------------------------------
// PlayerChip:
//   - avatar (with voice activity pulse + disconnect badge + YOU glow)
//   - turn timer ring (SVG circle drain) when this seat holds the turn
//   - floating emoji reaction bubble above the avatar
//   - name/color label + "X/4" finished count
//   - per-player dice (only clickable if isSelf && isActive && phase==='ready')
// EventLog: compact scrollable feed.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { COLOR_HEX, COLOR_HEX_DARK, STEPS_TO_FINISH, TURN_DURATION_MS } from '@shared/constants.js';
import Dice from './Dice.jsx';

// Re-render every 100ms while a turn is active so the countdown animates.
function useTick(active, ms = 100) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

// Avatar is 48x48 with a 4px "ring" border, so its visual footprint is 56x56.
// The turn ring lives OUTSIDE that ring - at 72x72 - so it's clearly visible.
// A "XXs" countdown pill sits just below the avatar for accessibility.
function TurnRing({ expiresAt }) {
  useTick(!!expiresAt);
  if (!expiresAt) return null;
  const remaining = Math.max(0, expiresAt - Date.now());
  const frac = Math.min(1, remaining / TURN_DURATION_MS);
  const SIZE = 72;
  const cx = SIZE / 2;
  const r = cx - 4;
  const C = 2 * Math.PI * r;
  const offset = C * (1 - frac);
  const secs = Math.ceil(remaining / 1000);
  return (
    <>
      <svg
        className="absolute pointer-events-none"
        width={SIZE} height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ top: -12, left: -12 }}
      >
        <circle cx={cx} cy={cx} r={r}
          fill="none" stroke="rgba(245,195,78,0.2)" strokeWidth="3" />
        <circle cx={cx} cy={cx} r={r}
          fill="none" stroke="#F5C34E" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      </svg>
    </>
  );
}

function Avatar({ color, label, active, connected, speaking, turnExpiresAt }) {
  const secs = active && turnExpiresAt
    ? Math.max(0, Math.ceil((turnExpiresAt - Date.now()) / 1000))
    : null;
  // Force re-render every 500ms while a turn ticks down so the seconds text
  // above the avatar stays in sync without hammering the DOM.
  useTick(active && !!turnExpiresAt, 500);

  return (
    <div className="relative">
      {active && turnExpiresAt && <TurnRing expiresAt={turnExpiresAt} />}
      <div
        className={`relative w-12 h-12 rounded-full ring-4 flex items-center justify-center font-display font-bold text-white text-lg shadow-lg transition
          ${active ? 'scale-110' : ''}
          ${connected === false ? 'grayscale opacity-60' : ''}
          ${speaking ? 'voice-pulse' : ''}
        `}
        style={{
          background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.7) 0%, ${COLOR_HEX[color]} 45%, ${COLOR_HEX_DARK[color]} 100%)`,
          borderColor: COLOR_HEX_DARK[color],
          ['--tw-ring-color']: COLOR_HEX_DARK[color],
        }}
      >
        <span className="drop-shadow-[0_1px_0_rgba(0,0,0,0.35)]">{label}</span>

        {/* Connection status dot (green when online, red OFF when not). */}
        {connected !== false ? (
          <span
            className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-chrome-900"
            title="Online"
            aria-label="online"
          />
        ) : (
          <span className="absolute -top-1 -right-1 text-[9px] font-display font-semibold px-1.5 py-0.5 rounded-full bg-rose-500 text-white shadow">
            OFF
          </span>
        )}

        {/* TURN badge (replaced by countdown when the turn timer is active). */}
        {active && (
          <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-display font-semibold px-1.5 py-0.5 rounded-full bg-gold-400 text-chrome-900 shadow whitespace-nowrap">
            {secs != null ? `${secs}s` : 'TURN'}
          </span>
        )}
      </div>
    </div>
  );
}

function FloatingEmoji({ emoji, t }) {
  // Anchored at the HORIZONTAL centre of the avatar wrapper, at the VERTICAL
  // top. The keyframe animates translate(-50%, -Npx) so the bubble always
  // grows upward from just above the avatar. Range is kept tight (max -68px)
  // so top-row chips don't push it above the viewport.
  return (
    <div
      key={t}
      className="absolute left-1/2 top-0 text-3xl pointer-events-none z-20"
      style={{ animation: 'emojiFloat 1800ms ease-out forwards' }}
    >
      {emoji}
    </div>
  );
}

/**
 * @param {object} props
 * @param {string}  props.color
 * @param {object}  props.state             server game state
 * @param {object}  props.seat              server seat object (name/connected)
 * @param {boolean} props.isSelf
 * @param {Function} props.onRoll
 * @param {'left'|'right'} props.align
 * @param {number|null} props.turnExpiresAt ms epoch of current turn deadline (null if not their turn)
 * @param {boolean} props.speaking
 * @param {{emoji:string, t:number}|null} props.reaction
 */
export function PlayerChip({
  color, state, seat, isSelf, onRoll, align = 'left',
  turnExpiresAt = null, speaking = false, reaction = null,
}) {
  const p = state?.players?.[color];
  if (!p || !seat) return null;
  const finished = p.tokens.filter((s) => s === STEPS_TO_FINISH).length;
  const isActive = state.current === color && !state.winner;
  const isWinner = state.winner === color;
  const canRoll = isSelf && isActive && state.phase === 'ready';
  const rowDir = align === 'right' ? 'flex-row-reverse' : 'flex-row';

  return (
    <div className={`flex items-center gap-3 ${rowDir}`}>
      <div className="relative">
        <Avatar
          color={color}
          label={(seat.name || '?')[0].toUpperCase()}
          active={isActive}
          connected={seat.connected}
          speaking={speaking}
          turnExpiresAt={isActive ? turnExpiresAt : null}
        />
        {reaction && <FloatingEmoji emoji={reaction.emoji} t={reaction.t} />}
      </div>

      <div
        className={`px-3 py-1.5 rounded-2xl border backdrop-blur font-display relative
          ${isActive ? 'border-gold-400 bg-chrome-800/80' : 'border-white/10 bg-chrome-900/60'}
          ${isSelf ? 'shadow-[0_0_0_2px_rgba(245,195,78,0.45)]' : ''}
        `}
      >
        <div className="text-[11px] uppercase tracking-widest text-white/60 truncate max-w-[110px] flex items-center gap-1">
          {isWinner ? 'Winner' : color}
          {isSelf && (
            <span className="text-[9px] tracking-widest px-1 py-[1px] rounded-sm bg-gold-400 text-chrome-900 font-bold">
              YOU
            </span>
          )}
        </div>
        <div className="text-sm font-semibold text-white flex items-center gap-1.5">
          <span className="truncate max-w-[110px]">{seat.name}</span>
          <span className="opacity-60">· {finished}/4</span>
          {seat.sessionWins > 0 && (
            <span
              className="text-[10px] font-display font-bold px-1.5 py-[1px] rounded-full bg-gold-400/20 text-gold-400 border border-gold-400/40"
              title={`Wins this session: ${seat.sessionWins}`}
            >
              ★{seat.sessionWins}
            </span>
          )}
        </div>
      </div>

      <Dice
        compact
        value={p.lastRoll}
        canRoll={canRoll}
        onRoll={onRoll}
        colorHex={COLOR_HEX[color]}
      />
    </div>
  );
}

export function EventLog({ log }) {
  return (
    <div className="log rounded-2xl border border-white/10 bg-chrome-900/70 backdrop-blur p-3 max-h-44 overflow-auto font-sans text-sm text-white/80">
      <div className="text-xs uppercase tracking-widest text-white/50 mb-1 font-display">
        Feed
      </div>
      {(!log || log.length === 0) && <div className="italic opacity-50">Nothing yet</div>}
      {log?.map((line, i) => (
        <div key={i} className="py-0.5">• {line}</div>
      ))}
    </div>
  );
}
