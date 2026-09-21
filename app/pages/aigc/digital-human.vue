<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- TalkingHead / HeadAudio 只发布 ESM 产物、没有类型声明（也无人维护 .d.ts），
   这里按 webllm.vue 的既有做法用 any 承接这两个命令式 API。 */
/* 数字人：浏览器内「会说话、对口型」的 3D 头像。
   - 渲染 + 口型混合：TalkingHead（MIT）
   - 口型识别：HeadAudio（MIT）—— 音频驱动，所以「谁在出声」随意换：
     本地 Kokoro 出声它跟着动，服务端 Edge TTS 出声它照样跟着动，中文也没问题。
   - 语音合成两套引擎：
       服务端 Edge TTS —— 音色 300+、零下载、即点即用；代价是文本会离开浏览器
       本地 Kokoro     —— 零联网，但要下 ~92MB 模型并在浏览器内推理（建议 WebGPU）
   - 人物（头像）与音色都分男女，且**必须同性别**：男头像配女声是最容易被一眼看穿的
     穿帮，所以音色下拉按人物性别过滤，换人物时音色自动落到该性别的首选音色。
   头像是 /avatar（两个 GLB 都来自 VTubeMe 免费资产，CC BY 4.0，见 CREDITS.txt），
   口型脚本与模型在 /model/vendor/headaudio（全部同源）。 */
import type { ParamOption } from '~/utils/params'
import { humanError } from '~/utils/errors'
import { kokoroSynthesize, kokoroVoiceGroups, kokoroVoices, voiceOptionLabel } from '~/utils/kokoro'

const { t, locale } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('aigc', 'digital-human')!)

/* 人物：两个 GLB 都是 VTubeMe 免费头像（CC BY 4.0），已用
   scripts/patch-avatar-visemes.mjs 改成 TalkingHead / HeadAudio 认的 Oculus 口型命名。
   body（'M' / 'F'）是库自己的头像配置项：它会用来筛掉一部分不合身体形态的随机站姿。 */
type Gender = 'female' | 'male'
const AVATARS: Record<Gender, { url: string, asset: string, body: 'M' | 'F' }> = {
  male: { url: '/avatar/nova.glb', asset: 'Nova', body: 'M' },
  female: { url: '/avatar/kai.glb', asset: 'Kai', body: 'F' }
}
const GENDERS: Gender[] = ['male', 'female']
const HEADTTS_WORKLET = '/model/vendor/headaudio/headworklet.min.mjs'
const HEADAUDIO_MODULE = '/model/vendor/headaudio/headaudio.min.mjs'
const VISEME_MODEL = '/model/vendor/headaudio/model-en-mixed.bin'

interface EdgeVoice { shortName: string, locale: string, gender: string, friendlyName: string }

/* Edge 音色兜底（与 audio-engines/edge.ts 同风格）：接口不可用时下拉不能空。
   顺序与下拉分组一致：美式英语 → 英式英语 → 中文 → 其他。 */
const EDGE_FALLBACK: EdgeVoice[] = [
  { shortName: 'en-US-AriaNeural', locale: 'en-US', gender: 'Female', friendlyName: 'Aria' },
  { shortName: 'en-US-GuyNeural', locale: 'en-US', gender: 'Male', friendlyName: 'Guy' },
  { shortName: 'en-GB-SoniaNeural', locale: 'en-GB', gender: 'Female', friendlyName: 'Sonia' },
  { shortName: 'zh-CN-XiaoxiaoNeural', locale: 'zh-CN', gender: 'Female', friendlyName: 'Xiaoxiao' },
  { shortName: 'zh-CN-YunxiNeural', locale: 'zh-CN', gender: 'Male', friendlyName: 'Yunxi' },
  { shortName: 'ja-JP-NanamiNeural', locale: 'ja-JP', gender: 'Female', friendlyName: 'Nanami' }
]

