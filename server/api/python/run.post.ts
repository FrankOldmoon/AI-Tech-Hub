import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'

const execFileAsync = promisify(execFile)

const PYTHON_ROOT = resolve(process.cwd(), 'server/python')

interface RunBody {
  feature: string
  input?: string
  params?: Record<string, unknown>
}

/**
 * 调用 server/python/<feature>/main.py
 * 约定：
 *  - 每个功能在自己的目录下创建 .venv
 *  - main.py 从 stdin 读取 JSON { input, params }，向 stdout 输出 JSON
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
  const venvPython = join(featureDir, '.venv', 'bin', 'python')

  if (!existsSync(mainPy)) {
    return {
      ok: false,
      available: false,
      error: `main.py not found for feature: ${feature}`
    }
  }
  if (!existsSync(venvPython)) {
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
