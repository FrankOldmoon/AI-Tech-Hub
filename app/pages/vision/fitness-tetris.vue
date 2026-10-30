<script setup lang="ts">
/**
 * 体感俄罗斯方块（Fitness Tetris）—— 独立应用集成（iframe 壳，见 docs/APP-INTEGRATION-GUIDE.md §5）
 *
 * - 前端：public/apps/fitness-tetris/（同源 iframe 嵌入，纯静态无后端）
 * - 上游：github.com/ikeee/ai-fitness-tetris（课堂 demo v0.02；MediaPipe WASM 与字体全部本地化）
 * - 模型：**不随子应用分发**。MediaPipe 的 wasm 文件集与姿态模型由站点统一放在 `.models/`
 *   （自托管）或 CDN（远程部署），这里把当前生效的两个地址用 `?wasm=&model=` 传进 iframe ——
 *   子应用自己不知道部署形态，也不需要知道。
 * - 布局：这页是「控制台级」全屏应用（摄像头铺满 + HUD 浮层，≥1180px 才成立），所以走
 *   bare + fullscreen（app.vue 据此隐藏 AppHeader/Footer/CookieConsent 并收起 UMain 的最小高度），
 *   让 iframe 拿到整屏空间，而不是塞进带侧栏的内容区里被压成手机单列。
 * - 进度上报：子应用被 iframe 嵌时 postMessage `type:'correct_rate'`（契约同
 *   app/utils/embed-report.ts），父页面无需处理即可被外层监听。
 */
import { mediapipeModels, mediapipeWasm } from '~/utils/mediapipe'
import { pickText, type LocalizedText } from '~/utils/localized'

definePageMeta({ layout: 'bare', fullscreen: true })

const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'fitness-tetris')!)
const { locale, withLocale } = useIframeLocale()
const lang = computed<'zh' | 'en'>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: LocalizedText) => pickText(o, lang.value)

const wrapEl = ref<HTMLElement | null>(null)
const iframeSrc = ref('')

useSeoMeta({
  title: () => demo.value.title,
  description: () => demo.value.description
})

// mediapipeWasm / mediapipeModels 依赖 isRemoteDeploy()（SSR 期恒为 false），
// 在 computed 里直接算会造成 hydration 后 src 不一致，所以只在客户端算。
function buildSrc() {
  const base = withLocale('/apps/fitness-tetris/index.html')
  const sep = base.includes('?') ? '&' : '?'
  const wasm = encodeURIComponent(mediapipeWasm.vision)
  const model = encodeURIComponent(mediapipeModels.poseLandmarker)
  // embed=1：让子应用走「紧凑三栏」（≤1180px 不折叠成单列），见其 styles.css 末尾
  return `${base}${sep}embed=1&wasm=${wasm}&model=${model}`
}
onMounted(() => {
  iframeSrc.value = buildSrc()
})
watch(locale, () => {
  iframeSrc.value = buildSrc()
})

/** 整屏：把承载 iframe 的容器推进全屏，课堂投屏时 HUD 才有地方展开 */
function enterFullscreen() {
  wrapEl.value?.requestFullscreen?.().catch(() => {})
}

const tips = computed(() => ({
  stand: pick({
    zh: '站 1.5–3 米：头左右倾斜移块 · 单手向下翻转 · 双手向下瞬降',
    en: 'Stand 1.5–3 m away: tilt head to steer · one hand down to rotate · both down to hard-drop'
  }),
  keyboard: pick({
    zh: '先点画面取得键盘焦点：← → 移动 · Q/Z 左转 · E/X 右转 · 空格瞬降 · P 暂停 · M 静音',
    en: 'Click the stage for keyboard focus: ← → move · Q/Z rotate left · E/X rotate right · Space drop · P pause · M mute'
  })
}))
</script>

<template>
  <div class="h-[100dvh] flex flex-col overflow-hidden bg-default">
    <!-- 顶栏：标题 + 关键提示 + 全屏（子应用自己已有 HUD，这里只留最少一条） -->
    <header class="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-b border-default">
      <div class="flex items-center gap-2 min-w-0">
        <UIcon
          :name="demo.icon"
          class="size-5 shrink-0 text-primary"
        />
        <h1 class="font-semibold text-highlighted truncate">
          {{ demo.title }}
        </h1>
        <DemoStatusBadge :status="demo.status" />
      </div>
      <p class="text-xs text-muted hidden lg:block truncate">
        {{ tips.stand }}
      </p>
      <div class="ml-auto flex items-center gap-2">
        <UButton
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-lucide-maximize-2"
          @click="enterFullscreen"
        >
          {{ pick({ zh: '全屏演示', en: 'Fullscreen' }) }}
        </UButton>
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-arrow-left"
          to="/vision"
        >
          {{ pick({ zh: '视觉', en: 'Vision' }) }}
        </UButton>
      </div>
    </header>

    <p class="shrink-0 px-4 py-1.5 text-xs text-muted border-b border-default lg:hidden">
      {{ tips.stand }}
    </p>

    <div
      ref="wrapEl"
      class="flex-1 min-h-0 bg-black"
    >
      <iframe
        v-if="iframeSrc"
        :key="locale"
        :src="iframeSrc"
        :title="demo.title"
        class="w-full h-full border-0 block"
        allow="camera; microphone; fullscreen; autoplay"
        allowfullscreen
      />
    </div>

    <footer class="shrink-0 px-4 py-1 text-[11px] text-muted border-t border-default hidden sm:block">
      {{ tips.keyboard }}
    </footer>
  </div>
</template>
