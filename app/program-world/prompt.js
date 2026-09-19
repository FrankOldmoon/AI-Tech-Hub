/* @deps: clipboard.js, config.js, dom.js */
import { copyToClipboard } from './clipboard.js'
import { LLM_PROMPT } from './config.js'
import { btnPrompt, on, promptClose, promptCopy, promptModal, promptState, promptText } from './dom.js'

/* =====================================================================
   The prompt tip next to Run game.

   An AI assistant writing pygame does not know that this runner owns the event
   loop, so it writes a synchronous loop that freezes the tab.  The modal shows
   the rules that fix that, ready to paste into any assistant — the text is
   config.js's LLM_PROMPT, so there is one copy to keep honest.
   ===================================================================== */

function open() {
  if (!promptModal) return
  setState('')
  promptModal.classList.add('show')
}

function close() {
  if (!promptModal) return
  promptModal.classList.remove('show')
  setState('')
}

function setState(text) {
  if (promptState) promptState.textContent = text
}

/* Nothing could reach the clipboard: put the text in the selection so a plain
   Ctrl/Cmd+C finishes the job. */
function selectAll() {
  if (!promptText) return
  try {
    const range = document.createRange()
    range.selectNodeContents(promptText)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  } catch { /* the reader can still select by hand */ }
  setState('Press Ctrl/Cmd+C')
}

export function initPrompt() {
  if (!promptModal) return
  if (promptText) promptText.textContent = LLM_PROMPT
  on(btnPrompt, 'click', open)
  on(promptClose, 'click', close)
  on(promptModal, 'click', (e) => { if (e.target === promptModal) close() })
  on(promptCopy, 'click', () => {
    copyToClipboard(LLM_PROMPT, () => {
      setState('Copied \u2713')
      setTimeout(() => setState(''), 1800)
    }, selectAll)
  })
  on(document, 'keydown', (e) => {
    if (!promptModal.classList.contains('show')) return
    if (e.key === 'Escape') { e.preventDefault(); close() }
  })
}
