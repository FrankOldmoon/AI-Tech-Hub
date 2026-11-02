/**
 * 繁體中文（香港）运行时支持。
 *
 * 站内的中文文案有两类来源，处理方式不同：
 *
 *  - **i18n 词表**（i18n/locales/zh-HK.json）：构建期由 scripts/gen-zh-hk.mjs 用 opencc
 *    的 s2hk 做词级转换，这里是**不用**再处理的，直接 t() 取即可；
 *  - **内联 `{ zh, en }` 字面量**（散在 100+ 个页面/引擎里）：构建期改不到，只能运行时
 *    逐字换。toHK() 就是干这个的，用的表来自 zh-hk-map.ts（单字对单字，见该文件注释）。
 *
 * 为什么不给所有内联对象补一份 `zhHK` 字段：132 个 demo 的内联文案有上万条，补第三份
 * 等于把维护成本乘 1.5，而单字转换对内联短句（按钮、标题、提示）的准确率已经够用 ——
 * 真正需要词级准确度的长文案本来就该进 i18n 词表。
 */
import { ZH_HK_FROM, ZH_HK_TO } from './zh-hk-map'

/** 站内三种界面语言（比 locale code 短，便于在类型层穷举） */
export type UiLang = 'zh' | 'zhHK' | 'en'

/** locale code → 界面语言。'zh-HK' / 'zh-hk' / 'zh_HK' 都归到 zhHK */
export function uiLangOf(locale: string): UiLang {
  const lc = (locale || '').toLowerCase()
  if (lc.startsWith('zh-hk') || lc.startsWith('zh_hk') || lc === 'zhhk') return 'zhHK'
  if (lc.startsWith('zh')) return 'zh'
  return 'en'
}

/**
 * locale code → 引擎语言（只有 zh / en）。
 *
 * three.js 场景、Canvas 面板这些引擎内部的文案字典是 `Record<'zh'|'en', …>` 的编译期表，
 * 加第三份要改上百个数据块，收益却只在 3D 场景里的小字。所以引擎一律收 'zh'，
 * 由页面模板层（pickText + toHK）保证屏上文字是繁体。
 */
export function engineLangOf(locale: string): 'zh' | 'en' {
  return uiLangOf(locale) === 'en' ? 'en' : 'zh'
}

let lookup: Map<string, string> | null = null

function table(): Map<string, string> {
  if (lookup) return lookup
  lookup = new Map()
  const from = Array.from(ZH_HK_FROM)
  const to = Array.from(ZH_HK_TO)
  for (let i = 0; i < from.length; i++) lookup.set(from[i]!, to[i]!)
  return lookup
}

/** 逐字繁化：只替换表里有的字，其余原样保留（英文、标点、emoji 都不受影响） */
export function toHK(text: string): string {
  if (!text) return ''
  // 没有汉字就直接返回，省掉一次逐字扫描（大量英文文案走这条快路）
  if (!/[\u4e00-\u9fff]/.test(text)) return text
  const map = table()
  let out = ''
  for (const ch of text) out += map.get(ch) ?? ch
  return out
}

/** 按界面语言取中文文案：en 不管，zh 原样，zhHK 繁化 */
export function zhByLang(text: string, lang: UiLang): string {
  return lang === 'zhHK' ? toHK(text) : text
}
