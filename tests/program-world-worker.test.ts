/**
 * Program World 的 worker ↔ tracer 之间的**名字契约**。
 *
 * pyworker.js 用 `py.globals.set('__pw_stdin__', ...)` 把输入交进去，PY_TRACE（config.js）
 * 再把它读出来铺成 sys.stdin —— 两边分处两个文件、两种语言，靠的是同一个全局名；
 * 交互式终端的 `__pw_interactive__` 同理。名字写错不会报错，只会静默失效，所以钉住。
 *
 * 这里**不再**检查「pyworker.js 不得出现 import」：那条属于打包契约（它被原样拷贝成
 * 静态资源），已挪到构建期 —— scripts/check-program-world-worker.mjs，由 pnpm build
 * 在打包前后各跑一次，检查的还包括 .output 里真正要发布的那份拷贝。
 *
 * 另外钉一条回归护栏：worker 里没有 prompt，谁都不许去碰它
 * （碰了只会得到 "ReferenceError: prompt is not defined"）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const WORKER = fileURLToPath(new URL('../app/program-world/pyworker.js', import.meta.url))
const TRACER = fileURLToPath(new URL('../app/program-world/config.js', import.meta.url))

const workerSrc = readFileSync(WORKER, 'utf8')
const tracerSrc = readFileSync(TRACER, 'utf8')

describe('program-world worker ↔ tracer', () => {
  it('输入靠共用的全局名，两边必须一致', () => {
    for (const name of ['__pw_stdin__', '__pw_interactive__']) {
      expect(workerSrc, `${name} 在 pyworker.js 里`).toContain(name)
      expect(tracerSrc, `${name} 在 config.js 里`).toContain(name)
    }
    /* PY_TRACE 把整段输入铺成 sys.stdin，并由自己的 input() 读它 */
    expect(tracerSrc).toContain('sys.stdin')
  })

  it('谁都不碰 worker 里不存在的 prompt', () => {
    expect(workerSrc).not.toMatch(/\bprompt\s*\(/)
    expect(tracerSrc).not.toMatch(/\bprompt\s*\(/)
  })
})
