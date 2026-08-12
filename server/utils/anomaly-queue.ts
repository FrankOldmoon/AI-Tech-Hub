/**
 * 异常检测异步任务队列
 * - POST /api/ml/anomaly (multipart: file + xCol + yCol + contamination)
 * - GET /api/ml/anomaly/:id / DELETE /api/ml/anomaly/:id
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

const FEATURE_DIR = resolve(process.cwd(), 'python', 'ml', 'anomaly')
const WORK_ROOT = join(process.cwd(), 'tmp', 'anomaly')
const PUBLIC_GEN = resolve(process.cwd(), 'public', 'generated', 'anomaly')
const MAX_CONCURRENT = 1

export type AnomalyStatus = 'queued' | 'processing' | 'done' | 'error' | 'cancelled'

export interface AnomalyTaskView {
  id: string
  status: AnomalyStatus
  progress: number
  message: string
  error?: string
  reportUrl?: string
  createdAt: number
}

interface AnomalyTask extends AnomalyTaskView {
  cancelled: boolean
  child?: ReturnType<typeof execFile>
}

interface UploadedFilePart { filename?: string, data: Buffer }

const tasks = new Map<string, AnomalyTask>()
let running = 0
const queue: Array<() => void> = []

function findVenvPython(): string | null {
  const candidates = [join(FEATURE_DIR, '.venv', 'Scripts', 'python.exe'), join(FEATURE_DIR, '.venv', 'bin', 'python')]
  return candidates.find((p) => existsSync(p)) ?? null
}

function patch(t: AnomalyTask, p: Partial<AnomalyTaskView>): void { Object.assign(t, p) }
function next(): void { queue.shift()?.() }

export function getAnomalyTask(id: string): AnomalyTaskView | null {
  const t = tasks.get(id)
  if (!t) return null
  const { child: _c, cancelled: _x, ...view } = t
  return view
}

export function cancelAnomalyTask(id: string): boolean {
  const t = tasks.get(id)
  if (!t || ['done', 'error', 'cancelled'].includes(t.status)) return false
  t.cancelled = true
  patch(t, { status: 'cancelled', progress: 0, message: '已取消' })
  try { t.child?.kill() } catch { /* ignore */ }
  return true
}

async function runTask(task: AnomalyTask, file: UploadedFilePart, xCol: string, yCol: string, contamination: number): Promise<void> {
  const venvPython = findVenvPython()
  if (!venvPython) {
    patch(task, { status: 'error', progress: 0, message: '异常检测需要本地 Python 环境，云端部署暂不支持', error: 'venv not found' })
    return
  }
  if (file.data.length > 10 * 1024 * 1024) {
    patch(task, { status: 'error', progress: 0, message: '文件不能超过 10MB', error: 'file too large' })
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
  writeFileSync(join(workDir, 'params.json'), JSON.stringify({ x_col: xCol, y_col: yCol, contamination }))

  patch(task, { status: 'processing', progress: 10, message: '正在训练 IsolationForest…' })
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
            patch(task, { status: 'error', progress: 50, message: '检测失败', error: err?.message })
            resolvePromise()
            return
          }
          if (!task.cancelled && existsSync(reportPath)) {
            const pubDir = join(PUBLIC_GEN, task.id)
            mkdirSync(pubDir, { recursive: true })
            copyFile(reportPath, join(pubDir, 'report.json'))
              .then(() => patch(task, { status: 'done', progress: 100, message: '检测完成', reportUrl: `/generated/anomaly/${task.id}/report.json` }))
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
    patch(task, { status: 'error', progress: 15, message: '检测失败', error: (e as Error)?.message })
    return
  }
  rm(workDir, { recursive: true, force: true }).catch(() => {})
}

export function enqueueAnomaly(file: UploadedFilePart, xCol: string, yCol: string, contamination: number): { ok: boolean, taskId?: string, error?: string } {
  if (process.env.VERCEL) {
    return { ok: false, error: '异常检测需要本地 Python 环境，云端部署不支持此功能。请在本地运行 pnpm dev 后使用。' }
  }
  if (!file?.data?.length) return { ok: false, error: 'Missing CSV file' }
  if (!xCol || !yCol) return { ok: false, error: 'Missing columns' }
  const task: AnomalyTask = {
    id: randomUUID(), status: 'queued', progress: 0, message: '排队中…', createdAt: Date.now(), cancelled: false,
  }
  tasks.set(task.id, task)
  const start = () => {
    running++
    void runTask(task, file, xCol, yCol, contamination).finally(() => { running--; next() })
  }
  if (running < MAX_CONCURRENT) start()
  else queue.push(start)
  return { ok: true, taskId: task.id }
}
