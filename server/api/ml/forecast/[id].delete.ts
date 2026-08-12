export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return { ok: false, error: 'Missing id' }
  return { ok: cancelForecastTask(id) }
})
