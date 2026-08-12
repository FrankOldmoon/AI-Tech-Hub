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
      // 统一用轮询判断就绪（兼容 4.x wasm 的 onRuntimeInitialized 与 3.x ASM.js 即时可用），
      // 且 interval 回调是独立宏任务，resolve 后 await 续体必然能执行。
      const poll = setInterval(() => {
        if (w.cv?.Mat) {
          clearInterval(poll)
          resolve(w.cv)
        }
      }, 100)
      setTimeout(() => {
        clearInterval(poll)
        reject(new Error('OpenCV.js init timeout'))
      }, 60000)
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
