<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { humanError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'
import { setupTransformersEnv, preferredDevice } from '~/utils/transformers'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'text-training')!)

const loading = ref(false)
const loadingSamples = ref(false)
const predicting = ref(false)
const error = ref<string | null>(null)
const loadProgress = ref('')

// 模型选择
const modelOptions = computed(() => [
  { label: t('ml.textTraining.modelEnglish'), value: 'Xenova/all-MiniLM-L6-v2' },
  { label: t('ml.textTraining.modelMultilingual'), value: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' }
])
const modelId = ref('Xenova/all-MiniLM-L6-v2')

// 3 个类别
const classNames = ref(['Class A', 'Class B', 'Class C'])
const sampleTexts = ref(['', '', ''])
const sampleCounts = ref([0, 0, 0])
// 预测
const predictText = ref('')
const predictions = ref<Array<{ name: string, score: number }>>([])
const topClass = ref('')

// 可调参数
const specs = computed<ParamSpec[]>(() => [
  {
    key: 'topK',
    label: t('ml.topK'),
    type: 'slider',
    default: 5,
    min: 1,
    max: 20,
    step: 1,
    help: t('ml.topKHelp')
  },
  {
    key: 'probabilityThreshold',
    label: t('ml.probThreshold'),
    type: 'slider',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    help: t('ml.probThresholdHelp')
  }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

let extractor: any = null
let classifier: any = null

async function loadModels() {
  if (extractor && classifier) return
  loading.value = true
  error.value = null
  loadProgress.value = t('ml.textTraining.loadingModel')
  try {
    const env = await setupTransformersEnv()
    // 本地 public/model/transformers 有该模型才允许本地加载，否则走 /api/hf 远程代理
    const localOk = await localModelExists(modelId.value)
    env.allowLocalModels = localOk
    const { pipeline } = await import('@huggingface/transformers')
    extractor = await pipeline('feature-extraction', modelId.value, {
      dtype: 'q8',
      device: preferredDevice()
    })
    const knnMod = await import('@tensorflow-models/knn-classifier')
    classifier = knnMod.create()
    loadProgress.value = ''
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}

async function localModelExists(modelId: string): Promise<boolean> {
  try {
    const res = await fetch(`/model/transformers/${modelId}/config.json`, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

function resetModel() {
  extractor = null
  classifier = null
  sampleCounts.value = [0, 0, 0]
  predictions.value = []
  topClass.value = ''
}

/** 句子嵌入：mean pooling + L2 归一化 */
async function embed(text: string): Promise<number[] | null> {
  if (!extractor) return null
  try {
    const out = await extractor(text, { pooling: 'mean', normalize: true })
    return Array.from(out.data) as number[]
  } catch (e: any) {
    error.value = humanError(e, t)
    return null
  }
}

async function addSamples(idx: number) {
  if (!classifier) {
    error.value = t('ml.textTraining.loadFirst')
    return
  }
  const lines = sampleTexts.value[idx].split('\n').map(s => s.trim()).filter(Boolean)
  if (!lines.length) return
  loadingSamples.value = true
  error.value = null
  try {
    const tf = await import('@tensorflow/tfjs')
    for (const line of lines) {
      const vec = await embed(line)
      if (!vec) continue
      const tensor = tf.tensor2d([vec], [1, vec.length])
      classifier.addExample(tensor, classNames.value[idx])
      sampleCounts.value[idx] = classifier.getClassExampleCount()[classNames.value[idx]] || 0
    }
    sampleTexts.value[idx] = ''
  } finally {
    loadingSamples.value = false
  }
}

async function predict() {
  const text = predictText.value.trim()
  if (!text) return
  if (!classifier || classifier.getNumClasses() === 0) {
    error.value = t('ml.textTraining.noSamples')
    return
  }
  predicting.value = true
  error.value = null
  try {
    const vec = await embed(text)
    if (!vec) return
    const tf = await import('@tensorflow/tfjs')
    const tensor = tf.tensor2d([vec], [1, vec.length])
    const res = await classifier.predictClass(tensor, Number(params.value.topK))
    const confidences = res.confidences
    const label = res.label
    topClass.value = (confidences[label] ?? 0) >= Number(params.value.probabilityThreshold) ? label : ''
    predictions.value = classNames.value
      .map((name, i) => ({ name, score: confidences[name] ?? confidences[i] ?? 0 }))
      .sort((a, b) => b.score - a.score)
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    predicting.value = false
  }
}

function clearAll() {
  if (!classifier) return
  classifier.clearAllClasses()
  sampleCounts.value = [0, 0, 0]
  predictions.value = []
  topClass.value = ''
}

function clearClass(idx: number) {
  if (!classifier) return
  classifier.clearClass(classNames.value[idx])
  sampleCounts.value[idx] = 0
  predictions.value = []
  topClass.value = ''
}

function renameClass(idx: number, name: string) {
  const oldName = classNames.value[idx]
  if (classifier && oldName !== name) {
    const count = classifier.getClassExampleCount()?.[oldName] || 0
    if (count > 0) {
      const dataset = classifier.getClassDatasetObject(oldName)
      if (dataset) {
        classifier.clearClass(oldName)
        for (const tensor of Object.values(dataset)) {
          classifier.addExample(tensor, name)
        }
      }
    }
  }
  classNames.value[idx] = name
}
</script>

<template>
  <MediaDemoShell :demo="demo">
    <!-- 控件 -->
    <div class="flex flex-wrap items-center gap-2">
      <USelect
        v-model="modelId"
        :items="modelOptions"
        class="w-64"
        :disabled="loading"
        @update:model-value="resetModel"
      />
      <UButton
        icon="i-lucide-brain"
        :label="t('ml.loadModel')"
        color="primary"
        :loading="loading"
        :disabled="extractor !== null"
        @click="loadModels"
      />
      <UButton
        icon="i-lucide-trash-2"
        :label="t('ml.clearAll')"
        color="neutral"
        variant="subtle"
        :disabled="!sampleCounts.some(c => c > 0)"
        @click="clearAll"
      />
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />
    <UAlert v-if="loading && loadProgress" color="primary" variant="subtle" :title="loadProgress" />

    <!-- 训练区：3 个类别 -->
    <div class="grid sm:grid-cols-3 gap-4">
      <UCard
        v-for="(name, i) in classNames"
        :key="i"
      >
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <span class="size-3 rounded-full" :class="['bg-green-500', 'bg-purple-500', 'bg-orange-500'][i]" />
            <input
              :value="name"
              class="flex-1 bg-transparent border-b border-default text-sm font-medium text-highlighted focus:border-primary outline-none py-1"
              @change="renameClass(i, ($event.target as HTMLInputElement).value)"
            >
          </div>
          <textarea
            v-model="sampleTexts[i]"
            rows="5"
            class="w-full rounded-lg border border-default bg-elevated/40 p-2 text-sm outline-none focus:border-primary resize-y"
            :placeholder="t('ml.textTraining.samplesPlaceholder')"
          />
          <div class="flex items-center gap-2">
            <UButton
              icon="i-lucide-plus"
              :label="t('ml.textTraining.addToClass')"
              color="primary"
              size="sm"
              variant="subtle"
              :loading="loadingSamples"
              :disabled="!classifier || loading"
              block
              @click="addSamples(i)"
            />
            <UButton
              v-if="sampleCounts[i] > 0"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="clearClass(i)"
            />
          </div>
          <div class="text-sm text-muted">
            {{ sampleCounts[i] }} {{ t('ml.samples') }}
          </div>
        </div>
      </UCard>
    </div>

    <!-- 预测 -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-scan-search" class="size-4" />
          {{ t('ml.textTraining.predict') }}
        </div>
      </template>
      <div class="space-y-3">
        <div class="flex gap-2">
          <UInput
            v-model="predictText"
            class="flex-1"
            :placeholder="t('ml.textTraining.predictPlaceholder')"
            @keyup.enter="predict"
          />
          <UButton
            icon="i-lucide-play"
            :label="t('ml.textTraining.predict')"
            color="primary"
            :loading="predicting"
            :disabled="!predictText.trim()"
            @click="predict"
          />
        </div>
        <div v-if="topClass" class="flex items-center gap-2">
          <span class="text-xl font-bold text-highlighted">{{ topClass }}</span>
        </div>
        <div v-else-if="predictions.length" class="text-sm text-muted">
          {{ t('ml.textTraining.belowThreshold') }}
        </div>
        <div
          v-for="(p, i) in predictions"
          :key="i"
          class="flex items-center gap-3"
        >
          <span class="text-sm font-medium w-24 shrink-0 truncate">{{ p.name }}</span>
          <UProgress :model-value="Math.round(p.score * 100)" size="sm" class="flex-1" />
          <span class="text-sm text-muted w-12 text-right tabular-nums">{{ Math.round(p.score * 100) }}%</span>
        </div>
      </div>
    </UCard>

    <!-- 可调参数 -->
    <DemoParams v-model="params" :specs="specs" :running="predicting || loadingSamples" />
  </MediaDemoShell>
</template>
