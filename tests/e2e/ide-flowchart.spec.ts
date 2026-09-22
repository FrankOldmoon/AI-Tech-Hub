/**
 * IDE 右侧 Flowchart 面板的端到端契约。
 *
 * 四件事：
 *   · Run 跑完（哪怕程序自身报错）之后，入口文件被自动画成控制流图；
 *   · 图里的形状按语义分色，循环的回边是流动虚线；
 *   · 图和 Execution 的逐步执行联动 —— 点节点跳源码行，按步进高亮当前节点；
 *     图上只画代码，变量值留在 Execution 面板；
 *   · 跨文件的调用连着定义所在的那一行，可以就地展开；图能导出 SVG / PNG。
 *
 * 图是 worker 里用 Python 的 ast 解析源码得到的，所以必须先等运行时 ready、
 * 再 Run 一次（Run 会把运行时拉起来并触发首次绘图）。
 *
 * 跑法：
 *   npm run dev
 *   npx playwright test tests/e2e/ide-flowchart.spec.ts
 */
import { expect, test } from '@playwright/test'

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

/** 一段够全的小程序：函数 / for / if-else / input / print 都在里面 */
const PROGRAM = [
  'def total(n):',
  '    s = 0',
  '    for i in range(n):',
  '        s = s + i',
  '    return s',
  '',
  'x = int(input(\'n: \'))',
  'if x > 0:',
  '    print(total(x))',
  'else:',
  '    print(\'neg\')',
  ''
].join('\n')

/** 载入代码、喂一行标准输入、Run，然后切到 Flowchart 面板 */
async function runAndChart(page: import('@playwright/test').Page) {
  await page.goto(codeUrl(PROGRAM))
  await ready(page)
  await page.locator('#ioIn').fill('3')
  await page.locator('#btnRun').click()
  await page.locator('#tabFlow').click()
  await expect(page.locator('#panelFlow .fc-node').first()).toBeVisible({ timeout: 60_000 })
}

test('Run 后自动出图：判定/循环节点齐全，回边是流动虚线，计数就位', async ({ page }) => {
  await runAndChart(page)

  // 判定与循环各自成形状
  expect(await page.locator('#panelFlow .fc-if').count()).toBeGreaterThan(0)
  expect(await page.locator('#panelFlow .fc-for').count()).toBeGreaterThan(0)
  // def / input / print 各有其类
  expect(await page.locator('#panelFlow .fc-func').count()).toBeGreaterThan(0)
  expect(await page.locator('#panelFlow .fc-io').count()).toBeGreaterThan(0)
  // 循环回边（那条流动虚线）确实画出来了
  expect(await page.locator('#panelFlow .fc-e-loop').count()).toBeGreaterThan(0)
  // 工具栏计数
  await expect(page.locator('#panelFlow [data-fc="count"]')).toContainText('nodes')
  // 起止胶囊
  expect(await page.locator('#panelFlow .fc-start').count()).toBe(1)
  expect(await page.locator('#panelFlow .fc-end').count()).toBe(1)
})

test('点节点把源码跳到那一行（编辑器出现整行高亮）', async ({ page }) => {
  await runAndChart(page)

  // 取最外层的 input 节点（.fc-io 是输入输出框，叶子上的 data-line 才是命中区）
  const hit = page.locator('#panelFlow .fc-node.fc-io [data-line]').first()
  await hit.click({ force: true })

  // editor.js 的 highlight() 会给该行挂上 .cur-line 装饰
  await expect(page.locator('.monaco-editor .cur-line').first()).toBeVisible({ timeout: 15_000 })
})

/** 用户实际报过的那段：if/else + 一个两行的长 print */
const SAMPLE = [
  'hp = 100',
  'enemy = 80',
  '',
  'if enemy > hp:',
  '    print(\'die\')',
  'else:',
  '    print(\'win\')',
  'print("hp =", hp, " enemy =", enemy)',
  ''
].join('\n')

