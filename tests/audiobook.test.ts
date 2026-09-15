import { describe, expect, it } from 'vitest'
import { VOICE_POOLS, assignVoices, collectRoles, concatChunks, parseScript } from '../app/utils/audiobook'

describe('parseScript', () => {
  it('解析中文冒号的「角色：台词」', () => {
    const lines = parseScript('小明：你好呀！\n小红：今天天气真好。')
    expect(lines).toEqual([
      { role: '小明', text: '你好呀！' },
      { role: '小红', text: '今天天气真好。' }
    ])
  })

  it('兼容英文冒号与前后空格', () => {
    const lines = parseScript('Amy:  Hi Ben!  \nBen : I am here.')
    expect(lines).toEqual([
      { role: 'Amy', text: 'Hi Ben!' },
      { role: 'Ben', text: 'I am here.' }
    ])
  })

  it('没有冒号的行当作旁白（role 为空串）', () => {
    const lines = parseScript('两人相视一笑。')
    expect(lines).toEqual([{ role: '', text: '两人相视一笑。' }])
  })

  it('跳过空行与空台词', () => {
    expect(parseScript('\n\n小明：\n\n小红：嗨\n')).toEqual([{ role: '小红', text: '嗨' }])
  })

  it('剥掉成对的中文引号/书名号，避免把标点读出来', () => {
    expect(parseScript('小明：「你好」')[0]!.text).toBe('你好')
    expect(parseScript('小明：“你好”')[0]!.text).toBe('你好')
  })

  it('台词内的冒号不会被误当分隔符', () => {
    const lines = parseScript('小明：时间：下午三点')
    expect(lines[0]!.role).toBe('小明')
    expect(lines[0]!.text).toBe('时间：下午三点')
  })

  it('兼容 CRLF 换行', () => {
    expect(parseScript('小明：你好\r\n小红：嗨')).toHaveLength(2)
  })
})

describe('collectRoles', () => {
  it('按出场顺序去重，旁白排最后', () => {
    const lines = parseScript('B：1\nA：2\n旁白一句\nB：3')
    expect(collectRoles(lines)).toEqual(['B', 'A', ''])
  })

  it('没有旁白时不额外插入空角色', () => {
    const lines = parseScript('A：1\nB：2')
    expect(collectRoles(lines)).toEqual(['A', 'B'])
  })
})

describe('assignVoices', () => {
  const pool = ['v0', 'v1', 'v2']

  it('按角色顺序轮转分配，旁白固定用池中最后一个', () => {
    const voices = assignVoices(['A', 'B', ''], pool)
    expect(voices.A).toBe('v0')
    expect(voices.B).toBe('v1')
    expect(voices['']).toBe('v2')
  })

  it('角色数超过可用音色时循环复用，且不与旁白撞', () => {
    const voices = assignVoices(['A', 'B', 'C', 'D', ''], pool)
    expect(voices.C).toBe('v0')
    expect(voices.D).toBe('v1')
    const assigned = [voices.A, voices.B, voices.C, voices.D]
    expect(assigned).not.toContain(voices[''])
  })

  it('只有一个音色时不会崩（退化为全部同音色）', () => {
    const voices = assignVoices(['A', ''], ['only'])
    expect(voices.A).toBe('only')
    expect(voices['']).toBe('only')
  })

  it('语言池都非空且无重复', () => {
    for (const [lang, list] of Object.entries(VOICE_POOLS)) {
      expect(list.length, lang).toBeGreaterThan(1)
      expect(new Set(list).size, lang).toBe(list.length)
    }
  })
})

describe('concatChunks', () => {
  it('按顺序拼接并在句间插入静音', () => {
    const out = concatChunks([Float32Array.from([1, 2]), Float32Array.from([3])], 10, 0.5)
    expect(Array.from(out)).toEqual([1, 2, 0, 0, 0, 0, 0, 3])
  })

  it('gap 为 0 时是纯拼接', () => {
    const out = concatChunks([Float32Array.from([1]), Float32Array.from([2])], 10, 0)
    expect(Array.from(out)).toEqual([1, 2])
  })

  it('空输入返回空数组', () => {
    expect(concatChunks([], 24000).length).toBe(0)
  })

  it('单句不追加尾部静音', () => {
    const out = concatChunks([Float32Array.from([1, 2, 3])], 10, 0.5)
    expect(Array.from(out)).toEqual([1, 2, 3])
  })
})
