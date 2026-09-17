/**
 * objectURL 的生命周期。
 * 这是「换一个文件泄漏一个 blob」这类问题的唯一防线：规则是**换新必回收旧的**。
 * 源码注释里记着历史：选文件 / 加载示例 / 切模式 / 卸载四处各写一遍 revoke，漏一处就漏一个 blob。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './support/nuxt-env'
import { useObjectUrl } from '../app/composables/useObjectUrl'

let created = 0
let revoked: string[] = []
/** 捕获 composable 注册的卸载兜底（不在组件里调用不会真的挂上，但能拿到回调） */
let unmountHooks: Array<() => void> = []

beforeEach(() => {
  created = 0
  revoked = []
  unmountHooks = []
  globalThis.URL.createObjectURL = vi.fn(() => `blob:test-${++created}`) as typeof URL.createObjectURL
  globalThis.URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url)
  }) as typeof URL.revokeObjectURL
  stubUnmountHook()
})

/** 替换生命周期钩子以捕获卸载回调（不在组件里调用 onBeforeUnmount 会打 Vue 警告） */
function stubUnmountHook() {
  const g = globalThis as unknown as Record<string, unknown>
  g.onBeforeUnmount = (fn: () => void) => {
    unmountHooks.push(fn)
  }
}

describe('useObjectUrl', () => {
  it('初始为空串', () => {
    const { url } = useObjectUrl()
    expect(url.value).toBe('')
  })

  it('set(blob) 生成 URL 并返回它', () => {
    const { url, set } = useObjectUrl()
    const blob = new Blob(['x'])
    const returned = set(blob)
    expect(returned).toBe('blob:test-1')
    expect(url.value).toBe('blob:test-1')
  })

  it('再次 set 会先回收旧的（换文件不泄漏）', () => {
    const { url, set } = useObjectUrl()
    set(new Blob(['a']))
    set(new Blob(['b']))
    expect(url.value).toBe('blob:test-2')
    expect(revoked).toEqual(['blob:test-1'])
  })

  it('set(null) 等价于 clear：回收并清空', () => {
    const { url, set } = useObjectUrl()
    set(new Blob(['a']))
    set(null)
    expect(url.value).toBe('')
    expect(revoked).toEqual(['blob:test-1'])
  })

  it('clear 回收并清空；空值时重复 clear 不会去 revoke 空串', () => {
    const { url, set, clear } = useObjectUrl()
    clear()
    expect(revoked).toEqual([])

    set(new Blob(['a']))
    clear()
    clear()
    expect(url.value).toBe('')
    expect(revoked).toEqual(['blob:test-1'])
  })

  it('注册了卸载时的兜底回收（组件卸载不靠页面记得手写 revoke）', () => {
    const { set } = useObjectUrl()
    set(new Blob(['a']))
    expect(unmountHooks).toHaveLength(1)

    unmountHooks[0]!()
    expect(revoked).toEqual(['blob:test-1'])
  })

  it('每次都返回新的 URL，不会复用同一个（旧 URL 已被 revoke，复用会指向失效资源）', () => {
    const { set } = useObjectUrl()
    const first = set(new Blob(['a']))
    const second = set(new Blob(['b']))
    expect(first).not.toBe(second)
  })
})
