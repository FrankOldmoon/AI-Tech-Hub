
export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form) return { ok: false, error: 'Invalid multipart form data' }
  const filePart = form.find((f) => f.name === 'file' && f.filename) ?? null
  const text = String(form.find((f) => f.name === 'text')?.data?.toString('utf8') ?? '')
  const mode = String(form.find((f) => f.name === 'mode')?.data?.toString('utf8') ?? 'text2img')

  if (!text.trim()) return { ok: false, error: '请输入提示词' }
  if (mode === 'img2img' && !filePart?.data?.length) return { ok: false, error: '图生图模式需要上传输入图片' }
  if (filePart?.data?.length) {
    const uploadErr = validateUploadPart(filePart, IMAGE_RULE)
    if (uploadErr) return { ok: false, error: uploadErr }
  }

  const num = (name: string, def: number): number => {
    const v = form.find((f) => f.name === name)?.data?.toString('utf8')
    return v === undefined || v === '' ? def : Number(v)
  }

  const params = {
    mode,
    steps: num('steps', 2),
    guidance: num('guidance', 0),
    seed: num('seed', -1),
    batch: num('batch', 1),
    size: num('size', 512),
    strength: num('strength', 0.75),
  }
  return enqueueSdTurbo(filePart, text, params)
})
