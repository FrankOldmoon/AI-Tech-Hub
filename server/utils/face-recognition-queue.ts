/**
 * 人脸识别/验证异步任务队列（insightface 常驻 worker）。
 * 模式：
 *   recognition   - 单图 -> { faces, dim, embeddings }
 *   verification  - 双图 -> { similarity, verdict }
 * 状态机与 sd-turbo-queue 一致；结果为 JSON（无文件输出）。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const PYTHON_ROOT = resolve(process.cwd(), 'python')
const FEATURE_DIR = join(PYTHON_ROOT, 'image', 'face-recognition')
const WORK_ROOT = join(process.cwd(), 'tmp', 'face-recognition')

const MAX_CONCURRENT = 1
const WORKER_IDLE_TIMEOUT = 30 * 60 * 1000
const TASK_TIMEOUT = 5 * 60 * 1000

export type FaceRecStatus = 'queued' | 'preparing' | 'loading' | 'processing' | 'done' | 'error' | 'cancelled'

export interface FaceRecTaskView {
  id: string
  status: FaceRecStatus
  progress: number
  message: string
  error?: string
  result?: Record<string, any>
  createdAt: number
}

interface FaceRecTask extends FaceRecTaskView {
  cancelled: boolean
}

interface UploadedFilePart { filename?: string, data: Buffer }

const tasks = new Map<string, FaceRecTask>()
let running = 0
const queue: Array<() => void> = []

let worker: {
  proc: ReturnType<typeof spawn>,
  loaded: boolean,
  busy: boolean,
  pending: { resolve: (o: string) => void, reject: (e: Error) => void } | null,
  idleTimer: NodeJS.Timeout | null,
  loadPromise: Promise<void> | null,
  loadError: Error | null
} | null = null

function findVenvPython(): string | null {
  const candidates = [
    join(FEATURE_DIR, '.venv', 'Scripts', 'python.exe'),
    join(FEATURE_DIR, '.venv', 'bin', 'python')
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function patch(task: FaceRecTask, p: Partial<FaceRecTaskView>): void { Object.assign(task, p) }
function next(): void { const run = queue.shift(); if (run) run() }

function armIdleTimer(h: NonNullable<typeof worker>): void {
  if (!h) return
  if (h.idleTimer) clearTimeout(h.idleTimer)
  h.idleTimer = setTimeout(() => { try { h.proc.kill() } catch { /* ignore */ } }, WORKER_IDLE_TIMEOUT)
}

function spawnWorker(): NonNullable<typeof worker> {
  const venvPython = findVenvPython()
  if (!venvPython) throw new Error('venv not found')
  const proc = spawn(venvPython, ['worker.py'], { cwd: FEATURE_DIR, stdio: ['pipe', 'pipe', 'pipe'] })
  const h = { proc, loaded: false, busy: false, pending: null, idleTimer: null, loadPromise: null, loadError: null }
  const rl = createInterface({ input: proc.stdout })
  rl.on('line', (line) => {
    const t = line.trim(); if (!t.startsWith('{')) return
    let msg: any; try { msg = JSON.parse(t) } catch { return }
    if (msg.type === 'loaded') { h.loaded = true; h.loadError = null; return }
    if (h.pending) {
      const p = h.pending; h.pending = null; h.busy = false; armIdleTimer(h)
      msg.type === 'done' ? p.resolve(msg.result ? JSON.stringify(msg.result) : '{}') : p.reject(new Error(msg.error || 'worker error'))
    }
  })
  proc.on('exit', () => {
    if (worker === h) worker = null
    if (h.pending) { h.pending.reject(new Error('worker exited')); h.pending = null }
    h.busy = false; h.loaded = false
    if (h.idleTimer) clearTimeout(h.idleTimer)
  })
  proc.on('error', (e) => { h.loadError = e; if (h.pending) { h.pending.reject(e); h.pending = null } })
  return h
}

