// The screenshot scenes behind ?shot=start|play|end|stealth|caught. Each one
// plays the real rules forward from a fresh world, steered by a small
// pathfinding autopilot: every quarter second it plans a route over the
// tile grid to the nearest lantern (or the exit), paying extra for tiles a
// guard's vision cone covers and less for bushes, then walks it. The same
// seed always gives the same frame.
import { STEP, TILE } from './config.js';
import { EVENT_CAUGHT, EVENT_LEVEL_CLEAR, hasLineOfSight } from './world.js';
import { SCREEN_CLEAR, SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 8;
const END_LIMIT_SECONDS = 300;
const CAUGHT_LIMIT_SECONDS = 120;
const REPLAN_EVERY_STEPS = 15;

/** A tiny binary heap of [cost, index] pairs for Dijkstra. */
function makeHeap() {
  const items = [];
  function push(cost, index) {
    items.push([cost, index]);
    let child = items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (items[parent][0] <= items[child][0]) break;
      [items[parent], items[child]] = [items[child], items[parent]];
      child = parent;
    }
  }
  function pop() {
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < items.length && items[left][0] < items[smallest][0]) smallest = left;
        if (right < items.length && items[right][0] < items[smallest][0]) smallest = right;
        if (smallest === parent) break;
        [items[parent], items[smallest]] = [items[smallest], items[parent]];
        parent = smallest;
      }
    }
    return top;
  }
  return { push, pop, get size() { return items.length; } };
}

/**
 * Plan a route over the tile grid from the player's tile to `targetTile`.
 * `coneCost` is the extra price of a tile a guard can see: high and the
 * route goes around vision cones, low and it walks straight through them.
 * Bushes are cheap (they hide the player) and shadow is slightly cheap.
 * Returns the route as pixel centres, nearest first, or [] when already there.
 */
function planPath(world, targetTile, coneCost) {
  const state = world.state;
  const level = state.level;
  const rows = level.grid.length;
  const cols = level.grid[0].length;
  const startCol = Math.floor(state.player.x / TILE);
  const startRow = Math.floor(state.player.y / TILE);
  const start = startRow * cols + startCol;
  const goal = targetTile.row * cols + targetTile.col;
  if (start === goal) return [];

  // Price every tile once: a guard's cone makes it dear, a bush makes it cheap.
  const cost = new Float64Array(rows * cols).fill(Infinity);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const tile = level.grid[row][col];
      if (tile === '#' || tile === 'C') continue;
      let price = 1;
      if (tile === 'B') price = 0.5;
      else if (tile === 'S') price = 0.8;
      if (tile !== 'B' && coneCost > 0) {
        const cx = (col + 0.5) * TILE;
        const cy = (row + 0.5) * TILE;
        for (const guard of state.guards) {
          const dx = cx - guard.x;
          const dy = cy - guard.y;
          const dist = Math.hypot(dx, dy);
          if (dist > guard.range + 15) continue;
          const angle = Math.atan2(dy, dx);
          let diff = angle - guard.facing;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          if (Math.abs(diff) > guard.halfAngle) continue;
          if (!hasLineOfSight(level, guard.x, guard.y, cx, cy)) continue;
          price += coneCost;
          break;
        }
      }
      cost[row * cols + col] = price;
    }
  }

  const dist = new Float64Array(rows * cols).fill(Infinity);
  const prev = new Int32Array(rows * cols).fill(-1);
  const heap = makeHeap();
  dist[start] = 0;
  heap.push(0, start);
  while (heap.size > 0) {
    const [d, current] = heap.pop();
    if (d > dist[current]) continue;
    if (current === goal) break;
    const col = current % cols;
    const row = (current - col) / cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const next = nr * cols + nc;
      if (!Number.isFinite(cost[next])) continue;
      const nd = d + cost[next];
      if (nd < dist[next]) {
        dist[next] = nd;
        prev[next] = current;
        heap.push(nd, next);
      }
    }
  }
  if (!Number.isFinite(dist[goal])) return [];
  const route = [];
  let current = goal;
  while (current !== -1 && current !== start) {
    route.push({ x: (current % cols + 0.5) * TILE, y: ((current - (current % cols)) / cols + 0.5) * TILE });
    current = prev[current];
  }
  route.reverse();
  return route;
}

function nearestLanternTile(state) {
  let best = null;
  let bestDist = Infinity;
  for (const lantern of state.level.lanterns) {
    if (lantern.taken) continue;
    const dist = Math.hypot(lantern.x - state.player.x, lantern.y - state.player.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = lantern;
    }
  }
  return best;
}

/**
 * The autopilot's steering: it keeps a planned route (replanned every
 * quarter second, or when the goal changes) and walks toward the next tile
 * centre on it. `coneCost` 8 plays patiently; 0 walks straight through
 * vision cones.
 */
function createAutopilot(world, coneCost) {
  let route = [];
  let stepsSinceReplan = Infinity;
  let goalKey = '';
  return function steer() {
    const state = world.state;
    let target;
    let key;
    if (state.lanternsTaken < state.lanternsTotal) {
      target = nearestLanternTile(state);
      key = `L${target.x},${target.y}`;
    } else {
      target = state.level.exit;
      key = `E${target.x},${target.y}`;
    }
    stepsSinceReplan += 1;
    if (key !== goalKey || stepsSinceReplan >= REPLAN_EVERY_STEPS || route.length === 0) {
      goalKey = key;
      stepsSinceReplan = 0;
      route = planPath(world, { col: Math.floor(target.x / TILE), row: Math.floor(target.y / TILE) }, coneCost);
    }
    const player = state.player;
    while (route.length > 0 && Math.hypot(route[0].x - player.x, route[0].y - player.y) < 10) route.shift();
    const waypoint = route.length > 0 ? route[0] : target;
    const dx = waypoint.x - player.x;
    const dy = waypoint.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return [0, 0];
    return [dx / dist, dy / dist];
  };
}

