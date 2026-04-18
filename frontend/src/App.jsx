// ---------------------------------------------------------------------------
// Top-level composition, Stage-3.5 edition.
//
// Adds: SFX + haptics + confetti + emoji reactions + turn timer ring +
// voice activity ring + last-move arrow + post-game summary.
//
// Game reducer/state is still 100% server-authoritative.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import Menu from './components/Menu.jsx';
import Lobby from './components/Lobby.jsx';
import Board from './components/Board.jsx';
import VoiceBar from './components/VoiceBar.jsx';
import EmojiBar from './components/EmojiBar.jsx';
import Confetti from './components/Confetti.jsx';
import PostGame from './components/PostGame.jsx';
import { PlayerChip, EventLog } from './components/PlayerPanel.jsx';
import { useRoom } from './net/useRoom.js';
import { useVoice } from './voice/useVoice.js';
import { socket } from './net/socket.js';
import { useSyncExternalStore } from 'react';
import { COLOR_HEX } from '@shared/constants.js';
import * as sfx from './audio.js';

function slotSeats(seats) {
  const by = { yellow: null, blue: null, red: null, green: null };
  for (const s of seats) by[s.color] = s;
  return {
    topLeft: by.yellow,
    topRight: by.blue,
    bottomLeft: by.green,
    bottomRight: by.red,
  };
}

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch {}
}

// Shared "am I connected" subscriber used by header chips. Reads socket state
// directly so it updates regardless of which component is asking.
function subscribeSocket(cb) {
  socket.on('connect', cb);
  socket.on('disconnect', cb);
  return () => { socket.off('connect', cb); socket.off('disconnect', cb); };
}
function useSocketConnected() {
  return useSyncExternalStore(
    subscribeSocket,
    () => socket.connected,
    () => false,
  );
}

function ConnectionDot() {
  const online = useSocketConnected();
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-display uppercase tracking-widest
        ${online ? 'text-emerald-300' : 'text-rose-300'}`}
      title={online ? 'Server online' : 'Reconnecting…'}
    >
      <span
        className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'}`}
      />
      {online ? 'online' : 'offline'}
    </span>
  );
}

function RoomCodeChip({ code }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${window.location.pathname}?room=${code}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <button onClick={copy} className="chip text-gold-400" title="Copy invite link">
      Room {code} <span className="opacity-60 text-[10px]">{copied ? '✓' : '⧉'}</span>
    </button>
  );
}

