/* @deps: dom.js, editor.js, sound.js, state.js */
import { $, arenaEl, clip, drawerMeta, errBox, esc, framePill, framesEl, nowCode, nowLn, nowMeta, outSlotEl, scrub, stdoutEl, stepPill, timelineEl, varCount, varsEl, vsLayerEl, worldIdleEl, wtopEl } from "./dom.js";
import { setHoverLine } from "./editor.js";
import { beep } from "./sound.js";
import { editor, error, events, limit, outputs, scenes, stacks, steps, truncated } from "./state.js";

/* =====================================================================
   STEP 5 · renderers
   ===================================================================== */
function actorStateClass(c, prev) {
  if (prev === null) return "created";
  if (prev.value !== c.value || prev.type !== c.type) return "changed";
  return "";
}

export const actorNodes = new Map();

function makeDiv(cls) {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  return d;
}

function createActorNode(c) {
  const el = makeDiv("actor");
  el.setAttribute("data-char", c.name);
  const avatar = makeDiv("avatar");
  const name = makeDiv("name");
  const value = makeDiv("value");
  const type = makeDiv("type");
  const bar = makeDiv("bar");
  const fill = makeDiv("fill");
  bar.appendChild(fill);
  const bag = makeDiv("bag");
  bag.style.display = "none";
  const scope = makeDiv("scope");
  scope.style.display = "none";
  el.appendChild(avatar);
  el.appendChild(name);
  el.appendChild(value);
  el.appendChild(type);
  el.appendChild(bar);
  el.appendChild(bag);
  el.appendChild(scope);
  el.setAttribute("data-entity", c.id);
  el.setAttribute("data-line", "0");
  const node = { id: c.id, el, avatar, name, value, type, bar, fill, bag, chips: [], bagOn: false, scope, scopeOn: false, want: "", applied: "", dying: false, exitAnim: null, index: -1, last: {} };
  arenaEl.appendChild(el);
  actorNodes.set(c.id, node);
  return node;
}

function updateActorNode(node, c, prev, index, animate) {
  const L = node.last;
  if (L.name !== c.name) {
    node.name.textContent = c.name;
    node.el.setAttribute("data-char", c.name);
  }
  if (L.value !== c.value) {
    if (animate && typeof L.numeric === "number" && typeof c.numeric === "number") {
      tweenNumber(node, L.numeric, c.numeric, c.value);
      if (Math.abs(c.numeric - L.numeric) >= 2) spawnDelta(node, c.numeric - L.numeric);
    } else {
      stopNumTween(node);
      node.value.textContent = clip(c.value, 14);
    }
  }
  if (L.type !== c.type) node.type.textContent = c.type;
  if (L.avatar !== c.avatar) node.avatar.textContent = c.avatar;

  const hasBar = c.numeric !== null;
  if (L.hasBar !== hasBar) node.bar.style.display = hasBar ? "" : "none";
  const width = hasBar ? c.bar.toFixed(1) + "%" : "";
  if (hasBar && L.bar !== width) node.fill.style.width = width;

  const outer = !!c.isOuter;
  if (L.outer !== outer) node.el.classList.toggle("outer", outer);
  const scopeName = outer ? (c.scopeName === "<module>" ? "module" : c.scopeName) : "";
  if (L.scope !== scopeName) {
    if (scopeName) {
      node.scope.textContent = scopeName;
      node.scope.style.display = "";
    } else {
      node.scope.style.display = "none";
    }
  }

  const line = c.lastLine || 0;
  if (L.line !== line) node.el.setAttribute("data-line", String(line));

  const want = actorStateClass(c, prev);
  node.want = want;
  if (animate && want) {
    spawnParticles(node, want);
    beep(want === "created" ? "create" : "change");
  }
  if (node.index !== index) {
    node.el.style.order = index;
    node.index = index;
  }
  node.last = { name: c.name, value: c.value, type: c.type, avatar: c.avatar, numeric: c.numeric, hasBar, bar: width, outer, scope: scopeName, line };
  if (L.value !== c.value) syncBag(node, c, animate);
}

const BAG_POOL = 6;
const ELLIPSIS = "\u2026";

function setChipText(chip, text, isMore, animate) {
  if (chip._more !== isMore) {
    if (isMore) chip.classList.add("more"); else chip.classList.remove("more");
    chip._more = isMore;
  }
  if (chip._t === text) return;
  chip._t = text;
  chip.textContent = text;
  if (animate === false) return;
  chip.animate(
    [{ transform: "scale(.6)", opacity: 0.4 }, { transform: "scale(1)", opacity: 1 }],
    { duration: 220, easing: "cubic-bezier(.34,1.4,.64,1)" }
  );
}

function bagChip(node, i) {
  let chip = node.chips[i];
  if (!chip) {
    chip = makeDiv("chip");
    node.bag.appendChild(chip);
    node.chips[i] = chip;
  }
  return chip;
}

