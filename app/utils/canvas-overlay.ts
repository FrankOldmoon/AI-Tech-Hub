/**
 * 画布叠加绘制小工具（YOLO 与 MediaPipe 两条推理链共用）。
 *
 * 分类这类「没有框可画」的任务，结果只能标在图上：把「标签 + 置信度」按名次
 * 依次列在画面左上角。抽到这里是为了让两个引擎画出一模一样的东西，改一处即可。
 */

/**
 * 在画布左上角按顺序列出「标签 + 置信度」，第 1 名高亮。
 * @param rows 已按置信度降序排好的结果（调用方决定取前几名）
 */
export function drawScoreList(
  ctx: CanvasRenderingContext2D,
  rows: Array<{ label: string, score: number }>
) {
  if (!rows.length) return
  /* 画布通常远大于显示尺寸（按 max-w 缩放显示），字号按宽度取比例才保持可读 */
  const fs = Math.max(12, Math.round(ctx.canvas.width / 50))
  const pad = Math.round(fs * 0.55)
  const lh = Math.round(fs * 1.5)
  ctx.save()
  ctx.font = `600 ${fs}px -apple-system, sans-serif`
  ctx.textBaseline = 'top'
  const lines = rows.map((r, i) => `${i + 1}. ${r.label}  ${(r.score * 100).toFixed(1)}%`)
  const bw = Math.max(...lines.map(t => ctx.measureText(t).width)) + pad * 2
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(0, 0, bw, lh * lines.length + pad * 2)
  lines.forEach((text, i) => {
    ctx.fillStyle = i === 0 ? '#4ade80' : '#ffffff'
    ctx.fillText(text, pad, pad + i * lh)
  })
  ctx.restore()
}
