#!/usr/bin/env node
/**
 * 手动预取语音模块所需的 transformers.js 模型到 .models/transformers/
 *
 * 用法：
 *   pnpm models:fetch                # 下载全部（约 3 GB）
 *   pnpm models:fetch whisper-tiny   # 只下指定项（可用别名，见 --list）
 *   pnpm models:fetch ser chatterbox
 *   pnpm models:fetch --list         # 只列出清单与体积，不下载
 *
 * 已存在的文件会跳过（大小一致才算命中），中断后可直接重跑续传。
 * 源：ModelScope → hf-mirror.com → huggingface.co（自动回退）
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SPEECH_REPOS, fetchModelRepo, resolveRepoFiles } from '../server/utils/model-fetch.mjs'

const BASE = process.env.MODELS_DIR || join(process.cwd(), '.models')
const TRANSFORMERS_DIR = join(BASE, 'transformers')

const argv = process.argv.slice(2)
const listOnly = argv.includes('--list')
const wanted = argv.filter(a => !a.startsWith('--'))

function dirSizeMb(dir) {
  if (!existsSync(dir)) return 0
  let total = 0
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else total += statSync(full).size
    }
  }
  walk(dir)
  return total / 1048576
}

function pick() {
  if (!wanted.length) return SPEECH_REPOS
  const picked = []
  for (const key of wanted) {
    const hit = SPEECH_REPOS.find(r => r.alias === key || r.id === key || r.alias.includes(key))
    if (!hit) {
      console.error(`未知项：${key}（可选：${SPEECH_REPOS.map(r => r.alias).join(', ')}）`)
      process.exit(1)
    }
    if (!picked.includes(hit)) picked.push(hit)
  }
  return picked
}

const targets = pick()

if (listOnly) {
  console.log('语音模块模型清单：\n')
  for (const r of SPEECH_REPOS) {
    const dest = join(TRANSFORMERS_DIR, r.id)
    const have = dirSizeMb(dest)
    let need = '?'
    const resolved = await resolveRepoFiles(r.id)
    if (resolved) {
      const files = resolved.files.filter(f => r.keep(f.path))
      need = (files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1) + ' MB'
    }
    console.log(`  ${r.alias.padEnd(14)} 本地 ${have.toFixed(1).padStart(8)} MB / 全量约 ${need.padStart(10)}  ${r.label}`)
  }
  console.log('\n用法：pnpm models:fetch [别名...]   例：pnpm models:fetch whisper-tiny')
  process.exit(0)
}

console.log(`模型目标目录：${TRANSFORMERS_DIR}\n`)
const t0 = Date.now()
let totalFail = 0

for (const repo of targets) {
  console.log(`=== ${repo.label} ===`)
  const dest = join(TRANSFORMERS_DIR, repo.id)
  mkdirSync(dest, { recursive: true })
  const r = await fetchModelRepo(repo.id, dest, { keep: repo.keep })
  totalFail += r.fail
  console.log('')
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`完成，耗时 ${elapsed}s，.models 总大小 ${dirSizeMb(BASE).toFixed(1)} MB`)
if (totalFail > 0) {
  console.log(`⚠️ 有 ${totalFail} 个文件下载失败，重新执行本命令可续传。`)
  process.exitCode = 1
} else {
  console.log('✔ 全部模型就绪，刷新页面即可离线使用。')
}
