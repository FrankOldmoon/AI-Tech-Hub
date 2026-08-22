// transformers.js 共用配置：环境初始化 + 模型 ID + NLP 文本任务注册表
// 仅在客户端被动态 import，SSR 不会加载
import type { ParamSpec } from './params'

/** 初始化 transformers.js 运行环境（仅客户端调用一次） */
export async function setupTransformersEnv() {
  const { env } = await import('@huggingface/transformers')
  // 优先从本地 public/model/transformers/ 加载
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
  return typeof navigator !== 'undefined' && !!(navigator as any).gpu
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
  buildArgs: (vals: Record<string, any>) => any[]
  /** pipeline 调用选项 */
  callOptions?: (vals: Record<string, any>, params: Record<string, any>) => Record<string, any>
  /** 可调参数 */
  params?: (t: (key: string) => string) => ParamSpec[]
  /** 解析为列表项（优先） */
  parseItems?: (raw: any) => Array<{ label: string, value?: string, score?: number }>
  /** 解析为纯文本 */
  parseText?: (raw: any) => string
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
    parseItems: raw => (Array.isArray(raw) ? raw : []).map((r: any) => ({
      label: r.entity_group || r.entity || '—',
      value: r.word,
      score: r.score
    }))
  },

  'zero-shot': {
    task: 'zero-shot-classification',
    model: transformersModels.zeroShot,
    inputs: [
      { key: 'text', labelKey: 'tf.inputText', type: 'textarea', default: 'I have a really exciting news about a new AI model that can understand images and text.', placeholderKey: 'tf.zeroShotPlaceholder' },
      { key: 'labels', labelKey: 'tf.candidateLabels', type: 'text', default: 'technology, sports, politics, education', placeholderKey: 'tf.labelsPlaceholder' }
    ],
    buildArgs: v => [v.text, v.labels.split(',').map((s: string) => s.trim()).filter(Boolean)],
    callOptions: (_v, p) => ({ multi_label: Boolean(p.multiLabel) }),
    params: t => [
      { key: 'multiLabel', label: t('tf.multiLabel'), type: 'switch', default: false, help: t('tf.multiLabelHelp') }
    ],
    // 返回 [{sequence, labels:[...], scores:[...]}]
    parseItems: (raw) => {
      const r = Array.isArray(raw) ? raw[0] : raw
      if (!r?.labels) return []
      return r.labels.map((label: string, i: number) => ({ label, score: r.scores?.[i] }))
    }
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
    parseText: raw => (Array.isArray(raw) ? raw[0] : raw)?.summary_text || ''
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
    parseItems: (raw) => {
      const arr = Array.isArray(raw) ? raw : [raw]
      return arr.map((r: any) => ({ label: r.answer || '—', score: r.score }))
    }
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
    parseItems: raw => (Array.isArray(raw) ? raw : []).map((r: any) => ({
      label: r.token_str || '—',
      value: r.sequence,
      score: r.score
    }))
  }
}
