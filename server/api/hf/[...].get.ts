/**
 * HuggingFace 模型代理 - 转发到 hf-mirror.com
 *
 * transformers.js 的 env.remoteHost 指向 /api/hf（见 app/utils/transformers.ts），
 * 本地 public/model/transformers/ 缺少文件时回退到这里下载，绕过 CORS。
 *
 * 请求格式：/api/hf/{model}/resolve/{revision}/{file...}
 * 转发到： https://hf-mirror.com/{model}/resolve/{revision}/{file...}
 */

import { Readable } from 'node:stream'
import { createError, getRouterParam, sendStream, setResponseHeader } from 'h3'

// 上游可配置：本地/大陆网络默认 hf-mirror.com；海外部署（Vercel）设 HF_MIRROR_URL=https://huggingface.co
const MIRROR = process.env.HF_MIRROR_URL || 'https://hf-mirror.com'

// 常见文件扩展名 -> MIME
const MIME: Record<string, string> = {
  onnx: 'application/octet-stream',
  bin: 'application/octet-stream',
  safetensors: 'application/octet-stream',
  ot: 'application/octet-stream',
  json: 'application/json',
  txt: 'text/plain',
  wasm: 'application/wasm',
}

export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, '_') ?? ''
  // 只允许模型仓库路径：{owner}/{repo}/resolve/{revision}/{file...}
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/resolve\/[A-Za-z0-9_.-]+\/.*$/.test(path)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid model path: ${path}`,
    })
  }

  const upstream = `${MIRROR}/${path}`
  let resp: Response
  try {
    resp = await fetch(upstream, { redirect: 'follow' })
  } catch (e) {
    throw createError({
      statusCode: 502,
      statusMessage: `Failed to reach ${MIRROR}: ${(e as Error)?.message || e}`,
    })
  }

  if (!resp.ok || !resp.body) {
    throw createError({
      statusCode: resp.status || 502,
      statusMessage: `Upstream error: ${resp.statusText || resp.status}`,
    })
  }

  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  setResponseHeader(event, 'Content-Type', MIME[ext] || resp.headers.get('content-type') || 'application/octet-stream')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  return sendStream(event, Readable.fromWeb(resp.body as any))
})
