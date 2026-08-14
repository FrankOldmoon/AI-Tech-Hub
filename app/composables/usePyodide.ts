/**
 * 共享 Pyodide（浏览器内 Python 运行时）加载与执行。
 * - 模块级单例：多个页面复用同一实例，避免重复下载 ~10MB
 * - 通过 CDN 动态加载，不进入主包
 */

const PYODIDE_VERSION = '0.27.7'
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full`

const scriptCache = new Map<string, Promise<void>>()
function loadScript(src: string): Promise<void> {
  if (scriptCache.has(src)) return scriptCache.get(src)!
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptCache.delete(src)
      reject(new Error(`Failed to load ${src}`))
    }
    document.head.appendChild(script)
  })
  scriptCache.set(src, promise)
  return promise
}

let pyodideInstance: any = null
let pyodidePromise: Promise<any> | null = null

export interface PyodideResult {
  output: string
  hasError: boolean
}

/** 加载 Pyodide（幂等，返回单例实例） */
export async function ensurePyodide(): Promise<any | null> {
  if (import.meta.server) return null
  if (pyodideInstance) return pyodideInstance
  if (pyodidePromise) return pyodidePromise

  pyodidePromise = (async () => {
    await loadScript(`${PYODIDE_BASE}/pyodide.js`)
    const w = window as any
    const instance = await w.loadPyodide({ indexURL: `${PYODIDE_BASE}/` })
    pyodideInstance = instance
    return instance
  })()

  try {
    return await pyodidePromise
  } catch (e) {
    pyodidePromise = null
    throw e
  }
}

/** 运行一段 Python 代码，返回合并后的 stdout/stderr 与错误标记 */
export async function runPyodide(code: string, stdinText = ''): Promise<PyodideResult> {
  const pyodide = await ensurePyodide()
  if (!pyodide) return { output: 'Pyodide 加载失败', hasError: true }

  let stdout = ''
  let stderr = ''
  pyodide.setStdout({ batched: (msg: string) => { stdout += msg + '\n' } })
  pyodide.setStderr({ batched: (msg: string) => { stderr += msg + '\n' } })

  let stdinPos = 0
  pyodide.setStdin({
    stdin: () => {
      if (stdinPos >= stdinText.length) return null
      return stdinText.charCodeAt(stdinPos++)
    }
  })

  try {
    await pyodide.runPythonAsync(code)
    return { output: stdout + (stderr ? stderr : ''), hasError: false }
  } catch (e: any) {
    return {
      output: stdout + (stderr ? stderr : '') + (e?.message || String(e)),
      hasError: true
    }
  }
}
