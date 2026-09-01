/** ReBot Arm：LLM 对话代理（本部署未起 text-agent，返回 502 不可用） */
import { createError } from 'h3'

export default defineEventHandler(() => {
  throw createError({ statusCode: 502, statusMessage: 'text-agent 未部署，LLM 对话暂不可用（仿真/手动控制不受影响）' })
})
