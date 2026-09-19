/* @deps: dom.js */
import { on, panelExec, panelWorld, tabExec, tabWorld } from './dom.js'

/* =====================================================================
   The two right-hand panels.

   They sit below the transport bar and share its column: Program World, the
   character stage the tracer animates, and Execution, the step-by-step view of
   variables, call stack and output that used to live in a drawer under the
   editor.  Only one is on screen at a time.
   ===================================================================== */

let current = 'world'

export function showPanel(name) {
  current = name === 'exec' ? 'exec' : 'world'
  const exec = current === 'exec'
  if (panelWorld) panelWorld.hidden = exec
  if (panelExec) panelExec.hidden = !exec
  if (tabWorld) {
    tabWorld.classList.toggle('on', !exec)
    tabWorld.setAttribute('aria-selected', String(!exec))
  }
  if (tabExec) {
    tabExec.classList.toggle('on', exec)
    tabExec.setAttribute('aria-selected', String(exec))
  }
}

export function initPanels() {
  on(tabWorld, 'click', () => showPanel('world'))
  on(tabExec, 'click', () => showPanel('exec'))
  showPanel('world')
}
