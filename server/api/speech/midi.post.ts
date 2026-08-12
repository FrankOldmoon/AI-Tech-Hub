/**
 * 音频转 MIDI API - 异步任务模式
 * POST /api/speech/midi (multipart) file=音频, instrument=piano
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
  const instrument = String(form.find((f) => f.name === 'instrument')?.data?.toString('utf8') ?? 'piano')
  return enqueueMidi(filePart, instrument)
})
