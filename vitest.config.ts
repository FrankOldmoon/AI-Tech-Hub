import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { configDefaults, defineConfig } from 'vitest/config'

/**
 * 单测配置：补上 Nuxt 的路径别名 + 让 vitest 能编译 .vue（组件测试）。
 *
 * 别名：app/utils 下的业务模块之间用 `~/utils/...` 互相引用，没有别名 Vite 解析不了。
 * 别名与 .nuxt/tsconfig.json 保持一致：~ / @ → app，~~ → 仓库根。
 *
 * vue 插件：tests/components 下的用例直接挂载 app/components 里的 SFC，需要它把
 * 单文件组件编译成渲染函数。默认环境仍是 node（纯逻辑用例不变），组件用例在自己
 * 文件顶部用 `@vitest-environment happy-dom` 单独切换。
 */
const appDir = fileURLToPath(new URL('./app', import.meta.url))
const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: /^~~\//, replacement: `${rootDir}/` },
      { find: /^~\//, replacement: `${appDir}/` },
      { find: /^@\//, replacement: `${appDir}/` }
    ]
  },
  test: {
    // tests/e2e 下的用例由 Playwright 跑（playwright.config.ts），
    // 它们的文件名也匹配 vitest 默认的 *.spec.ts，必须显式排除
    exclude: [...configDefaults.exclude, 'tests/e2e/**']
  }
})
