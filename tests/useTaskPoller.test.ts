import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaskPoller } from '../app/composables/useTaskPoller'

describe('useTaskPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // @ts-expect-error 测试中注入全局 $fetch
    globalThis.$fetch = vi.fn()
  })

  it('任务 done 时调用 onDone 并返回 true', async () => {
    vi.mocked(globalThis.$fetch).mockResolvedValue({
      ok: true,
      task: { status: 'done', progress: 100, resultUrl: '/x.png' }
    })
    const onDone = vi.fn()
    const { poll } = useTaskPoller({ onDone })
    const p = poll('/api/task/1')
    await vi.advanceTimersByTimeAsync(0)
    await expect(p).resolves.toBe(true)
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }))
  })

  it('任务超时后报错并停止轮询', async () => {
    vi.mocked(globalThis.$fetch).mockResolvedValue({
      ok: true,
      task: { status: 'pending', progress: 10 }
    })
    const error = { value: null as string | null }
    const { poll } = useTaskPoller({
      error,
      timeoutMs: 1000,
      interval: 100,
      timeoutMessage: 'TIMEOUT'
    })
    const p = poll('/api/task/1')
    await vi.advanceTimersByTimeAsync(1100)
    await expect(p).resolves.toBe(false)
    expect(error.value).toBe('TIMEOUT')
  })

  it('网络瞬断容忍后恢复（不超过 maxFetchFailures）', async () => {
    vi.mocked(globalThis.$fetch)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true, task: { status: 'done', progress: 100 } })
    const onDone = vi.fn()
    const { poll } = useTaskPoller({ onDone, maxFetchFailures: 3, interval: 10 })
    const p = poll('/api/task/1')
    await vi.advanceTimersByTimeAsync(50)
    await expect(p).resolves.toBe(true)
    expect(onDone).toHaveBeenCalled()
  })

  it('连续失败超过 maxFetchFailures 时放弃', async () => {
    vi.mocked(globalThis.$fetch).mockRejectedValue(new Error('network'))
    const error = { value: null as string | null }
    const { poll } = useTaskPoller({ error, maxFetchFailures: 2, interval: 10, failMessage: 'FAIL' })
    const p = poll('/api/task/1')
    await vi.advanceTimersByTimeAsync(100)
    await expect(p).resolves.toBe(false)
    expect(error.value).toBe('FAIL')
  })
})
