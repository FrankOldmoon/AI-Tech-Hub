/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 图像工坊（Image Lab）工具注册表。
 *
 * 与 vision/[slug].vue 的 visionTasks 注册表同构：新增工具 = 注册一条记录 + 实现 run。
 * kind 决定实现层：
 *   - canvas      : 纯浏览器 ImageData 运算（本文件内直接调用 image-algorithms）
 *   - opencv      : OpenCV.js（经典算子）
 *   - mediapipe   : MediaPipe Tasks
 *   - transformers: Transformers.js
 *   - tesseract   : Tesseract.js
 *   - yolo        : ONNX Runtime + YOLO26 模型（utils/yolo/tools.ts 映射）
 *
 * 页面归属：单页工具写 `page`；需要同时出现在能力页与引擎页的工具写 `pages`（多对多）。
 */

import type { ParamSpec } from '~/utils/params'
import { pickText, buildParamSpecs } from '~/utils/localized'
import * as alg from '~/utils/image-algorithms'
import { imageDataToMat, matToImageData, withCvMat } from '~/utils/opencv'
import * as ai from '~/utils/image-ai'
import { loadTesseract, tesseractLocalOptions } from '~/utils/tesseract'
import { yoloTools } from '~/utils/yolo/tools'
import { mediaPipeTools } from '~/utils/mediapipe-tools'
import { sketchTools } from '~/utils/sketch-tools'

export type ImagePageSlug =
  // 图像工坊：经典算法与文档
  | 'viewer'
  | 'transform'
  | 'color'
  | 'adjustment'
  | 'filters'
  | 'enhancement'
  | 'morphology'
  | 'edge'
  | 'object'
  | 'features'
  | 'face'
  | 'ocr'
  // 引擎页：一个模型库的全部任务
  | 'mediapipe'
  | 'yolo'
  | 'transformers'
  // 能力页：同一任务的多引擎实现
  | 'detection'
  | 'classification'
  | 'segmentation'
  | 'matting'
  | 'depth'
  | 'pose'
  | 'sketch'

export type ImageToolKind = 'canvas' | 'opencv' | 'mediapipe' | 'transformers' | 'tesseract' | 'yolo' | 'tfjs'

// 本地化文案 / 参数规范类型已抽到 utils/localized（语音侧 audio-tools 共用同一套数据模型）。
// 注意：这里**不再 re-export**——Nuxt 的自动导入会把两个模块的同名导出都收进来并报
// "Duplicated imports" 警告。需要这些类型的文件请直接从 ~/utils/localized 引入。

export interface ImageToolContext {
  /** 当前工作图像（与原始图像同尺寸，供工具做像素运算） */
  imageData: ImageData
  original: ImageData
  /** 第二张图（needsSecondImage 工具使用，如特征匹配） */
  secondImage?: ImageData
  params: Record<string, number | string | boolean>
  lang: 'zh' | 'en'
}

export interface ImageToolResult {
  imageData?: ImageData
  /** 附加信息行（如取色值、尺寸、模式） */
  info?: { label: string; value: string }[]
  /** 本次推理实际使用的后端（webgpu / wasm / GPU…）。工具自己能确定时填这里；
   *  不填则由 ImagePlayground 按 kind + 本机能力推断，用于运行时标注与能力页对比。 */
  device?: string
}

export interface ImageTool {
  id: string
  /** 主归属页（单页工具写这个） */
  page?: ImagePageSlug
  /** 多归属页：工具同时出现在这些页面（能力页 × 引擎页多对多）；设置后覆盖 page */
  pages?: ImagePageSlug[]
  name: LocalizedText
  description?: LocalizedText
  kind: ImageToolKind
  /** 交互模式：click = 点击结果画布只读像素信息；crop = 原图上可拖拽的裁剪选区框；prompt = 点击坐标喂回推理（交互式分割） */
  interactive?: 'click' | 'crop' | 'prompt'
  /** 需要上传第二张图 */
  needsSecondImage?: boolean
  /** 规划中：仅展示说明，不执行（重型模型/依赖未就绪） */
  planned?: boolean
  /** 需要「手绘画布」作为输入源（简笔画识别类工具）；开启后隐藏上传/示例/拍照入口 */
  needsDrawing?: boolean
  /** 侧栏小节标题（i18n key），按页面给出：能力页按实现引擎分组（MediaPipe / YOLO），引擎页按任务族分组。
   *  键为页面 slug，`*` 为所有页面的默认值。 */
  section?: Record<string, string>
  /** 实时模式：摄像头逐帧推理入口（存在时才显示「实时」开关） */
  live?: {
    /** 创建/预热检测器（首次开启实时时调用） */
    ensure: () => Promise<void>
    /** 逐帧推理（可为异步：调用方会用 busy 守卫避免重入）；返回 null 表示本帧跳过 */
    runFrame: (
      video: HTMLVideoElement,
      ts: number,
      params: Record<string, number | string | boolean>,
      lang: 'zh' | 'en'
    ) => ImageToolResult | null | Promise<ImageToolResult | null>
    /** 释放检测器（关闭实时 / 切换工具 / 卸载） */
    dispose?: () => void
  }
  params?: LocalizedParamSpec[]
  /** 已本地化的参数提供者（MediaPipe 任务直接复用 visionTasks 的 i18n key 解析）；优先于 params */
  resolvedParams?: (t: (key: string) => string) => ParamSpec[]
  run: (ctx: ImageToolContext) => ImageToolResult | Promise<ImageToolResult>
  onPick?: (ctx: ImageToolContext, x: number, y: number) => { label: string; value: string }[]
}

// ===== 小工具 =====

function hint(lang: 'zh' | 'en'): { label: string; value: string }[] {
  return [{
    label: lang === 'zh' ? '提示' : 'Hint',
    value: lang === 'zh' ? '点击结果画布查看像素信息' : 'Click the result canvas to inspect pixels'
  }]
}

function dimsInfo(w: number, h: number, lang: 'zh' | 'en'): { label: string; value: string }[] {
  return [{
    label: lang === 'zh' ? '输出尺寸' : 'Output size',
    value: `${w} × ${h}`
  }]
}

function hexToRgb(hex: string): alg.RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return { r: 255, g: 0, b: 0 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

// ===== 01 Image Viewer =====

const viewerTools: ImageTool[] = [
  {
    id: 'info',
    page: 'viewer',
    name: { zh: '图片信息', en: 'Image Info' },
    description: { zh: '显示尺寸、色彩模式与估算大小。', en: 'Show size, color mode and estimated file size.' },
    kind: 'canvas',
    run: ({ imageData, lang }) => {
      const L = lang === 'zh'
      return {
        imageData,
        info: [
          { label: L ? '宽度' : 'Width', value: `${imageData.width} px` },
          { label: L ? '高度' : 'Height', value: `${imageData.height} px` },
          {
            label: L ? '色彩模式' : 'Color mode',
            value: alg.hasAlpha(imageData)
              ? (L ? 'RGBA（含透明）' : 'RGBA (with alpha)')
              : (L ? 'RGB（不透明）' : 'RGB (opaque)')
          },
          { label: L ? '估算大小（未压缩）' : 'Estimated size (uncompressed)', value: alg.formatBytes(imageData.width * imageData.height * 4) }
        ]
      }
    }
  },
  {
    id: 'pixel-picker',
    page: 'viewer',
    name: { zh: '像素取色', en: 'Pixel Picker' },
    description: { zh: '点击结果画布查看任意像素的 RGB/HSV/HSL/Lab 值。', en: 'Click the result canvas to inspect RGB/HSV/HSL/Lab values of any pixel.' },
    kind: 'canvas',
    interactive: 'click',
    run: ({ imageData, lang }) => ({ imageData, info: hint(lang) }),
    onPick: (ctx, x, y) => alg.pixelInfoRows(alg.pixelInfo(ctx.imageData, x, y), ctx.lang)
  },
  {
    id: 'pixel-grid',
    page: 'viewer',
    name: { zh: '像素网格 Pixel Grid', en: 'Pixel Grid' },
    description: { zh: '把中心区域放大为像素格子，观察单个像素。', en: 'Magnify the center region into a pixel grid.' },
    kind: 'canvas',
    params: [
      { key: 'zoom', label: { zh: '放大倍数', en: 'Zoom' }, type: 'slider', default: 8, min: 2, max: 24, step: 1 },
      { key: 'cx', label: { zh: '中心 X', en: 'Center X' }, type: 'slider', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'cy', label: { zh: '中心 Y', en: 'Center Y' }, type: 'slider', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'grid', label: { zh: '显示网格线', en: 'Show grid' }, type: 'switch', default: true }
    ],
    run: ({ imageData, params }) => ({
      imageData: alg.pixelGrid(
        imageData,
        Number(params.cx) * imageData.width,
        Number(params.cy) * imageData.height,
        Number(params.zoom),
        Boolean(params.grid)
      )
    })
  },
  {
    id: 'pixel-math',
    page: 'viewer',
    name: { zh: '像素运算 Pixel Math', en: 'Pixel Math' },
    description: { zh: '对每个像素做加减乘除运算（含归一化/钳制）。', en: 'Add, subtract, multiply or divide every pixel (clamped).' },
    kind: 'canvas',
    params: [
      {
        key: 'op',
        label: { zh: '运算', en: 'Operation' },
        type: 'select',
        default: 'add',
        options: [
          { label: { zh: '加 Add', en: 'Add' }, value: 'add' },
          { label: { zh: '减 Subtract', en: 'Subtract' }, value: 'subtract' },
          { label: { zh: '乘 Multiply', en: 'Multiply' }, value: 'multiply' },
          { label: { zh: '除 Divide', en: 'Divide' }, value: 'divide' }
        ]
      },
      {
        key: 'value',
        label: { zh: '数值', en: 'Value' },
        type: 'slider',
        default: 30,
        min: -100,
        max: 100,
        step: 1,
        help: {
          zh: '加/减：直接作为像素偏移；乘/除：作为百分比（1 + v/100）因子。',
          en: 'Add/Subtract: pixel offset. Multiply/Divide: percent factor (1 + v/100).'
        }
      }
    ],
    run: ({ imageData, params }) => {
      const op = String(params.op)
      const v = Number(params.value)
      return {
        imageData: alg.applyPixelOp(imageData, (r, g, b, a) => {
          if (op === 'add') return [r + v, g + v, b + v, a]
          if (op === 'subtract') return [r - v, g - v, b - v, a]
          const f = 1 + v / 100
          if (op === 'multiply') return [r * f, g * f, b * f, a]
          const d = f <= 0.05 ? 1 : f
          return [r / d, g / d, b / d, a]
        })
      }
    }
  }
]

// ===== 02 Image Transform =====

const transformTools: ImageTool[] = [
  {
    id: 'resize',
    page: 'transform',
    name: { zh: '缩放 Resize', en: 'Resize' },
    kind: 'canvas',
    params: [
      // width/height 用 slider 拖拽（ImagePlayground 会按原图尺寸动态调整 min/max）
      { key: 'width', label: { zh: '宽度', en: 'Width' }, type: 'slider', default: 800, min: 1, max: 2048, step: 1 },
      { key: 'height', label: { zh: '高度', en: 'Height' }, type: 'slider', default: 600, min: 1, max: 2048, step: 1 },
      // 等比缩放（% 相对原图）：拖动时 width/height 按原图比例同时变化，与 width 双向同步
      { key: 'scale', label: { zh: '等比缩放', en: 'Uniform scale' }, type: 'slider', default: 100, min: 10, max: 300, step: 1 },
      { key: 'keep', label: { zh: '保持宽高比（以宽度为准）', en: 'Keep aspect ratio (by width)' }, type: 'switch', default: false },
      {
        key: 'interpolation',
        label: { zh: '插值方式', en: 'Interpolation' },
        type: 'select',
        default: 'linear',
        options: [
          { label: { zh: '最近邻（马赛克）', en: 'Nearest (pixelated)' }, value: 'nearest' },
          { label: { zh: '双线性（默认，同 OpenCV）', en: 'Bilinear (default, same as OpenCV)' }, value: 'linear' },
          { label: { zh: '高质量（双三次）', en: 'High quality (bicubic)' }, value: 'high' }
        ],
        help: {
          zh: 'OpenCV 经验：放大用双线性/双三次，缩小用区域平均（浏览器 canvas 无区域平均，此处提供最近邻/双线性/双三次三档）。',
          en: 'OpenCV rule: INTER_LINEAR/CUBIC for upscale; INTER_AREA for downscale (canvas has no area-average; three tiers provided).'
        }
      }
    ],
    run: ({ imageData, params, lang }) => {
      const w = Math.max(1, Math.round(Number(params.width) || 800))
      let h = Math.max(1, Math.round(Number(params.height) || 600))
      if (params.keep) h = Math.max(1, Math.round(imageData.height * (w / imageData.width)))
      const interp = String(params.interpolation || 'linear') as alg.ResizeInterpolation
      return {
        imageData: alg.resize(imageData, w, h, interp),
        info: [
          ...dimsInfo(w, h, lang),
          { label: lang === 'zh' ? 'fx（水平缩放比）' : 'fx (horizontal scale)', value: (w / imageData.width).toFixed(2) },
          { label: lang === 'zh' ? 'fy（垂直缩放比）' : 'fy (vertical scale)', value: (h / imageData.height).toFixed(2) }
        ]
      }
    }
  },
  {
    id: 'crop',
    page: 'transform',
    name: { zh: '裁剪 Crop', en: 'Crop' },
    kind: 'canvas',
    interactive: 'crop',
    params: [
      { key: 'x', label: { zh: '起点 X（%）', en: 'X (%)' }, type: 'slider', default: 0, min: 0, max: 90, step: 1 },
      { key: 'y', label: { zh: '起点 Y（%）', en: 'Y (%)' }, type: 'slider', default: 0, min: 0, max: 90, step: 1 },
      { key: 'w', label: { zh: '宽度（%）', en: 'Width (%)' }, type: 'slider', default: 80, min: 10, max: 100, step: 1 },
      { key: 'h', label: { zh: '高度（%）', en: 'Height (%)' }, type: 'slider', default: 80, min: 10, max: 100, step: 1 }
    ],
    run: ({ imageData, params, lang }) => {
      const x = Math.round(imageData.width * (Number(params.x) / 100))
      const y = Math.round(imageData.height * (Number(params.y) / 100))
      const w = Math.min(imageData.width - x, Math.round(imageData.width * (Number(params.w) / 100)))
      const h = Math.min(imageData.height - y, Math.round(imageData.height * (Number(params.h) / 100)))
      return { imageData: alg.crop(imageData, x, y, Math.max(1, w), Math.max(1, h)), info: dimsInfo(Math.max(1, w), Math.max(1, h), lang) }
    }
  },
  {
    id: 'rotate',
    page: 'transform',
    name: { zh: '旋转 Rotate', en: 'Rotate' },
    kind: 'canvas',
    params: [
      { key: 'angle', label: { zh: '角度（度）', en: 'Angle (deg)' }, type: 'slider', default: 90, min: -180, max: 180, step: 1 },
      {
        key: 'bg',
        label: { zh: '背景', en: 'Background' },
        type: 'select',
        default: 'transparent',
        options: [
          { label: { zh: '透明', en: 'Transparent' }, value: 'transparent' },
          { label: { zh: '黑色', en: 'Black' }, value: 'black' },
          { label: { zh: '白色', en: 'White' }, value: 'white' }
        ]
      }
    ],
    run: ({ imageData, params }) => {
      const bg = params.bg === 'black' ? { r: 0, g: 0, b: 0 } : params.bg === 'white' ? { r: 255, g: 255, b: 255 } : null
      return { imageData: alg.rotate(imageData, Number(params.angle), bg) }
    }
  },
  {
    id: 'flip',
    page: 'transform',
    name: { zh: '翻转 Flip', en: 'Flip' },
    kind: 'canvas',
    params: [
      {
        key: 'dir',
        label: { zh: '方向', en: 'Direction' },
        type: 'select',
        default: 'horizontal',
        options: [
          { label: { zh: '水平', en: 'Horizontal' }, value: 'horizontal' },
          { label: { zh: '垂直', en: 'Vertical' }, value: 'vertical' },
          { label: { zh: '水平 + 垂直', en: 'Both' }, value: 'both' }
        ]
      }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.flip(imageData, String(params.dir) as alg.FlipDir) })
  },
  {
    id: 'scale',
    page: 'transform',
    name: { zh: '比例缩放 Scale', en: 'Scale' },
    kind: 'canvas',
    params: [
      { key: 'factor', label: { zh: '缩放倍数', en: 'Factor' }, type: 'slider', default: 1, min: 0.1, max: 4, step: 0.05 }
    ],
    run: ({ imageData, params, lang }) => {
      const f = Number(params.factor)
      return {
        imageData: alg.scale(imageData, f),
        info: dimsInfo(Math.round(imageData.width * f), Math.round(imageData.height * f), lang)
      }
    }
  },
  {
    id: 'pad',
    page: 'transform',
    name: { zh: '边距 Padding', en: 'Padding' },
    kind: 'canvas',
    params: [
      { key: 'top', label: { zh: '上', en: 'Top' }, type: 'number', default: 20, min: 0, max: 500 },
      { key: 'right', label: { zh: '右', en: 'Right' }, type: 'number', default: 20, min: 0, max: 500 },
      { key: 'bottom', label: { zh: '下', en: 'Bottom' }, type: 'number', default: 20, min: 0, max: 500 },
      { key: 'left', label: { zh: '左', en: 'Left' }, type: 'number', default: 20, min: 0, max: 500 },
      {
        key: 'color',
        label: { zh: '填充色', en: 'Fill color' },
        type: 'select',
        default: 'white',
        options: [
          { label: { zh: '白色', en: 'White' }, value: 'white' },
          { label: { zh: '黑色', en: 'Black' }, value: 'black' },
          { label: { zh: '灰色', en: 'Gray' }, value: 'gray' },
          { label: { zh: '透明', en: 'Transparent' }, value: 'transparent' }
        ]
      }
    ],
    run: ({ imageData, params }) => ({
      imageData: alg.pad(
        imageData,
        Number(params.top),
        Number(params.right),
        Number(params.bottom),
        Number(params.left),
        String(params.color) as alg.PadColor
      )
    })
  },
  {
    id: 'perspective',
    page: 'transform',
    name: { zh: '透视变换 Perspective', en: 'Perspective' },
    kind: 'canvas',
    params: [
      { key: 'topInset', label: { zh: '上边内缩', en: 'Top inset' }, type: 'slider', default: 0, min: 0, max: 0.45, step: 0.01 },
      { key: 'bottomInset', label: { zh: '下边内缩', en: 'Bottom inset' }, type: 'slider', default: 0, min: 0, max: 0.45, step: 0.01 },
      { key: 'leftInset', label: { zh: '左边内缩', en: 'Left inset' }, type: 'slider', default: 0, min: 0, max: 0.45, step: 0.01 },
      { key: 'rightInset', label: { zh: '右边内缩', en: 'Right inset' }, type: 'slider', default: 0, min: 0, max: 0.45, step: 0.01 }
    ],
    run: ({ imageData, params, lang }) => {
      const W = imageData.width
      const H = imageData.height
      const ti = Number(params.topInset)
      const bi = Number(params.bottomInset)
      const li = Number(params.leftInset)
      const ri = Number(params.rightInset)
      const srcQuad: [number, number][] = [[0, 0], [W, 0], [W, H], [0, H]]
      const dstQuad: [number, number][] = [
        [W * ti, H * li],
        [W * (1 - ti), H * li],
        [W * (1 - bi), H * (1 - ri)],
        [W * bi, H * (1 - ri)]
      ]
      return { imageData: alg.perspectiveWarp(imageData, srcQuad, dstQuad), info: dimsInfo(imageData.width, imageData.height, lang) }
    }
  },
  {
    id: 'affine',
    page: 'transform',
    name: { zh: '仿射变换 Affine', en: 'Affine' },
    kind: 'canvas',
    params: [
      { key: 'rotateDeg', label: { zh: '旋转（度）', en: 'Rotate (deg)' }, type: 'slider', default: 0, min: -180, max: 180, step: 1 },
      { key: 'scaleX', label: { zh: '水平缩放', en: 'Scale X' }, type: 'slider', default: 1, min: 0.1, max: 3, step: 0.05 },
      { key: 'scaleY', label: { zh: '垂直缩放', en: 'Scale Y' }, type: 'slider', default: 1, min: 0.1, max: 3, step: 0.05 },
      { key: 'shearX', label: { zh: '水平错切', en: 'Shear X' }, type: 'slider', default: 0, min: -1, max: 1, step: 0.02 },
      { key: 'shearY', label: { zh: '垂直错切', en: 'Shear Y' }, type: 'slider', default: 0, min: -1, max: 1, step: 0.02 },
      { key: 'tx', label: { zh: '水平平移', en: 'Translate X' }, type: 'slider', default: 0, min: -0.5, max: 0.5, step: 0.01 },
      { key: 'ty', label: { zh: '垂直平移', en: 'Translate Y' }, type: 'slider', default: 0, min: -0.5, max: 0.5, step: 0.01 }
    ],
    run: ({ imageData, params }) => ({
      imageData: alg.affineWarp(imageData, {
        rotateDeg: Number(params.rotateDeg),
        scaleX: Number(params.scaleX),
        scaleY: Number(params.scaleY),
        shearX: Number(params.shearX),
        shearY: Number(params.shearY),
        tx: Number(params.tx),
        ty: Number(params.ty)
      })
    })
  }
]

