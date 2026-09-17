<script setup lang="ts">
/**
 * 重模型加载提示（审计 P1-4）：
 * 大 LLM demo（推理/多模态/代码生成/WebLLM）在无 WebGPU 的教室电脑上加载+推理较慢，
 * 提前告知学生/老师"会等多久"，避免课堂干等。
 */
import { hasWebGPU } from '~/utils/transformers'

defineProps<{
  /** 模型体积（GB，用于提示） */
  sizeGb?: number
}>()

const { t } = useI18n()

/**
 * 能力探测必须等客户端：SSR 阶段没有 navigator.gpu，若在 setup 里同步求值，
 * 服务端会渲染「无 WebGPU」而客户端渲染「有 WebGPU」，两边 HTML 对不上 →
 * Vue 报 hydration mismatch（E2E 的 routes.spec 正是在这 4 个 LLM 页抓到的）。
 * 先渲染成服务端的结果，挂载后再按真实能力更新，水合输出保持一致。
 */
const gpu = ref(false)
onMounted(() => {
  gpu.value = hasWebGPU()
})
</script>

<template>
  <UAlert
    color="info"
    variant="subtle"
    icon="i-lucide-cpu"
    :title="t('demo.heavyModelNotice')"
  >
    <template #description>
      <div class="space-y-1">
        <p v-if="sizeGb">
          {{ t('demo.heavyModelSize', { size: sizeGb }) }}
        </p>
        <p>{{ gpu ? t('demo.webgpuYes') : t('demo.webgpuNo') }}</p>
      </div>
    </template>
  </UAlert>
</template>
