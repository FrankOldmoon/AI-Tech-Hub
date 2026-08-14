<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { humanError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'
import { isRemoteDeploy, REMOTE_TFJS } from '~/utils/remote-models'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'audio-training')!)

const loading = ref(false) // 模型加载
const error = ref<string | null>(null)
const trained = ref(false) // 是否已训练
const training = ref(false) // 训练中
const predicting = ref(false) // 预测中
const recording = ref(false) // 录制中
const loadProgress = ref('')

// 3 个类别
const classNames = ref(['Class A', 'Class B', 'Class C'])
const sampleCounts = ref([0, 0, 0])
// 预测结果
const predictions = ref<Array<{ name: string, score: number }>>([])
const topClass = ref<string>('')

// 可调参数
const specs = computed<ParamSpec[]>(() => [
  {
    key: 'epochs',
    label: t('ml.epochs'),
    type: 'slider',
    default: 25,
    min: 10,
    max: 100,
    step: 5,
    help: t('ml.epochsHelp')
  },
  {
    key: 'overlapFactor',
    label: t('ml.overlapFactor'),
    type: 'slider',
    default: 0.5,
    min: 0,
    max: 0.9,
    step: 0.1,
    help: t('ml.overlapFactorHelp')
  },
  {
    key: 'probabilityThreshold',
    label: t('ml.probThreshold'),
    type: 'slider',
    default: 0.7,
    min: 0,
    max: 1,
    step: 0.05,
    help: t('ml.probThresholdHelp')
  }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

let recognizer: any = null
let transfer: any = null
let collecting = false // 是否在连续采集
let collectClass = -1

async function loadModels() {
  if (recognizer && transfer) return
  loading.value = true
  error.value = null
  loadProgress.value = t('ml.loadingSpeechCommands')
  try {
    const tf = await import('@tensorflow/tfjs')
    await tf.ready()
    const scMod = await import('@tensorflow-models/speech-commands')
    // speech-commands 0.5.x 只接受 http(s):// 或 file:// 开头的 URL，
    // 相对路径会报 "Unsupported URL scheme"，因此拼成绝对 URL
    const origin = window.location.origin
    const scBase = isRemoteDeploy() ? REMOTE_TFJS.speechCommandsBase : `${origin}/model/tfjs/speech-commands`
    recognizer = scMod.create(
      'BROWSER_FFT',
      null, // 提供自定义 modelURL 时 vocabulary 必须为 null（词汇表在 metadata.json 中）
      `${scBase}/model.json`,
      `${scBase}/metadata.json`
    )
    await recognizer.ensureModelLoaded()
    transfer = recognizer.createTransfer('tm-audio')
    loadProgress.value = ''
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}

// 连续采集：循环调用 collectExample（每次约 1 秒）
async function startTraining(idx: number) {
  await loadModels()
  if (!transfer) return
  collecting = true
  collectClass = idx
  recording.value = true

  const collectLoop = async () => {
    if (!collecting || collectClass !== idx) return
    try {
      await transfer.collectExample(classNames.value[idx])
      sampleCounts.value[idx] = transfer.countExamples()?.[classNames.value[idx]] || 0
    } catch (e: any) {
      error.value = humanError(e, t)
      collecting = false
    }
    if (collecting && collectClass === idx) {
      // 短暂间隔后继续采集
      setTimeout(collectLoop, 50)
    }
  }
  collectLoop()
}

function stopTraining() {
  collecting = false
  collectClass = -1
  recording.value = false
}

function clearClass(idx: number) {
  if (!transfer) return
  // speech-commands transfer 模型没有 clearClass，需清空所有并重建
  // 简化处理：清除该类别样本需重建 transfer
  const counts = transfer.countExamples() || {}
  const name = classNames.value[idx]
  if (counts[name]) {
    // 移除该类别的所有样本
    try {
      transfer.clearExamples(name)
      sampleCounts.value[idx] = 0
    } catch { /* ignore */ }
  }
  trained.value = false
  stopPredict()
  predictions.value = []
  topClass.value = ''
}

function clearAll() {
  if (!transfer) return
  try {
    transfer.clearExamples()
  } catch { /* ignore */ }
  sampleCounts.value = [0, 0, 0]
  trained.value = false
  stopPredict()
  predictions.value = []
  topClass.value = ''
}

async function trainModel() {
  if (!transfer) return
  const total = sampleCounts.value.reduce((a, b) => a + b, 0)
  if (total === 0) return
  training.value = true
  error.value = null
  stopPredict()
  try {
    await transfer.train({
      epochs: Number(params.value.epochs),
      callback: {
        onEpochEnd: async (epoch: number, logs: any) => {
          loadProgress.value = `Epoch ${epoch + 1} · loss=${logs.loss?.toFixed(4) ?? '?'}`
        }
      }
    })
    trained.value = true
    loadProgress.value = ''
    startPredict()
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    training.value = false
  }
}

async function startPredict() {
  if (!transfer || !trained.value) return
  predicting.value = true
  try {
    await transfer.listen((result: any) => {
      const scores = result.scores
      const labels = transfer.wordLabels()
      if (!labels || !scores) return
      predictions.value = labels.map((name: string, i: number) => ({ name, score: scores[i] ?? 0 }))
        .sort((a: any, b: any) => b.score - a.score)
      topClass.value = predictions.value[0]?.score >= Number(params.value.probabilityThreshold)
        ? predictions.value[0]?.name
        : ''
    }, {
      overlapFactor: Number(params.value.overlapFactor),
      invokeCallbackOnNoiseAndUnknown: true,
      probabilityThreshold: 0
    })
  } catch (e: any) {
    error.value = humanError(e, t)
  }
}

function stopPredict() {
  if (predicting.value && transfer) {
    try { transfer.stopListening() } catch { /* ignore */ }
  }
  predicting.value = false
}

function renameClass(idx: number, name: string) {
  const oldName = classNames.value[idx]
  if (oldName === name) return
  if (transfer && sampleCounts.value[idx] > 0) {
    // speech-commands 不支持重命名，需先清除旧标签
    error.value = t('ml.renameAfterSamples')
    return
  }
  classNames.value[idx] = name
  trained.value = false
}

onBeforeUnmount(() => {
  stopTraining()
  stopPredict()
  try { if (recognizer) recognizer.stopStreaming?.() } catch { /* ignore */ }
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <!-- 控件 -->
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        icon="i-lucide-brain"
        :label="t('ml.loadModel')"
        color="primary"
        :loading="loading"
        :disabled="recognizer !== null"
        @click="loadModels"
      />
      <UButton
        icon="i-lucide-play"
        :label="t('ml.trainModel')"
        color="primary"
        variant="subtle"
        :loading="training"
        :disabled="!recognizer || sampleCounts.every(c => c === 0) || training"
        @click="trainModel"
      />
      <UButton
        v-if="predicting"
        icon="i-lucide-square"
        :label="t('mp.stop')"
        color="error"
        variant="subtle"
        @click="stopPredict"
      />
      <UButton
        v-else
        icon="i-lucide-play"
        :label="t('ml.predict')"
        color="neutral"
        variant="subtle"
        :disabled="!trained"
        @click="startPredict"
      />
      <UButton
        icon="i-lucide-trash-2"
        :label="t('ml.clearAll')"
        color="neutral"
        variant="ghost"
        :disabled="!sampleCounts.some(c => c > 0)"
        @click="clearAll"
      />
      <span v-if="recording" class="flex items-center gap-1 text-sm text-error">
        <span class="size-2 rounded-full bg-error animate-pulse" />
        {{ t('ml.recording') }}
      </span>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />
    <UAlert v-if="(loading || training) && loadProgress" color="primary" variant="subtle" :title="loadProgress" />

    <!-- 预测状态 -->
    <UCard>
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-muted">{{ t('demo.result') }}</span>
        <template v-if="topClass">
          <span class="text-xl font-bold text-highlighted">{{ topClass }}</span>
        </template>
        <span v-else-if="predicting" class="text-sm text-muted">{{ t('ml.listening') }}</span>
        <span v-else-if="trained" class="text-sm text-muted">{{ t('ml.clickPredict') }}</span>
        <span v-else class="text-sm text-muted">{{ t('ml.trainFirst') }}</span>
      </div>
    </UCard>

    <!-- 训练区：3 个类别 -->
    <div class="grid sm:grid-cols-3 gap-4">
      <UCard
        v-for="(name, i) in classNames"
        :key="i"
        :class="collectClass === i ? 'ring-2 ring-primary' : ''"
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
          <div class="text-3xl font-bold tabular-nums text-highlighted">{{ sampleCounts[i] }}</div>
          <p class="text-xs text-muted">{{ t('ml.samples') }}</p>
          <div class="flex gap-2">
            <UButton
              :label="collectClass === i ? t('ml.recording') : t('ml.record')"
              :color="collectClass === i ? 'error' : 'primary'"
              :variant="collectClass === i ? 'solid' : 'subtle'"
              size="sm"
              :disabled="!recognizer || training || predicting"
              block
              @mousedown="startTraining(i)"
              @mouseup="stopTraining"
              @mouseleave="stopTraining"
              @touchstart.prevent="startTraining(i)"
              @touchend.prevent="stopTraining"
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
        </div>
      </UCard>
    </div>

    <!-- 可调参数 -->
    <DemoParams v-model="params" :specs="specs" :running="training || predicting || recording" />

    <!-- 预测结果条 -->
    <UCard v-if="predictions.length">
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-terminal" class="size-4" />
          {{ t('demo.result') }}
        </div>
      </template>
      <div class="space-y-3">
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
  </MediaDemoShell>
</template>
