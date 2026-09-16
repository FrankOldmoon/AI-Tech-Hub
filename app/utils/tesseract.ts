/**
 * Tesseract.js 懒加载 + 本地资源路径。
 *
 * 库脚本、worker、core wasm、语言数据全部从本地 `/model/vendor/tesseract/` 加载
 * （由 scripts/sync-runtime-libs.mjs 从 package.json 的 npm 依赖同步而来），
 * 不再依赖公网 CDN。
 */

const TESSERACT_BASE = '/model/vendor/tesseract'

let tesseractPromise: Promise<any> | null = null

export function loadTesseract(): Promise<any> {
  if (import.meta.server) {
    return Promise.reject(new Error('Tesseract.js is client-only'))
  }
  const w = window as any
  if (w.Tesseract) return Promise.resolve(w.Tesseract)
  if (tesseractPromise) return tesseractPromise
  tesseractPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${TESSERACT_BASE}/tesseract.min.js`
    script.async = true
    script.onload = () => {
      if (w.Tesseract) resolve(w.Tesseract)
      else reject(new Error('Tesseract.js loaded but global is undefined'))
    }
    script.onerror = () => {
      tesseractPromise = null
      reject(new Error('Failed to load tesseract.js from /model/vendor — run `node scripts/sync-runtime-libs.mjs`'))
    }
    document.head.appendChild(script)
  })
  return tesseractPromise
}

/**
 * createWorker 的本地资源选项：
 * - workerPath：worker 主脚本
 * - corePath：core 目录（内含 simd/lstm 各变体，Tesseract 按浏览器能力自选）
 * - langPath：语言数据目录（eng.traineddata.gz / chi_sim.traineddata.gz）
 */
export function tesseractLocalOptions() {
  return {
    workerPath: `${TESSERACT_BASE}/worker.min.js`,
    corePath: `${TESSERACT_BASE}/core`,
    langPath: `${TESSERACT_BASE}/lang`
  }
}