// ===== 04 Color Processing =====

const channelOptions = [
  { label: { zh: 'R（红）', en: 'R (Red)' }, value: 'r' },
  { label: { zh: 'G（绿）', en: 'G (Green)' }, value: 'g' },
  { label: { zh: 'B（蓝）', en: 'B (Blue)' }, value: 'b' },
  { label: { zh: 'A（Alpha）', en: 'A (Alpha)' }, value: 'a' },
  { label: { zh: 'HSV-H', en: 'HSV-H' }, value: 'h' },
  { label: { zh: 'HSV-S', en: 'HSV-S' }, value: 's' },
  { label: { zh: 'HSV-V', en: 'HSV-V' }, value: 'v' },
  { label: { zh: 'HSL-L', en: 'HSL-L' }, value: 'l' },
  { label: { zh: 'Lab-L', en: 'Lab-L' }, value: 'la' },
  { label: { zh: 'Lab-b', en: 'Lab-b' }, value: 'lb' }
]

const colorTools: ImageTool[] = [
  {
    id: 'grayscale',
    page: 'color',
    name: { zh: '灰度化 Grayscale', en: 'Grayscale' },
    kind: 'canvas',
    params: [
      {
        key: 'method',
        label: { zh: '方法', en: 'Method' },
        type: 'select',
        default: 'luminance',
        options: [
          { label: { zh: '亮度加权（0.299/0.587/0.114）', en: 'Luminance (0.299/0.587/0.114)' }, value: 'luminance' },
          { label: { zh: '平均值', en: 'Average' }, value: 'average' },
          { label: { zh: '去饱和（最大最小均值）', en: 'Desaturate (min/max avg)' }, value: 'desaturate' }
        ]
      }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.grayscale(imageData, String(params.method) as alg.GrayMethod) })
  },
  {
    id: 'channel-extract',
    page: 'color',
    name: { zh: '通道提取 Channel Extract', en: 'Channel Extract' },
    kind: 'canvas',
    params: [
      { key: 'channel', label: { zh: '通道', en: 'Channel' }, type: 'select', default: 'r', options: channelOptions }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.channelExtract(imageData, String(params.channel) as alg.ChannelKey) })
  },
  {
    id: 'channel-merge',
    page: 'color',
    name: { zh: '通道合并 Channel Merge', en: 'Channel Merge' },
    description: { zh: '把不同来源通道重排为新的 RGB 图像。', en: 'Rearrange channels from different sources into a new RGB image.' },
    kind: 'canvas',
    params: [
      { key: 'rSrc', label: { zh: 'R 来源', en: 'R source' }, type: 'select', default: 'r', options: channelOptions },
      { key: 'gSrc', label: { zh: 'G 来源', en: 'G source' }, type: 'select', default: 'g', options: channelOptions },
      { key: 'bSrc', label: { zh: 'B 来源', en: 'B source' }, type: 'select', default: 'b', options: channelOptions }
    ],
    run: ({ imageData, params }) => ({
      imageData: alg.channelMerge(imageData, String(params.rSrc) as alg.ChannelKey, String(params.gSrc) as alg.ChannelKey, String(params.bSrc) as alg.ChannelKey)
    })
  },
  {
    id: 'color-replace',
    page: 'color',
    name: { zh: '颜色替换 Color Replace', en: 'Color Replace' },
    kind: 'canvas',
    params: [
      { key: 'target', label: { zh: '目标颜色（#RRGGBB）', en: 'Target color (#RRGGBB)' }, type: 'text', default: '#ff0000' },
      { key: 'tolerance', label: { zh: '容差', en: 'Tolerance' }, type: 'slider', default: 60, min: 0, max: 255, step: 1 },
      { key: 'replacement', label: { zh: '替换颜色（#RRGGBB）', en: 'Replacement (#RRGGBB)' }, type: 'text', default: '#0000ff' }
    ],
    run: ({ imageData, params }) => ({
      imageData: alg.colorReplace(imageData, hexToRgb(String(params.target)), Number(params.tolerance), hexToRgb(String(params.replacement)))
    })
  },
  {
    id: 'color-quantize',
    page: 'color',
    name: { zh: '颜色量化 Quantize', en: 'Color Quantize' },
    description: { zh: '用 K-Means 把图像压缩为 k 种主色。', en: 'Compress the image to k dominant colors with K-Means.' },
    kind: 'canvas',
    params: [
      { key: 'k', label: { zh: '颜色数量 k', en: 'Color count k' }, type: 'slider', default: 8, min: 2, max: 16, step: 1 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.colorQuantize(imageData, Number(params.k)) })
  }
]

// ===== 05 Image Adjustment =====

const adjustmentTools: ImageTool[] = [
  {
    id: 'brightness',
    page: 'adjustment',
    name: { zh: '亮度 Brightness', en: 'Brightness' },
    kind: 'canvas',
    params: [
      { key: 'delta', label: { zh: '偏移（-255 ~ 255）', en: 'Offset (-255 ~ 255)' }, type: 'slider', default: 30, min: -255, max: 255, step: 1 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.adjustBrightness(imageData, Number(params.delta)) })
  },
  {
    id: 'contrast',
    page: 'adjustment',
    name: { zh: '对比度 Contrast', en: 'Contrast' },
    kind: 'canvas',
    params: [
      { key: 'factor', label: { zh: '系数', en: 'Factor' }, type: 'slider', default: 1.3, min: 0.1, max: 3, step: 0.05 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.adjustContrast(imageData, Number(params.factor)) })
  },
  {
    id: 'gamma',
    page: 'adjustment',
    name: { zh: '伽马 Gamma', en: 'Gamma' },
    kind: 'canvas',
    params: [
      { key: 'gamma', label: { zh: '伽马值（<1 变亮，>1 变暗）', en: 'Gamma (<1 brighter, >1 darker)' }, type: 'slider', default: 1.2, min: 0.1, max: 3, step: 0.05 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.adjustGamma(imageData, Number(params.gamma)) })
  },
  {
    id: 'saturation',
    page: 'adjustment',
    name: { zh: '饱和度 Saturation', en: 'Saturation' },
    kind: 'canvas',
    params: [
      { key: 'factor', label: { zh: '系数', en: 'Factor' }, type: 'slider', default: 1.5, min: 0, max: 3, step: 0.05 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.adjustSaturation(imageData, Number(params.factor)) })
  },
  {
    id: 'hue',
    page: 'adjustment',
    name: { zh: '色相 Hue', en: 'Hue' },
    kind: 'canvas',
    params: [
      { key: 'shift', label: { zh: '偏移（度）', en: 'Shift (deg)' }, type: 'slider', default: 60, min: -180, max: 180, step: 1 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.adjustHue(imageData, Number(params.shift)) })
  },
  {
    id: 'exposure',
    page: 'adjustment',
    name: { zh: '曝光 Exposure', en: 'Exposure' },
    kind: 'canvas',
    params: [
      { key: 'ev', label: { zh: '曝光补偿 EV', en: 'Exposure (EV)' }, type: 'slider', default: 0.5, min: -3, max: 3, step: 0.1 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.adjustExposure(imageData, Number(params.ev)) })
  },
  {
    id: 'white-balance',
    page: 'adjustment',
    name: { zh: '白平衡 White Balance', en: 'White Balance' },
    kind: 'canvas',
    params: [
      { key: 'temp', label: { zh: '色温（>0 偏暖）', en: 'Temperature (>0 warmer)' }, type: 'slider', default: 0, min: -100, max: 100, step: 1 },
      { key: 'tint', label: { zh: '色调（>0 偏洋红）', en: 'Tint (>0 magenta)' }, type: 'slider', default: 0, min: -100, max: 100, step: 1 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.adjustWhiteBalance(imageData, Number(params.temp), Number(params.tint)) })
  },
  {
    id: 'auto-contrast',
    page: 'adjustment',
    name: { zh: '自动对比度 Auto Contrast', en: 'Auto Contrast' },
    description: { zh: '按亮度百分位自动拉伸对比度。', en: 'Auto-stretch contrast by luminance percentiles.' },
    kind: 'canvas',
    run: ({ imageData }) => ({ imageData: alg.autoContrast(imageData) })
  },
  {
    id: 'auto-brightness',
    page: 'adjustment',
    name: { zh: '自动亮度 Auto Brightness', en: 'Auto Brightness' },
    description: { zh: '把平均亮度自动调整到中灰。', en: 'Shift the mean luminance to mid-gray automatically.' },
    kind: 'canvas',
    run: ({ imageData }) => ({ imageData: alg.autoBrightness(imageData) })
  },
  {
    id: 'levels',
    page: 'adjustment',
    name: { zh: '色阶 Levels', en: 'Levels' },
    description: { zh: '重映射输入黑/白点并做 gamma 校正（Photoshop 色阶的经典三滑块）。', en: 'Remap input black/white points with gamma correction (the classic Levels triad).' },
    kind: 'canvas',
    params: [
      { key: 'black', label: { zh: '输入黑点', en: 'Input black' }, type: 'slider', default: 0, min: 0, max: 254, step: 1 },
      { key: 'white', label: { zh: '输入白点', en: 'Input white' }, type: 'slider', default: 255, min: 1, max: 255, step: 1 },
      { key: 'gamma', label: { zh: 'Gamma（>1 变亮）', en: 'Gamma (>1 brighter)' }, type: 'slider', default: 1, min: 0.2, max: 3, step: 0.05 }
    ],
    run: ({ imageData, params }) => ({
      imageData: alg.colorLevels(
        imageData,
        Number(params.black ?? 0),
        Number(params.white ?? 255),
        Number(params.gamma ?? 1)
      )
    })
  }
]

