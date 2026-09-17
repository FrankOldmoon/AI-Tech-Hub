/* =====================================================================
   Monaco.

   `attachEditor` is split out of `loadMonaco` so the editor plumbing can be
   wired against any Monaco-shaped object, and so this module never has to import
   the controller back: the app hands its handlers in.  That keeps the import
   graph a DAG.
   ===================================================================== */
import { SAMPLE } from "./config.js";
import { $ } from "./dom.js";
import { editor, setEditor, deco, setDeco } from "./state.js";

/* Monaco 走 hubs 自托管的 npm 产物（标准 AMD 构建），见 sync-runtime-libs.mjs。
   AMD 构建的 worker 就是 workerMain.js 本身：它按自身 URL 去 importScripts，
   所以同源绝对路径即可。Python 没有专属 worker，基础 worker 就够了。 */
const MONACO_BASE = "/model/vendor/monaco/min";

window.MonacoEnvironment = {
  getWorkerUrl: () => MONACO_BASE + "/vs/base/worker/workerMain.js"
};

let monacoApi = null;
let hoverDeco = null;

/* One editor, one model per file: switching files is setModel, so scroll
   position, undo history and the cursor all survive. */
const models = new Map();
let activeName = null;

export function fileNames() { return Array.from(models.keys()); }

export function hasFiles() { return models.size > 0; }

export function activeFileName() { return activeName; }

/* Lines for a file, used by the analysis to read the source of a traced step.
   Falls back to whatever the editor shows (and then to the sample) so the
   analysis also works with no project loaded. */
export function fileLines(name) {
  const key = name || "main.py";
  const m = models.get(key);
  if (m) return m.getValue().split("\n");
  if (editor && editor.getModel()) return editor.getModel().getValue().split("\n");
  return SAMPLE.split("\n");
}

export function hasModel(name) { return models.has(name); }

export function fileText(name) {
  const m = models.get(name);
  return m ? m.getValue() : "";
}

/* Returns false when there is no model for that name — a binary file has
   none, and the app shows a preview instead. */
export function showFile(name) {
  const m = models.get(name);
  if (!m || !editor) return false;
  if (activeName === name) return activeName;
  activeName = name;
  editor.setModel(m);
  /* decorations belong to a model, so hand the app fresh collections */
  setDeco(editor.createDecorationsCollection([]));
  hoverDeco = editor.createDecorationsCollection([]);
  const label = $("fname");
  if (label) label.textContent = name;
  return activeName;
}

export function setFiles(files, active) {
  const seen = new Set();
  (files || []).forEach(function (f) {
    if (!f || typeof f.name !== "string") return;
    if (f.kind === "bin") return;              // images are not editor models
    seen.add(f.name);
    let m = models.get(f.name);
    if (!m) {
      m = monacoApi.editor.createModel(f.content, "python", monacoApi.Uri.parse("file:///" + f.name));
      models.set(f.name, m);
    } else if (m.getValue() !== f.content) {
      m.setValue(f.content);
    }
  });
  /* move the editor off any file that left the project before disposing it */
  if (active && models.has(active)) showFile(active);
  else if (!models.has(activeName)) showFile(models.keys().next().value);
  for (const [name, m] of Array.from(models)) {
    if (seen.has(name)) continue;
    m.dispose();
    models.delete(name);
  }
}

export function setFileContent(name, content) {
  const m = models.get(name);
  if (m) { if (m.getValue() !== content) m.setValue(content); return true; }
  return false;
}

export function renameModel(from, to) {
  const m = models.get(from);
  if (!m) return null;
  const fresh = monacoApi.editor.createModel(m.getValue(), "python", monacoApi.Uri.parse("file:///" + to));
  models.delete(from);
  m.dispose();
  models.set(to, fresh);
  if (activeName === from) { activeName = null; showFile(to); }
  return fresh;
}

export function dropModel(name) {
  const m = models.get(name);
  if (m && activeName !== name) { m.dispose(); models.delete(name); }
}

