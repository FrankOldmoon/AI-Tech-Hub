/**
 * Whisper 引擎（Transformers.js + 本地 onnx）—— 引擎页 whisper 的任务族：转写 / 翻译。
 *
 * 搬移来源：app/pages/speech/asr.vue 的「文件模式」半部分（脚本 113–254 / 模板 334–411）。
 *
 * 为什么用一个工厂生成两个工具：`transcribe` / `translate` 只差传给 pipeline 的 `task` 一个字段，
 * 其余（三档模型、语言的 auto 语义、dtype、WebGPU→WASM 回退、30s/5s 滑窗）完全一致。
 * 把差异收敛成工厂入参，既让「同引擎的两个任务」在侧栏天然成对，也避免两份 30 行的
 * pipeline 样板各自漂移（这正是本次重构要消掉的重复）。
 *
 * 与源页面的行为差异（仅此三处，均因公共层接管了职责）：
 * - 不再自行解码：`ctx.samples` 已由 playground 解成 16kHz 单声道（源页面此处调 decodeTo16k）；
 * - 不再有「任务」下拉：任务由工具身份决定，直接落到同一个 `task` 调用参数；
 * - 不再自维护 `device` ref：回退结果作为 `device` 字段返回，由 playground 标注。
 */
import type { AudioPageSlug, AudioTool, AudioToolContext, AudioToolResult } from '~/utils/audio-tools'
import type { LocalizedParamSpec } from '~/utils/localized'
import { parseDownloadProgress } from '~/utils/audio-progress'
import { preferredDevice, setupTransformersEnv } from '~/utils/transformers'

/** 同引擎的两个任务；作为工具身份的一部分，不再暴露成参数 */
type WhisperTask = 'transcribe' | 'translate'

/**
 * 三档模型、八个语言、两种精度：与源页面 asr.vue 的 `modelItems` / `fileLangItems` /
 * `dtypeItems` 逐项对应（含体积提示与默认值），改动任何一项都是行为变更而非重构。
 */
const whisperParams: LocalizedParamSpec[] = [
  {
    key: 'model',
    label: { zh: '模型', en: 'Model' },
    type: 'select',
    default: 'Xenova/whisper-base',
    help: { zh: '中文识别建议 base 或 small；small 更准但更慢', en: 'For Chinese audio use base or small; small is more accurate but slower' },
    options: [
      { label: { zh: 'whisper-tiny · 最快 (~75MB)', en: 'whisper-tiny · fastest (~75MB)' }, value: 'Xenova/whisper-tiny' },
      { label: { zh: 'whisper-base · 均衡 (~145MB)', en: 'whisper-base · balanced (~145MB)' }, value: 'Xenova/whisper-base' },
      { label: { zh: 'whisper-small · 更准 (~460MB)', en: 'whisper-small · more accurate (~460MB)' }, value: 'Xenova/whisper-small' }
    ]
  },
  {
    key: 'lang',
    label: { zh: '语言', en: 'Language' },
    type: 'select',
    default: 'chinese',
    help: { zh: 'WebGPU 下自动检测可能回退英文，中文音频建议选择「中文」', en: 'Auto-detect may fall back to English on WebGPU; pick Chinese for Chinese audio' },
    options: [
      { label: { zh: '自动检测', en: 'Auto detect' }, value: 'auto' },
      { label: { zh: '中文', en: 'Chinese' }, value: 'chinese' },
      { label: { zh: 'English', en: 'English' }, value: 'english' },
      { label: { zh: '日本語', en: 'Japanese' }, value: 'japanese' },
      { label: { zh: '한국어', en: 'Korean' }, value: 'korean' },
      { label: { zh: 'Français', en: 'French' }, value: 'french' },
      { label: { zh: 'Deutsch', en: 'German' }, value: 'german' },
      { label: { zh: 'Español', en: 'Spanish' }, value: 'spanish' }
    ]
  },
  {
    key: 'dtype',
    label: { zh: '精度', en: 'Precision' },
    type: 'select',
    default: 'q8',
    options: [
      { label: { zh: 'q8 量化（小/快）', en: 'q8 quantized (small/fast)' }, value: 'q8' },
      { label: { zh: 'fp32 全精度（准）', en: 'fp32 full precision (accurate)' }, value: 'fp32' }
    ]
  }
]

/**
 * 跑一次 Whisper：加载模型（带 WebGPU→WASM 回退）→ 整段推理 → 整理文本与时间戳分段。
 * 源页面的 whisperProgress / whisperStatus 由 `ctx.onProgress` 转交 playground 展示，
 * 因此这里不再拼文案。
 */