/* 这个资产的静止姿势是低着头的，而且 TalkingHead 的随机站姿模板里
   Head.rotation.x 能到 0.298 rad（≈17° 低头），所以数字人总像在往下看。
   两条一起治：
   1) 该库加载后会用自己的 poseBase 重写头骨旋转，改 GLB 里的骨头是没用的；
   2) 每个模板的头部俯仰统一抬到一个值（身体姿态依旧随机，只有头不再一直低着）。
   -0.14 rad 是按头骨 up 轴实测标定出来的（低头 17°~24° → 3.3°~5.7°）。
   3) 说话的俯仰还来自情绪动画的 bodyRotateX：待机 [-0.04,0.10]、说话 [-0.05,0.15]，
   上限全部偏「向下」，一开口头就慢慢低下去。这里把两个相位都收到 0 附近
   （保留微动、去掉低头），并在每帧把库的音量点头量归零（见 init 里的 opt.update）。
   4) 姿势动画会在站姿模板里随机挑：除了 side / straight，还有 hip / turn / back（躺下）
   —— `cameraView` 是 upper，一旦挑中「躺下」，整个身体连带头会突然被拽下去。
   库本来用 avatar.body（'M'/'F'）挡掉其中一部分，但只在 body='M' 时生效。 */
const HEAD_LEVEL_X = -0.14
/** 情绪动画里头的俯仰范围（原值上限 0.10/0.15 rad ≈ 6°~9° 向下） */
const HEAD_LEVEL_BODY_X = [-0.03, 0.03]
/** 允许被随机挑中的站姿（其余 turn / back / bend / kneel / oneknee… 都是扭曲或非站立姿势） */
const STANDING_POSES = new Set(['side', 'straight', 'wide', 'hip'])

function levelAvatarPose(head: any) {
  const templates = head?.poseTemplates
  if (!templates) return
  for (const name of Object.keys(templates)) {
    const props = templates[name]?.props
    if (props?.['Head.rotation']) props['Head.rotation'].x = HEAD_LEVEL_X
    if (props?.['Neck.rotation']) props['Neck.rotation'].x = 0
  }
  /* 待机时眼珠的视线游走范围原本能到 0.6（看起来一直在往下瞟），压到 ±0.15：
     保住「眼睛会动」的自然感，但不再是低头盯地。 */
  for (const mood of Object.values<any>(head.animMoods || {})) {
    for (const anim of mood?.anims || []) {
      for (const phase of ['idle', 'speaking']) {
        const node = anim?.[phase]
        for (const branch of node?.alt ? node.alt : [node]) {
          if (branch?.vs?.eyesRotateX) branch.vs.eyesRotateX = [[-0.15, 0.15]]
          if (branch?.vs?.bodyRotateX) branch.vs.bodyRotateX = [HEAD_LEVEL_BODY_X]
        }
      }
    }
  }
  /* 站姿随机里剔掉非站立姿势。'M' / 'full' 是会把姿势改写成 wide / bend / oneknee 的
     条件覆盖，留着等于留了个后门，一并删掉（概率权重由库按剩余项重新分摊）。 */
  for (const mood of Object.values<any>(head.animMoods || {})) {
    for (const anim of mood?.anims || []) {
      if (anim?.name !== 'pose' || !Array.isArray(anim.alt)) continue
      anim.alt = anim.alt
        .filter((entry: any) => STANDING_POSES.has(entry?.vs?.pose?.[0]))
        .map((entry: any) => {
          delete entry.M
          delete entry.full
          return entry
        })
    }
  }
  /* neutral 心情自带 0.1 的「眼珠往下看」，一并归零，目光才平视 */
  head.setBaselineValue?.('eyesLookDown', 0)
  /* 库用 mtLimits 把「眼珠下看 / 眉毛下压」混进眼睑开合：eyeBlink ≥ (eyesLookDown + browDown)/2。
     说话时眉毛会被音量随机抖动（mtRandomized + vol），于是眼睑被动半闭 —— 就是「眼睛半睁开」。
     解掉这条耦合：眼睑只由眨眼动画控制。limit 在每次 showAvatar 时从 mtLimits 复制进
     mtAvatar，所以配置和当前值都要清。 */
  head.mtLimits = {}
  for (const side of ['Left', 'Right']) {
    const blink = head.mtAvatar?.[`eyeBlink${side}`]
    if (blink) blink.limit = null
  }
  /* 立刻套用一个挺直的站姿，否则首次随机换姿前一直是低头静止姿势 */
  const straight = templates.straight
  if (straight) head.setPoseFromTemplate(straight, 0)
}

const stageEl = ref<HTMLElement | null>(null)
const ready = ref(false)
const loading = ref(false)
const speaking = ref(false)
const progress = ref(0)
const progressText = ref('')
const error = ref<string | null>(null)
const text = ref('')
const sayText = ref('')
const hasWebgpu = ref(true)

