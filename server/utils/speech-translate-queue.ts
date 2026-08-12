/**
 * 语音翻译异步任务队列（faster-whisper translate）
 *
 * - POST /api/speech/speech-translate -> 立即返回 taskId
 * - GET  /api/speech/speech-translate/:id -> 轮询
 * - DELETE /api/speech/speech-translate/:id -> 取消
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

const PYTHON_ROOT = resolve(process.cwd(), 'python')
const FEATURE_DIR = join(PYTHON_ROOT, 'speech', 'speech-translate')
const WORK_ROOT = join(process.cwd(), 'tmp', 'speech-translate')

const MAX_CONCURRENT = 2

export type TranslateStatus = 'queued' | 'converting' | 'translating' | 'done' | 'error' | 'cancelled'

export interface TranslateTaskView {
  id: string
  status: TranslateStatus
  progress: number
  message: string
  error?: string
  translation?: string
  language?: string
  createdAt: number
}

interface TranslateTask extends TranslateTaskView {
  cancelled: boolean
  child?: ReturnType<typeof execFile>
}

interface UploadedFilePart {
  filename?: string
  data: Buffer
}

const tasks = new Map<string, TranslateTask>()
let running = 0
const queue: Array<() => void> = []

function findVenvPython(): string | null {
  const candidates = [
    join(FEATURE_DIR, '.venv', 'Scripts', 'python.exe'),
    join(FEATURE_DIR, '.venv', 'bin', 'python'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function patch(task: TranslateTask, p: Partial<TranslateTaskView>): void {
  Object.assign(task, p)
}

function next(): void {
  const run = queue.shift()
  if (run) run()
}

export function getTranslateTask(id: string): TranslateTaskView | null {
  const t = tasks.get(id)
  if (!t) return null
  const { child: _c, cancelled: _x, ...view } = t
  return view
}

export function cancelTranslateTask(id: string): boolean {
  const task = tasks.get(id)
  if (!task) return false
  if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') return false
  task.cancelled = true
  patch(task, { status: 'cancelled', progress: 0, message: '已取消' })
  try { task.child?.kill() } catch { /* ignore */ }
  return true
}

async function runTask(task: TranslateTask, file: UploadedFilePart): Promise<void> {
  const venvPython = findVenvPython()
  if (!venvPython) {
    patch(task, { status: 'error', progress: 0, message: '语音翻译需要本地 Python 环境（faster-whisper），云端部署暂不支持', error: 'venv not found' })
    return
  }
  const workDir = join(WORK_ROOT, task.id)
  const ext = extname(file.filename || '').toLowerCase() || '.wav'
  const inputPath = join(workDir, `input${ext}`)
  mkdirSync(workDir, { recursive: true })
  writeFileSync(inputPath, file.data)

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

  patch(task, { status: 'translating', progress: 15, message: '正在转写并翻译为英文（首次运行需下载模型）…' })
  try {
    await new Promise<void>((resolvePromise) => {
      const child = execFile(
        venvPython,
        ['main.py', wavPath],
        { cwd: FEATURE_DIR, maxBuffer: 20 * 1024 * 1024, timeout: 300000 },
        (err, stdout) => {
          if (err) {
            if (task.cancelled) { resolvePromise(); return }
            patch(task, { status: 'error', progress: 15, message: '翻译失败', error: err?.message })
            resolvePromise()
            return
          }
          try {
            const data = JSON.parse(stdout.trim().split(/\r?\n/).pop() || '{}')
            if (!task.cancelled) {
              patch(task, { status: 'done', progress: 100, message: '翻译完成', translation: data.translation || '', language: data.language })
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
    patch(task, { status: 'error', progress: 15, message: '翻译失败', error: (e as Error)?.message })
    return
  }
  rm(workDir, { recursive: true, force: true }).catch(() => {})
}

export function enqueueTranslate(file: UploadedFilePart): { ok: boolean, taskId?: string, error?: string } {
  if (process.env.VERCEL) {
    return { ok: false, error: '语音翻译需要本地 Python 环境（faster-whisper），云端部署不支持此功能。请在本机运行 pnpm dev 后使用。' }
  }
  if (!file?.data?.length) return { ok: false, error: 'Missing audio file' }

  const task: TranslateTask = {
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
  if (running < MAX_CONCURRENT) start()
  else queue.push(start)
  return { ok: true, taskId: task.id }
}
