/* ============================================================================
   Test adapters.

   The application code is imported as ES modules — the real thing, not a
   re-implementation — and the DOM underneath is the real one: the app's own
   markup, its own CSS and real elements.  Nothing here fakes tree, class,
   attribute, layout or event semantics.

   Three observation seams are installed on purpose:

     1. the clock — requestAnimationFrame / performance.now are replaced by a
        manually advanced queue so tween / typewriter assertions stay
        synchronous and deterministic (ordinary fake-timer practice);

     2. Element.prototype.animate — recorded instead of started, so a test can
        read the keyframes back and "settle" an animation without real time;

     3. Monaco — a stub is wired in through the real `attachEditor`, so the
        editor plumbing (decorations, hover line) is exercised against the real
        code path instead of a hand-rolled replacement.

   `_cls`, `attrs` and `animations` are read-through views onto the real DOM.
   ========================================================================== */
import * as configMod from '../../app/program-world/config.js'
import * as urlsMod from '../../app/program-world/url-code.js'
import * as soundMod from '../../app/program-world/sound.js'
import * as domMod from '../../app/program-world/dom.js'
import * as stateMod from '../../app/program-world/state.js'
import * as editorMod from '../../app/program-world/editor.js'
import * as analysisMod from '../../app/program-world/analysis.js'
import * as renderMod from '../../app/program-world/render.js'
import * as draftMod from '../../app/program-world/draft.js'

/* ------------------------------ controllable clock ------------------------ */
var __now = 0
var __rafQ = []
var __rafId = 0
window.requestAnimationFrame = function (fn) { __rafId += 1; __rafQ.push({ id: __rafId, fn: fn }); return __rafId }
window.cancelAnimationFrame = function (id) { __rafQ = __rafQ.filter(function (r) { return r.id !== id }) }
try {
  performance.now = function () { return __now }
} catch {
  Object.defineProperty(performance, 'now', { value: function () { return __now }, configurable: true })
}
function tick(ms) {
  __now += ms
  const q = __rafQ
  __rafQ = []
  for (const r of q) r.fn(__now)
}
function pendingFrames() { return __rafQ.length }

/* --------------------------- animation recorder --------------------------- */
const __animStore = new WeakMap()
function __recList(el) {
  let list = __animStore.get(el)
  if (!list) { list = []; __animStore.set(el, list) }
  return list
}
Element.prototype.animate = function (keyframes, options) {
  const rec = { keyframes: keyframes, options: options, cancelled: false, done: false, _h: null }
  rec.finished = {
    then(ok, err) {
      rec._h = { ok: ok, err: err }
      if (rec.cancelled) { if (err) err() } else if (rec.done) { if (ok) ok() }
      return rec.finished
    },
    catch(err) { return rec.finished.then(undefined, err) },
    finally(fn) { return rec.finished.then(function () { fn() }, function () { fn() }) }
  }
  rec.cancel = function () { rec.cancelled = true; if (rec._h && rec._h.err) rec._h.err() }
  rec.settle = function () { if (rec.cancelled) return; rec.done = true; if (rec._h && rec._h.ok) rec._h.ok() }
  __recList(this).push(rec)
  return rec
}

/* ------------------------ read-through DOM views -------------------------- */
Object.defineProperty(Element.prototype, '_cls', {
  get() {
    const el = this
    return { has: function (c) { return el.classList.contains(c) } }
  }
})
Object.defineProperty(Element.prototype, 'attrs', {
  get() {
    const el = this
    return new Proxy(Object.create(null), {
      get: function (_t, k) { return typeof k === 'string' ? el.getAttribute(k) : undefined },
      has: function (_t, k) { return typeof k === 'string' && el.hasAttribute(k) }
    })
  }
})
Object.defineProperty(Element.prototype, 'animations', {
  get() { return __recList(this) },
  set(v) {
    if (v && v.length) throw new Error('`el.animations` is a read view; tests may only clear it with []')
    __animStore.set(this, [])
  }
})