function showChip(node, i, text, isMore, animate) {
  const chip = bagChip(node, i);
  if (chip._hiding) {
    chip._hiding.cancel();
    chip._hiding = null;
  }
  chip.style.display = "";
  setChipText(chip, text, isMore, animate);
  return chip;
}

function collapseChip(chip, animate) {
  if (chip.style.display === "none" || chip._hiding) return;
  if (!animate) {
    chip.style.display = "none";
    return;
  }
  const anim = chip.animate(
    [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(.35)", opacity: 0 }],
    { duration: 190, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" }
  );
  chip._hiding = anim;
  anim.finished.then(
    () => {
      chip.style.display = "none";
      if (chip._hiding === anim) chip._hiding = null;
    },
    () => {
      if (chip._hiding === anim) chip._hiding = null;
    }
  );
}

export function syncBag(node, c, animate) {
  const items = c.items;
  if (!items || !items.length) {
    if (node.bagOn) {
      node.bag.style.display = "none";
      node.bagOn = false;
    }
    return;
  }
  if (!node.bagOn) {
    node.bag.style.display = "";
    node.bagOn = true;
  }

  const shown = Math.min(items.length, BAG_POOL);
  const rest = items.length - BAG_POOL;
  const hasMore = items.length > BAG_POOL || !!c.itemsTruncated;

  for (let i = 0; i <= BAG_POOL; i++) {
    if (i < shown) {
      showChip(node, i, clip(items[i], 16), false, animate);
    } else if (i === shown && hasMore) {
      const label = c.itemsTruncated ? (rest > 0 ? "+" + rest + ELLIPSIS : ELLIPSIS) : "+" + rest;
      showChip(node, i, label, true, animate);
    } else if (node.chips[i]) {
      collapseChip(node.chips[i], animate);
    }
  }
}

function decimalsOf(repr) {
  const m = String(repr).match(/\.(\d+)$/);
  return m ? Math.min(m[1].length, 4) : 0;
}

function stopNumTween(node) {
  if (node.numRaf) {
    cancelAnimationFrame(node.numRaf);
    node.numRaf = 0;
  }
}

function tweenNumber(node, from, to, repr) {
  stopNumTween(node);
  const dec = decimalsOf(repr);
  const t0 = performance.now();
  const dur = 260;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    if (k >= 1) {
      node.value.textContent = clip(repr, 14);
      node.numRaf = 0;
      return;
    }
    node.value.textContent = (from + (to - from) * k).toFixed(dec);
    node.numRaf = requestAnimationFrame(step);
  };
  node.numRaf = requestAnimationFrame(step);
}

function spawnDelta(node, diff) {
  const el = makeDiv("delta");
  const up = diff > 0;
  if (up) el.classList.add("up"); else el.classList.add("down");
  const mag = Math.round(Math.abs(diff) * 100) / 100;
  el.textContent = (up ? "+" : "-") + mag;
  node.el.appendChild(el);
  const anim = el.animate(
    [
      { translate: "0px 0px", scale: "1", opacity: 0 },
      { translate: "0px -9px", scale: "1.16", opacity: 1, offset: 0.25 },
      { translate: "0px -28px", scale: "1", opacity: 0 }
    ],
    { duration: 900, easing: "ease-out", fill: "forwards" }
  );
  anim.finished.then(() => el.remove(), () => el.remove());
}

const TIMELINE_BUDGET = 300;
const TICK_RANK = { call: 6, ctl: 6, ret: 5, cond: 5, loop: 4, out: 4, assign: 3, expr: 1 };

export let tlTicks = null;
export let tlCursor = null;
export let tlProgress = null;

export function tickClass(type) {
  switch (type) {
    case "assignment": case "collection_mutation": return "assign";
    case "function_call": return "call";
    case "function_return": return "ret";
    case "condition": return "cond";
    case "loop_iteration": return "loop";
    case "output": return "out";
    case "break": case "continue": return "ctl";
    default: return "expr";
  }
}

export function buildTicks(list, budget) {
  const n = list ? list.length : 0;
  if (!n) return [];
  const cap = Math.max(1, budget || TIMELINE_BUDGET);
  const size = Math.max(1, Math.ceil(n / cap));
  const ticks = [];
  for (let i = 0; i < n; i += size) {
    const end = Math.min(n, i + size);
    let best = "expr";
    let bestRank = -1;
    for (let k = i; k < end; k++) {
      const sc = list[k];
      const cls = tickClass(sc && sc.event ? sc.event.type : "");
      const rank = TICK_RANK[cls] || 0;
      if (rank > bestRank) {
        bestRank = rank;
        best = cls;
      }
    }
    ticks.push({ start: i, end: end - 1, cls: best });
  }
  return ticks;
}

export function renderTimeline() {
  if (!timelineEl) return;
  timelineEl.innerHTML = "";
  tlCursor = null;
  tlProgress = null;
  tlTicks = buildTicks(scenes, TIMELINE_BUDGET);
  if (!tlTicks.length) {
    timelineEl.style.display = "none";
    return;
  }
  timelineEl.style.display = "";
  tlProgress = makeDiv("tl-progress");
  timelineEl.appendChild(tlProgress);
  for (const t of tlTicks) {
    const tick = makeDiv("tl-tick " + t.cls);
    tick.setAttribute("data-start", String(t.start));
    tick.setAttribute("data-end", String(t.end));
    timelineEl.appendChild(tick);
  }
  tlCursor = makeDiv("tl-cursor");
  timelineEl.appendChild(tlCursor);
}

export function syncTimelineCursor(i) {
  if (!tlCursor || !steps.length) return;
  const n = steps.length;
  const ratio = n > 1 ? Math.min(1, Math.max(0, i / (n - 1))) : 0;
  const pct = (ratio * 100).toFixed(3) + "%";
  tlCursor.style.left = pct;
  if (tlProgress) tlProgress.style.width = pct;
}

export const roomNodes = new Map();
let cameraScale = 1;
let cameraPending = null;
let staleRooms = [];

function roomLabel(name) {
  return name === "<module>" ? "module" : name;
}

const ROOM_GAP = 14;
export const CAMERA_MIN = 0.6;

function contentHeight() {
  let h = 0;
  let n = 0;
  for (const node of roomNodes.values()) {
    if (!node.el.parentNode) continue;
    h += node.el.offsetHeight || 0;
    n++;
  }
  return n > 1 ? h + (n - 1) * ROOM_GAP : h;
}

/* The camera only zooms OUT, and only as far as the stack actually needs.
   A stack that already fits stays 1:1 instead of shrinking for nothing, and
   the whole stack always fits inside the stage (which clips its overflow). */
function syncRoomEmptiness() {
  for (const node of roomNodes.values()) {
    node.el.classList.toggle("empty", node.body.children.length === 0);
  }
}

function cameraScaleFor() {
  const avail = arenaEl.clientHeight || 0;
  const content = contentHeight();
  if (!avail || !content) return 1;
  const s = avail / content;
  /* a hair under 1 is just rounding/padding noise, not a real overflow */
  if (s >= 0.97) return 1;
  return Math.max(CAMERA_MIN, s);
}

function createRoom(room) {
  const el = makeDiv("room");
  const head = makeDiv("room-head");
  const rname = makeDiv("room-name");
  const rdepth = makeDiv("room-depth");
  head.appendChild(rname);
  head.appendChild(rdepth);
  const body = makeDiv("room-body");
  el.appendChild(head);
  el.appendChild(body);
  const node = { scope: room.scope, el, rname, rdepth, body };
  arenaEl.appendChild(el);
  roomNodes.set(room.scope, node);
  return node;
}

function syncRooms(scene, animate) {
  const rooms = (scene && scene.rooms) || [];
  const seen = new Set();
  let active = null;
  rooms.forEach(function (room, k) {
    seen.add(room.scope);
    const node = roomNodes.get(room.scope) || createRoom(room);
    const label = roomLabel(room.name);
    if (node.rname.textContent !== label) node.rname.textContent = label;
    const depth = k === 0 ? "global scope" : "depth " + k;
    if (node.rdepth.textContent !== depth) node.rdepth.textContent = depth;
    if (!room.isOuter) active = node;
    node.el.classList.toggle("outer", !!room.isOuter);
    node.el.classList.toggle("active", !room.isOuter);
    if (node.el.style.order !== String(k)) node.el.style.order = k;
    const indent = Math.min(k, 4) * 16;
    const ml = indent ? indent + "px" : "";
    if (node.el.style.marginLeft !== ml) node.el.style.marginLeft = ml;
  });
  staleRooms = [];
  for (const [key, node] of Array.from(roomNodes)) {
    if (seen.has(key)) continue;
    staleRooms.push(node);
  }
  cameraPending = { depth: Math.max(0, rooms.length - 1), animate: !!animate, active: active };
}

function dropStaleRooms() {
  for (const node of staleRooms) {
    node.el.remove();
    roomNodes.delete(node.scope);
  }
  staleRooms = [];
}

function applyCamera() {
  const pending = cameraPending;
  cameraPending = null;
  if (!pending) return;
  cameraScale = cameraScaleFor();
  arenaEl.style.transform = cameraScale === 1 ? "" : "scale(" + cameraScale.toFixed(3) + ")";
  if (pending.active && pending.active.el.scrollIntoView) {
    pending.active.el.scrollIntoView({ behavior: pending.animate ? "smooth" : "auto", block: "center" });
  }
}

const PARTICLE_CAP = 10;

function spawnParticles(node, kind) {
  if (!node.parts) node.parts = [];
  const room = PARTICLE_CAP - node.parts.length;
  if (room <= 0) return 0;
  const retire = kind === "retire";
  const count = Math.min(retire ? 6 : (kind === "created" ? 5 : 3), room);
  const spread = retire ? 26 : 18;
  for (let i = 0; i < count; i++) {
    const p = makeDiv("particle " + kind);
    const a = (i / count) * Math.PI * 2;
    const dx = Math.cos(a) * spread;
    const dy = Math.sin(a) * spread * (retire ? 0.7 : 1);
    node.el.appendChild(p);
    node.parts.push(p);
    const anim = p.animate(
      [
        { translate: "0px 0px", scale: "1", opacity: 0 },
        { translate: (dx * 0.65).toFixed(1) + "px " + (dy * 0.65).toFixed(1) + "px", scale: "1", opacity: 1, offset: 0.25 },
        { translate: dx.toFixed(1) + "px " + dy.toFixed(1) + "px", scale: "0.2", opacity: 0 }
      ],
      { duration: retire ? 420 : 520, easing: "ease-out", fill: "forwards" }
    );
    const drop = () => {
      p.remove();
      const k = node.parts.indexOf(p);
      if (k >= 0) node.parts.splice(k, 1);
    };
    anim.finished.then(drop, drop);
  }
  return count;
}

export function showHoverLine(line) {
  if (typeof setHoverLine === "function") setHoverLine(line);
  for (const node of actorNodes.values()) {
    node.el.classList.toggle("same-src", !!line && node.last.line === line);
  }
}

function renderTopHTML(scene) {
  const parts = [];
  if (scene.funcSpace) {
    const fs = scene.funcSpace;
    if (fs.mode === "calling") {
      const args = fs.args.map(a => `${a.name}=${a.value}`).join(", ");
      parts.push(`<div class="func-space">
        <span class="flabel">FUNCTION</span>
        <span class="fname">${esc(fs.name)}()</span>
        <span class="fargs">${esc(args)}</span>
      </div>`);
    } else {
      parts.push(`<div class="func-space returning">
        <span class="flabel">RETURN</span>
        <span class="fname">${esc(fs.name)}()</span>
        <span class="fval">→ ${esc(clip(fs.value || "None", 24))}</span>
      </div>`);
    }
  }
  if (scene.round) {
    const r = scene.round;
    const cnt = r.total ? `${r.index} / ${r.total}` : `Round ${r.index}`;
    const dots = r.total && r.total <= 20
      ? `<div class="round-dots">${Array.from({ length: r.total }, (_, k) => {
          const n = k + 1;
          const cls = n < r.index ? "done" : (n === r.index ? "current" : "");
          return `<span class="round-dot ${cls}"></span>`;
        }).join("")}</div>`
      : "";
    parts.push(`<div class="round-badge">
      <span class="rlabel">LOOP</span>
      <span class="rtext">${esc(r.text)}</span>
      <span class="rnum">${esc(cnt)}</span>
      ${dots}
    </div>`);
  }
  if (scene.event.type === "break" || scene.event.type === "continue") {
    const label = scene.event.type === "break" ? "BREAK · exit loop" : "CONTINUE · skip to next round";
    parts.push(`<div class="round-badge" style="border-color:var(--red)">
      <span class="rlabel" style="color:var(--red)">${label}</span>
    </div>`);
  }
  return parts.join("");
}

function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function flipMove(mutate) {
  const k0 = cameraScale || 1;
  const p0 = arenaEl.getBoundingClientRect();
  const first = new Map();
  for (const node of actorNodes.values()) {
    if (node.dying || !node.el.parentNode) continue;
    const r = node.el.getBoundingClientRect();
    first.set(node, { x: (r.left - p0.left) / k0, y: (r.top - p0.top) / k0 });
  }

  mutate();

  /* the camera may change zoom in the same frame; convert the measurement into
     the LOCAL space of the new zoom so the tween starts exactly where the node
     was drawn (otherwise the FLIP would be off by the zoom ratio). */
  const k1 = cameraScaleFor();
  const w0 = k0 ? p0.width / k0 : p0.width;
  const p1 = arenaEl.getBoundingClientRect();
  const moves = [];
  for (const [node, a] of first) {
    if (node.dying || !node.el.parentNode) continue;
    const r = node.el.getBoundingClientRect();
    const bx = (r.left - p1.left) / k0;
    const by = (r.top - p1.top) / k0;
    const dx = ((w0 / 2) * (k1 - k0) + a.x * k0 - bx * k1) / k1;
    const dy = (a.y * k0 - by * k1) / k1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    moves.push([node, dx, dy]);
  }

  applyCamera();

  for (const [node, dx, dy] of moves) {
    node.el.animate(
      [{ translate: dx + "px " + dy + "px" }, { translate: "0px 0px" }],
      { duration: 300, easing: "cubic-bezier(.34,1.2,.64,1)" }
    );
  }
}

function startRetire(node) {
  stopNumTween(node);
  spawnParticles(node, "retire");
  beep("retire");
  const el = node.el;
  const k = cameraScale || 1;
  const pr = arenaEl.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (el.parentNode !== arenaEl) arenaEl.appendChild(el);
  node.dying = true;
  el.style.position = "absolute";
  el.style.margin = "0";
  el.style.minWidth = "0";
  el.style.left = ((r.left - pr.left) / k) + "px";
  el.style.top = ((r.top - pr.top) / k) + "px";
  el.style.width = (r.width / k) + "px";
  el.style.pointerEvents = "none";
  node.exitAnim = el.animate(
    [
      { opacity: 1, translate: "0px 0px", scale: "1" },
      { opacity: 0, translate: "0px 18px", scale: "0.7" }
    ],
    { duration: 280, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" }
  );
  node.exitAnim.finished.then(
    () => {
      el.remove();
      if (actorNodes.get(node.id) === node) actorNodes.delete(node.id);
    },
    () => {}
  );
}

function reviveActorNode(node) {
  node.dying = false;
  if (node.exitAnim) { node.exitAnim.cancel(); node.exitAnim = null; }
  const s = node.el.style;
  s.position = "";
  s.margin = "";
  s.minWidth = "";
  s.left = "";
  s.top = "";
  s.width = "";
  s.pointerEvents = "";
}

export function syncArena(scene, prevScene, motion) {
  const animate = motion !== "instant" && !reducedMotion();

  const prevMap = new Map();
  if (prevScene) for (const c of prevScene.chars) prevMap.set(c.id, c);

  const seen = new Set();
  for (const c of scene.chars) seen.add(c.id);

  const mutate = () => {
    syncRooms(scene, animate);

    const roomIndex = new Map();
    scene.chars.forEach((c) => {
      let node = actorNodes.get(c.id);
      if (node && node.dying) reviveActorNode(node);
      if (!node) node = createActorNode(c);
      const room = roomNodes.get(c.scope);
      if (room && node.el.parentNode !== room.body) room.body.appendChild(node.el);
      const idx = roomIndex.get(c.scope) || 0;
      roomIndex.set(c.scope, idx + 1);
      updateActorNode(node, c, prevMap.has(c.id) ? prevMap.get(c.id) : null, idx, animate);
    });

    for (const [key, node] of Array.from(actorNodes)) {
      if (seen.has(key) || node.dying) continue;
      if (animate) startRetire(node);
      else { node.el.remove(); actorNodes.delete(key); }
    }

    /* retire first, then drop rooms: a ghost must still be measured while its
       room is attached, or it would fly off to the arena origin. */
    dropStaleRooms();
    syncRoomEmptiness();
  };

  if (animate) flipMove(mutate);
  else mutate();

  rearmStates();
  applyCamera();
}

function rearmStates() {
  let any = false;
  for (const node of actorNodes.values()) {
    if (node.dying) continue;
    if (node.applied) node.el.classList.remove(node.applied);
    node.applied = "";
    if (node.want) any = true;
  }
  if (!any) return;
  void arenaEl.offsetWidth;
  for (const node of actorNodes.values()) {
    if (node.dying || !node.want) continue;
    node.el.classList.add(node.want);
    node.applied = node.want;
  }
}

/* combat animation bookkeeping — owned here, cancelled on demand */
let combatCleanup = null;
let combatStartedAt = 0;
let lastTopSignature = "";

/* app.js resets the world; it must be able to stop a combat that is mid-flight */
export function cancelCombat() {
  if (combatCleanup) { combatCleanup(); combatCleanup = null; }
}

export function resetWorld() {
  lastTopSignature = "";
  stopOutType();
  outNode = null;
  outTarget = "";
  wtopEl.innerHTML = "";
  outSlotEl.innerHTML = "";
  outSlotEl.style.display = "";
  timelineEl.innerHTML = "";
  timelineEl.style.display = "none";
  showHoverLine(0);
  tlTicks = null;
  tlCursor = null;
  tlProgress = null;
  for (const node of actorNodes.values()) {
    stopNumTween(node);
    if (node.exitAnim) node.exitAnim.cancel();
    node.el.remove();
  }
  actorNodes.clear();
  for (const room of roomNodes.values()) {
    room.el.remove();
    room.body.innerHTML = "";
  }
  roomNodes.clear();
  staleRooms = [];
  cameraPending = null;
  cameraScale = 1;
  arenaEl.style.transform = "";
}


export let outNode = null;
let outTarget = "";
let outRaf = 0;
let lastStageError = false;

function stopOutType() {
  if (outRaf) {
    cancelAnimationFrame(outRaf);
    outRaf = 0;
  }
}

function typeStep() {
  outRaf = 0;
  if (!outNode) return;
  const cur = outNode.textContent;
  if (cur.length >= outTarget.length) return;
  const step = Math.max(2, Math.ceil((outTarget.length - cur.length) / 6));
  outNode.textContent = outTarget.slice(0, cur.length + step);
  if (outNode.textContent.length < outTarget.length) outRaf = requestAnimationFrame(typeStep);
}

export function syncOutput(text, animate) {
  if (!outNode) {
    outNode = makeDiv("out-float");
    outSlotEl.appendChild(outNode);
  }
  const target = text || "";
  if (!target) {
    stopOutType();
    outTarget = "";
    outNode.textContent = "";
    outSlotEl.style.display = "none";
    return;
  }
  outSlotEl.style.display = "";
  const cur = outNode.textContent;
  if (target === cur) {
    outTarget = target;
    return;
  }
  if (target.indexOf(cur) !== 0) {
    stopOutType();
    outTarget = target;
    outNode.textContent = target;
    return;
  }
  outTarget = target;
  if (!animate) {
    stopOutType();
    outNode.textContent = target;
    return;
  }
  if (!outRaf) outRaf = requestAnimationFrame(typeStep);
}

export function syncErrorDrama(on) {
  if (on === lastStageError) return;
  lastStageError = on;
  const el = $("stage");
  el.classList.remove("error");
  if (on) {
    void el.offsetWidth;
    el.classList.add("error");
    beep("error");
  }
}

function renderWorld(scene, prevScene, motion) {
  worldIdleEl.style.display = "none";

  const topHTML = renderTopHTML(scene);
  if (topHTML !== lastTopSignature) {
    lastTopSignature = topHTML;
    wtopEl.innerHTML = topHTML;
  }

  syncArena(scene, prevScene, motion);

  syncOutput(scene.output || "", motion !== "instant" && !reducedMotion());
}

/* ============ FIX #2 — combat animation that lasts 2.6s ============
   Phases:
     0ms    box appears
     200ms  both fighters charge toward center
     700ms  💥 collision
     850ms  TRUE/FALSE result revealed
     1700ms winner celebrates, loser reels
     2300ms box fades out
     2600ms fully removed
   The animation has its OWN lifecycle — renderStage never wipes it. */
function showCombat(scene, isBackward) {
  // Backward scrub → never replay, just clean up whatever is showing
  if (isBackward) {
    if (combatCleanup) { combatCleanup(); combatCleanup = null; }
    return;
  }
  if (!scene.combat) return;

  // Guard: don't restart the same combat if it just started
  const now = Date.now();
  if (combatCleanup && now - combatStartedAt < 900) return;

  // Clean any prior combat before starting a new one
  if (combatCleanup) { combatCleanup(); combatCleanup = null; }

  const c = scene.combat;
  const branch = c.branch;
  beep("combat");

  vsLayerEl.innerHTML = `
    <div class="vs-box" id="vsBox">
      <div class="vs-fighter left" id="vsLeft">
        ${c.left.avatar}
        <span class="fval">${esc(clip(c.left.value, 12))}</span>
        <span class="flabel">${esc(c.left.name)}</span>
      </div>
      <div class="vs-mid">
        <div class="vs-op">${esc(vsOpLabel(c))}</div>
        <div class="vs-boom" id="vsBoom">💥</div>
        ${vsChainHTML(c)}
      </div>
      <div class="vs-fighter right" id="vsRight">
        ${c.right.avatar}
        <span class="fval">${esc(clip(c.right.value, 12))}</span>
        <span class="flabel">${esc(c.right.name)}</span>
      </div>
      <div id="vsResultWrap"></div>
    </div>
  `;

  const box = $("vsBox");
  const left = $("vsLeft");
  const right = $("vsRight");
  const boom = $("vsBoom");
  const resultWrap = $("vsResultWrap");

  combatStartedAt = now;
  const timers = [];
  const at = (t, fn) => timers.push(setTimeout(fn, t));

  requestAnimationFrame(() => {
    box.classList.add("show");

    at(200, () => {
      left.classList.add("charge");
      right.classList.add("charge");
    });

    at(700, () => {
      boom.classList.add("show");
    });

    at(850, () => {
      if (branch) {
        resultWrap.innerHTML =
          `<div class="vs-result ${branch} show">` +
          (branch === "true" ? "TRUE ✓" : "FALSE ✗") +
          `</div>`;
      }
      applyCombatOutcome(scene);
    });

    at(1700, () => {
      if (branch === "true") {
        left.classList.add("win");
        right.classList.add("lose");
      } else if (branch === "false") {
        left.classList.add("lose");
        right.classList.add("win");
      }
    });

    at(2300, () => {
      box.classList.remove("show");
    });

    at(2600, () => {
      vsLayerEl.innerHTML = "";
      arenaEl.querySelectorAll(".winner, .loser").forEach(el => {
        el.classList.remove("winner", "loser");
      });
      combatCleanup = null;
    });
  });

  combatCleanup = () => {
    timers.forEach(t => clearTimeout(t));
    vsLayerEl.innerHTML = "";
    arenaEl.querySelectorAll(".winner, .loser").forEach(el => {
      el.classList.remove("winner", "loser");
    });
  };
}

export function vsOpLabel(c) {
  if (c.parts && c.parts.length > 1) return c.tree && c.tree.kind === "or" ? "OR" : "AND";
  if (c.tree && c.tree.kind === "not") return "NOT";
  return c.op;
}

export function vsChainHTML(c) {
  const parts = c.parts || [];
  if (parts.length < 2) return "";
  const chips = parts.map(function (p) {
    const cls = p.ok === true ? "ok" : (p.ok === false ? "bad" : "unk");
    return '<span class="vs-chip ' + cls + '">' + esc(clip(p.expr, 22)) + "</span>";
  }).join("");
  return '<div class="vs-chain">' + chips + "</div>";
}

function combatEl(side) {
  if (side.id) {
    const byId = arenaEl.querySelector('[data-entity="' + CSS.escape(side.id) + '"]');
    if (byId) return byId;
  }
  return arenaEl.querySelector('[data-char="' + CSS.escape(side.name) + '"]');
}

export function applyCombatOutcome(scene) {
  const c = scene.combat;
  if (!c.branch) return;
  const leftEl = combatEl(c.left);
  const rightEl = combatEl(c.right);
  if (c.branch === "true") {
    if (leftEl) leftEl.classList.add("winner");
    if (rightEl) rightEl.classList.add("loser");
  } else if (c.branch === "false") {
    if (leftEl) leftEl.classList.add("loser");
    if (rightEl) rightEl.classList.add("winner");
  }
}

/* ----------------------- details drawer ------------------------ */
function lineText(n) {
  if (!editor || !editor.getModel() || n < 1) return "";
  if (n > editor.getModel().getLineCount()) return "";
  return editor.getModel().getLineContent(n);
}
const EVENT_CLASS = { call: "start", return: "ret" };
function evClass(e) { return EVENT_CLASS[e] || "hi"; }

export function renderDetails(i) {
  const total = steps.length;
  const has = total > 0 && i >= 0 && i < total;
  const label = total ? "step " + (has ? i + 1 : 0) + " / " + total : "step 0 / 0";
  stepPill.textContent = label;
  drawerMeta.textContent = label;

  scrub.max = Math.max(0, total - 1);
  scrub.value = has ? i : 0;
  scrub.disabled = total === 0;

  if (!has) {
    nowLn.innerHTML = "&ndash;";
    nowCode.textContent = total ? "Trace collected. Use Step or Play." : "Press Run to trace this program.";
    nowMeta.innerHTML = "";
    varsEl.innerHTML = '<div class="frames"><div class="empty">no variables in scope</div></div>';
    varCount.textContent = "";
    framesEl.innerHTML = '<div class="frames"><div class="empty">no frames yet</div></div>';
    stdoutEl.innerHTML = '<span class="none">program has not run yet</span>';
    errBox.innerHTML = "";
    return;
  }

  const s = steps[i];
  const prev = i > 0 ? steps[i - 1] : null;

  nowLn.textContent = s.l;
  nowCode.textContent = lineText(s.l) || "(line " + s.l + ")";
  nowMeta.innerHTML =
    '<span class="chipx ' + evClass(s.e) + '">' + esc(s.e) + "</span>" +
    '<span class="chipx">' + esc(s.f === "<module>" ? "module level" : s.f + "()") + "</span>" +
    '<span class="chipx">depth ' + s.d + "</span>" +
    '<span class="chipx">' + Object.keys(s.v || {}).length + " variable(s)</span>";

  const names = Object.keys(s.v || {}).sort();
  if (!names.length) {
    varsEl.innerHTML = '<div class="frames"><div class="empty">no variables in scope</div></div>';
    varCount.textContent = "";
  } else {
    varsEl.innerHTML = names.map(n => {
      const pair = s.v[n];
      const before = prev && prev.i === s.i && prev.v ? prev.v[n] : undefined;
      const changed = !before || before[1] !== pair[1] || before[0] !== pair[0];
      return '<div class="var' + (changed ? " changed" : "") + '">' +
        '<div class="top"><span class="vname">' + esc(n) + '</span><span class="vtype">' + esc(pair[0]) + "</span></div>" +
        '<div class="vval">' + esc(pair[1]) + "</div></div>";
    }).join("");
    varCount.textContent = names.length + " in scope";
  }

  const st = stacks[i] || [];
  framesEl.innerHTML = st.length
    ? st.slice().reverse().map((f, idx) =>
        '<div class="frame' + (idx === 0 ? " current" : "") + '">' +
        '<span class="fname">' + esc(f.f === "<module>" ? "module" : f.f) + "</span>" +
        '<span class="fline">line ' + f.l + "</span></div>"
      ).join("")
    : '<div class="empty">no frames yet</div>';

  const out = outputs[i] || "";
  stdoutEl.innerHTML = out ? esc(out) : '<span class="none">no output yet</span>';
  if (i === total - 1) stdoutEl.innerHTML += '<span class="cursor"></span>';

  errBox.innerHTML = "";
  if (i === total - 1) {
    if (error) errBox.innerHTML = '<div class="err"><div class="etitle">' + esc(error.type) + ": " + esc(error.msg) +
      "</div><pre>" + esc(error.tb) + "</pre></div>";
    else if (limit) {
      const what = limit.kind === "seconds"
        ? "after " + limit.seconds + "s"
        : "at the " + limit.steps + "-step demo limit";
      errBox.innerHTML = '<div class="err"><div class="etitle">Stopped ' + what + "</div>" +
        "<pre>This is the demo budget, not a mistake in the program.\n" +
        "A loop that never ends is the usual cause.</pre></div>";
    }
    else if (truncated) {
      errBox.innerHTML = '<div class="err"><div class="etitle">Trace truncated</div>' +
        "<pre>Execution stopped after " + total + " steps. Check for an infinite loop.</pre></div>";
    }
  }

  const scene = scenes[i] || { event: { type: "expression", line: 1 } };
  const b = bannerText(scene);
  $("ebKind").textContent = b.kind;
  $("ebKind").className = "eb-kind " + (events[i] ? events[i].type : "");
  $("ebText").textContent = b.text;
}

export function bannerText(scene) {
  const ev = scene.event;
  switch (ev.type) {
    case "assignment": {
      const c = ev.changes[0];
      if (c.action === "create") return { kind: "Spawn", text: `${c.name} appears = ${c.after}` };
      if (c.action === "update") return { kind: "Change", text: `${c.name}: ${c.before} → ${c.after}` };
      if (c.action === "delete") return { kind: "Vanish", text: `${c.name} removed` };
      return { kind: "Assign", text: c.name };
    }
    case "collection_mutation": {
      const c = ev.changes[0];
      if (c.action === "update")
        return { kind: "Bag", text: `${c.name}: ${clip(c.before, 24)} → ${clip(c.after, 24)}` };
      return { kind: "Bag", text: c.name };
    }
    case "function_call": {
      const names = Object.keys(ev.args || {}).filter(k => !k.startsWith("__"));
      const a = names.slice(0, 3).map(k => ev.args[k][1]).join(", ");
      return { kind: "Call", text: `${ev.name}(${a}${names.length > 3 ? ", …" : ""})` };
    }
    case "function_return":
      return { kind: "Return", text: `${ev.name}() → ${ev.value || "None"}` };
    case "condition": {
      if (scene.combat && scene.combat.branch) {
        const parts = scene.combat.parts || [];
        const label = parts.length > 1
          ? clip(ev.expr, 70)
          : scene.combat.left.name + " " + scene.combat.op + " " + scene.combat.right.name;
        return { kind: "Combat", text: label + " → " + scene.combat.branch.toUpperCase() };
      }
      return { kind: "Check", text: ev.expr };
    }
    case "loop_iteration": {
      if (scene.round) {
        const cnt = scene.round.total ? `${scene.round.index} / ${scene.round.total}` : `round ${scene.round.index}`;
        return { kind: "Loop", text: `${ev.text} — ${cnt}` };
      }
      return { kind: "Loop", text: ev.text };
    }
    case "output": return { kind: "Output", text: clip(ev.text, 80) };
    case "break": return { kind: "Break", text: "exit loop" };
    case "continue": return { kind: "Continue", text: "skip to next round" };
    default: return { kind: "Line", text: "line " + ev.line };
  }
}

/* ------------------------------ stage go ---------------------------- */
export function renderStage(i, prevIdx, motion) {
  const total = steps.length;
  const has = total > 0 && i >= 0 && i < total;

  if (!has) {
    resetWorld();
    syncErrorDrama(false);
    worldIdleEl.style.display = "flex";
    if (combatCleanup) { combatCleanup(); combatCleanup = null; }
    $("ebKind").textContent = "Ready";
    $("ebKind").className = "eb-kind";
    $("ebText").textContent = steps.length
      ? "Trace collected. Use Step or Play."
      : "Press Run to trace this program.";
    framePill.textContent = "no frame";
    return;
  }

  const scene = scenes[i];
  const prevScene = (prevIdx >= 0 && prevIdx < total) ? scenes[prevIdx] : null;
  const isBackward = prevIdx > i;

  renderWorld(scene, prevScene, motion);
  syncErrorDrama(i === total - 1 && !!error);
  syncTimelineCursor(i);
  framePill.textContent = scene.chars.length + " char" + (scene.chars.length === 1 ? "" : "s");

  /* Combat has its own lifecycle now. renderStage never clears vsLayer. */
  if (scene.combat) {
    showCombat(scene, isBackward || motion === "instant");
  }
  // NOTE: when there's no combat, we deliberately do NOT wipe the layer.
  // The previous animation keeps running until its 2.6s lifecycle ends.
}
