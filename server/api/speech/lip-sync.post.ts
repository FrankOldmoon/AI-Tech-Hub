/**
 * 口型同步 API - 异步任务模式
 * POST /api/speech/lip-sync (multipart) video=视频, audio=音频
 */

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form) {
    return { ok: false, error: 'Invalid multipart form data' }
  }
  const video = form.find((f) => f.name === 'video' && f.filename)
  const audio = form.find((f) => f.name === 'audio' && f.filename)
  if (!video?.data?.length || !audio?.data?.length) {
    return { ok: false, error: 'Missing video or audio' }
  }
  return enqueueLipSync(video, audio)
})