// ===== 06 Image Filters =====

const filterTools: ImageTool[] = [
  {
    id: 'box-blur',
    page: 'filters',
    name: { zh: '方框模糊 Box Blur', en: 'Box Blur' },
    kind: 'canvas',
    params: [
      { key: 'radius', label: { zh: '半径', en: 'Radius' }, type: 'slider', default: 3, min: 1, max: 20, step: 1 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.boxBlur(imageData, Number(params.radius)) })
  },
  {
    id: 'gaussian-blur',
    page: 'filters',
    name: { zh: '高斯模糊 Gaussian Blur', en: 'Gaussian Blur' },
    kind: 'canvas',
    params: [
      { key: 'radius', label: { zh: '半径', en: 'Radius' }, type: 'slider', default: 3, min: 1, max: 20, step: 1 },
      { key: 'sigma', label: { zh: 'Sigma', en: 'Sigma' }, type: 'slider', default: 1.5, min: 0.2, max: 5, step: 0.1 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.gaussianBlur(imageData, Number(params.radius), Number(params.sigma)) })
  },
  {
    id: 'median-blur',
    page: 'filters',
    name: { zh: '中值模糊 Median Blur', en: 'Median Blur' },
    kind: 'canvas',
    params: [
      {
        key: 'size',
        label: { zh: '窗口大小', en: 'Window size' },
        type: 'select',
        default: 3,
        options: [
          { label: '3 × 3', value: 3 },
          { label: '5 × 5', value: 5 },
          { label: '7 × 7', value: 7 },
          { label: '9 × 9', value: 9 }
        ]
      }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.medianBlur(imageData, Number(params.size)) })
  },
  {
    id: 'motion-blur',
    page: 'filters',
    name: { zh: '运动模糊 Motion Blur', en: 'Motion Blur' },
    kind: 'canvas',
    params: [
      { key: 'length', label: { zh: '长度', en: 'Length' }, type: 'slider', default: 10, min: 2, max: 30, step: 1 },
      { key: 'angle', label: { zh: '角度（度）', en: 'Angle (deg)' }, type: 'slider', default: 45, min: 0, max: 360, step: 5 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.convolve(imageData, alg.motionKernel(Number(params.length), Number(params.angle))) })
  },
  {
    id: 'sharpen',
    page: 'filters',
    name: { zh: '锐化 Sharpen', en: 'Sharpen' },
    kind: 'canvas',
    params: [
      { key: 'amount', label: { zh: '强度', en: 'Amount' }, type: 'slider', default: 1, min: 0.1, max: 5, step: 0.1 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.sharpen(imageData, Number(params.amount)) })
  },
  {
    id: 'unsharp-mask',
    page: 'filters',
    name: { zh: 'USM 锐化 Unsharp Mask', en: 'Unsharp Mask' },
    kind: 'canvas',
    params: [
      { key: 'radius', label: { zh: '半径', en: 'Radius' }, type: 'slider', default: 3, min: 1, max: 10, step: 1 },
      { key: 'amount', label: { zh: '强度', en: 'Amount' }, type: 'slider', default: 1, min: 0.1, max: 3, step: 0.1 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.unsharpMask(imageData, Number(params.radius), Number(params.amount)) })
  },
  {
    id: 'emboss',
    page: 'filters',
    name: { zh: '浮雕 Emboss', en: 'Emboss' },
    kind: 'canvas',
    params: [
      { key: 'angle', label: { zh: '光源方向（度）', en: 'Light angle (deg)' }, type: 'slider', default: 45, min: 0, max: 315, step: 45 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.emboss(imageData, Number(params.angle)) })
  },
  {
    id: 'high-pass',
    page: 'filters',
    name: { zh: '高通滤波 High-pass', en: 'High-pass Filter' },
    kind: 'canvas',
    run: ({ imageData }) => ({ imageData: alg.highPass(imageData) })
  },
  {
    id: 'bilateral',
    page: 'filters',
    name: { zh: '双边滤波 Bilateral', en: 'Bilateral Filter' },
    description: { zh: '空间核 × 值域核的保边平滑：磨平噪声但保留边缘（半径越大越慢）。', en: 'Edge-preserving smoothing with a spatial × range kernel; larger radius is slower.' },
    kind: 'canvas',
    params: [
      { key: 'radius', label: { zh: '半径', en: 'Radius' }, type: 'slider', default: 3, min: 1, max: 8, step: 1 },
      { key: 'sigmaColor', label: { zh: '值域 Sigma', en: 'Range sigma' }, type: 'slider', default: 40, min: 5, max: 120, step: 5 },
      { key: 'sigmaSpace', label: { zh: '空间 Sigma', en: 'Spatial sigma' }, type: 'slider', default: 3, min: 1, max: 10, step: 0.5 }
    ],
    run: ({ imageData, params }) => ({
      imageData: alg.bilateralFilter(
        imageData,
        Number(params.radius ?? 3),
        Number(params.sigmaColor ?? 40),
        Number(params.sigmaSpace ?? 3)
      )
    })
  }
]

// ===== 07 Noise & Enhancement =====

const enhancementTools: ImageTool[] = [
  {
    id: 'add-noise',
    page: 'enhancement',
    name: { zh: '添加噪声 Add Noise', en: 'Add Noise' },
    kind: 'canvas',
    params: [
      {
        key: 'type',
        label: { zh: '噪声类型', en: 'Noise type' },
        type: 'select',
        default: 'gaussian',
        options: [
          { label: { zh: '高斯噪声', en: 'Gaussian' }, value: 'gaussian' },
          { label: { zh: '椒盐噪声', en: 'Salt & pepper' }, value: 'salt-pepper' }
        ]
      },
      { key: 'sigma', label: { zh: '高斯强度 Sigma', en: 'Gaussian sigma' }, type: 'slider', default: 25, min: 1, max: 100, step: 1 },
      { key: 'amount', label: { zh: '椒盐比例（%）', en: 'Salt & pepper (%)' }, type: 'slider', default: 5, min: 1, max: 30, step: 1 }
    ],
    run: ({ imageData, params }) => ({
      imageData: String(params.type) === 'gaussian'
        ? alg.addGaussianNoise(imageData, Number(params.sigma))
        : alg.addSaltPepperNoise(imageData, Number(params.amount))
    })
  },
  {
    id: 'denoise',
    page: 'enhancement',
    name: { zh: '去噪 Denoise', en: 'Denoise' },
    kind: 'canvas',
    params: [
      {
        key: 'method',
        label: { zh: '方法', en: 'Method' },
        type: 'select',
        default: 'median',
        options: [
          { label: { zh: '中值滤波（椒盐噪声最佳）', en: 'Median (best for salt & pepper)' }, value: 'median' },
          { label: { zh: '高斯滤波', en: 'Gaussian' }, value: 'gaussian' }
        ]
      },
      { key: 'size', label: { zh: '窗口', en: 'Window' }, type: 'slider', default: 3, min: 3, max: 9, step: 2 }
    ],
    run: ({ imageData, params }) => ({
      imageData: String(params.method) === 'median'
        ? alg.medianBlur(imageData, Number(params.size))
        : alg.gaussianBlur(imageData, Number(params.size) / 2)
    })
  },
  {
    id: 'histogram',
    page: 'enhancement',
    name: { zh: '直方图 Histogram', en: 'Histogram' },
    description: { zh: '显示亮度直方图（条形 + 折线）。', en: 'Show the luminance histogram (bars + line).' },
    kind: 'canvas',
    run: ({ imageData }) => ({ imageData: alg.renderHistogram(alg.luminanceHistogram(imageData)) })
  },
  {
    id: 'histogram-equalize',
    page: 'enhancement',
    name: { zh: '直方图均衡 Histogram Equalization', en: 'Histogram Equalization' },
    kind: 'canvas',
    run: ({ imageData }) => ({ imageData: alg.histogramEqualization(imageData) })
  },
  {
    id: 'enhance',
    page: 'enhancement',
    name: { zh: '图像增强 Enhance', en: 'Image Enhancement' },
    description: { zh: '自动亮度 + 自动对比度组合增强。', en: 'Auto brightness + auto contrast combined.' },
    kind: 'canvas',
    run: ({ imageData }) => ({ imageData: alg.enhance(imageData) })
  },
  {
    id: 'super-res',
    page: 'enhancement',
    name: { zh: '超分辨率 Super Resolution', en: 'Super Resolution' },
    description: { zh: '简化版：高质量放大 + USM 锐化（完整版见 Python 参考）。', en: 'Simplified: high-quality upscale + USM (full version in Python reference).' },
    kind: 'canvas',
    params: [
      {
        key: 'scale',
        label: { zh: '放大倍数', en: 'Scale' },
        type: 'select',
        default: 2,
        options: [
          { label: '2×', value: 2 },
          { label: '4×', value: 4 }
        ]
      },
      { key: 'amount', label: { zh: '锐化强度', en: 'Sharpen amount' }, type: 'slider', default: 0.8, min: 0, max: 2, step: 0.1 }
    ],
    run: ({ imageData, params }) => {
      const scale = Number(params.scale)
      const up = alg.resize(imageData, imageData.width * scale, imageData.height * scale)
      return { imageData: Number(params.amount) > 0 ? alg.unsharpMask(up, 2, Number(params.amount)) : up }
    }
  },
  {
    id: 'histogram-match',
    page: 'enhancement',
    name: { zh: '直方图匹配 Histogram Matching', en: 'Histogram Matching' },
    description: { zh: '把本图亮度分布对齐到参考图；上传第二张图作为参考，不传则对齐到均匀分布（规定化）。', en: 'Align this image’s luminance distribution to a reference image; without one it matches a uniform distribution.' },
    kind: 'canvas',
    needsSecondImage: true,
    run: ({ imageData, secondImage, lang }) => {
      const refMissing = !secondImage
      return {
        imageData: alg.histogramMatch(imageData, secondImage ?? undefined),
        info: [{
          label: lang === 'zh' ? '参考分布' : 'Reference',
          value: refMissing
            ? (lang === 'zh' ? '均匀分布（未提供第二张图）' : 'Uniform (no second image)')
            : (lang === 'zh' ? '第二张图的直方图' : 'Histogram of the second image')
        }]
      }
    }
  }
]

// ===== 08 Threshold & Morphology =====

const morphSizeOptions = [
  { label: '3 × 3', value: 3 },
  { label: '5 × 5', value: 5 },
  { label: '7 × 7', value: 7 },
  { label: '9 × 9', value: 9 }
]

