<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
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

// 3 个类别（可改名）
const classNames = ref(['Class A', 'Class B', 'Class C'])
const sampleCounts = ref([0, 0, 0])
// 预测结果
const predictions = ref<Array<{ name: string, score: number }>>([])
const topClass = ref<string>('')
const inferenceTime = ref(0)

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
let classifier: any = null
let stream: MediaStream | null = null
let rafId: number | null = null
let captureTimer: number | null = null
let trainingClass = -1 // 当前正在训练的类别索引

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
    error.value = e?.message || String(e)
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
    error.value = e?.message || String(e)
  }
}

function stopWebcam() {
  stopPredicting()
  running.value = false
  if (trainingClass >= 0) trainingClass = -1
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null }
  if (videoRef.value) videoRef.value.srcObject = null
  predictions.value = []
  topClass.value = ''
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
  if (!video || !mobilenet || !classifier || classifier.getNumClasses() === 0) return
  if (trainingClass >= 0) return // 训练中不预测
  const ts = performance.now()
  try {
    const logits = mobilenet.infer(video, true)
    const res = await classifier.predictClass(logits, Number(params.value.topK))
    logits.dispose()
    inferenceTime.value = Math.round(performance.now() - ts)
    // 构造预测列表
    const confidences = res.confidences
    const label = res.label
    topClass.value = label
    predictions.value = classNames.value
      .map((name, i) => ({ name, score: confidences[name] ?? confidences[i] ?? 0 }))
      .sort((a, b) => b.score - a.score)
  } catch (e: any) {
    error.value = e?.message || String(e)
  }
}

// 按住训练：定时采集样本
async function startTraining(idx: number) {
  if (!running.value || !mobilenet) return
  await loadModels()
  if (!mobilenet) return
  trainingClass = idx
  stopPredicting()
  const capture = async () => {
    const video = videoRef.value
    if (!video) return
    try {
      const logits = mobilenet.infer(video, true)
      classifier.addExample(logits, classNames.value[idx])
      sampleCounts.value[idx] = classifier.getClassExampleCount()[classNames.value[idx]] || 0
    } catch (e: any) {
      error.value = e?.message || String(e)
    }
  }
  await capture()
  captureTimer = window.setInterval(capture, Number(params.value.captureInterval))
}

function stopTraining() {
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null }
  if (trainingClass >= 0) {
    trainingClass = -1
    if (running.value) startPredicting()
  }
}

function clearClass(idx: number) {
  if (!classifier) return
  classifier.clearClass(classNames.value[idx])
  sampleCounts.value[idx] = 0
  predictions.value = []
  topClass.value = ''
}

function clearAll() {
  if (!classifier) return
  classifier.clearAllClasses()
  sampleCounts.value = [0, 0, 0]
  predictions.value = []
  topClass.value = ''
}

function renameClass(idx: number, name: string) {
  // 若已有样本，需在 KNN 中迁移标签
  const oldName = classNames.value[idx]
  if (classifier && oldName !== name) {
    const count = classifier.getClassExampleCount()?.[oldName] || 0
    if (count > 0) {
      // 取出旧样本，以新标签重新加入
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
        :disabled="!sampleCounts.some(c => c > 0)"
        @click="clearAll"
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
    <div class="grid sm:grid-cols-3 gap-4">
      <UCard
        v-for="(name, i) in classNames"
        :key="i"
        :class="trainingClass === i ? 'ring-2 ring-primary' : ''"
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
              :label="trainingClass === i ? t('ml.recording') : t('ml.train')"
              :color="trainingClass === i ? 'error' : 'primary'"
              :variant="trainingClass === i ? 'solid' : 'subtle'"
              size="sm"
              :disabled="!running"
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
    <DemoParams v-model="params" :specs="specs" :running="trainingClass >= 0" />

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
