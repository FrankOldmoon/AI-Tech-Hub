/* =====================================================================
   Python worker  (module worker on purpose)

   pyodide's own environment check throws "Classic web workers are not
   supported", so this must be a module worker (`importScripts` unavailable).
   The vendored build is a UMD bundle that installs a global `loadPyodide` as a
   side effect of being evaluated, so it is pulled in with a dynamic import and
   falls back to evaluating the fetched source if that does not take.

   The main thread passes absolute URLs: a worker resolves relative paths
   against its own script location, not the page's.

   Note: real pygame cannot run here.  emscripten's SDL reaches for `screen`,
   `document` and a canvas at import time, and a worker has none of them; the
   offscreen surface path needs SDL's video subsystem to come up first.  The
   turtle shim in pylib exists for exactly this reason.

   Messages (main → worker): `load` warms the runtime, `run` traces a project.
   Messages (worker → main), three kinds and no more:
     { type:'status', state:'ready'|'fatal'|'packages'|'running', ... }
     { type:'out', text }                       -- print() as it happens
     { type:'result', id, data?, produced?, error? }   -- one reply per run
   ===================================================================== */
/* =====================================================================
   ⚠️ 本文件必须保持**零 import / 零 export 依赖**。

   它不是一个被 Rollup 当入口打包的模块：python.js 里用的是
   `new URL('./pyworker.js', import.meta.url)`，Vite 把它当**静态资源原样拷贝**
   （产物形如 _nuxt/pyworker.<hash>.js，连源码里的注释都原封不动），不会内联它的依赖。
   所以这里只要写下 `import ... from './io.js'`，生产环境就会 404：
   `/_nuxt/io.js` 根本不存在 —— dev 之所以看不出来，是因为 Vite 在 dev 里按需
   转译，相对导入能被解析。

   tests/program-world-worker.test.ts 钉住了「本文件不得出现 import」这条约束。
   ===================================================================== */

let runtime = null

/* The project lives in pyodide's in-memory filesystem, so `import helper` and
   `open("data.txt")` behave exactly as they would on disk. */
const DIR = '/project'

/* Small helpers the runner needs inside the interpreter (turtle, and the code
   that collects what a program drew).  They live outside the project so they
   never show up in the file list and never count against its size. */
const PYLIB = '/pwlib'
const PYLIB_FILES = ['pwviews.py', 'turtle.py']

function removePath(FS, p) {
  let st
  try { st = FS.stat(p) } catch { return }
  if (FS.isDir(st.mode)) {
    try { FS.readdir(p).forEach((n) => { if (n !== '.' && n !== '..') removePath(FS, p + '/' + n) }) } catch { /* ignore */ }
    try { FS.rmdir(p) } catch { /* ignore */ }
  } else {
    try { FS.unlink(p) } catch { /* ignore */ }
  }
}

function syncFs(py, files) {
  const FS = py.FS
  try { FS.mkdir(DIR) } catch { /* ignore */ }
  try {
    FS.readdir(DIR).forEach((n) => { if (n !== '.' && n !== '..') removePath(FS, DIR + '/' + n) })
  } catch { /* ignore */ }
  (files || []).forEach(function (f) {
    if (!f || typeof f.name !== 'string') return
    const body = f.bytes ? f.bytes : String(f.content == null ? '' : f.content)
    FS.writeFile(DIR + '/' + f.name, body)
  })
}

async function ensurePylib(py) {
  if (py.$pwlib) return
  const base = new URL('/program-world/pylib/', self.location.href).href
  try { py.FS.mkdir(PYLIB) } catch { /* ignore */ }
  for (const name of PYLIB_FILES) {
    try {
      const res = await fetch(base + name)
      if (!res.ok) continue
      py.FS.writeFile(PYLIB + '/' + name, await res.text())
    } catch { /* the run still works without it */ }
  }
  py.$pwlib = true
}

async function installPyodide(indexURL) {
  if (typeof globalThis.loadPyodide === 'function') return
  try {
    await import(indexURL + 'pyodide.js')
  } catch {
    /* not an ES module: evaluate it instead, which is what it expects anyway */
    const res = await fetch(indexURL + 'pyodide.js');
    (0, eval)(await res.text())
  }
  if (typeof globalThis.loadPyodide !== 'function') {
    throw new Error('pyodide.js did not install loadPyodide')
  }
}

