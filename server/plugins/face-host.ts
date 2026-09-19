import { isIP } from 'node:net'

/* =====================================================================
   /face（学生人脸识别）的访问控制 —— 只认 IP 直连。

   这个工具带学生姓名/班级/人脸特征（public/face/students-face-data.json），
   所以整条 /face 路径（页面 + 特征库 + 模型 + 客户端脚本）都只允许用 IP 访问：
   一旦请求的 Host 是个域名，就直接 302 回首页。

   运行时（IP 直连）   http://10.28.1.152/face     → 放行
   域名访问            https://aihub.example/face  → 302 /
   localhost 也不算 IP，本地调试请用 http://127.0.0.1:3000/face

   为什么用 nitro plugin 的 request 钩子，而不是 server/middleware：
   Nitro 把 public/ 的静态资源挂在整条中间件链**之前**，`/face/app.js`、
   `/face/students-face-data.json` 这类文件会绕过 server/middleware 直接出网。
   request 钩子在 h3 应用栈开跑之前触发，且 sendRedirect 会立刻写响应
   （h3 后续的 send 见到 event.handled 就不再输出），静态文件也一并拦住。

   注意：生产是 nginx 反代到 127.0.0.1:80（见 docs/DEPLOY-AIHUB.md），若 nginx
   不转发原始 Host，这里看到的永远是 127.0.0.1，守卫就会失效。nginx 侧需要
   proxy_set_header Host $host; 与 proxy_set_header X-Forwarded-Host $host;
   ===================================================================== */

/** Host 头 → 主机名：去掉端口，拆掉 IPv6 的方括号（[::1]:3000 → ::1）。 */
function hostnameOf(host: string): string {
  const h = (host || '').trim()
  if (!h) return ''
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    return end > 0 ? h.slice(1, end) : h
  }
  const colon = h.lastIndexOf(':')
  return colon > 0 ? h.slice(0, colon) : h
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const path = getRequestURL(event).pathname
    if (path !== '/face' && !path.startsWith('/face/')) return

    /* 反代后面 Host 可能已被改写，优先用 nginx 透传的原始主机 */
    const raw = getRequestHeader(event, 'x-forwarded-host') || getRequestHeader(event, 'host') || ''
    const forwarded = raw.split(',')[0] || ''
    if (isIP(hostnameOf(forwarded))) return

    return sendRedirect(event, '/', 302)
  })
})