async function runWhisper(ctx: AudioToolContext, task: WhisperTask): Promise<AudioToolResult> {
  const samples = ctx.samples
  // playground 只在选到输入后才触发 run；此处兜底，避免把空样本喂给模型（源页面是 uploadRequired 分支）
  if (!samples || samples.length === 0) {
    return {
      info: [{
        label: ctx.lang === 'zh' ? '输入' : 'Input',
        value: ctx.lang === 'zh' ? '请先选择音频文件' : 'Please choose an audio file first'
      }]
    }
  }

  const model = String(ctx.params.model ?? 'Xenova/whisper-base')
  const dtype = String(ctx.params.dtype ?? 'q8') as 'q8' | 'fp32'
  // 'auto' 代表不传 language 交给模型自检（源页面同样是 `lang === 'auto' ? undefined : lang`）
  const language = String(ctx.params.lang ?? 'chinese')
  let device = preferredDevice()

  // whisper 三档已随 `pnpm models:fetch` 预取到 .models/transformers/，默认走本地，
  // 缺失的文件才回退 /api/hf 远程（见 server/utils/model-fetch.mjs）
  await setupTransformersEnv()
  const { pipeline } = await import('@huggingface/transformers')

  const onProgress = (p: unknown) => {
    const parsed = parseDownloadProgress(p)
    if (parsed) ctx.onProgress?.(parsed)
  }

  const build = (dev: 'webgpu' | 'wasm') =>
    pipeline('automatic-speech-recognition', model, { dtype, device: dev, progress_callback: onProgress })

  // 模型加载可能耗时很久（首次下模型），加载前后各查一次取消
  if (ctx.isCancelled?.()) return {}

  let transcriber: Awaited<ReturnType<typeof build>>
  try {
    transcriber = await build(device)
  } catch (e) {
    // WebGPU 失败时回退 WASM（源页面同此）；已是 wasm 还失败说明模型本身加载不了，抛给 playground
    if (device !== 'webgpu') throw e
    device = 'wasm'
    transcriber = await build('wasm')
  }

  if (ctx.isCancelled?.()) return {}

  const output = await transcriber(samples, {
    language: language === 'auto' ? undefined : language,
    task,
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true
  })

  if (ctx.isCancelled?.()) return {}

  const text = (output.text || '').trim()
  // 源页面用 Array.isArray 兜底（模型没开时间戳时 chunks 可能不是数组）；缺 timestamp 的 chunk 也算 0
  const chunks = Array.isArray(output.chunks) ? output.chunks : []
  const segments = chunks.map(c => ({
    start: c.timestamp?.[0] ?? 0,
    end: c.timestamp?.[1] ?? 0,
    text: (c.text || '').trim()
  }))

  return {
    text,
    segments,
    device,
    info: [
      { label: ctx.lang === 'zh' ? '模型' : 'Model', value: model },
      { label: ctx.lang === 'zh' ? '语言' : 'Language', value: language === 'auto' ? (ctx.lang === 'zh' ? '自动检测' : 'Auto detect') : language },
      { label: ctx.lang === 'zh' ? '分段' : 'Segments', value: String(segments.length) },
      { label: ctx.lang === 'zh' ? '推理设备' : 'Device', value: device }
    ]
  }
}

/** 由任务生成一个工具：只有任务名、归属页与分组键不同，其余数据共享 */
function createWhisperTool(task: WhisperTask): AudioTool {
  const translate = task === 'translate'
  const pages: AudioPageSlug[] = translate ? ['whisper'] : ['whisper', 'asr']
  // 能力页 asr 侧栏按引擎分组（whisper 一个引擎占一行）、引擎页 whisper 侧栏按任务族分组
  const section: Record<string, string> = translate
    ? { '*': 'speech.sections.translate' }
    : { 'whisper': 'speech.sections.transcribe', 'asr': 'speech.sections.whisper', '*': 'speech.sections.transcribe' }

  return {
    id: translate ? 'whisper-translate' : 'whisper-transcribe',
    pages,
    section,
    name: translate
      ? { zh: 'Whisper 语音翻译', en: 'Whisper Translation' }
      : { zh: 'Whisper 语音转写', en: 'Whisper Transcription' },
    description: translate
      ? { zh: '用 Whisper 把音频翻译成英文，全程本地推理（首次使用需下载模型）。', en: 'Translate audio into English with Whisper, fully local (first run downloads the model).' }
      : { zh: '选择音频文件，在本地浏览器中转写（数据不上传服务器，首次使用需下载模型）。', en: 'Pick an audio file and transcribe locally in your browser (no upload; first run downloads the model).' },
    kind: 'whisper',
    inputs: ['file'],
    params: whisperParams,
    run: ctx => runWhisper(ctx, task)
  }
}

export const whisperAudioTools: AudioTool[] = [
  createWhisperTool('transcribe'),
  createWhisperTool('translate')
]
