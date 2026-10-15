/**
 * /v1/** 的跨域支持：让外部网页（浏览器直连）也能调用本兼容 API。
 *
 * - 对 /v1/* 响应统一追加 CORS 头；
 * - OPTIONS 预检直接 204 结束（/v1 下没有 OPTIONS 路由，拦截在这里避免 404）。
 * 其余路径不受影响，/api/** 维持同源默认。
 */
import { sendNoContent, setResponseHeaders } from 'h3'

export default defineEventHandler((event) => {
  if (!event.path.startsWith('/v1/')) return

  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400'
  })
  if (event.method === 'OPTIONS') {
    return sendNoContent(event)
  }
})
