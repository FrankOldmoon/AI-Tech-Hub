/**
 * 字幕导出：秒 → SRT 时间戳与分块文本。
 * 这段逻辑的坑都在边界上：非有限值、四舍五入进位、末段缺结束时间、分段重叠、
 * 空文本段 —— 每一处都会产出播放器打不开的字幕文件。
 */
import { describe, expect, it } from 'vitest'
import { srtTime, toSrt, type SubtitleSegment } from '../app/utils/srt'

describe('srtTime', () => {
  it('格式是 HH:MM:SS,mmm', () => {
    expect(srtTime(0)).toBe('00:00:00,000')
    expect(srtTime(1.5)).toBe('00:00:01,500')
    expect(srtTime(61.25)).toBe('00:01:01,250')
    expect(srtTime(3661.25)).toBe('01:01:01,250')
  })

  it('毫秒补零到 3 位（缺了会出现 ,50 这种非法时间戳）', () => {
    expect(srtTime(1.05)).toBe('00:00:01,050')
    expect(srtTime(1.005)).toBe('00:00:01,005')
  })

  it('四舍五入到整毫秒，不会出现 ,1000', () => {
    expect(srtTime(0.9996)).toBe('00:00:01,000')
    expect(srtTime(0.9999)).not.toContain('1000')
  })

  it('NaN / Infinity / 负数一律当 0（不输出 NaN:NaN）', () => {
    expect(srtTime(Number.NaN)).toBe('00:00:00,000')
    expect(srtTime(Number.POSITIVE_INFINITY)).toBe('00:00:00,000')
    expect(srtTime(-3)).toBe('00:00:00,000')
  })
})

describe('toSrt', () => {
  const seg = (start: number, end: number | undefined, text: string): SubtitleSegment =>
    ({ start, end, text } as SubtitleSegment)

  it('没有可用分段时返回空串（调用方据此提示「没识别到语音」）', () => {
    expect(toSrt([])).toBe('')
    expect(toSrt([seg(0, 1, '   ')])).toBe('')
  })

  it('基本分块：序号从 1 连续编号，块间空行，末尾换行', () => {
    const srt = toSrt([seg(0, 1.5, '你好'), seg(2, 3, '世界')])
    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\n你好\n\n'
      + '2\n00:00:02,000 --> 00:00:03,000\n世界\n'
    )
  })

  it('文本里的空白被压成单空格并去首尾', () => {
    expect(toSrt([seg(0, 1, '  a \n\t b  ')])).toContain('\na b\n')
  })

  it('按 start 排序（模型给的顺序不保证有序）', () => {
    const srt = toSrt([seg(5, 6, '后'), seg(0, 1, '前')])
    expect(srt.indexOf('前')).toBeLessThan(srt.indexOf('后'))
  })

  it('末段缺结束时间：顺延到音频总时长', () => {
    const srt = toSrt([seg(0, undefined, '只有开始')], 12)
    expect(srt).toContain('00:00:00,000 --> 00:00:12,000')
  })

  it('缺结束时间且有下一段时：顺延到下一段起点', () => {
    const srt = toSrt([seg(0, undefined, 'A'), seg(4, 5, 'B')])
    expect(srt).toContain('00:00:00,000 --> 00:00:04,000')
  })

  it('缺结束时间且什么都没有时：给一个最短时长（不会出现 同起同止 的非法块）', () => {
    const srt = toSrt([seg(3, undefined, 'A')], 0)
    const [, range] = srt.split('\n')
    const [from, to] = range!.split(' --> ')
    expect(from).not.toBe(to)
  })

  it('与下一段重叠时截断到下一段起点', () => {
    const srt = toSrt([seg(0, 9, 'A'), seg(4, 5, 'B')])
    expect(srt).toContain('00:00:00,000 --> 00:00:04,000')
  })

  it('非有限的 start 当 0；非 number 的 end 视为缺失', () => {
    const srt = toSrt([
      { start: Number.NaN, end: 1, text: 'A' } as SubtitleSegment,
      { start: 2, end: Number.NaN, text: 'B' } as SubtitleSegment
    ], 10)
    expect(srt).toContain('00:00:00,000 --> 00:00:01,000')
    expect(srt).toContain('00:00:02,000 --> 00:00:10,000')
  })
})
