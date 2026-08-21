<script setup lang="ts">
/**
 * 视觉 demo 示例图选择器：一行小按钮，点击 pick(url)。
 * 与文件上传按钮并排使用，老师可一键加载示例图。
 */
defineProps<{ samples: Array<{ label: string; url: string }> }>()
const emit = defineEmits(['pick'])
const { t } = useI18n()
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <span class="text-xs text-muted">{{ t('samples.trySample') }}</span>
    <UButton
      v-for="s in samples"
      :key="s.url"
      size="xs"
      variant="outline"
      :label="s.label"
      @click="emit('pick', s.url)"
    />
  </div>
</template>
