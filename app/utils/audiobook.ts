/**
 * 多角色有声书的纯逻辑：剧本解析 + 音色分配 + 音频拼接。
 * 与页面解耦（不碰 WebAudio / DOM），便于单测；合成由调用方用 utils/kokoro 完成。
 */

export interface ScriptLine {
  /** 角色名；空字符串表示旁白（该行没有「角色：」前缀） */
  role: string
  text: string
}

/** 各语言的候选音色池（Kokoro voice id，见 utils/kokoro.ts 的 kokoroVoices） */
export const VOICE_POOLS: Record<string, string[]> = {
  zh: ['zf_xiaoxiao', 'zm_yunjian', 'zf_xiaoni', 'zm_yunxi', 'zf_xiaobei', 'zm_yunxia', 'zf_xiaoyi', 'zm_yunyang'],
  en: ['af_heart', 'am_adam', 'af_bella', 'am_michael', 'af_nova', 'am_puck', 'af_sarah', 'am_eric']
}

/**
 * 解析剧本：每行一句，支持「角色：台词」与「角色: 台词」（中英文冒号）。
 * 没有冒号的行按旁白处理；空行、空台词、以及「只有角色名没台词」的行都跳过。
 */
export function parseScript(raw: string): ScriptLine[] {
  const out: ScriptLine[] = []
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const m = line.match(/^([^：:]{1,16})[：:](.*)$/)
    if (m) {
      const role = m[1]!.trim()
      const text = stripQuotes(m[2]!.trim())
      // 有冒号就必须有台词，否则忽略（避免把「小明：」当旁白念出来）
      if (role && text) out.push({ role, text })
      continue
    }
    const narration = stripQuotes(line)
    if (narration) out.push({ role: '', text: narration })
  }
  return out
}

/** 去掉台词两端成对的引号/书名号，避免把标点读出来 */
function stripQuotes(s: string): string {
  const pairs: Array<[string, string]> = [['「', '」'], ['“', '”'], ['"', '"'], ['‘', '’'], ['（', '）'], ['(', ')']]
  for (const [l, r] of pairs) {
    if (s.length > 1 && s.startsWith(l) && s.endsWith(r)) return s.slice(l.length, s.length - r.length).trim()
  }
  return s
}

/** 按出场顺序去重收集角色（旁白排最后，读起来更顺） */
export function collectRoles(lines: ScriptLine[]): string[] {
  const seen = new Set<string>()
  const speakers: string[] = []
  let hasNarration = false
  for (const l of lines) {
    if (!l.role) {
      hasNarration = true
      continue
    }
    if (!seen.has(l.role)) {
      seen.add(l.role)
      speakers.push(l.role)
    }
  }
  return hasNarration ? [...speakers, ''] : speakers
}

/** 按出场顺序轮转分配音色；旁白固定用池中最后一个，保证与角色音色不撞 */
export function assignVoices(roles: string[], pool: string[]): Record<string, string> {
  const voices: Record<string, string> = {}
  const speakers = roles.filter(r => r !== '')
  const usable = pool.length > 1 ? pool.slice(0, -1) : pool
  speakers.forEach((role, i) => {
    voices[role] = usable[i % usable.length]!
  })
  if (roles.includes('')) voices[''] = pool[pool.length - 1]!
  return voices
}

/** 把各句音频按顺序拼成一条（句间插入 gapSeconds 静音） */
export function concatChunks(chunks: Float32Array[], sampleRate: number, gapSeconds = 0.25): Float32Array {
  if (!chunks.length) return new Float32Array(0)
  const gap = Math.max(0, Math.round(gapSeconds * sampleRate))
  let total = 0
  for (const c of chunks) total += c.length
  total += gap * (chunks.length - 1)
  const out = new Float32Array(total)
  let offset = 0
  chunks.forEach((c, i) => {
    out.set(c, offset)
    offset += c.length
    if (i < chunks.length - 1) offset += gap
  })
  return out
}
