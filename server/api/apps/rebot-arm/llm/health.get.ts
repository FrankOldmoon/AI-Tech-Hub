/** ReBot Arm：LLM text-agent 健康检查（本部署未起 text-agent，返回不可用） */
export default defineEventHandler(() => ({ ok: false, error: 'text-agent not available in this deployment' }))