/* ----------------------------- scroll spy --------------------------------- */
const __focusCalls = []
const __realScrollIntoView = Element.prototype.scrollIntoView
Element.prototype.scrollIntoView = function (opts) {
  __focusCalls.push({ el: this, opts: opts })
  __realScrollIntoView.apply(this, arguments)
}

/* ------------------------------- audio spy -------------------------------- */
/* beep() gives every step its own sound.  Recording the oscillator frequency
   lets a test assert *which* tone a step played without any real audio, and it
   has to be installed before any module can cache a context. */
const __tones = []
function __RecOsc() {
  this.type = 'triangle'
  this.frequency = { setValueAtTime: (f) => { __tones.push(f) } }
  this.connect = function () { return this }
  this.start = function () {}
  this.stop = function () {}
}
function __RecGain() {
  return {
    gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect() { return this }
  }
}
function __RecAC() {
  return { currentTime: 0, destination: {}, createOscillator: () => new __RecOsc(), createGain: () => __RecGain() }
}
Object.defineProperty(window, 'AudioContext', { value: __RecAC, configurable: true, writable: true })
Object.defineProperty(window, 'webkitAudioContext', { value: __RecAC, configurable: true, writable: true })
function clearTones() { __tones.length = 0 }

/* --------------------- freeze the state animations ------------------------ */
/* .created / .changed / the retiry ghost drive CSS keyframe animations, and
   getBoundingClientRect() reflects their in-flight transform.  These tests
   measure layout and the JS-driven FLIP, so leaving them running would make
   geometry assertions depend on wall-clock timing. */
const __freeze = document.createElement('style')
__freeze.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}'
document.head.appendChild(__freeze)
domMod.worldIdleEl.style.display = 'none'

/* --------------------- editor stand-in (real wiring) ---------------------- */
let srcText = configMod.SAMPLE
export function setSource(text) { srcText = String(text) }

export const decoCalls = { main: [], hover: [] }
let __decoN = 0
const stubMonaco = {
  Range: function (a, b, c, d) { this.parts = [a, b, c, d] },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { Enter: 3 },
  editor: { ScrollType: { Smooth: 0 } }
}
const stubEditor = {
  createDecorationsCollection: function () {
    const slot = __decoN++ === 0 ? 'main' : 'hover'
    return {
      set: function (arr) {
        const box = decoCalls[slot]
        box.length = 0
        for (const x of arr) box.push(x)
      }
    }
  },
  onDidChangeModelContent: function () {},
  addCommand: function () {},
  layout: function () {},
  revealLineInCenterIfOutsideViewport: function () {},
  setValue: function (v) { srcText = String(v) },
  getModel: function () {
    const lines = srcText.split('\n')
    return {
      getValue: function () { return srcText },
      getLineCount: function () { return lines.length },
      getLineContent: function (n) { return lines[n - 1] }
    }
  }
}
editorMod.attachEditor(stubEditor, stubMonaco, { onRun: function () {}, onEdit: function () {} })

/* browser-side base64 for UTF-8 text (these tests used Node's Buffer before) */
function encB64(s, urlSafe) {
  const bytes = new TextEncoder().encode(String(s))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const out = btoa(bin)
  return urlSafe ? out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : out
}

