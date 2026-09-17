/**
 * 页面报错的采集与分类。
 *
 * 为什么要分类：本项目大量能力依赖外部条件（模型文件是否在本机、WebGPU 是否可用、
 * 浏览器的自动播放策略、是否插了摄像头），这些失败都是**设计内的降级** —— 页面会给出
 * 人话错误并继续可用，但控制台里一定会留下 error 级日志。若一律判失败，这套 E2E 会
 * 永远红着，最后没人看，等于没写。
 *
 * 因此策略是：
 * - 未捕获异常（pageerror）→ 一律失败（那是真 bug）
 * - 控制台 error → 命中「已知降级」名单才放过，其余失败
 * 名单要谨慎增补：每加一条就意味着一类错误不再能被发现。
 */
import type { Page } from '@playwright/test'

export interface PageIssues {
  /** 未捕获异常（window.onerror / unhandledrejection） */
  pageErrors: string[]
  /** 控制台 error 级日志 */
  consoleErrors: string[]
  /**
   * 网络层失败（ERR_CONNECTION_CLOSED / ERR_ABORTED …）。
   * 控制台的 "Failed to load resource" 不含 URL，光看它定位不了是哪个请求，
   * 所以单独记一份带 URL 的，失败时附在报错里。
   *
   * 存结构化对象而不是拼好的字符串：判定「能否忽略」要读 url，
   * 若把展示文本当数据解析，格式一变判定就静默失效。
   */
  failedRequests: FailedRequest[]
}

export interface FailedRequest {
  method: string
  url: string
  failure: string
}

/** 已知的「设计内降级」噪声 */
export const ALLOWED_CONSOLE_ERRORS: RegExp[] = [
  /favicon/i,
  // 模型文件缺失 → /model/* 会 302 回退远程（服务器上 faceapi、doodle 就是空的）
  /Failed to load resource.*\b(401|403|404)\b/i,
  // WebGPU 不可用（headless 或旧显卡）→ 各页回退 wasm / 给提示
  /webgpu|navigator\.gpu/i,
  // 自动播放、画中画、媒体元素被策略拦截
  /play\(\) failed|play was interrupted|autoplay|NotAllowedError/i,
  // 假设备无法满足 facingMode 等约束
  /OverconstrainedError|Requested device not found|NotFoundError/i,
  // 切页 / 切工具时中断在途请求
  /ERR_ABORTED|The user aborted a request/i,
  // MediaPipe 的 wasm 胶水层用 console.error 打 INFO 级日志（如 XNNPACK delegate），不是错误
  /INFO: .*TensorFlow Lite|XNNPACK delegate/i
]

export function watchPage(page: Page): PageIssues {
  const issues: PageIssues = { pageErrors: [], consoleErrors: [], failedRequests: [] }
  page.on('pageerror', e => issues.pageErrors.push(e.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.consoleErrors.push(msg.text())
  })
  page.on('requestfailed', (req) => {
    issues.failedRequests.push({
      method: req.method(),
      url: req.url(),
      failure: req.failure()?.errorText ?? 'unknown'
    })
  })
  return issues
}

/** 失败信息尾巴：把网络层失败（含 URL）附上，便于直接定位 */
export function requestTail(issues: PageIssues): string {
  if (!issues.failedRequests.length) return ''
  const uniq = [...new Set(issues.failedRequests.map(r => `${r.method} ${r.url} — ${r.failure}`))]
  return `\n  期间失败的网络请求（${uniq.length}）：\n${uniq.map(r => `    · ${r}`).join('\n')}`
}

/**
 * 第三方脚本域（统计/广告）：校园网 / 内网机器通常直接连不上。
 * 它们与本站功能无关，加载失败不该让 E2E 变红。
 * 来源见 app/utils/stats.ts（百度统计 + Google Analytics，随 Cookie 同意开关加载）。
 */
const THIRD_PARTY_HOSTS = [
  /hm\.baidu\.com/i,
  /hmcdn\.baidu\.com/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /doubleclick\.net/i,
  // MediaPipe 的匿名使用上报（内网跑必失败）。注意别扩大成整个 googleapis.com ——
  // storage.googleapis.com 是 TF.js 模型的真实来源，放进去会掩盖模型取不到的问题。
  /odml\.pa\.googleapis\.com/i
]

/**
 * 一条失败请求是否可以忽略：第三方统计域，或本地 blob:/data: 资源。
 * 后者被 abort 是正常现象 —— 换音源/换图时旧 objectURL 会被撤销。
 */
function ignorableRequest(req: FailedRequest): boolean {
  // 主动取消（切页/换输入时中断在途请求）不算失败
  if (/ERR_ABORTED/i.test(req.failure)) return true
  if (/^(blob|data):/i.test(req.url)) return true
  return THIRD_PARTY_HOSTS.some(re => re.test(req.url))
}

/**
 * 同期失败的网络请求是否**全部**可以忽略。
 *
 * 之所以要「全部」：控制台的 "Failed to load resource" 不带 URL，只有确认这一窗口里
 * 没有本站请求失败，才能判定这条是噪声。若混着 /model /api 的失败，就必须报出来。
 */
export function onlyIgnorableRequests(issues: PageIssues): boolean {
  return issues.failedRequests.length > 0 && issues.failedRequests.every(ignorableRequest)
}

export function isAllowedConsoleError(text: string, issues: PageIssues): boolean {
  if (ALLOWED_CONSOLE_ERRORS.some(re => re.test(text))) return true
  return /Failed to load resource/i.test(text) && onlyIgnorableRequests(issues)
}

/** 去掉已知降级噪声后仍然存在的控制台错误 —— 这些才算问题 */
export function blockingConsoleErrors(issues: PageIssues): string[] {
  return issues.consoleErrors.filter(text => !isAllowedConsoleError(text, issues))
}

/** 失败信息里带上原文，方便直接定位 */
export function describeIssues(label: string, list: string[]): string {
  return `${label}（${list.length}）：\n${list.map(t => `  - ${t}`).join('\n')}`
}
