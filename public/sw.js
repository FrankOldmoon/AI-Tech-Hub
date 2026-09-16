/* AI-Tech-Hub Service Worker —— 只缓存「应用外壳」，不碰模型文件。
 *
 * 设计约束（改动前务必先读，下面每条都对应一个已知坑）：
 * 1. /model/* 一律不缓存：模型动辄几十 MB，/model/* 已带长缓存响应头，交给浏览器 HTTP 缓存即可；
 *    SW 再存一份等于磁盘翻倍。而且模型缺失时该路由会 302 回退上游 CDN，缓存 302 会污染后续结果。
 * 2. /api/* 一律不缓存：模型状态页等接口必须实时。
 * 3. /_nuxt/builds/* 不缓存：那是 Nuxt 的构建版本探针。缓存住会让旧页面误判「已是最新」，
 *    继而请求新部署已删除的 chunk。只缓存 /_nuxt/ 下带内容哈希的静态资源（版本变化即换 URL，天然安全）。
 * 4. 导航请求 network-first：保证拿到最新 HTML；仅断网时回落到缓存的外壳，避免白屏。
 * 5. /apps/* 是随 public 一起发布的独立子应用（自带 SW 语义与相对路径），不介入。
 */

const SHELL_CACHE = 'ai-tech-hub-shell-v1'
const ASSET_CACHE = 'ai-tech-hub-assets-v1'

/** 预缓存的外壳入口：断网时至少能打开首页 */
const SHELL_ENTRIES = ['/']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    await Promise.all(SHELL_ENTRIES.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }))
      } catch {
        /* 单个入口失败不阻塞安装 */
      }
    }))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ASSET_CACHE])
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)))
    await self.clients.claim()
  })())
})

/** 这些路径完全交回浏览器/网络，SW 不参与 */
function isBypassed(url) {
  if (url.origin !== self.location.origin) return true
  const path = url.pathname
  return path.startsWith('/model/')
    || path.startsWith('/api/')
    || path.startsWith('/apps/')
    || path.startsWith('/_nuxt/builds/')
}

/** 可长期缓存的静态资源：/_nuxt/ 下的带哈希产物 */
function isImmutableAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/_nuxt/')
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  // Range 请求（大文件分片、视频拖动）必须由网络处理，命中缓存会返回 200 全量而破坏 206 语义
  if (request.headers.has('range')) return

  const url = new URL(request.url)
  if (isBypassed(url)) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request)
        if (fresh.ok) {
          const cache = await caches.open(SHELL_CACHE)
          await cache.put(request, fresh.clone()).catch(() => {})
        }
        return fresh
      } catch {
        const cache = await caches.open(SHELL_CACHE)
        return (await cache.match(request))
          || (await cache.match('/'))
          || Response.error()
      }
    })())
    return
  }

  if (!isImmutableAsset(url)) return

  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE)
    const hit = await cache.match(request)
    if (hit) return hit
    try {
      const fresh = await fetch(request)
      if (fresh.ok && fresh.type === 'basic') {
        await cache.put(request, fresh.clone()).catch(() => {})
      }
      return fresh
    } catch {
      return Response.error()
    }
  })())
})
