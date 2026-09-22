/**
 * 数字人：点「初始化数字人」→ TalkingHead 渲染 + 口型识别就绪。
 *
 * 第二条用例的由来（2026-09-22 生产故障）：
 * 服务器上 nginx 用 `alias` 直出 /model/（见 docs/DEPLOY-AIHUB.md 第一节），而 nginx 的
 * mime.types 里没有 .mjs → 按 default_type 发成 application/octet-stream。浏览器对
 * ES module 强制校验 MIME，于是 import('/model/vendor/headaudio/headaudio.min.mjs') 被拒：
 *
 *   Failed to load module script: Expected a JavaScript-or-Wasm module script but the
 *   server responded with a MIME type of "application/octet-stream".
 *
 * 这条失败在 humanError 里匹配 /failed to fetch/，被归成网络问题 —— 学生看到的是
 * 「网络请求失败，请检查网络后重试」，与真实原因毫无关系（2026-09-22 就是用这条
 * 误导文案报上来的）。修法见 app/utils/vendored-module.ts：MIME 由前端自己给。
 *
 * 第二条用例把 .mjs 的响应改写成 octet-stream，复现那台反向代理的行为。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { blockingConsoleErrors, describeIssues, watchPage } from './support/console'

const INIT_BUTTON = /初始化数字人|Initialize/
/** 页面上唯一的成功标志：init() 跑完才挂上（见 digital-human.vue 的 window.__digitalHuman） */
const READY_FLAG = () => !!(window as unknown as { __digitalHuman?: unknown }).__digitalHuman

/** 点初始化并等就绪；失败时把页面上的报错原文带进断言，便于直接定位 */
async function initAvatar(page: Page) {
  await page.goto('/aigc/digital-human', { waitUntil: 'domcontentloaded' })

  /* 必须先等 hydration：SSR 出来的按钮在 Vue 挂载之前没有监听器，那时点下去既没反应
     也不报错 —— 用例会「假绿」（本用例第一版就是这么骗过自己的）。 */
  await page.waitForFunction(
    () => !!(document.querySelector('#__nuxt') as unknown as { __vue_app__?: unknown })?.__vue_app__,
    null,
    { timeout: 30_000 }
  )

  await page.getByRole('button', { name: INIT_BUTTON }).first().click()

  const ready = await page.waitForFunction(READY_FLAG, null, { timeout: 60_000 })
    .then(() => true)
    .catch(() => false)
  if (!ready) {
    // UAlert 不带 role=alert，只能按文案找
    const shown = (await page.locator('body').innerText())
      .split('\n')
      .find(line => /网络|失败|Network|Failed/.test(line)) ?? '（页面上没有任何报错）'
    expect(ready, `数字人没能初始化，页面显示的是：${shown}`).toBe(true)
  }
}

test('数字人：初始化后进入就绪，且无报错', async ({ page }) => {
  const issues = watchPage(page)

  await initAvatar(page)

  const blocking = blockingConsoleErrors(issues)
  expect(blocking.length, describeIssues('控制台还有这些错误', blocking)).toBe(0)
})

test('数字人：反向代理把 .mjs 当 octet-stream 发时也要能初始化', async ({ page }) => {
  const issues = watchPage(page)

  // 复现 nginx 的行为：文件照发 200，但 Content-Type 是 application/octet-stream。
  // 用正则而不是 glob —— dev 下 Vite 会给动态 import 的 URL 加 ?import 后缀，
  // 以 .mjs 结尾的 glob 匹配不到它。
  await page.route(/\/model\/.*\.mjs/, async (route) => {
    const res = await route.fetch()
    await route.fulfill({
      status: 200,
      headers: { ...res.headers(), 'content-type': 'application/octet-stream' },
      body: await res.body()
    })
  })

  await initAvatar(page)

  const blocking = blockingConsoleErrors(issues)
  expect(blocking.length, describeIssues('控制台还有这些错误', blocking)).toBe(0)
})