function GameScreen({ room, session, onRoll, onMove, onRestart, onLeave, onVoteRematch }) {
  const game = room.game;
  const myColor = room.seats.find((s) => s.playerId === session.playerId)?.color ?? null;
  const slots = slotSeats(room.seats);
  const activeHex = game ? COLOR_HEX[game.current] : '#ffffff';
  const activeName = game ? game.players[game.current]?.name : '';
  const isMyTurn = game && game.current === myColor && game.phase !== 'finished';

  const voice = useVoice({
    enabled: true,
    roomCode: room.code,
    myPlayerId: session.playerId,
    seats: room.seats,
  });

  // ---- SFX + haptics driven by state transitions ----------------------
  const prevGameRef = useRef(null);
  useEffect(() => {
    if (!game) return;
    const prev = prevGameRef.current;
    prevGameRef.current = game;
    if (!prev) return;

    // Dice: any player's lastRoll incremented => dice SFX
    for (const color of Object.keys(game.players)) {
      const prevRoll = prev.players[color]?.lastRoll ?? null;
      const newRoll = game.players[color].lastRoll;
      if (newRoll != null && newRoll !== prevRoll) {
        sfx.playDice();
        if (color === myColor) vibrate(30);
      }
    }

    // Move: lastMove changed => token hopped
    const prevLM = prev.lastMove ? `${prev.lastMove.color}-${prev.lastMove.tokenIndex}-${prev.lastMove.fromSteps}-${prev.lastMove.toSteps}` : '';
    const curLM  = game.lastMove ? `${game.lastMove.color}-${game.lastMove.tokenIndex}-${game.lastMove.fromSteps}-${game.lastMove.toSteps}`  : '';
    if (curLM && curLM !== prevLM) {
      sfx.playMove();
      if (game.lastMove.captured && game.lastMove.captured.length > 0) {
        setTimeout(() => sfx.playCapture(), 200);
        vibrate([40, 60, 40]);
      }
      // Finished a token?
      if (game.lastMove.toSteps === 57) {
        setTimeout(() => sfx.playFinish(), 240);
      }
    }

    // Turn passed TO me
    if (prev.current !== game.current && game.current === myColor && !game.winner) {
      sfx.playTurn();
      vibrate(80);
    }

    // Winner appeared
    if (!prev.winner && game.winner) {
      sfx.playWin();
      vibrate([150, 80, 150, 80, 200]);
    }
  }, [game, myColor]);

  // ---- Turn-timer urgency tick (last 5s on MY turn) -------------------
  useEffect(() => {
    const turnExpiresAt = room.turnExpiresAt;
    if (!turnExpiresAt || !isMyTurn) return;
    let cancelled = false;
    const lastTickRef = { current: null };
    const id = setInterval(() => {
      if (cancelled) return;
      const remaining = turnExpiresAt - Date.now();
      if (remaining <= 0 || remaining > 5000) return;
      const bucket = Math.ceil(remaining / 1000); // 5,4,3,2,1
      if (lastTickRef.current !== bucket) {
        lastTickRef.current = bucket;
        sfx.playTick();
      }
    }, 150);
    return () => { cancelled = true; clearInterval(id); };
  }, [room.turnExpiresAt, isMyTurn]);

  // ---- Emoji reactions bridge -----------------------------------------
  const [reactions, setReactions] = useState({}); // playerId -> {emoji, t}
  useEffect(() => {
    const onReaction = ({ fromPlayerId, emoji, t }) => {
      setReactions((prev) => ({ ...prev, [fromPlayerId]: { emoji, t: t ?? Date.now() } }));
      sfx.playEmoji();
      // Clear after the float animation (emojiFloat = 1800ms).
      setTimeout(() => {
        setReactions((prev) => {
          const cur = prev[fromPlayerId];
          if (!cur || cur.t !== (t ?? cur.t)) return prev;
          const next = { ...prev }; delete next[fromPlayerId]; return next;
        });
      }, 1900);
    };
    socket.on('emoji:reaction', onReaction);
    return () => socket.off('emoji:reaction', onReaction);
  }, []);

  const sendEmoji = (emoji) => {
    socket.emit('emoji:send', { roomCode: room.code, emoji });
  };

  const turnExpiresAt = room.turnExpiresAt ?? null;

  return (
    <div className="min-h-full flex flex-col">
      <Confetti active={!!game?.winner} />

      <header className="px-4 pt-4 flex items-center justify-between max-w-6xl mx-auto w-full gap-2 flex-wrap">
        <button onClick={onLeave} className="chip text-white">
          <span aria-hidden>≡</span> Leave
        </button>
        <RoomCodeChip code={room.code} />
        <div className="chip"><ConnectionDot /></div>
        <div className="chip text-gold-400 max-w-[50%] truncate">
          <span aria-hidden>🏆</span>
          {game?.winner
            ? `${game.players[game.winner].name} wins`
            : `${activeName}'s turn`}
        </div>
      </header>

      <main className="flex-1 px-4 py-4 max-w-6xl w-full mx-auto grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-start min-h-[60px] gap-3">
            {slots.topLeft ? (
              <PlayerChip
                color="yellow" state={game} seat={slots.topLeft}
                isSelf={slots.topLeft.color === myColor}
                onRoll={onRoll} align="left"
                turnExpiresAt={game?.current === 'yellow' ? turnExpiresAt : null}
                speaking={!!voice.speakingMap[slots.topLeft.playerId]}
                reaction={reactions[slots.topLeft.playerId]}
              />
            ) : <div />}
            {slots.topRight ? (
              <PlayerChip
                color="blue" state={game} seat={slots.topRight}
                isSelf={slots.topRight.color === myColor}
                onRoll={onRoll} align="right"
                turnExpiresAt={game?.current === 'blue' ? turnExpiresAt : null}
                speaking={!!voice.speakingMap[slots.topRight.playerId]}
                reaction={reactions[slots.topRight.playerId]}
              />
            ) : <div />}
          </div>

          <Board
            players={game?.players ?? {}}
            currentColor={game?.current}
            legal={isMyTurn ? game?.legal ?? [] : []}
            onTokenClick={onMove}
            winner={game?.winner}
            lastMove={game?.lastMove}
            myColor={myColor}
          />

          <div className="flex justify-between items-start min-h-[60px] gap-3">
            {slots.bottomLeft ? (
              <PlayerChip
                color="green" state={game} seat={slots.bottomLeft}
                isSelf={slots.bottomLeft.color === myColor}
                onRoll={onRoll} align="left"
                turnExpiresAt={game?.current === 'green' ? turnExpiresAt : null}
                speaking={!!voice.speakingMap[slots.bottomLeft.playerId]}
                reaction={reactions[slots.bottomLeft.playerId]}
              />
            ) : <div />}
            {slots.bottomRight ? (
              <PlayerChip
                color="red" state={game} seat={slots.bottomRight}
                isSelf={slots.bottomRight.color === myColor}
                onRoll={onRoll} align="right"
                turnExpiresAt={game?.current === 'red' ? turnExpiresAt : null}
                speaking={!!voice.speakingMap[slots.bottomRight.playerId]}
                reaction={reactions[slots.bottomRight.playerId]}
              />
            ) : <div />}
          </div>

          {isMyTurn && game?.phase === 'rolled' && game.legal.length > 0 && (
            <div className="rounded-2xl border border-gold-400/60 bg-chrome-900/80 backdrop-blur px-4 py-3 text-center text-sm text-white">
              You rolled <span className="font-bold">{game.lastRoll}</span> — pick a glowing token.
            </div>
          )}
          {!isMyTurn && game?.phase === 'rolled' && (
            <div className="rounded-2xl border border-white/10 bg-chrome-900/70 backdrop-blur px-4 py-3 text-center text-sm text-white/80">
              <span className="font-display font-bold capitalize" style={{ color: activeHex }}>
                {activeName}
              </span>{' '}
              rolled {game.lastRoll}. Waiting for their move…
            </div>
          )}

          <EmojiBar onSend={sendEmoji} disabled={!myColor} />
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <div className="rounded-3xl border border-white/10 bg-chrome-900/70 backdrop-blur p-5">
            <div className="text-[11px] uppercase tracking-widest text-white/60 font-display">
              On the clock
            </div>
            <div className="text-3xl font-display font-bold mt-1" style={{ color: activeHex }}>
              {game?.winner ? game.players[game.winner].name : activeName}
            </div>
            <div className="text-xs text-white/60 mt-1">
              {game?.winner
                ? 'Board cleared — game over.'
                : isMyTurn
                ? 'Your move. Tap your dice to roll.'
                : 'Waiting for remote player…'}
            </div>
          </div>

          <VoiceBar seats={room.seats} myPlayerId={session.playerId} voice={voice} />

          <EventLog log={game?.log ?? []} />

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onRestart}
              className="btn-ghost text-sm"
              disabled={session.playerId !== room.hostId}
            >
              Restart
            </button>
            <button onClick={onLeave} className="btn-ghost text-sm">Leave room</button>
          </div>

          <div className="text-[10px] uppercase tracking-[0.3em] text-white/30 text-center font-display">
            Stage 3 · Online
          </div>
        </aside>
      </main>

      {game?.winner && (
        <PostGame
          room={room}
          session={session}
          isHost={session.playerId === room.hostId}
          onRestart={onRestart}
          onLeave={onLeave}
          onVoteRematch={onVoteRematch}
        />
      )}
    </div>
  );
}

export default function App() {
  const {
    connected, session, room, error,
    createRoom, joinRoom, leaveRoom,
    startGame, rollDice, moveToken, restart, voteRematch,
  } = useRoom();

  if (!session || !room) {
    return (
      <Menu connected={connected} error={error} onCreate={createRoom} onJoin={joinRoom} />
    );
  }

  if (room.phase === 'lobby') {
    return <Lobby room={room} session={session} onStart={startGame} onLeave={leaveRoom} />;
  }

  return (
    <GameScreen
      room={room}
      session={session}
      onRoll={rollDice}
      onMove={moveToken}
      onRestart={restart}
      onLeave={leaveRoom}
      onVoteRematch={voteRematch}
    />
  );
}
