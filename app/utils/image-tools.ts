/**
 * 图像工坊（Image Lab）工具注册表。
 *
 * 与 vision/[slug].vue 的 visionTasks 注册表同构：新增工具 = 注册一条记录 + 实现 run。
 * kind 决定实现层：
 *   - canvas      : 纯浏览器 ImageData 运算（本文件内直接调用 image-algorithms）
 *   - opencv      : OpenCV.js（08-11 页，P3 引入）
 *   - mediapipe   : MediaPipe Tasks（12/14 页）
 *   - transformers: Transformers.js（14/15 页）
 *   - tesseract   : Tesseract.js（13 页）
 *   - python      : Python 后端异步队列（12/15 页重型能力）
 *
 * 每个工具都有对应的 Python 参考实现 python/image/<page>/main.py（子命令式），
 * 通过 PythonSourceViewer 的 feature = pythonModule 展示。
 */

import type { ParamSpec } from '~/utils/params'
import * as alg from '~/utils/image-algorithms'
import { loadOpenCv, imageDataToMat, matToImageData, withCvMat } from '~/utils/opencv'
import * as ai from '~/utils/image-ai'
import { loadTesseract } from '~/utils/tesseract'

export type ImagePageSlug =
  | 'viewer'
  | 'transform'
  | 'pixel'
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
  | 'ai-vision'
  | 'multimodal'

export type ImageToolKind = 'canvas' | 'opencv' | 'mediapipe' | 'transformers' | 'tesseract' | 'python'

export interface LocalizedText {
  zh: string
  en: string
}

export interface LocalizedParamOption {
  label: LocalizedText
  value: string | number | boolean
}

export interface LocalizedParamSpec extends Omit<ParamSpec, 'label' | 'help' | 'options'> {
  label: LocalizedText
  help?: LocalizedText
  options?: LocalizedParamOption[]
}

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
}

export interface ImageTool {
  id: string
  page: ImagePageSlug
  name: LocalizedText
  description?: LocalizedText
  kind: ImageToolKind
  /** 交互模式：click = 点击结果画布触发 onPick */
  interactive?: 'click'
  /** 需要上传第二张图 */
  needsSecondImage?: boolean
  /** 规划中：仅展示说明，不执行（重型模型/依赖未就绪） */
  planned?: boolean
  params?: LocalizedParamSpec[]
  /** Python 参考实现模块路径（feature=... -> python/<path>/main.py） */
  pythonModule: string
  run: (ctx: ImageToolContext) => ImageToolResult | Promise<ImageToolResult>
  onPick?: (ctx: ImageToolContext, x: number, y: number) => { label: string; value: string }[]
}

export function pickText(t: LocalizedText, lang: 'zh' | 'en'): string {
  return t[lang] ?? t.en
}

export function buildParamSpecs(specs: LocalizedParamSpec[] | undefined, lang: 'zh' | 'en'): ParamSpec[] {
  if (!specs) return []
  return specs.map(s => ({
    key: s.key,
    label: pickText(s.label, lang),
    type: s.type,
    default: s.default,
    min: s.min,
    max: s.max,
    step: s.step,
    options: s.options?.map(o => ({ label: pickText(o.label, lang), value: o.value })),
    help: s.help ? pickText(s.help, lang) : undefined,
    disableWhileRunning: s.disableWhileRunning
  }))
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
    pythonModule: 'image/viewer',
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
    pythonModule: 'image/viewer',
    run: ({ imageData, lang }) => ({ imageData, info: hint(lang) }),
    onPick: (ctx, x, y) => alg.pixelInfoRows(alg.pixelInfo(ctx.imageData, x, y), ctx.lang)
  }
]

// ===== 02 Image Transform =====

