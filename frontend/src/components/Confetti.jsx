// ---------------------------------------------------------------------------
// Canvas confetti. Pure client-side. Particle system runs for ~4s then the
// canvas self-removes. Colors come from the four Ludo palettes.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { COLOR_HEX } from '@shared/constants.js';

const DURATION_MS = 4000;
const PARTICLE_COUNT = 180;

export default function Confetti({ active }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx.scale(dpr, dpr);

    const palette = Object.values(COLOR_HEX).concat(['#F5C34E', '#FFFDF6']);
    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 80,
      y: window.innerHeight / 2 + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 16 - 4,
      g: 0.4,
      size: 4 + Math.random() * 6,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      color: palette[Math.floor(Math.random() * palette.length)],
    }));

    startRef.current = performance.now();
    const tick = (now) => {
      const t = now - startRef.current;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      particles.forEach((p) => {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        const alpha = Math.max(0, 1 - t / DURATION_MS);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      });
      if (t < DURATION_MS) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [active]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-50"
      aria-hidden
    />
  );
}
