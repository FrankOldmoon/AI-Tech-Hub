/**
 * 参数面板的数据模型：specs → 默认值对象。
 * 每个播放台页都靠它初始化参数，漏键会让首次运行算出 NaN。
 */
import { describe, expect, it } from 'vitest'
import { paramDefaults, type ParamSpec } from '../app/utils/params'

function spec(partial: Partial<ParamSpec> & { key: string, default: ParamSpec['default'] }): ParamSpec {
  return { label: partial.key, type: 'slider', ...partial } as ParamSpec
}

describe('paramDefaults', () => {
  it('每个 key 都取到自己的 default', () => {
    const specs: ParamSpec[] = [
      spec({ key: 'threshold', default: 0.4 }),
      spec({ key: 'method', type: 'select', default: 'luminance' }),
      spec({ key: 'keep', type: 'switch', default: true })
    ]
    expect(paramDefaults(specs)).toEqual({ threshold: 0.4, method: 'luminance', keep: true })
  })

  it('保留默认值的原始类型（布尔不能被写成字符串）', () => {
    const values = paramDefaults([spec({ key: 'keep', type: 'switch', default: false })])
    expect(values.keep).toBe(false)
  })

  it('空 specs 得到空对象', () => {
    expect(paramDefaults([])).toEqual({})
  })

  it('重复 key 后者覆盖前者（不抛错）', () => {
    const values = paramDefaults([
      spec({ key: 'x', default: 1 }),
      spec({ key: 'x', default: 2 })
    ])
    expect(values.x).toBe(2)
  })
})
