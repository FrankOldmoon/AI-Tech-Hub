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
   ===================================================================== */
let runtime = null;

/* The project lives in pyodide's in-memory filesystem, so `import helper` and
   `open("data.txt")` behave exactly as they would on disk. */
const DIR = "/project";

/* Small helpers the runner needs inside the interpreter (turtle, and the code
   that collects what a program drew).  They live outside the project so they
   never show up in the file list and never count against its size. */
const PYLIB = "/pwlib";
const PYLIB_FILES = ["pwviews.py", "turtle.py"];

function removePath(FS, p) {
  let st = null;
  try { st = FS.stat(p); } catch (e) { return; }
  if (FS.isDir(st.mode)) {
    try { FS.readdir(p).forEach(n => { if (n !== "." && n !== "..") removePath(FS, p + "/" + n); }); } catch (e) {}
    try { FS.rmdir(p); } catch (e) {}
  } else {
    try { FS.unlink(p); } catch (e) {}
  }
}

function syncFs(py, files) {
  const FS = py.FS;
  try { FS.mkdir(DIR); } catch (e) {}
  try {
    FS.readdir(DIR).forEach(n => { if (n !== "." && n !== "..") removePath(FS, DIR + "/" + n); });
  } catch (e) {}
  (files || []).forEach(function (f) {
    if (!f || typeof f.name !== "string") return;
    const body = f.bytes ? f.bytes : String(f.content == null ? "" : f.content);
    FS.writeFile(DIR + "/" + f.name, body);
  });
}

async function ensurePylib(py) {
  if (py.$pwlib) return;
  const base = new URL("/program-world/pylib/", self.location.href).href;
  try { py.FS.mkdir(PYLIB); } catch (e) {}
  for (const name of PYLIB_FILES) {
    try {
      const res = await fetch(base + name);
      if (!res.ok) continue;
      py.FS.writeFile(PYLIB + "/" + name, await res.text());
    } catch (e) { /* the run still works without it */ }
  }
  py.$pwlib = true;
}

async function installPyodide(indexURL) {
  if (typeof globalThis.loadPyodide === "function") return;
  try {
    await import(indexURL + "pyodide.js");
  } catch (e) {
    /* not an ES module: evaluate it instead, which is what it expects anyway */
    const res = await fetch(indexURL + "pyodide.js");
    (0, eval)(await res.text());
  }
  if (typeof globalThis.loadPyodide !== "function") {
    throw new Error("pyodide.js did not install loadPyodide");
  }
}

function ensureRuntime(indexURL) {
  if (runtime) return runtime;
  runtime = installPyodide(indexURL)
    .then(() => globalThis.loadPyodide({ indexURL: indexURL }))
    .then(function (py) {
      /* py.version is the *Pyodide* version (314.0.7); ask the interpreter for
         its own version instead of showing one as if it were the other */
      let interpreter = "";
      try {
        interpreter = py.runPython("import sys; '%d.%d.%d' % sys.version_info[:3]");
      } catch (e) {
        interpreter = "";
      }
      self.postMessage({ type: "ready", api: py.version, python: interpreter });
      return py;
    })
    .catch(function (e) {
      runtime = null;
      self.postMessage({ type: "failed", message: String(e) });
      throw e;
    });
  return runtime;
}

/* What the program left behind: the file list mirrors the project directory,
   so a chart the program wrote shows up in the tree. */
const MAX_OUT_BYTES = 2 * 1024 * 1024;
const MAX_OUT_FILES = 20;

function fsFiles(py, dir) {
  const out = [];
  let names = [];
  try { names = py.FS.readdir(dir); } catch (e) { return out; }
  names.forEach(function (n) {
    if (n === "." || n === ".." || n === "__pycache__") return;
    const p = dir + "/" + n;
    try {
      const st = py.FS.stat(p);
      if (py.FS.isDir(st.mode) || st.size > MAX_OUT_BYTES) return;
      out.push({ name: n, bytes: py.FS.readFile(p) });
    } catch (e) { /* unreadable: skip */ }
  });
  return out.slice(0, MAX_OUT_FILES);
}

function sameAsSent(prev, bytes) {
  if (prev === undefined) return false;
  const pb = typeof prev === "string" ? new TextEncoder().encode(prev) : prev;
  if (pb.length !== bytes.length) return false;
  for (let i = 0; i < pb.length; i++) {
    if (pb[i] !== bytes[i]) return false;
  }
  return true;
}

function producedFiles(py, files) {
  const sent = new Map();
  (files || []).forEach(function (f) {
    sent.set(f.name, f.bytes ? f.bytes : String(f.content == null ? "" : f.content));
  });
  return fsFiles(py, DIR).filter(function (f) {
    return !sameAsSent(sent.get(f.name), f.bytes);
  });
}

self.onmessage = function (ev) {
  const msg = ev.data || {};
  if (msg.type === "load") {
    ensureRuntime(msg.indexURL).catch(function () {});
    return;
  }
  if (msg.type !== "run") return;

  ensureRuntime(msg.indexURL)
    .then(async function (py) {
      await ensurePylib(py);
      /* numpy, pillow, ... : pyodide resolves each wheel against indexURL, so
         anything vendored next to the lock loads without touching the network.
         The main thread is told, so the trace budget does not include the wait. */
      self.postMessage({ type: "phase", id: msg.id, phase: "packages" });
      const all = (msg.files || []).map(f => f.content || "").join("\n");
      try {
        await py.loadPackagesFromImports(all, { messageCallback: () => {} });
      } catch (e) {
        self.postMessage({ type: "phase", id: msg.id, phase: "running" });
        throw new Error("could not load a package this program imports: " +
          (e && e.message ? e.message : e), { cause: e });
      }
      self.postMessage({ type: "phase", id: msg.id, phase: "running" });
      syncFs(py, msg.files);
      py.globals.set("__PROJECT_DIR__", DIR);
      py.globals.set("__PROJECT_ENTRY__", DIR + "/" + (msg.entry || "main.py"));
      py.runPython(msg.tracer);
      const raw = py.globals.get("RESULT");
      const data = JSON.parse(typeof raw === "string" ? raw : String(raw));
      self.postMessage({ type: "result", id: msg.id, data: data, produced: producedFiles(py, msg.files) });
    })
    .catch(function (e) {
      self.postMessage({ type: "failed", id: msg.id, message: (e && e.message) ? e.message : String(e) });
    });
};
