/* @deps: none */
let audioCtx = null;
let soundOn = false;

export const TONES = {
  create: [660, 0.07],
  change: [430, 0.05],
  retire: [300, 0.09],
  combat: [180, 0.14],
  output: [880, 0.06],
  error: [140, 0.32]
};

export function soundEnabled() { return soundOn; }

function ensureAudio() {
  if (audioCtx) return audioCtx;
  const Ctor = typeof AudioContext !== "undefined" ? AudioContext
    : (typeof webkitAudioContext !== "undefined" ? webkitAudioContext : null);
  if (!Ctor) return null;
  try { audioCtx = new Ctor(); } catch (e) { audioCtx = null; }
  return audioCtx;
}

export function toggleSound() {
  soundOn = !soundOn;
  if (soundOn) ensureAudio();
  return soundOn;
}

export function beep(kind) {
  if (!soundOn) return false;
  const ctx = ensureAudio();
  if (!ctx) return false;
  const tone = TONES[kind];
  if (!tone) return false;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime;
    osc.type = "triangle";
    osc.frequency.setValueAtTime(tone[0], t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone[1]);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + tone[1] + 0.03);
    return true;
  } catch (e) {
    return false;
  }
}