const morphologyTools: ImageTool[] = [
  {
    id: 'binary-threshold',
    page: 'morphology',
    name: { zh: '二值化阈值 Binary Threshold', en: 'Binary Threshold' },
    kind: 'canvas',
    params: [
      { key: 'thresh', label: { zh: '阈值', en: 'Threshold' }, type: 'slider', default: 128, min: 0, max: 255, step: 1 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.thresholdBinary(imageData, Number(params.thresh)) })
  },
  {
    id: 'adaptive-threshold',
    page: 'morphology',
    name: { zh: '自适应阈值 Adaptive Threshold', en: 'Adaptive Threshold' },
    kind: 'canvas',
    params: [
      { key: 'block', label: { zh: '块大小', en: 'Block size' }, type: 'slider', default: 15, min: 3, max: 41, step: 2 },
      { key: 'c', label: { zh: '常数 C', en: 'Constant C' }, type: 'slider', default: 10, min: 0, max: 40, step: 1 },
      {
        key: 'method',
        label: { zh: '均值方法', en: 'Mean method' },
        type: 'select',
        default: 'mean',
        options: [
          { label: { zh: '均值', en: 'Mean' }, value: 'mean' },
          { label: { zh: '高斯加权', en: 'Gaussian' }, value: 'gaussian' }
        ]
      }
    ],
    run: ({ imageData, params }) => ({
      imageData: alg.thresholdAdaptive(imageData, Number(params.block), Number(params.c), String(params.method) as 'mean' | 'gaussian')
    })
  },
  {
    id: 'otsu-threshold',
    page: 'morphology',
    name: { zh: 'Otsu 阈值 Otsu Threshold', en: 'Otsu Threshold' },
    kind: 'canvas',
    run: ({ imageData, lang }) => {
      const { threshold, imageData: out } = alg.thresholdOtsu(imageData)
      return {
        imageData: out,
        info: [{ label: lang === 'zh' ? 'Otsu 自动阈值' : 'Otsu threshold', value: `${threshold}` }]
      }
    }
  },
  {
    id: 'erode',
    page: 'morphology',
    name: { zh: '腐蚀 Erosion', en: 'Erosion' },
    kind: 'canvas',
    params: [
      { key: 'size', label: { zh: '结构元素大小', en: 'Kernel size' }, type: 'select', default: 3, options: morphSizeOptions },
      { key: 'iter', label: { zh: '迭代次数', en: 'Iterations' }, type: 'slider', default: 1, min: 1, max: 5, step: 1 }
    ],
    run: ({ imageData, params }) => {
      let out = imageData
      for (let i = 0; i < Number(params.iter); i++) out = alg.erode(out, Number(params.size))
      return { imageData: out }
    }
  },
  {
    id: 'dilate',
    page: 'morphology',
    name: { zh: '膨胀 Dilation', en: 'Dilation' },
    kind: 'canvas',
    params: [
      { key: 'size', label: { zh: '结构元素大小', en: 'Kernel size' }, type: 'select', default: 3, options: morphSizeOptions },
      { key: 'iter', label: { zh: '迭代次数', en: 'Iterations' }, type: 'slider', default: 1, min: 1, max: 5, step: 1 }
    ],
    run: ({ imageData, params }) => {
      let out = imageData
      for (let i = 0; i < Number(params.iter); i++) out = alg.dilate(out, Number(params.size))
      return { imageData: out }
    }
  },
  {
    id: 'opening',
    page: 'morphology',
    name: { zh: '开运算 Opening', en: 'Opening' },
    kind: 'canvas',
    params: [
      { key: 'size', label: { zh: '结构元素大小', en: 'Kernel size' }, type: 'select', default: 3, options: morphSizeOptions }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.opening(imageData, Number(params.size)) })
  },
  {
    id: 'closing',
    page: 'morphology',
    name: { zh: '闭运算 Closing', en: 'Closing' },
    kind: 'canvas',
    params: [
      { key: 'size', label: { zh: '结构元素大小', en: 'Kernel size' }, type: 'select', default: 3, options: morphSizeOptions }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.closing(imageData, Number(params.size)) })
  },
  {
    id: 'morph-gradient',
    page: 'morphology',
    name: { zh: '形态学梯度 Morphological Gradient', en: 'Morphological Gradient' },
    kind: 'canvas',
    params: [
      { key: 'size', label: { zh: '结构元素大小', en: 'Kernel size' }, type: 'select', default: 3, options: morphSizeOptions }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.morphGradient(imageData, Number(params.size)) })
  },
  {
    id: 'morph-shape',
    page: 'morphology',
    name: { zh: '顶帽 / 黑帽 Top-hat & Black-hat', en: 'Top-hat & Black-hat' },
    description: { zh: '顶帽 = 原图 − 开运算（提亮细节）；黑帽 = 闭运算 − 原图（提暗细节）。', en: 'Top-hat = source − opening (bright details); black-hat = closing − source (dark details).' },
    kind: 'canvas',
    params: [
      {
        key: 'mode',
        label: { zh: '模式', en: 'Mode' },
        type: 'select',
        default: 'top',
        options: [
          { label: { zh: '顶帽（亮细节）', en: 'Top-hat (bright)' }, value: 'top' },
          { label: { zh: '黑帽（暗细节）', en: 'Black-hat (dark)' }, value: 'black' }
        ]
      },
      { key: 'size', label: { zh: '结构元素大小', en: 'Kernel size' }, type: 'select', default: 3, options: morphSizeOptions }
    ],
    run: ({ imageData, params }) => ({
      imageData: String(params.mode) === 'black'
        ? alg.blackHat(imageData, Number(params.size))
        : alg.topHat(imageData, Number(params.size))
    })
  },
  {
    id: 'skeletonize',
    page: 'morphology',
    name: { zh: '骨架化 Skeletonize', en: 'Skeletonize' },
    description: { zh: '先按阈值二值化，再做 Zhang-Suen 细化，得到单像素宽骨架（前景黑线、背景白）。', en: 'Binarize by threshold, then Zhang-Suen thinning to a one-pixel skeleton (black lines on white).' },
    kind: 'canvas',
    params: [
      { key: 'thresh', label: { zh: '二值化阈值', en: 'Threshold' }, type: 'slider', default: 128, min: 0, max: 255, step: 1 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.skeletonize(imageData, Number(params.thresh ?? 128)) })
  }
]

// ===== OpenCV 公共辅助 =====

/** 灰度 Mat（调用方负责 delete） */
function cvGray(cv: any, bgr: any): any {
  const gray = new cv.Mat()
  cv.cvtColor(bgr, gray, cv.COLOR_BGR2GRAY)
  return gray
}

/** 复制一份 BGR Mat 用于绘制（调用方负责 delete） */
function cvCopy(cv: any, bgr: any): any {
  const out = new cv.Mat()
  bgr.copyTo(out)
  return out
}

// ===== 09 Edge & Shape Detection =====

const edgeTools: ImageTool[] = [
  {
    id: 'sobel',
    page: 'edge',
    name: { zh: 'Sobel 边缘', en: 'Sobel' },
    kind: 'opencv',
    params: [
      {
        key: 'ksize',
        label: { zh: '核大小', en: 'Kernel size' },
        type: 'select',
        default: 3,
        options: [
          { label: '3 × 3', value: 3 },
          { label: '5 × 5', value: 5 },
          { label: '7 × 7', value: 7 }
        ]
      }
    ],
    run: async ({ imageData, params }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const dx = new cv.Mat()
      const dy = new cv.Mat()
      const mag = new cv.Mat()
      cv.Sobel(gray, dx, cv.CV_8U, 1, 0, Number(params.ksize))
      cv.Sobel(gray, dy, cv.CV_8U, 0, 1, Number(params.ksize))
      cv.addWeighted(dx, 0.5, dy, 0.5, 0, mag)
      gray.delete(); dx.delete(); dy.delete()
      return { imageData: matToImageData(cv, mag) }
    })
  },
  {
    id: 'scharr',
    page: 'edge',
    name: { zh: 'Scharr 边缘', en: 'Scharr' },
    kind: 'opencv',
    run: async ({ imageData }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const dx = new cv.Mat()
      const dy = new cv.Mat()
      const mag = new cv.Mat()
      cv.Scharr(gray, dx, cv.CV_8U, 1, 0)
      cv.Scharr(gray, dy, cv.CV_8U, 0, 1)
      cv.addWeighted(dx, 0.5, dy, 0.5, 0, mag)
      gray.delete(); dx.delete(); dy.delete()
      return { imageData: matToImageData(cv, mag) }
    })
  },
  {
    id: 'laplacian',
    page: 'edge',
    name: { zh: 'Laplacian 边缘', en: 'Laplacian' },
    kind: 'opencv',
    run: async ({ imageData }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const out = new cv.Mat()
      cv.Laplacian(gray, out, cv.CV_8U, 3)
      gray.delete()
      return { imageData: matToImageData(cv, out) }
    })
  },
  {
    id: 'canny',
    page: 'edge',
    name: { zh: 'Canny 边缘', en: 'Canny' },
    kind: 'opencv',
    params: [
      { key: 't1', label: { zh: '低阈值', en: 'Low threshold' }, type: 'slider', default: 100, min: 0, max: 255, step: 1 },
      { key: 't2', label: { zh: '高阈值', en: 'High threshold' }, type: 'slider', default: 200, min: 0, max: 255, step: 1 }
    ],
    run: async ({ imageData, params }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const out = new cv.Mat()
      cv.Canny(gray, out, Number(params.t1), Number(params.t2))
      gray.delete()
      return { imageData: matToImageData(cv, out) }
    })
  },
  {
    id: 'harris',
    page: 'edge',
    name: { zh: 'Harris 角点', en: 'Harris Corners' },
    kind: 'opencv',
    params: [
      { key: 'thresh', label: { zh: '阈值（×最大值）', en: 'Threshold (×max)' }, type: 'slider', default: 0.01, min: 0.001, max: 0.1, step: 0.001 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const dst = new cv.Mat()
      cv.cornerHarris(gray, dst, 2, 3, 0.04)
      let max = 0
      for (let i = 0; i < dst.rows * dst.cols; i++) max = Math.max(max, dst.data32F[i])
      const out = cvCopy(cv, bgr)
      const thresh = max * Number(params.thresh)
      let count = 0
      for (let y = 0; y < dst.rows; y++) {
        for (let x = 0; x < dst.cols; x++) {
          if (dst.data32F[y * dst.cols + x] > thresh) {
            cv.circle(out, new cv.Point(x, y), 3, new cv.Scalar(0, 0, 255), -1)
            count++
          }
        }
      }
      gray.delete(); dst.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [{ label: lang === 'zh' ? '角点数' : 'Corners', value: `${count}` }]
      }
    })
  },
  {
    id: 'hough-lines',
    page: 'edge',
    name: { zh: 'Hough 直线', en: 'Hough Lines' },
    kind: 'opencv',
    params: [
      { key: 'threshold', label: { zh: '累加器阈值', en: 'Accumulator threshold' }, type: 'slider', default: 80, min: 10, max: 300, step: 5 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const edges = new cv.Mat()
      cv.Canny(gray, edges, 100, 200)
      const lines = new cv.Mat()
      cv.HoughLinesP(edges, lines, 1, Math.PI / 180, Number(params.threshold), 30, 10)
      const out = cvCopy(cv, bgr)
      for (let i = 0; i < lines.rows; i++) {
        const [x1, y1, x2, y2] = lines.data32S.subarray(i * 4, i * 4 + 4)
        cv.line(out, new cv.Point(x1, y1), new cv.Point(x2, y2), new cv.Scalar(0, 255, 0), 2)
      }
      gray.delete(); edges.delete(); lines.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [{ label: lang === 'zh' ? '直线数' : 'Lines', value: `${lines.rows}` }]
      }
    })
  },
  {
    id: 'hough-circles',
    page: 'edge',
    name: { zh: 'Hough 圆', en: 'Hough Circles' },
    kind: 'opencv',
    params: [
      { key: 'param2', label: { zh: '累加器阈值', en: 'Accumulator threshold' }, type: 'slider', default: 100, min: 20, max: 300, step: 5 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const circles = new cv.Mat()
      cv.HoughCircles(gray, circles, cv.HOUGH_GRADIENT, 1, Math.max(20, gray.rows / 8), 200, Number(params.param2), 10, 0)
      const out = cvCopy(cv, bgr)
      const n = circles.cols > 0 ? circles.cols : circles.rows
      for (let i = 0; i < n; i++) {
        const c = circles.data32F.subarray(i * 3, i * 3 + 3)
        cv.circle(out, new cv.Point(c[0], c[1]), c[2], new cv.Scalar(0, 255, 0), 2)
        cv.circle(out, new cv.Point(c[0], c[1]), 2, new cv.Scalar(0, 0, 255), -1)
      }
      gray.delete(); circles.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [{ label: lang === 'zh' ? '圆数' : 'Circles', value: `${n}` }]
      }
    })
  },
  {
    id: 'fit-ellipse',
    page: 'edge',
    name: { zh: '椭圆拟合 Fit Ellipse', en: 'Ellipse Fitting' },
    description: { zh: '提取轮廓后最小二乘拟合椭圆（OpenCV.js 未提供 HoughEllipse，拟合更稳且参数更少）。', en: 'Fit ellipses on contours via least squares (OpenCV.js has no HoughEllipse; fitting is more stable).' },
    kind: 'opencv',
    params: [
      { key: 'thresh', label: { zh: '二值化阈值', en: 'Threshold' }, type: 'slider', default: 128, min: 0, max: 255, step: 1 },
      { key: 'minArea', label: { zh: '最小面积（px²）', en: 'Min area (px²)' }, type: 'slider', default: 300, min: 30, max: 5000, step: 10 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const binary = new cv.Mat()
      cv.threshold(gray, binary, Number(params.thresh), 255, cv.THRESH_BINARY)
      const contours = new cv.MatVector()
      const hierarchy = new cv.Mat()
      cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      const out = cvCopy(cv, bgr)
      let count = 0
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i)
        // fitEllipse 要求至少 5 个点
        if (c.rows < 5) continue
        if (cv.contourArea(c) < Number(params.minArea)) continue
        const e = cv.fitEllipse(c)
        cv.ellipse(
          out,
          e.center,
          new cv.Size(e.size.width / 2, e.size.height / 2),
          e.angle,
          0,
          360,
          new cv.Scalar(0, 255, 0),
          2
        )
        count++
      }
      gray.delete()
      binary.delete()
      contours.delete()
      hierarchy.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [{ label: lang === 'zh' ? '椭圆数' : 'Ellipses', value: `${count}` }]
      }
    })
  }
]

// ===== 10 Color & Object Detection =====

function hsvRangeTool(
  id: string,
  name: LocalizedText,
  description: LocalizedText | undefined,
  mode: 'mask' | 'segment'
): ImageTool {
  return {
    id,
    page: 'object',
    name,
    description,
    kind: 'opencv',
    params: [
      { key: 'hMin', label: { zh: 'H 最小', en: 'H min' }, type: 'slider', default: 0, min: 0, max: 179, step: 1 },
      { key: 'hMax', label: { zh: 'H 最大', en: 'H max' }, type: 'slider', default: 179, min: 0, max: 179, step: 1 },
      { key: 'sMin', label: { zh: 'S 最小', en: 'S min' }, type: 'slider', default: 60, min: 0, max: 255, step: 1 },
      { key: 'sMax', label: { zh: 'S 最大', en: 'S max' }, type: 'slider', default: 255, min: 0, max: 255, step: 1 },
      { key: 'vMin', label: { zh: 'V 最小', en: 'V min' }, type: 'slider', default: 60, min: 0, max: 255, step: 1 },
      { key: 'vMax', label: { zh: 'V 最大', en: 'V max' }, type: 'slider', default: 255, min: 0, max: 255, step: 1 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const hsv = new cv.Mat()
      cv.cvtColor(bgr, hsv, cv.COLOR_BGR2HSV)
      const mask = new cv.Mat()
      // 官方坑：cv.inRange 的 lowerb/upperb 传 cv.Scalar 会报 "Cannot pass '0,60,60,0' as a Mat"，
      // 必须用 matFromArray 建 1×3 的 CV_8UC1 Mat（见 answers.opencv.org 同报错案例）
      const low = cv.matFromArray(1, 3, cv.CV_8UC1, [Number(params.hMin), Number(params.sMin), Number(params.vMin)])
      const high = cv.matFromArray(1, 3, cv.CV_8UC1, [Number(params.hMax), Number(params.sMax), Number(params.vMax)])
      cv.inRange(hsv, low, high, mask)
      let out: any
      if (mode === 'mask') {
        out = new cv.Mat()
        cv.cvtColor(mask, out, cv.COLOR_GRAY2BGR)
      } else {
        out = new cv.Mat()
        cv.bitwise_and(bgr, bgr, out, mask)
      }
      let count = 0
      const contours = new cv.MatVector()
      const hierarchy = new cv.Mat()
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      for (let i = 0; i < contours.size(); i++) {
        if (cv.contourArea(contours.get(i)) > 50) count++
      }
      contours.delete(); hierarchy.delete(); hsv.delete(); mask.delete(); low.delete(); high.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [{ label: lang === 'zh' ? '匹配物体数' : 'Objects', value: `${count}` }]
      }
    })
  }
}

