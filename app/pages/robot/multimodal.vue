<script setup lang="ts">
/**
 * MultimodalDrone 多模态无人机指令台
 *
 * 一个最简易的无人机飞行场景（停机坪 + 四旋翼 + 起飞/悬停/降落三态），
 * 三种控制通道全部指向同一组指令（takeoff / land）：
 *   1. 屏幕按钮     —— 直接调用引擎 command；
 *   2. 麦克风语音   —— 复用 useSpeechRecognition（Web Speech API），关键词匹配；
 *   3. 摄像头手势   —— 复用 MediaPipe GestureRecognizer（vision 分类同款模型），👍=起飞 🖐=降落。
 *
 * 教学完成条件（4 项，权重合计 1）：
 *   1. 用屏幕按钮完成一次起飞（0.2）
 *   2. 用语音完成一次起飞（0.25）
 *   3. 用手势完成一次起飞（0.25）
 *   4. 完成一次「起飞 → 降落」完整飞行（0.3，任意通道组合）
 */
import { createMultimodalDroneSim, type CmdSource, type MultimodalState } from '~/utils/multimodal/engine'
import type { GestureRecognizer, GestureRecognizerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { reportCorrectRate } from '~/utils/embed-report'
import { pickText, type LocalizedText } from '~/utils/localized'

const APP_ID = 'robot/multimodal'

const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'multimodal')!)
const { locale } = useI18n()
const lang = computed(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: LocalizedText) => pickText(o, lang.value)

/* ---------- 引擎 ---------- */
const stageEl = ref<HTMLElement | null>(null)
const errorMsg = ref('')
let handle: ReturnType<typeof createMultimodalDroneSim> | null = null

const state = ref<MultimodalState>({ phase: 'idle', altitude: 0, source: null })

const PHASE_META: Record<string, { label: LocalizedText, color: string }> = {
  idle: { label: { zh: '待命', en: 'Standby' }, color: '#ff5470' },
  takeoff: { label: { zh: '起飞中', en: 'Taking off' }, color: '#ffcc4d' },
  hover: { label: { zh: '悬停', en: 'Hovering' }, color: '#39e6a0' },
  land: { label: { zh: '降落中', en: 'Landing' }, color: '#ff9f43' }
}
const phaseLabel = computed(() => pick(PHASE_META[state.value.phase]!.label))
const phaseColor = computed(() => PHASE_META[state.value.phase]!.color)

const SOURCE_LABEL: Record<CmdSource, LocalizedText> = {
  button: { zh: '屏幕按钮', en: 'Button' },
  voice: { zh: '语音', en: 'Voice' },
  gesture: { zh: '手势', en: 'Gesture' }
}

/* ---------- 指令日志 ---------- */
const logs = ref<Array<{ id: number, text: string }>>([])
let logId = 0
function addLog(text: string) {
  logs.value = [...logs.value.slice(-7), { id: ++logId, text }]
}

/* ---------- 教学进度（上报用） ---------- */
const btnTakeoff = ref(false)
const voiceTakeoff = ref(false)
const gestureTakeoff = ref(false)
const landed = ref(false)

const tasks = computed(() => [
  {
    key: 'btn',
    label: { zh: '屏幕按钮起飞', en: 'Take off via button' } as LocalizedText,
    done: btnTakeoff.value ? 1 : 0,
    total: 1,
    weight: 0.2
  },
  {
    key: 'voice',
    label: { zh: '语音口令起飞', en: 'Take off via voice' } as LocalizedText,
    done: voiceTakeoff.value ? 1 : 0,
    total: 1,
    weight: 0.25
  },
  {
    key: 'gesture',
    label: { zh: '手势指令起飞', en: 'Take off via gesture' } as LocalizedText,
    done: gestureTakeoff.value ? 1 : 0,
    total: 1,
    weight: 0.25
  },
  {
    key: 'flight',
    label: { zh: '完成一次起飞→降落', en: 'Complete a takeoff→landing' } as LocalizedText,
    done: landed.value ? 1 : 0,
    total: 1,
    weight: 0.3
  }
])

const rate = computed(() => tasks.value.reduce((acc, t) => acc + t.weight * Math.min(1, t.done / t.total), 0))
const finished = computed(() => rate.value >= 0.999)

