/* @deps: none */

/* =====================================================================
   Running Python on the main thread.

   Two places need this: the game page (play.html) and the visualizer's game
   view.  Both need it for one reason — emscripten's SDL reaches for `screen`,
   `document` and a real canvas, and the tracing worker has none of them.

   The price is that a game loop has to hand the browser a turn: only while the
   interpreter is parked in `await asyncio.sleep(...)` can the page repaint,
   collect keys or handle a click.  So that is also the only moment "stop" can
   be noticed.  The preamble wraps `asyncio.sleep`, checks a flag on every call
   and raises `_Stop` when it is set — deliberately a BaseException, so a user's
   `except Exception` cannot swallow the escape hatch.  Once it is out, the
   interpreter is still healthy and the same runtime can run again: no reload.
   ===================================================================== */
/* 与追踪 worker 一样，pyodide 走 hubs 自托管的 npm 产物 */
const VENDOR = () => new URL("/model/vendor/pyodide/", document.baseURI).href;

let runtime = null;
let running = false;
let stopFlag = false;

export function isRunning() { return running; }

export function stopGame() { stopFlag = true; }

/* The main-thread interpreter cannot be terminated from outside (that is the
   whole reason the tracer uses a worker), so "releasing" it means dropping the
   reference and letting the next run build a fresh one. */
export function releaseMainRuntime() { runtime = null; }

/* Runs before the game: cwd, stdout, and the stop check inside every yield. */
const PREAMBLE = `
import asyncio, os, sys

DIR = '/project'
os.makedirs(DIR, exist_ok=True)
os.chdir(DIR)
if DIR not in sys.path:
    sys.path.insert(0, DIR)
sys.dont_write_bytecode = True

class _Out:
    # print() calls write() once per argument, so a line has to be assembled
    # here: emitting every fragment on its own line turns a single
    # print("hp =", 100) into three lines of output.
    def __init__(self):
        self.buf = ''
    def write(self, s):
        s = str(s)
        self.buf += s
        while '\\n' in self.buf:
            line, self.buf = self.buf.split('\\n', 1)
            pw_print(line)
        return len(s)
    def flush(self):
        if self.buf:
            pw_print(self.buf)
            self.buf = ''
        return None

sys.stdout = _Out()
sys.stderr = _Out()

class _Stop(BaseException):
    pass

def _pw_guard(mod, name):
    # a checkpoint: whoever reaches it first after the interpreter resumes gets
    # to see a stop that was requested while it was parked
    real = getattr(mod, name)
    if getattr(real, '_pw_guarded', False):
        return
    def guarded(*a, **k):
        if pw_should_stop():
            raise _Stop()
        return real(*a, **k)
    guarded._pw_guarded = True
    setattr(mod, name, guarded)

import pygame

_pw_guard(asyncio, 'sleep')      # the yield the browser needs anyway
_pw_guard(pygame.event, 'get')   # reached once per frame by any real game

if not hasattr(pygame.display, '_pw_real_set_mode'):
    pygame.display._pw_real_set_mode = pygame.display.set_mode

def _pw_set_mode(size, *a, **k):
    surf = pygame.display._pw_real_set_mode(size, *a, **k)
    try:
        pw_resize(int(size[0]), int(size[1]))
    except BaseException:
        pass
    return surf

pygame.display.set_mode = _pw_set_mode
`;

/* The page already owns the event loop, so a program that ends with
   `asyncio.run(main())` dies on its first frame with a confusing message. */
const HINT = "hint: this page already runs your file inside an event loop — "
  + "end it with `await main()` instead of `asyncio.run(main())`.";

function tail(text, lines) {
  const all = String(text == null ? "" : text).split("\n").filter(s => s.trim() !== "");
  return all.slice(-(lines || 12)).join("\n");
}

export async function loadMainRuntime(onStatus) {
  if (runtime) return runtime;
  if (onStatus) onStatus("Loading Python runtime…");
  const indexURL = VENDOR();
  /* resolved against the document, not this module: the vendored pyodide sits
     outside the app folder, so a module-relative path lands one level short */
  await import(indexURL + "pyodide.js");
  runtime = await globalThis.loadPyodide({ indexURL: indexURL });
  return runtime;
}

function writeFiles(py, files, onOut) {
  try { py.FS.mkdir("/project"); } catch (e) {}
  (files || []).forEach(function (f) {
    if (!f || typeof f.name !== "string") return;
    try {
      py.FS.writeFile("/project/" + f.name, f.kind === "bin" ? f.bytes : String(f.content || ""));
    } catch (e) {
      if (onOut) onOut("could not write " + f.name);
    }
  });
}

/* Resolves — never rejects — with what happened, so both callers can stay
   short: `{stopped}` when the flag was set, `{error}` when the program died. */
export async function startGame(opts) {
  const o = opts || {};
  const files = o.files || [];
  const entry = o.entry || "main.py";
  const canvas = o.canvas || null;
  const file = files.filter(f => f && f.name === entry)[0] || files[0];
  const code = String((file && file.content) || "");
  if (!code.trim()) return { stopped: false, error: "That file is empty." };

  if (running) return { stopped: false, error: "Already running." };
  stopFlag = false;
  running = true;
  try {
    const py = await loadMainRuntime(o.onStatus);
    /* emscripten looks for its canvas the moment pygame is imported */
    if (canvas) py._module.canvas = canvas;
    py.globals.set("pw_print", (s) => { if (o.onOut) o.onOut(String(s).replace(/\n$/, "")); });
    py.globals.set("pw_resize", (w, h) => {
      if (canvas && w > 0 && h > 0) { canvas.width = w; canvas.height = h; }
    });
    py.globals.set("pw_should_stop", () => stopFlag);

    if (o.onStatus) o.onStatus("Writing project files…");
    writeFiles(py, files, o.onOut);

    if (o.onStatus) o.onStatus("Loading packages…");
    const all = files.map(f => f.content || "").join("\n");
    await py.loadPackagesFromImports(all, { messageCallback: () => {} });

    if (o.onStatus) o.onStatus("Running " + entry);
    await py.runPythonAsync(PREAMBLE + "\n" + code);
    return { stopped: stopFlag, error: null };
  } catch (e) {
    if (stopFlag) return { stopped: true, error: null };
    const msg = String(e && e.message ? e.message : e);
    return { stopped: false, error: tail(msg) + (/asyncio\.run\(\)/.test(msg) ? "\n\n" + HINT : "") };
  } finally {
    running = false;
  }
}
