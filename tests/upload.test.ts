import { describe, expect, it } from 'vitest'
import { validateUpload } from '../app/utils/upload'

const t = (key: string): string => key

function file(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type })
}

describe('validateUpload', () => {
  it('拒绝非音频文件', () => {
    expect(validateUpload(file('a.png', 'image/png', 10), 'audio', t)).toBe('upload.typeAudio')
  })

  it('拒绝非图片文件', () => {
    expect(validateUpload(file('a.mp3', 'audio/mpeg', 10), 'image', t)).toBe('upload.typeImage')
  })

  it('拒绝超大音频（>50MB）', () => {
    expect(validateUpload(file('a.wav', 'audio/wav', 51 * 1024 * 1024), 'audio', t)).toBe('upload.tooLarge')
  })

  it('拒绝超大图片（>20MB）', () => {
    expect(validateUpload(file('a.jpg', 'image/jpeg', 21 * 1024 * 1024), 'image', t)).toBe('upload.tooLarge')
  })

  it('合法文件通过', () => {
    expect(validateUpload(file('a.wav', 'audio/wav', 1024), 'audio', t)).toBeNull()
    expect(validateUpload(file('a.jpg', 'image/jpeg', 1024), 'image', t)).toBeNull()
  })
})
