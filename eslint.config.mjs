// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  // 第三方打包产物（Kokoro.js bundle 等）不参与 lint（与 check-i18n 的 SKIP_DIRS 一致）
  {
    ignores: ['app/vendor/**']
  },
  // Program World 是从一个独立应用 1:1 移植过来的：模块逐字搬运，行为由
  // `pnpm test:program-world` 的 348 条真实浏览器断言锁定。这里只关掉纯格式类规则
  // —— 把「无分号」风格机械地套到这些文件上，恰恰是引入 ASI 陷阱的典型方式，
  // 而收益为零。真正的正确性规则（no-undef / no-unused-vars 等）仍然生效。
  {
    files: ['app/program-world/**/*.js', 'tests/program-world/**/*.js'],
    rules: {
      '@stylistic/semi': 'off',
      '@stylistic/quotes': 'off',
      '@stylistic/indent': 'off',
      '@stylistic/indent-binary-ops': 'off',
      '@stylistic/max-statements-per-line': 'off',
      '@stylistic/no-multi-spaces': 'off',
      '@stylistic/no-multiple-empty-lines': 'off',
      '@stylistic/operator-linebreak': 'off',
      '@stylistic/arrow-parens': 'off',
      '@stylistic/comma-spacing': 'off',
      '@stylistic/multiline-ternary': 'off',
      '@stylistic/brace-style': 'off',
      '@stylistic/padded-blocks': 'off',
      // dom.js 有意导出 let 绑定：ES module 的 live binding 保证每个模块读到的永远
      // 是最近一次 bindDom 装上的元素（页面可以离开再回来）
      'import/no-mutable-exports': 'off',
      // 原应用的 `let x = null; ... x = ...` 防御式写法，赋值不是笔误
      'no-useless-assignment': 'off',
      // 原应用通篇用 `catch (e) {}` 表达「尽力而为」，被忽略的永远是异常对象
      'no-unused-vars': ['error', { caughtErrors: 'none', argsIgnorePattern: '^_' }],
      // 同上：空的 catch 块是这里的正常写法，不是漏写
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  // Monaco 的 AMD 加载器与 WebAudio 是运行期全局，原应用由浏览器提供
  {
    files: ['app/program-world/**/*.js'],
    languageOptions: {
      globals: { monaco: 'readonly', require: 'readonly', webkitAudioContext: 'readonly' }
    }
  },
  // 测试台的适配器把模块导出与辅助函数挂到 globalThis，断言文件按原样使用裸标识符
  {
    files: ['tests/program-world/**/*.js'],
    rules: { 'no-undef': 'off' }
  }
)
