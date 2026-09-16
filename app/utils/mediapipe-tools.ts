/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MediaPipe 任务 → ImageTool 映射（能力 × 引擎双轴的第二块拼图）。
 *
 * 覆盖 MediaPipe 引擎页的全部任务：visionTasks 里的 8 个标准任务
 * + 底层同为 MediaPipe 的 3 个（selfie segmenter / MagicTouch 交互分割 / image embedder）。
 *
 * 归属通过 `pages` 表达：能力页（detection / classification / segmentation / matting / pose / face）
 * 与引擎页（mediapipe）多对多；侧栏 `section` 按页面解析（能力页显示引擎名，引擎页显示任务族）。
 *
 * 能力页里 MediaPipe 实现排在前（模型小、出结果快），YOLO 实现在 imageTools 汇总里排后。
 */
import type { ImagePageSlug, ImageTool } from '~/utils/image-tools'
import { mediapipeModels, mediapipeWasm } from '~/utils/mediapipe'
import { visionTasks, type VisionTaskConfig } from '~/utils/mediapipe-vision'
import * as ai from '~/utils/image-ai'

/** 侧栏小节（i18n key） */
const SEC = {
  mediapipe: 'image.sections.mediapipe',
  face: 'image.sections.face',
  handsPose: 'image.sections.handsPose',
  detection: 'image.sections.detection',
  segmentation: 'image.sections.segmentation',
  embedding: 'image.sections.embedding'
} as const

type InfoRow = { label: string, value: string }
type Params = Record<string, number | string | boolean>

function toCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.putImageData(imageData, 0, 0)
  return canvas
}

/** 从 MediaPipe 结果里抽出可读信息行（沿用原 vision/[slug].vue 的展示口径） */
function infoFor(r: any, lang: 'zh' | 'en'): InfoRow[] {
  const zh = lang === 'zh'
  if (r?.detections?.length) {
    return r.detections.slice(0, 10).map((d: any) => ({
      label: d.categories?.[0]?.categoryName || 'object',
      value: `${Math.round((d.categories?.[0]?.score || 0) * 100)}%`
    }))
  }
  if (r?.classifications?.[0]?.categories?.length) {
    return r.classifications[0].categories.slice(0, 10).map((c: any) => ({
      label: c.categoryName || '?',
      value: `${Math.round((c.score || 0) * 100)}%`
    }))
  }
  if (r?.gestures?.length) {
    return r.gestures.slice(0, 5).map((g: any) => ({
      label: g[0]?.categoryName || '—',
      value: `${Math.round((g[0]?.score || 0) * 100)}%`
    }))
  }
  if (r?.faceLandmarks?.length) {
    const rows: InfoRow[] = [{ label: zh ? '人脸数' : 'Faces', value: `${r.faceLandmarks.length}` }]
    const blends = r.faceBlendshapes?.[0]?.categories ?? []
    for (const b of blends.slice(0, 6)) {
      rows.push({ label: b.categoryName || '?', value: `${Math.round((b.score || 0) * 100)}%` })
    }
    return rows
  }
  if (r?.poseLandmarks?.length) {
    return [{ label: zh ? '人体数' : 'Poses', value: `${r.poseLandmarks.length} · ${r.poseLandmarks[0].length} pts` }]
  }
  if (r?.landmarks?.length) {
    return [{ label: zh ? '手数' : 'Hands', value: `${r.landmarks.length} · ${r.landmarks[0].length} pts` }]
  }
  return []
}

// ===== 实时检测器缓存 =====

const liveDetectors = new Map<string, any>()
/** 每个任务的最近一次 setOptions 快照（避免逐帧重复 setOptions） */
const liveOptions = new Map<string, string>()

async function getLiveDetector(key: string, cfg: VisionTaskConfig) {
  const cached = liveDetectors.get(key)
  if (cached) return cached
  const { FilesetResolver } = await import('@mediapipe/tasks-vision')
  const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
  const det = await cfg.create(vision)
  liveDetectors.set(key, det)
  return det
}

/** 参数变化时才调用 setOptions（默认真值切换等） */
async function syncOptions(key: string, det: any, params: Params) {
  const snap = JSON.stringify(params)
  if (liveOptions.get(key) === snap) return
  await det.setOptions(params)
  liveOptions.set(key, snap)
}

