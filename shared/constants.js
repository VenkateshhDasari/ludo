// ---------------------------------------------------------------------------
// Pure board constants. No runtime, no DOM, no imports. This module is the
// single source of truth for coordinates and is imported by BOTH the server
// (as plain ESM) and the client (via Vite's @shared alias).
// ---------------------------------------------------------------------------

export const COLORS = ['yellow', 'blue', 'red', 'green'];

export const COLOR_HEX = {
  red: '#E53935',
  green: '#43A047',
  yellow: '#FDD835',
  blue: '#1E88E5',
};

export const COLOR_HEX_DARK = {
  red: '#AD1F1A',
  green: '#2E7D32',
  yellow: '#C8A714',
  blue: '#155F9F',
};

export const TRACK = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0], [6, 0],
];

export const START_INDEX = { yellow: 0, blue: 13, red: 26, green: 39 };

export const HOME_COLUMN = {
  yellow: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  blue:   [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  red:    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  green:  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
};

export const CENTER = [7, 7];

export const YARD = {
  yellow: [[1, 1], [1, 4], [4, 1], [4, 4]],
  blue:   [[1, 10], [1, 13], [4, 10], [4, 13]],
  red:    [[10, 10], [10, 13], [13, 10], [13, 13]],
  green:  [[10, 1], [10, 4], [13, 1], [13, 4]],
};

export const YARD_QUADRANT = {
  yellow: { rows: [0, 5], cols: [0, 5] },
  blue:   { rows: [0, 5], cols: [9, 14] },
  red:    { rows: [9, 14], cols: [9, 14] },
  green:  { rows: [9, 14], cols: [0, 5] },
};

export const SAFE_TRACK_INDICES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export const STEPS_TO_FINISH = 57;

// Stage 2: grace window for reconnecting before a turn is force-skipped.
export const DISCONNECT_GRACE_MS = 30_000;

// Stage 3+: active-play clock. A connected player who does nothing for this
// long forfeits their turn automatically.
export const TURN_DURATION_MS = 30_000;

// Whitelisted emoji reactions (clients + server agree).
export const EMOJI_REACTIONS = ['🎲', '👏', '😂', '🔥', '😭', '🙏', '🤣', '🫠'];
