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
const gpu = hasWebGPU()
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
