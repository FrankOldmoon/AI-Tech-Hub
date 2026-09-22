/**
 * 加载 .models/vendor/ 下的运行时库产物（headaudio 等 —— 由 scripts/sync-runtime-libs.mjs
 * 从 npm 包的 dist 同步而来，不进打包，运行时按 URL 现取）。
 *
 * 为什么不直接 import('/model/vendor/headaudio/headaudio.min.mjs')：
 * 浏览器对 ES module 强制校验 MIME，而生产上这些文件由 nginx `alias` 直出
 * （见 docs/DEPLOY-AIHUB.md 第一节），nginx 的 mime.types 里没有 .mjs → 按
 * default_type 发成 application/octet-stream → 模块被拒绝执行：
 *
 *   Failed to load module script: Expected a JavaScript-or-Wasm module script but the
 *   server responded with a MIME type of "application/octet-stream".
 *
 * 更糟的是这条错误在 humanError() 里匹配 /failed to fetch/，被显示成「网络请求失败，
 * 请检查网络后重试」—— 2026-09-22 的生产故障就是它，排查方向被带偏了一整轮。
 * AudioWorklet 的 addModule() 同样受 MIME 约束，走同一套路。
 *
 * 做法：把源码取回来，用明确写着 text/javascript 的 Blob URL 交给浏览器 —— MIME 由前端
 * 自己给，与反向代理怎么配无关。这些产物都是自包含的单文件 bundle（无相对 import、
 * 无 import.meta.url），换成 blob: 不影响它们的解析。
 */
export async function blobModuleUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`取不到 ${url}（HTTP ${res.status}）`)
  const source = await res.text()
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
}
