/** 上传前置校验（审计维度三-3）：类型 + 大小，超限立即提示，不等服务端报错 */
export const UPLOAD_LIMITS = {
  audio: 50 * 1024 * 1024,
  image: 20 * 1024 * 1024,
  video: 100 * 1024 * 1024
} as const

export type UploadKind = keyof typeof UPLOAD_LIMITS

export function validateUpload(file: File, kind: UploadKind, t: (key: string, params?: Record<string, unknown>) => string): string | null {
  if (kind === 'audio' && !/^(audio\/|video\/)/.test(file.type)) return t('upload.typeAudio')
  if (kind === 'image' && !file.type.startsWith('image/')) return t('upload.typeImage')
  if (kind === 'video' && !file.type.startsWith('video/')) return t('upload.typeVideo')
  const max = UPLOAD_LIMITS[kind]
  if (file.size > max) return t('upload.tooLarge', { size: `${max / 1024 / 1024}MB` })
  return null
}
