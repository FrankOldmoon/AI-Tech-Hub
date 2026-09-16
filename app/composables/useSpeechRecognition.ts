/**
 * Web Speech API（浏览器内建识别）统一封装。
 *
 * 为什么单独抽：asr / speech-rate / voice-command 三个页面各写了一份几乎相同的样板
 * （取 ctor → 设 continuous/interimResults/lang → 从 resultIndex 遍历结果 → onend/onerror 收尾），
 * 其中 asr 已迁进 `utils/audio-engines/web-speech.ts`，剩下两页靠这个 composable 收拢。
 *
 * 与那个引擎模块的区别：引擎模块是「注册表工具」（模块级单例、按会话 start/stop）；
 * 这里是「组件级状态」，`listening` / `supported` 是响应式的，供页面直接绑 UI。
 *
 * 注意 `supported` 只能在 onMounted 之后才可信：SSR 没有 SpeechRecognition，
 * 若在 setup 里直接探测，服务端渲染出的结构与客户端不一致（hydration mismatch）。
 */
export interface SpeechRecognitionOptions {
  lang?: string
  /** 默认 true：持续识别直到手动停止 */
  continuous?: boolean
  /** 默认 true：回吐中间结果 */
  interimResults?: boolean
  /** 默认 1 */
  maxAlternatives?: number
  /** 最终文本（跨 onresult 累积，不是增量） */
  onFinal?: (text: string) => void
  /** 中间结果（每次覆写，不是累积） */
  onInterim?: (text: string) => void
  onError?: (error: string) => void
  /** 会话结束：continuous=false 时浏览器说完一句就自行结束，必须靠它复位 UI */
  onEnd?: () => void
}

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean, 0?: { transcript?: string } }>
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike
    webkitSpeechRecognition?: new () => RecognitionLike
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function useSpeechRecognition() {
  const supported = ref(false)
  const listening = ref(false)

  let recognition: RecognitionLike | null = null
  let active = false

  function stop() {
    // 未启动 / 已被浏览器 onend 时再 stop() 会抛 InvalidStateError，用 active 挡住
    if (recognition && active) {
      try {
        recognition.stop()
      } catch {
        /* 已停止，忽略 */
      }
    }
    active = false
    listening.value = false
  }

  function start(options: SpeechRecognitionOptions = {}) {
    const Ctor = recognitionCtor()
    if (!Ctor) return
    // 每次 start 重新建实例并清零：复用实例会让上一会话的 onresult 继续往新会话吐文本
    const rec = new Ctor()
    let finalText = ''
    rec.lang = options.lang ?? 'zh-CN'
    rec.continuous = options.continuous ?? true
    rec.interimResults = options.interimResults ?? true
    rec.maxAlternatives = options.maxAlternatives ?? 1

    rec.onresult = (event) => {
      let interimText = ''
      // 从 resultIndex 开始：更早的 result 已经累加过，重头遍历会让最终文本翻倍
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i]
        if (!res) continue
        const transcript = res[0]?.transcript ?? ''
        if (res.isFinal) finalText += transcript
        else interimText += transcript
      }
      if (finalText) options.onFinal?.(finalText)
      options.onInterim?.(interimText)
    }
    rec.onerror = (event) => {
      active = false
      listening.value = false
      options.onError?.(String(event.error || 'error'))
      options.onEnd?.()
    }
    rec.onend = () => {
      active = false
      listening.value = false
      options.onEnd?.()
    }

    recognition = rec
    try {
      rec.start()
      active = true
      listening.value = true
    } catch {
      // 重复 start 抛 InvalidStateError，忽略（与源页面一致）
    }
  }

  onMounted(() => {
    supported.value = recognitionCtor() !== null
  })

  onBeforeUnmount(stop)

  return { supported, listening, start, stop }
}
