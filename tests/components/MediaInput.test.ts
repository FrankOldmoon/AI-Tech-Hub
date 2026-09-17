// @vitest-environment happy-dom
/**
 * 通用媒体输入组件（拖拽 / 点击 / 示例 / 摄像头）。
 * 覆盖它的每一个出口：select(file)、sample(url)、error —— 以及摄像头那条支路的开关与拍照。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { WebcamCaptureStub, uiStubs } from './support'
import MediaInput from '~/components/MediaInput.vue'

function mountInput(props: Record<string, unknown> = {}) {
  return mount(MediaInput as never, {
    props,
    global: { stubs: { ...uiStubs, WebcamCapture: WebcamCaptureStub } }
  })
}

/** 拖拽区是组件里唯一带 border-dashed 的元素 */
const dropzone = (wrapper: ReturnType<typeof mountInput>) => wrapper.find('.border-dashed')
const fileInput = (wrapper: ReturnType<typeof mountInput>) => wrapper.find('input[type="file"]')

async function chooseFile(wrapper: ReturnType<typeof mountInput>, file: File) {
  const input = fileInput(wrapper)
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
}

function dropFile(wrapper: ReturnType<typeof mountInput>, file: File) {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.assign(event, { dataTransfer: { files: [file] } })
  dropzone(wrapper).element.dispatchEvent(event)
  return wrapper.vm.$nextTick()
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('MediaInput 上传区', () => {
  it('默认用通用文案与 image/* 的 accept', () => {
    const wrapper = mountInput()
    expect(wrapper.text()).toContain('mediaInput.upload')
    expect(wrapper.text()).toContain('mediaInput.uploadHint')
    expect(fileInput(wrapper).attributes('accept')).toBe('image/*')
  })

  it('title / hint / accept 可被调用方覆盖', () => {
    const wrapper = mountInput({ title: '换张图', hint: '支持 png', accept: 'audio/*' })
    expect(wrapper.text()).toContain('换张图')
    expect(wrapper.text()).toContain('支持 png')
    expect(fileInput(wrapper).attributes('accept')).toBe('audio/*')
  })

  it('点击拖拽区打开系统选择器', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    const wrapper = mountInput()
    await dropzone(wrapper).trigger('click')
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('选中文件后上报 select(file)', async () => {
    const wrapper = mountInput()
    const file = new File(['abc'], 'photo.png', { type: 'image/png' })
    await chooseFile(wrapper, file)
    expect(wrapper.emitted('select')).toEqual([[file]])
    expect(wrapper.emitted('error')).toBeUndefined()
  })

  it('超出 maxSize 时只上报 error，不把文件交出去，并在界面上给出提示', async () => {
    const wrapper = mountInput({ maxSize: 10 })
    await chooseFile(wrapper, new File([new Uint8Array(11)], 'big.png', { type: 'image/png' }))
    expect(wrapper.emitted('select')).toBeUndefined()
    expect(wrapper.emitted('error')?.[0]?.[0]).toContain('mediaInput.tooLarge')
    expect(wrapper.find('[data-stub="UAlert"]').text()).toContain('mediaInput.tooLarge')
  })

  it('恰好等于 maxSize 时放行（边界不外溢）', async () => {
    const wrapper = mountInput({ maxSize: 10 })
    await chooseFile(wrapper, new File([new Uint8Array(10)], 'edge.png', { type: 'image/png' }))
    expect(wrapper.emitted('select')).toHaveLength(1)
  })
})

describe('MediaInput 拖拽', () => {
  it('拖入文件等同于选中文件', async () => {
    const wrapper = mountInput()
    const file = new File(['abc'], 'dropped.png', { type: 'image/png' })
    await dropFile(wrapper, file)
    expect(wrapper.emitted('select')).toEqual([[file]])
  })

  it('拖到上方时高亮，离开后恢复', async () => {
    const wrapper = mountInput()
    const zone = dropzone(wrapper)
    expect(zone.classes()).toContain('border-default')

    await zone.trigger('dragover')
    expect(zone.classes()).toContain('border-primary')

    await zone.trigger('dragleave')
    expect(zone.classes()).not.toContain('border-primary')
  })

  it('没有文件落下时什么也不上报', async () => {
    const wrapper = mountInput()
    const event = new Event('drop', { bubbles: true, cancelable: true })
    dropzone(wrapper).element.dispatchEvent(event)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('select')).toBeUndefined()
    expect(wrapper.emitted('error')).toBeUndefined()
  })
})

describe('MediaInput 示例', () => {
  const samples = [
    { label: '街景', url: '/samples/images/street.jpg' },
    { label: '人脸', url: '/samples/images/face.jpg' }
  ]

  it('每个示例一个按钮，点击只上报 sample(url)', async () => {
    const wrapper = mountInput({ samples })
    const buttons = wrapper.findAll('[data-stub="UButton"]')
    expect(buttons.map(b => b.text())).toEqual(['街景', '人脸'])

    await buttons[1]?.trigger('click')
    expect(wrapper.emitted('sample')).toEqual([['/samples/images/face.jpg']])
  })

  it('点示例不会顺带打开系统选择器（拖拽区上的 .stop 生效）', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    const wrapper = mountInput({ samples })
    await wrapper.findAll('[data-stub="UButton"]')[0]?.trigger('click')
    expect(click).not.toHaveBeenCalled()
  })

  it('不给 samples 时不渲染示例区', () => {
    const wrapper = mountInput()
    expect(wrapper.findAll('[data-stub="UButton"]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('samples.trySample')
  })
})

describe('MediaInput 摄像头', () => {
  it('默认不提供摄像头入口', () => {
    const wrapper = mountInput()
    expect(wrapper.text()).not.toContain('webcam.useCamera')
    expect(wrapper.find('[data-stub="WebcamCapture"]').exists()).toBe(false)
  })

  it('camera 打开后出现按钮，点击才挂载取帧组件', async () => {
    const wrapper = mountInput({ camera: true })
    const button = wrapper.get('button')
    expect(button.text()).toContain('webcam.useCamera')
    expect(wrapper.find('[data-stub="WebcamCapture"]').exists()).toBe(false)

    await button.trigger('click')
    expect(wrapper.find('[data-stub="WebcamCapture"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('webcam.useCamera')
  })

  it('拍照结果与选文件走同一条出口', async () => {
    const wrapper = mountInput({ camera: true })
    await wrapper.get('button').trigger('click')
    await wrapper.get('[data-cam="capture"]').trigger('click')

    const select = wrapper.emitted('select')
    expect(select).toHaveLength(1)
    expect((select?.[0]?.[0] as File).name).toBe('camera-1.jpg')
  })

  it('拍照后收起取帧组件，回到按钮态（避免多实例占用摄像头）', async () => {
    const wrapper = mountInput({ camera: true })
    await wrapper.get('button').trigger('click')
    await wrapper.get('[data-cam="capture"]').trigger('click')
    expect(wrapper.find('[data-stub="WebcamCapture"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('webcam.useCamera')
  })

  it('关闭摄像头也回到按钮态，且不产生 select', async () => {
    const wrapper = mountInput({ camera: true })
    await wrapper.get('button').trigger('click')
    await wrapper.get('[data-cam="close"]').trigger('click')
    expect(wrapper.find('[data-stub="WebcamCapture"]').exists()).toBe(false)
    expect(wrapper.emitted('select')).toBeUndefined()
  })
})

describe('MediaInput 禁用', () => {
  it('disabled 时拖拽区标记不可用、input 与摄像头按钮都禁用', () => {
    const wrapper = mountInput({ disabled: true, camera: true })
    expect(dropzone(wrapper).attributes('aria-disabled')).toBe('true')
    expect(fileInput(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })

  it('disabled 时不打开系统选择器', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    const wrapper = mountInput({ disabled: true })
    await dropzone(wrapper).trigger('click')
    expect(click).not.toHaveBeenCalled()
  })

  it('disabled 时示例按钮上报不了 sample', async () => {
    const wrapper = mountInput({ disabled: true, samples: [{ label: 'A', url: '/a.png' }] })
    await wrapper.get('[data-stub="UButton"]').trigger('click')
    expect(wrapper.emitted('sample')).toBeUndefined()
  })
})
