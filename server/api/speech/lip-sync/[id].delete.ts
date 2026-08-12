/**
 * 取消口型同步任务
 * DELETE /api/speech/lip-sync/:id
 */

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const cancelled = cancelLipSyncTask(id)
  if (!cancelled) {
    return { ok: false, error: 'Task not found or already finished' }
  }
  return { ok: true, cancelled: true }
})
