/**
 * OpenAI 兼容：模型清单
 *
 * GET /v1/models（Bearer Key 见 server/utils/openai-compat.ts）
 * 让 OpenAI SDK / 兼容客户端可以枚举站内可用的模型（Kimi + DeepSeek）。
 */
import { accessError, listModelIds } from '../../utils/openai-compat'

// OpenAI 响应里的 created 为秒级时间戳；站内模型无上线时间概念，用固定常量即可
const CREATED = 1700000000

export default defineEventHandler((event) => {
  const denied = accessError(event)
  if (denied) return denied
  return {
    object: 'list',
    data: listModelIds().map(m => ({
      id: m.id,
      object: 'model',
      created: CREATED,
      owned_by: m.ownedBy
    }))
  }
})
