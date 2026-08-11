/**
 * 语音克隆 API - 异步任务模式
 *
 * POST /api/speech/voice-clone (multipart/form-data)
 *   ref   - 参考音频（必填，5-15 秒人声）
 *   text  - 要合成的文本（必填）
 *   lang  - 语言（默认 zh-cn）
 *
 * 返回 { ok, taskId }，轮询 GET /api/speech/voice-clone/:id
 */

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form) return { ok: false, error: 'Invalid multipart form data' }

  const refPart = form.find((f) => f.name === 'ref' && f.filename)
  if (!refPart?.data?.length) return { ok: false, error: 'Missing reference audio' }

  const text = String(form.find((f) => f.name === 'text')?.data?.toString('utf8') ?? '')
  const lang = String(form.find((f) => f.name === 'lang')?.data?.toString('utf8') ?? 'zh-cn')

  return enqueueVoiceClone(refPart, text, lang)
})
