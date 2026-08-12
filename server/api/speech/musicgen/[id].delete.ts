/**
 * 取消文生音乐任务
 * DELETE /api/speech/musicgen/:id
 */

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const cancelled = cancelMusicgenTask(id)
  if (!cancelled) {
    return { ok: false, error: 'Task not found or already finished' }
  }
  return { ok: true, cancelled: true }
})
