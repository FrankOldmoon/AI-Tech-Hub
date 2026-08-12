/**
 * 文生音乐任务状态查询（轮询用）
 * GET /api/speech/musicgen/:id
 */

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const task = getMusicgenTask(id)
  if (!task) {
    return { ok: false, error: 'Task not found' }
  }
  return { ok: true, task }
})