test('每个标签都居中在自己的形状里（曾经被平移两次，整张图错位）', async ({ page }) => {
  await page.goto(codeUrl(SAMPLE))
  await ready(page)
  await page.locator('#btnRun').click()
  await page.locator('#tabFlow').click()
  await expect(page.locator('#panelFlow .fc-node').first()).toBeVisible({ timeout: 60_000 })

  async function centred(what: string, node: import('@playwright/test').Locator) {
    const shape = await node.locator('rect, polygon').first().boundingBox()
    const label = await node.locator('text').first().boundingBox()
    expect(shape, `${what} 没有形状`).not.toBeNull()
    expect(label, `${what} 没有标签`).not.toBeNull()
    const dx = Math.abs((shape!.x + shape!.width / 2) - (label!.x + label!.width / 2))
    const dy = Math.abs((shape!.y + shape!.height / 2) - (label!.y + label!.height / 2))
    expect(dx, `${what} 的标签横向偏了 ${dx}px`).toBeLessThan(3)
    expect(dy, `${what} 的标签纵向偏了 ${dy}px`).toBeLessThan(3)
  }

  await centred('Start', page.locator('#panelFlow .fc-node.fc-start').first())
  await centred('判定菱形', page.locator('#panelFlow .fc-node.fc-if').first())
  await centred('单行 print', page.locator('#panelFlow .fc-node.fc-io').first())
  await centred('两行的长 print', page.locator('#panelFlow .fc-node.fc-io').last())
  await centred('End', page.locator('#panelFlow .fc-node.fc-end').first())

  // 整张图必须落在 svg 的 viewBox 里 —— 偏移两倍时下面的节点会跑到画布外
  const nodes = await page.locator('#panelFlow .fc-node').all()
  expect(nodes.length).toBeGreaterThan(5)
  const svg = await page.locator('#panelFlow svg.fc-svg').boundingBox()
  for (const node of nodes) {
    const box = await node.boundingBox()
    expect(box!.y + box!.height, '节点超出了 svg 下边界').toBeLessThanOrEqual(svg!.y + svg!.height + 1)
    expect(box!.x, '节点超出了 svg 左边界').toBeGreaterThanOrEqual(svg!.x - 1)
  }
})

test('逐步执行与图联动：步进后当前节点高亮', async ({ page }) => {
  await runAndChart(page)

  await expect(page.locator('#btnNext')).toBeEnabled({ timeout: 30_000 })
  await page.locator('#btnFirst').click()
  await page.locator('#btnNext').click()

  // 步进把 tracer 所在节点标成 .fc-now
  await expect(page.locator('#panelFlow .fc-now').first()).toBeVisible({ timeout: 15_000 })
})

test('图上只画代码，不画变量值（变量留给 Execution 面板）', async ({ page }) => {
  await runAndChart(page)

  await expect(page.locator('#btnNext')).toBeEnabled({ timeout: 30_000 })
  await page.locator('#btnFirst').click()
  // 走过几步，让作用域里确实有变量（hp / enemy 这些）
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('#btnNext').isEnabled())) break
    await page.locator('#btnNext').click()
  }

  // 图里没有变量值：既没有挂在节点上的 .fc-vars，也没有变量条
  await expect(page.locator('#panelFlow .fc-vars')).toHaveCount(0)
  await expect(page.locator('#panelFlow .fc-varsbar')).toHaveCount(0)
  // 形状里的文字仍然是代码本身
  await expect(page.locator('#panelFlow .fc-node text').first()).toContainText('total')
})

test('导出：SVG 与 PNG 各下载一份', async ({ page }) => {
  await runAndChart(page)

  const [svg] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#panelFlow [data-fc="svg"]').click()
  ])
  expect(svg.suggestedFilename()).toMatch(/\.flowchart\.svg$/)

  const [png] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#panelFlow [data-fc="png"]').click()
  ])
  expect(png.suggestedFilename()).toMatch(/\.flowchart\.png$/)
})

test('跨文件调用连着定义所在的文件，并能就地展开', async ({ page }) => {
  await page.goto('/ide')
  await ready(page)
  await page.selectOption('#examplePick', 'multifile')
  await page.locator('#btnRun').click()
  await page.locator('#tabFlow').click()

  // `helper.read_rows(...)` / `helper.total(...)` 各长出一行 ↳ helper.py:行号
  await expect(page.locator('#panelFlow .fc-link').first()).toBeVisible({ timeout: 60_000 })
  // 展开之前，图上没有别的文件的节点
  await expect(page.locator('#panelFlow .fc-node.fc-cross')).toHaveCount(0)

  await page.locator('#panelFlow .fc-expander').first().click()
  await expect(page.locator('#panelFlow .fc-node.fc-cross').first()).toBeVisible({ timeout: 15_000 })
})
