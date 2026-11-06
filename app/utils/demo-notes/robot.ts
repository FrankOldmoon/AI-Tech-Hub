/**
 * robot 分类的「延伸学习」内容。
 *
 * 写作约定：
 *  - 代码是最小可读版本，注释用英文（不会因繁简转换而错字）；
 *  - 原理说明必须对应**本页真实实现**，不是教科书通稿 —— 页里哪里是简化、
 *    哪里是对真实系统的示意，都写清楚，这本身就是教学点；
 *  - 中英各一份，繁体由 toHK 自动转。
 */
import type { NoteMap } from './index'

export const notes: NoteMap = {
  '/robot/auto-drive': {
    python: `"""Car-following: the whole control layer of the auto-drive page, stripped down.

The page's auto mode only does longitudinal speed control -- steering is manual.
That is exactly what this function does: pick a target speed, then saturate.
"""
import math

DT = 0.1                 # s, simulation step
CRUISE_KMH = 40.0        # page default cruising speed
ACCEL_KMH_S = 13.0       # how fast the motor may speed the car up
BRAKE_KMH_S = 30.0       # brakes are ~2x stronger than the motor (as in the page)
SAFE_GAP_M = 6.0         # standstill gap kept behind the car in front
HEADWAY_S = 1.2          # seconds of gap added per m/s of allowed closing speed


def speed_step(ego_kmh, lead_kmh, gap_m):
    """Return the next speed in km/h. lead_kmh=None means free road."""
    if lead_kmh is None:
        target = CRUISE_KMH
    else:
        # The gap is spent at a constant *time* headway: allowed closing speed
        # is linear in the remaining distance. This is the P of IDM, without
        # the exponential comfort term.
        allowed = max(0.0, (gap_m - SAFE_GAP_M) / HEADWAY_S) * 3.6
        target = min(CRUISE_KMH, lead_kmh + allowed)

    # Proportional step, clamped by what the car can physically do.
    err = target - ego_kmh
    return ego_kmh + max(-BRAKE_KMH_S, min(ACCEL_KMH_S, err)) * DT


if __name__ == "__main__":
    v, gap = 60.0, 30.0
    for _ in range(40):
        v = speed_step(v, lead_kmh=20.0, gap_m=gap)
        gap -= (v - 20.0) / 3.6 * DT      # gap closes while we are faster
        print(f"v={v:5.1f} km/h  gap={gap:5.1f} m")
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Car following: one gain, two limits</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#0f172a}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:130px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:52px}
  .stat{margin-top:8px;font-size:12px;color:#475569}
  .stat b{color:#0f172a;font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>Speed control is a saturated integrator</h1>
<p>The page's auto mode does longitudinal control only: pick a target speed, brake when the gap closes.
Drag the gain — too low and it never reaches the set speed, too high and it oscillates.</p>
<canvas id="c" width="620" height="220"></canvas>
<div class="ctl">
  <label>gain K <input type="range" id="k" min="0.2" max="4" step="0.1" value="1.6"><output id="vk">1.6</output></label>
  <label>target <input type="range" id="t" min="10" max="80" step="5" value="40"><output id="vt">40</output> km/h</label>
</div>
<div class="stat" id="stat"></div>
<div class="note">The two limits (ACCEL 3.2, BRAKE 6.0 m/s²) are what make it a <i>saturated</i> controller:
past them the gain slider stops mattering, because the output is clamped.</div>
<script>
(function () {
  var DT = 0.05, ACCEL = 3.2, BRAKE = 6.0;
  var v = 20, gap = 42, hist = [];
  var running = true, t = 0;

  function step(target) {
    var targetMs = target / 3.6;
    var err = targetMs - v / 3.6;
    // stop for the lead car: no closer than 6 m at current speed
    var safe = 6 + (v / 3.6) * 0.9;
    var cmd = Math.max(-BRAKE, Math.min(ACCEL, err * 2));
    if (gap < safe) cmd = Math.min(cmd, -BRAKE * 0.6);
    v = Math.max(0, v + cmd * DT * 3.6);
    gap -= (v / 3.6) * DT;
    if (gap < 3) gap = 3;
    t += DT;
  }

  function draw() {
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 220;
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);

    // road
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 130, W, 60);
    ctx.strokeStyle = '#fbbf24'; ctx.setLineDash([26, 22]);
    ctx.beginPath(); ctx.moveTo(0, 160); ctx.lineTo(W, 160); ctx.stroke();
    ctx.setLineDash([]);

    // ego car
    var egoX = 90;
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(egoX - 26, 138, 52, 24);
    // lead car: position from the gap, scaled
    var leadX = Math.min(W - 60, egoX + 60 + gap * 6);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(leadX - 26, 138, 52, 24);

    // gap annotation
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(egoX + 28, 176); ctx.lineTo(leadX - 28, 176); ctx.stroke();
    ctx.fillStyle = '#cbd5e1'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(gap.toFixed(1) + ' m', (egoX + leadX) / 2 - 18, 192);

    // speed trace
    hist.push(v / 3.6);
    if (hist.length > 200) hist.shift();
    ctx.beginPath();
    for (var i = 0; i < hist.length; i++) {
      var x = 20 + i * 2.9;
      var y = 110 - Math.min(1, hist[i] / 25) * 86;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.8; ctx.stroke();

    // set speed line
    var tv = +document.getElementById('t').value / 3.6;
    ctx.strokeStyle = 'rgba(251,191,36,.6)'; ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(20, 110 - Math.min(1, tv / 25) * 86);
    ctx.lineTo(W - 20, 110 - Math.min(1, tv / 25) * 86);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#94a3b8';
    ctx.fillText('speed (m/s) vs set speed', 20, 20);
    ctx.fillText('t = ' + t.toFixed(1) + ' s', W - 90, 20);
  }

  function loop() {
    if (running) {
      var target = +document.getElementById('t').value;
      var k = +document.getElementById('k').value;
      ACCEL = 3.2 * k / 1.6;
      BRAKE = 6.0 * Math.min(1.4, k / 1.6);
      step(target);
      draw();
      document.getElementById('stat').innerHTML =
        'ego <b>' + (v).toFixed(1) + ' km/h</b> · gap <b>' + gap.toFixed(1) +
        ' m</b> · accel limit <b>' + ACCEL.toFixed(1) + ' m/s²</b>';
    }
    requestAnimationFrame(loop);
  }

  document.getElementById('k').addEventListener('input', function (e) {
    document.getElementById('vk').textContent = (+e.target.value).toFixed(1);
  });
  document.getElementById('t').addEventListener('input', function (e) {
    document.getElementById('vt').textContent = e.target.value;
  });
  loop();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 这一页在模拟什么

自动驾驶的标准分层是 **感知 → 规划 → 控制**。本页把三层都做成可操作的形式，但每个层都做了明确的简化：

| 层 | 页里真实做的事 | 简化点 |
| --- | --- | --- |
| 感知 | 相机画面、检测框、点云、雷达扇形共 4 个可视化层 | 检测框是场景图对象的投影，不是模型推理结果 |
| 规划 | 自动巡航时按前车距离选目标速度；红灯、行人、自放障碍三类触发 | 只有纵向决策，没有换道与路径规划 |
| 控制 | 目标速度 → 加速度，按 13 / 30 km/h·s⁻¹ 的加/减速上限饱和 | 手动模式的转向是简化自行车模型 \`yaw -= steer·v·0.18·dt\` |

## 跟车为什么用「时间间隔」而不是「固定距离」

如果只是「离前车 6 m 就刹车」，前车 5 km/h 时你会停在 6 m 外，前车 100 km/h 时 6 m 完全不够。所以真实系统看的是 **时间**（headway）：剩余距离除以允许的接近时间，得到允许的接近速度。距离越短，允许的接近速度越低，到 0 时自然停在安全车距上 —— 这就是上面 \`allowed\` 那一行。

## 碰撞检测用 OBB，而不是「距离 < 半径」

本页的车会转向，用轴对齐包围盒（AABB）在 45° 时会虚涨出约 40% 的面积，误判为撞上。所以这里用 **2D 有向包围盒 + 分离轴定理（SAT）**：把两个矩形的 4 条边法线当投影轴，只要存在一条轴上两者的投影不重叠，就不相交。矩形只有 2 个独立轴（另 2 个与之平行），所以每对盒子只算 4 次投影。

## 一个诚实的说明：这页的 LiDAR 是示意

页面 4 个传感器里，LiDAR 点云是 160 个固定点的 \`BufferGeometry\` 加旋转环动画，**没有做射线求交** —— 它用来表达「激光扫描」的概念，不是测距结果。真正逐帧发 200 条 \`THREE.Raycaster\` 求最近交点的实现在 **/robot/avsim**（航空/车载视景页）。想对比「示意 vs 真算」，两页连起来看最清楚。

## 想深一层

1. 本页的纵向控制只看**一辆**前车。真实 ACC 要处理切入车辆（cut-in），通常靠跟踪所有目标的 TTC（time-to-collision）取最小。
2. 上面代码是纯比例控制。真实车辆会加积分项消除稳态误差（长上坡时纯 P 永远差一点速度），但要配抗积分饱和，否则起步瞬间会猛冲。
3. 想在浏览器里做真感知，可参考本站的 ONNX Runtime Web 页面：模型推理一帧往往 20–80 ms，和 60 fps 的控制回路差一个数量级，所以工程上感知和控制在不同的频率上跑。`,
      en: `## What this page simulates

Autonomous driving is normally layered as **perceive → plan → control**. This page makes all three layers touchable, but simplifies each one deliberately:

| Layer | What the page really does | Where it is simplified |
| --- | --- | --- |
| Perception | Four toggleable layers: camera feed, detection boxes, point cloud, radar fan | Boxes are projections of scene objects, not model output |
| Planning | Picks a target speed from the gap ahead; reacts to red lights, pedestrians, user-placed obstacles | Longitudinal only — no lane changes, no path planning |
| Control | Target speed → acceleration, saturated at 13 / 30 km/h·s⁻¹ | Manual steering is a simplified bicycle model, \`yaw -= steer·v·0.18·dt\` |

## Why car-following uses time, not a fixed distance

"Brake at 6 m" fails both ways: at 5 km/h you stop absurdly early, at 100 km/h 6 m is nothing. Real systems regulate **headway time** instead: remaining distance divided by the allowed approach time gives the allowed closing speed. Shorter gap → lower allowed speed → the car settles at a safe following distance on its own. That is the \`allowed\` line above.

## Why collision uses OBB instead of "distance < radius"

The cars turn, so an axis-aligned box inflates by roughly 40% at 45° and reports phantom hits. The page therefore uses **oriented bounding boxes with the separating axis theorem**: project both rectangles onto the four edge normals; if any axis shows no overlap, they do not intersect. A rectangle has only two independent axes, so each pair costs four projections.

## An honest note: the LiDAR here is illustrative

Of the four sensors, the LiDAR layer is 160 fixed points in a \`BufferGeometry\` plus a spinning ring animation — there is **no ray casting** behind it. It communicates the *idea* of laser scanning, not ranges. The page that really fires 200 \`THREE.Raycaster\` rays per frame is **/robot/avsim**. Watching the two side by side is the fastest way to see "illustration vs computation".

## Going one level deeper

1. This page follows a single lead vehicle. Production ACC tracks every object and takes the minimum time-to-collision, which is what handles cut-ins.
2. The code above is pure proportional control. Real controllers add an integral term (a pure P always loses a little speed on a long climb) plus anti-windup, or the car lurches on start.
3. For real perception in a browser, see the site's ONNX Runtime Web pages: 20–80 ms per inference is an order of magnitude slower than a 60 fps control loop, which is why perception and control run at different rates in practice.`
    }
  },

  '/robot/drone': {
    python: `"""The drone page's entire flight model: kinematics with a P controller.

No aerodynamics, no motor model, no attitude loop -- the page is about the
control idea, so the plant is kept as simple as possible.
"""
import math

THROTTLE = 8.0      # m/s horizontal speed at full stick
ALT_KP = 1.2        # proportional gain of the altitude hold
LIMIT_Y = 26.0      # ceiling, same as the page


def step(pos, stick, alt_target, dt=1 / 60):
    """One frame. pos=(x,y,z), stick=(sx,sz) in [-1,1] from the keyboard."""
    sx, sz = stick
    n = math.hypot(sx, sz)
    if n > 1.0:                        # keep diagonal input from being faster
        sx, sz = sx / n, sz / n

    # Horizontal: constant-speed drift in the stick direction (yaw is held).
    vx, vz = sx * THROTTLE, sz * THROTTLE

    # Vertical: hunt the target altitude. Pure P -- no integral, because the
    # page has no persistent disturbance that would need one.
    vy = (alt_target - pos[1]) * ALT_KP
    vy = max(-3.0, min(3.0, vy))       # clamp: no teleporting on big errors

    x = pos[0] + vx * dt
    y = min(LIMIT_Y, max(0.0, pos[1] + vy * dt))
    z = pos[2] + vz * dt
    return (x, y, z), (vx, vy, vz)


if __name__ == "__main__":
    pos = (0.0, 0.0, 0.0)
    for i in range(180):               # 3 seconds: take off, hold at 7 m
        pos, vel = step(pos, (0.0, 0.0), alt_target=7.0)
        if i % 30 == 0:
            print(f"t={i / 60:4.1f}s  y={pos[1]:5.2f} m  vy={vel[1]:5.2f} m/s")
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Cascaded PID: gain, overshoot, oscillation</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:140px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:48px}
  .stat{margin-top:8px;font-size:12px;color:#475569}
  .stat b{color:#0f172a;font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>Why a drone needs two loops</h1>
<p>Position error becomes a velocity target (outer loop); velocity error becomes thrust (inner loop).
Cut the damping and the altitude rings for seconds — that is the classic P-only failure.</p>
<canvas id="c" width="620" height="200"></canvas>
<div class="ctl">
  <label>Kp <input type="range" id="p" min="0.5" max="8" step="0.1" value="3"><output id="vp">3.0</output></label>
  <label>Kd <input type="range" id="d" min="0" max="5" step="0.1" value="2.4"><output id="vd">2.4</output></label>
</div>
<div class="stat" id="stat"></div>
<div class="note">Damping below ~1.5 with Kp at 3 gives sustained oscillation; above ~4 the response is
sluggish but stable. The page runs the same structure on attitude and position, nested.</div>
<script>
(function () {
  var DT = 0.02;
  var y = 0, vy = 0, target = 1.0, hist = [], t = 0;

  function step(kp, kd) {
    // position error -> velocity target -> acceleration
    var vTarget = (target - y) * 0.9;
    var a = (vTarget - vy) * kp - vy * kd * 0.2;
    vy += a * DT;
    y += vy * DT;
    t += DT;
    hist.push({ y: y, t: t });
    if (hist.length > 260) hist.shift();
  }

  function render() {
    var kp = +document.getElementById('p').value;
    var kd = +document.getElementById('d').value;
    document.getElementById('vp').textContent = kp.toFixed(1);
    document.getElementById('vd').textContent = kd.toFixed(1);

    for (var i = 0; i < 3; i++) step(kp, kd);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 200;
    ctx.clearRect(0, 0, W, H);

    // target line
    var Y = v => H - 30 - Math.min(1.6, v) / 1.6 * (H - 56);
    ctx.strokeStyle = '#f59e0b'; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(30, Y(target)); ctx.lineTo(W - 16, Y(target)); ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    hist.forEach(function (p, i) {
      var x = 30 + i / 259 * (W - 46);
      if (i === 0) ctx.moveTo(x, Y(p.y)); else ctx.lineTo(x, Y(p.y));
    });
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('altitude vs target', 30, 16);
    ctx.fillText('0 m', 8, H - 26);
    ctx.fillText('1 m', 8, Y(1) + 4);

    var overshoot = Math.max.apply(null, hist.map(function (p) { return p.y; })) - target;
    var settled = Math.abs(hist[hist.length - 1].y - target) < 0.02;
    document.getElementById('stat').innerHTML =
      'altitude <b>' + y.toFixed(2) + ' m</b> · overshoot <b>' +
      (overshoot > 0 ? '+' + overshoot.toFixed(3) : '0') + ' m</b> · ' +
      (settled ? '<span style="color:#16a34a">settled</span>'
               : '<span style="color:#b45309">still moving</span>');
  }

  document.getElementById('p').addEventListener('input', render);
  document.getElementById('d').addEventListener('input', render);

  var raf;
  (function loop() {
    render();
    raf = requestAnimationFrame(loop);
  })();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 简化的地方，就是教学重点

本页没有飞控、没有气动、没有姿态环。**水平速度 = 摇杆方向 × 8 m/s**，**垂直速度 = 高度误差 × 1.2**。整个飞行模型不到 20 行。这不是偷懒，而是让「位置控制」这个概念不被姿态动力学淹没 —— 真实无人机的飞控栈里，位置环外面还套着速度环、姿态环、角速度环，四层串级，任何一层都能让初学者迷路。

## 为什么必须对摇杆做归一化

同时按「前进 + 右移」时，两个方向各给 1.0，合成速度就成了 8√2 ≈ 11.3 m/s —— 斜着飞比直着飞快 41%，操作手感会非常怪。所以先算模长，超过 1 就整体缩放。几乎所有游戏引擎的输入层都有这一步。

## 比例控制的取舍

高度控制用纯 P（\`k = 1.2\`）。因为在没有持续外扰的模型里，P 的稳态误差为 0：误差归零时输出也归零，飞机自然停住。加入积分项反而会在接近目标时超调 —— 积分器不会「记得」目标已经快到了。

真实无人机必须加积分，因为存在持续扰动（风、电池电压下降导致的推力漂移），纯 P 会稳定在一个偏离目标的高度上。代价就是要处理抗积分饱和。

## 其他几个真实存在于代码里的模型

- **倾角平滑**：俯仰/横滚朝向目标倾角按 0.12 的一阶系数插值，模拟机身的惯性感；
- **限高与碰撞**：y 夹在 26 m 以内；建筑用 AABB 检测（半宽外扩 0.8 m 容差），撞上后强制坠落 \`vy = -max(2.5, 2y)\`；
- **电量**：\`(0.05 + 速度项 · 0.04 + 0.02) · dt · 6\`，悬停也耗电，爬升耗得更多；
- **图传信号**：随离家距离线性衰减，最低 20%，模拟数传链路。

## 想深一层

1. 上面 \`vy\` 的钳位是工程常识：没有它，从 0 飞到 100 m 时第一帧速度会是 120 m/s。
2. 真机的姿态环通常 500 Hz–1 kHz，位置环 50–100 Hz。把不同频率的控制环画在同一张图上，是理解串级 PID 的最好方式。
3. 页面的 RTL（返航）用 \`atan2\` 求偏航角，并限制在 ±2 rad/s。为什么要限速？因为控制器算出的「理想角速度」可能超过机体物理极限，不限就会被积分器带偏。`,
      en: `## The simplification *is* the lesson

No flight controller, no aerodynamics, no attitude loop. **Horizontal speed = stick direction × 8 m/s**, **vertical speed = altitude error × 1.2**. The whole flight model is under 20 lines. That is deliberate: it keeps "position control" from being buried under attitude dynamics. A real drone stacks a position loop around a velocity loop, an attitude loop and a rate loop — four cascaded layers, any one of which can lose a beginner.

## Why the stick must be normalised

Holding "forward + strafe" gives 1.0 on each axis, so the combined speed becomes 8√2 ≈ 11.3 m/s — flying diagonally is 41% faster than straight. That feels wrong immediately. Taking the vector length and scaling the whole input down to 1 fixes it. Almost every game engine does this in its input layer.

## The trade-off behind a pure P controller

Altitude holds with pure P (\`k = 1.2\`). In a model with no persistent disturbance, steady-state error is zero: when the error reaches zero the output does too, and the drone stops. Adding an integral term would only cause overshoot near the target — an integrator does not know the goal is close.

Real drones *must* integrate, because wind and sagging battery voltage create a constant disturbance, and pure P settles at a wrong altitude. The price is anti-windup logic.

## Models that are genuinely in the code

- **Tilt smoothing**: pitch/roll interpolate toward the target angle at a first-order factor of 0.12 — the airframe's inertia, cheaply;
- **Ceiling and collisions**: y is clamped to 26 m; buildings use AABB with a 0.8 m tolerance, and a hit forces a fall at \`vy = -max(2.5, 2y)\`;
- **Battery**: \`(0.05 + speed term · 0.04 + 0.02) · dt · 6\` — hovering drains, climbing drains faster;
- **Signal**: decays linearly with distance from home, floored at 20%, standing in for the radio link.

## Going one level deeper

1. That \`vy\` clamp is engineering common sense: without it, going from 0 to 100 m produces a first-frame velocity of 120 m/s.
2. On real hardware the attitude loop runs at 500 Hz–1 kHz and the position loop at 50–100 Hz. Drawing those loops on one timeline is the fastest way to understand cascaded PID.
3. RTL uses \`atan2\` for heading and clamps yaw rate to ±2 rad/s. Why clamp? The controller's "ideal" rate can exceed what the airframe can do, and an integrator will happily wind up chasing it.`
    }
  },

  '/robot/vacusim': {
    python: `"""Two ideas from the vacuum-robot page: a coverage grid and a reactive policy.

The page has no SLAM and no map building -- it is an honest "reflex agent".
"""
import math

CELL = 0.5          # m, grid resolution (page uses 12 x 9 m room, 0.5 m cells)
BRUSH_R = 0.85      # m, cleaning radius around the robot
FRONT_STOP = 1.3    # m, stop distance when something is ahead
TURN_GAIN = 1.6     # how hard it turns away from a side wall


def clean_around(grid, x, z, r=BRUSH_R):
    """Mark every traversable cell within r of the robot as cleaned.
    Coverage ratio = cleaned cells / traversable cells."""
    c0, c1 = int((x - r) // CELL), int((x + r) // CELL)
    r0, r1 = int((z - r) // CELL), int((z + r) // CELL)
    for c in range(c0, c1 + 1):
        for rw in range(r0, r1 + 1):
            if grid[rw][c] is not None:                 # None = wall / drop
                cx, cz = (c + 0.5) * CELL, (rw + 0.5) * CELL
                if math.hypot(cx - x, cz - z) <= r:
                    grid[rw][c] = True                  # True = cleaned
    done = sum(v is True for row in grid for v in row)
    total = sum(v is not None for row in grid for v in row)
    return done / total


def steer(front, left, right):
    """Reactive policy, same shape as the page's state machine.
    Returns angular velocity (rad/s); positive turns left."""
    if front < FRONT_STOP:
        # something ahead: turn toward the roomier side
        return TURN_GAIN if left > right else -TURN_GAIN
    # edge following: keep a constant margin from the nearer side wall
    err = min(left, right) - FRONT_STOP
    return max(-1.0, min(1.0, err * TURN_GAIN * 0.3))


if __name__ == "__main__":
    grid = [[False for _ in range(24)] for _ in range(18)]
    grid[5][5] = None                                     # one obstacle
    x, z, yaw = 1.0, 1.0, 0.0
    for _ in range(600):
        w = steer(front=2.0, left=1.5, right=0.9)
        yaw += w * (1 / 60)
        x += math.cos(yaw) * 2.4 / 60                     # page speed: 2.4 m/s
        z += math.sin(yaw) * 2.4 / 60
        ratio = clean_around(grid, x % 12, z % 9)
        print(f"coverage={ratio:.1%}  yaw={yaw:5.2f}")
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Coverage without a map</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:420px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .ctl{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:12px;align-items:center}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:130px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:52px}
  button{font:inherit;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer}
  .note{color:#64748b;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>No SLAM, no map — just a grid it writes to</h1>
<p>The robot cleans where it has not been. Coverage rises monotonically because each cell is marked the
moment it is visited; the wall bounce is a simple reflection, not path planning.</p>
<canvas id="c" width="420" height="420"></canvas>
<div class="ctl">
  <label>speed <input type="range" id="s" min="1" max="8" step="1" value="3"><output id="vs">3</output></label>
  <button id="reset">reset</button>
</div>
<div class="note">This is the same idea as /robot/envsense's coverage grid on the real page: a 2D array of
counters, no geometry, no map. That is why it runs in a browser.</div>
<script>
(function () {
  var G = 28, CELL = 15, S = G * CELL;
  var grid, rx, ry, dir, cover = 0;

  function reset() {
    grid = [];
    for (var y = 0; y < G; y++) {
      var row = [];
      for (var x = 0; x < G; x++) row.push(0);
      grid.push(row);
    }
    // a few obstacles
    for (var i = 0; i < 24; i++) {
      var ox = 4 + (i * 7) % (G - 8), oy = 4 + (i * 11) % (G - 8);
      grid[oy][ox] = 2;
    }
    rx = 1; ry = 1; dir = 0; cover = 0;
  }

  function step() {
    var speed = +document.getElementById('s').value;
    for (var k = 0; k < speed; k++) {
      var dx = [1, 0, -1, 0][dir], dy = [0, 1, 0, -1][dir];
      var nx = rx + dx, ny = ry + dy;
      if (nx < 0 || ny < 0 || nx >= G || ny >= G || grid[ny][nx] === 2) {
        dir = (dir + 1) % 4;                      // wall: turn, no planning
      } else {
        rx = nx; ry = ny;
        // occasionally turn to emulate a reactive policy
        if (Math.random() < 0.04) dir = (dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
      }
      if (grid[ry][rx] === 0) { grid[ry][rx] = 1; cover++; }
    }
  }

  function render() {
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, S, S);

    for (var y = 0; y < G; y++) {
      for (var x = 0; x < G; x++) {
        var v = grid[y][x];
        if (v === 1) { ctx.fillStyle = '#bfdbfe'; ctx.fillRect(x * CELL, y * CELL, CELL, CELL); }
        else if (v === 2) { ctx.fillStyle = '#94a3b8'; ctx.fillRect(x * CELL, y * CELL, CELL, CELL); }
      }
    }

    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.arc(rx * CELL + CELL / 2, ry * CELL + CELL / 2, CELL * 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0f172a'; ctx.font = '11px ui-monospace, monospace';
    var total = G * G - 24;
    var pct = cover / total;
    ctx.fillText('coverage ' + Math.round(pct * 100) + '%  ·  ' + cover + '/' + total + ' cells', 8, S - 8);
  }

  document.getElementById('reset').addEventListener('click', function () { reset(); render(); });
  document.getElementById('s').addEventListener('input', function (e) {
    document.getElementById('vs').textContent = e.target.value;
  });
  document.getElementById('vs').textContent = 3;
  reset();
  (function loop() { step(); render(); requestAnimationFrame(loop); })();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 覆盖率不是「走了多远」，而是「扫过多少格」

这类页面最容易误导的地方，是把「机器人走遍屋子」当成「扫干净了」。本页算的是**栅格覆盖率**：房间 12 × 9 m、格子 0.5 m，共 24 × 18 = 432 格；先标出哪些格子可清洁（避开墙、家具、悬崖区），再在机器人每帧位置对半径 0.85 m 内的可清洁格打上已清洁标记，最后用「已清洁格数 / 可清洁格数」作为进度。

这个定义决定了优化方向：知道走遍全屋 ≠ 覆盖率高，因为刷盘有宽度，重叠的路径是白走的。真实扫地机做的是 **boustrophedon（牛耕式）分区覆盖**，把房间切成若干无遗漏的单元再逐格往复，而不是像本页这样随机游走。

## 这里的「LiDAR」是真算的，但不是 Raycaster

值得对比的一点：本页没用 \`THREE.Raycaster\`，而是 \`rayDist\` 沿角度每 0.25 m 递进到 6 m，用 AABB **解析判断**是否撞墙，取第一个命中的距离。每帧只发 3 条（正前、±0.6 rad）。

为什么这样也行？因为场景墙都是轴对齐矩形，「射线 vs AABB」有闭式解（slab method），比走 three 的通用射线求交快得多，也不用构建 BVH。代价是不能处理任意形状。

## 反应式策略 vs 规划

页面是一个**行为状态机**：\`auto\`（前进，遇障停下并转向）、\`edge\`（沿边，比例控制保持 1.3 m 边距）、\`spot\`（原地深度清洁 9 s）、\`dock\`（用 \`atan2\` 归位回充）。触发方式是「撞了就 0.5 s 倒退转向」这种最朴素的反射。

它没有 SLAM、没有建图、没有 A*。这类系统叫 **reactive agent**（Brooks 的包容架构一路）：不需要世界模型，靠局部感知直接映射到动作。优点是极稳（传感器坏了也只是变笨，不会崩），缺点是永远无法保证覆盖完全，会在某些角落反复打转。

## 想深一层

1. 覆盖率的分子分母都必须是「可清洁格」，否则地毯、门槛这些不可清洁区域会把分数永远压在 90% 以下。
2. 想升级成规划式：先建栅格地图（占用栅格），再做前沿探索（frontier exploration）选下一个未探索边界，或用 A* 走网格。代价是要处理定位漂移 —— 这也是为什么真机要上 VSLAM。
3. 页面里的电量模型是 \`0.09 · 速度 · dt\`，只和速度有关。真实扫地机的大头消耗在风机（吸力），所以「降吸力换续航」是个真实的策略开关。`,
      en: `## Coverage is "how many cells were brushed", not "how far did it drive"

The easy mistake with this kind of page is to read "the robot went everywhere" as "the floor is clean". This page computes **grid coverage**: a 12 × 9 m room on 0.5 m cells is 24 × 18 = 432 cells; traversable cells are marked first (walls, furniture and drop-off zones excluded), then every frame paints all traversable cells within 0.85 m of the robot, and progress is cleaned cells over traversable cells.

That definition dictates the optimisation: visiting the whole room is not the same as a high coverage ratio, because the brush has width and overlapping passes are wasted. Production robot vacuums do **boustrophedon (ox-plough) area coverage** — split the room into units, sweep each one back and forth — rather than the random wandering here.

## The "LiDAR" here is real, but not Raycaster

Worth contrasting with the drone/AV pages: this one does **not** use \`THREE.Raycaster\`. \`rayDist\` steps 0.25 m at a time up to 6 m and tests walls with an analytic AABB check, returning the first hit. Only three rays per frame (ahead, ±0.6 rad).

Why is that enough? Every wall in the scene is an axis-aligned rectangle, and ray-vs-AABB has a closed form (the slab method) — far cheaper than three's general ray casting, and no BVH to maintain. The price is that arbitrary shapes are out.

## Reactive policy vs planning

The page is a **behaviour state machine**: \`auto\` (drive, stop and turn on contact), \`edge\` (proportional control holding a 1.3 m margin), \`spot\` (spin in place for 9 s), \`dock\` (\`atan2\` homing). Triggers are as blunt as "bumped → reverse and turn for 0.5 s".

No SLAM, no map, no A*. This is a **reactive agent** in the Brooks subsumption tradition: local sensing maps directly to action with no world model. It is extremely robust (a dead sensor makes it dumber, not broken) but can never guarantee full coverage and will orbit some corners forever.

## Going one level deeper

1. Both numerator and denominator must count only traversable cells — otherwise rugs and thresholds cap the score below 90% forever.
2. To make it a planning agent: build an occupancy grid, then pick the next unexplored frontier or run A* on the grid. The real cost is localisation drift, which is exactly why production robots run VSLAM.
3. Battery here is \`0.09 · speed · dt\` — speed only. On real hardware the fan dominates, which is why "lower suction for runtime" is a genuine user-facing switch.`
    }
  },
  '/robot/avsim': {
    python: `"""Ray-cast sensing + time-to-collision braking: the avsim page in ~40 lines.

Unlike the auto-drive page, this one really casts rays -- 200 per frame, in
three pitch bands, skipping the ego vehicle, keeping hits under 46 m.
"""
import math

N_RAYS = 200
FOV = math.radians(120)     # total horizontal sweep
MAX_RANGE = 46.0           # page: hits beyond this are dropped
DECEL = 6.0                # m/s^2 assumed by the planner


def scan(raycast, x, z, heading):
    """Nearest hit per azimuth, over 3 pitch bands (a poor man's 3-line LiDAR)."""
    out = []
    for i in range(N_RAYS):
        a = heading - FOV / 2 + FOV * i / (N_RAYS - 1)
        best = MAX_RANGE
        for pitch in (-0.16, 0.0, 0.16):
            d = raycast(x, z, a, pitch, MAX_RANGE)   # your ray-vs-world query
            if d is not None and d < best:
                best = d
        out.append(best)
    return out


def allowed_speed(v, d):
    """It is too late once you can see the obstacle: brake as soon as
    the stopping distance v^2 / (2a) exceeds the free distance."""
    return min(v, math.sqrt(2 * DECEL * max(0.0, d)))


if __name__ == "__main__":
    v, gap = 34 / 3.6, 30.0       # 34 km/h, 30 m to the obstacle
    for t in range(10):
        v = allowed_speed(v, gap)
        gap -= v * 0.5
        print(f"t={t * 0.5:4.1f}s  v={v * 3.6:5.1f} km/h  gap={gap:5.1f} m")
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>200 rays, one obstacle</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:560px;display:block;border-radius:8px;background:#0f172a}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:150px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:54px}
  .stat{margin-top:8px;font-size:12px;color:#475569}
  .stat b{color:#0f172a}
  .note{color:#64748b;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>Angular resolution is a hard ceiling</h1>
<p>200 rays over 120°, so one ray every 0.6°. Shrink the obstacle and watch it fall between rays — no
algorithm recovers a target that was never sampled.</p>
<canvas id="c" width="560" height="340"></canvas>
<div class="ctl">
  <label>obstacle radius <input type="range" id="r" min="4" max="40" step="1" value="14"><output id="vr">14</output></label>
  <label>distance <input type="range" id="d" min="60" max="240" step="5" value="150"><output id="vd">150</output></label>
</div>
<div class="stat" id="stat"></div>
<div class="note">The car is at the bottom. Grey dots are ray hits; the red circle is the obstacle. When
the dots stop covering the circle, the car is blind to it — exactly what happens to a pedestrian at 40 m.</div>
<script>
(function () {
  var W = 560, H = 340, CX = W / 2, CY = H - 30;
  var N = 200, FOV = 120 * Math.PI / 180, MAXR = 300;

  function render() {
    var rad = +document.getElementById('r').value;
    var dist = +document.getElementById('d').value;
    document.getElementById('vr').textContent = rad;
    document.getElementById('vd').textContent = dist;

    // obstacle sits straight ahead
    var ox = CX, oy = CY - dist;

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);

    // rays
    var hits = 0, nearest = MAXR;
    for (var i = 0; i < N; i++) {
      var a = -Math.PI / 2 - FOV / 2 + FOV * i / (N - 1);
      var dx = Math.cos(a), dy = Math.sin(a);

      // ray-circle: solve |o + t d - c| = r for the smallest positive t
      var ex = CX - ox, ey = CY - oy;
      var b = ex * dx + ey * dy;
      var cc = ex * ex + ey * ey - rad * rad;
      var disc = b * b - cc;
      var t = disc >= 0 ? -b - Math.sqrt(disc) : MAXR;
      if (t < 0) t = MAXR;
      var hit = t < MAXR;
      if (hit) { hits++; nearest = Math.min(nearest, t); }

      var px = CX + dx * Math.min(t, MAXR);
      var py = CY + dy * Math.min(t, MAXR);
      ctx.fillStyle = hit ? '#f97316' : 'rgba(148,163,184,.35)';
      ctx.fillRect(px - 1, py - 1, hit ? 2.4 : 1.6, hit ? 2.4 : 1.6);
    }

    // obstacle
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ox, oy, rad, 0, Math.PI * 2); ctx.stroke();

    // ego
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(CX - 12, CY - 8, 24, 16);

    ctx.fillStyle = '#94a3b8'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(N + ' rays · ' + (FOV * 180 / Math.PI).toFixed(0) + '° FOV · ' + (FOV / N * 180 / Math.PI).toFixed(2) + '° per ray', 10, 16);

    var angular = 2 * Math.atan(rad / dist) * 180 / Math.PI;
    document.getElementById('stat').innerHTML =
      'hits <b>' + hits + '/' + N + '</b> · obstacle subtends <b>' + angular.toFixed(2) +
      '°</b> · ' + (angular >= FOV / N * 180 / Math.PI ? '<span style="color:#16a34a">visible</span>'
        : '<span style="color:#dc2626">between rays — invisible</span>');
  }

  ['r', 'd'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 一个数字决定了这页能「看见」什么：角分辨率

200 条射线铺满 120°，即 **每 0.6° 一条**。一个 40 m 外的行人在视野里只占约 0.3°，正好落在两条射线之间 —— 看不见。这不是 bug，而是所有激光雷达/毫米波雷达的共同约束：**角分辨率是硬上限**，靠算法补不回来。真实 64 线激光雷达的水平分辨率在 0.1–0.4° 量级，这也是它比摄像头贵一个数量级的原因。

三个仰角（-0.16 / 0 / 0.16 rad ≈ ±9°）模拟多线扫描：单线激光只能扫一个平面，遇到坡道或低矮障碍就瞎了。

## 性能取舍：为什么隔帧更新

每帧 200 × 3 = 600 次射线求交，three 的 \`Raycaster\` 每次都要走一遍场景图（除非自己建 BVH）。页面选择**隔帧更新点云**，用上一帧的结果继续做规划 —— 感知 30 Hz、控制 60 Hz，这是工程上非常常见的分层。

## 刹车距离公式，以及为什么它救不了所有情况

匀减速下 \`v² = 2·a·d\`，所以允许速度是 \`√(2·a·d)\`。这个式子有个残酷的性质：**距离减半，允许速度只降到 70%**（不是 50%）。所以它只是「下限保护」，真正的安全来自提前发现 —— 这也解释了为什么页面的检测距离（46 m 或开相机后 70 m）比刹车距离重要得多。

页面在威胁判定上还加了两条前置条件：前向点积 \`dot > 0.85\`（在正前方约 32° 锥内）且横向偏移小于 6 m。不加这两条，路边的行人会让车不停刹车。

## 其余真实存在的机制

- **信号灯周期 9 s**，红 50% / 黄 20% / 绿 30%；红灯在 55 m 处开始介入，停线前 10 m 精算；
- **12 辆 NPC 车**在红灯前按 2.5 的减速系数停下，**16 名行人**随机过街；
- **横向让行**：需要绕行时把 \`laneOffset\` 以 2.2 m/s 插值到 ±5.5 m，上限 ±6 m；
- **12 m 内急刹**：这是最后一道保险，不参与舒适性计算。

## 和 /robot/auto-drive 对照着看

那页的 LiDAR 是 160 个固定点的动画（示意），这页是真射线。两页放在一起，正好回答一个常见误解：**「看起来像点云」和「由测距得到点云」是两件事**。判断方法很简单 —— 把场景里的障碍挪走，真射线点云会跟着变，装饰性点云不会。`,
      en: `## One number decides what this page can see: angular resolution

200 rays over 120° means **one ray every 0.6°**. A pedestrian 40 m away subtends about 0.3° — they fall exactly between two rays, and are invisible. That is not a bug; it is the constraint every LiDAR and radar shares: **angular resolution is a hard ceiling** that no algorithm recovers. A real 64-line LiDAR resolves 0.1–0.4°, which is a large part of why it costs an order of magnitude more than a camera.

The three pitch bands (-0.16 / 0 / 0.16 rad ≈ ±9°) stand in for multiple scan lines: a single-line scanner sees one plane, and goes blind on ramps and low obstacles.

## The performance trade: why every other frame

600 ray queries per frame, and three's \`Raycaster\` walks the scene graph on each one unless you build a BVH yourself. The page updates the cloud **every other frame** and keeps planning on the previous one — perception at 30 Hz, control at 60 Hz. That split is standard engineering practice, not a shortcut.

## The braking formula, and why it cannot save every case

Under constant deceleration \`v² = 2·a·d\`, so the allowed speed is \`√(2·a·d)\`. The formula has a cruel property: **halve the distance and the allowed speed only drops to 70%** (not 50%). It is a floor, not a guarantee — real safety comes from seeing earlier, which is why the detection range (46 m, or 70 m with the camera on) matters far more than the brake model.

Threat detection also requires \`dot > 0.85\` (inside roughly a 32° forward cone) and a lateral offset under 6 m. Without those two gates, roadside pedestrians would make the car brake constantly.

## Other mechanisms that really exist

- **A 9 s signal cycle**, red 50% / amber 20% / green 30%; red starts influencing at 55 m, refined within 10 m of the stop line;
- **12 NPC cars** brake at red lights with a 2.5 damping factor, **16 pedestrians** cross at random;
- **Lane offset**: when swerving, \`laneOffset\` interpolates at 2.2 m/s toward ±5.5 m, clamped to ±6 m;
- **Emergency braking inside 12 m** — the last resort, excluded from comfort tuning.

## Read it next to /robot/auto-drive

That page's LiDAR is 160 fixed points with a spinning ring (illustrative); this page casts real rays. Put side by side, they answer a common misconception: **"looks like a point cloud" and "is computed from ranges" are different things**. The test is easy — move an obstacle and see whether the cloud follows. Decorative clouds do not.`
    }
  },

  '/robot/drone_dance': {
    python: `"""Formation maths for the drone light show: golden-angle sphere + easing.

420 drones, 13 shapes, 2.5 s transitions -- the whole trick is fewer numbers
per drone than you would guess.
"""
import math

GOLDEN = math.pi * (3 - math.sqrt(5))   # ~137.5 deg, the golden angle


def sphere(n, radius):
    """Even coverage of a sphere. Naive lat/long grids bunch up at the poles;
    stepping the height uniformly and the angle by the golden ratio does not."""
    pts = []
    for i in range(n):
        y = 1 - 2 * (i + 0.5) / n                    # uniform in height
        r = math.sqrt(max(0.0, 1 - y * y))
        a = GOLDEN * i
        pts.append((math.cos(a) * r * radius, y * radius, math.sin(a) * r * radius))
    return pts


def ease_in_out_cubic(t):
    """Zero velocity at both ends: no visible jerk when a transition starts."""
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def blend(a, b, k):
    return tuple(ai + (bi - ai) * k for ai, bi in zip(a, b))


if __name__ == "__main__":
    start = sphere(420, 30)
    target = [(x * 0.4, 20.0 - abs(x) * 0.2, z * 0.4) for x, _, z in start]
    for step in range(0, 6):
        k = ease_in_out_cubic(step / 5)
        p = blend(start[0], target[0], k)
        print(f"t={step / 5:.1f}  eased={k:.3f}  drone0=({p[0]:6.2f},{p[1]:6.2f},{p[2]:6.2f})")
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Golden angle, then easing</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:520px;display:block;border-radius:8px;background:#0f172a}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px;align-items:center}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:150px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:48px}
  button{font:inherit;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer}
  .note{color:#64748b;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>Even coverage without clustering at the poles</h1>
<p>Fibonacci sphere: uniform height, 137.5° of rotation per step. Drag the angle to 90° and the points
collapse onto four meridians — that is resonance from a rational ratio.</p>
<canvas id="c" width="520" height="360"></canvas>
<div class="ctl">
  <label>angle <input type="range" id="a" min="60" max="180" step="0.5" value="137.5"><output id="va">137.5°</output></label>
  <button id="roll">morph →</button>
</div>
<div class="note">The morph uses easeInOutCubic: zero velocity at both ends, so 420 drones do not visibly
jerk when a transition starts or stops.</div>
<script>
(function () {
  var W = 520, H = 360, CX = W / 2, CY = H / 2;
  var N = 420, R = 140;
  var morph = 0, dir = 0;

  function sphere(angleDeg) {
    var pts = [], ga = angleDeg * Math.PI / 180;
    for (var i = 0; i < N; i++) {
      var y = 1 - 2 * (i + 0.5) / N;
      var r = Math.sqrt(Math.max(0, 1 - y * y));
      var a = ga * i;
      pts.push({ x: Math.cos(a) * r, y: y, z: Math.sin(a) * r });
    }
    return pts;
  }

  function targetShape(pts) {
    // a cone: keep the height, pull the radius in
    return pts.map(function (p) {
      var k = 0.35 + (1 - (p.y + 1) / 2) * 0.6;
      return { x: p.x * k, y: p.y, z: p.z * k };
    });
  }

  var ease = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

  function project(p) {
    // simple isometric-ish projection with depth -> size
    var k = 1 / (2.6 - p.z * 0.35);
    return { x: CX + p.x * R * k, y: CY + p.y * R * k * 0.9, depth: p.z };
  }

  function render() {
    var angle = +document.getElementById('a').value;
    document.getElementById('va').textContent = angle.toFixed(1) + '°';

    var A = sphere(angle);
    var B = targetShape(A);
    var k = ease(Math.min(1, Math.max(0, morph)));

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);

    // equator hint
    ctx.strokeStyle = 'rgba(148,163,184,.18)';
    ctx.beginPath(); ctx.ellipse(CX, CY, R, R * 0.28, 0, 0, Math.PI * 2); ctx.stroke();

    var list = A.map(function (p, i) {
      var q = B[i];
      return {
        x: p.x + (q.x - p.x) * k,
        y: p.y + (q.y - p.y) * k,
        z: p.z + (q.z - p.z) * k
      };
    });
    list.sort(function (a, b) { return a.z - b.z; });   // far first

    list.forEach(function (p) {
      var s = project(p);
      var lit = 0.35 + (p.z + 1) / 2 * 0.65;
      ctx.fillStyle = 'rgba(' + Math.round(56 + lit * 80) + ',' +
        Math.round(140 + lit * 90) + ',255,' + (0.35 + lit * 0.55) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.4 + lit * 1.8, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = '#94a3b8'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(N + ' drones · ' + (Math.abs(angle - 137.5) < 1 ? 'golden angle' : angle.toFixed(1) + '°'), 12, 20);
    ctx.fillText('morph ' + Math.round(k * 100) + '%', 12, H - 14);
  }

  document.getElementById('a').addEventListener('input', render);
  document.getElementById('roll').addEventListener('click', function () {
    dir = dir === 0 ? 1 : 0;
    if (dir === 1) {
      var t0 = performance.now();
      (function anim() {
        var t = Math.min(1, (performance.now() - t0) / 1400);
        morph = t;
        render();
        if (t < 1) requestAnimationFrame(anim);
        else { morph = 0; }
      })();
    }
  });
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 为什么用黄金角铺球面

用经纬度网格铺球面，两极会挤成一团、赤道却稀稀拉拉 —— 因为经线在高纬度收拢，每格的实际面积差距可达几十倍。光照、粒子这些场景一眼就能看出「极点糊了」。

黄金角螺旋换个思路：**高度均匀取**（\`y\` 等距），**角度每次转 137.5°**。137.5° 是无理数与圆周的最优比，使得任意前 \`n\` 个点都不会落在同一条经线附近，从而近似等面积分布。这段代码只有 6 行，是所有球面均匀采样里性价比最高的做法（Phyllotaxis，向日葵籽排列的同一个原理）。

## 缓动函数不是装饰

从形状 A 到形状 B，如果按线性插值，起步和停下都是「速度突变」—— 420 架无人机的视觉重量会让这点变成明显的「啪」。\`easeInOutCubic\` 在 \`t=0\` 和 \`t=1\` 处导数为 0，所以起停都是平滑的。页面用 2.5 s / speed 作为过渡时长，慢速时整段动画拉长，形状不会跳。

## 文字编队怎么变成点云

「文字」形状是用 640 × 220 的 canvas 画出文字，\`getImageData\` 取像素，按 \`stride = 3\` 隔行隔列采样，把不透明像素转成目标点，再洗牌。\`stride\` 是分辨率与机队规模的折中：stride 太大字会碎，太小点不够分。

## 420 架无人机怎么跑得动

不是 420 个 \`Mesh\`，而是 6 个 \`InstancedMesh\`（机身、2 机臂、4 桨、4 电机、2 组 LED）。每帧给每架算一次矩阵，写进 \`instanceMatrix\`，标 \`needsUpdate = true\`，一次 draw call 出画面。这是 WebGL 里画大量同形物体的标准做法 —— 也是为什么这页能开到 800 架。

## 现实里的差距

真实的无人机灯光秀有两条这页没有的硬约束：**绝对定位**（RTK-GPS 或 UWB，厘米级，否则会撞）和**碰撞裕度**（相邻机间距不小于 1.5–2 m）。这页的坐标是数学上理想的位置，真实的编排软件会在解算后做一遍间距检查。

## 想深一层

1. 黄金角换成 \`π/2\` 会怎样？所有点落在 4 条经线上 —— 这就是「有理比导致共振」。
2. 过渡时如果两架无人机的路径交叉，线性插值会让它们在空中相撞。真实软件做的是**匈牙利算法分配目标点**（最小化总路径长度）+ 高度错层。`,
      en: `## Why the golden angle tiles a sphere

A latitude/longitude grid crowds at the poles and thins at the equator, because meridians converge with height — cell areas can differ by tens of times, and any lighting or particle scene shows the poles as a smudge.

The golden-angle spiral flips it around: **uniform height** (\`y\` evenly spaced), **137.5° of rotation per step**. That angle is the optimal irrational ratio to the circle, so no prefix of points ever lands near one meridian — an approximately equal-area distribution. Six lines of code, the best cost/benefit in uniform sphere sampling (phyllotaxis, the same trick sunflowers use).

## Easing is not decoration

Interpolating linearly between shapes makes both the start and the end velocity discontinuities — with 420 drones' visual weight, that reads as a visible snap. \`easeInOutCubic\` has zero derivative at \`t=0\` and \`t=1\`, so both ends are smooth. The page spends 2.5 s / speed on a transition, so slow playback stretches the animation instead of skipping.

## Turning text into a point cloud

The "text" shape rasterises on a 640 × 220 canvas, reads back pixels, samples every \`stride = 3\` rows and columns, converts opaque pixels into target points, then shuffles. \`stride\` is the resolution-vs-fleet-size trade: too large and the letters fragment, too small and there are not enough drones to go around.

## How 420 drones stay at 60 fps

Not 420 \`Mesh\` objects but 6 \`InstancedMesh\` batches (body, 2 arms, 4 props, 4 motors, 2 LED groups). Each frame computes one matrix per drone, writes it into \`instanceMatrix\`, sets \`needsUpdate\`, and the whole fleet draws in one call. That is the standard WebGL answer for many copies of one shape — and why the page can go to 800.

## Where reality diverges

Real drone shows have two constraints this page omits: **absolute positioning** (RTK-GPS or UWB, centimetre level, or they collide) and **separation margins** (neighbouring drones stay 1.5–2 m apart). Coordinates here are mathematically ideal; production choreography software runs a separation check after solving.

## Going one level deeper

1. What if the golden angle were \`π/2\`? Every point lands on one of four meridians — resonance caused by a rational ratio.
2. If two drones' paths cross during a transition, linear interpolation flies them into each other. Real software solves an **assignment problem (Hungarian algorithm)** to minimise total path length, plus altitude layering.`
    }
  },

  '/robot/embodied': {
    python: `"""How the embodied page poses a URDF rig: one quaternion per joint.

The page has no IK and no physics -- it parses URDF, then drives each joint
with a scripted periodic signal. That is exactly what this file does.
"""
import math


def axis_angle_quat(axis, angle):
    """URDF revolute joints rotate about one local axis. Quaternions avoid the
    gimbal lock that Euler angles hit at +/-90 deg."""
    x, y, z = axis
    s = math.sin(angle / 2)
    return (x * s, y * s, z * s, math.cos(angle / 2))


def trot(phase, knee_base=0.55, lift=0.35):
    """Quadruped trot: diagonal pairs move together, so two feet always push.
    phase = (elapsed / cycle) % 1 -- shared, but each leg is offset."""
    offset = {'fl': 0.0, 'rr': 0.0, 'fr': 0.5, 'rl': 0.5}
    out = {}
    for name, off in offset.items():
        p = (phase + off) % 1.0
        hip = math.sin(p * 2 * math.pi) * 0.6      # swing fore/aft
        swinging = p >= 0.5                        # second half = swing phase
        knee = knee_base + (lift if swinging else 0.0)   # bend only to clear ground
        out[name] = (hip, knee)
    return out


if __name__ == "__main__":
    cycle = 1.9                                     # page: 1.9 s per stride
    for i in range(8):
        t = i * cycle / 8
        legs = trot((t / cycle) % 1.0)
        fl_hip, fl_knee = legs['fl']
        fr_hip, _ = legs['fr']
        print(f"t={t:4.2f}s  FL=({fl_hip:+.2f},{fl_knee:.2f})  FR=({fr_hip:+.2f})")
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>One sine, four legs, two phases</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:560px;display:block;border-radius:8px;background:#0f172a}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:150px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:48px}
  .note{color:#64748b;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>The gait is a phase offset, nothing more</h1>
<p>Diagonal legs share a phase (FL+RR, then FR+RL). Knees only bend during the swing half, because the
stance leg has to carry load. Drag the cycle time and watch the two support triangles alternate.</p>
<canvas id="c" width="560" height="320"></canvas>
<div class="ctl">
  <label>cycle <input type="range" id="c" min="0.6" max="3" step="0.1" value="1.9"><output id="vc">1.9 s</output></label>
  <label>lift <input type="range" id="l" min="0.1" max="0.8" step="0.05" value="0.35"><output id="vl">0.35</output></label>
</div>
<div class="note">No IK, no physics. The page uses the same sine gait for the quadruped model, and the
G1 page replaces it with a learned policy — that is the whole difference between the two demos.</div>
<script>
(function () {
  var W = 560, H = 320, CX = W / 2, CY = 150;
  var t0 = performance.now();

  // body-relative foot anchor positions
  var LEGS = [
    { name: 'FL', x: -0.55, y: -0.45, off: 0.0 },
    { name: 'RR', x: 0.55, y: 0.45, off: 0.0 },
    { name: 'FR', x: 0.55, y: -0.45, off: 0.5 },
    { name: 'RL', x: -0.55, y: 0.45, off: 0.5 }
  ];

  function render() {
    var cycle = +document.getElementById('c').value;
    var lift = +document.getElementById('l').value;
    document.getElementById('vc').textContent = cycle.toFixed(1) + ' s';
    document.getElementById('vl').textContent = lift.toFixed(2);

    var t = ((performance.now() - t0) / 1000) % cycle;
    var phase = t / cycle;

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);

    // ground
    ctx.strokeStyle = '#1e293b';
    ctx.beginPath(); ctx.moveTo(0, CY + 96); ctx.lineTo(W, CY + 96); ctx.stroke();

    // body
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.ellipse(CX, CY - 20, 96, 54, 0, 0, Math.PI * 2);
    ctx.fill();

    LEGS.forEach(function (leg) {
      var p = (phase + leg.off) % 1;
      var swing = Math.sin(p * Math.PI * 2);           // fore/aft
      var inSwing = p >= 0.5;
      var knee = inSwing ? lift : 0;                   // bend only to clear ground
      var footX = CX + leg.x * 96 + swing * 34;
      var footY = CY + 70 - knee * 60 + (inSwing ? Math.max(0, Math.sin((p - 0.5) * 2 * Math.PI)) * 18 : 0);
      var hipX = CX + leg.x * 84;
      var hipY = CY + 10;

      ctx.strokeStyle = inSwing ? '#38bdf8' : '#22c55e';
      ctx.lineWidth = inSwing ? 5 : 7;
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      // two-segment leg through a knee at the midpoint plus the lift
      var kx = (hipX + footX) / 2 + swing * 8;
      var ky = (hipY + footY) / 2 - knee * 26;
      ctx.lineTo(kx, ky);
      ctx.lineTo(footX, footY);
      ctx.stroke();

      ctx.fillStyle = inSwing ? '#38bdf8' : '#22c55e';
      ctx.beginPath(); ctx.arc(footX, footY, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#94a3b8'; ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(leg.name, footX - 8, footY + 22);
    });

    ctx.fillStyle = '#94a3b8'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('phase ' + phase.toFixed(2) + ' · ' +
      (phase < 0.5 ? 'FL+RR in swing' : 'FR+RL in swing'), 12, 20);
    ctx.fillText('green = stance · blue = swing', 12, H - 14);
  }

  document.getElementById('c').addEventListener('input', render);
  document.getElementById('l').addEventListener('input', render);
  (function loop() { render(); requestAnimationFrame(loop); })();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## URDF 是什么，这一页怎么用它

URDF（Unified Robot Description Format）是一棵 **link 与 joint 的树**：link 是刚体（带 STL 几何、质量、惯性），joint 描述两个 link 怎么连（\`revolute\` 转、\`prismatic\` 推、\`fixed\` 死连接），每个 joint 有 \`axis\`（转轴）、\`origin\`（相对位置和姿态）、\`limit\`（角度上下限）。

页面的 \`urdf.ts\` 用 \`DOMParser\` 解析这段 XML，按层级建 \`Object3D\` 枢轴，把 STL 挂到对应 link 上。之后「让机器人动」就是**给每个 joint 的 quaternion 赋值**。五个机型（无人机、六足、六轴臂、四足、人形）共用同一个解析器 —— 这就是 URDF 存在的意义：几何与运动学描述和渲染代码解耦。

## 为什么关节用四元数，而不是欧拉角

欧拉角在 ±90° 附近会出现**万向锁**（两个旋转轴重合，丢失一个自由度）。机械臂的肘、四足的膝经常正好转到这里，用欧拉角会出现「转着转着突然翻面」。四元数没有这个问题，代价是四个数、需要归一化，且人不容易直观读懂。

## 脚本步态 = 手写动画，不是控制

四足的步态这里是一条正弦 + 相位偏移：对角腿（FL+RR / FR+RL）同相，所以任何时刻都有两只脚在推地。膝只在**摆动相**（后一半周期）弯曲，因为支撑相要伸直承重。

这是「手写动画」的做法。真实的四足用 MPC（模型预测控制）或强化学习策略，输入是 IMU 与足端力，输出是关节力矩 —— 页面的 **G1 / MicroDuck** 两个页面就是那条路线（MuJoCo + ONNX 策略），可以接着点进去看。

## 六足的「三足步态」

六条腿分两组交替（1-3-5 与 2-4-6），永远有三只脚着地 —— 三点确定一个平面，所以六足即使没有平衡控制也能站稳。这是生物启发机器人里最经典的稳定性论证。

## 想深一层

1. 为什么 URDF 里每个 link 都要写惯性矩阵？因为物理引擎靠它算力矩；纯渲染其实用不到，但同一份文件要能喂给 MuJoCo / PyBullet。
2. 页面里「爆炸视图」是把每个零件沿父节点方向外移，配合 \`lerp(1 - e^(-6.5dt))\` 做平滑 —— 这个指数形式保证与帧率无关，比固定步长插值稳。
3. 如果给这页加 IK（让足端踩在指定位置），四足的膝角就要用余弦定理解 —— 参考 **/robot/soma** 页的 \`leg_ik\`。`,
      en: `## What URDF is, and how this page uses it

URDF (Unified Robot Description Format) is a **tree of links and joints**: a link is a rigid body (STL geometry, mass, inertia); a joint says how two links connect (\`revolute\`, \`prismatic\`, \`fixed\`) and carries \`axis\`, \`origin\` and \`limit\`.

The page's \`urdf.ts\` parses that XML with \`DOMParser\`, builds \`Object3D\` pivots in hierarchy order, and attaches STLs to their links. After that, "making the robot move" is just **assigning a quaternion per joint**. All five models (drone, hexapod, 6-axis arm, quadruped, humanoid) share one parser — which is the entire point of URDF: geometry and kinematics decoupled from rendering code.

## Why joints use quaternions, not Euler angles

Euler angles gimbal-lock near ±90°, where two rotation axes coincide and a degree of freedom is lost. Elbows and knees routinely pass through that region, and with Euler angles the limb visibly flips. Quaternions have no such singularity; the price is four numbers, a normalisation step, and poor human legibility.

## A scripted gait is animation, not control

The quadruped gait here is a sine plus a phase offset: diagonal legs (FL+RR / FR+RL) stay in phase, so two feet always push. The knee bends only during the **swing half**, because the stance phase needs a straight, load-bearing leg.

That is hand-authored animation. Real quadrupeds use MPC or learned policies taking IMU and foot forces as input and emitting joint torques — the **G1** and **MicroDuck** pages on this site are exactly that route (MuJoCo + ONNX policy). Worth clicking through next.

## The hexapod's tripod gait

Six legs split into two alternating groups (1-3-5 and 2-4-6), so three feet are always down. Three points define a plane — which is why a hexapod stands stably with no balance controller at all. It is the classic stability argument in bio-inspired robotics.

## Going one level deeper

1. Why does every URDF link carry an inertia matrix? Physics engines need it for torques; pure rendering does not, but the same file must also feed MuJoCo / PyBullet.
2. The exploded view moves each part along its parent axis and smooths with \`lerp(1 - e^(-6.5dt))\` — an exponential form that is frame-rate independent, unlike fixed-step interpolation.
3. To add IK (feet at specified positions), knee angles come from the law of cosines — see \`leg_ik\` on the **/robot/soma** page.`
    }
  },

  '/robot/envsense': {
    python: `"""Sensor synthesis: everything on the envsense page is an empirical formula
driven by one physical quantity (the sun), then low-pass filtered."""
import math


def solar(hour):
    """Cosine daylight model: peak at 12:00, zero at 06:00 and 18:00."""
    return max(0.0, math.cos((hour - 12) / 12 * math.pi))


def targets(hour, occupants=3, vent=1, weather=1.0):
    """What each sensor *wants* to read. These are the page's formulas."""
    s = solar(hour) * weather
    return {
        'T1': 21 + 5 * s,                          # deg C
        'H1': 65 - 15 * s,                         # %RH
        'C1': 410 + occupants * 900 - vent * 260,   # ppm CO2
        'L1': 20 + 900 * s,                        # lux
        'P1': 1005 + 4 * math.sin(hour / 24 * 2 * math.pi),  # hPa
        'N1': 34 + 8 * s,                          # dB
        'S1': 0.3 + 4.2 * s,                       # m/s wind
    }


def low_pass(current, target, k):
    """First-order lag. A real sensor does not jump to the new value --
    it chases it, and k (per frame) sets how fast."""
    return current + (target - current) * k


if __name__ == "__main__":
    reading = targets(6)                                    # start at dawn
    for hour in range(6, 19):
        want = targets(hour, occupants=12 if 9 <= hour <= 17 else 2)
        # 0.08 per frame at 60 fps -> time constant ~0.2 s of simulated time
        for _ in range(60):
            for key in reading:
                reading[key] = low_pass(reading[key], want[key], 0.08)
        print(f"{hour:02d}:00  T1={reading['T1']:5.1f}C  C1={reading['C1']:6.0f}ppm")
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>One driver, seven sensors, one lag</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:150px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:48px}
  .stat{margin-top:8px;font-size:12px;color:#475569}
  .stat b{color:#0f172a;font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>The sun drives everything, then a lag filters it</h1>
<p>Temperature and CO₂ are not computed independently — both chase a target set by one driver. The
low-pass is what makes the sensor lag behind reality, which is the whole point of the page.</p>
<canvas id="c" width="620" height="200"></canvas>
<div class="ctl">
  <label>occupants <input type="range" id="n" min="0" max="30" step="1" value="6"><output id="vn">6</output></label>
  <label>ventilation <input type="range" id="v" min="0" max="4" step="1" value="1"><output id="vv">1</output></label>
  <label>k <input type="range" id="k" min="0.01" max="0.3" step="0.01" value="0.06"><output id="vk">0.06</output></label>
</div>
<div class="stat" id="stat"></div>
<div class="note">k is the per-frame blend of a first-order lag: out += (target - out) * k. Small k means
a slow sensor — visible as a curve that lags the dashed target.</div>
<script>
(function () {
  var temp = 22, co2 = 500, hour = 6;
  var hist = [];

  function target() {
    var solar = Math.max(0, Math.cos((hour - 12) / 12 * Math.PI));
    var n = +document.getElementById('n').value;
    var v = +document.getElementById('v').value;
    return {
      temp: 21 + 5 * solar + n * 0.08,
      co2: 410 + n * 90 - v * 120
    };
  }

  function step() {
    var k = +document.getElementById('k').value;
    var tg = target();
    temp += (tg.temp - temp) * k;
    co2 += (tg.co2 - co2) * k;
    hour += 0.02;
    if (hour > 24) hour = 0;
    hist.push({ t: temp, c: co2, tt: tg.temp });
    if (hist.length > 320) hist.shift();
  }

  function render() {
    document.getElementById('vn').textContent = document.getElementById('n').value;
    document.getElementById('vv').textContent = document.getElementById('v').value;
    document.getElementById('vk').textContent = (+document.getElementById('k').value).toFixed(2);

    for (var i = 0; i < 2; i++) step();

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 200;
    ctx.clearRect(0, 0, W, H);

    function Y(v, lo, hi) { return H - 26 - (v - lo) / (hi - lo) * (H - 48); }

    // target (dashed) and actual (solid) for temperature
    ctx.beginPath();
    hist.forEach(function (p, i) {
      var x = 30 + i / 319 * (W - 46);
      if (i === 0) ctx.moveTo(x, Y(p.tt, 18, 32)); else ctx.lineTo(x, Y(p.tt, 18, 32));
    });
    ctx.strokeStyle = '#f59e0b'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    hist.forEach(function (p, i) {
      var x = 30 + i / 319 * (W - 46);
      if (i === 0) ctx.moveTo(x, Y(p.t, 18, 32)); else ctx.lineTo(x, Y(p.t, 18, 32));
    });
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2; ctx.stroke();

    // CO2 normalised into the same box
    ctx.beginPath();
    hist.forEach(function (p, i) {
      var x = 30 + i / 319 * (W - 46);
      var v = 400 + (p.c - 400) / 2500 * 12;      // squeeze into 18..32
      if (i === 0) ctx.moveTo(x, Y(v, 18, 32)); else ctx.lineTo(x, Y(v, 18, 32));
    });
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1.6; ctx.stroke();

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('red = temperature · dashed = target · blue = CO2 (scaled)', 30, 16);
    ctx.fillText('hour ' + hour.toFixed(1), W - 92, 16);

    var tg = target();
    document.getElementById('stat').innerHTML =
      'T <b>' + temp.toFixed(1) + ' °C</b> (target ' + tg.temp.toFixed(1) + ') · CO₂ <b>' +
      Math.round(co2) + ' ppm</b> (target ' + Math.round(tg.co2) + ')';
  }

  ['n', 'v', 'k'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  (function loop() { render(); requestAnimationFrame(loop); })();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 这页模拟的是「传感器」，不是「房间」

七个传感器的读数全部由**一个驱动量**推出来：太阳高度角。\`cos((h-12)/12·π)\` 在正午为 1、6 点和 18 点为 0，正好是一条日照曲线。温度、湿度、照度、噪声、风速都挂在这个值上，再乘一个天气系数。

这不是物理仿真（没有热容、没有辐射传输），而是一层**经验模型**。对教学目标来说这个选择是对的：学生要理解的是「照度上升 → 温度滞后上升 → 空调启动」这类**因果链与响应速度**，而不是求解热传导方程。

## CO₂ 那条式子是质量平衡的简化

\`410 + 人数×900 - 通风×260\`：410 ppm 是室外背景值，每个人稳定贡献约 900 ppm 的增量，每次通风档位带走 260 ppm。真实房间是一阶微分方程 \`dC/dt = (G - Q·(C - C_out))/V\`，稳态解长得和上面几乎一样 —— 也就是说，这条经验公式其实是那个 ODE 的**稳态**。

代价是它没有「关窗后 CO₂ 爬升需要多久」这个过程。想补上，就把 \`low_pass\` 里的 \`k\` 用 \`1 - e^(-dt/τ)\` 替换，\`τ = V/Q\`。

## 一阶低通 = 传感器的响应时间

\`v += (target - v) * k\`，\`k = 0.08\`。这是离散化的一阶惯性环节，等价于连续域的 \`τ = dt / k\`。在 60 fps 下 \`τ ≈ 0.2 s\` 的**仿真时间**——因为页面把时间加速了 30 倍，真实体感是 6 秒左右，和家用温湿度计的响应速度差不多。

照度用的是 0.25，比其他快：光电二极管确实比热敏电阻快得多。这类「不同传感器不同时间常数」的细节，是这页最值得抄的地方。

## 两级阈值 + 时间加速的取舍

每个量有 warn 和 alarm 两级阈值，触发时变色并写日志。时间加速 30 倍、以 2 分钟为上限分子步，是为了让一整天在几分钟内跑完。**分子步**这一步很关键：如果直接把 \`dt\` 乘以 30，低通滤波会跳过大量中间状态，曲线会变成折线。

## 想深一层

1. 页面加了均匀噪声（±1 个量化单位），模拟 ADC 抖动。没有噪声的话，曲线太完美，学生会以为真实传感器也这么干净。
2. 想验证「经验公式 vs 物理模型」的差距，可以给房间加一个阶跃（突然开窗），看 CO₂ 曲线：经验公式会瞬间跳到新稳态，真实系统会走一条指数曲线。`,
      en: `## This page simulates sensors, not a room

All seven readings derive from **one driver**: solar elevation. \`cos((h-12)/12·π)\` is 1 at noon and 0 at 06:00 and 18:00 — a daylight curve. Temperature, humidity, illuminance, noise and wind all hang off it, scaled by a weather factor.

This is not physical simulation (no heat capacity, no radiative transfer) but an **empirical layer**. For teaching that is the right call: what students need is the causal chain and the *speed* of response ("light rises → temperature lags → AC starts"), not a conduction equation.

## The CO₂ formula is a mass balance at steady state

\`410 + occupants×900 - vent×260\`: 410 ppm outdoor baseline, ~900 ppm per occupant, 260 ppm removed per ventilation step. A real room is \`dC/dt = (G - Q·(C - C_out))/V\`, whose steady-state solution looks almost identical — the empirical formula *is* that ODE's equilibrium.

What it loses is the transient: how long CO₂ takes to climb after closing a window. To add it, replace \`k\` in \`low_pass\` with \`1 - e^(-dt/τ)\` and \`τ = V/Q\`.

## First-order lag = sensor response time

\`v += (target - v) * k\` with \`k = 0.08\` is a discretised first-order lag, equivalent to \`τ = dt / k\` in continuous time. At 60 fps that is \`τ ≈ 0.2 s\` of **simulated** time — about 6 s of wall-clock at the page's 30× speed-up, close to a domestic thermometer/hygrometer.

Illuminance uses 0.25, much faster: photodiodes really are far quicker than thermistors. These per-sensor time constants are the most copyable detail on the page.

## Two-stage thresholds, and the cost of time compression

Each quantity has warn and alarm thresholds that recolour the UI and write a log line. The 30× speed-up (sub-stepping, capped at 2 minutes) compresses a day into minutes. **Sub-stepping** matters: multiplying \`dt\` by 30 directly would make the low-pass skip intermediate states and turn smooth curves into polylines.

## Going one level deeper

1. Uniform noise (about one quantisation step) models ADC jitter. Without it the curves are unrealistically clean, and students assume real sensors behave that way.
2. To feel the gap between empirical and physical: step the room (open a window suddenly) and watch CO₂. The empirical model jumps straight to a new steady state; a real system follows an exponential.`
    }
  },

  '/robot/g1-cartpole': {
    python: `"""The loop shared by the two G1 pages: MuJoCo steps at 1 kHz, the policy at 50 Hz.

MuJoCo integrates the physics; the ONNX policy decides what to push on.
"decimation" is the gear between those two rates.
"""
import numpy as np

PHYSICS_DT = 0.001        # MuJoCo timestep for the G1 scene
CONTROL_DT = 0.02         # the policy was trained at 50 Hz
DECIMATION = round(CONTROL_DT / PHYSICS_DT)   # -> 20 physics steps per decision
ACTION_SCALE = np.array([...])                # per-joint, from the training config


def control_step(env, policy, obs_mean, obs_std):
    # 1) Observe exactly the vector the policy saw in training.
    #    G1 balance: 3 angular velocity + 3 gravity + 29 qpos + 29 qvel + 29 last action
    obs = env.observation()                      # shape (93,)

    # 2) Normalise with the TRAINING statistics. Skipping this (or using your own
    #    mean/std) is the single most common deployment bug.
    x = (obs - obs_mean) / obs_std

    # 3) One forward pass -> actions in [-1, 1].
    action = np.clip(policy(x[None].astype(np.float32))[0], -1.0, 1.0)

    # 4) Scale to joint targets and HOLD for the whole control period.
    #    Feeding a new action every 1 ms would violate the policy's assumption
    #    that 20 ms of dynamics happen between decisions.
    target = env.default_joint_pos + action * ACTION_SCALE
    for _ in range(DECIMATION):
        env.set_ctrl(target)
        env.mj_step()
    return action


# Cartpole is the same loop with 5 inputs instead of 93:
#   [cart_pos, sin(pole), cos(pole), cart_vel, pole_vel] -> one force slider
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Balance is unstable — that is the whole problem</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:560px;display:block;border-radius:8px;background:#0f172a}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px;align-items:center}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:130px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:48px}
  button{font:inherit;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer}
  .stat{margin-top:8px;font-size:12px;color:#475569}
  .stat b{color:#0f172a;font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>No controller, no balance</h1>
<p>Turn the gain to zero and the pole falls in about a second — the open-loop system is unstable, which
is why this task needs a policy rather than a script. Turn it up and watch it recover.</p>
<canvas id="c" width="560" height="300"></canvas>
<div class="ctl">
  <label>Kp <input type="range" id="p" min="0" max="14" step="0.5" value="9"><output id="vp">9.0</output></label>
  <label>Kd <input type="range" id="d" min="0" max="4" step="0.1" value="1.8"><output id="vd">1.8</output></label>
  <button id="kick">push it</button>
</div>
<div class="stat" id="stat"></div>
<div class="note">The physics here is the linearised cart-pole: θ'' = (g/L)·sinθ − u/L. Good enough to show
instability; the page's G1 model uses MuJoCo with contacts and 29 joints.</div>
<script>
(function () {
  var DT = 0.008, G = 9.81, L = 0.9;
  var theta = 0.12, dtheta = 0, cartX = 0, cartV = 0;
  var trail = [];

  function step(kp, kd) {
    // PD on the pole angle; the action is a horizontal force
    var u = kp * theta + kd * dtheta;
    var acc = (G / L) * Math.sin(theta) - u / L;
    dtheta += acc * DT;
    theta += dtheta * DT;
    // cart reacts to the same force (roughly)
    cartV += -u * DT * 0.4;
    cartX += cartV * DT;
    cartX = Math.max(-1, Math.min(1, cartX));
    if (Math.abs(theta) > 1.2) { theta = 0.12 * (theta > 0 ? 1 : -1); dtheta = 0; }
    trail.push(theta);
    if (trail.length > 240) trail.shift();
  }

  function render() {
    var kp = +document.getElementById('p').value;
    var kd = +document.getElementById('d').value;
    document.getElementById('vp').textContent = kp.toFixed(1);
    document.getElementById('vd').textContent = kd.toFixed(1);

    for (var i = 0; i < 3; i++) step(kp, kd);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 560, H = 300, ground = 210;
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#1e293b';
    ctx.beginPath(); ctx.moveTo(0, ground); ctx.lineTo(W, ground); ctx.stroke();

    var cx = W / 2 + cartX * 170;
    // cart
    ctx.fillStyle = '#475569';
    ctx.fillRect(cx - 34, ground - 20, 68, 20);
    ctx.fillStyle = '#1e293b';
    ctx.beginPath(); ctx.arc(cx - 20, ground, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 20, ground, 7, 0, Math.PI * 2); ctx.fill();

    // pole
    var px = cx + Math.sin(theta) * 130;
    var py = ground - 20 - Math.cos(theta) * 130;
    ctx.strokeStyle = Math.abs(theta) > 0.5 ? '#ef4444' : '#fbbf24';
    ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, ground - 20); ctx.lineTo(px, py); ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill();

    // angle trace
    ctx.beginPath();
    trail.forEach(function (a, i) {
      var x = 20 + i / 239 * (W - 40);
      var y = 90 - a * 60;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.6; ctx.stroke();

    ctx.fillStyle = '#94a3b8'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('pole angle over time', 20, 20);
    ctx.fillText('θ = ' + (theta * 180 / Math.PI).toFixed(1) + '°', W - 110, 20);

    document.getElementById('stat').innerHTML =
      'θ <b>' + (theta * 180 / Math.PI).toFixed(1) + '°</b> · ' +
      (Math.abs(theta) < 0.2 ? '<span style="color:#16a34a">balanced</span>'
        : Math.abs(theta) < 0.6 ? '<span style="color:#b45309">drifting</span>'
        : '<span style="color:#dc2626">falling</span>');
  }

  document.getElementById('p').addEventListener('input', render);
  document.getElementById('d').addEventListener('input', render);
  document.getElementById('kick').addEventListener('click', function () {
    dtheta += 0.9;                    // a disturbance, like a shove
  });
  (function loop() { render(); requestAnimationFrame(loop); })();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 两个时钟：1 kHz 物理，50 Hz 决策

MuJoCo 的 \`mj_step\` 以 0.001 s 步长积分动力学（接触、约束、摩擦都在这层解）。策略网络的训练是在 50 Hz 下做的 —— 也就是每 20 ms 才做一次决策。\`decimation = round(controlDt / timestep) = 20\` 就是把这两个时钟对上：**一次决策，连续执行 20 个物理步**。

这个细节不是性能优化，而是**语义正确性**。策略学到的是「在这个观测下推 20 ms」，如果每 1 ms 换一次动作，实际动力学就和训练时不一样了，机器人会抖。同样的道理在真实硬件上就是控制周期必须稳定 —— 抖动比频率低更致命。

## 观测向量的构成，每一项都有理由

G1 平衡任务 93 维 = **3 角速度 + 3 重力投影 + 29 关节位置 + 29 关节速度 + 29 上一帧动作**。

- **重力投影**代替欧拉角：它告诉策略"哪边是下"，没有万向锁，且在对称姿态下连续；
- **上一帧动作**：策略需要知道自己的动作历史，否则学不到平滑性（这一项在论文里常写作 \`last_action\` 或 \`prev_action\`）；
- Cartpole 只有 5 维：\`[车位置, sin(杆角), cos(杆角), 车速度, 杆角速度]\`。用 sin/cos 而不是角度，是因为角度在 ±π 处不连续 —— 而倒立摆的杆会转整圈。

## 归一化必须用训练时的统计量

\`(obs - mean) / std\` 里的 mean/std 是训练时**滑动统计**的产物，随 checkpoint 一起存。用推理时自己算的统计量、或者干脆跳过归一化，是部署阶段最常见的 bug —— 而且它不报错，只是表现变差，非常难查。

## 为什么动作要 clip 再 scale

策略输出理论上在 [-1, 1]，但分布外观测（比如被人推了一把）会让它越界。clip 是保命的；scale 是每个关节不同的量程（大腿关节和手指不可能一样）。页面里 29 个关节各有自己的 scale，这份表必须和训练配置逐项一致。

## ONNX 这一层值不值

PyTorch 直接导出 ONNX 再在浏览器里跑，好处是**同一份模型既能上机器人也能进网页**，坏处是丢掉了一些算子（自定义激活、量化）。这页选 ONNX 是因为要跑在 WASM/WebGPU 上 —— 也意味着推理延迟在 10–40 ms 量级，正好和 50 Hz 的控制周期同一个数量级，所以这页的策略必须小（几层 MLP，几万参数）。

## 想深一层

1. 为什么 MuJoCo 而不是自写积分器？接触求解需要 LCP（线性互补问题），自己写会在堆叠、摩擦锥上出各种诡异抖动。
2. WebGPU 一定比 WASM 快吗？不一定：小模型（<1M 参数）在 WebGPU 上有 kernel 启动开销，实测常常 WASM 更快。页面两个后端都在，可以直接对比。`,
      en: `## Two clocks: 1 kHz physics, 50 Hz decisions

MuJoCo's \`mj_step\` integrates dynamics at 0.001 s (contacts, constraints and friction are solved at this layer). The policy was trained at 50 Hz — one decision every 20 ms. \`decimation = round(controlDt / timestep) = 20\` aligns the clocks: **one decision, executed over 20 consecutive physics steps**.

That is not a performance trick, it is **semantic correctness**. The policy learned "given this observation, push for 20 ms". Handing it a new action every 1 ms changes the dynamics it was trained on, and the robot chatters. On real hardware this is the rule that control periods must be stable — jitter is worse than a low rate.

## Why every term of the observation exists

G1 balance is 93 dims = **3 angular velocity + 3 gravity projection + 29 joint positions + 29 joint velocities + 29 previous actions**.

- **Gravity projection** instead of Euler angles: it says "which way is down", has no gimbal lock, and is continuous through symmetric poses;
- **Previous action**: the policy needs its own action history or it cannot learn smoothness (usually \`last_action\` / \`prev_action\` in papers);
- Cartpole needs only 5: \`[cart pos, sin(pole), cos(pole), cart vel, pole vel]\`. sin/cos rather than an angle because the angle is discontinuous at ±π — and a cartpole's pole spins all the way round.

## Normalisation must use training statistics

The mean/std in \`(obs - mean) / std\` come from running statistics during training and ship with the checkpoint. Computing your own at inference time, or skipping it, is the most common deployment bug — and it is silent, degrading behaviour without any error.

## Why clip then scale

Policy output is nominally [-1, 1], but out-of-distribution observations (someone shoving the robot) push it past that. Clipping is a safety net; scaling is per-joint because a thigh and a finger cannot share a range. The page's 29 per-joint scales must match the training config item by item.

## Is the ONNX layer worth it

Exporting PyTorch to ONNX and running it in a browser means **one model serves both the robot and the web page**; the cost is losing some operators (custom activations, quantisation). This page uses ONNX to run on WASM/WebGPU, which also caps inference at roughly 10–40 ms — the same order as a 50 Hz control period. That is why the policy must stay small: a few MLP layers, tens of thousands of parameters.

## Going one level deeper

1. Why MuJoCo instead of a hand-written integrator? Contact needs an LCP (linear complementarity) solve; rolling your own produces mysterious jitter on stacks and friction cones.
2. Is WebGPU always faster than WASM? No — small models (<1M params) pay kernel launch overhead, and WASM often wins in practice. Both backends are present, so you can compare directly.`
    }
  },

  '/robot/g1-motion-tracking': {
    python: `"""Motion tracking: the policy sees the FUTURE of the reference clip.

Observation is 623 dims because the same reference frame is sampled at several
future offsets -- a feed-forward hint, not just feedback.
"""
import numpy as np

FUTURE_STEPS = (0, 2, 4, 8, 16)   # x 0.02 s -> looks 0.32 s ahead
HISTORY = (0, 1, 2, 3, 4, 8)


def build_obs(q, dq, prev_actions, t, ref, dt=0.02):
    i = int(round(t / dt))
    parts = [q, dq, prev_actions]

    for k in FUTURE_STEPS:
        j = min(i + k, len(ref) - 1)
        parts.append(ref[j]['joint_pos'])        # 29
        parts.append([ref[j]['root_z']])         # 1
        parts.append(ref[j]['gravity'])          # 3

    for k in HISTORY:
        j = max(0, i - k)
        parts.append(ref[j]['joint_pos'])        # 29 per step
    # + BootIndicator + TrackingCommandObs -> 623 total

    return np.concatenate([np.asarray(p, dtype=np.float32).ravel() for p in parts])


def pd(target, q, dq, kp, kd):
    """The low-level loop: the policy writes joint targets, PD turns them into
    torques at 1 kHz. kp/kd differ per joint group (hip / knee / ankle)."""
    return kp * (target - q) - kd * dq
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Tracking lags without the future</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:140px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:48px}
  label.chk{display:inline-flex;gap:6px;align-items:center;font-size:12px;margin-top:10px}
  .stat{margin-top:8px;font-size:12px;color:#475569}
  .stat b{color:#0f172a;font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>Feedback alone is always late</h1>
<p>Yellow is the reference joint angle. Blue is PD tracking with feedback only — it lags. Tick
"feed-forward" and the policy sees the reference 0.32 s ahead, which removes most of the lag.</p>
<canvas id="c" width="620" height="200"></canvas>
<div class="ctl">
  <label>Kp <input type="range" id="p" min="2" max="40" step="1" value="14"><output id="vp">14</output></label>
  <label>Kd <input type="range" id="d" min="0" max="6" step="0.2" value="2"><output id="vd">2.0</output></label>
</div>
<label class="chk"><input type="checkbox" id="ff"> feed-forward (look 0.32 s ahead)</label>
<div class="stat" id="stat"></div>
<div class="note">This is the difference between the G1 balance page (feedback only, 93-dim obs) and this
one (623-dim obs, which is mostly the same reference sampled at five future offsets).</div>
<script>
(function () {
  var DT = 0.01, t = 0;
  var q = 0, dq = 0, hist = [];
  var LOOKAHEAD = 0.32;

  function ref(tt) {
    // a walking-like joint trajectory: two harmonics
    return 0.6 * Math.sin(tt * 3.1) + 0.25 * Math.sin(tt * 6.6 + 0.8);
  }

  function step(kp, kd, ff) {
    var target = ref(t + (ff ? LOOKAHEAD : 0));
    var tau = kp * (target - q) - kd * dq;
    dq += tau * DT;
    q += dq * DT;
    t += DT;
    hist.push({ target: ref(t), q: q });
    if (hist.length > 300) hist.shift();
  }

  function render() {
    var kp = +document.getElementById('p').value;
    var kd = +document.getElementById('d').value;
    var ff = document.getElementById('ff').checked;
    document.getElementById('vp').textContent = kp;
    document.getElementById('vd').textContent = kd.toFixed(1);

    for (var i = 0; i < 2; i++) step(kp, kd, ff);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 200;
    ctx.clearRect(0, 0, W, H);
    var X = i => 30 + i / 299 * (W - 46);
    var Y = v => H / 2 - v * 60;

    ctx.strokeStyle = '#f1f5f9';
    ctx.beginPath(); ctx.moveTo(30, H / 2); ctx.lineTo(W - 16, H / 2); ctx.stroke();

    ctx.beginPath();
    hist.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(X(i), Y(p.target)); else ctx.lineTo(X(i), Y(p.target));
    });
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.6; ctx.stroke();

    ctx.beginPath();
    hist.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(X(i), Y(p.q)); else ctx.lineTo(X(i), Y(p.q));
    });
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.stroke();

    var err = 0;
    hist.slice(-80).forEach(function (p) { err += Math.abs(p.target - p.q); });
    err /= Math.min(80, hist.length);

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('reference (yellow) vs actual (blue)', 30, 16);
    ctx.fillText(ff ? 'feed-forward on: target = ref(t + 0.32)' : 'feedback only: target = ref(t)', 30, H - 10);

    document.getElementById('stat').innerHTML =
      'mean error <b>' + err.toFixed(3) + ' rad</b> · ' +
      (err < 0.05 ? '<span style="color:#16a34a">tight tracking</span>'
                  : err < 0.15 ? '<span style="color:#b45309">visible lag</span>'
                  : '<span style="color:#dc2626">falling behind</span>');
  }

  ['p', 'd'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  document.getElementById('ff').addEventListener('change', function () {
    hist = []; t = 0; q = 0; dq = 0;      // restart so the comparison is honest
  });
  (function loop() { render(); requestAnimationFrame(loop); })();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 「跟踪动作」和「走到某点」是两种任务

走到某点是**目标驱动**：到达就结束。跟踪动作是**轨迹驱动**：每一帧都有一个参考姿态，误差是「当前姿态 vs 此刻应有的姿态」，而且参考轨迹的下文是已知的（动作片段早就录好了）。

这条差异直接决定了观测设计：既然未来已知，就该把它喂给策略。

## 为什么要看未来 0.32 秒

纯反馈系统有个物理下限：**误差出现之后才能纠正**。机器人腿有惯量，等姿态偏了再发力，已经晚了半个周期。所以策略同时看 \`[0, 2, 4, 8, 16]\` 帧（0 / 40 / 80 / 160 / 320 ms）之后的参考姿态 —— 相当于提前知道「马上要抬腿了」，可以先把重心移过去。

这个思路在控制里叫**前馈（feed-forward）**。人走路也是这样：你不是等身体歪了才调整，而是根据「下一步要迈哪只脚」预先分配重心。

## 623 维是怎么来的

不是特征工程，是**把同一批数据在多个时间点采样后拼起来**：

- 当前：29 关节位置 + 29 速度 + 29×3 上一动作
- 未来 5 个偏移 × （29 关节位置 + 1 根高度 + 3 重力投影）
- 历史 6 个偏移 × 29 关节位置
- 加上启动指示位与跟踪指令

这么做的原因是策略是 MLP（不是 LSTM/Transformer），没有内建记忆。**要让它「记得」，只能把历史显式拼进输入**。这是把时序问题压成静态回归的标准手法，代价是输入维度随历史长度线性膨胀。

## PD 环还在，而且必须分组调参

策略输出的是**关节目标位置**（\`control_type = joint_position\`），不是力矩。MuJoCo 内部用 PD 把它转成力矩：\`τ = kp·(q_target - q) - kd·q̇\`。

k p/kd 按关节组分：髋 40.18 / 2.56、膝 99.10 / 6.31、踝 28.50 / 1.81 …… 刚度差 3 倍以上。为什么？膝盖承重最大且行程短，需要硬；踝关节要吸收冲击，需要软。**一套参数走天下是外行的做法**。

## 41 个参考动作从哪来

页面里是预先录好的 41 个 JSON：每帧包含关节角、根节点高度、重力方向。来源通常是动作捕捉 + 重定向（retargeting）—— 把人的骨架映射到 29 自由度的机器人上。这一步是整个流水线里最容易被低估的部分：**重定向做不好，策略再强也学不会**（脚会打滑、关节会撞限位）。

## 想深一层

1. 未来帧数量是超参。看得太远（比如 1 秒），策略会「预判错误」；看得太近，前馈失效。0.2–0.4 秒是这类任务的常见区间。
2. 观测里为什么要根高度而不要根位置？因为策略需要在**任意场地**工作，绝对位置是无关变量，带上只会让训练分布发散。`,
      en: `## "Track a motion" and "walk to a point" are different tasks

Walking to a point is **goal-driven**: done on arrival. Tracking a motion is **trajectory-driven**: every frame has a reference pose, the error is "current pose vs the pose you should be in right now" — and the rest of the reference is known in advance, because the clip was recorded earlier.

That difference dictates the observation design: if the future is known, feed it in.

## Why look 0.32 s ahead

Pure feedback has a physical floor: **an error must exist before it can be corrected**. Legs have inertia, so reacting once the pose has drifted is half a cycle too late. The policy therefore reads the reference at \`[0, 2, 4, 8, 16]\` frames ahead (0 / 40 / 80 / 160 / 320 ms) — it knows a leg is about to lift and can shift the centre of mass first.

Control theory calls this **feed-forward**. Human walking works the same way: you do not wait to tip over, you pre-load weight based on which foot goes next.

## Where 623 dims come from

Not feature engineering but **the same data sampled at several points in time and concatenated**:

- Now: 29 joint positions + 29 velocities + 29×3 previous actions
- 5 future offsets × (29 joints + root height + 3 gravity)
- 6 history offsets × 29 joint positions
- plus a boot indicator and the tracking command

The reason is that the policy is an MLP, not an LSTM or Transformer, so it has no built-in memory. **To make it "remember", the history must be concatenated into the input.** That is the standard way to flatten a sequence problem into regression; the cost is input size growing linearly with history.

## The PD loop stays, and it must be tuned per group

The policy emits **joint position targets** (\`control_type = joint_position\`), not torques. MuJoCo's PD turns them into torque: \`τ = kp·(q_target - q) - kd·q̇\`.

kp/kd are grouped: hip 40.18 / 2.56, knee 99.10 / 6.31, ankle 28.50 / 1.81 … a 3× spread in stiffness. Why? The knee carries the most load over a short range and must be stiff; the ankle absorbs impacts and must be soft. One set of gains for everything is amateur work.

## Where the 41 reference clips come from

The page ships 41 JSON files, each frame holding joint angles, root height and gravity direction. They normally originate from motion capture plus **retargeting** — mapping a human skeleton onto a 29-DoF robot. This is the most underrated step in the pipeline: bad retargeting means feet slide and joints hit limits, and no policy can learn through that.

## Going one level deeper

1. The number of future frames is a hyperparameter. Too far (say 1 s) and the policy mis-predicts; too near and feed-forward is useless. 0.2–0.4 s is the usual band for these tasks.
2. Why root *height* and not root *position*? The policy must work on any ground; absolute position is an irrelevant variable that only widens the training distribution.`
    }
  },

  '/robot/microduck': {
    python: `"""MicroDuck: one policy, 61 numbers in, 14 torques out, 200 Hz decisions.

The observation layout is the whole interface -- get it wrong and the robot
falls over while every number "looks right".
"""
import numpy as np

PHYSICS_DT = 0.005      # MuJoCo timestep
DECIMATION = 4          # -> 20 ms control period (50 Hz)
ACTION_SCALE = 1.0      # ctrl = default + action * scale


def build_obs(gyro, gravity, q, dq, last_action, command):
    """61 dims, in exactly this order:
       3 gyro + 3 gravity + 14 q + 14 dq + 14 last action + 13 command
    """
    return np.concatenate([gyro, gravity, q, dq, last_action, command]).astype(np.float32)


def command_vector(vx, vy, wz, gait_phase, height):
    """The 13-dim command: body twist, gait clock, stance height + padding.
    The gait clock is the trick -- the policy does not invent a rhythm, it
    follows the phase you feed it, so you can speed the gait up at runtime."""
    cmd = np.zeros(13, dtype=np.float32)
    cmd[0], cmd[1], cmd[2] = vx, vy, wz
    cmd[3], cmd[4] = np.sin(2 * np.pi * gait_phase), np.cos(2 * np.pi * gait_phase)
    cmd[5] = height
    return cmd


def step(env, policy, obs):
    action = np.clip(policy(obs[None])[0], -1.0, 1.0)     # 14 torques, scaled
    target = env.default_ctrl + action * ACTION_SCALE
    for _ in range(DECIMATION):
        env.ctrl[:] = target
        env.step()
    return action
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>61 numbers, one order, no room for error</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .ctl{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:12px;align-items:center}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:120px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:44px}
  .note{color:#64748b;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>The observation layout is the interface</h1>
<p>Three gyro, three gravity, fourteen joints, fourteen velocities, fourteen last actions, thirteen
commands. Shift any block by one slot and the robot falls — with no error message anywhere.</p>
<canvas id="c" width="620" height="220"></canvas>
<div class="ctl">
  <label>vx <input type="range" id="x" min="-1" max="1" step="0.05" value="0.4"><output id="vx">0.40</output></label>
  <label>wz <input type="range" id="w" min="-1" max="1" step="0.05" value="0"><output id="vw">0.00</output></label>
  <label>phase <input type="range" id="p" min="0" max="1" step="0.02" value="0.25"><output id="vp">0.25</output></label>
</div>
<div class="note">The gait clock is stored as sin/cos precisely so the phase wraps smoothly: at phase
1.00 the pair reads the same as at 0.00, so the policy never sees a jump.</div>
<script>
(function () {
  var BLOCKS = [
    { name: 'gyro', n: 3, color: '#2563eb' },
    { name: 'gravity', n: 3, color: '#0ea5e9' },
    { name: 'qpos', n: 14, color: '#16a34a' },
    { name: 'qvel', n: 14, color: '#65a30d' },
    { name: 'last action', n: 14, color: '#f59e0b' },
    { name: 'command', n: 13, color: '#7c3aed' }
  ];

  function render() {
    var vx = +document.getElementById('x').value;
    var wz = +document.getElementById('w').value;
    var phase = +document.getElementById('p').value;
    document.getElementById('vx').textContent = vx.toFixed(2);
    document.getElementById('vw').textContent = wz.toFixed(2);
    document.getElementById('vp').textContent = phase.toFixed(2);

    // build the command block: vx, vy, wz, sin, cos, height, then padding
    var cmd = [vx, 0, wz, Math.sin(2 * Math.PI * phase), Math.cos(2 * Math.PI * phase), 0.28];
    while (cmd.length < 13) cmd.push(0);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 220;
    ctx.clearRect(0, 0, W, H);

    var total = BLOCKS.reduce(function (a, b) { return a + b.n; }, 0);
    var x = 20, y = 60, bw = (W - 40) / total;

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('61 values, in this order', 20, 36);

    BLOCKS.forEach(function (b) {
      ctx.fillStyle = b.color + '33';
      ctx.fillRect(x, y, b.n * bw, 40);
      ctx.strokeStyle = b.color; ctx.lineWidth = 1.4;
      ctx.strokeRect(x, y, b.n * bw, 40);
      ctx.fillStyle = b.color;
      ctx.fillText(b.name, x + 4, y + 58);
      ctx.fillText(b.n + '', x + 4, y + 74);
      x += b.n * bw;
    });

    // the command block in detail
    ctx.fillStyle = '#0f172a'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('command block:', 20, 150);
    cmd.forEach(function (v, i) {
      var cx = 20 + i * 44;
      var lit = Math.abs(v);
      ctx.fillStyle = i < 6 ? 'rgba(124,58,237,' + (0.15 + Math.min(1, lit) * 0.7) + ')' : '#f1f5f9';
      ctx.fillRect(cx, 160, 40, 26);
      ctx.strokeStyle = '#cbd5e1'; ctx.strokeRect(cx, 160, 40, 26);
      ctx.fillStyle = '#334155';
      ctx.fillText(v.toFixed(2).slice(0, 5), cx + 3, 178);
    });

    ctx.fillStyle = '#64748b';
    ctx.fillText('vx  vy  wz  sin(phase)  cos(phase)  height  …  padding', 20, 208);
  }

  ['x', 'w', 'p'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 观测顺序就是接口

61 维不是随便排的：**3 陀螺 + 3 重力投影 + 14 关节角 + 14 关节速度 + 14 上一动作 + 13 指令**。顺序错一位，机器人立刻摔倒 —— 因为倒二位置的"关节速度"被当成了"关节角"，策略收到的世界完全是假的。

这类 bug 的特点是**不报错**。所以工程上的标准做法是把观测布局写成常量表（页面就是这么做的），并在训练与部署两侧共用同一份定义。做这类项目时，张量形状对得上不代表语义对得上。

## 指令里的「步态时钟」是个好设计

13 维指令里最值得学的是第 4、5 位：\`sin(2π·phase)\` 和 \`cos(2π·phase)\`。

为什么不用一个 \`phase ∈ [0,1)\`？因为它在 1 处不连续 —— 策略会把"1.0 和 0.0"当成两个截然不同的状态，在循环点产生跳变。用 sin/cos 编码后，相位变成了单位圆上的连续点，绕一圈自然闭合。

更妙的是**时钟由外部提供**：策略不自己发明节奏，而是跟着你给的相位走。所以运行时可以随时加速、减速、甚至倒放步态，不需要重新训练。这是"把时间从策略里拿出来"的经典手法。

## 七个策略怎么切换

页面带了 7 个常驻策略（走、坐站、翻滚、左踢、右踢、地面拾取、站立）加 2 个 rollers 变体。切换时**不能直接换网络** —— 观测里的 \`last_action\` 还留着上一个策略的动作，会瞬间产生巨大的力矩跳变。做法通常是：切策略时把 \`last_action\` 平滑过渡，或者给一个短暂的过渡策略。

## 鼠标拖拽为什么用弹簧力

\`xfrc_applied\` 是 MuJoCo 施加在刚体上的外力。页面用刚度 100、阻尼 10 的 PD 弹簧把"鼠标指向的位置"变成力，上限 200 N。

为什么不直接把机器人瞬移过去？因为那样会破坏物理一致性 —— 速度无穷大，接触求解器会直接爆炸。**任何对物理引擎的「外部干预」都应该以力的形式表达**，这是仿真里的一条铁律。

## 地形是程序化生成的

65 × 65 的 hfield（高度场）。hfield 是 MuJoCo 表示地形的标准形式：一张高度图 + 一个尺度，比三角网格省内存，且碰撞检测天然高效。程序化生成意味着每次重置地形都不同，能测策略的泛化 —— 这比固定地形训练有用得多。

## 想深一层

1. 为什么物理步长是 5 ms 而 G1 是 1 ms？MicroDuck 更小更轻，最高频率的模态更低，5 ms 仍稳定；G1 是人形，接触更硬，需要更细的步长。**步长跟着系统最硬的模态走**。
2. 多人在线那块（Trystero/Nostr）只同步位置，不同步物理。物理状态同步需要锁步或状态插值，成本高一个量级。`,
      en: `## The observation order is the interface

The 61 dims are not arbitrary: **3 gyro + 3 gravity + 14 joint angles + 14 joint velocities + 14 previous actions + 13 commands**. Shift the order by one slot and the robot falls instantly — the "joint velocity" block is read as "joint angle", and the policy sees a completely fake world.

The nasty property of this bug is that **nothing errors**. Standard practice is therefore to define the layout as a constant table (as this page does) shared by training and deployment. Matching tensor shapes is not the same as matching meaning.

## The gait clock inside the command is the good idea

The most instructive part of the 13-dim command is slots 4 and 5: \`sin(2π·phase)\` and \`cos(2π·phase)\`.

Why not a single \`phase ∈ [0,1)\`? Because it is discontinuous at 1 — the policy sees "1.0" and "0.0" as wildly different states and jumps at the wrap point. Encoded as sin/cos, phase becomes a continuous point on the unit circle that closes naturally.

Better still, **the clock is supplied from outside**: the policy does not invent a rhythm, it follows the phase you hand it. So the gait can be sped up, slowed, or reversed at runtime with no retraining. This is the classic move of taking time out of the policy.

## Switching between seven policies

The page ships 7 resident policies (walk, sit-stand, roll, kick left, kick right, ground pick, stand) plus two roller variants. You cannot simply swap the network: \`last_action\` in the observation still holds the previous policy's action, which produces an enormous torque jump. In practice you ramp \`last_action\` across the switch, or insert a short transition policy.

## Why mouse dragging applies a spring force

\`xfrc_applied\` is the external force MuJoCo applies to a body. The page turns the cursor position into a force through a PD spring (stiffness 100, damping 10, capped at 200 N).

Why not just teleport the robot there? Because that breaks physical consistency — infinite velocity, and the contact solver explodes. **Any external intervention in a physics engine must be expressed as a force.** That is an iron rule of simulation.

## Terrain is procedurally generated

A 65 × 65 hfield (height field). hfield is MuJoCo's standard terrain representation: one height map plus a scale, cheaper than a triangle mesh and naturally efficient for collision. Generating it procedurally means every reset differs, which tests generalisation far better than a fixed terrain.

## Going one level deeper

1. Why is the physics step 5 ms here but 1 ms on G1? MicroDuck is smaller and lighter with lower-frequency modes, so 5 ms stays stable; G1 is a humanoid with harder contacts needing finer steps. **The step size follows the stiffest mode of the system.**
2. The multiplayer part (Trystero/Nostr) syncs positions only, not physics. Syncing physical state needs lockstep or state interpolation and costs an order of magnitude more.`
    }
  },

  '/robot/multimodal': {
    python: `"""Gesture-gated drone: 21 hand landmarks -> a class -> a state machine.

The interesting part is not the classifier, it is the debounce: one noisy
frame must never take off your drone.
"""
import math

STABLE_FRAMES = 6        # page: the gesture must agree for 6 frames in a row
COOLDOWN_S = 1.5         # ... and commands lock out for 1.5 s afterwards
CLIMB_S = 2.6            # climb duration of the visual model


def vote(history, label):
    """Debounce: append and only accept when the tail is unanimous."""
    history.append(label)
    if len(history) > STABLE_FRAMES:
        history.pop(0)
    if len(history) < STABLE_FRAMES:
        return None
    return label if all(h == label for h in history) else None


def command(label, now, last_cmd_at):
    """Map a *stable* gesture to a command. Empty string = ignore."""
    if now - last_cmd_at < COOLDOWN_S:
        return ''
    return {'Thumb_Up': 'takeoff', 'Open_Palm': 'land'}.get(label, '')


def altitude(phase_t, hover_y=5.0, ground_y=0.26):
    """The visual model: climb once, then hover with a small sine bob.
    No dynamics -- the page is about the interface, not the airframe."""
    if phase_t < 0:
        return ground_y
    if phase_t < CLIMB_S:
        k = phase_t / CLIMB_S
        return ground_y + (hover_y - ground_y) * (k * k * (3 - 2 * k))   # smoothstep
    return hover_y + math.sin(phase_t * 2.1) * 0.06
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Gesture to command: three filters</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:130px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:44px}
  .log{margin-top:8px;font:12px/1.7 ui-monospace,monospace;color:#334155;max-height:70px;overflow:auto}
  .log b{color:#2563eb}
  .note{color:#64748b;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>One misread frame must not launch a drone</h1>
<p>Three filters in series: EMA smoothing, a deadzone, then six-frame agreement. Move the slider to see
how many frames are rejected before a command is accepted.</p>
<canvas id="c" width="620" height="160"></canvas>
<div class="ctl">
  <label>EMA alpha <input type="range" id="a" min="0.1" max="0.9" step="0.05" value="0.6"><output id="va">0.60</output></label>
  <label>stable frames <input type="range" id="s" min="1" max="12" step="1" value="6"><output id="vs">6</output></label>
</div>
<div class="log" id="log"></div>
<div class="note">With 1 stable frame every flicker fires a command; with 12 the response feels laggy.
Six frames at 30 fps is 0.2 s — the value the page's drone demo settled on.</div>
<script>
(function () {
  // a noisy classification stream: Thumb_Up for ~0.5 s, then Open_Palm
  var seq = [];
  for (var i = 0; i < 90; i++) {
    var base = i < 45 ? 'Thumb_Up' : 'Open_Palm';
    // 30% chance of a wrong label on any frame
    var r = Math.sin(i * 12.9898) * 43758.5453;
    var noise = (r - Math.floor(r));
    seq.push(noise < 0.3 ? (base === 'Thumb_Up' ? 'None' : 'Thumb_Up') : base);
  }

  function render() {
    var alpha = +document.getElementById('a').value;
    var need = +document.getElementById('s').value;
    document.getElementById('va').textContent = alpha.toFixed(2);
    document.getElementById('vs').textContent = need;

    // filter 1: EMA over a numeric code, filter 2: deadzone, filter 3: run length
    var CODE = { None: 0, Thumb_Up: 1, Open_Palm: -1 };
    var smooth = 0, hist = [], accepted = [], counts = { Thumb_Up: 0, Open_Palm: 0 };

    seq.forEach(function (lab, i) {
      smooth = alpha * CODE[lab] + (1 - alpha) * smooth;
      if (Math.abs(smooth) < 0.35) { hist.push(null); return; }   // deadzone
      var cur = smooth > 0 ? 'Thumb_Up' : 'Open_Palm';
      hist.push(cur);
      var run = 0;
      for (var k = hist.length - 1; k >= 0 && hist[k] === cur; k--) run++;
      if (run === need) { accepted.push({ at: i, cmd: cur }); counts[cur]++; }
    });

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 160;
    ctx.clearRect(0, 0, W, H);
    var X = i => 20 + i / seq.length * (W - 40);

    seq.forEach(function (lab, i) {
      ctx.fillStyle = lab === 'Thumb_Up' ? '#bfdbfe' : lab === 'Open_Palm' ? '#bbf7d0' : '#e2e8f0';
      ctx.fillRect(X(i), 40, Math.max(1, (W - 40) / seq.length - 0.5), 22);
    });
    hist.forEach(function (h, i) {
      if (!h) return;
      ctx.fillStyle = h === 'Thumb_Up' ? '#2563eb' : '#16a34a';
      ctx.fillRect(X(i), 70, Math.max(1, (W - 40) / seq.length - 0.5), 14);
    });
    accepted.forEach(function (a) {
      ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(a.at), 92); ctx.lineTo(X(a.at), 118); ctx.stroke();
      ctx.fillStyle = '#dc2626';
      ctx.beginPath(); ctx.arc(X(a.at), 118, 4, 0, Math.PI * 2); ctx.fill();
    });

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('raw classifier  →  EMA + deadzone  →  run-length gate', 20, 26);
    ctx.fillText('commands accepted: ' + accepted.length, 20, 148);
    ctx.fillText('blue = Thumb_Up · green = Open_Palm · red = accepted', 20, 132);

    document.getElementById('log').innerHTML = accepted.map(function (a) {
      return '<div>frame ' + a.at + ' → <b>' + a.cmd + '</b> (after ' + need + ' agreeing frames)</div>';
    }).join('') || '<div>no command accepted — raise the run length or lower the deadzone</div>';
  }

  document.getElementById('a').addEventListener('input', render);
  document.getElementById('s').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 识别不难，稳定才难

MediaPipe 的 \`GestureRecognizer\` 每帧输出一个类别和置信度，单帧准确率不低。但把它直接接到无人机的起飞命令上，结果一定是灾难：**手在自然晃动时，分类结果会在 Thumb_Up 与 None 之间高频抖动**，飞机会在你还没想清楚的时候起飞。

页面用了两层防抖，这两层都要：

1. **连续 6 帧一致**才接受（约 0.2 s @ 30 fps）。这是中值滤波的变体 —— 要求整段历史一致，比"最近一次为准"稳得多；
2. **命令后 1.5 s 冷却**。这不是防抖，是防"重复触发"：起飞后手还没放下，下一帧仍然是 Thumb_Up。

这两层缺一不可：只做第 1 层，指令会连发；只做第 2 层，一次误识别就能起飞。

## MediaPipe 手势识别里发生了什么

\`GestureRecognizer\` 是一条三段流水线：**手掌检测 → 21 点关键点 → 分类头**。

- 手掌检测用轻量 CNN 在整幅图上找手（所以不需要先把手放到画面中央）；
- 关键点模型输出 21 个 3D 点，其中包含手腕、五根手指各 4 个关节；
- 分类头吃这 21 点（做归一化到手掌局部坐标系），输出手势类别。

**注意最后一步的关键设计**：分类头吃的是**归一化后的相对坐标**，不是原始像素坐标。所以手离摄像头远近、在画面哪个位置，都不影响识别 —— 这是它能跨场景工作的原因，也是为什么 21 点比"整张图分类"更省数据。

页面的 21 点骨架是硬编码 \`HAND_CONNECTIONS\` 连线画出来的，不是模型的一部分 —— 所有手部可视化都这么画。

## 为什么这页用「相位机」而不是物理

无人机的垂直运动只有三段：地面 → 爬升 → 悬停。页面用 \`easeInOutCubic\` 插值高度，悬停时叠一个 \`sin(2.1t) × 0.06\` 的轻微起伏。**没有动力学，也不需要**——这页的教学目标是"手势 → 意图 → 动作"这条链路，加物理只会让时序更难观察。

那个 0.06 m 的起伏是个细节：完全静止的悬停看起来像"卡住了"，微小的正弦运动才让人相信它在飞。

## 语音那条链路更朴素

\`useSpeechRecognition\` 走 Web Speech API，拿到转写文本后做**关键词包含匹配**（起飞/升空/降落/takeoff/land）。这不是 NLU，就是 \`text.includes()\`。

够用吗？对固定指令够用，而且好处是零延迟、零成本、完全可解释。真实语音助手要处理的是同义词、否定（"先别起飞"）、上下文 —— 那是另一个量级的问题。

## 想深一层

1. 融合两种输入（手势 + 语音）时，冲突怎么办？页面是"后到者生效"。更稳的策略是给每个模态一个置信度，做加权投票。
2. 如果把 6 帧改成 10 帧，误触发率下降但延迟上升（0.33 s）。这个权衡在交互设计里叫 **去抖时间（debounce time）**，鼠标点击的双击判定用的是同一套逻辑。`,
      en: `## Recognition is easy; stability is hard

MediaPipe's \`GestureRecognizer\` emits a class and a confidence every frame, and single-frame accuracy is good. Wire that straight into a take-off command and you get a disaster: **while a hand moves naturally, the class flickers between Thumb_Up and None at frame rate**, and the drone lifts off before you have decided anything.

The page applies two debounce layers, and both are necessary:

1. **Six consecutive agreeing frames** (about 0.2 s at 30 fps). This is a median-filter variant — requiring the whole window to agree is far steadier than "last frame wins";
2. **A 1.5 s cooldown after each command.** That is not debounce but repeat suppression: right after take-off your hand is still up, so the next frame is still Thumb_Up.

Neither alone works: layer 1 only and commands repeat; layer 2 only and one misread launches the drone.

## What happens inside MediaPipe's gesture recogniser

\`GestureRecognizer\` is a three-stage pipeline: **palm detection → 21 landmarks → classification head**.

- Palm detection is a small CNN over the full frame, so the hand need not be centred;
- The landmark model emits 21 3D points: wrist plus four joints on each of five fingers;
- The classifier consumes those 21 points, normalised into hand-local coordinates, and outputs the gesture class.

**That normalisation is the key design.** The classifier never sees raw pixel positions, so distance from the camera and position in frame do not matter — which is why it generalises across scenes, and why 21 points beat classifying whole images with much less data.

The 21-point skeleton on the page is drawn from a hard-coded \`HAND_CONNECTIONS\` list, not produced by the model. Every hand visualisation does this.

## Why this page uses a phase machine, not physics

Vertical motion has exactly three states: ground → climb → hover. The page interpolates height with \`easeInOutCubic\` and adds a \`sin(2.1t) × 0.06\` bob while hovering. **No dynamics, and none needed** — the teaching goal is the chain "gesture → intent → motion", and physics would only make the timing harder to observe.

That 0.06 m bob is a real detail: a perfectly still hover reads as frozen; a slight sine motion is what makes it look airborne.

## The voice path is plainer still

\`useSpeechRecognition\` goes through the Web Speech API, then does **keyword containment** on the transcript (takeoff / land / 起飞 / 降落). That is \`text.includes()\`, not NLU.

Good enough? For fixed commands, yes — with zero latency, zero cost and full explainability. A production assistant must handle synonyms, negation ("not yet, don't take off") and context, which is a different order of problem.

## Going one level deeper

1. When hand and voice conflict, this page lets the later one win. A steadier scheme gives each modality a confidence and votes.
2. Raising the window from 6 to 10 frames cuts false triggers but adds latency (0.33 s). Interaction design calls this the **debounce time** — double-click detection uses the same logic.`
    }
  },

  '/robot/rebot-arm': {
    python: `"""Damped least squares IK: what actually moves the ReBot arm.

6 joints, 3 position targets (+ orientation), numeric Jacobian by central
difference, and a damping term so singular poses do not blow up.
"""
import numpy as np

EPS = 4e-4          # finite-difference step for the Jacobian
LAMBDA = 0.05       # damping; the page scales this up near singularities
MAX_STEP = 0.35     # rad, clamp per iteration (page: 2.8 rad/s at 60 fps)


def jacobian(fk, q, eps=EPS):
    """d(position) / d(q), 3 x 6, by central differences on the FK function."""
    p0 = fk(q)[:3, 3]
    J = np.zeros((3, len(q)))
    for i in range(len(q)):
        dq = q.copy()
        dq[i] += eps
        J[:, i] = (fk(dq)[:3, 3] - p0) / eps
    return J


def ik(fk, q0, target, iters=120, tol=1.5e-3):
    q = q0.copy()
    for _ in range(iters):
        err = target - fk(q)[:3, 3]
        if np.linalg.norm(err) < tol:
            break
        J = jacobian(fk, q)                       # 3 x 6
        # (J J^T + lambda^2 I) y = err  ->  dq = J^T y
        # The lambda term is what keeps J J^T invertible at singularities.
        y = np.linalg.solve(J @ J.T + LAMBDA ** 2 * np.eye(3), err)
        dq = J.T @ y
        # Clamp so one iteration cannot teleport a joint through its limit.
        scale = min(1.0, MAX_STEP / (np.max(np.abs(dq)) + 1e-9))
        q += dq * scale
    return q
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Damped least squares: why it needs damping at all</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:520px;display:block;border-radius:8px;background:#0f172a;cursor:crosshair}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:140px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:50px}
  .stat{margin-top:8px;font-size:12px;color:#475569}
  .stat b{color:#0f172a;font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>Click anywhere — the solver walks to it</h1>
<p>Two links, numeric Jacobian by finite differences, damped least squares. Set the damping to 0 and
click far away: the pseudo-inverse blows up near a straight-arm singularity.</p>
<canvas id="c" width="520" height="380"></canvas>
<div class="ctl">
  <label>damping λ <input type="range" id="l" min="0" max="0.3" step="0.01" value="0.05"><output id="vl">0.05</output></label>
  <label>step cap <input type="range" id="m" min="0.05" max="1" step="0.05" value="0.35"><output id="vm">0.35</output></label>
</div>
<div class="stat" id="stat"></div>
<div class="note">The solver runs a few iterations per frame, so you can watch it converge instead of
snapping. Red segments mean a joint hit the step cap — the arm is asking for more speed than allowed.</div>
<script>
(function () {
  var W = 520, H = 380, OX = W / 2, OY = H - 60;
  var L1 = 120, L2 = 105;
  var q = [0.6, -0.9];
  var target = { x: OX + 90, y: OY - 150 };
  var clamped = false;

  function fk(q0, q1) {
    var x = Math.sin(q0) * L1 + Math.sin(q0 + q1) * L2;
    var y = -Math.cos(q0) * L1 - Math.cos(q0 + q1) * L2;
    return { x: OX + x, y: OY + y };
  }

  function solve(lam, cap) {
    clamped = false;
    for (var it = 0; it < 6; it++) {
      var p = fk(q[0], q[1]);
      var e = [target.x - p.x, target.y - p.y];
      if (Math.hypot(e[0], e[1]) < 1.2) break;

      // numeric Jacobian: d(position)/d(joint), 2x2
      var eps = 0.0004;
      var pa = fk(q[0] + eps, q[1]);
      var pb = fk(q[0], q[1] + eps);
      var J = [
        [(pa.x - p.x) / eps, (pb.x - p.x) / eps],
        [(pa.y - p.y) / eps, (pb.y - p.y) / eps]
      ];

      // (J J^T + λ²I) y = e ;  dq = J^T y
      var a = J[0][0] * J[0][0] + J[0][1] * J[0][1] + lam * lam;
      var b = J[0][0] * J[1][0] + J[0][1] * J[1][1];
      var d = J[1][0] * J[1][0] + J[1][1] * J[1][1] + lam * lam;
      var det = a * d - b * b;
      if (Math.abs(det) < 1e-9) break;
      var y0 = (d * e[0] - b * e[1]) / det;
      var y1 = (a * e[1] - b * e[0]) / det;
      var dq = [J[0][0] * y0 + J[1][0] * y1, J[0][1] * y0 + J[1][1] * y1];

      var mx = Math.max(Math.abs(dq[0]), Math.abs(dq[1]));
      if (mx > cap) { var k = cap / mx; dq[0] *= k; dq[1] *= k; clamped = true; }
      q[0] += dq[0]; q[1] += dq[1];
    }
  }

  function render() {
    var lam = +document.getElementById('l').value;
    var cap = +document.getElementById('m').value;
    document.getElementById('vl').textContent = lam.toFixed(2);
    document.getElementById('vm').textContent = cap.toFixed(2);

    solve(lam, cap);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);

    // base
    ctx.fillStyle = '#334155';
    ctx.fillRect(OX - 34, OY, 68, 16);

    var p1 = { x: OX + Math.sin(q[0]) * L1, y: OY - Math.cos(q[0]) * L1 };
    var p2 = fk(q[0], q[1]);

    ctx.strokeStyle = clamped ? '#ef4444' : '#38bdf8';
    ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(OX, OY); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    ctx.strokeStyle = clamped ? '#f87171' : '#22c55e';
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();

    // joints
    [[OX, OY], [p1.x, p1.y], [p2.x, p2.y]].forEach(function (p, i) {
      ctx.fillStyle = i === 2 ? '#fbbf24' : '#e2e8f0';
      ctx.beginPath(); ctx.arc(p[0], p[1], i === 2 ? 7 : 5, 0, Math.PI * 2); ctx.fill();
    });

    // target
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(target.x, target.y, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(target.x - 14, target.y); ctx.lineTo(target.x + 14, target.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(target.x, target.y - 14); ctx.lineTo(target.x, target.y + 14); ctx.stroke();

    var err = Math.hypot(target.x - p2.x, target.y - p2.y);
    ctx.fillStyle = '#94a3b8'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('q = [' + q[0].toFixed(2) + ', ' + q[1].toFixed(2) + '] rad', 12, 20);
    ctx.fillText('error ' + err.toFixed(1) + ' px' + (clamped ? ' · step capped' : ''), 12, 36);

    document.getElementById('stat').innerHTML =
      'error <b>' + err.toFixed(1) + ' px</b> · λ = <b>' + lam.toFixed(2) + '</b> · ' +
      (err < 2 ? '<span style="color:#16a34a">converged</span>'
               : clamped ? '<span style="color:#dc2626">clamped, still moving</span>'
               : 'converging');
  }

  document.getElementById('c').addEventListener('click', function (e) {
    var r = e.currentTarget.getBoundingClientRect();
    target = {
      x: (e.clientX - r.left) / r.width * W,
      y: (e.clientY - r.top) / r.height * H
    };
  });
  ['l', 'm'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  (function loop() { render(); requestAnimationFrame(loop); })();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 正运动学容易，逆运动学才难

**正运动学（FK）**是给定期望关节角，算出末端在哪 —— 矩阵连乘，唯一解，永远能算。
**逆运动学（IK）**反过来：给定末端要在哪，求关节角。这一步有三个麻烦：

1. **零个解**：目标超出工作空间（太远、太低）；
2. **多个解**：6 轴臂对同一个位置常有 8 组解（肘上/肘下 × 腕翻/腕不翻），选哪组决定了姿态是否自然；
3. **奇异位形**：某些姿态下雅可比矩阵退化，解算会突然要求关节以无穷大的速度转动。

页面的 \`solveDampedLeastSquares\` 就是为第 3 点准备的。

## 雅可比：关节速度 → 末端速度

\`J\` 的物理意义是**偏导数矩阵**：\`J[i][j] = ∂p_i / ∂q_j\`，也就是"第 j 个关节转一点点，末端第 i 个坐标动多少"。有了它，末端误差 \`e\` 就能换算成关节修正量。

页面用 **中心差分**算雅可比（\`eps = 0.004\`），因为对任意 URDF 都能算，不需要写解析式。代价是精度略低、要多算 6 次正运动学。解析雅可比更快更准，但要为每个机型手写。

## 为什么要「阻尼」

最朴素的解是 \`dq = J⁺e\`（伪逆）。在奇异位形附近 \`J Jᵀ\` 接近不可逆，伪逆的元素会趋向无穷 —— 表现为机械臂突然抽搐。

DLS 的做法是给对角加一个 \`λ²\`：

\`dq = Jᵀ (J Jᵀ + λ² I)⁻¹ e\`

分子分母同时趋小的结果，是**牺牲一部分精度换取有界的关节速度**。这是数值 IK 里最重要的一行公式。页面更进一步，用位置雅可比的 3×3 gram 矩阵的归一化行列式估计"离奇异有多近"，让 λ 自适应变大 —— 平时精确，靠近奇异时保守。

## 分拣那条流水线里，「视觉」是假的

页面上的检测框是 \`project()\` 画的 2D 方框，置信度是 \`96 + id % 4\` 的合成值，颜色直接读方块自带的字段。**没有相机，没有识别**。

这不是偷懒：把「视觉 → 抓取 → 分拣」的**时序与节拍**演示清楚，比做一个能识别颜色的 CNN 更有教学价值（后者对本章是噪声）。但这个取舍必须讲明白 —— 否则学生会以为识别来自模型。想看真的，去 /vision/detection。

## 想深一层

1. 传送带速度 0.055 m/s，抓取区 z ∈ [-0.20, 0.10]。这个窗口宽度决定了机械臂必须多快 —— 典型的**节拍约束**设计。
2. 姿态权重 \`oriWeight = 0.45\`：把 3 行姿态误差乘 0.45 接到 6 行雅可比下面。为什么小于 1？因为位置精度通常比姿态精度重要，权重是可调的优先级。
3. 收敛判据 0.0015 m 已经小于大多数机械臂的重复定位精度（0.02–0.05 mm 是工业级，教学机 0.5 mm）。再往下迭代没有意义。`,
      en: `## Forward kinematics is easy; inverse kinematics is the hard part

**FK** takes joint angles and says where the tool is: matrix products, one solution, always computable.
**IK** reverses it: where must the joints be? Three complications follow:

1. **Zero solutions** — the target is outside the workspace;
2. **Many solutions** — a 6-axis arm usually has 8 joint sets for one position (elbow up/down × wrist flip/no-flip), and the choice decides whether the pose looks natural;
3. **Singularities** — at some poses the Jacobian degenerates and the solver demands infinite joint speed.

The page's \`solveDampedLeastSquares\` exists for case 3.

## The Jacobian: joint speed → tool speed

\`J\` is the partial-derivative matrix: \`J[i][j] = ∂p_i / ∂q_j\`, i.e. "how much does coordinate i of the tool move per unit of joint j". With it, a tool error \`e\` converts into a joint correction.

The page computes J by **central differences** (\`eps = 0.004\`) because that works for any URDF with no hand-derived formula. The cost is slightly lower accuracy plus 6 extra FK evaluations. Analytic Jacobians are faster and exact, but must be written per model.

## Why damping

The naive answer is \`dq = J⁺e\` (pseudo-inverse). Near a singularity \`J Jᵀ\` approaches non-invertibility and the pseudo-inverse blows up — the arm visibly twitches.

DLS adds a diagonal \`λ²\`:

\`dq = Jᵀ (J Jᵀ + λ² I)⁻¹ e\`

Because both numerator and denominator shrink together, the result **trades some accuracy for bounded joint speed**. This is the single most important line in numerical IK. The page goes further: it estimates proximity to a singularity from the normalised determinant of the 3×3 position gram matrix and lets λ grow — precise normally, conservative near singular poses.

## The "vision" in the sorting line is fake

The detection boxes are 2D rectangles drawn by \`project()\`, confidence is synthesised as \`96 + id % 4\`, and the target class is read straight from the block's own colour field. **No camera, no recognition.**

That is a deliberate trade: demonstrating the **timing and cadence** of see → grasp → sort teaches more than a colour-classifying CNN would (which is noise for this chapter). But the trade-off must be stated, or students will think recognition comes from a model. For the real thing, see /vision/detection.

## Going one level deeper

1. The conveyor runs at 0.055 m/s and the grasp zone spans z ∈ [-0.20, 0.10]. That window width sets how fast the arm must be — a classic **cycle-time constraint**.
2. The orientation weight \`oriWeight = 0.45\` scales three orientation rows appended under the position Jacobian. Why below 1? Position accuracy usually matters more; the weight is a tunable priority.
3. The 0.0015 m tolerance is already finer than most arms' repeatability (0.02–0.05 mm industrial, ~0.5 mm for teaching hardware). Iterating further buys nothing.`
    }
  },

  '/robot/soma': {
    python: `"""Analytic two-link IK: how the SOMA page bends a leg to reach a foot target.

Closed-form, no iteration -- because this runs for every leg, every frame.
"""
import math

L1, L2 = 0.42, 0.44      # thigh, shin


def leg_ik(target_y, target_z):
    """Foot target in the leg's sagittal plane -> (hip, knee) angles."""
    d = math.hypot(target_y, target_z)
    d = max(1e-6, min(d, L1 + L2 - 1e-6))        # unreachable -> clamp to the rim

    # Law of cosines: the interior knee angle is a function of d alone.
    cos_knee = (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2)
    knee = math.acos(max(-1.0, min(1.0, cos_knee)))

    # The hip must be offset so the chain actually lands on the target.
    hip_off = math.atan2(L2 * math.sin(knee), L1 + L2 * math.cos(knee))
    hip = math.atan2(target_z, target_y) + hip_off

    # Convert the interior angle to a joint angle (0 = straight leg).
    return hip, math.pi - knee


def foot_target(phase, stride=0.34, lift=0.30):
    """The gait: 62% stance (foot planted, slides back), 38% swing (lifts)."""
    if phase < 0.62:
        k = phase / 0.62
        return stride * (1 - 2 * k), 0.0          # (y, z) on the ground
    k = (phase - 0.62) / 0.38
    return stride * (2 * k - 1), math.sin(math.pi * k) * lift


if __name__ == "__main__":
    for i in range(8):
        ph = i / 8
        y, z = foot_target(ph)
        hip, knee = leg_ik(y, z)
        print(f"phase={ph:.2f}  foot=({y:+.2f},{z:+.2f})  hip={hip:+.3f} knee={knee:.3f}")
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Two links, a triangle, no iteration</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:520px;display:block;border-radius:8px;background:#0f172a;cursor:crosshair}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:150px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:50px}
  .stat{margin-top:8px;font-size:12px;color:#475569}
  .stat b{color:#0f172a;font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>A leg is a triangle, so the answer is closed-form</h1>
<p>Drag the foot. The knee angle comes from the law of cosines on the hip–knee–foot triangle — no
iteration, which is why this runs for every leg every frame.</p>
<canvas id="c" width="520" height="380"></canvas>
<div class="ctl">
  <label>reach limit <input type="range" id="r" min="0.6" max="1" step="0.02" value="0.98"><output id="vr">0.98</output></label>
</div>
<div class="stat" id="stat"></div>
<div class="note">Push the foot past the leg length and the clamp kicks in: d is capped at L1+L2, so the
leg straightens instead of producing NaN. That clamp is one line and saves a lot of debugging.</div>
<script>
(function () {
  var W = 520, H = 380, HX = W / 2, HY = 80;
  var L1 = 130, L2 = 120;
  var foot = { x: HX + 60, y: HY + 220 };

  function ik(fx, fy, limit) {
    var dy = fy - HY, dx = fx - HX;
    var d = Math.hypot(dx, dy);
    var maxD = (L1 + L2) * limit;
    var clamped = d > maxD;
    if (clamped) d = maxD;

    // law of cosines: interior knee angle depends only on d
    var cosKnee = (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2);
    var knee = Math.acos(Math.max(-1, Math.min(1, cosKnee)));

    // the hip must be offset or the chain never reaches the target
    var hipOff = Math.atan2(L2 * Math.sin(knee), L1 + L2 * Math.cos(knee));
    var hip = Math.atan2(dx, dy) + hipOff;
    return { hip: hip, knee: Math.PI - knee, clamped: clamped, d: d };
  }

  function render() {
    var limit = +document.getElementById('r').value;
    document.getElementById('vr').textContent = limit.toFixed(2);

    var sol = ik(foot.x, foot.y, limit);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);

    // hip -> knee -> foot
    var kx = HX + Math.sin(sol.hip) * L1;
    var ky = HY + Math.cos(sol.hip) * L1;
    // the foot direction after the knee bend
    var a2 = sol.hip - sol.knee;
    var fx = kx + Math.sin(a2) * L2;
    var fy = ky + Math.cos(a2) * L2;

    // triangle hint
    ctx.strokeStyle = 'rgba(148,163,184,.35)'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(HX, HY); ctx.lineTo(foot.x, foot.y); ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(HX, HY); ctx.lineTo(kx, ky); ctx.stroke();
    ctx.strokeStyle = '#22c55e';
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();

    [[HX, HY, 6, '#e2e8f0'], [kx, ky, 6, '#fbbf24'], [fx, fy, 7, '#22c55e']].forEach(function (j) {
      ctx.fillStyle = j[3];
      ctx.beginPath(); ctx.arc(j[0], j[1], j[2], 0, Math.PI * 2); ctx.fill();
    });

    // requested foot position
    ctx.strokeStyle = ctx.fillStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(foot.x, foot.y, 9, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = '#94a3b8'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('hip ' + (sol.hip * 180 / Math.PI).toFixed(1) + '°  knee ' +
      (sol.knee * 180 / Math.PI).toFixed(1) + '°', 12, 20);
    ctx.fillText('d = ' + sol.d.toFixed(0) + ' px' + (sol.clamped ? ' (clamped)' : ''), 12, 36);

    document.getElementById('stat').innerHTML =
      'hip <b>' + (sol.hip * 180 / Math.PI).toFixed(1) + '°</b> · knee <b>' +
      (sol.knee * 180 / Math.PI).toFixed(1) + '°</b> · ' +
      (sol.clamped ? '<span style="color:#b45309">out of reach — clamped to the rim</span>'
                   : '<span style="color:#16a34a">reachable</span>');
  }

  document.getElementById('c').addEventListener('pointermove', function (e) {
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    var r = e.currentTarget.getBoundingClientRect();
    foot = { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  });
  document.getElementById('c').addEventListener('click', function (e) {
    var r = e.currentTarget.getBoundingClientRect();
    foot = { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  });
  document.getElementById('r').addEventListener('input', render);
  (function loop() { render(); requestAnimationFrame(loop); })();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 两条腿骨 = 一个三角形，所以有解析解

一条腿（髋 → 膝 → 踝）在矢状面上就是**两根固定长度的杆**。已知两根杆的长度和目标点到髋的距离 \`d\`，三角形就被唯一确定（除了镜像）。

余弦定理给出膝角：

\`cos(θ_knee) = (d² - L1² - L2²) / (2·L1·L2)\`

这比数值 IK 快得多，也不需要迭代 —— 页面的每条腿每帧都要算，所以这个选择是必须的。代价是：**只对 2 连杆好用**。加到 3 自由度（髋再分两个轴）就要拆成"先选髋的偏航角，再在平面内解两连杆"，5 轴以上基本只能数值解。

## 那个 \`hip_off\` 为什么不能省

很多人第一次写 2 连杆 IK 会写成 \`hip = atan2(z, y)\`，然后发现末端总是够不到目标。原因是**膝一弯，整条腿就"缩"了**：踝的实际位置不再在髋到目标的连线上，而是偏出一个角度。\`hip_off = atan2(L2·sinθ, L1 + L2·cosθ)\` 就是在补偿这个偏差。

## 步态：支撑 62%，摆动 38%

- **支撑相**（0–62%）：脚贴地，相对身体向后滑。这一段是动力来源；
- **摆动相**（62–100%）：脚抬起，\`sin(πk) × 0.3\` 的抬脚高度，向前送。

**为什么支撑相更长**：双足行走时，单脚支撑的时间必须超过 50%，否则会出现"腾空"（跑步）。62% 意味着约 24% 的时间双脚同时着地 —— 这就是走路和跑步的物理分界。

抬脚高度用 \`sin(πk)\` 而不是线性或方波，因为它的速度在起止点为零，脚落地时不会有横向"刮地"。

## 爆炸视图和轮廓描边

- 爆炸视图：每个零件沿父节点方向外移，用 \`lerp(1 - e^(-8dt))\` 平滑。指数形式的好处是**与帧率无关**，60 fps 和 30 fps 的动画速度一致；
- \`OutlinePass\`：悬停 2.5、选中 4.2 的描边强度。这是 three.js 的后处理描边，比给每个零件加一份放大网格省得多。

## 想深一层

1. 页面有 25 个零件、7 个总成、5 个系统 —— 这个层级不是装饰，它决定了「点一个零件时该高亮谁」。把语义层级建进模型，UI 才能不写死。
2. 眼睛用 \`raycaster\` 跟随指针 + 眨眼 + 扫视。这三件事加起来才让机器人"像在看"，单有跟随会像监控摄像头。
3. 想从这里过渡到真正的足式机器人控制：解析 IK 只解决"脚放哪"，还得有重心轨迹规划（ZMP / Capture Point）才能保证不摔倒。`,
      en: `## Two bones make a triangle, so there is a closed form

A leg (hip → knee → ankle) in the sagittal plane is **two fixed-length rods**. Given both lengths and the distance \`d\` from hip to target, the triangle is determined (up to a mirror).

The law of cosines gives the knee angle:

\`cos(θ_knee) = (d² - L1² - L2²) / (2·L1·L2)\`

That is far faster than numerical IK and needs no iteration — and every leg is solved every frame, so the choice is forced. The cost: **it only works for two links**. Add a third DoF (a hip yaw) and you must first pick the yaw, then solve two links in-plane. Past five axes, numerical solving is the only option.

## Why \`hip_off\` cannot be dropped

Most first attempts write \`hip = atan2(z, y)\` and find the foot never reaches the target. Bending the knee **shortens the leg**: the ankle no longer sits on the hip-to-target line but off to one side. \`hip_off = atan2(L2·sinθ, L1 + L2·cosθ)\` compensates for exactly that deviation.

## Gait: 62% stance, 38% swing

- **Stance** (0–62%): the foot is planted and slides backwards relative to the body. This is where propulsion comes from;
- **Swing** (62–100%): the foot lifts by \`sin(πk) × 0.3\` and travels forward.

**Why stance is longer**: in bipedal walking, single support must exceed 50% of the cycle or there is a flight phase — which is running. 62% leaves about 24% double support: the physical boundary between walking and running.

The foot lifts on \`sin(πk)\` rather than a line or a square wave because its velocity is zero at both ends, so the foot does not scuff on landing.

## Exploded view and outlines

- Exploded view: each part offsets along its parent axis, smoothed by \`lerp(1 - e^(-8dt))\`. The exponential form is **frame-rate independent** — identical speed at 60 and 30 fps;
- \`OutlinePass\`: outline strength 2.5 on hover, 4.2 on selection. That is three.js post-processing, far cheaper than adding a scaled copy of every part.

## Going one level deeper

1. The model has 25 parts, 7 assemblies, 5 systems — that hierarchy is not decoration, it decides "which thing highlights when I click a part". Semantic structure in the model is what lets the UI stay generic.
2. The eyes combine \`raycaster\` pointer tracking with blinking and saccades. All three are needed to read as "looking"; tracking alone looks like a security camera.
3. To go from here to real legged control: analytic IK only places the foot. You also need centre-of-mass trajectory planning (ZMP / capture point) to stay upright.`
    }
  },

  '/robot/uaibot-kinematics': {
    python: `"""DH parameters + forward kinematics: the UAIbot page's model of a KUKA KR5.

DH is a 70-year-old convention that still decides how every robot library
stores its geometry. Worth understanding once.
"""
import numpy as np

# Each row: (theta_offset, d, a, alpha) -- the classic Denavit-Hartenberg four.
# d and a are lengths, alpha twists one frame into the next.
DH = [
    (0.0, 0.400, 0.025, -np.pi / 2),
    (0.0, 0.000, 0.315, 0.0),
    (0.0, 0.000, 0.035, -np.pi / 2),
    (0.0, 0.365, 0.000, np.pi / 2),
    (0.0, 0.000, 0.000, -np.pi / 2),
    (0.0, 0.080, 0.000, 0.0),
]


def dh_matrix(theta, d, a, alpha):
    """One link's transform: rotate, translate along z, translate along x, twist."""
    ct, st = np.cos(theta), np.sin(theta)
    ca, sa = np.cos(alpha), np.sin(alpha)
    return np.array([
        [ct, -st * ca, st * sa, a * ct],
        [st, ct * ca, -ct * sa, a * st],
        [0, sa, ca, d],
        [0, 0, 0, 1],
    ])


def fk(q):
    """Chain the six link transforms. T[0:3, 3] is the tool position."""
    T = np.eye(4)
    for (off, d, a, alpha), qi in zip(DH, q):
        T = T @ dh_matrix(off + qi, d, a, alpha)
    return T


if __name__ == "__main__":
    for q in ([0] * 6, [0.3, -0.5, 0.8, 0, 0.4, 0]):
        T = fk(q)
        print("q =", q, "-> tool at", np.round(T[:3, 3], 3))
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DH: four numbers per joint, multiplied</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:520px;display:block;border-radius:8px;background:#0f172a}
  .ctl{display:flex;flex-direction:column;gap:6px;margin-top:10px;font-size:12px;max-width:400px}
  .ctl label{display:flex;align-items:center;gap:8px}
  .ctl b{width:34px;font-family:ui-monospace,monospace;font-weight:500}
  input[type=range]{flex:1}
  output{font-variant-numeric:tabular-nums;font-weight:600;width:56px;text-align:right}
  .stat{margin-top:8px;font-size:12px;color:#475569}
  .stat b{color:#0f172a;font-variant-numeric:tabular-nums}
</style>
</head>
<body>
<h1>Chain three transforms, get the tool pose</h1>
<p>Each slider is one joint angle. The forward kinematics multiplies three DH matrices — nothing is
looked up, the coordinates come out of the product.</p>
<canvas id="c" width="520" height="360"></canvas>
<div class="ctl" id="ctl"></div>
<div class="stat" id="stat"></div>
<div class="note">The real page chains six joints and reads the tool position out of three's matrixWorld.
Same maths, one fewer joint, no scene graph.</div>
<script>
(function () {
  var W = 520, H = 360, OX = W / 2, OY = H - 50;
  var L = [110, 95, 80];                     // link lengths, the "a" of each DH row
  var q = [0.4, -0.9, 0.7];

  function fk() {
    // composed in 2D: each link rotates in the plane, so the chain is just angles
    var x = 0, y = 0, ang = 0;
    var joints = [{ x: 0, y: 0 }];
    for (var i = 0; i < 3; i++) {
      ang += q[i];
      x += Math.sin(ang) * L[i];
      y += Math.cos(ang) * L[i];
      joints.push({ x: x, y: y, ang: ang });
    }
    return { joints: joints, tool: { x: OX + x, y: OY + y } };
  }

  function render() {
    var k = fk();
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#334155';
    ctx.fillRect(OX - 30, OY, 60, 14);

    var colors = ['#38bdf8', '#22c55e', '#fbbf24'];
    for (var i = 0; i < 3; i++) {
      var a = k.joints[i], b = k.joints[i + 1];
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 11 - i * 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(OX + a.x, OY + a.y);
      ctx.lineTo(OX + b.x, OY + b.y);
      ctx.stroke();
    }
    k.joints.forEach(function (j, i) {
      ctx.fillStyle = i === 3 ? '#fbbf24' : '#e2e8f0';
      ctx.beginPath(); ctx.arc(OX + j.x, OY + j.y, i === 3 ? 7 : 5, 0, Math.PI * 2); ctx.fill();
    });

    // reach circles
    ctx.strokeStyle = 'rgba(148,163,184,.15)';
    ctx.beginPath(); ctx.arc(OX, OY, L[0] + L[1] + L[2], 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = '#94a3b8'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('tool at (' + (k.tool.x - OX).toFixed(0) + ', ' + (k.tool.y - OY).toFixed(0) + ') px', 12, 20);

    document.getElementById('stat').innerHTML =
      'tool <b>(' + (k.tool.x - OX).toFixed(1) + ', ' + (k.tool.y - OY).toFixed(1) +
      ')</b> px · total rotation <b>' + ((k.joints[3].ang) * 180 / Math.PI).toFixed(1) + '°</b>';
  }

  // build the sliders
  var ctl = document.getElementById('ctl');
  q.forEach(function (v, i) {
    var lab = document.createElement('label');
    lab.innerHTML = '<b>q' + (i + 1) + '</b>' +
      '<input type="range" min="-1.6" max="1.6" step="0.02" value="' + v + '" data-i="' + i + '">' +
      '<output>' + v.toFixed(2) + '</output>';
    ctl.appendChild(lab);
  });
  ctl.addEventListener('input', function (e) {
    var i = +e.target.dataset.i;
    q[i] = +e.target.value;
    e.target.nextElementSibling.textContent = q[i].toFixed(2);
    render();
  });
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## DH 参数：四个数描述一个关节

1955 年 Denavit 和 Hartenberg 提出一个约定：**任意两个相邻关节之间，只需要四个数**就能确定它们的相对位置与姿态。

| 参数 | 含义 | 直觉 |
| --- | --- | --- |
| \`theta\` | 绕 z 轴的转角 | 关节本身转的角度（旋转关节就是它） |
| \`d\` | 沿 z 轴的偏移 | 上一节到这一节的"高度差" |
| \`a\` | 沿 x 轴的偏移 | 连杆长度（两个关节轴的距离） |
| \`alpha\` | 绕 x 轴的转角 | 下一根轴相对上一根轴的"扭转" |

把这四个数代进一个固定的 4×4 矩阵模板，连乘六次就得到末端位姿。**这就是正运动学的全部**。今天所有机器人库（ROS、PyBullet、MuJoCo 的 URDF）内部都等价于这张表，只是存储格式不同（URDF 用 origin + axis，本质可以互相转换）。

## 为什么这个约定还在用

因为它是**最小表示**：6 轴机器人只需要 24 个数就能完全描述几何。相比之下，手写每个关节的齐次矩阵容易出错且无法复用。

代价是 DH 有几个历史包袱：\`alpha\` 的方向约定（经典 DH vs 改进 DH）两家吵了几十年，不同教材的同一台机器人参数表会差一个符号。**照着论文抄参数前，先确认它用的是哪种约定**。

## 页面里那个「不寻常」的 FK 实现

仓库里的 \`fkm()\` 没有逐级矩阵相乘，而是**直接读取 \`link6\` 的 \`matrixWorld\`** 来组装 4×4 矩阵。这是「借渲染引擎当运动学引擎」的做法：three.js 已经为层级变换维护好了世界矩阵，再算一遍纯属浪费。

优点：零成本、永远和画面上一致。
缺点：**依赖场景图结构**（必须有正确的父子关系和关节原点），且拿不到中间量（比如"第 3 关节的世界坐标"要另外取）。教学页这样写没问题，工程代码不该这么写。

## 逆解：λ 固定 0.03 就够了

IK 部分和 ReBot 页同一套 DLS（阻尼最小二乘），差别在参数：

- \`λ = 0.03\`（ReBot 是 0.018 起，再按奇异度自适应放大）；
- 单关节单步上限 \`0.55 rad\`（更保守，防止拖动目标球时机械臂抽搐）；
- 收敛判据 \`2e-4 m\`（0.2 mm，比 ReBot 的 1.5 mm 严格得多）。

**为什么 KR5 可以更严**：它的工作范围小（臂展 ~0.9 m），同样的绝对误差对应更大的相对精度；而且这页是纯教学演示，速度不是瓶颈。

## 三种输入方式，一个求解器

关节滑块（直接给 q）、拖拽目标球（逐帧解 IK）、轨迹（沿圆/8 字/直线逐点解 IK）—— 三种模式都落到同一个 \`ik()\`，只是调用频率不同。这种「一个求解器 + 多个输入源」的结构，是示教器软件的标准形态。

## 想深一层

1. 为什么拖拽时要限 \`0.55 rad/步\`？因为鼠标可能瞬移几十像素，对应的目标点可能跨越半个工作空间，不限速机械臂会"甩"过去 —— 真实机器人上这是事故。
2. 六轴机器人有解析解（Pieper 判据：后三轴交于一点），但只对特定构型成立。数值解通用，代价是可能落到一个姿态很别扭的解上 —— 这就是为什么工程上常把数值解"投"到解析解附近。`,
      en: `## DH parameters: four numbers per joint

In 1955 Denavit and Hartenberg fixed a convention: **between any two adjacent joints, four numbers** fully determine their relative position and orientation.

| Parameter | Meaning | Intuition |
| --- | --- | --- |
| \`theta\` | rotation about z | the joint angle itself, for a revolute joint |
| \`d\` | offset along z | the "height gap" from the previous link |
| \`a\` | offset along x | link length (distance between the two joint axes) |
| \`alpha\` | rotation about x | how much the next axis is twisted relative to this one |

Feed those four into one fixed 4×4 template, multiply six times, and you have the tool pose. **That is all of forward kinematics.** Every robot library today (ROS, PyBullet, MuJoCo's URDF) is equivalent to this table, only with different storage (URDF uses origin + axis, convertible either way).

## Why the convention survives

Because it is a **minimal representation**: 24 numbers fully describe a 6-axis machine. Writing homogeneous matrices by hand per joint is error-prone and does not generalise.

The cost is historical baggage: the sign convention for \`alpha\` differs between classic and modified DH, so the same robot's table can differ by a sign across textbooks. **Check which convention a paper uses before copying its numbers.**

## The unusual FK in this project

The repo's \`fkm()\` does not chain matrices. It **reads \`link6\`'s \`matrixWorld\`** and assembles the 4×4 from that — using the renderer as the kinematics engine. three.js already maintains world matrices for hierarchical transforms, so recomputing them is waste.

Upside: free, and always consistent with what is drawn.
Downside: **it depends on scene-graph structure** (parents and joint origins must be right) and you cannot read intermediate quantities — "world position of joint 3" needs a separate query. Fine for a teaching page, wrong for production code.

## Inverse kinematics: a fixed λ of 0.03 is enough

The IK is the same DLS (damped least squares) as the ReBot page, with different constants:

- \`λ = 0.03\` (ReBot starts at 0.018 and scales up with singularity);
- per-joint step capped at \`0.55 rad\` (more conservative, so dragging the target sphere cannot make the arm twitch);
- convergence at \`2e-4 m\` (0.2 mm, far tighter than ReBot's 1.5 mm).

**Why KR5 can afford to be tighter**: short reach (~0.9 m), so the same absolute error is a larger relative precision — and this page is a pure demo where speed is not the bottleneck.

## Three inputs, one solver

Joint sliders (feed q directly), dragging a target sphere (solve IK per frame), and trajectories (circle / figure-eight / line, solved point by point) all land on the same \`ik()\`, only at different rates. That "one solver, many input sources" shape is exactly how teach-pendant software is built.

## Going one level deeper

1. Why cap dragging at \`0.55 rad/step\`? The cursor can jump dozens of pixels, which can mean a target across half the workspace; unbounded, the arm whips across — on real hardware, an accident.
2. Six-axis arms do have analytic solutions (Pieper's criterion: last three axes intersecting), but only for specific geometries. Numerical solving is general but may land on an awkward configuration — which is why production systems project numerical solutions near analytic ones.`
    }
  }
}
