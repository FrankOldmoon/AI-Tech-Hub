// transformers.js 共用配置：环境初始化 + 模型 ID + NLP 文本任务注册表
// 仅在客户端被动态 import，SSR 不会加载
import type { ParamSpec } from './params'

/** 初始化 transformers.js 运行环境（仅客户端调用一次） */
export async function setupTransformersEnv() {
  const { env } = await import('@huggingface/transformers')
  // 优先从本地 .models/transformers/ 加载（经 /model/* API 路由 Range 服务）
  env.allowLocalModels = true
  env.localModelPath = '/model/transformers'
  // 远程回退：使用本地代理转发 hf-mirror.com，绕过 CORS
  env.allowRemoteModels = true
  env.remoteHost = `${window.location.origin}/api/hf`
  env.remotePathTemplate = '{model}/resolve/{revision}/'
  // WASM 后端放到 worker，避免阻塞主线程
  env.backends.onnx!.wasm!.proxy = true
  // onnxruntime WASM 自托管到 public/vendor/onnx，避免默认从 jsdelivr CDN 拉取
  // （CDN 被拦截/网络不通时 transformers 工具会卡在加载一直转圈）
  env.backends.onnx!.wasm!.wasmPaths = '/vendor/onnx/'
  return env
}

/** WebGPU 是否可用 */
export function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as { gpu?: GPU | unknown }).gpu
}

/** 优选 device：有 WebGPU 用 WebGPU，否则 WASM */
export function preferredDevice(): 'webgpu' | 'wasm' {
  return hasWebGPU() ? 'webgpu' : 'wasm'
}

/** 各任务默认模型 ID（均来自 Xenova / onnx-community，浏览器友好） */
export const transformersModels = {
  ner: 'Xenova/bert-base-NER-uncased',
  zeroShot: 'Xenova/distilbert-base-uncased-mnli',
  summarization: 'Xenova/distilbart-cnn-6-6',
  qa: 'Xenova/distilbert-base-cased-distilled-squad',
  fillMask: 'Xenova/bert-base-uncased',
  // onnx-community/depth-anything-v1-small 是 gated 仓库（匿名 401），
  // 改用非受限的 Xenova 转换版
  depthEstimation: 'Xenova/depth-anything-small-hf',
  imageCaptioning: 'Xenova/vit-gpt2-image-captioning'
}

export interface TransformersInputSpec {
  key: string
  /** i18n key，由调用方解析后传入 label */
  labelKey: string
  type: 'textarea' | 'text'
  default?: string
  placeholderKey?: string
}

export interface TransformersTextTaskConfig {
  task: string
  model: string
  inputs: TransformersInputSpec[]
  /** 由 inputs 当前值构造 pipeline 调用位置参数 */
  buildArgs: (vals: Record<string, string>) => unknown[]
  /** pipeline 调用选项 */
  callOptions?: (vals: Record<string, string>, params: Record<string, number | string | boolean>) => Record<string, unknown>
  /** 可调参数 */
  params?: (t: (key: string) => string) => ParamSpec[]
  /** 解析为列表项（优先） */
  parseItems?: (raw: unknown) => Array<{ label: string, value?: string, score?: number }>
  /** 解析为纯文本 */
  parseText?: (raw: unknown) => string
  /** 预置示例（试试示例按钮组）：labelKey 为 i18n key，values 按 input.key 填充 */
  examples?: Array<{ labelKey: string, values: Record<string, string> }>
}

/** pipeline 返回项的宽松结构（各 pipeline 字段不一，按需取用） */
interface PipelineItem {
  label?: string
  value?: string
  score?: number
  entity?: string
  entity_group?: string
  word?: string
  sequence?: string
  token_str?: string
  answer?: string
  labels?: string[]
  scores?: number[]
  summary_text?: string
  [key: string]: unknown
}

function toItems(raw: unknown): PipelineItem[] {
  return Array.isArray(raw) ? raw as PipelineItem[] : [raw as PipelineItem]
}

