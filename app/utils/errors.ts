/**
 * 错误文案统一映射（审计 P1-1 / 维度三-1）：
 * - humanError：常见技术错误（网络/显存/WebGPU）→ 人话
 * - mediaError：getUserMedia 权限/设备错误 → 人话 + 指引（复用 FaceCamera 模式）
 * 原始 message 由调用方通过 description 折叠展示，不直接作为主文案。
 */
export function humanError(e: unknown, t: (key: string) => string): string {
  const msg = (e instanceof Error ? e.message : String(e ?? '')).trim()
  if (!msg) return t('errors.unknown')
  const m = msg.toLowerCase()
  if (/fetch failed|failed to fetch|networkerror|load failed|timeout|aborted|enetdown/.test(m)) {
    return t('errors.network')
  }
  if (/out of memory|oom|memory limit|allocation failed/.test(m)) {
    return t('errors.oom')
  }
  if (/webgpu|navigator\.gpu/.test(m)) {
    return t('errors.webgpu')
  }
  return msg
}

/** getUserMedia / 设备 API 错误 → 分类人话（NotAllowedError/NotFoundError/NotReadableError/非安全上下文） */
export function mediaError(e: unknown, t: (key: string) => string): string {
  const name = (e as DOMException)?.name || ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return t('errors.permission')
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return t('errors.deviceNotFound')
  if (name === 'NotReadableError' || name === 'TrackStartError') return t('errors.deviceBusy')
  if (name === 'NotSupportedError') return t('errors.unsupported')
  return humanError(e, t)
}