/* 默认走服务端 Edge TTS：零下载、音色多、中文口型同样成立 */
const engine = ref<'edge' | 'kokoro'>('edge')
const engineItems = computed(() => [
  { label: t('digitalHuman.engineEdge'), value: 'edge' },
  { label: t('digitalHuman.engineKokoro'), value: 'kokoro' }
])

/* 默认人物 = Nova（男）：保持页面原有的默认形象不变，只是把默认音色换成男声 */
const gender = ref<Gender>('male')
const genderItems = computed(() => GENDERS.map(g => ({
  label: `${t(g === 'female' ? 'digitalHuman.female' : 'digitalHuman.male')} · ${AVATARS[g].asset}`,
  value: g
})))

const edgeVoices = ref<EdgeVoice[]>(EDGE_FALLBACK)
let edgeVoicesLoaded = false
/* 初始值只是占位：下面的 watch(..., { immediate: true }) 会按「界面语言 × 人物性别」落定 */
const voice = ref('en-US-AriaNeural')
const speed = ref(1)

/** 界面语言（示例语句、默认音色都跟着它走，避免「中文句子读成英文音素」） */
const lang = computed<'zh' | 'en'>(() => (locale.value === 'zh' ? 'zh' : 'en'))

/* Nuxt UI 的 USelect 分组是「数组的数组」：每个内层数组是一组，组内第一个
   { type: 'label' } 条目当组标题（与 utils/params.ts 的 ParamOptions 一致）。
   早先用 [{ label, items }] 是错的 —— 选项既选不中、显示出来的也是原始值。 */
/* 音色分组顺序：美式英语 → 英式英语 → 中文 → 其余按字母排。
   两套引擎都按这个来（Kokoro 的声线分组本身就已经是这个次序）。 */
const LOCALE_ORDER = ['en-US', 'en-GB', 'zh-CN', 'zh-TW', 'zh-HK']

/** 每个（语言 × 性别）的首选音色 —— 列表里没有它时才退回同性别第一个 */
const EDGE_PREFERRED: Record<'zh' | 'en', Record<Gender, string>> = {
  zh: { female: 'zh-CN-XiaoxiaoNeural', male: 'zh-CN-YunxiNeural' },
  en: { female: 'en-US-AriaNeural', male: 'en-US-GuyNeural' }
}
const KOKORO_PREFERRED: Record<'zh' | 'en', Record<Gender, string>> = {
  zh: { female: 'zf_xiaoxiao', male: 'zm_yunxi' },
  en: { female: 'af_heart', male: 'am_adam' }
}

const edgeGender = (v: EdgeVoice): Gender => (v.gender.toLowerCase().startsWith('f') ? 'female' : 'male')

/** 当前引擎的全部音色（id + 性别），换人物时据此把音色一起换掉 */
const voicePool = computed(() => (engine.value === 'edge'
  ? edgeVoices.value.map(v => ({ id: v.shortName, gender: edgeGender(v) }))
  : kokoroVoices.map(v => ({ id: v.id, gender: v.gender }))))

/** 只留与人物同性别的音色：男头像配女声是最容易被一眼看穿的穿帮 */
const genderVoices = computed(() => voicePool.value.filter(v => v.gender === gender.value))

function toEdgeGroups(voices: EdgeVoice[]): ParamOption[][] {
  const byLocale = new Map<string, EdgeVoice[]>()
  for (const v of voices) {
    const list = byLocale.get(v.locale) ?? []
    list.push(v)
    byLocale.set(v.locale, list)
  }
  const rank = (locale: string) => {
    const i = LOCALE_ORDER.indexOf(locale)
    return i < 0 ? LOCALE_ORDER.length : i
  }
  return [...byLocale.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([locale, list]) => [
      { label: locale, type: 'label' as const },
      ...list.map(v => ({
        label: `${v.friendlyName} · ${v.gender.toLowerCase().startsWith('f') ? t('digitalHuman.female') : t('digitalHuman.male')}`,
        value: v.shortName
      }))
    ])
}

const voiceItems = computed<ParamOption[][]>(() => {
  if (engine.value === 'edge') return toEdgeGroups(edgeVoices.value.filter(v => edgeGender(v) === gender.value))
  return kokoroVoiceGroups
    .map(g => [
      { label: g.label, type: 'label' as const },
      ...kokoroVoices
        .filter(v => v.lang === g.lang && v.gender === gender.value)
        .map(v => ({ label: voiceOptionLabel(v), value: v.id }))
    ])
    .filter(group => group.length > 1) // 只保留真有声线的语言组
})

