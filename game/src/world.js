// Bayang Malam — the world: one level's live state and its rules.
//
// The player sneaks through the level, collects every lantern, then slips
// out through the exit. Guards walk their patrols and watch through a
// vision cone; walls and crates block their sight, bushes hide the player,
// and shadow floor slows how fast suspicion grows. Being seen fills a
// guard's suspicion meter: past half the guard grows wary and closes in,
// full means caught — a life lost and a respawn at the level start.
import {
  BUSH_HIDES,
  DETECT_DECAY,
  DETECT_FILL_CLOSE,
  DETECT_FILL_FAR,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  GUARD_RADIUS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  RESPAWN_GRACE_SECONDS,
  SCORE_GHOST_BONUS,
  SCORE_LANTERN,
  SCORE_LEVEL_CLEAR,
  SHADOW_SLOWDOWN,
  STEP,
  SUSPICIOUS_AT,
  TILE,
  TIME_BONUS_PER_SECOND,
} from './config.js';
import { buildLevel, LEVEL_COUNT, tileBlocksSight, tileWalkable } from './levels.js';

export const EVENT_NONE = 0;
export const EVENT_PICKUP = 1;
export const EVENT_SUSPICIOUS = 2;
export const EVENT_CAUGHT = 4;
export const EVENT_LEVEL_CLEAR = 8;
export const EVENT_VICTORY = 16;
export const EVENT_STEP = 32;

const TAU = Math.PI * 2;

function angleDifference(a, b) {
  let diff = (a - b) % TAU;
  if (diff > Math.PI) diff -= TAU;
  if (diff < -Math.PI) diff += TAU;
  return diff;
}

function tileAt(level, px, py) {
  const col = Math.floor(px / TILE);
  const row = Math.floor(py / TILE);
  if (col < 0 || row < 0 || col >= level.grid[0].length || row >= level.grid.length) return '#';
  return level.grid[row][col];
}

function moveCircle(level, body, dx, dy, radius) {
  // Move, then push the circle out of any wall it overlaps, along the
  // shortest way out. Pushing out radially (instead of refusing each axis
  // separately) lets the player slide around a wall's corner instead of
  // wedging against it when approaching diagonally.
  body.x += dx;
  body.y += dy;
  for (let iter = 0; iter < 3; iter += 1) {
    let pushed = false;
    const col0 = Math.floor((body.x - radius) / TILE);
    const col1 = Math.floor((body.x + radius) / TILE);
    const row0 = Math.floor((body.y - radius) / TILE);
    const row1 = Math.floor((body.y + radius) / TILE);
    for (let row = row0; row <= row1; row += 1) {
      for (let col = col0; col <= col1; col += 1) {
        const tile = row < 0 || col < 0 || row >= level.grid.length || col >= level.grid[0].length ? '#' : level.grid[row][col];
        if (tileWalkable(tile)) continue;
        const tileX = col * TILE;
        const tileY = row * TILE;
        const closestX = Math.max(tileX, Math.min(body.x, tileX + TILE));
        const closestY = Math.max(tileY, Math.min(body.y, tileY + TILE));
        const ox = body.x - closestX;
        const oy = body.y - closestY;
        const distSq = ox * ox + oy * oy;
        if (distSq >= radius * radius) continue;
        if (distSq > 0.0001) {
          const dist = Math.sqrt(distSq);
          const push = radius - dist;
          body.x += (ox / dist) * push;
          body.y += (oy / dist) * push;
        } else {
          // The centre is inside the tile: leave by the nearest face.
          const left = body.x - tileX;
          const right = tileX + TILE - body.x;
          const top = body.y - tileY;
          const bottom = tileY + TILE - body.y;
          const min = Math.min(left, right, top, bottom);
          if (min === left) body.x = tileX - radius;
          else if (min === right) body.x = tileX + TILE + radius;
          else if (min === top) body.y = tileY - radius;
          else body.y = tileY + TILE + radius;
        }
        pushed = true;
      }
    }
    if (!pushed) break;
  }
}

/** True when no wall or crate stands between two points. */
export function hasLineOfSight(level, ax, ay, bx, by) {
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(dist / 8));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (tileBlocksSight(tileAt(level, ax + (bx - ax) * t, ay + (by - ay) * t))) return false;
  }
  return true;
}

/** True when the player stands on a bush tile (hidden) or shadow tile. */
function groundUnder(level, x, y) {
  return tileAt(level, x, y);
}

