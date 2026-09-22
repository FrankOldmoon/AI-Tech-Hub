/**
 * IDE 里 Python `input()` 的端到端契约。
 *
 * 两条路，两种喂法：
 *   · Run：编辑器下方左边那个输入框就是程序的标准输入，一行一个答案、按顺序交给
 *     input()，用完就是 EOFError —— 和 `python main.py < in.txt` 一致；右边那个
 *     只读框显示程序打印出来的内容。
 *   · Run terminal：交互式。程序跑到 input() 就停在终端里等你，你在终端自己那行
 *     敲一行回车，它接着往下跑 —— 像真的 python 交互终端。
 *
 * 两条路都**不需要**跨域隔离、SharedArrayBuffer 或任何特殊响应头，也不需要 HTTPS：
 * worker 全程没有阻塞等待（终端是「读到没有就中止、拿到答案带更长输入重跑」实现的）。
 *
 * 跑法：
 *   npm run dev
 *   npx playwright test tests/e2e/ide-input.spec.ts
 *
 * 地址必须是 /ide（跑 tracer 的 worker 版），不是 /ide/play —— 后者是 pygame 主线程
 * 游戏页。
 *
 * 用链接只把代码装进编辑器，**不**带 &run=1：自动运行会和「草稿/示例回填」抢时序。
 */
import { expect, test } from '@playwright/test'

/* 导览只在「第一次 Run」之后出现，而且出现时会挡住页面上的点击（终端那行也点不到）。
   这个文件不测导览，所以先把「已看过」标记预置进去；导览本身在 ide-tour.spec.ts 里验。 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('pw.tour.v1', 'seen')
    } catch { /* 没有存储就用不了，导览会冒出来 */ }
  })
})

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

test('Run：input() 从左边输入框按行取值，print 的结果进右边输出框', async ({ page }) => {
  await page.goto(codeUrl([
    'name = input(\'你叫什么？\')',
    'print(\'你好,\' + name)',
    ''
  ].join('\n')))
  await ready(page)

  // 先填输入（一行一个答案），再 Run
  await page.locator('#ioIn').fill('小明')
  await page.locator('#btnRun').click()

  await expect(page.locator('#ioOut')).toHaveValue(/你好,小明/, { timeout: 120_000 })
})

test('Run：多行输入按顺序喂给连续的 input()', async ({ page }) => {
  await page.goto(codeUrl([
    'a = input(\'a: \')',
    'b = input(\'b: \')',
    'print(a + \'-\' + b)',
    ''
  ].join('\n')))
  await ready(page)

  await page.locator('#ioIn').fill('one\ntwo')
  await page.locator('#btnRun').click()

  await expect(page.locator('#ioOut')).toHaveValue(/one-two/, { timeout: 120_000 })
})

test('Run：输入不够时是真正的 EOFError，而不是 prompt 未定义', async ({ page }) => {
  await page.goto(codeUrl([
    'x = input(\'need: \')',
    'print(x)',
    ''
  ].join('\n')))
  await ready(page)

  // 一行都不填就 Run
  await page.locator('#btnRun').click()

  await expect(page.locator('#ioOut')).toHaveValue(/EOFError/, { timeout: 120_000 })
  // 回归护栏：这个特定的 ReferenceError 说明又退回了 worker 里不存在的 prompt
  await expect(page.locator('#ioOut')).not.toHaveValue(/prompt is not defined/)
})

test('Run terminal：input() 在终端自己那行一问一答', async ({ page }) => {
  await page.goto(codeUrl([
    'print(\'start\')',
    'name = input(\'name? \')',
    'print(\'hi \' + name)',
    ''
  ].join('\n')))
  await ready(page)

  await page.locator('#btnTerm').click()
  await expect(page.locator('#termModal')).toBeVisible({ timeout: 30_000 })

  // 程序跑到 input() 就停在终端里等你（提示语先出现在屏幕上）
  const term = page.locator('#termIn')
  await expect(term).toBeEnabled({ timeout: 120_000 })
  await expect(page.locator('#termOut')).toContainText('name?')
  await term.fill('ada')
  await term.press('Enter')

  // 你敲的那行回显在提示语后面，程序接着跑完
  await expect(page.locator('#termOut')).toContainText('name? ada', { timeout: 120_000 })
  await expect(page.locator('#termOut')).toContainText('hi ada', { timeout: 120_000 })
})

test('Run terminal：连续两次 input() 依次问答，输出不重复', async ({ page }) => {
  await page.goto(codeUrl([
    'a = input(\'a: \')',
    'b = input(\'b: \')',
    'print(a + \'-\' + b)',
    ''
  ].join('\n')))
  await ready(page)

  await page.locator('#btnTerm').click()
  const term = page.locator('#termIn')

  await expect(term).toBeEnabled({ timeout: 120_000 })
  await term.fill('one')
  await term.press('Enter')

  await expect(term).toBeEnabled({ timeout: 120_000 })
  await expect(page.locator('#termOut')).toContainText('a: one')
  await term.fill('two')
  await term.press('Enter')

  await expect(page.locator('#termOut')).toContainText('one-two', { timeout: 120_000 })
  // 「重跑」被按字符数对齐掉了：每一行只出现一次
  const shown = (await page.locator('#termOut').textContent()) || ''
  expect(shown.match(/a: /g)?.length).toBe(1)
  expect(shown.match(/b: /g)?.length).toBe(1)
})