async function loadEdgeVoices() {
  if (edgeVoicesLoaded) return
  edgeVoicesLoaded = true
  try {
    const res = await fetch('/api/speech/tts-voices')
    if (!res.ok) return
    const data = await res.json() as { voices?: EdgeVoice[] }
    if (data.voices?.length) edgeVoices.value = data.voices
  } catch { /* 保留兜底音色 */ }
}

/* 换引擎 / 换人物 / 音色列表到货后，把当前音色拉回「该语言 × 该性别」的合法值：
   用户自己挑过的音色只要还在候选里就不动，否则落到首选（再不行就第一个）。 */
watch([engine, gender, genderVoices], () => {
  if (genderVoices.value.some(v => v.id === voice.value)) return
  const preferred = (engine.value === 'edge' ? EDGE_PREFERRED : KOKORO_PREFERRED)[lang.value][gender.value]
  voice.value = genderVoices.value.some(v => v.id === preferred)
    ? preferred
    : (genderVoices.value[0]?.id ?? voice.value)
}, { immediate: true })

watch(engine, (v) => {
  if (v === 'edge') void loadEdgeVoices()
})

/* 语速滑杆（0.5–2.0）→ Edge 的百分比偏移（-50%..+100%） */
function edgeRate(v: number): string {
  const pct = Math.round((v - 1) * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}

// TalkingHead / HeadAudio 都没有类型声明，统一按 any 用
let head: any = null
let headaudio: any = null
let stopTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  hasWebgpu.value = typeof navigator !== 'undefined' && !!(navigator as any).gpu
  void loadEdgeVoices()
  /* 开箱即用：先给一句长一点的示例，点「朗读」就能看出断句与嘴型；
     语言跟界面一致，音色也跟着（否则中文句子会被英文音素表读坏）。 */
  if (!text.value.trim()) text.value = t('digitalHuman.sampleText')
})

/** 加载当前人物的 GLB 并把头部姿态摆正（库的 showAvatar 支持重复调用，会保留现有 morph 值） */
async function loadAvatar() {
  if (!head) return
  const avatar = AVATARS[gender.value]
  await head.showAvatar({ url: avatar.url, body: avatar.body })
  levelAvatarPose(head)
}

/** 换人物 = 换 GLB：加载期间禁掉交互，失败也不把页面炸掉 */
async function switchAvatar() {
  if (!ready.value || !head || loading.value) return
  loading.value = true
  progressText.value = t('digitalHuman.loadingAvatar')
  try {
    await loadAvatar()
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}

watch(gender, () => {
  void switchAvatar()
})

async function init() {
  if (ready.value || loading.value || !stageEl.value) return
  error.value = null
  loading.value = true
  progress.value = 0
  try {
    progressText.value = t('digitalHuman.loadingAvatar')
    const { TalkingHead } = await import('@met4citizen/talkinghead')
    head = new TalkingHead(stageEl.value, {
      /* 不用它自带的 Google TTS / 文本口型（那要联网 + 只支持几种语言），
         口型完全交给 HeadAudio 从音频里推 */
      ttsEndpoint: null,
      lipsyncModules: [],
      lipsyncLang: 'en',
      cameraView: 'upper',
      modelFPS: 30,
      modelPixelRatio: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2),
      avatarMood: 'neutral',
      /* 关掉「看着镜头」这套眼动补偿。它是按库自家头像的骨骼轴向标定的：对我们的资产，
         低头量会被算成 0.6~0.8，于是眼珠被压着往下看、眼睑还被 mtLimits
         （eyeBlink ≥ eyesLookDown/2）强制压到半闭 —— 看上去就是「眯着眼」。视线交给
         情绪动画自己的游走就够了。 */
      avatarIdleEyeContact: 0,
      avatarSpeakingEyeContact: 0
    })
    /* speakAudio 按 opt.pcmSampleRate 解释我们喂进去的 PCM，而 decodeAudioData 会把
       音频重采样到 AudioContext 自己的采样率（常见 48k）—— 把两者对齐，否则变调变速。
       这样 Kokoro(24k) 与 Edge(24k mp3) 两条路都成立。 */
    head.opt.pcmSampleRate = head.audioCtx.sampleRate
    await loadAvatar()

    progressText.value = t('digitalHuman.loadingLipSync')
    const audioMod = await import(/* @vite-ignore */ HEADAUDIO_MODULE) as { HeadAudio: any }
    await head.audioCtx.audioWorklet.addModule(HEADTTS_WORKLET)
    headaudio = new audioMod.HeadAudio(head.audioCtx, { parameterData: { vadMode: 0 } })
    await headaudio.loadModel(VISEME_MODEL)
    /* 口型值直接写进 TalkingHead 的 morph 通道（newvalue 是它每帧消费的一次性通道） */
    headaudio.onvalue = (key: string, value: number) => {
      const mt = head?.mtAvatar?.[key]
      if (mt) {
        mt.newvalue = value
        mt.needsUpdate = true
      }
    }
    /* 让 HeadAudio 监听 TalkingHead 的语音增益节点：音频播什么，它就推什么口型 */
    head.audioSpeechGainNode.connect(headaudio)
    /* 口型之外还要压掉「说话点头」：库会用音量驱动脖子俯仰（volumeHeadBase 固定 +0.05，
       也就是向下），一开口头就跟着往下点。它只在 eye contact 打开时生效（上面已关），
       这里每帧归零作为第二道保险 —— 脖子旋转每帧都会从姿势模板重建，只去掉点头、
       静态姿势一点不动。 */
    const audioUpdate = headaudio.update.bind(headaudio)
    head.opt.update = (dt: number) => {
      audioUpdate(dt)
      head.volumeHeadCurrent = 0
      head.volumeHeadTarget = 0
      head.volumeHeadBase = 0
    }
    ready.value = true
    /* 控制台调试用（同 /face 的 window.rec）：可直接查 mtAvatar 看口型通道 */
    ;(window as any).__digitalHuman = { head, headaudio }
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}

/** WAV blob → TalkingHead 要的 PCM16 单声道 */
async function blobToPcm16(blob: Blob): Promise<ArrayBuffer> {
  const audioBuf = await head.audioCtx.decodeAudioData(await blob.arrayBuffer())
  const f = audioBuf.getChannelData(0)
  const pcm = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]!))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return pcm.buffer as ArrayBuffer
}

