// ---------------------------------------------------------------------------
// Backend keepalive ping. While the user has an active room, hit /health
// every 4 minutes so the free-tier PaaS host (Render free dyno) keeps the
// server warm and doesn't sleep mid-game.
//
// 4 min < Render's 15 min idle threshold. The same client also has a live
// socket open which counts as traffic, but the explicit HTTP ping is
// belt-and-braces in case the socket transport gets downgraded to polling
// or temporarily detaches.
// ---------------------------------------------------------------------------

import { useEffect } from 'react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const PING_INTERVAL_MS = 4 * 60 * 1000;

export function useKeepalive(active) {
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      fetch(`${SERVER_URL}/health`, { cache: 'no-store' }).catch(() => {});
    };
    // Fire immediately so the FIRST page-load also wakes the dyno.
    tick();
    const id = setInterval(tick, PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active]);
}