function ensureRuntime(indexURL) {
  if (runtime) return runtime
  runtime = installPyodide(indexURL)
    .then(() => globalThis.loadPyodide({ indexURL: indexURL }))
    .then(function (py) {
      /* py.version is the *Pyodide* version (314.0.7); ask the interpreter for
         its own version instead of showing one as if it were the other */
      let interpreter
      try {
        interpreter = py.runPython('import sys; \'%d.%d.%d\' % sys.version_info[:3]')
      } catch {
        interpreter = ''
      }
      self.postMessage({ type: 'status', state: 'ready', api: py.version, python: interpreter })
      return py
    })
    .catch(function (e) {
      runtime = null
      self.postMessage({ type: 'status', state: 'fatal', message: String(e) })
      throw e
    })
  return runtime
}

/* What the program left behind: the file list mirrors the project directory,
   so a chart the program wrote shows up in the tree. */
const MAX_OUT_BYTES = 2 * 1024 * 1024
const MAX_OUT_FILES = 20

function fsFiles(py, dir) {
  const out = []
  let names
  try { names = py.FS.readdir(dir) } catch { return out }
  names.forEach(function (n) {
    if (n === '.' || n === '..' || n === '__pycache__') return
    const p = dir + '/' + n
    try {
      const st = py.FS.stat(p)
      if (py.FS.isDir(st.mode) || st.size > MAX_OUT_BYTES) return
      out.push({ name: n, bytes: py.FS.readFile(p) })
    } catch { /* unreadable: skip */ }
  })
  return out.slice(0, MAX_OUT_FILES)
}

function sameAsSent(prev, bytes) {
  if (prev === undefined) return false
  const pb = typeof prev === 'string' ? new TextEncoder().encode(prev) : prev
  if (pb.length !== bytes.length) return false
  for (let i = 0; i < pb.length; i++) {
    if (pb[i] !== bytes[i]) return false
  }
  return true
}

function producedFiles(py, files) {
  const sent = new Map();
  (files || []).forEach(function (f) {
    sent.set(f.name, f.bytes ? f.bytes : String(f.content == null ? '' : f.content))
  })
  return fsFiles(py, DIR).filter(function (f) {
    return !sameAsSent(sent.get(f.name), f.bytes)
  })
}

self.onmessage = function (ev) {
  const msg = ev.data || {}
  if (msg.type === 'load') {
    ensureRuntime(msg.indexURL).catch(function () {})
    return
  }
  if (msg.type !== 'run') return

  ensureRuntime(msg.indexURL)
    .then(async function (py) {
      await ensurePylib(py)
      /* numpy, pillow, ... : pyodide resolves each wheel against indexURL, so
         anything vendored next to the lock loads without touching the network.
         The main thread is told, so the trace budget does not include the wait. */
      self.postMessage({ type: 'status', id: msg.id, state: 'packages' })
      const all = (msg.files || []).map(f => f.content || '').join('\n')
      try {
        await py.loadPackagesFromImports(all, { messageCallback: () => {} })
      } catch (e) {
        throw new Error('could not load a package this program imports: '
          + (e && e.message ? e.message : e), { cause: e })
      }
      self.postMessage({ type: 'status', id: msg.id, state: 'running' })
      syncFs(py, msg.files)
      py.globals.set('__PROJECT_DIR__', DIR)
      py.globals.set('__PROJECT_ENTRY__', DIR + '/' + (msg.entry || 'main.py'))
      /* 输入：已给的行原样交给解释器（PY_TRACE 铺成 sys.stdin）。普通 Run 用输入框
         里的行、取完即 EOF；交互式终端每问一次就带更长的输入重跑，见 config.js 的
         NeedLine。两条路都不需要跨线程等待，也就不需要任何响应头。 */
      py.globals.set('__pw_stdin__', String(msg.stdin == null ? '' : msg.stdin))
      py.globals.set('__pw_interactive__', !!msg.interactive)
      /* 输出边写边发：Python 是同步跑的，但 worker 在 Python 里 postMessage 是即时的
         （此刻主线程空着，消息马上被处理），所以页面不必等整段 trace 结束才看到 print。 */
      py.globals.set('__pw_emit__', function (s) {
        self.postMessage({ type: 'out', text: String(s) })
      })
      py.runPython(msg.tracer)
      const raw = py.globals.get('RESULT')
      const data = JSON.parse(typeof raw === 'string' ? raw : String(raw))
      self.postMessage({ type: 'result', id: msg.id, data: data, produced: producedFiles(py, msg.files) })
    })
    .catch(function (e) {
      /* 一次运行只有一个答复：要么 result.data，要么 result.error */
      self.postMessage({ type: 'result', id: msg.id, error: (e && e.message) ? e.message : String(e) })
    })
}
