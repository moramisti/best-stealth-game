// All sound is synthesised with WebAudio — no audio files, no network.
// Footsteps are short filtered thumps (the player's, and a guard's when one
// walks nearby, panned to the side the guard is on, so you can hear where
// a patrol is). Pickups chime, suspicion blips, being caught wails, and
// clearing a level plays a small arpeggio.
export function createAudio() {
  let context = null;
  let muted = false;
  let master = null;

  function ensure() {
    if (context) {
      if (context.state === 'suspended') context.resume().catch(() => {});
      return context;
    }
    try {
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContextClass) return null;
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
    } catch {
      context = null;
    }
    return context;
  }

  function tone({ frequency, frequencyEnd, duration, type = 'sine', volume = 0.2, when = 0, pan = 0 }) {
    const ctx = ensure();
    if (!ctx || muted) return;
    const start = ctx.currentTime + when;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (frequencyEnd !== undefined) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, frequencyEnd), start + duration);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      panner.connect(master);
    } else {
      gain.connect(master);
    }
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  function thump(volume, pan, low) {
    const ctx = ensure();
    if (!ctx || muted) return;
    const start = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * 0.07);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = low ? 220 : 320;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    source.connect(filter);
    filter.connect(gain);
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      panner.connect(master);
    } else {
      gain.connect(master);
    }
    source.start(start);
  }

  let stepAlternate = false;
  return {
    unlock() {
      ensure();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    isMuted() {
      return muted;
    },
    /** The player's own footstep: soft, alternating pitch. */
    footstep() {
      stepAlternate = !stepAlternate;
      thump(0.12, 0, stepAlternate);
    },
    /** A guard's footstep, panned by where the guard is relative to the player. */
    guardStep(pan, distance) {
      const volume = Math.max(0.02, 0.16 * (1 - distance / 320));
      thump(volume, pan, true);
    },
    pickup() {
      tone({ frequency: 660, duration: 0.12, volume: 0.18 });
      tone({ frequency: 990, duration: 0.18, volume: 0.18, when: 0.09 });
    },
    suspicious() {
      tone({ frequency: 220, frequencyEnd: 330, duration: 0.16, type: 'triangle', volume: 0.2 });
    },
    caught() {
      tone({ frequency: 520, frequencyEnd: 130, duration: 0.7, type: 'sawtooth', volume: 0.25 });
      tone({ frequency: 392, frequencyEnd: 98, duration: 0.7, type: 'sawtooth', volume: 0.15, when: 0.08 });
    },
    levelClear() {
      [523, 659, 784, 1047].forEach((frequency, i) => {
        tone({ frequency, duration: 0.22, volume: 0.18, when: i * 0.11 });
      });
    },
    victory() {
      [523, 659, 784, 1047, 1319].forEach((frequency, i) => {
        tone({ frequency, duration: 0.3, volume: 0.18, when: i * 0.13 });
      });
    },
    click() {
      tone({ frequency: 880, duration: 0.06, volume: 0.12 });
    },
  };
}
