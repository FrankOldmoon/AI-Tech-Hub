// AI 演示注册表：所有 demo 的元数据集中在此，前端/分类页面统一消费
// 标题/描述以 { zh, en } 形式存储，便于按当前 locale 取值

export type DemoCategory = 'speech' | 'vision' | 'nlp' | 'aigc' | 'ml'
export type DemoStatus = 'ready' | 'planned'

export interface Localized {
  zh: string
  en: string
}

export interface Category {
  slug: DemoCategory
  title: Localized
  description: Localized
  icon: string
}

export interface Demo {
  slug: string
  category: DemoCategory
  title: Localized
  description: Localized
  icon: string
  status: DemoStatus
  /** 对应 python 下的模块路径，如 'speech/tts' -> python/speech/tts/main.py */
  pythonModule?: string
  tags?: string[]
}

/** 已按当前 locale 解析为字符串的 Category */
export interface LocalizedCategory extends Omit<Category, 'title' | 'description'> {
  title: string
  description: string
}

/** 已按当前 locale 解析为字符串的 Demo */
export interface LocalizedDemo extends Omit<Demo, 'title' | 'description'> {
  title: string
  description: string
}

export const categories: Category[] = [
  {
    slug: 'speech',
    title: { zh: '语音', en: 'Speech' },
    description: {
      zh: '语音合成、语音识别、音频分类等语音相关 AI 演示。',
      en: 'Speech synthesis, recognition and audio classification AI demos.'
    },
    icon: 'i-lucide-audio-lines'
  },
  {
    slug: 'vision',
    title: { zh: '视觉', en: 'Vision' },
    description: {
      zh: '人脸、手势、姿态、目标检测、图像分类、分割、深度估计与图像描述等计算机视觉 AI 演示。',
      en: 'Face, hand, pose, object detection, classification, segmentation, depth estimation and image captioning AI demos.'
    },
    icon: 'i-lucide-eye'
  },
  {
    slug: 'nlp',
    title: { zh: '自然语言', en: 'NLP' },
    description: {
      zh: '文本分类、语言检测、文本嵌入、命名实体识别、零样本分类、摘要、问答与完形填空等自然语言处理 AI 演示。',
      en: 'Text classification, language detection, embedding, NER, zero-shot, summarization, QA and fill-mask AI demos.'
    },
    icon: 'i-lucide-languages'
  },
  {
    slug: 'aigc',
    title: { zh: 'AI 生成', en: 'AIGC' },
    description: {
      zh: '在浏览器中运行的 LLM 对话与流式文本生成等 AI 内容生成演示。',
      en: 'LLM chat and streaming text generation demos running in-browser.'
    },
    icon: 'i-lucide-sparkles'
  },
  {
    slug: 'ml',
    title: { zh: '机器学习', en: 'Machine Learning' },
    description: {
      zh: '在浏览器中采集样本并训练自定义图像/声音分类模型（迁移学习）。',
      en: 'Collect samples and train custom image/audio classifiers in-browser (transfer learning).'
    },
    icon: 'i-lucide-graduation-cap'
  }
]

