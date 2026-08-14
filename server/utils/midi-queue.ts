/**
 * 音频转 MIDI 异步任务队列（hf-midi-transcription）
 *
 * - POST /api/speech/midi -> 立即返回 taskId（multipart: file + instrument）
 * - GET  /api/speech/midi/:id -> 轮询进度/状态
 * - DELETE /api/speech/midi/:id -> 取消任务
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

const PYTHON_ROOT = resolve(process.cwd(), 'python')
const FEATURE_DIR = join(PYTHON_ROOT, 'speech', 'midi')
const WORK_ROOT = join(process.cwd(), 'tmp', 'midi')
const PUBLIC_GEN = resolve(process.cwd(), 'public', 'generated', 'midi')

const MAX_CONCURRENT = 1
const ALLOWED_INSTRUMENTS = new Set(['piano', 'guitar', 'bass', 'saxophone'])

export type MidiStatus = 'queued' | 'converting' | 'transcribing' | 'done' | 'error' | 'cancelled'

export interface MidiTaskView {
  id: string
  status: MidiStatus
  progress: number
  message: string
  error?: string
  midiUrl?: string
  createdAt: number
}

interface MidiTask extends MidiTaskView {
  instrument: string
  cancelled: boolean
  child?: ReturnType<typeof execFile>
}

interface UploadedFilePart {
  filename?: string
  data: Buffer
}

const tasks = new Map<string, MidiTask>()
let running = 0
const queue: Array<() => void> = []

function findVenvPython(): string | null {
  const candidates = [
    join(FEATURE_DIR, '.venv', 'Scripts', 'python.exe'),
    join(FEATURE_DIR, '.venv', 'bin', 'python'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function patch(task: MidiTask, p: Partial<MidiTaskView>): void {
  Object.assign(task, p)
}

function next(): void {
  const run = queue.shift()
  if (run) run()
}

export function getMidiTask(id: string): MidiTaskView | null {
  const t = tasks.get(id)
  if (!t) return null
  const { child: _c, instrument: _i, cancelled: _x, ...view } = t
  return view
}

export function cancelMidiTask(id: string): boolean {
  const task = tasks.get(id)
  if (!task) return false
  if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') return false
  task.cancelled = true
  patch(task, { status: 'cancelled', progress: 0, message: '已取消' })
  try { task.child?.kill() } catch { /* ignore */ }
  return true
}

async function runTask(task: MidiTask, file: UploadedFilePart): Promise<void> {
  const venvPython = findVenvPython()
  if (!venvPython) {
    patch(task, { status: 'error', progress: 0, message: '音频转 MIDI 需要本地 Python 环境，云端部署暂不支持此功能', error: 'venv not found' })
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

  patch(task, { status: 'transcribing', progress: 15, message: '正在转写 MIDI（首次运行需下载模型）…' })
  const midiPath = join(workDir, 'transcript.mid')
  try {
    await new Promise<void>((resolvePromise) => {
      const child = execFile(
        venvPython,
        ['main.py', wavPath, midiPath],
        { cwd: FEATURE_DIR, maxBuffer: 50 * 1024 * 1024, timeout: 600000, env: { ...process.env, OMP_NUM_THREADS: '6' } },
        (err) => {
          if (err) {
            if (task.cancelled) { resolvePromise(); return }
            patch(task, { status: 'error', progress: 15, message: '转写失败', error: err?.message })
            resolvePromise()
            return
          }
          if (!task.cancelled && existsSync(midiPath)) {
            const pubDir = join(PUBLIC_GEN, task.id)
            mkdirSync(pubDir, { recursive: true })
            copyFile(midiPath, join(pubDir, 'transcript.mid'))
              .then(() => patch(task, { status: 'done', progress: 100, message: '转写完成', midiUrl: `/generated/midi/${task.id}/transcript.mid` }))
              .catch((e) => patch(task, { status: 'error', progress: 90, message: '结果生成失败', error: (e as Error)?.message }))
          } else if (!task.cancelled) {
            patch(task, { status: 'error', progress: 90, message: '未生成 MIDI 文件', error: 'no output' })
          }
          resolvePromise()
        },
      )
      task.child = child
    })
  } catch (e) {
    patch(task, { status: 'error', progress: 15, message: '转写失败', error: (e as Error)?.message })
    return
  }
  rm(workDir, { recursive: true, force: true }).catch(() => {})
}

export function enqueueMidi(file: UploadedFilePart, instrument: string): { ok: boolean, taskId?: string, error?: string } {
  if (process.env.VERCEL) {
    return { ok: false, error: '音频转 MIDI 需要本地 Python 环境，云端部署不支持此功能。请在本机运行 pnpm dev 后使用。' }
  }
  const inst = (instrument || 'piano').trim()
  if (!ALLOWED_INSTRUMENTS.has(inst)) return { ok: false, error: `Unsupported instrument: ${inst}` }
  if (!file?.data?.length) return { ok: false, error: 'Missing audio file' }

  const task: MidiTask = {
    id: randomUUID(),
    status: 'queued',
    progress: 0,
    message: '排队中…',
    createdAt: Date.now(),
    instrument: inst,
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
