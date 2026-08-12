export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form) return { ok: false, error: 'Invalid multipart form data' }
  const filePart = form.find((f) => f.name === 'file' && f.filename)
  if (!filePart?.data?.length) return { ok: false, error: 'Missing CSV file' }
  const dateCol = String(form.find((f) => f.name === 'dateCol')?.data?.toString('utf8') ?? '').trim()
  const valueCol = String(form.find((f) => f.name === 'valueCol')?.data?.toString('utf8') ?? '').trim()
  const horizon = Number(form.find((f) => f.name === 'horizon')?.data?.toString('utf8') ?? 30)
  return enqueueForecast(filePart, dateCol, valueCol, Math.min(Math.max(horizon, 1), 180))
})
