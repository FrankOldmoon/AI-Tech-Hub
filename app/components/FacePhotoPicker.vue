<script setup lang="ts">
/**
 * 多图人脸照片选择器（注册/识别共用）：
 * - 支持一次选择多张照片，逐张调用后端分析（提取全部人脸嵌入 + bbox）
 * - 展示原图与检测框；合影多脸时可点击缩略图选择要使用的人脸
 * - v-model:photos 双向绑定
 */
import { analyzeFace, makeFaceThumb } from '~/utils/face-registry'
import type { PickedPhoto } from '~/utils/face-studio'
import { processImageFile } from '~/utils/image'

const props = defineProps<{
  photos: PickedPhoto[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:photos', photos: PickedPhoto[]): void
}>()

const { t } = useI18n()
const fileInput = ref<HTMLInputElement>()

function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(36).slice(2)
}

async function fileToImageData(url: string): Promise<ImageData> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

function patch(photo: PickedPhoto, p: Partial<PickedPhoto>): void {
  const list = props.photos.map(x => (x.id === photo.id ? { ...x, ...p } : x))
  emit('update:photos', list)
}

async function addFiles(files: FileList | File[]) {
  if (props.disabled) return
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) continue
    const photo: PickedPhoto = {
      id: uid(),
      fileName: file.name,
      src: '',
      imageData: new ImageData(1, 1),
      status: 'analyzing',
      statusText: t('image.faceStudio.analyzing'),
      analysis: null,
      selectedFace: 0
    }
    emit('update:photos', [...props.photos, photo])
    void analyzePhoto(photo, file)
  }
}

async function analyzePhoto(photo: PickedPhoto, file: File) {
  try {
    const src = await processImageFile(file, 2048)
    const imageData = await fileToImageData(src)
    const analysis = await analyzeFace(imageData, {
      onStatus: s => patch(photo, { statusText: s.message || t('image.faceStudio.analyzing') })
    })
    patch(photo, {
      src,
      imageData,
      analysis,
      status: analysis.faces > 0 ? 'ok' : 'no-face',
      selectedFace: 0,
      statusText: undefined
    })
  } catch (e) {
    patch(photo, {
      status: 'error',
      error: (e as Error)?.message || String(e),
      statusText: undefined
    })
  }
}

function removePhoto(id: string) {
  const photo = props.photos.find(p => p.id === id)
  if (photo?.src) URL.revokeObjectURL(photo.src)
  emit('update:photos', props.photos.filter(p => p.id !== id))
}

function selectFace(photo: PickedPhoto, i: number) {
  if (!photo.analysis || i >= photo.analysis.faces) return
  patch(photo, { selectedFace: i })
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  const files = e.dataTransfer?.files
  if (files?.length) void addFiles(files)
}

function faceThumb(photo: PickedPhoto, i: number): string {
  if (!photo.analysis) return ''
  const bbox = photo.analysis.bboxes?.[i]
  return bbox?.length === 4 ? makeFaceThumb(photo.imageData, bbox) : ''
}

defineExpose({ addFiles })

function boxPct(photo: PickedPhoto, i: number) {
  const bbox = photo.analysis?.bboxes?.[i]
  if (!bbox?.length || !photo.imageData) return null
  const w = photo.imageData.width || 1
  const h = photo.imageData.height || 1
  return {
    x: (bbox[0] / w) * 100,
    y: (bbox[1] / h) * 100,
    width: ((bbox[2] - bbox[0]) / w) * 100,
    height: ((bbox[3] - bbox[1]) / h) * 100
  }
}

onBeforeUnmount(() => {
  for (const p of props.photos) if (p.src) URL.revokeObjectURL(p.src)
})
</script>

<template>
  <div class="space-y-3">
    <div
      class="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors hover:border-primary/60"
      :class="disabled ? 'opacity-50 pointer-events-none' : ''"
      @click="fileInput?.click()"
      @dragover.prevent
      @drop.prevent="onDrop"
    >
      <UIcon name="i-lucide-images" class="size-8 text-muted mx-auto" />
      <p class="mt-2 text-sm font-medium text-highlighted">{{ t('image.faceStudio.addPhotos') }}</p>
      <p class="mt-1 text-xs text-dimmed">{{ t('image.faceStudio.photosHint') }}</p>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        :disabled="disabled"
        @change="(e: Event) => addFiles((e.target as HTMLInputElement).files!)"
      >
    </div>

    <ul v-if="photos.length" class="grid sm:grid-cols-2 gap-3">
      <li
        v-for="p in photos"
        :key="p.id"
        class="rounded-lg border border-default p-2 space-y-2"
      >
        <div class="relative rounded-md overflow-hidden bg-elevated/60">
          <img
            v-if="p.src && p.status !== 'error'"
            :src="p.src"
            class="w-full h-auto max-h-56 object-contain"
            alt=""
          >
          <!-- 检测框（仅展示，点击缩略图选脸） -->
          <svg
            v-if="p.status === 'ok' && p.analysis?.faces"
            class="absolute inset-0 w-full h-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <template v-for="n in p.analysis.faces" :key="n">
              <rect
                :x="boxPct(p, n - 1)?.x"
                :y="boxPct(p, n - 1)?.y"
                :width="boxPct(p, n - 1)?.width"
                :height="boxPct(p, n - 1)?.height"
                fill="none"
                :stroke="n - 1 === p.selectedFace ? '#facc15' : '#34d399'"
                :stroke-width="n - 1 === p.selectedFace ? 1.6 : 1"
              />
            </template>
          </svg>
          <button
            type="button"
            class="absolute top-1.5 right-1.5 size-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-error"
            :aria-label="t('image.faceStudio.removePhoto')"
            @click="removePhoto(p.id)"
          >
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </div>

        <div class="flex items-center gap-2 text-xs">
          <span class="truncate text-muted">{{ p.fileName }}</span>
          <span v-if="p.status === 'analyzing'" class="inline-flex items-center gap-1 text-primary">
            <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
            {{ p.statusText || t('image.faceStudio.analyzing') }}
          </span>
          <UBadge v-else-if="p.status === 'no-face'" color="error" variant="subtle">
            {{ t('image.faceStudio.noFace') }}
          </UBadge>
          <UBadge v-else-if="p.status === 'error'" color="error" variant="subtle" :label="p.error || t('image.faceStudio.analyzeError')" />
          <UBadge v-else color="success" variant="subtle">
            {{ p.analysis?.faces }} {{ t('image.faceStudio.faces') }}
          </UBadge>
        </div>

        <!-- 人脸缩略图：点击选择要使用的脸 -->
        <div v-if="p.status === 'ok' && p.analysis?.faces" class="flex flex-wrap gap-2">
          <button
            v-for="n in p.analysis.faces"
            :key="n"
            type="button"
            class="relative size-12 rounded-lg overflow-hidden border-2 transition"
            :class="n - 1 === p.selectedFace ? 'border-primary ring-2 ring-primary/40' : 'border-default hover:border-primary/60'"
            :title="t('image.faceStudio.selectFace') + ' ' + n"
            @click="selectFace(p, n - 1)"
          >
            <img :src="faceThumb(p, n - 1)" class="w-full h-full object-cover" alt="">
            <span class="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] text-center">
              {{ n }}
            </span>
          </button>
          <span class="text-xs text-dimmed self-center">
            {{ t('image.faceStudio.faceSelectHint') }}
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>
