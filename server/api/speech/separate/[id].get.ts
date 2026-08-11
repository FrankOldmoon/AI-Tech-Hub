/**
 * 音频分离任务状态查询（轮询用）
 *
 * GET /api/speech/separate/:id
 * 返回: { ok, task: { id, status, progress, message, error?, stems? } }
 */

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const task = getSeparationTask(id)
  if (!task) {
    return { ok: false, error: 'Task not found' }
  }
  return { ok: true, task }
})
