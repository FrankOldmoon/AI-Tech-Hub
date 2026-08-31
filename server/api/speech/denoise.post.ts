/**
 * 音频降噪 API - 异步任务模式
 *
 * 用法 (POST multipart/form-data):
 *   POST /api/speech/denoise
 *   file - 音频文件（必填）
 *
 * 返回:
 *   { ok: true, taskId: "uuid" }  立即返回，任务后台执行
 *   之后轮询 GET /api/speech/denoise/{taskId}
 */

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form) {
    return { ok: false, error: 'Invalid multipart form data' }
  }
  const filePart = form.find((f) => f.name === 'file' && f.filename)
  if (!filePart?.data?.length) {
    return { ok: false, error: 'Missing audio file' }
  }
  const uploadErr = validateUploadPart(filePart, AUDIO_RULE)
  if (uploadErr) return { ok: false, error: uploadErr }
  return enqueueDenoise(filePart)
})