/** 上报契约：parent.postMessage({ type:'correct_rate', rate, ... })，详见 utils/embed-report.ts */
watch([rate, finished], () => {
  reportCorrectRate({
    app: APP_ID,
    rate: rate.value,
    finished: finished.value,
    locale: locale.value,
    extra: {
      btnTakeoff: btnTakeoff.value,
      voiceTakeoff: voiceTakeoff.value,
      gestureTakeoff: gestureTakeoff.value,
      landed: landed.value
    }
  })
})

let prevPhase = 'idle'
function onEngineState(s: MultimodalState) {
  state.value = s
  // 降落相位走完 → 记一次完整飞行
  if (prevPhase === 'land' && s.phase === 'idle' && !landed.value) {
    landed.value = true
    addLog(pick({ zh: '✅ 已完成一次完整飞行', en: '✅ Full flight completed' }))
  }
  prevPhase = s.phase
}

/* ---------- 发送指令（三通道共用出口） ---------- */
function sendCommand(cmd: 'takeoff' | 'land', source: CmdSource) {
  const ok = handle?.command(cmd, source)
  if (!ok) {
    addLog(pick(cmd === 'takeoff'
      ? { zh: '⚠️ 无法起飞：不在待命状态', en: '⚠️ Cannot take off: not on standby' }
      : { zh: '⚠️ 无法降落：当前在地面', en: '⚠️ Cannot land: already on ground' }))
    return
  }
  if (cmd === 'takeoff') {
    if (source === 'button') btnTakeoff.value = true
    else if (source === 'voice') voiceTakeoff.value = true
    else gestureTakeoff.value = true
  }
  const cmdText = cmd === 'takeoff'
    ? pick({ zh: '起飞', en: 'Take off' })
    : pick({ zh: '降落', en: 'Land' })
  addLog(pick({ zh: `📡 ${SOURCE_LABEL[source].zh}指令：${cmdText}`, en: `📡 ${SOURCE_LABEL[source].en} command: ${cmdText}` }))
}

/* ---------- 通道 1：屏幕按钮（直接 sendCommand） ---------- */

/* ---------- 通道 2：语音（Web Speech API） ---------- */
const voiceListening = ref(false)
const voiceText = ref('')
let wantListening = false
let voiceFatal = false
let lastMatched = ''
/** composable 的 onFinal 给的是跨事件累积文本，这里记已上报长度，只把新增片段送进解释器 */
let reportedFinal = 0

const { supported: voiceSupported, start: startRecognition, stop: stopRecognition } = useSpeechRecognition()

const VOICE_CMDS = computed<Record<string, 'takeoff' | 'land'>>(() => ({
  '起飞': 'takeoff', '升空': 'takeoff', '起飞吧': 'takeoff',
  '降落': 'land', '着陆': 'land', '降落吧': 'land',
  'takeoff': 'takeoff', 'take off': 'takeoff', 'launch': 'takeoff', 'lift off': 'takeoff', 'up': 'takeoff',
  'land': 'land', 'landing': 'land', 'touch down': 'land', 'down': 'land'
}))

function interpret(text: string): 'takeoff' | 'land' | null {
  // 归一化：去空格与标点后做包含匹配（中文无空格，英文含空格口令先归一掉）
  const norm = text.toLowerCase().replace(/[\s，。、,.!?！？]/g, '')
  for (const key of Object.keys(VOICE_CMDS.value)) {
    if (norm.includes(key.replace(/\s/g, ''))) return VOICE_CMDS.value[key]!
  }
  return null
}

function handleVoiceText(text: string) {
  voiceText.value = text.trim()
  const cmd = interpret(text)
  if (cmd && text.trim() !== lastMatched) {
    sendCommand(cmd, 'voice')
    lastMatched = text.trim()
    setTimeout(() => {
      lastMatched = ''
    }, 800)
  }
}

/** 这几类错误重启也没用（权限被拒 / 服务不可用 / 采不到音） */
const FATAL_ERRORS = ['not-allowed', 'service-not-allowed', 'audio-capture']

