/**
 * 全站路由冒烟：注册表里每个 ready 的 demo 都真开一遍。
 *
 * 断言四件事（都指向「用户打开这一页不会看到坏的画面」）：
 * 1. HTTP < 400；
 * 2. 有标题骨架，且标题属于该 demo（能抓住「渲染了错的页」和「回退到未找到」）；
 * 3. 没有未捕获异常；
 * 4. 没有「已知降级」之外的控制台错误（名单见 support/console.ts）。
 *
 * 这一层**不点任何按钮**，只保证「每一页都能打开」。逐操作点击在 operations.spec.ts。
 */
import { expect, test } from '@playwright/test'
import { blockingConsoleErrors, describeIssues, requestTail, watchPage } from './support/console'
import { readyDemos, routeOf, titlesOf } from './support/routes'

for (const demo of readyDemos) {
  const path = routeOf(demo)

  test(`打开 ${path}`, async ({ page }) => {
    const issues = watchPage(page)

    const response = await page.goto(path, { waitUntil: 'domcontentloaded' })
    expect(response, '没有拿到 HTTP 响应').not.toBeNull()
    expect(response!.status(), `HTTP ${response!.status()} ${path}`).toBeLessThan(400)

    // 标题骨架先出来（模型初始化会晚于此，但这页至少已经是「那一页」了）
    const h1 = page.locator('h1').first()
    await expect(h1, `${path} 没有 h1 骨架`).toBeVisible()

    const heading = (await h1.innerText()).trim()
    expect(heading.length, `${path} 的 h1 是空的`).toBeGreaterThan(0)
    const titles = titlesOf(demo)
    expect(
      titles.some(t => heading.includes(t)),
      `${path} 的 h1=${JSON.stringify(heading)}，既不是 ${titles[0]} 也不是 ${titles[1]}`
    ).toBe(true)

    // 给首屏的副作用（示例图/模型初始化）一点时间，让错误有机会冒出来
    await page.waitForTimeout(400)

    expect(issues.pageErrors, describeIssues(`${path} 有未捕获异常`, issues.pageErrors)).toEqual([])
    const blocking = blockingConsoleErrors(issues)
    expect(blocking, describeIssues(`${path} 有控制台错误`, blocking) + requestTail(issues)).toEqual([])
  })
}
