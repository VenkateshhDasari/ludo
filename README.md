# Ludo — staged build

Multiplayer Ludo-style board game. Built in stages, each runnable on its own.

| Stage | Scope |
|-------|-------|
| 1 | Frontend + local hotseat logic. |
| 2 | Node/Express + Socket.io. Rooms, shareable join codes, server-authoritative state, disconnect + rejoin. |
| **3 (current)** | WebRTC mesh voice chat (audio only, mute). Server is pure signaling relay; media is peer-to-peer. |
| 4 | Production hosting (Render + Vercel), TURN for symmetric NAT, Redis for rooms, horizontal scale. |

---

## Architecture

```
ludo-game/
├── shared/            # Pure ESM, no deps, no React, no sockets.
│   ├── constants.js   # Board coords, colors, track, home columns, safe cells.
│   ├── logic.js       # resolveCell, legalTokens, applyMove, hasWon.
│   └── reducer.js     # Pure reducer. Deterministic. Takes dice in payload.
│
├── backend/           # Node 18+ / Express / Socket.io. In-memory rooms.
│   └── src/
│       ├── index.js   # HTTP + socket handlers.
│       ├── rooms.js   # Room registry (Map<code, Room>).
│       ├── room.js    # Room class — seats, timers, dispatch wrapper.
│       └── rng.js     # crypto.randomInt → dice + room codes.
│
└── frontend/          # Vite + React + Tailwind.
    └── src/
        ├── net/
        │   ├── socket.js    # socket.io-client singleton + promise-ified ack.
        │   └── useRoom.js   # Hook: intents → emit, server state → setState.
        ├── components/      # Menu, Lobby, Board, Dice, PlayerPanel
        └── App.jsx          # Room-phase routing.
```

The frontend imports the pure reducer modules via Vite's `@shared` alias.
The backend imports the same files over a relative path. One source, two
runtimes — the reducer can never silently drift.

---

## Run Stage 2

Two terminals.

**Backend**

```bash
cd ludo-game/backend
npm install
npm run dev         # listens on :3001
```

**Frontend**

```bash
cd ludo-game/frontend
npm install
npm run dev         # http://localhost:5173
```

Open two browser tabs (or two devices on the same LAN). In tab 1, enter a
name, click **Create**, pick a size. Copy the room link. Paste it into
tab 2 — the menu will pre-fill the code. Enter a name, click **Join**.
Host clicks **Start game** once at least 2 people have joined.

For cross-device play on a LAN, set `VITE_SERVER_URL` to the LAN IP of the
box running the backend:

```bash
VITE_SERVER_URL=http://192.168.1.20:3001 npm run dev
```

---

## Event flow — from A clicks Roll to B sees the board

1. **A's UI** — Roll button is enabled only when `isSelf && phase==='ready'`
   for A's chip. Click → `onRoll()`.
2. **A's socket** — `socket.emit('rollDice', {roomCode}, ack)`. No dice,
   no reducer, no local state change.
3. **Server** receives on A's socket. Looks up `socketId → {playerId, roomCode}`.
4. **Server validates** (throws → returns `{ok:false, error}`):
   - Room exists and is in `playing` phase.
   - `playerId`'s seat color === `room.game.current`.
   - `room.game.phase === 'ready'`.
5. **Server rolls** — `dice = crypto.randomInt(1, 7)`. Only place randomness lives.
6. **Server dispatches** — `room.game = reducer(room.game, {type:'ROLL', color, dice})`.
   The reducer is pure: given the same state + action, always the same output.
7. **Server broadcasts** — `io.to(roomCode).emit('state', room.snapshot())`.
   Delivery happens to every socket that `join()`-ed this room, including A.
8. **Both clients** — `socket.on('state', setRoom)` drops the new snapshot into
   React state. React re-renders. B sees A's dice and the highlighted tokens;
   B's `legal` array is ignored on B's UI because A is `current`.
9. **A picks a token**, `socket.emit('moveToken', {roomCode, tokenIndex})`,
   and the same validate/dispatch/broadcast cycle applies.

Round trip: one `emit` from the acting client, one broadcast to the room.
Clients never compute outcomes.

