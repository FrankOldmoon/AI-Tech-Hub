/**
 * Nuxt 服务器启动插件：自动预下载所有 AI 模型到 public/model/。
 *
 * - 已存在的文件会跳过，只下载缺失的文件
 * - 在后台异步执行，不阻塞服务器启动
 * - 通过 HMR 重载时不会重复执行（model-downloader 内部有 running 守卫）
 */
// downloadAllModels 由 Nitro 从 server/utils/ 自动导入
export default defineNitroPlugin(() => {
  // 云端（Vercel）只读文件系统 + 无持久存储：跳过预下载，
  // 模型由前端通过 /api/hf 代理按需拉取
  // 自托管已预置本地模型时用 NUXT_SKIP_MODEL_DOWNLOAD=1 显式跳过
  if (process.env.VERCEL || process.env.NUXT_SKIP_MODEL_DOWNLOAD === '1') {
    console.log(`[model-downloader] 跳过模型预下载 (${process.env.VERCEL ? 'Vercel' : 'NUXT_SKIP_MODEL_DOWNLOAD'})`)
    return
  }
  // 后台异步执行，不阻塞服务器启动
  downloadAllModels()
})