const objectTools: ImageTool[] = [
  hsvRangeTool('color-mask', { zh: '颜色掩码 Color Mask', en: 'Color Mask' }, { zh: '用 HSV 范围生成二值掩码。', en: 'Generate a binary mask from an HSV range.' }, 'mask'),
  hsvRangeTool('color-segment', { zh: '颜色分割 Color Segmentation', en: 'Color Segmentation' }, { zh: '只保留落在 HSV 范围内的像素。', en: 'Keep only pixels inside the HSV range.' }, 'segment'),
  {
    id: 'contour-detect',
    page: 'object',
    name: { zh: '轮廓检测 Contours', en: 'Contour Detection' },
    kind: 'opencv',
    params: [
      { key: 'thresh', label: { zh: '二值化阈值', en: 'Threshold' }, type: 'slider', default: 128, min: 0, max: 255, step: 1 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const binary = new cv.Mat()
      cv.threshold(gray, binary, Number(params.thresh), 255, cv.THRESH_BINARY)
      const contours = new cv.MatVector()
      const hierarchy = new cv.Mat()
      cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      const out = cvCopy(cv, bgr)
      let count = 0
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i)
        if (cv.contourArea(c) < 30) continue
        cv.drawContours(out, contours, i, new cv.Scalar(0, 255, 0), 2)
        count++
      }
      gray.delete(); binary.delete(); contours.delete(); hierarchy.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [{ label: lang === 'zh' ? '轮廓数' : 'Contours', value: `${count}` }]
      }
    })
  },
  {
    id: 'object-count',
    page: 'object',
    name: { zh: '物体计数 Object Counting', en: 'Object Counting' },
    kind: 'opencv',
    params: [
      { key: 'thresh', label: { zh: '二值化阈值', en: 'Threshold' }, type: 'slider', default: 128, min: 0, max: 255, step: 1 },
      { key: 'minArea', label: { zh: '最小面积（px²）', en: 'Min area (px²)' }, type: 'slider', default: 100, min: 10, max: 5000, step: 10 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const binary = new cv.Mat()
      cv.threshold(gray, binary, Number(params.thresh), 255, cv.THRESH_BINARY)
      const contours = new cv.MatVector()
      const hierarchy = new cv.Mat()
      cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      const out = cvCopy(cv, bgr)
      let count = 0
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i)
        if (cv.contourArea(c) < Number(params.minArea)) continue
        count++
      }
      cv.putText(out, `Count: ${count}`, new cv.Point(12, 30), cv.FONT_HERSHEY_SIMPLEX, 1, new cv.Scalar(0, 255, 0), 2)
      gray.delete(); binary.delete(); contours.delete(); hierarchy.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [{ label: lang === 'zh' ? '物体数' : 'Objects', value: `${count}` }]
      }
    })
  },
  {
    id: 'bounding-box',
    page: 'object',
    name: { zh: '包围盒 Bounding Box', en: 'Bounding Box' },
    kind: 'opencv',
    params: [
      { key: 'thresh', label: { zh: '二值化阈值', en: 'Threshold' }, type: 'slider', default: 128, min: 0, max: 255, step: 1 },
      { key: 'minArea', label: { zh: '最小面积（px²）', en: 'Min area (px²)' }, type: 'slider', default: 100, min: 10, max: 5000, step: 10 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const binary = new cv.Mat()
      cv.threshold(gray, binary, Number(params.thresh), 255, cv.THRESH_BINARY)
      const contours = new cv.MatVector()
      const hierarchy = new cv.Mat()
      cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      const out = cvCopy(cv, bgr)
      let count = 0
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i)
        if (cv.contourArea(c) < Number(params.minArea)) continue
        const rect = cv.boundingRect(c)
        cv.rectangle(out, new cv.Point(rect.x, rect.y), new cv.Point(rect.x + rect.width, rect.y + rect.height), new cv.Scalar(0, 255, 0), 2)
        count++
      }
      gray.delete(); binary.delete(); contours.delete(); hierarchy.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [{ label: lang === 'zh' ? '物体数' : 'Objects', value: `${count}` }]
      }
    })
  },
  {
    id: 'centroid',
    page: 'object',
    name: { zh: '质心 Centroid', en: 'Centroid' },
    kind: 'opencv',
    params: [
      { key: 'thresh', label: { zh: '二值化阈值', en: 'Threshold' }, type: 'slider', default: 128, min: 0, max: 255, step: 1 },
      { key: 'minArea', label: { zh: '最小面积（px²）', en: 'Min area (px²)' }, type: 'slider', default: 100, min: 10, max: 5000, step: 10 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const binary = new cv.Mat()
      cv.threshold(gray, binary, Number(params.thresh), 255, cv.THRESH_BINARY)
      const contours = new cv.MatVector()
      const hierarchy = new cv.Mat()
      cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      const out = cvCopy(cv, bgr)
      let count = 0
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i)
        if (cv.contourArea(c) < Number(params.minArea)) continue
        const m = cv.moments(c)
        if (m.m00 === 0) continue
        const cx = m.m10 / m.m00
        const cy = m.m01 / m.m00
        cv.circle(out, new cv.Point(cx, cy), 5, new cv.Scalar(0, 0, 255), -1)
        count++
      }
      gray.delete(); binary.delete(); contours.delete(); hierarchy.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [{ label: lang === 'zh' ? '物体数' : 'Objects', value: `${count}` }]
      }
    })
  },
  {
    id: 'area-perimeter',
    page: 'object',
    name: { zh: '面积与周长 Area & Perimeter', en: 'Area & Perimeter' },
    kind: 'opencv',
    params: [
      { key: 'thresh', label: { zh: '二值化阈值', en: 'Threshold' }, type: 'slider', default: 128, min: 0, max: 255, step: 1 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const binary = new cv.Mat()
      cv.threshold(gray, binary, Number(params.thresh), 255, cv.THRESH_BINARY)
      const contours = new cv.MatVector()
      const hierarchy = new cv.Mat()
      cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      const out = cvCopy(cv, bgr)
      const info: { label: string; value: string }[] = []
      let shown = 0
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i)
        const area = cv.contourArea(c)
        if (area < 30) continue
        const perim = cv.arcLength(c, true)
        cv.drawContours(out, contours, i, new cv.Scalar(0, 255, 0), 1)
        if (shown < 6) {
          info.push({
            label: lang === 'zh' ? `物体 ${i + 1}` : `Object ${i + 1}`,
            value: `${lang === 'zh' ? '面积' : 'A'} ${area.toFixed(0)} · ${lang === 'zh' ? '周长' : 'P'} ${perim.toFixed(1)}`
          })
          shown++
        }
      }
      gray.delete(); binary.delete(); contours.delete(); hierarchy.delete()
      return { imageData: matToImageData(cv, out), info }
    })
  },
  {
    id: 'shape-recognize',
    page: 'object',
    name: { zh: '形状识别 Shape Recognition', en: 'Shape Recognition' },
    kind: 'opencv',
    params: [
      { key: 'thresh', label: { zh: '二值化阈值', en: 'Threshold' }, type: 'slider', default: 128, min: 0, max: 255, step: 1 },
      { key: 'epsilon', label: { zh: '近似精度 ε（%）', en: 'Approx epsilon (%)' }, type: 'slider', default: 2, min: 0.5, max: 10, step: 0.5 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const binary = new cv.Mat()
      cv.threshold(gray, binary, Number(params.thresh), 255, cv.THRESH_BINARY)
      const contours = new cv.MatVector()
      const hierarchy = new cv.Mat()
      cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      const out = cvCopy(cv, bgr)
      const info: { label: string; value: string }[] = []
      let shown = 0
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i)
        const area = cv.contourArea(c)
        if (area < 100) continue
        const approx = new cv.Mat()
        cv.approxPolyDP(c, approx, cv.arcLength(c, true) * Number(params.epsilon) / 100, true)
        const vertices = approx.rows
        const rect = cv.boundingRect(c)
        let shape: string
        if (vertices === 3) shape = lang === 'zh' ? '三角形' : 'Triangle'
        else if (vertices === 4) shape = lang === 'zh' ? '四边形' : 'Quad'
        else if (vertices === 5) shape = lang === 'zh' ? '五边形' : 'Pentagon'
        else shape = lang === 'zh' ? '多边形/圆' : 'Polygon/Circle'
        cv.drawContours(out, contours, i, new cv.Scalar(0, 255, 0), 2)
        cv.putText(out, shape, new cv.Point(rect.x, rect.y - 6), cv.FONT_HERSHEY_SIMPLEX, 0.5, new cv.Scalar(0, 0, 255), 1)
        if (shown < 6) {
          info.push({ label: lang === 'zh' ? `物体 ${i + 1}` : `Object ${i + 1}`, value: shape })
          shown++
        }
        approx.delete()
      }
      gray.delete(); binary.delete(); contours.delete(); hierarchy.delete()
      return { imageData: matToImageData(cv, out), info }
    })
  }
]

// ===== 11 Feature Detection =====

