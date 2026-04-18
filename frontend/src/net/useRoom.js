// ---------------------------------------------------------------------------
// useRoom - client-side hook.
//
// The client is deliberately dumb. It does NOT compute game outcomes: it
// sends an intent (rollDice / moveToken) and waits for the server to
// broadcast a new `state`. React re-renders; the UI reflects whatever the
// server said was true.
//
// sessionStorage persists {roomCode, playerId} so a reload reconnects to
// the same seat - the server still has the seat reserved for the grace
// window and beyond (room lives 5 min after last disconnect).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import { socket, request } from './socket.js';

// Session secrets (playerId + reconnectToken + roomCode) live in
// sessionStorage - per-tab, auto-cleared on tab close. This limits blast
// radius of an XSS: another tab opened by the same attacker can't read it.
// The display name is a plain preference, so it sits in localStorage so a
// user doesn't have to re-type it every session.
const SESSION_KEY = 'ludo.session';
const PROFILE_KEY = 'ludo.profile';

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}
function saveSession(data) {
  if (!data) sessionStorage.removeItem(SESSION_KEY);
  else sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

export function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); }
  catch { return null; }
}
export function saveProfile(profile) {
  if (!profile) localStorage.removeItem(PROFILE_KEY);
  else localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function useRoom() {
  /** @type {[null|{roomCode:string, playerId:string, name:string}, Function]} */
  const [session, setSession] = useState(() => loadSession());
  /** @type {[null|object, Function]} */
  const [room, setRoom] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState(null);

  // ---- socket lifecycle ----------------------------------------------
  useEffect(() => {
    const tryAutoRejoin = () => {
      const saved = loadSession();
      if (!saved?.roomCode || !saved?.playerId || !saved?.reconnectToken) return;

      // URL hints at a DIFFERENT room than the stored session -> drop the
      // stale session so Menu can present the URL room to join.
      try {
        const params = new URLSearchParams(window.location.search);
        const urlRoom = params.get('room')?.toUpperCase();
        if (urlRoom && urlRoom !== saved.roomCode) {
          saveSession(null);
          setSession(null);
          setRoom(null);
          return;
        }
      } catch { /* no window? skip */ }

      request('rejoinRoom', {
        roomCode: saved.roomCode,
        playerId: saved.playerId,
        reconnectToken: saved.reconnectToken,
      })
        .then((ack) => {
          setRoom(ack.room);
          // Server may have issued a fresh token (always does in our impl).
          if (ack.reconnectToken) {
            const next = { ...saved, reconnectToken: ack.reconnectToken };
            saveSession(next);
            setSession(next);
          }
        })
        .catch(() => {
          saveSession(null);
          setSession(null);
          setRoom(null);
        });
    };

    const onConnect = () => {
      setConnected(true);
      tryAutoRejoin();
    };
    const onDisconnect = () => setConnected(false);
    const onState = (state) => setRoom(state);
    const onError = (payload) => setError(payload?.message || 'Error');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state', onState);
    socket.on('error', onError);

    // Socket may have already connected before this effect ran; if so, the
    // 'connect' handler we just registered will never fire for that event.
    // Kick the rejoin manually to cover that case.
    if (socket.connected) {
      setConnected(true);
      tryAutoRejoin();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state', onState);
      socket.off('error', onError);
    };
  }, []);

  // ---- intents --------------------------------------------------------

  const createRoom = useCallback(async ({ name, capacity }) => {
    setError(null);
    const ack = await request('createRoom', { name, capacity });
    const next = {
      roomCode: ack.roomCode,
      playerId: ack.playerId,
      reconnectToken: ack.reconnectToken,
      name,
    };
    saveSession(next);
    saveProfile({ name }); // remember name for future sessions
    setSession(next);
    setRoom(ack.room);
    return ack;
  }, []);

  const joinRoom = useCallback(async ({ roomCode, name }) => {
    setError(null);
    const upper = roomCode.toUpperCase();
    const ack = await request('joinRoom', { roomCode: upper, name });
    const next = {
      roomCode: upper,
      playerId: ack.playerId,
      reconnectToken: ack.reconnectToken,
      name,
    };
    saveSession(next);
    saveProfile({ name });
    setSession(next);
    setRoom(ack.room);
    return ack;
  }, []);

  const leaveRoom = useCallback(async () => {
    const saved = loadSession();
    if (saved?.roomCode) {
      try { await request('leaveRoom', { roomCode: saved.roomCode }); } catch { /* ignore */ }
    }
    saveSession(null);
    setSession(null);
    setRoom(null);
  }, []);

  const startGame = useCallback(async () => {
    const saved = loadSession();
    if (!saved) return;
    await request('startGame', { roomCode: saved.roomCode });
  }, []);

  const rollDice = useCallback(async () => {
    const saved = loadSession();
    if (!saved) return;
    await request('rollDice', { roomCode: saved.roomCode });
  }, []);

  const moveToken = useCallback(async (tokenIndex) => {
    const saved = loadSession();
    if (!saved) return;
    await request('moveToken', { roomCode: saved.roomCode, tokenIndex });
  }, []);

  const restart = useCallback(async () => {
    const saved = loadSession();
    if (!saved) return;
    await request('restartGame', { roomCode: saved.roomCode });
  }, []);

  const voteRematch = useCallback(async () => {
    const saved = loadSession();
    if (!saved) return;
    await request('voteRematch', { roomCode: saved.roomCode });
  }, []);

  return {
    connected,
    session,
    room,
    error,
    clearError: () => setError(null),
    createRoom,
    joinRoom,
    leaveRoom,
    startGame,
    rollDice,
    moveToken,
    restart,
    voteRematch,
  };
}
