/**
 * 注册 Service Worker（只缓存应用外壳，策略见 public/sw.js）。
 * - 仅生产环境注册：dev 下 SW 会缓存 Vite 模块，改代码不生效，是经典坑
 * - 失败静默降级：SW 只影响「更快/离线」，注册不上不应干扰正常使用
 * - 等 load 之后再注册：不与应用首屏资源抢带宽
 */
export default defineNuxtPlugin(() => {
  if (import.meta.dev) return
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 注册失败（隐私模式/不支持）静默忽略 */
    })
  })
})