function beginVoice() {
  wantListening = true
  voiceFatal = false
  voiceListening.value = true
  reportedFinal = 0
  startRecognition({
    lang: lang.value === 'zh' ? 'zh-CN' : 'en-US',
    continuous: true,
    interimResults: true,
    onFinal: (t) => {
      const inc = t.slice(reportedFinal)
      reportedFinal = t.length
      handleVoiceText(inc)
    },
    onInterim: (t) => { if (t) handleVoiceText(t) },
    onError: (err) => {
      if (FATAL_ERRORS.includes(err)) {
        voiceFatal = true
        wantListening = false
        voiceListening.value = false
        addLog(pick({ zh: '🎙️ 麦克风不可用，请检查权限', en: '🎙️ Mic unavailable, check permission' }))
      }
    },
    onEnd: () => {
      // 浏览器自行结束（continuous 下偶发）时自动重启，致命错误除外
      if (wantListening && !voiceFatal) beginVoice()
      else voiceListening.value = false
    }
  })
}

function stopVoice() {
  wantListening = false
  voiceListening.value = false
  voiceText.value = ''
  stopRecognition()
}

/* ---------- 通道 3：手势（MediaPipe GestureRecognizer） ---------- */
const gestureLoading = ref(false)
const gestureRunning = ref(false)
const gestureError = ref('')
const gestureName = ref('')
let recognizer: GestureRecognizer | null = null
let gestureStream: MediaStream | null = null
let gestureRaf = 0
let lastVideoTime = -1
let stableGesture = ''
let stableCount = 0
let lastFiredAt = 0

const videoEl = ref<HTMLVideoElement | null>(null)
const gestureCanvasEl = ref<HTMLCanvasElement | null>(null)

/** MediaPipe 手势 → 指令（👍 起飞 / 🖐 降落），其余手势仅展示 */
const GESTURE_CMD: Record<string, 'takeoff' | 'land' | null> = {
  Thumb_Up: 'takeoff',
  Open_Palm: 'land',
  Closed_Fist: null,
  Pointing_Up: null,
  Victory: null,
  ILoveYou: null,
  None: null
}

const GESTURE_LABEL: Record<string, LocalizedText> = {
  Thumb_Up: { zh: '👍 竖起拇指 → 起飞', en: '👍 Thumb up → take off' },
  Open_Palm: { zh: '🖐 张开手掌 → 降落', en: '🖐 Open palm → land' },
  Closed_Fist: { zh: '✊ 握拳（无动作）', en: '✊ Fist (no action)' },
  Pointing_Up: { zh: '☝️ 指向上（无动作）', en: '☝️ Pointing up (no action)' },
  Victory: { zh: '✌️ 胜利手（无动作）', en: '✌️ Victory (no action)' },
  ILoveYou: { zh: '🤟 ILoveYou（无动作）', en: '🤟 ILoveYou (no action)' },
  None: { zh: '— 未识别到手势', en: '— No gesture detected' }
}

/** 手势需连续出现 ≥ 6 帧才触发；触发后冷却 1.5s，防止手抖连发 */
const STABLE_FRAMES = 6
const COOLDOWN_MS = 1500

function fireGesture(raw: string) {
  gestureName.value = raw
  const cmd = GESTURE_CMD[raw] ?? null
  const now = Date.now()
  if (!cmd || now - lastFiredAt < COOLDOWN_MS) return
  lastFiredAt = now
  sendCommand(cmd, 'gesture')
}

// MediaPipe 手部 21 点骨架连接（静态常量，硬编码避免额外依赖 HandLandmarker 导出）
const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
]

async function startGesture() {
  if (gestureLoading.value || gestureRunning.value) return
  gestureLoading.value = true
  gestureError.value = ''
  try {
    if (!recognizer) {
      const { FilesetResolver, GestureRecognizer } = await import('@mediapipe/tasks-vision')
      const [{ mediapipeWasm, mediapipeModels }] = await Promise.all([import('~/utils/mediapipe')])
      const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
      recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: mediapipeModels.gestureRecognizer, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1
      })
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } })
    gestureStream = stream
    const video = videoEl.value!
    video.srcObject = stream
    await video.play()
    gestureRunning.value = true
    addLog(pick({ zh: '🖐 手势通道已开启', en: '🖐 Gesture channel on' }))
    loopGesture()
  } catch (err) {
    gestureError.value = err instanceof Error ? err.message : String(err)
    stopGesture()
  } finally {
    gestureLoading.value = false
  }
}

