/**
 * 取消音频分离任务
 *
 * DELETE /api/speech/separate/:id
 * 返回: { ok, cancelled? }
 */

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const cancelled = cancelSeparationTask(id)
  if (!cancelled) {
    return { ok: false, error: 'Task not found or already finished' }
  }
  return { ok: true, cancelled: true }
})
