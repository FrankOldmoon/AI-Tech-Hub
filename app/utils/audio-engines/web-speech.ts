/**
 * Web Speech API 引擎（浏览器内建识别：无模型、无下载、不联网）。
 *
 * 为什么走 `session` 而不是 `frames`：识别过程完全由浏览器内部驱动，我们只拿得到
 * `onresult` 回调，**没有任何音频样本可以喂给模型**——这正是 audio-tools.ts 里
 * AudioLiveSpec 要区分两种 live 模式的原因（混成一个接口会逼出一堆 kind 判断）。
 *
 * 搬移自 `app/pages/speech/asr.vue` 的「实时识别」半部分（脚本 16–111 行）。
 * 源页面把两种实现塞在同一个组件的 `mode: 'live' | 'file'` 里，这里 live 归本文件、
 * file 归 whisper.ts —— 这正是「能力页 asr 按引擎分组」想要表达的东西。
 */
import type { AudioTool, AudioToolContext, AudioToolResult } from '~/utils/audio-tools'

/**
 * 浏览器 SpeechRecognition 的最小结构描述。
 *
 * 为什么不直接用 DOM 类型：`SpeechRecognition` 至今不在 TypeScript 的 lib.dom 里，
 * 且 Chrome / Safari 只暴露 `webkitSpeechRecognition` 前缀版（源页面因此写成
 * `const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition`）。
 * 这里用最小接口 + 一次断言把 `any` 收敛在函数内部，不让它扩散到 tool 定义里。
 */
interface SpeechAlternative {
  transcript: string
}

interface SpeechResult {
  isFinal: boolean
  length: number
  [index: number]: SpeechAlternative
}

interface SpeechResultList {
  length: number
  [index: number]: SpeechResult
}

interface SpeechEvent {
  /** 本次回调新产生的第一个 result 的下标；更早的已经处理过 */
  resultIndex: number
  results: SpeechResultList
}

