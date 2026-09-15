import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THRESHOLD,
  cosineSimilarity,
  l2normalize,
  matchVoiceprint,
  rankVoiceprints,
  type VoicePrint
} from '../app/utils/voiceprint'

/** 造一条注册声纹（单样本） */
function person(name: string, embedding: number[]): VoicePrint {
  return { id: name, name, createdAt: 0, samples: [{ id: name, embedding, seconds: 2, createdAt: 0 }] }
}

describe('cosineSimilarity', () => {
  it('同向量为 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6)
  })

  it('正交为 0、反相为 -1', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6)
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6)
  })

  it('与向量长度（模）无关', () => {
    expect(cosineSimilarity([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 6)
  })

  it('零向量返回 0（不做除零）', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0)
  })

  it('长度不一致时按较短者计算，不越界', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBeCloseTo(1, 6)
  })
})

describe('l2normalize', () => {
  it('归一化后模长为 1', () => {
    const v = l2normalize([3, 4])
    expect(Math.hypot(...v)).toBeCloseTo(1, 6)
    expect(v[0]).toBeCloseTo(0.6, 6)
    expect(v[1]).toBeCloseTo(0.8, 6)
  })

  it('零向量原样返回（不产生 NaN）', () => {
    expect(l2normalize([0, 0])).toEqual([0, 0])
  })
})

describe('rankVoiceprints', () => {
  const registry = [
    person('张老师', [1, 0, 0]),
    person('李同学', [0, 1, 0]),
    person('王同学', [0.8, 0.6, 0])
  ]

  it('按相似度降序排列', () => {
    const ranks = rankVoiceprints([1, 0, 0], registry)
    expect(ranks.map(r => r.name)).toEqual(['张老师', '王同学', '李同学'])
    expect(ranks[0]!.similarity).toBeCloseTo(1, 6)
  })

  it('accepted 按阈值标记', () => {
    const ranks = rankVoiceprints([1, 0, 0], registry, 0.9)
    expect(ranks[0]!.accepted).toBe(true)
    expect(ranks[1]!.accepted).toBe(false) // 0.8 < 0.9
  })

  it('同一个人的多个样本取最高相似度', () => {
    const multi: VoicePrint[] = [{
      id: 'x',
      name: '多段样本',
      createdAt: 0,
      samples: [
        { id: 's1', embedding: [0, 1, 0], seconds: 2, createdAt: 0 },
        { id: 's2', embedding: [1, 0, 0], seconds: 2, createdAt: 0 }
      ]
    }]
    const ranks = rankVoiceprints([0.9, 0.1, 0], multi)
    expect(ranks).toHaveLength(1)
    expect(ranks[0]!.similarity).toBeCloseTo(cosineSimilarity([0.9, 0.1, 0], [1, 0, 0]), 6)
  })

  it('空库返回空数组', () => {
    expect(rankVoiceprints([1, 0], [])).toEqual([])
  })
})

describe('matchVoiceprint', () => {
  const registry = [person('张老师', [1, 0]), person('李同学', [0, 1])]

  it('高于阈值返回最佳命中', () => {
    const hit = matchVoiceprint([0.95, 0.05], registry)
    expect(hit?.name).toBe('张老师')
    expect(hit!.similarity).toBeGreaterThan(DEFAULT_THRESHOLD)
  })

  it('全部低于阈值返回 null', () => {
    expect(matchVoiceprint([0.7, 0.714], registry, 0.9)).toBeNull()
  })

  it('空库返回 null', () => {
    expect(matchVoiceprint([1, 0], [])).toBeNull()
  })
})
