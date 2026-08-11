export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const cancelled = cancelVoiceCloneTask(id)
  if (!cancelled) return { ok: false, error: 'Task not found or already finished' }
  return { ok: true, cancelled: true }
})
