/**
 * 语音克隆异步任务队列（XTTS-v2）
 *
 * - POST /api/speech/voice-clone -> 立即返回 taskId
 * - GET  /api/speech/voice-clone/:id -> 轮询进度/状态
 * - DELETE /api/speech/voice-clone/:id -> 取消任务
 *
 * 模型常驻优化：
 * - 使用长驻 Python worker（worker.py），模型只加载一次
 * - 首次任务需加载 ~1.8GB 模型（40-60 秒），之后合成秒级复用
 * - worker 空闲 30 分钟自动退出释放内存，下次任务自动重启
 * - 取消任务会杀掉 worker（下次任务重新加载模型）
 * - 并发上限 1（模型内存占用大），通过 VC_THREADS 限制线程
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { basename, extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const PYTHON_ROOT = resolve(process.cwd(), 'python')
const FEATURE_DIR = join(PYTHON_ROOT, 'speech', 'voice-clone')
const WORK_ROOT = join(process.cwd(), 'tmp', 'voice-clone')
const PUBLIC_GEN = resolve(process.cwd(), 'public', 'generated', 'voice-clone')

const MAX_CONCURRENT = 1
const VC_THREADS = Number(process.env.VC_THREADS || 6)
const WORKER_IDLE_TIMEOUT = 30 * 60 * 1000 // 30 分钟空闲自动退出
const SYNTH_TIMEOUT = 5 * 60 * 1000 // 单次合成超时 5 分钟

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
}

interface UploadedFilePart {
  filename?: string
  data: Buffer
}

const tasks = new Map<string, VoiceCloneTask>()
let running = 0
const queue: Array<() => void> = []

// ===== 常驻 Worker（模型只加载一次） =====
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
      VC_THREADS: String(VC_THREADS),
      HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com',
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
  // 已就绪：直接复用
  if (worker?.loaded && worker.proc.exitCode === null) return worker
  // 加载中：等待
  if (worker && !worker.loaded && worker.proc.exitCode === null && worker.loadPromise) {
    await worker.loadPromise
    return worker
  }

  const h = spawnWorker()
  worker = h
  h.loadPromise = new Promise<void>((resolve, reject) => {
    const check = setInterval(() => {
      if (h.loaded) { clearInterval(check); resolve() }
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

async function synthViaWorker(task: VoiceCloneTask, refWav: string, text: string, outPath: string): Promise<void> {
  // 首次加载模型较慢，提示加载中；worker 已就绪则直接合成
  if (!worker?.loaded) {
    patch(task, { status: 'loading', progress: 10, message: '正在加载 XTTS-v2 模型（首次约 40-60 秒，之后合成秒级复用）…' })
  } else {
    patch(task, { status: 'synthesizing', progress: 20, message: '正在合成语音…' })
  }
  const h = await ensureWorker()
  if (task.cancelled) return
  if (h.busy) throw new Error('worker busy')

  const out = await new Promise<string>((resolve, reject) => {
    h.busy = true
    h.pending = { resolve, reject }
    h.proc.stdin.write(JSON.stringify({
      ref: refWav,
      text,
      lang: task.lang,
      out: outPath,
    }) + '\n')
    // 合成超时保护
    setTimeout(() => {
      if (h.pending) {
        const p = h.pending
        h.pending = null
        h.busy = false
        try { h.proc.kill() } catch { /* ignore */ }
        p.reject(new Error('合成超时'))
      }
    }, SYNTH_TIMEOUT)
  })
  if (out !== outPath) throw new Error('worker output mismatch')
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
  const { lang: _l, cancelled: _x, ...view } = t
  return view
}

export function cancelVoiceCloneTask(id: string): boolean {
  const task = tasks.get(id)
  if (!task) return false
  if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') return false
  task.cancelled = true
  patch(task, { status: 'cancelled', progress: 0, message: '已取消' })
  // 杀掉 worker：正在合成的任务立即停止；下次任务重新加载模型
  try { worker?.proc.kill() } catch { /* ignore */ }
  return true
}

async function runTask(task: VoiceCloneTask, refFile: UploadedFilePart, text: string): Promise<void> {
  if (!findVenvPython()) {
    patch(task, { status: 'error', progress: 0, message: '语音克隆的 Python 环境（Python 3.11 + coqui-tts）尚未就绪，请等待后台安装完成', error: 'venv not found' })
    return
  }

  const workDir = join(WORK_ROOT, task.id)
  const outDir = join(workDir, 'out')
  mkdirSync(workDir, { recursive: true })
  const ext = extname(refFile.filename || '').toLowerCase() || '.wav'
  const refPath = join(workDir, `ref${ext}`)
  writeFileSync(refPath, refFile.data)

  // 非 wav/flac 先用 ffmpeg 转 wav
  let refWav = refPath
  if (!['.wav', '.flac'].includes(ext)) {
    patch(task, { status: 'preparing', progress: 5, message: '正在转换参考音频…' })
    const wavPath = join(workDir, 'ref.wav')
    await new Promise<void>((resolveExec) => {
      execFile('ffmpeg', ['-y', '-i', refPath, '-ar', '44100', '-ac', '1', '-sample_fmt', 's16', wavPath], {
        timeout: 120000,
        maxBuffer: 20 * 1024 * 1024,
      }, (err) => {
        if (err && !task.cancelled) {
          patch(task, { status: 'error', progress: 5, message: '参考音频转码失败', error: err?.message })
        }
        resolveExec()
      })
    })
    if (task.cancelled) return
    if (task.status === 'error') return
    refWav = wavPath
  }

  const outPath = join(outDir, 'output.wav')
  mkdirSync(outDir, { recursive: true })
  try {
    await synthViaWorker(task, refWav, text, outPath)
  } catch (e) {
    if (task.cancelled) return
    patch(task, { status: 'error', progress: 10, message: '合成失败', error: (e as Error)?.message })
    return
  }
  if (task.cancelled) return
  await finalize(task, outPath, workDir)
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
