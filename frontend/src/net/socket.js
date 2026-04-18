// ---------------------------------------------------------------------------
// Socket.io-client singleton. One connection per tab. The server URL is
// configurable through VITE_SERVER_URL; defaults to localhost:3001 in dev.
// ---------------------------------------------------------------------------

import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export const socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
});

/** Promise-ified emit that expects the server to ack with {ok, ...}. */
export function request(event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server timeout')), 5000);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      if (!ack) return reject(new Error('No response'));
      if (!ack.ok) return reject(new Error(ack.error || 'Request failed'));
      resolve(ack);
    });
  });
}
