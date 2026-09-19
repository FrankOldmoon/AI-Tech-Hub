/* @deps: dom.js, python.js */
import {
  ioIn,
  ioOut,
  on,
  termClear,
  termClose,
  termFile,
  termIn,
  termModal,
  termOut,
  termPrompt,
  termSend
} from './dom.js'
import { setStreamHandler } from './python.js'

/* =====================================================================
   The program's I/O.

   Two boxes sit under the editor: the left one is the program's stdin — one
   line per `input()`, taken in order until they run out (then Python raises
   EOFError, exactly as a piped program would) — and the right one is read-only
   and shows what the program printed.  Nothing blocks: the lines are handed to
   the worker with the run, so no shared memory, no cross-thread wait and no
   special response headers are involved.

   Run terminal is the interactive one: the program runs, and when it reaches
   input() the terminal's own line lights up and waits for you, like a real
   terminal.  The worker cannot pause mid-run, so python.js answers that by
   re-running the program with the longer input buffer (see config.js); the
   output already on screen is skipped by character count, so the transcript
   keeps growing seamlessly instead of repeating itself.

   Output arrives as it is printed either way, because the worker forwards every
   write while Python is running.
   ===================================================================== */

let mode = 'inline'
const text = { inline: '', terminal: '' }

let pendingLine = null /* { resolve } while the terminal waits for a line */
let shown = 0 /* terminal: program characters already on screen */
let skip = 0 /* terminal: leading characters of this attempt to drop */

/* The inline box is capped; the terminal is not, so its skip count stays exact. */
const INLINE_LIMIT = 200000

export function stdinText() {
  return ioIn ? ioIn.value : ''
}

function render() {
  if (mode === 'terminal') {
    if (!termOut) return
    termOut.textContent = text.terminal
    termOut.scrollTop = termOut.scrollHeight
    return
  }
  if (!ioOut) return
  ioOut.value = text.inline
  ioOut.scrollTop = ioOut.scrollHeight
}

/* Called for every streamed chunk, while the program runs. */
export function write(chunk) {
  let s = String(chunk == null ? '' : chunk)
  if (!s) return
  if (mode === 'terminal') {
    /* a re-run repeats everything already displayed — drop that much of it */
    if (skip > 0) {
      if (s.length <= skip) { skip -= s.length; return }
      s = s.slice(skip)
      skip = 0
    }
    text.terminal += s
    shown += s.length
  } else {
    let next = text.inline + s
    if (next.length > INLINE_LIMIT) next = next.slice(next.length - INLINE_LIMIT)
    text.inline = next
  }
  render()
}

/* -------------------------------- session ------------------------------ */

export function beginSession() {
  text[mode] = ''
  if (mode === 'terminal') {
    shown = 0
    skip = 0
    enableTermInput(false)
  }
  render()
}

/* A re-run of the same program with one more line of input. */
export function beginAttempt() {
  if (mode === 'terminal') skip = shown
}

/* Output already arrived as it was printed, so finishing only has to add the
   failure the trace collected. */
export function finishSession(errText) {
  if (errText) write('\n' + errText + '\n')
  render()
}

export function clearIo() {
  text.inline = ''
  text.terminal = ''
  shown = 0
  skip = 0
  render()
}

/* ------------------------------- input() ------------------------------- */

function enableTermInput(on_, placeholder) {
  if (!termIn) return
  termIn.disabled = !on_
  if (termSend) termSend.disabled = !on_
  termIn.placeholder = on_
    ? (placeholder || 'input \u2014 press Enter')
    : 'Press Run terminal \u2014 input() is typed here'
  if (on_) {
    try { termIn.focus() } catch { /* ignore */ }
  }
}

function echo(line) {
  text.terminal += line + '\n'
  render()
}

function closeLine(value) {
  if (!pendingLine) return
  const done = pendingLine
  pendingLine = null
  enableTermInput(false)
  done(value)
}

function submitLine() {
  if (!pendingLine) return
  const line = termIn ? termIn.value : ''
  if (termIn) termIn.value = ''
  echo(line)
  closeLine(line)
}

/* The program is waiting for a line: light up the terminal's input and hand back
   a promise that resolves when the reader submits (or null if they close it). */
export function awaitLine(promptText) {
  if (termModal) termModal.classList.add('show')
  if (termPrompt) termPrompt.textContent = '$'
  enableTermInput(true, promptText)
  return new Promise(function (resolve) { pendingLine = resolve })
}

/* -------------------------------- terminal ----------------------------- */

export function openTerminal(fileName) {
  if (termFile) termFile.textContent = fileName || 'main.py'
  if (termModal) termModal.classList.add('show')
  mode = 'terminal'
  text.terminal = ''
  shown = 0
  skip = 0
  enableTermInput(false)
  render()
}

export function closeTerminal() {
  closeLine(null)
  if (termModal) termModal.classList.remove('show')
  mode = 'inline'
  render()
}

/* --------------------------------- boot -------------------------------- */

export function initIo() {
  on(termIn, 'keydown', function (e) {
    if (!pendingLine) return
    if (e.key === 'Enter') { e.preventDefault(); submitLine(); return }
    if (e.key === 'Escape') { e.preventDefault(); closeLine(null) }
  })
  on(termSend, 'click', submitLine)
  on(termClose, 'click', closeTerminal)
  on(termClear, 'click', function () { text.terminal = ''; render() })
  on(termModal, 'click', function (e) { if (e.target === termModal) closeTerminal() })
  on(document, 'keydown', function (e) {
    if (pendingLine || mode !== 'terminal') return
    if (!termModal || !termModal.classList.contains('show')) return
    if (e.key === 'Escape') { e.preventDefault(); closeTerminal() }
  })

  setStreamHandler(write)
  clearIo()
}