const featureTools: ImageTool[] = [
  {
    id: 'orb-keypoints',
    page: 'features',
    name: { zh: 'ORB 关键点', en: 'ORB Keypoints' },
    kind: 'opencv',
    params: [
      { key: 'max', label: { zh: '最大数量', en: 'Max keypoints' }, type: 'slider', default: 200, min: 10, max: 1000, step: 10 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const orb = new cv.ORB(Number(params.max))
      const kp = new cv.KeyPointVector()
      const desc = new cv.Mat()
      orb.detectAndCompute(bgr, new cv.Mat(), kp, desc)
      const out = new cv.Mat()
      cv.drawKeypoints(bgr, kp, out)
      const count = kp.size()
      orb.delete(); kp.delete(); desc.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [{ label: lang === 'zh' ? '关键点数' : 'Keypoints', value: `${count}` }]
      }
    })
  },
  {
    id: 'brisk-keypoints',
    page: 'features',
    name: { zh: 'BRISK 关键点', en: 'BRISK Keypoints' },
    kind: 'opencv',
    run: async ({ imageData, lang }) => withCvMat(imageData, (cv, bgr) => {
      const brisk = new cv.BRISK()
      const kp = new cv.KeyPointVector()
      const desc = new cv.Mat()
      brisk.detectAndCompute(bgr, new cv.Mat(), kp, desc)
      const out = new cv.Mat()
      cv.drawKeypoints(bgr, kp, out)
      const count = kp.size()
      brisk.delete(); kp.delete(); desc.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [{ label: lang === 'zh' ? '关键点数' : 'Keypoints', value: `${count}` }]
      }
    })
  },
  {
    id: 'feature-match',
    page: 'features',
    name: { zh: '特征匹配 Feature Matching', en: 'Feature Matching' },
    description: { zh: '用 ORB + 暴力匹配对齐两张图的关键点。', en: 'Match keypoints between two images with ORB + brute-force.' },
    kind: 'opencv',
    needsSecondImage: true,
    params: [
      { key: 'max', label: { zh: '最大关键点', en: 'Max keypoints' }, type: 'slider', default: 500, min: 50, max: 2000, step: 50 },
      { key: 'ratio', label: { zh: 'Lowe 比率', en: 'Lowe ratio' }, type: 'slider', default: 0.75, min: 0.5, max: 0.95, step: 0.01 }
    ],
    run: async ({ imageData, secondImage, params, lang }) => {
      if (!secondImage) {
        return {
          imageData,
          info: [{ label: lang === 'zh' ? '提示' : 'Hint', value: lang === 'zh' ? '请先上传第二张图' : 'Upload a second image first' }]
        }
      }
      return withCvMat(imageData, (cv, bgr) => {
        const bgr2 = imageDataToMat(cv, secondImage)
        cv.cvtColor(bgr2, bgr2, cv.COLOR_RGBA2BGR)
        const orb = new cv.ORB(Number(params.max))
        const kp1 = new cv.KeyPointVector()
        const kp2 = new cv.KeyPointVector()
        const d1 = new cv.Mat()
        const d2 = new cv.Mat()
        orb.detectAndCompute(bgr, new cv.Mat(), kp1, d1)
        orb.detectAndCompute(bgr2, new cv.Mat(), kp2, d2)
        const matches = new cv.DMatchVectorVector()
        const bf = new cv.BFMatcher(cv.NORM_HAMMING, false)
        bf.knnMatch(d1, d2, matches, 2)
        const good: { q: number; t: number }[] = []
        const ratio = Number(params.ratio)
        for (let i = 0; i < matches.size(); i++) {
          const pair = matches.get(i)
          if (pair.size() >= 2) {
            const a = pair.get(0)
            const b = pair.get(1)
            if (a.distance < ratio * b.distance) good.push({ q: a.queryIdx, t: a.trainIdx })
          }
        }
        // 并排画布
        const gap = 20
        const w = bgr.cols + bgr2.cols + gap
        const h = Math.max(bgr.rows, bgr2.rows)
        const out = new cv.Mat(h, w, cv.CV_8UC3, new cv.Scalar(0, 0, 0))
        bgr.copyTo(out.roi(new cv.Rect(0, 0, bgr.cols, bgr.rows)))
        bgr2.copyTo(out.roi(new cv.Rect(bgr.cols + gap, 0, bgr2.cols, bgr2.rows)))
        for (const m of good) {
          const p1 = kp1.get(m.q).pt
          const p2 = kp2.get(m.t).pt
          const x2 = p2.x + bgr.cols + gap
          const color = new cv.Scalar(0, 255, 0)
          cv.circle(out, new cv.Point(p1.x, p1.y), 3, color, -1)
          cv.circle(out, new cv.Point(x2, p2.y), 3, color, -1)
          cv.line(out, new cv.Point(p1.x, p1.y), new cv.Point(x2, p2.y), color, 1)
        }
        orb.delete(); bf.delete(); kp1.delete(); kp2.delete(); d1.delete(); d2.delete(); matches.delete(); bgr2.delete()
        return {
          imageData: matToImageData(cv, out),
          info: [{ label: lang === 'zh' ? '匹配对数' : 'Matches', value: `${good.length}` }]
        }
      })
    }
  },
  {
    id: 'template-match',
    page: 'features',
    name: { zh: '模板匹配 Template Matching', en: 'Template Matching' },
    description: { zh: '在原图里搜索第二张图（模板）出现的位置（TM_CCOEFF_NORMED + 阈值去重）。', en: 'Find where the second image (template) appears in the first, via TM_CCOEFF_NORMED with thresholding.' },
    kind: 'opencv',
    needsSecondImage: true,
    params: [
      { key: 'thresh', label: { zh: '匹配阈值（0~1）', en: 'Match threshold (0~1)' }, type: 'slider', default: 0.7, min: 0.3, max: 0.99, step: 0.01 }
    ],
    run: async ({ imageData, secondImage, params, lang }) => {
      if (!secondImage) {
        return { imageData, info: [{ label: lang === 'zh' ? '提示' : 'Hint', value: lang === 'zh' ? '请先上传第二张图作为模板' : 'Upload a second image to use as the template' }] }
      }
      return withCvMat(imageData, (cv, bgr) => {
        const tmpl = imageDataToMat(cv, secondImage)
        cv.cvtColor(tmpl, tmpl, cv.COLOR_RGBA2BGR)
        try {
          if (tmpl.cols > bgr.cols || tmpl.rows > bgr.rows) {
            return { imageData, info: [{ label: lang === 'zh' ? '提示' : 'Hint', value: lang === 'zh' ? '模板比原图大，无法匹配' : 'Template is larger than the source image' }] }
          }
          const res = new cv.Mat()
          cv.matchTemplate(bgr, tmpl, res, cv.TM_CCOEFF_NORMED)
          // matchTemplate 输出 CV_32F，需先阈值化再转 8U 才能 findContours 去重
          const hitsF = new cv.Mat()
          cv.threshold(res, hitsF, Number(params.thresh ?? 0.7), 255, cv.THRESH_BINARY)
          const hits = new cv.Mat()
          hitsF.convertTo(hits, cv.CV_8U)
          const contours = new cv.MatVector()
          const hierarchy = new cv.Mat()
          cv.findContours(hits, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
          const out = cvCopy(cv, bgr)
          let count = 0
          for (let i = 0; i < contours.size(); i++) {
            const r = cv.boundingRect(contours.get(i))
            const cx = r.x + Math.floor(r.width / 2)
            const cy = r.y + Math.floor(r.height / 2)
            const score = res.floatAt(cy, cx)
            cv.rectangle(out, new cv.Point(r.x, r.y), new cv.Point(r.x + tmpl.cols, r.y + tmpl.rows), new cv.Scalar(0, 255, 0), 2)
            cv.putText(out, score.toFixed(2), new cv.Point(r.x, Math.max(12, r.y - 4)), cv.FONT_HERSHEY_SIMPLEX, 0.5, new cv.Scalar(0, 0, 255), 1)
            count++
          }
          res.delete()
          hitsF.delete()
          hits.delete()
          contours.delete()
          hierarchy.delete()
          return {
            imageData: matToImageData(cv, out),
            info: [{ label: lang === 'zh' ? '匹配数量' : 'Matches', value: `${count}` }]
          }
        } finally {
          tmpl.delete()
        }
      })
    }
  },
  {
    id: 'image-stitch',
    page: 'features',
    name: { zh: '图像拼接 Stitching', en: 'Image Stitching' },
    description: { zh: 'ORB 特征 + 单应矩阵把第二张图对齐拼到第一张图上（全景示意，需两张图有重叠）。', en: 'ORB features + homography align the second image onto the first (panorama sketch; images must overlap).' },
    kind: 'opencv',
    needsSecondImage: true,
    params: [
      { key: 'max', label: { zh: '最大关键点', en: 'Max keypoints' }, type: 'slider', default: 1000, min: 200, max: 3000, step: 100 },
      { key: 'ratio', label: { zh: 'Lowe 比率', en: 'Lowe ratio' }, type: 'slider', default: 0.75, min: 0.5, max: 0.95, step: 0.01 }
    ],
    run: async ({ imageData, secondImage, params, lang }) => {
      if (!secondImage) {
        return { imageData, info: [{ label: lang === 'zh' ? '提示' : 'Hint', value: lang === 'zh' ? '请先上传第二张图（同一场景的另一视角）' : 'Upload a second image (another view of the same scene)' }] }
      }
      return withCvMat(imageData, (cv, bgr) => {
        const bgr2 = imageDataToMat(cv, secondImage)
        cv.cvtColor(bgr2, bgr2, cv.COLOR_RGBA2BGR)
        const orb = new cv.ORB(Number(params.max ?? 1000))
        const kp1 = new cv.KeyPointVector()
        const kp2 = new cv.KeyPointVector()
        const d1 = new cv.Mat()
        const d2 = new cv.Mat()
        orb.detectAndCompute(bgr, new cv.Mat(), kp1, d1)
        orb.detectAndCompute(bgr2, new cv.Mat(), kp2, d2)
        const matches = new cv.DMatchVectorVector()
        const bf = new cv.BFMatcher(cv.NORM_HAMMING, false)
        // 以第二张图为 query、第一张为 train，求「第二张 → 第一张」的单应
        bf.knnMatch(d2, d1, matches, 2)
        const srcPts: number[] = []
        const dstPts: number[] = []
        const ratio = Number(params.ratio ?? 0.75)
        for (let i = 0; i < matches.size(); i++) {
          const pair = matches.get(i)
          if (pair.size() >= 2) {
            const a = pair.get(0)
            const b = pair.get(1)
            if (a.distance < ratio * b.distance) {
              const p2 = kp2.get(a.queryIdx).pt
              const p1 = kp1.get(a.trainIdx).pt
              srcPts.push(p2.x, p2.y)
              dstPts.push(p1.x, p1.y)
            }
          }
        }
        orb.delete()
        bf.delete()
        kp1.delete()
        kp2.delete()
        d1.delete()
        d2.delete()
        matches.delete()
        try {
          if (srcPts.length < 8) {
            return { imageData, info: [{ label: lang === 'zh' ? '状态' : 'Status', value: lang === 'zh' ? '匹配点不足（建议两张图重叠 30% 以上）' : 'Not enough matches (aim for 30%+ overlap)' }] }
          }
          const n = srcPts.length / 2
          const srcMat = cv.matFromArray(n, 1, cv.CV_32FC2, srcPts)
          const dstMat = cv.matFromArray(n, 1, cv.CV_32FC2, dstPts)
          const H = cv.findHomography(srcMat, dstMat, cv.RANSAC, 5)
          srcMat.delete()
          dstMat.delete()
          if (!H || H.empty()) {
            if (H) H.delete()
            return { imageData, info: [{ label: lang === 'zh' ? '状态' : 'Status', value: lang === 'zh' ? '单应矩阵求解失败' : 'Homography failed' }] }
          }
          const is64 = H.type() === cv.CV_64F
          const h: number[] = []
          for (let i = 0; i < 9; i++) h.push(is64 ? H.data64F[i] : H.data32F[i])
          H.delete()
          // 把第二张图的四角变换到第一张图坐标系，求并集包围盒
          const corners = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, bgr2.cols, 0, bgr2.cols, bgr2.rows, 0, bgr2.rows])
          const Hmat = cv.matFromArray(3, 3, cv.CV_64FC1, h)
          const warpedCorners = new cv.Mat()
          cv.perspectiveTransform(corners, warpedCorners, Hmat)
          let minX = 0
          let minY = 0
          let maxX = bgr.cols
          let maxY = bgr.rows
          for (let i = 0; i < 4; i++) {
            const px = warpedCorners.data32F[i * 2]
            const py = warpedCorners.data32F[i * 2 + 1]
            minX = Math.min(minX, px)
            minY = Math.min(minY, py)
            maxX = Math.max(maxX, px)
            maxY = Math.max(maxY, py)
          }
          corners.delete()
          warpedCorners.delete()
          const W = Math.max(1, Math.round(maxX - minX))
          const Hh = Math.max(1, Math.round(maxY - minY))
          // 平移量并入单应矩阵：T·H 只需修改第三列（H 的 [2] 与 [5]）
          h[2] = h[2] + (-minX)
          h[5] = h[5] + (-minY)
          const TH = cv.matFromArray(3, 3, cv.CV_64FC1, h)
          Hmat.delete()
          const out = new cv.Mat(Hh, W, cv.CV_8UC3, new cv.Scalar(0, 0, 0))
          const roi = out.roi(new cv.Rect(Math.round(-minX), Math.round(-minY), bgr.cols, bgr.rows))
          bgr.copyTo(roi)
          roi.delete()
          const warped = new cv.Mat()
          cv.warpPerspective(bgr2, warped, TH, new cv.Size(W, Hh))
          // 用「非黑像素」作 mask 覆盖重叠区（简化版，不做多频段融合）
          const grayWarp = new cv.Mat()
          cv.cvtColor(warped, grayWarp, cv.COLOR_BGR2GRAY)
          const mask = new cv.Mat()
          cv.threshold(grayWarp, mask, 1, 255, cv.THRESH_BINARY)
          warped.copyTo(out, mask)
          TH.delete()
          warped.delete()
          grayWarp.delete()
          mask.delete()
          return {
            imageData: matToImageData(cv, out),
            info: [
              { label: lang === 'zh' ? '全景尺寸' : 'Canvas size', value: `${W}×${Hh}` },
              { label: lang === 'zh' ? '参与内点数' : 'Inliers', value: `${n}` }
            ]
          }
        } finally {
          bgr2.delete()
        }
      })
    }
  }
]

// ===== 本地小工具 =====

function toCanvasLocal(imageData: ImageData, willReadFrequently = false): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  // 重复 getImageData 读回的工具（如人脸马赛克）需在首次创建 context 时声明 willReadFrequently，
  // 否则后续 getContext 带 options 也不会生效（context 已存在，options 被忽略）
  const ctx = willReadFrequently ? canvas.getContext('2d', { willReadFrequently: true }) : canvas.getContext('2d')
  if (ctx) ctx.putImageData(imageData, 0, 0)
  return canvas
}

function toDataUrl(imageData: ImageData): string {
  return toCanvasLocal(imageData).toDataURL('image/png')
}

// ===== 12 Face Vision =====

const confidenceParam: LocalizedParamSpec = {
  key: 'confidence',
  label: { zh: '检测置信度', en: 'Confidence' },
  type: 'slider',
  default: 0.5,
  min: 0.3,
  max: 1,
  step: 0.05
}

