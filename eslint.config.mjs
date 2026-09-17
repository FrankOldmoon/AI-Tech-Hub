// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  // 第三方打包产物（Kokoro.js bundle 等）不参与 lint（与 check-i18n 的 SKIP_DIRS 一致）
  {
    ignores: ['app/vendor/**']
  },
  // Program World 是整体移植进来的，排版已按仓库风格统一；这里只剩两处结构性例外。
  {
    files: ['app/program-world/**/*.js'],
    languageOptions: {
      // Monaco 的 AMD 加载器与 WebAudio 是运行期全局，原应用由浏览器提供
      globals: { monaco: 'readonly', require: 'readonly', webkitAudioContext: 'readonly' }
    },
    rules: {
      // dom.js 依靠 ES module 的 live binding 导出 let 绑定：每个模块读到的永远是
      // 最近一次 bindDom 装上的元素（页面可以离开再回来），这条规则本身就是禁止
      // 这种写法，无法在不牺牲该行为的前提下满足。
      'import/no-mutable-exports': 'off'
    }
  },
  // 测试台的适配器把模块导出与辅助函数挂到 globalThis，断言文件按原样使用裸标识符
  {
    files: ['tests/program-world/**/*.js'],
    rules: { 'no-undef': 'off' }
  }
)
