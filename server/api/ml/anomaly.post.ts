export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form) return { ok: false, error: 'Invalid multipart form data' }
  const filePart = form.find((f) => f.name === 'file' && f.filename)
  if (!filePart?.data?.length) return { ok: false, error: 'Missing CSV file' }
  const uploadErr = validateUploadPart(filePart, CSV_RULE)
  if (uploadErr) return { ok: false, error: uploadErr }
  const xCol = String(form.find((f) => f.name === 'xCol')?.data?.toString('utf8') ?? '').trim()
  const yCol = String(form.find((f) => f.name === 'yCol')?.data?.toString('utf8') ?? '').trim()
  const contamination = Number(form.find((f) => f.name === 'contamination')?.data?.toString('utf8') ?? 0.1)
  return enqueueAnomaly(filePart, xCol, yCol, Math.min(Math.max(contamination, 0.01), 0.5))
})
