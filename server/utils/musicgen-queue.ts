/**
 * 文生音乐异步任务队列（MusicGen-small，常驻 worker）
 *
 * - POST /api/speech/musicgen -> 立即返回 taskId（body: { prompt, duration }）
 * - GET  /api/speech/musicgen/:id -> 轮询进度/状态
 * - DELETE /api/speech/musicgen/:id -> 取消任务
 *
 * 模型常驻优化（~1.5GB，按 skill 规范必须常驻）：
 * - worker.py 启动时加载模型一次，之后多次生成秒级/分钟级复用
 * - worker 空闲 30 分钟自动退出释放内存，下次任务自动重启
 * - 并发上限 1（模型内存占用大），通过 MUSICGEN_THREADS 限制线程
 */

import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const PYTHON_ROOT = resolve(process.cwd(), 'python')
const FEATURE_DIR = join(PYTHON_ROOT, 'speech', 'musicgen')
const PUBLIC_GEN = resolve(process.cwd(), 'public', 'generated', 'musicgen')

const MAX_CONCURRENT = 1
const MUSICGEN_THREADS = Number(process.env.MUSICGEN_THREADS || 6)
const WORKER_IDLE_TIMEOUT = 30 * 60 * 1000 // 30 分钟空闲自动退出
const GEN_TIMEOUT = 10 * 60 * 1000 // 单次生成超时 10 分钟

export type MusicgenStatus = 'queued' | 'loading' | 'generating' | 'done' | 'error' | 'cancelled'

export interface MusicgenTaskView {
  id: string
  status: MusicgenStatus
  progress: number
  message: string
  error?: string
  audioUrl?: string
  createdAt: number
}

interface MusicgenTask extends MusicgenTaskView {
  prompt: string
  duration: number
  cancelled: boolean
}

const tasks = new Map<string, MusicgenTask>()
let running = 0
const queue: Array<() => void> = []

// ===== 常驻 Worker =====
interface WorkerHandle {
  proc: ReturnType<typeof spawn>
  loaded: boolean
  busy: boolean
  pending: { resolve: (out: string) => void, reject: (e: Error) => void } | null
  idleTimer: NodeJS.Timeout | null
  loadPromise: Promise<void> | null
  loadError: Error | null
}

let worker: WorkerHandle | null = null

