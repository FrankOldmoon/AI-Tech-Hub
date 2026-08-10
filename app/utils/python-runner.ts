// Python 后端调用客户端：统一与 /api/python/run 通信
// 约定：每个功能在 server/python/<feature>/main.py，使用各自 .venv 运行
// main.py 从 stdin 读取 JSON，向 stdout 输出 JSON

export interface PythonRunRequest {
  /** 模块路径，如 'speech/tts' -> server/python/speech/tts/main.py */
  feature: string
  /** 主输入文本 */
  input?: string
  /** 附加参数 */
  params?: Record<string, unknown>
}

export interface PythonRunResponse<T = unknown> {
  /** 是否成功执行并拿到结果 */
  ok: boolean
  /** 后端是否就绪（main.py 与 venv 是否存在） */
  available: boolean
  /** 后端返回的数据 */
  data?: T
  /** 错误信息 */
  error?: string
  /** 子进程 stdout（调试用） */
  stdout?: string
  /** 子进程 stderr（调试用） */
  stderr?: string
}

/** 调用 Python 后端运行指定 feature 的 main.py */
export async function runPython<T = unknown>(
  req: PythonRunRequest
): Promise<PythonRunResponse<T>> {
  return await $fetch<PythonRunResponse<T>>('/api/python/run', {
    method: 'POST',
    body: req
  })
}
