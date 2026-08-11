import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const PYTHON_ROOT = resolve(process.cwd(), 'python')

/**
 * 读取 python/<feature>/main.py 的源码用于前端展示。
 * 查询参数：?feature=speech/tts
 * 返回：{ ok, available, source?, fileName?, error? }
 */
export default defineEventHandler(async (event) => {
  const feature = (getQuery(event)?.feature as string || '').trim()

  // 校验 feature 路径，防止目录穿越（与 run.post.ts 一致）
  if (!feature || !/^[a-z0-9]+(\/[a-z0-9_-]+)*$/i.test(feature)) {
    return { ok: false, available: false, error: 'invalid feature' }
  }

  const featureDir = join(PYTHON_ROOT, feature)
  const mainPy = join(featureDir, 'main.py')

  if (!existsSync(mainPy)) {
    return {
      ok: false,
      available: false,
      error: `main.py not found for feature: ${feature}`
    }
  }

  try {
    const source = await readFile(mainPy, 'utf8')
    return {
      ok: true,
      available: true,
      source,
      fileName: `${feature}/main.py`
    }
  } catch (e) {
    return {
      ok: false,
      available: true,
      error: (e as Error)?.message || 'read failed'
    }
  }
})
