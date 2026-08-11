/**
 * 自动扫描 python 下的 Python 项目，
 * 为每个包含 requirements.txt 的目录创建虚拟环境并安装依赖。
 *
 * - 已存在 .venv 的目录会跳过
 * - 在后台异步执行，不阻塞服务器启动
 * - 通过 server plugin 在服务器启动时自动触发
 */
import { existsSync, readdirSync } from 'node:fs'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve, sep } from 'node:path'

const execAsync = promisify(exec)

const PYTHON_ROOT = resolve(process.cwd(), 'python')

// Windows 与 Linux/macOS 下虚拟环境目录布局不同
const isWindows = process.platform === 'win32'
const VENV_BIN = isWindows ? join('.venv', 'Scripts') : join('.venv', 'bin')
// Windows 上 `python` 可能是 Microsoft Store 的占位程序，需回退到 `py -3`
const VENV_CREATE_CMDS = isWindows
  ? ['python -m venv .venv', 'py -3 -m venv .venv']
  : ['python3 -m venv .venv']

// 防止并发重复执行
let running = false

/** 递归扫描目录，返回所有包含 requirements.txt 的目录路径。 */
function findRequirementsDirs(root: string): string[] {
  const results: string[] = []
  if (!existsSync(root)) return results

  const walk = (dir: string) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    // 如果当前目录有 requirements.txt，注册并不再深入
    if (entries.some(e => e.isFile() && e.name === 'requirements.txt')) {
      results.push(dir)
      return
    }
    for (const entry of entries) {
      // 跳过 .venv、__pycache__、tmp 等无关目录
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__pycache__' && entry.name !== 'tmp') {
        walk(join(dir, entry.name))
      }
    }
  }
  walk(root)
  return results
}

/** 相对路径辅助。 */
function relativePath(fullPath: string): string {
  return fullPath.replace(PYTHON_ROOT + sep, '')
}

/** 为单个 Python 项目创建虚拟环境并安装依赖。 */
async function setupVenv(featureDir: string): Promise<void> {
  const venvPython = join(featureDir, VENV_BIN, isWindows ? 'python.exe' : 'python')
  const venvPip = join(featureDir, VENV_BIN, isWindows ? 'pip.exe' : 'pip')
  const reqFile = join(featureDir, 'requirements.txt')
  const relDir = relativePath(featureDir)

  // 已存在且 pip 可用 → 跳过
  if (existsSync(venvPip)) {
    console.log(`[python-setup] SKIP (venv exists): ${relDir}`)
    return
  }

  console.log(`[python-setup] Creating venv: ${relDir}`)
  // 创建虚拟环境（exec 默认 stdio=pipe，不会 EBADF）
  try {
    let lastErr: unknown
    for (const cmd of VENV_CREATE_CMDS) {
      try {
        await execAsync(cmd, {
          cwd: featureDir,
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024
        })
        lastErr = undefined
        break
      } catch (e) {
        lastErr = e
      }
    }
    if (lastErr) throw lastErr
  } catch (e: any) {
    console.error(`[python-setup] ERROR creating venv for ${relDir}: ${e?.message || e}`)
    return
  }

  // 安装依赖
  console.log(`[python-setup] Installing dependencies: ${relDir}`)
  try {
    const { stderr } = await execAsync(
      `"${venvPython}" -m pip install -r "${reqFile}" --disable-pip-version-check`,
      {
        cwd: featureDir,
        timeout: 600000, // 10 分钟超时（torch 等大包安装较慢）
        maxBuffer: 50 * 1024 * 1024
      }
    )
    if (stderr) {
      // pip 的进度信息输出到 stderr，不一定是错误
      const lines = stderr.split('\n').filter((l: string) => l.trim())
      const tail = lines.slice(-3).join('\n')
      console.log(`[python-setup] pip output (${relDir}): ${tail}`)
    }
    console.log(`[python-setup] OK: ${relDir}`)
  } catch (e: any) {
    console.error(`[python-setup] ERROR installing deps for ${relDir}: ${e?.message || e}`)
    if (e?.stderr) {
      console.error(`[python-setup] pip stderr: ${e.stderr.slice(-500)}`)
    }
  }
}

/**
 * 扫描并设置所有 Python 项目的虚拟环境。
 * 已存在 .venv 的项目会跳过，只设置缺失的。
 * 通过 server plugin 在服务器启动时自动调用。
 */
export async function setupAllPythonEnvs(): Promise<void> {
  if (running) {
    console.log('[python-setup] 已在运行中，跳过本次触发')
    return
  }
  running = true
  console.log(`[python-setup] 扫描 ${PYTHON_ROOT} 下的 Python 项目…`)
  try {
    const dirs = findRequirementsDirs(PYTHON_ROOT)
    if (!dirs.length) {
      console.log('[python-setup] 未找到任何 requirements.txt，跳过')
      return
    }
    console.log(`[python-setup] 发现 ${dirs.length} 个 Python 项目`)
    for (const dir of dirs) {
      await setupVenv(dir)
    }
    console.log('[python-setup] 全部 Python 环境设置完成')
  } catch (e: any) {
    console.error(`[python-setup] 出错: ${e?.message || e}`)
  } finally {
    running = false
  }
}
