/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * YOLO26 七任务 → ImageTool 映射（能力 × 引擎双轴的第一块拼图）。
 *
 * 目的：让同一个任务同时出现在「引擎页」（/vision/yolo，列举该模型库全部任务）
 * 与对应「能力页」（/vision/detection 等，与 MediaPipe 实现并列对比）。
 * 归属通过 `pages` 表达，侧栏用 `section: 'YOLO'` 分组。
 *
 * 静态图走 run（preprocessImageData），摄像头实时走 live（preprocess），
 * 两条路径共用 useYolo 的同一套预处理与 postprocess 绘制，结果一致。
 */
import type { ImagePageSlug, ImageTool, ImageToolResult } from '~/utils/image-tools'
import type { LocalizedParamSpec } from '~/utils/localized'
import type { YoloModel } from '~/utils/yolo/models'
import { MODELS } from '~/utils/yolo/models'
import { getYoloSession, preprocess, preprocessImageData } from '~/composables/useYolo'
import { drawScoreList } from '~/utils/canvas-overlay'
import {
  drawBoxes, drawDepth, drawObb, drawPose, drawSeg, drawSem, postprocess
} from '~/utils/yolo/postprocess'

/** 任务 → 能力页归属；未列出的（obb）只有 YOLO 一个实现，留在引擎页 */
const CAPABILITY_PAGE: Record<string, ImagePageSlug | undefined> = {
  detect: 'detection',
  cls: 'classification',
  seg: 'segmentation',
  sem: 'segmentation',
  depth: 'depth',
  pose: 'pose',
  obb: 'yolo'
}

const CONF_PARAM: LocalizedParamSpec = {
  key: 'conf',
  label: { zh: '置信度阈值', en: 'Confidence threshold' },
  type: 'slider',
  default: 0.25,
  min: 0.05,
  max: 0.95,
  step: 0.05
}

function pagesFor(id: string): ImagePageSlug[] {
  const cap = CAPABILITY_PAGE[id]
  return cap && cap !== 'yolo' ? ['yolo', cap] : ['yolo']
}

function toCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.putImageData(imageData, 0, 0)
  return canvas
}

type InfoRow = { label: string, value: string }

/** 把 postprocess 结果画到 canvas 并汇总信息行（静态图与实时共用） */
function paint(
  ctx: CanvasRenderingContext2D,
  res: ReturnType<typeof postprocess>,
  w: number,
  h: number,
  lang: 'zh' | 'en'
): InfoRow[] {
  const zh = lang === 'zh'
  const info: InfoRow[] = []
  const pushDets = (dets: { label: string, score: number }[]) => {
    for (const d of dets.slice(0, 8)) {
      info.push({ label: d.label, value: `${Math.round(d.score * 100)}%` })
    }
  }
  switch (res.type) {
    case 'boxes':
      drawBoxes(ctx, res.dets)
      info.push({ label: zh ? '检出目标' : 'Objects', value: `${res.dets.length}` })
      pushDets(res.dets)
      break
    case 'pose':
      drawPose(ctx, res.dets)
      info.push({ label: zh ? '检出人体' : 'Persons', value: `${res.dets.length}` })
      break
    case 'obb':
      drawObb(ctx, res.dets)
      info.push({ label: zh ? '有向框' : 'Oriented boxes', value: `${res.dets.length}` })
      pushDets(res.dets)
      break
    case 'seg':
      drawSeg(ctx, res.dets)
      info.push({ label: zh ? '实例数' : 'Instances', value: `${res.dets.length}` })
      pushDets(res.dets)
      break
    case 'sem':
      drawSem(ctx, res, w, h)
      info.push({ label: zh ? '语义掩码' : 'Semantic mask', value: `${res.w}×${res.h}` })
      break
    case 'depth':
      drawDepth(ctx, res, w, h)
      info.push({ label: zh ? '深度图' : 'Depth map', value: `${res.w}×${res.h}` })
      break
    case 'cls':
      drawScoreList(ctx, res.top5)
      for (const t of res.top5) {
        info.push({ label: t.label, value: `${(t.score * 100).toFixed(1)}%` })
      }
      break
  }
  return info
}

type LiveParams = Record<string, number | string | boolean>

/** 单帧推理：跑 session 并返回 postprocess 结果 */
async function runSession(model: YoloModel, p: { tensor: any } & Parameters<typeof postprocess>[2], conf: number) {
  const { session } = await getYoloSession(model)
  const results = await session.run({ [session.inputNames[0]]: p.tensor })
  const outputs = session.outputNames.map((n: string) => results[n])
  return postprocess(model.id, outputs, p, conf)
}

/** 静态图路径：返回叠加绘制后的 ImageData + 信息行 */
async function inferImage(
  model: YoloModel, imageData: ImageData, conf: number, lang: 'zh' | 'en'
): Promise<ImageToolResult> {
  const p = await preprocessImageData(imageData, model.imgsz, model.id === 'cls')
  const res = await runSession(model, p, conf)
  const canvas = toCanvas(imageData)
  const ctx = canvas.getContext('2d')
  if (!ctx) return { imageData }
  if (res.type === 'sem' || res.type === 'depth') {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
  const info = paint(ctx, res, canvas.width, canvas.height, lang)
  return { imageData: ctx.getImageData(0, 0, canvas.width, canvas.height), info }
}

/** 摄像头路径：返回叠加绘制后的 ImageData + 信息行 */
async function inferVideo(
  model: YoloModel, video: HTMLVideoElement, conf: number, lang: 'zh' | 'en'
): Promise<ImageToolResult | null> {
  const p = await preprocess(video, model.imgsz, model.id === 'cls')
  const res = await runSession(model, p, conf)
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (res.type === 'sem' || res.type === 'depth') ctx.clearRect(0, 0, w, h)
  else ctx.drawImage(video, 0, 0, w, h)
  const info = paint(ctx, res, w, h, lang)
  return { imageData: ctx.getImageData(0, 0, w, h), info }
}

function makeTool(model: YoloModel): ImageTool {
  return {
    id: `yolo-${model.id}`,
    pages: pagesFor(model.id),
    name: { zh: model.nameZh, en: model.nameEn },
    description: {
      zh: `YOLO26n ${model.nameZh}（ONNX Runtime 本地推理）`,
      en: `YOLO26n ${model.nameEn} via ONNX Runtime, fully local`
    },
    kind: 'yolo',
    section: { '*': 'image.sections.yolo' },
    /* 分类的「结果」就是原图 + 左上角 top5 标注，左右对比没有信息量，单图展示 */
    singlePane: model.id === 'cls',
    params: model.needConf ? [CONF_PARAM] : [],
    run: ({ imageData, params, lang }) =>
      inferImage(model, imageData, Number(params.conf ?? 0.25), lang),
    live: {
      ensure: async () => {
        await getYoloSession(model)
      },
      runFrame: (video: HTMLVideoElement, _ts: number, params: LiveParams, lang: 'zh' | 'en') => {
        if (video.readyState < 2 || !video.videoWidth) return null
        return inferVideo(model, video, Number(params.conf ?? 0.25), lang)
      }
    }
  }
}

/** YOLO 引擎页与各能力页共用的任务工具集（顺序 = MODELS 顺序） */
export const yoloTools: ImageTool[] = MODELS.map(makeTool)
