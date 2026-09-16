/**
 * NLP 工具注册表（Nlp Tool Registry）——与视觉侧 utils/image-tools.ts、语音侧 utils/audio-tools.ts 同构。
 *
 * 为什么要它：NLP 原本有两份**按 slug 索引**的注册表
 *   - utils/mediapipe-text.ts  → textTasks（2 项）
 *   - utils/transformers.ts    → transformersTextTasks（5 项）
 * 由 nlp/[slug].vue 在 onMounted 里「先查 MediaPipe 再查 Transformers」解析，于是
 *   **一个任务只能属于一个页面** —— 「同一任务横向对比两个引擎」根本没法表达。
 * 这里把两份 map 适配成带 `pages[]` 的统一数组，从而解锁能力×引擎双轴。
 *
 * 关键设计：**这是 adapter，不是重写。**
 * 既有声明式配置（inputs / buildArgs / callOptions / params / parseItems / parseText / examples）
 * 全部继续复用，本层只补 `pages` / `name` / `section` 与执行入口 `run`。
 * 行为等价性因此由「复用原配置」保证，而不是靠人肉搬运代码。
 *
 * 与视觉/语音的差异：NLP 的输入是**多输入框文本**（embedder 要两个），
 * 所以 `values` 是 `Record<key, string>` 而不是单一 text；结果也不是单形态，
 * 故 `NlpToolResult` 有 items / text / info / headline 四个通道。
 */
import type { LocalizedParamSpec, LocalizedText } from '~/utils/localized'
import type { DownloadProgress } from '~/utils/audio-progress'
import { mediapipeTextTools } from '~/utils/nlp-engines/mediapipe'
import { transformersNlpTools } from '~/utils/nlp-engines/transformers'

export type NlpEngine = 'mediapipe' | 'transformers'

export type NlpPageSlug = 'text-classifier' | 'language-detector' | 'text-embedder' | 'ner'
  | 'zero-shot' | 'summarization' | 'qa' | 'fill-mask' | 'mediapipe-text' | 'transformers'
// ↑ `=` 后紧跟第一个联合成员：@stylistic/operator-linebreak 要求换行时运算符必须在行首，
//   把 `=` 留在上一行会报错（视觉/语音的同类文件也踩过这个坑）

/** 输入框声明（沿用 transformers 侧既有形状；text-embedder 用两个） */
export interface NlpInputSpec {
  key: string
  /** i18n key，由 playground 解析后展示；**复用既有 tf.* 命名空间，不要新建 key** */
  labelKey: string
  type: 'textarea' | 'text'
  default?: string
  placeholderKey?: string
}

/** 结果行：带 score（0..1）时 playground 会渲染成进度条 */
export interface NlpResultItem {
  label: string
  value?: string
  score?: number
}

export interface NlpToolResult {
  /** 主结果：表格行（分类 / 语言检测 / NER / 零样本 / 问答 / 完形填空） */
  items?: NlpResultItem[]
  /** 纯文本结果（摘要） */
  text?: string
  /** 附加信息行（后端 / 耗时等） */
  info?: { label: string, value: string }[]
  /** 需要大字展示的单个指标（text-embedder 的余弦相似度） */
  headline?: { label: string, value: string }
}

export interface NlpToolContext {
  lang: 'zh' | 'en'
  /** 输入框当前值（key → 文本），长度与 tool.inputs 对应 */
  values: Record<string, string>
  params: Record<string, number | string | boolean>
  /** 模型下载进度（transformers.js）→ 由 playground 统一展示 */
  onProgress?: (p: DownloadProgress) => void
  /** 长任务请在每个分片前检查；返回 true 表示用户已取消，应尽早返回 */
  isCancelled?: () => boolean
}

export interface NlpTool {
  id: string
  /** 归属页面（能力页 / 引擎页多对多）—— 双轴的载体 */
  pages: NlpPageSlug[]
  name: LocalizedText
  description?: LocalizedText
  engine: NlpEngine
  /** 侧栏分组 i18n key：按当前页 slug 解析（能力页写引擎名、引擎页写任务族），`*` 为兜底 */
  section?: Record<string, string>
  inputs: NlpInputSpec[]
  params?: LocalizedParamSpec[]
  /** 预置示例：labelKey 为 i18n key，values 按 inputs 的 key 填充 */
  examples?: { labelKey: string, values: Record<string, string> }[]
  run: (ctx: NlpToolContext) => Promise<NlpToolResult>
}

/** 全部 NLP 工具（能力页与引擎页共用同一批数据，归属由 pages 决定） */
export const nlpTools: NlpTool[] = [
  // 引擎顺序即能力页里条目顺序：本地小模型（MediaPipe，无下载）排在需要下模型的之前
  ...mediapipeTextTools,
  ...transformersNlpTools
]

export function nlpToolsByPage(slug: string): NlpTool[] {
  return nlpTools.filter(t => t.pages.includes(slug as NlpPageSlug))
}

export function getNlpTool(page: string, toolId: string): NlpTool | undefined {
  return nlpTools.find(t => t.pages.includes(page as NlpPageSlug) && t.id === toolId)
}

/** 侧栏第二行的引擎名 */
export const nlpKindLabels: Record<NlpEngine, string> = {
  mediapipe: 'MediaPipe',
  transformers: 'Transformers.js'
}