export const transformersTextTasks: Record<string, TransformersTextTaskConfig> = {
  'ner': {
    task: 'token-classification',
    model: transformersModels.ner,
    inputs: [
      { key: 'text', labelKey: 'tf.inputText', type: 'textarea', default: 'My name is Sarah and I live in London. I work at Google.', placeholderKey: 'tf.nerPlaceholder' }
    ],
    buildArgs: v => [v.text],
    callOptions: (_v, p) => ({ aggregation_strategy: 'simple', top_k: Number(p.topK) }),
    params: t => [
      { key: 'topK', label: t('params.topK'), type: 'slider', default: 10, min: 1, max: 50, step: 1 }
    ],
    parseItems: raw => toItems(raw).map(r => ({
      label: r.entity_group || r.entity || '—',
      value: r.word,
      score: r.score
    })),
    examples: [
      { labelKey: 'samples.exNerPerson', values: { text: 'My name is Sarah and I live in London. I work at Google.' } },
      { labelKey: 'samples.exNerNews', values: { text: 'Apple CEO Tim Cook visited China to meet with officials and discuss trade.' } }
    ]
  },

  'zero-shot': {
    task: 'zero-shot-classification',
    model: transformersModels.zeroShot,
    inputs: [
      { key: 'text', labelKey: 'tf.inputText', type: 'textarea', default: 'I have a really exciting news about a new AI model that can understand images and text.', placeholderKey: 'tf.zeroShotPlaceholder' },
      { key: 'labels', labelKey: 'tf.candidateLabels', type: 'text', default: 'technology, sports, politics, education', placeholderKey: 'tf.labelsPlaceholder' }
    ],
    buildArgs: v => [v.text, (v.labels ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)],
    callOptions: (_v, p) => ({ multi_label: Boolean(p.multiLabel) }),
    params: t => [
      { key: 'multiLabel', label: t('tf.multiLabel'), type: 'switch', default: false, help: t('tf.multiLabelHelp') }
    ],
    // 返回 [{sequence, labels:[...], scores:[...]}]
    parseItems: (raw) => {
      const r = Array.isArray(raw) ? raw[0] : raw
      const item = (r ?? {}) as PipelineItem
      if (!item.labels) return []
      return item.labels.map((label: string, i: number) => ({ label, score: item.scores?.[i] }))
    },
    examples: [
      { labelKey: 'samples.exZsMovie', values: { text: 'This movie was absolutely fantastic! The acting was superb and the story kept me on the edge of my seat.', labels: 'positive, negative, neutral' } },
      { labelKey: 'samples.exZsNews', values: { text: 'The government announced that new AI regulations will take effect next year, affecting all major tech companies.', labels: 'technology, politics, sports, education' } }
    ]
  },

  'summarization': {
    task: 'summarization',
    model: transformersModels.summarization,
    inputs: [
      {
        key: 'text',
        labelKey: 'tf.inputText',
        type: 'textarea',
        default: 'The tower is 324 metres (1,063 ft) tall, about the same height as an 81-storey building, and the tallest structure in Paris. Its base is square, measuring 125 metres (410 ft) on each side. During its construction, the Eiffel Tower surpassed the Washington Monument to become the tallest man-made structure in the world, a title it held for 41 years until the Chrysler Building in New York City was finished in 1930.',
        placeholderKey: 'tf.summarizePlaceholder'
      }
    ],
    buildArgs: v => [v.text],
    callOptions: (_v, p) => ({ max_new_tokens: Number(p.maxNewTokens), min_length: Number(p.minLength) }),
    params: t => [
      { key: 'maxNewTokens', label: t('tf.maxNewTokens'), type: 'slider', default: 100, min: 20, max: 300, step: 10 },
      { key: 'minLength', label: t('tf.minLength'), type: 'slider', default: 20, min: 5, max: 100, step: 5 }
    ],
    // 返回 [{summary_text}]
    parseText: raw => (Array.isArray(raw) ? raw[0] : raw)?.summary_text || '',
    examples: [
      { labelKey: 'samples.exSummaryAI', values: { text: 'Artificial intelligence has transformed industries ranging from healthcare to transportation. In medicine, AI systems now assist doctors in detecting diseases from medical images with accuracy comparable to human experts. Self-driving cars use neural networks to process sensor data and make split-second decisions. However, these advances also raise important questions about privacy, bias, and the future of work. Researchers continue to debate how to balance innovation with ethical safeguards.' } },
      { labelKey: 'samples.exSummaryEiffel', values: { text: 'The tower is 324 metres (1,063 ft) tall, about the same height as an 81-storey building, and the tallest structure in Paris. Its base is square, measuring 125 metres (410 ft) on each side. During its construction, the Eiffel Tower surpassed the Washington Monument to become the tallest man-made structure in the world, a title it held for 41 years until the Chrysler Building in New York City was finished in 1930.' } }
    ]
  },

  'qa': {
    task: 'question-answering',
    model: transformersModels.qa,
    inputs: [
      { key: 'question', labelKey: 'tf.question', type: 'text', default: 'When was the Eiffel Tower built?', placeholderKey: 'tf.qaQPlaceholder' },
      { key: 'context', labelKey: 'tf.context', type: 'textarea', default: 'The Eiffel Tower was constructed from 1887 to 1889 as the entrance to the 1889 World\'s Fair. It is named after the engineer Gustave Eiffel.', placeholderKey: 'tf.qaCPlaceholder' }
    ],
    buildArgs: v => [v.question, v.context],
    callOptions: (_v, p) => ({ top_k: Number(p.topK) }),
    params: t => [
      { key: 'topK', label: t('params.topK'), type: 'slider', default: 3, min: 1, max: 10, step: 1 }
    ],
    // 返回 [{answer, score}] 或单个对象
    parseItems: raw => toItems(raw).map(r => ({ label: r.answer || '—', score: r.score }))
    ,
    examples: [
      { labelKey: 'samples.exQaEiffel', values: { question: 'When was the Eiffel Tower built?', context: 'The Eiffel Tower was constructed from 1887 to 1889 as the entrance to the 1889 World\'s Fair. It is named after the engineer Gustave Eiffel.' } },
      { labelKey: 'samples.exQaMars', values: { question: 'Which planet is known as the Red Planet?', context: 'Mars is the fourth planet from the Sun and the second-smallest planet in the Solar System. It is often called the "Red Planet" because of the iron oxide on its surface, which gives it a reddish appearance.' } }
    ]
  },

  'fill-mask': {
    task: 'fill-mask',
    model: transformersModels.fillMask,
    inputs: [
      { key: 'text', labelKey: 'tf.inputText', type: 'textarea', default: 'The capital of France is [MASK].', placeholderKey: 'tf.maskPlaceholder' }
    ],
    buildArgs: v => [v.text],
    callOptions: (_v, p) => ({ top_k: Number(p.topK) }),
    params: t => [
      { key: 'topK', label: t('params.topK'), type: 'slider', default: 5, min: 1, max: 20, step: 1 }
    ],
    // 返回 [{token_str, score, sequence}]
    parseItems: raw => toItems(raw).map(r => ({
      label: r.token_str || '—',
      value: r.sequence,
      score: r.score
    })),
    examples: [
      { labelKey: 'samples.exMaskCapital', values: { text: 'The capital of France is [MASK].' } },
      { labelKey: 'samples.exMaskPlanets', values: { text: 'There are [MASK] planets in the Solar System.' } }
    ]
  }
}
