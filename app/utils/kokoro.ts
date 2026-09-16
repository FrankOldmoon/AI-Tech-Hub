// Kokoro TTS 浏览器端封装：本地 ONNX/WASM 推理，不依赖服务端 edge-tts
// 模型与 voices 由 server/routes/model/[...].ts 从 .models/ 以 Range(206) 服务
import { hasWebGPU } from './transformers'
import { encodeWav } from './wav'

export interface KokoroVoice {
  id: string
  /** 英文 voice 有官方昵称；多语言 voice 无公开昵称时与 id 相同 */
  name: string
  lang: string
  gender: 'female' | 'male'
}

/** bundle 内嵌的英文 voice 元数据（名称），按 kokoro 官方表整理 */
const enUsNames: Record<string, string> = {
  af_heart: 'Heart', af_alloy: 'Alloy', af_aoede: 'Aoede', af_bella: 'Bella',
  af_jessica: 'Jessica', af_kore: 'Kore', af_nicole: 'Nicole', af_nova: 'Nova',
  af_river: 'River', af_sarah: 'Sarah', af_sky: 'Sky',
  am_adam: 'Adam', am_echo: 'Echo', am_eric: 'Eric', am_fenrir: 'Fenrir',
  am_liam: 'Liam', am_michael: 'Michael', am_onyx: 'Onyx', am_puck: 'Puck', am_santa: 'Santa'
}
const enGbNames: Record<string, string> = {
  bf_alice: 'Alice', bf_emma: 'Emma', bf_isabella: 'Isabella', bf_lily: 'Lily',
  bm_daniel: 'Daniel', bm_fable: 'Fable', bm_george: 'George', bm_lewis: 'Lewis'
}

/** 语言标签（按 Kokoro voice id 前缀命名约定） */
function langOf(id: string): string {
  if (/^af_|^am_/.test(id)) return 'en-us'
  if (/^bf_|^bm_/.test(id)) return 'en-gb'
  if (/^zf_|^zm_/.test(id)) return 'zh'
  if (/^jf_|^jm_/.test(id)) return 'ja'
  if (/^ef_|^em_/.test(id)) return 'es'
  if (/^ff_/.test(id)) return 'fr'
  if (/^hf_|^hm_/.test(id)) return 'hi'
  if (/^if_|^im_/.test(id)) return 'it'
  if (/^pf_|^pm_/.test(id)) return 'pt'
  return 'en-us'
}

function genderOf(id: string): 'female' | 'male' {
  return /^[abefhzjm]f_|^[bz]f_/.test(id) || /^[af]f_|^[bjhimp]f_/.test(id)
    ? 'female'
    : /^[a-z]m_/.test(id) ? 'male' : 'female'
}

function buildVoice(id: string, names: Record<string, string>): KokoroVoice {
  return { id, name: names[id] || id, lang: langOf(id), gender: genderOf(id) }
}

/** 全部可用 voice（Oz/仓库 55 个 bin 中的可选项；af.bin 总集不单独列出） */
/** 多语言 voice：无公开昵称，直接用 id 展示 */
const multiLangVoiceIds: string[] = [
  'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoxiao', 'zf_xiaoyi',
  'zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang',
  'jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo',
  'ef_dora', 'em_alex', 'em_santa',
  'ff_siwis',
  'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi',
  'if_sara', 'im_nicola',
  'pf_dora', 'pm_alex', 'pm_santa'
]

export const kokoroVoices: KokoroVoice[] = [
  ...Object.keys(enUsNames).map(id => buildVoice(id, enUsNames)),
  ...Object.keys(enGbNames).map(id => buildVoice(id, enGbNames)),
  ...multiLangVoiceIds.map(id => buildVoice(id, {}))
]

export const kokoroVoiceGroups = [
  { lang: 'en-us', label: 'English (US)' },
  { lang: 'en-gb', label: 'English (UK)' },
  { lang: 'zh', label: '中文' },
  { lang: 'ja', label: '日本語' },
  { lang: 'es', label: 'Español' },
  { lang: 'fr', label: 'Français' },
  { lang: 'hi', label: 'हिन्दी' },
  { lang: 'it', label: 'Italiano' },
  { lang: 'pt', label: 'Português' }
]

export interface KokoroProgress {
  status: string
  file?: string
  progress?: number
}

type KokoroEnv = {
  wasmPaths: string
}

type KokoroTTSInstance = {
  generate: (text: string, opts: { voice: string, speed: number }) => Promise<{ audio: Float32Array, sampling_rate: number }>
}

/** KVT：bundle 内 voice 校验器（默认只放行 28 个英文 voice），为避免误伤中文 voice，
 * 加载后覆盖为浅校验（voice 存在性交给后续 voices/{id}.bin 下载 404 把关） */
type KokoroVoiceValidator = {
  _validate_voice(voice: string): string
}

