/**
 * 语音克隆异步任务队列（XTTS-v2）
 *
 * - POST /api/speech/voice-clone -> 立即返回 taskId
 * - GET  /api/speech/voice-clone/:id -> 轮询进度/状态
 * - DELETE /api/speech/voice-clone/:id -> 取消任务
 * - 并发上限 1（XTTS-v2 模型 ~1.8GB，避免多进程内存爆炸）
 * - 首次合成会自动下载模型（走 HF 镜像），可能耗时较长
 * - 通过 VC_THREADS 限制 torch 线程，避免拖慢系统
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { basename, extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const PYTHON_ROOT = resolve(process.cwd(), 'python')
const FEATURE_DIR = join(PYTHON_ROOT, 'speech', 'voice-clone')
const WORK_ROOT = join(process.cwd(), 'tmp', 'voice-clone')
const PUBLIC_GEN = resolve(process.cwd(), 'public', 'generated', 'voice-clone')

const MAX_CONCURRENT = 1
const VC_THREADS = Number(process.env.VC_THREADS || 6)

export type VoiceCloneStatus = 'queued' | 'preparing' | 'loading' | 'synthesizing' | 'done' | 'error' | 'cancelled'

export interface VoiceCloneTaskView {
  id: string
  status: VoiceCloneStatus
  progress: number
  message: string
  error?: string
  audioUrl?: string
  createdAt: number
}

interface VoiceCloneTask extends VoiceCloneTaskView {
  lang: string
  cancelled: boolean
  child?: ReturnType<typeof execFile>
}

interface UploadedFilePart {
  filename?: string
  data: Buffer
}

const tasks = new Map<string, VoiceCloneTask>()
let running = 0
const queue: Array<() => void> = []

function findVenvPython(): string | null {
  const candidates = [
    join(FEATURE_DIR, '.venv', 'Scripts', 'python.exe'),
    join(FEATURE_DIR, '.venv', 'bin', 'python'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function patch(task: VoiceCloneTask, p: Partial<VoiceCloneTaskView>): void {
  Object.assign(task, p)
}

function next(): void {
  const run = queue.shift()
  if (run) run()
}

export function getVoiceCloneTask(id: string): VoiceCloneTaskView | null {
  const t = tasks.get(id)
  if (!t) return null
  const { child: _c, lang: _l, cancelled: _x, ...view } = t
  return view
}

export function cancelVoiceCloneTask(id: string): boolean {
  const task = tasks.get(id)
  if (!task) return false
  if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') return false
  task.cancelled = true
  patch(task, { status: 'cancelled', progress: 0, message: '已取消' })
  try { task.child?.kill() } catch { /* ignore */ }
  return true
}

async function runTask(task: VoiceCloneTask, refFile: UploadedFilePart, text: string): Promise<void> {
  const venvPython = findVenvPython()
  if (!venvPython) {
    patch(task, { status: 'error', progress: 0, message: '语音克隆的 Python 环境（Python 3.11 + coqui-tts）尚未就绪，请等待后台安装完成', error: 'venv not found' })
    return
  }

  const workDir = join(WORK_ROOT, task.id)
  const outDir = join(workDir, 'out')
  mkdirSync(workDir, { recursive: true })
  const ext = extname(refFile.filename || '').toLowerCase() || '.wav'
  const refPath = join(workDir, `ref${ext}`)
  writeFileSync(refPath, refFile.data)

  // 非 wav 先转成 wav（coqui 读取更稳）
  let refWav = refPath
  if (!['.wav', '.flac'].includes(ext)) {
    patch(task, { status: 'preparing', progress: 5, message: '正在转换参考音频…' })
    const wavPath = join(workDir, 'ref.wav')
    await new Promise<void>((resolveExec) => {
      const child = execFile('ffmpeg', ['-y', '-i', refPath, '-ar', '44100', '-ac', '1', '-sample_fmt', 's16', wavPath], {
        timeout: 120000,
        maxBuffer: 20 * 1024 * 1024,
      }, (err) => {
        if (err && !task.cancelled) {
          patch(task, { status: 'error', progress: 5, message: '参考音频转码失败', error: err?.message })
        }
        resolveExec()
      })
      task.child = child
    })
    if (task.cancelled) return
    if (task.status === 'error') return
    refWav = wavPath
  }

  // 合成（首次会加载/下载模型）
  patch(task, { status: 'loading', progress: 10, message: '正在加载 XTTS-v2 模型（首次需下载约 1.8GB，请耐心等待）…' })
  const outPath = join(outDir, 'output.wav')
  mkdirSync(outDir, { recursive: true })
  const args = ['main.py', '--ref', refWav, '--text', text, '--lang', task.lang, '--out', outPath]

  await new Promise<void>((resolveExec) => {
    const child = execFile(
      venvPython,
      args,
      {
        cwd: FEATURE_DIR,
        maxBuffer: 100 * 1024 * 1024,
        timeout: 1800000, // 30 分钟：模型下载 + 合成
        env: {
          ...process.env,
          VC_THREADS: String(VC_THREADS),
          HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com',
        },
      },
      (err) => {
        if (err) {
          if (task.cancelled) { resolveExec(); return }
          patch(task, { status: 'error', progress: 10, message: '合成失败', error: err?.message })
          resolveExec()
          return
        }
        finalize(task, outPath, workDir).finally(resolveExec)
      },
    )
    task.child = child
  })
  if (task.cancelled) return
}

async function finalize(task: VoiceCloneTask, outPath: string, workDir: string): Promise<void> {
  patch(task, { status: 'synthesizing', progress: 90, message: '正在生成结果…' })
  if (!existsSync(outPath)) {
    patch(task, { status: 'error', progress: 90, message: '未生成音频', error: 'no output file' })
    return
  }
  const pubDir = join(PUBLIC_GEN, task.id)
  mkdirSync(pubDir, { recursive: true })
  const fileName = basename(outPath)
  await copyFile(outPath, join(pubDir, fileName))
  if (!task.cancelled) {
    patch(task, { status: 'done', progress: 100, message: '合成完成', audioUrl: `/generated/voice-clone/${task.id}/${fileName}` })
  }
  rm(workDir, { recursive: true, force: true }).catch(() => {})
}

export function enqueueVoiceClone(
  refFile: UploadedFilePart,
  text: string,
  lang: string,
): { ok: boolean, taskId?: string, error?: string } {
  const t = (text || '').trim()
  if (!t) return { ok: false, error: '请输入要合成的文本' }
  if (!refFile?.data?.length) return { ok: false, error: '请上传参考音频' }

  const task: VoiceCloneTask = {
    id: randomUUID(),
    status: 'queued',
    progress: 0,
    message: '排队中…',
    createdAt: Date.now(),
    lang: lang || 'zh-cn',
    cancelled: false,
  }
  tasks.set(task.id, task)

  const start = () => {
    running++
    void runTask(task, refFile, t).finally(() => {
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
