/**
 * 每个功能页底部的「延伸学习」内容注册表（路由路径 → 最简代码 + 原理说明）。
 *
 * 为什么按分类拆文件 + 动态 import：132 个 demo 的中英双语文案加起来约 300 KB 文本，
 * 全量静态聚合会把首页 bundle 顶上去。这里用 `import.meta.glob` 按**路由第一段**
 * 找对应分类模块（/robot/auto-drive → ./robot.ts），进哪个分类的页面才下载哪个文件。
 *
 * 新增一个分类：在同目录加 `<category>.ts`，`export const notes: NoteMap = {…}` 即可，
 * 无需改本文件（glob 自动收录）。路径 key 必须写成 `/<category>/<slug>`，
 * 与 demos.ts 的 `demoPath()` 一致 —— tests/demo-notes.test.ts 会双向校验。
 */
import type { LocalizedText } from '../localized'

export interface DemoNote {
  /**
   * 最简 Python 实现：能独立跑的最小版本，注释用英文（避免繁简混排），
   * 讲清楚「这一段对应页面里的哪个动作」。
   */
  python: string
  /**
   * **能直接在浏览器里跑起来的完整 HTML**（含 <style> / <script>，零外部依赖）。
   *
   * 学习区在这段代码右上角给一个「运行」按钮，点了就在沙箱 iframe 里执行 —
   * 所以它必须自包含：图片用 canvas 画、不引 CDN、不读本地文件。
   * 模型类页面不加载真模型，而是用**真实后处理逻辑 + 合成输入**演示原理
   * （例如 YOLO 页用固定的 300 行输出演示 letterbox 还原与阈值过滤）。
   */
  html?: string
  /**
   * 纯 JS 片段（旧字段，robot 分类仍在用）。
   * 只有它、没有 html 时，学习区不给「运行」按钮 —— 片段本身跑不起来。
   */
  javascript?: string
  /**
   * 原理说明（Markdown）。zh 必填，en 必填；繁体由 zh-hk.ts 的 toHK 逐字转换，
   * 需要整词订正时再加可选 zhHK 字段。
   */
  principle: LocalizedText
}

export type NoteMap = Record<string, DemoNote>

/** glob 出的分类模块（`./robot.ts` → notes）；负模式排除本文件，否则会循环 import */
const modules = import.meta.glob<{ notes: NoteMap }>(['./*.ts', '!./index.ts'])

/** 路由路径规范化：去 query、去尾部斜杠，保证 `/robot/drone/` 也能命中 */
export function normalizeNotePath(path: string): string {
  const bare = (path || '').split(/[?#]/)[0] ?? ''
  return bare.replace(/\/+$/, '') || '/'
}

/**
 * 按路由取内容。没登记过的页面返回 undefined（组件据此整段不渲染）。
 * 只在分类文件里查一次，不命中就不会发起任何网络请求。
 */
export async function loadDemoNote(path: string): Promise<DemoNote | undefined> {
  const key = normalizeNotePath(path)
  const category = key.split('/')[1]
  if (!category) return undefined
  const loader = modules[`./${category}.ts`]
  if (!loader) return undefined
  try {
    const mod = await loader()
    return mod.notes[key]
  } catch (err) {
    // 加载失败时学习区会整段消失，页面上看不出任何异常（不报错、不占位）。
    // 这种情况几乎只有一个原因：分类文件里有语法错。留一条日志，避免排查时凭猜。
    console.error('[demo-notes] failed to load', category, err)
    return undefined
  }
}

/** 同步查表（测试与脚本用：把所有分类模块扁平化成一张表） */
export async function allDemoNotes(): Promise<Record<string, DemoNote & { category: string }>> {
  const out: Record<string, DemoNote & { category: string }> = {}
  for (const [file, loader] of Object.entries(modules)) {
    const mod = await loader()
    const category = file.replace('./', '').replace('.ts', '')
    for (const [path, note] of Object.entries(mod.notes)) out[path] = { ...note, category }
  }
  return out
}
