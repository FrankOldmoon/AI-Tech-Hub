/**
 * 逐操作点击：注册表里每个 ready 的 demo，把它页面上的可交互控件逐个点一遍。
 *
 * 判定原则（见 support/controls.ts）：
 * - 点击本身失败（被遮挡/动画中）只记备注，不算失败；
 * - 点击**引发**的未捕获异常或「已知降级」之外的控制台错误 → 失败。
 *
 * 这一层覆盖「切标签 / 开关 / 选择格式 / 换示例 / 展开参数 / 开始-停止」这类操作。
 * 选算子并运行模型的重活单独放在 tools.spec.ts（慢，且只在模型齐备的机器上有意义）。
 */
import { expect, test } from '@playwright/test'
import { clickThrough } from './support/controls'
import { watchPage } from './support/console'
import { readyDemos, routeOf } from './support/routes'

for (const demo of readyDemos) {
  const path = routeOf(demo)

  test(`点遍 ${path} 的可交互控件`, async ({ page }, testInfo) => {
    const issues = watchPage(page)
    // confirm / prompt 一律取消，否则用例会卡在弹窗上
    page.on('dialog', dialog => void dialog.dismiss().catch(() => {}))

    const response = await page.goto(path, { waitUntil: 'domcontentloaded' })
    expect(response!.status(), `HTTP ${response!.status()}`).toBeLessThan(400)
    await expect(page.locator('h1').first()).toBeVisible()

    const outcome = await clickThrough(page, issues, path, testInfo)

    // 一个控件都点不到，通常意味着选择器或页面结构变了 —— 这种「静默失效」必须报出来
    expect(
      outcome.clicked,
      `${path} 没点到任何控件：要么这页真的没有可交互控件，要么采集选择器失效了`
    ).toBeGreaterThan(0)
  })
}
