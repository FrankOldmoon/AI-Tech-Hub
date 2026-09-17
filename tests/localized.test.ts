/**
 * 本地化参数规范 → 可直接渲染的 ParamSpec。
 *
 * 关键契约是 **select 的两种形式都不能走形**：平铺 `[...]` 与分组 `[[...], [...]]`。
 * 历史 bug：只声明了平铺形式，分组选项会被压平成 label: undefined（TTS 音色选择器
 * 有几十个按语言分组的音色，正是分组形式），所以这里把两种都钉住。
 */
import { describe, expect, it } from 'vitest'
import { buildParamSpecs, pickText, type LocalizedParamSpec } from '../app/utils/localized'

describe('pickText', () => {
  it('按语言取值', () => {
    const text = { zh: '阈值', en: 'Threshold' }
    expect(pickText(text, 'zh')).toBe('阈值')
    expect(pickText(text, 'en')).toBe('Threshold')
  })

  it('缺该语言时回落英文（不让界面出现 undefined）', () => {
    expect(pickText({ en: 'Only English' } as { zh: string, en: string }, 'zh')).toBe('Only English')
  })
})

describe('buildParamSpecs', () => {
  it('未给 specs 时返回空数组', () => {
    expect(buildParamSpecs(undefined, 'zh')).toEqual([])
    expect(buildParamSpecs([], 'zh')).toEqual([])
  })

  it('label / help 按语言解析，其余字段原样透传', () => {
    const specs: LocalizedParamSpec[] = [{
      key: 'threshold',
      type: 'slider',
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.05,
      label: { zh: '阈值', en: 'Threshold' },
      help: { zh: '越高越严', en: 'Higher is stricter' }
    }]

    const [zh] = buildParamSpecs(specs, 'zh')
    expect(zh).toMatchObject({
      key: 'threshold',
      type: 'slider',
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.05,
      label: '阈值',
      help: '越高越严'
    })

    const [en] = buildParamSpecs(specs, 'en')
    expect(en?.label).toBe('Threshold')
    expect(en?.help).toBe('Higher is stricter')
  })

  it('没有 help 时不产生 help 字段', () => {
    const [built] = buildParamSpecs([
      { key: 'a', type: 'switch', default: true, label: { zh: 'A', en: 'A' } }
    ], 'zh')
    expect(built?.help).toBeUndefined()
  })

  it('平铺 select 选项逐项本地化', () => {
    const [built] = buildParamSpecs([{
      key: 'method',
      type: 'select',
      default: 'a',
      label: { zh: '方法', en: 'Method' },
      options: [
        { label: { zh: '平均', en: 'Average' }, value: 'a' },
        { label: { zh: '亮度', en: 'Luminance' }, value: 'b' }
      ]
    }], 'zh')

    expect(built?.options).toEqual([
      { label: '平均', value: 'a', type: undefined },
      { label: '亮度', value: 'b', type: undefined }
    ])
  })

  it('分组 select 选项保持分组结构（回归：曾被压平）', () => {
    const [built] = buildParamSpecs([{
      key: 'voice',
      type: 'select',
      default: 'v1',
      label: { zh: '音色', en: 'Voice' },
      options: [
        [
          { label: { zh: '中文', en: 'Chinese' }, type: 'label' as const },
          { label: { zh: '晓晓', en: 'Xiaoxiao' }, value: 'v1' }
        ],
        [
          { label: { zh: '英文', en: 'English' }, type: 'label' as const },
          { label: { zh: 'Aria', en: 'Aria' }, value: 'v2' }
        ]
      ]
    }], 'zh')

    const options = built?.options as Array<Array<{ label: string, value?: unknown, type?: string }>>
    expect(Array.isArray(options)).toBe(true)
    expect(options).toHaveLength(2)
    expect(options[0]?.[0]).toMatchObject({ label: '中文', type: 'label' })
    expect(options[1]?.[1]).toMatchObject({ label: 'Aria', value: 'v2' })
  })

  it('空 options 与未给 options 都得到 undefined（而不是空数组）', () => {
    const [a] = buildParamSpecs([
      { key: 'x', type: 'select', default: 1, label: { zh: 'X', en: 'X' }, options: [] }
    ], 'zh')
    expect(a?.options).toBeUndefined()

    const [b] = buildParamSpecs([
      { key: 'y', type: 'select', default: 1, label: { zh: 'Y', en: 'Y' } }
    ], 'zh')
    expect(b?.options).toBeUndefined()
  })
})
