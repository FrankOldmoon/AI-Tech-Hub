<script setup lang="ts">
const { t } = useI18n()
import { mediapipeWasm, mediapipeModels } from '~/utils/mediapipe'
import { humanError } from '~/utils/errors'

const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'image-embedder')!)

const loading = ref(false)
const error = ref<string | null>(null)
const similarity = ref<number | null>(null)
const img1Src = ref('')
const img2Src = ref('')
// 静态 ref（Vue 3 script setup 中动态 :ref 字符串无法通过 $refs 访问）
const file1Input = ref<HTMLInputElement>()
const file2Input = ref<HTMLInputElement>()

let embedder: any = null

const { fetchSampleFile } = useVisionSamples()
// Image A 固定为 Portrait（人脸照）；Image B 提供三个对比样本：动物/人/植物
const A_SRC = '/samples/images/face.jpg'
const samples = computed(() => [
  { label: t('samples.animal'), url: '/samples/images/parrot.jpg' },
  { label: t('samples.person'), url: '/samples/images/similar-portrait.jpg' },
  { label: t('samples.plant'), url: '/samples/images/plant.jpg' }
])

// 选 Image B 样本 → 与固定的 Portrait(Image A) 对比，展示余弦相似度
async function useSample(url: string) {
  try {
    const [f1, f2] = await Promise.all([fetchSampleFile(A_SRC), fetchSampleFile(url)])
    img1Src.value = URL.createObjectURL(f1)
    img2Src.value = URL.createObjectURL(f2)
    await compute()
  } catch (e) {
    error.value = humanError(e, t)
  }
}

onMounted(() => {
  // 课堂演示：Image A = Portrait，Image B 默认「人」（高相似度），第一时间出结果
  useSample('/samples/images/similar-portrait.jpg')
})

async function ensureEmbedder() {
  if (embedder) return embedder
  const { FilesetResolver, ImageEmbedder } = await import('@mediapipe/tasks-vision')
  const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
  embedder = await ImageEmbedder.createFromOptions(vision, {
    baseOptions: { modelAssetPath: mediapipeModels.imageEmbedder, delegate: 'GPU' }
  })
  return embedder
}

async function onFile(e: Event, which: 1 | 2) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const src = URL.createObjectURL(file)
  if (which === 1) img1Src.value = src
  else img2Src.value = src
  if (img1Src.value && img2Src.value) await compute()
}

async function compute() {
  loading.value = true
  error.value = null
  similarity.value = null
  try {
    const emb = await ensureEmbedder()
    const { ImageEmbedder } = await import('@mediapipe/tasks-vision')
    const [b1, b2] = await Promise.all([
      createImageBitmap(await (await fetch(img1Src.value)).blob()),
      createImageBitmap(await (await fetch(img2Src.value)).blob())
    ])
    const e1 = emb.embed(b1)
    const e2 = emb.embed(b2)
    similarity.value = ImageEmbedder.cosineSimilarity(e1.embeddings[0], e2.embeddings[0])
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

    <div class="grid sm:grid-cols-2 gap-4">
      <div v-for="n in 2" :key="n">
        <label class="block text-sm font-medium text-muted mb-2">
          {{ n === 1 ? 'Image A · Portrait' : 'Image B' }}
        </label>
        <button
          type="button"
          class="relative w-full aspect-video rounded-xl overflow-hidden bg-elevated/60 flex items-center justify-center border border-dashed border-default hover:border-primary transition"
          @click="(n === 1 ? file1Input : file2Input)?.click()"
        >
          <img v-show="(n === 1 ? img1Src : img2Src)" :src="n === 1 ? img1Src : img2Src" class="w-full h-full object-contain">
          <UIcon v-if="!(n === 1 ? img1Src : img2Src)" name="i-lucide-image-plus" class="size-8 text-muted" />
        </button>
        <div
          v-if="n === 2"
          class="mt-2"
        >
          <SampleImagePicker
            :samples="samples"
            @pick="useSample"
          />
        </div>
        <input
          :ref="(el: any) => { if (el) { if (n === 1) file1Input = el; else file2Input = el } }"
          type="file"
          accept="image/*"
          class="hidden"
          @change="onFile($event, n === 1 ? 1 : 2)"
        >
      </div>
    </div>

    <UCard>
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-muted">Cosine Similarity</span>
        <span v-if="similarity !== null" class="text-2xl font-bold text-highlighted">
          {{ similarity.toFixed(4) }}
        </span>
        <span v-else class="text-sm text-muted">{{ loading ? 'computing…' : '—' }}</span>
      </div>
    </UCard>
  </MediaDemoShell>
</template>
