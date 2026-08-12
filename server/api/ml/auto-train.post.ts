/**
 * CSV 自动训练 API - 异步任务模式
 * POST /api/ml/auto-train (multipart) file=CSV, target=目标列, task=auto|classification|regression
 */

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form) {
    return { ok: false, error: 'Invalid multipart form data' }
  }
  const filePart = form.find((f) => f.name === 'file' && f.filename)
  if (!filePart?.data?.length) {
    return { ok: false, error: 'Missing CSV file' }
  }
  const target = String(form.find((f) => f.name === 'target')?.data?.toString('utf8') ?? '').trim()
  const task = String(form.find((f) => f.name === 'task')?.data?.toString('utf8') ?? 'auto').trim()
  return enqueueAutoTrain(filePart, target, task)
})