function closeLiveDetector(key: string) {
  const det = liveDetectors.get(key)
  if (det) {
    try {
      det.close?.()
    } catch {
      /* ignore */
    }
    liveDetectors.delete(key)
    liveOptions.delete(key)
  }
}

// ===== visionTasks 里的 8 个标准任务 =====

function visionTaskTool(
  key: string,
  opts: { pages: ImagePageSlug[], section: Record<string, string>, name: { zh: string, en: string } }
): ImageTool {
  const cfg = visionTasks[key]!
  return {
    id: key,
    pages: opts.pages,
    name: opts.name,
    kind: 'mediapipe',
    section: opts.section,
    resolvedParams: t => (cfg.params ? cfg.params(t) : []),
    run: async ({ imageData, params, lang }) => {
      const { imageData: out, result } = await ai.mediaPipeImageResult(
        imageData, cfg.create, cfg.method, cfg.draw, params as Params
      )
      return { imageData: out, info: infoFor(result, lang) }
    },
    live: {
      ensure: async () => {
        await getLiveDetector(key, cfg)
      },
      runFrame: async (video, ts, params, lang) => {
        if (video.readyState < 2 || !video.videoWidth) return null
        const det = await getLiveDetector(key, cfg)
        await syncOptions(key, det, params)
        const w = video.videoWidth
        const h = video.videoHeight
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.drawImage(video, 0, 0, w, h)
        const res = det[cfg.method](canvas, ts)
        if (cfg.draw) cfg.draw(ctx, res)
        return { imageData: ctx.getImageData(0, 0, w, h), info: infoFor(res, lang) }
      },
      dispose: () => closeLiveDetector(key)
    }
  }
}

export const mediaPipeTaskTools: ImageTool[] = [
  visionTaskTool('face-detection', {
    pages: ['mediapipe', 'face'],
    section: { mediapipe: SEC.face, face: SEC.mediapipe },
    name: { zh: '人脸检测', en: 'Face Detection' }
  }),
  visionTaskTool('face-landmarker', {
    pages: ['mediapipe', 'face'],
    section: { mediapipe: SEC.face, face: SEC.mediapipe },
    name: { zh: '人脸关键点', en: 'Face Landmarks' }
  }),
  visionTaskTool('hand-landmarker', {
    pages: ['mediapipe'],
    section: { mediapipe: SEC.handsPose },
    name: { zh: '手部关键点', en: 'Hand Landmarks' }
  }),
  visionTaskTool('gesture-recognizer', {
    pages: ['mediapipe'],
    section: { mediapipe: SEC.handsPose },
    name: { zh: '手势识别', en: 'Gesture Recognition' }
  }),
  visionTaskTool('pose-landmarker', {
    pages: ['mediapipe', 'pose'],
    section: { mediapipe: SEC.handsPose, pose: SEC.mediapipe },
    name: { zh: '全身姿态（33 点）', en: 'Pose (33 landmarks)' }
  }),
  visionTaskTool('holistic-landmarker', {
    pages: ['mediapipe'],
    section: { mediapipe: SEC.handsPose },
    name: { zh: '整体检测（脸 + 手 + 姿态）', en: 'Holistic (face + hands + pose)' }
  }),
  visionTaskTool('object-detector', {
    pages: ['mediapipe', 'detection'],
    section: { mediapipe: SEC.detection, detection: SEC.mediapipe },
    name: { zh: '目标检测', en: 'Object Detection' }
  }),
  visionTaskTool('image-classifier', {
    pages: ['mediapipe', 'classification'],
    section: { mediapipe: SEC.detection, classification: SEC.mediapipe },
    name: { zh: '图像分类', en: 'Image Classification' }
  })
]

// ===== 人像分割 / 抠图（selfie segmenter，分割与抠图共用同一个模型）=====

let selfieLiveDetector: any = null

async function getSelfieLiveDetector() {
  if (selfieLiveDetector) return selfieLiveDetector
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
  const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
  selfieLiveDetector = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: mediapipeModels.selfieSegmenter, delegate: 'GPU' },
    runningMode: 'VIDEO',
    outputCategoryMask: true,
    outputConfidenceMasks: false
  })
  return selfieLiveDetector
}

