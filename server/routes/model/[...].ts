/**
 * 本地模型静态服务路由（模型迁移改造）
 *
 * 模型文件从 public/model/ 移至 .models/ 目录后，本路由接管 /model/* 请求，
 * 前端代码中所有 /model/... 静态引用（mediapipe.ts、face-studio.ts、useYolo.ts
 * 等）无需改动即可继续工作：
 *
 * - 支持 HTTP Range(206)：onnxruntime-web / transformers.js / mediapipe / webllm
 *   等浏览器端推理库按段下载大文件，必须返回 206 Partial Content
 * - 正确设置 Content-Type / Cache-Control / Accept-Ranges
 * - 安全防护：拒绝路径穿越（..），仅暴露模型目录内文件
 * - 文件不存在返回 404；模型目录不存在时同样 404
 *
 * 注意：未用 storage/ 命名模型目录，因为全局 gitignore（~/.gitignore_global）
 * 有 storage 规则，会使 yolo 模型的入库例外失效（git 无法反转父目录被全局
 * 排除的情况）；.models/ 与 /model/* URL 解耦，磁盘名无感知。
 *
 * 模型目录默认 <cwd>/.models，可用 MODELS_DIR 环境变量覆盖
 * （与 server/utils/model-downloader.ts 的写入路径保持一致）。
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import {
  createError,
  getRequestHeaders,
  getRouterParam,
  sendStream,
  setResponseHeader,
  setResponseStatus
} from 'h3'

const MODELS_DIR = process.env.MODELS_DIR || join(process.cwd(), '.models')

// 常见文件扩展名 -> MIME（与 server/api/hf/[...].get.ts 保持一致）
const MIME: Record<string, string> = {
  onnx: 'application/octet-stream',
  bin: 'application/octet-stream',
  safetensors: 'application/octet-stream',
  ot: 'application/octet-stream',
  json: 'application/json',
  txt: 'text/plain',
  wasm: 'application/wasm'
}

export default defineEventHandler((event) => {
  const rel = getRouterParam(event, '_') ?? ''

  // 路径穿越防护：normalize 后必须仍位于模型目录内
  const filePath = normalize(join(MODELS_DIR, rel))
  if (filePath !== MODELS_DIR && !filePath.startsWith(MODELS_DIR + sep)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid model path: ${rel}` })
  }

  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, statusMessage: `Model not found: ${rel || '(empty)'}` })
  }
  const stat = statSync(filePath)
  if (!stat.isFile()) {
    throw createError({ statusCode: 404, statusMessage: `Not a file: ${rel}` })
  }

  const ext = rel.split('.').pop()?.toLowerCase() ?? ''
  setResponseHeader(event, 'Content-Type', MIME[ext] || 'application/octet-stream')
  setResponseHeader(event, 'Accept-Ranges', 'bytes')
  // 模型文件为大文件且少变，长缓存；路径含版本/commit 时天然失效
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')

  const total = stat.size
  const range = getRequestHeaders(event).range

  // 单段 Range：bytes=start-end / bytes=start- / bytes=-suffix
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (m && (m[1] !== '' || m[2] !== '')) {
      const startPart = m[1] ?? ''
      const endPart = m[2] ?? ''
      let start: number
      let end: number
      if (startPart === '') {
        // suffix 形式：最后 N 字节
        const suffix = Number.parseInt(endPart, 10)
        start = Math.max(total - suffix, 0)
        end = total - 1
      } else {
        start = Number.parseInt(startPart, 10)
        end = endPart === '' ? total - 1 : Math.min(Number.parseInt(endPart, 10), total - 1)
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start >= total || start > end) {
        setResponseStatus(event, 416)
        setResponseHeader(event, 'Content-Range', `bytes */${total}`)
        return null
      }
      setResponseStatus(event, 206)
      setResponseHeader(event, 'Content-Range', `bytes ${start}-${end}/${total}`)
      setResponseHeader(event, 'Content-Length', end - start + 1)
      return sendStream(event, createReadStream(filePath, { start, end }))
    }
  }

  // 完整响应（200）
  setResponseStatus(event, 200)
  setResponseHeader(event, 'Content-Length', total)
  return sendStream(event, createReadStream(filePath))
})
