/**
 * Edge-TTS 发音人列表代理
 * 微软 voice list 端点需要与合成请求一致的 UA，浏览器跨域拿不到，故在服务端代理。
 * 结果内存缓存 12h（322 个 voice 全量，避免每次请求打微软）。
 * 失败时降级返回内置常用 voice 子集（zh/en 为主），保证前端下拉始终可用。
 */

const VOICE_LIST_URL
  = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list'
    + '?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4'

const UA
  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    + ' (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0'

const CACHE_TTL_MS = 12 * 60 * 60 * 1000 // 12h

/** 精简微软 FriendlyName："Microsoft Adri Online (Natural) - Afrikaans (South Africa)" → "Adri" */
function shortNameOf(friendly: string, shortName: string): string {
  const cleaned = friendly
    .replace(/^Microsoft\s+/, '')
    .replace(/\s+Online\s+\(Natural\).*$/, '')
    .replace(/\s+Neural.*$/, '')
    .trim()
  return cleaned || shortName
}

interface EdgeVoice {
  shortName: string
  locale: string
  gender: string
  friendlyName: string
}

/** 常用 voice 子集：中文全量 + 英文常用 + 少量主流语种，代理失败时兜底 */
const FALLBACK_VOICES: EdgeVoice[] = [
  // zh-CN
  { shortName: 'zh-CN-XiaoxiaoNeural', locale: 'zh-CN', gender: 'Female', friendlyName: 'Xiaoxiao' },
  { shortName: 'zh-CN-XiaoyiNeural', locale: 'zh-CN', gender: 'Female', friendlyName: 'Xiaoyi' },
  { shortName: 'zh-CN-YunjianNeural', locale: 'zh-CN', gender: 'Male', friendlyName: 'Yunjian' },
  { shortName: 'zh-CN-YunxiNeural', locale: 'zh-CN', gender: 'Male', friendlyName: 'Yunxi' },
  { shortName: 'zh-CN-YunxiaNeural', locale: 'zh-CN', gender: 'Male', friendlyName: 'Yunxia' },
  { shortName: 'zh-CN-YunyangNeural', locale: 'zh-CN', gender: 'Male', friendlyName: 'Yunyang' },
  { shortName: 'zh-CN-liaoning-XiaobeiNeural', locale: 'zh-CN-liaoning', gender: 'Female', friendlyName: 'Xiaobei' },
  { shortName: 'zh-CN-shaanxi-XiaoniNeural', locale: 'zh-CN-shaanxi', gender: 'Female', friendlyName: 'Xiaoni' },
  // zh-TW
  { shortName: 'zh-TW-HsiaoChenNeural', locale: 'zh-TW', gender: 'Female', friendlyName: 'HsiaoChen' },
  { shortName: 'zh-TW-HsiaoYuNeural', locale: 'zh-TW', gender: 'Female', friendlyName: 'HsiaoYu' },
  { shortName: 'zh-TW-YunJheNeural', locale: 'zh-TW', gender: 'Male', friendlyName: 'YunJhe' },
  // zh-HK
  { shortName: 'zh-HK-HiuGaaiNeural', locale: 'zh-HK', gender: 'Female', friendlyName: 'HiuGaai' },
  { shortName: 'zh-HK-HiuMaanNeural', locale: 'zh-HK', gender: 'Female', friendlyName: 'HiuMaan' },
  { shortName: 'zh-HK-WanLungNeural', locale: 'zh-HK', gender: 'Male', friendlyName: 'WanLung' },
  // en-US
  { shortName: 'en-US-AriaNeural', locale: 'en-US', gender: 'Female', friendlyName: 'Aria' },
  { shortName: 'en-US-JennyNeural', locale: 'en-US', gender: 'Female', friendlyName: 'Jenny' },
  { shortName: 'en-US-GuyNeural', locale: 'en-US', gender: 'Male', friendlyName: 'Guy' },
  // en-GB
  { shortName: 'en-GB-SoniaNeural', locale: 'en-GB', gender: 'Female', friendlyName: 'Sonia' },
  { shortName: 'en-GB-RyanNeural', locale: 'en-GB', gender: 'Male', friendlyName: 'Ryan' },
  // en-AU
  { shortName: 'en-AU-NatashaNeural', locale: 'en-AU', gender: 'Female', friendlyName: 'Natasha' },
  { shortName: 'en-AU-WilliamNeural', locale: 'en-AU', gender: 'Male', friendlyName: 'William' },
  // 其他主流语种少量兜底
  { shortName: 'ja-JP-NanamiNeural', locale: 'ja-JP', gender: 'Female', friendlyName: 'Nanami' },
  { shortName: 'ja-JP-KeitaNeural', locale: 'ja-JP', gender: 'Male', friendlyName: 'Keita' },
  { shortName: 'ko-KR-SunHiNeural', locale: 'ko-KR', gender: 'Female', friendlyName: 'SunHi' },
  { shortName: 'fr-FR-DeniseNeural', locale: 'fr-FR', gender: 'Female', friendlyName: 'Denise' },
  { shortName: 'de-DE-KatjaNeural', locale: 'de-DE', gender: 'Female', friendlyName: 'Katja' },
  { shortName: 'es-ES-ElviraNeural', locale: 'es-ES', gender: 'Female', friendlyName: 'Elvira' },
  { shortName: 'pt-BR-FranciscaNeural', locale: 'pt-BR', gender: 'Female', friendlyName: 'Francisca' },
  { shortName: 'it-IT-ElsaNeural', locale: 'it-IT', gender: 'Female', friendlyName: 'Elsa' }
]

let cache: { voices: EdgeVoice[], at: number } | null = null

async function fetchVoiceList(): Promise<EdgeVoice[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(VOICE_LIST_URL, {
      headers: { 'User-Agent': UA },
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`voice list HTTP ${res.status}`)
    const raw = await res.json()
    const list = Array.isArray(raw)
      ? raw
          .filter((v: Record<string, unknown>) =>
            typeof v.ShortName === 'string' && typeof v.Locale === 'string')
          .map((v: Record<string, unknown>) => ({
            shortName: v.ShortName as string,
            locale: v.Locale as string,
            gender: String(v.Gender || ''),
            friendlyName: shortNameOf(String(v.FriendlyName || ''), v.ShortName as string)
          }))
      : []
    if (list.length === 0) throw new Error('voice list empty')
    return list
  } finally {
    clearTimeout(timer)
  }
}

export default defineEventHandler(async () => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { voices: cache.voices, cached: true }
  }
  try {
    const voices = await fetchVoiceList()
    cache = { voices, at: Date.now() }
    return { voices, cached: false }
  } catch (e) {
    // 走兜底子集，避免前端无列表可用
    return { voices: FALLBACK_VOICES, cached: false, degraded: String(e) }
  }
})
