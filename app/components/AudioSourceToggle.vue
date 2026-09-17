<script setup lang="ts" generic="T extends string">
/**
 * 音频来源切换（麦克风 / 上传文件 / 录音…）。
 *
 * 默认两项：麦克风 + 上传文件 —— 覆盖绝大多数语音页；需要第三种来源（如「录音」）时
 * 由调用方用 items 自定义。选项 key 走泛型，调用方的 v-model 仍是原来的窄联合类型。
 */
const { t } = useI18n()

const props = defineProps<{
  modelValue: T
  /** 自定义选项；不传则用默认的 麦克风 / 上传文件 */
  items?: Array<{ key: T, label: string, icon?: string }>
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

const options = computed<Array<{ key: T, label: string, icon: string }>>(() => props.items
  ? props.items.map(item => ({ key: item.key, label: item.label, icon: item.icon ?? 'i-lucide-circle' }))
  : [
      { key: 'mic' as T, label: t('speech.sourceMic'), icon: 'i-lucide-mic' },
      { key: 'file' as T, label: t('speech.sourceFile'), icon: 'i-lucide-file-audio' }
    ])
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      v-for="item in options"
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
