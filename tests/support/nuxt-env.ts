/**
 * 测试环境的运行时补丁（副作用模块，import 即生效）。
 *
 * 被测代码本来是给 Nuxt 跑的：`ref` / `computed` / `useI18n` 这些都由 Nuxt 自动导入，
 * 编译产物里是「自由变量」，在纯 vitest 下会 ReferenceError。补到 globalThis 上即可
 * （运行时找不到模块级绑定时会落到 globalThis）。
 *
 * 组件测试（tests/components）与纯逻辑测试（tests/*.test.ts）都 import 本模块。
 *
 * i18n 刻意用 key 当文案：断言比对 key 比比对中文稳定，改文案也不会让用例挂。
 */
import * as v from 'vue'
import { ref } from 'vue'

const g = globalThis as unknown as Record<string, unknown>

/** Nuxt 自动导入的运行时 API（被测代码用到的那些） */
const AUTO_IMPORTS = [
  'ref',
  'shallowRef',
  'reactive',
  'computed',
  'watch',
  'watchEffect',
  'nextTick',
  'onMounted',
  'onBeforeUnmount',
  'onUnmounted',
  'toRefs',
  'defineComponent',
  'h',
  'markRaw',
  'readonly',
  'toRaw'
] as const

for (const name of AUTO_IMPORTS) {
  g[name] = (v as unknown as Record<string, unknown>)[name]
}

/** useI18n：返回 key 本身；带插值时把参数附在后面，便于断言 */
g.useI18n = () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}(${JSON.stringify(params)})` : key,
  locale: ref('zh')
})

/** useState：Nuxt 的跨组件状态（useDemos 之类可能用到），测试里退化成普通 ref */
g.useState = <T>(key: string, init: () => T) => {
  const store = g.__nuxtState__ as Map<string, unknown> | undefined
  const map = store ?? new Map<string, unknown>()
  g.__nuxtState__ = map
  if (!map.has(key)) map.set(key, ref(init()))
  return map.get(key)
}