/** 合成一段文本 → 音频 blob（两套引擎共用同一条下游链路） */
async function synthesize(text: string): Promise<{ blob: Blob, note: string }> {
  if (engine.value === 'edge') {
    const started = performance.now()
    const res = await fetch('/api/speech/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: voice.value,
        rate: edgeRate(Number(speed.value))
      })
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const blob = await res.blob()
    return { blob, note: `Edge TTS · ${Math.round(performance.now() - started)} ms` }
  }
  const { blob, ms } = await kokoroSynthesize(text, voice.value, Number(speed.value), (p) => {
    /* Kokoro 的 progress 已经是 0..100（与 speech/* 各页一致），不要再乘 100 */
    if (typeof p.progress === 'number') progress.value = Math.min(100, Math.max(0, Math.round(p.progress)))
    /* status 有时是空串，别把「正在合成」的提示抹掉 */
    if (p.status) progressText.value = p.status
  })
  return { blob, note: `Kokoro · ${ms} ms` }
}

async function speak() {
  if (!ready.value || !head) return
  const clean = text.value.trim()
  if (!clean || loading.value) return
  error.value = null
  loading.value = true
  sayText.value = clean
  try {
    progress.value = 0
    progressText.value = t('digitalHuman.synthesizing')
    const { blob, note } = await synthesize(clean)
    progress.value = 100
    progressText.value = note
    const pcm = await blobToPcm16(blob)
    /* 注意：speakAudio 只在 Array.isArray(r.audio) 时按「PCM 分块」处理，
       直接给一个 ArrayBuffer 会被当成已解码的 AudioBuffer → source.buffer 赋值报错。
       所以这里必须包成数组。 */
    head.speakAudio({ audio: [pcm], isRaw: true })
    speaking.value = true
    if (stopTimer) clearTimeout(stopTimer)
    /* 结束时间：按解码时长估一个，只用于按钮状态（PCM 采样率以 head 为准） */
    const dur = (pcm.byteLength / 2 / head.opt.pcmSampleRate) * 1000
    stopTimer = setTimeout(() => {
      speaking.value = false
    }, dur + 300)
  } catch (e: any) {
    error.value = humanError(e, t)
    speaking.value = false
  } finally {
    loading.value = false
  }
}

function stop() {
  if (stopTimer) clearTimeout(stopTimer)
  speakStop()
  speaking.value = false
}

