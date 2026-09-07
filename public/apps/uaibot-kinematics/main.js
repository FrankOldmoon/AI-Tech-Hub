/**
 * UAIBot 机械臂运动学演示（本地化封装 v2：关节空间 + IK 拖拽 + 轨迹播放）
 * - 上游：github.com/UAIbot/UAIbotJS @ f4a367d（MIT），three/mathjs 已本地化
 * - 模式：
 *   1) 关节空间 —— 6 个关节角滑块，FKM 正运动学实时读数
 *   2) IK 拖拽   —— 拖动绿色目标球，数值 IK（阻尼最小二乘）反解 6 关节角
 *   3) 轨迹播放   —— 末端沿预设轨迹（水平圆 / 8 字 / 竖直圆 / 直线往复）运动
 * - 教学边界：运动学几何演示，非碰撞/动力学/真实硬件仿真
 */
import * as UAIbot from "./lib/UAIbot.local.js";
import * as THREE from "three";
import * as math from "mathjs";
import { createIkSolver } from "./ik.js";

const JOINT_NAMES = ["q1", "q2", "q3", "q4", "q5", "q6"];
const RAD = Math.PI / 180;

const sim = new UAIbot.Simulation();
const bot = new UAIbot.Robot().create_kuka_kr5();
sim.add(bot);

let currentDeg = [0, 0, 0, 0, 0, 0];
bot.config(math.matrix(currentDeg.map((d) => d * RAD)));

const ikSolver = createIkSolver(bot, sim.scene);

// ---------- DOM ----------
const jointsEl = document.getElementById("joints");
const poseEl = document.getElementById("pose");

// ---------- 模式切换 ----------
let mode = "joint"; // 'joint' | 'ik' | 'traj'
const modeBtns = {
  joint: document.getElementById("modeJoint"),
  ik: document.getElementById("modeIk"),
  traj: document.getElementById("modeTraj"),
};
const modeSections = {
  joint: document.getElementById("jointMode"),
  ik: document.getElementById("ikMode"),
  traj: document.getElementById("trajMode"),
};

function setMode(m) {
  if (mode === "traj") stopTraj();
  mode = m;
  Object.entries(modeBtns).forEach(([k, el]) => {
    el.classList.toggle("active", k === m);
  });
  Object.entries(modeSections).forEach(([k, el]) => {
    el.style.display = k === m ? "" : "none";
  });
  if (m === "ik") {
    const ee = ikSolver.currentEE();
    ikTarget.set(ee[0], ee[1], ee[2]);
    marker.visible = true;
    marker.position.copy(ikTarget);
    ikZSlider.value = clamp(ee[2], 0.08, 0.9).toFixed(2);
    ikZVal.textContent = `${ikZSlider.value} m`;
    updateIkReadout();
  } else {
    marker.visible = m === "traj";
  }
}

Object.entries(modeBtns).forEach(([k, el]) => {
  el.addEventListener("click", () => setMode(k));
});

