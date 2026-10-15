/**
 * 云端 LLM 服务商配置（服务端校验与密钥注入用）
 *
 * 密钥一律通过环境变量注入，不落入代码：
 * - MOONSHOT_API_KEY -> https://api.moonshot.cn（Kimi）
 * - DEEPSEEK_API_KEY -> https://api.deepseek.com（DeepSeek）
 *
 * 自定义上游（任意 OpenAI 兼容服务：通义/智谱/OpenRouter/本地 Ollama...）按
 * LLM_PROVIDER_<ID>_* 环境变量声明，与内置供应商合并进同一注册表：
 * - LLM_PROVIDER_<ID>_BASE_URL       必填，如 https://api.foo.com/v1
 * - LLM_PROVIDER_<ID>_API_KEY        选填；缺省 = 无密钥上游（本地 Ollama 等），请求不带 Authorization
 * - LLM_PROVIDER_<ID>_MODELS         必填，逗号分隔模型 id，如 foo-large,foo-mini
 * - LLM_PROVIDER_<ID>_LABEL          选填，展示名，缺省用 id
 * - LLM_PROVIDER_<ID>_THINKING_MODELS 选填，逗号分隔；这些模型强制 temperature=1（上游限制）
 *
 * 模型清单与 app/utils/llm-providers.ts（前端展示）保持同步（自定义供应商仅服务端可见）。
 */

export interface LlmModel {
  value: string
  /** 是否支持思考/推理（上游返回 reasoning_content 字段） */
  thinking?: boolean
}

export interface LlmProvider {
  id: string
  label: string
  baseUrl: string
  /** 密钥所在环境变量名；缺省 = 无密钥上游，请求不带 Authorization 头 */
  keyEnv?: string
  models: LlmModel[]
}

export const llmProviders: LlmProvider[] = [
  {
    id: 'moonshot',
    label: 'Kimi（Moonshot）',
    baseUrl: 'https://api.moonshot.cn/v1',
    keyEnv: 'MOONSHOT_API_KEY',
    models: [
      { value: 'kimi-k3', thinking: true },
      { value: 'kimi-k2.7-code' },
      { value: 'kimi-k2.6' },
      { value: 'kimi-k2.5' },
      { value: 'moonshot-v1-128k' },
      { value: 'moonshot-v1-32k' }
    ]
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    models: [
      { value: 'deepseek-v4-pro' },
      { value: 'deepseek-v4-flash' }
    ]
  }
]

/** 解析 LLM_PROVIDER_<ID>_* 环境变量为供应商清单（BASE_URL 与 MODELS 齐全才生效） */
export function getCustomProviders(env: NodeJS.ProcessEnv = process.env): LlmProvider[] {
  const ids = new Set<string>()
  for (const key of Object.keys(env)) {
    const matched = /^LLM_PROVIDER_([A-Za-z0-9_]+)_BASE_URL$/.exec(key)
    const idToken = matched?.[1]
    if (idToken) ids.add(idToken.toLowerCase())
  }

  const providers: LlmProvider[] = []
  for (const id of ids) {
    const upper = id.toUpperCase()
    const baseUrl = env[`LLM_PROVIDER_${upper}_BASE_URL`]?.trim().replace(/\/+$/, '')
    const models = (env[`LLM_PROVIDER_${upper}_MODELS`] ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    if (!baseUrl || models.length === 0) {
      console.warn(`[llm-providers] 自定义供应商 ${id} 配置不完整（需 BASE_URL 与 MODELS），已跳过`)
      continue
    }
    const thinking = new Set(
      (env[`LLM_PROVIDER_${upper}_THINKING_MODELS`] ?? '')
        .split(',')
        .map(s => s.trim().toLowerCase())
    )
    const apiKeyVar = `LLM_PROVIDER_${upper}_API_KEY`
    providers.push({
      id,
      label: env[`LLM_PROVIDER_${upper}_LABEL`]?.trim() || id,
      baseUrl,
      // API_KEY 变量存在（哪怕待填）才算配置了密钥；完全不设 = 无密钥上游
      ...(env[apiKeyVar] !== undefined ? { keyEnv: apiKeyVar } : {}),
      models: models.map(value =>
        thinking.has(value.toLowerCase()) ? { value, thinking: true } : { value }
      )
    })
  }
  return providers.sort((a, b) => a.id.localeCompare(b.id))
}

/** 内置 + 自定义的完整供应商注册表（/v1 兼容 API 与 llm-chat 代理共用） */
export function getAllProviders(): LlmProvider[] {
  return [...llmProviders, ...getCustomProviders()]
}

export function getProvider(id: string): LlmProvider | undefined {
  return getAllProviders().find(p => p.id === id)
}
