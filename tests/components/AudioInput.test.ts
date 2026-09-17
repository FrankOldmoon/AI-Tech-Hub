// @vitest-environment happy-dom
/**
 * 通用音频输入组件：上传 / 麦克风实时 / 录音三种形态的展示与意图上报。
 * 它自己不持有状态（状态来自 useAudioInput），所以断言的就是「按 props 渲染成什么样、
 * 按操作上报什么事件」——这层是各语音页共用 UI 的唯一真源。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { uiStubs } from './support'
import AudioInput from '~/components/AudioInput.vue'
import AudioSourceToggle from '~/components/AudioSourceToggle.vue'

const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac'

function mountInput(props: Record<string, unknown> = {}, slots: Record<string, unknown> = {}) {
  return mount(AudioInput as never, {
    props: { mode: 'file', ...props },
    slots,
    global: { stubs: uiStubs, components: { AudioSourceToggle } }
  })
}

const buttons = (wrapper: ReturnType<typeof mountInput>) => wrapper.findAll('button')
const buttonByText = (wrapper: ReturnType<typeof mountInput>, text: string) =>
  buttons(wrapper).find(b => b.text().includes(text))

describe('AudioInput 来源切换', () => {
  it('只有一种形态时不渲染切换器', () => {
    const wrapper = mountInput({ modes: ['record'], mode: 'record' })
    expect(wrapper.findComponent(AudioSourceToggle).exists()).toBe(false)
  })

  it('多种形态时渲染切换器，选项与顺序跟随 modes', () => {
    const wrapper = mountInput({ modes: ['record', 'file'], mode: 'record' })
    const toggle = wrapper.findComponent(AudioSourceToggle)
    expect(toggle.props('items').map((i: { key: string }) => i.key)).toEqual(['record', 'file'])
    expect(toggle.text()).toContain('speech.sourceRecord')
    expect(toggle.text()).toContain('speech.sourceFile')
  })

  it('切换器选择后上报 update:mode', async () => {
    const wrapper = mountInput({ modes: ['mic', 'file'], mode: 'mic' })
    await buttonByText(wrapper, 'speech.sourceFile')?.trigger('click')
    expect(wrapper.emitted('update:mode')).toEqual([['file']])
  })

  it('切换器排在提示与控件之前', () => {
    const wrapper = mountInput({ modes: ['record', 'file'], mode: 'record' }, {
      hint: (scope: { mode: string }) => h('i', { 'data-slot': 'hint', 'data-mode': scope.mode })
    })
    const html = wrapper.html()
    expect(html.indexOf('speech.sourceRecord')).toBeLessThan(html.indexOf('data-slot="hint"'))
  })
})

describe('AudioInput 文件模式', () => {
  it('默认 accept 用音频全集，上传按钮文案落在「上传音频」', () => {
    const wrapper = mountInput()
    expect(wrapper.get('input[type="file"]').attributes('accept')).toBe(AUDIO_ACCEPT)
    expect(buttonByText(wrapper, 'speech.uploadAudio')).toBeDefined()
  })

  it('uploadLabel 与 fileName 依次覆盖上传按钮文案（已选文件优先）', () => {
    const custom = mountInput({ uploadLabel: '上传参考音' })
    expect(buttonByText(custom, '上传参考音')).toBeDefined()

    const picked = mountInput({ uploadLabel: '上传参考音', fileName: 'my.wav' })
    expect(buttonByText(picked, 'my.wav')).toBeDefined()
    expect(buttonByText(picked, '上传参考音')).toBeUndefined()
  })

  it('点上传按钮打开系统选择器', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    const wrapper = mountInput()
    await buttonByText(wrapper, 'speech.uploadAudio')?.trigger('click')
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('选中文件后上报 select(file)，并清空 input 以便再选同一个文件', async () => {
    const wrapper = mountInput()
    const input = wrapper.get('input[type="file"]')
    const file = new File(['x'], 'a.wav', { type: 'audio/wav' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    // happy-dom 只允许把 file input 的 value 置空，所以这里自建一个可写属性来模拟「已选过文件」
    Object.defineProperty(input.element, 'value', {
      value: 'C:\\fakepath\\a.wav',
      configurable: true,
      writable: true
    })
    await input.trigger('change')

    expect(wrapper.emitted('select')).toEqual([[file]])
    expect(input.element.value).toBe('')
  })

  it('没有选中文件时不产生 select', async () => {
    const wrapper = mountInput()
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [], configurable: true })
    await input.trigger('change')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('每个示例一个按钮，点击上报 sample(url)', async () => {
    const wrapper = mountInput({
      samples: [
        { label: '中文示例', url: '/samples/audio/speech-zh.wav' },
        { label: '英文示例', url: '/samples/audio/speech.wav' }
      ]
    })
    await buttonByText(wrapper, '英文示例')?.trigger('click')
    expect(wrapper.emitted('sample')).toEqual([['/samples/audio/speech.wav']])
  })

  it('不给 samples 就没有示例按钮（只留上传一个动作）', () => {
    const wrapper = mountInput()
    expect(wrapper.find('[data-icon="i-lucide-flask-conical"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-icon="i-lucide-upload"]')).toHaveLength(1)
  })
})

describe('AudioInput 采集模式', () => {
  it('未采集时给「开始」按钮，文案默认 speech.recordStart 且可覆盖', () => {
    const fallback = mountInput({ mode: 'record' })
    expect(buttonByText(fallback, 'speech.recordStart')).toBeDefined()

    const custom = mountInput({ mode: 'record', startLabel: '开始检测' })
    expect(buttonByText(custom, '开始检测')).toBeDefined()
  })

  it('采集模式不再渲染上传入口与示例按钮', () => {
    const wrapper = mountInput({ mode: 'record', samples: [{ label: 'A', url: '/a.wav' }] })
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
    expect(buttonByText(wrapper, 'speech.uploadAudio')).toBeUndefined()
  })

  it('采集中换成「停止」按钮，文案默认 speech.recordStop 且可覆盖', () => {
    const fallback = mountInput({ mode: 'record', active: true })
    expect(buttonByText(fallback, 'speech.recordStop')).toBeDefined()

    const custom = mountInput({ mode: 'record', active: true, stopLabel: '停止检测' })
    expect(buttonByText(custom, '停止检测')).toBeDefined()
  })

  it('秒数 > 0 时附在停止按钮上，为 0 时不加括号', () => {
    const ticking = mountInput({ mode: 'record', active: true, seconds: 7 })
    expect(buttonByText(ticking, '(7s)')).toBeDefined()

    const justStarted = mountInput({ mode: 'record', active: true, seconds: 0 })
    expect(buttonByText(justStarted, '(0s)')).toBeUndefined()
  })

  it('点开始 / 停止分别上报 start / stop', async () => {
    const idle = mountInput({ mode: 'record' })
    await buttonByText(idle, 'speech.recordStart')?.trigger('click')
    expect(idle.emitted('start')).toHaveLength(1)

    const running = mountInput({ mode: 'record', active: true })
    await buttonByText(running, 'speech.recordStop')?.trigger('click')
    expect(running.emitted('stop')).toHaveLength(1)
  })

  it('采集中即使 disabled 也留得住「停止」（跑模型时不能把人困在录音里）', () => {
    const wrapper = mountInput({ mode: 'record', active: true, disabled: true })
    expect(buttonByText(wrapper, 'speech.recordStop')?.attributes('disabled')).toBeUndefined()
  })
})

describe('AudioInput 播放器', () => {
  it('file / record 模式给了 fileUrl 就渲染播放器', () => {
    for (const mode of ['file', 'record']) {
      const wrapper = mountInput({ mode, fileUrl: 'blob:abc' })
      expect(wrapper.find('audio').attributes('src')).toBe('blob:abc')
    }
  })

  it('麦克风实时模式不渲染播放器（逐帧分析没有可播的产物）', () => {
    const wrapper = mountInput({ mode: 'mic', fileUrl: 'blob:abc' })
    expect(wrapper.find('audio').exists()).toBe(false)
  })

  it('没有 fileUrl 时不渲染播放器', () => {
    expect(mountInput({ mode: 'file' }).find('audio').exists()).toBe(false)
    expect(mountInput({ mode: 'file', fileUrl: '' }).find('audio').exists()).toBe(false)
  })
})

describe('AudioInput 插槽', () => {
  const slots = {
    hint: (scope: { mode: string }) => h('i', { 'data-slot': 'hint', 'data-mode': scope.mode }),
    status: (scope: { mode: string }) => h('i', { 'data-slot': 'status', 'data-mode': scope.mode }),
    actions: (scope: { mode: string }) => h('i', { 'data-slot': 'actions', 'data-mode': scope.mode }),
    extra: (scope: { mode: string }) => h('i', { 'data-slot': 'extra', 'data-mode': scope.mode })
  }

  it('四个插槽都按当前 mode 作用域渲染', () => {
    const wrapper = mountInput({ mode: 'record' }, slots)
    const marks = wrapper.findAll('[data-slot]')
    expect(marks.map(m => m.attributes('data-slot'))).toEqual(['hint', 'status', 'actions', 'extra'])
    expect(marks.every(m => m.attributes('data-mode') === 'record')).toBe(true)
  })

  it('没有 status 插槽的形态（文件模式）不渲染它', () => {
    const wrapper = mountInput({ mode: 'file' }, slots)
    expect(wrapper.findAll('[data-slot]').map(m => m.attributes('data-slot')))
      .toEqual(['hint', 'actions', 'extra'])
  })

  it('顺序固定：提示 → 控件/状态 → actions → 播放器 → extra', () => {
    const wrapper = mountInput({ mode: 'record', fileUrl: 'blob:abc' }, slots)
    const marks = wrapper.findAll('[data-slot], audio')
      .map(n => n.attributes('data-slot') ?? 'audio')
    expect(marks).toEqual(['hint', 'status', 'actions', 'audio', 'extra'])
  })
})

describe('AudioInput 禁用', () => {
  it('文件模式下上传与示例按钮都禁用', () => {
    const wrapper = mountInput({ disabled: true, samples: [{ label: 'A', url: '/a.wav' }] })
    for (const button of buttons(wrapper)) {
      expect(button.attributes('disabled')).toBeDefined()
    }
  })

  it('采集模式下的「开始」按钮禁用', () => {
    const wrapper = mountInput({ mode: 'record', disabled: true })
    expect(buttonByText(wrapper, 'speech.recordStart')?.attributes('disabled')).toBeDefined()
  })

  it('禁用时禁用态也传给切换器', () => {
    const wrapper = mountInput({ modes: ['record', 'file'], mode: 'record', disabled: true })
    expect(wrapper.findComponent(AudioSourceToggle).props('disabled')).toBe(true)
  })
})
