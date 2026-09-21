/**
 * HuggingFace 模型代理 —— 按源优先级转发（ModelScope → hf-mirror.com → huggingface.co）
 *
 * 两处用途：
 * 1. transformers.js 的 env.remoteHost 指向 /api/hf（见 app/utils/transformers.ts），
 *    本地 .models/transformers/ 缺文件时回退到这里下载，绕过 CORS；
 * 2. WebLLM 页在本地没有预置权重时也走这里（见 app/pages/aigc/webllm.vue）。
 *
 * 请求格式：/api/hf/{owner}/{repo}/resolve/{revision}/{file...}
 *
 * 候选源与预下载共用一份事实来源（server/utils/model-fetch.mjs 的 candidateUrls）：
 * 只认 hf-mirror.com 时，国内网络下它可能 308 跳转到被墙的 huggingface.co，整条链路失效，
 * 所以 ModelScope（国内直连）优先；海外节点（Vercel）反过来，优先 huggingface.co。
 * 另外 ModelScope 的文件 API 不带 CORS 头，浏览器不能直连 —— 这也是必须经本代理的原因。
 */

import { Readable } from 'node:stream'
import { createError, getRequestHeaders, getRouterParam, sendStream, setResponseHeader, setResponseStatus } from 'h3'
import { candidateUrls, sourceLabel } from '../../utils/model-fetch.mjs'

// 常见文件扩展名 -> MIME
const MIME: Record<string, string> = {
  onnx: 'application/octet-stream',
  bin: 'application/octet-stream',
  safetensors: 'application/octet-stream',
  ot: 'application/octet-stream',
  json: 'application/json',
  txt: 'text/plain',
  wasm: 'application/wasm'
}

export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, '_') ?? ''
  // 只允许模型仓库路径：{owner}/{repo}/resolve/{revision}/{file...}
  const m = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/resolve\/[A-Za-z0-9_.-]+\/(.+)$/.exec(path)
  if (!m) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid model path: ${path}`
    })
  }
  const modelId = m[1]!
  const file = m[2]!

  const urls = candidateUrls(modelId, file)
  // 海外节点：huggingface 直连更快（ModelScope 在境外反而慢）
  if (process.env.VERCEL) urls.reverse()

  // 转发 Range（ONNX Runtime Web / 大模型分段下载需要 206 响应）
  const headers: Record<string, string> = {}
  const range = getRequestHeaders(event).range
  if (range) headers['Range'] = range

  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const failures: string[] = []

  for (const upstream of urls) {
    let resp: Response
    try {
      resp = await fetch(upstream, { redirect: 'follow', headers })
    } catch (e) {
      failures.push(`${sourceLabel(upstream)}: ${(e as Error)?.message || e}`)
      continue
    }
    if (!resp.ok || !resp.body) {
      failures.push(`${sourceLabel(upstream)}: HTTP ${resp.status} ${resp.statusText || ''}`.trim())
      continue
    }

    setResponseStatus(event, resp.status)
    setResponseHeader(event, 'Content-Type', MIME[ext] || resp.headers.get('content-type') || 'application/octet-stream')
    setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
    const contentLength = resp.headers.get('content-length')
    if (contentLength) setResponseHeader(event, 'Content-Length', contentLength)
    const contentRange = resp.headers.get('content-range')
    if (contentRange) setResponseHeader(event, 'Content-Range', contentRange)
    setResponseHeader(event, 'Accept-Ranges', 'bytes')
    setResponseHeader(event, 'X-Model-Source', sourceLabel(upstream))
    return sendStream(event, Readable.fromWeb(resp.body as unknown as Parameters<typeof Readable.fromWeb>[0]))
  }

  throw createError({
    statusCode: 502,
    statusMessage: `All sources failed for ${modelId}/${file} — ${failures.join(' | ')}`
  })
})