async function ensureWorker(): Promise<NonNullable<typeof worker>> {
  if (worker?.loaded && worker.proc.exitCode === null) return worker
  if (worker && !worker.loaded && worker.proc.exitCode === null && worker.loadPromise) { await worker.loadPromise; return worker }
  const h = spawnWorker(); worker = h
  h.loadPromise = new Promise<void>((resolve, reject) => {
    const check = setInterval(() => {
      if (h.loaded) { clearInterval(check); resolve() }
      if (h.loadError) { clearInterval(check); reject(h.loadError) }
      if (h.proc.exitCode !== null && !h.loaded) { clearInterval(check); reject(new Error('worker exited before loading')) }
    }, 1000)
  })
  try { await h.loadPromise } catch (e) { worker = null; throw e }
  return h
}

export function getFaceRecTask(id: string): FaceRecTaskView | null {
  const t = tasks.get(id); if (!t) return null
  const { cancelled: _x, ...view } = t
  return view
}

export function cancelFaceRecTask(id: string): boolean {
  const task = tasks.get(id); if (!task) return false
  if (['done', 'error', 'cancelled'].includes(task.status)) return false
  task.cancelled = true
  patch(task, { status: 'cancelled', progress: 0, message: '已取消' })
  try { worker?.proc.kill() } catch { /* ignore */ }
  return true
}

async function runTask(task: FaceRecTask, file: UploadedFilePart, file2: UploadedFilePart | null, mode: string): Promise<void> {
  if (!findVenvPython()) {
    patch(task, { status: 'error', progress: 0, message: 'Python 环境尚未就绪，请等待后台安装完成', error: 'venv not found' })
    return
  }
  const workDir = join(WORK_ROOT, task.id)
  mkdirSync(workDir, { recursive: true })
  const ext = extname(file.filename || '').toLowerCase() || '.png'
  const inputPath = join(workDir, `input${ext}`)
  writeFileSync(inputPath, file.data)
  const secondPath = file2 ? join(workDir, `input2${extname(file2.filename || '').toLowerCase() || '.png'}`) : ''
  if (file2) writeFileSync(secondPath, file2.data)

  if (!worker?.loaded) patch(task, { status: 'loading', progress: 10, message: '正在加载 insightface 模型（首次下载 buffalo_l 约 300MB）…' })
  else patch(task, { status: 'processing', progress: 30, message: '正在分析人脸…' })
  try {
    const h = await ensureWorker()
    if (task.cancelled) return
    const resultStr = await new Promise<string>((resolve, reject) => {
      h.busy = true; h.pending = { resolve, reject }
      h.proc.stdin.write(JSON.stringify({ mode, input: inputPath, second: secondPath }) + '\n')
      setTimeout(() => {
        if (h.pending) { const p = h.pending; h.pending = null; h.busy = false; try { h.proc.kill() } catch { /* ignore */ } p.reject(new Error('处理超时')) }
      }, TASK_TIMEOUT)
    })
    if (task.cancelled) return
    let result: Record<string, any> = {}
    try { result = JSON.parse(resultStr) } catch { result = { raw: resultStr } }
    patch(task, { status: 'done', progress: 100, message: '完成', result })
  } catch (e) {
    if (task.cancelled) return
    patch(task, { status: 'error', progress: 10, message: '处理失败', error: (e as Error)?.message })
  }
  rm(workDir, { recursive: true, force: true }).catch(() => {})
}

export function enqueueFaceRec(file: UploadedFilePart, file2: UploadedFilePart | null, mode: string): { ok: boolean, taskId?: string, error?: string } {
  if (!file?.data?.length) return { ok: false, error: '缺少输入图片' }
  if (mode === 'verification' && !file2?.data?.length) return { ok: false, error: '验证模式需要第二张图片' }
  const task: FaceRecTask = { id: randomUUID(), status: 'queued', progress: 0, message: '排队中…', createdAt: Date.now(), cancelled: false }
  tasks.set(task.id, task)
  const start = () => { running++; void runTask(task, file, file2, mode).finally(() => { running--; next() }) }
  running < MAX_CONCURRENT ? start() : queue.push(start)
  return { ok: true, taskId: task.id }
}
