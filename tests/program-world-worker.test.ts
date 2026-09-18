/**
 * Program World 的 Python worker 是一个「静态资源式」worker。
 *
 * python.js 用 `new URL('./pyworker.js', import.meta.url)` 引用它，Vite 不把它当
 * Rollup 入口，而是**原样拷贝**成 _nuxt/pyworker.<hash>.js —— 产物里连注释都在，
 * 依赖一个都不会内联。所以 pyworker.js 里只要出现相对 import，生产环境就会去请求
 * 一个根本不存在的文件而 404；dev 因为按需转译，反而完全看不出来。
 *
 * 「别加 import」这种约定靠 code review 记不住（加一行 import 太自然了），钉成测试。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const WORKER = fileURLToPath(new URL('../app/program-world/pyworker.js', import.meta.url))
const SHARED = fileURLToPath(new URL('../app/program-world/stdin.js', import.meta.url))

const workerSrc = readFileSync(WORKER, 'utf8')
const sharedSrc = readFileSync(SHARED, 'utf8')

/** 去掉块注释与行注释：注释里也会出现 import 字样，不能误报 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 取出 `NAME = <十进制字面量>` 的值 */
function numericConst(src: string, name: string): number | null {
  const m = src.match(new RegExp(`\\b${name}\\s*=\\s*(\\d+)\\b`))
  return m ? Number(m[1]) : null
}

describe('program-world Python worker', () => {
  it('pyworker.js 不得出现任何 import —— 它被原样拷贝，相对导入在生产会 404', () => {
    expect(stripComments(workerSrc).match(/^\s*import\s/gm) ?? []).toEqual([])
  })

  it('worker 与主线程的共享内存协议常量成对一致', () => {
    for (const name of ['STDIN_STATE', 'STDIN_PROMPT_LEN', 'STDIN_ANSWER_LEN', 'STDIN_WAIT', 'STDIN_EOF']) {
      expect(numericConst(workerSrc, name), `${name} 在 pyworker.js 里`).toBe(numericConst(sharedSrc, name))
      expect(numericConst(sharedSrc, name), `${name} 在 stdin.js 里`).not.toBeNull()
    }
    /* 文本区布局：8KB 对半分，prompt 在前、答案在后，上限留 1 字节余量 */
    for (const expr of ['HALF = 4096', 'PROMPT_OFFSET = 0', 'ANSWER_OFFSET = HALF', 'TEXT_LIMIT = HALF - 1']) {
      expect(workerSrc, `pyworker.js 缺少 ${expr}`).toContain(expr)
      expect(sharedSrc, `stdin.js 缺少 ${expr}`).toContain(expr)
    }
  })
})
