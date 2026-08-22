<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { humanError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'
import { processImageFile } from '~/utils/image'
import { setupTransformersEnv, hasWebGPU, transformersModels } from '~/utils/transformers'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'depth-estimation')!)

const fileInput = ref<HTMLInputElement>()
const canvasRef = ref<HTMLCanvasElement>()
const imgSrc = ref('')
const loading = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const inferenceTime = ref(0)
// SSR 与客户端初始保持一致（false），挂载后再检测，避免 hydration mismatch
const webgpu = ref(false)
onMounted(() => {
  webgpu.value = hasWebGPU()
  // 课堂演示：打开页面自动加载街景示例图并估计深度
  useSample('/samples/images/street.jpg')
})

// 模型选择：small 体积小、加载快；base/large 精度更高
const modelItems = [
  { label: 'Depth Anything V1 Small', value: transformersModels.depthEstimation },
  { label: 'Depth Anything V2 Small', value: 'onnx-community/depth-anything-v2-small' }
]
const modelId = ref(modelItems[0]!.value)

const specs = computed<ParamSpec[]>(() => [
  {
    key: 'invert',
    label: t('tf.depthInvert'),
    type: 'switch',
    default: false,
    help: t('tf.depthInvertHelp')
  }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

let pipe: any = null
let envReady = false

async function ensurePipeline() {
  if (pipe) return pipe
  loading.value = true
  error.value = null
  try {
    if (!envReady) {
      await setupTransformersEnv()
      envReady = true
    }
    const { pipeline } = await import('@huggingface/transformers')
    pipe = await pipeline('depth-estimation' as any, modelId.value, {
      // depth-anything 在 WebGPU（onnxruntime jsep）执行报 "null function"，强制 wasm 稳定
      device: 'wasm',
      dtype: 'fp32'
    } as any)
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
  return pipe
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    // 先解码为标准 PNG（处理 HEIC/超大图等 createImageBitmap 不支持的输入）
    imgSrc.value = await processImageFile(file)
    await run()
  } catch (err: any) {
    error.value = err?.message || String(err)
    imgSrc.value = ''
  }
  input.value = ''
}

async function useSample(url: string) {
  try {
    const file = await fetchSampleFile(url)
    imgSrc.value = await processImageFile(file)
    error.value = null
    await run()
  } catch (err: any) {
    error.value = err?.message || String(err)
    imgSrc.value = ''
  }
}

const { samples, fetchSampleFile } = useVisionSamples()

async function run() {
  if (!imgSrc.value) return
  const p = await ensurePipeline()
  if (!p) return
  running.value = true
  error.value = null
  const ts = performance.now()
  try {
    const out = await p(imgSrc.value)
    inferenceTime.value = Math.round(performance.now() - ts)
    drawDepth(out)
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    running.value = false
  }
}

function drawDepth(out: any) {
  const canvas = canvasRef.value
  if (!canvas) return
  // transformers.js depth-estimation 返回 { depth: RawImage, predicted_depth: Tensor }
  const depth = out?.depth
  if (!depth) return
  const w = depth.width
  const h = depth.height
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  // 取 RawImage 的 RGBA 数据
  const data = depth.data
  const invert = Boolean(params.value.invert)
  const imgData = ctx.createImageData(w, h)
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]
    if (invert) {
      r = 255 - r
      g = 255 - g
      b = 255 - b
    }
    imgData.data[i] = r
    imgData.data[i + 1] = g
    imgData.data[i + 2] = b
    imgData.data[i + 3] = 255
  }
  ctx.putImageData(imgData, 0, 0)
}

// 参数变更后若已有结果，重绘
watch(params, () => {
  if (canvasRef.value) run()
}, { deep: true })

async function onModelChange() {
  if (pipe) {
    try { await pipe.dispose() } catch { /* ignore */ }
    pipe = null
  }
  if (imgSrc.value) run()
}

onBeforeUnmount(async () => {
  try { if (pipe) await pipe.dispose() } catch { /* ignore */ }
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="flex flex-wrap items-end gap-4">
      <div class="min-w-56 flex-1">
        <label class="block text-sm font-medium text-muted mb-1">{{ t('tf.model') }}</label>
        <USelect
          v-model="modelId"
          :items="modelItems"
          :disabled="loading || running"
          class="w-full"
          @change="onModelChange"
        />
      </div>
      <UBadge v-if="webgpu" color="primary" variant="subtle">WebGPU</UBadge>
      <UBadge v-else color="neutral" variant="subtle">WASM</UBadge>
      <UButton
        icon="i-lucide-upload"
        :label="t('mp.upload')"
        color="primary"
        variant="subtle"
        :disabled="loading || running"
        @click="fileInput?.click()"
      />
      <SampleImagePicker
        :samples="samples"
        @pick="useSample"
      />
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange">
      <span v-if="inferenceTime" class="text-sm text-muted ms-2">{{ inferenceTime }} ms</span>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

    <!-- 输入图 + 深度图对比 -->
    <div class="grid sm:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('tf.inputImage') }}</label>
        <div class="relative w-full aspect-video rounded-xl overflow-hidden bg-elevated/60 flex items-center justify-center border border-dashed border-default">
          <img v-if="imgSrc" :src="imgSrc" class="w-full h-full object-contain">
          <UIcon v-else name="i-lucide-image-plus" class="size-8 text-muted" />
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('tf.depthMap') }}</label>
        <div class="relative w-full aspect-video rounded-xl overflow-hidden bg-elevated/60 flex items-center justify-center border border-dashed border-default">
          <canvas v-show="imgSrc" ref="canvasRef" class="w-full h-full object-contain" />
          <UIcon v-if="!imgSrc || !inferenceTime" name="i-lucide-layers" class="size-8 text-muted" />
          <div v-if="running" class="absolute inset-0 flex items-center justify-center bg-black/40">
            <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-white" />
          </div>
        </div>
      </div>
    </div>

    <!-- 可调参数 -->
    <DemoParams v-model="params" :specs="specs" :running="running" />
  </MediaDemoShell>
</template>