type KokoroWebModule = {
  KokoroTTS: {
    from_pretrained: (
      modelId: string,
      opts: { dtype: string, device: string, progress_callback?: (p: KokoroProgress) => void }
    ) => Promise<KokoroTTSInstance>
    prototype: KokoroVoiceValidator
  }
  env: KokoroEnv
}

let kokoroModulePromise: Promise<KokoroWebModule> | null = null
let fetchRedirectInstalled = false

/** bundle 内 transformers.js 默认 localModelPath=/models/、voices 硬编码 HF URL；
 *  统一重定向到项目本地 /model/transformers/（离线可用）。只拦本次改造需要的两类 URL。
 *  HF 远程 URL 形如 <model>/resolve/main/<file>（或 resolve/<commit>/），本地目录无
 *  resolve 段，须剥掉该段再映射到 /model/transformers/<model>/<file>。 */
function installFetchRedirect() {
  if (fetchRedirectInstalled) return
  fetchRedirectInstalled = true
  const origFetch = window.fetch.bind(window)
  const HF_PREFIX = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/'
  const LOCAL_PREFIX = '/model/transformers/onnx-community/Kokoro-82M-v1.0-ONNX/'
  const stripResolve = (tail: string) => tail.replace(/^resolve\/[^/]+\//, '')
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let url = input
    if (typeof url === 'string') {
      if (url.startsWith(HF_PREFIX)) {
        url = LOCAL_PREFIX + stripResolve(url.slice(HF_PREFIX.length))
      } else if (url.startsWith('/models/')) {
        url = '/model/transformers/' + url.slice('/models/'.length)
      }
    } else if (url instanceof URL) {
      if (url.href.startsWith(HF_PREFIX)) {
        url = new URL(LOCAL_PREFIX + stripResolve(url.href.slice(HF_PREFIX.length)), window.location.origin)
      } else if (url.pathname.startsWith('/models/')) {
        url = new URL('/model/transformers/' + url.pathname.slice('/models/'.length), window.location.origin)
      }
    }
    return origFetch(url as RequestInfo, init)
  }
}

/** 懒加载 kokoro-web.js（约 2MB 单文件 bundle，内嵌 transformers.js + espeak-ng 数据） */
export async function loadKokoroWebModule(): Promise<KokoroWebModule> {
  if (!kokoroModulePromise) {
    installFetchRedirect()
    console.info('[kokoro] bundle 首次加载（约 2MB），仅此一次')
    kokoroModulePromise = import('~/vendor/kokoro-web.js').then((mod) => {
      const m = mod as unknown as KokoroWebModule
      // WASM 后端复用项目 public/vendor/onnx 自托管产物，避免外网 CDN
      m.env.wasmPaths = '/vendor/onnx/'
      // bundle 内置 voice 白名单仅 28 个英文 voice；绕过校验，allow 全部 55 个
      // voice bin（含 zf_/zm_ 中文等）。voices/*.bin 已随模型本地化，由 fetch 重
      // 定向打到 /model/transformers/…/voices/，离线可用。
      const proto = m.KokoroTTS.prototype as unknown as {
        _validate_voice(voice: string): string
      }
      proto._validate_voice = (voice: string) => voice.at(0) ?? ''
      return m
    })
  }
  return kokoroModulePromise
}

let ttsInstance: { tts: KokoroTTSInstance, device: string } | null = null

/** 加载 Kokoro 模型（q8 量化，约 92MB），带进度回调 */
export async function loadKokoroModel(onProgress?: (p: KokoroProgress) => void): Promise<{ tts: KokoroTTSInstance, device: string }> {
  if (ttsInstance) return ttsInstance
  const mod = await loadKokoroWebModule()
  const device = hasWebGPU() ? 'webgpu' : 'wasm'
  const tts = await mod.KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'q8',
    device,
    progress_callback: onProgress
  })
  ttsInstance = { tts, device }
  return ttsInstance
}

/** Float32Array PCM → 16bit WAV blob（Kokoro 固定 24kHz 单声道）。编码实现见 utils/wav */
export function rawAudioToWavBlob(audio: Float32Array, samplingRate: number): Blob {
  return encodeWav(audio, samplingRate)
}

/** 合成文本 → WAV blob */
export async function kokoroSynthesize(
  text: string,
  voice: string,
  speed: number,
  onProgress?: (p: KokoroProgress) => void
): Promise<{ blob: Blob, device: string, ms: number }> {
  const { tts, device } = await loadKokoroModel(onProgress)
  const start = performance.now()
  const raw = await tts.generate(text, { voice, speed })
  const ms = Math.round(performance.now() - start)
  return { blob: rawAudioToWavBlob(raw.audio, raw.sampling_rate), device, ms }
}

export function voiceOptionLabel(v: KokoroVoice): string {
  const lang = kokoroVoiceGroups.find(g => g.lang === v.lang)?.label || v.lang
  return `${v.name} · ${lang} · ${v.gender === 'female' ? '女' : '男'}`
}
