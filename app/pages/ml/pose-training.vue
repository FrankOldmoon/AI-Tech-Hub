<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import { mediapipeWasm, mediapipeModels } from '~/utils/mediapipe'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'pose-training')!)

const videoRef = ref<HTMLVideoElement>()
const canvasRef = ref<HTMLCanvasElement>()
const loading = ref(false)
const error = ref<string | null>(null)
const running = ref(false)
const predicting = ref(false)
const loadProgress = ref('')

// 3 个类别（可改名）
const classNames = ref(['Class A', 'Class B', 'Class C'])
const sampleCounts = ref([0, 0, 0])
// 预测结果
const predictions = ref<Array<{ name: string, score: number }>>([])
const topClass = ref('')
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

let poseLandmarker: any = null
let classifier: any = null
let stream: MediaStream | null = null
let rafId: number | null = null
let captureTimer: number | null = null
let trainingClass = -1 // 当前正在训练的分类下标
let lastVideoTime = -1

async function loadModels() {
  if (poseLandmarker && classifier) return
  loading.value = true
  error.value = null
  loadProgress.value = t('ml.poseTraining.loadingPose')
  try {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: mediapipeModels.poseLandmarker, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1
    })
    const knnMod = await import('@tensorflow-models/knn-classifier')
    classifier = knnMod.create()
    loadProgress.value = ''
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

/**
 * 姿态特征：以髋部中心为原点、肩宽为尺度做相对归一化，
 * 使同一动作在不同距离/身位下特征一致（33 个关键点 * x/y = 66 维）。
 */
function extractFeature(landmarks: Array<{ x: number, y: number, z: number }>): number[] | null {
  if (!landmarks || landmarks.length < 33) return null
  const lhip = landmarks[23]
  const rhip = landmarks[24]
  const lsh = landmarks[11]
  const rsh = landmarks[12]
  if (!lhip || !rhip || !lsh || !rsh) return null
  const cx = (lhip.x + rhip.x) / 2
  const cy = (lhip.y + rhip.y) / 2
  const scale = Math.hypot(lsh.x - rsh.x, lsh.y - rsh.y)
  if (!scale || scale < 1e-6) return null
  const feat: number[] = []
  for (const p of landmarks) {
    feat.push((p.x - cx) / scale, (p.y - cy) / scale)
  }
  return feat
}

function drawSkeleton(ctx: CanvasRenderingContext2D, landmarks: Array<{ x: number, y: number }>) {
  if (!landmarks?.length) return
  const connections = PoseLandmarkerConnections()
  ctx.strokeStyle = '#00DC82'
  ctx.lineWidth = 3
  for (const [a, b] of connections) {
    if (landmarks[a] && landmarks[b]) {
      ctx.beginPath()
      ctx.moveTo(landmarks[a].x * ctx.canvas.width, landmarks[a].y * ctx.canvas.height)
      ctx.lineTo(landmarks[b].x * ctx.canvas.width, landmarks[b].y * ctx.canvas.height)
      ctx.stroke()
    }
  }
  ctx.fillStyle = '#FF3B30'
  for (const p of landmarks) {
    ctx.beginPath()
    ctx.arc(p.x * ctx.canvas.width, p.y * ctx.canvas.height, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

function PoseLandmarkerConnections(): Array<[number, number]> {
  // MediaPipe PoseLandmarker.POSE_CONNECTIONS 静态常量
  return [
    [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
    [9, 10], [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
    [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
    [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32]
  ]
}

async function startWebcam() {
  await loadModels()
  if (!poseLandmarker) return
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
  if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null }
  if (videoRef.value) videoRef.value.srcObject = null
  predictions.value = []
  topClass.value = ''
  const canvas = canvasRef.value
  if (canvas) {
    const ctx = canvas.getContext('2d')
    ctx?.clearRect(0, 0, canvas.width, canvas.height)
  }
}

// 实时预测循环
function startPredicting() {
  predicting.value = true
  const loop = () => {
    if (!predicting.value) return
    detect()
    rafId = requestAnimationFrame(loop)
  }
  loop()
}

function stopPredicting() {
  predicting.value = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
}

async function detect() {
  const video = videoRef.value
  if (!video || !poseLandmarker || !classifier || video.readyState < 2) return
  if (video.currentTime === lastVideoTime) return
  lastVideoTime = video.currentTime
  const ts = performance.now()
  try {
    const result = poseLandmarker.detectForVideo(video, ts)
    const landmarks = result.poseLandmarks?.[0]
    // 绘制骨架
    const canvas = canvasRef.value
    if (canvas && landmarks) {
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawSkeleton(ctx, landmarks)
    }
    if (trainingClass >= 0 || classifier.getNumClasses() === 0) return
    const feat = extractFeature(landmarks)
    if (!feat) return
    const t0 = performance.now()
    const tf = await import('@tensorflow/tfjs')
    const tensor = tf.tensor2d([feat], [1, feat.length])
    const res = await classifier.predictClass(tensor, Number(params.value.topK))
    tensor.dispose()
    inferenceTime.value = Math.round(performance.now() - t0)
    const confidences = res.confidences
    const label = res.label
    topClass.value = (confidences[label] ?? 0) >= Number(params.value.probabilityThreshold) ? label : ''
    predictions.value = classNames.value
      .map((name, i) => ({ name, score: confidences[name] ?? confidences[i] ?? 0 }))
      .sort((a, b) => b.score - a.score)
  } catch (e: any) {
    error.value = e?.message || String(e)
  }
}

// 按住训练：定时采集姿态样本
async function startTraining(idx: number) {
  if (!running.value || !poseLandmarker) return
  trainingClass = idx
  const capture = async () => {
    const video = videoRef.value
    if (!video || !poseLandmarker || !classifier) return
    const result = poseLandmarker.detectForVideo(video, performance.now())
    const landmarks = result.poseLandmarks?.[0]
    if (!landmarks) return
    const feat = extractFeature(landmarks)
    if (!feat) return
    try {
      const tf = await import('@tensorflow/tfjs')
      const tensor = tf.tensor2d([feat], [1, feat.length])
      classifier.addExample(tensor, classNames.value[idx])
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
  if (trainingClass >= 0) trainingClass = -1
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

    <!-- 摄像头预览 + 骨架 -->
    <div class="relative w-full max-w-3xl mx-auto rounded-xl overflow-hidden bg-elevated/60 aspect-video flex items-center justify-center">
      <video ref="videoRef" class="w-full h-full object-contain" style="transform: scaleX(-1)" playsinline muted />
      <canvas
        ref="canvasRef"
        class="absolute inset-0 w-full h-full object-contain"
        style="transform: scaleX(-1)"
      />
      <div v-if="!running" class="absolute inset-0 flex items-center justify-center">
        <UIcon name="i-lucide-person-standing" class="size-10 text-muted" />
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
