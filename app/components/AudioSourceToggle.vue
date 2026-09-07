<script setup lang="ts">
/** 音频来源切换：麦克风实时 / 上传文件（语音分析页共用） */
const { t } = useI18n()

withDefaults(defineProps<{
  modelValue: 'mic' | 'file'
  disabled?: boolean
}>(), { disabled: false })

const emit = defineEmits<{
  'update:modelValue': [value: 'mic' | 'file']
}>()

const items = computed(() => [
  { key: 'mic' as const, label: t('speech.sourceMic'), icon: 'i-lucide-mic' },
  { key: 'file' as const, label: t('speech.sourceFile'), icon: 'i-lucide-file-audio' }
])
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      :class="modelValue === item.key
        ? 'bg-primary border-primary text-white'
        : 'bg-elevated/60 border-default text-muted hover:text-highlighted hover:border-primary'"
      :disabled="disabled"
      @click="emit('update:modelValue', item.key)"
    >
      <UIcon
        :name="item.icon"
        class="size-4"
      />
      {{ item.label }}
    </button>
  </div>
</template>
