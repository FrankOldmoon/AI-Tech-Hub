/**
 * transformers.js `progress_callback` 归一化。
 *
 * 各语音页原本各写一份 `Math.round(p.loaded / p.total * 100)` + 从文件路径取 basename 的样板
 * （asr / emotion / speech-translate / voice-clone / tts / audiobook / voiceprint 共 7 处）。
 * 这里只做**纯解析**：文案与 i18n 组合仍留给调用方，避免把中文串塞进工具层。
 */
export interface DownloadProgress {
  /** 0..100；事件不含总量信息时为 0 */
  percent: number
  /** 当前文件名（已去目录），非文件粒度事件时为空串 */
  file: string
  /** 原始 status，如 progress / download / ready */
  status: string
  /** 是否已就绪（status 为 ready 或 done） */
  done: boolean
}

/** 把未知形状的 progress 事件解析成统一结构；入参为空时返回 null */
export function parseDownloadProgress(raw: unknown): DownloadProgress | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as { status?: unknown, file?: unknown, loaded?: unknown, total?: unknown, progress?: unknown }
  const status = typeof p.status === 'string' ? p.status : ''
  const file = typeof p.file === 'string' && p.file ? p.file.split('/').pop() || '' : ''

  let percent = 0
  if (typeof p.progress === 'number' && Number.isFinite(p.progress)) {
    percent = Math.round(p.progress)
  } else if (typeof p.loaded === 'number' && typeof p.total === 'number' && p.total > 0) {
    percent = Math.round((p.loaded / p.total) * 100)
  }

  return {
    percent: Math.max(0, Math.min(100, percent)),
    file,
    status,
    done: status === 'ready' || status === 'done'
  }
}
