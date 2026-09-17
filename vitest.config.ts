import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 单测配置：只为补上 Nuxt 的路径别名，其余保持 vitest 默认（environment: node）。
 *
 * 为什么需要：app/utils 下的业务模块之间用 `~/utils/...` 互相引用，没有别名
 * Vite 解析不了。此前 tests/ 里只测过不依赖别名的模块（相对路径引入），所以能不带
 * 配置跑；现在要直接测 app/utils/image-pipeline.ts（它 import 了 image-tools），
 * 就必须把别名补上，否则会在 `import '~/utils/...'` 处报 Cannot find module。
 *
 * 别名与 .nuxt/tsconfig.json 保持一致：~ / @ → app，~~ → 仓库根。
 */
const appDir = fileURLToPath(new URL('./app', import.meta.url))
const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^~~\//, replacement: `${rootDir}/` },
      { find: /^~\//, replacement: `${appDir}/` },
      { find: /^@\//, replacement: `${appDir}/` }
    ]
  }
})
