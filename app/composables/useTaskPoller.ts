import { getCurrentInstance, onBeforeUnmount, type Ref } from 'vue'

/** 服务端任务对象：字段因 demo 而异（audioUrl/stems/segments/…），故放开索引类型 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type TaskData = Record<string, any>

export interface TaskPollResult {
  ok: boolean
  task?: TaskData
  error?: string
}

export interface UseTaskPollerOptions {
  /** 轮询间隔（毫秒），默认 1500 */
  interval?: number
  /** 总超时（毫秒），默认 10 分钟；超时后停止轮询并报错 */
  timeoutMs?: number
  /** 连续网络失败容忍次数，默认 3（瞬断不放弃任务） */
  maxFetchFailures?: number
  /** 进度 0-100 */
  progress?: Ref<number>
  /** 进度文案（服务端 message） */
  progressText?: Ref<string>
  /** 错误信息 */
  error?: Ref<string | null>
  /** 查询失败（超过重试次数）时的提示 */
  failMessage?: string
  /** 任务 error 状态且无服务端消息时的兜底提示 */
  errorMessage?: string
  /** 任务 cancelled 状态时的兜底提示 */
  cancelledMessage?: string
  /** 超时提示 */
  timeoutMessage?: string
  /** 任务 done 时回调（从 task 提取结果） */
  onDone?: (task: TaskData) => void
  /** 任务 error 时回调，返回自定义提示可覆盖默认 */
  onError?: (task: TaskData) => string | undefined
  /** 任务 cancelled 时回调，返回自定义提示可覆盖默认 */
  onCancelled?: (task: TaskData) => string | undefined
}

/**
 * 服务端任务轮询器：统一超时上限、卸载自动停止、网络瞬断重试。
 * 用法：const { poll, stop } = useTaskPoller({ progress, progressText, error, onDone })
 *       await poll(`/api/xxx/${taskId}`)
 */
export function useTaskPoller(options: UseTaskPollerOptions = {}) {
  const {
    interval = 1500,
    timeoutMs = 10 * 60 * 1000,
    maxFetchFailures = 3,
    progress,
    progressText,
    error
  } = options

  let stopped = false

  function stop() {
    stopped = true
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(stop)
  }

  function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /** 轮询直到 done/error/cancelled/超时/停止。返回是否成功完成（done）。 */
  async function poll(url: string): Promise<boolean> {
    const startedAt = Date.now()
    let fetchFailures = 0

    while (!stopped) {
      if (Date.now() - startedAt > timeoutMs) {
        if (error) error.value = options.timeoutMessage || '任务超时，请重试'
        return false
      }

      const res = await $fetch<TaskPollResult>(url, { method: 'GET' }).catch(() => null)

      if (stopped) return false

      if (!res || res.ok !== true || !res.task) {
        fetchFailures++
        if (fetchFailures > maxFetchFailures) {
          if (error) error.value = res?.error || options.failMessage || '任务查询失败'
          return false
        }
        await sleep(interval)
        continue
      }

      fetchFailures = 0
      const task = res.task
      if (progress) progress.value = task.progress || 0
      if (progressText) progressText.value = task.message || ''

      if (task.status === 'done') {
        options.onDone?.(task)
        return true
      }
      if (task.status === 'error') {
        const custom = options.onError?.(task)
        if (error) error.value = custom || task.error || task.message || options.errorMessage || '处理失败'
        return false
      }
      if (task.status === 'cancelled') {
        const custom = options.onCancelled?.(task)
        if (error) error.value = custom || task.message || options.cancelledMessage || '已取消'
        return false
      }

      await sleep(interval)
    }
    return false
  }

  return { poll, stop }
}
