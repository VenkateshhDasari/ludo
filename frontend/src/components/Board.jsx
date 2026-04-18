// ---------------------------------------------------------------------------
// Classic Ludo board, with Stage-3.5 eye candy:
//   - useAnimatedPlayers  - bumps each token one step per 120ms until the
//                           displayed state matches the server state, so
//                           tokens "hop" cell by cell on long rolls.
//   - LastMoveArrow       - faint arrow from the last move's from-cell to
//                           its to-cell, fades out over ~1.5s.
//   - Capture flash       - shake class briefly applied to captured tokens.
//
// All eye candy is purely derived from the server snapshot and the previous
// displayed state. The reducer is untouched.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import {
  TRACK,
  START_INDEX,
  HOME_COLUMN,
  CENTER,
  COLORS,
  COLOR_HEX,
  COLOR_HEX_DARK,
  YARD_QUADRANT,
  SAFE_TRACK_INDICES,
} from '../game/constants.js';
import { resolveCell } from '../game/logic.js';

const SIZE = 15;
const ANIM_STEP_MS = 120;

// ------- lookups --------------------------------------------------------

const trackLookup = new Map();
TRACK.forEach(([r, c], i) => trackLookup.set(`${r},${c}`, i));

const homeLookup = new Map();
Object.entries(HOME_COLUMN).forEach(([color, cells]) => {
  cells.forEach(([r, c]) => homeLookup.set(`${r},${c}`, color));
});

const startLookup = new Map();
Object.entries(START_INDEX).forEach(([color, idx]) => {
  const [r, c] = TRACK[idx];
  startLookup.set(`${r},${c}`, color);
});

const yardLookup = new Map();
Object.entries(YARD_QUADRANT).forEach(([color, q]) => {
  for (let r = q.rows[0]; r <= q.rows[1]; r++) {
    for (let c = q.cols[0]; c <= q.cols[1]; c++) {
      yardLookup.set(`${r},${c}`, color);
    }
  }
});

// ------- hook: bump displayed tokens toward server tokens ---------------

function clonePlayers(p) {
  const out = {};
  for (const c of Object.keys(p)) out[c] = { ...p[c], tokens: [...p[c].tokens] };
  return out;
}

function useAnimatedPlayers(serverPlayers) {
  const [displayed, setDisplayed] = useState(() => clonePlayers(serverPlayers || {}));

  useEffect(() => {
    if (!serverPlayers) return;

    // Structure change (new game, different seats) - snap immediately.
    const same =
      Object.keys(serverPlayers).length === Object.keys(displayed).length &&
      Object.keys(serverPlayers).every((c) => displayed[c]);
    if (!same) {
      setDisplayed(clonePlayers(serverPlayers));
      return;
    }

    for (const color of Object.keys(serverPlayers)) {
      for (let i = 0; i < 4; i++) {
        const from = displayed[color].tokens[i];
        const to = serverPlayers[color].tokens[i];
        if (from === to) continue;
        const t = setTimeout(() => {
          setDisplayed((prev) => {
            const next = clonePlayers(prev);
            const cur = next[color].tokens[i];
            if (to > cur) next[color].tokens[i] = cur + 1;
            else next[color].tokens[i] = to; // capture -> snap home
            return next;
          });
        }, ANIM_STEP_MS);
        return () => clearTimeout(t);
      }
    }
  }, [displayed, serverPlayers]);

  return displayed;
}

// ------- primitives -----------------------------------------------------

