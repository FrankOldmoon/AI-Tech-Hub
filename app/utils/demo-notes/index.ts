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
  /** 最简 JavaScript 实现，与 python 同一套逻辑，便于对照阅读 */
  javascript: string
  /**
   * 原理说明（Markdown）。zh 必填，en 必填；繁体由 zh-hk.ts 的 toHK 逐字转换，
   * 需要整词订正时再加可选 zhHK 字段。
   */
  principle: LocalizedText
  /**
   * 【预留】HTML 原理可视化：站内路径，例如 `/learning/robot/auto-drive.html`。
   *
   * 填了就在「原理说明」下方嵌一个 16:9 iframe（同源子文档，可自由用 canvas/three），
   * 空着则什么都不渲染 —— 先把位置留好，后续按页补可视化，不必再改组件。
   */
  htmlDemo?: string
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
  const mod = await loader()
  return mod.notes[key]
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