export function createWorld(random) {
  const state = {
    levelIndex: 0,
    level: null,
    player: { x: 0, y: 0, facing: 0, moving: false },
    guards: [],
    lanternsTaken: 0,
    lanternsTotal: 0,
    exitOpen: false,
    score: 0,
    lives: 3,
    time: 0,
    levelTime: 0,
    detection: 0,
    ghost: true,
    grace: 0,
    levelClear: false,
    victory: false,
    gameOver: false,
    lastEvent: EVENT_NONE,
    stepCount: 0,
  };

  function loadLevel(index) {
    const level = buildLevel(index);
    state.levelIndex = index;
    state.level = level;
    state.player.x = level.start.x;
    state.player.y = level.start.y;
    state.player.facing = 0;
    state.player.moving = false;
    state.guards = level.guards.map((guard) => ({
      x: guard.waypoints[0].x,
      y: guard.waypoints[0].y,
      facing: 0,
      waypointIndex: 1,
      waitLeft: 0,
      suspicion: 0,
      alerted: false,
      alertTarget: null,
      alertLeft: 0,
      speed: guard.speed,
      range: guard.range,
      halfAngle: guard.halfAngle,
      pause: guard.pause,
      waypoints: guard.waypoints,
      stepPhase: random() * TAU,
    }));
    state.lanternsTaken = 0;
    state.lanternsTotal = level.lanterns.length;
    state.exitOpen = false;
    state.detection = 0;
    state.ghost = true;
    state.grace = 0;
    state.levelTime = 0;
    state.levelClear = false;
    // Face the first guard along its patrol so its cone reads at a glance.
    for (const guard of state.guards) {
      const next = guard.waypoints[guard.waypointIndex % guard.waypoints.length];
      guard.facing = Math.atan2(next.y - guard.y, next.x - guard.x);
    }
  }

  function reset() {
    state.score = 0;
    state.lives = 3;
    state.time = 0;
    state.victory = false;
    state.gameOver = false;
    loadLevel(0);
  }

  function startNextLevel() {
    if (state.levelIndex + 1 >= LEVEL_COUNT) {
      state.victory = true;
      return EVENT_VICTORY;
    }
    loadLevel(state.levelIndex + 1);
    return EVENT_NONE;
  }

  function respawn() {
    state.player.x = state.level.start.x;
    state.player.y = state.level.start.y;
    state.player.facing = 0;
    state.grace = RESPAWN_GRACE_SECONDS;
    state.detection = 0;
    for (const guard of state.guards) {
      guard.suspicion = 0;
      guard.alerted = false;
      guard.alertTarget = null;
      guard.alertLeft = 0;
    }
  }

  function guardSeesPlayer(level, guard) {
    const dx = state.player.x - guard.x;
    const dy = state.player.y - guard.y;
    const dist = Math.hypot(dx, dy);
    if (dist > guard.range + PLAYER_RADIUS) return 0;
    const angle = Math.atan2(dy, dx);
    if (Math.abs(angleDifference(angle, guard.facing)) > guard.halfAngle) return 0;
    if (BUSH_HIDES && groundUnder(level, state.player.x, state.player.y) === 'B') return 0;
    if (!hasLineOfSight(level, guard.x, guard.y, state.player.x, state.player.y)) return 0;
    // Closer reads fill suspicion faster; far reads barely register.
    const closeness = 1 - dist / (guard.range + PLAYER_RADIUS);
    return DETECT_FILL_FAR + (DETECT_FILL_CLOSE - DETECT_FILL_FAR) * closeness;
  }

  function stepGuard(level, guard, dt) {
    if (guard.waitLeft > 0) {
      guard.waitLeft -= dt;
      return;
    }
    let target;
    let speed = guard.speed;
    if (guard.alerted && guard.alertTarget) {
      target = guard.alertTarget;
      speed = guard.speed * 1.55;
      guard.alertLeft -= dt;
      if (guard.alertLeft <= 0) {
        guard.alerted = false;
        guard.alertTarget = null;
      }
    } else {
      target = guard.waypoints[guard.waypointIndex % guard.waypoints.length];
    }
    const dx = target.x - guard.x;
    const dy = target.y - guard.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) {
      if (!guard.alerted) {
        guard.waypointIndex = (guard.waypointIndex + 1) % guard.waypoints.length;
        guard.waitLeft = guard.pause;
        const next = guard.waypoints[guard.waypointIndex % guard.waypoints.length];
        guard.facing = Math.atan2(next.y - guard.y, next.x - guard.x);
      }
      return;
    }
    const move = Math.min(dist, speed * dt);
    guard.x += (dx / dist) * move;
    guard.y += (dy / dist) * move;
    const wantFacing = Math.atan2(dy, dx);
    guard.facing += angleDifference(wantFacing, guard.facing) * Math.min(1, dt * 10);
  }

  /**
   * Advance the world one fixed step. `moveX`/`moveY` is the player's wished
   * direction (-1..1 each); `attract` runs the level with the player standing
   * still, for the title screen behind the menu. Returns an event bitmask.
   */
  function step(dt, moveX, moveY, attract) {
    if (state.gameOver || state.victory || state.levelClear) return EVENT_NONE;
    const level = state.level;
    let events = EVENT_NONE;
    state.time += dt;
    state.levelTime += dt;
    state.stepCount += 1;
    if (state.grace > 0) state.grace -= dt;

    // Player movement, sliding along walls.
    const moving = !attract && (moveX !== 0 || moveY !== 0);
    state.player.moving = moving;
    if (moving) {
      const len = Math.hypot(moveX, moveY);
      const nx = moveX / len;
      const ny = moveY / len;
      moveCircle(level, state.player, nx * PLAYER_SPEED * dt, ny * PLAYER_SPEED * dt, PLAYER_RADIUS);
      state.player.facing = Math.atan2(ny, nx);
      if (state.stepCount % 20 === 0) events |= EVENT_STEP;
    }

    // Lantern pickup.
    for (const lantern of level.lanterns) {
      if (lantern.taken) continue;
      if (Math.hypot(lantern.x - state.player.x, lantern.y - state.player.y) < PLAYER_RADIUS + 18) {
        lantern.taken = true;
        state.lanternsTaken += 1;
        state.score += SCORE_LANTERN;
        events |= EVENT_PICKUP;
        if (state.lanternsTaken >= state.lanternsTotal) state.exitOpen = true;
      }
    }

    // Guards patrol, watch, and react.
    let worst = 0;
    for (const guard of state.guards) {
      stepGuard(level, guard, dt);
      const rate = guardSeesPlayer(level, guard);
      if (rate > 0) {
        let fill = rate;
        if (groundUnder(level, state.player.x, state.player.y) === 'S') fill *= SHADOW_SLOWDOWN;
        guard.suspicion = Math.min(1, guard.suspicion + fill * dt);
        if (guard.suspicion >= SUSPICIOUS_AT && !guard.alerted) {
          guard.alerted = true;
          guard.alertTarget = { x: state.player.x, y: state.player.y };
          guard.alertLeft = 3;
          state.ghost = false;
          events |= EVENT_SUSPICIOUS;
        }
      } else {
        guard.suspicion = Math.max(0, guard.suspicion - DETECT_DECAY * dt);
        if (guard.suspicion < SUSPICIOUS_AT && guard.alerted) {
          guard.alerted = false;
          guard.alertTarget = null;
        }
      }
      worst = Math.max(worst, guard.suspicion);
    }
    const wasDetection = state.detection;
    state.detection = worst;

    // Caught: a full meter costs a life and sends the player back to start.
    if (worst >= 1 && state.grace <= 0) {
      state.lives -= 1;
      events |= EVENT_CAUGHT;
      if (state.lives <= 0) {
        state.gameOver = true;
      } else {
        respawn();
      }
      return events;
    }
    if (wasDetection < SUSPICIOUS_AT && worst >= SUSPICIOUS_AT) state.ghost = false;

    // Exit: open only once every lantern is taken.
    if (state.exitOpen && Math.hypot(level.exit.x - state.player.x, level.exit.y - state.player.y) < PLAYER_RADIUS + 20) {
      const timeBonus = Math.max(0, Math.round((level.parSeconds - state.levelTime) * TIME_BONUS_PER_SECOND));
      const ghostBonus = state.ghost ? SCORE_GHOST_BONUS : 0;
      state.score += SCORE_LEVEL_CLEAR + timeBonus + ghostBonus;
      state.levelClear = true;
      state.lastClear = { timeBonus, ghostBonus, level: state.levelIndex };
      return events | EVENT_LEVEL_CLEAR;
    }

    return events;
  }

  function playerHidden() {
    return groundUnder(state.level, state.player.x, state.player.y) === 'B';
  }

  function playerInShadow() {
    return groundUnder(state.level, state.player.x, state.player.y) === 'S';
  }

  reset();

  return {
    state,
    reset,
    loadLevel,
    startNextLevel,
    step,
    playerHidden,
    playerInShadow,
    hasLineOfSight,
    levelCount: LEVEL_COUNT,
  };
}

export { FIELD_WIDTH, FIELD_HEIGHT, STEP };