const selfieTool: ImageTool = {
  id: 'selfie-segment',
  pages: ['mediapipe', 'segmentation', 'matting'],
  name: { zh: '人像分割 / 抠图', en: 'Person Segmentation / Matting' },
  description: {
    zh: 'MediaPipe selfie segmenter：输出人像掩码；抠图模式输出透明背景。',
    en: 'MediaPipe selfie segmenter: person mask; matting mode returns a transparent background.'
  },
  kind: 'mediapipe',
  section: { mediapipe: SEC.segmentation, segmentation: SEC.mediapipe, matting: SEC.mediapipe },
  params: [{
    key: 'mode',
    label: { zh: '输出', en: 'Output' },
    type: 'select',
    default: 'overlay',
    options: [
      { label: { zh: '叠加掩码', en: 'Overlay mask' }, value: 'overlay' },
      { label: { zh: '透明背景（抠图）', en: 'Transparent (matting)' }, value: 'transparent' }
    ],
    help: {
      zh: '抠图模式请下载 PNG 以保留透明通道。',
      en: 'In matting mode, download as PNG to keep the alpha channel.'
    }
  }],
  run: async ({ imageData, params, lang }) => {
    const matting = String(params.mode || 'overlay') === 'transparent'
    const out = await ai.segmentImage(imageData, matting ? 'background-removal' : 'overlay')
    return {
      imageData: out,
      info: [{
        label: lang === 'zh' ? '模式' : 'Mode',
        value: lang === 'zh' ? (matting ? '透明背景' : '叠加掩码') : (matting ? 'Transparent' : 'Overlay')
      }]
    }
  },
  live: {
    ensure: async () => {
      await getSelfieLiveDetector()
    },
    runFrame: async (video, ts, _params, lang) => {
      if (video.readyState < 2 || !video.videoWidth) return null
      const det = await getSelfieLiveDetector()
      const w = video.videoWidth
      const h = video.videoHeight
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(video, 0, 0, w, h)
      const res = det.segmentForVideo(video, ts)
      const mask = res.categoryMask
      if (mask) {
        const m = mask.getAsUint8Array()
        const overlay = ctx.createImageData(w, h)
        const px = overlay.data
        for (let i = 0; i < m.length && i * 4 < px.length; i++) {
          if (m[i] > 0) {
            px[i * 4] = 0
            px[i * 4 + 1] = 220
            px[i * 4 + 2] = 130
            px[i * 4 + 3] = 140
          }
        }
        const tmp = document.createElement('canvas')
        tmp.width = w
        tmp.height = h
        tmp.getContext('2d')?.putImageData(overlay, 0, 0)
        ctx.drawImage(tmp, 0, 0)
        mask.close()
      }
      return {
        imageData: ctx.getImageData(0, 0, w, h),
        info: [{ label: lang === 'zh' ? '模式' : 'Mode', value: 'overlay' }]
      }
    },
    dispose: () => {
      try {
        selfieLiveDetector?.close?.()
      } catch {
        /* ignore */
      }
      selfieLiveDetector = null
    }
  }
}

// ===== 交互式分割（MagicTouch，点提示 → 掩码）=====

let interactiveSegmenter: any = null
let interactiveDelegate: 'GPU' | 'CPU' = 'GPU'

async function createInteractiveSegmenter(delegate: 'GPU' | 'CPU') {
  const { FilesetResolver, InteractiveSegmenter } = await import('@mediapipe/tasks-vision')
  const vision = await FilesetResolver.forVisionTasks(mediapipeWasm.vision)
  return InteractiveSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: mediapipeModels.magicTouch, delegate }
  })
}

async function getInteractiveSegmenter() {
  if (interactiveSegmenter) return interactiveSegmenter
  try {
    interactiveSegmenter = await createInteractiveSegmenter('GPU')
    interactiveDelegate = 'GPU'
  } catch {
    interactiveSegmenter = await createInteractiveSegmenter('CPU')
    interactiveDelegate = 'CPU'
  }
  return interactiveSegmenter
}