---

## Socket contract

Client → Server (ack-style):

| Event | Payload | Ack |
|-------|---------|-----|
| `createRoom`  | `{name, capacity}`            | `{ok, playerId, roomCode, room}` |
| `joinRoom`    | `{roomCode, name}`            | `{ok, playerId, room}` |
| `rejoinRoom`  | `{roomCode, playerId}`        | `{ok, room}` |
| `startGame`   | `{roomCode}`                  | `{ok}` |
| `rollDice`    | `{roomCode}`                  | `{ok}` |
| `moveToken`   | `{roomCode, tokenIndex}`      | `{ok}` |
| `restartGame` | `{roomCode}`                  | `{ok}` |
| `leaveRoom`   | `{roomCode}`                  | `{ok}` |

Server → Client (broadcast):

| Event   | Payload        | Notes |
|---------|----------------|-------|
| `state` | `RoomSnapshot` | Full truth. Sent to every socket in the room after every state-changing event. |
| `error` | `{message}`    | Out-of-band errors (rare; most failures land in ack). |

---

## Disconnect & rejoin

- Session `{roomCode, playerId}` is persisted in **sessionStorage** on join
  (per-tab). On page load the `useRoom` hook auto-calls `rejoinRoom`.
- Server's `disconnect` handler marks the seat `connected=false` and
  broadcasts. Clients dim that seat's avatar + show an `OFF` badge.
- If the disconnected seat is the current player, the server arms a
  **30-second** grace timer. If they reconnect within grace, the timer
  is cleared and play resumes unchanged.
- If grace expires, server dispatches `FORCE_SKIP` on the reducer and
  broadcasts. Turn passes; the disconnected player can still rejoin and
  play on their next turn.
- If **all** seats are disconnected, the room is kept in memory for
  **5 minutes** before removal — enough for every player to reload.

---

## Determinism invariants (why Stage 2 is safe)

1. **No `Math.random()` / `Date.now()` inside the reducer.** Dice arrive
   as an action payload from the server's `crypto.randomInt`.
2. **Reducer is pure.** Same `(state, action)` → same `nextState`. This is
   what lets the server own truth without the client second-guessing.
3. **Client never calls the reducer.** It only calls `setRoom(snapshot)`.
   Optimistic updates are deliberately avoided — stage 2 prioritises
   correctness over 50ms of perceived latency.
4. **Every intent is validated on the server** (phase / turn owner / legal
   set) before the reducer sees it. If invalid, the ack carries an error
   and no state change happens.

---

## Stage-3 — voice chat (WebRTC mesh)

### Architecture

Two **parallel** systems. They never share state.

```
 ┌──────────────┐   Socket.io (TCP)   ┌──────────────┐
 │   Client A   │ ←────── game ────── │              │
 │              │ ←─── signaling ───→ │   Server     │
 │              │                     │              │
 │              │ ◄═══ media UDP ════►│ (pass-thru)  │
 │              │  (direct peer→peer) │              │
 └──────────────┘                     └──────────────┘
```

Server's role in voice is ONE socket handler: `voice:signal`. It validates
sender is in the claimed room, resolves `targetPlayerId → socketId`, and
forwards verbatim. No reducer, no game state, no inspection.

### Client layering

```
frontend/src/voice/
├── peer.js       Pure RTCPeerConnection wrapper. No React, no socket.
│                 Emits: stream, iceState, connectionState, signalingState,
│                        trackEnded, trackMute, trackUnmute.
│                 Handles ICE restart automatically on 'failed'.
└── useVoice.js   React hook. Owns:
                    - one getUserMedia stream (shared across all peers)
                    - Map<playerId, Peer> via useRef (not React state)
                    - Map<playerId, HTMLAudioElement> mounted on document.body
                    - snapshot peerStates in useState for UI render
                  Reconciles peer map against seats[] on every change.
                  Brigdes server 'voice:signal' events to the right Peer.
```

### Signaling contract

Client → Server:

```
socket.emit('voice:signal', {roomCode, targetPlayerId, payload})
```

`payload.type` ∈ `{'offer', 'answer', 'candidate', 'bye'}`. Server forwards
untouched with `fromPlayerId` attached.

