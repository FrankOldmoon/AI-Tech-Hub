<script setup lang="ts">
/**
 * 共享图像输入组件：上传 + 示例图 + 摄像头 三者一体（大虚线拖拽区形态）。
 * - 上传：点击大虚线区或拖拽图片 → emit('select', File)
 * - 示例：点示例图 → emit('pick', url)
 * - 摄像头：点「使用摄像头」→ 拍照 → emit('select', File)（与上传走同一处理管线）
 * 任何使用该组件的页面都自动获得一致的「上传+示例+实时摄像头取帧」能力，
 * 外观与 features（ImagePlayground）的上传区一致。
 */
const props = withDefaults(defineProps<{
  samples: Array<{ label: string, url: string }>
  /** 是否显示上传入口（默认显示） */
  upload?: boolean
  disabled?: boolean
}>(), { upload: true, disabled: false })

const emit = defineEmits<{ select: [file: File], pick: [url: string] }>()
const { t } = useI18n()
const camOpen = ref(false)
const fileInput = ref<HTMLInputElement>()
const dragOver = ref(false)

function openPicker() {
  if (props.disabled) return
  fileInput.value?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('select', file)
  input.value = ''
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  if (props.disabled) return
  const file = e.dataTransfer?.files?.[0]
  if (file) emit('select', file)
}

function onSample(s: { url: string }) {
  if (props.disabled) return
  emit('pick', s.url)
}

function onCapture(file: File) {
  emit('select', file)
  camOpen.value = false
}
</script>

<template>
  <div class="space-y-2 w-full">
    <!-- 大虚线拖拽上传区 -->
    <input
      v-if="upload"
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hidden"
      :disabled="disabled"
      @change="onFileChange"
    >
    <div
      v-if="upload"
      class="border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors"
      :class="dragOver ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/60'"
      :aria-disabled="disabled"
      @click="openPicker"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <UIcon
        name="i-lucide-image-plus"
        class="size-10 text-muted mx-auto"
      />
      <p class="mt-3 text-sm font-medium text-highlighted">
        {{ t('image.upload') }}
      </p>
      <p class="mt-1 text-xs text-dimmed">
        {{ t('image.uploadHint') }}
      </p>
      <div
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
        <UButton
          :label="t('webcam.useCamera')"
          :icon="camOpen ? 'i-lucide-camera-off' : 'i-lucide-video'"
          size="xs"
          color="neutral"
          variant="soft"
          :disabled="disabled"
          @click="camOpen = !camOpen"
        />
      </div>
    </div>

    <!-- 仅示例与摄像头入口（upload=false 时） -->
    <div
      v-else
      class="flex flex-wrap items-center gap-2"
    >
      <span class="text-xs text-muted">{{ t('samples.trySample') }}</span>
      <UButton
        v-for="s in samples"
        :key="s.url"
        size="xs"
        variant="outline"
        :label="s.label"
        :disabled="disabled"
        @click="onSample(s)"
      >
        <template #leading>
          <UIcon
            name="i-lucide-image"
            class="size-3.5"
          />
        </template>
      </UButton>
      <UButton
        size="xs"
        variant="outline"
        :disabled="disabled"
        :label="t('webcam.useCamera')"
        :icon="camOpen ? 'i-lucide-camera-off' : 'i-lucide-video'"
        @click="camOpen = !camOpen"
      />
    </div>

    <div
      v-if="camOpen"
      class="mt-3"
    >
      <WebcamCapture
        @capture="onCapture"
        @close="camOpen = false"
      />
    </div>
  </div>
</template>
