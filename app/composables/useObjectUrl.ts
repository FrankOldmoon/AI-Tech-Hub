/**
 * 单个 object URL 的生命周期：换新 blob 时自动回收旧的，组件卸载时再兜一次。
 *
 * 抽它的原因：useAudioSource（音频输入源）与 useMediaConvert（媒体转换状态机）各自写过一遍
 * 「revoke 旧的 → create 新的」，而 visualizer 里的注释早就记过这类疏漏的代价 ——
 * 「此前选文件 / 加载示例 / 切模式 / 卸载四处各写一遍 revoke，漏一处就泄漏一个 blob」。
 * 现在两边都只调 set / clear，回收点收敛到一处。
 */
export function useObjectUrl() {
  const url = ref('')

  /** 换成新 blob 的 URL（传 null 等价于 clear）；返回新的 URL，方便链式使用 */
  function set(blob: Blob | null) {
    clear()
    if (blob) url.value = URL.createObjectURL(blob)
    return url.value
  }

  function clear() {
    if (url.value) {
      URL.revokeObjectURL(url.value)
      url.value = ''
    }
  }

  onBeforeUnmount(clear)

  return { url, set, clear }
}
