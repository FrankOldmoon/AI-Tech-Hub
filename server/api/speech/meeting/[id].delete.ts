/**
 * 取消会议纪要任务
 * DELETE /api/speech/meeting/:id
 */

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const cancelled = cancelMeetingTask(id)
  if (!cancelled) {
    return { ok: false, error: 'Task not found or already finished' }
  }
  return { ok: true, cancelled: true }
})
