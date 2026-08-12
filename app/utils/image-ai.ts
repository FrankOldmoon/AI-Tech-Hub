/**
 * 图像工坊 AI 工具辅助层：
 * 复用 MediaPipe Tasks（检测/分类/分割/嵌入）与 Transformers.js（描述/深度），
 * 把 ImageData -> 推理 -> 结果 ImageData / 信息 的流程统一起来。
 * 仅客户端调用（所有 import 均动态）。
 */

import { mediapipeWasm, mediapipeModels } from '~/utils/mediapipe'

function toCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.putImageData(imageData, 0, 0)
  return canvas
}

/** 通用 MediaPipe 推理：创建检测器 -> 推理 -> 在原图上绘制 -> 返回 ImageData + 原始 result */
export async function mediaPipeImageResult(
  imageData: ImageData,
  create: (vision: any) => Promise<any>,
  method: string,
  draw?: (ctx: CanvasRenderingContext2D, result: any) => void,
  setOptions?: Record<string, number | string | boolean>
): Promise<{ imageData: ImageData; result: any }> {
  const { FilesetResolver } = await import('@mediapipe/tasks-vision')
  const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
  const det = await create(vision)
  try {
    if (setOptions && Object.keys(setOptions).length) await det.setOptions(setOptions)
    const bitmap = await createImageBitmap(toCanvas(imageData))
    const result = det[method](bitmap, performance.now())
    const canvas = toCanvas(imageData)
    const ctx = canvas.getContext('2d')!
    if (draw) draw(ctx, result)
    return { imageData: ctx.getImageData(0, 0, canvas.width, canvas.height), result }
  } finally {
    det.close()
  }
}

/** 图像嵌入（ImageEmbedder），返回 L2 归一化向量 */
export async function imageEmbedding(imageData: ImageData): Promise<Float32Array> {
  const { FilesetResolver, ImageEmbedder } = await import('@mediapipe/tasks-vision')
  const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
  const embedder = await ImageEmbedder.createFromOptions(vision, {
    baseOptions: { modelAssetPath: mediapipeModels.imageEmbedder, delegate: 'GPU' },
    l2Normalize: true
  })
  try {
    const bitmap = await createImageBitmap(toCanvas(imageData))
    const res = embedder.embed(bitmap)
    return new Float32Array(res.embeddings[0].floatEmbedding ?? res.embeddings[0].embedding)
  } finally {
    embedder.close()
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9)
}

/** 人体分割：返回前景保留（透明背景）或彩色叠加图 */
export async function segmentImage(
  imageData: ImageData,
  mode: 'background-removal' | 'overlay'
): Promise<ImageData> {
  const { FilesetResolver, ImageSegmenter, DrawingUtils } = await import('@mediapipe/tasks-vision')
  const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
  const segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: mediapipeModels.selfieSegmenter, delegate: 'GPU' },
    runningMode: 'IMAGE',
    outputCategoryMask: true,
    outputConfidenceMasks: false
  })
  try {
    const bitmap = await createImageBitmap(toCanvas(imageData))
    const result = segmenter.segment(bitmap)
    const mask = result.categoryMask
    const maskData = mask.getAsUint8Array()
    if (mode === 'overlay') {
      // 用 DrawingUtils 在画布上叠加半透明绿色
      const canvas = toCanvas(imageData)
      const ctx = canvas.getContext('2d')!
      const d = new DrawingUtils(ctx)
      d.drawCategoryMask(result.categoryMask, ['rgba(0,0,0,0)', 'rgba(0,220,130,0.55)'])
      return ctx.getImageData(0, 0, canvas.width, canvas.height)
    }
    // 背景移除：mask==0 的像素 alpha 置 0
    const out = new ImageData(imageData.width, imageData.height)
    const src = imageData.data
    const dst = out.data
    for (let i = 0; i < src.length; i += 4) {
      const m = maskData[(i / 4) | 0]
      dst[i] = src[i]
      dst[i + 1] = src[i + 1]
      dst[i + 2] = src[i + 2]
      dst[i + 3] = m > 0 ? src[i + 3] : 0
    }
    return out
  } finally {
    segmenter.close()
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = /data:(.*?);base64/.exec(head)?.[1] || 'image/png'
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// ===== Janus-Pro 图像理解（QA） =====

let janus: { model: any; processor: any } | null = null

async function supportsFP16(): Promise<boolean> {
  try {
    const adapter = await (navigator as any).gpu?.requestAdapter()
    return Boolean(adapter?.features?.has('shader-f16'))
  } catch {
    return false
  }
}

/** 用 Janus-Pro-1B 回答关于图片的问题（模型首次需下载 ~1.2GB） */
export async function janusImageQA(imageData: ImageData, question: string, maxTokens = 256): Promise<string> {
  if (!janus) {
    const { setupTransformersEnv, hasWebGPU } = await import('~/utils/transformers')
    await setupTransformersEnv()
    const { env, AutoProcessor, MultiModalityCausalLM } = await import('@huggingface/transformers')
    const prevAllowLocal = env.allowLocalModels
    env.allowLocalModels = false
    const modelId = 'onnx-community/Janus-Pro-1B-ONNX'
    const fp16 = await supportsFP16()
    const dtype = fp16
      ? { prepare_inputs_embeds: 'q4', language_model: 'q4f16', lm_head: 'fp16', gen_head: 'fp16', gen_img_embeds: 'fp16', image_decode: 'fp32' }
      : { prepare_inputs_embeds: 'fp32', language_model: 'q4', lm_head: 'fp32', gen_head: 'fp32', gen_img_embeds: 'fp32', image_decode: 'fp32' }
    const device = hasWebGPU()
      ? { prepare_inputs_embeds: 'wasm', language_model: 'webgpu', lm_head: 'webgpu', gen_head: 'webgpu', gen_img_embeds: 'webgpu', image_decode: 'webgpu' }
      : { prepare_inputs_embeds: 'wasm', language_model: 'wasm', lm_head: 'wasm', gen_head: 'wasm', gen_img_embeds: 'wasm', image_decode: 'wasm' }
    const processor = await AutoProcessor.from_pretrained(modelId)
    const model = await MultiModalityCausalLM.from_pretrained(modelId, { dtype, device })
    env.allowLocalModels = prevAllowLocal
    janus = { model, processor }
  }
  const { TextStreamer } = await import('@huggingface/transformers')
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(imageData, 0, 0)
  const imageUrl = canvas.toDataURL('image/png')
  const conversation = [{ role: '<|User|>', content: '<image_placeholder>\n' + question, images: [imageUrl] }]
  const inputs = await janus.processor(conversation)
  let answer = ''
  const streamer = new TextStreamer(janus.processor.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => { answer += text }
  })
  await janus.model.generate({
    ...inputs,
    max_new_tokens: maxTokens,
    do_sample: false,
    streamer
  })
  return answer.trim()
}
