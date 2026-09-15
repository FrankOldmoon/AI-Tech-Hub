/**
 * iframe 子应用 locale 同步（P1-2）
 * - 站点切换语言时，子应用 UI 语言应跟随站点 locale，而非浏览器的 navigator.language。
 * - 通过 iframe src 追加 `?locale=zh|en` 实现：子应用 index.html 读取该参数决定界面语言，
 *   未传时回落 navigator.language（子应用原生行为），因此该方案向后兼容所有旧子应用。
 */
export function useIframeLocale() {
  const { locale } = useI18n()

  /**
   * 把静态子应用 URL 转成带 locale 参数的 src
   * 纯字符串拼接（不依赖 window），SSR/CSR 输出一致，无水合差异
   * @param baseSrc 静态路径，如 /apps/neural-sandbox/demos/boids/index.html
   */
  function withLocale(baseSrc: string): string {
    const sep = baseSrc.includes('?') ? '&' : '?'
    return `${baseSrc}${sep}locale=${encodeURIComponent(locale.value)}`
  }

  return { locale, withLocale }
}