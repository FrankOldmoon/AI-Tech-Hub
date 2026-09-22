/* @deps: dom.js */
import { on, panelExec, panelFlow, panelWorld, tabExec, tabFlow, tabWorld } from './dom.js'

/* =====================================================================
   The right-hand panels.

   They sit below the transport bar and share its column: Program World, the
   character stage the tracer animates; Execution, the step-by-step view of
   variables, call stack and output; and Flowchart, the control flow of the
   entry file.  Only one is on screen at a time.

   Elements are read through thunks because dom.js rebinds them on every
   boot() — the page may be left and re-entered.
   ===================================================================== */

const PANELS = [
  { name: 'world', tab: () => tabWorld, panel: () => panelWorld },
  { name: 'exec', tab: () => tabExec, panel: () => panelExec },
  { name: 'flow', tab: () => tabFlow, panel: () => panelFlow }
]

let current = 'world'

export function showPanel(name) {
  current = PANELS.some(p => p.name === name) ? name : 'world'
  for (const p of PANELS) {
    const active = p.name === current
    const tab = p.tab()
    const panel = p.panel()
    if (panel) panel.hidden = !active
    if (tab) {
      tab.classList.toggle('on', active)
      tab.setAttribute('aria-selected', String(active))
    }
  }
}

export function initPanels() {
  for (const p of PANELS) on(p.tab(), 'click', () => showPanel(p.name))
  showPanel('world')
}
