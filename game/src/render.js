// Bayang Malam — the renderer: a top-down night scene on one canvas.
//
// The field is drawn tile by tile (stone floor, walls, crates, bushes,
// shadow ground), then each guard's vision cone, then lanterns, the exit
// gate, the guards and the player, bushes last so they really cover a
// hiding player, and finally a darkness layer with pools of light cut
// around the player, the lanterns and the open exit. The HUD and the
// title / clear / over / victory screens are drawn in the same canvas.
import { FIELD_HEIGHT, FIELD_WIDTH, GUARD_RADIUS, PLAYER_RADIUS, TILE } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_CLEAR = 'clear';
export const SCREEN_OVER = 'over';
export const SCREEN_VICTORY = 'victory';

const HUD_HEIGHT = 64;
const LOGICAL_WIDTH = FIELD_WIDTH;
const LOGICAL_HEIGHT = FIELD_HEIGHT + HUD_HEIGHT;
const TAU = Math.PI * 2;

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** A pre-rendered stone floor: checker tiles with speckles and worn patches. */
function buildFloorPattern() {
  const canvas = document.createElement('canvas');
  canvas.width = FIELD_WIDTH;
  canvas.height = FIELD_HEIGHT;
  const ctx = canvas.getContext('2d');
  for (let row = 0; row < FIELD_HEIGHT / TILE; row += 1) {
    for (let col = 0; col < FIELD_WIDTH / TILE; col += 1) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#1b2338' : '#171e30';
      ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.strokeRect(col * TILE + 0.5, row * TILE + 0.5, TILE - 1, TILE - 1);
    }
  }
  // Deterministic speckles: a fixed pseudo-random scatter, same every run.
  let seed = 1234567;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 500; i += 1) {
    ctx.fillStyle = next() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(next() * FIELD_WIDTH, next() * FIELD_HEIGHT, 2 + next() * 4, 2 + next() * 3);
  }
  return canvas;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const floorPattern = buildFloorPattern();
  const lightCanvas = document.createElement('canvas');
  lightCanvas.width = LOGICAL_WIDTH;
  lightCanvas.height = LOGICAL_HEIGHT;
  const lightCtx = lightCanvas.getContext('2d');

  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { width, height };
  }

  function drawTile(tile, x, y) {
    if (tile === '#') {
      ctx.fillStyle = '#2c3852';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#46587e';
      ctx.fillRect(x, y, TILE, 8);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x, y + TILE - 6, TILE, 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    } else if (tile === 'C') {
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
      ctx.strokeStyle = '#4a2f1c';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 4);
      ctx.lineTo(x + TILE - 4, y + TILE - 4);
      ctx.moveTo(x + TILE - 4, y + 4);
      ctx.lineTo(x + 4, y + TILE - 4);
      ctx.stroke();
      ctx.lineWidth = 1;
    } else if (tile === 'B') {
      ctx.fillStyle = '#12291a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#1e4d2a';
      for (const [ox, oy, r] of [[12, 14, 10], [30, 10, 11], [36, 30, 10], [14, 34, 9], [24, 24, 8]]) {
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#2f7a3d';
      for (const [ox, oy] of [[12, 14], [30, 10], [36, 30], [14, 34], [24, 24]]) {
        ctx.beginPath();
        ctx.arc(x + ox - 3, y + oy - 3, 3, 0, TAU);
        ctx.fill();
      }
    } else if (tile === 'S') {
      ctx.fillStyle = 'rgba(8, 10, 28, 0.55)';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(120, 140, 220, 0.18)';
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    }
  }

  function drawVisionCone(guard) {
    const suspicious = guard.suspicion >= 0.5;
    const gradient = ctx.createRadialGradient(guard.x, guard.y, 10, guard.x, guard.y, guard.range);
    if (suspicious) {
      gradient.addColorStop(0, 'rgba(255, 90, 60, 0.42)');
      gradient.addColorStop(1, 'rgba(255, 90, 60, 0)');
    } else {
      gradient.addColorStop(0, 'rgba(255, 214, 110, 0.34)');
      gradient.addColorStop(1, 'rgba(255, 214, 110, 0)');
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(guard.x, guard.y);
    ctx.arc(guard.x, guard.y, guard.range, guard.facing - guard.halfAngle, guard.facing + guard.halfAngle);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = suspicious ? 'rgba(255, 120, 90, 0.5)' : 'rgba(255, 214, 110, 0.35)';
    ctx.beginPath();
    ctx.moveTo(guard.x, guard.y);
    ctx.lineTo(guard.x + Math.cos(guard.facing - guard.halfAngle) * guard.range, guard.y + Math.sin(guard.facing - guard.halfAngle) * guard.range);
    ctx.moveTo(guard.x, guard.y);
    ctx.lineTo(guard.x + Math.cos(guard.facing + guard.halfAngle) * guard.range, guard.y + Math.sin(guard.facing + guard.halfAngle) * guard.range);
    ctx.stroke();
  }

  function drawLantern(lantern, time) {
    const flicker = 0.75 + Math.sin(time * 5 + lantern.x) * 0.15 + Math.sin(time * 9 + lantern.y) * 0.1;
    const glow = ctx.createRadialGradient(lantern.x, lantern.y, 4, lantern.x, lantern.y, 46);
    glow.addColorStop(0, `rgba(255, 214, 106, ${0.55 * flicker})`);
    glow.addColorStop(1, 'rgba(255, 214, 106, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lantern.x, lantern.y, 46, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#8a6a2f';
    ctx.fillRect(lantern.x - 9, lantern.y - 12, 18, 22);
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath();
    ctx.arc(lantern.x, lantern.y - 1, 6, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#8a6a2f';
    ctx.beginPath();
    ctx.arc(lantern.x, lantern.y - 12, 6, Math.PI, 0);
    ctx.stroke();
  }

  function drawExit(exit, open, time) {
    const pulse = open ? 0.7 + Math.sin(time * 4) * 0.3 : 0.25;
    const glow = ctx.createRadialGradient(exit.x, exit.y, 4, exit.x, exit.y, 70);
    glow.addColorStop(0, open ? `rgba(55, 214, 122, ${0.5 * pulse + 0.25})` : 'rgba(120, 120, 120, 0.15)');
    glow.addColorStop(1, 'rgba(55, 214, 122, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(exit.x, exit.y, 70, 0, TAU);
    ctx.fill();
    ctx.fillStyle = open ? '#1d7a44' : '#3a3f4a';
    ctx.fillRect(exit.x - 20, exit.y - 20, 8, 40);
    ctx.fillRect(exit.x + 12, exit.y - 20, 8, 40);
    ctx.fillStyle = open ? '#37d67a' : '#565d6e';
    ctx.beginPath();
    ctx.arc(exit.x, exit.y - 20, 20, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = open ? '#0d2b18' : '#22242c';
    ctx.fillRect(exit.x - 12, exit.y - 18, 24, 36);
    ctx.fillStyle = open ? '#a9f5c6' : '#8a8f9e';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(open ? 'KELUAR' : 'TERKUNCI', exit.x, exit.y + 34);
  }

  function drawGuard(guard) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(guard.x, guard.y + GUARD_RADIUS - 3, GUARD_RADIUS, 6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#a93226';
    ctx.beginPath();
    ctx.arc(guard.x, guard.y, GUARD_RADIUS, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#e8b4a0';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;
    // Helmet cap and facing nose.
    ctx.fillStyle = '#d8dce6';
    ctx.beginPath();
    ctx.arc(guard.x, guard.y, GUARD_RADIUS - 5, guard.facing - 1.1, guard.facing + 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2b2f3a';
    ctx.beginPath();
    ctx.arc(guard.x + Math.cos(guard.facing) * 8, guard.y + Math.sin(guard.facing) * 8, 4, 0, TAU);
    ctx.fill();
    if (guard.suspicion >= 0.85) {
      ctx.fillStyle = '#ff5a3c';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', guard.x, guard.y - GUARD_RADIUS - 8);
    } else if (guard.suspicion >= 0.5) {
      ctx.fillStyle = '#ffd76a';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('?', guard.x, guard.y - GUARD_RADIUS - 8);
    }
  }

  function drawPlayer(player, hidden, grace) {
    const blink = grace > 0 && Math.floor(grace * 8) % 2 === 0;
    ctx.globalAlpha = hidden ? 0.55 : blink ? 0.45 : 1;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(player.x, player.y + PLAYER_RADIUS - 2, PLAYER_RADIUS, 6, 0, 0, TAU);
    ctx.fill();
    // Hooded cloak: a pointed hood in the facing direction.
    ctx.fillStyle = '#7c5cff';
    ctx.beginPath();
    ctx.arc(player.x, player.y, PLAYER_RADIUS, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(player.x + Math.cos(player.facing) * (PLAYER_RADIUS + 9), player.y + Math.sin(player.facing) * (PLAYER_RADIUS + 9));
    ctx.lineTo(player.x + Math.cos(player.facing + 2.4) * PLAYER_RADIUS * 0.8, player.y + Math.sin(player.facing + 2.4) * PLAYER_RADIUS * 0.8);
    ctx.lineTo(player.x + Math.cos(player.facing - 2.4) * PLAYER_RADIUS * 0.8, player.y + Math.sin(player.facing - 2.4) * PLAYER_RADIUS * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f2c9a0';
    ctx.beginPath();
    ctx.arc(player.x + Math.cos(player.facing) * 5, player.y + Math.sin(player.facing) * 5, 6.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2b2f3a';
    ctx.beginPath();
    ctx.arc(player.x + Math.cos(player.facing) * 7, player.y + Math.sin(player.facing) * 7, 2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (hidden) {
      ctx.fillStyle = '#a9f5c6';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('TERSEMBUNYI', player.x, player.y - PLAYER_RADIUS - 10);
    }
  }

  function drawDarkness(state) {
    lightCtx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    lightCtx.fillStyle = 'rgba(3, 5, 16, 0.5)';
    lightCtx.fillRect(0, HUD_HEIGHT, FIELD_WIDTH, FIELD_HEIGHT);
    lightCtx.globalCompositeOperation = 'destination-out';
    function hole(x, y, radius, strength) {
      const gradient = lightCtx.createRadialGradient(x, y + HUD_HEIGHT, 4, x, y + HUD_HEIGHT, radius);
      gradient.addColorStop(0, `rgba(0,0,0,${strength})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      lightCtx.fillStyle = gradient;
      lightCtx.beginPath();
      lightCtx.arc(x, y + HUD_HEIGHT, radius, 0, TAU);
      lightCtx.fill();
    }
    hole(state.player.x, state.player.y, 170, 0.95);
    for (const lantern of state.level.lanterns) {
      if (!lantern.taken) hole(lantern.x, lantern.y, 95, 0.6);
    }
    if (state.exitOpen) hole(state.level.exit.x, state.level.exit.y, 120, 0.65);
    for (const guard of state.guards) hole(guard.x, guard.y, 70, 0.35);
    lightCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(lightCanvas, 0, 0);
  }

  function drawHud(state, screen, best, muted) {
    ctx.fillStyle = '#0d1220';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, HUD_HEIGHT);
    ctx.fillStyle = '#2c3852';
    ctx.fillRect(0, HUD_HEIGHT - 2, LOGICAL_WIDTH, 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffd76a';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText(`LEVEL ${state.levelIndex + 1} — ${state.level.name}`, 16, 28);
    ctx.fillStyle = '#c8d0e0';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(state.level.subtitle, 16, 50);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8ecf4';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillText(`SKOR ${state.score}`, 480, 27);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = state.exitOpen ? '#37d67a' : '#c8d0e0';
    const lanternText = state.exitOpen ? `Lentera ${state.lanternsTaken}/${state.lanternsTotal} — PINTU TERBUKA!` : `Lentera ${state.lanternsTaken}/${state.lanternsTotal}`;
    ctx.fillText(lanternText, 480, 50);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ff7a6b';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText('♥'.repeat(Math.max(0, state.lives)) + '♡'.repeat(Math.max(0, 3 - state.lives)), 944, 28);
    ctx.fillStyle = '#c8d0e0';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`${formatTime(state.levelTime)}   Terbaik ${best}   ${muted ? 'SUARA MATI (M)' : 'Suara: M'}`, 944, 50);
    // Detection meter across the top centre, under the HUD.
    if (screen === SCREEN_PLAY && state.detection > 0.02) {
      const width = 260;
      const x = (LOGICAL_WIDTH - width) / 2;
      const y = HUD_HEIGHT + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 2, y - 2, width + 4, 14);
      ctx.fillStyle = state.detection >= 0.5 ? '#ff5a3c' : '#ffd76a';
      ctx.fillRect(x, y, width * state.detection, 10);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.detection >= 0.85 ? 'HAMPIR KETAHUAN — SEMBUNYI!' : state.detection >= 0.5 ? 'DICURIGAI!' : 'TERLIHAT…', LOGICAL_WIDTH / 2, y + 26);
    }
  }

  function overlayPanel(lines, title, titleColor) {
    ctx.fillStyle = 'rgba(5, 8, 18, 0.72)';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    ctx.textAlign = 'center';
    ctx.fillStyle = titleColor;
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.fillText(title, LOGICAL_WIDTH / 2, 250);
    ctx.fillStyle = '#e8ecf4';
    ctx.font = '18px system-ui, sans-serif';
    lines.forEach((line, i) => {
      ctx.fillText(line, LOGICAL_WIDTH / 2, 300 + i * 30);
    });
  }

  function drawTitle(state, best) {
    overlayPanel(
      [
        'Curi semua lentera, lalu kabur lewat pintu keluar — tanpa terlihat.',
        'Penjaga berpatroli dengan kerucut pandang. Semak menyembunyikanmu,',
        'bayangan memperlambat kecurigaan, peti menghalangi pandangan.',
        '',
        'Gerak: WASD / panah atau klik — Jeda: P — Mulai ulang: R — Suara: M',
        `Skor terbaik: ${best}`,
        '',
        'TEKAN ENTER ATAU KLIK UNTUK MULAI',
      ],
      'BAYANG MALAM',
      '#ffd76a',
    );
    ctx.fillStyle = '#a9f5c6';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText('— Pencuri Lentera —', LOGICAL_WIDTH / 2, 285);
  }

  function draw(state, screen, best, info = {}) {
    const { width, height } = fitCanvas();
    const scale = Math.min(width / LOGICAL_WIDTH, height / LOGICAL_HEIGHT);
    const offsetX = (width - LOGICAL_WIDTH * scale) / 2;
    const offsetY = (height - LOGICAL_HEIGHT * scale) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

    // Field.
    ctx.save();
    ctx.translate(0, HUD_HEIGHT);
    ctx.drawImage(floorPattern, 0, 0);
    const level = state.level;
    for (let row = 0; row < level.grid.length; row += 1) {
      for (let col = 0; col < level.grid[row].length; col += 1) {
        drawTile(level.grid[row][col], col * TILE, row * TILE);
      }
    }
    drawExit(level.exit, state.exitOpen, state.time);
    for (const lantern of level.lanterns) {
      if (!lantern.taken) drawLantern(lantern, state.time);
    }
    for (const guard of state.guards) drawVisionCone(guard);
    for (const guard of state.guards) drawGuard(guard);
    drawPlayer(state.player, info.hidden, state.grace);
    // Bushes over the top, so a hiding player is really covered.
    for (let row = 0; row < level.grid.length; row += 1) {
      for (let col = 0; col < level.grid[row].length; col += 1) {
        if (level.grid[row][col] === 'B') drawTile('B', col * TILE, row * TILE);
      }
    }
    ctx.restore();

    drawDarkness(state);
    drawHud(state, screen, best, info.muted);

    if (screen === SCREEN_TITLE) drawTitle(state, best);
    else if (screen === SCREEN_PAUSED) {
      overlayPanel(['Permainan dijeda.', '', 'P / Enter — lanjutkan', 'R — mulai ulang level'], 'JEDA', '#c8d0e0');
    } else if (screen === SCREEN_CLEAR) {
      const clear = info.lastClear || { timeBonus: 0, ghostBonus: 0 };
      overlayPanel(
        [
          `Level ${state.levelIndex + 1} selesai — semua lentera dicuri.`,
          `Bonus waktu: +${clear.timeBonus}   Bonus tanpa jejak: +${clear.ghostBonus}`,
          `Skor: ${state.score}`,
          '',
          'ENTER — LEVEL BERIKUTNYA',
        ],
        'LEVEL SELESAI!',
        '#37d67a',
      );
    } else if (screen === SCREEN_OVER) {
      overlayPanel(
        [`Kamu tertangkap. Skor: ${state.score}`, `Skor terbaik: ${best}`, '', 'R — MAIN LAGI', 'Enter — main lagi'],
        'TERTANGKAP!',
        '#ff5a3c',
      );
    } else if (screen === SCREEN_VICTORY) {
      overlayPanel(
        [
          'Semua lentera dari tiga level berhasil dicuri — tanpa jejak.',
          `Skor akhir: ${state.score}`,
          `Skor terbaik: ${best}`,
          '',
          'R — MAIN LAGI',
        ],
        'SEMUA LENTERA DICURI!',
        '#ffd76a',
      );
    }
  }

  return { draw };
}
