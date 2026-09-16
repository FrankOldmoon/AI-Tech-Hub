/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Transformers.js 音频引擎（除 Whisper 外）：wav2vec2 语音情绪识别。
 *
 * 搬移自 app/pages/speech/emotion.vue：文件模式「整段分析」+ 麦克风「滑动窗口实时评估」。
 * 原页面里这两半共用同一个分类器单例（模型只下载一次）与同一套 webgpu→wasm 回退，
 * 这里原样保留：分类器提升为模块级单例，file 的 run 与 live 的 prepare/frame 都走它。
 *
 * 与源页面唯一的结构性差异：`live.frame` 是**同步**接口（见 audio-tools 的 AudioLiveSpec），
 * 而 wav2vec2 推理是异步的，所以 frame 只负责「攒窗口 + 触发推理」，算完后把结果暂存，
 * 由下一帧取走（无新结果时返回 null）。滑窗状态机本身复用 utils/emotion-stream.ts 的纯函数。
 */
import type { AudioTool, AudioToolContext, AudioToolResult } from '~/utils/audio-tools'
import { setupTransformersEnv, preferredDevice } from '~/utils/transformers'
import { parseDownloadProgress } from '~/utils/audio-progress'
import {
  createWindowState, pushSamples, latestWindow, enoughStep, windowTime,
  type WindowState
} from '~/utils/emotion-stream'

/** 与源页面完全一致：onnx-community 转换的 wav2vec2 情绪模型（已随 pnpm models:fetch 预取到 .models/transformers/） */
const MODEL_ID = 'onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX'

type EmotionScore = { label: string, score: number }

type InfoRow = { label: string, value: string }

/**
 * 情绪类别 → 双语显示名。源页面走 i18n `emotion.label.*`，但工具层不允许新增 key
 * （见重构计划 §4 硬性规则 4/6），故在此内联同一套译文，语义与 zh/en 语言包逐条对应。
 */
const EMOTION_NAMES: Record<string, { zh: string, en: string }> = {
  angry: { zh: '生气', en: 'Angry' },
  disgust: { zh: '厌恶', en: 'Disgust' },
  fear: { zh: '害怕', en: 'Fear' },
  happy: { zh: '开心', en: 'Happy' },
  neutral: { zh: '平静', en: 'Neutral' },
  sad: { zh: '悲伤', en: 'Sad' },
  surprise: { zh: '惊讶', en: 'Surprise' }
}

/** 情绪名本地化；模型若给出未知类别（非 7 类之一）则回落原始 label，与源页面 i18n 回落行为一致 */
function emotionName(label: string, lang: 'zh' | 'en'): string {
  const known = EMOTION_NAMES[label.toLowerCase()]
  return known ? known[lang] : label
}

function hintRow(lang: 'zh' | 'en', zh: string, en: string): InfoRow {
  return { label: lang === 'zh' ? '提示' : 'Hint', value: lang === 'zh' ? zh : en }
}

/** pipeline 输出归一化：源页面用 `r.label || '?'` / `Number(r.score) || 0` 兜底 */
function mapOut(out: unknown): EmotionScore[] {
  return (Array.isArray(out) ? out : []).map((r: any) => ({
    label: r.label || '?',
    score: Number(r.score) || 0
  }))
}

/** 分数分布行；pipeline 输出已按分数降序，故首行即 top1（源页面整段结果的条形列表同序） */
function emotionRows(list: EmotionScore[], lang: 'zh' | 'en'): InfoRow[] {
  return list.map(r => ({
    label: emotionName(r.label, lang),
    value: `${(r.score * 100).toFixed(1)}%`
  }))
}

// ===== 分类器单例（file 与 live 共用，等价源页面脚本里的 classifierPromise）=====

let classifierPromise: Promise<any> | null = null
/** 首次加载时探测；WebGPU 初始化失败后改写为 wasm，后续结果里的 device 即取自它 */
let activeDevice: 'webgpu' | 'wasm' | null = null

function loadClassifier(ctx: AudioToolContext): Promise<any> {
  if (classifierPromise) return classifierPromise
  const p = (async () => {
    await setupTransformersEnv()
    const { pipeline } = await import('@huggingface/transformers')
    const onProgress = (raw: any) => {
      // 下载进度样板统一走 parseDownloadProgress；文案由 playground 渲染
      const parsed = parseDownloadProgress(raw)
      if (parsed) ctx.onProgress?.(parsed)
    }
    // 设备探测延到首次调用（模块在 SSR 阶段也会被 import，那时没有 navigator）
    activeDevice = preferredDevice()
    const first = activeDevice
    const options = { device: first, progress_callback: onProgress }
    try {
      return await pipeline('audio-classification', MODEL_ID, options)
    } catch (e) {
      // 源页面同款回退：WebGPU 起不来（驱动/显存）时用 WASM 重建
      if (first === 'webgpu') {
        activeDevice = 'wasm'
        return await pipeline('audio-classification', MODEL_ID, { ...options, device: 'wasm' })
      }
      throw e
    }
  })()
  classifierPromise = p
  // 源页面里失败后 classifierPromise 保持 rejected（页面随组件卸载自然作废）；
  // 注册表是模块级长生命周期，一次下载失败会永久卡死，故失败时清缓存留给用户重试
  p.catch(() => {
    classifierPromise = null
  })
  return p
}

