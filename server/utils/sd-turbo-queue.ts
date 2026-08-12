/**
 * 文生图/图生图（SD-Turbo）异步任务队列（常驻 worker 模式）
 *
 * - enqueueSdTurbo(file, text, params) / getSdTurboTask() / cancelSdTurboTask()
 * - 状态机: queued → preparing → loading → processing → done/error/cancelled
 * - 模型常驻复用、并发 1、取消时 kill worker、空闲自动退出
 * - 文生图可不传文件；图生图必须传图片
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { basename, extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const PYTHON_ROOT = resolve(process.cwd(), 'python')
const FEATURE_DIR = join(PYTHON_ROOT, 'aigc', 'sd-turbo')
const WORK_ROOT = join(process.cwd(), 'tmp', 'sd-turbo')
const PUBLIC_GEN = resolve(process.cwd(), 'public', 'generated', 'sd-turbo')

const MAX_CONCURRENT = 1
const WORKER_IDLE_TIMEOUT = 30 * 60 * 1000
const TASK_TIMEOUT = 10 * 60 * 1000

export type SdTurboStatus = 'queued' | 'preparing' | 'loading' | 'processing' | 'done' | 'error' | 'cancelled'

export interface SdTurboTaskView {
  id: string
  status: SdTurboStatus
  progress: number
  message: string
  error?: string
  resultUrl?: string
  resultUrls?: string[]
  createdAt: number
}

interface SdTurboTask extends SdTurboTaskView {
  cancelled: boolean
}

interface UploadedFilePart { filename?: string, data: Buffer }

const tasks = new Map<string, SdTurboTask>()
let running = 0
const queue: Array<() => void> = []

let worker: { proc: ReturnType<typeof spawn>, loaded: boolean, busy: boolean, pending: { resolve: (o: string) => void, reject: (e: Error) => void } | null, idleTimer: NodeJS.Timeout | null, loadPromise: Promise<void> | null, loadError: Error | null } | null = null

function findVenvPython(): string | null {
  const candidates = [
    join(FEATURE_DIR, '.venv', 'Scripts', 'python.exe'),
    join(FEATURE_DIR, '.venv', 'bin', 'python'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function patch(task: SdTurboTask, p: Partial<SdTurboTaskView>): void { Object.assign(task, p) }
function next(): void { const run = queue.shift(); if (run) run() }

function armIdleTimer(h: typeof worker): void {
  if (!h) return
  if (h.idleTimer) clearTimeout(h.idleTimer)
  h.idleTimer = setTimeout(() => { try { h.proc.kill() } catch { /* ignore */ } }, WORKER_IDLE_TIMEOUT)
}

