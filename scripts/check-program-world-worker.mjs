/**
 * 构建期契约：pyworker.js 是**被原样拷贝的静态资源**，不是被打包的模块。
 *
 * python.js 用 `new URL('./pyworker.js', import.meta.url)` 引用它，Vite 不会把它当
 * Rollup 入口，而是原样拷贝成 .output/public/_nuxt/pyworker.<hash>.js —— 连源码里的
 * 注释都还在，依赖一个都不会内联。所以它一旦出现相对 import，生产环境就会去请求一个
 * 根本不存在的文件而 404；dev 因为按需转译，反而完全看不出来（这个坑踩过）。
 *
 * 这条约束以前只写在 tests/program-world-worker.test.ts 里。挪到构建期有两个好处：
 *   ① 打包/部署的人不必记得先跑测试；
 *   ② 能检查**真正要发布的那份拷贝**（.output 里的产物），而不只是源文件。
 *
 * 用法：
 *   node scripts/check-program-world-worker.mjs              # 只查源文件
 *   node scripts/check-program-world-worker.mjs --artifacts  # 再查 .output 里已发射的拷贝
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = '[program-world]'
const root = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = join(root, 'app', 'program-world', 'pyworker.js')
const ARTIFACT_DIR = join(root, '.output', 'public', '_nuxt')

const wantArtifacts = process.argv.includes('--artifacts')

/** 去掉注释：注释里也会出现 import 字样，不能误报 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 模块语法：静态 import / export 语句（它们会变成对别的文件的请求） */
function moduleStatements(src) {
  return stripComments(src).match(/^\s*(import|export)\s/gm) ?? []
}

const failures = []

function check(label, file) {
  let src
  try {
    src = readFileSync(file, 'utf8')
  } catch (e) {
    failures.push(`${label} 读不到：${file}（${e.message}）`)
    return
  }
  const hits = moduleStatements(src)
  if (hits.length) {
    failures.push(`${label} 里出现了 ${hits.length} 处 import/export 语句：${file}\n`
      + '  pyworker.js 被原样拷贝成静态资源，相对 import 在生产会 404。\n'
      + '  需要新的依赖时，请把那段逻辑内联进本文件（或改用 postMessage 让主线程去做）。')
  } else {
    console.log(`${TAG} ok  ${label} 无 import/export`)
  }
}

/* ------------------------------- 源文件 -------------------------------- */
check('pyworker.js（源）', SOURCE)

/* ------------------------------- 产物 ---------------------------------- */
if (wantArtifacts) {
  if (!existsSync(ARTIFACT_DIR)) {
    failures.push(`找不到构建产物目录：${ARTIFACT_DIR}\n  先跑 nuxt build，再执行 --artifacts。`)
  } else {
    const emitted = readdirSync(ARTIFACT_DIR)
      .filter(n => /^pyworker\..*\.js$/.test(n))
      .map(n => join(ARTIFACT_DIR, n))
      .filter(p => statSync(p).isFile())
    if (!emitted.length) {
      failures.push(`${ARTIFACT_DIR} 里没有 pyworker.<hash>.js —— worker 没被发射出去，`
        + '引用它的 URL 在生产会 404。')
    }
    for (const file of emitted) check(`pyworker.js（产物 ${file.slice(root.length)}）`, file)
  }
}

/* ------------------------------- 结论 ---------------------------------- */
if (failures.length) {
  console.error(`\n${TAG} ✖ 检查未通过：`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log(`${TAG} ✔ 全部通过`)
