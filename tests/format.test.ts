/**
 * 展示用格式化：体积、时长、体积变化。
 * 这些数字直接出现在转换/裁剪/压缩页上，算错会让人误判「压缩有没有效果」。
 */
import { describe, expect, it } from 'vitest'
import { formatBytes, formatTime, formatTimeMs, sizeDelta } from '../app/utils/format'

describe('formatBytes', () => {
  it('小于 1KB 按字节显示', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('小于 1MB 按 KB 显示（一位小数）', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('1MB 及以上按 MB 显示（两位小数）', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB')
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.50 MB')
  })

  it('边界不粘连：1023/1024 与 1048575/1048576 分属不同单位', () => {
    expect(formatBytes(1023)).toContain('B')
    expect(formatBytes(1024)).toContain('KB')
    expect(formatBytes(1048575)).toContain('KB')
    expect(formatBytes(1048576)).toContain('MB')
  })
})

describe('formatTime', () => {
  it('一小时以内是 mm:ss', () => {
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(59)).toBe('00:59')
    expect(formatTime(60)).toBe('01:00')
    expect(formatTime(3599)).toBe('59:59')
  })

  it('超过一小时才带小时位', () => {
    expect(formatTime(3600)).toBe('1:00:00')
    expect(formatTime(3661)).toBe('1:01:01')
  })

  it('小数秒向下取整（不四舍五入，避免显示比实际长）', () => {
    expect(formatTime(1.9)).toBe('00:01')
  })

  it('NaN / Infinity / 负数一律当 0 —— 媒体元数据未就绪时就是这么给的', () => {
    expect(formatTime(Number.NaN)).toBe('00:00')
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('00:00')
    expect(formatTime(-5)).toBe('00:00')
  })
})

describe('formatTimeMs', () => {
  it('保留一位小数（裁剪滑块步进是 0.1 秒）', () => {
    expect(formatTimeMs(0)).toBe('00:00.0')
    expect(formatTimeMs(1.5)).toBe('00:01.5')
    expect(formatTimeMs(61.25)).toBe('01:01.3')
  })

  it('非法值当 0', () => {
    expect(formatTimeMs(Number.NaN)).toBe('00:00.0')
    expect(formatTimeMs(-1)).toBe('00:00.0')
  })
})

describe('sizeDelta', () => {
  it('原始体积未知时返回 null（而不是 Infinity）', () => {
    expect(sizeDelta(0, 100)).toBeNull()
  })

  it('变大/变小/不变的百分比', () => {
    expect(sizeDelta(1000, 500)).toBe(-50)
    expect(sizeDelta(1000, 2000)).toBe(100)
    expect(sizeDelta(1000, 1000)).toBe(0)
  })

  it('四舍五入到整数百分比', () => {
    expect(sizeDelta(3, 4)).toBe(33)
  })
})
