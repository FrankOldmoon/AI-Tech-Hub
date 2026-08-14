import { describe, expect, it } from 'vitest'
import { humanError, mediaError } from '../app/utils/errors'

const t = (key: string): string => key

describe('humanError', () => {
  it('映射网络类错误为人话', () => {
    expect(humanError(new Error('fetch failed'), t)).toBe('errors.network')
    expect(humanError(new Error('Failed to fetch'), t)).toBe('errors.network')
  })

  it('映射内存类错误', () => {
    expect(humanError(new Error('out of memory'), t)).toBe('errors.oom')
  })

  it('映射 WebGPU 错误', () => {
    expect(humanError(new Error('WebGPU not supported'), t)).toBe('errors.webgpu')
  })

  it('空错误走 unknown 兜底', () => {
    expect(humanError(undefined, t)).toBe('errors.unknown')
  })

  it('未识别错误保留原始 message', () => {
    expect(humanError(new Error('custom boom'), t)).toBe('custom boom')
  })
})

describe('mediaError', () => {
  it('权限拒绝', () => {
    expect(mediaError({ name: 'NotAllowedError' }, t)).toBe('errors.permission')
  })

  it('设备未找到', () => {
    expect(mediaError({ name: 'NotFoundError' }, t)).toBe('errors.deviceNotFound')
  })

  it('设备被占用', () => {
    expect(mediaError({ name: 'NotReadableError' }, t)).toBe('errors.deviceBusy')
  })

  it('其他错误回退 humanError', () => {
    expect(mediaError(new Error('fetch failed'), t)).toBe('errors.network')
  })
})
