/**
 * /ide 的首次导览（见 app/program-world/tour.js）。
 *
 * 两条契约：
 *   · 第一次 Run 出图之后才出现，点完「下一步」就消失；
 *   · 之后再 Run、甚至刷新页面，都不再出现 —— 标记落在 localStorage 里。
 *
 * ⚠️ 这份 spec **不**预置「已看过」标记；另两个 ide spec 都预置了，因为它们不测
 * 导览，而导览在出现时会挡住页面上的点击。
 *
 * 跑法：
 *   npm run dev
 *   npx playwright test tests/e2e/ide-tour.spec.ts
 */
import { expect, test } from '@playwright/test'

const TOUR = '.pw-tour'

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

async function ready(page: import('@playwright/test').Page) {
  await expect(page.getByText(/Python .* ready/).first()).toBeVisible({ timeout: 120_000 })
}

test('第一次 Run 出图后出现导览，点「下一步」走完就消失', async ({ page }) => {
  await page.goto(codeUrl('print("hi")\n'))
  await ready(page)
  // Run 之前不该有导览
  await expect(page.locator(TOUR)).toBeHidden()

  await page.locator('#btnRun').click()

  const tour = page.locator(TOUR)
  await expect(tour).toBeVisible({ timeout: 60_000 })
  await expect(tour.locator('.tour-step')).toHaveText('1 / 4')
  await expect(tour.locator('.tour-title')).toHaveText('Your program, charted')
  // 导览讲的就是这张图，所以它先把图切到前台，聚光才有东西可框
  await expect(page.locator('#panelFlow')).toBeVisible()
  await expect(page.locator('#panelFlow .fc-node').first()).toBeVisible()

  for (let i = 0; i < 3; i++) await tour.locator('[data-tour="next"]').click()
  await expect(tour.locator('.tour-step')).toHaveText('4 / 4')
  await expect(tour.locator('[data-tour="next"]')).toHaveText('Done')

  await tour.locator('[data-tour="next"]').click()
  await expect(tour).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('pw.tour.v1'))).toBe('seen')

  // 同一次会话里再 Run 也不出现
  await page.locator('#btnRun').click()
  await expect(page.locator('#btnNext')).toBeEnabled({ timeout: 60_000 })
  await expect(tour).toBeHidden()
})

test('Skip 关掉也算看过：刷新页面再 Run 也不再出现', async ({ page }) => {
  await page.goto(codeUrl('print("hi")\n'))
  await ready(page)
  await page.locator('#btnRun').click()

  const tour = page.locator(TOUR)
  await expect(tour).toBeVisible({ timeout: 60_000 })
  await tour.locator('[data-tour="skip"]').click()
  await expect(tour).toBeHidden()

  await page.reload()
  await ready(page)
  await page.locator('#btnRun').click()

  // 没被挡住：页签点得动，图也画出来了
  await page.locator('#tabFlow').click()
  await expect(page.locator('#panelFlow .fc-node').first()).toBeVisible({ timeout: 60_000 })
  await expect(tour).toBeHidden()
})

test('Esc 也能关掉，并且记成看过', async ({ page }) => {
  await page.goto(codeUrl('print("hi")\n'))
  await ready(page)
  await page.locator('#btnRun').click()

  const tour = page.locator(TOUR)
  await expect(tour).toBeVisible({ timeout: 60_000 })
  await page.keyboard.press('Escape')
  await expect(tour).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('pw.tour.v1'))).toBe('seen')
})
