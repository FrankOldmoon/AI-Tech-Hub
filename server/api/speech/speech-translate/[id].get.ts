/**
 * 语音翻译任务状态查询（轮询用）
 * GET /api/speech/speech-translate/:id
 */

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const task = getTranslateTask(id)
  if (!task) {
    return { ok: false, error: 'Task not found' }
  }
  return { ok: true, task }
})
