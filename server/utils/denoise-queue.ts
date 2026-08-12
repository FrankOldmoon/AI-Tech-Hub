/**
 * 音频降噪异步任务队列（DeepFilterNet）
 *
 * - POST /api/speech/denoise -> 立即返回 taskId
 * - GET  /api/speech/denoise/:id -> 轮询进度/状态
 * - DELETE /api/speech/denoise/:id -> 取消任务
 * - 并发上限 2，模型小（~30MB），每次任务独立进程加载（可接受）
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

const PYTHON_ROOT = resolve(process.cwd(), 'python')
const FEATURE_DIR = join(PYTHON_ROOT, 'speech', 'denoise')
const WORK_ROOT = join(process.cwd(), 'tmp', 'denoise')
const PUBLIC_GEN = resolve(process.cwd(), 'public', 'generated', 'denoise')

const MAX_CONCURRENT = 2
const MODEL = 'DeepFilterNet3'

export type DenoiseStatus = 'queued' | 'converting' | 'denoising' | 'done' | 'error' | 'cancelled'

export interface DenoiseTaskView {
  id: string
  status: DenoiseStatus
  progress: number
  message: string
  error?: string
  audioUrl?: string
  createdAt: number
}

interface DenoiseTask extends DenoiseTaskView {
  cancelled: boolean
  child?: ReturnType<typeof execFile>
}

interface UploadedFilePart {
  filename?: string
  data: Buffer
}

const tasks = new Map<string, DenoiseTask>()
let running = 0
const queue: Array<() => void> = []

function findVenvPython(): string | null {
  const candidates = [
    join(FEATURE_DIR, '.venv', 'Scripts', 'python.exe'),
    join(FEATURE_DIR, '.venv', 'bin', 'python'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function patch(task: DenoiseTask, p: Partial<DenoiseTaskView>): void {
  Object.assign(task, p)
}

function next(): void {
  const run = queue.shift()
  if (run) run()
}

/** 查询任务（返回副本，避免外部篡改） */
export function getDenoiseTask(id: string): DenoiseTaskView | null {
  const t = tasks.get(id)
  if (!t) return null
  const { child: _c, cancelled: _x, ...view } = t
  return view
}

/** 取消任务：排队中直接取消；运行中 kill 子进程 */
export function cancelDenoiseTask(id: string): boolean {
  const task = tasks.get(id)
  if (!task) return false
  if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') return false
  task.cancelled = true
  patch(task, { status: 'cancelled', progress: 0, message: '已取消' })
  try { task.child?.kill() } catch { /* ignore */ }
  return true
}

async function runTask(task: DenoiseTask, file: UploadedFilePart): Promise<void> {
  const venvPython = findVenvPython()
  if (!venvPython) {
    patch(task, { status: 'error', progress: 0, message: '音频降噪需要本地 Python 环境（DeepFilterNet），云端部署暂不支持此功能', error: 'venv not found' })
    return
  }

  const workDir = join(WORK_ROOT, task.id)
  const ext = extname(file.filename || '').toLowerCase() || '.wav'
  const inputPath = join(workDir, `input${ext}`)
  mkdirSync(workDir, { recursive: true })
  writeFileSync(inputPath, file.data)

  // 1. ffmpeg 统一转码为 48kHz 立体声 wav
  patch(task, { status: 'converting', progress: 5, message: '正在转换音频格式…' })
  const wavPath = join(workDir, 'converted.wav')
  try {
    await execFileAsync('ffmpeg', ['-y', '-i', inputPath, '-ar', '48000', '-ac', '2', '-sample_fmt', 's16', wavPath], {
      timeout: 120000,
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch (e) {
    patch(task, { status: 'error', progress: 5, message: '音频转码失败', error: (e as Error)?.message })
    return
  }
  if (task.cancelled) return

  // 2. DeepFilterNet 降噪
  patch(task, { status: 'denoising', progress: 15, message: '正在降噪（首次运行需下载模型）…' })
  const outPath = join(workDir, 'enhanced.wav')
  try {
    await new Promise<void>((resolvePromise) => {
      const child = execFile(
        venvPython,
        ['main.py', wavPath, outPath, '--model', MODEL],
        {
          cwd: FEATURE_DIR,
          maxBuffer: 50 * 1024 * 1024,
          timeout: 300000,
          env: { ...process.env, OMP_NUM_THREADS: '6' },
        },
        (err) => {
          if (err) {
            if (task.cancelled) { resolvePromise(); return }
            patch(task, { status: 'error', progress: 15, message: '降噪失败', error: err?.message })
            resolvePromise()
            return
          }
          void finalize(task, outPath, workDir).finally(resolvePromise)
        },
      )
      task.child = child
    })
  } catch (e) {
    patch(task, { status: 'error', progress: 15, message: '降噪失败', error: (e as Error)?.message })
    return
  }
  if (task.cancelled) return
}

async function finalize(task: DenoiseTask, outPath: string, workDir: string): Promise<void> {
  patch(task, { status: 'denoising', progress: 90, message: '正在生成结果…' })
  if (!existsSync(outPath)) {
    patch(task, { status: 'error', progress: 90, message: '未生成降噪结果', error: 'no output file' })
    rm(workDir, { recursive: true, force: true }).catch(() => {})
    return
  }
  const pubDir = join(PUBLIC_GEN, task.id)
  mkdirSync(pubDir, { recursive: true })
  const dest = join(pubDir, 'enhanced.wav')
  try {
    await copyFile(outPath, dest)
    if (!task.cancelled) {
      patch(task, { status: 'done', progress: 100, message: '降噪完成', audioUrl: `/generated/denoise/${task.id}/enhanced.wav` })
    }
  } catch {
    patch(task, { status: 'error', progress: 90, message: '结果生成失败', error: 'copy failed' })
  }
  rm(workDir, { recursive: true, force: true }).catch(() => {})
}

/** 创建并提交降噪任务，立即返回 taskId */
export function enqueueDenoise(file: UploadedFilePart): { ok: boolean, taskId?: string, error?: string } {
  if (process.env.VERCEL) {
    return { ok: false, error: '音频降噪需要本地 Python 环境（DeepFilterNet），云端部署不支持此功能。请在本机运行 pnpm dev 后使用。' }
  }
  if (!file?.data?.length) return { ok: false, error: 'Missing audio file' }

  const task: DenoiseTask = {
    id: randomUUID(),
    status: 'queued',
    progress: 0,
    message: '排队中…',
    createdAt: Date.now(),
    cancelled: false,
  }
  tasks.set(task.id, task)

  const start = () => {
    running++
    void runTask(task, file).finally(() => {
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
