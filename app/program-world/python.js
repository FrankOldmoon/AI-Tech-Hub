/* @deps: dom.js */
import { setStatus } from './dom.js'

/* =====================================================================
   The Python runtime lives in a worker.

   Tracing is synchronous inside the interpreter, and the tracer only regains
   control on Python-level events — so a single heavy call
   (`sum(range(300_000_000))` produces no events at all) cannot be interrupted
   from Python.  Running it off the main thread means the page never freezes,
   and the timeout can do the one thing that always works: terminate the worker
   and start a clean one.

   The program's stdin rides along with the run message: the input box's lines
   are handed to the interpreter up front and consumed in order, so nothing has
   to block while the user types.
   ===================================================================== */

/* 由 hubs 自托管的 npm pyodide 产物（含示例用到的 wheel），见 sync-runtime-libs.mjs */
const VENDOR_INDEX = new URL('/model/vendor/pyodide/', document.baseURI).href
const WORKER_URL = new URL('./pyworker.js', import.meta.url).href

/* The tracer's own budget is 6s, but it only regains control on Python events:
   time.sleep or one huge expression produce none at all.  This watchdog is the
   backstop, so it sits just above the budget instead of far above it. */
const TRACE_TIMEOUT_MS = 7000

/* Loading a package is I/O, not the user's program: give it its own rope. */
const PACKAGE_TIMEOUT_MS = 45000

let worker = null
let ready = null
let seq = 0
let pending = null

/* the timer is re-armed between phases, so a slow download never eats the
   trace budget and a runaway trace never waits for a download timeout */
let rearm = () => {}

/* Files the program wrote or changed, handed to whoever wants them. */
let outputHandler = null

export function setOutputHandler(fn) { outputHandler = fn }

/* `print()` output as it happens, not once the trace is over: the worker sends
   every write while Python is still running (see pyworker.js). */
let streamHandler = null

export function setStreamHandler(fn) { streamHandler = fn }

/* Pictures the program drew (figures, frames, turtle strokes). */
let viewHandler = null

export function setViewHandler(fn) { viewHandler = fn }

function settle(kind, payload) {
  const p = pending
  if (!p) return
  pending = null
  clearTimeout(p.timer)
  if (kind === 'ok') p.resolve(payload)
  else p.reject(payload)
}

/* A failure that comes out of the worker rather than out of the traced program
   means the interpreter itself is suspect: pygame's SDL dies mid-import and
   pyodide then reports "Pyodide has suffered a fatal error", after which the
   runtime never answers again.  Drop it so the next run starts clean, instead
   of letting the next call sit until the watchdog fires. */
function poison() {
  ready = null
  if (worker) { worker.terminate(); worker = null }
}

/* The worker speaks three things: `status` for the runtime/run lifecycle, `out`
   for `print()` as it happens, and one `result` per run — carrying `data` or an
   `error`.  (Load requests go the other way as `load` / `run`.) */
function onMessage(ev) {
  const msg = ev.data || {}
  if (msg.type === 'status') {
    if (msg.state === 'ready') {
      if (ready) ready.resolve({ api: msg.api, python: msg.python })
    } else if (msg.state === 'fatal') {
      /* the interpreter itself died: it will never answer again */
      if (ready) ready.reject(new Error(msg.message || 'python failed'))
      poison()
    } else if (pending && pending.id === msg.id) {
      if (msg.state === 'packages') {
        setStatus('busy', 'Loading packages...')
        rearm(PACKAGE_TIMEOUT_MS, 'packages')
      } else {
        setStatus('busy', 'Tracing program...')
        rearm()
      }
    }
    return
  }
  if (msg.type === 'out') {
    if (streamHandler) {
      try { streamHandler(msg.text) } catch { /* the run still counts */ }
    }
    return
  }
  if (msg.type !== 'result') return
  if (msg.error) {
    settle('err', new Error(msg.error))
    poison() // a worker that failed a run may be in a bad state
    return
  }
  if (msg.produced && msg.produced.length && outputHandler) {
    try { outputHandler(msg.produced) } catch { /* the run still counts */ }
  }
  if (msg.data && msg.data.views && msg.data.views.length && viewHandler) {
    try { viewHandler(msg.data.views) } catch { /* the trace still counts */ }
  }
  settle('ok', msg.data)
}

