/**
 * 视觉类 demo 示例图统一入口：
 * - samples：示例图列表（含专属默认图 street.jpg）
 * - fetchSampleFile：拉取示例图并转为 File，供各页复用
 */
export function useVisionSamples() {
  const { t } = useI18n()

  const samples = computed(() => [
    { label: t('samples.face'), url: '/samples/images/face.jpg' },
    { label: t('samples.group'), url: '/samples/images/group.jpg' },
    { label: t('samples.landscape'), url: '/samples/images/landscape.jpg' },
    { label: t('samples.document'), url: '/samples/images/document.jpg' },
    { label: t('samples.street'), url: '/samples/images/street.jpg' }
  ])

  async function fetchSampleFile(url: string): Promise<File> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`sample fetch failed: ${res.status}`)
    const blob = await res.blob()
    return new File([blob], url.split('/').pop() || 'sample.jpg', { type: blob.type })
  }

  return { samples, fetchSampleFile }
}
