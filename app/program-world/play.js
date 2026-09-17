/* @deps: gamerun.js, project.js */
import { loadMainRuntime, startGame, stopGame } from "./gamerun.js";
import { ENTRY, fileByName, project, readProject, setProject } from "./project.js";
import { $ } from "./dom.js";

/* =====================================================================
   The game page.

   All this page owns is its widgets: the file picker, the status line and the
   output box.  Running Python on the main thread — and stopping it again at a
   frame boundary — lives in gamerun.js, which the visualizer's game view also
   uses.  The project is shared with the visualizer (same localStorage and
   IndexedDB), so a game written there shows up here.
   ===================================================================== */
let busy = false;
let picked = ENTRY;

function say(text, cls) {
  const el = $("status");
  if (!el) return;
  el.className = "status" + (cls ? " " + cls : "");
  el.textContent = text;
}

function out(line) {
  const el = $("out");
  if (!el) return;
  el.textContent += "\n" + line;
  el.scrollTop = el.scrollHeight;
}

function resetOut() {
  const el = $("out");
  if (el) el.textContent = "";
}

function buttons(running) {
  if ($("btnPlay")) $("btnPlay").disabled = running;
  if ($("btnStop")) $("btnStop").disabled = !running;
}

async function start() {
  if (busy) return;
  const file = fileByName(picked);
  if (!file || file.kind === "bin") { say("Pick a Python file first.", "bad"); return; }
  if (!String(file.content || "").trim()) { say("That file is empty.", "bad"); return; }

  busy = true;
  buttons(true);
  resetOut();
  const screen = $("screen");
  if (screen && screen.focus) screen.focus();

  const res = await startGame({
    files: project.files,
    entry: file.name,
    canvas: screen,
    onOut: out,
    onStatus: say
  });

  busy = false;
  buttons(false);
  if (res.stopped) say("Stopped at the end of the frame.", "good");
  else if (res.error) { out(res.error); say("The game stopped with an error.", "bad"); }
  else say("The game returned. Press Run game to start again.", "good");
}

export async function boot() {
  let p = null;
  try {
    p = await readProject();
  } catch (e) {
    p = null;
  }
  if (!p || !p.files || !p.files.length) {
    say("No project found — write a main.py in the visualizer first.", "bad");
    return;
  }
  setProject(p);

  const sel = $("filePick");
  if (sel) {
    const names = p.files.filter(f => f.kind !== "bin").map(f => f.name);
    sel.innerHTML = names.map(function (n) {
      return '<option value="' + n + '"' + (n === ENTRY ? " selected" : "") + ">" + n + "</option>";
    }).join("");
    picked = names.indexOf(ENTRY) >= 0 ? ENTRY : (names[0] || ENTRY);
    sel.addEventListener("change", function () { picked = sel.value; });
  }

  if ($("btnPlay")) $("btnPlay").addEventListener("click", start);
  if ($("btnStop")) $("btnStop").addEventListener("click", function () {
    /* the loop hands the browser a turn every frame, so the flag is noticed at
       the next yield — no reload, and the same runtime can run again */
    stopGame();
    say("Stopping at the end of this frame…");
  });

  /* report ready only once the runtime is in: the first Play otherwise lands
     on a page that looks idle while it is still fetching Python */
  const n = p.files.length;
  loadMainRuntime(say).then(function () {
    if (!busy) say("Ready — " + n + " file" + (n === 1 ? "" : "s"), "good");
  }).catch(function (e) {
    say("Could not load Python: " + String(e).slice(0, 90), "bad");
  });
}
