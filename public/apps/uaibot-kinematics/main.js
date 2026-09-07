/**
 * UAIBot 机械臂运动学演示（本地化封装）
 * - 上游：github.com/UAIbot/UAIbotJS @ f4a367d（MIT），three/mathjs 已本地化
 * - 功能：6-DoF KUKA KR5 关节角滑块（关节空间）、末端位姿 FKM 实时读数（正运动学）
 * - 教学边界：运动学几何演示，非动力学/碰撞仿真
 */
import * as UAIbot from "./lib/UAIbot.local.js";
import * as math from "mathjs";

const JOINT_NAMES = ["q1", "q2", "q3", "q4", "q5", "q6"];
const DEG = 180 / Math.PI;

const sim = new UAIbot.Simulation();
const bot = new UAIbot.Robot().create_kuka_kr5();
sim.add(bot);

// 初始姿态（全 0，立直）
let currentDeg = [0, 0, 0, 0, 0, 0];
bot.config(math.matrix(currentDeg.map((d) => (d * Math.PI) / 180)));

// ---- 构建 6 个关节滑块 ----
const jointsEl = document.getElementById("joints");
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
  });
  wrap.appendChild(row);
  wrap.appendChild(input);
  jointsEl.appendChild(wrap);
}
for (let i = 0; i < 6; i++) buildJointUI(i);

function applyJoints() {
  bot.config(math.matrix(currentDeg.map((d) => (d * Math.PI) / 180)));
  updateReadout();
}

function updateReadout() {
  try {
    const T = bot.fkm()._data;
    const x = (T[0][3] * 1000).toFixed(0);
    const y = (T[1][3] * 1000).toFixed(0);
    const z = (T[2][3] * 1000).toFixed(0);
    document.getElementById("pose").textContent = `x: ${x} mm   y: ${y} mm   z: ${z} mm`;
  } catch (e) {
    /* 模型尚未就绪时忽略 */
  }
}

document.getElementById("resetBtn").addEventListener("click", () => {
  currentDeg = [0, 0, 0, 0, 0, 0];
  document.querySelectorAll("#joints input[type=range]").forEach((el, i) => {
    el.value = 0;
    document.getElementById(`qval${i}`).textContent = "0°";
  });
  applyJoints();
});

// 模型（OBJ）加载完成后刷新一次读数
setTimeout(updateReadout, 3000);

sim.setAnimationLoop(() => {
  sim.render();
});
