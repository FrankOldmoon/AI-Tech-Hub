/**
 * 模型供给状态（运维自检接口）。
 *
 * 用途：自托管/内网部署时确认「本地模型是否齐备」，以及缺失项是否会回退到远程。
 * 背景：模型由 server/plugins/download-models.ts 在服务器启动时预下载；若下载失败
 * （例如校园网被墙），浏览器请求 /model/* 会走 302 回退远程，或直接 404。
 * 这个接口把这件事从「不可见」变成「可查」。
 *
 * 只暴露分组统计与公开的模型文件名，不返回绝对路径。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MODELS_DIR = process.env.MODELS_DIR || join(process.cwd(), '.models')

/** 需要统计的分组（与 .models/ 下的目录一一对应） */
const GROUPS = ['mediapipe', 'tfjs', 'faceapi', 'yolo', 'transformers', 'webllm', 'doodle', 'vendor']

/** 关键文件：缺了会直接影响对应能力页 */
function criticalFiles(): { group: string, rel: string, label: string }[] {
  const fromMediapipe = Object.values(MEDIAPIPE_MODELS).map(rel => ({
    group: 'mediapipe',
    rel,
    label: rel.split('/').pop() ?? rel
  }))
  return [
    ...fromMediapipe,
    { group: 'doodle', rel: 'doodle/model.json', label: 'DoodleNet model.json' },
    { group: 'vendor', rel: 'vendor/ml5/ml5.min.js', label: 'ml5.min.js（简笔画）' },
    { group: 'vendor', rel: 'vendor/tesseract/worker.min.js', label: 'tesseract worker' },
    { group: 'vendor', rel: 'vendor/tesseract/lang/chi_sim.traineddata.gz', label: 'chi_sim 语言数据' },
    { group: 'vendor', rel: 'vendor/pyodide/pyodide.asm.wasm', label: 'pyodide wasm' },
    { group: 'vendor', rel: 'vendor/monaco/min/vs/loader.js', label: 'monaco loader' }
  ]
}

function dirStats(dir: string): { files: number, bytes: number } {
  let files = 0
  let bytes = 0
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        files++
        try {
          bytes += statSync(full).size
        } catch {
          /* 忽略构建期间瞬时消失的文件 */
        }
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return { files, bytes }
}

export default defineEventHandler(() => {
  const groupRows = GROUPS.map((key) => {
    const { files, bytes } = dirStats(join(MODELS_DIR, key))
    return { key, present: files > 0, files, mb: Math.round(bytes / 1048576) }
  })

  const missing = criticalFiles()
    .filter(item => !existsSync(join(MODELS_DIR, item.rel)))
    .map(item => ({
      ...item,
      // 缺失时浏览器会由 /model/* 302 到远程；没有远程对应则为硬 404
      fallback: remoteUrlFor(item.rel) ? 'remote' as const : 'none' as const
    }))

  const totalMb = Math.round(dirStats(MODELS_DIR).bytes / 1048576)

  return {
    modelsDir: MODELS_DIR.replace(process.cwd(), '.'),
    totalMb,
    groups: groupRows,
    missing,
    ready: missing.length === 0
  }
})