const interactiveTool: ImageTool = {
  id: 'interactive-segment',
  pages: ['mediapipe', 'segmentation'],
  name: { zh: '交互式分割（点选）', en: 'Interactive Segmentation (point)' },
  description: {
    zh: '点击图片上的目标，一键抠出该区域（MediaPipe MagicTouch，点提示）。',
    en: 'Click a target in the image to cut it out (MediaPipe MagicTouch, point prompt).'
  },
  kind: 'mediapipe',
  section: { mediapipe: SEC.segmentation, segmentation: SEC.mediapipe },
  interactive: 'prompt',
  run: async ({ imageData, params, lang }) => {
    const nx = Number(params.promptX)
    const ny = Number(params.promptY)
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      return {
        imageData,
        info: [{ label: lang === 'zh' ? '提示' : 'Hint', value: lang === 'zh' ? '请先在图片上点击一个目标' : 'Click a target in the image first' }]
      }
    }
    const canvas = toCanvas(imageData)
    const bitmap = await createImageBitmap(canvas)
    try {
      const segment = async () => {
        const seg = await getInteractiveSegmenter()
        seg.setImage(bitmap)
        return seg.segment([{
          brushMode: 1,
          point: [{ x: nx * bitmap.width, y: ny * bitmap.height }],
          isCompleted: true
        }])
      }
      let mask: any
      try {
        mask = await segment()
      } catch (e) {
        if (interactiveDelegate === 'GPU') {
          interactiveSegmenter = null
          interactiveSegmenter = await createInteractiveSegmenter('CPU')
          interactiveDelegate = 'CPU'
          mask = await segment()
        } else {
          throw e
        }
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return { imageData }
      if (mask) {
        const m = mask.getAsUint8Array()
        const out = ctx.createImageData(canvas.width, canvas.height)
        const px = out.data
        for (let i = 0; i < m.length && i * 4 < px.length; i++) {
          if (m[i] > 0) {
            px[i * 4] = 0
            px[i * 4 + 1] = 220
            px[i * 4 + 2] = 130
            px[i * 4 + 3] = 140
          }
        }
        const tmp = document.createElement('canvas')
        tmp.width = canvas.width
        tmp.height = canvas.height
        tmp.getContext('2d')?.putImageData(out, 0, 0)
        ctx.drawImage(tmp, 0, 0)
        mask.close()
      }
      return {
        imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
        info: [{ label: lang === 'zh' ? '后端' : 'Backend', value: interactiveDelegate }]
      }
    } finally {
      bitmap.close()
    }
  }
}

// ===== 图像嵌入 / 相似度（MediaPipe ImageEmbedder）=====

const embedderTool: ImageTool = {
  id: 'image-embedder',
  pages: ['mediapipe'],
  name: { zh: '图像嵌入 / 相似度', en: 'Image Embedding / Similarity' },
  description: {
    zh: '提取图像向量；上传第二张图时计算余弦相似度。',
    en: 'Extract an image embedding; add a second image to compute cosine similarity.'
  },
  kind: 'mediapipe',
  section: { mediapipe: SEC.embedding },
  needsSecondImage: true,
  run: async ({ imageData, secondImage, lang }) => {
    const v1 = await ai.imageEmbedding(imageData)
    const zh = lang === 'zh'
    const head = Array.from(v1.slice(0, 6)).map(v => v.toFixed(3)).join(', ')
    const info: InfoRow[] = [
      { label: zh ? '向量维度' : 'Dimension', value: `${v1.length}` },
      { label: zh ? '前 6 维' : 'First 6 values', value: `[${head}, …]` }
    ]
    if (secondImage) {
      const v2 = await ai.imageEmbedding(secondImage)
      info.push({ label: zh ? '余弦相似度' : 'Cosine similarity', value: ai.cosineSimilarity(v1, v2).toFixed(4) })
    } else {
      info.push({ label: zh ? '提示' : 'Hint', value: zh ? '上传第二张图可计算相似度' : 'Add a second image to compare' })
    }
    return { imageData, info }
  }
}

/** MediaPipe 引擎页与相关能力页共用的全部任务工具 */
export const mediaPipeTools: ImageTool[] = [
  ...mediaPipeTaskTools,
  selfieTool,
  interactiveTool,
  embedderTool
]

/** 供外部（如测试/调试）显式释放实时检测器 */
export function disposeMediaPipeLive() {
  liveDetectors.forEach((det) => {
    try {
      det.close?.()
    } catch {
      /* ignore */
    }
  })
  liveDetectors.clear()
  liveOptions.clear()
}
