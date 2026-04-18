// ---------------------------------------------------------------------------
// A single game room. Owns:
//   - seat list (playerId, color, name, connected, socketId)
//   - the authoritative game state (the reducer's current state)
//   - two timers:
//       * disconnect-grace   (force-skip when AFK current player is offline)
//       * turn timer         (force-skip when current player is online but idle)
//   - empty-room GC timer
//
// The reducer itself is pure and lives in shared/. This class is the *only*
// place side effects are permitted: timers, broadcasts, socket maps.
// ---------------------------------------------------------------------------

import {
  COLORS,
  DISCONNECT_GRACE_MS,
  TURN_DURATION_MS,
} from '../../shared/constants.js';
import { reducer, initGameState } from '../../shared/reducer.js';
import { rollDice, makePlayerId } from './rng.js';

export class Room {
  constructor({ code, capacity, io }) {
    this.code = code;
    this.capacity = Math.min(4, Math.max(2, capacity));
    this.io = io;

    /** @type {Array<{playerId:string, color:string, name:string, connected:boolean, socketId:string|null}>} */
    this.seats = [];
    this.hostId = null;

    this.phase = 'lobby';       // 'lobby' | 'playing' | 'finished'
    this.game = null;

    this._skipTimer = null;
    this._turnTimer = null;
    this._turnExpiresAt = null;
    this._emptyTimer = null;

    // Rematch: after a game ends, seats vote. When every connected seat
    // has voted, a short countdown fires and the room auto-restarts with
    // the same seats + accumulated sessionWins preserved.
    this._rematchTimer = null;
    this._rematchStartsAt = null;
  }

  // ---- seats / players ----------------------------------------------------

  isFull() { return this.seats.length >= this.capacity; }
  findSeat(playerId) { return this.seats.find((s) => s.playerId === playerId) ?? null; }
  findSeatBySocket(socketId) { return this.seats.find((s) => s.socketId === socketId) ?? null; }
  connectedCount() { return this.seats.filter((s) => s.connected).length; }

  addPlayer({ name, socketId }) {
    if (this.phase !== 'lobby') throw new Error('Game already started');
    if (this.isFull()) throw new Error('Room is full');
    const color = COLORS[this.seats.length];
    const seat = {
      playerId: makePlayerId(),
      // Reconnect token: shared secret returned only in the join ack and
      // never broadcast. Required for rejoinRoom.
      reconnectToken: makePlayerId(),
      color,
      name: ((name || '').trim().slice(0, 32)) || `Player ${this.seats.length + 1}`,
      connected: true,
      socketId,
      sessionWins: 0,
      wantsRematch: false,
    };
    this.seats.push(seat);
    if (!this.hostId) this.hostId = seat.playerId;
    this._cancelEmptyTimer();
    return seat;
  }

  /** Token-gated reconnect. Returns null if playerId/token mismatch.
   *  Rotates the reconnect token on every successful reconnect so a leaked
   *  token can only ever be replayed once. */
  reconnect(playerId, socketId, reconnectToken) {
    const seat = this.findSeat(playerId);
    if (!seat) return null;
    if (!reconnectToken || seat.reconnectToken !== reconnectToken) return null;
    seat.socketId = socketId;
    seat.connected = true;
    seat.reconnectToken = makePlayerId();
    this._clearSkipTimerIfMine(seat.color);
    this._cancelEmptyTimer();
    return seat;
  }

  /**
   * Reclaim a disconnected seat by matching display name. Used when a
   * player explicitly "left" and later tries to rejoin the same room.
   * Regenerates the reconnect token so any previously-issued token can no
   * longer replay after a name-based reclaim.
   */
  reclaimSeatByName(name, socketId) {
    const target = ((name || '').trim().slice(0, 32)).toLowerCase();
    if (!target) return null;
    const orphan = this.seats.find(
      (s) => !s.connected && s.name.toLowerCase() === target
    );
    if (!orphan) return null;
    orphan.socketId = socketId;
    orphan.connected = true;
    orphan.reconnectToken = makePlayerId();
    this._clearSkipTimerIfMine(orphan.color);
    this._cancelEmptyTimer();
    return orphan;
  }

