/**
 * 云端 LLM 服务商配置（前端展示用）
 *
 * 仅含展示文案与模型值（模型 ID 属公开 API 事实）；
 * 密钥由服务端 server/utils/llm-providers.ts 经环境变量注入，浏览器不接触。
 * 模型清单与 server 侧保持同步。
 */

export interface LlmModelItem {
  value: string
  label: string
  /** 是否支持思考/推理（上游返回 reasoning_content） */
  thinking?: boolean
}

export interface LlmProviderItem {
  id: 'moonshot' | 'deepseek'
  label: string
  models: LlmModelItem[]
}

export const llmProviders: LlmProviderItem[] = [
  {
    id: 'moonshot',
    label: 'Kimi（Moonshot）',
    models: [
      { value: 'kimi-k3', label: 'Kimi K3（思考推理）', thinking: true },
      { value: 'kimi-k2.7-code', label: 'Kimi K2.7 Code（代码）' },
      { value: 'kimi-k2.6', label: 'Kimi K2.6' },
      { value: 'kimi-k2.5', label: 'Kimi K2.5' },
      { value: 'moonshot-v1-128k', label: 'Moonshot V1 128K' },
      { value: 'moonshot-v1-32k', label: 'Moonshot V1 32K' }
    ]
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    models: [
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash（快速）' }
    ]
  }
]
