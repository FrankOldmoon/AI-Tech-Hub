/**
 * OpenAI 兼容 API（/v1/*）的公共工具
 *
 * - 鉴权：调用方 Bearer Key 白名单（OPENAI_COMPAT_API_KEYS，逗号分隔），
 *   与上游供应商 key（MOONSHOT_API_KEY / DEEPSEEK_API_KEY）无关。
 *   未配置白名单 = 对外关闭（503），安全默认，避免上游付费额度被公网滥用。
 * - 模型解析：复用 llm-providers 注册表，裸模型 id（kimi-k3 等）跨 provider 唯一。
 * - 错误：不抛 h3 错误（h3 默认错误体会把 data 包一层，SDK 读不到），
 *   而是 setResponseStatus + 直接返回 OpenAI 风格 `{"error": { message, type, code }}`。
 */
import { getHeader, setResponseStatus, type H3Event } from 'h3'
import { getAllProviders, type LlmModel, type LlmProvider } from './llm-providers'

export interface ResolvedModel {
  provider: LlmProvider
  model: LlmModel
}

export interface OpenAiErrorBody {
  error: { message: string, type: string, code: string }
}

/** 裸模型 id -> { provider, model }，未命中返回 undefined（内置 + 自定义供应商） */
export function resolveModel(model: string): ResolvedModel | undefined {
  for (const provider of getAllProviders()) {
    const found = provider.models.find(m => m.value === model)
    if (found) return { provider, model: found }
  }
  return undefined
}

/** 已知模型 id 的去重清单（/v1/models 用） */
export function listModelIds(): { id: string, ownedBy: string }[] {
  return getAllProviders().flatMap(p => p.models.map(m => ({ id: m.value, ownedBy: p.id })))
}

export type AccessCheck = 'ok' | 'missing-config' | 'invalid-key'

/**
 * 校验 `Authorization: Bearer <key>` 是否在 OPENAI_COMPAT_API_KEYS 白名单中。
 * OPENAI_COMPAT_API_KEYS 未配置视为「对外关闭」。
 */
export function checkAccessKey(event: H3Event): AccessCheck {
  const configured = (process.env.OPENAI_COMPAT_API_KEYS ?? '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
  if (configured.length === 0) return 'missing-config'

  const header = getHeader(event, 'authorization') ?? ''
  const value = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]
  if (!value) return 'invalid-key'
  return configured.includes(value.trim()) ? 'ok' : 'invalid-key'
}

/** 设置响应状态码并返回 OpenAI 风格错误体（调用方 `return openAiError(...)` 即可） */
export function openAiError(event: H3Event, statusCode: number, message: string, code: string): OpenAiErrorBody {
  setResponseStatus(event, statusCode)
  const type = statusCode === 401 || statusCode === 400 || statusCode === 404
    ? 'invalid_request_error'
    : 'api_error'
  return { error: { message, type, code } }
}

/**
 * 鉴权门：通过返回 undefined；否则返回已设好状态码的错误体，
 * 调用方 `const denied = accessError(event); if (denied) return denied`。
 */
export function accessError(event: H3Event): OpenAiErrorBody | undefined {
  const result = checkAccessKey(event)
  if (result === 'missing-config') {
    return openAiError(event, 503, 'external OpenAI-compatible API is disabled: set OPENAI_COMPAT_API_KEYS on the server', 'api_disabled')
  }
  if (result === 'invalid-key') {
    return openAiError(event, 401, 'invalid or missing API key (Authorization: Bearer <key>)', 'invalid_api_key')
  }
  return undefined
}