function spawnWorker(): NonNullable<typeof worker> {
  const venvPython = findVenvPython()
  if (!venvPython) throw new Error('venv not found')
  const proc = spawn(venvPython, ['worker.py'], { cwd: FEATURE_DIR, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com' } })
  const h = { proc, loaded: false, busy: false, pending: null, idleTimer: null, loadPromise: null, loadError: null }
  const rl = createInterface({ input: proc.stdout })
  rl.on('line', (line) => {
    const t = line.trim(); if (!t.startsWith('{')) return
    let msg: any; try { msg = JSON.parse(t) } catch { return }
    if (msg.type === 'loaded') { h.loaded = true; h.loadError = null; return }
    if (h.pending) {
      const p = h.pending; h.pending = null; h.busy = false; armIdleTimer(h)
      msg.type === 'done' ? p.resolve(msg.out) : p.reject(new Error(msg.error || 'worker error'))
    }
  })
  proc.on('exit', () => { if (worker === h) worker = null; if (h.pending) { h.pending.reject(new Error('worker exited')); h.pending = null } h.busy = false; h.loaded = false; if (h.idleTimer) clearTimeout(h.idleTimer) })
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

export function getSdTurboTask(id: string): SdTurboTaskView | null {
  const t = tasks.get(id); if (!t) return null
  const { cancelled: _x, ...view } = t; return view
}

export function cancelSdTurboTask(id: string): boolean {
  const task = tasks.get(id); if (!task) return false
  if (['done', 'error', 'cancelled'].includes(task.status)) return false
  task.cancelled = true
  patch(task, { status: 'cancelled', progress: 0, message: '已取消' })
  try { worker?.proc.kill() } catch { /* ignore */ }
  return true
}

async function runTask(task: SdTurboTask, file: UploadedFilePart | null, text: string, params: Record<string, any>): Promise<void> {
  if (!findVenvPython()) {
    patch(task, { status: 'error', progress: 0, message: 'Python 环境尚未就绪，请等待后台安装完成', error: 'venv not found' })
    return
  }
  const workDir = join(WORK_ROOT, task.id)
  const outDir = join(workDir, 'out')
  mkdirSync(workDir, { recursive: true })

  // 图生图：把上传图片写入工作目录
  let pyInput = ''
  if (file?.data?.length) {
    const ext = extname(file.filename || '').toLowerCase() || '.png'
    const inputPath = join(workDir, `input${ext}`)
    writeFileSync(inputPath, file.data)
    pyInput = inputPath
  }

  const outPath = join(outDir, 'output')
  mkdirSync(outDir, { recursive: true })
  if (!worker?.loaded) {
    patch(task, { status: 'loading', progress: 10, message: '正在加载模型（首次约 1-3 分钟）…' })
  } else {
    patch(task, { status: 'processing', progress: 20, message: '正在生成…' })
  }
  try {
    const h = await ensureWorker()
    if (task.cancelled) return
    const result = await new Promise<string>((resolve, reject) => {
      h.busy = true; h.pending = { resolve, reject }
      h.proc.stdin.write(JSON.stringify({ input: pyInput, text, params: { ...params, prompt: text }, out: outPath }) + '\n')
      setTimeout(() => {
        if (h.pending) { const p = h.pending; h.pending = null; h.busy = false; try { h.proc.kill() } catch { /* ignore */ } p.reject(new Error('处理超时')) }
      }, TASK_TIMEOUT)
    })
    // worker 返回 JSON: {"files": [...]}
    let files: string[] = []
    try {
      const parsed = JSON.parse(result)
      files = Array.isArray(parsed?.files) ? parsed.files : [result]
    } catch {
      files = [result]
    }
    if (task.cancelled) return

    patch(task, { status: 'processing', progress: 90, message: '正在生成结果…' })
    const pubDir = join(PUBLIC_GEN, task.id); mkdirSync(pubDir, { recursive: true })
    const urls: string[] = []
    for (const f of files) {
      if (!existsSync(f)) continue
      const fileName = basename(f)
      await copyFile(f, join(pubDir, fileName))
      urls.push(`/generated/sd-turbo/${task.id}/${fileName}`)
    }
    if (!urls.length) { patch(task, { status: 'error', progress: 90, message: '未生成输出', error: 'no output file' }); return }
    patch(task, { status: 'done', progress: 100, message: '完成', resultUrls: urls, resultUrl: urls[0] })
  } catch (e) {
    if (task.cancelled) return
    patch(task, { status: 'error', progress: 10, message: '处理失败', error: (e as Error)?.message })
    return
  }
  rm(workDir, { recursive: true, force: true }).catch(() => {})
}

export function enqueueSdTurbo(file: UploadedFilePart | null, text: string, params: Record<string, any>): { ok: boolean, taskId?: string, error?: string } {
  if (!text?.trim()) return { ok: false, error: '请输入提示词' }
  const task: SdTurboTask = { id: randomUUID(), status: 'queued', progress: 0, message: '排队中…', createdAt: Date.now(), cancelled: false }
  tasks.set(task.id, task)
  const start = () => { running++; void runTask(task, file, text, params).finally(() => { running--; next() }) }
  running < MAX_CONCURRENT ? start() : queue.push(start)
  return { ok: true, taskId: task.id }
}