export function attachEditor(instance, api, hooks) {
  monacoApi = api;
  setEditor(instance);
  setDeco(instance.createDecorationsCollection([]));
  hoverDeco = instance.createDecorationsCollection([]);
  const h = hooks || {};
  instance.onDidChangeModelContent(() => { if (h.onEdit) h.onEdit(); });
  if (h.onRun) instance.addCommand(api.KeyMod.CtrlCmd | api.KeyCode.Enter, h.onRun);
}

/* The loader and the Monaco API are singletons for the page's lifetime, but the
   editor's DOM is not: bind() (re)creates the editor inside whichever #editor
   element is current, and destroyEditor() disposes it when the page unmounts. */
function bind(hooks) {
  monaco.editor.defineTheme("stage-dark", {
    base: "vs-dark", inherit: true,
    rules: [
      { token: "comment", foreground: "6b7699", fontStyle: "italic" },
      { token: "keyword", foreground: "8aa2ff" },
      { token: "string", foreground: "9fe0b4" },
      { token: "number", foreground: "ffd166" },
      { token: "identifier", foreground: "e8ecf1" }
    ],
    colors: {
      "editor.background": "#12141f",
      "editorGutter.background": "#12141f",
      "editor.lineHighlightBackground": "#181c2c",
      "editorLineNumber.foreground": "#3f4869",
      "editorLineNumber.activeForeground": "#ffd166",
      "editorIndentGuide.background1": "#232a45",
      "editor.selectionBackground": "#2c3a63",
      "editorCursor.foreground": "#ffd166"
    }
  });
  const instance = monaco.editor.create($("editor"), {
    value: SAMPLE, language: "python", theme: "stage-dark", automaticLayout: true,
    minimap: { enabled: false },
    fontFamily: 'ui-monospace,SFMono-Regular,"JetBrains Mono",Consolas,Monaco,monospace',
    fontSize: 13.5, lineHeight: 22, tabSize: 4, insertSpaces: true,
    renderLineHighlight: "all", scrollBeyondLastLine: false, smoothScrolling: true,
    padding: { top: 12, bottom: 12 },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
  });
  attachEditor(instance, monaco, hooks);
}

export function loadMonaco(hooks) {
  return new Promise((resolve, reject) => {
    const boot = () => {
      require.config({ paths: { vs: MONACO_BASE + "/vs" } });
      require(["vs/editor/editor.main"], () => {
        try { bind(hooks); resolve(); } catch (e) { reject(e); }
      }, reject);
    };
    /* Re-entering the page must not inject a second loader: the AMD module is
       already registered, so only the editor instance has to be re-created. */
    if (typeof globalThis.monaco !== "undefined") {
      boot();
      return;
    }
    const s = document.createElement("script");
    s.src = MONACO_BASE + "/vs/loader.js";
    s.onload = boot;
    s.onerror = () => reject(new Error("Failed to load Monaco loader.js"));
    document.head.appendChild(s);
  });
}

/* Models survive an editor dispose() — they belong to the Monaco API, not to
   the instance — so the project's text is still there after a re-mount. */
export function destroyEditor() {
  if (editor) {
    try { editor.dispose(); } catch (e) {}
  }
  setEditor(null);
  setDeco(null);
  hoverDeco = null;
  activeName = null;
}

export function setHoverLine(line) {
  if (!hoverDeco) return;
  if (!line || line < 1) { hoverDeco.set([]); return; }
  hoverDeco.set([{
    range: new monacoApi.Range(line, 1, line, 1),
    options: { isWholeLine: true, className: "hover-line" }
  }]);
}

export function highlight(line) {
  if (!editor || !deco) return;
  if (!line || line < 1) { deco.set([]); return; }
  deco.set([{
    range: new monacoApi.Range(line, 1, line, 1),
    options: { isWholeLine: true, className: "cur-line", linesDecorationsClassName: "cur-line-gutter" }
  }]);
  editor.revealLineInCenterIfOutsideViewport(line, monacoApi.editor.ScrollType.Smooth);
}
