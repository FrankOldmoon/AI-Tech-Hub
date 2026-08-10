// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxtjs/i18n'],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  ui: {
    fonts: false
  },

  i18n: {
    defaultLocale: 'en',
    locales: [
      { code: 'zh', name: '中文', file: 'zh.json' },
      { code: 'en', name: 'English', file: 'en.json' }
    ]
  },

  // 首页与分类页可预渲染，单个 demo 页保持动态以支持 Python 后端调用
  routeRules: {
    '/': { prerender: true },
    '/speech': { prerender: true },
    '/vision': { prerender: true },
    '/nlp': { prerender: true },
    '/aigc': { prerender: true },
    '/ml': { prerender: true }
  },

  compatibilityDate: '2026-06-30',

  // transformers.js 仅在客户端动态 import；排除出 optimizeDeps 避免 esbuild 预打包
  // 触发 onnxruntime-node / sharp 等 Node 专属依赖解析失败
  // TensorFlow.js 需保留在预打包中以将 CJS require() 转为 ESM
  vite: {
    optimizeDeps: {
      exclude: ['@huggingface/transformers', 'onnxruntime-node', 'sharp'],
      include: ['onnxruntime-web']
    },
    resolve: {
      dedupe: ['long']
    },
    define: {
      'process.env.WITH_NATIVE_ENGINE': JSON.stringify('0'),
      'process.env.ONNXRUNTIME_NODE': JSON.stringify('0')
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
