/* @deps: dom.js */
import { $, on } from "./dom.js";
/* =====================================================================
   The output window.

   A run can leave pictures behind: matplotlib figures, pygame frames, or the
   strokes a turtle recorded.  They all land here, and each kind knows how to
   play itself: figures are just an image, frames are stepped through like a
   film, turtle strokes are drawn one at a time.
   ===================================================================== */

let views = [];
let index = 0;
let pos = 0;
let playing = false;
let timer = null;

const TICK_MS = { figure: 0, frames: 60, turtle: 26 };

function canvasSize(view) {
  const s = view && view.size && view.size.length === 2 ? view.size : [480, 360];
  return { w: s[0] || 480, h: s[1] || 360 };
}

function colorOf(c) {
  if (!c) return "#000";
  if (typeof c === "string") return c;
  if (Array.isArray(c) && c.length >= 3) {
    const n = c.map(v => Math.max(0, Math.min(255, Math.round(v))));
    return "rgb(" + n[0] + "," + n[1] + "," + n[2] + ")";
  }
  return "#000";
}

/* turtle coordinates: origin in the middle, y pointing up */
function fitTransform(ops, size, cssW, cssH) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  ops.forEach(function (op) {
    const pts = op.pts || [[op.x || 0, op.y || 0]];
    pts.forEach(function (p) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    });
  });
  if (!isFinite(minX)) { minX = -size.w / 2; maxX = size.w / 2; minY = -size.h / 2; maxY = size.h / 2; }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const pad = 14;
  const scale = Math.min((cssW - pad * 2) / spanX, (cssH - pad * 2) / spanY, 1.6);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    scale: scale,
    map: function (x, y) {
      return [(x - cx) * scale + cssW / 2, cssH / 2 - (y - cy) * scale];
    }
  };
}

function paintTurtle(canvas, view, upto) {
  const ctx = canvas.getContext("2d");
  const cs = canvasSize(view);
  const cssW = canvas.clientWidth || cs.w;
  const cssH = canvas.clientHeight || cs.h;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = view.bg && typeof view.bg === "string" ? view.bg : "#ffffff";
  ctx.fillRect(0, 0, cssW, cssH);

  const ops = (view.ops || []).slice(0, upto);
  const lastClear = ops.map(o => o.t).lastIndexOf("clear");
  const visible = lastClear >= 0 ? ops.slice(lastClear + 1) : ops;
  const T = fitTransform(visible, cs, cssW, cssH);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  /* fills first: the outline is drawn on top of them, as turtle does */
  visible.forEach(function (op) {
    if (op.t !== "fill") return;
    const pts = op.pts || [];
    if (pts.length < 3) return;
    ctx.beginPath();
    pts.forEach(function (p, i) {
      const m = T.map(p[0], p[1]);
      if (i === 0) ctx.moveTo(m[0], m[1]); else ctx.lineTo(m[0], m[1]);
    });
    ctx.closePath();
    ctx.fillStyle = colorOf(op.color);
    ctx.fill();
  });

  visible.forEach(function (op) {
    if (op.t === "line") {
      const pts = op.pts || [];
      if (pts.length < 2) return;
      ctx.beginPath();
      pts.forEach(function (p, i) {
        const m = T.map(p[0], p[1]);
        if (i === 0) ctx.moveTo(m[0], m[1]); else ctx.lineTo(m[0], m[1]);
      });
      ctx.strokeStyle = colorOf(op.color);
      ctx.lineWidth = Math.max(1, (op.w || 1) * T.scale);
      ctx.stroke();
    } else if (op.t === "dot") {
      const m = T.map(op.x || 0, op.y || 0);
      ctx.beginPath();
      ctx.arc(m[0], m[1], Math.max(1.5, (op.r || 2) * T.scale), 0, Math.PI * 2);
      ctx.fillStyle = colorOf(op.color);
      ctx.fill();
    } else if (op.t === "text") {
      const m = T.map(op.x || 0, op.y || 0);
      ctx.fillStyle = colorOf(op.color);
      ctx.font = Math.max(9, (op.size || 12) * T.scale) + "px ui-sans-serif,system-ui,sans-serif";
      ctx.textAlign = op.align === "center" ? "center" : (op.align === "right" ? "right" : "left");
      ctx.textBaseline = "middle";
      ctx.fillText(op.s || "", m[0], m[1]);
    }
  });
}

/* ------------------------------- controls ---------------------------- */
function stop() {
  playing = false;
  if (timer) { clearInterval(timer); timer = null; }
  const btn = $("viewPlay");
  if (btn) btn.textContent = "Play";
}

