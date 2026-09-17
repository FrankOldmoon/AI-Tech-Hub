/* @deps: dom.js, state.js */
import { $, drawer, drawerHead, mainEl, on, splitterEl } from './dom.js'
import { editor } from './state.js'

/* ---------------------------------------------------------------------
   Splitters and the execution drawer.

   What used to be two import-time IIFEs plus a few module-level constants is
   now initLayout(), called from boot(): it needs the page's elements to be in
   the document, and it has to be able to set itself up again after the page
   has been left and re-entered.  The drag listeners live on document/window,
   so they go through on() and are dropped by unbindAll() on unmount.
   --------------------------------------------------------------------- */

const SPLIT_KEY = 'pw.split3'
const DRAWER_KEY = 'pw.drawerH3'
const DRAWER_MIN = 44

let drawerRatio = 0.54
let leftPane = null
let hsplitEl = null

function relayoutEditor() {
  if (editor) editor.layout()
  setTimeout(() => { if (editor) editor.layout() }, 0)
}

function setDrawerCollapsed() {
  drawer.classList.remove('open')
  leftPane.style.setProperty('--drawer-h', DRAWER_MIN + 'px')
  drawerHead.setAttribute('aria-expanded', 'false')
  relayoutEditor()
}

export function setDrawerOpen(ratio) {
  if (ratio) drawerRatio = ratio
  drawer.classList.add('open')
  leftPane.style.setProperty('--drawer-h', (drawerRatio * 100).toFixed(2) + '%')
  drawerHead.setAttribute('aria-expanded', 'true')
  relayoutEditor()
}

export function initLayout() {
  leftPane = mainEl.querySelector('.left')
  hsplitEl = $('hsplit')

  /* ---------------------------- splitters ------------------------------ */
  try {
    const saved = parseFloat(localStorage.getItem(SPLIT_KEY))
    if (saved > 0.2 && saved < 0.75) mainEl.style.setProperty('--right', (saved * 100) + '%')
  } catch { /* ignore */ }
  let dragging = false
  function onMove(e) {
    if (!dragging) return
    const r = mainEl.getBoundingClientRect()
    const px = r.right - e.clientX
    const min = 320, max = r.width * 0.72
    const w = Math.max(min, Math.min(max, px))
    mainEl.style.setProperty('--right', w + 'px')
    try { localStorage.setItem(SPLIT_KEY, String(w / r.width)) } catch { /* ignore */ }
    if (editor) editor.layout()
  }
  function stop() {
    if (!dragging) return
    dragging = false
    splitterEl.classList.remove('dragging')
    mainEl.classList.remove('dragging')
    if (editor) editor.layout()
  }
  on(splitterEl, 'mousedown', (e) => {
    dragging = true
    splitterEl.classList.add('dragging')
    mainEl.classList.add('dragging')
    e.preventDefault()
  })
  on(document, 'mousemove', onMove)
  on(document, 'mouseup', stop)
  on(splitterEl, 'dblclick', () => {
    mainEl.style.setProperty('--right', '46%')
    try { localStorage.setItem(SPLIT_KEY, '0.46') } catch { /* ignore */ }
    if (editor) editor.layout()
  })

  /* ------------------------- execution drawer -------------------------- */
  try {
    const s = parseFloat(localStorage.getItem(DRAWER_KEY))
    if (s > 0.1 && s < 0.85) drawerRatio = s
  } catch { /* ignore */ }

  on(drawerHead, 'click', () => {
    if (drawer.classList.contains('open')) setDrawerCollapsed(); else setDrawerOpen()
  })

  let draggingV = false
  function onMoveV(e) {
    if (!draggingV) return
    const r = leftPane.getBoundingClientRect()
    if (!r.height) return
    const maxH = Math.max(DRAWER_MIN + 60, r.height - 140)
    const h = Math.max(DRAWER_MIN, Math.min(maxH, r.bottom - e.clientY))
    if (h <= 64) { setDrawerCollapsed(); return }
    drawerRatio = h / r.height
    try { localStorage.setItem(DRAWER_KEY, String(drawerRatio)) } catch { /* ignore */ }
    setDrawerOpen(drawerRatio)
  }
  on(hsplitEl, 'mousedown', (e) => {
    draggingV = true
    hsplitEl.classList.add('dragging')
    mainEl.classList.add('rowdragging')
    e.preventDefault()
  })
  on(document, 'mousemove', onMoveV)
  on(document, 'mouseup', () => {
    if (!draggingV) return
    draggingV = false
    hsplitEl.classList.remove('dragging')
    mainEl.classList.remove('rowdragging')
    relayoutEditor()
  })
  on(hsplitEl, 'dblclick', () => {
    if (drawer.classList.contains('open')) setDrawerCollapsed(); else setDrawerOpen()
  })

  on(window, 'resize', () => {
    if (drawer.classList.contains('open')) {
      leftPane.style.setProperty('--drawer-h', (drawerRatio * 100).toFixed(2) + '%')
    }
    relayoutEditor()
  })
}
