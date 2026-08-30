/**
 * Nuxt 服务器启动插件：自动为 python 下的 Python 项目
 * 创建虚拟环境并安装依赖。
 *
 * - 已存在 .venv 的项目会跳过
 * - 在后台异步执行，不阻塞服务器启动
 * - 通过 HMR 重载时不会重复执行（python-setup 内部有 running 守卫）
 */
// setupAllPythonEnvs 由 Nitro 从 server/utils/ 自动导入
export default defineNitroPlugin(() => {
  // 云端（Vercel）无 Python 运行时：跳过 venv 创建
  // 自托管 Phase 1（未启用 Python 后端）用 NUXT_SKIP_PYTHON_SETUP=1 显式跳过
  if (process.env.VERCEL || process.env.NUXT_SKIP_PYTHON_SETUP === '1') {
    console.log(`[python-setup] 跳过 Python 环境初始化 (${process.env.VERCEL ? 'Vercel' : 'NUXT_SKIP_PYTHON_SETUP'})`)
    return
  }
  // 后台异步执行，不阻塞服务器启动
  setupAllPythonEnvs()
})
