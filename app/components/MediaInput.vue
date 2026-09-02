<script setup lang="ts">
/**
 * 通用媒体上传组件：拖拽 / 点击 / 示例图三合一。
 * - 通过 v-model / emit('select', file) 暴露选中的文件
 * - optional samples 渲染「试试示例」按钮，emit('sample', url)
 * - 统一尺寸校验与错误提示，避免各页面重复实现
 */
const props = defineProps<{
  /** 上传类型，默认图片 */
  accept?: string
  title?: string
  hint?: string
  /** 示例媒体（label + url） */
  samples?: Array<{ label: string, url: string }> | null
  /** 最大文件大小（字节），默认 30MB */
  maxSize?: number
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', file: File): void
  (e: 'sample' | 'error', value: string): void
}>()

const { t } = useI18n()
const fileInput = ref<HTMLInputElement>()
const dragOver = ref(false)
const error = ref<string | null>(null)

function openPicker() {
  if (props.disabled) return
  fileInput.value?.click()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) validateAndEmit(file)
  input.value = ''
}

async function validateAndEmit(file: File) {
  const max = props.maxSize ?? 30 * 1024 * 1024
  error.value = null
  if (file.size > max) {
    error.value = t('mediaInput.tooLarge', { max: Math.round(max / 1024 / 1024) })
    emit('error', error.value)
    return
  }
  emit('select', file)
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) validateAndEmit(file)
}

function onSample(s: { url: string }) {
  if (props.disabled) return
  emit('sample', s.url)
}

const resolved = computed(() => ({
  title: props.title ?? t('mediaInput.upload'),
  hint: props.hint ?? t('mediaInput.uploadHint'),
  accept: props.accept ?? 'image/*'
}))
</script>

<template>
  <div class="space-y-2">
    <div
      class="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      :class="dragOver ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/60'"
      :aria-disabled="disabled"
      @click="openPicker"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <UIcon
        name="i-lucide-image-plus"
        class="size-9 text-muted mx-auto"
      />
      <p class="mt-2 text-sm font-medium text-highlighted">
        {{ resolved.title }}
      </p>
      <p class="mt-1 text-xs text-dimmed">
        {{ resolved.hint }}
      </p>

      <div
        v-if="samples?.length"
        class="mt-4 flex flex-wrap justify-center items-center gap-2"
        @click.stop
      >
        <span class="text-xs text-dimmed">{{ t('samples.trySample') }}:</span>
        <UButton
          v-for="s in samples"
          :key="s.url"
          :label="s.label"
          icon="i-lucide-image"
          size="xs"
          color="neutral"
          variant="soft"
          :disabled="disabled"
          @click="onSample(s)"
        />
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      :accept="resolved.accept"
      class="hidden"
      :disabled="disabled"
      @change="onFileChange"
    >

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-alert-triangle"
      :title="error"
    />
  </div>
</template>
