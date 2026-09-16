<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import type { KnnClassifierLike } from '~/composables/useKnnTrainer'
import { humanError, mediaError } from '~/utils/errors'
import { paramDefaults } from '~/utils/params'
import { isRemoteDeploy, REMOTE_TFJS } from '~/utils/remote-models'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'image-training')!)

const videoRef = ref<HTMLVideoElement>()
const loading = ref(false) // 模型加载
const error = ref<string | null>(null)
const running = ref(false) // 摄像头开启
const predicting = ref(false) // 预测中
const loadProgress = ref('')
const inferenceTime = ref(0)

// 类别名 / 样本数 / 预测结果 / 重命名迁移 / 清空 由共享层管理（与姿态、文本训练页同源）
const {
  classNames, sampleCounts, predictions, topClass,
  classNameAt, totalSamples, syncCount, resetResults, applyPrediction,
  renameClass, clearClass, clearAll
} = useKnnTrainer()

// 可调参数
const specs = computed<ParamSpec[]>(() => [
  {
    key: 'topK',
    label: t('ml.topK'),
    type: 'slider',
    default: 10,
    min: 1,
    max: 50,
    step: 1,
    help: t('ml.topKHelp')
  },
  {
    key: 'captureInterval',
    label: t('ml.captureInterval'),
    type: 'slider',
    default: 100,
    min: 50,
    max: 500,
    step: 50,
    help: t('ml.captureIntervalHelp')
  }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

let mobilenet: any = null
let classifier: KnnClassifierLike | null = null
let stream: MediaStream | null = null
let rafId: number | null = null
let captureTimer: number | null = null
// 当前正在训练的类别索引（-1 = 未在训练）。用 ref：模板要据此高亮对应卡片
const trainingClass = ref(-1)

async function loadModels() {
  if (mobilenet && classifier) return
  loading.value = true
  error.value = null
  loadProgress.value = t('ml.loadingMobilenet')
  try {
    const tf = await import('@tensorflow/tfjs')
    await tf.ready()
    const mobilenetMod = await import('@tensorflow-models/mobilenet')
    const knnMod = await import('@tensorflow-models/knn-classifier')
    // 云端无本地模型，使用 tfhub.dev 远程模型（带 CORS）
    const modelUrl = isRemoteDeploy() ? REMOTE_TFJS.mobilenet : '/model/tfjs/mobilenet/model.json'
    mobilenet = await mobilenetMod.load({ version: 2, alpha: 1.0, modelUrl })
    classifier = knnMod.create()
    loadProgress.value = ''
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}

async function startWebcam() {
  await loadModels()
  if (!mobilenet) return
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
    const video = videoRef.value!
    video.srcObject = stream
    await video.play()
    running.value = true
    startPredicting()
  } catch (e: any) {
    error.value = mediaError(e, t)
  }
}

function stopWebcam() {
  stopPredicting()
  running.value = false
  trainingClass.value = -1
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null }
  if (videoRef.value) videoRef.value.srcObject = null
  resetResults()
}

// 实时预测循环
function startPredicting() {
  predicting.value = true
  const loop = () => {
    if (!predicting.value) return
    predict()
    rafId = requestAnimationFrame(loop)
  }
  loop()
}

function stopPredicting() {
  predicting.value = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
}

async function predict() {
  const video = videoRef.value
  const clf = classifier
  if (!video || !mobilenet || !clf || clf.getNumClasses() === 0) return
  if (trainingClass.value >= 0) return // 训练中不预测
  const ts = performance.now()
  try {
    const logits = mobilenet.infer(video, true)
    const res = await clf.predictClass(logits, Number(params.value.topK))
    logits.dispose()
    inferenceTime.value = Math.round(performance.now() - ts)
    // 本页不设置信度阈值：传 0 表示始终显示 top-1
    applyPrediction(res, 0)
  } catch (e: any) {
    error.value = humanError(e, t)
  }
}

// 按住训练：定时采集样本
async function startTraining(idx: number) {
  if (!running.value || !mobilenet) return
  await loadModels()
  if (!mobilenet) return
  trainingClass.value = idx
  stopPredicting()
  const capture = async () => {
    const video = videoRef.value
    const clf = classifier
    if (!video || !clf) return
    try {
      const logits = mobilenet.infer(video, true)
      clf.addExample(logits, classNameAt(idx))
      syncCount(idx, clf)
    } catch (e: any) {
      error.value = humanError(e, t)
    }
  }
  await capture()
  captureTimer = window.setInterval(capture, Number(params.value.captureInterval))
}

function stopTraining() {
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null }
  if (trainingClass.value >= 0) {
    trainingClass.value = -1
    if (running.value) startPredicting()
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

onBeforeUnmount(() => stopWebcam())
</script>

<template>
  <MediaDemoShell :demo="demo">
    <!-- 控件 -->
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        v-if="!running"
        icon="i-lucide-video"
        :label="t('mp.webcam')"
        color="primary"
        :loading="loading"
        @click="startWebcam"
      />
      <UButton
        v-else
        icon="i-lucide-square"
        :label="t('mp.stop')"
        color="error"
        variant="subtle"
        @click="stopWebcam"
      />
      <UButton
        icon="i-lucide-trash-2"
        :label="t('ml.clearAll')"
        color="neutral"
        variant="subtle"
        :disabled="totalSamples === 0"
        @click="onClearAll"
      />
      <span v-if="inferenceTime" class="text-sm text-muted ms-2">{{ inferenceTime }} ms</span>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />
    <UAlert v-if="loading && loadProgress" color="primary" variant="subtle" :title="loadProgress" />

    <!-- 摄像头预览 -->
    <div class="relative w-full max-w-3xl mx-auto rounded-xl overflow-hidden bg-elevated/60 aspect-video flex items-center justify-center">
      <video ref="videoRef" class="w-full h-full object-contain" style="transform: scaleX(-1)" playsinline muted />
      <div v-if="!running" class="absolute inset-0 flex items-center justify-center">
        <UIcon name="i-lucide-camera-off" class="size-10 text-muted" />
      </div>
      <!-- 预测结果叠加 -->
      <div v-if="topClass && predicting" class="absolute bottom-3 left-3 right-3 flex items-center gap-2">
        <div class="px-3 py-1.5 rounded-lg bg-black/60 text-white text-sm font-medium backdrop-blur">
          {{ topClass }}
        </div>
      </div>
    </div>

    <!-- 训练区：3 个类别 -->
    <ClassTrainerGrid
      :class-names="classNames"
      :sample-counts="sampleCounts"
      :active-index="trainingClass"
      @rename="onRenameClass"
      @clear="onClearClass"
    >
      <template #collect="{ index }">
        <UButton
          :label="trainingClass === index ? t('ml.recording') : t('ml.train')"
          :color="trainingClass === index ? 'error' : 'primary'"
          :variant="trainingClass === index ? 'solid' : 'subtle'"
          size="sm"
          :disabled="!running"
          block
          @mousedown="startTraining(index)"
          @mouseup="stopTraining"
          @mouseleave="stopTraining"
          @touchstart.prevent="startTraining(index)"
          @touchend.prevent="stopTraining"
        />
      </template>
    </ClassTrainerGrid>

    <!-- 可调参数 -->
    <DemoParams v-model="params" :specs="specs" :running="trainingClass >= 0" />

    <!-- 预测结果条 -->
    <UCard v-if="predictions.length">
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-terminal" class="size-4" />
          {{ t('demo.result') }}
        </div>
      </template>
      <PredictionBars :predictions="predictions" :top-class="topClass" />
    </UCard>
  </MediaDemoShell>
</template>
