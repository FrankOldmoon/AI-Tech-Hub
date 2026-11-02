/**
 * 本地化文案与参数规范的公共类型/工具。
 *
 * 视觉侧（image-tools）与语音侧（audio-tools）共用同一套「zh/en 文案 + 参数面板」数据模型，
 * 故从 image-tools.ts 里抽到这里：否则 audio-tools 为了拿 LocalizedText 就得 import 整个
 * 2675 行的视觉工具注册表，把视觉侧的实现拖进语音页面的 bundle。
 *
 * image-tools.ts 保留同名 re-export，历史 import 不受影响。
 */
import type { ParamOption, ParamOptions, ParamSpec } from './params'
import { toHK, type UiLang } from './zh-hk'

export interface LocalizedText {
  zh: string
  en: string
  /**
   * 繁体中文（香港）专用文案 —— **可选**。
   *
   * 绝大多数内联文案不需要填：缺省时 pickText 用 toHK() 逐字繁化 zh 文案，
   * 对按钮/标题/提示这种短句够用。只有「整词都换了说法」的地方才值得单独写
   * （例如 视频 → 影片、信息 → 資訊），否则留给自动转换。
   */
  zhHK?: string
}

export interface LocalizedParamOption {
  label: LocalizedText
  /** 组标题条目（Nuxt UI Select 的 type:'label' / 分组形式下的标题）可省略 value */
  value?: string | number | boolean
  type?: 'label'
}

/**
 * Select 选项：平铺 `[...]`，或「数组的数组」分组 `[[...], [...]]`（组内用 type:'label' 作标题）。
 *
 * 分组形式是语音侧 TTS 音色选择器的硬需求（Kokoro 有几十个音色、按语言分组），
 * 与 utils/params.ts 的 ParamOptions 保持一致；早先这里只声明了平铺形式，
 * 会让分组选项在 buildParamSpecs 里被压平成 label: undefined。
 */
export type LocalizedParamOptions = LocalizedParamOption[] | LocalizedParamOption[][]

export interface LocalizedParamSpec extends Omit<ParamSpec, 'label' | 'help' | 'options'> {
  label: LocalizedText
  help?: LocalizedText
  options?: LocalizedParamOptions
}

/**
 * 按界面语言取文案。zhHK 优先用显式 zhHK 字段，没有就逐字繁化 zh ——
 * 见 utils/zh-hk.ts 里的取舍说明。
 *
 * 每个分支都保持「缺该语言时回落另一种语言」的旧行为（类型上 zh/en 必填，
 * 但注册表数据可能是手写的、偶尔漏一项，界面上不能出现 undefined）。
 */
export function pickText(t: LocalizedText, lang: UiLang): string {
  if (lang === 'en') return t.en ?? t.zh
  if (lang === 'zhHK') return t.zhHK ?? toHK(t.zh ?? t.en ?? '')
  return t.zh ?? t.en
}

function toParamOption(o: LocalizedParamOption, lang: UiLang): ParamOption {
  return { label: pickText(o.label, lang), value: o.value, type: o.type }
}

/** 平铺 / 分组两种形式都要正确透传（判据：第一个元素本身是数组则为分组） */
function toParamOptions(options: LocalizedParamOptions | undefined, lang: UiLang): ParamOptions | undefined {
  if (!options || options.length === 0) return undefined
  return Array.isArray(options[0])
    ? (options as LocalizedParamOption[][]).map(group => group.map(o => toParamOption(o, lang)))
    : (options as LocalizedParamOption[]).map(o => toParamOption(o, lang))
}

/** 本地化参数规范 → DemoParams 可直接渲染的 ParamSpec[] */
export function buildParamSpecs(specs: LocalizedParamSpec[] | undefined, lang: UiLang): ParamSpec[] {
  if (!specs) return []
  return specs.map(s => ({
    key: s.key,
    label: pickText(s.label, lang),
    type: s.type,
    default: s.default,
    min: s.min,
    max: s.max,
    step: s.step,
    options: toParamOptions(s.options, lang),
    help: s.help ? pickText(s.help, lang) : undefined,
    disableWhileRunning: s.disableWhileRunning
  }))
}
