/**
 * 示例素材加载：public/samples 下的预置文件 → File。
 * 「开箱可玩」全靠它，文件名与 MIME 都要对（下游按 type 判断是图片还是音频）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSample } from '../app/utils/samples'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(impl: (url: string) => Promise<Response>) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('fetchSample', () => {
  it('把响应体包成 File，名字取 URL 最后一段，type 沿用 blob 的', async () => {
    stubFetch(async () => new Response(new Blob(['abc'], { type: 'image/jpeg' }), { status: 200 }))

    const file = await fetchSample('/samples/images/street.jpg')
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('street.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(file.size).toBe(3)
  })

  it('音频示例同样带上正确的 type（下游按 type 分流）', async () => {
    stubFetch(async () => new Response(new Blob(['x'], { type: 'audio/wav' }), { status: 200 }))
    const file = await fetchSample('/samples/audio/speech.wav')
    expect(file.name).toBe('speech.wav')
    expect(file.type).toBe('audio/wav')
  })

  it('请求的就是传入的 URL（不做任何拼接/改写）', async () => {
    const mock = stubFetch(async () => new Response(new Blob(['x']), { status: 200 }))
    await fetchSample('/samples/images/face.jpg')
    expect(mock).toHaveBeenCalledWith('/samples/images/face.jpg')
  })

  it('URL 以斜杠结尾时回落默认名 sample，不会得到空文件名', async () => {
    stubFetch(async () => new Response(new Blob(['x']), { status: 200 }))
    const file = await fetchSample('/samples/images/')
    expect(file.name).toBe('sample')
    expect(file.name.length).toBeGreaterThan(0)
  })
})
