/**
 * 音频分离 API - 异步任务模式
 *
 * 用法 (POST multipart/form-data):
 *   POST /api/speech/separate
 *   file      - 音频文件（必填）
 *   model     - htdemucs（默认）/ htdemucs_ft / mdx / mdx_extra
 *   twoStems  - 双轨分离指定声部：vocals/drums/bass/other（空 = 四轨）
 *
 * 返回:
 *   { ok: true, taskId: "uuid" }  立即返回，任务后台执行
 *   之后轮询 GET /api/speech/separate/{taskId}
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

  const model = String(form.find((f) => f.name === 'model')?.data?.toString('utf8') ?? 'htdemucs')
  const twoStems = String(form.find((f) => f.name === 'twoStems')?.data?.toString('utf8') ?? 'vocals')

  return enqueueSeparation(filePart, model, twoStems)
})
