/**
 * 语音活动检测（VAD）异步任务队列（Silero VAD）
 *
 * - POST /api/speech/vad -> 立即返回 taskId
 * - GET  /api/speech/vad/:id -> 轮询进度/状态
 * - DELETE /api/speech/vad/:id -> 取消任务
 * - 模型小（~2MB），每次任务独立进程加载（可接受）
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

const PYTHON_ROOT = resolve(process.cwd(), 'python')
const FEATURE_DIR = join(PYTHON_ROOT, 'speech', 'vad')
const WORK_ROOT = join(process.cwd(), 'tmp', 'vad')

const MAX_CONCURRENT = 2

export type VadStatus = 'queued' | 'converting' | 'detecting' | 'done' | 'error' | 'cancelled'

export interface VadSegment {
  start: number
  end: number
}

export interface VadTaskView {
  id: string
  status: VadStatus
  progress: number
  message: string
  error?: string
  segments?: VadSegment[]
  speechSeconds?: number
  totalSeconds?: number
  createdAt: number
}

interface VadTask extends VadTaskView {
  cancelled: boolean
  child?: ReturnType<typeof execFile>
}

interface UploadedFilePart {
  filename?: string
  data: Buffer
}

const tasks = new Map<string, VadTask>()
let running = 0
const queue: Array<() => void> = []

function findVenvPython(): string | null {
  const candidates = [
    join(FEATURE_DIR, '.venv', 'Scripts', 'python.exe'),
    join(FEATURE_DIR, '.venv', 'bin', 'python'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function patch(task: VadTask, p: Partial<VadTaskView>): void {
  Object.assign(task, p)
}

function next(): void {
  const run = queue.shift()
  if (run) run()
}

/** 查询任务（返回副本，避免外部篡改） */
export function getVadTask(id: string): VadTaskView | null {
  const t = tasks.get(id)
  if (!t) return null
  const { child: _c, cancelled: _x, ...view } = t
  return view
}

/** 取消任务 */
export function cancelVadTask(id: string): boolean {
  const task = tasks.get(id)
  if (!task) return false
  if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') return false
  task.cancelled = true
  patch(task, { status: 'cancelled', progress: 0, message: '已取消' })
  try { task.child?.kill() } catch { /* ignore */ }
  return true
}

async function runTask(task: VadTask, file: UploadedFilePart): Promise<void> {
  const venvPython = findVenvPython()
  if (!venvPython) {
    patch(task, { status: 'error', progress: 0, message: 'VAD 需要本地 Python 环境（Silero），云端部署暂不支持此功能', error: 'venv not found' })
    return
  }

  const workDir = join(WORK_ROOT, task.id)
  const ext = extname(file.filename || '').toLowerCase() || '.wav'
  const inputPath = join(workDir, `input${ext}`)
  mkdirSync(workDir, { recursive: true })
  writeFileSync(inputPath, file.data)

  // 1. ffmpeg 统一转码为 16kHz 单声道 wav
  patch(task, { status: 'converting', progress: 5, message: '正在转换音频格式…' })
  const wavPath = join(workDir, 'converted.wav')
  try {
    await execFileAsync('ffmpeg', ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', wavPath], {
      timeout: 120000,
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch (e) {
    patch(task, { status: 'error', progress: 5, message: '音频转码失败', error: (e as Error)?.message })
    return
  }
  if (task.cancelled) return

  // 2. Silero VAD 检测
  patch(task, { status: 'detecting', progress: 15, message: '正在检测语音段（首次运行需下载模型）…' })
  try {
    await new Promise<void>((resolvePromise) => {
      const child = execFile(
        venvPython,
        ['main.py', wavPath],
        {
          cwd: FEATURE_DIR,
          maxBuffer: 20 * 1024 * 1024,
          timeout: 180000,
        },
        (err, stdout) => {
          if (err) {
            if (task.cancelled) { resolvePromise(); return }
            patch(task, { status: 'error', progress: 15, message: '检测失败', error: err?.message })
            resolvePromise()
            return
          }
          try {
            const data = JSON.parse(stdout.trim().split(/\r?\n/).pop() || '{}')
            if (!task.cancelled) {
              patch(task, {
                status: 'done',
                progress: 100,
                message: '检测完成',
                segments: data.speech_segments || [],
                speechSeconds: data.speech_seconds,
                totalSeconds: data.total_seconds,
              })
            }
          } catch (e) {
            patch(task, { status: 'error', progress: 15, message: '结果解析失败', error: (e as Error)?.message })
          }
          resolvePromise()
        },
      )
      task.child = child
    })
  } catch (e) {
    patch(task, { status: 'error', progress: 15, message: '检测失败', error: (e as Error)?.message })
    return
  }
  rm(workDir, { recursive: true, force: true }).catch(() => {})
}

/** 创建并提交 VAD 任务，立即返回 taskId */
export function enqueueVad(file: UploadedFilePart): { ok: boolean, taskId?: string, error?: string } {
  if (process.env.VERCEL) {
    return { ok: false, error: 'VAD 需要本地 Python 环境（Silero），云端部署不支持此功能。请在本机运行 pnpm dev 后使用。' }
  }
  if (!file?.data?.length) return { ok: false, error: 'Missing audio file' }

  const task: VadTask = {
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
