// https://nuxt.com/docs/api/configuration/nuxt-config
import { isWebllmIndexJs, neutralizeImportMetaUrl } from './build/webllm-neutralize'

export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxtjs/i18n'],

  // 自托管部署配置：NUXT_PUBLIC_SELF_HOSTED
  // 在构建/运行环境设 true 时烘焙进 runtimeConfig.public（Nuxt 自动做布尔转换）
  devtools: {
    enabled: true
  },

  // 网站统计：百度统计 + Google Analytics (GA4)
  // 合规条件化：不再在 <head> 无条件注入；用户「同意」后由
  // app/utils/stats.ts + plugins/stats-consent.client.ts 注入（见 CookieConsent.vue）
  app: {
    head: {
      // 统计脚本已移至 stats-consent 流程（P2-3），勿在此加回
    }
  },

  css: ['~/assets/css/main.css'],

  ui: {
    fonts: false
  },
  runtimeConfig: {
    public: {
      selfHosted: false
    }
  },

  // 首页与分类页生产构建时预渲染；dev 中禁用。
  // 注：Nitro 2.13.4 的 prerender 在生产构建报错（本地 createRequire('file:///_entry.js')、
  // Vercel Maximum call stack size exceeded），且这些页面均为 ClientOnly/SPA 组件，
  // prerender 非必需——改为运行时渲染（SSR on-demand / SPA fallback）。
  //
  // 视觉信息架构重构（能力 × 引擎双轴）：旧入口 301 到新能力页/引擎页，避免外链与收藏 404。
  // 必须与删除旧 slug 的改动同时上线，否则中间态 404。
  routeRules: {
    // 跨域隔离（默认关闭，构建时开关 NUXT_ENABLE_CROSS_ORIGIN_ISOLATION=true）：
    // 打开后才有 SharedArrayBuffer → onnxruntime-web / MediaPipe / Tesseract / Pyodide
    // 可启用多线程 WASM（WASM SIMD+MT 相对单线程有数倍差距）。
    // 注：/ide 的 Python input() 不依赖它 —— 输入框里的行是整段喂进解释器的，
    // 不存在跨线程的同步等待。
    // ⚠️ 打开前必须：① 真机验证「模型缺失 → 302 回退 CDN」「站内 iframe 子应用」
    //    「统计脚本」三条链路仍可加载；② 在生产 nginx 同步同名响应头。
    // 用 credentialless 而非 require-corp：对无凭据的跨域子资源更宽容，且不支持的
    // 浏览器会忽略该值（退化为非隔离），不会硬失败。
    // CORP 必须一起给：COEP 下**同源**的 worker 脚本 / WASM 也算「嵌入资源」，
    // 缺 CORP 时 Chrome 直接 ERR_BLOCKED_BY_RESPONSE —— 那样隔离一开，Pyodide
    // 的 worker 根本起不来（比不开还糟）。
    // ⚠️ 生产（10.28.1.152）目前是**由 nginx 统一下发**这三个头的（见
    //    /etc/nginx/sites-available/aihub 的 server 级 add_header），所以部署时
    //    **不要**再设 NUXT_ENABLE_CROSS_ORIGIN_ISOLATION=true：nginx 的 add_header
    //    不会去重，会和这里叠成两个 COEP，按规范「多个 token 等价于 unsafe-none」，
    //    隔离反而失效（input() 会静默退回「不可用」提示，不报错，很难查）。
    //    二者只能选其一：要么这里开（头随应用走，需确认 routeRules 覆盖 /_nuxt/**
    //    与 /apps/** 这类静态/子文档），要么 nginx 开（已实测可用）。
    ...(process.env.NUXT_ENABLE_CROSS_ORIGIN_ISOLATION === 'true'
      ? {
          '/**': {
            headers: {
              'Cross-Origin-Opener-Policy': 'same-origin',
              'Cross-Origin-Embedder-Policy': 'credentialless',
              'Cross-Origin-Resource-Policy': 'same-origin'
            }
          }
        }
      : {}),
    // 语音侧信息架构重构（能力 × 引擎双轴）：被吸收进能力页/引擎页的旧 slug 301 迁移。
    // audio-classifier 顺带修掉 "-er" 的别扭命名；emotion 并入 audio-classification 能力页
    // （情绪识别是「音频分类」任务的一种标签空间，不再单独成页）。
    '/speech/audio-classifier': { redirect: { to: '/speech/audio-classification', statusCode: 301 } },
    '/speech/emotion': { redirect: { to: '/speech/audio-classification', statusCode: 301 } },
    '/vision/face-detection': { redirect: { to: '/vision/face', statusCode: 301 } },
    '/vision/face-landmarker': { redirect: { to: '/vision/face', statusCode: 301 } },
    '/vision/object-detector': { redirect: { to: '/vision/detection', statusCode: 301 } },
    '/vision/image-classifier': { redirect: { to: '/vision/classification', statusCode: 301 } },
    '/vision/image-segmenter': { redirect: { to: '/vision/segmentation', statusCode: 301 } },
    '/vision/interactive-segmenter': { redirect: { to: '/vision/segmentation', statusCode: 301 } },
    '/vision/bg-removal': { redirect: { to: '/vision/matting', statusCode: 301 } },
    '/vision/depth-estimation': { redirect: { to: '/vision/depth', statusCode: 301 } },
    '/vision/image-captioning': { redirect: { to: '/vision/transformers', statusCode: 301 } },
    '/vision/image-embedder': { redirect: { to: '/vision/mediapipe', statusCode: 301 } },
    '/vision/multimodal': { redirect: { to: '/vision/transformers', statusCode: 301 } },
    '/vision/ai-vision': { redirect: { to: '/vision/detection', statusCode: 301 } },
    '/vision/yolo-detection': { redirect: { to: '/vision/yolo', statusCode: 301 } },
    // 手部两个任务已从 mediapipe 引擎页抽出为 /vision/gesture 专页，但当初这批 301 漏了
    // 这四条，旧深链（含书签、课件里的链接）会直接 404，这里补齐。
    // pose 已有能力页（MediaPipe 33 点 × YOLO 17 点对比），单独指过去比丢回引擎页更有用；
    // holistic 没有独立页，仍留在引擎页内。
    '/vision/hand-landmarker': { redirect: { to: '/vision/gesture?tool=hand-landmarker', statusCode: 301 } },
    '/vision/gesture-recognizer': { redirect: { to: '/vision/gesture?tool=gesture-recognizer', statusCode: 301 } },
    '/vision/pose-landmarker': { redirect: { to: '/vision/pose?tool=pose-landmarker', statusCode: 301 } },
    '/vision/holistic-landmarker': { redirect: { to: '/vision/mediapipe?tool=holistic-landmarker', statusCode: 301 } }
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    compressPublicAssets: true
  },

  // transformers.js 仅在客户端动态 import；排除出 optimizeDeps 避免 esbuild 预打包
  // 触发 onnxruntime-node / sharp 等 Node 专属依赖解析失败
  // TensorFlow.js 需保留在预打包中以将 CJS require() 转为 ESM
  vite: {
    // dev 下 `/_nuxt/**`（含 pyworker.js 这些模块）由 Vite 中间件直出，
    // 不经过上面 routeRules 的 `/**`，所以隔离头得在这里补一份。
    // 三件套缺一不可：COEP 下 worker 脚本的**响应本身**也要带 COEP，否则 Chrome
    // 以 coep-frame-resource-needs-coep-header 直接 ERR_BLOCKED_BY_RESPONSE
    // （隔离一开，Pyodide 的 worker 就起不来，比不开还糟）；CORP 则供 worker 内部
    // 去取 pyodide wasm/wheel 时通过 COEP 的资源检查。
    // 生产由 nginx 静态托管 `/_nuxt/**`，同样要同步这三个头。
    ...(process.env.NUXT_ENABLE_CROSS_ORIGIN_ISOLATION === 'true'
      ? {
          server: {
            headers: {
              'Cross-Origin-Embedder-Policy': 'credentialless',
              'Cross-Origin-Resource-Policy': 'same-origin'
            }
          }
        }
      : {}),
    plugins: [
      {
        // 修复 Vercel 生产构建崩溃，详见 build/webllm-neutralize.ts
        name: 'web-llm-neutralize-import-meta-url',
        enforce: 'pre',
        transform(code, id) {
          if (!isWebllmIndexJs(id)) return
          const next = neutralizeImportMetaUrl(code)
          return next === code ? undefined : next
        }
      }
    ],
    optimizeDeps: {
      exclude: ['@huggingface/transformers', 'onnxruntime-node', 'sharp'],
      // 显式预构建常见运行时依赖，避免 Vite 在 dev 中"发现新依赖→优化→页面 full-reload"
      // （Nuxt/Vite 已知问题：多页面应用触发 endless reload，见 nuxt/cli#1141、nuxt/nuxt#33746）
      include: [
        'onnxruntime-web',
        '@mediapipe/tasks-vision',
        'tesseract.js',
        'webllm',
        'pyodide'
      ]
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
  },

  i18n: {
    // 进站语言策略见 app/middleware/locale-default.global.ts：
    // defaultLocale 只是「检测不到时的兜底」，开着 detectBrowserLanguage 时中文浏览器会直接进中文。
    // 那个中间件把它改成「英文优先 + 记住手动切换」，所以这里的检测配置要留着（cookie 读写归它管）。
    defaultLocale: 'en',
    strategy: 'no_prefix',
    locales: [
      { code: 'zh', name: '中文', file: 'zh.json' },
      { code: 'en', name: 'English', file: 'en.json' }
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_locale',
      redirectOn: 'root'
    }
  }
})
