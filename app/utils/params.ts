// 可调参数规范：所有 demo 共用的参数面板数据模型
// 由各 demo 声明 specs，DemoParams 组件渲染对应控件并维护 values

export type ParamType = 'slider' | 'number' | 'select' | 'switch' | 'text'

export interface ParamOption {
  label: string
  value: string | number | boolean
}

export interface ParamSpec {
  /** 参数键名，对应 values 对象的字段 */
  key: string
  /** 已按 locale 解析的标签 */
  label: string
  type: ParamType
  /** 默认值 */
  default: number | string | boolean
  min?: number
  max?: number
  step?: number
  /** select 类型的可选项 */
  options?: ParamOption[]
  /** 附加说明（已本地化） */
  help?: string
  /** 是否在运行中禁用（默认 true：运行时禁用） */
  disableWhileRunning?: boolean
}

/** 由 specs 生成默认值对象 */
export function paramDefaults(specs: ParamSpec[]): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  for (const s of specs) out[s.key] = s.default
  return out
}