  markDisconnected(playerId) {
    const seat = this.findSeat(playerId);
    if (!seat) return;
    seat.connected = false;
    seat.socketId = null;
    if (this.phase === 'playing' && this.game && this.game.current === seat.color) {
      this._armSkipTimer(seat.color);
    }
    if (this.connectedCount() === 0) this._armEmptyTimer();
  }

  // ---- lifecycle ----------------------------------------------------------

  startGame(playerId) {
    if (playerId !== this.hostId) throw new Error('Only the host can start');
    if (this.phase !== 'lobby') throw new Error('Already started');
    if (this.seats.length < 2) throw new Error('Need at least 2 players');
    this.game = initGameState(this.seats);
    this.phase = 'playing';
    this._armTurnTimer();
  }

  dispatch(action) {
    if (!this.game) throw new Error('Game not started');
    const prevWinner = this.game.winner;
    const next = reducer(this.game, action);
    if (next === this.game) return false;
    this.game = next;
    if (this.game.winner) {
      // Bump the winner's sessionWins exactly once - when the winner goes
      // from null -> color. Seats persist across rematches so this count
      // accumulates over the session.
      if (!prevWinner) {
        const winnerSeat = this.seats.find((s) => s.color === this.game.winner);
        if (winnerSeat) winnerSeat.sessionWins = (winnerSeat.sessionWins || 0) + 1;
      }
      this.phase = 'finished';
      this._cancelTurnTimer();
      this._cancelSkipTimer();
    } else if (this.game.phase === 'ready') {
      this._armTurnTimer();
    }
    return true;
  }

  // ---- gameplay commands (wrap reducer with validation + rng) -------------

  requestRoll(playerId) {
    const seat = this.findSeat(playerId);
    if (!seat) throw new Error('Not in this room');
    if (this.phase !== 'playing') throw new Error('Game not in progress');
    if (!this.game || this.game.current !== seat.color) throw new Error('Not your turn');
    if (this.game.phase !== 'ready') throw new Error('Already rolled');
    const dice = rollDice();
    const applied = this.dispatch({ type: 'ROLL', color: seat.color, dice });
    if (!applied) throw new Error('Roll rejected');
  }

  requestMove(playerId, tokenIndex) {
    const seat = this.findSeat(playerId);
    if (!seat) throw new Error('Not in this room');
    if (this.phase !== 'playing') throw new Error('Game not in progress');
    if (!this.game || this.game.current !== seat.color) throw new Error('Not your turn');
    if (this.game.phase !== 'rolled') throw new Error('Roll first');
    // Defensive: reject bad tokenIndex shapes up-front. Note JSON.stringify
    // turns NaN/Infinity into null, so typeof check catches those too.
    if (typeof tokenIndex !== 'number' || !Number.isInteger(tokenIndex)
        || tokenIndex < 0 || tokenIndex > 3) {
      throw new Error('Invalid token');
    }
    const applied = this.dispatch({ type: 'MOVE', color: seat.color, tokenIndex });
    if (!applied) throw new Error('Illegal move');
  }

  requestRestart(playerId) {
    if (playerId !== this.hostId) throw new Error('Only the host can restart');
    if (this.phase === 'lobby') return;
    this._restartNow();
  }

  /** Cast a rematch vote. When every connected seat has voted, a short
   *  countdown starts; the game auto-restarts with seats + sessionWins
   *  preserved when it fires. */
  voteRematch(playerId) {
    const seat = this.findSeat(playerId);
    if (!seat) throw new Error('Not in this room');
    if (this.phase !== 'finished') throw new Error('Game not finished');
    if (seat.wantsRematch) return;
    seat.wantsRematch = true;

    const connected = this.seats.filter((s) => s.connected);
    const allReady = connected.length >= 2 && connected.every((s) => s.wantsRematch);
    if (allReady && !this._rematchTimer) this._armRematchCountdown();
  }