function loopGesture() {
  gestureRaf = requestAnimationFrame(loopGesture)
  const video = videoEl.value
  const canvas = gestureCanvasEl.value
  if (!video || !canvas || video.readyState < 2) return
  const ctx = canvas.getContext('2d')!
  if (canvas.width !== video.videoWidth) {
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
  }
  // 视频帧镜像绘制（自拍习惯），关键点坐标同步镜像
  ctx.save()
  ctx.translate(canvas.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  ctx.restore()

  if (video.currentTime === lastVideoTime) return
  lastVideoTime = video.currentTime
  if (!recognizer) return
  const result: GestureRecognizerResult = recognizer.recognizeForVideo(video, performance.now())
  const lm: NormalizedLandmark[] | undefined = result?.landmarks?.[0]
  if (!lm) {
    stableGesture = ''
    stableCount = 0
    gestureName.value = 'None'
    return
  }
  drawHand(ctx, lm)
  const raw: string = result.gestures?.[0]?.[0]?.categoryName ?? 'None'
  // 连续帧稳定后才触发指令
  if (raw === stableGesture) stableCount++
  else {
    stableGesture = raw
    stableCount = 1
  }
  if (stableCount >= STABLE_FRAMES) fireGesture(raw)
  else gestureName.value = raw
}

function drawHand(ctx: CanvasRenderingContext2D, lm: Array<{ x: number, y: number }>) {
  ctx.strokeStyle = '#39e6a0'
  ctx.lineWidth = 3
  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = lm[a]
    const pb = lm[b]
    if (!pa || !pb) continue
    ctx.beginPath()
    // 关键点与画面同为镜像坐标系：x 用 1-x
    ctx.moveTo((1 - pa.x) * ctx.canvas.width, pa.y * ctx.canvas.height)
    ctx.lineTo((1 - pb.x) * ctx.canvas.width, pb.y * ctx.canvas.height)
    ctx.stroke()
  }
  ctx.fillStyle = '#ff5470'
  for (const p of lm) {
    ctx.beginPath()
    ctx.arc((1 - p.x) * ctx.canvas.width, p.y * ctx.canvas.height, 4, 0, Math.PI * 2)
    ctx.fill()
  }
}

function stopGesture() {
  cancelAnimationFrame(gestureRaf)
  if (gestureStream) {
    gestureStream.getTracks().forEach(track => track.stop())
    gestureStream = null
  }
  if (videoEl.value) videoEl.value.srcObject = null
  const canvas = gestureCanvasEl.value
  if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  gestureRunning.value = false
  gestureName.value = ''
  stableGesture = ''
  stableCount = 0
}

const gestureLabel = computed<LocalizedText>(
  () => GESTURE_LABEL[gestureName.value || 'None'] ?? GESTURE_LABEL.None ?? { zh: '—', en: '—' }
)

/* ---------- 全屏（右上角悬浮按钮，与 robot/drone 一致） ---------- */
const rootEl = ref<HTMLElement | null>(null)
const isFullscreen = ref(false)
const fsLabel = computed(() => pick({
  zh: isFullscreen.value ? '退出全屏' : '全屏',
  en: isFullscreen.value ? 'Exit fullscreen' : 'Fullscreen'
}))

async function toggleFullscreen() {
  const el = rootEl.value
  if (!el) return
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await el.requestFullscreen()
  } catch (err) {
    console.warn('[robot/multimodal] requestFullscreen failed', err)
  }
}
function syncFullscreenState() {
  isFullscreen.value = !!document.fullscreenElement
}

/* ---------- 生命周期 ---------- */
function unmount() {
  handle?.dispose()
  handle = null
}

