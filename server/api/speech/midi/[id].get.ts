/**
 * 音频转 MIDI 任务状态查询（轮询用）
 * GET /api/speech/midi/:id
 */

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const task = getMidiTask(id)
  if (!task) {
    return { ok: false, error: 'Task not found' }
  }
  return { ok: true, task }
})
