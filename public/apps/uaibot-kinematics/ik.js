/**
 * 数值 IK（阻尼最小二乘，Damped Least Squares）——教学演示实现
 * - 对 KUKA KR5 的 6 个旋转关节用「扰动法」求数值雅可比（3×6，只约束末端位置）
 * - 更新律：dq = J^T * (J*J^T + lambda^2 * I)^-1 * e
 * - 依赖：UAIbot.local.js 的 Robot.fkm()（需场景 world matrix 已刷新）
 */
import * as math from "mathjs";

export function createIkSolver(bot, scene, opts = {}) {
  const N = 6; // KUKA KR5：6 个旋转关节（link0..link5）
  const lambda = opts.lambda ?? 0.03; // 阻尼系数：越大越稳、收敛越慢
  const dqLimit = opts.dqLimit ?? 0.55; // 单步关节角最大变化（弧度）
  const tol = opts.tol ?? 2e-4; // 收敛阈值（米）

  function setQRad(qArr) {
    bot.config(math.matrix(qArr.slice())); // 1×6 向量，兼容现有 config
  }

  /** 读取指定 q 下末端（link6）世界坐标（米） */
  function eePos(qArr) {
    setQRad(qArr);
    scene.updateMatrixWorld(true);
    const T = bot.fkm()._data;
    return [T[0][3], T[1][3], T[2][3]];
  }

  /** 单次 DLS 步进，就地修改 qArr（弧度） */
  function step(qArr, target) {
    const p0 = eePos(qArr);
    const ex = target[0] - p0[0];
    const ey = target[1] - p0[1];
    const ez = target[2] - p0[2];
    const err = Math.hypot(ex, ey, ez);
    if (err < tol) return err;

    const d = 1e-4; // 扰动步长（弧度）
    const J = [[], [], []]; // 3×6 数值雅可比（只取位置分量）
    for (let j = 0; j < N; j++) {
      const q2 = qArr.slice();
      q2[j] += d;
      const p1 = eePos(q2);
      J[0][j] = (p1[0] - p0[0]) / d;
      J[1][j] = (p1[1] - p0[1]) / d;
      J[2][j] = (p1[2] - p0[2]) / d;
    }
    const M = math.matrix(J);
    const e = math.matrix([[ex], [ey], [ez]]);
    const A = math.add(
      math.multiply(M, math.transpose(M)),
      math.multiply(lambda * lambda, math.identity(3))
    );
    let dq;
    try {
      dq = math.multiply(math.transpose(M), math.multiply(math.inv(A), e))._data; // 6×1
    } catch (_) {
      return err;
    }
    for (let j = 0; j < N; j++) {
      let dv = dq[j][0];
      if (!Number.isFinite(dv)) continue;
      dv = Math.max(-dqLimit, Math.min(dqLimit, dv));
      qArr[j] += dv;
    }
    return err;
  }

  /**
   * 从 qDeg0（度）出发，把末端解到 target（米）。
   * @returns {{qDeg:number[], err:number}}
   */
  function solve(target, qDeg0, maxIter = 60) {
    const q = qDeg0.map((v) => (v * Math.PI) / 180);
    let err = Infinity;
    for (let i = 0; i < maxIter; i++) {
      err = step(q, target);
      if (err < tol) break;
    }
    setQRad(q);
    scene.updateMatrixWorld(true);
    return { qDeg: q.map((v) => (v * 180) / Math.PI), err };
  }

  /** 读取当前位形下末端坐标（不改变位形） */
  function currentEE() {
    scene.updateMatrixWorld(true);
    const T = bot.fkm()._data;
    return [T[0][3], T[1][3], T[2][3]];
  }

  return { solve, currentEE };
}
