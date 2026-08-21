/**
 * 云端 LLM 对话代理（Kimi / DeepSeek）
 *
 * 前端 -> 本接口（隐藏 API Key）-> 上游 /chat/completions
 * - 默认流式：透明转发上游 SSE（text/event-stream），前端自行解析 OpenAI 格式分片
 * - stream=false 时返回完整 JSON（供接口自测/降级）
 *
 * 请求体：
 *   { provider: 'moonshot' | 'deepseek', model: string, messages: {role,content}[],
 *     stream?: boolean, temperature?: number, maxTokens?: number }
 */
import { getProvider } from '../../utils/llm-providers'
import { sendStream } from 'h3'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    provider?: string
    model?: string
    messages?: { role: string, content: string }[]
    stream?: boolean
    temperature?: number
    maxTokens?: number
  }>(event)

  const provider = getProvider(body.provider ?? '')
  if (!provider) {
    throw createError({ statusCode: 400, statusMessage: `unknown provider: ${body.provider ?? ''}` })
  }
  const model = provider.models.find(m => m.value === body.model)
  if (!model) {
    throw createError({ statusCode: 400, statusMessage: `unknown model for ${provider.id}: ${body.model ?? ''}` })
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'messages is required' })
  }

  const apiKey = process.env[provider.keyEnv]
  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: `server key missing: set ${provider.keyEnv} in .env`
    })
  }

  const stream = body.stream !== false
  // 思考/推理类模型（如 kimi-k3）上游只允许 temperature=1，否则 400
  const temperature = model.thinking ? 1 : (body.temperature ?? 0.7)
  const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model.value,
      messages: body.messages,
      stream,
      temperature,
      max_tokens: body.maxTokens ?? 4096
    }),
    signal: AbortSignal.timeout(180_000)
  })

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '')
    throw createError({
      statusCode: upstream.status,
      statusMessage: detail.slice(0, 400) || `upstream error ${upstream.status}`
    })
  }

  if (!stream) {
    return await upstream.json()
  }

  // 流式：透明转发上游 SSE 分片
  setResponseHeaders(event, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no'
  })
  if (!upstream.body) {
    throw createError({ statusCode: 502, statusMessage: 'upstream returned no body' })
  }
  return sendStream(event, upstream.body as unknown as ReadableStream)
})
