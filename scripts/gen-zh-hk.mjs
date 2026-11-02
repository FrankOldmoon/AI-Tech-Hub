#!/usr/bin/env node
/**
 * 生成「繁體中文（香港）」资源。
 *
 * 站内中文文案有两个来源，这个脚本两边都覆盖：
 *  1. i18n/locales/zh.json（1650 行词表）→ i18n/locales/zh-HK.json，用 opencc 的 **s2hk**
 *     做词级转换（「設定」「網絡」「檔案」这类是整个词变的，单字映射做不到）；
 *  2. 页面内联的 `{ zh, en }` 文案没法在构建期转（散在 100+ 个 .vue / .ts 里），
 *     所以导出 app/utils/zh-hk-map.ts —— 一张**单字映射表**，由 zh-hk.ts 在运行时逐字替换。
 *
 * 单字映射的取舍：只收 CJK 基本区（U+4E00–U+9FFF）里转换后确实变形的字，
 * 约 1.3k 对，编成「两个字串逐位对应」的形式（比对象字面量小 3 倍），
 * 够覆盖内联短句；词级差异（如「软件 → 軟件」这种单字也变的会被单字表覆盖；
 * 「鼠标 → 滑鼠」这种整词换了词的不覆盖，页面上会保留「鼠標」这类写法，
 * 属可接受残留 —— 词表那一侧走 opencc，不受影响）。
 *
 * 用法：node scripts/gen-zh-hk.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as OpenCC from 'opencc-js'

const ROOT = process.cwd()
const SRC = join(ROOT, 'i18n/locales/zh.json')
const OUT = join(ROOT, 'i18n/locales/zh-HK.json')
const MAP_OUT = join(ROOT, 'app/utils/zh-hk-map.ts')

const toHK = OpenCC.Converter({ from: 'cn', to: 'hk' })

/**
 * 香港语境的人工订正表（opencc 的 hk 词表偏保守，这几个是站内高频且明显不合港式习惯的）。
 * 键是 opencc 的输出，值是香港实际写法；只放「确定更好」的，别塞猜测。
 */
const FIXUPS = [
  ['計算機', '電腦'],
  ['互聯網', '互聯網'], // 港式同样写「互聯網」，留着占位说明无需改
  ['視頻', '影片'],
  ['激光', '激光'],
  // opencc 的 s2hk 有几个字会落到日式异体上（这里是「説」U+8AAC，正体应为「說」U+8AAA），
  // 属字典数据问题，不修的话页面上会混进日文字形
  ['説', '說']
]
const fixupPairs = FIXUPS.filter(([a, b]) => a !== b)

function convert(text) {
  let out = toHK(text)
  for (const [from, to] of fixupPairs) out = out.split(from).join(to)
  return out
}

/** 递归转换 JSON 里的每个字符串值，保持键名（键名是 i18n key，不能动） */
function convertDeep(value) {
  if (typeof value === 'string') return convert(value)
  if (Array.isArray(value)) return value.map(convertDeep)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = convertDeep(v)
    return out
  }
  return value
}

const zh = JSON.parse(readFileSync(SRC, 'utf8'))
const zhHK = convertDeep(zh)
writeFileSync(OUT, `${JSON.stringify(zhHK, null, 2)}\n`, 'utf8')

/* ---------- 单字映射表 ---------- */
const from = []
const to = []
for (let cp = 0x4e00; cp <= 0x9fff; cp++) {
  const ch = String.fromCodePoint(cp)
  const converted = convert(ch)
  // 只收「一对一变形」的字：一变多（如 干 → 乾/幹）在无语境时无法判断，交给词表那侧
  if (converted !== ch && Array.from(converted).length === 1) {
    from.push(ch)
    to.push(converted)
  }
}

const header = `/**
 * 繁简单字映射（自动生成，勿手改）。
 *
 * 由 scripts/gen-zh-hk.mjs 用 opencc 的 s2hk 逐字转换 CJK 基本区得到：
 * 只保留「一字对一字」的结果（一变多的字比如「干」→ 乾/幹 依赖上下文，交由
 * i18n/locales/zh-HK.json 的词级转换处理，这里宁缺勿错）。
 *
 * 消费方：app/utils/zh-hk.ts 的 toHK()，用于运行时繁化散落在各页面里的内联
 * \`{ zh, en }\` 文案（构建期改不到那些字面量）。
 */

/** 简体字（与 ZH_HK_TO 逐位对应） */
export const ZH_HK_FROM = ${JSON.stringify(from.join(''))}

/** 繁体字 */
export const ZH_HK_TO = ${JSON.stringify(to.join(''))}

/** 映射条目数（测试用） */
export const ZH_HK_PAIRS = ${from.length}
`

writeFileSync(MAP_OUT, header, 'utf8')

console.log(`[gen-zh-hk] i18n/locales/zh-HK.json  ${(readFileSync(OUT, 'utf8').length / 1024).toFixed(1)} KB`)
console.log(`[gen-zh-hk] app/utils/zh-hk-map.ts   ${from.length} 对单字`)
