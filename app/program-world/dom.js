/* @deps: none */
/* ---------------------------------------------------------------------
   Element bindings.

   The standalone page resolved every element once, at import time, because
   the document belonged to it and was never re-created.  Inside the hub the
   page can be left and re-entered, so the bindings are (re)established by
   bindDom(root) on every boot instead.  Importers keep their named imports:
   an ES module live binding means each read sees the node that is current
   at the moment of use, not the one that was current at import time.
   --------------------------------------------------------------------- */
let root = null

/* getElementById only exists on Document/DocumentFragment, not on Element, so a
   scoped lookup has to go through querySelector.  Every id in the app is a plain
   identifier, so the "#id" form needs no escaping. */
export const $ = id => (root ? root.querySelector('#' + id) : document.getElementById(id))

export let statusEl = null, statusText = null
export let btnRun = null, btnStep = null, btnPlay = null, btnReset = null, examplePick = null
export let btnGame = null, btnGameStop = null, btnGameExit = null
export let stageEl = null, gameCanvas = null, gameOut = null, gameMsg = null
export let btnShare = null
export let btnSound = null
export let btnFirst = null, btnPrev = null, btnNext = null, btnLast = null
export let scrub = null, speedSel = null, stepPill = null, framePill = null
export let drawer = null, drawerHead = null, drawerMeta = null
export let nowLn = null, nowCode = null, nowMeta = null
export let varsEl = null, varCount = null, framesEl = null, stdoutEl = null, errBox = null
export let staleEl = null
export let mainEl = null, splitterEl = null
export let wtopEl = null, arenaEl = null, outSlotEl = null, worldIdleEl = null
export let vsLayerEl = null
export let draftStateEl = null
export let timelineEl = null

export function bindDom(el) {
  root = el || null
  statusEl = $('status'); statusText = $('statusText')
  btnRun = $('btnRun'); btnStep = $('btnStep'); btnPlay = $('btnPlay'); btnReset = $('btnReset'); examplePick = $('examplePick')
  btnGame = $('btnGame'); btnGameStop = $('btnGameStop'); btnGameExit = $('btnGameExit')
  stageEl = $('stage'); gameCanvas = $('gameCanvas'); gameOut = $('gameOut'); gameMsg = $('gameMsg')
  btnShare = $('btnShare')
  btnSound = $('btnSound')
  btnFirst = $('btnFirst'); btnPrev = $('btnPrev'); btnNext = $('btnNext'); btnLast = $('btnLast')
  scrub = $('scrub'); speedSel = $('speed'); stepPill = $('stepPill'); framePill = $('framePill')
  drawer = $('drawer'); drawerHead = $('drawerHead'); drawerMeta = $('drawerMeta')
  nowLn = $('nowLn'); nowCode = $('nowCode'); nowMeta = $('nowMeta')
  varsEl = $('vars'); varCount = $('varCount'); framesEl = $('frames'); stdoutEl = $('stdout'); errBox = $('errBox')
  staleEl = $('stale')
  mainEl = $('main'); splitterEl = $('splitter')
  wtopEl = $('wtop'); arenaEl = $('arena'); outSlotEl = $('outSlot'); worldIdleEl = $('worldIdle')
  vsLayerEl = $('vsLayer')
  draftStateEl = $('draftState')
  timelineEl = $('timeline')
}

/* Listeners on document/window outlive the page's own DOM, so they are
   registered through on() and dropped again by unbindAll() on unmount. */
const listeners = []

export function on(target, type, fn, opts) {
  if (!target) return
  target.addEventListener(type, fn, opts)
  listeners.push([target, type, fn, opts])
}

export function unbindAll() {
  for (const [t, type, fn, opts] of listeners.splice(0)) {
    try { t.removeEventListener(type, fn, opts) } catch { /* ignore */ }
  }
}

export function setStatus(kind, text) {
  statusEl.className = 'status' + (kind ? ' ' + kind : '')
  statusText.textContent = text
}
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]))
}
export function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s }
