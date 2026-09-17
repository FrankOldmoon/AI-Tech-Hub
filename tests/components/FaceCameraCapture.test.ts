// @vitest-environment happy-dom
/**
 * 人脸摄像头：它只是通用取帧组件之上的一层（实时识别叠加）。
 * 覆盖：文案透传、拍照/关闭透传、live 叠加的三种状态（未就绪 / 就绪 / 模型加载失败），
 * 以及 live 循环真的跑到了 face-api（而不只是画个空壳）。face-api 整个被替身。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { extractFaces, ensureFaceApiLoaded, getRegistry } from '~/utils/face-studio'
import { WebcamCaptureStub, patchMediaElements, uiStubs } from './support'
import FaceCameraCapture from '~/components/FaceCameraCapture.vue'

vi.mock('~/utils/face-studio', () => ({
  ensureFaceApiLoaded: vi.fn(() => Promise.resolve()),
  extractFaces: vi.fn(async () => []),
  getRegistry: vi.fn(() => []),
  recognizeDescriptor: vi.fn(() => null)
}))

let wrapper: ReturnType<typeof mount> | undefined

function mountFace(props: Record<string, unknown> = {}) {
  wrapper = mount(FaceCameraCapture as never, {
    props,
    global: { stubs: { ...uiStubs, WebcamCapture: WebcamCaptureStub } }
  })
  return wrapper
}

/** 取帧组件是替身，文案与插槽都落在它的属性/内容上 */
const cameraStub = (w: ReturnType<typeof mountFace>) => w.getComponent(WebcamCaptureStub)
const overlayCanvas = (w: ReturnType<typeof mountFace>) => w.find('canvas')
const ready = (w: ReturnType<typeof mountFace>) => w.get('[data-cam="ready"]').trigger('click')

/** 等几拍宏任务，让 rAF 排的识别循环真的跑起来 */
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 10))
}

beforeEach(() => {
  // face-api 全部替身：每个用例都从「加载成功、识别出 0 张脸」这个干净状态开始
  vi.mocked(ensureFaceApiLoaded).mockReset().mockResolvedValue(undefined)
  vi.mocked(extractFaces).mockReset().mockResolvedValue([])
  vi.mocked(getRegistry).mockReset().mockReturnValue([])
  patchMediaElements()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('FaceCameraCapture 文案与透传', () => {
  it('把三个按钮文案换成人脸页的措辞', () => {
    const w = mountFace()
    const stub = cameraStub(w)
    expect(stub.props('openLabel')).toBe('image.faceStudio.useCamera')
    expect(stub.props('captureLabel')).toBe('image.faceStudio.cameraCapture')
    expect(stub.props('closeLabel')).toBe('image.faceStudio.closeCamera')
  })

  it('拍照原样透传 capture', async () => {
    const w = mountFace()
    await w.get('[data-cam="capture"]').trigger('click')
    expect(w.emitted('capture')?.[0]?.[0]).toBeInstanceOf(File)
  })

  it('关闭原样透传 close', async () => {
    const w = mountFace()
    await w.get('[data-cam="close"]').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})

describe('FaceCameraCapture 非 live', () => {
  it('不叠加任何识别层（画布 / 角标 / 说明都不渲染）', async () => {
    const w = mountFace()
    await ready(w)
    await flushPromises()

    expect(overlayCanvas(w).exists()).toBe(false)
    expect(w.text()).not.toContain('image.faceStudio.liveRecognition')
    expect(w.text()).not.toContain('image.faceStudio.liveHint')
  })

  it('不去加载 face-api（省掉一个几 MB 的模型）', async () => {
    const w = mountFace()
    await ready(w)
    await flushPromises()
    expect(ensureFaceApiLoaded).not.toHaveBeenCalled()
  })
})

describe('FaceCameraCapture live', () => {
  it('挂载即铺好叠加层，但未就绪时不可见、标「分析中」', async () => {
    const w = mountFace({ live: true })
    expect(overlayCanvas(w).exists()).toBe(true)
    expect(overlayCanvas(w).classes()).toContain('opacity-0')
    expect(w.text()).toContain('image.faceStudio.analyzing')
    await ready(w)
  })

  it('模型还没返回时保持「分析中」（不提前把空画布亮出来）', async () => {
    vi.mocked(ensureFaceApiLoaded).mockImplementation(() => new Promise(() => {}))
    const w = mountFace({ live: true })
    await ready(w)
    await flushPromises()

    expect(w.text()).toContain('image.faceStudio.analyzing')
    expect(overlayCanvas(w).classes()).toContain('opacity-0')
  })

  it('模型就绪后画布可见并切到「识别中」', async () => {
    const w = mountFace({ live: true })
    await ready(w)
    await flushPromises()

    expect(ensureFaceApiLoaded).toHaveBeenCalledTimes(1)
    expect(overlayCanvas(w).classes()).toContain('opacity-100')
    expect(w.text()).toContain('image.faceStudio.liveRecognition')
    expect(w.text()).toContain('image.faceStudio.liveHint')
  })

  it('识别循环真的在跑：逐帧喂给 face-api', async () => {
    const w = mountFace({ live: true })
    await ready(w)
    await flushPromises()
    await settle()

    expect(extractFaces).toHaveBeenCalled()
    expect(getRegistry).toHaveBeenCalled()
    w.unmount()
  })

  it('模型加载失败：不崩、给出人话错误、画布保持不可见', async () => {
    vi.mocked(ensureFaceApiLoaded).mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    const w = mountFace({ live: true })
    await ready(w)
    await flushPromises()

    expect(w.find('[data-stub="UAlert"]').text()).toContain('errors.permission')
    expect(overlayCanvas(w).classes()).toContain('opacity-0')
  })

  it('识别开始时清掉上一次的错误提示（重试不再挂着旧错误）', async () => {
    vi.mocked(ensureFaceApiLoaded).mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    const w = mountFace({ live: true })
    await ready(w)
    await flushPromises()
    expect(w.find('[data-stub="UAlert"]').exists()).toBe(true)

    // 第二次关闭再打开（取帧组件会重新 emit ready），这次模型加载成功
    await w.get('[data-cam="close"]').trigger('click')
    await ready(w)
    await flushPromises()
    expect(w.find('[data-stub="UAlert"]').exists()).toBe(false)
    expect(w.text()).toContain('image.faceStudio.liveRecognition')
  })

  it('关闭时清掉识别状态（下次打开重新走「分析中」）', async () => {
    const w = mountFace({ live: true })
    await ready(w)
    await flushPromises()
    expect(w.text()).toContain('image.faceStudio.liveRecognition')

    await w.get('[data-cam="close"]').trigger('click')
    await flushPromises()
    expect(w.text()).not.toContain('image.faceStudio.liveRecognition')
  })

  it('卸载时取消识别循环（不在页面之外继续跑 rAF）', async () => {
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame')
    const w = mountFace({ live: true })
    await ready(w)
    await flushPromises()
    await settle()

    w.unmount()
    wrapper = undefined
    expect(cancel).toHaveBeenCalled()
  })
})
