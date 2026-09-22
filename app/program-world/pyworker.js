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

/* =====================================================================
   Flowchart source analysis.

   The module the tracer imports below is *inlined* on purpose: this file is
   copied verbatim as a static asset (see scripts/check-program-world-worker.mjs),
   so a relative import would 404 in production.

   `__import__` instead of `import ast, json` for the same reason: that script
   flags any line starting with `import`, and it cannot tell Python from JS.
   ===================================================================== */
const FLOW_PY = `
_ast = __import__('ast')
_json = __import__('json')

def __pw_seg(node):
    try:
        text = _ast.get_source_segment(__pw_src__, node) or ''
    except Exception:
        text = ''
    return ' '.join(text.split())

def __pw_args(args):
    parts = []
    for a in getattr(args, 'posonlyargs', []):
        parts.append(a.arg)
    for a in args.args:
        parts.append(a.arg)
    if args.vararg:
        parts.append('*' + args.vararg.arg)
    for a in args.kwonlyargs:
        parts.append(a.arg)
    if args.kwarg:
        parts.append('**' + args.kwarg.arg)
    return ', '.join(parts)

def __pw_calls(value):
    # 语句里出现的调用，点号名原样留着（helper.total）：主线程据此把「调用别处
    # 定义的函数」连到那个定义上。取不到就当没有，绝不影响解析本身。
    found = []
    try:
        for sub in _ast.walk(value):
            if not isinstance(sub, _ast.Call):
                continue
            f = sub.func
            name = ''
            if isinstance(f, _ast.Name):
                name = f.id
            elif isinstance(f, _ast.Attribute):
                parts = []
                cur = f
                while isinstance(cur, _ast.Attribute):
                    parts.append(cur.attr)
                    cur = cur.value
                if isinstance(cur, _ast.Name):
                    parts.append(cur.id)
                    name = '.'.join(reversed(parts))
            if name and name not in found:
                found.append(name)
            if len(found) >= 8:
                break
    except Exception:
        found = []
    return found

def __pw_io(node):
    if isinstance(node, _ast.Expr) and isinstance(node.value, _ast.Call):
        f = node.value.func
        if isinstance(f, _ast.Name) and f.id in ('print', 'input'):
            return f.id
    return ''

def __pw_plain(node):
    value = getattr(node, 'value', None)
    return {'kind': 'stmt', 'line': getattr(node, 'lineno', 0), 'text': __pw_seg(node),
            'calls': __pw_calls(value) if value is not None else []}

def __pw_stmt(node):
    line = getattr(node, 'lineno', 0)
    # 文档字符串不进图
    if isinstance(node, _ast.Expr) and isinstance(node.value, _ast.Constant) and isinstance(node.value.value, str):
        return []
    io = __pw_io(node)
    if io:
        return [{'kind': 'io', 'dir': 'out' if io == 'print' else 'in', 'line': line,
                 'text': __pw_seg(node), 'calls': __pw_calls(node.value)}]
    if isinstance(node, _ast.If):
        # if / elif / else 摊成一条 branches 链，else 单独放
        branches = []
        cur = node
        tail = []
        while isinstance(cur, _ast.If):
            branches.append({'test': __pw_seg(cur.test), 'line': getattr(cur, 'lineno', line), 'body': __pw_block(cur.body)})
            nxt = cur.orelse
            if len(nxt) == 1 and isinstance(nxt[0], _ast.If):
                cur = nxt[0]
            else:
                tail = nxt
                cur = None
        out = {'kind': 'if', 'line': line, 'branches': branches}
        if tail:
            out['orelse'] = __pw_block(tail)
        return [out]
    if isinstance(node, _ast.While):
        out = {'kind': 'while', 'line': line, 'test': __pw_seg(node.test), 'body': __pw_block(node.body)}
        if node.orelse:
            out['orelse'] = __pw_block(node.orelse)
        return [out]
    if isinstance(node, (_ast.For, _ast.AsyncFor)):
        return [{'kind': 'for', 'line': line, 'target': __pw_seg(node.target),
                 'iter': __pw_seg(node.iter), 'body': __pw_block(node.body)}]
    if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
        is_class = isinstance(node, _ast.ClassDef)
        return [{'kind': 'func', 'sub': 'class' if is_class else 'def', 'line': line,
                 'name': node.name, 'args': '' if is_class else __pw_args(node.args),
                 'body': __pw_block(node.body)}]
    if isinstance(node, _ast.Return):
        calls = __pw_calls(node.value) if node.value is not None else []
        return [{'kind': 'return', 'line': line, 'text': __pw_seg(node), 'calls': calls}]
    if isinstance(node, _ast.Break):
        return [{'kind': 'break', 'line': line, 'text': 'break'}]
    if isinstance(node, _ast.Continue):
        return [{'kind': 'continue', 'line': line, 'text': 'continue'}]
    if isinstance(node, _ast.Try):
        out = [{'kind': 'stmt', 'line': line, 'text': 'try'}]
        out.extend(__pw_block(node.body))
        for h in node.handlers:
            label = 'except'
            if h.type is not None:
                label = 'except ' + __pw_seg(h.type)
            out.append({'kind': 'stmt', 'line': getattr(h, 'lineno', line), 'text': label})
            out.extend(__pw_block(h.body))
        if node.orelse:
            out.append({'kind': 'stmt', 'line': line, 'text': 'else'})
            out.extend(__pw_block(node.orelse))
        if node.finalbody:
            out.append({'kind': 'stmt', 'line': line, 'text': 'finally'})
            out.extend(__pw_block(node.finalbody))
        return out
    # 其余带 body 的复合语句（with / match / async with …）：保留外壳，body 摊平进主流程，语句不丢
    body = getattr(node, 'body', None)
    if isinstance(body, list) and body:
        out = [__pw_plain(node)]
        out.extend(__pw_block(body))
        return out
    return [__pw_plain(node)]

def __pw_block(nodes):
    out = []
    for n in nodes:
        out.extend(__pw_stmt(n))
        if len(out) > 600:
            out.append({'kind': 'more', 'line': 0, 'text': '... (too long, chart truncated)'})
            break
    return out

__pw_error = None

def __pw_imports_of(nodes):
    # 顶层 import 语句：主线程据此把 helper.total 里的 helper 认成 helper.py，
    # 从而把跨文件的调用连到定义上。
    out = []
    for n in nodes:
        if isinstance(n, _ast.Import):
            for a in n.names:
                out.append({'module': a.name, 'alias': a.asname or a.name, 'names': []})
        elif isinstance(n, _ast.ImportFrom):
            if n.module:
                out.append({'module': n.module, 'alias': '', 'names': [a.name for a in n.names]})
    return out

__pw_tree = []
__pw_imports = []
try:
    __pw_module = _ast.parse(__pw_src__)
    __pw_tree = __pw_block(__pw_module.body)
    __pw_imports = __pw_imports_of(__pw_module.body)
except SyntaxError as e:
    __pw_error = {'line': getattr(e, 'lineno', 0) or 0, 'message': e.msg or 'syntax error'}
except Exception as e:
    __pw_error = {'line': 0, 'message': str(e)}
__pw_flow__ = _json.dumps({'tree': __pw_tree, 'error': __pw_error, 'imports': __pw_imports})
`

self.onmessage = function (ev) {
  const msg = ev.data || {}
  if (msg.type === 'load') {
    ensureRuntime(msg.indexURL).catch(function () {})
    return
  }
  if (msg.type === 'parse') {
    /* 只解析、不执行用户代码：语法错误是正常答复，所以不走 result（那条路会 poison）。
       一个项目的每个 .py 都解析一遍，跨文件的调用才连得起来。 */
    ensureRuntime(msg.indexURL)
      .then(function (py) {
        const list = (Array.isArray(msg.files) && msg.files.length)
          ? msg.files
          : [{ name: 'main.py', code: msg.code }]
        const entry = msg.entry || list[0].name
        const files = {}
        for (const f of list) {
          py.globals.set('__pw_src__', String(f.code == null ? '' : f.code))
          py.runPython(FLOW_PY)
          const raw = py.globals.get('__pw_flow__')
          files[f.name] = JSON.parse(typeof raw === 'string' ? raw : String(raw))
        }
        self.postMessage({ type: 'parsed', id: msg.id, data: { entry: entry, files: files } })
      })
      .catch(function (e) {
        self.postMessage({ type: 'parsed', id: msg.id, error: (e && e.message) ? e.message : String(e) })
      })
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