function findVenvPython(): string | null {
  const candidates = [
    join(FEATURE_DIR, '.venv', 'Scripts', 'python.exe'),
    join(FEATURE_DIR, '.venv', 'bin', 'python'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function armIdleTimer(h: WorkerHandle): void {
  if (h.idleTimer) clearTimeout(h.idleTimer)
  h.idleTimer = setTimeout(() => {
    try { h.proc.kill() } catch { /* ignore */ }
  }, WORKER_IDLE_TIMEOUT)
}

function spawnWorker(): WorkerHandle {
  const venvPython = findVenvPython()
  if (!venvPython) throw new Error('venv not found')

  const proc = spawn(venvPython, ['worker.py'], {
    cwd: FEATURE_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MUSICGEN_THREADS: String(MUSICGEN_THREADS),

    },
  })
  const h: WorkerHandle = {
    proc,
    loaded: false,
    busy: false,
    pending: null,
    idleTimer: null,
    loadPromise: null,
    loadError: null,
  }

  const rl = createInterface({ input: proc.stdout })
  rl.on('line', (line) => {
    const t = line.trim()
    if (!t.startsWith('{')) return
    let msg: any
    try { msg = JSON.parse(t) } catch { return }
    if (msg.type === 'ready' || msg.type === 'loaded') {
      if (msg.type === 'loaded') {
        h.loaded = true
        h.loadError = null
      }
      return
    }
    if (h.pending) {
      const p = h.pending
      h.pending = null
      h.busy = false
      armIdleTimer(h)
      if (msg.type === 'done') p.resolve(msg.out)
      else p.reject(new Error(msg.error || 'worker error'))
    }
  })

  proc.stderr.on('data', () => { /* worker 日志 */ })
  proc.on('exit', () => {
    if (worker === h) worker = null
    if (h.pending) {
      h.pending.reject(new Error('worker exited'))
      h.pending = null
    }
    h.busy = false
    h.loaded = false
    if (h.idleTimer) clearTimeout(h.idleTimer)
  })
  proc.on('error', (e) => {
    h.loadError = e
    if (h.pending) {
      h.pending.reject(e)
      h.pending = null
    }
  })

  return h
}

async function ensureWorker(): Promise<WorkerHandle> {
  if (worker?.loaded && worker.proc.exitCode === null) return worker
  if (worker && !worker.loaded && worker.proc.exitCode === null && worker.loadPromise) {
    await worker.loadPromise
    return worker
  }

  const h = spawnWorker()
  worker = h
  h.loadPromise = new Promise<void>((resolvePromise, reject) => {
    const check = setInterval(() => {
      if (h.loaded) { clearInterval(check); resolvePromise() }
      if (h.loadError) { clearInterval(check); reject(h.loadError) }
      if (h.proc.exitCode !== null && !h.loaded) {
        clearInterval(check)
        reject(new Error('worker exited before loading'))
      }
    }, 1000)
  })
  try {
    await h.loadPromise
  } catch (e) {
    worker = null
    throw e
  }
  return h
}

function patch(task: MusicgenTask, p: Partial<MusicgenTaskView>): void {
  Object.assign(task, p)
}

function next(): void {
  const run = queue.shift()
  if (run) run()
}

/** 查询任务（返回副本，避免外部篡改） */
export function getMusicgenTask(id: string): MusicgenTaskView | null {
  const t = tasks.get(id)
  if (!t) return null
  const { prompt: _p, duration: _d, cancelled: _x, ...view } = t
  return view
}

/** 取消任务 */
export function cancelMusicgenTask(id: string): boolean {
  const task = tasks.get(id)
  if (!task) return false
  if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') return false
  task.cancelled = true
  patch(task, { status: 'cancelled', progress: 0, message: '已取消' })
  return true
}

async function runTask(task: MusicgenTask): Promise<void> {
  const venvPython = findVenvPython()
  if (!venvPython) {
    patch(task, { status: 'error', progress: 0, message: '文生音乐需要本地 Python 环境（MusicGen），云端部署暂不支持此功能', error: 'venv not found' })
    return
  }
  if (!worker?.loaded) {
    patch(task, { status: 'loading', progress: 10, message: '正在加载 MusicGen 模型（首次约 1-3 分钟，之后生成复用）…' })
  } else {
    patch(task, { status: 'generating', progress: 50, message: '正在生成音乐…' })
  }
  let h: WorkerHandle
  try {
    h = await ensureWorker()
  } catch (e) {
    patch(task, { status: 'error', progress: 10, message: '模型加载失败', error: (e as Error)?.message })
    return
  }
  if (task.cancelled) return
  if (h.busy) {
    patch(task, { status: 'error', progress: 50, message: '生成失败：worker 忙', error: 'worker busy' })
    return
  }
  patch(task, { status: 'generating', progress: 50, message: '正在生成音乐…' })

  const workDir = join(PUBLIC_GEN, task.id)
  mkdirSync(workDir, { recursive: true })
  const outPath = join(workDir, 'music.wav')

  const timer = setTimeout(() => {
    try { h.proc.kill() } catch { /* ignore */ }
  }, GEN_TIMEOUT)

  try {
    const out = await new Promise<string>((resolvePromise, reject) => {
      h.busy = true
      h.pending = { resolve: resolvePromise, reject }
      h.proc.stdin.write(JSON.stringify({
        prompt: task.prompt,
        duration: task.duration,
        out: outPath,
      }) + '\n')
    })
    if (task.cancelled) return
    if (!existsSync(outPath)) {
      patch(task, { status: 'error', progress: 90, message: '未生成音乐文件', error: 'no output file' })
      return
    }
    patch(task, { status: 'done', progress: 100, message: '生成完成', audioUrl: `/generated/musicgen/${task.id}/music.wav` })
  } catch (e) {
    if (!task.cancelled) {
      patch(task, { status: 'error', progress: 50, message: '生成失败', error: (e as Error)?.message })
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 创建并提交文生音乐任务，立即返回 taskId */
export function enqueueMusicgen(prompt: string, duration: number): { ok: boolean, taskId?: string, error?: string } {
  if (process.env.VERCEL) {
    return { ok: false, error: '文生音乐需要本地 Python 环境（MusicGen），云端部署不支持此功能。请在本机运行 pnpm dev 后使用。' }
  }
  const p = (prompt || '').trim()
  if (!p) return { ok: false, error: 'Missing prompt' }
  const d = Math.min(Math.max(Number(duration) || 5, 3), 30)

  const task: MusicgenTask = {
    id: randomUUID(),
    status: 'queued',
    progress: 0,
    message: '排队中…',
    createdAt: Date.now(),
    prompt: p,
    duration: d,
    cancelled: false,
  }
  tasks.set(task.id, task)

  const start = () => {
    running++
    void runTask(task).finally(() => {
      running--
      next()
    })
  }
  if (running < MAX_CONCURRENT) {
    start()
  } else {
    queue.push(start)
  }
  return { ok: true, taskId: task.id }
}