function steps() {
  const v = views[index];
  if (!v) return 0;
  if (v.kind === "frames") return (v.frames || []).length;
  if (v.kind === "turtle") return (v.ops || []).length;
  return 1;
}

function paint() {
  const v = views[index];
  const body = $("viewBody");
  if (!v || !body) return;
  const count = steps();
  const scrub = $("viewScrub");
  if (scrub) {
    scrub.max = String(Math.max(0, count - 1));
    scrub.value = String(Math.min(pos, Math.max(0, count - 1)));
  }
  if ($("viewCount")) $("viewCount").textContent = count > 1 ? (Math.min(pos + 1, count) + " / " + count) : "";

  if (v.kind === "frames") {
    const img = $("viewImg");
    if (img) img.src = "data:image/png;base64," + ((v.frames || [])[pos] || "");
  } else if (v.kind === "turtle") {
    const canvas = $("viewCanvas");
    if (canvas) paintTurtle(canvas, v, pos + 1);
  }
}

function advance() {
  const count = steps();
  pos++;
  if (pos >= count) {
    pos = count - 1;
    stop();
  }
  paint();
}

function play() {
  stop();
  const v = views[index];
  if (!v) return;
  const count = steps();
  if (count <= 1) return;
  if (pos >= count - 1) pos = 0;
  playing = true;
  const btn = $("viewPlay");
  if (btn) btn.textContent = "Pause";
  timer = setInterval(advance, TICK_MS[v.kind] || 60);
  advance();
}

function build() {
  const v = views[index];
  const body = $("viewBody");
  if (!v || !body) return;
  pos = 0;
  if (v.kind === "figure") {
    body.innerHTML = '<img id="viewImg" class="view-shot" alt="">';
    $("viewImg").src = "data:image/png;base64," + (v.png || "");
  } else if (v.kind === "frames") {
    body.innerHTML = '<img id="viewImg" class="view-shot" alt="">';
    paint();
  } else {
    const cs = canvasSize(v);
    body.innerHTML = '<canvas id="viewCanvas" class="view-canvas" style="aspect-ratio:' +
      cs.w + "/" + cs.h + '"></canvas>';
    requestAnimationFrame(() => paint());
  }
  const tabs = $("viewTabs");
  if (tabs) {
    tabs.innerHTML = views.length > 1 ? views.map(function (w, i) {
      return '<button class="mtab' + (i === index ? " on" : "") + '" data-i="' + i + '">' +
        (w.kind === "turtle" ? "turtle" : w.kind === "frames" ? "game" : "figure " + (i + 1)) + "</button>";
    }).join("") : "";
  }
  if ($("viewTitle")) {
    $("viewTitle").textContent = v.kind === "turtle" ? "Turtle drawing"
      : v.kind === "frames" ? "Animation (" + (v.frames || []).length + " frames)"
      : "Figure" + (views.length > 1 ? " " + (index + 1) : "");
  }
  paint();
}

export function closeViews() {
  stop();
  const modal = $("viewModal");
  if (modal) modal.classList.remove("show");
  const body = $("viewBody");
  if (body) body.innerHTML = "";
}

export function openViews(list) {
  if (!list || !list.length) return;
  views = list;
  index = 0;
  const modal = $("viewModal");
  if (!modal) return;
  modal.classList.add("show");
  build();
  /* pictures are the point: play an animation straight away */
  const v = views[0];
  if (v && (v.kind === "frames" || v.kind === "turtle") && steps() > 1) play();
}

export function initViews() {
  const modal = $("viewModal");
  if (!modal) return;
  const close = $("viewClose");
  if (close) close.addEventListener("click", closeViews);
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeViews();
  });
  const play = $("viewPlay");
  if (play) play.addEventListener("click", function () { if (playing) stop(); else play(); });
  const scrub = $("viewScrub");
  if (scrub) scrub.addEventListener("input", function () { stop(); pos = Number(scrub.value) || 0; paint(); });
  const tabs = $("viewTabs");
  if (tabs) {
    tabs.addEventListener("click", function (e) {
      const b = e.target && e.target.closest ? e.target.closest(".mtab") : null;
      if (!b) return;
      stop();
      index = Number(b.getAttribute("data-i")) || 0;
      build();
      const v = views[index];
      if (v && (v.kind === "frames" || v.kind === "turtle") && steps() > 1) play();
    });
  }
  on(document, "keydown", function (e) {
    if (!modal.classList.contains("show")) return;
    if (e.key === "Escape") { e.preventDefault(); closeViews(); }
    else if (e.key === " ") { e.preventDefault(); if (playing) stop(); else play(); }
  }, true);
  on(window, "resize", function () {
    if (modal.classList.contains("show") && views[index] && views[index].kind === "turtle") paint();
  });
}
