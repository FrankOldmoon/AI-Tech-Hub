/**
 * 会议纪要异步任务队列（faster-whisper + WeSpeaker）
 *
 * - POST /api/speech/meeting -> 立即返回 taskId
 * - GET  /api/speech/meeting/:id -> 轮询进度/状态
 * - DELETE /api/speech/meeting/:id -> 取消任务
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

const PYTHON_ROOT = resolve(process.cwd(), 'python')
const FEATURE_DIR = join(PYTHON_ROOT, 'speech', 'meeting')
const WORK_ROOT = join(process.cwd(), 'tmp', 'meeting')
const PUBLIC_GEN = resolve(process.cwd(), 'public', 'generated', 'meeting')

const MAX_CONCURRENT = 1
const WHISPER_MODEL = 'base'

export type MeetingStatus = 'queued' | 'converting' | 'processing' | 'done' | 'error' | 'cancelled'

export interface MeetingSegment {
  start: number
  end: number
  speaker: string
  text: string
}

export interface MeetingTaskView {
  id: string
  status: MeetingStatus
  progress: number
  message: string
  error?: string
  segments?: MeetingSegment[]
  text?: string
  resultUrl?: string
  createdAt: number
}

interface MeetingTask extends MeetingTaskView {
  cancelled: boolean
  child?: ReturnType<typeof execFile>
}

interface UploadedFilePart {
  filename?: string
  data: Buffer
}

const tasks = new Map<string, MeetingTask>()
let running = 0
const queue: Array<() => void> = []

function findVenvPython(): string | null {
  const candidates = [
    join(FEATURE_DIR, '.venv', 'Scripts', 'python.exe'),
    join(FEATURE_DIR, '.venv', 'bin', 'python'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function patch(task: MeetingTask, p: Partial<MeetingTaskView>): void {
  Object.assign(task, p)
}

function next(): void {
  const run = queue.shift()
  if (run) run()
}

export function getMeetingTask(id: string): MeetingTaskView | null {
  const t = tasks.get(id)
  if (!t) return null
  const { child: _c, cancelled: _x, ...view } = t
  return view
}

export function cancelMeetingTask(id: string): boolean {
  const task = tasks.get(id)
  if (!task) return false
  if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') return false
  task.cancelled = true
  patch(task, { status: 'cancelled', progress: 0, message: '已取消' })
  try { task.child?.kill() } catch { /* ignore */ }
  return true
}

async function runTask(task: MeetingTask, file: UploadedFilePart): Promise<void> {
  const venvPython = findVenvPython()
  if (!venvPython) {
    patch(task, { status: 'error', progress: 0, message: '会议纪要需要本地 Python 环境（faster-whisper + WeSpeaker），云端部署暂不支持', error: 'venv not found' })
    return
  }

  if (file.data.length > 50 * 1024 * 1024) {
    patch(task, { status: 'error', progress: 0, message: '文件不能超过 50MB', error: 'file too large' })

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

  patch(task, { status: 'processing', progress: 15, message: '正在转写 + 说话人分离（首次运行需下载模型）…' })
  const outJson = join(workDir, 'transcript.json')
  try {
    await new Promise<void>((resolvePromise) => {
      const child = execFile(
        venvPython,
        ['main.py', wavPath, '--model', WHISPER_MODEL, '--out', outJson],
        { cwd: FEATURE_DIR, maxBuffer: 50 * 1024 * 1024, timeout: 600000, env: { ...process.env, OMP_NUM_THREADS: '6' } },
        (err, stdout) => {
          if (err) {
            if (task.cancelled) { resolvePromise(); return }
            patch(task, { status: 'error', progress: 15, message: '处理失败', error: err?.message })
            resolvePromise()
            return
          }
          try {
            const data = JSON.parse(stdout.trim().split(/\r?\n/).pop() || '{}')
            if (!task.cancelled) {
              patch(task, {
                status: 'done',
                progress: 100,
                message: '处理完成',
                segments: data.segments || [],
                text: data.text || '',
                resultUrl: `/generated/meeting/${task.id}/transcript.json`,
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
    patch(task, { status: 'error', progress: 15, message: '处理失败', error: (e as Error)?.message })
    return
  }
  if (!task.cancelled && task.status === 'done') {
    const pubDir = join(PUBLIC_GEN, task.id)
    mkdirSync(pubDir, { recursive: true })
    await copyFile(outJson, join(pubDir, 'transcript.json')).catch(() => {})
  }
  rm(workDir, { recursive: true, force: true }).catch(() => {})
}

export function enqueueMeeting(file: UploadedFilePart): { ok: boolean, taskId?: string, error?: string } {
  if (process.env.VERCEL) {
    return { ok: false, error: '会议纪要需要本地 Python 环境（faster-whisper + WeSpeaker），云端部署不支持此功能。请在本机运行 pnpm dev 后使用。' }
  }
  if (!file?.data?.length) return { ok: false, error: 'Missing audio file' }

  const task: MeetingTask = {
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
