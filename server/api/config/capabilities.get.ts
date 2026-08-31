/**
 * 前端能力探测（审计 P1-3）：返回服务器端可选功能是否就绪。
 * 用于前端在入口处显示"未配置/未就绪"提示，而不是让用户点了才报错。
 */
export default defineEventHandler(() => {
  return {
    llmChat: Boolean(process.env.MOONSHOT_API_KEY || process.env.DEEPSEEK_API_KEY)
  }
})
