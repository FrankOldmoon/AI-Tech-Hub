// https://nuxt.com/docs/api/configuration/nuxt-config
import { isWebllmIndexJs, neutralizeImportMetaUrl } from './build/webllm-neutralize'

export default defineNuxtConfig({
  modules: ["@nuxt/eslint", "@nuxt/ui", "@nuxtjs/i18n"],

  // 自托管部署配置：NUXT_PUBLIC_SELF_HOSTED
  // 在构建/运行环境设 true 时烘焙进 runtimeConfig.public（Nuxt 自动做布尔转换）
  devtools: {
    enabled: true,
  },

  css: ["~/assets/css/main.css"],

  nitro: {
    compressPublicAssets: true,
  },

  ui: {
    fonts: false,
  },
  runtimeConfig: {
    public: {
      selfHosted: false,
    },
  },

  // 首页与分类页生产构建时预渲染；dev 中禁用。
  // 注：Nitro 2.13.4 的 prerender 在生产构建报错（本地 createRequire('file:///_entry.js')、
  // Vercel Maximum call stack size exceeded），且这些页面均为 ClientOnly/SPA 组件，
  // prerender 非必需——改为运行时渲染（SSR on-demand / SPA fallback）。
  routeRules: {},

  compatibilityDate: "2026-06-30",

  // transformers.js 仅在客户端动态 import；排除出 optimizeDeps 避免 esbuild 预打包
  // 触发 onnxruntime-node / sharp 等 Node 专属依赖解析失败
  // TensorFlow.js 需保留在预打包中以将 CJS require() 转为 ESM
  vite: {
    plugins: [
      {
        // 修复 Vercel 生产构建崩溃，详见 build/webllm-neutralize.ts
        name: "web-llm-neutralize-import-meta-url",
        enforce: "pre",
        transform(code, id) {
          if (!isWebllmIndexJs(id)) return;
          const next = neutralizeImportMetaUrl(code);
          return next === code ? undefined : next;
        },
      },
    ],
    optimizeDeps: {
      exclude: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
      // 显式预构建常见运行时依赖，避免 Vite 在 dev 中"发现新依赖→优化→页面 full-reload"
      // （Nuxt/Vite 已知问题：多页面应用触发 endless reload，见 nuxt/cli#1141、nuxt/nuxt#33746）
      include: [
        "onnxruntime-web",
        "@mediapipe/tasks-vision",
        "tesseract.js",
        "webllm",
        "pyodide",
      ],
    },
    resolve: {
      dedupe: ["long"],
    },
    define: {
      "process.env.WITH_NATIVE_ENGINE": JSON.stringify("0"),
      "process.env.ONNXRUNTIME_NODE": JSON.stringify("0"),
    },
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: "never",
        braceStyle: "1tbs",
      },
    },
  },

  i18n: {
    defaultLocale: "zh",
    strategy: "no_prefix",
    locales: [
      { code: "zh", name: "中文", file: "zh.json" },
      { code: "en", name: "English", file: "en.json" },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: "i18n_locale",
      redirectOn: "root",
    },
  },
});
