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
      zh: '图像查看/变换/像素/颜色/调整/滤镜/增强/形态学/边缘/特征、人脸、目标检测、分割、OCR 与多模态 AI 视觉演示。',
      en: 'Image view/transform/pixel/color/adjust/filter/enhance/morphology/edge/feature tools, face, object detection, segmentation, OCR and multimodal AI vision demos.'
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
      zh: 'LLM 对话与推理、文生图、图像编辑/修复、代码生成、多模态对话、音视频生成等 AI 内容生成演示（浏览器本地 / 本地服务端）。',
      en: 'LLM chat & reasoning, text-to-image, image editing/inpainting, code generation, multimodal chat and AI content generation demos (in-browser / local server).'
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
    tags: ['ASR', 'Web Speech API', 'Whisper'],
    pythonModule: 'speech/asr',
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
  {
    slug: 'voice-clone',
    category: 'speech',
    title: { zh: '语音克隆', en: 'Voice Cloning' },
    description: { zh: '用一段参考录音克隆音色并合成任意文本。', en: 'Clone a voice from a reference recording and synthesize any text.' },
    icon: 'i-lucide-mic-vocal',
    status: 'ready',
    pythonModule: 'speech/voice-clone',
    tags: ['Voice', 'XTTS-v2', 'Zero-shot']
  },
  {
    slug: 'emotion',
    category: 'speech',
    title: { zh: '语音情感识别 (SER)', en: 'Speech Emotion Recognition (SER)' },
    description: { zh: '识别语音中的情绪（开心/生气/悲伤等）。', en: 'Recognize emotions in speech (happy, angry, sad...).' },
    icon: 'i-lucide-smile-plus',
    status: 'ready',
    tags: ['Emotion', 'wav2vec2', 'transformers.js'],
    pythonModule: 'speech/emotion',
  },
  {
    slug: 'pitch-detector',
    category: 'speech',
    title: { zh: '实时音高检测', en: 'Real-time Pitch Detector' },
    description: { zh: '用麦克风实时检测音高与音名（YIN 算法）。', en: 'Real-time pitch and note detection from mic (YIN).' },
    icon: 'i-lucide-audio-waveform',
    status: 'ready',
    tags: ['Pitch', 'YIN', 'Web Audio'],
    pythonModule: 'speech/pitch-detector',
  },
  {
    slug: 'denoise',
    category: 'speech',
    title: { zh: '音频降噪增强', en: 'Audio Denoise (Enhancement)' },
    description: { zh: '用 DeepFilterNet 去除噪声、增强语音。', en: 'Remove noise and enhance speech with DeepFilterNet.' },
    icon: 'i-lucide-waves',
    status: 'ready',
    pythonModule: 'speech/denoise',
    tags: ['Denoise', 'DeepFilterNet']
  },

  {
    slug: 'vad',
    category: 'speech',
    title: { zh: '语音活动检测 (VAD)', en: 'Voice Activity Detection (VAD)' },
    description: { zh: '用 Silero VAD 检测音频中的语音段。', en: 'Detect speech segments in audio with Silero VAD.' },
    icon: 'i-lucide-mic-vocal',
    status: 'ready',
    pythonModule: 'speech/vad',
    tags: ['VAD', 'Silero']
  },

  {
    slug: 'musicgen',
    category: 'speech',
    title: { zh: '文生音乐 (MusicGen)', en: 'Music Generation (MusicGen)' },
    description: { zh: '用文字描述生成一段音乐。', en: 'Generate music from a text description.' },
    icon: 'i-lucide-music-4',
    status: 'ready',
    pythonModule: 'speech/musicgen',
    tags: ['MusicGen', 'AIGC']
  },

  {
    slug: 'visualizer',
    category: 'speech',
    title: { zh: '音频可视化', en: 'Audio Visualizer' },
    description: { zh: '波形 + 频谱图实时可视化音频。', en: 'Visualize audio with waveform and spectrogram.' },
    icon: 'i-lucide-audio-lines',
    status: 'ready',
    pythonModule: 'speech/visualizer',
    tags: ['Visualizer', 'wavesurfer']
  },

  {
    slug: 'meeting',
    category: 'speech',
    title: { zh: '会议纪要', en: 'Meeting Notes' },
    description: { zh: '转写音频并区分说话人，生成会议纪要。', en: 'Transcribe audio, separate speakers and generate meeting notes.' },
    icon: 'i-lucide-users',
    status: 'ready',
    pythonModule: 'speech/meeting',
    tags: ['Meeting', 'Whisper', 'WeSpeaker']
  },

  {
    slug: 'midi',
    category: 'speech',
    title: { zh: '音频转 MIDI', en: 'Audio to MIDI' },
    description: { zh: '把乐器音频转成可编辑的 MIDI 文件。', en: 'Convert instrument audio into an editable MIDI file.' },
    icon: 'i-lucide-piano',
    status: 'ready',
    pythonModule: 'speech/midi',
    tags: ['MIDI', 'Transcription']
  },

  {
    slug: 'speech-translate',
    category: 'speech',
    title: { zh: '语音翻译', en: 'Speech Translation' },
    description: { zh: '语音识别并翻译为英文（Whisper translate）。', en: 'Transcribe speech and translate it to English (Whisper translate).' },
    icon: 'i-lucide-languages',
    status: 'ready',
    pythonModule: 'speech/speech-translate',
    tags: ['Translate', 'Whisper']
  },

  {
    slug: 'lip-sync',
    category: 'speech',
    title: { zh: '口型同步 (Wav2Lip)', en: 'Lip Sync (Wav2Lip)' },
    description: { zh: '让视频中的人脸随音频口型同步。', en: 'Make the face in a video lip-sync to any audio.' },
    icon: 'i-lucide-clapperboard',
    status: 'ready',
    pythonModule: 'speech/lip-sync',
    tags: ['Wav2Lip', 'Video']
  },

  {
    slug: 'singing',
    category: 'speech',
    title: { zh: '歌声合成 (DiffSinger)', en: 'Singing Synthesis (DiffSinger)' },
    description: { zh: '从乐谱与歌词合成歌声（需 GPU 与声库，规划中）。', en: 'Synthesize singing from notes and lyrics (requires GPU + voice bank, planned).' },
    icon: 'i-lucide-music-2',
    status: 'planned',
    pythonModule: 'speech/singing',
    tags: ['Singing', 'DiffSinger']
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
  {
    slug: 'text-to-image',
    category: 'aigc',
    title: { zh: '文生图 (Janus-Pro)', en: 'Text-to-Image (Janus-Pro)' },
    description: { zh: '用 Janus-Pro-1B 在浏览器本地生成图片，并支持图像理解问答。', en: 'Generate images locally in-browser with Janus-Pro-1B, plus image understanding QA.' },
    icon: 'i-lucide-image',
    status: 'ready',
    tags: ['Janus-Pro', 'Transformers.js', 'WebGPU', 'Multi-modal']
  },
  {
    slug: 'inpainting',
    category: 'aigc',
    title: { zh: '图像修复 (Moebius)', en: 'Image Inpainting (Moebius)' },
    description: { zh: '用 Moebius-0.2B 在浏览器涂抹去除并补全图片区域。', en: 'Paint over image regions to remove and inpaint them with Moebius-0.2B in-browser.' },
    icon: 'i-lucide-eraser',
    status: 'ready',
    tags: ['Moebius', 'Inpainting', 'ONNX Runtime Web', 'WebGPU']
  },
  {
    slug: 'capabilities',
    category: 'aigc',
    title: { zh: 'WebGPU 能力诊断', en: 'WebGPU Capabilities' },
    description: { zh: '检测当前浏览器的 WebGPU 适配器、特性与运行建议。', en: 'Inspect the browser WebGPU adapter, features and recommendations.' },
    icon: 'i-lucide-gpu',
    status: 'ready',
    tags: ['WebGPU', 'Diagnostics']
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
  },
  {
    slug: 'pose-training',
    category: 'ml',
    title: { zh: '姿态训练', en: 'Pose Training' },
    description: { zh: '采集身体姿态样本训练自定义动作分类器（迁移学习）。', en: 'Collect pose samples from the webcam to train a custom gesture classifier (transfer learning).' },
    icon: 'i-lucide-person-standing',
    status: 'ready',
    pythonModule: 'ml/pose-training',
    tags: ['MediaPipe', 'Pose', 'KNN']
  },
  {
    slug: 'text-training',
    category: 'ml',
    title: { zh: '文本训练', en: 'Text Training' },
    description: { zh: '输入文本样本训练自定义文本分类器（迁移学习）。', en: 'Train a custom text classifier with your own examples (transfer learning).' },
    icon: 'i-lucide-type',
    status: 'ready',
    pythonModule: 'ml/text-training',
    tags: ['Transformers.js', 'Embedding', 'KNN']
  },
  {
    slug: 'playground',
    category: 'ml',
    title: { zh: '神经网络游乐场', en: 'Neural Network Playground' },
    description: { zh: '在 2D 数据上实时训练神经网络，观察决策边界与损失变化。', en: 'Train a neural network on 2D data in real time and watch the decision boundary and loss evolve.' },
    icon: 'i-lucide-brain-circuit',
    status: 'ready',
    pythonModule: 'ml/playground',
    tags: ['Neural Network', 'Backprop', 'Playground']
  },
  {
    slug: 'auto-train',
    category: 'ml',
    title: { zh: 'CSV 自动训练', en: 'CSV AutoTrain' },
    description: { zh: '上传 CSV，自动训练多个模型并对比指标，快速上手机器学习工作流。', en: 'Upload a CSV, auto-train multiple models and compare metrics — a quick machine learning workflow.' },
    icon: 'i-lucide-file-spreadsheet',
    status: 'ready',
    pythonModule: 'ml/auto-train',
    tags: ['scikit-learn', 'AutoML', 'CSV']
  },
  {
    slug: 'kmeans',
    category: 'ml',
    title: { zh: 'K-Means 聚类', en: 'K-Means Clustering' },
    description: { zh: '步进式观察 K-Means 如何把数据点聚成 K 簇（无监督学习）。', en: 'Step through K-Means as it groups points into K clusters (unsupervised learning).' },
    icon: 'i-lucide-donut',
    status: 'ready',
    pythonModule: 'ml/kmeans',
    tags: ['K-Means', 'Unsupervised', 'Clustering']
  },
  {
    slug: 'regression',
    category: 'ml',
    title: { zh: '回归拟合', en: 'Regression Fitting' },
    description: { zh: '在散点上用梯度下降拟合多项式曲线，观察损失下降。', en: 'Fit a polynomial curve to scatter points with gradient descent and watch the loss drop.' },
    icon: 'i-lucide-trending-up',
    status: 'ready',
    pythonModule: 'ml/regression',
    tags: ['Regression', 'Gradient Descent', 'Polynomial']
  },
  {
    slug: 'mnist',
    category: 'ml',
    title: { zh: 'MNIST 手写数字', en: 'MNIST Handwritten Digits' },
    description: { zh: '在浏览器中训练神经网络识别手写数字，然后亲手写一个测试它。', en: 'Train a neural network in the browser to recognize handwritten digits, then draw one to test it.' },
    icon: 'i-lucide-pen-tool',
    status: 'ready',
    pythonModule: 'ml/mnist',
    tags: ['TensorFlow.js', 'MNIST', 'CNN']
  },
  {
    slug: 'cartpole',
    category: 'ml',
    title: { zh: '强化学习 CartPole', en: 'Reinforcement Learning: CartPole' },
    description: { zh: '用策略梯度在浏览器中训练智能体学会平衡倒立摆。', en: 'Train an agent with policy gradient in the browser to balance an inverted pendulum.' },
    icon: 'i-lucide-rocket',
    status: 'ready',
    pythonModule: 'ml/cartpole',
    tags: ['Reinforcement Learning', 'Policy Gradient', 'TF.js']
  },
  {
    slug: 'forecast',
    category: 'ml',
    title: { zh: '时间序列预测', en: 'Time Series Forecasting' },
    description: { zh: '上传时间序列 CSV，用指数平滑预测未来趋势并显示置信区间。', en: 'Upload a time series CSV and forecast future trends with exponential smoothing and confidence bands.' },
    icon: 'i-lucide-chart-line',
    status: 'ready',
    pythonModule: 'ml/forecast',
    tags: ['Time Series', 'Holt-Winters', 'statsmodels']
  },
  {
    slug: 'anomaly',
    category: 'ml',
    title: { zh: '异常检测', en: 'Anomaly Detection' },
    description: { zh: '用 IsolationForest 在二维数据中自动找出异常点。', en: 'Automatically find outliers in 2D data with Isolation Forest.' },
    icon: 'i-lucide-radar',
    status: 'ready',
    pythonModule: 'ml/anomaly',
    tags: ['IsolationForest', 'Outlier', 'scikit-learn']
  },
  {
    slug: 'palette',
    category: 'ml',
    title: { zh: '图像主色调', en: 'Image Palette' },
    description: { zh: '用 K-Means 聚类提取图片的主色调配色板（无监督学习的趣味应用）。', en: 'Extract a color palette from any image with K-Means clustering (a fun unsupervised learning app).' },
    icon: 'i-lucide-palette',
    status: 'ready',
    pythonModule: 'ml/palette',
    tags: ['K-Means', 'Color', 'Unsupervised']
  },
  {
    slug: 'dim-reduction',
    category: 'ml',
    title: { zh: '降维可视化', en: 'Dim Reduction' },
    description: { zh: '用 PCA / t-SNE 把高维数据降到二维并聚类着色。', en: 'Project high-dimensional data to 2D with PCA / t-SNE and color by cluster.' },
    icon: 'i-lucide-scatter-chart',
    status: 'ready',
    pythonModule: 'ml/dim-reduction',
    tags: ['PCA', 't-SNE', 'scikit-learn']
  },
  {
    slug: 'svd',
    category: 'ml',
    title: { zh: '推荐系统 (SVD)', en: 'Recommender (SVD)' },
    description: { zh: '在 MovieLens 数据集上用矩阵分解做协同过滤推荐。', en: 'Collaborative filtering with matrix factorization on MovieLens.' },
    icon: 'i-lucide-star',
    status: 'ready',
    pythonModule: 'ml/svd',
    tags: ['SVD', 'Recommendation', 'MovieLens']
  },
  {
    slug: 'decision-tree',
    category: 'ml',
    title: { zh: '决策树', en: 'Decision Tree' },
    description: { zh: '交互式构建 CART 决策树，观察特征分裂与决策边界。', en: 'Build a CART decision tree interactively and watch feature splits and the decision boundary.' },
    icon: 'i-lucide-git-branch',
    status: 'ready',
    pythonModule: 'ml/decision-tree',
    tags: ['Decision Tree', 'CART', 'Gini']
  },
  {
    slug: 'flappy',
    category: 'ml',
    title: { zh: 'Flappy Bird 神经进化', en: 'Flappy Bird Neuroevolution' },
    description: { zh: '用遗传算法 + 神经网络在浏览器中训练小鸟学会飞行。', en: 'Train birds to fly in the browser with a genetic algorithm and neural networks.' },
    icon: 'i-lucide-bird',
    status: 'ready',
    pythonModule: 'ml/flappy',
    tags: ['Neuroevolution', 'Genetic Algorithm', 'Neural Network']
  },
  {
    slug: 'sd-turbo',
    category: 'aigc',
    title: { zh: '文生图/图生图 (SD-Turbo)', en: 'Text/Image-to-Image (SD-Turbo)' },
    description: { zh: '用 SD-Turbo 在本地服务端生成或编辑图片（CPU 友好，1-4 步）。', en: 'Generate or edit images locally with SD-Turbo (CPU-friendly, 1-4 steps).' },
    icon: 'i-lucide-image',
    status: 'ready',
    pythonModule: 'aigc/sd-turbo',
    tags: ['Python', 'Text/Image-to-Image (SD-Turbo)']
  },
  {
    slug: 'photo-restore',
    category: 'aigc',
    title: { zh: '老照片修复', en: 'Photo Restoration' },
    description: { zh: '用 Real-ESRGAN + CodeFormer 修复模糊老照片与人脸细节。', en: 'Restore blurry old photos and face details with Real-ESRGAN + CodeFormer.' },
    icon: 'i-lucide-images',
    status: 'ready',
    pythonModule: 'aigc/photo-restore',
    tags: ['Python', 'Photo Restoration']
  },
  {
    slug: 'bg-removal',
    category: 'vision',
    title: { zh: '智能抠图（背景移除）', en: 'Background Removal' },
    description: { zh: '用 MODNet 在浏览器中一键抠出人像/主体，导出透明背景 PNG（数据不出浏览器）。', en: 'Cut out people/subjects in-browser with MODNet and export transparent PNGs (all local).' },
    icon: 'i-lucide-scissors',
    status: 'ready',
    tags: ['MODNet', 'Transformers.js', 'WebGPU']
  },
  {
    slug: 'reasoning-chat',
    category: 'aigc',
    title: { zh: '推理对话（DeepSeek-R1 蒸馏）', en: 'Reasoning Chat (DeepSeek-R1 Distill)' },
    description: { zh: '在浏览器运行推理 LLM：先展示思考过程，再给出答案（DeepSeek-R1 / MiniThinky）。', en: 'Run a reasoning LLM in-browser: watch it think step-by-step, then answer (DeepSeek-R1 / MiniThinky).' },
    icon: 'i-lucide-brain',
    status: 'ready',
    tags: ['DeepSeek-R1', 'Transformers.js', 'WebGPU']
  },
  {
    slug: 'codegen',
    category: 'aigc',
    title: { zh: '代码生成与执行', en: 'Code Generation & Execution' },
    description: { zh: '用 Qwen2.5-Coder 在浏览器补全代码，并用 Pyodide 直接在浏览器运行 Python。', en: 'Complete code in-browser with Qwen2.5-Coder, then run Python right away via Pyodide.' },
    icon: 'i-lucide-code-xml',
    status: 'ready',
    tags: ['Qwen2.5-Coder', 'Pyodide', 'Transformers.js']
  },
  {
    slug: 'multimodal-chat',
    category: 'aigc',
    title: { zh: '多模态对话（SmolVLM）', en: 'Multimodal Chat (SmolVLM)' },
    description: { zh: '上传图片与 SmolVLM-256M 多轮对话：识别图表、手写、场景与物体。', en: 'Upload images and chat multi-turn with SmolVLM-256M: charts, handwriting, scenes and objects.' },
    icon: 'i-lucide-messages-square',
    status: 'ready',
    tags: ['SmolVLM', 'Vision-Language', 'Transformers.js']
  },
  {
    slug: 'tripo3d',
    category: 'aigc',
    title: { zh: '图生 3D（TripoSR）', en: 'Image to 3D (TripoSR)' },
    description: { zh: '单张图片生成 3D 模型并在浏览器预览（Python 后端，CPU 30-60s/个）。', en: 'Generate a 3D mesh from a single image and preview it in-browser (Python backend, CPU 30-60s).' },
    icon: 'i-lucide-cuboid',
    status: 'planned',
    tags: ['TripoSR', 'Python', '3D']
  },
  {
    slug: 'talking-photo',
    category: 'aigc',
    title: { zh: '照片说话（SadTalker）', en: 'Talking Photo (SadTalker)' },
    description: { zh: '让静态照片跟随音频开口说话（Python 后端，非商用许可）。', en: 'Make a still photo talk along with audio (Python backend, non-commercial license).' },
    icon: 'i-lucide-user-round',
    status: 'planned',
    tags: ['SadTalker', 'Python', 'Video']
  },
  {
    slug: 'video-gen',
    category: 'aigc',
    title: { zh: '文生视频（Wan2.1）', en: 'Text-to-Video (Wan2.1)' },
    description: { zh: '文字描述生成短视频（需 GPU，当前机器受限）。', en: 'Generate short videos from text (requires GPU, limited on this machine).' },
    icon: 'i-lucide-video',
    status: 'planned',
    tags: ['Wan2.1', 'Python', 'Video']
  },
  // ===== vision 图像处理 Playground（viewer/transform/... 共 15 页）=====
  {
    slug: 'viewer',
    category: 'vision',
    title: { zh: '图像查看器', en: 'Image Viewer' },
    description: { zh: '图片信息、像素取色与格式转换下载。', en: 'Image info, pixel color picking, format conversion and download.' },
    icon: 'i-lucide-image',
    status: 'ready',
    pythonModule: 'image/viewer',
    tags: ['Canvas', 'Info', 'Picker']
  },
  {
    slug: 'transform',
    category: 'vision',
    title: { zh: '图像变换', en: 'Image Transform' },
    description: { zh: '缩放、裁剪、旋转、翻转、缩放比例、边距、透视与仿射变换。', en: 'Resize, crop, rotate, flip, scale, padding, perspective and affine transform.' },
    icon: 'i-lucide-move-3d',
    status: 'ready',
    pythonModule: 'image/transform',
    tags: ['Canvas', 'Geometry']
  },
  {
    slug: 'pixel',
    category: 'vision',
    title: { zh: '像素处理', en: 'Pixel Processing' },
    description: { zh: '读取像素、像素网格放大与像素级数学运算。', en: 'Read pixels, magnify the pixel grid and run pixel-level math.' },
    icon: 'i-lucide-grid-3x3',
    status: 'ready',
    pythonModule: 'image/pixel',
    tags: ['Canvas', 'ImageData']
  },
  {
    slug: 'color',
    category: 'vision',
    title: { zh: '颜色处理', en: 'Color Processing' },
    description: { zh: '灰度化、通道提取与合并、色彩空间、颜色替换与量化。', en: 'Grayscale, channel extraction & merge, color spaces, color replacement and quantization.' },
    icon: 'i-lucide-palette',
    status: 'ready',
    pythonModule: 'image/color',
    tags: ['Canvas', 'Color']
  },
  {
    slug: 'adjustment',
    category: 'vision',
    title: { zh: '图像调整', en: 'Image Adjustment' },
    description: { zh: '亮度、对比度、伽马、饱和度、色相、曝光、白平衡与自动增强。', en: 'Brightness, contrast, gamma, saturation, hue, exposure, white balance and auto enhancement.' },
    icon: 'i-lucide-sliders-horizontal',
    status: 'ready',
    pythonModule: 'image/adjust',
    tags: ['Canvas', 'Adjust']
  },
  {
    slug: 'filters',
    category: 'vision',
    title: { zh: '图像滤镜', en: 'Image Filters' },
    description: { zh: '模糊、锐化、浮雕、高通滤波等经典卷积滤镜（规划中）。', en: 'Blur, sharpen, emboss, high-pass and other classic convolution filters (planned).' },
    icon: 'i-lucide-sparkles',
    status: 'ready',
    pythonModule: 'image/filters',
    tags: ['Canvas', 'Filter']
  },
  {
    slug: 'enhancement',
    category: 'vision',
    title: { zh: '噪声与增强', en: 'Noise & Enhancement' },
    description: { zh: '加噪、去噪、直方图均衡与图像增强（规划中）。', en: 'Add noise, denoise, histogram equalization and enhancement (planned).' },
    icon: 'i-lucide-waves',
    status: 'ready',
    pythonModule: 'image/enhancement',
    tags: ['Canvas', 'Denoise']
  },
  {
    slug: 'morphology',
    category: 'vision',
    title: { zh: '阈值与形态学', en: 'Threshold & Morphology' },
    description: { zh: '二值化、自适应阈值、腐蚀膨胀、开闭运算与形态学梯度（规划中，OpenCV.js）。', en: 'Binary/adaptive/Otsu threshold, erosion, dilation, opening, closing and morphological gradient (planned, OpenCV.js).' },
    icon: 'i-lucide-shapes',
    status: 'ready',
    pythonModule: 'image/morphology',
    tags: ['OpenCV.js', 'Threshold']
  },
  {
    slug: 'edge',
    category: 'vision',
    title: { zh: '边缘与形状检测', en: 'Edge & Shape Detection' },
    description: { zh: 'Sobel、Canny、Harris 角点、Hough 直线与圆检测（规划中，OpenCV.js）。', en: 'Sobel, Canny, Harris corners, Hough lines and circles (planned, OpenCV.js).' },
    icon: 'i-lucide-scan-line',
    status: 'ready',
    pythonModule: 'image/edge',
    tags: ['OpenCV.js', 'Edge']
  },
  {
    slug: 'object',
    category: 'vision',
    title: { zh: '颜色与物体检测', en: 'Color & Object Detection' },
    description: { zh: '颜色分割、轮廓检测、物体计数、包围盒与形状识别（规划中，OpenCV.js）。', en: 'Color segmentation, contours, object counting, bounding boxes and shape recognition (planned, OpenCV.js).' },
    icon: 'i-lucide-target',
    status: 'ready',
    pythonModule: 'image/object',
    tags: ['OpenCV.js', 'Contour']
  },
  {
    slug: 'features',
    category: 'vision',
    title: { zh: '特征检测', en: 'Feature Detection' },
    description: { zh: 'ORB/BRISK 关键点与特征匹配（规划中，OpenCV.js）。', en: 'ORB/BRISK keypoints and feature matching (planned, OpenCV.js).' },
    icon: 'i-lucide-crosshair',
    status: 'ready',
    pythonModule: 'image/features',
    tags: ['OpenCV.js', 'Feature']
  },
  {
    slug: 'face',
    category: 'vision',
    title: { zh: '人脸视觉', en: 'Face Vision' },
    description: { zh: '人脸检测、关键点、模糊、马赛克与双图验证（MediaPipe + insightface）。', en: 'Face detection, landmarks, blur, pixelation and two-image verification (MediaPipe + insightface).' },
    icon: 'i-lucide-scan-face',
    status: 'ready',
    pythonModule: 'image/face',
    tags: ['MediaPipe', 'Face']
  },
  {
    slug: 'face-recognition',
    category: 'vision',
    title: { zh: '人脸注册与识别', en: 'Face Registration & Recognition' },
    description: { zh: '一人可上传多张照片或使用摄像头注册，之后上传照片/实时摄像头即可识别身份；支持合影选脸（insightface + 浏览器本地注册库）。', en: 'Enroll a person with multiple photos or your camera, then recognize them via photo upload or live camera; supports picking a face in group photos (insightface + local registry).' },
    icon: 'i-lucide-user-check',
    status: 'ready',
    pythonModule: 'image/face-recognition',
    tags: ['InsightFace', 'Face']
  },
  {
    slug: 'ocr',
    category: 'vision',
    title: { zh: 'OCR 与文档视觉', en: 'OCR & Document Vision' },
    description: { zh: '文字识别（Tesseract.js）与文档扫描校正（OpenCV.js）。', en: 'Text recognition (Tesseract.js) and document scanning (OpenCV.js).' },
    icon: 'i-lucide-file-text',
    status: 'ready',
    pythonModule: 'image/ocr',
    tags: ['Tesseract.js', 'OCR']
  },
  {
    slug: 'ai-vision',
    category: 'vision',
    title: { zh: 'AI 目标与图像视觉', en: 'AI Object & Image Vision' },
    description: { zh: '图像分类、目标检测、分割、抠图、嵌入与相似度（MediaPipe）。', en: 'Classification, detection, segmentation, background removal, embedding and similarity (MediaPipe).' },
    icon: 'i-lucide-eye',
    status: 'ready',
    pythonModule: 'image/ai-vision',
    tags: ['MediaPipe', 'Transformers.js']
  },
  {
    slug: 'multimodal',
    category: 'vision',
    title: { zh: 'AI 视觉与多模态', en: 'AI Vision & Multimodal' },
    description: { zh: '图像描述与深度估计（Transformers.js），问答/修复/风格迁移见 AIGC。', en: 'Image captioning and depth estimation (Transformers.js); QA/inpainting/style transfer under AIGC.' },
    icon: 'i-lucide-layers',
    status: 'ready',
    pythonModule: 'image/multimodal',
    tags: ['Transformers.js', 'Multimodal']
  },
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
