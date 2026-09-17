/**
 * 逐操作点击的公共机械：枚举可交互控件 → 点一个 → 断言没冒出新错误 → 再枚举。
 *
 * 为什么每点一次都重新枚举：控件点下去之后 DOM 会变（按钮换文案、面板展开、列表重排），
 * 一次枚举出来的下标会漂移。用「标签 + 已点集合」做去重，比按 index 点稳得多。
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { blockingConsoleErrors, describeIssues, requestTail, type PageIssues } from './console'

/** 不点的控件：会触发浏览器下载（容易把用例挂住），也不是「功能」本身 */
const SKIP_TEXT = [/下载/, /download/i]

/** 单个页面最多点多少个控件：页面控件数量差异很大，封顶保证整套能在可接受时间内跑完 */
export const MAX_CLICKS_PER_PAGE = Number(process.env.E2E_MAX_CLICKS || 25)

/** 一个可点的对象：标签（用于去重与报告）+ 当前定位器 */
export interface Target {
  /** `${tag}|${text}` —— 同一个控件在 DOM 变化后仍能对上 */
  signature: string
  /** 人在报告里看到的名称 */
  label: string
  locator: Locator
}

const CANDIDATES = 'button:visible, [role="switch"]:visible, [role="tab"]:visible'

export async function collectTargets(
  page: Page,
  options: { root?: string, includeSidebar?: boolean } = {}
): Promise<Target[]> {
  // 页面可能已经被上一次点击搞没了（崩溃 / 被关闭），此时直接收工
  if (page.isClosed()) return []

  const locator = page.locator(options.root ?? 'body').locator(CANDIDATES)
  const count = await locator.count().catch(() => 0)
  const out: Target[] = []

  for (let i = 0; i < count; i++) {
    if (page.isClosed()) break
    const el = locator.nth(i)

    // 一次 evaluate 取齐所有信息（三次往返既慢又更容易撞上页面被关闭）
    const meta = await el
      .evaluate((node) => {
        const el = node as HTMLElement
        return {
          // innerText 对纯图标按钮是空串，用 textContent 兜底
          text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '),
          tag: el.getAttribute('role') || el.tagName.toLowerCase(),
          aria: el.getAttribute('aria-label') ?? '',
          disabled: (el as HTMLButtonElement).disabled === true,
          inSidebar: !!el.closest('[data-testid="tool-sidebar"]')
        }
      })
      .catch(() => null)

    if (!meta) continue
    // 工具栏里的算子归 tools.spec 管：这里再点一遍会重复触发模型加载，白等好几倍时间
    if (meta.inSidebar && !options.includeSidebar) continue

    const label = meta.text || meta.aria
    if (!label) continue
    if (SKIP_TEXT.some(re => re.test(meta.text) || re.test(meta.aria))) continue
    if (meta.disabled) continue
    out.push({ signature: `${meta.tag}|${label}`, label, locator: el })
  }
  return out
}

/** 关掉点击后可能弹出来的遮罩（下拉/弹层），避免它挡住下一个控件 */
async function dismissOverlays(page: Page) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(120)
}

export interface ClickOutcome {
  /** 点了多少个 */
  clicked: number
  /** 点不动 / 跳走了，只记录不判失败 */
  notes: string[]
}

/**
 * 把 root 范围内的可交互控件逐个点一遍，每次点完都检查错误。
 *
 * 判定原则：点击本身失败（被遮挡、动画中）不算失败 —— 那是环境噪声；
 * 但点击**引发**的未捕获异常/控制台错误一律算失败，那才是真问题。
 */
export async function clickThrough(
  page: Page,
  issues: PageIssues,
  route: string,
  testInfo: TestInfo,
  options: { root?: string, max?: number, includeSidebar?: boolean } = {}
): Promise<ClickOutcome> {
  const max = options.max ?? MAX_CLICKS_PER_PAGE
  const clicked = new Set<string>()
  const notes: string[] = []
  let count = 0

  for (let round = 0; round < max; round++) {
    if (page.isClosed()) {
      notes.push('页面在点完之前被关闭，后续控件跳过')
      break
    }
    const targets = await collectTargets(page, { root: options.root, includeSidebar: options.includeSidebar })
    const next = targets.find(t => !clicked.has(t.signature))
    if (!next) break
    clicked.add(next.signature)
    count++

    const errorsBefore = issues.pageErrors.length
    const consoleBefore = blockingConsoleErrors(issues).length

    const urlBefore = page.url()
    await next.locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {})
    const ok = await next.locator
      .click({ timeout: 3000 })
      .then(() => true)
      .catch(() => false)
    if (!ok) {
      notes.push(`点不动：${next.label}`)
      continue
    }

    await page.waitForTimeout(350)

    // 点出来的是跳转/遮罩，就把现场收回来再继续
    if (page.url() !== urlBefore) {
      notes.push(`触发了跳转：${next.label} → ${page.url()}`)
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(300)
      continue
    }
    await dismissOverlays(page)

    const newPageErrors = issues.pageErrors.slice(errorsBefore)
    expect(
      newPageErrors,
      describeIssues(`点「${next.label}」后出现未捕获异常（${route}）`, newPageErrors)
    ).toEqual([])

    const newConsole = blockingConsoleErrors(issues).slice(consoleBefore)
    expect(
      newConsole,
      describeIssues(`点「${next.label}」后出现控制台错误（${route}）`, newConsole) + requestTail(issues)
    ).toEqual([])
  }

  if (notes.length) testInfo.annotations.push({ type: '点击备注', description: notes.join('；') })
  return { clicked: count, notes }
}
