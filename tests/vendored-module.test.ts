import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blobModuleUrl } from '../app/utils/vendored-module'

describe('blobModuleUrl', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:fake')
  const URL_UNDER_TEST = '/model/vendor/headaudio/headaudio.min.mjs'

  beforeEach(() => {
    createObjectURL.mockClear()
    vi.stubGlobal('URL', { createObjectURL })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('把源码包成 text/javascript 的 Blob URL —— MIME 由前端给，不看响应头', async () => {
    const source = 'export{HeadAudio};'
    const fetchMock = vi.fn(async () => new Response(source))
    vi.stubGlobal('fetch', fetchMock)

    const url = await blobModuleUrl(URL_UNDER_TEST)

    expect(fetchMock).toHaveBeenCalledWith(URL_UNDER_TEST)
    expect(url).toBe('blob:fake')
    const blob = createObjectURL.mock.calls[0]![0]
    expect(blob.type).toBe('text/javascript')
    expect(await blob.text()).toBe(source)
  })

  it('取不到时抛出带 URL 与状态码的错误，不静默', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))

    await expect(blobModuleUrl(URL_UNDER_TEST)).rejects.toThrow(`取不到 ${URL_UNDER_TEST}（HTTP 404）`)
  })
})
