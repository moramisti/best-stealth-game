// Keyboard and mouse input. WASD or arrow keys move the player; clicking a
// point on the floor walks toward it until a key is pressed or the point is
// reached. Enter/Space confirms, P pauses, R restarts, M mutes.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_RESTART = 4;
export const ACTION_MUTE = 8;

export function createInput(canvas, toWorld) {
  const keys = new Set();
  let actions = 0;
  let clickTarget = null;

  function keyDirection(key) {
    return key === 'ArrowLeft' || key === 'a' || key === 'A' || key === 'ArrowRight' || key === 'd' || key === 'D' || key === 'ArrowUp' || key === 'w' || key === 'W' || key === 'ArrowDown' || key === 's' || key === 'S';
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) event.preventDefault();
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) event.preventDefault();
    keys.add(event.key);
    if (event.key === 'Enter' || event.key === ' ') actions |= ACTION_CONFIRM;
    else if (event.key === 'p' || event.key === 'P' || event.key === 'Escape') actions |= ACTION_PAUSE;
    else if (event.key === 'r' || event.key === 'R') actions |= ACTION_RESTART;
    else if (event.key === 'm' || event.key === 'M') actions |= ACTION_MUTE;
    if (keyDirection(event.key)) clickTarget = null;
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.key);
  });
  window.addEventListener('blur', () => {
    keys.clear();
  });

  canvas.addEventListener('pointerdown', (event) => {
    const rect = canvas.getBoundingClientRect();
    clickTarget = toWorld((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
    actions |= ACTION_CONFIRM;
  });

  function direction(playerX, playerY) {
    let x = 0;
    let y = 0;
    if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) x -= 1;
    if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) x += 1;
    if (keys.has('ArrowUp') || keys.has('w') || keys.has('W')) y -= 1;
    if (keys.has('ArrowDown') || keys.has('s') || keys.has('S')) y += 1;
    if (x !== 0 || y !== 0) return { x, y };
    if (clickTarget) {
      const dx = clickTarget.x - playerX;
      const dy = clickTarget.y - playerY;
      const dist = Math.hypot(dx, dy);
      if (dist < 10) {
        clickTarget = null;
        return { x: 0, y: 0 };
      }
      return { x: dx / dist, y: dy / dist };
    }
    return { x: 0, y: 0 };
  }

  return {
    direction,
    clearClickTarget() {
      clickTarget = null;
    },
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
