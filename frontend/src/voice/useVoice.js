// ---------------------------------------------------------------------------
// useVoice - parallel system to useRoom. Never touches game state.
//
// Responsibilities:
//   1. getUserMedia({audio:true}) once on mount; stop on unmount.
//   2. Reconcile a Map<playerId, Peer> against the current seat list.
//   3. Bridge server 'voice:signal' events to the right Peer instance.
//   4. Expose mute/unmute, mic error, autoplay recovery, and a per-peer
//      status snapshot (for VoiceBar).
//
// Design choices:
//   - Peer map lives in useRef, not useState. Its lifecycle is longer and
//     more chaotic than React would like; React state holds only the
//     READ-ONLY snapshot (state strings + stream presence) that the UI renders.
//   - Initiator rule: me.playerId < them.playerId. Deterministic both sides.
//   - Audio elements are created via ref so re-renders don't restart them.
//   - Voice-activity analyser runs on a CLONED MediaStream so Chrome doesn't
//     mute the <audio> element (known browser behaviour when the same
//     stream is attached to both an <audio> and a MediaStreamSourceNode).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { socket } from '../net/socket.js';
import { Peer } from './peer.js';

const STATS_INTERVAL_MS = 1500;

export function useVoice({ enabled, roomCode, myPlayerId, seats }) {
  const [muted, setMuted] = useState(true);
  const [micError, setMicError] = useState(null);
  const [micReady, setMicReady] = useState(false);
  const [peerStates, setPeerStates] = useState({});
  const [speakingMap, setSpeakingMap] = useState({});
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const audioElsRef = useRef(new Map());
  const analysersRef = useRef(new Map());

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

  // Voice-activity analyser. Declared BEFORE attachAudio because attachAudio
  // calls it; JavaScript's temporal dead zone would otherwise crash at mount.
  const attachAnalyser = useCallback((playerId, stream) => {
    const prev = analysersRef.current.get(playerId);
    if (prev) {
      try { cancelAnimationFrame(prev.raf); } catch {}
      try { prev.ctx.close(); } catch {}
      if (prev.analysisStream) {
        try { prev.analysisStream.getTracks().forEach((t) => t.stop()); } catch {}
      }
      analysersRef.current.delete(playerId);
    }

    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      // Chrome mutes an <audio> element whose srcObject stream is ALSO piped
      // into a MediaStreamAudioSourceNode. Clone the tracks into a separate
      // MediaStream consumed only by the analyser so <audio> plays normally.
      const analysisStream = new MediaStream(
        stream.getAudioTracks().map((t) => t.clone())
      );
      const ctx = new Ctor();
      const src = ctx.createMediaStreamSource(analysisStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastSpeak = 0;
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i] - 128);
          if (v > peak) peak = v;
        }
        const now = Date.now();
        const isSpeaking = peak > 12;
        if (isSpeaking) lastSpeak = now;
        const display = now - lastSpeak < 300;
        setSpeakingMap((prev) =>
          prev[playerId] === display ? prev : { ...prev, [playerId]: display }
        );
        const entry = analysersRef.current.get(playerId);
        if (entry) entry.raf = requestAnimationFrame(loop);
      };
      const entry = { ctx, src, analyser, data, raf: 0, analysisStream };
      analysersRef.current.set(playerId, entry);
      entry.raf = requestAnimationFrame(loop);
    } catch (e) {
      // AudioContext failed; skip speaking detection for this peer.
    }
  }, []);

  const attachAudio = useCallback((playerId, stream) => {
    let el = audioElsRef.current.get(playerId);
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.playsInline = true;
      el.muted = false;
      el.volume = 1.0;
      el.setAttribute('data-peer', playerId);
      document.body.appendChild(el);
      audioElsRef.current.set(playerId, el);
    }
    el.srcObject = stream;
    el.muted = false;
    el.volume = 1.0;
    const playPromise = el.play?.();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.catch(() => setAutoplayBlocked(true));
    }
    attachAnalyser(playerId, stream);
  }, [attachAnalyser]);

  const resumeAudio = useCallback(() => {
    for (const el of audioElsRef.current.values()) {
      try { el.muted = false; el.play?.().catch(() => {}); } catch {}
    }
    setAutoplayBlocked(false);
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
      if (entry.analysisStream) {
        try { entry.analysisStream.getTracks().forEach((t) => t.stop()); } catch {}
      }
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
      peersRef.current.forEach((p) => p.close());
      peersRef.current.clear();
      audioElsRef.current.forEach((el) => { try { el.remove(); } catch {} });
      audioElsRef.current.clear();
      analysersRef.current.forEach((entry) => {
        try { cancelAnimationFrame(entry.raf); } catch {}
        try { entry.ctx.close(); } catch {}
        if (entry.analysisStream) {
          try { entry.analysisStream.getTracks().forEach((t) => t.stop()); } catch {}
        }
      });
      analysersRef.current.clear();
      setMicReady(false);
      setPeerStates({});
      setSpeakingMap({});
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

    for (const existingId of Array.from(peersRef.current.keys())) {
      if (!remotePlayerIds.includes(existingId)) tearDownPeer(existingId);
    }
    for (const pid of remotePlayerIds) {
      if (peersRef.current.has(pid)) continue;
      const isInitiator = myPlayerId < pid;
      createPeer(pid, { isInitiator });
    }
  }, [enabled, micReady, myPlayerId, remotePlayerIds, createPeer, tearDownPeer]);

  // -------------------------------------------------------------- signaling

  useEffect(() => {
    const onSignal = async ({ fromPlayerId, payload }) => {
      if (!payload) return;
      let peer = peersRef.current.get(fromPlayerId);
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

  // -------------------------------------------------------------- stats poll

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
    autoplayBlocked,
    resumeAudio,
  };
}
