/**
 * OpenCV.js 懒加载与 Mat <-> ImageData 转换助手。
 *
 * opencv.js（~10MB，ASM.js）放在 public/opencv/opencv.js，首次使用时通过 <script>
 * 动态加载并缓存，之后所有工具共用同一个 cv 实例。
 * 官方构建不含非自由模块（SIFT 等），浏览器侧用 ORB / BRISK，SIFT 仅见 Python 参考。
 */

let cvPromise: Promise<any> | null = null

export function loadOpenCv(): Promise<any> {
  if (import.meta.server) {
    return Promise.reject(new Error('OpenCV.js is client-only'))
  }
  const w = window as any
  if (w.cv?.Mat) {
    // 防御：若 cv 由其他途径加载（then 未删除），先删除避免 Promise 把 Module 当 thenable 递归吸收
    if (typeof w.cv.then === 'function') delete w.cv.then
    return Promise.resolve(w.cv)
  }
  if (cvPromise) {
    return cvPromise
  }
  cvPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/opencv/opencv.js'
    script.async = true
    script.onload = () => {
      const cv = w.cv
      if (!cv) {
        reject(new Error('OpenCV.js loaded but cv is undefined'))
        return
      }
      // 关键：cv.Mat 挂上 ≠ wasm 完全初始化（embind 导出早于 calledRun/onRuntimeInitialized）。
      // 窗口期调用 new cv.Mat() 会让主线程死循环（用户「页面无响应」根因）。
      // Emscripten 的 Module.then(cb) 是官方就绪信号：calledRun 后立即回调，否则等 onRuntimeInitialized。
      const timeout = setTimeout(() => {
        reject(new Error('OpenCV.js init timeout (60s)'))
      }, 60000)

      if (typeof cv.then === 'function') {
        cv.then(() => {
          clearTimeout(timeout)
          // 关键修复：Module.then 是非标准 thenable（其语义是注册 onRuntimeInitialized 回调并返回 Module 自身），
          // 若直接 resolve(cv)，Promise 会把 cv 当 thenable 递归吸收（cv.then 又 resolve 回 cv → 无限递归 → 主线程死锁）。
          // 删除 cv.then 使其不再是 thenable，resolve 即可正常。
          delete cv.then
          resolve(cv)
        })
      } else {
        // 兜底：旧构建无 Module.then，退回轮询 cv.Mat
        const poll = setInterval(() => {
          if (w.cv?.Mat) {
            clearInterval(poll)
            clearTimeout(timeout)
            resolve(w.cv)
          }
        }, 100)
      }
    }
    script.onerror = () => {
      cvPromise = null
      reject(new Error('Failed to load /opencv/opencv.js'))
    }
    document.head.appendChild(script)
  })
  return cvPromise
}

/** ImageData (RGBA) -> cv.Mat (CV_8UC4，共享内存） */
export function imageDataToMat(cv: any, img: ImageData): any {
  const mat = new cv.Mat(img.height, img.width, cv.CV_8UC4)
  mat.data.set(img.data)
  return mat
}

/** cv.Mat -> ImageData（自动处理 1/3/4 通道） */
export function matToImageData(cv: any, mat: any): ImageData {
  const channels = mat.channels()
  let rgba = mat
  if (channels === 3) {
    rgba = new cv.Mat()
    cv.cvtColor(mat, rgba, cv.COLOR_BGR2RGBA)
  } else if (channels === 1) {
    rgba = new cv.Mat()
    cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA)
  }
  const out = new ImageData(rgba.cols, rgba.rows)
  out.data.set(rgba.data)
  if (rgba !== mat) rgba.delete()
  return out
}

/** 通用模式：ImageData -> Mat -> 处理 -> ImageData，自动释放中间 Mat */
export async function withCvMat<T>(
  imageData: ImageData,
  fn: (cv: any, bgr: any) => T | Promise<T>
): Promise<T> {
  const cv = await loadOpenCv()
  const rgba = imageDataToMat(cv, imageData)
  const bgr = new cv.Mat()
  cv.cvtColor(rgba, bgr, cv.COLOR_RGBA2BGR)
  try {
    return await fn(cv, bgr)
  } finally {
    rgba.delete()
    bgr.delete()
  }
}

/** 把结果 Mat 转成 ImageData（自动释放） */
export function matToResult(cv: any, mat: any): ImageData {
  const out = matToImageData(cv, mat)
  mat.delete()
  return out
}
