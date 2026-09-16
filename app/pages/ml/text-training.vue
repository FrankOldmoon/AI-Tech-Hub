<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import type { KnnClassifierLike } from '~/composables/useKnnTrainer'
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

// 类别名 / 样本数 / 预测结果 / 重命名迁移 / 清空 由共享层管理（与图像、姿态训练页同源）
const {
  classNames, sampleCounts, predictions, topClass,
  classNameAt, totalSamples, syncCount, resetResults, applyPrediction,
  renameClass, clearClass, clearAll
} = useKnnTrainer()

// 每类的待加入样本文本
const sampleTexts = ref<string[]>(['', '', ''])
const predictText = ref('')

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
let classifier: KnnClassifierLike | null = null

async function loadModels() {
  if (extractor && classifier) return
  loading.value = true
  error.value = null
  loadProgress.value = t('ml.textTraining.loadingModel')
  try {
    const env = await setupTransformersEnv()
    // 本地 .models/transformers 有该模型才允许本地加载，否则走 /api/hf 远程代理
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
  sampleCounts.value = sampleCounts.value.map(() => 0)
  resetResults()
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
  const clf = classifier
  if (!clf) {
    error.value = t('ml.textTraining.loadFirst')
    return
  }
  const lines = (sampleTexts.value[idx] ?? '').split('\n').map(s => s.trim()).filter(Boolean)
  if (!lines.length) return
  loadingSamples.value = true
  error.value = null
  try {
    const tf = await import('@tensorflow/tfjs')
    for (const line of lines) {
      const vec = await embed(line)
      if (!vec) continue
      const tensor = tf.tensor2d([vec], [1, vec.length])
      clf.addExample(tensor, classNameAt(idx))
      syncCount(idx, clf)
    }
    sampleTexts.value[idx] = ''
  } finally {
    loadingSamples.value = false
  }
}

async function predict() {
  const text = predictText.value.trim()
  if (!text) return
  const clf = classifier
  if (!clf || clf.getNumClasses() === 0) {
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
    const res = await clf.predictClass(tensor, Number(params.value.topK))
    applyPrediction(res, Number(params.value.probabilityThreshold))
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    predicting.value = false
  }
}

function onRenameClass(idx: number, name: string) {
  if (!renameClass(idx, name, classifier)) error.value = t('ml.renameAfterSamples')
}

function onClearClass(idx: number) {
  clearClass(idx, classifier)
}

function onClearAll() {
  clearAll(classifier)
}

function onSampleInput(idx: number, event: Event) {
  sampleTexts.value[idx] = (event.target as HTMLTextAreaElement).value
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
        :disabled="totalSamples === 0"
        @click="onClearAll"
      />
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />
    <UAlert v-if="loading && loadProgress" color="primary" variant="subtle" :title="loadProgress" />

    <!-- 训练区：3 个类别 -->
    <ClassTrainerGrid
      :class-names="classNames"
      :sample-counts="sampleCounts"
      @rename="onRenameClass"
      @clear="onClearClass"
    >
      <template #extra="{ index }">
        <textarea
          :value="sampleTexts[index] ?? ''"
          rows="5"
          class="w-full rounded-lg border border-default bg-elevated/40 p-2 text-sm outline-none focus:border-primary resize-y"
          :placeholder="t('ml.textTraining.samplesPlaceholder')"
          @input="onSampleInput(index, $event)"
        />
      </template>
      <template #collect="{ index }">
        <UButton
          icon="i-lucide-plus"
          :label="t('ml.textTraining.addToClass')"
          color="primary"
          size="sm"
          variant="subtle"
          :loading="loadingSamples"
          :disabled="!classifier || loading"
          block
          @click="addSamples(index)"
        />
      </template>
    </ClassTrainerGrid>

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
        <PredictionBars
          :predictions="predictions"
          :top-class="topClass"
          :below-threshold-hint="t('ml.textTraining.belowThreshold')"
        />
      </div>
    </UCard>

    <!-- 可调参数 -->
    <DemoParams v-model="params" :specs="specs" :running="predicting || loadingSamples" />
  </MediaDemoShell>
</template>
