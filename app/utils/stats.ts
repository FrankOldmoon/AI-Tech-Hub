/**
 * 站点统计（百度统计 + GA4）——合规条件化加载（P2-3）
 *
 * 原实现：nuxt.config.ts app.head 无条件注入（拒绝也加载 → 不合规）。
 * 现改为：
 * - 首屏不再注入任何统计脚本；
 * - 用户接受后加载（CookieConsent.vue 或本机已存「同意」时由插件注入）；
 * - 用户拒绝 / 未选择：不加载、不影响功能。
 *
 * 存储：localStorage `aihub-stats-consent`（'accepted' | 'declined'），仅本机。
 */

const CONSENT_KEY = 'aihub-stats-consent'
const BAIDU_ID = '86faec7849fa9c0a981876f7193cebfd'
const GA_ID = 'G-PMGVZBWTZQ'

/** 读取用户选择；未选择返回 null；SSR 返回 null */
export function readStatsConsent(): 'accepted' | 'declined' | null {
  if (import.meta.server) return null
  try {
    const v = localStorage.getItem(CONSENT_KEY)
    return v === 'accepted' || v === 'declined' ? v : null
  } catch {
    return null
  }
}

/** 写入用户选择（仅客户端） */
export function setStatsConsent(v: 'accepted' | 'declined') {
  try {
    localStorage.setItem(CONSENT_KEY, v)
  } catch { /* 隐私模式等场景忽略 */ }
}

let loaded = false

/** 注入百度统计 + GA4 脚本（幂等，仅客户端） */
export function loadStatsScripts() {
  if (import.meta.server || loaded) return
  loaded = true
  try {
    // 百度统计
    const hm = document.createElement('script')
    hm.async = true
    hm.src = `https://hm.baidu.com/hm.js?${BAIDU_ID}`
    document.head.appendChild(hm)

    // Google Analytics (GA4)
    const gtag = document.createElement('script')
    gtag.async = true
    gtag.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
    document.head.appendChild(gtag)
    const w = window as unknown as Record<string, unknown>
    w.dataLayer = (w.dataLayer as unknown[]) || []
    const gtagFn = function (...args: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(w.dataLayer as any[]).push(args)
    }
    w.gtag = gtagFn as unknown
    gtagFn('js', new Date())
    gtagFn('config', GA_ID)
  } catch { /* 不阻断页面功能 */ }
}
