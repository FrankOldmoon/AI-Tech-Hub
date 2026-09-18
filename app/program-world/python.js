/* @deps: dom.js */
import { setStatus } from './dom.js'
import {
  ANSWER_OFFSET,
  PROMPT_OFFSET,
  STDIN_ANSWER,
  STDIN_ANSWER_LEN,
  STDIN_EOF,
  STDIN_PROMPT_LEN,
  STDIN_STATE,
  STDIN_WAIT,
  TEXT_LIMIT,
  createStdinBuffers,
  getText,
  putText
} from './stdin.js'

/* =====================================================================
   The Python runtime lives in a worker.

   Tracing is synchronous inside the interpreter, and the tracer only regains
   control on Python-level events — so a single heavy call
   (`sum(range(300_000_000))` produces no events at all) cannot be interrupted
   from Python.  Running it off the main thread means the page never freezes,
   and the timeout can do the one thing that always works: terminate the worker
   and start a clean one.
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

/* =====================================================================
   `input()` 的桥（主线程这一侧）

   worker 里没有 prompt，所以 Python 的 input() 必须由主线程来回答。worker
   在共享内存里放下提示语后挂起（Atomics.wait），这里轮询到就弹输入框，
   把值写回去再唤醒它。worker 挂起的这段时间**必须停表**：用户在慢慢想，
   不是程序跑得久 —— 否则 7s 看门狗会把这次运行当成超时杀掉。
   ===================================================================== */
let stdinBuffers = null
let stdinWatch = null

function stopStdinWatch() {
  if (!stdinWatch) return
  clearInterval(stdinWatch)
  stdinWatch = null
}

function startStdinWatch() {
  if (stdinWatch || !stdinBuffers) return
  const ctrl = new Int32Array(stdinBuffers.control)
  /* 用轮询而不是 Atomics.waitAsync：只有 worker 挂起的那一段需要响应，
     40ms 的间隔手感上察觉不到，也省掉一套 promise 重排的维护成本。 */
  stdinWatch = setInterval(function () {
    if (Atomics.load(ctrl, STDIN_STATE) !== STDIN_WAIT) return
    answerStdin(ctrl, stdinBuffers.text)
  }, 40)
}

function answerStdin(ctrl, text) {
  stopStdinWatch()
  // 先停表再弹框
  if (pending && pending.timer) {
    clearTimeout(pending.timer)
  }

  const asked = getText(text, PROMPT_OFFSET, Atomics.load(ctrl, STDIN_PROMPT_LEN))
  let line = null
  try {
    line = window.prompt(asked || 'input()', '')
  } catch {
    // 弹框被浏览器策略拦下：按用户取消处理，走下面的 EOF 分支
  }

  if (line === null || line === undefined) {
    // 取消按 Ctrl+C 处理：Python 侧抛 EOFError
    Atomics.store(ctrl, STDIN_STATE, STDIN_EOF)
  } else {
    Atomics.store(ctrl, STDIN_ANSWER_LEN, putText(text, ANSWER_OFFSET, line, TEXT_LIMIT))
    Atomics.store(ctrl, STDIN_STATE, STDIN_ANSWER)
  }
  Atomics.notify(ctrl, STDIN_STATE)

  if (pending) rearm()
  startStdinWatch()
}

/* Files the program wrote or changed, handed to whoever wants them. */
let outputHandler = null

export function setOutputHandler(fn) { outputHandler = fn }

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
  stopStdinWatch()
  if (worker) { worker.terminate(); worker = null }
}

function onMessage(ev) {
  const msg = ev.data || {}
  if (msg.type === 'ready') {
    if (ready) ready.resolve({ api: msg.api, python: msg.python })
  } else if (msg.type === 'failed') {
    const err = new Error(msg.message || 'python failed')
    if (!msg.id) {
      // the runtime itself failed
      if (ready) ready.reject(err)
      poison()
    } else {
      settle('err', err)
      poison()
    }
  } else if (msg.type === 'phase') {
    if (!pending || pending.id !== msg.id) return
    if (msg.phase === 'packages') {
      setStatus('busy', 'Loading packages...')
      rearm(PACKAGE_TIMEOUT_MS, 'packages')
    } else {
      setStatus('busy', 'Tracing program...')
      rearm()
    }
  } else if (msg.type === 'result') {
    if (msg.produced && msg.produced.length && outputHandler) {
      try { outputHandler(msg.produced) } catch { /* the run still counts */ }
    }
    if (msg.data && msg.data.views && msg.data.views.length && viewHandler) {
      try { viewHandler(msg.data.views) } catch { /* the trace still counts */ }
    }
    settle('ok', msg.data)
  }
}

function spawn() {
  stdinBuffers = createStdinBuffers()
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
  worker.postMessage({ type: 'load', indexURL: VENDOR_INDEX, stdin: stdinBuffers })
  startStdinWatch()
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
  stopStdinWatch()
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

export function runTrace(source, tracer, timeoutMs) {
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
    worker.postMessage({ type: 'run', id: id, files: project.files, entry: project.entry, tracer: tracer })
  }))
}
