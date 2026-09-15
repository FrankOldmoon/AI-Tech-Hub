#!/usr/bin/env node
/**
 * i18n key 完整性校验（check-i18n）
 *
 * 职责：
 *  - 扫描 app/ server/ 下所有 .vue/.ts/.mjs/.js 中的字符串字面量 i18n 调用
 *    （t('a.b') / $t("a.b") 直接字符串 key）
 *  - 校验每个被引用的 key 在 en.json 与 zh.json 中均存在（嵌套路径用点拼接）
 *  - 缺失即 exit 1，供 CI 拦截
 *
 * 已知限制：
 *  - 动态 key（t(someVar)、t(`demo.${x}`)）无法静态判定，跳过并计数提示
 *  - 注释/文档中的调用会一并计入（若引用到不存在的 key 同样报错，可借此发现注释过期）
 *
 * 用法：node scripts/check-i18n.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = process.cwd()
const SRC_DIRS = ['app', 'server']
const EXTS = new Set(['.vue', '.ts', '.mjs', '.js'])
const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', 'dist', '.git', 'vendor'])

/** 递归收集源码文件 */
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      walk(p, acc)
    } else if (EXTS.has(extname(p))) {
      acc.push(p)
    }
  }
  return acc
}

/** 将嵌套 JSON 扁平化为点路径 Set */
function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out.add(key)
  }
  return out
}

const en = flatten(JSON.parse(readFileSync(join(ROOT, 'i18n/locales/en.json'), 'utf8')))
const zh = flatten(JSON.parse(readFileSync(join(ROOT, 'i18n/locales/zh.json'), 'utf8')))

// 字符串字面量 key：t('...') / $t("...")，前一个字符不能是 [\w.$]（避免 ctx.text( 等误匹配）
const RE = /(?<![\w$.])(?:\$?t)\(\s*['"]([^'"]+)['"]/g

const problems = []
let refCount = 0
const referenced = new Set()

for (const file of SRC_DIRS.flatMap(d => (statSync(join(ROOT, d), { throwIfNoEntry: false }) ? walk(join(ROOT, d)) : []))) {
  const code = readFileSync(file, 'utf8')
  let m
  while ((m = RE.exec(code)) !== null) {
    const key = m[1]
    if (!key || key.includes('${') || key.includes('?') || key.includes(':')) continue
    refCount++
    referenced.add(key)
    if (!en.has(key)) problems.push(`${file.replace(ROOT + '/', '')}: key 在 en.json 中缺失: ${key}`)
    if (!zh.has(key)) problems.push(`${file.replace(ROOT + '/', '')}: key 在 zh.json 中缺失: ${key}`)
  }
}

console.log(`✔ 扫描 ${refCount} 处字符串字面量 i18n 引用（${referenced.size} 个独立 key；动态 key 暂不校验）`)
if (problems.length) {
  console.error(`✘ 发现 ${problems.length} 个 i18n 问题：`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}
console.log('✔ OK：所有引用的 i18n key 在 en.json 与 zh.json 中均存在')
process.exit(0)