onMounted(() => {
  const stage = stageEl.value
  if (stage) {
    try {
      handle = createMultimodalDroneSim(stage, { onState: onEngineState })
    } catch (err) {
      errorMsg.value = err instanceof Error ? err.message : String(err)
    }
  }
  document.addEventListener('fullscreenchange', syncFullscreenState)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreenState)
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  stopVoice()
  stopGesture()
  unmount()
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div
      ref="rootEl"
      class="mm-root"
    >
      <!-- 左：3D 场景 + HUD 覆盖 -->
      <div class="stage-wrap">
        <div
          ref="stageEl"
          class="stage"
        />

        <div class="hud">
          <span
            class="phase-pill"
            :style="{ color: phaseColor, borderColor: phaseColor }"
          >
            <span
              class="dot"
              :style="{ background: phaseColor }"
            />{{ phaseLabel }}
          </span>
          <span class="alt">ALT <b>{{ state.altitude.toFixed(1) }}</b><small>m</small></span>
          <span
            v-if="state.source"
            class="src"
          >{{ pick(SOURCE_LABEL[state.source]) }}</span>
        </div>

        <!-- 右上角全屏按钮：悬浮醒目，避免被面板遮挡 -->
        <button
          class="fsbtn"
          type="button"
          :title="fsLabel"
          :aria-label="fsLabel"
          @click="toggleFullscreen"
        >
          <svg
            v-if="!isFullscreen"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M8 3v3a2 2 0 0 1-2 2H3" />
            <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
            <path d="M3 16h3a2 2 0 0 1 2 2v3" />
            <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
          </svg>
        </button>

        <!-- 指令日志 -->
        <div class="log">
          <p
            v-for="l in logs"
            :key="l.id"
          >
            {{ l.text }}
          </p>
        </div>

        <p
          v-if="errorMsg"
          class="err"
        >
          {{ errorMsg }}
        </p>
      </div>

      <!-- 右：三个控制通道 + 教学进度 -->
      <div class="side">
        <!-- 通道 1：屏幕按钮 -->
        <div class="card">
          <div class="card-head">
            <UIcon
              name="i-lucide-touchpad"
              class="size-4"
            />
            <b>{{ pick({ zh: '通道 1 · 屏幕按钮', en: 'Channel 1 · Buttons' }) }}</b>
          </div>
          <div class="btn-row">
            <button
              class="big takeoff"
              type="button"
              :disabled="state.phase !== 'idle'"
              @click="sendCommand('takeoff', 'button')"
            >
              🛫 {{ pick({ zh: '起飞', en: 'Take Off' }) }}
            </button>
            <button
              class="big land"
              type="button"
              :disabled="state.phase === 'idle'"
              @click="sendCommand('land', 'button')"
            >
              🛬 {{ pick({ zh: '降落', en: 'Land' }) }}
            </button>
          </div>
        </div>

        <!-- 通道 2：语音 -->
        <div class="card">
          <div class="card-head">
            <UIcon
              name="i-lucide-mic"
              class="size-4"
            />
            <b>{{ pick({ zh: '通道 2 · 语音口令', en: 'Channel 2 · Voice' }) }}</b>
          </div>
          <p
            v-if="!voiceSupported"
            class="muted"
          >
            {{ pick({ zh: '当前浏览器不支持 Web Speech 识别，请用 Chrome / Edge。', en: 'This browser does not support Web Speech. Try Chrome / Edge.' }) }}
          </p>
          <template v-else>
            <button
              class="big voice"
              type="button"
              :class="{ listening: voiceListening }"
              @click="voiceListening ? stopVoice() : beginVoice()"
            >
              {{ voiceListening ? `⏹ ${pick({ zh: '停止聆听', en: 'Stop listening' })}` : `🎙️ ${pick({ zh: '开始聆听', en: 'Start listening' })}` }}
            </button>
            <p
              v-if="voiceText"
              class="muted transcript"
            >
              {{ voiceText }}
            </p>
            <div class="chips">
              <span class="chip">起飞 / Take off</span>
              <span class="chip">降落 / Land</span>
            </div>
          </template>
        </div>

        <!-- 通道 3：手势 -->
        <div class="card">
          <div class="card-head">
            <UIcon
              name="i-lucide-hand"
              class="size-4"
            />
            <b>{{ pick({ zh: '通道 3 · 摄像头手势', en: 'Channel 3 · Gesture' }) }}</b>
          </div>
          <button
            class="big gesture"
            type="button"
            :disabled="gestureLoading"
            @click="gestureRunning ? stopGesture() : startGesture()"
          >
            <span v-if="gestureLoading">{{ pick({ zh: '⏳ 模型加载中…', en: '⏳ Loading model…' }) }}</span>
            <span v-else-if="gestureRunning">{{ pick({ zh: '⏹ 关闭摄像头', en: '⏹ Stop camera' }) }}</span>
            <span v-else>{{ pick({ zh: '📷 开启摄像头', en: '📷 Start camera' }) }}</span>
          </button>
          <p
            v-if="gestureError"
            class="muted"
          >
            {{ gestureError }}
          </p>
          <div class="cam">
            <video
              ref="videoEl"
              class="hidden-video"
              playsinline
              muted
            />
            <canvas
              ref="gestureCanvasEl"
              class="cam-canvas"
              :class="{ off: !gestureRunning }"
            />
            <span
              v-if="!gestureRunning"
              class="cam-hint"
            >{{ pick({ zh: '摄像头未开启', en: 'Camera off' }) }}</span>
          </div>
          <p class="muted gesture-now">
            {{ pick(gestureLabel) }}
          </p>
          <div class="chips">
            <span class="chip">👍 {{ pick({ zh: '起飞', en: 'Take off' }) }}</span>
            <span class="chip">🖐 {{ pick({ zh: '降落', en: 'Land' }) }}</span>
          </div>
        </div>

        <!-- 教学进度 -->
        <div class="card progress">
          <div class="pg-head">
            <span>{{ pick({ zh: '教学进度', en: 'Lesson Progress' }) }}</span>
            <b>{{ Math.round(rate * 100) }}%</b>
          </div>
          <div class="pg-track">
            <span
              class="pg-fill"
              :style="{ width: `${Math.round(rate * 100)}%` }"
            />
          </div>
          <ul class="pg-list">
            <li
              v-for="t in tasks"
              :key="t.key"
              :class="{ done: t.done >= t.total }"
            >
              <span>{{ pick(t.label) }}</span>
              <b>{{ t.done }}/{{ t.total }}</b>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </MediaDemoShell>
</template>

<style scoped>
.mm-root {
  --bg:#070b12; --panel:rgba(15,21,33,0.86); --border:rgba(120,160,220,0.18);
  --text:#e6edf6; --muted:#8aa0bd; --accent:#36d3ff; --good:#39e6a0; --warn:#ffcc4d; --alarm:#ff5470;

  display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:12px;
  height:min(80vh,820px); min-height:540px; color:var(--text); font-size:13px;
}
.mm-root :deep(*), .mm-root { box-sizing:border-box; }
.mm-root :deep(button) { font-family:inherit; cursor:pointer; color:var(--text);
  background:rgba(54,211,255,.10); border:1px solid var(--border); border-radius:10px; transition:.15s; }
.mm-root :deep(button:disabled) { opacity:.4; cursor:not-allowed; }
.mm-root :deep(button:hover:not(:disabled)) { border-color:var(--accent); }
.card { background:var(--panel); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
  border:1px solid var(--border); border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:9px; }

/* 左：场景 */
.stage-wrap { position:relative; border-radius:16px; overflow:hidden; background:var(--bg);
  border:1px solid var(--border); min-height:0; }
.stage { position:absolute; inset:0; }
.hud { position:absolute; top:12px; left:12px; z-index:10; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.phase-pill { display:inline-flex; gap:7px; align-items:center; padding:5px 12px; border-radius:99px;
  border:1px solid; background:rgba(8,12,20,.72); font-size:12px; font-weight:600; letter-spacing:.4px; }
.phase-pill .dot { width:8px; height:8px; border-radius:50%; box-shadow:0 0 8px currentColor; }
.alt { padding:5px 12px; border-radius:99px; background:rgba(8,12,20,.72); border:1px solid var(--border);
  font-variant-numeric:tabular-nums; font-size:12px; color:var(--muted); }
.alt b { color:#fff; font-size:15px; }
.alt small { color:var(--muted); }
.src { padding:5px 12px; border-radius:99px; background:rgba(54,211,255,.14); border:1px solid rgba(54,211,255,.4);
  color:var(--accent); font-size:11px; font-weight:600; }
.log { position:absolute; left:12px; bottom:12px; z-index:10; display:flex; flex-direction:column; gap:4px;
  max-width:min(420px, 80%); pointer-events:none; }
.log p { margin:0; font-size:11px; color:var(--muted); background:rgba(8,12,20,.68);
  padding:4px 10px; border-radius:8px; border:1px solid var(--border); }
.err { position:absolute; z-index:40; left:50%; bottom:16px; transform:translateX(-50%);
  background:rgba(61,11,22,.94); color:#ffdce1; border:1px solid rgba(255,90,111,.7);
  padding:8px 12px; border-radius:10px; font-size:12px; margin:0; }

/* 右上角全屏按钮：与 robot/drone 同款醒目样式 */
.stage-wrap .fsbtn { position:absolute; top:14px; right:14px; z-index:30; display:inline-flex;
  align-items:center; justify-content:center; width:38px; height:38px; padding:0; flex:none;
  background:rgba(54,211,255,.16); border:1px solid rgba(54,211,255,.5); border-radius:10px;
  color:var(--accent); box-shadow:0 0 14px rgba(54,211,255,.28); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); }
.stage-wrap .fsbtn:hover { background:rgba(54,211,255,.32); border-color:var(--accent); box-shadow:0 0 18px rgba(54,211,255,.5); }
.fsbtn svg { width:17px; height:17px; }
.mm-root:fullscreen { height:100vh; min-height:0; }
.stage-wrap:fullscreen { border-radius:0; }

/* 右栏 */
.side { display:flex; flex-direction:column; gap:12px; overflow-y:auto; min-height:0;
  scrollbar-width:thin; }
.side::-webkit-scrollbar { width:6px; }
.side::-webkit-scrollbar-thumb { background:rgba(120,160,220,.25); border-radius:3px; }
.card-head { display:flex; gap:8px; align-items:center; color:var(--accent); font-size:12px; }
.card-head b { color:var(--text); font-size:12.5px; }
.big { width:100%; padding:11px 14px; font-size:14px; font-weight:600; }
.big.takeoff { background:rgba(57,230,160,.16); border-color:rgba(57,230,160,.4); }
.big.takeoff:hover:not(:disabled) { background:rgba(57,230,160,.3); }
.big.land { background:rgba(255,159,67,.14); border-color:rgba(255,159,67,.4); }
.big.land:hover:not(:disabled) { background:rgba(255,159,67,.28); }
.big.voice.listening { background:rgba(255,84,112,.18); border-color:rgba(255,84,112,.5);
  animation:mm-pulse 1.4s infinite; }
.big.gesture { background:rgba(54,211,255,.12); border-color:rgba(54,211,255,.4); }
@keyframes mm-pulse { 50% { box-shadow:0 0 14px rgba(255,84,112,.45); } }
.btn-row { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.muted { margin:0; color:var(--muted); font-size:11.5px; line-height:1.55; }
.transcript { min-height:1.2em; color:#dbe6f2; }
.chips { display:flex; gap:6px; flex-wrap:wrap; }
.chip { font-size:11px; padding:3px 10px; border-radius:99px; border:1px solid var(--border);
  background:rgba(255,255,255,.03); color:var(--muted); }
.cam { position:relative; border-radius:9px; overflow:hidden; border:1px solid rgba(54,211,255,.35);
  background:#000; aspect-ratio:4/3; }
.cam-canvas { display:block; width:100%; height:100%; object-fit:cover; }
.cam-canvas.off { opacity:.25; }
.cam-hint { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  color:var(--muted); font-size:12px; }
.hidden-video { display:none; }
.gesture-now { font-weight:600; color:#dbe6f2; }

/* 教学进度 */
.progress { gap:6px; }
.pg-head { display:flex; align-items:baseline; justify-content:space-between;
  color:var(--muted); font-size:10px; letter-spacing:.8px; text-transform:uppercase; }
.pg-head b { color:var(--accent); font-size:14px; font-variant-numeric:tabular-nums; }
.pg-track { height:6px; border-radius:99px; background:rgba(120,160,220,.16); overflow:hidden; }
.pg-fill { display:block; height:100%; border-radius:99px;
  background:linear-gradient(90deg,var(--accent),var(--good)); transition:width .3s ease; }
.pg-list { list-style:none; margin:4px 0 0; padding:0; display:flex; flex-direction:column; gap:2px; }
.pg-list li { display:flex; justify-content:space-between; gap:8px; color:var(--muted); font-size:11px; line-height:1.5; }
.pg-list li b { color:#fff; font-variant-numeric:tabular-nums; flex:none; }
.pg-list li.done { color:var(--good); }
.pg-list li.done b { color:var(--good); }

/* 窄屏堆叠 */
@media (max-width:1024px) {
  .mm-root { grid-template-columns:1fr; height:auto; }
  .stage-wrap { height:52vh; min-height:340px; }
}
</style>
