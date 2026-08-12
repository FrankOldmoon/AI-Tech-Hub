/**
 * Tesseract.js 懒加载（CDN，与 highlight.js 同策略）。
 * 首次使用 OCR 时动态加载，之后复用；语言数据由 Tesseract 内部按需下载。
 */

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
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
    script.async = true
    script.onload = () => {
      if (w.Tesseract) resolve(w.Tesseract)
      else reject(new Error('Tesseract.js loaded but global is undefined'))
    }
    script.onerror = () => {
      tesseractPromise = null
      reject(new Error('Failed to load tesseract.js from CDN (network required)'))
    }
    document.head.appendChild(script)
  })
  return tesseractPromise
}
