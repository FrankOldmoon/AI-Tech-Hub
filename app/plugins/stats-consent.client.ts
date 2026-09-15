/**
 * 统计脚本条件注入（P2-3 合规）
 * 首屏加载时若用户已选择「同意」，注入百度统计 + GA4；
 * 未选择/拒绝则什么都不做（CookieConsent 横幅引导选择）。
 */
import { readStatsConsent, loadStatsScripts } from '~/utils/stats'

export default defineNuxtPlugin(() => {
  if (import.meta.client && readStatsConsent() === 'accepted') {
    loadStatsScripts()
  }
})
