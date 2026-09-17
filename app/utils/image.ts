/**
 * 图片预处理工具
 *
 * transformers.js 浏览器端用 createImageBitmap 解码图片，
 * 对 HEIC/TIFF/SVG 等格式或超大图会抛 "The source image could not be decoded."。
 * 这里先用 <img> + canvas 解码并统一转为标准 PNG（自动缩放超大图），
 * 返回可直接交给 pipeline 的 blob URL。
 */
export function processImageFile(file: File, maxSize = 2048): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      let { width, height } = img
      if (width <= 0 || height <= 0) {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('图片尺寸无效'))
        return
      }
      // 限制最大边，避免超大图导致 canvas / createImageBitmap 失败
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('无法创建画布'))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(objectUrl)

      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('图片处理失败'))
          return
        }
        resolve(URL.createObjectURL(blob))
      }, 'image/png')
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('图片无法解码，请使用 PNG / JPG / WebP 格式'))
    }

    img.src = objectUrl
  })
}

/**
 * 读入图片为 ImageData（最长边超出 maxSize 时等比缩小）。
 *
 * `source` 可以是 File / Blob（上传）或站内 URL（示例图）。
 * 走 <img> + canvas 解码（而不是 createImageBitmap），是为了兼容 HEIC/TIFF/SVG
 * 这类 createImageBitmap 会直接抛错、但浏览器能显示的情况。
 */
export function loadImageData(source: File | Blob | string, maxSize = 1600): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const creating = typeof source !== 'string'
    const objectUrl = creating ? URL.createObjectURL(source) : source
    const img = new Image()

    const cleanup = () => {
      if (creating) URL.revokeObjectURL(objectUrl)
    }

    img.onload = () => {
      let { width, height } = img
      if (width <= 0 || height <= 0) {
        cleanup()
        reject(new Error('图片尺寸无效'))
        return
      }
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height)
        width = Math.max(1, Math.round(width * ratio))
        height = Math.max(1, Math.round(height * ratio))
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        cleanup()
        reject(new Error('无法创建画布'))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      cleanup()
      try {
        resolve(ctx.getImageData(0, 0, width, height))
      } catch (e) {
        // 跨域图片会污染画布，getImageData 直接抛安全错误 —— 说清楚原因比抛原始错误好排查
        reject(new Error(`图片像素读取失败（跨域图片不允许读取像素）：${String(e)}`))
      }
    }

    img.onerror = () => {
      cleanup()
      reject(new Error('图片无法解码，请使用 PNG / JPG / WebP 格式'))
    }

    img.src = objectUrl
  })
}
