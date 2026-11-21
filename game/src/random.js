// A tiny seeded random generator (mulberry32). A fixed seed replays the same
// level layout and patrol timing, which is what the screenshot scenes need;
// a random seed keeps every fresh play different in the small details.
export function createRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** An integer in [min, max) from a seeded generator. */
export function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min));
}

/** Pick one element of an array from a seeded generator. */
export function randomPick(random, items) {
  return items[Math.floor(random() * items.length)];
}