const transformTools: ImageTool[] = [
  {
    id: 'resize',
    page: 'transform',
    name: { zh: '缩放 Resize', en: 'Resize' },
    kind: 'canvas',
    pythonModule: 'image/transform',
    params: [
      { key: 'width', label: { zh: '宽度', en: 'Width' }, type: 'number', default: 800, min: 1, max: 4096 },
      { key: 'height', label: { zh: '高度', en: 'Height' }, type: 'number', default: 600, min: 1, max: 4096 },
      { key: 'keep', label: { zh: '保持宽高比（以宽度为准）', en: 'Keep aspect ratio (by width)' }, type: 'switch', default: true }
    ],
    run: ({ imageData, params, lang }) => {
      const w = Math.max(1, Math.round(Number(params.width) || 800))
      let h = Math.max(1, Math.round(Number(params.height) || 600))
      if (params.keep) h = Math.max(1, Math.round(imageData.height * (w / imageData.width)))
      return { imageData: alg.resize(imageData, w, h), info: dimsInfo(w, h, lang) }
    }
  },
  {
    id: 'crop',
    page: 'transform',
    name: { zh: '裁剪 Crop', en: 'Crop' },
    kind: 'canvas',
    pythonModule: 'image/transform',
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
    pythonModule: 'image/transform',
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
    pythonModule: 'image/transform',
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
    pythonModule: 'image/transform',
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
    pythonModule: 'image/transform',
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
    pythonModule: 'image/transform',
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
    pythonModule: 'image/transform',
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

// ===== 03 Pixel Processing =====

const pixelTools: ImageTool[] = [
  {
    id: 'read-pixel',
    page: 'pixel',
    name: { zh: '读取像素 Read Pixel', en: 'Read Pixel' },
    description: { zh: '点击画布读取像素的 RGB(A) 值。', en: 'Click the canvas to read pixel RGBA values.' },
    kind: 'canvas',
    interactive: 'click',
    pythonModule: 'image/pixel',
    run: ({ imageData, lang }) => ({ imageData, info: hint(lang) }),
    onPick: (ctx, x, y) => alg.pixelInfoRows(alg.pixelInfo(ctx.imageData, x, y), ctx.lang)
  },
  {
    id: 'pixel-grid',
    page: 'pixel',
    name: { zh: '像素网格 Pixel Grid', en: 'Pixel Grid' },
    description: { zh: '把中心区域放大为像素格子，观察单个像素。', en: 'Magnify the center region into a pixel grid.' },
    kind: 'canvas',
    pythonModule: 'image/pixel',
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
    page: 'pixel',
    name: { zh: '像素运算 Pixel Math', en: 'Pixel Math' },
    description: { zh: '对每个像素做加减乘除运算（含归一化/钳制）。', en: 'Add, subtract, multiply or divide every pixel (clamped).' },
    kind: 'canvas',
    pythonModule: 'image/pixel',
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
    pythonModule: 'image/color',
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
    pythonModule: 'image/color',
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
    pythonModule: 'image/color',
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
    pythonModule: 'image/color',
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
    pythonModule: 'image/color',
    params: [
      { key: 'k', label: { zh: '颜色数量 k', en: 'Color count k' }, type: 'slider', default: 8, min: 2, max: 16, step: 1 }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.colorQuantize(imageData, Number(params.k)) })
  },
  {
    id: 'color-space-info',
    page: 'color',
    name: { zh: '色彩空间 Color Space', en: 'Color Space' },
    description: { zh: '点击画布查看像素在 RGB/HSV/HSL/Lab 下的值。', en: 'Click the canvas to see pixel values in RGB/HSV/HSL/Lab.' },
    kind: 'canvas',
    interactive: 'click',
    pythonModule: 'image/color',
    run: ({ imageData, lang }) => ({ imageData, info: hint(lang) }),
    onPick: (ctx, x, y) => alg.pixelInfoRows(alg.pixelInfo(ctx.imageData, x, y), ctx.lang)
  }
]

// ===== 05 Image Adjustment =====

const adjustmentTools: ImageTool[] = [
  {
    id: 'brightness',
    page: 'adjustment',
    name: { zh: '亮度 Brightness', en: 'Brightness' },
    kind: 'canvas',
    pythonModule: 'image/adjust',
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
    pythonModule: 'image/adjust',
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
    pythonModule: 'image/adjust',
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
    pythonModule: 'image/adjust',
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
    pythonModule: 'image/adjust',
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
    pythonModule: 'image/adjust',
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
    pythonModule: 'image/adjust',
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
    pythonModule: 'image/adjust',
    run: ({ imageData }) => ({ imageData: alg.autoContrast(imageData) })
  },
  {
    id: 'auto-brightness',
    page: 'adjustment',
    name: { zh: '自动亮度 Auto Brightness', en: 'Auto Brightness' },
    description: { zh: '把平均亮度自动调整到中灰。', en: 'Shift the mean luminance to mid-gray automatically.' },
    kind: 'canvas',
    pythonModule: 'image/adjust',
    run: ({ imageData }) => ({ imageData: alg.autoBrightness(imageData) })
  }
]

// ===== 06 Image Filters =====

const filterTools: ImageTool[] = [
  {
    id: 'box-blur',
    page: 'filters',
    name: { zh: '方框模糊 Box Blur', en: 'Box Blur' },
    kind: 'canvas',
    pythonModule: 'image/filters',
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
    pythonModule: 'image/filters',
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
    pythonModule: 'image/filters',
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
    pythonModule: 'image/filters',
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
    pythonModule: 'image/filters',
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
    pythonModule: 'image/filters',
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
    pythonModule: 'image/filters',
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
    pythonModule: 'image/filters',
    run: ({ imageData }) => ({ imageData: alg.highPass(imageData) })
  }
]

// ===== 07 Noise & Enhancement =====

const enhancementTools: ImageTool[] = [
  {
    id: 'add-noise',
    page: 'enhancement',
    name: { zh: '添加噪声 Add Noise', en: 'Add Noise' },
    kind: 'canvas',
    pythonModule: 'image/enhancement',
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
    pythonModule: 'image/enhancement',
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
    pythonModule: 'image/enhancement',
    run: ({ imageData }) => ({ imageData: alg.renderHistogram(alg.luminanceHistogram(imageData)) })
  },
  {
    id: 'histogram-equalize',
    page: 'enhancement',
    name: { zh: '直方图均衡 Histogram Equalization', en: 'Histogram Equalization' },
    kind: 'canvas',
    pythonModule: 'image/enhancement',
    run: ({ imageData }) => ({ imageData: alg.histogramEqualization(imageData) })
  },
  {
    id: 'enhance',
    page: 'enhancement',
    name: { zh: '图像增强 Enhance', en: 'Image Enhancement' },
    description: { zh: '自动亮度 + 自动对比度组合增强。', en: 'Auto brightness + auto contrast combined.' },
    kind: 'canvas',
    pythonModule: 'image/enhancement',
    run: ({ imageData }) => ({ imageData: alg.enhance(imageData) })
  },
  {
    id: 'super-res',
    page: 'enhancement',
    name: { zh: '超分辨率 Super Resolution', en: 'Super Resolution' },
    description: { zh: '简化版：高质量放大 + USM 锐化（完整版见 Python 参考）。', en: 'Simplified: high-quality upscale + USM (full version in Python reference).' },
    kind: 'canvas',
    pythonModule: 'image/enhancement',
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
    pythonModule: 'image/morphology',
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
    pythonModule: 'image/morphology',
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
    pythonModule: 'image/morphology',
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
    pythonModule: 'image/morphology',
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
    pythonModule: 'image/morphology',
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
    pythonModule: 'image/morphology',
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
    pythonModule: 'image/morphology',
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
    pythonModule: 'image/morphology',
    params: [
      { key: 'size', label: { zh: '结构元素大小', en: 'Kernel size' }, type: 'select', default: 3, options: morphSizeOptions }
    ],
    run: ({ imageData, params }) => ({ imageData: alg.morphGradient(imageData, Number(params.size)) })
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
    pythonModule: 'image/edge',
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
    pythonModule: 'image/edge',
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
    pythonModule: 'image/edge',
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
    pythonModule: 'image/edge',
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
    pythonModule: 'image/edge',
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
    pythonModule: 'image/edge',
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
    pythonModule: 'image/edge',
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
    id: 'polygon-detect',
    page: 'edge',
    name: { zh: '多边形检测 Polygon', en: 'Polygon Detection' },
    kind: 'opencv',
    pythonModule: 'image/edge',
    params: [
      { key: 'epsilon', label: { zh: '近似精度 ε（%）', en: 'Approx epsilon (%)' }, type: 'slider', default: 2, min: 0.5, max: 10, step: 0.5 }
    ],
    run: async ({ imageData, params, lang }) => withCvMat(imageData, (cv, bgr) => {
      const gray = cvGray(cv, bgr)
      const edges = new cv.Mat()
      cv.Canny(gray, edges, 80, 200)
      const contours = new cv.MatVector()
      const hierarchy = new cv.Mat()
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      const out = cvCopy(cv, bgr)
      let polys = 0
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i)
        const area = cv.contourArea(c)
        if (area < 50) continue
        const approx = new cv.Mat()
        cv.approxPolyDP(c, approx, cv.arcLength(c, true) * Number(params.epsilon) / 100, true)
        cv.polylines(out, [approx], true, new cv.Scalar(0, 255, 0), 2)
        polys++
        approx.delete()
      }
      gray.delete(); edges.delete(); contours.delete(); hierarchy.delete()
      return {
        imageData: matToImageData(cv, out),
        info: [{ label: lang === 'zh' ? '多边形数' : 'Polygons', value: `${polys}` }]
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
    pythonModule: 'image/object',
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
      const low = new cv.Scalar(Number(params.hMin), Number(params.sMin), Number(params.vMin))
      const high = new cv.Scalar(Number(params.hMax), Number(params.sMax), Number(params.vMax))
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
      contours.delete(); hierarchy.delete(); hsv.delete(); mask.delete()
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
    pythonModule: 'image/object',
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
    pythonModule: 'image/object',
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
    pythonModule: 'image/object',
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
    pythonModule: 'image/object',
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
    pythonModule: 'image/object',
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
    pythonModule: 'image/object',
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
    pythonModule: 'image/features',
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
    pythonModule: 'image/features',
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
    pythonModule: 'image/features',
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
  }
]

// ===== 本地小工具 =====

function toCanvasLocal(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.putImageData(imageData, 0, 0)
  return canvas
}

function toDataUrl(imageData: ImageData): string {
  return toCanvasLocal(imageData).toDataURL('image/png')
}

/** 提交 multipart 任务并轮询直到完成/失败（用于 Python 后端异步任务） */
async function submitAndPoll(
  submitUrl: string,
  form: FormData,
  pollUrl: (taskId: string) => string,
  timeoutMs = 10 * 60 * 1000
): Promise<any> {
  const res = await $fetch<any>(submitUrl, { method: 'POST', body: form })
  if (!res?.ok) throw new Error(res?.error || '提交任务失败')
  const deadline = Date.now() + timeoutMs
  let task: any = null
  while (Date.now() < deadline) {
    await ai.sleep(1000)
    task = await $fetch<any>(pollUrl(res.taskId))
    if (task && ['done', 'error', 'cancelled'].includes(task.status)) break
  }
  if (!task) throw new Error('任务超时')
  if (task.status !== 'done') throw new Error(task.error || task.message || task.status)
  return task
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
    id: 'face-detect',
    page: 'face',
    name: { zh: '人脸检测 Face Detection', en: 'Face Detection' },
    kind: 'mediapipe',
    pythonModule: 'image/face',
    params: [confidenceParam],
    run: async ({ imageData, params, lang }) => {
      const { visionTasks } = await import('~/utils/mediapipe-vision')
      const cfg = visionTasks['face-detection']
      const { imageData: out, result } = await ai.mediaPipeImageResult(imageData, cfg.create, cfg.method, cfg.draw, {
        minDetectionConfidence: Number(params.confidence)
      })
      return {
        imageData: out,
        info: [{ label: lang === 'zh' ? '检测到人脸' : 'Faces detected', value: `${result.detections?.length ?? 0}` }]
      }
    }
  },
  {
    id: 'face-landmark',
    page: 'face',
    name: { zh: '人脸关键点 Face Landmark', en: 'Face Landmark' },
    kind: 'mediapipe',
    pythonModule: 'image/face',
    params: [confidenceParam],
    run: async ({ imageData, params, lang }) => {
      const { visionTasks } = await import('~/utils/mediapipe-vision')
      const cfg = visionTasks['face-landmarker']
      const { imageData: out, result } = await ai.mediaPipeImageResult(imageData, cfg.create, cfg.method, cfg.draw, {
        minDetectionConfidence: Number(params.confidence)
      })
      return {
        imageData: out,
        info: [{ label: lang === 'zh' ? '人脸数' : 'Faces', value: `${result.faceLandmarks?.length ?? 0}` }]
      }
    }
  },
  {
    id: 'face-blur',
    page: 'face',
    name: { zh: '人脸模糊 Face Blur', en: 'Face Blur' },
    kind: 'mediapipe',
    pythonModule: 'image/face',
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
    pythonModule: 'image/face',
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
    id: 'face-register',
    page: 'face',
    name: { zh: '人脸注册与识别 Face Registration', en: 'Face Registration & Recognition' },
    description: { zh: '注册人脸姓名，之后上传照片即可识别身份（insightface + 浏览器本地注册库）。', en: 'Register faces with names, then identify unknown photos (insightface + local registry).' },
    kind: 'python',
    pythonModule: 'image/face',
    run: ({ imageData, lang }) => ({
      imageData,
      info: [{ label: lang === 'zh' ? '提示' : 'Hint', value: lang === 'zh' ? '使用下方「人脸注册与识别」面板完成注册与识别' : 'Use the registration panel below to register and recognize faces' }]
    })
  },
  {
    id: 'face-verification',
    page: 'face',
    name: { zh: '人脸验证 Face Verification', en: 'Face Verification' },
    description: { zh: '比较两张人脸是否为同一人（insightface，Python 后端）。', en: 'Compare whether two faces are the same person (insightface, Python backend).' },
    kind: 'python',
    needsSecondImage: true,
    pythonModule: 'image/face',
    run: async ({ imageData, secondImage, lang }) => {
      if (!secondImage) {
        return {
          imageData,
          info: [{ label: lang === 'zh' ? '提示' : 'Hint', value: lang === 'zh' ? '请先上传第二张图' : 'Upload a second image first' }]
        }
      }
      const form = new FormData()
      form.append('file', ai.dataUrlToBlob(toDataUrl(imageData)), 'input.png')
      form.append('file2', ai.dataUrlToBlob(toDataUrl(secondImage)), 'input2.png')
      form.append('mode', 'verification')
      const task = await submitAndPoll('/api/image/face-recognition', form, id => `/api/image/face-recognition/${id}`)
      const r = task.result || {}
      return {
        imageData,
        info: [
          { label: lang === 'zh' ? '余弦相似度' : 'Similarity', value: `${r.similarity ?? '-'}` },
          { label: lang === 'zh' ? '结论' : 'Verdict', value: r.verdict === 'same' ? (lang === 'zh' ? '同一人' : 'Same person') : (lang === 'zh' ? '不同人' : 'Different persons') }
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
    pythonModule: 'image/ocr',
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
      const worker = await Tesseract.createWorker(String(params.lang))
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
    pythonModule: 'image/ocr',
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
  }
]

// ===== 14 AI Object & Image Vision =====

const aiVisionTools: ImageTool[] = [
  {
    id: 'image-classify',
    page: 'ai-vision',
    name: { zh: '图像分类 Image Classification', en: 'Image Classification' },
    kind: 'mediapipe',
    pythonModule: 'image/ai-vision',
    params: [{
      key: 'max',
      label: { zh: '结果数量', en: 'Top K' },
      type: 'slider',
      default: 5,
      min: 1,
      max: 10,
      step: 1
    }],
    run: async ({ imageData, params, lang }) => {
      const { visionTasks } = await import('~/utils/mediapipe-vision')
      const cfg = visionTasks['image-classifier']
      const { imageData: out, result } = await ai.mediaPipeImageResult(imageData, cfg.create, cfg.method, undefined, {
        maxResults: Number(params.max)
      })
      const cats = result.classifications?.[0]?.categories ?? []
      return {
        imageData: out,
        info: cats.slice(0, 10).map(c => ({
          label: c.categoryName || '?',
          value: `${Math.round((c.score || 0) * 100)}%`
        }))
      }
    }
  },
  {
    id: 'object-detect',
    page: 'ai-vision',
    name: { zh: '目标检测 Object Detection', en: 'Object Detection' },
    kind: 'mediapipe',
    pythonModule: 'image/ai-vision',
    params: [{
      key: 'max',
      label: { zh: '最多目标', en: 'Max objects' },
      type: 'slider',
      default: 5,
      min: 1,
      max: 20,
      step: 1
    }],
    run: async ({ imageData, params, lang }) => {
      const { visionTasks } = await import('~/utils/mediapipe-vision')
      const cfg = visionTasks['object-detector']
      const { imageData: out, result } = await ai.mediaPipeImageResult(imageData, cfg.create, cfg.method, cfg.draw, {
        maxResults: Number(params.max)
      })
      const dets = result.detections ?? []
      return {
        imageData: out,
        info: dets.slice(0, 10).map((d: any) => ({
          label: d.categories?.[0]?.categoryName || 'object',
          value: `${Math.round((d.categories?.[0]?.score || 0) * 100)}%`
        }))
      }
    }
  },
  {
    id: 'image-segment',
    page: 'ai-vision',
    name: { zh: '图像分割 Image Segmentation', en: 'Image Segmentation' },
    kind: 'mediapipe',
    pythonModule: 'image/ai-vision',
    run: async ({ imageData }) => ({ imageData: await ai.segmentImage(imageData, 'overlay') })
  },
  {
    id: 'background-removal',
    page: 'ai-vision',
    name: { zh: '背景移除 Background Removal', en: 'Background Removal' },
    kind: 'mediapipe',
    pythonModule: 'image/ai-vision',
    run: async ({ imageData, lang }) => ({
      imageData: await ai.segmentImage(imageData, 'background-removal'),
      info: [{ label: lang === 'zh' ? '提示' : 'Hint', value: lang === 'zh' ? '下载 PNG 保留透明背景' : 'Download as PNG to keep transparency' }]
    })
  },
  {
    id: 'image-embed',
    page: 'ai-vision',
    name: { zh: '图像嵌入 Image Embedding', en: 'Image Embedding' },
    kind: 'mediapipe',
    pythonModule: 'image/ai-vision',
    run: async ({ imageData, lang }) => {
      const vec = await ai.imageEmbedding(imageData)
      const head = Array.from(vec.slice(0, 6)).map(v => v.toFixed(3)).join(', ')
      return {
        imageData,
        info: [
          { label: lang === 'zh' ? '向量维度' : 'Dimension', value: `${vec.length}` },
          { label: lang === 'zh' ? '前 6 维' : 'First 6 values', value: `[${head}, …]` }
        ]
      }
    }
  },
  {
    id: 'image-similarity',
    page: 'ai-vision',
    name: { zh: '图像相似度 Image Similarity', en: 'Image Similarity' },
    description: { zh: '计算两张图的余弦相似度（上传第二张图）。', en: 'Cosine similarity between two images (upload a second image).' },
    kind: 'mediapipe',
    needsSecondImage: true,
    pythonModule: 'image/ai-vision',
    run: async ({ imageData, secondImage, lang }) => {
      if (!secondImage) {
        return {
          imageData,
          info: [{ label: lang === 'zh' ? '提示' : 'Hint', value: lang === 'zh' ? '请先上传第二张图' : 'Upload a second image first' }]
        }
      }
      const [v1, v2] = await Promise.all([ai.imageEmbedding(imageData), ai.imageEmbedding(secondImage)])
      const sim = ai.cosineSimilarity(v1, v2)
      return {
        imageData,
        info: [{ label: lang === 'zh' ? '余弦相似度' : 'Cosine similarity', value: sim.toFixed(4) }]
      }
    }
  }
]

// ===== 15 AI Vision & Multimodal =====

const multimodalTools: ImageTool[] = [
  {
    id: 'image-caption',
    page: 'multimodal',
    name: { zh: '图像描述 Image Captioning', en: 'Image Captioning' },
    kind: 'transformers',
    pythonModule: 'image/multimodal',
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
          info: [{ label: lang === 'zh' ? '图像描述' : 'Caption', value: arr[0]?.generated_text || '' }]
        }
      } finally {
        try { await p.dispose() } catch { /* ignore */ }
      }
    }
  },
  {
    id: 'depth-map',
    page: 'multimodal',
    name: { zh: '深度估计 Depth Map', en: 'Depth Estimation' },
    kind: 'transformers',
    pythonModule: 'image/multimodal',
    run: async ({ imageData, lang }) => {
      const { setupTransformersEnv, preferredDevice, transformersModels } = await import('~/utils/transformers')
      await setupTransformersEnv()
      const { pipeline } = await import('@huggingface/transformers')
      const p = await pipeline('depth-estimation' as any, transformersModels.depthEstimation, { device: preferredDevice(), dtype: 'fp32' } as any)
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
          info: [{ label: lang === 'zh' ? '深度图尺寸' : 'Depth size', value: `${depth.width}×${depth.height}` }]
        }
      } finally {
        try { await p.dispose() } catch { /* ignore */ }
      }
    }
  },
  {
    id: 'image-qa',
    page: 'multimodal',
    name: { zh: '图像问答 Image QA', en: 'Image Question Answering' },
    description: { zh: '基于 Janus-Pro 的图像理解问答（模型 ~1.2GB，首次需下载）。', en: 'Image understanding QA with Janus-Pro (~1.2GB model, first run downloads).' },
    kind: 'transformers',
    pythonModule: 'image/multimodal',
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
    page: 'multimodal',
    name: { zh: '图像修复 Inpainting', en: 'Image Inpainting' },
    description: { zh: 'Moebius 涂抹修复（交互复杂，规划中，可先体验 /aigc/inpainting）。', en: 'Moebius paint-over inpainting (planned; try /aigc/inpainting).' },
    kind: 'transformers',
    planned: true,
    pythonModule: 'image/multimodal',
    run: ({ imageData, lang }) => ({
      imageData,
      info: [{ label: lang === 'zh' ? '状态' : 'Status', value: lang === 'zh' ? '规划中：可先体验 /aigc/inpainting' : 'Planned: try /aigc/inpainting' }]
    })
  },
  {
    id: 'style-transfer',
    page: 'multimodal',
    name: { zh: '风格迁移 / 图生图', en: 'Style Transfer / Image-to-Image' },
    description: { zh: '基于 SD-Turbo 的图生图（Python 后端异步任务）。', en: 'Image-to-image with SD-Turbo (Python backend).' },
    kind: 'python',
    pythonModule: 'image/multimodal',
    params: [
      { key: 'prompt', label: { zh: '提示词', en: 'Prompt' }, type: 'text', default: 'a watercolor painting, soft colors, artistic' },
      { key: 'strength', label: { zh: '变换强度', en: 'Strength' }, type: 'slider', default: 0.75, min: 0.1, max: 1, step: 0.05 },
      { key: 'steps', label: { zh: '步数', en: 'Steps' }, type: 'slider', default: 4, min: 1, max: 8, step: 1 }
    ],
    run: async ({ imageData, params, lang }) => {
      const form = new FormData()
      form.append('file', ai.dataUrlToBlob(toDataUrl(imageData)), 'input.png')
      form.append('text', String(params.prompt))
      form.append('mode', 'img2img')
      form.append('strength', String(params.strength))
      form.append('steps', String(params.steps))
      const task = await submitAndPoll('/api/aigc/sd-turbo', form, id => `/api/aigc/sd-turbo/${id}`)
      const url = task.resultUrl as string
      const blob = await (await fetch(url)).blob()
      const bmp = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bmp.width
      canvas.height = bmp.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bmp, 0, 0)
      return {
        imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
        info: [{ label: lang === 'zh' ? '结果' : 'Result', value: url }]
      }
    }
  }
]

