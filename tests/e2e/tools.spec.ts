/**
 * 算子/任务遍历：在播放台页（ImagePlayground / AudioPlayground / NlpPlayground）里，
 * 把左侧工具栏的每一项都选中一次并触发一次运行。
 *
 * 这是「每个功能页的每个操作」里最重的一层：
 * - 真实模型会按需初始化，所以只在模型齐备的机器上有意义
 *   （`E2E_BASE_URL=https://10.28.1.152 npm run test:e2e:tools`）；本地 dev 没下模型时
 *   大量项会走联网兜底，很慢；
 * - 单条用例给了很长的超时，也可用 E2E_TOOL_TIMEOUT 放大；
 * - E2E_MAX_TOOLS 可只跑前 N 项，便于先小范围验证。
 *
 * 触发运行有两条路径，都覆盖到：
 * 1. 选中算子后页面自己会重跑（ImagePlayground 的 selectTool → runLater）；
 * 2. 显式点一次「运行」按钮（AudioPlayground / NlpPlayground 需要）。
 *
 * 断言原则同 operations.spec：不炸即通过 —— 模型缺失导致的失败，各页已有人话提示，
 * 不算失败（见 support/console.ts 的降级名单）。
 */
import { expect, test } from '@playwright/test'
import { blockingConsoleErrors, describeIssues, requestTail, serverErrorTail, watchPage } from './support/console'
import { readyDemos, routeOf } from './support/routes'

/** 只有这三类的页面由注册表驱动的工具栏承载 */
const SWEEP_CATEGORIES = new Set(['vision', 'speech', 'nlp'])
const playgrounds = readyDemos.filter(d => SWEEP_CATEGORIES.has(d.category))

test.setTimeout(Number(process.env.E2E_TOOL_TIMEOUT || 600_000))

/** 调试用：只跑前 N 个算子 */
const MAX_TOOLS = Number(process.env.E2E_MAX_TOOLS || 0)
/** 每个算子跑完的等待（模型可能首次初始化） */
const RUN_SETTLE = Number(process.env.E2E_RUN_SETTLE || 1200)

/** 空文字的按钮（纯图标）取不到名字，用 textContent 兜底 */
async function labelOf(locator: import('@playwright/test').Locator): Promise<string> {
  return locator
    .evaluate((el) => {
      const text = (el as HTMLElement).innerText || (el.textContent ?? '')
      return text.trim().replace(/\s+/g, ' ')
    })
    .catch(() => '')
}

for (const demo of playgrounds) {
  const path = routeOf(demo)

  test(`遍历 ${path} 的算子/任务`, async ({ page }, testInfo) => {
    const issues = watchPage(page)

    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('h1').first()).toBeVisible()

    const sidebar = page.getByTestId('tool-sidebar')
    const tools = sidebar.locator('button')
    const total = await tools.count()
    if (!total) {
      testInfo.annotations.push({ type: '跳过', description: '该页没有工具栏（不是播放台页）' })
      return
    }

    // 先喂一份输入：多数播放台的控件区（含「运行」）只在选中输入后才出现
    const sample = page.getByTestId('media-sample').first()
    if (await sample.isVisible().catch(() => false)) {
      await sample.click({ timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(RUN_SETTLE)
    }

    const limit = MAX_TOOLS > 0 ? Math.min(MAX_TOOLS, total) : total
    const runButton = page.getByRole('button', { name: /^(运行|Run)$/ }).first()
    const notes: string[] = []
    let ran = 0

    for (let i = 0; i < limit; i++) {
      const item = tools.nth(i)
      if (await item.isDisabled().catch(() => true)) continue
      const name = (await labelOf(item)) || `#${i}`

      const pageErrorsBefore = issues.pageErrors.length
      const consoleBefore = blockingConsoleErrors(issues).length

      // 工具栏列表在选中时不会重排，所以可以按下标稳定点击
      const picked = await item
        .click({ timeout: 5000 })
        .then(() => true)
        .catch(() => false)
      if (!picked) {
        notes.push(`选不中：${name}`)
        continue
      }
      await page.waitForTimeout(RUN_SETTLE)

      // 需要手动点运行的播放台：点一次（不在的话说明该页选中即自动重跑）
      if (await runButton.isVisible().catch(() => false)) {
        await runButton
          .click({ timeout: 5000 })
          .then(() => { ran++ })
          .catch(() => notes.push(`点不了运行：${name}`))
        await page.waitForTimeout(RUN_SETTLE)
      }

      const newPageErrors = issues.pageErrors.slice(pageErrorsBefore)
      expect(
        newPageErrors,
        describeIssues(`选中/运行「${name}」后出现未捕获异常（${path}）`, newPageErrors)
      ).toEqual([])

      const newConsole = blockingConsoleErrors(issues).slice(consoleBefore)
      expect(
        newConsole,
        describeIssues(`选中/运行「${name}」后出现控制台错误（${path}）`, newConsole)
        + requestTail(issues)
        + serverErrorTail(issues)
      ).toEqual([])
    }

    const summary = `工具栏 ${total} 项，遍历 ${limit} 项，显式点运行 ${ran} 次${notes.length ? `；备注：${notes.join('；')}` : ''}`
    testInfo.annotations.push({ type: '覆盖', description: summary })
    console.log(`[tools] ${path} — ${summary}`)
  })
}
