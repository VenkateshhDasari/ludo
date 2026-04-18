// ---------------------------------------------------------------------------
// Dice primitive with a pre-roll tumble animation.
//
// Whenever `value` transitions from "null/prev" to a NEW numeric value we
// cycle random faces for ~400ms then settle on the real result. Pure UI
// trickery - the server already decided the outcome before this dice ever
// animates, but the tumble makes the roll feel physical.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';

const PIPS = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

const TUMBLE_FRAMES = 8;
const FRAME_MS = 55;

export default function Dice({ value, canRoll, onRoll, colorHex, compact = false }) {
  const [display, setDisplay] = useState(value);
  const prevValueRef = useRef(value);
  const tumbleTimerRef = useRef(null);

  useEffect(() => {
    const prev = prevValueRef.current;
    prevValueRef.current = value;
    if (value === prev) return;

    // Value went away (turn ended / cleared) - just clear instantly.
    if (value == null) { setDisplay(null); return; }

    // Run the tumble animation. cancel any previous one first.
    if (tumbleTimerRef.current) clearTimeout(tumbleTimerRef.current);
    let frame = 0;
    const tick = () => {
      frame += 1;
      if (frame >= TUMBLE_FRAMES) {
        setDisplay(value);
        tumbleTimerRef.current = null;
        return;
      }
      setDisplay(1 + Math.floor(Math.random() * 6));
      tumbleTimerRef.current = setTimeout(tick, FRAME_MS);
    };
    tumbleTimerRef.current = setTimeout(tick, FRAME_MS);

    return () => {
      if (tumbleTimerRef.current) clearTimeout(tumbleTimerRef.current);
    };
  }, [value]);

  const face = display ? PIPS[display] : [];
  const size = compact ? 'w-12 h-12 rounded-lg' : 'w-16 h-16 rounded-xl';
  const btn  = compact ? 'text-[11px] py-1 px-2.5' : 'text-sm py-2 px-4';

  return (
    <div className={`flex flex-col items-center ${compact ? 'gap-1' : 'gap-2'}`}>
      <div
        className={`${size} bg-white shadow-dice relative ${canRoll ? 'ring-2 ring-gold-400' : ''}`}
        style={{
          background: 'linear-gradient(145deg, #ffffff 0%, #f1eadb 100%)',
          border: '1px solid rgba(15,25,60,0.12)',
          transform: tumbleTimerRef.current ? 'rotate(6deg)' : 'rotate(0)',
          transition: 'transform 80ms',
        }}
        aria-label={display ? `dice shows ${display}` : 'dice'}
      >
        <div className="absolute inset-[14%] grid grid-cols-3 grid-rows-3 gap-[6%]">
          {Array.from({ length: 9 }, (_, i) => (
            <div
              key={i}
              className={`rounded-full ${face.includes(i + 1) ? 'bg-chrome-900' : 'bg-transparent'}`}
              style={
                face.includes(i + 1)
                  ? {
                      boxShadow:
                        'inset 0 2px 2px rgba(255,255,255,0.3), 0 1px 0 rgba(255,255,255,0.5)',
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      <button
        onClick={onRoll}
        disabled={!canRoll}
        className={`btn-primary ${btn} disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none`}
        style={canRoll && colorHex ? { backgroundColor: colorHex, color: '#0F193C' } : undefined}
      >
        Roll
      </button>
    </div>
  );
}
