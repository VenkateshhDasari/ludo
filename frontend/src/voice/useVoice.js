// ---------------------------------------------------------------------------
// useVoice - parallel system to useRoom. Never touches game state.
//
// Responsibilities:
//   1. getUserMedia({audio:true}) once on mount; stop on unmount.
//   2. Reconcile a Map<playerId, Peer> against the current seat list.
//   3. Bridge server 'voice:signal' events to the right Peer instance.
//   4. Expose mute/unmute, mic error, and a per-peer status snapshot.
//
// Design choices:
//   - Peer map lives in useRef, not useState. Its lifecycle is longer and
//     more chaotic than React would like; React state holds only the
//     READ-ONLY snapshot (state strings + stream presence) that the UI renders.
//   - Initiator rule: me.playerId < them.playerId. Deterministic both sides.
//   - Audio elements are created via ref so re-renders don't restart them.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { socket } from '../net/socket.js';
import { Peer } from './peer.js';

const STATS_INTERVAL_MS = 1500;

export function useVoice({ enabled, roomCode, myPlayerId, seats }) {
  const [muted, setMuted] = useState(true); // start muted - no surprise hot-mic
  const [micError, setMicError] = useState(null);
  const [micReady, setMicReady] = useState(false);
  /**
   * peerStates:
   *   playerId -> { connectionState, iceState, signalingState, streaming,
   *                 packetsReceived, jitter }
   */
  const [peerStates, setPeerStates] = useState({});

  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const audioElsRef = useRef(new Map());   // playerId -> HTMLAudioElement

  // -------------------------------------------------------------- helpers

  const sendSignal = useCallback((targetPlayerId, payload) => {
    socket.emit('voice:signal', { roomCode, targetPlayerId, payload });
  }, [roomCode]);

  const bumpPeerState = useCallback((playerId, patch) => {
    setPeerStates((prev) => ({
      ...prev,
      [playerId]: { ...prev[playerId], ...patch },
    }));
  }, []);

  const attachAudio = useCallback((playerId, stream) => {
    let el = audioElsRef.current.get(playerId);
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.playsInline = true;
      el.setAttribute('data-peer', playerId);
      // Append to body so it keeps playing across re-renders.
      document.body.appendChild(el);
      audioElsRef.current.set(playerId, el);
    }
    el.srcObject = stream;
    el.play?.().catch(() => {/* some browsers require a gesture first */});
    // Attach / reattach a voice-activity analyser so the UI can pulse this
    // peer's avatar when they're actually speaking.
    attachAnalyser(playerId, stream);
  }, []);

  // ---- speaking detection (AnalyserNode polling) --------------------------
  const analysersRef = useRef(new Map()); // playerId -> {ctx, src, analyser, data, raf}
  const [speakingMap, setSpeakingMap] = useState({});

  const attachAnalyser = useCallback((playerId, stream) => {
    // Tear down any previous analyser for this peer.
    const prev = analysersRef.current.get(playerId);
    if (prev) { try { cancelAnimationFrame(prev.raf); prev.ctx.close(); } catch {} analysersRef.current.delete(playerId); }

    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastSpeak = 0;
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        // Normalised peak deviation from 128 (silence baseline).
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i] - 128);
          if (v > peak) peak = v;
        }
        const now = Date.now();
        const isSpeaking = peak > 12; // empirical threshold
        if (isSpeaking) lastSpeak = now;
        // Debounce: stay "speaking" for 300ms after last threshold trip.
        const display = now - lastSpeak < 300;
        setSpeakingMap((prev) =>
          prev[playerId] === display ? prev : { ...prev, [playerId]: display }
        );
        const entry = analysersRef.current.get(playerId);
        if (entry) entry.raf = requestAnimationFrame(loop);
      };
      const entry = { ctx, src, analyser, data, raf: 0 };
      analysersRef.current.set(playerId, entry);
      entry.raf = requestAnimationFrame(loop);
    } catch (e) {
      // AudioContext failed; skip speaking detection for this peer.
    }
  }, []);

  const removeAudio = useCallback((playerId) => {
    const el = audioElsRef.current.get(playerId);
    if (el) {
      try { el.srcObject = null; } catch {}
      try { el.remove(); } catch {}
      audioElsRef.current.delete(playerId);
    }
    const entry = analysersRef.current.get(playerId);
    if (entry) {
      try { cancelAnimationFrame(entry.raf); } catch {}
      try { entry.ctx.close(); } catch {}
      analysersRef.current.delete(playerId);
    }
    setSpeakingMap((prev) => {
      if (!(playerId in prev)) return prev;
      const next = { ...prev }; delete next[playerId]; return next;
    });
  }, []);

  const tearDownPeer = useCallback((playerId) => {
    const p = peersRef.current.get(playerId);
    if (p) p.close();
    peersRef.current.delete(playerId);
    removeAudio(playerId);
    setPeerStates((prev) => {
      const next = { ...prev };
      delete next[playerId];
      return next;
    });
  }, [removeAudio]);

  const createPeer = useCallback((targetId, { isInitiator }) => {
    if (!localStreamRef.current) return null;
    const peer = new Peer({
      targetId,
      localStream: localStreamRef.current,
      isInitiator,
      sendSignal,
    });
    peer.on('connectionState', (s) => bumpPeerState(targetId, { connectionState: s }));
    peer.on('iceState', (s) => bumpPeerState(targetId, { iceState: s }));
    peer.on('signalingState', (s) => bumpPeerState(targetId, { signalingState: s }));
    peer.on('stream', (stream) => {
      attachAudio(targetId, stream);
      bumpPeerState(targetId, { streaming: true });
    });
    peer.on('trackEnded', () => bumpPeerState(targetId, { streaming: false }));
    peersRef.current.set(targetId, peer);
    bumpPeerState(targetId, {
      connectionState: peer.pc.connectionState,
      iceState: peer.pc.iceConnectionState,
      signalingState: peer.pc.signalingState,
      streaming: false,
    });
    return peer;
  }, [attachAudio, bumpPeerState, sendSignal]);

  // -------------------------------------------------------------- mic

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        // Start muted - flip .enabled when the user hits the mic button.
        stream.getAudioTracks().forEach((t) => { t.enabled = false; });
        localStreamRef.current = stream;
        setMicReady(true);
        setMicError(null);
      })
      .catch((err) => {
        console.warn('getUserMedia failed', err);
        setMicError(err.message || 'Microphone denied');
      });

    return () => {
      cancelled = true;
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      // Tear down every peer.
      peersRef.current.forEach((p) => p.close());
      peersRef.current.clear();
      audioElsRef.current.forEach((el) => { try { el.remove(); } catch {} });
      audioElsRef.current.clear();
      setMicReady(false);
      setPeerStates({});
    };
  }, [enabled]);

  // -------------------------------------------------------------- reconcile

  const remotePlayerIds = useMemo(
    () => (seats || [])
      .filter((s) => s.playerId !== myPlayerId && s.connected)
      .map((s) => s.playerId),
    [seats, myPlayerId]
  );

  useEffect(() => {
    if (!enabled || !micReady || !myPlayerId) return;

    // 1. Close peers for seats that disappeared.
    for (const existingId of Array.from(peersRef.current.keys())) {
      if (!remotePlayerIds.includes(existingId)) tearDownPeer(existingId);
    }
    // 2. Open peers for new seats.
    for (const pid of remotePlayerIds) {
      if (peersRef.current.has(pid)) continue;
      // String compare keeps both sides in agreement on who offers.
      const isInitiator = myPlayerId < pid;
      createPeer(pid, { isInitiator });
      // Initiator offer is triggered by onnegotiationneeded after addTrack.
    }
  }, [enabled, micReady, myPlayerId, remotePlayerIds, createPeer, tearDownPeer]);

  // -------------------------------------------------------------- signaling bridge

  useEffect(() => {
    const onSignal = async ({ fromPlayerId, payload }) => {
      if (!payload) return;
      let peer = peersRef.current.get(fromPlayerId);

      // Lazy-create peer on incoming offer - covers the race where the
      // remote's offer arrives before our seats effect has run.
      if (!peer && payload.type === 'offer' && localStreamRef.current) {
        peer = createPeer(fromPlayerId, { isInitiator: false });
      }
      if (!peer) return;

      try {
        switch (payload.type) {
          case 'offer':     await peer.acceptOffer(payload.sdp);       break;
          case 'answer':    await peer.acceptAnswer(payload.sdp);      break;
          case 'candidate': await peer.addCandidate(payload.candidate);break;
          case 'bye':       tearDownPeer(fromPlayerId);                break;
        }
      } catch (err) {
        console.warn(`voice:${payload.type} failed from`, fromPlayerId, err);
      }
    };
    socket.on('voice:signal', onSignal);
    return () => socket.off('voice:signal', onSignal);
  }, [createPeer, tearDownPeer]);

  // -------------------------------------------------------------- stats polling

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(async () => {
      for (const [pid, peer] of peersRef.current) {
        const s = await peer.stats();
        if (s) bumpPeerState(pid, s);
      }
    }, STATS_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, bumpPeerState]);

  // -------------------------------------------------------------- mute

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    setMuted((prev) => {
      const next = !prev;
      stream.getAudioTracks().forEach((t) => { t.enabled = !next; });
      return next;
    });
  }, []);

  return {
    micReady,
    micError,
    muted,
    toggleMute,
    peerStates,
    speakingMap,
  };
}
