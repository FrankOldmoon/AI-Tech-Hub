import { describe, expect, it } from 'vitest'
import {
  isWebllmIndexJs,
  neutralizeImportMetaUrl
} from '../build/webllm-neutralize'

// 复刻 @mlc-ai/web-llm@0.2.84 lib/index.js 中触发 Vite bug 的那行 JSDoc 注释
const SAMPLE = `/**
 *   new URL('./worker.ts', import.meta.url),
 *   {type: 'module'}
 * ));
 */
class WebWorkerMLCEngine {}
`

describe('isWebllmIndexJs', () => {
  it('匹配 Linux/Vercel 的 POSIX 路径', () => {
    expect(
      isWebllmIndexJs(
        '/vercel/path0/node_modules/.pnpm/@mlc-ai+web-llm@0.2.84/node_modules/@mlc-ai/web-llm/lib/index.js'
      )
    ).toBe(true)
  })

  it('匹配 Windows 反斜杠路径', () => {
    expect(
      isWebllmIndexJs(
        'D:\\YIN-PROJE\\nuxt_AI\\node_modules\\.pnpm\\@mlc-ai+web-llm@0.2.84\\node_modules\\@mlc-ai\\web-llm\\lib\\index.js'
      )
    ).toBe(true)
  })

  it('不匹配其他文件', () => {
    expect(isWebllmIndexJs('node_modules/@mlc-ai/web-llm/lib/index.d.ts')).toBe(false)
    expect(isWebllmIndexJs('node_modules/other/lib/index.js')).toBe(false)
  })
})

describe('neutralizeImportMetaUrl', () => {
  it('中和注释里的 new URL(..., import.meta.url)，对运行时语义无影响', () => {
    const out = neutralizeImportMetaUrl(SAMPLE)
    expect(out).not.toContain('import.meta.url')
    expect(out).toContain('new URL(\'./worker.ts\', document.baseURI),')
  })

  it('Vite 的 assetImportMetaUrlRE code filter 不再命中', () => {
    const out = neutralizeImportMetaUrl(SAMPLE)
    // 与 Vite src/node/plugins/assetImportMetaUrl.ts 中 assetImportMetaUrlRE 等价
    const viteRe
      = /\bnew\s+URL\s*\(\s*('[^']+'|"[^"]+"|`[^`]+`)\s*,\s*import\.meta\.url\s*(?:,\s*)?\)/
    expect(viteRe.test(out)).toBe(false)
  })

  it('无命中时原样返回', () => {
    const code = 'const a = 1\nnew URL("x", location.href)\n'
    expect(neutralizeImportMetaUrl(code)).toBe(code)
  })
})
