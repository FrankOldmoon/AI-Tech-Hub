/**
 * OpenAI 兼容：对话补全（外部 API 入口）
 *
 * POST /v1/chat/completions（Bearer Key 见 server/utils/openai-compat.ts）
 * 用 OpenAI SDK 直连：baseURL = 'https://host/v1'，apiKey = 白名单里的自定义 key。
 *
 * 上游（Kimi / DeepSeek）本身即 OpenAI 协议，body 原样透传，仅：
 * - 替换 model 为注册表中的真实模型；
 * - thinking 模型（如 kimi-k3）上游只允许 temperature=1，强制之（与 llm-chat 一致）；
 * - stream 缺省为 false（OpenAI 默认非流式）。
 * - 流式：透明转发上游 SSE；非流式：直接返回上游 JSON（天然 OpenAI 格式）。
 */
import { sendStream } from 'h3'
import { accessError, openAiError, resolveModel } from '../../../utils/openai-compat'

export default defineEventHandler(async (event) => {
  const denied = accessError(event)
  if (denied) return denied

  const body = await readBody<Record<string, unknown>>(event)
  const modelName = typeof body?.model === 'string' ? body.model : ''
  const resolved = resolveModel(modelName)
  if (!resolved) {
    return openAiError(event, 404, `model not found: ${modelName || '(empty)'}; see GET /v1/models`, 'model_not_found')
  }
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return openAiError(event, 400, 'messages is required and must be a non-empty array', 'invalid_request_error')
  }

  // 内置供应商必须配 key；自定义上游可不配（无密钥服务如本地 Ollama）
  const apiKey = resolved.provider.keyEnv ? process.env[resolved.provider.keyEnv] : undefined
  if (resolved.provider.keyEnv && !apiKey) {
    return openAiError(event, 500, `server key missing: set ${resolved.provider.keyEnv} in .env`, 'upstream_key_missing')
  }
  const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) authHeaders.Authorization = `Bearer ${apiKey}`

  // OpenAI 默认非流式；透传其余字段（temperature/top_p/max_tokens/stop/tools...）
  const stream = body.stream === true
  const upstream = await fetch(`${resolved.provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      ...body,
      model: resolved.model.value,
      stream,
      ...(resolved.model.thinking ? { temperature: 1 } : {})
    }),
    signal: AbortSignal.timeout(180_000)
  })

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '')
    return openAiError(
      event,
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      detail.slice(0, 400) || `upstream error ${upstream.status}`,
      'upstream_error'
    )
  }

  if (!stream) {
    return await upstream.json()
  }

  setResponseHeaders(event, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no'
  })
  if (!upstream.body) {
    return openAiError(event, 502, 'upstream returned no body', 'upstream_error')
  }
  return sendStream(event, upstream.body as unknown as ReadableStream)
})
