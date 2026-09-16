/**
 * Edge TTS 引擎（微软在线合成的服务端代理，见 server/api/speech/tts.post.ts）。
 *
 * 与其它工具最大的不同：**参数选项来自接口**。微软的 voice list 端点要求特定 UA，
 * 浏览器直连会被跨域挡住，因此走 server 的 /api/speech/tts-voices 代理（服务端缓存 12h）。
 * 这就是 AudioTool 需要 `asyncParams` 的原因——静态 `params` 装不下「选项要等接口」。
 *
 * 代价：合成时文本会离开浏览器（服务端转发给微软），这一点必须写在描述里，
 * 与本地 Kokoro 形成对照，正是 /speech/tts 这个能力页要教的差异。
 */
import type { AudioTool, AudioToolContext, AudioToolResult } from '~/utils/audio-tools'
import type { LocalizedParamOption, LocalizedParamSpec } from '~/utils/localized'

interface EdgeVoice {
  shortName: string
  locale: string
  gender: string
  friendlyName: string
}

const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'

/** 兜底音色：接口不可用时也要能选（与 server 侧 FALLBACK_VOICES 保持同风格） */
const FALLBACK_VOICES: EdgeVoice[] = [
  { shortName: 'zh-CN-XiaoxiaoNeural', locale: 'zh-CN', gender: 'Female', friendlyName: 'Xiaoxiao' },
  { shortName: 'zh-CN-YunxiNeural', locale: 'zh-CN', gender: 'Male', friendlyName: 'Yunxi' },
  { shortName: 'en-US-AriaNeural', locale: 'en-US', gender: 'Female', friendlyName: 'Aria' },
  { shortName: 'en-US-GuyNeural', locale: 'en-US', gender: 'Male', friendlyName: 'Guy' },
  { shortName: 'ja-JP-NanamiNeural', locale: 'ja-JP', gender: 'Female', friendlyName: 'Nanami' }
]

function genderLabel(gender: string, zh: boolean): string {
  const female = gender.toLowerCase().startsWith('f')
  if (zh) return female ? '女' : '男'
  return female ? 'Female' : 'Male'
}

/** 音色按 locale 分组——微软有 300+ 个音色，平铺成一个下拉根本没法选。
 *  不需要 lang 参数：label 里两种 locale 都写全，由 buildParamSpecs 按当前语言取。 */
function toVoiceOptions(voices: EdgeVoice[]): LocalizedParamOption[][] {
  const byLocale = new Map<string, EdgeVoice[]>()
  for (const v of voices) {
    const list = byLocale.get(v.locale)
    if (list) list.push(v)
    else byLocale.set(v.locale, [v])
  }
  return [...byLocale.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([locale, list]) => [
      // 组标题：Nuxt UI Select 的 type:'label' 条目
      { label: { zh: locale, en: locale }, type: 'label' as const },
      ...list.map(v => ({
        // 两种 locale 各自完整：zh 用中文性别、en 用英文性别（不能共用同一个值）
        label: {
          zh: `${v.friendlyName} · ${genderLabel(v.gender, true)}`,
          en: `${v.friendlyName} · ${genderLabel(v.gender, false)}`
        },
        value: v.shortName
      }))
    ])
}

/** 百分比类参数：-50%..+50%，0 为原样。存数值、发给接口时拼成 '+N%' 形式 */
function percentOption(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}%`
}

function hzOption(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}Hz`
}

