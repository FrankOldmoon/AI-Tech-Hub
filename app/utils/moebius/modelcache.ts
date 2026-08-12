// 模型字节下载 + Cache Storage 持久缓存（移植自 simonw/moebius-web，Apache-2.0）
// 用稳定 URL（.../resolve/main/<file>）作缓存键，避免 HF 签名 CDN URL 导致缓存永不命中
const CACHE_NAME = 'moebius-onnx-v1'

export interface DownloadProgress {
  (loaded: number, total: number, fromCache: boolean): void
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true
      return await navigator.storage.persist()
    }
  } catch {
    // 不支持则忽略
  }
  return false
}

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE_NAME)
  } catch {
    return null // 隐私模式等
  }
}

export async function loadModelBytes(
  url: string,
  onProgress?: DownloadProgress,
): Promise<Uint8Array> {
  const cache = await openCache()

  if (cache) {
    const hit = await cache.match(url)
    if (hit) {
      const buf = await hit.arrayBuffer()
      onProgress?.(buf.byteLength, buf.byteLength, true)
      return new Uint8Array(buf)
    }
  }

  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`fetch ${url} → HTTP ${resp.status}`)
  const total = Number(resp.headers.get('content-length')) || 0

  let bytes: Uint8Array
  const reader = resp.body?.getReader()
  if (reader && total > 0) {
    bytes = new Uint8Array(total)
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes.set(value, loaded)
      loaded += value.length
      onProgress?.(loaded, total, false)
    }
  } else {
    const buf = await resp.arrayBuffer()
    bytes = new Uint8Array(buf)
    onProgress?.(bytes.length, bytes.length, false)
  }

  if (cache) {
    try {
      await cache.put(url, new Response(bytes.buffer as ArrayBuffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(bytes.length),
        },
      }))
    } catch (e) {
      console.warn('[moebius] cache.put failed (continuing uncached):', e)
    }
  }
  return bytes
}

export async function clearModelCache(): Promise<void> {
  try {
    await caches.delete(CACHE_NAME)
  } catch {
    // ignore
  }
}

export async function cachedBytes(): Promise<number> {
  const cache = await openCache()
  if (!cache) return 0
  let total = 0
  for (const req of await cache.keys()) {
    const r = await cache.match(req)
    const len = Number(r?.headers.get('content-length')) || 0
    total += len
  }
  return total
}
