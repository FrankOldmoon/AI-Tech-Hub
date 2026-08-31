export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form) return { ok: false, error: 'Invalid multipart form data' }
  const filePart = form.find((f) => f.name === 'file' && f.filename)
  if (!filePart?.data?.length) return { ok: false, error: 'Missing CSV file' }
  const uploadErr = validateUploadPart(filePart, CSV_RULE)
  if (uploadErr) return { ok: false, error: uploadErr }
  const method = String(form.find((f) => f.name === 'method')?.data?.toString('utf8') ?? 'pca')
  const clusters = Number(form.find((f) => f.name === 'clusters')?.data?.toString('utf8') ?? 3)
  return enqueueDimReduction(filePart, method === 'tsne' ? 'tsne' : 'pca', Math.min(Math.max(clusters, 2), 8))
})
