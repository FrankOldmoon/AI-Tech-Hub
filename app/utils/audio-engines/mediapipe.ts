/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MediaPipe tasks-audio 引擎：YAMNet 环境音事件分类（AudioSet 521 类）。
 *
 * 从 `app/pages/speech/audio-classifier.vue` 全文搬移（该页已被 `/speech/audio-classification` 吸收删除），
 * 源页面的两半行为都保留：
 *   - 文件：整段 1s 窗口 / 0.5s 步进逐段 `classify(slice, 16000)`，只记录相邻不同的 top 命中
 *   - 实时：源页面用 `AudioContext({ sampleRate: 16000 })` + `ScriptProcessor(4096)` 喂帧；
 *     playground 的 useMicStream 给出的正是 16kHz / 4096 样本帧，所以这里只做 `frame(samples) → classify`
 *
 * 分类器常驻进程：源页面的 `classifier` 同样跨 start/stop 复用（只有音频链路被拆掉、模型不卸载），
 * 故这里不实现 dispose —— 反复进出实时不必重新拉 wasm 与 yamnet.tflite。
 */
import type { AudioTool, AudioToolContext } from '~/utils/audio-tools'
import { mediapipeModels, mediapipeWasm } from '~/utils/mediapipe'

type Params = Record<string, number | string | boolean>
type InfoRow = { label: string, value: string }
type Top = { name: string, score: number }

/** YAMNet 固定 16kHz：源页面既 setDefaultSampleRate(16000)，又在 classify 里显式传 16000 */
const SAMPLE_RATE = 16000
/** 分类窗口 1s（= 16000 样本），YAMNet 的输入长度 */
const WINDOW = SAMPLE_RATE
/** 步进 0.5s：相邻窗口重叠一半，源页面为 `win / 2` */
const HOP = WINDOW / 2
/** 事件条数上限，源页面 history 最多留 20 条 */
const MAX_EVENTS = 20

let classifier: any = null
/** 最近一次生效的参数快照：参数没变就不重复 setOptions（源页面用 `watch(params, {deep:true})` 达到同样效果） */
let optionsSnap = ''

function snapOf(params: Params): string {
  return `${Number(params.maxResults)}|${Number(params.scoreThreshold)}`
}

async function ensureClassifier(ctx: AudioToolContext): Promise<any> {
  if (classifier) return classifier
  try {
    const { FilesetResolver, AudioClassifier } = await import('@mediapipe/tasks-audio')
    const audio = await FilesetResolver.forAudioTasks(mediapipeWasm.audio)
    const created = await AudioClassifier.createFromOptions(audio, {
      baseOptions: { modelAssetPath: mediapipeModels.audioClassifier },
      maxResults: Number(ctx.params.maxResults),
      scoreThreshold: Number(ctx.params.scoreThreshold)
    })
    // 不设默认采样率时 classify 按 48000 解释样本，1s 窗口会被误当成 0.33s
    created.setDefaultSampleRate(SAMPLE_RATE)
    classifier = created
    optionsSnap = snapOf(ctx.params)
    return created
  } catch (e) {
    // 资源加载失败时 e 往往是 Event（没有 message），源页面在此处给了一句人话；这里按语言还原同样的兜底
    if (e instanceof Event) {
      const msg = ctx.lang === 'zh'
        ? '模型/WASM 加载失败，请检查网络或稍后重试'
        : 'Failed to load the model/WASM. Check your network and retry.'
      throw new Error(msg, { cause: e })
    }
    throw e
  }
}

/** 参数变化时才同步给分类器（源页面 watch(params, deep) → setOptions） */
async function syncOptions(c: any, params: Params): Promise<void> {
  const snap = snapOf(params)
  if (snap === optionsSnap) return
  await c.setOptions({
    maxResults: Number(params.maxResults),
    scoreThreshold: Number(params.scoreThreshold)
  })
  optionsSnap = snap
}

