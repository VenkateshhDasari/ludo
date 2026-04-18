// ---------------------------------------------------------------------------
// Tiny WebAudio-synth SFX. No external files, no libraries.
// Every sound is a few oscillator tones shaped with gain envelopes.
// Callers use the named helper (playDice, playMove, ...) directly.
// ---------------------------------------------------------------------------

let ctx = null;
let muted = false;

function getCtx() {
  if (ctx) return ctx;
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  try { ctx = new Ctor(); } catch { ctx = null; }
  return ctx;
}

export function setSfxMuted(v) { muted = !!v; }
export function isSfxMuted() { return muted; }

function tone(c, freq, duration, { type = 'sine', gain = 0.14, start = 0, rampTo = 0.0005 } = {}) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(gain, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(rampTo, c.currentTime + start + duration);
  osc.connect(g); g.connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + duration + 0.02);
}

function safePlay(render) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') { try { c.resume(); } catch {} }
  try { render(c); } catch {}
}

export function playDice() {
  safePlay((c) => {
    for (let i = 0; i < 4; i++) {
      const f = 500 + Math.random() * 300;
      tone(c, f, 0.08, { type: 'square', gain: 0.08, start: i * 0.06 });
    }
    // Landing thunk
    tone(c, 220, 0.14, { type: 'triangle', gain: 0.18, start: 0.26 });
  });
}

export function playMove() {
  safePlay((c) => {
    tone(c, 560, 0.08, { type: 'triangle', gain: 0.13 });
    tone(c, 820, 0.09, { type: 'triangle', gain: 0.10, start: 0.05 });
  });
}

export function playCapture() {
  safePlay((c) => {
    tone(c, 380, 0.14, { type: 'sawtooth', gain: 0.18 });
    tone(c, 220, 0.25, { type: 'sawtooth', gain: 0.15, start: 0.09 });
    tone(c, 140, 0.30, { type: 'square',  gain: 0.10, start: 0.16 });
  });
}

export function playFinish() {
  safePlay((c) => {
    [523, 659, 784].forEach((f, i) => tone(c, f, 0.18, { type: 'triangle', gain: 0.18, start: i * 0.08 }));
  });
}

export function playWin() {
  safePlay((c) => {
    const seq = [523, 659, 784, 1047, 1319];
    seq.forEach((f, i) => tone(c, f, 0.28, { type: 'triangle', gain: 0.22, start: i * 0.13 }));
  });
}

export function playEmoji() {
  safePlay((c) => tone(c, 880, 0.08, { type: 'sine', gain: 0.12 }));
}

export function playTurn() {
  safePlay((c) => {
    tone(c, 660, 0.08, { type: 'triangle', gain: 0.10 });
    tone(c, 990, 0.08, { type: 'triangle', gain: 0.10, start: 0.05 });
  });
}

// Short metronome click used in the last 5 seconds of a turn.
export function playTick() {
  safePlay((c) => tone(c, 1200, 0.04, { type: 'square', gain: 0.07 }));
}
