/**
 * 默认语言策略：**英文优先，但记住手动切换**。
 *
 * 为什么需要这个中间件：nuxt.config 里 defaultLocale 是 'en'，但只要开着 detectBrowserLanguage，
 * 模块的检测顺序就是「cookie → Accept-Language → navigator.languages → fallbackLocale」
 * （见 @nuxtjs/i18n 的 createLocaleDetector），中文浏览器（zh-CN）会直接进中文 ——
 * defaultLocale 只是「检测不到时的兜底」，不是「进站一律英文」。
 *
 * 而检测那一步又不能整个关掉：写 i18n_locale cookie 也归它管，关掉后手动切语言刷新就丢。
 *
 * 折中：只在**没有 cookie**（访客还没自己选过）时把语言定成默认值并固化进 cookie；
 * 之后 cookie 优先级最高，浏览器语言不再参与，用户点「中文」也会被记住。
 */

/** 与 nuxt.config 的 i18n.detectBrowserLanguage.cookieKey 必须一致 */
const LOCALE_COOKIE = 'i18n_locale'

export default defineNuxtRouteMiddleware(async () => {
  // 有 cookie = 访客自己选过（或本策略已固化过），尊重它
  if (useCookie(LOCALE_COOKIE).value) return

  // 路由中间件里不能调 useI18n()（它要求 setup 上下文），用 Nuxt 注入的全局实例
  const i18n = useNuxtApp().$i18n
  // 语言已经是默认值：只把这次选择固化进 cookie，避免以后再被浏览器语言改写
  if (i18n.locale.value === i18n.defaultLocale) {
    i18n.setLocaleCookie(i18n.defaultLocale)
    return
  }
  await i18n.setLocale(i18n.defaultLocale)
})
