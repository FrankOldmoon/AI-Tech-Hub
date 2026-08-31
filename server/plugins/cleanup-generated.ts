/**
 * 产物自动清理（审计 P1-2）：
 * 任务输出写到 public/generated/<queue>/<taskId>/，之前永不删除、磁盘持续增长。
 * 启动时清理一次 + 每 6 小时清理超过 7 天的旧产物。
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const GENERATED_ROOT = join(process.cwd(), 'public', 'generated')
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const CLEAN_INTERVAL_MS = 6 * 60 * 60 * 1000

function cleanOnce(): void {
  if (!existsSync(GENERATED_ROOT)) return
  for (const queue of readdirSync(GENERATED_ROOT)) {
    const queueDir = join(GENERATED_ROOT, queue)
    try {
      if (!statSync(queueDir).isDirectory()) continue
    } catch {
      continue
    }
    for (const id of readdirSync(queueDir)) {
      const dir = join(queueDir, id)
      try {
        if (Date.now() - statSync(dir).mtimeMs > MAX_AGE_MS) {
          rmSync(dir, { recursive: true, force: true })
        }
      } catch {
        /* 单个任务失败不影响其他清理 */
      }
    }
  }
}

export default defineNitroPlugin(() => {
  cleanOnce()
  const timer = setInterval(cleanOnce, CLEAN_INTERVAL_MS)
  timer.unref?.()
})
