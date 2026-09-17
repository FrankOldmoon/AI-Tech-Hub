// @vitest-environment happy-dom
/**
 * 全站唯一的摄像头取帧组件。
 * 覆盖：开流 → 预览就绪（ready）→ 拍照（capture）→ 关闭 / 卸载停轨，以及权限失败与
 * 不支持设备时的降级表现（只给错误提示，不崩）。getUserMedia 与 video/canvas 能力都是假的。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import { fakeStream, mockGetUserMedia, patchMediaElements, uiStubs } from './support'
import WebcamCapture from '~/components/WebcamCapture.vue'

function mountCamera(props: Record<string, unknown> = {}, slots: Record<string, unknown> = {}) {
  return mount(WebcamCapture as never, {
    props,
    slots,
    global: { stubs: uiStubs }
  })
}

const video = (wrapper: ReturnType<typeof mountCamera>) => wrapper.find('video')
const buttonByText = (wrapper: ReturnType<typeof mountCamera>, text: string) =>
  wrapper.findAll('button').find(b => b.text().includes(text))

beforeEach(() => {
  vi.restoreAllMocks()
  patchMediaElements()
})

describe('WebcamCapture 开流', () => {
  it('挂载即申请摄像头（只要视频、不要音频）', async () => {
    const { stream } = fakeStream()
    const getUserMedia = mockGetUserMedia(() => Promise.resolve(stream))
    mountCamera()
    await flushPromises()

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia.mock.calls[0]?.[0]).toEqual({ video: { facingMode: 'user' }, audio: false })
  })

  it('开流成功后进入预览态：video 出现且拿到流', async () => {
    const { stream } = fakeStream()
    mockGetUserMedia(() => Promise.resolve(stream))
    const wrapper = mountCamera()
    await flushPromises()

    expect(video(wrapper).exists()).toBe(true)
    expect(video(wrapper).element.srcObject).toBe(stream)
    expect(buttonByText(wrapper, 'webcam.capture')).toBeDefined()
    expect(buttonByText(wrapper, 'webcam.closeCamera')).toBeDefined()
  })

  it('预览就绪后 emit ready 并把 video 元素交出去（上层据此挂逐帧循环）', async () => {
    const { stream } = fakeStream()
    mockGetUserMedia(() => Promise.resolve(stream))
    const wrapper = mountCamera()
    await flushPromises()

    const ready = wrapper.emitted('ready')
    expect(ready).toHaveLength(1)
    expect(ready?.[0]?.[0]).toBe(video(wrapper).element)
  })

  it('再次点开不会重复申请（active 时直接返回）', async () => {
    const { stream } = fakeStream()
    const getUserMedia = mockGetUserMedia(() => Promise.resolve(stream))
    const wrapper = mountCamera()
    await flushPromises()

    await (wrapper.vm as unknown as { open: () => Promise<void> }).open()
    await flushPromises()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
})

describe('WebcamCapture 拍照', () => {
  it('把当前帧导出成 JPEG File 并 emit capture', async () => {
    const { stream } = fakeStream()
    mockGetUserMedia(() => Promise.resolve(stream))
    const wrapper = mountCamera()
    await flushPromises()

    await buttonByText(wrapper, 'webcam.capture')?.trigger('click')
    await flushPromises()

    const captured = wrapper.emitted('capture')
    expect(captured).toHaveLength(1)
    const file = captured?.[0]?.[0] as File
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/jpeg')
    expect(file.name).toMatch(/^camera-\d+\.jpg$/)
  })

  it('拿不到有效视频帧时报错而不是抛异常', async () => {
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      get: () => 0
    })
    const { stream } = fakeStream()
    mockGetUserMedia(() => Promise.resolve(stream))
    const wrapper = mountCamera()
    await flushPromises()

    await buttonByText(wrapper, 'webcam.capture')?.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('capture')).toBeUndefined()
    expect(wrapper.find('[data-stub="UAlert"]').text()).toContain('errors.unknown')
  })
})

describe('WebcamCapture 关闭与卸载', () => {
  it('点关闭：停掉轨道、emit close、回到按钮态', async () => {
    const { stream, stop } = fakeStream()
    mockGetUserMedia(() => Promise.resolve(stream))
    const wrapper = mountCamera()
    await flushPromises()

    await buttonByText(wrapper, 'webcam.closeCamera')?.trigger('click')
    await flushPromises()

    expect(stop).toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(video(wrapper).exists()).toBe(false)
    expect(buttonByText(wrapper, 'webcam.useCamera')).toBeDefined()
  })

  it('组件卸载时自动停轨道（离开页面不会留下亮着的摄像头）', async () => {
    const { stream, stop } = fakeStream()
    mockGetUserMedia(() => Promise.resolve(stream))
    const wrapper = mountCamera()
    await flushPromises()

    wrapper.unmount()
    expect(stop).toHaveBeenCalled()
  })

  it('toggle 暴露出来：开着的停掉、没开的打开', async () => {
    const { stream, stop } = fakeStream()
    const getUserMedia = mockGetUserMedia(() => Promise.resolve(stream))
    const wrapper = mountCamera()
    await flushPromises()

    const api = wrapper.vm as unknown as { toggle: () => void }
    api.toggle()
    await flushPromises()
    expect(stop).toHaveBeenCalledTimes(1)

    api.toggle()
    await flushPromises()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })
})

describe('WebcamCapture 降级', () => {
  it('权限被拒：给分类过的人话错误，且仍停在按钮态可以重试', async () => {
    const getUserMedia = mockGetUserMedia(() =>
      Promise.reject(new DOMException('denied', 'NotAllowedError'))
    )
    const wrapper = mountCamera()
    await flushPromises()

    expect(wrapper.find('[data-stub="UAlert"]').text()).toContain('errors.permission')
    const retry = buttonByText(wrapper, 'webcam.useCamera')
    expect(retry).toBeDefined()

    await retry?.trigger('click')
    await flushPromises()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })

  it('重试成功后可正常进入预览态', async () => {
    const { stream } = fakeStream()
    const getUserMedia = mockGetUserMedia(() =>
      Promise.reject(new DOMException('denied', 'NotAllowedError'))
    )
    const wrapper = mountCamera()
    await flushPromises()

    getUserMedia.mockResolvedValueOnce(stream)
    await buttonByText(wrapper, 'webcam.useCamera')?.trigger('click')
    await flushPromises()

    expect(video(wrapper).exists()).toBe(true)
    expect(wrapper.find('[data-stub="UAlert"]').exists()).toBe(false)
  })

  it('设备被占用：错误文案走 errors.deviceBusy', async () => {
    mockGetUserMedia(() => Promise.reject(new DOMException('busy', 'NotReadableError')))
    const wrapper = mountCamera()
    await flushPromises()
    expect(wrapper.find('[data-stub="UAlert"]').text()).toContain('errors.deviceBusy')
  })

  it('浏览器不支持 getUserMedia：给出 unsupported 提示且不去调它', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    const wrapper = mountCamera()
    await flushPromises()

    expect(wrapper.find('[data-stub="UAlert"]').text()).toContain('errors.unsupported')
    expect(video(wrapper).exists()).toBe(false)
  })
})

describe('WebcamCapture 文案与插槽', () => {
  it('未开摄像头时用 openLabel（默认 webcam.useCamera）', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    const wrapper = mountCamera({ openLabel: '打开相机' })
    await flushPromises()
    expect(buttonByText(wrapper, '打开相机')).toBeDefined()
  })

  it('预览态的拍照 / 关闭文案可覆盖', async () => {
    const { stream } = fakeStream()
    mockGetUserMedia(() => Promise.resolve(stream))
    const wrapper = mountCamera({ captureLabel: '拍一张', closeLabel: '关掉' })
    await flushPromises()
    expect(buttonByText(wrapper, '拍一张')).toBeDefined()
    expect(buttonByText(wrapper, '关掉')).toBeDefined()
  })

  it('overlay 插槽在预览态渲染，并把 video / active 作用域交出去', async () => {
    const { stream } = fakeStream()
    mockGetUserMedia(() => Promise.resolve(stream))
    const wrapper = mountCamera({}, {
      overlay: (scope: { active: boolean }) =>
        h('i', { 'data-overlay': '', 'data-active': String(scope.active) })
    })
    await flushPromises()

    const overlay = wrapper.find('[data-overlay]')
    expect(overlay.exists()).toBe(true)
    expect(overlay.attributes('data-active')).toBe('true')
  })

  it('footer 插槽在预览态渲染（放「实时识别中」这类说明）', async () => {
    const { stream } = fakeStream()
    mockGetUserMedia(() => Promise.resolve(stream))
    const wrapper = mountCamera({}, { footer: () => h('p', { 'data-footer': '' }, '识别中') })
    await flushPromises()
    expect(wrapper.find('[data-footer]').text()).toBe('识别中')
  })

  it('未开摄像头时不渲染 overlay / footer（插槽只在预览态出现）', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    const wrapper = mountCamera({}, {
      overlay: () => h('i', { 'data-overlay': '' }),
      footer: () => h('p', { 'data-footer': '' })
    })
    await flushPromises()
    expect(wrapper.find('[data-overlay]').exists()).toBe(false)
    expect(wrapper.find('[data-footer]').exists()).toBe(false)
  })
})