function TokenPiece({ color, clickable, onClick, tokenIndex, justCaptured, mine }) {
  const base = COLOR_HEX[color];
  const dark = COLOR_HEX_DARK[color];
  const style = {
    background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.85) 0%, ${base} 40%, ${dark} 100%)`,
    borderColor: dark,
    // Always-on gold halo for MY tokens so I never lose track of my side.
    boxShadow: mine
      ? '0 0 0 2px rgba(245,195,78,0.65), 0 4px 6px -2px rgba(0,0,0,0.45), inset 0 -3px 0 rgba(0,0,0,0.28), inset 0 2px 0 rgba(255,255,255,0.55)'
      : undefined,
  };
  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      aria-label={`${color} token ${tokenIndex + 1}`}
      className={`relative rounded-full border shadow-token transition
        w-[68%] aspect-square
        ${clickable ? 'cursor-pointer animate-bob ring-2 ring-white/90' : 'cursor-default'}
        ${justCaptured ? 'animate-pop' : ''}
      `}
      style={style}
    >
      <span
        className="absolute inset-[18%] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 35% 30%, rgba(255,255,255,0.6), transparent 55%)',
        }}
      />
    </button>
  );
}

function YardPlate({ color, quadrant }) {
  const base = COLOR_HEX[color];
  const dark = COLOR_HEX_DARK[color];
  const left = (quadrant.cols[0] / SIZE) * 100;
  const top = (quadrant.rows[0] / SIZE) * 100;
  const width = ((quadrant.cols[1] - quadrant.cols[0] + 1) / SIZE) * 100;
  const height = ((quadrant.rows[1] - quadrant.rows[0] + 1) / SIZE) * 100;
  return (
    <div
      className="absolute rounded-[14px] shadow-plate"
      style={{
        left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`,
        background: `linear-gradient(180deg, ${base} 0%, ${dark} 100%)`,
      }}
    >
      <div className="absolute inset-[12%] rounded-[10px] bg-board-cell shadow-dock grid grid-cols-2 grid-rows-2 gap-[8%] p-[10%]">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-full"
            style={{
              background: `radial-gradient(circle at 50% 55%, ${base}33 0%, transparent 70%)`,
              boxShadow: `inset 0 0 0 3px ${dark}55`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CentreStar() {
  const left = (6 / SIZE) * 100;
  const top = (6 / SIZE) * 100;
  const size = (3 / SIZE) * 100;
  return (
    <div
      className="absolute"
      style={{ left: `${left}%`, top: `${top}%`, width: `${size}%`, height: `${size}%` }}
    >
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-glow">
        <polygon points="0,0 100,0 50,50" fill={COLOR_HEX.blue} />
        <polygon points="100,0 100,100 50,50" fill={COLOR_HEX.red} />
        <polygon points="100,100 0,100 50,50" fill={COLOR_HEX.green} />
        <polygon points="0,100 0,0 50,50" fill={COLOR_HEX.yellow} />
        <circle cx="50" cy="50" r="6" fill="#F5C34E" stroke="#0F193C" strokeWidth="1" />
      </svg>
    </div>
  );
}

function StarMark() {
  return (
    <svg viewBox="0 0 24 24" className="w-[70%] h-[70%] opacity-70" fill="none">
      <path
        d="M12 2l2.9 6.9L22 9.6l-5.4 4.7L18.2 22 12 18.3 5.8 22l1.6-7.7L2 9.6l7.1-.7L12 2z"
        fill="currentColor"
        stroke="#0F193C"
        strokeWidth="0.6"
      />
    </svg>
  );
}

const ARROW_ROT = { yellow: 0, blue: 90, red: 180, green: 270 };
function ArrowMark({ color }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-[75%] h-[75%]"
      fill="none"
      style={{ transform: `rotate(${ARROW_ROT[color] ?? 0}deg)` }}
    >
      <path
        d="M4 12h13m0 0l-5-5m5 5l-5 5"
        stroke="#0F193C"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ------- last-move arrow overlay ----------------------------------------

function LastMoveArrow({ lastMove, boardKey }) {
  const arrowRef = useRef(null);
  // Remount on every new lastMove so the fade animation replays.
  if (!lastMove) return null;
  const fromCell = resolveCell(lastMove.color, lastMove.tokenIndex, lastMove.fromSteps);
  const toCell = resolveCell(lastMove.color, lastMove.tokenIndex, lastMove.toSteps);
  // Translate to SVG coords (centered on each cell).
  const fx = (fromCell.rc[1] + 0.5) * (100 / SIZE);
  const fy = (fromCell.rc[0] + 0.5) * (100 / SIZE);
  const tx = (toCell.rc[1] + 0.5) * (100 / SIZE);
  const ty = (toCell.rc[0] + 0.5) * (100 / SIZE);
  const col = COLOR_HEX[lastMove.color];

  return (
    <svg
      key={boardKey}
      ref={arrowRef}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ animation: 'lastMoveFade 1500ms ease-out forwards' }}
    >
      <defs>
        <marker id={`arrowhead-${lastMove.color}`} markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill={col} />
        </marker>
      </defs>
      <line
        x1={fx} y1={fy} x2={tx} y2={ty}
        stroke={col}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeDasharray="2 1.5"
        markerEnd={`url(#arrowhead-${lastMove.color})`}
        opacity="0.85"
      />
    </svg>
  );
}

// ------- cell classifier ------------------------------------------------

function cellStyle(r, c, myColor) {
  const key = `${r},${c}`;
  if (r >= 6 && r <= 8 && c >= 6 && c <= 8) return { className: 'bg-transparent' };
  if (yardLookup.get(key)) return { className: 'bg-transparent' };

  const homeColor = homeLookup.get(key);
  if (homeColor) {
    const isMine = homeColor === myColor;
    return {
      className: '',
      style: {
        background: `linear-gradient(180deg, ${COLOR_HEX[homeColor]} 0%, ${COLOR_HEX_DARK[homeColor]} 100%)`,
        // My home column gets a subtle gold inner glow so my goal is obvious.
        boxShadow: isMine ? 'inset 0 0 6px 1px rgba(245,195,78,0.85)' : undefined,
      },
    };
  }

  const trackIdx = trackLookup.get(key);
  if (trackIdx !== undefined) {
    const startColor = startLookup.get(key);
    if (startColor) {
      return {
        className: '',
        style: {
          background: `linear-gradient(180deg, ${COLOR_HEX[startColor]}cc 0%, ${COLOR_HEX_DARK[startColor]}cc 100%)`,
          boxShadow: 'inset 0 0 0 1px rgba(15,25,60,0.3)',
        },
        marker: 'arrow',
        markerColor: startColor,
      };
    }
    if (SAFE_TRACK_INDICES.has(trackIdx)) {
      return {
        className: 'bg-board-cell',
        style: { boxShadow: 'inset 0 0 0 1px rgba(15,25,60,0.2)' },
        marker: 'star',
      };
    }
    return {
      className: 'bg-board-cell',
      style: { boxShadow: 'inset 0 0 0 1px rgba(15,25,60,0.18)' },
    };
  }
  return { className: 'bg-transparent' };
}

// ------- board ----------------------------------------------------------

function tokensByCell(players) {
  const map = new Map();
  Object.entries(players).forEach(([color, p]) => {
    p.tokens.forEach((steps, i) => {
      const { rc } = resolveCell(color, i, steps);
      const key = `${rc[0]},${rc[1]}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ color, tokenIndex: i, steps });
    });
  });
  return map;
}

export default function Board({
  players,
  currentColor,
  legal,
  onTokenClick,
  winner,
  lastMove,
  myColor,
}) {
  const displayed = useAnimatedPlayers(players);
  const tokens = tokensByCell(displayed);

  // Capture-flash bookkeeping: when a displayed token jumps from >0 to 0
  // (the snap-home in useAnimatedPlayers), mark it briefly for the pop anim.
  const prevDisplayedRef = useRef(displayed);
  const [flashing, setFlashing] = useState({}); // "color-i" -> true
  useEffect(() => {
    const prev = prevDisplayedRef.current;
    prevDisplayedRef.current = displayed;
    const keys = [];
    for (const color of Object.keys(displayed)) {
      if (!prev?.[color]) continue;
      for (let i = 0; i < 4; i++) {
        if (prev[color].tokens[i] > 0 && displayed[color].tokens[i] === 0) {
          keys.push(`${color}-${i}`);
        }
      }
    }
    if (keys.length === 0) return;
    setFlashing((f) => {
      const next = { ...f };
      keys.forEach((k) => { next[k] = true; });
      return next;
    });
    const t = setTimeout(() => {
      setFlashing((f) => {
        const next = { ...f };
        keys.forEach((k) => { delete next[k]; });
        return next;
      });
    }, 320);
    return () => clearTimeout(t);
  }, [displayed]);

  const lastMoveKey = lastMove
    ? `${lastMove.color}-${lastMove.tokenIndex}-${lastMove.fromSteps}-${lastMove.toSteps}`
    : '';

  return (
    <div className="w-full max-w-[560px] mx-auto">
      <div className="rounded-[28px] p-3 bg-gradient-to-br from-chrome-900 to-chrome-800 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
        <div className="relative aspect-square rounded-[18px] overflow-hidden bg-[#FFFDF6]">
          {COLORS.map((color) => (
            <YardPlate key={color} color={color} quadrant={YARD_QUADRANT[color]} />
          ))}

          <CentreStar />

          <div
            className="absolute inset-0 grid gap-0"
            style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }}
          >
            {Array.from({ length: SIZE * SIZE }, (_, idx) => {
              const r = Math.floor(idx / SIZE);
              const c = idx % SIZE;
              const style = cellStyle(r, c, myColor);
              const here = tokens.get(`${r},${c}`) || [];
              return (
                <div
                  key={idx}
                  className={`relative ${style.className ?? ''}`}
                  style={style.style}
                >
                  {style.marker === 'star' && (
                    <div className="absolute inset-0 flex items-center justify-center text-chrome-900">
                      <StarMark />
                    </div>
                  )}
                  {style.marker === 'arrow' && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <ArrowMark color={style.markerColor} />
                    </div>
                  )}

                  {here.length > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      {here.map((t, stackIdx) => {
                        const clickable =
                          !winner &&
                          t.color === currentColor &&
                          legal.includes(t.tokenIndex);
                        return (
                          <div
                            key={`${t.color}-${t.tokenIndex}`}
                            className="absolute flex items-center justify-center"
                            style={{
                              width: '100%',
                              height: '100%',
                              transform: here.length > 1
                                ? `translate(${(stackIdx - (here.length - 1) / 2) * 18}%, 0)`
                                : 'none',
                            }}
                          >
                            <TokenPiece
                              color={t.color}
                              clickable={clickable}
                              tokenIndex={t.tokenIndex}
                              onClick={() => clickable && onTokenClick(t.tokenIndex)}
                              justCaptured={!!flashing[`${t.color}-${t.tokenIndex}`]}
                              mine={t.color === myColor}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Last-move arrow overlay (above cells, below token buttons via svg) */}
          <LastMoveArrow lastMove={lastMove} boardKey={lastMoveKey} />
        </div>
      </div>
    </div>
  );
}
