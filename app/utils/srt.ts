/**
 * 字幕分段 → SRT。
 *
 * 单独抽成纯函数，是因为 Whisper 的原始输出有三处必须收尾才能成为合法 SRT：
 * - 末段的 `timestamp[1]` 常为 null（模型不知道话什么时候停）
 * - 相邻段可能重叠（30s 滑窗 + 5s stride 造成）
 * - 空文本段要丢掉（纯音乐/噪声时常出现）
 * 纯函数也便于直接在 node 里跑用例验证（见提交里附的用例）。
 */

export interface SubtitleSegment {
  /** 起始秒 */
  start: number
  /** 结束秒；null 表示模型没给（末段常见） */
  end: number | null
  text: string
}

/** 模型给不出结束时间时的最短时长（秒） */
const MIN_DURATION = 0.8

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/**
 * 秒 → SRT 时间戳 `HH:MM:SS,mmm`。
 * 先化成整毫秒再拆分，这样 0.9996 这类四舍五入引起的进位会自然处理，不会出现 `,1000`。
 */
export function srtTime(seconds: number): string {
  // Math.max(0, NaN) 仍是 NaN，所以先挡掉非有限值，否则会输出 "NaN:NaN:NaN,NaN"
  const safe = Number.isFinite(seconds) ? seconds : 0
  const total = Math.max(0, Math.round(safe * 1000))
  const h = Math.floor(total / 3600000)
  const m = Math.floor(total / 60000) % 60
  const s = Math.floor(total / 1000) % 60
  const ms = total % 1000
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

/**
 * 分段 → SRT 文本。`audioDuration` 为该段音频总时长（秒），用于给末段兜底结束时间。
 * 没有可用分段时返回空串（调用方据此提示「没识别到语音」）。
 */
export function toSrt(segments: SubtitleSegment[], audioDuration = 0): string {
  const clean = segments
    .map(seg => ({
      start: Number.isFinite(seg.start) ? Math.max(0, seg.start) : 0,
      end: typeof seg.end === 'number' && Number.isFinite(seg.end) ? seg.end : null,
      text: seg.text.replace(/\s+/g, ' ').trim()
    }))
    .filter(seg => seg.text)
    .sort((a, b) => a.start - b.start)

  const blocks: string[] = []
  for (let i = 0; i < clean.length; i++) {
    const seg = clean[i]
    if (!seg) continue
    const next = clean[i + 1]
    let end = seg.end !== null && seg.end > seg.start ? seg.end : 0
    if (!end) {
      // 末段没有结束时间：优先顺延到下一段起点，其次是音频总时长，最后给最短时长
      if (next && next.start > seg.start) end = next.start
      else if (audioDuration > seg.start) end = audioDuration
      else end = seg.start + MIN_DURATION
    }
    // 与下一段重叠的区间截断到下一段起点（播放器对重叠的容忍度不一致）
    if (next && next.start > seg.start && end > next.start) end = next.start
    if (!(end > seg.start)) end = seg.start + MIN_DURATION
    blocks.push(`${blocks.length + 1}\n${srtTime(seg.start)} --> ${srtTime(end)}\n${seg.text}`)
  }
  return blocks.length ? `${blocks.join('\n\n')}\n` : ''
}
