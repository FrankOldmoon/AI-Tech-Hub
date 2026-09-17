#!/usr/bin/env node
/**
 * Program World 的行为基线：把原来的浏览器测试台跑在移植后的代码上。
 *
 * 为什么不是 vitest：这套断言原本就跑在真实浏览器里 —— 用真实 DOM、真实 CSS、
 * 真实布局（FLIP 位移、style.order、房间/角色几何）和真实媒体查询
 * （prefers-reduced-motion）。jsdom 没有布局，这些断言等于失效，所以这里起一个
 * 静态服务器（模块只有相对 import，不需要打包）+ 无头 Chrome，用 CDP 取回
 * 测试台自己打印的 SUMMARY。
 *
 * 断言计数就是验收线：main 344 条、reduced-motion 4 条，全部必须通过。
 * 找不到 Chrome 时跳过并以 0 退出，这样在没有浏览器的环境里不会挡住别的检查。
 *
 * 用法：node scripts/test-program-world.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3078
const CDP_PORT = 9341

/* 计数即基线；改动要么是修 bug，要么是加断言，两者都应当在这里写明。 */
const EXPECTED = [
  { page: 'harness.html', ok: 344, label: 'main' },
  { page: 'harness-rm.html', ok: 4, label: 'reduced-motion', reducedMotion: true }
]

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean)

const chromePath = CHROME_CANDIDATES.find(p => existsSync(p))
if (!chromePath) {
  console.log('[test:program-world] 未找到 Chrome（可用 CHROME_PATH 指定），跳过。')
  process.exit(0)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm'
}

const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0])
  const file = join(ROOT, normalize(path))
  try {
    if (!file.startsWith(ROOT) || !statSync(file).isFile()) throw new Error('not a file')
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(readFileSync(file))
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise(r => server.listen(PORT, '127.0.0.1', r))

const profile = join(ROOT, '.program-world-test-profile')
rmSync(profile, { recursive: true, force: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function targetUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const page = list.find(t => t.type === 'page')
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(200)
  }
  throw new Error('无法连接 Chrome 调试端口')
}

function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url)
    ws.onopen = () => res(ws)
    ws.onerror = () => rej(new Error('CDP WebSocket 连接失败'))
  })
}

function client(ws) {
  let seq = 0
  const waiting = new Map()
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id === undefined) return
    const w = waiting.get(msg.id)
    if (w) {
      waiting.delete(msg.id)
      w(msg)
    }
  }
  return (method, params = {}) => {
    const id = ++seq
    return new Promise(resolve => {
      waiting.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1440,900',
  '--no-first-run', '--no-default-browser-check',
  'about:blank'
], { stdio: 'ignore' })

let failures = 0
try {
  const send = client(await connect(await targetUrl()))
  await send('Runtime.enable')
  await send('Page.enable')
  /* 这些断言量的是真实布局（FLIP 位移、房间/角色几何），所以视口必须固定：
     headless 默认 800x600 会让“幽灵停在原地”这类断言失去意义。 */
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
  })

  for (const t of EXPECTED) {
    if (t.reducedMotion) {
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      })
    }
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/tests/program-world/${t.page}` })
    let summary = null
    for (let i = 0; i < 80; i++) {
      await sleep(500)
      const r = await send('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__summary || null)',
        returnByValue: true
      })
      const raw = r.result && r.result.result ? r.result.result.value : null
      if (raw && raw !== 'null') { summary = JSON.parse(raw); break }
    }
    if (!summary) {
      console.log(`✖ ${t.label}: 测试台没有产出结果`)
      failures++
      continue
    }
    const pass = summary.fail === 0 && summary.ok === t.ok
    console.log(`${pass ? '✔' : '✖'} ${t.label}: ok=${summary.ok} fail=${summary.fail}（期望 ok=${t.ok}）`)
    for (const f of (summary.fails || []).slice(0, 10)) console.log(`    FAIL ${f}`)
    if (!pass) failures++
  }
} finally {
  chrome.kill()
  server.close()
  rmSync(profile, { recursive: true, force: true })
}

if (failures) {
  console.log(`[test:program-world] ${failures} 个测试台未通过`)
  process.exit(1)
}
console.log('[test:program-world] 全部通过')
