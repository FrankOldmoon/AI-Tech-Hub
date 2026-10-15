/**
 * OpenAI 兼容 API（/v1/*）的公共工具单测：
 *
 * - 模型解析必须命中 llm-providers 注册表（外部调用方按 /v1/models 里的 id 传参）；
 * - Bearer Key 白名单是 /v1 唯一一道门，三类结果（未配置 / 命中 / 未命中）都要覆盖；
 * - 错误必须是 OpenAI 风格 { error: { message, type, code } }，SDK 才能正常解析；
 * - 自定义上游（LLM_PROVIDER_* 环境变量）必须与内置供应商合并进同一注册表。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCustomProviders } from '../server/utils/llm-providers'
import {
  accessError,
  checkAccessKey,
  listModelIds,
  openAiError,
  resolveModel
} from '../server/utils/openai-compat'

function fakeEvent(auth?: string) {
  const headers: Record<string, string> = {}
  if (auth) headers.authorization = auth
  const res = { statusCode: 200 }
  const event = { node: { req: { headers }, res } }
  return { event: event as never, res }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveModel', () => {
  it('命中 moonshot / deepseek 的模型并带出 provider', () => {
    expect(resolveModel('kimi-k3')?.provider.id).toBe('moonshot')
    expect(resolveModel('deepseek-v4-pro')?.provider.id).toBe('deepseek')
  })

  it('未知 / 空模型返回 undefined', () => {
    expect(resolveModel('gpt-4o')).toBeUndefined()
    expect(resolveModel('')).toBeUndefined()
  })
})

describe('listModelIds', () => {
  it('覆盖注册表全部模型且 id 无重复（/v1/models 的清单）', () => {
    const ids = listModelIds().map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('kimi-k3')
    expect(ids).toContain('deepseek-v4-pro')
    for (const m of listModelIds()) {
      expect(resolveModel(m.id), m.id).toBeDefined()
    }
  })
})

describe('checkAccessKey', () => {
  it('未配置白名单 = missing-config（对外关闭）', () => {
    vi.stubEnv('OPENAI_COMPAT_API_KEYS', '')
    expect(checkAccessKey(fakeEvent('Bearer k1').event)).toBe('missing-config')
    vi.stubEnv('OPENAI_COMPAT_API_KEYS', '   ')
    expect(checkAccessKey(fakeEvent('Bearer k1').event)).toBe('missing-config')
  })

  it('命中白名单（容忍空格与大小写无关的 Bearer 前缀）', () => {
    vi.stubEnv('OPENAI_COMPAT_API_KEYS', 'k1, k2')
    expect(checkAccessKey(fakeEvent('Bearer k2').event)).toBe('ok')
    expect(checkAccessKey(fakeEvent('bearer k1').event)).toBe('ok')
  })

  it('未命中 / 缺 Bearer 头 = invalid-key', () => {
    vi.stubEnv('OPENAI_COMPAT_API_KEYS', 'k1')
    expect(checkAccessKey(fakeEvent('Bearer nope').event)).toBe('invalid-key')
    expect(checkAccessKey(fakeEvent().event)).toBe('invalid-key')
    expect(checkAccessKey(fakeEvent('k1').event)).toBe('invalid-key')
  })
})

describe('自定义上游供应商（LLM_PROVIDER_*）', () => {
  it('从环境变量解析：id 小写、去尾斜杠、模型清单与 thinking 标记', () => {
    vi.stubEnv('LLM_PROVIDER_FOO_BASE_URL', 'https://api.foo.com/v1/')
    vi.stubEnv('LLM_PROVIDER_FOO_API_KEY', 'sk-custom')
    vi.stubEnv('LLM_PROVIDER_FOO_MODELS', 'foo-large, foo-mini')
    vi.stubEnv('LLM_PROVIDER_FOO_LABEL', 'Foo AI')
    vi.stubEnv('LLM_PROVIDER_FOO_THINKING_MODELS', 'foo-large')
    expect(getCustomProviders()).toEqual([
      {
        id: 'foo',
        label: 'Foo AI',
        baseUrl: 'https://api.foo.com/v1',
        keyEnv: 'LLM_PROVIDER_FOO_API_KEY',
        models: [{ value: 'foo-large', thinking: true }, { value: 'foo-mini' }]
      }
    ])
  })

  it('缺 MODELS / BASE_URL 跳过；未设 API_KEY 视为无密钥上游', () => {
    vi.stubEnv('LLM_PROVIDER_BROKEN_BASE_URL', 'https://api.foo.com/v1')
    expect(getCustomProviders()).toHaveLength(0)

    vi.stubEnv('LLM_PROVIDER_LOCAL_BASE_URL', 'http://localhost:11434/v1')
    vi.stubEnv('LLM_PROVIDER_LOCAL_MODELS', 'qwen3')
    const providers = getCustomProviders()
    expect(providers).toHaveLength(1)
    expect(providers[0]?.keyEnv).toBeUndefined()
    expect(providers[0]?.models).toEqual([{ value: 'qwen3' }])
  })

  it('自定义模型并入统一注册表：resolveModel / listModelIds 都可见', () => {
    vi.stubEnv('LLM_PROVIDER_FOO_BASE_URL', 'https://api.foo.com/v1')
    vi.stubEnv('LLM_PROVIDER_FOO_MODELS', 'foo-large')
    expect(resolveModel('foo-large')?.provider.id).toBe('foo')
    expect(listModelIds().map(m => m.id)).toContain('foo-large')
    // 环境变量还原后自定义模型消失，内置模型不受影响
    vi.unstubAllEnvs()
    expect(resolveModel('foo-large')).toBeUndefined()
    expect(resolveModel('deepseek-v4-pro')).toBeDefined()
  })
})

describe('OpenAI 风格错误', () => {
  it('openAiError 设状态码并返回 { error: { message, type, code } }（不抛错，SDK 才能读到）', () => {
    const { event, res } = fakeEvent()
    const body = openAiError(event, 401, 'bad key', 'invalid_api_key')
    expect(res.statusCode).toBe(401)
    expect(body).toEqual({
      error: { message: 'bad key', type: 'invalid_request_error', code: 'invalid_api_key' }
    })
  })

  it('accessError：未配置 503、错 key 401、对 key 放行', () => {
    vi.stubEnv('OPENAI_COMPAT_API_KEYS', '')
    const deniedA = accessError(fakeEvent('Bearer k1').event)
    expect(deniedA?.error.code).toBe('api_disabled')
    const { event: evB, res: resB } = fakeEvent('Bearer k1')
    const bodyB = accessError(evB)
    expect(resB.statusCode).toBe(503)
    expect(bodyB?.error.code).toBe('api_disabled')

    vi.stubEnv('OPENAI_COMPAT_API_KEYS', 'k1')
    const { event: evC, res: resC } = fakeEvent('Bearer nope')
    const bodyC = accessError(evC)
    expect(resC.statusCode).toBe(401)
    expect(bodyC?.error.code).toBe('invalid_api_key')

    expect(accessError(fakeEvent('Bearer k1').event)).toBeUndefined()
  })
})
