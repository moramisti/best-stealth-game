// Bayang Malam — boot and the one loop: input is read every frame, the world
// advances in fixed 1/60 s steps, and the renderer paints what is there.
// The game moves between title, play, paused, level-clear, game-over and
// victory screens.
//
// ?seed=N fixes the level's small random details. ?shot=start|play|end|
// stealth|caught (with &seed=N) stages that scene instead of running the
// loop, paints it twice and sets window.__shotReady for a screenshot.
import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createAudio } from './audio.js';
import { createWorld, EVENT_CAUGHT, EVENT_LEVEL_CLEAR, EVENT_PICKUP, EVENT_STEP, EVENT_SUSPICIOUS, EVENT_VICTORY } from './world.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createRenderer, SCREEN_CLEAR, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_VICTORY } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

// A test hook: the play-test reads the live state through this, nothing else uses it.
window.__game = world;
window.__errors = [];
window.addEventListener('error', (event) => {
  window.__errors.push(String(event.message || event.error || 'unknown error'));
});

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, 0, { hidden: world.playerHidden(), lastClear: world.state.lastClear });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas, (fx, fy) => {
    // Click position in fractions of the canvas -> world pixels.
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / 960, rect.height / 688);
    const offsetX = (rect.width - 960 * scale) / 2;
    const offsetY = (rect.height - 688 * scale) / 2;
    return { x: (fx * rect.width - offsetX) / scale, y: (fy * rect.height - offsetY) / scale - 64 };
  });
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let lastClear = null;
  let guardStepTimer = 0;

  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    audio.unlock();
    world.reset();
    accumulator = 0;
    lastClear = null;
    screen = SCREEN_PLAY;
    announce('Bermain. Curi semua lentera, lalu kabur lewat pintu keluar.');
  }

  function endGame() {
    screen = SCREEN_OVER;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    announce(`Tertangkap. Skor ${world.state.score}. Terbaik ${best}.`);
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Suara mati.' : 'Suara hidup.');
    }
    if (actions & ACTION_RESTART && (screen === SCREEN_PLAY || screen === SCREEN_PAUSED || screen === SCREEN_OVER || screen === SCREEN_VICTORY)) {
      audio.click();
      startGame();
      return;
    }
    if (actions & ACTION_CONFIRM && screen === SCREEN_TITLE) {
      audio.click();
      startGame();
    } else if (actions & ACTION_CONFIRM && screen === SCREEN_CLEAR) {
      audio.click();
      if (world.startNextLevel() === EVENT_VICTORY) {
        screen = SCREEN_VICTORY;
        audio.victory();
        if (world.state.score > best) {
          best = world.state.score;
          saveBest(best);
        }
        announce(`Menang! Skor akhir ${world.state.score}.`);
      } else {
        screen = SCREEN_PLAY;
        announce(`Level ${world.state.levelIndex + 1}: ${world.state.level.name}.`);
      }
    } else if (actions & ACTION_CONFIRM && (screen === SCREEN_OVER || screen === SCREEN_VICTORY)) {
      audio.click();
      startGame();
    } else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Jeda.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Bermain.');
    }
  }

  function handleEvents(events) {
    if (events & EVENT_PICKUP) {
      audio.pickup();
      announce(`Lentera ${world.state.lanternsTaken} dari ${world.state.lanternsTotal}.`);
    }
    if (events & EVENT_SUSPICIOUS) {
      audio.suspicious();
      announce('Penjaga curiga!');
    }
    if (events & EVENT_CAUGHT) {
      audio.caught();
      if (world.state.lives <= 0) endGame();
      else announce(`Tertangkap! ${world.state.lives} nyawa tersisa.`);
    }
    if (events & EVENT_STEP) audio.footstep();
    if (events & EVENT_LEVEL_CLEAR) {
      lastClear = world.state.lastClear;
      audio.levelClear();
      screen = SCREEN_CLEAR;
      announce(`Level ${world.state.levelIndex + 1} selesai! Skor ${world.state.score}.`);
    }
    if (events & EVENT_VICTORY) {
      screen = SCREEN_VICTORY;
      audio.victory();
    }
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, 0, 0, true);
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    const direction = input.direction(world.state.player.x, world.state.player.y);
    const events = world.step(STEP, direction.x, direction.y, false);
    handleEvents(events);
    // A guard's footsteps, panned to the side the nearest guard walks on.
    guardStepTimer -= STEP;
    if (guardStepTimer <= 0) {
      let nearest = null;
      let nearestDist = Infinity;
      for (const guard of world.state.guards) {
        const dist = Math.hypot(guard.x - world.state.player.x, guard.y - world.state.player.y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = guard;
        }
      }
      if (nearest && nearestDist < 320) {
        audio.guardStep((nearest.x - world.state.player.x) / 320, nearestDist);
      }
      guardStepTimer = 0.45;
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
      step();
      accumulator -= STEP;
      if (screen !== SCREEN_TITLE && screen !== SCREEN_PLAY) break;
    }
    if (screen !== SCREEN_TITLE && screen !== SCREEN_PLAY) accumulator = 0;
    renderer.draw(world.state, screen, best, {
      hidden: world.playerHidden(),
      muted: audio.isMuted(),
      lastClear,
    });
  }

  // Leaving the tab pauses a running game rather than letting guards close in unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Jeda.');
    }
  });

  announce('Bayang Malam, Pencuri Lentera. Tekan Enter atau klik untuk mulai.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