export const demos: Demo[] = [
  // ===== speech =====
  {
    slug: 'tts',
    category: 'speech',
    title: { zh: '文本转语音 (TTS)', en: 'Text to Speech (TTS)' },
    description: { zh: '文本转语音合成。', en: 'Text to speech synthesis.' },
    icon: 'i-lucide-volume-2',
    status: 'ready',
    pythonModule: 'speech/tts',
    tags: ['TTS', 'edge-tts']
  },
  {
    slug: 'asr',
    category: 'speech',
    title: { zh: '语音识别 (ASR)', en: 'Speech Recognition (ASR)' },
    description: { zh: '语音识别转文字。', en: 'Speech to text recognition.' },
    icon: 'i-lucide-mic',
    status: 'ready',
    tags: ['ASR', 'Web Speech API']
  },
  {
    slug: 'audio-classifier',
    category: 'speech',
    title: { zh: '音频分类', en: 'Audio Classifier' },
    description: { zh: '音频事件分类识别。', en: 'Audio event classification.' },
    icon: 'i-lucide-audio-waveform',
    status: 'ready',
    pythonModule: 'mediapipe/audio-classifier',
    tags: ['Audio', 'MediaPipe', 'YAMNet']
  },
  {
    slug: 'separation',
    category: 'speech',
    title: { zh: '音频分离', en: 'Audio Separation' },
    description: { zh: '分离人声与伴奏等音轨。', en: 'Separate vocals, drums, bass and other stems.' },
    icon: 'i-lucide-split',
    status: 'ready',
    pythonModule: 'speech/separation',
    tags: ['Audio', 'Demucs']
  },
  // ===== vision (MediaPipe) =====
  {
    slug: 'face-detection',
    category: 'vision',
    title: { zh: '人脸检测', en: 'Face Detector' },
    description: { zh: '检测图像中的人脸。', en: 'Detect human faces in images.' },
    icon: 'i-lucide-scan-face',
    status: 'ready',
    pythonModule: 'mediapipe/face-detection',
    tags: ['MediaPipe', 'Face']
  },
  {
    slug: 'face-landmarker',
    category: 'vision',
    title: { zh: '人脸关键点', en: 'Face Landmarker' },
    description: { zh: '检测人脸 478 个关键点。', en: 'Detect 478 face landmarks.' },
    icon: 'i-lucide-smile',
    status: 'ready',
    pythonModule: 'mediapipe/face-landmarker',
    tags: ['MediaPipe', 'Face Mesh']
  },
  {
    slug: 'hand-landmarker',
    category: 'vision',
    title: { zh: '手势关键点', en: 'Hand Landmarker' },
    description: { zh: '检测手部 21 个关键点。', en: 'Detect 21 hand landmarks.' },
    icon: 'i-lucide-hand',
    status: 'ready',
    pythonModule: 'mediapipe/hand-landmarker',
    tags: ['MediaPipe', 'Hand']
  },
  {
    slug: 'gesture-recognizer',
    category: 'vision',
    title: { zh: '手势识别', en: 'Gesture Recognizer' },
    description: { zh: '识别手部手势类别。', en: 'Recognize hand gesture categories.' },
    icon: 'i-lucide-hand-metal',
    status: 'ready',
    pythonModule: 'mediapipe/gesture-recognizer',
    tags: ['MediaPipe', 'Gesture']
  },
  {
    slug: 'pose-landmarker',
    category: 'vision',
    title: { zh: '姿态估计', en: 'Pose Landmarker' },
    description: { zh: '检测人体姿态关键点。', en: 'Detect body pose landmarks.' },
    icon: 'i-lucide-person-standing',
    status: 'ready',
    pythonModule: 'mediapipe/pose-landmarker',
    tags: ['MediaPipe', 'Pose']
  },
  {
    slug: 'holistic-landmarker',
    category: 'vision',
    title: { zh: '整体检测', en: 'Holistic Landmarker' },
    description: { zh: '同时检测人脸、手部与姿态。', en: 'Detect face, hands and pose together.' },
    icon: 'i-lucide-move-3d',
    status: 'ready',
    pythonModule: 'mediapipe/holistic-landmarker',
    tags: ['MediaPipe', 'Holistic']
  },
  {
    slug: 'object-detector',
    category: 'vision',
    title: { zh: '目标检测', en: 'Object Detector' },
    description: { zh: '检测图像中的目标并分类。', en: 'Detect and classify objects in images.' },
    icon: 'i-lucide-scan-eye',
    status: 'ready',
    pythonModule: 'mediapipe/object-detector',
    tags: ['MediaPipe', 'Object']
  },
  {
    slug: 'image-classifier',
    category: 'vision',
    title: { zh: '图像分类', en: 'Image Classifier' },
    description: { zh: '对图像内容进行分类。', en: 'Classify image content.' },
    icon: 'i-lucide-image',
    status: 'ready',
    pythonModule: 'mediapipe/image-classifier',
    tags: ['MediaPipe', 'Classification']
  },
  {
    slug: 'image-embedder',
    category: 'vision',
    title: { zh: '图像嵌入', en: 'Image Embedder' },
    description: { zh: '计算图像相似度。', en: 'Compute image similarity.' },
    icon: 'i-lucide-layers',
    status: 'ready',
    pythonModule: 'mediapipe/image-embedder',
    tags: ['MediaPipe', 'Embedding']
  },
  {
    slug: 'image-segmenter',
    category: 'vision',
    title: { zh: '图像分割', en: 'Image Segmenter' },
    description: { zh: '分割图像前景。', en: 'Segment image foreground.' },
    icon: 'i-lucide-scissors',
    status: 'ready',
    pythonModule: 'mediapipe/image-segmenter',
    tags: ['MediaPipe', 'Segmentation']
  },
  {
    slug: 'interactive-segmenter',
    category: 'vision',
    title: { zh: '交互式分割', en: 'Interactive Segmenter' },
    description: { zh: '点击选取目标并分割。', en: 'Click to segment a target.' },
    icon: 'i-lucide-mouse-pointer-click',
    status: 'ready',
    pythonModule: 'mediapipe/interactive-segmenter',
    tags: ['MediaPipe', 'Segmentation']
  },
  {
    slug: 'depth-estimation',
    category: 'vision',
    title: { zh: '深度估计', en: 'Depth Estimation' },
    description: { zh: '估计图像中每个像素的深度。', en: 'Estimate per-pixel depth of an image.' },
    icon: 'i-lucide-box',
    status: 'ready',
    pythonModule: 'transformers/depth-estimation',
    tags: ['Transformers.js', 'Depth']
  },
  {
    slug: 'image-captioning',
    category: 'vision',
    title: { zh: '图像描述', en: 'Image Captioning' },
    description: { zh: '生成图像内容的文字描述。', en: 'Generate a text description of an image.' },
    icon: 'i-lucide-text',
    status: 'ready',
    pythonModule: 'transformers/image-captioning',
    tags: ['Transformers.js', 'Captioning']
  },
  // ===== nlp (MediaPipe Text) =====
  {
    slug: 'text-classifier',
    category: 'nlp',
    title: { zh: '文本分类', en: 'Text Classifier' },
    description: { zh: '文本情感分类。', en: 'Text sentiment classification.' },
    icon: 'i-lucide-message-square',
    status: 'ready',
    pythonModule: 'mediapipe/text-classifier',
    tags: ['MediaPipe', 'Sentiment']
  },
  {
    slug: 'language-detector',
    category: 'nlp',
    title: { zh: '语言检测', en: 'Language Detector' },
    description: { zh: '检测文本所属语言。', en: 'Detect text language.' },
    icon: 'i-lucide-globe',
    status: 'ready',
    pythonModule: 'mediapipe/language-detector',
    tags: ['MediaPipe', 'Language']
  },
  {
    slug: 'text-embedder',
    category: 'nlp',
    title: { zh: '文本嵌入', en: 'Text Embedder' },
    description: { zh: '计算文本相似度。', en: 'Compute text similarity.' },
    icon: 'i-lucide-type',
    status: 'ready',
    pythonModule: 'mediapipe/text-embedder',
    tags: ['MediaPipe', 'Embedding']
  },
  {
    slug: 'ner',
    category: 'nlp',
    title: { zh: '命名实体识别', en: 'Named Entity Recognition' },
    description: { zh: '识别文本中的人名、地名、机构等实体。', en: 'Recognize persons, locations, organizations in text.' },
    icon: 'i-lucide-tag',
    status: 'ready',
    pythonModule: 'transformers/ner',
    tags: ['Transformers.js', 'NER']
  },
  {
    slug: 'zero-shot',
    category: 'nlp',
    title: { zh: '零样本文本分类', en: 'Zero-shot Classification' },
    description: { zh: '用自定义候选标签对文本分类。', en: 'Classify text with custom candidate labels.' },
    icon: 'i-lucide-list-checks',
    status: 'ready',
    pythonModule: 'transformers/zero-shot',
    tags: ['Transformers.js', 'Zero-shot']
  },
  {
    slug: 'summarization',
    category: 'nlp',
    title: { zh: '文本摘要', en: 'Summarization' },
    description: { zh: '生成文本的摘要。', en: 'Generate a summary of the text.' },
    icon: 'i-lucide-file-text',
    status: 'ready',
    pythonModule: 'transformers/summarization',
    tags: ['Transformers.js', 'Summarization']
  },
  {
    slug: 'qa',
    category: 'nlp',
    title: { zh: '问答抽取', en: 'Question Answering' },
    description: { zh: '从上下文中抽取问题答案。', en: 'Extract an answer from context.' },
    icon: 'i-lucide-help-circle',
    status: 'ready',
    pythonModule: 'transformers/qa',
    tags: ['Transformers.js', 'QA']
  },
  {
    slug: 'fill-mask',
    category: 'nlp',
    title: { zh: '完形填空', en: 'Fill-Mask' },
    description: { zh: '预测掩码位置的词。', en: 'Predict the masked token.' },
    icon: 'i-lucide-puzzle',
    status: 'ready',
    pythonModule: 'transformers/fill-mask',
    tags: ['Transformers.js', 'Mask']
  },
  // ===== aigc (WebLLM) =====
  {
    slug: 'webllm',
    category: 'aigc',
    title: { zh: '浏览器 LLM 对话', en: 'In-browser LLM Chat' },
    description: { zh: '基于 WebLLM 在浏览器中本地运行的 LLM 对话。', en: 'LLM chat running locally in-browser via WebLLM.' },
    icon: 'i-lucide-message-circle',
    status: 'ready',
    pythonModule: 'transformers/webllm',
    tags: ['WebLLM', 'WebGPU', 'Llama', 'Qwen']
  },
  // ===== ml (Teachable Machine) =====
  {
    slug: 'image-training',
    category: 'ml',
    title: { zh: '图像训练', en: 'Image Training' },
    description: { zh: '采集摄像头样本训练自定义图像分类器。', en: 'Collect webcam samples to train a custom image classifier.' },
    icon: 'i-lucide-camera',
    status: 'ready',
    pythonModule: 'ml/image-training',
    tags: ['TensorFlow.js', 'MobileNet', 'KNN']
  },
  {
    slug: 'audio-training',
    category: 'ml',
    title: { zh: '声音训练', en: 'Audio Training' },
    description: { zh: '采集麦克风样本训练自定义声音分类器。', en: 'Collect microphone samples to train a custom audio classifier.' },
    icon: 'i-lucide-mic',
    status: 'ready',
    pythonModule: 'ml/audio-training',
    tags: ['TensorFlow.js', 'Speech Commands', 'KNN']
  }
]

// ===== 纯函数辅助（不依赖 Nuxt 上下文，可在任意处使用）=====

export function categoryBySlug(slug: DemoCategory | string): Category | undefined {
  return categories.find(c => c.slug === slug)
}

export function demosByCategory(slug: DemoCategory | string): Demo[] {
  return demos.filter(d => d.category === slug)
}

export function getDemo(category: DemoCategory | string, slug: string): Demo | undefined {
  return demos.find(d => d.category === category && d.slug === slug)
}

export function demoPath(demo: { category: DemoCategory | string, slug: string }): string {
  return `/${demo.category}/${demo.slug}`
}

/** 状态对应的 Nuxt UI Badge 颜色 */
export function statusColor(status: DemoStatus): 'success' | 'neutral' {
  return status === 'ready' ? 'success' : 'neutral'
}

/** 状态对应的 i18n 文案 key（demo.status.*） */
export function statusI18nKey(status: DemoStatus): string {
  return status === 'ready' ? 'demo.status.ready' : 'demo.status.planned'
}
