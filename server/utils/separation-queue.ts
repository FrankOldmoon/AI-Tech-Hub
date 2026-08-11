/**
 * 音频分离异步任务队列
 *
 * 为什么异步：
 * - demucs 分离是 CPU 密集型任务（torch 推理），一首歌可能耗时几十秒到几分钟
 * - 若保持同步请求，前端只能干等；且并发不受控时多个 demucs 会把 CPU 打满
 *
 * 设计：
 * - POST /api/speech/separate  -> 立即返回 taskId，任务入队
 * - GET  /api/speech/separate/:id -> 轮询进度/状态
 * - DELETE /api/speech/separate/:id -> 取消任务
 * - 并发上限 MAX_CONCURRENT（默认 2），超出排队
 * - 通过 SEPARATION_THREADS 限制 torch 线程，避免拖垮系统
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

const PYTHON_ROOT = resolve(process.cwd(), 'python')
const FEATURE_DIR = join(PYTHON_ROOT, 'speech', 'separation')
const WORK_ROOT = join(process.cwd(), 'tmp', 'separation')
const PUBLIC_GEN = resolve(process.cwd(), 'public', 'generated', 'separation')

const MAX_CONCURRENT = 2
const SEPARATION_THREADS = Number(process.env.SEPARATION_THREADS || 6)
const ALLOWED_MODELS = new Set(['htdemucs', 'htdemucs_ft', 'mdx', 'mdx_extra'])
const ALLOWED_TWO_STEMS = new Set(['vocals', 'drums', 'bass', 'other'])

export type SeparationStatus = 'queued' | 'converting' | 'separating' | 'done' | 'error' | 'cancelled'

export interface SeparationStem {
  name: string
  url: string
}

export interface SeparationTaskView {
  id: string
  status: SeparationStatus
  progress: number
  message: string
  error?: string
  stems?: SeparationStem[]
  createdAt: number
}

interface SeparationTask extends SeparationTaskView {
  model: string
  twoStems: string
  cancelled: boolean
  child?: ReturnType<typeof execFile>
}

interface UploadedFilePart {
  filename?: string
  data: Buffer
}

const tasks = new Map<string, SeparationTask>()
let running = 0
const queue: Array<() => void> = []

function findVenvPython(): string | null {
  const candidates = [
    join(FEATURE_DIR, '.venv', 'Scripts', 'python.exe'),
    join(FEATURE_DIR, '.venv', 'bin', 'python'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function patch(task: SeparationTask, p: Partial<SeparationTaskView>): void {
  Object.assign(task, p)
}

function next(): void {
  const run = queue.shift()
  if (run) run()
}

/** 查询任务（返回副本，避免外部篡改） */
export function getSeparationTask(id: string): SeparationTaskView | null {
  const t = tasks.get(id)
  if (!t) return null
  const { child: _c, model: _m, twoStems: _t, cancelled: _x, ...view } = t
  return view
}

/** 取消任务：排队中直接取消；运行中 kill 子进程 */
export function cancelSeparationTask(id: string): boolean {
  const task = tasks.get(id)
  if (!task) return false
  if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') return false
  task.cancelled = true
  patch(task, { status: 'cancelled', progress: 0, message: '已取消' })
  try { task.child?.kill() } catch { /* ignore */ }
  return true
}

