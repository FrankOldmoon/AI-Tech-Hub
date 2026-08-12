export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const task = getSdTurboTask(id)
  if (!task) return { ok: false, error: 'Task not found' }
  return { ok: true, task }
})
