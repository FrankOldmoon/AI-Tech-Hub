/**
 * 给组件测试用的替身。
 *
 * 目的：测一个输入组件时不该把整套 Nuxt UI 与真实摄像头组件拉进来。所以
 * - `uiStubs`：把 UButton / UAlert / UIcon 换成「能渲染、能被点击、文案可断言」的极简实现；
 * - `WebcamCaptureStub`：把取帧组件换成三个可点按钮（ready / capture / close）+ overlay
 *   与 footer 插槽的转发，这样父组件（MediaInput / FaceCameraCapture）的逻辑能被精确驱动。
 */
import { defineComponent, h } from 'vue'

/**
 * UButton：label 变文本、icon 变 data-icon（便于按图标定位按钮），
 * @click / disabled 等透传到真实的 <button>。
 */
export const UButton = defineComponent({
  name: 'UButton',
  inheritAttrs: false,
  props: {
    label: { type: String, default: '' },
    icon: { type: String, default: '' }
  },
  setup(props, { slots, attrs }) {
    return () =>
      h(
        'button',
        { ...attrs, 'data-stub': 'UButton', 'data-icon': props.icon || undefined },
        slots.default?.() ?? props.label
      )
  }
})

/** UAlert：title 变文本内容 */
export const UAlert = defineComponent({
  name: 'UAlert',
  inheritAttrs: false,
  props: { title: { type: String, default: '' } },
  setup(props, { attrs }) {
    return () => h('div', { ...attrs, 'data-stub': 'UAlert' }, props.title)
  }
})

/** UIcon：name 变 data-icon，便于断言「这里用的是哪个图标」 */
export const UIcon = defineComponent({
  name: 'UIcon',
  inheritAttrs: false,
  props: { name: { type: String, default: '' } },
  setup(props, { attrs }) {
    return () => h('i', { ...attrs, 'data-icon': props.name })
  }
})

export const uiStubs = { UButton, UAlert, UIcon }

/**
 * 假摄像头组件：三个按钮分别触发 ready / capture / close，并转发 overlay 与 footer 插槽。
 * 三个 label 声明成 props（而不是留给 attrs），这样上层「文案透传」能被直接断言。
 */
export const WebcamCaptureStub = defineComponent({
  name: 'WebcamCapture',
  inheritAttrs: false,
  props: {
    openLabel: { type: String, default: undefined },
    captureLabel: { type: String, default: undefined },
    closeLabel: { type: String, default: undefined }
  },
  emits: ['capture', 'close', 'ready'],
  setup(_, { slots, emit, attrs }) {
    return () => h('div', { ...attrs, 'data-stub': 'WebcamCapture' }, [
      h(
        'button',
        { 'data-cam': 'ready', 'onClick': () => emit('ready', document.createElement('video')) },
        'ready'
      ),
      h(
        'button',
        {
          'data-cam': 'capture',
          'onClick': () =>
            emit('capture', new File(['frame'], 'camera-1.jpg', { type: 'image/jpeg' }))
        },
        'capture'
      ),
      h('button', { 'data-cam': 'close', 'onClick': () => emit('close') }, 'close'),
      slots.overlay?.({ video: null, active: true }),
      slots.footer?.()
    ])
  }
})

/** AudioSourceToggle 的真实实现会被 AudioInput 用到，这里不替身，直接由测试文件注册 */
