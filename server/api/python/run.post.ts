import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'

const execFileAsync = promisify(execFile)

const PYTHON_ROOT = resolve(process.cwd(), 'python')

interface RunBody {
  feature: string
  input?: string
  params?: Record<string, unknown>
}

/**
 * 从 featureDir 向上查找最近的 .venv/bin/python（支持共享虚拟环境）。
 * 相同依赖的功能放在同一目录（如 mediapipe/、transformers/），
 * 在该目录根创建一个 .venv 即可被所有子功能共享。
 * 查找范围：featureDir → 上级目录 → … → PYTHON_ROOT。
 */
function findVenvPython(featureDir: string): string | null {
  let dir = featureDir
  while (dir.startsWith(PYTHON_ROOT)) {
    const venvPython = join(dir, '.venv', 'bin', 'python')
    if (existsSync(venvPython)) return venvPython
    if (dir === PYTHON_ROOT) break
    dir = resolve(dir, '..')
  }
  return null
}

/**
 * 调用 python/<feature>/main.py
 * 约定：
 *  - main.py 位于 feature 目录，从 stdin/argv 读取 JSON { input, params }，向 stdout 输出 JSON
 *  - 虚拟环境：先在 feature 目录找 .venv，再向上级目录查找（共享 venv）
 *  - 相同依赖的功能放在同一父目录，共享该目录下的 .venv
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<RunBody>(event)
  const feature = (body?.feature || '').trim()

  // 校验 feature 路径，防止目录穿越
  if (!feature || !/^[a-z0-9]+(\/[a-z0-9_-]+)*$/i.test(feature)) {
    return { ok: false, available: false, error: 'invalid feature' }
  }

  const featureDir = join(PYTHON_ROOT, feature)
  const mainPy = join(featureDir, 'main.py')
  const venvPython = findVenvPython(featureDir)

  if (!existsSync(mainPy)) {
    return {
      ok: false,
      available: false,
      error: `main.py not found for feature: ${feature}`
    }
  }
  if (!venvPython) {
    return {
      ok: false,
      available: false,
      error: 'venv not set up: create .venv and install requirements.txt'
    }
  }

  const payload = JSON.stringify({
    input: body.input ?? '',
    params: body.params ?? {}
  })

  try {
    // 通过 argv 传递 JSON 载荷（避免 stdin EOF 在某些环境下阻塞）
    const { stdout, stderr } = await execFileAsync(venvPython, ['main.py', payload], {
      cwd: featureDir,
      maxBuffer: 100 * 1024 * 1024,
      timeout: 120000
    })

    let data: unknown
    try {
      data = JSON.parse(stdout)
    } catch {
      data = { raw: stdout }
    }

    return { ok: true, available: true, data, stdout, stderr }
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string, stderr?: string, message?: string }
    return {
      ok: false,
      available: true,
      error: err?.message || 'exec failed',
      stdout: err?.stdout || '',
      stderr: err?.stderr || ''
    }
  }
})