function paramsFor(voiceOptions: LocalizedParamOption[][]): LocalizedParamSpec[] {
  return [
    {
      key: 'voice',
      label: { zh: '音色', en: 'Voice' },
      type: 'select',
      default: DEFAULT_VOICE,
      options: voiceOptions,
      help: { zh: '按语言分组；列表来自服务端代理（微软接口有跨域限制）。', en: 'Grouped by language; the list comes from a server proxy (the Microsoft endpoint blocks CORS).' }
    },
    {
      key: 'rate',
      label: { zh: '语速', en: 'Rate' },
      type: 'slider',
      default: 0,
      min: -50,
      max: 50,
      step: 10,
      help: { zh: '百分比偏移，0 为原样。', en: 'Percentage offset; 0 leaves it unchanged.' }
    },
    {
      key: 'pitch',
      label: { zh: '音调', en: 'Pitch' },
      type: 'slider',
      default: 0,
      min: -50,
      max: 50,
      step: 10,
      help: { zh: 'Hz 偏移，0 为原样。', en: 'Hz offset; 0 leaves it unchanged.' }
    },
    {
      key: 'volume',
      label: { zh: '音量', en: 'Volume' },
      type: 'slider',
      default: 0,
      min: -50,
      max: 50,
      step: 10,
      help: { zh: '百分比偏移，0 为原样。', en: 'Percentage offset; 0 leaves it unchanged.' }
    }
  ]
}

/** 拉取音色列表；失败时抛错，由调用方决定是否退回静态兜底 */
async function fetchVoices(): Promise<EdgeVoice[]> {
  const res = await fetch('/api/speech/tts-voices')
  if (!res.ok) throw new Error(`voice list HTTP ${res.status}`)
  const data = await res.json() as { voices?: EdgeVoice[] }
  const voices = data.voices ?? []
  if (!voices.length) throw new Error('voice list empty')
  return voices
}

async function synthesize(ctx: AudioToolContext): Promise<AudioToolResult> {
  const text = (ctx.text ?? '').trim()
  const zh = ctx.lang === 'zh'
  if (!text) {
    return {
      info: [{ label: zh ? '提示' : 'Hint', value: zh ? '请先输入要朗读的文本' : 'Type the text to read aloud first' }]
    }
  }
  ctx.onProgress?.({ percent: 0, file: '', status: 'synth', done: false })
  const started = performance.now()
  const res = await fetch('/api/speech/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice: String(ctx.params.voice ?? DEFAULT_VOICE),
      rate: percentOption(Number(ctx.params.rate ?? 0)),
      pitch: hzOption(Number(ctx.params.pitch ?? 0)),
      volume: percentOption(Number(ctx.params.volume ?? 0))
    })
  })
  if (!res.ok) {
    // 服务端把失败原因放在 statusMessage 里，原样透出更好排查
    throw new Error(`${res.status} ${res.statusText}`)
  }
  const blob = await res.blob()
  const ms = Math.round(performance.now() - started)
  return {
    audio: { blob, filename: 'edge-tts.mp3' },
    // 后端标注沿用视觉侧 P0.1：这是服务端合成的，与本地 Kokoro 必须能一眼区分
    device: 'server',
    info: [
      { label: zh ? '音色' : 'Voice', value: String(ctx.params.voice ?? DEFAULT_VOICE) },
      { label: zh ? '耗时' : 'Elapsed', value: `${ms} ms` },
      { label: zh ? '隐私' : 'Privacy', value: zh ? '文本会发送到服务端（再转发微软）' : 'Text is sent to the server (then to Microsoft)' }
    ]
  }
}

export const edgeTtsAudioTools: AudioTool[] = [
  {
    id: 'edge-tts',
    pages: ['tts'],
    name: { zh: 'Edge TTS（服务端合成）', en: 'Edge TTS (server-side)' },
    description: {
      zh: '微软 Edge 的在线 TTS，由本站服务端代理调用。音色数量多（300+）、零下载、即点即用，但文本会离开浏览器。',
      en: 'Microsoft Edge online TTS proxied by this site\'s server. Hundreds of voices, zero download, instant — but your text leaves the browser.'
    },
    kind: 'edge',
    section: { '*': 'speech.sections.edge' },
    inputs: ['text'],
    // 音色选项要等接口：静态 params 先给兜底，asyncParams 拿到完整列表后替换
    params: paramsFor(toVoiceOptions(FALLBACK_VOICES)),
    asyncParams: async () => {
      try {
        return paramsFor(toVoiceOptions(await fetchVoices()))
      } catch {
        // 接口挂了（或代理降级前失败）就用兜底音色，不能让下拉变空
        return paramsFor(toVoiceOptions(FALLBACK_VOICES))
      }
    },
    run: synthesize
  }
]
