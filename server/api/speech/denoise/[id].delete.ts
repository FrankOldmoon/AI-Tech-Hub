/**
 * 取消音频降噪任务
 *
 * DELETE /api/speech/denoise/:id
 * 返回: { ok, cancelled? }
 */

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const cancelled = cancelDenoiseTask(id)
  if (!cancelled) {
    return { ok: false, error: 'Task not found or already finished' }
  }
  return { ok: true, cancelled: true }
})