interface SpeechErrorEvent {
  error?: string
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

/** SSR 阶段没有 window，返回 null 与「浏览器不支持」同义（源页面也是 hydration 后才渲染提示） */
function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * 当前会话的识别器。
 *
 * 源页面在 onMounted 里建一次、之后反复 start/stop 复用；这里改成「start 时新建」：
 * 工具是模块级单例、不随页面卸载而销毁，复用同一个实例会让上一次会话注册的 onresult
 * 继续往新会话里吐脏文本。新建不加载任何模型，代价可忽略，所以选更安全的一侧。
 */
let recognition: SpeechRecognitionLike | null = null

/** 会话是否已 start；浏览器自行 onend 后要清掉，否则再点停止会把 InvalidStateError 抛给用户 */
let active = false

export const webSpeechAudioTools: AudioTool[] = [
  {
    id: 'webspeech-live',
    pages: ['asr'],
    name: { zh: '浏览器实时识别', en: 'Browser Live Recognition' },
    description: {
      zh: '用浏览器内建的 SpeechRecognition，无模型下载，识别在本地完成',
      en: 'Uses the built-in SpeechRecognition API — no model download, recognition runs on device'
    },
    kind: 'web-speech',
    // asr 是能力页 → 侧栏按引擎分组，两侧都写引擎名
    section: { 'asr': 'speech.sections.webSpeech', '*': 'speech.sections.webSpeech' },
    inputs: ['live'],
    // 参数与默认值逐项照搬源页面（含 help 文案，原为 asr.* i18n 串，按规矩内联）
    params: [
      {
        key: 'lang',
        label: { zh: '识别语言', en: 'Recognition language' },
        type: 'select',
        default: 'zh-CN',
        options: [
          { label: { zh: '中文 · zh-CN', en: '中文 · zh-CN' }, value: 'zh-CN' },
          { label: { zh: 'English · en-US', en: 'English · en-US' }, value: 'en-US' },
          { label: { zh: 'English · en-GB', en: 'English · en-GB' }, value: 'en-GB' },
          { label: { zh: '日本語 · ja-JP', en: '日本語 · ja-JP' }, value: 'ja-JP' }
        ]
      },
      {
        key: 'continuous',
        label: { zh: '连续识别', en: 'Continuous' },
        type: 'switch',
        default: true,
        help: {
          zh: '开启后持续识别直到手动停止，否则识别一次即停。',
          en: 'Keep recognizing until stopped; otherwise stop after one utterance.'
        }
      },
      {
        key: 'interimResults',
        label: { zh: '中间结果', en: 'Interim results' },
        type: 'switch',
        default: true,
        help: {
          zh: '实时显示识别中的临时文本。',
          en: 'Show partial transcripts in real time.'
        }
      },
      {
        key: 'maxAlternatives',
        label: { zh: '候选数量', en: 'Max alternatives' },
        type: 'slider',
        default: 1,
        min: 1,
        max: 5,
        step: 1
      }
    ],
    live: {
      // 必须显式声明：AudioLiveSpec.mode 默认是 'frames'，而 Web Speech 没有样本可喂
      mode: 'session',
      session: {
        supported: () => speechRecognitionCtor() !== null,
        start: (ctx: AudioToolContext, emit: (result: AudioToolResult) => void, onEnd: () => void) => {
          const Ctor = speechRecognitionCtor()
          if (!Ctor) return
          const rec = new Ctor()
          // 每次 start 都清零：源页面用组件 ref 存最终文本，start() 里显式置空
          let finalText = ''
          // params 来自 playground，取值与源页面 applyParams() 一一对应
          rec.lang = String(ctx.params.lang ?? 'zh-CN')
          rec.continuous = Boolean(ctx.params.continuous)
          rec.interimResults = Boolean(ctx.params.interimResults)
          rec.maxAlternatives = Number(ctx.params.maxAlternatives ?? 1)
          rec.onresult = (event) => {
            let interimText = ''
            // 从 resultIndex 开始遍历：更早的 result 已经累加过，重头遍历会让 finalText 翻倍
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const res = event.results[i]
              if (!res) continue
              const transcript = res[0]?.transcript ?? ''
              if (res.isFinal) finalText += transcript
              else interimText += transcript
            }
            // finalText 跨回调累积（最终文本只增不减），中间结果每次覆写
            emit({
              text: finalText,
              info: [{ label: ctx.lang === 'zh' ? '中间结果' : 'Interim', value: interimText }]
            })
          }
          rec.onerror = (event) => {
            // 源页面写的是 `e.error || 'error'`：事件不带 error 时也要给个兜底串
            emit({ info: [{ label: ctx.lang === 'zh' ? '错误' : 'Error', value: String(event.error || 'error') }] })
            // 报错后浏览器一定不再继续，通知 playground 复位（源页面是 listening.value = false）
            active = false
            onEnd()
          }
          rec.onend = () => {
            // continuous=false 时浏览器说完一句就自行结束，必须通知 playground 复位「聆听中」，
            // 否则普通识别场景会一直显示在听（源页面在 onend 里置 listening = false）
            active = false
            onEnd()
          }
          recognition = rec
          try {
            rec.start()
            active = true
          } catch {
            // 重复 start 会抛 InvalidStateError，忽略（与源页面一致）
          }
        },
        stop: () => {
          // 未 start / 已被浏览器 onend 时再 stop() 同样会抛 InvalidStateError，用 active 挡住
          if (recognition && active) recognition.stop()
          active = false
        }
      },
      // 对齐源页面的 onBeforeUnmount：离开时停掉识别器，免得后台继续占用麦克风
      dispose: () => {
        if (recognition && active) recognition.stop()
        recognition = null
        active = false
      }
    },
    run: async ctx => ({
      // 本工具 inputs 只有 'live'，playground 不会调用 run；但 AudioTool.run 是必填项。
      // 返回一条说明好过返回空结果——后者会让人以为「跑了但没输出」。
      info: [{
        label: ctx.lang === 'zh' ? '实时' : 'Live',
        value: ctx.lang === 'zh' ? '该工具仅在麦克风实时模式下工作' : 'This tool only runs in live microphone mode'
      }]
    })
  }
]
