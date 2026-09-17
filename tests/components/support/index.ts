/**
 * 组件测试的公共入口：`import { ... } from './support'` 即可。
 *
 * env 是副作用模块（把 Nuxt 自动导入的 ref / computed / useI18n 之类补到 globalThis），
 * 必须在这里先加载。
 */
import '../../support/nuxt-env'

export * from './stubs'
export * from './media'
