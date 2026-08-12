/**
 * 文生音乐 API - 异步任务模式（常驻 worker）
 *
 * POST /api/speech/musicgen
 * body: { prompt: string, duration?: number }
 * 返回 { ok: true, taskId }，轮询 GET /api/speech/musicgen/{taskId}
 */

export default defineEventHandler(async (event) => {
  const body = await readBody<{ prompt?: string, duration?: number }>(event)
  return enqueueMusicgen(String(body?.prompt || ''), Number(body?.duration) || 5)
})
