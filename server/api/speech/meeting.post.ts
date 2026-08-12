/**
 * 会议纪要 API - 异步任务模式
 * POST /api/speech/meeting (multipart) file=音频
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
  return enqueueMeeting(filePart)
})
