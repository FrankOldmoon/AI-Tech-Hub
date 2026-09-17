/**
 * neural-sandbox 演示清单。
 * 这份清单是 `ml/[slug].vue` 分发的**唯一事实来源**，且 name 必须与
 * public/apps/neural-sandbox/demos/<name>/ 目录名逐字一致 —— 写错就是 iframe 白屏。
 */
import { describe, expect, it } from 'vitest'
import { neuralDemoNames, neuralNameFromSlug } from '../app/utils/neural-demos'

describe('neuralDemoNames', () => {
  it('没有重复项', () => {
    expect(new Set(neuralDemoNames).size).toBe(neuralDemoNames.length)
  })

  it('名字都是 URL/目录安全的（小写字母、数字、连字符）', () => {
    for (const name of neuralDemoNames) {
      expect(name, name).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('清单非空（分发页依赖它）', () => {
    expect(neuralDemoNames.length).toBeGreaterThan(0)
  })
})

describe('neuralNameFromSlug', () => {
  it('去掉 neural- 前缀并在清单里校验', () => {
    const first = neuralDemoNames[0]!
    expect(neuralNameFromSlug(`neural-${first}`)).toBe(first)
  })

  it('清单里每个名字都能从自己的 slug 反解出来', () => {
    for (const name of neuralDemoNames) {
      expect(neuralNameFromSlug(`neural-${name}`), name).toBe(name)
    }
  })

  it('非 neural- 前缀或不在清单里 → null（交由 404 处理，而不是让 iframe 去猜）', () => {
    expect(neuralNameFromSlug('foragers')).toBeNull()
    expect(neuralNameFromSlug('neural-')).toBeNull()
    expect(neuralNameFromSlug('neural-not-a-real-demo')).toBeNull()
  })
})
