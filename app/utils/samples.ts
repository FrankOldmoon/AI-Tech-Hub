/** 从 public/samples 加载预置示例素材并转换为 File（P0-4：demo 开箱可玩） */
export async function fetchSample(url: string): Promise<File> {
  const res = await fetch(url)
  const blob = await res.blob()
  return new File([blob], url.split('/').pop() || 'sample', { type: blob.type })
}
