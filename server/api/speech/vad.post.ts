/**
 * VAD API - 异步任务模式
 *
 * POST /api/speech/vad (multipart/form-data)
 *   file - 音频文件（必填）
 * 返回 { ok: true, taskId }，轮询 GET /api/speech/vad/{taskId}
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
  return enqueueVad(filePart)
})
