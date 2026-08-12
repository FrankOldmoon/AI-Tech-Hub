
export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form) return { ok: false, error: 'Invalid multipart form data' }
  const filePart = form.find((f) => f.name === 'file' && f.filename)
  if (!filePart?.data?.length) return { ok: false, error: '请上传需要修复的图片' }

  const num = (name: string, def: number): number => {
    const v = form.find((f) => f.name === name)?.data?.toString('utf8')
    return v === undefined || v === '' ? def : Number(v)
  }
  const params = {
    fidelity: Math.min(1, Math.max(0, num('fidelity', 0.5))),
    upscale: num('upscale', 2) === 1 ? 1 : 2,
  }
  return enqueuePhotoRestore(filePart, '', params)
})