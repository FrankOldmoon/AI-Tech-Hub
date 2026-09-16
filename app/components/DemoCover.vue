<script setup lang="ts">
import type { LocalizedDemo } from '~/utils/demos'
import { accentForCategory } from '~/utils/demos'
import { demoCoverArt } from '~/utils/demo-cover'

/**
 * demo 卡片的封面位（16:9）：这个页面干什么，就画什么。
 *
 * 两种来源，优先级从高到低：
 * 1. `demo.cover` 指向的图片（站内路径如 `/covers/vision-face.webp`，或外链）；
 * 2. 没有图片时用 demoCoverArt() 生成的功能效果图（手掌 + 关键点、文档 + 文本框、
 *    机械臂连杆…，见 app/utils/demo-cover-scenes.ts）。
 *
 * 生成的图是纯函数产物：零网络请求、零素材维护，也不含任何文字（纯几何图形，
 * 中英文通用）。真图到位后直接填 `cover` 即可，两者占同一个 16:9 格子，
 * 替换不会引起布局跳动。
 */
const props = defineProps<{ demo: LocalizedDemo }>()

const accent = computed(() => accentForCategory(props.demo.category))
const art = computed(() => demoCoverArt(props.demo.slug, props.demo.category))

/**
 * 多边形的点串（`x,y x,y …`）。
 * 与 art.shapes 同序，模板里按同一个下标取用 —— 这样图元的绘制顺序（谁能压住谁）
 * 完全由场景决定，不会因为按类型分组渲染而被重排。
 */
const pointStrings = computed(() => art.value.shapes.map(shape =>
  shape.kind === 'poly' ? shape.points.map(([x, y]) => `${x},${y}`).join(' ') : ''
))

/** 图片加载失败时回退到生成的 SVG，避免出现裂图 */
const imageFailed = ref(false)
const imgEl = ref<HTMLImageElement>()
const cover = computed(() => (imageFailed.value ? '' : props.demo.cover ?? ''))

/**
 * SSR 时 <img> 已经写进了 HTML，浏览器可能在水合挂上 @error 之前就把请求跑失败了，
 * 那次 error 事件谁也收不到。所以挂载后再补判一次「已结束但天然尺寸为 0」= 失败态。
 */
onMounted(() => {
  const el = imgEl.value
  if (el && el.complete && el.naturalWidth === 0) imageFailed.value = true
})
</script>

<template>
  <div
    data-slot="cover"
    class="relative aspect-video w-full overflow-hidden bg-gradient-to-br"
    :class="accent"
  >
    <img
      v-if="cover"
      ref="imgEl"
      :src="cover"
      :alt="demo.title"
      class="size-full object-cover"
      loading="lazy"
      decoding="async"
      @error="imageFailed = true"
    >

    <template v-else>
      <!-- 柔光：SVG 里做柔和光斑需要每实例唯一的 gradient id，这里直接用 HTML 径向渐变 -->
      <div class="absolute inset-0 bg-[radial-gradient(120%_90%_at_18%_0%,rgba(255,255,255,0.26),transparent_62%)]" />

      <svg
        class="absolute inset-0 size-full text-white"
        :viewBox="`0 0 ${art.width} ${art.height}`"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <template
          v-for="(shape, i) in art.shapes"
          :key="i"
        >
          <rect
            v-if="shape.kind === 'rect'"
            :x="shape.x"
            :y="shape.y"
            :width="shape.w"
            :height="shape.h"
            :rx="shape.rx"
            fill="currentColor"
            :opacity="shape.opacity"
          />

          <circle
            v-else-if="shape.kind === 'circle'"
            :cx="shape.cx"
            :cy="shape.cy"
            :r="shape.r"
            fill="currentColor"
            :opacity="shape.opacity"
          />

          <!-- 闭合多边形：既能填充（实心图形）也能只描边（轮廓） -->
          <polygon
            v-else-if="shape.close"
            :points="pointStrings[i]"
            :fill="shape.mode === 'fill' ? 'currentColor' : 'none'"
            :stroke="shape.mode === 'stroke' ? 'currentColor' : undefined"
            :stroke-width="shape.width || undefined"
            :stroke-dasharray="shape.dash || undefined"
            stroke-linecap="round"
            stroke-linejoin="round"
            :opacity="shape.opacity"
          />

          <!-- 开放折线：曲线、轨迹、括号、骨架连杆 -->
          <polyline
            v-else
            :points="pointStrings[i]"
            fill="none"
            stroke="currentColor"
            :stroke-width="shape.width"
            :stroke-dasharray="shape.dash || undefined"
            stroke-linecap="round"
            stroke-linejoin="round"
            :opacity="shape.opacity"
          />
        </template>
      </svg>
    </template>
  </div>
</template>
