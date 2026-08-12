/**
 * 取消语音翻译任务
 * DELETE /api/speech/speech-translate/:id
 */

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const cancelled = cancelTranslateTask(id)
  if (!cancelled) {
    return { ok: false, error: 'Task not found or already finished' }
  }
  return { ok: true, cancelled: true }
})
