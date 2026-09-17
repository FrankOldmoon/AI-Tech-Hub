// @vitest-environment happy-dom
/**
 * 来源切换器（麦克风 / 上传文件 / 自定义项）。
 * 它是 AudioInput 与多个语音页共用的那一排胶囊按钮，只做「显示 + 上报选择 + 禁用」。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { uiStubs } from './support'
import AudioSourceToggle from '~/components/AudioSourceToggle.vue'

function mountToggle(props: Record<string, unknown> = {}) {
  return mount(AudioSourceToggle as never, {
    props: { modelValue: 'mic', ...props },
    global: { stubs: uiStubs }
  })
}

describe('AudioSourceToggle', () => {
  it('默认渲染「麦克风 + 上传文件」两项，顺序固定', () => {
    const toggle = mountToggle()
    const buttons = toggle.findAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.text()).toBe('speech.sourceMic')
    expect(buttons[1]?.text()).toBe('speech.sourceFile')
  })

  it('当前项高亮：只有选中项带主色类', () => {
    const toggle = mountToggle({ modelValue: 'file' })
    const buttons = toggle.findAll('button')
    expect(buttons[0]?.classes()).not.toContain('bg-primary')
    expect(buttons[1]?.classes()).toContain('bg-primary')
  })

  it('点击某一项上报 update:modelValue（带该项 key）', async () => {
    const toggle = mountToggle()
    await toggle.findAll('button')[1]?.trigger('click')
    expect(toggle.emitted('update:modelValue')).toEqual([['file']])
  })

  it('items 自定义时按给定顺序渲染，key / label / icon 都生效', () => {
    const toggle = mountToggle({
      modelValue: 'record',
      items: [
        { key: 'record', label: '录音', icon: 'i-lucide-circle-dot' },
        { key: 'file', label: '上传', icon: 'i-lucide-file-audio' }
      ]
    })
    const buttons = toggle.findAll('button')
    expect(buttons.map(b => b.text())).toEqual(['录音', '上传'])
    expect(buttons[0]?.find('[data-icon]').attributes('data-icon')).toBe('i-lucide-circle-dot')
    expect(buttons[0]?.classes()).toContain('bg-primary')
  })

  it('未给 icon 的自定义项回落一个占位图标，不会渲染出空 name', () => {
    const toggle = mountToggle({
      modelValue: 'a',
      items: [{ key: 'a', label: 'A' }]
    })
    expect(toggle.find('[data-icon]').attributes('data-icon')).toBe('i-lucide-circle')
  })

  it('disabled 时两个按钮都不可点', () => {
    const toggle = mountToggle({ disabled: true })
    for (const button of toggle.findAll('button')) {
      expect(button.attributes('disabled')).toBeDefined()
    }
  })
})
