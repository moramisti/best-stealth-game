// Bayang Malam — Pencuri Lentera: tuning constants for the whole game.
// One place holds every number a designer would tweak: tile size, speeds,
// vision-cone reach, how fast a guard grows suspicious, and the score table.
export const TILE = 48;
export const COLS = 20;
export const ROWS = 13;
export const FIELD_WIDTH = COLS * TILE;
export const FIELD_HEIGHT = ROWS * TILE;
export const STEP = 1 / 60;

export const PLAYER_RADIUS = 15;
export const PLAYER_SPEED = 168;
export const GUARD_RADIUS = 16;

export const BEST_KEY = 'bayang-malam-best';

// Detection: a guard's suspicion of the player, 0..1. It fills while the
// player stands inside a vision cone with a clear line of sight, faster up
// close; it drains while the player is unseen. At SUSPICIOUS the guard turns
// toward the player and closes in; at 1 the player is caught.
export const SUSPICIOUS_AT = 0.5;
export const DETECT_FILL_CLOSE = 1.05;
export const DETECT_FILL_FAR = 0.34;
export const DETECT_DECAY = 0.7;
export const SHADOW_SLOWDOWN = 0.45;
export const BUSH_HIDES = true;

// After being caught the player respawns at the level start and cannot be
// caught again for this long, so one mistake cannot chain into two.
export const RESPAWN_GRACE_SECONDS = 2.5;

// Score table.
export const SCORE_LANTERN = 150;
export const SCORE_LEVEL_CLEAR = 400;
export const SCORE_GHOST_BONUS = 250;
export const TIME_BONUS_PER_SECOND = 5;
