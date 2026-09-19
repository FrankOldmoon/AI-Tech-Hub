/* @deps: dom.js, state.js */
import { mainEl, on, splitterEl } from './dom.js'
import { editor } from './state.js'

/* ---------------------------------------------------------------------
   The splitter between the editor and the stage.

   What used to be two import-time IIFEs plus a few module-level constants is
   now initLayout(), called from boot(): it needs the page's elements to be in
   the document, and it has to be able to set itself up again after the page
   has been left and re-entered.  The drag listeners live on document/window,
   so they go through on() and are dropped by unbindAll() on unmount.

   There is only one splitter left: the vertical one between the two panes.
   The editor's own I/O boxes are a fixed bar under it, so nothing else needs
   dragging.
   --------------------------------------------------------------------- */

const SPLIT_KEY = 'pw.split3'

function relayoutEditor() {
  if (editor) editor.layout()
  setTimeout(() => { if (editor) editor.layout() }, 0)
}

export function initLayout() {
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

  on(window, 'resize', relayoutEditor)
}
