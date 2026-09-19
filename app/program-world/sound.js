/* @deps: none */
let audioCtx = null
let soundOn = false

/* 每种逐步动画都有自己的声音：create/change/retire 是角色的生死，combat 是条件
   对战，cond/loop/call/ret/ctl/bag 是那些没有角色变化的步骤（否则它们全程静音），
   flow/ref 是「值从别处流过来」。 */
export const TONES = {
  create: [660, 0.07],
  change: [430, 0.05],
  retire: [300, 0.09],
  combat: [180, 0.14],
  output: [880, 0.06],
  error: [140, 0.32],
  cond: [520, 0.08],
  loop: [600, 0.05],
  call: [740, 0.06],
  ret: [500, 0.07],
  ctl: [900, 0.05],
  bag: [640, 0.05],
  flow: [820, 0.05],
  ref: [1000, 0.07]
}

export function soundEnabled() { return soundOn }

function ensureAudio() {
  if (audioCtx) return audioCtx
  const Ctor = typeof AudioContext !== 'undefined'
    ? AudioContext
    : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null)
  if (!Ctor) return null
  try { audioCtx = new Ctor() } catch { audioCtx = null }
  return audioCtx
}

export function toggleSound() {
  soundOn = !soundOn
  if (soundOn) ensureAudio()
  return soundOn
}

export function beep(kind) {
  if (!soundOn) return false
  const ctx = ensureAudio()
  if (!ctx) return false
  const tone = TONES[kind]
  if (!tone) return false
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const t0 = ctx.currentTime
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(tone[0], t0)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone[1])
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + tone[1] + 0.03)
    return true
  } catch {
    return false
  }
}
