#!/usr/bin/env node
/**
 * 把 npm 运行时库产物同步到 .models/vendor/，由 /model/vendor/* 本地提供。
 *
 * 背景：以下库原先在浏览器端从公网 CDN 动态加载 script，换成 npm 依赖后
 * 仍需一个「本地、可静态服务、支持 Range」的落点（与大模型一致），故复用
 * .models/ 目录 + /model/* 路由：
 *   - tesseract.js   → /model/vendor/tesseract/          （脚本 + worker + core + 语言数据）
 *   - ml5            → /model/vendor/ml5/                 （仅 min 主包，不搬 25MB sourcemap）
 *   - pyodide        → /model/vendor/pyodide/             （脚本 + wasm + stdlib + lock）
 *   - monaco-editor  → /model/vendor/monaco/min/          （AMD 加载器 + workers）
 *   - ffmpeg.wasm    → /model/vendor/ffmpeg/              （UMD 主包 + worker 分块 + 单线程 core 与 wasm）
 *
 * 只复制必需的运行时文件，不整目录搬运（ml5 dist 74MB、tesseract.js-core 29MB）。
 * 幂等：已存在的产物默认跳过（--force 强制重来）；traineddata 缺失时联网下载。
 *
 * 用法：node scripts/sync-runtime-libs.mjs [--force]
 */
import { createRequire } from 'node:module'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, '.models', 'vendor')
const FORCE = process.argv.includes('--force')
const require = createRequire(join(ROOT, 'package.json'))

/** 解析包目录（支持 pnpm 布局：传递依赖需从「宿主包」目录解析） */
function pkgDir(name, fromDir) {
  const req = fromDir ? createRequire(join(fromDir, 'package.json')) : require
  try {
    return dirname(req.resolve(`${name}/package.json`))
  } catch {
    // 部分包（@ffmpeg/*）的 exports 只声明了 "."，子路径 ./package.json 不可解析，
    // 于是退化为：先解析包入口，再逐级向上找 name 匹配的 package.json。
    let dir = dirname(req.resolve(name))
    while (true) {
      const pj = join(dir, 'package.json')
      if (existsSync(pj)) {
        try {
          if (JSON.parse(readFileSync(pj, 'utf8')).name === name) return dir
        } catch {
          // 读不了/不是合法 JSON，继续向上
        }
      }
      const parent = dirname(dir)
      if (parent === dir) throw new Error(`无法定位包目录：${name}`)
      dir = parent
    }
  }
}

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(1)}MB`
}

let copied = 0
let skipped = 0

function put(from, to, { force = FORCE } = {}) {
  if (!existsSync(from)) {
    console.warn(`  ! 源不存在，跳过：${from}`)
    return
  }
  if (existsSync(to) && !force) {
    skipped++
    return
  }
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  copied++
  console.log(`  + ${to.replace(`${ROOT}/`, '')}  ${mb(statSync(to).size)}`)
}

function rel(p) {
  return p.replace(`${ROOT}/`, '')
}

// ===== 1. 复制 npm 产物 =====
console.log('[sync-runtime-libs] npm 产物 → .models/vendor/')

const tessDir = pkgDir('tesseract.js')
const coreDir = pkgDir('tesseract.js-core', tessDir)

put(join(tessDir, 'dist/tesseract.min.js'), join(OUT, 'tesseract/tesseract.min.js'))
put(join(tessDir, 'dist/worker.min.js'), join(OUT, 'tesseract/worker.min.js'))

// core 有 simd/non-simd、lstm/non-lstm 多个变体，Tesseract 按浏览器能力自选，全部复制
for (const f of readdirSync(coreDir)) {
  if (!/^tesseract-core.*\.(js|wasm)$/.test(f)) continue
  put(join(coreDir, f), join(OUT, 'tesseract/core', f))
}

put(join(pkgDir('ml5'), 'dist/ml5.min.js'), join(OUT, 'ml5/ml5.min.js'))

// ffmpeg.wasm：UMD 主包 + 它的 worker 分块（文件名带 hash，故按 .js 过滤）+ 单线程 esm core。
// 只搬单线程 core（dist/esm）：多线程版（@ffmpeg/core-mt）依赖 SharedArrayBuffer，而本项目
// COOP/COEP 默认关闭。ffmpeg-core.wasm 是 32MB，是这个目录的体积大头。
// 不搬 @ffmpeg/util：它是 fetchFile/toBlobURL 这类可选辅助，本项目已改成同源直取，用不上。
// ffmpeg.js 是 webpack 入口，靠 document.currentScript.src 推断 publicPath，因此会去
// 同目录下找 814.ffmpeg.js —— 两者必须放在一起。
const ffmpegUmd = join(pkgDir('@ffmpeg/ffmpeg'), 'dist/umd')
for (const f of readdirSync(ffmpegUmd)) {
  if (!f.endsWith('.js')) continue
  put(join(ffmpegUmd, f), join(OUT, 'ffmpeg', f))
}

const ffmpegCore = join(pkgDir('@ffmpeg/core'), 'dist/esm')
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  put(join(ffmpegCore, f), join(OUT, 'ffmpeg', f))
}

const pyDir = pkgDir('pyodide')
for (const f of ['pyodide.js', 'pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  put(join(pyDir, f), join(OUT, 'pyodide', f))
}

// monaco 是 AMD 目录结构（loader.js + vs/ + workers），必须整目录拷贝
const monacoMin = join(pkgDir('monaco-editor'), 'min')
const monacoOut = join(OUT, 'monaco/min')
if (existsSync(monacoMin)) {
  if (!existsSync(monacoOut) || FORCE) {
    rmSync(monacoOut, { recursive: true, force: true })
    mkdirSync(dirname(monacoOut), { recursive: true })
    // 不搬 *.map（体积大头），loader 不需要
    cpSync(monacoMin, monacoOut, {
      recursive: true,
      filter: src => !src.endsWith('.map')
    })
    copied++
    console.log(`  + ${rel(monacoOut)}/  (已排除 .map)`)
  } else {
    skipped++
  }
} else {
  console.warn('  ! 未找到 monaco-editor/min，跳过')
}

// ===== 2. Tesseract 语言数据（chi_sim 约 20MB，缺失才下载）=====
const LANGS = ['eng', 'chi_sim']
const TESSDATA = 'https://tessdata.projectnaptha.com/4.0.0'
const langOut = join(OUT, 'tesseract/lang')

async function fetchLang(lang) {
  const target = join(langOut, `${lang}.traineddata.gz`)
  if (existsSync(target) && !FORCE) {
    skipped++
    console.log(`  = 语言数据已存在：${rel(target)}`)
    return
  }
  mkdirSync(langOut, { recursive: true })
  const url = `${TESSDATA}/${lang}.traineddata.gz`
  process.stdout.write(`  下载 ${lang}.traineddata.gz ... `)
  const res = await fetch(url)
  if (!res.ok) {
    console.log(`失败 (HTTP ${res.status})`)
    return
  }
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(target, buf)
  copied++
  console.log(`${mb(buf.length)} → ${rel(target)}`)
}

for (const lang of LANGS) {
  await fetchLang(lang)
}

console.log(`[sync-runtime-libs] 完成：复制 ${copied} 项，跳过 ${skipped} 项（已是最新）`)
