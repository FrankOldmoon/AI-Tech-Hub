/**
 * 会议纪要任务状态查询（轮询用）
 * GET /api/speech/meeting/:id
 */

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const task = getMeetingTask(id)
  if (!task) {
    return { ok: false, error: 'Task not found' }
  }
  return { ok: true, task }
})