function runAutopilot(world, seconds, coneCost) {
  const steer = createAutopilot(world, coneCost);
  const limit = Math.floor(seconds / STEP);
  for (let index = 0; index < limit; index += 1) {
    const [mx, my] = steer();
    const events = world.step(STEP, mx, my, false);
    if (events & EVENT_LEVEL_CLEAR) return 'clear';
    if (events & EVENT_CAUGHT) return 'caught';
    if (world.state.gameOver) return 'over';
  }
  return 'playing';
}

/**
 * Set `world` to the named scene and return the screen to draw over it.
 * start: the title over a patrolling level. play: mid-game, the autopilot
 * sneaking toward a lantern. end: the level-clear screen after the autopilot
 * really wins level 1. stealth: the player hidden in a bush while a guard's
 * cone sweeps past. caught: the game-over screen after a bold autopilot is
 * spotted.
 */
export function stageShot(name, world) {
  world.reset();
  if (name === 'play') {
    runAutopilot(world, PLAY_SECONDS, 8);
    return { screen: SCREEN_PLAY };
  }
  if (name === 'end') {
    const outcome = runAutopilot(world, END_LIMIT_SECONDS, 8);
    if (outcome === 'clear') return { screen: SCREEN_CLEAR };
    return { screen: SCREEN_PLAY };
  }
  if (name === 'caught') {
    // A moth to the flame: chase the nearest guard, then stand still inside
    // its cone until spotted. The guard's own suspicion closes in on a
    // standing player, so detection fills to a catch; three catches end it.
    for (let index = 0; index < Math.floor(CAUGHT_LIMIT_SECONDS / STEP); index += 1) {
      const state = world.state;
      let mx = 0;
      let my = 0;
      if (state.detection < 0.25) {
        let nearest = null;
        let nearestDist = Infinity;
        for (const guard of state.guards) {
          const dist = Math.hypot(guard.x - state.player.x, guard.y - state.player.y);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = guard;
          }
        }
        if (nearest) {
          const route = planPath(
            world,
            { col: Math.floor(nearest.x / TILE), row: Math.floor(nearest.y / TILE) },
            0,
          );
          const player = state.player;
          while (route.length > 0 && Math.hypot(route[0].x - player.x, route[0].y - player.y) < 10) route.shift();
          if (route.length > 0) {
            const dx = route[0].x - player.x;
            const dy = route[0].y - player.y;
            const dist = Math.hypot(dx, dy);
            if (dist >= 4) {
              mx = dx / dist;
              my = dy / dist;
            }
          }
        }
      }
      const events = world.step(STEP, mx, my, false);
      if (events & EVENT_CAUGHT) {
        // Keep going until the third catch ends the game.
      }
      if (world.state.gameOver) return { screen: SCREEN_OVER };
    }
    return { screen: SCREEN_PLAY };
  }
  if (name === 'stealth') {
    // Plan a route to the bush nearest a patrolling guard and walk it, then
    // freeze the moment the player is hidden with a guard close by.
    const level = world.state.level;
    let bushTarget = null;
    for (let row = 0; row < level.grid.length; row += 1) {
      for (let col = 0; col < level.grid[row].length; col += 1) {
        if (level.grid[row][col] !== 'B') continue;
        const x = (col + 0.5) * TILE;
        const y = (row + 0.5) * TILE;
        const nearGuard = world.state.guards.some((guard) => Math.hypot(guard.x - x, guard.y - y) < 300);
        if (!nearGuard) continue;
        const dist = Math.hypot(x - world.state.player.x, y - world.state.player.y);
        if (!bushTarget || dist < bushTarget.dist) bushTarget = { col, row, dist };
      }
    }
    let route = bushTarget ? planPath(world, bushTarget, 8) : [];
    let replanIn = 0;
    for (let index = 0; index < Math.floor(120 / STEP); index += 1) {
      replanIn -= 1;
      if (bushTarget && replanIn <= 0) {
        route = planPath(world, bushTarget, 8);
        replanIn = REPLAN_EVERY_STEPS;
      }
      const player = world.state.player;
      while (route.length > 0 && Math.hypot(route[0].x - player.x, route[0].y - player.y) < 10) route.shift();
      let mx = 0;
      let my = 0;
      if (route.length > 0) {
        const dx = route[0].x - player.x;
        const dy = route[0].y - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= 4) {
          mx = dx / dist;
          my = dy / dist;
        }
      }
      world.step(STEP, mx, my, false);
      const hidden = world.playerHidden();
      const nearGuard = world.state.guards.some(
        (guard) => Math.hypot(guard.x - player.x, guard.y - player.y) < 260,
      );
      if (hidden && nearGuard) break;
    }
    return { screen: SCREEN_PLAY };
  }
  // start (and anything else): a few seconds of patrol behind the title.
  for (let index = 0; index < START_SECONDS / STEP; index += 1) world.step(STEP, 0, 0, true);
  return { screen: SCREEN_TITLE };
}
