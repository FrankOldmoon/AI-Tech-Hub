/**
 * 上传文件统一校验（审计 P0-2）：
 * - 必填校验（存在性）
 * - 大小上限（h3 multipart 全量读入内存，必须限制）
 * - MIME 类型 / 扩展名白名单
 *
 * 用法：const err = validateUploadPart(part, rule); if (err) return { ok: false, error: err }
 */
import type { MultiPartData } from 'h3'

export interface UploadRule {
  maxBytes?: number
  allowedMime?: string[]
  allowedExt?: string[]
  /** 字段名，用于错误提示 */
  fieldName?: string
}

export const UPLOAD_LIMITS = {
  image: 20 * 1024 * 1024, // 20MB
  audio: 100 * 1024 * 1024, // 100MB
  video: 300 * 1024 * 1024, // 300MB
  csv: 5 * 1024 * 1024 // 5MB
} as const

const MIME = {
  jpeg: ['image/jpeg', 'image/jpg'],
  png: ['image/png'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  wav: ['audio/wav', 'audio/x-wav', 'audio/wave'],
  mp3: ['audio/mpeg', 'audio/mp3'],
  mp4: ['video/mp4'],
  webm: ['video/webm'],
  csv: ['text/csv', 'application/csv', 'application/vnd.ms-excel']
} as const

export const IMAGE_RULE: UploadRule = {
  maxBytes: UPLOAD_LIMITS.image,
  allowedMime: [...MIME.jpeg, ...MIME.png, ...MIME.webp, ...MIME.gif],
  allowedExt: ['.jpg', '.jpeg', '.png', '.webp', '.gif']
}

export const AUDIO_RULE: UploadRule = {
  maxBytes: UPLOAD_LIMITS.audio,
  allowedMime: [...MIME.wav, ...MIME.mp3, ...MIME.mp4, ...MIME.webm],
  allowedExt: ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.mp4', '.webm', '.opus']
}

export const VIDEO_RULE: UploadRule = {
  maxBytes: UPLOAD_LIMITS.video,
  allowedMime: [...MIME.mp4, ...MIME.webm],
  allowedExt: ['.mp4', '.webm', '.mov', '.mkv']
}

export const CSV_RULE: UploadRule = {
  maxBytes: UPLOAD_LIMITS.csv,
  allowedMime: [...MIME.csv],
  allowedExt: ['.csv', '.txt']
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i).toLowerCase() : ''
}

/** 校验上传分片；合法返回 null，不合法返回错误消息（调用方 return { ok:false, error }） */
export function validateUploadPart(part: MultiPartData | undefined, rule: UploadRule): string | null {
  if (!part?.data?.length) {
    return `缺少上传文件：${rule.fieldName ?? 'file'}`
  }
  if (rule.maxBytes && part.data.length > rule.maxBytes) {
    const mb = Math.round(rule.maxBytes / 1024 / 1024)
    return `文件过大（上限 ${mb}MB）`
  }
  const mime = (part.type ?? '').toLowerCase()
  if (rule.allowedMime?.length && !rule.allowedMime.includes(mime)) {
    return `不支持的文件类型：${mime || '未知'}`
  }
  const ext = extOf(part.filename ?? '')
  if (rule.allowedExt?.length && !rule.allowedExt.includes(ext)) {
    return `不支持的文件扩展名：${ext || '未知'}`
  }
  return null
}
