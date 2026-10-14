/**
 * reBot Arm — 视觉分拣任务模块
 * - 侧栏「视觉分拣」区 UI 绑定（相机画面 / 识别状态 / 手动抓取 / 自动分拣）
 * - 取放编排：预判悬停 → trackBlockTo 跟随下探 → 边跟随边闭合 → 抓取/释放 → 入盒计数
 *   方块在抓取全程随传送带移动，机械臂追着它走（不会被钉在原地）
 * - 依赖：rebot-sim.js 暴露的 window.reBotSim 任务 API + window.rebotI18n
 */
(function () {
  const t = window.rebotI18n ? window.rebotI18n.t : (k) => k;
  const sim = () => window.reBotSim;

  let busy = false;          // 任一编排动作执行中（含手动取放）
  let autoRunning = false;

  // 抓取流程各阶段耗时：方块在传送带上一刻不停，这些时间就是机械臂需要「追」的行程
  const HOVER_MS = 900;
  // 悬停高度同样受可达性限制：工具朝下时 TCP 抬得太高 IK 会失手，2cm 够用了
  const HOVER_CLEARANCE = 0.02;
  const DESCEND_MS = 2600;
  const OPEN_MS = 220;
  const CLOSE_MS = 440;
  const TRACK_TOLERANCE = 0.005;

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text) {
    const el = $('task-status');
    if (el) el.textContent = text;
  }

  function colorName(color) {
    if (!color) return '--';
    const key = `vision.color${color.charAt(0).toUpperCase()}${color.slice(1)}`;
    const translated = t(key);
    return translated === key ? color : translated;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function selectedColor() {
    const select = $('task-color');
    return select ? select.value : 'auto';
  }

  // ROS→three 在 sim.moveTcpTo 内部处理；这里统一把 three 场景坐标转成 ROS 后下发
  function rosFromThree(p) {
    return { x: p.x, y: -p.z, z: p.y };
  }

  // 当前 TCP 的 three 场景坐标（sim 只暴露 ROS 坐标）
  function tcpThree() {
    const ros = sim().getTcpRos();
    return ros ? { x: ros.x, y: ros.z, z: -ros.y } : null;
  }

  // 目标为 three 场景坐标；带姿态约束（工具竖直朝下）移动，返回是否成功完成
  async function tcpMove(threeTarget, durationMs, epoch) {
    const result = await sim().moveTcpTo(rosFromThree(threeTarget), durationMs, { orientation: true });
    if (!result.ok || result.epoch !== epoch) return false;
    return true;
  }

  function addOffset(pos, offset) {
    return {
      x: pos.x + (offset.x || 0),
      y: pos.y + (offset.y || 0),
      z: pos.z + (offset.z || 0)
    };
  }

  // 传送带沿 +Z 输送，目标点要按「到达时刻」向前预判，否则总是差一个行程
  function leadAhead(pos, speed, ms) {
    return { x: pos.x, y: pos.y, z: pos.z + (speed || 0) * (ms / 1000) };
  }

  // 把方块「罩进夹爪」：先悬停到预判点上方，再边跟随边下探，最后边跟随边闭合。
  // 返回 'ok' | 'wait'（够不着/目标丢了）
  async function graspBlock(s, target, epoch) {
    const speed = s.getConveyorSpeed();
    const graspOffset = s.getGraspOffsetHint(); // three 空间：方块中心相对 TCP 的偏移

    const hover = addOffset(leadAhead(target.pos, speed, HOVER_MS), {
      y: graspOffset.y + HOVER_CLEARANCE
    });
    if (!await tcpMove(hover, HOVER_MS, epoch)) return 'wait';

    await s.openGripper(OPEN_MS);
    // timeoutMs 只是保险：正常情况下跟随收敛后立刻进入下一步
    const track = await s.trackBlockTo(
      target,
      { y: graspOffset.y - 0.004 },
      { timeoutMs: DESCEND_MS, tolerance: TRACK_TOLERANCE }
    );
    if (!track.ok) return 'wait';

    // 闭合过程中继续跟随，方块始终留在夹爪正中
    const closing = s.closeGripper(CLOSE_MS);
    await s.trackBlockTo(target, { y: graspOffset.y - 0.004 }, {
      timeoutMs: CLOSE_MS + 500,
      tolerance: TRACK_TOLERANCE
    });
    await closing;
    return 'ok';
  }

  // —— 取放编排（单次）——
  // 返回 'done' | 'wait'（无可抓目标）| 'fail'
  async function runPickPlace(colorPref) {
    const s = sim();
    const epoch = s.getMotionEpoch();

    // 0. 手上已有物体 → 先送入对应格子
    if (s.getCarriedObject()) {
      const okPlace = await placeHeldBlock(epoch);
      if (!okPlace) return 'fail';
    }

    // 1. 选目标（pos 为 three 场景坐标）
    const target = s.selectTargetBlock(colorPref);
    if (!target) {
      setStatus(t('task.waitingBlock'));
      return 'wait';
    }
    setStatus(t('task.picking', { color: colorName(target.color) }));

    // 2. 锁定方块（只是标记「这块留给机械臂」，方块照旧随带面前进）
    //    → 悬停 → 跟随下探 → 跟随闭合
    if (!s.lockTargetBlock(target)) return 'fail';
    const outcome = await graspBlock(s, target, epoch);
    const graspedColor = outcome === 'ok' ? s.tryGraspNearTcp() : null;
    // 无论抓取成败都解除锁定：成功时由 carried 状态接管，失败时放行方块继续输送
    s.unlockTargetBlock(target);
    if (!graspedColor) {
      setStatus(t('task.noTarget'));
      const tcp = tcpThree();
      if (tcp) await tcpMove(addOffset(tcp, { y: 0.05 }), 700, epoch);
      return 'wait';
    }
    setStatus(t('task.grasped', { color: colorName(graspedColor) }));

    // 3. 抬升 → 移到对应颜色格上方 → 下探 → 释放
    const okPlace = await placeHeldBlock(epoch, graspedColor);
    if (!okPlace) return 'fail';
    return 'done';
  }

  async function placeHeldBlock(epoch, heldColor) {
    const s = sim();
    const color = heldColor || s.getCarriedObject();
    if (!color) return false;
    setStatus(t('task.placing', { color: colorName(color) }));

    const slot = s.getSlotPose(color); // three 坐标：above / drop（drop 在盒壁上方）
    const here = tcpThree();
    if (here && slot.above.y - here.y > 0.02) {
      // 抬升只为让随后的横向移动不刮到东西，失败不该放弃整个放置
      await tcpMove(addOffset(here, { y: 0.04 }), 700, epoch);
    }
    if (!await tcpMove(slot.above, 1500, epoch)) return safeDrop(epoch);
    if (!await tcpMove(slot.drop, 900, epoch)) return safeDrop(epoch);
    // 在盒壁上方松手，方块自己落进分格：夹爪不必挤进 55mm 窄格
    s.releaseCurrent();
    await s.openGripper(420);
    setStatus(t('task.placed', { color: colorName(color) }));
    updateBinCounts();
    // 释放后抬升是收尾动作，即使因可达边界失败也不应判定任务失败
    await tcpMove(addOffset(slot.drop, { y: 0.04 }), 750, epoch);
    return true;
  }

  // 放置路径受阻时兜底：就地松开（若恰在盒上方则正常入格，否则落地/回带循环再取）
  async function safeDrop(epoch) {
    const s = sim();
    if (s.getCarriedObject()) {
      s.releaseCurrent();
      await s.openGripper(420);
      updateBinCounts();
    }
    return true;
  }

  // —— 自动分拣循环 ——
  async function autoLoop() {
    while (autoRunning) {
      const outcome = await runPickPlace(selectedColor());
      if (!autoRunning) break;
      if (outcome === 'fail') {
        autoRunning = false;
        setStatus(t('task.stepFail'));
        break;
      }
      if (outcome === 'wait') await sleep(650);
    }
    autoRunning = false;
    updateAutoButton();
  }

  function updateAutoButton() {
    const btn = $('task-auto');
    if (!btn) return;
    btn.textContent = autoRunning ? t('task.stopSort') : t('task.autoSort');
    btn.classList.toggle('active', autoRunning);
  }

  function updateBinCounts() {
    const s = sim();
    if (!s) return;
    const counts = s.getBinCounts();
    ['red', 'yellow', 'blue'].forEach((color) => {
      const el = $(`bin-count-${color}`);
      if (el) el.textContent = String(counts[color] || 0);
    });
  }

  function updateDetectStatus() {
    const s = sim();
    if (!s) return;
    const status = s.getCameraStatus();
    const detectEl = $('detect-status');
    if (detectEl) {
      detectEl.textContent = status.targets.length
        ? t('task.detected', { n: status.targets.length })
        : t('task.detectedNone');
    }
    const targetEl = $('detect-target');
    if (targetEl) {
      if (status.targets.length) {
        const nearest = status.targets.reduce((best, item) => {
          const d = Math.hypot(item.x, item.y);
          const bd = best ? Math.hypot(best.x, best.y) : Infinity;
          return d < bd ? item : best;
        }, null);
        targetEl.textContent = `X ${nearest.x.toFixed(2)} / Y ${nearest.y.toFixed(2)} / Z ${nearest.z.toFixed(2)}`;
      } else {
        targetEl.textContent = '--';
      }
    }
    const holdingEl = $('task-holding');
    if (holdingEl) {
      holdingEl.textContent = status.holding
        ? t('task.holding', { color: colorName(status.holding) })
        : t('task.stopped');
    }
    updateBinCounts();
  }

  function bindUi() {
    const s = sim();

    // 侧边栏折叠
    const collapseBtn = $('sidebar-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        const shell = document.querySelector('.app-shell');
        const collapsed = shell.classList.toggle('panel-collapsed');
        collapseBtn.textContent = collapsed ? '▶' : '◀';
      });
    }

    // Pose（IK）运动
    const ikBtn = $('ros-check-ik');
    if (ikBtn) {
      ikBtn.addEventListener('click', async () => {
        if (busy || autoRunning) {
          setStatus(t('task.busy'));
          return;
        }
        busy = true;
        const num = (id, fallback) => {
          const value = Number($(id) && $(id).value);
          return Number.isFinite(value) ? value : fallback;
        };
        const target = {
          x: num('ros-pose-x', 0.4),
          y: num('ros-pose-y', 0),
          z: num('ros-pose-z', 0.25)
        };
        const duration = Math.max(0.4, num('ros-pose-duration', 1.5)) * 1000;
        setStatus(t('task.moving'));
        const result = await s.moveTcpTo(target, duration, {});
        if (result.ok) {
          setStatus(t('task.reachOk', { mm: (result.error * 1000).toFixed(1) }));
        } else {
          setStatus(t('task.reachFail'));
        }
        busy = false;
      });
    }

    // 移动到目标（按当前选中颜色，悬停在方块上方）
    const moveBtn = $('task-move-above');
    if (moveBtn) {
      moveBtn.addEventListener('click', async () => {
        if (busy || autoRunning) {
          setStatus(t('task.busy'));
          return;
        }
        const target = s.selectTargetBlock(selectedColor());
        if (!target) {
          setStatus(t('task.waitingBlock'));
          return;
        }
        busy = true;
        const graspOffset = s.getGraspOffsetHint();
        setStatus(t('msg.moveAboveTarget', { color: colorName(target.color) }));
        // 目标一直在随带面前进，悬停点要按运动耗时预判
        const ok = await tcpMove(
          addOffset(leadAhead(target.pos, s.getConveyorSpeed(), 1300), {
            y: graspOffset.y + HOVER_CLEARANCE
          }),
          1300,
          s.getMotionEpoch()
        );
        setStatus(ok ? t('task.reachOk', { mm: '0.0' }) : t('task.reachFail'));
        busy = false;
      });
    }

    // 手动抓取
    const graspBtn = $('task-grasp');
    if (graspBtn) {
      graspBtn.addEventListener('click', async () => {
        if (busy || autoRunning) {
          setStatus(t('task.busy'));
          return;
        }
        busy = true;
        if (s.getCarriedObject()) {
          setStatus(t('task.alreadyHolding'));
          busy = false;
          return;
        }
        // 传送带在动：锁定目标后边跟随边下探、边跟随边闭合
        const target = s.selectTargetBlock(selectedColor());
        if (target && s.lockTargetBlock(target)) {
          const epoch = s.getMotionEpoch();
          await graspBlock(s, target, epoch);
          s.unlockTargetBlock(target);
        } else {
          await s.closeGripper(CLOSE_MS);
        }
        const color = s.tryGraspNearTcp();
        setStatus(color ? t('task.grasped', { color: colorName(color) }) : t('task.graspClosed'));
        busy = false;
      });
    }

    // 手动松开
    const releaseBtn = $('task-release');
    if (releaseBtn) {
      releaseBtn.addEventListener('click', async () => {
        if (busy || autoRunning) {
          setStatus(t('task.busy'));
          return;
        }
        busy = true;
        if (!s.getCarriedObject()) {
          await s.openGripper(380);
          setStatus(t('task.firstOpen'));
          busy = false;
          return;
        }
        s.releaseCurrent();
        await s.openGripper(420);
        setStatus(t('task.released'));
        updateBinCounts();
        busy = false;
      });
    }

    // 单次「抓取并放入盒子」
    const pickPlaceBtn = $('task-pick-place');
    if (pickPlaceBtn) {
      pickPlaceBtn.addEventListener('click', async () => {
        if (busy || autoRunning) {
          setStatus(t('task.busy'));
          return;
        }
        busy = true;
        const outcome = await runPickPlace(selectedColor());
        if (outcome === 'wait') setStatus(t('task.waitingBlock'));
        else if (outcome !== 'done') setStatus(t('task.stepFail'));
        busy = false;
      });
    }

    // 自动分拣开关
    const autoBtn = $('task-auto');
    if (autoBtn) {
      autoBtn.addEventListener('click', () => {
        if (autoRunning) {
          autoRunning = false;
          s.stopMotion();
          setStatus(t('task.sortStopped'));
          updateAutoButton();
          return;
        }
        autoRunning = true;
        updateAutoButton();
        setStatus(t('task.sortStarted'));
        autoLoop();
      });
    }

    // 传送带开关
    const conveyorToggle = $('task-conveyor');
    if (conveyorToggle) {
      conveyorToggle.addEventListener('change', () => {
        s.setConveyorRunning(conveyorToggle.checked);
      });
    }

    // 停止按钮：终止一切动作（自动循环会因 epoch 变化自动退出）
    const stopBtn = $('stop-path');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        if (autoRunning) {
          autoRunning = false;
          updateAutoButton();
        }
      });
    }

    // 相机视图挂载（由 sim 负责渲染与检测框）
    s.attachCameraView($('camera-view'));

    // 识别状态轮询
    setInterval(updateDetectStatus, 320);

    // 语言切换时刷新按钮文案
    if (window.rebotI18n) {
      window.rebotI18n.onLangChange(() => {
        updateAutoButton();
        updateDetectStatus();
      });
    }
  }

  function init() {
    if (!sim()) {
      setTimeout(init, 60);
      return;
    }
    bindUi();
    updateAutoButton();
    updateDetectStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
