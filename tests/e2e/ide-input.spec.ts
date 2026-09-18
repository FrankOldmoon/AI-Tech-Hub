/**
 * IDE 里 Python `input()` 的端到端契约。
 *
 * 为什么分两条用例：交互式输入靠 worker ↔ 主线程的 SharedArrayBuffer 桥，而 SAB
 * 只在**跨域隔离**下可用（COOP: same-origin + COEP: credentialless + CORP，见
 * nuxt.config.ts 的 NUXT_ENABLE_CROSS_ORIGIN_ISOLATION）。站点没开隔离时，worker
 * 里没有任何办法同步等用户 —— 那时的正确行为是给一句可执行的报错，而不是把 pyodide
 * 的 "ReferenceError: prompt is not defined" 甩给用户。两条契约都得钉住。
 *
 * 跑法（隔离必须在起 dev server 时就打开，它决定了响应头）：
 *   NUXT_ENABLE_CROSS_ORIGIN_ISOLATION=true npm run dev
 *   npx playwright test tests/e2e/ide-input.spec.ts
 * 或在已开启隔离的站点上：
 *   E2E_BASE_URL=https://<站点> npx playwright test tests/e2e/ide-input.spec.ts
 *
 * 地址必须是 /ide（跑 tracer 的 worker 版），不是 /ide/play —— 后者是 pygame 主线程
 * 游戏页，那里 prompt 本来就存在，压根到不了这条契约上。
 *
 * 用链接只把代码装进编辑器，**不**带 &run=1：自动运行会和「草稿/示例回填」抢时序，
 * 跑出来的结果可能被判为过期（面板显示 "Code changed since the last run"）。显式点
 * Run 才是一次可复现的运行。
 */
import { expect, test } from '@playwright/test'

const SRC = [
  'name = input(\'你叫什么？\')',
  'print(\'你好,\' + name)',
  ''
].join('\n')

function codeUrl(source: string): string {
  const b64 = Buffer.from(source, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `/ide?code=${b64}`
}

/** 载入 Python 运行时本身就要十几秒，给足 */
test.setTimeout(240_000)

test('input() 弹出输入框，值回到 Python 里', async ({ page }) => {
  const asked: string[] = []
  page.on('dialog', (dialog) => {
    asked.push(dialog.message())
    void dialog.accept('小明')
  })

  await page.goto(codeUrl(SRC))

  const isolated = await page.evaluate(() => globalThis.crossOriginIsolated === true)
  test.skip(!isolated, '站点未开启跨域隔离：worker 无法同步等输入，走的是「不可用」分支')

  // 等运行时就绪再点 Run（否则按钮点了也只是排队，弹框迟迟不来）
  await expect(page.getByText(/Python .* ready/).first()).toBeVisible({ timeout: 120_000 })
  await page.locator('#btnRun').click()

  // 弹框要带着程序写的提示语（不是一句笼统的 "input()"）
  await expect.poll(() => asked.join('\n'), { timeout: 120_000 }).toContain('你叫什么')
  // 运行时输出面板是**按步累积**的（outputs[i] 只含到第 i 步为止的输出），
  // 跑完停在 step 1，所以先跳到末步，才看得到 print 的结果
  await expect(page.locator('#stepPill')).not.toHaveText(/step 0 \/ 0/, { timeout: 120_000 })
  await page.locator('#btnLast').click()
  // 值真的进了 Python：print 的结果出现在输出里
  await expect(page.locator('body')).toContainText('你好,小明', { timeout: 60_000 })
})

test('未开启跨域隔离时，input() 给出可执行的报错而不是 prompt 未定义', async ({ page }) => {
  await page.goto(codeUrl(SRC))

  const isolated = await page.evaluate(() => globalThis.crossOriginIsolated === true)
  test.skip(isolated, '站点已开启跨域隔离：这条契约属于未隔离环境')

  await expect(page.getByText(/Python .* ready/).first()).toBeVisible({ timeout: 120_000 })
  await page.locator('#btnRun').click()

  // 错误面板同样只在末步渲染
  await expect(page.locator('#stepPill')).not.toHaveText(/step 0 \/ 0/, { timeout: 120_000 })
  await page.locator('#btnLast').click()
  // 等运行结束（错误面板出现）
  await expect(page.locator('body')).toContainText('input() is unavailable', { timeout: 60_000 })
  // 回归护栏：这个特定的 ReferenceError 说明又退回了 pyodide 的默认 stdin
  await expect(page.locator('body')).not.toContainText('prompt is not defined')
})
