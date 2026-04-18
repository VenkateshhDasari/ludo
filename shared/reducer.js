// ---------------------------------------------------------------------------
// Pure game reducer. Deterministic. Serializable. No Date.now(), no Math.random().
//
// Added in Stage 3.5:
//   - Per-player stats (sixes, captures, finished)
//   - lastMove marker for the UI's move-arrow / capture overlays
//   - Blocking rule: legalTokens now refuses to traverse blocks
//     (enforced by shared/logic.js)
//
// Actions:
//   {type:'INIT',       seats}                - build a fresh game
//   {type:'ROLL',       color, dice}          - apply a roll (dice is payload)
//   {type:'MOVE',       color, tokenIndex}    - apply a token move
//   {type:'FORCE_SKIP', color}                - drop a turn (disconnect/timeout)
//   {type:'RESET',      seats}                - restart with same seats
// ---------------------------------------------------------------------------

import { legalTokens, applyMove, hasWon } from './logic.js';

export function initGameState(seats) {
  const colors = seats.map((s) => s.color);
  const players = {};
  for (const seat of seats) {
    players[seat.color] = {
      name: seat.name,
      tokens: [0, 0, 0, 0],
      lastRoll: null,
      stats: { sixes: 0, captures: 0, finished: 0, steps: 0 },
    };
  }
  return {
    colors,
    players,
    current: colors[0],
    phase: 'ready',
    lastRoll: null,
    legal: [],
    sixStreak: 0,
    winner: null,
    lastMove: null,     // {color, tokenIndex, fromSteps, toSteps, captured:[...], t}
    log: [`${players[colors[0]].name} to roll`],
  };
}

function nextColor(state) {
  const idx = state.colors.indexOf(state.current);
  return state.colors[(idx + 1) % state.colors.length];
}

function writeRollIntoChannel(state, color, dice) {
  return {
    ...state.players,
    [color]: { ...state.players[color], lastRoll: dice },
  };
}

function trimLog(prev, entries) {
  return [...entries, ...prev].slice(0, 30);
}

function bumpStats(players, color, patch) {
  const cur = players[color].stats || { sixes: 0, captures: 0, finished: 0, steps: 0 };
  return {
    ...players,
    [color]: {
      ...players[color],
      stats: {
        sixes:    cur.sixes    + (patch.sixes    ?? 0),
        captures: cur.captures + (patch.captures ?? 0),
        finished: cur.finished + (patch.finished ?? 0),
        steps:    cur.steps    + (patch.steps    ?? 0),
      },
    },
  };
}

export function reducer(state, action) {
  switch (action.type) {
    case 'INIT':
    case 'RESET':
      return initGameState(action.seats);

    case 'ROLL': {
      if (!state) return state;
      if (state.phase !== 'ready' || state.winner) return state;
      if (action.color !== state.current) return state;
      if (typeof action.dice !== 'number' || action.dice < 1 || action.dice > 6) return state;

      const dice = action.dice;
      const currentName = state.players[state.current].name;
      const newStreak = dice === 6 ? state.sixStreak + 1 : 0;
      let players = writeRollIntoChannel(state, state.current, dice);
      if (dice === 6) players = bumpStats(players, state.current, { sixes: 1 });

      if (newStreak >= 3) {
        return {
          ...state,
          players,
          lastRoll: dice,
          legal: [],
          phase: 'ready',
          current: nextColor(state),
          sixStreak: 0,
          log: trimLog(state.log, [`${currentName} rolled three 6s — turn forfeit`]),
        };
      }

      const legal = legalTokens(state.current, dice, state.players);
      if (legal.length === 0) {
        return {
          ...state,
          players,
          lastRoll: dice,
          legal: [],
          phase: 'ready',
          current: nextColor(state),
          sixStreak: 0,
          log: trimLog(state.log, [`${currentName} rolled ${dice} — no move, skip`]),
        };
      }

      return {
        ...state,
        players,
        lastRoll: dice,
        legal,
        phase: 'rolled',
        sixStreak: newStreak,
        log: trimLog(state.log, [`${currentName} rolled ${dice}`]),
      };
    }

    case 'MOVE': {
      if (!state) return state;
      if (state.phase !== 'rolled' || state.winner) return state;
      if (action.color !== state.current) return state;
      if (!state.legal.includes(action.tokenIndex)) return state;

      const result = applyMove(
        state.current,
        action.tokenIndex,
        state.lastRoll,
        state.players
      );
      const { players: rawPlayers, captured, grantsExtraTurn, fromSteps, toSteps, finished } = result;

      let players = {};
      for (const c of state.colors) {
        players[c] = { ...state.players[c], tokens: rawPlayers[c].tokens };
      }

      // Bump stats for mover: distance covered + captures + maybe finish.
      players = bumpStats(players, state.current, {
        steps: toSteps - fromSteps,
        captures: captured.length,
        finished: finished ? 1 : 0,
      });

      const currentName = players[state.current].name;
      const won = hasWon(players[state.current]);
      const turnPasses = won || !grantsExtraTurn;

      const newLines = [];
      if (captured.length > 0) {
        newLines.push(
          `${currentName} captured ${captured.map((c) => players[c.color].name).join(', ')}`
        );
      }
      if (won) newLines.push(`${currentName} wins!`);

      return {
        ...state,
        players,
        phase: won ? 'finished' : 'ready',
        current: turnPasses ? nextColor(state) : state.current,
        lastRoll: null,
        legal: [],
        sixStreak: turnPasses ? 0 : state.sixStreak,
        winner: won ? state.current : null,
        lastMove: {
          color: state.current,
          tokenIndex: action.tokenIndex,
          fromSteps,
          toSteps,
          captured,
        },
        log: trimLog(state.log, newLines),
      };
    }

    case 'FORCE_SKIP': {
      if (!state) return state;
      if (state.winner) return state;
      if (action.color !== state.current) return state;
      const currentName = state.players[state.current].name;
      return {
        ...state,
        phase: 'ready',
        current: nextColor(state),
        lastRoll: null,
        legal: [],
        sixStreak: 0,
        lastMove: null,
        log: trimLog(state.log, [`${currentName} auto-skipped (timeout)`]),
      };
    }

    default:
      return state;
  }
}
