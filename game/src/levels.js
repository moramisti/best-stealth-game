// The three levels of Bayang Malam. Each level is an ASCII map plus its guards.
//
// Map legend:
//   # wall (blocks movement and sight)   C crate (blocks movement and sight)
//   . floor                              B bush (hides the player, walkable)
//   S shadow floor (detection fills slower)   P player start
//   L lantern (collect them all to unlock the exit)   E exit gate
//
// A guard patrols a list of waypoints in tile coordinates. Every segment of a
// patrol is axis-aligned and runs only over walkable tiles, so a guard never
// clips through a wall. `range` is the vision-cone reach in pixels,
// `halfAngle` the cone's half-angle in degrees, `pause` the wait at each
// waypoint, in seconds.
import { TILE } from './config.js';

const LEVEL_1_MAP = [
  '####################',
  '#P...B......L......#',
  '#.##....##....##...#',
  '#......C.....#.....#',
  '#.###.....B...#....#',
  '#.#.......##.......#',
  '#.#..L....##..C....#',
  '#.#..###......##...#',
  '#.....#...B....#...#',
  '#.##..#....##......#',
  '#.....B....#..L...E#',
  '#..C.......#.......#',
  '####################',
];

const LEVEL_2_MAP = [
  '####################',
  '#P..B....C....L....#',
  '#.##.##.....##.#...#',
  '#....#...B...#.L...#',
  '#.##....###....##..#',
  '#.#..C.....#..L....#',
  '#.#.####.B.#.##....#',
  '#......#...#....#..#',
  '#.##..B..C...##....#',
  '#.#....##......#...#',
  '#...L....#..B.....E#',
  '#..C......#....S...#',
  '####################',
];

const LEVEL_3_MAP = [
  '####################',
  '#P...#.....L....#..#',
  '#.##.#..##..#..#...#',
  '#....#....#..B...L.#',
  '#.###..C.....##....#',
  '#.#......##..#..L..#',
  '#.#.##..B....#.....#',
  '#...#...##..C..#...#',
  '#.##...#....#..#...#',
  '#.#..L....##.....#.#',
  '#..B...#...#..#....#',
  '#....#....L....#..E#',
  '####################',
];

const LEVELS = [
  {
    name: 'Taman Bulan',
    subtitle: 'Malam pertama — pelajari patroli, curi 3 lentera.',
    map: LEVEL_1_MAP,
    parSeconds: 90,
    guards: [
      { waypoints: [[16, 1], [16, 10]], speed: 55, range: 190, halfAngle: 35, pause: 1.2 },
      { waypoints: [[4, 5], [9, 5]], speed: 50, range: 185, halfAngle: 33, pause: 1.5 },
    ],
  },
  {
    name: 'Balai Lentera',
    subtitle: 'Penjaga lebih cepat, kerucut lebih lebar — 4 lentera.',
    map: LEVEL_2_MAP,
    parSeconds: 105,
    guards: [
      { waypoints: [[17, 1], [17, 9]], speed: 68, range: 215, halfAngle: 38, pause: 1.0 },
      { waypoints: [[9, 9], [14, 9]], speed: 62, range: 210, halfAngle: 37, pause: 1.0 },
      { waypoints: [[12, 3], [12, 9]], speed: 60, range: 205, halfAngle: 37, pause: 1.2 },
    ],
  },
  {
    name: 'Menara Bayang',
    subtitle: 'Empat penjaga, sedikit tempat sembunyi — 5 lentera.',
    map: LEVEL_3_MAP,
    parSeconds: 120,
    guards: [
      { waypoints: [[17, 1], [17, 8]], speed: 82, range: 245, halfAngle: 43, pause: 0.8 },
      { waypoints: [[9, 6], [12, 6]], speed: 78, range: 240, halfAngle: 42, pause: 0.8 },
      { waypoints: [[6, 3], [6, 10]], speed: 75, range: 235, halfAngle: 42, pause: 1.0 },
      { waypoints: [[12, 9], [16, 9]], speed: 80, range: 240, halfAngle: 43, pause: 0.8 },
    ],
  },
];

export const LEVEL_COUNT = LEVELS.length;

/** A tile is walkable when it is not a wall or a crate. */
export function tileWalkable(tile) {
  return tile !== '#' && tile !== 'C';
}

/** A tile blocks a guard's line of sight when it is a wall or a crate. */
export function tileBlocksSight(tile) {
  return tile === '#' || tile === 'C';
}

/**
 * Parse one level definition into the live structures the world steps:
 * the tile grid, the lantern list, the exit, the player start, and guards
 * with their patrol waypoints converted to pixel centres.
 */
export function buildLevel(index) {
  const def = LEVELS[index];
  const grid = def.map.map((row) => row.split(''));
  const lanterns = [];
  let start = { x: TILE * 1.5, y: TILE * 1.5 };
  let exit = { x: TILE * 18.5, y: TILE * 10.5 };
  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < grid[row].length; col += 1) {
      const tile = grid[row][col];
      const cx = (col + 0.5) * TILE;
      const cy = (row + 0.5) * TILE;
      if (tile === 'P') start = { x: cx, y: cy };
      else if (tile === 'E') exit = { x: cx, y: cy };
      else if (tile === 'L') lanterns.push({ x: cx, y: cy, taken: false });
    }
  }
  const guards = def.guards.map((guard) => ({
    waypoints: guard.waypoints.map(([col, row]) => ({ x: (col + 0.5) * TILE, y: (row + 0.5) * TILE })),
    speed: guard.speed,
    range: guard.range,
    halfAngle: (guard.halfAngle * Math.PI) / 180,
    pause: guard.pause,
  }));
  return {
    index,
    name: def.name,
    subtitle: def.subtitle,
    parSeconds: def.parSeconds,
    grid,
    lanterns,
    start,
    exit,
    guards,
  };
}
