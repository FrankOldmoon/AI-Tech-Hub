<script setup lang="ts">
/**
 * 智能抠图（背景移除）：MODNet 在浏览器本地推理
 * - 模型：Xenova/modnet（约 25MB，人像/主体 matting）
 * - WebGPU 优先，WASM 兜底；数据不出浏览器
 */
import { processImageFile } from '~/utils/image'
import { humanError } from '~/utils/errors'
import { setupTransformersEnv, preferredDevice } from '~/utils/transformers'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'bg-removal')!)

const imgSrc = ref('')
const resultUrl = ref('')
const loading = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const modelReady = ref(false)
const progressFile = ref('')
const progressPct = ref(0)
const inferenceTime = ref(0)
const webgpu = ref(false)
const alphaThreshold = ref(128)
const fileInput = ref<HTMLInputElement>()

onMounted(() => { webgpu.value = typeof navigator !== 'undefined' && !!(navigator as any).gpu })

let model: any = null
let processor: any = null
let envReady = false

const onProgress = (x: any) => {
  if (x?.status === 'progress' && x.file) {
    progressFile.value = String(x.file).split('/').pop() || x.file
    progressPct.value = x.total ? Math.round((x.loaded / x.total) * 100) : 0
  }
}

async function ensureModel() {
  if (model && processor) return
  loading.value = true
  error.value = null
  try {
    if (!envReady) {
      await setupTransformersEnv()
      envReady = true
    }
    const { AutoModel, AutoProcessor } = await import('@huggingface/transformers')
    const modelId = 'Xenova/modnet'
    processor = await AutoProcessor.from_pretrained(modelId, { progress_callback: onProgress })
    model = await AutoModel.from_pretrained(modelId, {
      dtype: 'fp32',
      device: preferredDevice(),
      progress_callback: onProgress
    })
    modelReady.value = true
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
    progressFile.value = ''
    progressPct.value = 0
  }
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    imgSrc.value = await processImageFile(file)
    resultUrl.value = ''
    error.value = null
  } catch (err: any) {
    error.value = err?.message || String(err)
  }
  input.value = ''
}

async function removeBg() {
  if (!imgSrc.value) return
  await ensureModel()
  if (!model || !processor) return
  running.value = true
  error.value = null
  resultUrl.value = ''
  const ts = performance.now()
  try {
    const { RawImage } = await import('@huggingface/transformers')
    const img = await RawImage.fromURL(imgSrc.value)
    const { pixel_values } = await processor(img)
    const { output } = await model({ input: pixel_values })

    // output: [1, 1, H, W] 的 alpha matte，先转 uint8 再缩放到原图尺寸
    const maskData = (
      await RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(img.width, img.height)
    ).data

    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')

    ctx.drawImage(img.toCanvas(), 0, 0)
    const pixelData = ctx.getImageData(0, 0, img.width, img.height)
    const th = Number(alphaThreshold.value)
    for (let i = 0; i < maskData.length; ++i) {
      // 阈值 + 平滑过渡，避免硬边
      const m = maskData[i]
      const a = m <= th ? 0 : Math.min(255, Math.round(((m - th) / Math.max(1, 255 - th)) * 255))
      pixelData.data[4 * i + 3] = a
    }
    ctx.putImageData(pixelData, 0, 0)

    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
    resultUrl.value = canvas.toDataURL('image/png')
    inferenceTime.value = Math.round(performance.now() - ts)
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    running.value = false
  }
}

function download() {
  if (!resultUrl.value) return
  const a = document.createElement('a')
  a.href = resultUrl.value
  a.download = 'bg-removed.png'
  a.click()
}

onBeforeUnmount(async () => {
  try { if (resultUrl.value && resultUrl.value.startsWith('blob:')) URL.revokeObjectURL(resultUrl.value) } catch { /* ignore */ }
  try { if (model) await model.dispose() } catch { /* ignore */ }
  model = null
  processor = null
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="flex flex-wrap items-center gap-3">
      <UBadge v-if="webgpu" color="primary" variant="subtle">WebGPU</UBadge>
      <UBadge v-else color="neutral" variant="subtle">WASM</UBadge>
      <UBadge v-if="modelReady" color="success" variant="subtle">
        {{ t('bgRemoval.loaded') }}
      </UBadge>
      <UButton
        v-else
        icon="i-lucide-download"
        :label="t('bgRemoval.load')"
        color="primary"
        variant="subtle"
        :loading="loading"
        :disabled="loading || running"
        @click="ensureModel"
      />
      <span class="text-sm text-muted">{{ t('bgRemoval.modelHelp') }}</span>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="error" />
    <UAlert v-if="!modelReady && !error" color="info" variant="subtle" icon="i-lucide-info" :title="t('bgRemoval.firstDownload')" />

    <div v-if="loading" class="space-y-1">
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted truncate">{{ progressFile || t('bgRemoval.loadingModel') }}</span>
        <span class="text-muted">{{ progressPct }}%</span>
      </div>
      <UProgress :model-value="progressPct" />
    </div>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-upload" class="size-4" />
          {{ t('bgRemoval.upload') }}
        </div>
      </template>
      <div class="flex flex-wrap items-end gap-4">
        <UButton
          icon="i-lucide-upload"
          :label="t('bgRemoval.uploadBtn')"
          color="primary"
          variant="subtle"
          :disabled="loading || running"
          @click="fileInput?.click()"
        />
        <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange">
        <UButton
          icon="i-lucide-scissors"
          :label="t('bgRemoval.run')"
          color="primary"
          :loading="running"
          :disabled="loading || running || !imgSrc"
          @click="removeBg"
        />
        <span v-if="inferenceTime" class="text-sm text-muted">
          {{ t('bgRemoval.time') }}: {{ inferenceTime }} ms
        </span>
      </div>
      <label class="mt-4 block">
        <span class="block text-sm font-medium text-muted mb-1">{{ t('bgRemoval.threshold') }}</span>
        <div class="flex items-center gap-3 max-w-sm">
          <URange v-model="alphaThreshold" :min="0" :max="255" :step="1" class="flex-1" />
          <span class="text-sm text-muted w-10 text-right">{{ alphaThreshold }}</span>
        </div>
      </label>
    </UCard>

    <div class="grid sm:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('bgRemoval.original') }}</label>
        <div class="relative aspect-video rounded-xl overflow-hidden bg-elevated/60 border border-dashed border-default flex items-center justify-center">
          <img v-if="imgSrc" :src="imgSrc" class="w-full h-full object-contain">
          <UIcon v-else name="i-lucide-image-plus" class="size-8 text-muted" />
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('bgRemoval.result') }}</label>
        <div class="relative aspect-video rounded-xl overflow-hidden border border-dashed border-default flex items-center justify-center"
          :style="{ backgroundImage: 'linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%),linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%)', backgroundSize: '16px 16px', backgroundPosition: '0 0,8px 8px' }"
        >
          <img v-if="resultUrl" :src="resultUrl" class="w-full h-full object-contain">
          <div v-else class="flex flex-col items-center gap-2 text-muted">
            <UIcon v-if="running" name="i-lucide-loader-circle" class="size-8 animate-spin" />
            <UIcon v-else name="i-lucide-scissors" class="size-8" />
            <span class="text-sm">{{ running ? t('bgRemoval.running') : t('bgRemoval.noResult') }}</span>
          </div>
        </div>
        <UButton
          v-if="resultUrl"
          icon="i-lucide-download"
          :label="t('bgRemoval.download')"
          color="secondary"
          variant="subtle"
          class="mt-3"
          @click="download"
        />
      </div>
    </div>
  </MediaDemoShell>
</template>