// ===== 文件模式：整段分析（源页面 analyzeFile）=====

async function runEmotion(ctx: AudioToolContext): Promise<AudioToolResult> {
  const { lang } = ctx
  // ctx.samples 已由 playground 解码成 16kHz 单声道，这里不再自行解码（硬性规则 3）
  if (!ctx.samples || ctx.samples.length === 0) {
    return { info: [hintRow(lang, '请先选择音频文件', 'Choose an audio file first')] }
  }
  if (ctx.isCancelled?.()) return { info: [] }
  const cls = await loadClassifier(ctx)
  if (ctx.isCancelled?.()) return { info: [] }
  // 源页面对整段音频直接推理（不分窗），此处保持一致
  const out = await cls(ctx.samples)
  if (ctx.isCancelled?.()) return { info: [] }
  return { info: emotionRows(mapOut(out), lang), device: activeDevice ?? undefined }
}

// ===== 实时模式：3s 窗 / 1.5s 步进（源页面 startRecording + maybeAnalyzeLive）=====

let liveWin: WindowState = createWindowState()
let lastAnalyzedTotal = 0
let analyzing = false
/** 已算完、等下一帧取走的结果（frame 是同步接口，异步推理只能这样回吐） */
let pendingResult: AudioToolResult | null = null
/** 会话号：prepare 时自增，用于丢弃上一会话迟到的推理结果（等价源页面的 recording/cancelled 守卫） */
let sessionId = 0

async function analyzeWindow(
  audio: Float32Array,
  at: number,
  analyzedTotal: number,
  lang: 'zh' | 'en',
  ctx: AudioToolContext,
  session: number
): Promise<void> {
  try {
    const cls = await loadClassifier(ctx)
    const out = await cls(audio)
    if (session !== sessionId) return
    pendingResult = {
      info: [
        ...emotionRows(mapOut(out), lang),
        { label: lang === 'zh' ? '窗口起点' : 'Window start', value: `${at.toFixed(1)}s` }
      ],
      device: activeDevice ?? undefined
    }
    // 只在成功后推进游标，语义与源页面一致（lastAnalyzedTotal = analyzedTotal）
    lastAnalyzedTotal = analyzedTotal
  } catch {
    // 源页面失败时不推进游标，然后 finally 递归重试 → 持续失败会变成热循环；
    // 这里仍推进游标，等价于「本窗口已消费」，避免同一窗口反复重算打满 CPU
    if (session === sessionId) lastAnalyzedTotal = analyzedTotal
  } finally {
    analyzing = false
  }
}

const speechEmotion: AudioTool = {
  id: 'speech-emotion',
  pages: ['audio-classification'],
  section: { 'audio-classification': 'speech.sections.transformers', '*': 'speech.sections.emotion' },
  name: { zh: '语音情感识别 (SER)', en: 'Speech Emotion Recognition (SER)' },
  description: {
    zh: 'wav2vec2 情绪分类：上传语音整段分析，或开麦按 3 秒窗口实时评估（首次需下载模型）。',
    en: 'wav2vec2 emotion classification: analyze a whole clip, or listen live in 3-second windows (first run downloads the model).'
  },
  kind: 'transformers',
  inputs: ['file', 'live'],
  run: runEmotion,
  live: {
    mode: 'frames',
    prepare: async (ctx) => {
      // 新会话：窗口状态机归零，等价源页面 startRecording 里的 win = createWindowState()
      liveWin = createWindowState()
      lastAnalyzedTotal = 0
      analyzing = false
      pendingResult = null
      sessionId++
      // 源页面是「先开麦、模型并行下载」；playground 的契约是 prepare 里加载模型（进度经 onProgress 展示）
      await loadClassifier(ctx)
    },
    frame: (samples, ctx) => {
      pushSamples(liveWin, samples)
      if (!analyzing && enoughStep(liveWin, lastAnalyzedTotal)) {
        analyzing = true
        // 快照必须在 await 之前取：推理期间缓冲继续滚动，时间戳与游标会偏到最新窗口上（源页面同款注释）
        const audio = latestWindow(liveWin)
        const at = Math.max(0, windowTime(liveWin))
        const analyzedTotal = liveWin.total
        void analyzeWindow(audio, at, analyzedTotal, ctx.lang, ctx, sessionId)
      }
      const out = pendingResult
      pendingResult = null
      return out
    }
    // 模型常驻（与源页面一致，只有页面卸载才释放），故不实现 dispose
  }
}

export const transformersAudioTools: AudioTool[] = [speechEmotion]
