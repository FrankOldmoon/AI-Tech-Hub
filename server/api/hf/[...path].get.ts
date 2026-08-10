/**
 * Hugging Face 镜像代理
 * 浏览器直接请求 hf-mirror.com 会被 CORS 拦截（仅允许 https://hf-mirror.com 来源），
 * 通过服务端代理转发，绕过 CORS 限制。
 *
 * 路径映射: /api/hf/{path} → https://hf-mirror.com/{path}
 */
export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path')
  if (!path) {
    throw createError({ statusCode: 400, statusMessage: 'Missing path' })
  }

  const url = `https://hf-mirror.com/${path}`
  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'nuxt-ai-demos/1.0',
        'Accept': '*/*'
      },
      redirect: 'follow'
    })

    if (!upstream.ok) {
      throw createError({
        statusCode: upstream.status,
        statusMessage: `Upstream error: ${upstream.statusText}`
      })
    }

    // 仅透传 content-type；不透传 content-encoding / content-length，
    // 因为服务端 fetch 已自动解压，浏览器会重复解压导致 ERR_CONTENT_DECODING_FAILED
    const headers: Record<string, string> = {}
    const ct = upstream.headers.get('content-type')
    if (ct) headers['content-type'] = ct

    return new Response(upstream.body, {
      status: upstream.status,
      headers
    })
  } catch (e: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `Proxy error: ${e?.message || 'unknown'}`
    })
  }
})
