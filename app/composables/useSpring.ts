import { computed, onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'

export interface SpringOptions {
  /** 阻尼比：1.0 = 临界阻尼（跟手不振荡，Apple 默认）；<1 带轻微过冲 */
  damping?: number
  /** 刚度：越大收敛越快（180 ≈ 2.1Hz，约 300ms 收敛） */
  stiffness?: number
  /** 收敛精度：距目标小于此值且速度可忽略时停止 */
  precision?: number
}

/** 用户偏好减少动效（prefers-reduced-motion）时返回 true，用于禁用弹簧动画 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * 弹簧动画（Apple「Designing Fluid Interfaces」的 Web 实现）：
 * - 从「当前值」起动画，目标变化立即转向（可中断，不跳变）
 * - 半隐式欧拉积分，数值稳定
 * - 阻尼比 1.0 临界阻尼：跟手、不过冲、不振荡
 * - prefers-reduced-motion 时退化为即时跳变（无动画）
 */
export function useSpring(target: Ref<number>, options: SpringOptions = {}) {
  const { damping = 1, stiffness = 180, precision = 0.01 } = options
  const value = ref(target.value)
  let velocity = 0
  let rafId = 0
  let lastTime = 0

  // 质量 m=1：k = stiffness，c = 2 * damping * sqrt(k)
  const k = stiffness
  const c = 2 * damping * Math.sqrt(k)

  function frame(time: number) {
    const dt = Math.min((time - lastTime) / 1000, 1 / 30) // 防切后台后大跳
    lastTime = time
    const x = value.value - target.value
    // 半隐式欧拉：先更新速度再更新位置
    velocity += (-c * velocity - k * x) * dt
    value.value += velocity * dt
    if (Math.abs(x) < precision && Math.abs(velocity) < precision * 10) {
      value.value = target.value
      velocity = 0
      rafId = 0
      return
    }
    rafId = requestAnimationFrame(frame)
  }

  function start() {
    if (rafId) return
    lastTime = performance.now()
    rafId = requestAnimationFrame(frame)
  }

  watch(target, (nv) => {
    if (prefersReducedMotion()) {
      value.value = nv
      velocity = 0
      return
    }
    if (nv !== value.value) start()
  })

  onScopeDispose(() => {
    if (rafId) cancelAnimationFrame(rafId)
  })

  // 直接返回只读 ref（computed）：调用方 .value 恒为数值
  return computed(() => value.value)
}
