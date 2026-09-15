/**
 * Vercel 专用构建脚本
 *
 * 背景：
 * - 本地模型位于 .models/（已从 public/model/ 迁移，模型迁移改造），Vercel 无持久存储，
 *   本地模型文件不进部署；构建前整体删除，避免污染构建环境
 * - Vercel 无 Python/ffmpeg 运行时，音频分离功能云端不可用（前端会提示）
 * - 其余功能（MediaPipe / Transformers.js / WebLLM / TTS）正常：
 *   模型通过 /api/hf 代理从 HuggingFace 实时拉取（部署时设 HF_MIRROR_URL=https://huggingface.co）
 *
 * 用法：vercel.json buildCommand 指向本脚本
 */

import { rmSync } from 'node:fs'
import { execSync } from 'node:child_process'

// 1. 删除本地模型与运行时生成物（不部署）
console.log('[vercel-build] removing .models, public/generated, tmp ...')
for (const p of ['.models', 'public/generated', 'tmp']) {
  try {
    rmSync(p, { recursive: true, force: true })
  } catch { /* ignore */ }
}

// 2. 正常构建（Nuxt 会自动适配 Vercel preset）
console.log('[vercel-build] running pnpm build ...')
execSync('pnpm build', { stdio: 'inherit' })