const faceTools: ImageTool[] = [
  {
    id: 'face-blur',
    page: 'face',
    name: { zh: '人脸模糊 Face Blur', en: 'Face Blur' },
    kind: 'mediapipe',
    section: { face: 'image.sections.mediapipe' },
    params: [confidenceParam],
    run: async ({ imageData, params, lang }) => {
      const { visionTasks } = await import('~/utils/mediapipe-vision')
      const cfg = visionTasks['face-detection']
      const { result } = await ai.mediaPipeImageResult(imageData, cfg.create, cfg.method, undefined, {
        minDetectionConfidence: Number(params.confidence)
      })
      const canvas = toCanvasLocal(imageData)
      const ctx = canvas.getContext('2d')!
      const dets = result.detections ?? []
      for (const det of dets) {
        const bb = det.boundingBox
        const pad = 0.35
        const sx = Math.max(0, bb.originX - bb.width * pad)
        const sy = Math.max(0, bb.originY - bb.height * pad)
        const sw = Math.min(canvas.width - sx, bb.width * (1 + 2 * pad))
        const sh = Math.min(canvas.height - sy, bb.height * (1 + 2 * pad))
        ctx.save()
        ctx.filter = `blur(${Math.max(6, Math.round(bb.width * 0.12))}px)`
        ctx.drawImage(canvas, sx, sy, sw, sh, sx, sy, sw, sh)
        ctx.restore()
      }
      return {
        imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
        info: [{ label: lang === 'zh' ? '已模糊人脸' : 'Faces blurred', value: `${dets.length}` }]
      }
    }
  },
  {
    id: 'face-pixelate',
    page: 'face',
    name: { zh: '人脸马赛克 Face Pixelation', en: 'Face Pixelation' },
    kind: 'mediapipe',
    section: { face: 'image.sections.mediapipe' },
    params: [confidenceParam],
    run: async ({ imageData, params, lang }) => {
      const { visionTasks } = await import('~/utils/mediapipe-vision')
      const cfg = visionTasks['face-detection']
      const { result } = await ai.mediaPipeImageResult(imageData, cfg.create, cfg.method, undefined, {
        minDetectionConfidence: Number(params.confidence)
      })
      // 像素化循环内多次 getImageData 读回：创建 context 时声明 willReadFrequently 避免性能警告
      const canvas = toCanvasLocal(imageData, true)
      const ctx = canvas.getContext('2d')!
      const dets = result.detections ?? []
      for (const det of dets) {
        const bb = det.boundingBox
        const pad = 0.35
        const x = Math.max(0, bb.originX - bb.width * pad)
        const y = Math.max(0, bb.originY - bb.height * pad)
        const w = Math.min(canvas.width - x, bb.width * (1 + 2 * pad))
        const h = Math.min(canvas.height - y, bb.height * (1 + 2 * pad))
        const cell = Math.max(4, Math.round(w / 14))
        for (let cy = y; cy < y + h; cy += cell) {
          for (let cx = x; cx < x + w; cx += cell) {
            const cw = Math.min(cell, x + w - cx)
            const ch = Math.min(cell, y + h - cy)
            const d = ctx.getImageData(cx, cy, cw, ch).data
            let r = 0
            let g = 0
            let b = 0
            const n = d.length / 4
            for (let i = 0; i < d.length; i += 4) {
              r += d[i]
              g += d[i + 1]
              b += d[i + 2]
            }
            ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`
            ctx.fillRect(cx, cy, cw, ch)
          }
        }
      }
      return {
        imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
        info: [{ label: lang === 'zh' ? '已马赛克人脸' : 'Faces pixelated', value: `${dets.length}` }]
      }
    }
  },
  {
    id: 'face-id-photo',
    page: 'face',
    name: { zh: '证件照生成', en: 'ID Photo' },
    description: {
      zh: '检测人脸后按证件照比例裁切，并填充纯色背景（一寸 3:4 / 二寸 35:49 / 方形 1:1）。',
      en: 'Detect the face, crop to an ID-photo ratio and fill a solid background (1-inch 3:4 / 2-inch 35:49 / square 1:1).'
    },
    kind: 'mediapipe',
    section: { face: 'image.sections.mediapipe' },
    params: [
      {
        key: 'ratio',
        label: { zh: '比例', en: 'Aspect ratio' },
        type: 'select',
        default: '3:4',
        options: [
          { label: { zh: '一寸（3:4）', en: '1 inch (3:4)' }, value: '3:4' },
          { label: { zh: '二寸（35:49）', en: '2 inch (35:49)' }, value: '35:49' },
          { label: { zh: '方形（1:1）', en: 'Square (1:1)' }, value: '1:1' }
        ]
      },
      {
        key: 'bg',
        label: { zh: '背景色', en: 'Background' },
        type: 'select',
        default: 'white',
        options: [
          { label: { zh: '白色', en: 'White' }, value: 'white' },
          { label: { zh: '蓝色', en: 'Blue' }, value: 'blue' },
          { label: { zh: '红色', en: 'Red' }, value: 'red' }
        ]
      },
      confidenceParam
    ],
    run: async ({ imageData, params, lang }) => {
      const zh = lang === 'zh'
      const { visionTasks } = await import('~/utils/mediapipe-vision')
      const cfg = visionTasks['face-detection']!
      const { result } = await ai.mediaPipeImageResult(imageData, cfg.create, cfg.method, undefined, {
        minDetectionConfidence: Number(params.confidence)
      })
      const bb = result.detections?.[0]?.boundingBox
      if (!bb) {
        return { imageData, info: [{ label: zh ? '状态' : 'Status', value: zh ? '未检测到人脸' : 'No face detected' }] }
      }
      const ratioKey = String(params.ratio || '3:4')
      const [rw, rh] = ratioKey === '1:1' ? [1, 1] : ratioKey === '35:49' ? [35, 49] : [3, 4]
      // 以人脸框中心为基准：裁切高度取人脸高 ×4（留出发际与肩部），再按比例定宽
      const ch = Math.max(64, Math.min(imageData.height, Math.round(bb.height * 4)))
      const cw = Math.max(16, Math.round(ch * (rw / rh)))
      const cx = bb.originX + bb.width / 2
      const cy = bb.originY + bb.height * 0.55
      const x0 = Math.round(cx - cw / 2)
      const y0 = Math.round(cy - ch * 0.42)
      const bgColors: Record<string, [number, number, number]> = {
        white: [255, 255, 255],
        blue: [67, 142, 219],
        red: [208, 32, 32]
      }
      const [br, bgc, bbc] = bgColors[String(params.bg || 'white')] ?? bgColors.white!
      const out = new ImageData(cw, ch)
      const od = out.data
      for (let i = 0; i < od.length; i += 4) {
        od[i] = br
        od[i + 1] = bgc
        od[i + 2] = bbc
        od[i + 3] = 255
      }
      const sd = imageData.data
      for (let yy = 0; yy < ch; yy++) {
        const sy = y0 + yy
        if (sy < 0 || sy >= imageData.height) continue
        for (let xx = 0; xx < cw; xx++) {
          const sx = x0 + xx
          if (sx < 0 || sx >= imageData.width) continue
          const si = (sy * imageData.width + sx) * 4
          const di = (yy * cw + xx) * 4
          od[di] = sd[si]!
          od[di + 1] = sd[si + 1]!
          od[di + 2] = sd[si + 2]!
        }
      }
      return {
        imageData: out,
        info: [
          { label: zh ? '输出尺寸' : 'Output size', value: `${cw}×${ch}` },
          { label: zh ? '人脸框' : 'Face box', value: `${Math.round(bb.width)}×${Math.round(bb.height)}` }
        ]
      }
    }
  },
  {
    id: 'face-compare',
    page: 'face',
    name: { zh: '人脸比对（1:1）', en: 'Face Verification (1:1)' },
    description: {
      zh: '两张图各取一张人脸，比较 128 维人脸嵌入的余弦相似度，判断是否为同一人。',
      en: 'Extract one face from each image and compare the 128-dim face embeddings by cosine similarity.'
    },
    kind: 'tfjs',
    section: { face: 'image.sections.tfjs' },
    needsSecondImage: true,
    run: async ({ imageData, secondImage, lang }) => {
      const zh = lang === 'zh'
      if (!secondImage) {
        return {
          imageData,
          info: [{ label: zh ? '提示' : 'Hint', value: zh ? '请先上传第二张图（证件照 vs 本人）' : 'Add a second image (ID photo vs selfie)' }]
        }
      }
      const fs = await import('~/utils/face-studio')
      await fs.ensureFaceApiLoaded()
      const [a, b] = await Promise.all([
        fs.extractFaces(toCanvasLocal(imageData)),
        fs.extractFaces(toCanvasLocal(secondImage))
      ])
      if (!a.length || !b.length) {
        return {
          imageData,
          info: [{ label: zh ? '状态' : 'Status', value: zh ? '两张图都需要检测到人脸' : 'Both images need a detectable face' }]
        }
      }
      const sim = fs.cosineSimilarity(a[0]!.descriptor, b[0]!.descriptor)
      const threshold = fs.descriptorDistanceThreshold()
      const same = sim >= threshold
      return {
        imageData,
        info: [
          { label: zh ? '余弦相似度' : 'Cosine similarity', value: sim.toFixed(4) },
          { label: zh ? '判定阈值' : 'Threshold', value: threshold.toFixed(2) },
          { label: zh ? '判定结果' : 'Verdict', value: same ? (zh ? '同一人' : 'Same person') : (zh ? '不同人' : 'Different people') }
        ]
      }
    }
  }
]

// ===== 13 OCR & Document Vision =====

const ocrTools: ImageTool[] = [
  {
    id: 'ocr-text',
    page: 'ocr',
    name: { zh: '文字识别 OCR', en: 'OCR Text Recognition' },
    kind: 'tesseract',
    params: [
      {
        key: 'lang',
        label: { zh: '语言', en: 'Language' },
        type: 'select',
        default: 'eng',
        options: [
          { label: 'English', value: 'eng' },
          { label: '简体中文', value: 'chi_sim' },
          { label: '中英混合', value: 'chi_sim+eng' }
        ]
      }
    ],
    run: async ({ imageData, params, lang }) => {
      const Tesseract = await loadTesseract()
      const worker = await Tesseract.createWorker(String(params.lang), undefined, tesseractLocalOptions())
      try {
        const { data } = await worker.recognize(toCanvasLocal(imageData))
        const text = (data.text || '').trim()
        return {
          imageData,
          info: [{
            label: lang === 'zh' ? '识别文本' : 'Recognized text',
            value: text || (lang === 'zh' ? '（未识别到文字）' : '(no text found)')
          }]
        }
      } finally {
        await worker.terminate()
      }
    }
  },
  {
    id: 'document-scan',
    page: 'ocr',
    name: { zh: '文档扫描 Document Scan', en: 'Document Scan' },
    description: { zh: '自动检测文档轮廓并透视校正（OpenCV.js）。', en: 'Auto-detect the document quad and apply perspective correction (OpenCV.js).' },
    kind: 'opencv',
    run: async ({ imageData, lang }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const blur = new cv.Mat()
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0)
      const thresh = new cv.Mat()
      cv.adaptiveThreshold(blur, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2)
      const contours = new cv.MatVector()
      const hierarchy = new cv.Mat()
      cv.findContours(thresh, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
      // 找最大四边形
      let best: any = null
      let bestArea = 0
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i)
        const area = cv.contourArea(c)
        if (area < bgr.cols * bgr.rows * 0.1) continue
        const peri = cv.arcLength(c, true)
        const approx = new cv.Mat()
        cv.approxPolyDP(c, approx, 0.02 * peri, true)
        if (approx.rows === 4 && area > bestArea) {
          best = approx.clone()
          bestArea = area
        }
        approx.delete()
      }
      let out: any
      if (best) {
        // 按 左上/右上/右下/左下 排序
        const pts: [number, number][] = []
        for (let i = 0; i < 4; i++) pts.push([best.data32S[i * 2], best.data32S[i * 2 + 1]])
        pts.sort((a, b) => a[1] - b[1])
        const [tl, bl] = [pts[0], pts[3]].sort((a, b) => a[0] - b[0])
        const [tr, br] = [pts[1], pts[2]].sort((a, b) => a[0] - b[0])
        const w = Math.max(400, Math.round(Math.hypot(tr[0] - tl[0], tr[1] - tl[1])))
        const h = Math.max(400, Math.round(Math.hypot(bl[0] - tl[0], bl[1] - tl[1])))
        const srcQuad = cv.matFromArray(4, 1, cv.CV_32FC2, [tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1]])
        const dstQuad = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w - 1, 0, w - 1, h - 1, 0, h - 1])
        const m = cv.getPerspectiveTransform(srcQuad, dstQuad)
        out = new cv.Mat()
        cv.warpPerspective(bgr, out, m, new cv.Size(w, h))
        srcQuad.delete(); dstQuad.delete(); m.delete(); best.delete()
      } else {
        out = bgr.clone()
      }
      gray.delete(); blur.delete(); thresh.delete(); contours.delete(); hierarchy.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [{ label: lang === 'zh' ? '文档' : 'Document', value: best ? `${out.cols}×${out.rows}` : (lang === 'zh' ? '未检测到文档轮廓' : 'no document quad found') }]
      }
    })
  },
  {
    id: 'table-structure',
    page: 'ocr',
    name: { zh: '表格结构识别 Table Structure', en: 'Table Structure' },
    description: { zh: '形态学提取横竖线并求交点还原表格网格（经典路数，适合扫描件的深色表格线）。', en: 'Extract horizontal/vertical rules by morphology and detect crossings to recover the table grid (classic approach; works on dark table rules in scans).' },
    kind: 'opencv',
    params: [
      { key: 'scale', label: { zh: '线长比例（%）', en: 'Line length (%)' }, type: 'slider', default: 2, min: 1, max: 8, step: 1 },
      { key: 'thresh', label: { zh: '二值化阈值', en: 'Threshold' }, type: 'slider', default: 180, min: 0, max: 255, step: 1 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const binary = new cv.Mat()
      // 反相二值化：让「深色线条」变成前景白
      cv.threshold(gray, binary, Number(params.thresh ?? 180), 255, cv.THRESH_BINARY_INV)
      const hSize = Math.max(5, Math.round((gray.cols * Number(params.scale ?? 2)) / 100))
      const vSize = Math.max(5, Math.round((gray.rows * Number(params.scale ?? 2)) / 100))
      const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(hSize, 1))
      const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, vSize))
      const hLines = new cv.Mat()
      const vLines = new cv.Mat()
      // 开运算只留「比核更长」的横线/竖线
      cv.morphologyEx(binary, hLines, cv.MORPH_OPEN, hKernel)
      cv.morphologyEx(binary, vLines, cv.MORPH_OPEN, vKernel)
      const intersect = new cv.Mat()
      cv.bitwise_and(hLines, vLines, intersect)
      const out = cvCopy(cv, bgr)
      const hContours = new cv.MatVector()
      const hHier = new cv.Mat()
      cv.findContours(hLines, hContours, hHier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      let hCount = 0
      for (let i = 0; i < hContours.size(); i++) {
        const r = cv.boundingRect(hContours.get(i))
        if (r.width < hSize * 0.6) continue
        cv.rectangle(out, new cv.Point(r.x, r.y), new cv.Point(r.x + r.width, r.y + r.height), new cv.Scalar(0, 255, 0), 1)
        hCount++
      }
      const vContours = new cv.MatVector()
      const vHier = new cv.Mat()
      cv.findContours(vLines, vContours, vHier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      let vCount = 0
      for (let i = 0; i < vContours.size(); i++) {
        const r = cv.boundingRect(vContours.get(i))
        if (r.height < vSize * 0.6) continue
        cv.rectangle(out, new cv.Point(r.x, r.y), new cv.Point(r.x + r.width, r.y + r.height), new cv.Scalar(255, 128, 0), 1)
        vCount++
      }
      const iContours = new cv.MatVector()
      const iHier = new cv.Mat()
      cv.findContours(intersect, iContours, iHier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      let crossings = 0
      for (let i = 0; i < iContours.size(); i++) {
        const m = cv.moments(iContours.get(i))
        if (m.m00 === 0) continue
        cv.circle(out, new cv.Point(m.m10 / m.m00, m.m01 / m.m00), 4, new cv.Scalar(0, 0, 255), -1)
        crossings++
      }
      gray.delete()
      binary.delete()
      hKernel.delete()
      vKernel.delete()
      hLines.delete()
      vLines.delete()
      intersect.delete()
      hContours.delete()
      hHier.delete()
      vContours.delete()
      vHier.delete()
      iContours.delete()
      iHier.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [
          { label: lang === 'zh' ? '横线' : 'H lines', value: `${hCount}` },
          { label: lang === 'zh' ? '竖线' : 'V lines', value: `${vCount}` },
          { label: lang === 'zh' ? '交点（≈网格顶点）' : 'Crossings (grid nodes)', value: `${crossings}` }
        ]
      }
    })
  },
  {
    id: 'handwriting-ocr',
    page: 'ocr',
    name: { zh: '手写识别 Handwriting OCR', en: 'Handwriting OCR' },
    description: { zh: '先二值化增强笔画，再用 Tesseract 单行/单块模式识别。手写准确率有限，仅作演示与对照。', en: 'Binarize to strengthen strokes, then run Tesseract in single-line/block mode. Handwriting accuracy is limited — demo and comparison only.' },
    kind: 'tesseract',
    params: [
      { key: 'thresh', label: { zh: '二值化阈值', en: 'Threshold' }, type: 'slider', default: 150, min: 0, max: 255, step: 1 },
      {
        key: 'lang',
        label: { zh: '语言', en: 'Language' },
        type: 'select',
        default: 'eng',
        options: [
          { label: { zh: '英文', en: 'English' }, value: 'eng' },
          { label: { zh: '简体中文', en: 'Chinese (simplified)' }, value: 'chi_sim' }
        ]
      },
      {
        key: 'psm',
        label: { zh: '版面模式', en: 'Page segmentation' },
        type: 'select',
        default: '7',
        options: [
          { label: { zh: '单行（7）', en: 'Single line (7)' }, value: '7' },
          { label: { zh: '单块（6）', en: 'Single block (6)' }, value: '6' },
          { label: { zh: '稀疏文本（11）', en: 'Sparse text (11)' }, value: '11' }
        ]
      }
    ],
    run: async ({ imageData, params, lang }) => {
      const canvas = toCanvasLocal(imageData)
      const ctx = canvas.getContext('2d')
      const th = Number(params.thresh ?? 150)
      if (ctx) {
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height)
        for (let i = 0; i < d.data.length; i += 4) {
          const lum = 0.299 * d.data[i]! + 0.587 * d.data[i + 1]! + 0.114 * d.data[i + 2]!
          const v = lum >= th ? 255 : 0
          d.data[i] = v
          d.data[i + 1] = v
          d.data[i + 2] = v
        }
        ctx.putImageData(d, 0, 0)
      }
      const Tesseract = await loadTesseract()
      const worker = await Tesseract.createWorker(String(params.lang || 'eng'), undefined, tesseractLocalOptions())
      try {
        await worker.setParameters({ tessedit_pageseg_mode: String(params.psm || '7') })
        const { data } = await worker.recognize(canvas)
        const text = (data.text || '').trim()
        return {
          imageData,
          info: [{
            label: lang === 'zh' ? '识别文本' : 'Recognized text',
            value: text || (lang === 'zh' ? '（未识别到文字）' : '(no text found)')
          }]
        }
      } finally {
        await worker.terminate()
      }
    }
  }
]

// ===== 14 Transformers.js（引擎页 + 深度 / 抠图能力页）=====

/** MODNet 模型/处理器缓存（约 25MB，避免每次抠图重新加载） */
const modnetCache: { model?: any, processor?: any } = {}

const transformersTools: ImageTool[] = [
  {
    id: 'image-caption',
    pages: ['transformers'],
    section: { '*': 'image.sections.depth' },
    name: { zh: '图像描述 Image Captioning', en: 'Image Captioning' },
    kind: 'transformers',
    params: [{
      key: 'maxTokens',
      label: { zh: '最大 Token 数', en: 'Max tokens' },
      type: 'slider',
      default: 40,
      min: 10,
      max: 120,
      step: 5
    }],
    run: async ({ imageData, params, lang }) => {
      const { setupTransformersEnv, preferredDevice, transformersModels } = await import('~/utils/transformers')
      await setupTransformersEnv()
      const { pipeline } = await import('@huggingface/transformers')
      const p = await pipeline('image-to-text' as any, transformersModels.imageCaptioning, { device: preferredDevice(), dtype: 'q8' } as any)
      try {
        const out = await p(toDataUrl(imageData), { max_new_tokens: Number(params.maxTokens) })
        const arr = Array.isArray(out) ? out : [out]
        return {
          imageData,
          info: [{ label: lang === 'zh' ? '图像描述' : 'Caption', value: arr[0]?.generated_text || '' }],
          device: preferredDevice()
        }
      } finally {
        try { await p.dispose() } catch { /* ignore */ }
      }
    }
  },
  {
    id: 'depth-map',
    pages: ['depth', 'transformers'],
    section: { depth: 'image.sections.transformers', transformers: 'image.sections.depth' },
    name: { zh: '深度估计 Depth Map', en: 'Depth Estimation' },
    kind: 'transformers',
    run: async ({ imageData, lang }) => {
      const { setupTransformersEnv, transformersModels } = await import('~/utils/transformers')
      await setupTransformersEnv()
      const { pipeline } = await import('@huggingface/transformers')
      // depth-anything 在 WebGPU（onnxruntime jsep）执行报 "null function"，强制 wasm 稳定
      const p = await pipeline('depth-estimation' as any, transformersModels.depthEstimation, { device: 'wasm', dtype: 'fp32' } as any)
      try {
        const out = await p(toDataUrl(imageData))
        const depth = out?.depth
        if (!depth) return { imageData }
        const imgData = new ImageData(depth.width, depth.height)
        const src = depth.data
        const dst = imgData.data
        for (let i = 0; i < dst.length; i += 4) {
          dst[i] = src[i]
          dst[i + 1] = src[i + 1]
          dst[i + 2] = src[i + 2]
          dst[i + 3] = 255
        }
        return {
          imageData: imgData,
          info: [{ label: lang === 'zh' ? '深度图尺寸' : 'Depth size', value: `${depth.width}×${depth.height}` }],
          device: 'wasm'
        }
      } finally {
        try { await p.dispose() } catch { /* ignore */ }
      }
    }
  },
  {
    id: 'image-qa',
    pages: ['transformers'],
    section: { '*': 'image.sections.depth' },
    name: { zh: '图像问答 Image QA', en: 'Image Question Answering' },
    description: { zh: '基于 Janus-Pro 的图像理解问答（模型 ~1.2GB，首次需下载）。', en: 'Image understanding QA with Janus-Pro (~1.2GB model, first run downloads).' },
    kind: 'transformers',
    params: [
      { key: 'question', label: { zh: '问题', en: 'Question' }, type: 'text', default: 'What is in this picture?' },
      { key: 'maxTokens', label: { zh: '最大 Token 数', en: 'Max tokens' }, type: 'slider', default: 256, min: 32, max: 1024, step: 16 }
    ],
    run: async ({ imageData, params, lang }) => {
      const answer = await ai.janusImageQA(imageData, String(params.question), Number(params.maxTokens))
      return {
        imageData,
        info: [{ label: lang === 'zh' ? '回答' : 'Answer', value: answer || (lang === 'zh' ? '（无回答）' : '(empty)') }]
      }
    }
  },
  {
    id: 'inpainting',
    pages: ['transformers'],
    section: { '*': 'image.sections.depth' },
    name: { zh: '图像修复 Inpainting', en: 'Image Inpainting' },
    description: { zh: 'Moebius 涂抹修复（交互复杂，规划中，可先体验 /aigc/inpainting）。', en: 'Moebius paint-over inpainting (planned; try /aigc/inpainting).' },
    kind: 'transformers',
    planned: true,
    run: ({ imageData, lang }) => ({
      imageData,
      info: [{ label: lang === 'zh' ? '状态' : 'Status', value: lang === 'zh' ? '规划中：可先体验 /aigc/inpainting' : 'Planned: try /aigc/inpainting' }]
    })
  },
  {
    id: 'modnet-matting',
    pages: ['matting', 'transformers'],
    section: { matting: 'image.sections.transformers', transformers: 'image.sections.segmentation' },
    name: { zh: 'MODNet 抠图', en: 'MODNet Matting' },
    description: {
      zh: 'Xenova/modnet 人像抠图（约 25MB），输出带透明通道的结果。',
      en: 'Xenova/modnet person matting (~25MB) producing an alpha channel.'
    },
    kind: 'transformers',
    params: [{
      key: 'alphaThreshold',
      label: { zh: 'Alpha 阈值', en: 'Alpha threshold' },
      type: 'slider',
      default: 64,
      min: 0,
      max: 255,
      step: 1
    }],
    run: async ({ imageData, params, lang }) => {
      const { setupTransformersEnv, preferredDevice } = await import('~/utils/transformers')
      await setupTransformersEnv()
      const { AutoModel, AutoProcessor, RawImage } = await import('@huggingface/transformers')
      const modelId = 'Xenova/modnet'
      if (!modnetCache.model || !modnetCache.processor) {
        modnetCache.processor = await AutoProcessor.from_pretrained(modelId)
        modnetCache.model = await AutoModel.from_pretrained(modelId, {
          dtype: 'fp32',
          device: preferredDevice()
        } as any)
      }
      const img = await RawImage.fromURL(toDataUrl(imageData))
      const { pixel_values } = await modnetCache.processor(img)
      const { output } = await modnetCache.model({ input: pixel_values })
      // output: [1, 1, H, W] 的 alpha matte，先转 uint8 再缩放到原图尺寸
      const maskData = (
        await RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(img.width, img.height)
      ).data
      const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
      const th = Number(params.alphaThreshold ?? 64)
      for (let i = 0; i < maskData.length; i++) {
        // 阈值 + 平滑过渡，避免硬边
        const m = maskData[i] as number
        out.data[4 * i + 3] = m <= th ? 0 : Math.min(255, Math.round(((m - th) / Math.max(1, 255 - th)) * 255))
      }
      return {
        imageData: out,
        info: [{ label: lang === 'zh' ? '输出' : 'Output', value: lang === 'zh' ? '透明背景（下载 PNG 保留）' : 'Transparent (download as PNG)' }],
        device: preferredDevice()
      }
    }
  }
]

// ===== 汇总 =====

export const imageTools: ImageTool[] = [
  ...viewerTools,
  ...transformTools,
  ...colorTools,
  ...adjustmentTools,
  ...filterTools,
  ...enhancementTools,
  ...morphologyTools,
  ...edgeTools,
  ...objectTools,
  ...featureTools,
  ...ocrTools,
  // 能力页里 MediaPipe 实现排在前（模型小、出结果快）
  ...mediaPipeTools,
  ...faceTools,
  // YOLO 实现在能力页里排第二
  ...yoloTools,
  ...transformersTools,
  ...sketchTools
]

/**
 * 图像工坊各页专属示例图（labelKey 在 ImagePlayground 中经 i18n 解析）。
 * 未配置的页回落通用示例列表。选图原则见 docs/vision-sample-keywords.md。
 */
export type ImagePageSample = {
  labelKey: string
  url: string
  /** 可选：双图工具（needsSecondImage）的配对第二图，如特征匹配的「同一场景另一视角」 */
  secondUrl?: string
}

export const imagePageSamples: Partial<Record<ImagePageSlug, ImagePageSample[]>> = {
  viewer: [
    { labelKey: 'samples.landscape', url: '/samples/images/urban-street.jpg' },
    { labelKey: 'samples.street', url: '/samples/images/street.jpg' }
  ],
  transform: [
    // 用户要求：transform 页示例图用 face.jpg（人脸照，便于观察缩放/裁剪效果）
    { labelKey: 'samples.face', url: '/samples/images/face.jpg' },
    { labelKey: 'samples.landscape', url: '/samples/images/urban-street.jpg' }
  ],
  color: [
    { labelKey: 'samples.colorful', url: '/samples/images/colorful.jpg' },
    { labelKey: 'samples.landscape', url: '/samples/images/urban-street.jpg' }
  ],
  adjustment: [
    { labelKey: 'samples.street', url: '/samples/images/street.jpg' },
    { labelKey: 'samples.face', url: '/samples/images/portrait.jpg' }
  ],
  filters: [
    { labelKey: 'samples.texture', url: '/samples/images/texture.jpg' },
    { labelKey: 'samples.face', url: '/samples/images/portrait.jpg' },
    { labelKey: 'samples.landscape', url: '/samples/images/urban-street.jpg' }
  ],
  enhancement: [
    { labelKey: 'samples.noisy', url: '/samples/images/noisy.jpg' },
    { labelKey: 'samples.face', url: '/samples/images/portrait.jpg' }
  ],
  morphology: [
    { labelKey: 'samples.text', url: '/samples/images/text.jpg' },
    { labelKey: 'samples.document', url: '/samples/images/document.jpg' }
  ],
  edge: [
    { labelKey: 'samples.street', url: '/samples/images/street.jpg' },
    { labelKey: 'samples.shapes', url: '/samples/images/shapes.jpg' }
  ],
  object: [
    { labelKey: 'samples.objects', url: '/samples/images/objects.jpg' },
    { labelKey: 'samples.street', url: '/samples/images/street.jpg' }
  ],
  features: [
    { labelKey: 'samples.tajPair', url: '/samples/images/taj-a.jpg', secondUrl: '/samples/images/taj-b.jpg' },
    { labelKey: 'samples.checkerboard', url: '/samples/images/checkerboard.jpg' },
    { labelKey: 'samples.street', url: '/samples/images/street.jpg' }
  ],
  face: [
    { labelKey: 'samples.group', url: '/samples/images/group.jpg' },
    { labelKey: 'samples.face', url: '/samples/images/portrait.jpg', secondUrl: '/samples/images/face.jpg' }
  ],
  ocr: [
    { labelKey: 'samples.document', url: '/samples/images/document.jpg' }
  ],
  mediapipe: [
    { labelKey: 'samples.group', url: '/samples/images/group.jpg' },
    { labelKey: 'samples.hand', url: '/samples/images/hand.jpg' },
    { labelKey: 'samples.pose', url: '/samples/images/pose.jpg' }
  ],
  yolo: [
    { labelKey: 'samples.person', url: '/samples/images/group.jpg' },
    { labelKey: 'samples.dog', url: '/samples/images/dog.jpg' },
    { labelKey: 'samples.street', url: '/samples/images/street.jpg' }
  ],
  transformers: [
    { labelKey: 'samples.landscape', url: '/samples/images/urban-street.jpg' },
    { labelKey: 'samples.dog', url: '/samples/images/dog.jpg' },
    { labelKey: 'samples.pose', url: '/samples/images/pose.jpg' }
  ],
  detection: [
    { labelKey: 'samples.street', url: '/samples/images/street.jpg' },
    { labelKey: 'samples.group', url: '/samples/images/group.jpg' }
  ],
  classification: [
    { labelKey: 'samples.dog', url: '/samples/images/dog.jpg' },
    { labelKey: 'samples.bird', url: '/samples/images/bird.jpg' },
    { labelKey: 'samples.cat', url: '/samples/images/cat.jpg' }
  ],
  segmentation: [
    { labelKey: 'samples.personPhoto', url: '/samples/images/person.jpg' },
    { labelKey: 'samples.group', url: '/samples/images/group.jpg' },
    { labelKey: 'samples.desk', url: '/samples/images/desk.jpg' }
  ],
  matting: [
    { labelKey: 'samples.pose', url: '/samples/images/pose.jpg' },
    { labelKey: 'samples.face', url: '/samples/images/portrait.jpg' }
  ],
  depth: [
    { labelKey: 'samples.street', url: '/samples/images/street.jpg' },
    { labelKey: 'samples.landscape', url: '/samples/images/urban-street.jpg' }
  ],
  pose: [
    { labelKey: 'samples.pose', url: '/samples/images/pose.jpg' },
    { labelKey: 'samples.group', url: '/samples/images/group.jpg' }
  ]
}

/** 工具归属的页面列表：设置了 pages 以 pages 为准，否则回落单值 page */
export function toolPages(tool: ImageTool): string[] {
  return tool.pages ?? (tool.page ? [tool.page] : [])
}

export function imageToolsByPage(slug: string): ImageTool[] {
  return imageTools.filter(t => toolPages(t).includes(slug))
}

export function getImageTool(page: string, toolId: string): ImageTool | undefined {
  return imageTools.find(t => toolPages(t).includes(page) && t.id === toolId)
}
