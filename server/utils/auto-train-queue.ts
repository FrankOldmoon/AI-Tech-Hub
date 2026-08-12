/**
 * CSV 自动训练异步任务队列
 * - POST /api/ml/auto-train -> 立即返回 taskId（multipart: file + target + task）
 * - GET  /api/ml/auto-train/:id -> 轮询进度/状态
 * - DELETE /api/ml/auto-train/:id -> 取消任务
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

const PYTHON_ROOT = resolve(process.cwd(), 'python')
const FEATURE_DIR = join(PYTHON_ROOT, 'ml', 'auto-train')
const WORK_ROOT = join(process.cwd(), 'tmp', 'auto-train')
const PUBLIC_GEN = resolve(process.cwd(), 'public', 'generated', 'auto-train')

const MAX_CONCURRENT = 1
const MAX_FILE_MB = 10
const MAX_ROWS = 50000

export type AutoTrainStatus = 'queued' | 'processing' | 'done' | 'error' | 'cancelled'

export interface AutoTrainTaskView {
  id: string
  status: AutoTrainStatus
  progress: number
  message: string
  error?: string
  reportUrl?: string
  createdAt: number
}

interface AutoTrainTask extends AutoTrainTaskView {
  cancelled: boolean
  child?: ReturnType<typeof execFile>
}

interface UploadedFilePart {
  filename?: string
  data: Buffer
}

const tasks = new Map<string, AutoTrainTask>()
let running = 0
const queue: Array<() => void> = []

function findVenvPython(): string | null {
  const candidates = [
    join(FEATURE_DIR, '.venv', 'Scripts', 'python.exe'),
    join(FEATURE_DIR, '.venv', 'bin', 'python'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function patch(task: AutoTrainTask, p: Partial<AutoTrainTaskView>): void {
  Object.assign(task, p)
}

function next(): void {
  const run = queue.shift()
  if (run) run()
}

export function getAutoTrainTask(id: string): AutoTrainTaskView | null {
  const t = tasks.get(id)
  if (!t) return null
  const { child: _c, cancelled: _x, ...view } = t
  return view
}

export function cancelAutoTrainTask(id: string): boolean {
  const task = tasks.get(id)
  if (!task) return false
  if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') return false
  task.cancelled = true
  patch(task, { status: 'cancelled', progress: 0, message: '已取消' })
  try { task.child?.kill() } catch { /* ignore */ }
  return true
}

async function runTask(task: AutoTrainTask, file: UploadedFilePart, target: string, taskType: string): Promise<void> {
  const venvPython = findVenvPython()
  if (!venvPython) {
    patch(task, { status: 'error', progress: 0, message: 'CSV 自动训练需要本地 Python 环境，云端部署暂不支持', error: 'venv not found' })
    return
  }

  if (file.data.length > MAX_FILE_MB * 1024 * 1024) {
    patch(task, { status: 'error', progress: 0, message: `文件不能超过 ${MAX_FILE_MB}MB`, error: 'file too large' })
    return
  }

  const workDir = join(WORK_ROOT, task.id)
  const ext = extname(file.filename || '').toLowerCase() || '.csv'
  if (ext !== '.csv') {
    patch(task, { status: 'error', progress: 0, message: '仅支持 CSV 文件', error: 'not csv' })
    return
  }
  mkdirSync(workDir, { recursive: true })
  const csvPath = join(workDir, `input${ext}`)
  writeFileSync(csvPath, file.data)
  writeFileSync(join(workDir, 'params.json'), JSON.stringify({
    target,
    task: taskType,
    test_size: 0.2,
  }))

  patch(task, { status: 'processing', progress: 10, message: '正在训练模型（首次运行需创建 Python 环境）…' })
  const reportPath = join(workDir, 'report.json')
  try {
    await new Promise<void>((resolvePromise) => {
      const child = execFile(
        venvPython,
        ['main.py', csvPath, join(workDir, 'params.json'), reportPath],
        { cwd: FEATURE_DIR, maxBuffer: 50 * 1024 * 1024, timeout: 600000, env: { ...process.env, OMP_NUM_THREADS: '6' } },
        (err) => {
          if (err) {
            if (task.cancelled) { resolvePromise(); return }
            patch(task, { status: 'error', progress: 50, message: '训练失败', error: err?.message })
            resolvePromise()
            return
          }
          if (!task.cancelled && existsSync(reportPath)) {
            const pubDir = join(PUBLIC_GEN, task.id)
            mkdirSync(pubDir, { recursive: true })
            copyFile(reportPath, join(pubDir, 'report.json'))
              .then(() => patch(task, { status: 'done', progress: 100, message: '训练完成', reportUrl: `/generated/auto-train/${task.id}/report.json` }))
              .catch((e) => patch(task, { status: 'error', progress: 90, message: '结果生成失败', error: (e as Error)?.message }))
          } else if (!task.cancelled) {
            patch(task, { status: 'error', progress: 90, message: '未生成报告', error: 'no output' })
          }
          resolvePromise()
        },
      )
      task.child = child
    })
  } catch (e) {
    patch(task, { status: 'error', progress: 15, message: '训练失败', error: (e as Error)?.message })
    return
  }
  rm(workDir, { recursive: true, force: true }).catch(() => {})
}

export function enqueueAutoTrain(file: UploadedFilePart, target: string, taskType: string): { ok: boolean, taskId?: string, error?: string } {
  if (process.env.VERCEL) {
    return { ok: false, error: 'CSV 自动训练需要本地 Python 环境，云端部署不支持此功能。请在本地运行 pnpm dev 后使用。' }
  }
  if (!file?.data?.length) return { ok: false, error: 'Missing CSV file' }
  if (!target) return { ok: false, error: 'Missing target column' }

  const task: AutoTrainTask = {
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
    void runTask(task, file, target, taskType).finally(() => {
      running--
      next()
    })
  }
  if (running < MAX_CONCURRENT) start()
  else queue.push(start)
  return { ok: true, taskId: task.id }
}
