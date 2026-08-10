/**
 * Nuxt 服务器启动插件：自动预下载所有 AI 模型到 public/model/。
 *
 * - 已存在的文件会跳过，只下载缺失的文件
 * - 在后台异步执行，不阻塞服务器启动
 * - 通过 HMR 重载时不会重复执行（model-downloader 内部有 running 守卫）
 */
// downloadAllModels 由 Nitro 从 server/utils/ 自动导入
export default defineNitroPlugin(() => {
  // 后台异步执行，不阻塞服务器启动
  downloadAllModels()
})
