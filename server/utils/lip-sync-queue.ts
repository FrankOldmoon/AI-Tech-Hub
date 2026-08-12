/**
 * 口型同步异步任务队列（Wav2Lip）
 *
 * - POST /api/speech/lip-sync -> 立即返回 taskId（multipart: video + audio）
 * - GET  /api/speech/lip-sync/:id -> 轮询
 * - DELETE /api/speech/lip-sync/:id -> 取消
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

const PYTHON_ROOT = resolve(process.cwd(), 'python')
const FEATURE_DIR = join(PYTHON_ROOT, 'speech', 'lip-sync')
const WORK_ROOT = join(process.cwd(), 'tmp', 'lip-sync')
const PUBLIC_GEN = resolve(process.cwd(), 'public', 'generated', 'lip-sync')

const MAX_CONCURRENT = 1

export type LipSyncStatus = 'queued' | 'converting' | 'processing' | 'done' | 'error' | 'cancelled'

export interface LipSyncTaskView {
  id: string
  status: LipSyncStatus
  progress: number
  message: string
  error?: string
  videoUrl?: string
  createdAt: number
}

interface LipSyncTask extends LipSyncTaskView {
  cancelled: boolean
  child?: ReturnType<typeof execFile>
}

interface UploadedFilePart {
  filename?: string
  data: Buffer
}

const tasks = new Map<string, LipSyncTask>()
let running = 0
const queue: Array<() => void> = []

function findVenvPython(): string | null {
  const candidates = [
    join(FEATURE_DIR, '.venv', 'Scripts', 'python.exe'),
    join(FEATURE_DIR, '.venv', 'bin', 'python'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function patch(task: LipSyncTask, p: Partial<LipSyncTaskView>): void {
  Object.assign(task, p)
}

function next(): void {
  const run = queue.shift()
  if (run) run()
}

export function getLipSyncTask(id: string): LipSyncTaskView | null {
  const t = tasks.get(id)
  if (!t) return null
  const { child: _c, cancelled: _x, ...view } = t
  return view
}

export function cancelLipSyncTask(id: string): boolean {
  const task = tasks.get(id)
  if (!task) return false
  if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') return false
  task.cancelled = true
  patch(task, { status: 'cancelled', progress: 0, message: '已取消' })
  try { task.child?.kill() } catch { /* ignore */ }
  return true
}

async function runTask(task: LipSyncTask, video: UploadedFilePart, audio: UploadedFilePart): Promise<void> {
  const venvPython = findVenvPython()
  if (!venvPython) {
    patch(task, { status: 'error', progress: 0, message: '口型同步需要本地 Python 环境（Wav2Lip），云端部署暂不支持', error: 'venv not found' })
    return
  }
  const workDir = join(WORK_ROOT, task.id)
  mkdirSync(workDir, { recursive: true })
  const vext = extname(video.filename || '').toLowerCase() || '.mp4'
  const aext = extname(audio.filename || '').toLowerCase() || '.wav'
  const videoPath = join(workDir, `input${vext}`)
  const audioPath = join(workDir, `input${aext}`)
  writeFileSync(videoPath, video.data)
  writeFileSync(audioPath, audio.data)

  // 统一转码：视频 25fps + 音频 16k wav（Wav2Lip 期望）
  patch(task, { status: 'converting', progress: 5, message: '正在转换视频/音频格式…' })
  const facePath = join(workDir, 'face.mp4')
  const wavPath = join(workDir, 'audio.wav')
  try {
    await execFileAsync('ffmpeg', ['-y', '-i', videoPath, '-vf', 'fps=25', '-pix_fmt', 'yuv420p', facePath], { timeout: 120000, maxBuffer: 20 * 1024 * 1024 })
    await execFileAsync('ffmpeg', ['-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', wavPath], { timeout: 120000, maxBuffer: 20 * 1024 * 1024 })
  } catch (e) {
    patch(task, { status: 'error', progress: 5, message: '转码失败', error: (e as Error)?.message })
    return
  }
  if (task.cancelled) return

  patch(task, { status: 'processing', progress: 15, message: '正在口型同步（首次运行加载模型）…' })
  const outPath = join(workDir, 'result.mp4')
  try {
    await new Promise<void>((resolvePromise) => {
      const child = execFile(
        venvPython,
        ['main.py', facePath, wavPath, outPath],
        { cwd: FEATURE_DIR, maxBuffer: 50 * 1024 * 1024, timeout: 900000 },
        (err) => {
          if (err) {
            if (task.cancelled) { resolvePromise(); return }
            patch(task, { status: 'error', progress: 15, message: '口型同步失败', error: err?.message })
            resolvePromise()
            return
          }
          if (!task.cancelled && existsSync(outPath)) {
            const pubDir = join(PUBLIC_GEN, task.id)
            mkdirSync(pubDir, { recursive: true })
            copyFile(outPath, join(pubDir, 'result.mp4'))
              .then(() => patch(task, { status: 'done', progress: 100, message: '完成', videoUrl: `/generated/lip-sync/${task.id}/result.mp4` }))
              .catch((e) => patch(task, { status: 'error', progress: 90, message: '结果生成失败', error: (e as Error)?.message }))
          } else if (!task.cancelled) {
            patch(task, { status: 'error', progress: 90, message: '未生成视频', error: 'no output' })
          }
          resolvePromise()
        },
      )
      task.child = child
    })
  } catch (e) {
    patch(task, { status: 'error', progress: 15, message: '口型同步失败', error: (e as Error)?.message })
    return
  }
  rm(workDir, { recursive: true, force: true }).catch(() => {})
}

export function enqueueLipSync(video: UploadedFilePart, audio: UploadedFilePart): { ok: boolean, taskId?: string, error?: string } {
  if (process.env.VERCEL) {
    return { ok: false, error: '口型同步需要本地 Python 环境（Wav2Lip），云端部署不支持此功能。请在本机运行 pnpm dev 后使用。' }
  }
  if (!video?.data?.length || !audio?.data?.length) return { ok: false, error: 'Missing video or audio' }

  const task: LipSyncTask = {
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
    void runTask(task, video, audio).finally(() => {
      running--
      next()
    })
  }
  if (running < MAX_CONCURRENT) start()
  else queue.push(start)
  return { ok: true, taskId: task.id }
}
