/**
 * 人脸识别/验证 API（异步任务）
 *
 * POST /api/image/face-recognition (multipart/form-data)
 *   file  - 人脸图片（必填）
 *   file2 - 第二张图片（mode=verification 必填）
 *   mode  - recognition | verification
 */

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form) return { ok: false, error: 'Invalid multipart form data' }
  const filePart = form.find((f) => f.name === 'file' && f.filename) ?? null
  const file2Part = form.find((f) => f.name === 'file2' && f.filename) ?? null
  const mode = String(form.find((f) => f.name === 'mode')?.data?.toString('utf8') ?? 'recognition')
  if (!filePart?.data?.length) return { ok: false, error: 'Missing image' }
  if (!['recognition', 'verification'].includes(mode)) return { ok: false, error: 'Invalid mode' }
  return enqueueFaceRec(filePart, file2Part, mode)
})