function speakStop() {
  try {
    head?.audioSpeechSource?.stop()
  } catch { /* 已经停了 */ }
  try {
    head?.stopSpeaking?.(true)
  } catch { /* 同上 */ }
  try {
    headaudio?.resetAll?.()
  } catch { /* 同上 */ }
}

onBeforeUnmount(() => {
  if (stopTimer) clearTimeout(stopTimer)
  speakStop()
  try {
    head?.audioCtx?.close()
  } catch { /* 已关闭 */ }
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-6">
      <HeavyModelNotice
        v-if="engine === 'kokoro'"
        :size-gb="0.1"
      />

      <UAlert
        v-if="!hasWebgpu && engine === 'kokoro'"
        color="info"
        variant="subtle"
        icon="i-lucide-info"
        :title="t('digitalHuman.noWebgpu')"
      />

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        :title="error"
      />

      <!-- 舞台 -->
      <UCard>
        <div
          ref="stageEl"
          class="relative mx-auto aspect-[3/4] w-full max-w-md overflow-hidden rounded-xl bg-black"
        />
        <div class="mt-4 flex flex-wrap items-center justify-center gap-3">
          <UButton
            v-if="!ready"
            icon="i-lucide-sparkles"
            :label="t('digitalHuman.init')"
            color="primary"
            :loading="loading"
            @click="init"
          />
          <template v-else>
            <UBadge
              color="success"
              variant="subtle"
              icon="i-lucide-check"
              :label="t('digitalHuman.ready')"
            />
            <UButton
              v-if="speaking"
              icon="i-lucide-square"
              :label="t('digitalHuman.stop')"
              color="neutral"
              variant="subtle"
              @click="stop"
            />
          </template>
        </div>
        <div
          v-if="loading"
          class="mt-3"
        >
          <UProgress :model-value="progress" />
        </div>
        <!-- 合成耗时留在界面上（Edge TTS 往往一两百毫秒就完成，随 loading 一起消失会看不到） -->
        <p
          v-if="progressText"
          class="mt-2 truncate text-center text-xs text-muted"
        >
          {{ progressText }}
        </p>
        <p class="mt-3 text-center text-xs text-muted">
          {{ engine === 'edge' ? t('digitalHuman.hintEdge') : t('digitalHuman.hint') }}
        </p>
        <p class="mt-1 text-center text-xs text-muted">
          <a
            class="underline decoration-dotted hover:text-default"
            href="https://vtubeme.com/free-vrm-avatars"
            target="_blank"
            rel="noopener"
          >{{ t('digitalHuman.credit') }}</a>
        </p>
      </UCard>

      <!-- 说话输入 -->
      <UCard>
        <div class="flex flex-wrap items-end gap-4">
          <div class="min-w-44">
            <label class="mb-1 block text-sm font-medium text-muted">{{ t('digitalHuman.avatar') }}</label>
            <USelect
              v-model="gender"
              :items="genderItems"
              :disabled="loading"
              class="w-full"
            />
          </div>
          <div class="min-w-44">
            <label class="mb-1 block text-sm font-medium text-muted">{{ t('digitalHuman.engine') }}</label>
            <USelect
              v-model="engine"
              :items="engineItems"
              :disabled="loading"
              class="w-full"
            />
          </div>
          <div class="min-w-56 flex-1">
            <label class="mb-1 block text-sm font-medium text-muted">{{ t('digitalHuman.voice') }}</label>
            <USelect
              v-model="voice"
              :items="voiceItems"
              :disabled="loading"
              class="w-full"
            />
          </div>
          <div class="w-40">
            <label class="mb-1 block text-sm font-medium text-muted">{{ t('digitalHuman.speed') }}</label>
            <USlider
              v-model="speed"
              :min="0.5"
              :max="2"
              :step="0.05"
              :disabled="loading"
            />
          </div>
        </div>
        <div class="mt-4 flex items-end gap-2">
          <UTextarea
            v-model="text"
            :rows="3"
            :placeholder="t('digitalHuman.placeholder')"
            class="flex-1"
            :disabled="!ready || loading"
            @keydown.enter.exact.prevent="speak"
          />
          <UButton
            icon="i-lucide-volume-2"
            :label="t('digitalHuman.speak')"
            color="primary"
            :loading="loading"
            :disabled="!ready || !text.trim()"
            @click="speak"
          />
        </div>
      </UCard>
    </div>
  </MediaDemoShell>
</template>