/** 取 top 类别（源页面：`results?.[0]?.classifications?.[0]?.categories?.[0]`） */
function topCategory(results: any): Top | null {
  const top = results?.[0]?.classifications?.[0]?.categories?.[0]
  if (!top) return null
  return { name: top.categoryName, score: top.score }
}

/** 结果行口径沿用源页面：类别名 + `Math.round(score * 100)%` */
function rowOf(top: Top): InfoRow {
  return { label: top.name, value: `${Math.round(top.score * 100)}%` }
}

export const mediapipeAudioTools: AudioTool[] = [
  {
    id: 'yamnet-classify',
    pages: ['yamnet', 'audio-classification'],
    name: { zh: '音频事件分类', en: 'Audio Event Classification' },
    description: {
      zh: 'YAMNet 对 521 类 AudioSet 声音事件逐段打分：整段文件滑窗，或麦克风实时。',
      en: 'YAMNet scores 521 AudioSet sound-event classes: sliding windows over a file, or live from the mic.'
    },
    kind: 'mediapipe',
    section: {
      'yamnet': 'speech.sections.eventClassify',
      'audio-classification': 'speech.sections.mediapipe',
      '*': 'speech.sections.eventClassify'
    },
    inputs: ['file', 'live'],
    params: [
      {
        key: 'maxResults',
        label: { zh: '返回类别数', en: 'Max results' },
        type: 'slider',
        default: 5,
        min: 1,
        max: 20,
        step: 1
      },
      {
        key: 'scoreThreshold',
        label: { zh: '置信度阈值', en: 'Score threshold' },
        type: 'slider',
        default: 0,
        min: 0,
        max: 1,
        step: 0.05
      }
    ],
    run: async (ctx) => {
      const samples = ctx.samples
      // inputs 含 'file' 时 playground 保证样本已解码成 16kHz 单声道；没有样本则无事可做
      if (!samples) return { info: [] }
      const c = await ensureClassifier(ctx)
      await syncOptions(c, ctx.params)
      // 与源页面同一公式：窗口数由「样本数 - 窗口 + 步进」决定，短于 1s 的音频总数为 0
      const total = Math.floor((samples.length - WINDOW) / HOP) + 1
      const events: InfoRow[] = []
      for (let i = 0; i < total; i++) {
        // 源页面的「取消分析」按钮 → 这里换成 playground 的取消信号，尽早返回已得到的结果
        if (ctx.isCancelled?.()) break
        const start = i * HOP
        const top = topCategory(c.classify(samples.slice(start, start + WINDOW), SAMPLE_RATE))
        // 只在类别变化时记一条（源页面 history 的去重条件）
        if (top && events[events.length - 1]?.label !== top.name) {
          events.push(rowOf(top))
          // 源页面是 unshift + pop（保留最近 20 条、新在前）；这里是播放顺序的正序列表，故丢掉最旧的
          if (events.length > MAX_EVENTS) events.shift()
        }
        // 源页面用 rAF 让出主线程以刷新进度条与结果；进度条改由 playground 统一渲染，
        // 但长时间音频仍需要让出，否则整段分析期间界面完全卡死
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
      return { info: events }
    },
    live: {
      mode: 'frames',
      /** 开麦前加载模型（源页面 start() 里先 `await ensure()`，失败即不建链路） */
      prepare: async (ctx) => {
        await ensureClassifier(ctx)
      },
      frame: (samples, ctx) => {
        if (!classifier) return null
        // setOptions 是异步的，而帧回调是同步契约：参数改动后最多晚一帧生效（源页面的 watch 同样是异步的）。
        // 帧回调没有错误通道，失败就先吞掉，下一次 prepare/run 会重新同步参数。
        void syncOptions(classifier, ctx.params).catch(() => {})
        const top = topCategory(classifier.classify(samples, SAMPLE_RATE))
        // 本帧没有类别时不更新展示（源页面此时不写 topResult）
        return top ? { info: [rowOf(top)] } : null
      }
    }
  }
]
