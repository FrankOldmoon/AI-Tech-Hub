/**
 * 生产产物模型瘦身脚本（P1-4 部署瘦身 → 模型迁移改造后的防御性清理）
 *
 * 背景：
 * - 模型已从 public/model/ 迁移至项目根 .models/（见 server/routes/model/[...].ts），
 *   由 model API 路由以 HTTP Range(206) 提供；生产构建不再把模型复制进 .output/public
 * - 本脚本改为防御性清理：若构建产物中仍残留 .output/public/model（旧产物 / 意外复制），
 *   直接整体删除，保证产物不含模型
 * - .models/ 本身不进构建产物，无需裁剪；SKIP_TRIM_MODELS=1 可跳过防御清理
 *
 * 用法：nuxt build && node scripts/trim-production-assets.mjs（已接入 package.json build）
 */

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

// 模型已迁移至 .models/，构建产物中不应存在任何模型目录
const STALE_DIRS = [join(root, '.output', 'public', 'model')]

if (process.env.SKIP_TRIM_MODELS === '1') {
  console.log('[trim] SKIP_TRIM_MODELS=1，跳过防御性清理')
} else {
  let cleaned = 0
  for (const dir of STALE_DIRS) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
      cleaned++
      console.log(`[trim] 已删除残留模型目录: ${dir}（模型已迁移至 .models/，不应在产物中）`)
    }
  }
  if (!cleaned) console.log('[trim] 产物中无模型残留，无需清理')
}
