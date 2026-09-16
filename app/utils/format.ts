/**
 * 展示用格式化小工具：字节体积、时长、体积变化。
 *
 * 从 image-algorithms.ts 里提出来（原先只有图像页在用），因为音频/视频转换页同样需要，
 * 而语音页不该为了一个 5 行函数去引入整个图像算法模块。
 */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 秒 → mm:ss（超过 1 小时才带小时位）；duration 常为 NaN/Infinity（未加载完成或流式容器），一律当 0 */
export function formatTime(totalSeconds: number): string {
  const total = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const s = String(total % 60).padStart(2, '0')
  const m = String(Math.floor(total / 60) % 60).padStart(2, '0')
  const h = Math.floor(total / 3600)
  return h ? `${h}:${m}:${s}` : `${m}:${s}`
}

/** 结果相对原始的百分比变化（负数=变小）；原始体积未知时返回 null */
export function sizeDelta(before: number, after: number): number | null {
  if (!before) return null
  return Math.round(((after - before) / before) * 100)
}

/**
 * 秒 → mm:ss.s（一位小数）。
 * 裁剪类界面需要比 mm:ss 更细的刻度：滑块步进是 0.1 秒，只显示到秒会让「选了 1.5 秒」看起来像 1 秒。
 */
export function formatTimeMs(totalSeconds: number): string {
  const total = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0
  const m = String(Math.floor(total / 60) % 60).padStart(2, '0')
  const s = (total % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}