async function runTask(task: SeparationTask, file: UploadedFilePart): Promise<void> {
  const venvPython = findVenvPython()
  if (!venvPython) {
    patch(task, { status: 'error', progress: 0, message: '音频分离需要本地 Python 环境（Demucs），云端部署暂不支持此功能', error: 'venv not found' })
    return
  }

  const workDir = join(WORK_ROOT, task.id)
  const outDir = join(workDir, 'out')
  const ext = extname(file.filename || '').toLowerCase() || '.wav'
  const inputPath = join(workDir, `input${ext}`)
  mkdirSync(workDir, { recursive: true })
  writeFileSync(inputPath, file.data)

  // 1. ffmpeg 统一转码为 44.1kHz 立体声 wav
  patch(task, { status: 'converting', progress: 5, message: '正在转换音频格式…' })
  const wavPath = join(workDir, 'converted.wav')
  try {
    await execFileAsync('ffmpeg', ['-y', '-i', inputPath, '-ar', '44100', '-ac', '2', '-sample_fmt', 's16', wavPath], {
      timeout: 120000,
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch (e) {
    patch(task, { status: 'error', progress: 5, message: '音频转码失败', error: (e as Error)?.message })
    return
  }
  if (task.cancelled) return

  // 2. demucs 分离（线程数受环境变量限制）
  patch(task, { status: 'separating', progress: 15, message: '正在分离音轨（首次运行需加载模型）…' })
  const args = ['main.py', wavPath, outDir, '--model', task.model]
  if (task.twoStems) args.push('--two-stems', task.twoStems)
  let files: string[] = []
  try {
    // 用 Promise 包装 execFile，确保 runTask 等待分离完成才 resolve（并发计数才正确）
    await new Promise<void>((resolve) => {
      const child = execFile(
        venvPython,
        args,
        {
          cwd: FEATURE_DIR,
          maxBuffer: 200 * 1024 * 1024,
          timeout: 600000,
          env: { ...process.env, SEPARATION_THREADS: String(SEPARATION_THREADS), SEPARATION_INTEROP_THREADS: '1' },
        },
        (err, stdout) => {
          if (err) {
            if (task.cancelled) { resolve(); return }
            patch(task, { status: 'error', progress: 15, message: '分离失败', error: err?.message })
            resolve()
            return
          }
          files = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
          if (!files.length) {
            patch(task, { status: 'error', progress: 15, message: '未生成分离结果', error: 'no output files' })
            resolve()
            return
          }
          void finalize(task, files, workDir, outDir).finally(resolve)
        },
      )
      task.child = child
    })
  } catch (e) {
    patch(task, { status: 'error', progress: 15, message: '分离失败', error: (e as Error)?.message })
    return
  }
  if (task.cancelled) return
}

async function finalize(task: SeparationTask, files: string[], workDir: string, outDir: string): Promise<void> {
  patch(task, { status: 'separating', progress: 90, message: '正在生成结果…' })
  const pubDir = join(PUBLIC_GEN, task.id)
  mkdirSync(pubDir, { recursive: true })
  const stems: SeparationStem[] = []
  for (const f of files) {
    if (!existsSync(f)) continue
    const base = basename(f)
    let name = base.replace(/\.wav$/i, '')
    const stemMatch = name.match(/(?:^|_)((?:no_)?(?:drums|bass|other|vocals))$/)
    if (stemMatch) name = stemMatch[1]
    const dest = join(pubDir, base)
    try {
      await copyFile(f, dest)
      stems.push({ name, url: `/generated/separation/${task.id}/${base}` })
    } catch { /* skip broken file */ }
  }
  if (!task.cancelled) {
    if (stems.length) {
      patch(task, { status: 'done', progress: 100, message: '分离完成', stems })
    } else {
      patch(task, { status: 'error', progress: 90, message: '未生成分离结果', error: 'no stems copied' })
    }
  }
  rm(workDir, { recursive: true, force: true }).catch(() => {})
}

/** 创建并提交分离任务，立即返回 taskId */
export function enqueueSeparation(file: UploadedFilePart, model: string, twoStems: string): { ok: boolean, taskId?: string, error?: string } {
  const m = (model || 'htdemucs').trim()
  const t = (twoStems || '').trim()
  if (!ALLOWED_MODELS.has(m)) return { ok: false, error: `Unsupported model: ${m}` }
  if (t && !ALLOWED_TWO_STEMS.has(t)) return { ok: false, error: `Unsupported twoStems: ${t}` }
  if (!file?.data?.length) return { ok: false, error: 'Missing audio file' }

  const task: SeparationTask = {
    id: randomUUID(),
    status: 'queued',
    progress: 0,
    message: '排队中…',
    createdAt: Date.now(),
    model: m,
    twoStems: t,
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
