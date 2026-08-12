/**
 * 音频降噪任务状态查询（轮询用）
 *
 * GET /api/speech/denoise/:id
 * 返回: { ok, task: { id, status, progress, message, error?, audioUrl? } }
 */

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const task = getDenoiseTask(id)
  if (!task) {
    return { ok: false, error: 'Task not found' }
  }
  return { ok: true, task }
})
