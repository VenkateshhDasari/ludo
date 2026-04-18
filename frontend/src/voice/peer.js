// ---------------------------------------------------------------------------
// Peer - a thin wrapper around RTCPeerConnection for ONE remote player.
//
// Responsibilities:
//   - Own the RTCPeerConnection's lifecycle (create, offer/answer, close).
//   - Forward stream / state-change events to listeners via a tiny emitter.
//   - Restart ICE on failure (no manual glare dance - the initiator simply
//     re-offers with iceRestart:true).
//
// Non-responsibilities:
//   - No React. No socket. No DOM.
//   - Does NOT manage multiple peers. useVoice does that.
//   - Does NOT know about game state. Voice is a parallel system.
// ---------------------------------------------------------------------------

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class Peer {
  /**
   * @param {object} opts
   * @param {string} opts.targetId         remote playerId
   * @param {MediaStream} opts.localStream local mic stream (already live)
   * @param {boolean} opts.isInitiator     true if WE should send the offer
   * @param {(targetId:string, payload:object)=>void} opts.sendSignal
   */
  constructor({ targetId, localStream, isInitiator, sendSignal, iceServers }) {
    this.targetId = targetId;
    this.isInitiator = isInitiator;
    this.sendSignal = sendSignal;
    this.closed = false;

    this.pc = new RTCPeerConnection({
      iceServers: iceServers || DEFAULT_ICE_SERVERS,
    });

    this.remoteStream = new MediaStream();
    this.listeners = {};

    // Attach our local audio tracks so the remote hears us.
    for (const track of localStream.getAudioTracks()) {
      this.pc.addTrack(track, localStream);
    }

    this.pc.ontrack = (e) => {
      // Incoming remote tracks. Pool them into a single MediaStream so the
      // consumer can point one <audio> element at it.
      for (const t of e.streams[0]?.getTracks() ?? e.track ? [e.track] : []) {
        if (!this.remoteStream.getTracks().includes(t)) this.remoteStream.addTrack(t);
        t.addEventListener('ended', () => this._emit('trackEnded', t));
        t.addEventListener('mute',  () => this._emit('trackMute',  t));
        t.addEventListener('unmute',() => this._emit('trackUnmute',t));
      }
      this._emit('stream', this.remoteStream);
    };

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal(this.targetId, { type: 'candidate', candidate: e.candidate.toJSON() });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const s = this.pc.iceConnectionState;
      this._emit('iceState', s);
      // Automatic recovery: only initiator re-offers to avoid double-restart.
      if (s === 'failed' && this.isInitiator && !this.closed) {
        this._renegotiate({ iceRestart: true }).catch(() => {/* swallow */});
      }
    };

    this.pc.onconnectionstatechange = () => this._emit('connectionState', this.pc.connectionState);
    this.pc.onsignalingstatechange = () => this._emit('signalingState', this.pc.signalingState);
    this.pc.onnegotiationneeded = () => {
      // onnegotiationneeded fires on initial addTrack (initiator) AND on
      // iceRestart calls. We only want to make an offer if we're the
      // initiator; otherwise await the remote's offer.
      if (this.isInitiator && !this.closed) this._renegotiate().catch(() => {});
    };
  }

  // ---- tiny emitter ----------------------------------------------------
  on(event, cb) {
    (this.listeners[event] ||= new Set()).add(cb);
    return () => this.listeners[event]?.delete(cb);
  }
  _emit(event, value) {
    this.listeners[event]?.forEach((cb) => {
      try { cb(value); } catch (e) { console.warn('peer listener error', e); }
    });
  }

  // ---- offer / answer flow ---------------------------------------------
  async _renegotiate({ iceRestart = false } = {}) {
    if (this.closed) return;
    const offer = await this.pc.createOffer({ iceRestart });
    await this.pc.setLocalDescription(offer);
    this.sendSignal(this.targetId, { type: 'offer', sdp: this.pc.localDescription });
  }

  /** Remote sent us an offer. Answer it. */
  async acceptOffer(sdp) {
    if (this.closed) return;
    await this.pc.setRemoteDescription(sdp);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.sendSignal(this.targetId, { type: 'answer', sdp: this.pc.localDescription });
  }

  /** Remote answered our offer. */
  async acceptAnswer(sdp) {
    if (this.closed) return;
    await this.pc.setRemoteDescription(sdp);
  }

  /** Remote sent an ICE candidate. */
  async addCandidate(candidate) {
    if (this.closed || !candidate) return;
    try { await this.pc.addIceCandidate(candidate); }
    catch (e) { /* often benign: candidates arriving out of order */ }
  }

  /** getStats summary for the debug panel. */
  async stats() {
    try {
      const s = await this.pc.getStats();
      let packetsReceived = 0, bytesReceived = 0, jitter = null;
      s.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') {
          packetsReceived = r.packetsReceived ?? packetsReceived;
          bytesReceived = r.bytesReceived ?? bytesReceived;
          jitter = r.jitter ?? jitter;
        }
      });
      return { packetsReceived, bytesReceived, jitter };
    } catch { return null; }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.pc.getSenders().forEach((s) => {
        try { /* local tracks are shared with the mic stream; do NOT stop */ } catch {}
      });
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.onconnectionstatechange = null;
      this.pc.onsignalingstatechange = null;
      this.pc.onnegotiationneeded = null;
      this.pc.close();
    } catch {}
    this.remoteStream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    this.listeners = {};
  }
}
