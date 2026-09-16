/**
 * 简笔画识别（/vision/sketch 能力页）—— 同一任务的两条实现路径：
 *   ① DoodleNet：Google Quick, Draw! 数据集（345 类）训练的 CNN，预置类别、无需教学
 *   ② MobileNet + KNN：现场把用户自己的涂鸦归入自定义类别，零训练循环、即时生效
 *
 * 输入统一为手绘画布（ImageTool.needsDrawing -> ImagePlayground 渲染 SketchCanvas），
 * 画的快照即 ImageData，走与其它工具完全相同的 run() 管线。
 */
import type { ImageTool, ImageToolResult } from '~/utils/image-tools'
import type { LocalizedParamSpec } from '~/utils/localized'
import { doodleClassify, predictDoodle, resetDoodleSamples, teachDoodle } from '~/utils/doodle'
import { formatDoodleLabel } from '~/utils/doodle-labels'

/** 手绘画布快照（ImageData）→ HTMLCanvasElement：喂给 DoodleNet / MobileNet */
function toCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.putImageData(imageData, 0, 0)
  return canvas
}

const TOPK_PARAM: LocalizedParamSpec = {
  key: 'topK',
  label: { zh: '返回类别数（Top-K）', en: 'Top-K results' },
  type: 'slider',
  default: 5,
  min: 1,
  max: 10,
  step: 1
}

function topRows(confidences: Record<string, number>) {
  return Object.entries(confidences)
    .map(([label, v]) => ({ label, value: `${Math.round(Number(v) * 100)}%` }))
    .sort((a, b) => Number.parseFloat(b.value) - Number.parseFloat(a.value))
}

const doodleNetTool: ImageTool = {
  id: 'doodlenet',
  pages: ['sketch'],
  name: { zh: 'DoodleNet（Quick Draw 345 类）', en: 'DoodleNet (Quick Draw, 345 classes)' },
  description: {
    zh: '白底粗黑线画一笔，CNN 直接给出最可能的类别（DoodleNet，用 Google Quick, Draw! 的 345 类训练）。首次使用需联网下载模型；345 个类别名均已配中文对照。',
    en: 'Draw with thick black lines on white and a CNN returns the most likely category (DoodleNet, trained on Google Quick, Draw!\'s 345 classes). The first run downloads the model; class names come from the dataset (English).'
  },
  kind: 'tfjs',
  section: { '*': 'image.sections.pretrained' },
  needsDrawing: true,
  params: [TOPK_PARAM],
  run: async ({ imageData, params, lang }): Promise<ImageToolResult> => {
    const zh = lang === 'zh'
    const hits = await doodleClassify(toCanvas(imageData), Number(params.topK ?? 5))
    if (!hits.length) {
      return { imageData, info: [{ label: zh ? '状态' : 'Status', value: zh ? '未得到结果' : 'No result' }] }
    }
    return {
      imageData,
      info: [
        { label: zh ? '最可能' : 'Top guess', value: formatDoodleLabel(hits[0]!.label, zh) },
        ...hits.map(h => ({
          label: formatDoodleLabel(h.label, zh),
          value: `${Math.round(h.confidence * 100)}%`
        }))
      ]
    }
  }
}

const teachTool: ImageTool = {
  id: 'doodle-teach',
  pages: ['sketch'],
  name: { zh: '现场教它认（MobileNet + KNN）', en: 'Teach It On the Spot (MobileNet + KNN)' },
  description: {
    zh: '零训练循环：切到「采集样本」、填类别名、点运行把当前画作存进 KNN；切回「识别」点运行即可预测。用的是 MobileNet 特征，对简笔画的判别力弱于专用模型，但能直观演示迁移学习。',
    en: 'No training loop: switch to Teach, type a class name, press Run to store the drawing into a KNN; switch back to Predict and press Run. Uses MobileNet features — weaker on doodles than a dedicated model, but it demonstrates transfer learning clearly.'
  },
  kind: 'tfjs',
  section: { '*': 'image.sections.teach' },
  needsDrawing: true,
  params: [
    {
      key: 'mode',
      label: { zh: '模式', en: 'Mode' },
      type: 'select',
      default: 'predict',
      options: [
        { label: { zh: '识别', en: 'Predict' }, value: 'predict' },
        { label: { zh: '采集样本', en: 'Teach' }, value: 'teach' },
        { label: { zh: '清空样本', en: 'Clear' }, value: 'clear' }
      ]
    },
    {
      key: 'label',
      label: { zh: '类别名（采集样本时用）', en: 'Class name (used when teaching)' },
      type: 'text',
      default: 'cat'
    }
  ],
  run: async ({ imageData, params, lang }): Promise<ImageToolResult> => {
    const zh = lang === 'zh'
    const canvas = toCanvas(imageData)
    const mode = String(params.mode ?? 'predict')

    if (mode === 'clear') {
      const { labels, counts } = await resetDoodleSamples()
      return {
        imageData,
        info: [
          { label: zh ? '状态' : 'Status', value: zh ? '已清空全部样本' : 'All samples cleared' },
          ...labels.map((l, i) => ({ label: l, value: `${counts[i] ?? 0}` }))
        ]
      }
    }

    if (mode === 'teach') {
      const label = String(params.label ?? '').trim()
      if (!label) {
        return { imageData, info: [{ label: zh ? '提示' : 'Hint', value: zh ? '请先填写类别名' : 'Enter a class name first' }] }
      }
      const { labels, counts } = await teachDoodle(canvas, label)
      return {
        imageData,
        info: [
          { label: zh ? '已采集' : 'Stored', value: `${label} · ${counts[labels.indexOf(label)] ?? 0} ${zh ? '个样本' : 'samples'}` },
          ...labels.map((l, i) => ({ label: l, value: `${counts[i] ?? 0}` }))
        ]
      }
    }

    const confidences = await predictDoodle(canvas)
    if (!confidences) {
      return {
        imageData,
        info: [{ label: zh ? '提示' : 'Hint', value: zh ? '还没有样本，先切到「采集样本」教它几笔' : 'No samples yet — switch to Teach mode first' }]
      }
    }
    const rows = topRows(confidences)
    return {
      imageData,
      info: [
        { label: zh ? '预测' : 'Prediction', value: rows[0] ? `${rows[0].label} ${rows[0].value}` : '—' },
        ...rows
      ]
    }
  }
}

/** 简笔画能力页的全部实现工具 */
export const sketchTools: ImageTool[] = [doodleNetTool, teachTool]