Server → Client:

```
socket.on('voice:signal', ({fromPlayerId, payload}) => …)
```

### Peer-connection lifecycle (step-by-step)

1. A and B both join a room. Both `useVoice` hooks list each other in `seats`.
2. Each side creates a `Peer` object in its own local map.
3. Initiator selection is deterministic: `isInitiator = myId < theirId`. Only
   one side sends the offer — no glare.
4. Initiator's `pc.addTrack()` fires `onnegotiationneeded` → `createOffer` →
   `setLocalDescription` → `socket.emit('voice:signal', {type:'offer', sdp})`.
5. Server relays offer to B. B's `useVoice` sees no peer for A (or creates
   one lazily), calls `peer.acceptOffer()` → `setRemoteDescription` →
   `createAnswer` → `setLocalDescription` → emit answer.
6. Server relays answer. A calls `peer.acceptAnswer()` → remote description set.
7. Both sides are now exchanging ICE candidates via `onicecandidate` →
   `voice:signal{type:'candidate'}`. Each `addIceCandidate` nudges the
   connectivity check forward.
8. `pc.iceConnectionState` progresses: `new → checking → connected/completed`.
9. Remote track arrives via `pc.ontrack`. Stream attached to a hidden
   `<audio autoplay>` appended to document.body (survives React re-renders).
10. Mute is `track.enabled = false` on local mic — no renegotiation, no
    extra signaling traffic, flips instantly.

### Failure recovery

- **Socket disconnect** → server emits `voice:signal{type:'bye'}` to each
  remaining peer; each remote tears down their Peer.
- **ICE 'failed'** → the initiator's Peer calls `pc.restartIce()` which
  triggers a new offer with `iceRestart:true`.
- **Remote track ended** → UI flips the peer's dot back to gray. If it was
  a transient, next `ontrack` flips it green again.
- **Rejoin** (socket reconnect into same room) → `useVoice` re-reconciles
  from the fresh `seats[]` broadcast and rebuilds any missing Peers.

### Diagnosing audio failures — the VoiceBar debug panel

Click **"debug"** on the VoiceBar. Each peer row shows:

```
Bob  ice:connected  conn:connected  sig:stable  stream:yes  pkts:1284  jitter:0.003
```

Read in this order if audio is silent:

1. **ice != connected/completed** → NAT traversal / ICE broken. Check firewall,
   try on same LAN, or add a TURN server.
2. **conn != connected** → DTLS/transport layer dead; close + rebuild.
3. **sig != stable** → offer/answer mid-flight; wait or check server relay.
4. **stream == no** → `ontrack` never fired; likely the remote didn't add
   a track (old browser? permission denied silently?).
5. **pkts flat over time** → peer "connected" but media path silent; often
   a one-way NAT problem, mitigated by TURN.

### Browser / HTTPS notes

- `getUserMedia` needs a "secure context" (HTTPS) **except** on `localhost`
  / `127.0.0.1`. Testing over `http://192.168.x.y` may be blocked — use
  `ngrok`, `localhost.run`, or a self-signed cert for LAN testing.
- iOS Safari autoplay: audio elements require at least one user gesture
  before `play()` resolves. Joining a room counts as that gesture, so the
  first inbound peer plays immediately.
- Chrome's WebRTC internals live at `chrome://webrtc-internals/` — the
  ground-truth view when the VoiceBar debug panel isn't enough.

### Stage-3 scope limits (deliberate)

- **No TURN server.** STUN-only works on most home networks. Symmetric-NAT
  mobile carriers will fall back to… nothing. Stage 4 adds TURN via coturn
  or a hosted service (Twilio/Xirsys).
- **No audio processing.** Relying on the browser's built-in echo cancellation
  and noise suppression (enabled by default in `getUserMedia`). No custom AGC.
- **Mesh only.** 2–4 players is fine; 5+ would need an SFU (mediasoup/janus).
- **No recording, no transcript, no push-to-talk.** Plain open mic + mute.
- **Voice is tied to the game room.** Leaving the game leaves the voice
  channel. No persistent "lobby voice."
