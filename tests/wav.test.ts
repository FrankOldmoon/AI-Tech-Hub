/**
 * WAV 编码：全站「合成出音频给用户下载」的唯一实现。
 *
 * 历史教训（已写进源码注释）：kokoro 与 voice-clone 曾各有一份 header 写法，且
 * 负半周缩放不一致（对正负都乘 0x7fff 会引入直流偏移）。所以这里把**头部字节**与
 * **采样缩放**都逐字节钉住 —— 这类错误听感上只是「有点闷」，很难靠耳朵发现。
 */
import { describe, expect, it } from 'vitest'
import { encodeWav, formatClock } from '../app/utils/wav'

async function bytesOf(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer())
}

function str(view: DataView, offset: number, len: number): string {
  return Array.from({ length: len }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join('')
}

describe('encodeWav 头部', () => {
  it('是标准 44 字节 PCM 单声道 16bit 头', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1])
    const blob = encodeWav(samples, 16000)
    const view = await bytesOf(blob)

    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(44 + samples.length * 2)
    expect(str(view, 0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2)
    expect(str(view, 8, 4)).toBe('WAVE')
    expect(str(view, 12, 4)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // 单声道
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(28, true)).toBe(16000 * 2) // byte rate
    expect(view.getUint16(32, true)).toBe(2) // block align
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(str(view, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(samples.length * 2)
  })

  it('采样率写进头部（44.1k 与 16k 要能区分）', async () => {
    const [, view16] = [0, await bytesOf(encodeWav(new Float32Array(2), 16000))]
    const [, view44] = [0, await bytesOf(encodeWav(new Float32Array(2), 44100))]
    expect(view16!.getUint32(24, true)).toBe(16000)
    expect(view44!.getUint32(24, true)).toBe(44100)
  })
})

describe('encodeWav 采样缩放', () => {
  it('正负半周对称缩放（0x7fff / 0x8000），避免直流偏移', async () => {
    const view = await bytesOf(encodeWav(new Float32Array([1, -1, 0]), 16000))
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
    expect(view.getInt16(48, true)).toBe(0)
  })

  it('超出 ±1 的样本被夹住，不会回绕成异响', async () => {
    const view = await bytesOf(encodeWav(new Float32Array([2, -2]), 16000))
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
  })

  it('空样本也能出一个合法头（不是 0 字节文件）', async () => {
    const blob = encodeWav(new Float32Array(0), 16000)
    expect(blob.size).toBe(44)
    expect(await str(await bytesOf(blob), 0, 4)).toBe('RIFF')
  })
})

describe('formatClock', () => {
  it('mm:ss，秒补零', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(9)).toBe('0:09')
    expect(formatClock(60)).toBe('1:00')
    expect(formatClock(125)).toBe('2:05')
  })

  it('向下取整、负数与非法值当 0', () => {
    expect(formatClock(59.9)).toBe('0:59')
    expect(formatClock(-1)).toBe('0:00')
    expect(formatClock(Number.NaN)).toBe('0:00')
  })
})
