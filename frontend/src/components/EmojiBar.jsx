// ---------------------------------------------------------------------------
// Quick emoji reactions. Wraps on narrow viewports instead of horizontal
// scroll so every button stays visible.
// ---------------------------------------------------------------------------

import { EMOJI_REACTIONS } from '@shared/constants.js';

export default function EmojiBar({ onSend, disabled }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-chrome-900/70 backdrop-blur p-2 flex flex-wrap items-center justify-center gap-1">
      <span className="text-[10px] uppercase tracking-widest text-white/50 font-display px-2 mr-auto">
        React
      </span>
      {EMOJI_REACTIONS.map((e) => (
        <button
          key={e}
          onClick={() => onSend(e)}
          disabled={disabled}
          className="text-2xl rounded-lg px-2 py-1 hover:bg-white/10 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={`send ${e}`}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