// ---------- 关节滑块 ----------
function buildJointUI(i) {
  const wrap = document.createElement("div");
  wrap.className = "joint";
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<span><b>${JOINT_NAMES[i]}</b></span><span id="qval${i}">0°</span>`;
  const input = document.createElement("input");
  input.type = "range";
  input.min = -180;
  input.max = 180;
  input.value = 0;
  input.step = 1;
  input.addEventListener("input", () => {
    currentDeg[i] = Number(input.value);
    document.getElementById(`qval${i}`).textContent = `${input.value}°`;
    applyJoints();
    if (mode === "ik") {
      const ee = ikSolver.currentEE();
      ikTarget.set(ee[0], ee[1], ee[2]);
      marker.position.copy(ikTarget);
    }
  });
  wrap.appendChild(row);
  wrap.appendChild(input);
  jointsEl.appendChild(wrap);
}
for (let i = 0; i < 6; i++) buildJointUI(i);

function syncJointUI() {
  document.querySelectorAll("#joints input[type=range]").forEach((el, i) => {
    const v = Math.round(currentDeg[i]);
    el.value = v;
    document.getElementById(`qval${i}`).textContent = `${v}°`;
  });
}

function applyJoints() {
  bot.config(math.matrix(currentDeg.map((d) => d * RAD)));
  updateReadout();
}

function updateReadout() {
  try {
    const T = bot.fkm()._data;
    const x = (T[0][3] * 1000).toFixed(0);
    const y = (T[1][3] * 1000).toFixed(0);
    const z = (T[2][3] * 1000).toFixed(0);
    poseEl.textContent = `x: ${x} mm   y: ${y} mm   z: ${z} mm`;
    if (mode === "ik") updateIkReadout();
  } catch (e) {
    /* 模型尚未就绪时忽略 */
  }
}

// ---------- 复位 ----------
document.getElementById("resetBtn").addEventListener("click", () => {
  stopTraj();
  currentDeg = [0, 0, 0, 0, 0, 0];
  syncJointUI();
  applyJoints();
  if (mode === "ik") {
    const ee = ikSolver.currentEE();
    ikTarget.set(ee[0], ee[1], ee[2]);
    marker.position.copy(ikTarget);
  }
});

// ---------- 场景对象：目标球 / 轨迹线 ----------
const marker = new THREE.Mesh(
  new THREE.SphereGeometry(0.03, 24, 16),
  new THREE.MeshStandardMaterial({
    color: 0x16a34a,
    emissive: 0x166534,
    emissiveIntensity: 0.55,
  })
);
marker.visible = false;
sim.scene.add(marker);

const markerRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.045, 0.004, 10, 40),
  new THREE.MeshBasicMaterial({ color: 0x16a34a })
);
markerRing.rotation.x = Math.PI / 2;
marker.add(markerRing);

let pathLine = null;
function buildPathLine(points) {
  if (pathLine) {
    sim.scene.remove(pathLine);
    pathLine.geometry.dispose();
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  pathLine = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.8 })
  );
  sim.scene.add(pathLine);
}

// ---------- IK 目标（世界坐标，米） ----------
const ikTarget = new THREE.Vector3(0.3, 0.2, 0.5);
const ikZSlider = document.getElementById("ikZ");
const ikZVal = document.getElementById("ikZVal");
const ikErrEl = document.getElementById("ikErr");
const ikTargetEl = document.getElementById("ikTargetPos");
let ikErr = 1;
let lastIkTargetKey = "";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clampToWorkspace(v3) {
  v3.z = clamp(v3.z, 0.08, 0.9);
  const d = Math.hypot(v3.x, v3.y);
  if (d > 0.85) {
    v3.x *= 0.85 / d;
    v3.y *= 0.85 / d;
  }
  return v3;
}

function updateIkReadout() {
  const t = ikTarget;
  ikTargetEl.textContent = `x: ${(t.x * 1000).toFixed(0)}   y: ${(t.y * 1000).toFixed(0)}   z: ${(t.z * 1000).toFixed(0)} mm`;
  ikErrEl.textContent = `${(ikErr * 1000).toFixed(1)} mm`;
}

ikZSlider.addEventListener("input", () => {
  ikZVal.textContent = `${ikZSlider.value} m`;
  ikTarget.z = Number(ikZSlider.value);
  clampToWorkspace(ikTarget);
  marker.position.copy(ikTarget);
});

function ikTick() {
  clampToWorkspace(ikTarget);
  const key = ikTarget.toArray().map((v) => v.toFixed(5)).join(",");
  if (ikErr < 0.0006 && key === lastIkTargetKey) {
    updateReadout();
    return;
  }
  lastIkTargetKey = key;
  const iters = ikErr > 0.015 ? 18 : ikErr > 0.003 ? 8 : 4;
  const res = ikSolver.solve([ikTarget.x, ikTarget.y, ikTarget.z], currentDeg, iters);
  ikErr = res.err;
  currentDeg = res.qDeg;
  syncJointUI();
  updateReadout();
}

// ---------- 拖拽目标球（raycast 到过目标高度的水平面） ----------
const canvas = sim.canvas;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let ikDragging = false;

function setRay(e) {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, sim.camera);
}

function planeAtZ(z) {
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
  const pt = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, pt);
  return pt;
}

canvas.addEventListener("pointerdown", (e) => {
  if (mode !== "ik") return;
  setRay(e);
  const hits = raycaster.intersectObject(marker, false);
  if (hits.length > 0) {
    ikDragging = true;
    sim.controls.enabled = false;
    canvas.style.cursor = "grabbing";
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!ikDragging) return;
  setRay(e);
  const pt = planeAtZ(ikTarget.z);
  if (pt) {
    ikTarget.x = pt.x;
    ikTarget.y = pt.y;
    clampToWorkspace(ikTarget);
    marker.position.copy(ikTarget);
  }
});

function endDrag() {
  if (ikDragging) {
    ikDragging = false;
    sim.controls.enabled = true;
    canvas.style.cursor = "";
  }
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

// ---------- 轨迹播放 ----------
const trajShapeEl = document.getElementById("trajShape");
const trajRadiusEl = document.getElementById("trajRadius");
const trajRadiusVal = document.getElementById("radiusVal");
const trajPeriodEl = document.getElementById("trajPeriod");
const trajPeriodVal = document.getElementById("periodVal");
const trajPlayBtn = document.getElementById("trajPlay");
const trajResetBtn = document.getElementById("trajReset");
const trajStatus = document.getElementById("trajStatus");

let trajCenter = null;
let trajPlaying = false;
let trajPos = 0; // 0..1
let lastTs = null;
let trajStarted = false;

function trajPoint(t) {
  const r = Number(trajRadiusEl.value);
  const c = trajCenter || { x: 0.4, y: 0, z: 0.4 };
  const a = t * Math.PI * 2;
  const shape = trajShapeEl.value;
  let p;
  if (shape === "circle") p = [c.x + r * Math.cos(a), c.y + r * Math.sin(a), c.z];
  else if (shape === "fig8") p = [c.x + r * Math.sin(a), c.y + r * 0.55 * Math.sin(2 * a), c.z];
  else if (shape === "vcircle") p = [c.x + r * Math.cos(a), c.y, c.z + r * Math.sin(a)];
  else p = [c.x + r * Math.cos(a), c.y, c.z]; // line 往复
  // 把轨迹点钳制在工作空间内，保证 IK 始终可达
  const radial = Math.hypot(p[0], p[1]);
  const maxRadial = 0.82;
  if (radial > maxRadial) {
    p[0] *= maxRadial / radial;
    p[1] *= maxRadial / radial;
  }
  p[2] = clamp(p[2], 0.1, 0.88);
  return p;
}

function rebuildPath() {
  if (!trajCenter) return;
  const pts = [];
  const seg = 240;
  for (let i = 0; i <= seg; i++) pts.push(trajPoint(i / seg));
  buildPathLine(pts);
}

function stopTraj() {
  trajPlaying = false;
  trajPlayBtn.textContent = "播放";
  if (pathLine) pathLine.visible = mode === "traj";
}

function startTraj() {
  const ee = ikSolver.currentEE();
  const r = Number(trajRadiusEl.value);
  // 圆心放在工作空间中部（不贴近边缘），保证整条轨迹可达
  const radial = Math.hypot(ee[0], ee[1]);
  const centerMaxRadial = Math.max(0.28, 0.58 - r * 1.2);
  const k = radial > centerMaxRadial ? centerMaxRadial / radial : 1;
  trajCenter = {
    x: ee[0] * k,
    y: ee[1] * k,
    z: clamp(ee[2], 0.3 + r, 0.72 - r),
  };
  rebuildPath();
  const start = trajPoint(0);
  const res = ikSolver.solve(start, currentDeg, 120);
  currentDeg = res.qDeg;
  syncJointUI();
  updateReadout();
  trajPos = 0;
  trajStarted = true;
  marker.position.set(start[0], start[1], start[2]);
  lastTs = performance.now();
}

function trajTick() {
  if (!trajPlaying || !trajCenter) return;
  const now = performance.now();
  const dt = lastTs == null ? 0 : (now - lastTs) / 1000;
  lastTs = now;
  const period = Number(trajPeriodEl.value);
  trajPos = (trajPos + dt / period) % 1;
  const p = trajPoint(trajPos);
  const res = ikSolver.solve(p, currentDeg, 30);
  currentDeg = res.qDeg;
  syncJointUI();
  marker.position.set(p[0], p[1], p[2]);
  updateReadout();
}

trajPlayBtn.addEventListener("click", () => {
  if (mode !== "traj") return;
  if (trajPlaying) {
    stopTraj();
    trajStatus.textContent = "已暂停";
    return;
  }
  if (!trajStarted) {
    startTraj();
    trajStatus.textContent = "已就位，开始沿轨迹运动…";
  } else {
    lastTs = performance.now();
  }
  trajPlaying = true;
  trajPlayBtn.textContent = "暂停";
});

trajResetBtn.addEventListener("click", () => {
  if (mode !== "traj") return;
  stopTraj();
  trajStarted = false;
  if (trajCenter) {
    const start = trajPoint(0);
    const res = ikSolver.solve(start, currentDeg, 120);
    currentDeg = res.qDeg;
    syncJointUI();
    updateReadout();
    marker.position.set(start[0], start[1], start[2]);
  }
  trajStatus.textContent = "已回到轨迹起点";
});

trajShapeEl.addEventListener("change", () => {
  if (trajCenter) rebuildPath();
});
trajRadiusEl.addEventListener("input", () => {
  trajRadiusVal.textContent = `${trajRadiusEl.value} m`;
  if (trajCenter) rebuildPath();
});
trajPeriodEl.addEventListener("input", () => {
  trajPeriodVal.textContent = `${trajPeriodEl.value} s`;
});

// ---------- 主循环 ----------
sim.setAnimationLoop(() => {
  if (mode === "ik") ikTick();
  else if (mode === "traj") trajTick();
  sim.render();
});

// 模型（OBJ）异步加载完成后刷新一次读数
setTimeout(updateReadout, 3000);

// 测试/调试句柄（不影响课堂使用）
window.__uaibot = {
  bot,
  sim,
  ikSolver,
  ikTarget,
  marker,
  getQ: () => currentDeg.slice(),
  ee: () => ikSolver.currentEE(),
  setMode,
  runIkTick: () => ikTick(),
  setIkTarget: (x, y, z) => {
    ikTarget.set(x, y, z);
    clampToWorkspace(ikTarget);
    marker.position.copy(ikTarget);
  },
  startTraj,
  stopTraj,
  stepTraj: (dt) => {
    trajPlaying = true;
    lastTs = null;
    trajPos = (trajPos + dt / Number(trajPeriodEl.value)) % 1;
    trajTick();
  },
  trajPoint: (t) => trajPoint(t),
};