function spawn() {
  worker = new Worker(WORKER_URL, { type: 'module' }) // pyodide rejects classic workers
  worker.onmessage = onMessage
  worker.onerror = (e) => {
    const err = new Error('Python worker failed: ' + (e && e.message ? e.message : 'unknown'))
    if (ready) ready.reject(err)
    settle('err', err)
    poison() // a dead worker must be rebuilt
  }
  let resolve, reject
  ready = { promise: new Promise((res, rej) => { resolve = res; reject = rej }), resolve: resolve, reject: reject }
  worker.postMessage({ type: 'load', indexURL: VENDOR_INDEX })
  return ready.promise
}

export function loadPython() {
  if (!ready) {
    setStatus('busy', 'Loading Python runtime...')
    spawn()
      .then(info => setStatus('ready', 'Python ' + (info.python || '?')
      + ' (Pyodide ' + info.api + ') ready'))
      .catch((e) => {
        console.error('python runtime failed:', (e && e.message) ? e.message : e)
        setStatus('error', 'Python runtime failed to load')
      })
  }
  return ready.promise
}

/* Giving the interpreter up on purpose: the game view runs Python on the main
   thread, and two whole runtimes — each with its own copy of every package —
   is more memory than one page should hold.  The next loadPython() spawns a
   fresh worker, which the browser's HTTP cache makes cheap. */
export function releasePython() {
  ready = null // a released worker cannot be reused
  const p = pending
  pending = null
  if (p) { clearTimeout(p.timer); p.reject(new Error('released')) }
  if (worker) { worker.terminate(); worker = null }
}

/* Runs the tracer over `src` in the worker.  Rejects with `timeout:<seconds>`
   when the budget runs out, in which case the runtime has already been
   restarted so the app stays usable. */
/* `source` is a project ({ files, entry }) or, for callers that only have one
   buffer, a plain string. */
function asProject(source) {
  if (typeof source === 'string') {
    return { files: [{ name: 'main.py', content: source }], entry: 'main.py' }
  }
  const p = source || {}
  return {
    files: (p.files || []).map(f => f.kind === 'bin'
      ? { name: f.name, bytes: f.bytes }
      : { name: f.name, content: f.content }),
    entry: p.entry || 'main.py'
  }
}

/* `stdin` is the whole input buffer, one line per `input()` call.  `interactive`
   lets the program ask for more lines than that: the run stops at the missing
   line and the caller re-runs with a longer buffer (see config.js). */
export function runTrace(source, tracer, timeoutMs, stdin, interactive) {
  const project = asProject(source)
  const limit = timeoutMs || TRACE_TIMEOUT_MS
  return loadPython().then(() => new Promise((resolve, reject) => {
    const id = ++seq
    const kill = (why) => {
      if (!pending || pending.id !== id) return
      const secs = Math.round((why === 'packages' ? PACKAGE_TIMEOUT_MS : limit) / 1000)
      ready = null // a killed worker cannot be reused
      if (worker) { worker.terminate(); worker = null }
      settle('err', new Error((why === 'packages' ? 'packages:' : 'timeout:') + secs))
    }
    rearm = function (ms, why) {
      if (!pending || pending.id !== id) return
      if (pending.timer) clearTimeout(pending.timer)
      pending.timer = setTimeout(() => kill(why), ms || limit)
    }
    pending = { id: id, timer: null, resolve: resolve, reject: reject }
    rearm()
    worker.postMessage({
      type: 'run', id: id, files: project.files, entry: project.entry, tracer: tracer,
      stdin: stdin == null ? '' : String(stdin),
      interactive: !!interactive
    })
  }))
}
