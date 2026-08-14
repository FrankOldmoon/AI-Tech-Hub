<script setup lang="ts">
/**
 * 视觉分类通用页面（统一分发）：
 * 1. slug 命中图像工坊注册表（imageToolsByPage）-> ImagePlayground（15 个图像工坊页）
 * 2. 否则命中 MediaPipe visionTasks -> MediaVisionRunner（人脸/手/姿态/检测等旧视觉 demo）
 * 3. 都没有 -> 404
 */
import type { VisionTaskConfig } from '~/utils/mediapipe-vision'
import { imageToolsByPage } from '~/utils/image-tools'

const route = useRoute()
const { getDemo } = useDemos()
const { t } = useI18n()

const slug = computed(() => route.params.slug as string)
const demo = computed(() => getDemo('vision', slug.value))
const tools = computed(() => imageToolsByPage(slug.value))

const cfg = ref<VisionTaskConfig | null>(null)

onMounted(async () => {
  if (tools.value.length) return
  const mod = await import('~/utils/mediapipe-vision')
  const c = mod.visionTasks[slug.value]
  if (c) cfg.value = c
})

const createDetector = computed(() => cfg.value?.create ?? null)
const draw = computed(() => cfg.value?.draw)
// 可调参数 specs（label 随 locale 变化自动重算）
const paramSpecs = computed(() => cfg.value?.params ? cfg.value.params(t) : [])
const detectVideo = (det: any, video: HTMLVideoElement, ts: number) => det[cfg.value!.method](video, ts)
const detectImage = (det: any, bitmap: ImageBitmap) => det[cfg.value!.method](bitmap, performance.now())
</script>

<template>
  <div v-if="demo">
    <ClientOnly>
      <!-- 图像工坊模式 -->
      <ImagePlayground v-if="tools.length" :demo="demo" :tools="tools" />

      <!-- 传统 MediaPipe 模式 -->
      <MediaVisionRunner
        v-else-if="cfg && createDetector"
        :demo="demo"
        :create-detector="createDetector!"
        :detect-video="detectVideo"
        :detect-image="detectImage"
        :draw="draw"
        :param-specs="paramSpecs"
      >
        <template #result="{ result }">
          <div v-if="result?.detections?.length" class="space-y-1">
            <div
              v-for="(d, i) in result.detections"
              :key="i"
              class="flex justify-between text-sm"
            >
              <span>{{ d.categories?.[0]?.categoryName || 'object' }}</span>
              <span class="text-muted">{{ Math.round((d.categories?.[0]?.score || 0) * 100) }}%</span>
            </div>
          </div>
          <div v-else-if="result?.classifications?.[0]?.categories?.length" class="space-y-1">
            <div
              v-for="(c, i) in result.classifications[0].categories"
              :key="i"
              class="flex justify-between text-sm"
            >
              <span>{{ c.categoryName }}</span>
              <span class="text-muted">{{ Math.round(c.score * 100) }}%</span>
            </div>
          </div>
          <div v-else-if="result?.gestures?.length" class="space-y-1">
            <div
              v-for="(g, i) in result.gestures"
              :key="i"
              class="flex justify-between text-sm"
            >
              <span>{{ g[0]?.categoryName }}</span>
              <span class="text-muted">{{ Math.round((g[0]?.score || 0) * 100) }}%</span>
            </div>
          </div>
          <div v-else-if="result?.landmarks?.length" class="text-sm text-muted">
            {{ result.landmarks.length }} hand(s) · {{ result.landmarks[0].length }} pts
          </div>
          <div v-else-if="result?.faceLandmarks?.length" class="space-y-1 text-sm">
            <div class="text-muted">
              {{ result.faceLandmarks.length }} face(s) · {{ result.faceLandmarks[0].length }} pts
            </div>
            <!-- face-landmarker 的表情混合值（前 8 个） -->
            <div v-if="result.faceBlendshapes?.[0]?.categories?.length" class="space-y-1">
              <div
                v-for="(b, bi) in result.faceBlendshapes[0].categories.slice(0, 8)"
                :key="bi"
                class="flex justify-between"
              >
                <span>{{ b.categoryName }}</span>
                <span class="text-muted">{{ Math.round((b.score || 0) * 100) }}%</span>
              </div>
            </div>
          </div>
          <div v-else-if="result?.poseLandmarks?.length" class="text-sm text-muted">
            {{ result.poseLandmarks.length }} pose(s) · {{ result.poseLandmarks[0].length }} pts
          </div>
          <div v-else class="text-sm text-muted">
            —
          </div>
        </template>
      </MediaVisionRunner>

      <UContainer v-else class="py-16">
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-hourglass"
          :title="t('image.comingSoon')"
        />
      </UContainer>
      <template #fallback>
        <div class="py-20 flex items-center justify-center">
          <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-muted" />
        </div>
      </template>
    </ClientOnly>
  </div>
  <UContainer v-else class="py-16">
    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-file-question"
      :title="t('demo.notFound')"
    />
  </UContainer>
</template>
