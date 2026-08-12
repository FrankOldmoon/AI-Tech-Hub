/**
 * 口型同步任务状态查询（轮询用）
 * GET /api/speech/lip-sync/:id
 */

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const task = getLipSyncTask(id)
  if (!task) {
    return { ok: false, error: 'Task not found' }
  }
  return { ok: true, task }
})
