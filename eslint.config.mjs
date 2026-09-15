// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  // 第三方打包产物（Kokoro.js bundle 等）不参与 lint（与 check-i18n 的 SKIP_DIRS 一致）
  {
    ignores: ['app/vendor/**']
  }
  // Your custom configs here
)