/* ------------------------------ helpers ----------------------------------- */
function rectOf(el) {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top }
}
function movedBy(before, el) {
  const r = el.getBoundingClientRect()
  return { x: before.x - r.left, y: before.y - r.top }
}
function parsedFlip(f) {
  if (!f) return null
  const p = String(f).replace(/px/g, ' ').trim().split(/\s+/)
  return { x: parseFloat(p[0]) || 0, y: parseFloat(p[1]) || 0 }
}
function movedMatches(f, d) {
  const p = parsedFlip(f)
  if (!p) return false
  return Math.abs(p.x - d.x) < 0.6 && Math.abs(p.y - d.y) < 0.6
}
function roomEls() { return Array.from(domMod.arenaEl.children).filter(function (e) { return e.classList.contains('room') }) }
function bodyOf(room) { return room.querySelector('.room-body') }
function actorEls() {
  const out = []
  for (const e of Array.from(domMod.arenaEl.children)) {
    if (!e.classList.contains('room')) { out.push(e); continue }
    const b = bodyOf(e)
    if (b) for (const a of Array.from(b.children)) out.push(a)
  }
  return out
}
function inFlow() { return actorEls().filter(function (e) { return e.style.position !== 'absolute' }).length }
function clearAnims() { for (const e of actorEls()) e.animations = [] }
function flipOf(el) {
  for (const a of el.animations) {
    if (a.keyframes.length === 2 && a.keyframes[0].translate !== undefined
      && a.keyframes[1].translate !== undefined && a.keyframes[0].opacity === undefined) {
      return a.keyframes[0].translate
    }
  }
  return null
}
function exitOf(el) {
  for (const a of el.animations) {
    const last = a.keyframes[a.keyframes.length - 1]
    if (last && last.opacity === 0) return a
  }
  return null
}
function totalAnims() { let n = 0; for (const e of actorEls()) n += e.animations.length; return n }
function deltaOf(el) { for (const c of Array.from(el.children)) if (c.classList.contains('delta')) return c; return null }

/* ------------------------------ assertions -------------------------------- */
export const summary = { ok: 0, fail: 0, fails: [] }
function ok(m) { summary.ok++; console.log('ok   ' + m) }
function bad(m) { summary.fail++; summary.fails.push(m); console.log('FAIL ' + m) }
function eq(actual, want, label) {
  if (actual === want) ok(label + ' -> ' + actual)
  else bad(label + ' expected [' + want + '] got [' + actual + ']')
}
function mk(id, name, value) {
  return { id: id, name: name, value: value, type: 'int', avatar: 'A', numeric: parseFloat(value), bar: 10 }
}
function scene(chars) { return { chars: chars, output: '' } }

/* ------------------------------- the bridge ------------------------------- */
/* The ported assertions predate the module split and use bare names, so the
   module surface is re-exposed as globals with live getters.  This is test
   glue only: every read still goes straight to the module binding. */
function expose(ns) {
  for (const key of Object.keys(ns)) {
    if (key in globalThis) continue
    Object.defineProperty(globalThis, key, { get: () => ns[key], configurable: true })
  }
}
expose(configMod); expose(urlsMod); expose(soundMod); expose(domMod)
expose(stateMod); expose(editorMod); expose(analysisMod); expose(renderMod); expose(draftMod)

const local = {
  rectOf: rectOf, movedBy: movedBy, parsedFlip: parsedFlip, movedMatches: movedMatches,
  roomEls: roomEls, bodyOf: bodyOf, actorEls: actorEls, inFlow: inFlow, clearAnims: clearAnims,
  flipOf: flipOf, exitOf: exitOf, totalAnims: totalAnims, deltaOf: deltaOf,
  tick: tick, pendingFrames: pendingFrames, mk: mk, scene: scene,
  ok: ok, bad: bad, eq: eq, encB64: encB64,
  setSource: setSource, decoCalls: decoCalls, __focusCalls: __focusCalls,
  tones: __tones, clearTones: clearTones,
  summary: summary
}
for (const key of Object.keys(local)) {
  Object.defineProperty(globalThis, key, { value: local[key], writable: true, configurable: true })
}
Object.defineProperty(globalThis, 'fails', { get: () => summary.fail, configurable: true })
Object.defineProperty(globalThis, 'passes', { get: () => summary.ok, configurable: true })
Object.defineProperty(globalThis, 'failLines', { get: () => summary.fails, configurable: true })