// ===== 汇总 =====

export const imageTools: ImageTool[] = [
  ...viewerTools,
  ...transformTools,
  ...pixelTools,
  ...colorTools,
  ...adjustmentTools,
  ...filterTools,
  ...enhancementTools,
  ...morphologyTools,
  ...edgeTools,
  ...objectTools,
  ...featureTools,
  ...faceTools,
  ...ocrTools,
  ...aiVisionTools,
  ...multimodalTools
]

export const imagePages: { slug: ImagePageSlug; tools: ImageTool[] }[] = [
  { slug: 'viewer', tools: viewerTools },
  { slug: 'transform', tools: transformTools },
  { slug: 'pixel', tools: pixelTools },
  { slug: 'color', tools: colorTools },
  { slug: 'adjustment', tools: adjustmentTools },
  { slug: 'filters', tools: filterTools },
  { slug: 'enhancement', tools: enhancementTools },
  { slug: 'morphology', tools: morphologyTools },
  { slug: 'edge', tools: edgeTools },
  { slug: 'object', tools: objectTools },
  { slug: 'features', tools: featureTools },
  { slug: 'face', tools: faceTools },
  { slug: 'ocr', tools: ocrTools },
  { slug: 'ai-vision', tools: aiVisionTools },
  { slug: 'multimodal', tools: multimodalTools }
]

export function imageToolsByPage(slug: string): ImageTool[] {
  return imageTools.filter(t => t.page === slug)
}

export function getImageTool(page: string, toolId: string): ImageTool | undefined {
  return imageTools.find(t => t.page === page && t.id === toolId)
}
