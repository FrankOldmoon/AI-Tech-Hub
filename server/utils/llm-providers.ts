/**
 * 云端 LLM 服务商配置（服务端校验与密钥注入用）
 *
 * 密钥一律通过环境变量注入，不落入代码：
 * - MOONSHOT_API_KEY -> https://api.moonshot.cn（Kimi）
 * - DEEPSEEK_API_KEY -> https://api.deepseek.com（DeepSeek）
 *
 * 模型清单与 app/utils/llm-providers.ts（前端展示）保持同步。
 */

export interface LlmModel {
  value: string
  /** 是否支持思考/推理（上游返回 reasoning_content 字段） */
  thinking?: boolean
}

export interface LlmProvider {
  id: 'moonshot' | 'deepseek'
  label: string
  baseUrl: string
  keyEnv: string
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

export function getProvider(id: string): LlmProvider | undefined {
  return llmProviders.find(p => p.id === id)
}
