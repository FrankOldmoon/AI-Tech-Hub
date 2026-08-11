// 获取 python/<feature>/main.py 源码，带模块级缓存避免重复请求

export interface PythonSourceResponse {
  ok: boolean
  available: boolean
  source?: string
  fileName?: string
  error?: string
}

const cache = new Map<string, PythonSourceResponse>()

/**
 * 按 feature 路径获取 Python 源码（如 'speech/tts'）。
 * 同一 feature 只请求一次，结果在内存中缓存。
 */
export function usePythonSource() {
  async function fetchSource(feature: string): Promise<PythonSourceResponse> {
    if (!feature) return { ok: false, available: false, error: 'empty feature' }

    const hit = cache.get(feature)
    if (hit) return hit

    const res = await $fetch<PythonSourceResponse>('/api/python/source', {
      method: 'GET',
      query: { feature }
    })
    cache.set(feature, res)
    return res
  }

  return { fetchSource }
}
