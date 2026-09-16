/**
 * 语音工具注册表（Audio Tool Registry）—— 与视觉侧 utils/image-tools.ts 同构。
 *
 * 为什么需要它：语音侧原本 17 个页面各自手写实现，同一个「任务」的多种实现（如语音转文字
 * 既有浏览器内建 Web Speech API、又有本地 Whisper）散落在页面内部的 `mode` ref 里，
 * 既无法横向对比、也无法在「引擎页」复用。注册表把「实现」变成数据，页面变成分发。
 *
 * 双轴与视觉侧一致：
 *   - 能力页（asr / tts / audio-classification）：一个任务 × 多种引擎，侧栏按**引擎**分组
 *   - 引擎页（whisper / kokoro / yamnet）：一个引擎 × 多种任务，侧栏按**任务族**分组
 *   - `pages` 多对多：同一个工具可同时挂在能力页与引擎页（这就是「复用」的载体）
 *
 * 与视觉侧的关键差异（决定了 AudioPlayground 的形状）：
 *   语音的输入有三种互不兼容的模态，必须由工具声明 `inputs`：
 *   - 'file'：音频文件 → 16kHz 单声道 samples（Whisper / YAMNet / wav2vec2）
 *   - 'text'：文本（TTS）
 *   - 'live'：麦克风实时流（YAMNet 边听边分类）；实现放在 `live` 字段里逐帧回调
 *   而视觉侧统一是 ImageData 快照，所以 ImagePlayground 不需要这一层。
 */
import type { LocalizedParamSpec, LocalizedText } from '~/utils/localized'
import type { DownloadProgress } from '~/utils/audio-progress'
import { whisperAudioTools } from '~/utils/audio-engines/whisper'
import { kokoroAudioTools } from '~/utils/audio-engines/kokoro'
import { edgeTtsAudioTools } from '~/utils/audio-engines/edge'
import { mediapipeAudioTools } from '~/utils/audio-engines/mediapipe'
import { transformersAudioTools } from '~/utils/audio-engines/transformers'
import { webSpeechAudioTools } from '~/utils/audio-engines/web-speech'

export type AudioPageSlug = 'asr' | 'tts' | 'audio-classification' | 'whisper' | 'kokoro' | 'yamnet'
// ↑ 一行写完：@stylistic/operator-linebreak 要求换行时 `=` 必须行首，多行并集反而更难读

/** 实现层（侧栏第二行展示为大写） */
export type AudioToolKind = 'web-speech' | 'whisper' | 'kokoro' | 'edge' | 'mediapipe' | 'transformers' | 'dsp'

/** 输入模态；工具声明自己吃哪几种，playground 据此渲染输入区 */
export type AudioInputKind = 'file' | 'text' | 'live'

export interface AudioToolContext {
  /** 'file' / 'live' 工具：16kHz 单声道样本（live 模式下为本次录制结果） */
  samples?: Float32Array
  /** 原始文件（需要自行解码到其它采样率的工具用，如 48kHz 参考音） */
  file?: File | null
  /** 'text' 工具：用户输入 */
  text?: string
  params: Record<string, number | string | boolean>
  lang: 'zh' | 'en'
  /** 模型下载进度（transformers.js 等）→ 由 playground 统一展示 */
  onProgress?: (p: DownloadProgress) => void
  /** 长任务请在每个分片前检查；返回 true 表示用户已取消，应尽早返回 */
  isCancelled?: () => boolean
}

export interface AudioToolResult {
  /** 结果行（label / value 两列） */
  info?: { label: string, value: string }[]
  /** 合成/处理后的音频：playground 提供内联播放与下载 */
  audio?: { blob: Blob, filename: string }
  /** 纯文本结果（转写 / 翻译）：playground 提供复制与下载 */
  text?: string
  /** 带时间戳的分段（转写），供导出 SRT */
  segments?: { start: number, end: number, text: string }[]
  /** 本次实际使用的后端（webgpu / wasm / 服务端…），与视觉侧 P0.1 的标注同义 */
  device?: string
}

/**
 * 实时模式实现（`inputs` 含 'live' 时才需要提供）。
 *
 * 两种模式是必须的，因为「实时」在语音里有两类完全不同的东西：
 * - `frames`：模型逐帧吃样本（YAMNet 环境音、wav2vec2 情绪）→ playground 负责开麦与喂帧
 * - `session`：识别过程由浏览器自己驱动、根本没有样本可喂（Web Speech API 只有
 *   onresult 回调）→ 工具自己管理会话，playground 只负责渲染增量结果
 * 把两者混成一个接口会逼出一堆 `if (kind === 'web-speech')` 的补丁。
 */