  _armRematchCountdown() {
    this._cancelRematchCountdown();
    this._rematchStartsAt = Date.now() + 3000;
    this._rematchTimer = setTimeout(() => {
      this._rematchTimer = null;
      this._rematchStartsAt = null;
      this._restartNow();
      this.broadcast();
    }, 3000);
  }

  _cancelRematchCountdown() {
    if (this._rematchTimer) {
      clearTimeout(this._rematchTimer);
      this._rematchTimer = null;
    }
    this._rematchStartsAt = null;
  }

  _restartNow() {
    for (const s of this.seats) s.wantsRematch = false;
    this._cancelRematchCountdown();
    this.game = initGameState(this.seats);
    this.phase = 'playing';
    this._armTurnTimer();
  }

  // ---- timers -------------------------------------------------------------

  _armSkipTimer(color) {
    this._cancelSkipTimer();
    this._skipTimer = setTimeout(() => {
      this._skipTimer = null;
      if (this.phase !== 'playing' || !this.game) return;
      if (this.game.current !== color) return;
      const seat = this.seats.find((s) => s.color === color);
      if (!seat || seat.connected) return;
      this.dispatch({ type: 'FORCE_SKIP', color });
      this.broadcast();
    }, DISCONNECT_GRACE_MS);
  }

  _clearSkipTimerIfMine(color) {
    if (this._skipTimer && this.game && this.game.current === color) {
      this._cancelSkipTimer();
    }
  }

  _cancelSkipTimer() {
    if (this._skipTimer) {
      clearTimeout(this._skipTimer);
      this._skipTimer = null;
    }
  }

  _armTurnTimer() {
    this._cancelTurnTimer();
    if (this.phase !== 'playing' || !this.game || this.game.winner) return;
    this._turnExpiresAt = Date.now() + TURN_DURATION_MS;
    this._turnTimer = setTimeout(() => {
      this._turnTimer = null;
      this._turnExpiresAt = null;
      if (!this.game || this.game.winner || this.phase !== 'playing') return;
      // Force-skip the current player (connected or not - idle is idle).
      this.dispatch({ type: 'FORCE_SKIP', color: this.game.current });
      this.broadcast();
    }, TURN_DURATION_MS);
  }

  _cancelTurnTimer() {
    if (this._turnTimer) {
      clearTimeout(this._turnTimer);
      this._turnTimer = null;
    }
    this._turnExpiresAt = null;
  }

  _armEmptyTimer() {
    this._cancelEmptyTimer();
    this._emptyTimer = setTimeout(() => {
      if (this.connectedCount() === 0 && this._onEmptyTimeout) this._onEmptyTimeout(this);
    }, 5 * 60 * 1000);
  }

  _cancelEmptyTimer() {
    if (this._emptyTimer) {
      clearTimeout(this._emptyTimer);
      this._emptyTimer = null;
    }
  }

  // ---- broadcast ----------------------------------------------------------

  snapshot() {
    return {
      code: this.code,
      phase: this.phase,
      capacity: this.capacity,
      hostId: this.hostId,
      turnExpiresAt: this._turnExpiresAt,
      rematchStartsAt: this._rematchStartsAt,
      // Never include reconnectToken in broadcasts.
      seats: this.seats.map((s) => ({
        playerId: s.playerId,
        color: s.color,
        name: s.name,
        connected: s.connected,
        sessionWins: s.sessionWins || 0,
        wantsRematch: !!s.wantsRematch,
      })),
      game: this.game,
    };
  }

  broadcast() {
    this.io.to(this.code).emit('state', this.snapshot());
  }
}
