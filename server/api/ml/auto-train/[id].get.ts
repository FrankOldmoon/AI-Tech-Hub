export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return { ok: false, error: 'Missing id' }
  const task = getAutoTrainTask(id)
  if (!task) return { ok: false, error: 'Task not found' }
  return { ok: true, task }
})