export interface AudioLiveSpec {
  /** 默认 'frames' */
  mode?: 'frames' | 'session'
  /** 开始实时前调用一次：加载模型 / 检查浏览器能力 */
  prepare?: (ctx: AudioToolContext) => Promise<void>
  /** mode='frames'：逐帧回调；返回 null 表示本帧不更新展示 */
  frame?: (samples: Float32Array, ctx: AudioToolContext) => AudioToolResult | null
  /** mode='session'：由工具自己驱动的会话（如 Web Speech API） */
  session?: {
    /** 是否可用（如浏览器不支持 SpeechRecognition 时返回 false，playground 据此置灰） */
    supported: () => boolean
    /** 开始；通过 emit 增量回吐结果 */
    start: (
      ctx: AudioToolContext,
      emit: (result: AudioToolResult) => void,
      /** 会话结束通知：continuous=false 时浏览器会自行结束，
       *  playground 必须靠它复位「聆听中」状态，否则会一直显示在听 */
      onEnd: () => void
    ) => void | Promise<void>
    /** 停止 */
    stop: () => void
  }
  /** 停止实时时的清理（模型常驻可不实现） */
  dispose?: () => void
}

export interface AudioTool {
  id: string
  /** 归属页面（能力页 / 引擎页多对多） */
  pages: AudioPageSlug[]
  name: LocalizedText
  description?: LocalizedText
  kind: AudioToolKind
  /** 侧栏分组 i18n key：按当前页 slug 解析（能力页写引擎名、引擎页写任务族），`*` 为兜底 */
  section?: Record<string, string>
  /** 支持的输入模态；第一个为默认。仅一种时 playground 不渲染切换器 */
  inputs: AudioInputKind[]
  /** 实时分析实现 */
  live?: AudioLiveSpec
  params?: LocalizedParamSpec[]
  /**
   * 动态参数：选项来自接口时用（如 Edge TTS 的音色列表来自 /api/speech/tts-voices）。
   * 激活该工具时异步取一次，取到后替换 `params`；失败则保留 `params` 兜底。
   */
  asyncParams?: (ctx: { lang: 'zh' | 'en' }) => Promise<LocalizedParamSpec[]>
  /** 运行一次（file / text 模式） */
  run: (ctx: AudioToolContext) => Promise<AudioToolResult>
}

/** 全部语音工具（能力页与引擎页共用同一批数据，归属由 pages 决定） */
export const audioTools: AudioTool[] = [
  ...webSpeechAudioTools,
  ...whisperAudioTools,
  // 能力页里本地实现排在前（与视觉侧一致：模型小的、出结果快的放前面）
  ...kokoroAudioTools,
  ...edgeTtsAudioTools,
  ...mediapipeAudioTools,
  ...transformersAudioTools
]

export function audioToolsByPage(slug: string): AudioTool[] {
  return audioTools.filter(t => t.pages.includes(slug as AudioPageSlug))
}

export function getAudioTool(page: string, toolId: string): AudioTool | undefined {
  return audioTools.find(t => t.pages.includes(page as AudioPageSlug) && t.id === toolId)
}

/** 侧栏第二行的引擎名（大写展示） */
export const audioKindLabels: Record<AudioToolKind, string> = {
  'web-speech': 'Web Speech API',
  'whisper': 'Whisper',
  'kokoro': 'Kokoro',
  'edge': 'Edge TTS',
  'mediapipe': 'MediaPipe',
  'transformers': 'Transformers.js',
  'dsp': 'Web Audio'
}

export interface AudioPageSample {
  labelKey: string
  url: string
}

/**
 * 各页示例音频（labelKey 经 i18n 解析）。
 * 优先选「能听出差别」的素材：中文语音用 speech-zh，噪声鲁棒性用 noisy-speech。
 */
export const audioPageSamples: Partial<Record<AudioPageSlug, AudioPageSample[]>> = {
  'asr': [
    { labelKey: 'samples.speechZh', url: '/samples/audio/speech-zh.wav' },
    { labelKey: 'samples.speech', url: '/samples/audio/speech.wav' },
    { labelKey: 'samples.noisySpeech', url: '/samples/audio/noisy-speech.wav' }
  ],
  'whisper': [
    { labelKey: 'samples.speechZh', url: '/samples/audio/speech-zh.wav' },
    { labelKey: 'samples.speech', url: '/samples/audio/speech.wav' },
    { labelKey: 'samples.noisySpeech', url: '/samples/audio/noisy-speech.wav' }
  ],
  'audio-classification': [
    { labelKey: 'samples.speech', url: '/samples/audio/speech.wav' },
    { labelKey: 'samples.music', url: '/samples/audio/music.wav' },
    { labelKey: 'samples.noisySpeech', url: '/samples/audio/noisy-speech.wav' }
  ],
  'yamnet': [
    { labelKey: 'samples.speech', url: '/samples/audio/speech.wav' },
    { labelKey: 'samples.music', url: '/samples/audio/music.wav' },
    { labelKey: 'samples.noisySpeech', url: '/samples/audio/noisy-speech.wav' }
  ]
}
