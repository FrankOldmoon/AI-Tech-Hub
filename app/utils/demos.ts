// AI 演示注册表：所有 demo 的元数据集中在此，前端/分类页面统一消费
// 标题/描述以 { zh, en } 形式存储，便于按当前 locale 取值

export type DemoCategory = 'speech' | 'vision' | 'nlp' | 'aigc' | 'ml' | 'robot'
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

/** 预期管理：卡片上展示的运行前提（审计维度四-2） */
export interface DemoRequirements {
  camera?: boolean
  mic?: boolean
  modelSizeMB?: number
  needsServer?: boolean
}

export interface Demo {
  slug: string
  category: DemoCategory
  title: Localized
  description: Localized
  icon: string
  status: DemoStatus
  /** 运行时类型：浏览器本地推理 / 本地服务端（Python） */
  runtime?: 'browser' | 'server'
  /** 运行前提（需摄像头/麦克风/模型体积/需本地服务） */
  requirements?: DemoRequirements
  /** 首页精选（在分类限流中优先展示） */
  featured?: boolean
  /** 课堂演示推荐（老师视角：可靠、快、适合全班演示，审计 P1-5） */
  classroomSafe?: boolean
  /** 工作原理（教学向，Shell 折叠渲染；缺省不展示） */
  howItWorks?: Localized
  /** 运行必需本地 Python 后端；云端部署（Vercel）时禁用并提示 */
  requiresPython?: boolean
  /** 本地 Python 后端是否已就绪（服务器端依赖/模型已装好）。false 时前端显示"后端未就绪"而非报错 */
  backendReady?: boolean
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
export interface LocalizedDemo extends Omit<Demo, 'title' | 'description' | 'howItWorks'> {
  title: string
  description: string
  howItWorks?: string
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
  },
  {
    slug: 'robot',
    title: { zh: '机械人', en: 'Robotics' },
    description: {
      zh: '机器人相关 AI 演示（敬请期待）——机械臂控制、视觉导航、语音交互等。',
      en: 'Robotics AI demos (coming soon) — robot arm control, vision navigation, voice interaction and more.'
    },
    icon: 'i-lucide-bot'
  }
]

export const demos: Demo[] = [
  // ===== speech =====
  {
    slug: 'tts',
    classroomSafe: true,
    category: 'speech',
    title: { zh: '文本转语音 (TTS)', en: 'Text to Speech (TTS)' },
    description: { zh: '文本转语音合成。', en: 'Text to speech synthesis.' },
    howItWorks: { zh: '输入文本，合成引擎（如 edge-tts 神经网络语音）逐句生成语音，可直接播放或下载。', en: 'Type text and a neural TTS engine turns it into natural speech you can play or download.' },
    icon: 'i-lucide-volume-2',
    status: 'ready',
    runtime: 'browser',
    requirements: { modelSizeMB: 100 },
    featured: true,
    pythonModule: 'speech/tts',
    tags: ['TTS', 'edge-tts']
  },
  {
    slug: 'asr',
    classroomSafe: true,
    category: 'speech',
    title: { zh: '语音识别 (ASR)', en: 'Speech Recognition (ASR)' },
    description: { zh: '语音识别转文字。', en: 'Speech to text recognition.' },
    howItWorks: { zh: '上传/录制音频，Whisper 等声学模型识别语音并转成文字，可切换模型与语言。', en: 'Upload or record audio; a speech recognition model (e.g. Whisper) transcribes it into text.' },
    icon: 'i-lucide-mic',
    status: 'ready',
    runtime: 'browser',
    requirements: { mic: true, modelSizeMB: 150 },
    featured: true,
    tags: ['ASR', 'Web Speech API', 'Whisper'],
    pythonModule: 'speech/asr'
  },
  {
    slug: 'audio-classifier',
    classroomSafe: true,
    category: 'speech',
    title: { zh: '音频分类', en: 'Audio Classifier' },
    description: { zh: '音频事件分类识别。', en: 'Audio event classification.' },
    howItWorks: { zh: '输入音频片段，YAMNet 等分类模型逐帧判断声音类别（人声/乐器/环境声等）并给出置信度。', en: 'Feed an audio clip; a classifier like YAMNet tags each frame with a sound category and confidence.' },
    icon: 'i-lucide-audio-waveform',
    status: 'ready',
    runtime: 'browser',
    requirements: { mic: true },
    pythonModule: 'mediapipe/audio-classifier',
    tags: ['Audio', 'MediaPipe', 'YAMNet']
  },
  {
    slug: 'separation',
    category: 'speech',
    title: { zh: '音频分离', en: 'Audio Separation' },
    description: { zh: '分离人声与伴奏等音轨。', en: 'Separate vocals, drums, bass and other stems.' },
    howItWorks: { zh: '输入混合音乐，Demucs 深度分离模型把人声、鼓、贝斯、其他音轨拆开，可单独试听。', en: 'Mix a song, and Demucs separates vocals, drums, bass and other stems so you can listen to each alone.' },
    icon: 'i-lucide-split',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    pythonModule: 'speech/separation',
    tags: ['Audio', 'Demucs']
  },
  {
    slug: 'voice-clone',
    classroomSafe: true,
    category: 'speech',
    title: { zh: '语音克隆', en: 'Voice Cloning' },
    description: { zh: '用一段参考录音克隆音色并合成任意文本。', en: 'Clone a voice from a reference recording and synthesize any text.' },
    howItWorks: { zh: '用一段参考语音提取音色，再用文本合成出“同一人声线”的克隆语音。', en: 'Extract a speaker’s timbre from reference audio, then synthesize new speech in that same voice.' },
    icon: 'i-lucide-mic-vocal',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    featured: true,
    pythonModule: 'speech/voice-clone',
    tags: ['Voice', 'XTTS-v2', 'Zero-shot']
  },
  {
    slug: 'emotion',
    category: 'speech',
    title: { zh: '语音情感识别 (SER)', en: 'Speech Emotion Recognition (SER)' },
    description: { zh: '识别语音中的情绪（开心/生气/悲伤等）。', en: 'Recognize emotions in speech (happy, angry, sad...).' },
    howItWorks: { zh: '输入语音，情绪识别模型从语调与能量特征判断开心/生气/中性等情绪。', en: 'Speech emotion recognition reads tone and energy to classify happy, angry, neutral and more.' },
    icon: 'i-lucide-smile-plus',
    status: 'ready',
    runtime: 'browser',
    requirements: { mic: true },
    tags: ['Emotion', 'wav2vec2', 'transformers.js'],
    pythonModule: 'speech/emotion'
  },
  {
    slug: 'pitch-detector',
    category: 'speech',
    title: { zh: '实时音高检测', en: 'Real-time Pitch Detector' },
    description: { zh: '用麦克风实时检测音高与音名（YIN 算法）。', en: 'Real-time pitch and note detection from mic (YIN).' },
    howItWorks: { zh: '输入音频，实时检测基频并绘制音高曲线，帮助练声与乐器校音。', en: 'Detect fundamental frequency in real time and plot the pitch curve — great for singing practice.' },
    icon: 'i-lucide-audio-waveform',
    status: 'ready',
    runtime: 'browser',
    requirements: { mic: true },
    tags: ['Pitch', 'YIN', 'Web Audio'],
    pythonModule: 'speech/pitch-detector'
  },
  {
    slug: 'denoise',
    category: 'speech',
    title: { zh: '音频降噪增强', en: 'Audio Denoise (Enhancement)' },
    description: { zh: '用 DeepFilterNet 去除噪声、增强语音。', en: 'Remove noise and enhance speech with DeepFilterNet.' },
    howItWorks: { zh: '输入带噪语音，DeepFilterNet 模型抑制噪声、增强人声，前后对比直观。', en: 'Feed in noisy speech; DeepFilterNet suppresses noise and enhances the voice with a clear before/after.' },
    icon: 'i-lucide-waves',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    backendReady: false,
    pythonModule: 'speech/denoise',
    tags: ['Denoise', 'DeepFilterNet']
  },

  {
    slug: 'vad',
    category: 'speech',
    title: { zh: '语音活动检测 (VAD)', en: 'Voice Activity Detection (VAD)' },
    description: { zh: '用 Silero VAD 检测音频中的语音段。', en: 'Detect speech segments in audio with Silero VAD.' },
    howItWorks: { zh: '输入音频，语音活动检测标出“哪些时间段在说话”，可截取有效片段。', en: 'Voice activity detection marks which time spans contain speech, so you can trim the useful parts.' },
    icon: 'i-lucide-mic-vocal',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    backendReady: false,
    pythonModule: 'speech/vad',
    tags: ['VAD', 'Silero']
  },

  {
    slug: 'musicgen',
    category: 'speech',
    title: { zh: '文生音乐 (MusicGen)', en: 'Music Generation (MusicGen)' },
    description: { zh: '用文字描述生成一段音乐。', en: 'Generate music from a text description.' },
    howItWorks: { zh: '输入一句文字描述（如“轻松的爵士钢琴”），MusicGen 模型生成对应风格的音乐。', en: 'Type a prompt like “chill jazz piano” and MusicGen synthesizes matching music.' },
    icon: 'i-lucide-music-4',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    backendReady: false,
    pythonModule: 'speech/musicgen',
    tags: ['MusicGen', 'AIGC']
  },

  {
    slug: 'visualizer',
    category: 'speech',
    title: { zh: '音频可视化', en: 'Audio Visualizer' },
    description: { zh: '波形 + 频谱图实时可视化音频。', en: 'Visualize audio with waveform and spectrogram.' },
    howItWorks: { zh: '播放音频，Web Audio 分析节点实时提取频谱与波形，可视化展示声音形态。', en: 'Play audio; the Web Audio analyser renders live waveform and spectrogram of the sound.' },
    icon: 'i-lucide-audio-lines',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'speech/visualizer',
    tags: ['Visualizer', 'wavesurfer']
  },

  {
    slug: 'meeting',
    category: 'speech',
    title: { zh: '会议纪要', en: 'Meeting Notes' },
    description: { zh: '转写音频并区分说话人，生成会议纪要。', en: 'Transcribe audio, separate speakers and generate meeting notes.' },
    howItWorks: { zh: '上传会议音频，依次完成转写、说话人区分与要点总结，生成结构化会议纪要。', en: 'Upload meeting audio; it is transcribed, diarized by speaker and summarized into structured notes.' },
    icon: 'i-lucide-users',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    backendReady: false,
    pythonModule: 'speech/meeting',
    tags: ['Meeting', 'Whisper', 'WeSpeaker']
  },

  {
    slug: 'midi',
    category: 'speech',
    title: { zh: '音频转 MIDI', en: 'Audio to MIDI' },
    description: { zh: '把乐器音频转成可编辑的 MIDI 文件。', en: 'Convert instrument audio into an editable MIDI file.' },
    howItWorks: { zh: '输入音频/演奏，音符转录模型把声音转成 MIDI 音符序列。', en: 'Audio or live playing is transcribed into a MIDI note sequence.' },
    icon: 'i-lucide-piano',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    backendReady: false,
    pythonModule: 'speech/midi',
    tags: ['MIDI', 'Transcription']
  },

  {
    slug: 'speech-translate',
    category: 'speech',
    title: { zh: '语音翻译', en: 'Speech Translation' },
    description: { zh: '语音识别并翻译为英文（Whisper translate）。', en: 'Transcribe speech and translate it to English (Whisper translate).' },
    howItWorks: { zh: '输入语音，先识别再翻译（可选语音合成），输出目标语言的文字或语音。', en: 'Speech is recognized then translated (with optional TTS) into text or audio in another language.' },
    icon: 'i-lucide-languages',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    backendReady: false,
    pythonModule: 'speech/speech-translate',
    tags: ['Translate', 'Whisper']
  },

  {
    slug: 'lip-sync',
    category: 'speech',
    title: { zh: '口型同步 (Wav2Lip)', en: 'Lip Sync (Wav2Lip)' },
    description: { zh: '让视频中的人脸随音频口型同步。', en: 'Make the face in a video lip-sync to any audio.' },
    howItWorks: { zh: '输入人像照片 + 语音，口型驱动模型让照片中的人“说出”这段语音并生成视频。', en: 'Give a portrait and a voice clip; a lip-sync model animates the face to speak it as video.' },
    icon: 'i-lucide-clapperboard',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    backendReady: false,
    pythonModule: 'speech/lip-sync',
    tags: ['Wav2Lip', 'Video']
  },

  {
    slug: 'singing',
    category: 'speech',
    title: { zh: '歌声合成 (DiffSinger)', en: 'Singing Synthesis (DiffSinger)' },
    description: { zh: '从乐谱与歌词合成歌声（需 GPU 与声库，规划中）。', en: 'Synthesize singing from notes and lyrics (requires GPU + voice bank, planned).' },
    howItWorks: { zh: '输入乐谱/歌词，歌声合成模型生成带音色与情感的歌声（规划中）。', en: 'Score and lyrics are synthesized into singing with timbre and emotion (planned).' },
    icon: 'i-lucide-music-2',
    status: 'planned',
    runtime: 'server',
    pythonModule: 'speech/singing',
    tags: ['Singing', 'DiffSinger']
  },

  // ===== vision (MediaPipe) =====
  {
    slug: 'face-detection',
    classroomSafe: true,
    category: 'vision',
    title: { zh: '人脸检测', en: 'Face Detector' },
    description: { zh: '检测图像中的人脸。', en: 'Detect human faces in images.' },
    howItWorks: { zh: '输入图像/摄像头，人脸检测模型定位人脸并画框（可调灵敏度）。', en: 'A face detector locates faces in an image or camera feed and draws boxes.' },
    icon: 'i-lucide-scan-face',
    status: 'ready',
    runtime: 'browser',
    requirements: { camera: true },
    featured: true,
    pythonModule: 'mediapipe/face-detection',
    tags: ['MediaPipe', 'Face']
  },
  {
    slug: 'face-landmarker',
    category: 'vision',
    title: { zh: '人脸关键点', en: 'Face Landmarker' },
    description: { zh: '检测人脸 478 个关键点。', en: 'Detect 478 face landmarks.' },
    howItWorks: { zh: '输入人脸图像，关键点模型标出 468 个面部关键点/网格，支持表情追踪。', en: 'A landmarker plots 468 facial points and a mesh, enabling expression tracking.' },
    icon: 'i-lucide-smile',
    status: 'ready',
    runtime: 'browser',
    requirements: { camera: true },
    pythonModule: 'mediapipe/face-landmarker',
    tags: ['MediaPipe', 'Face Mesh']
  },
  {
    slug: 'hand-landmarker',
    classroomSafe: true,
    category: 'vision',
    title: { zh: '手势关键点', en: 'Hand Landmarker' },
    description: { zh: '检测手部 21 个关键点。', en: 'Detect 21 hand landmarks.' },
    howItWorks: { zh: '输入手势图像/摄像头，模型标出 21 个手部关键点并绘制骨骼连线。', en: 'A model plots 21 hand keypoints and draws the skeleton, live or on a photo.' },
    icon: 'i-lucide-hand',
    status: 'ready',
    runtime: 'browser',
    requirements: { camera: true },
    pythonModule: 'mediapipe/hand-landmarker',
    tags: ['MediaPipe', 'Hand']
  },
  {
    slug: 'gesture-recognizer',
    classroomSafe: true,
    category: 'vision',
    title: { zh: '手势识别', en: 'Gesture Recognizer' },
    description: { zh: '识别手部手势类别。', en: 'Recognize hand gesture categories.' },
    howItWorks: { zh: '输入手势图像/摄像头，先检测手部关键点再识别手势类别（如竖大拇指）。', en: 'Hand keypoints are detected first, then the gesture is classified (e.g. thumbs up).' },
    icon: 'i-lucide-hand-metal',
    status: 'ready',
    runtime: 'browser',
    requirements: { camera: true },
    pythonModule: 'mediapipe/gesture-recognizer',
    tags: ['MediaPipe', 'Gesture']
  },
  {
    slug: 'pose-landmarker',
    classroomSafe: true,
    category: 'vision',
    title: { zh: '姿态估计', en: 'Pose Landmarker' },
    description: { zh: '检测人体姿态关键点。', en: 'Detect body pose landmarks.' },
    howItWorks: { zh: '输入人体图像/摄像头，姿态模型标出 33 个关键点，可测角度与动作。', en: 'A pose model plots 33 body keypoints, enabling angle and movement analysis.' },
    icon: 'i-lucide-person-standing',
    status: 'ready',
    runtime: 'browser',
    requirements: { camera: true },
    pythonModule: 'mediapipe/pose-landmarker',
    tags: ['MediaPipe', 'Pose']
  },
  {
    slug: 'holistic-landmarker',
    category: 'vision',
    title: { zh: '整体检测', en: 'Holistic Landmarker' },
    description: { zh: '同时检测人脸、手部与姿态。', en: 'Detect face, hands and pose together.' },
    howItWorks: { zh: '输入全身图像/摄像头，综合模型同时输出人脸、左右手与全身关键点。', en: 'A holistic model outputs face, both hands and full-body keypoints at once.' },
    icon: 'i-lucide-move-3d',
    status: 'ready',
    runtime: 'browser',
    requirements: { camera: true },
    pythonModule: 'mediapipe/holistic-landmarker',
    tags: ['MediaPipe', 'Holistic']
  },
  {
    slug: 'object-detector',
    classroomSafe: true,
    category: 'vision',
    title: { zh: '目标检测', en: 'Object Detector' },
    description: { zh: '检测图像中的目标并分类。', en: 'Detect and classify objects in images.' },
    howItWorks: { zh: '输入图像，目标检测模型用框标出物体位置并给出类别与置信度。', en: 'An object detector draws boxes around objects with category and confidence.' },
    icon: 'i-lucide-scan-eye',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'mediapipe/object-detector',
    tags: ['MediaPipe', 'Object']
  },
  {
    slug: 'image-classifier',
    classroomSafe: true,
    category: 'vision',
    title: { zh: '图像分类', en: 'Image Classifier' },
    description: { zh: '对图像内容进行分类。', en: 'Classify image content.' },
    howItWorks: { zh: '输入图像，分类模型输出最可能的 Top-K 类别与置信度。', en: 'An image classifier returns the top-K categories and their confidences.' },
    icon: 'i-lucide-image',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'mediapipe/image-classifier',
    tags: ['MediaPipe', 'Classification']
  },
  {
    slug: 'image-embedder',
    category: 'vision',
    title: { zh: '图像嵌入', en: 'Image Embedder' },
    description: { zh: '计算图像相似度。', en: 'Compute image similarity.' },
    howItWorks: { zh: '输入两张图，嵌入模型分别提取向量并计算余弦相似度（越接近 1 越相似）。', en: 'Two images are embedded into vectors; cosine similarity tells how alike they are.' },
    icon: 'i-lucide-layers',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'mediapipe/image-embedder',
    tags: ['MediaPipe', 'Embedding']
  },
  {
    slug: 'image-segmenter',
    category: 'vision',
    title: { zh: '图像分割', en: 'Image Segmenter' },
    description: { zh: '分割图像前景。', en: 'Segment image foreground.' },
    howItWorks: { zh: '输入图像，分割模型输出逐像素的前景/背景掩码（可选人体分割）。', en: 'A segmenter outputs a per-pixel foreground/background mask (person segmentation optional).' },
    icon: 'i-lucide-scissors',
    status: 'ready',
    runtime: 'browser',
    requirements: { camera: true },
    pythonModule: 'mediapipe/image-segmenter',
    tags: ['MediaPipe', 'Segmentation']
  },
  {
    slug: 'interactive-segmenter',
    category: 'vision',
    title: { zh: '交互式分割', en: 'Interactive Segmenter' },
    description: { zh: '点击选取目标并分割。', en: 'Click to segment a target.' },
    howItWorks: { zh: '点击图像上的目标，交互式分割模型一键抠出该目标区域。', en: 'Click a target and the interactive segmenter cuts it out instantly.' },
    icon: 'i-lucide-mouse-pointer-click',
    status: 'ready',
    runtime: 'browser',
    requirements: { camera: true },
    pythonModule: 'mediapipe/interactive-segmenter',
    tags: ['MediaPipe', 'Segmentation']
  },
  {
    slug: 'depth-estimation',
    classroomSafe: true,
    category: 'vision',
    title: { zh: '深度估计', en: 'Depth Estimation' },
    description: { zh: '估计图像中每个像素的深度。', en: 'Estimate per-pixel depth of an image.' },
    howItWorks: { zh: '输入图像，深度估计模型为每个像素预测相对深度，生成灰度深度图。', en: 'A depth model predicts per-pixel relative depth and renders a grayscale depth map.' },
    icon: 'i-lucide-box',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'transformers/depth-estimation',
    tags: ['Transformers.js', 'Depth']
  },
  {
    slug: 'image-captioning',
    category: 'vision',
    title: { zh: '图像描述', en: 'Image Captioning' },
    description: { zh: '生成图像内容的文字描述。', en: 'Generate a text description of an image.' },
    howItWorks: { zh: '输入图像，视觉语言模型（如 ViT-GPT2）生成一句自然语言描述。', en: 'A vision-language model (e.g. ViT-GPT2) writes a natural-language caption for the image.' },
    icon: 'i-lucide-text',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'transformers/image-captioning',
    tags: ['Transformers.js', 'Captioning']
  },
  // ===== nlp (MediaPipe Text) =====
  {
    slug: 'text-classifier',
    category: 'nlp',
    title: { zh: '文本分类', en: 'Text Classifier' },
    description: { zh: '文本情感分类。', en: 'Text sentiment classification.' },
    howItWorks: { zh: '输入文本，分类模型输出情感/主题类别与置信度。', en: 'Feed in text; a classifier returns category and confidence (e.g. sentiment).' },
    icon: 'i-lucide-message-square',
    status: 'ready',
    runtime: 'browser',
    featured: true,
    pythonModule: 'mediapipe/text-classifier',
    tags: ['MediaPipe', 'Sentiment']
  },
  {
    slug: 'language-detector',
    category: 'nlp',
    title: { zh: '语言检测', en: 'Language Detector' },
    description: { zh: '检测文本所属语言。', en: 'Detect text language.' },
    howItWorks: { zh: '输入文本，语言识别模型判断其属于哪种语言。', en: 'A language detector identifies which language the text is written in.' },
    icon: 'i-lucide-globe',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'mediapipe/language-detector',
    tags: ['MediaPipe', 'Language']
  },
  {
    slug: 'text-embedder',
    category: 'nlp',
    title: { zh: '文本嵌入', en: 'Text Embedder' },
    description: { zh: '计算文本相似度。', en: 'Compute text similarity.' },
    howItWorks: { zh: '输入两段文本，分别嵌入为向量并计算语义相似度（越接近 1 越相关）。', en: 'Two texts are embedded into vectors; cosine similarity measures semantic closeness.' },
    icon: 'i-lucide-type',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'mediapipe/text-embedder',
    tags: ['MediaPipe', 'Embedding']
  },
  {
    slug: 'ner',
    classroomSafe: true,
    category: 'nlp',
    title: { zh: '命名实体识别', en: 'Named Entity Recognition' },
    description: { zh: '识别文本中的人名、地名、机构等实体。', en: 'Recognize persons, locations, organizations in text.' },
    howItWorks: { zh: '输入文本，命名实体识别标出人名、地名、机构等实体。', en: 'Named-entity recognition tags people, places and organizations in text.' },
    icon: 'i-lucide-tag',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'transformers/ner',
    tags: ['Transformers.js', 'NER']
  },
  {
    slug: 'zero-shot',
    classroomSafe: true,
    category: 'nlp',
    title: { zh: '零样本文本分类', en: 'Zero-shot Classification' },
    description: { zh: '用自定义候选标签对文本分类。', en: 'Classify text with custom candidate labels.' },
    howItWorks: { zh: '输入文本 + 候选标签，零样本分类模型判断文本最匹配哪个标签。', en: 'Zero-shot classification matches text against candidate labels without training.' },
    icon: 'i-lucide-list-checks',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'transformers/zero-shot',
    tags: ['Transformers.js', 'Zero-shot']
  },
  {
    slug: 'summarization',
    classroomSafe: true,
    category: 'nlp',
    title: { zh: '文本摘要', en: 'Summarization' },
    description: { zh: '生成文本的摘要。', en: 'Generate a summary of the text.' },
    howItWorks: { zh: '输入长文，摘要模型压缩出要点（可调长度）。', en: 'A summarization model condenses long text into key points (length adjustable).' },
    icon: 'i-lucide-file-text',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'transformers/summarization',
    tags: ['Transformers.js', 'Summarization']
  },
  {
    slug: 'qa',
    classroomSafe: true,
    category: 'nlp',
    title: { zh: '问答抽取', en: 'Question Answering' },
    description: { zh: '从上下文中抽取问题答案。', en: 'Extract an answer from context.' },
    howItWorks: { zh: '基于给定文档提问，问答模型从上下文中抽取答案。', en: 'Ask a question about a document; the QA model extracts the answer from context.' },
    icon: 'i-lucide-help-circle',
    status: 'ready',
    runtime: 'browser',
    featured: true,
    pythonModule: 'transformers/qa',
    tags: ['Transformers.js', 'QA']
  },
  {
    slug: 'fill-mask',
    category: 'nlp',
    title: { zh: '完形填空', en: 'Fill-Mask' },
    description: { zh: '预测掩码位置的词。', en: 'Predict the masked token.' },
    howItWorks: { zh: '输入含 [MASK] 的句子，掩码模型预测最可能的词。', en: 'Type a sentence with [MASK]; the model predicts the most likely word.' },
    icon: 'i-lucide-puzzle',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'transformers/fill-mask',
    tags: ['Transformers.js', 'Mask']
  },
  // ===== aigc (WebLLM) =====
  {
    slug: 'webllm',
    category: 'aigc',
    title: { zh: '浏览器 LLM 对话', en: 'In-browser LLM Chat' },
    description: { zh: '基于 WebLLM 在浏览器中本地运行的 LLM 对话。', en: 'LLM chat running locally in-browser via WebLLM.' },
    howItWorks: { zh: '输入提示词，浏览器内直接运行 LLM（Qwen/Llama 量化版）生成回复，模型可本地缓存。', en: 'Prompt a quantized LLM (Qwen/Llama) that runs fully in your browser, with local model caching.' },
    icon: 'i-lucide-message-circle',
    status: 'ready',
    runtime: 'browser',
    requirements: { modelSizeMB: 1300 },
    featured: true,
    pythonModule: 'transformers/webllm',
    tags: ['WebLLM', 'WebGPU', 'Llama', 'Qwen']
  },
  {
    slug: 'text-to-image',
    category: 'aigc',
    title: { zh: '文生图 (Janus-Pro)', en: 'Text-to-Image (Janus-Pro)' },
    description: { zh: '用 Janus-Pro-1B 在浏览器本地生成图片，并支持图像理解问答。', en: 'Generate images locally in-browser with Janus-Pro-1B, plus image understanding QA.' },
    howItWorks: { zh: '输入描述文本，扩散模型生成对应图像，可调步数与尺寸。', en: 'A diffusion model renders an image from your text prompt, with steps and size controls.' },
    icon: 'i-lucide-image',
    status: 'ready',
    runtime: 'browser',
    requirements: { modelSizeMB: 1500 },
    featured: true,
    tags: ['Janus-Pro', 'Transformers.js', 'WebGPU', 'Multi-modal']
  },
  {
    slug: 'inpainting',
    category: 'aigc',
    title: { zh: '图像修复 (Moebius)', en: 'Image Inpainting (Moebius)' },
    description: { zh: '用 Moebius-0.2B 在浏览器涂抹去除并补全图片区域。', en: 'Paint over image regions to remove and inpaint them with Moebius-0.2B in-browser.' },
    howItWorks: { zh: '上传图像并涂掉区域，修复模型根据周围内容补全该区域。', en: 'Mask a region of an image and an inpainting model fills it from surrounding context.' },
    icon: 'i-lucide-eraser',
    status: 'ready',
    runtime: 'browser',
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
  {
    slug: 'llm-chat',
    category: 'aigc',
    title: { zh: '云端 LLM 对话（Kimi / DeepSeek）', en: 'Cloud LLM Chat (Kimi / DeepSeek)' },
    description: {
      zh: '通过云端 API 调用 Kimi K3 / DeepSeek 等大模型对话，服务商与模型可随时切换，Kimi K3 会先展示思考过程。',
      en: 'Chat with cloud LLMs (Kimi K3 / DeepSeek) via API — switch providers and models anytime; Kimi K3 shows its thinking first.'
    },
    howItWorks: { zh: '输入对话，请求云端大模型 API（Kimi / DeepSeek，可切换）流式生成回复，支持多轮上下文。', en: 'Your message goes to a cloud LLM API (Kimi/DeepSeek, switchable) which streams a reply with multi-turn context.' },
    icon: 'i-lucide-message-square-text',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    tags: ['Kimi K3', 'DeepSeek', 'Cloud API', 'SSE Streaming']
  },
  // ===== ml (Teachable Machine) =====
  {
    slug: 'image-training',
    category: 'ml',
    title: { zh: '图像训练', en: 'Image Training' },
    description: { zh: '采集摄像头样本训练自定义图像分类器。', en: 'Collect webcam samples to train a custom image classifier.' },
    howItWorks: { zh: '上传图片数据集，在浏览器训练图像分类器（迁移学习），可下载模型。', en: 'Train an image classifier in the browser via transfer learning, then export it.' },
    icon: 'i-lucide-camera',
    status: 'ready',
    runtime: 'browser',
    requirements: { camera: true },
    pythonModule: 'ml/image-training',
    tags: ['TensorFlow.js', 'MobileNet', 'KNN']
  },
  {
    slug: 'audio-training',
    category: 'ml',
    title: { zh: '声音训练', en: 'Audio Training' },
    description: { zh: '采集麦克风样本训练自定义声音分类器。', en: 'Collect microphone samples to train a custom audio classifier.' },
    howItWorks: { zh: '录制/上传音频样本，在浏览器训练声音分类器。', en: 'Record or upload audio samples to train a sound classifier in the browser.' },
    icon: 'i-lucide-mic',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'ml/audio-training',
    tags: ['TensorFlow.js', 'Speech Commands', 'KNN']
  },
  {
    slug: 'pose-training',
    category: 'ml',
    title: { zh: '姿态训练', en: 'Pose Training' },
    description: { zh: '采集身体姿态样本训练自定义动作分类器（迁移学习）。', en: 'Collect pose samples from the webcam to train a custom gesture classifier (transfer learning).' },
    howItWorks: { zh: '用摄像头采集动作样本，在浏览器训练姿态分类器（可玩小游戏）。', en: 'Collect pose samples from your camera and train a classifier in the browser.' },
    icon: 'i-lucide-person-standing',
    status: 'ready',
    runtime: 'browser',
    requirements: { camera: true },
    pythonModule: 'ml/pose-training',
    tags: ['MediaPipe', 'Pose', 'KNN']
  },
  {
    slug: 'text-training',
    category: 'ml',
    title: { zh: '文本训练', en: 'Text Training' },
    description: { zh: '输入文本样本训练自定义文本分类器（迁移学习）。', en: 'Train a custom text classifier with your own examples (transfer learning).' },
    howItWorks: { zh: '输入带标签的文本样本，在浏览器训练文本分类器。', en: 'Feed labeled text samples to train a text classifier in the browser.' },
    icon: 'i-lucide-type',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'ml/text-training',
    tags: ['Transformers.js', 'Embedding', 'KNN']
  },
  {
    slug: 'playground',
    category: 'ml',
    title: { zh: '神经网络游乐场', en: 'Neural Network Playground' },
    description: { zh: '在 2D 数据上实时训练神经网络，观察决策边界与损失变化。', en: 'Train a neural network on 2D data in real time and watch the decision boundary and loss evolve.' },
    howItWorks: { zh: '机器学习游乐场：小数据集上直观调整模型/正则化，观察决策边界。', en: 'A playground: tweak a small dataset and model settings to watch decision boundaries.' },
    icon: 'i-lucide-brain-circuit',
    status: 'ready',
    runtime: 'browser',
    featured: true,
    pythonModule: 'ml/playground',
    tags: ['Neural Network', 'Backprop', 'Playground']
  },
  {
    slug: 'auto-train',
    category: 'ml',
    title: { zh: 'CSV 自动训练', en: 'CSV AutoTrain' },
    description: { zh: '上传 CSV，自动训练多个模型并对比指标，快速上手机器学习工作流。', en: 'Upload a CSV, auto-train multiple models and compare metrics — a quick machine learning workflow.' },
    howItWorks: { zh: '上传 CSV，自动训练多个模型并对比指标，快速上手机器学习工作流。', en: 'Upload a CSV; multiple models train automatically and metrics are compared side by side.' },
    icon: 'i-lucide-file-spreadsheet',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    pythonModule: 'ml/auto-train',
    tags: ['scikit-learn', 'AutoML', 'CSV']
  },
  {
    slug: 'kmeans',
    category: 'ml',
    title: { zh: 'K-Means 聚类', en: 'K-Means Clustering' },
    description: { zh: '步进式观察 K-Means 如何把数据点聚成 K 簇（无监督学习）。', en: 'Step through K-Means as it groups points into K clusters (unsupervised learning).' },
    howItWorks: { zh: '上传/生成数据点，K-Means 迭代聚类并着色，可调 K 值。', en: 'K-Means clusters data points iteratively and colors them; adjust K live.' },
    icon: 'i-lucide-donut',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'ml/kmeans',
    tags: ['K-Means', 'Unsupervised', 'Clustering']
  },
  {
    slug: 'regression',
    category: 'ml',
    title: { zh: '回归拟合', en: 'Regression Fitting' },
    description: { zh: '在散点上用梯度下降拟合多项式曲线，观察损失下降。', en: 'Fit a polynomial curve to scatter points with gradient descent and watch the loss drop.' },
    howItWorks: { zh: '拟合数据集，可视化回归曲线与残差。', en: 'Fit a dataset and visualize the regression curve and residuals.' },
    icon: 'i-lucide-trending-up',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'ml/regression',
    tags: ['Regression', 'Gradient Descent', 'Polynomial']
  },
  {
    slug: 'mnist',
    classroomSafe: true,
    category: 'ml',
    title: { zh: 'MNIST 手写数字', en: 'MNIST Handwritten Digits' },
    description: { zh: '在浏览器中训练神经网络识别手写数字，然后亲手写一个测试它。', en: 'Train a neural network in the browser to recognize handwritten digits, then draw one to test it.' },
    howItWorks: { zh: '手写数字画板：画出数字，神经网络实时识别。', en: 'Draw a digit and a neural network classifies it in real time.' },
    icon: 'i-lucide-pen-tool',
    status: 'ready',
    runtime: 'browser',
    featured: true,
    pythonModule: 'ml/mnist',
    tags: ['TensorFlow.js', 'MNIST', 'CNN']
  },
  {
    slug: 'cartpole',
    category: 'ml',
    title: { zh: '强化学习 CartPole', en: 'Reinforcement Learning: CartPole' },
    description: { zh: '用策略梯度在浏览器中训练智能体学会平衡倒立摆。', en: 'Train an agent with policy gradient in the browser to balance an inverted pendulum.' },
    howItWorks: { zh: '强化学习经典任务：训练智能体平衡倒立摆，可调学习率与回合数。', en: 'The classic RL task: train an agent to balance a pole, tuning learning rate and episodes.' },
    icon: 'i-lucide-rocket',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'ml/cartpole',
    tags: ['Reinforcement Learning', 'Policy Gradient', 'TF.js']
  },
  {
    slug: 'forecast',
    category: 'ml',
    title: { zh: '时间序列预测', en: 'Time Series Forecasting' },
    description: { zh: '上传时间序列 CSV，用指数平滑预测未来趋势并显示置信区间。', en: 'Upload a time series CSV and forecast future trends with exponential smoothing and confidence bands.' },
    howItWorks: { zh: '上传时间序列 CSV，指数平滑预测未来趋势并显示置信区间。', en: 'Upload time-series CSV; exponential smoothing forecasts trends with confidence bands.' },
    icon: 'i-lucide-chart-line',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    pythonModule: 'ml/forecast',
    tags: ['Time Series', 'Holt-Winters', 'statsmodels']
  },
  {
    slug: 'anomaly',
    classroomSafe: true,
    category: 'ml',
    title: { zh: '异常检测', en: 'Anomaly Detection' },
    description: { zh: '用 IsolationForest 在二维数据中自动找出异常点。', en: 'Automatically find outliers in 2D data with Isolation Forest.' },
    howItWorks: { zh: '上传数据，孤立森林等算法识别异常点并高亮。', en: 'Algorithms like isolation forest flag and highlight anomalies in your data.' },
    icon: 'i-lucide-radar',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    pythonModule: 'ml/anomaly',
    tags: ['IsolationForest', 'Outlier', 'scikit-learn']
  },
  {
    slug: 'palette',
    category: 'ml',
    title: { zh: '图像主色调', en: 'Image Palette' },
    description: { zh: '用 K-Means 聚类提取图片的主色调配色板（无监督学习的趣味应用）。', en: 'Extract a color palette from any image with K-Means clustering (a fun unsupervised learning app).' },
    howItWorks: { zh: '上传图片，自动提取主色生成调色板，可复制色值。', en: 'Extract dominant colors from an image into a copyable palette.' },
    icon: 'i-lucide-palette',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'ml/palette',
    tags: ['K-Means', 'Color', 'Unsupervised']
  },
  {
    slug: 'dim-reduction',
    category: 'ml',
    title: { zh: '降维可视化', en: 'Dim Reduction' },
    description: { zh: '用 PCA / t-SNE 把高维数据降到二维并聚类着色。', en: 'Project high-dimensional data to 2D with PCA / t-SNE and color by cluster.' },
    howItWorks: { zh: '上传高维数据，PCA/t-SNE 降到二维并聚类着色。', en: 'Project high-dimensional data to 2D with PCA/t-SNE and color by cluster.' },
    icon: 'i-lucide-scatter-chart',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    pythonModule: 'ml/dim-reduction',
    tags: ['PCA', 't-SNE', 'scikit-learn']
  },
  {
    slug: 'svd',
    category: 'ml',
    title: { zh: '推荐系统 (SVD)', en: 'Recommender (SVD)' },
    description: { zh: '在 MovieLens 数据集上用矩阵分解做协同过滤推荐。', en: 'Collaborative filtering with matrix factorization on MovieLens.' },
    howItWorks: { zh: '用 SVD 分解图像/矩阵，可按奇异值数量压缩重建，观察信息损失。', en: 'Decompose an image/matrix with SVD and rebuild it from a few singular values to see loss.' },
    icon: 'i-lucide-star',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'ml/svd',
    tags: ['SVD', 'Recommendation', 'MovieLens']
  },
  {
    slug: 'decision-tree',
    classroomSafe: true,
    category: 'ml',
    title: { zh: '决策树', en: 'Decision Tree' },
    description: { zh: '交互式构建 CART 决策树，观察特征分裂与决策边界。', en: 'Build a CART decision tree interactively and watch feature splits and the decision boundary.' },
    howItWorks: { zh: '在数据集上训练决策树，可视化树结构与划分边界。', en: 'Train a decision tree and visualize the tree structure and splits.' },
    icon: 'i-lucide-git-branch',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'ml/decision-tree',
    tags: ['Decision Tree', 'CART', 'Gini']
  },
  {
    slug: 'flappy',
    category: 'ml',
    title: { zh: 'Flappy Bird 神经进化', en: 'Flappy Bird Neuroevolution' },
    description: { zh: '用遗传算法 + 神经网络在浏览器中训练小鸟学会飞行。', en: 'Train birds to fly in the browser with a genetic algorithm and neural networks.' },
    howItWorks: { zh: '用强化学习训练小鸟飞过障碍，实时显示得分曲线。', en: 'Train a bird with reinforcement learning to fly through pipes; watch the score curve.' },
    icon: 'i-lucide-bird',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'ml/flappy',
    tags: ['Neuroevolution', 'Genetic Algorithm', 'Neural Network']
  },
  {
    slug: 'sd-turbo',
    category: 'aigc',
    title: { zh: '文生图/图生图 (SD-Turbo)', en: 'Text/Image-to-Image (SD-Turbo)' },
    description: { zh: '用 SD-Turbo 在本地服务端生成或编辑图片（CPU 友好，1-4 步）。', en: 'Generate or edit images locally with SD-Turbo (CPU-friendly, 1-4 steps).' },
    howItWorks: { zh: '输入文本或参考图，SD-Turbo 在本地服务端 1-4 步快速生成/编辑图像。', en: 'SD-Turbo generates or edits images on the local server in just 1-4 steps.' },
    icon: 'i-lucide-image',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    backendReady: false,
    pythonModule: 'aigc/sd-turbo',
    tags: ['Python', 'Text/Image-to-Image (SD-Turbo)']
  },
  {
    slug: 'photo-restore',
    category: 'aigc',
    title: { zh: '老照片修复', en: 'Photo Restoration' },
    description: { zh: '用 Real-ESRGAN + CodeFormer 修复模糊老照片与人脸细节。', en: 'Restore blurry old photos and face details with Real-ESRGAN + CodeFormer.' },
    howItWorks: { zh: '上传旧照片，修复模型去划痕/降噪/上色/放大，输出高清修复图。', en: 'Upload an old photo; the restoration model removes scratches, denoises, upscales and restores it.' },
    icon: 'i-lucide-images',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    backendReady: false,
    pythonModule: 'aigc/photo-restore',
    tags: ['Python', 'Photo Restoration']
  },
  {
    slug: 'bg-removal',
    classroomSafe: true,
    category: 'vision',
    title: { zh: '智能抠图（背景移除）', en: 'Background Removal' },
    description: { zh: '用 MODNet 在浏览器中一键抠出人像/主体，导出透明背景 PNG（数据不出浏览器）。', en: 'Cut out people/subjects in-browser with MODNet and export transparent PNGs (all local).' },
    howItWorks: { zh: '输入人像照，分割模型抠出主体并输出透明背景 PNG，可换背景。', en: 'A segmentation model cuts the subject out of a portrait and exports a transparent PNG.' },
    icon: 'i-lucide-scissors',
    status: 'ready',
    runtime: 'browser',
    featured: true,
    tags: ['MODNet', 'Transformers.js', 'WebGPU']
  },
  {
    slug: 'reasoning-chat',
    category: 'aigc',
    title: { zh: '推理对话（DeepSeek-R1 蒸馏）', en: 'Reasoning Chat (DeepSeek-R1 Distill)' },
    description: { zh: '在浏览器运行推理 LLM：先展示思考过程，再给出答案（DeepSeek-R1 / MiniThinky）。', en: 'Run a reasoning LLM in-browser: watch it think step-by-step, then answer (DeepSeek-R1 / MiniThinky).' },
    howItWorks: { zh: '输入问题，推理模型分步思考后给出带依据的回答。', en: 'A reasoning model thinks step by step before answering, with rationale.' },
    icon: 'i-lucide-brain',
    status: 'ready',
    tags: ['DeepSeek-R1', 'Transformers.js', 'WebGPU']
  },
  {
    slug: 'codegen',
    category: 'aigc',
    title: { zh: '代码生成与执行', en: 'Code Generation & Execution' },
    description: { zh: '用 Qwen2.5-Coder 在浏览器补全代码，并用 Pyodide 直接在浏览器运行 Python。', en: 'Complete code in-browser with Qwen2.5-Coder, then run Python right away via Pyodide.' },
    howItWorks: { zh: '输入需求描述，代码生成模型输出代码，浏览器本地运行。', en: 'Describe what you need and a code model generates it locally in your browser.' },
    icon: 'i-lucide-code-xml',
    status: 'ready',
    runtime: 'browser',
    tags: ['Qwen2.5-Coder', 'Pyodide', 'Transformers.js']
  },
  {
    slug: 'multimodal-chat',
    category: 'aigc',
    title: { zh: '多模态对话（SmolVLM）', en: 'Multimodal Chat (SmolVLM)' },
    description: { zh: '上传图片与 SmolVLM-256M 多轮对话：识别图表、手写、场景与物体。', en: 'Upload images and chat multi-turn with SmolVLM-256M: charts, handwriting, scenes and objects.' },
    howItWorks: { zh: '图文对话：可上传图片并提问，多模态模型结合图像与文字作答。', en: 'Image-and-text chat: upload a picture and ask questions; a multimodal model answers with both.' },
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
    runtime: 'browser',
    tags: ['TripoSR', 'Python', '3D']
  },
  {
    slug: 'talking-photo',
    category: 'aigc',
    title: { zh: '照片说话（SadTalker）', en: 'Talking Photo (SadTalker)' },
    description: { zh: '让静态照片跟随音频开口说话（Python 后端，非商用许可）。', en: 'Make a still photo talk along with audio (Python backend, non-commercial license).' },
    icon: 'i-lucide-user-round',
    status: 'planned',
    runtime: 'browser',
    tags: ['SadTalker', 'Python', 'Video']
  },
  {
    slug: 'video-gen',
    category: 'aigc',
    title: { zh: '文生视频（Wan2.1）', en: 'Text-to-Video (Wan2.1)' },
    description: { zh: '文字描述生成短视频（需 GPU，当前机器受限）。', en: 'Generate short videos from text (requires GPU, limited on this machine).' },
    icon: 'i-lucide-video',
    status: 'planned',
    runtime: 'browser',
    tags: ['Wan2.1', 'Python', 'Video']
  },
  // ===== vision 图像处理 Playground（viewer/transform/... 共 15 页）=====
  {
    slug: 'viewer',
    category: 'vision',
    title: { zh: '图像查看器', en: 'Image Viewer' },
    description: { zh: '图片信息、像素取色与格式转换下载。', en: 'Image info, pixel color picking, format conversion and download.' },
    howItWorks: { zh: '图像查看器：查看图像信息（尺寸/直方图/像素值）。', en: 'View image info such as size, histogram and pixel values.' },
    icon: 'i-lucide-image',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/viewer',
    tags: ['Canvas', 'Info', 'Picker']
  },
  {
    slug: 'transform',
    category: 'vision',
    title: { zh: '图像变换', en: 'Image Transform' },
    description: { zh: '缩放、裁剪、旋转、翻转、缩放比例、边距、透视与仿射变换。', en: 'Resize, crop, rotate, flip, scale, padding, perspective and affine transform.' },
    howItWorks: { zh: '几何变换工坊：缩放/旋转/翻转/裁剪/透视校正，拖动滑块即时预览。', en: 'Geometric transform studio: resize, rotate, flip, crop and perspective with instant sliders.' },
    icon: 'i-lucide-move-3d',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/transform',
    tags: ['Canvas', 'Geometry']
  },
  {
    slug: 'pixel',
    category: 'vision',
    title: { zh: '像素处理', en: 'Pixel Processing' },
    description: { zh: '读取像素、像素网格放大与像素级数学运算。', en: 'Read pixels, magnify the pixel grid and run pixel-level math.' },
    howItWorks: { zh: '像素级工坊：通道提取、阈值、颜色量化、像素化等逐像素处理。', en: 'Pixel-level studio: channel ops, thresholding, color quantization, pixelation and more.' },
    icon: 'i-lucide-grid-3x3',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/pixel',
    tags: ['Canvas', 'ImageData']
  },
  {
    slug: 'color',
    category: 'vision',
    title: { zh: '颜色处理', en: 'Color Processing' },
    description: { zh: '灰度化、通道提取与合并、色彩空间、颜色替换与量化。', en: 'Grayscale, channel extraction & merge, color spaces, color replacement and quantization.' },
    howItWorks: { zh: '颜色工坊：颜色空间转换、直方图、颜色替换与匹配。', en: 'Color studio: color-space conversion, histograms, color replace and match.' },
    icon: 'i-lucide-palette',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/color',
    tags: ['Canvas', 'Color']
  },
  {
    slug: 'adjustment',
    category: 'vision',
    title: { zh: '图像调整', en: 'Image Adjustment' },
    description: { zh: '亮度、对比度、伽马、饱和度、色相、曝光、白平衡与自动增强。', en: 'Brightness, contrast, gamma, saturation, hue, exposure, white balance and auto enhancement.' },
    howItWorks: { zh: '调整工坊：亮度/对比度/曝光/伽马/白平衡等全局调整。', en: 'Adjustment studio: brightness, contrast, exposure, gamma and white balance.' },
    icon: 'i-lucide-sliders-horizontal',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/adjust',
    tags: ['Canvas', 'Adjust']
  },
  {
    slug: 'filters',
    category: 'vision',
    title: { zh: '图像滤镜', en: 'Image Filters' },
    description: { zh: '模糊、锐化、浮雕、高通滤波等经典卷积滤镜。', en: 'Blur, sharpen, emboss, high-pass and other classic convolution filters.' },
    howItWorks: { zh: '滤波工坊：模糊/锐化/浮雕/高通等卷积核滤镜。', en: 'Filter studio: blur, sharpen, emboss and high-pass convolution kernels.' },
    icon: 'i-lucide-sparkles',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/filters',
    tags: ['Canvas', 'Filter']
  },
  {
    slug: 'enhancement',
    category: 'vision',
    title: { zh: '噪声与增强', en: 'Noise & Enhancement' },
    description: { zh: '加噪、去噪、直方图均衡与图像增强。', en: 'Add noise, denoise, histogram equalization and enhancement.' },
    howItWorks: { zh: '增强工坊：降噪、直方图均衡与图像增强。', en: 'Enhancement studio: denoise, histogram equalization and enhancement.' },
    icon: 'i-lucide-waves',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/enhancement',
    tags: ['Canvas', 'Denoise']
  },
  {
    slug: 'morphology',
    category: 'vision',
    title: { zh: '阈值与形态学', en: 'Threshold & Morphology' },
    description: { zh: '二值化、自适应阈值、腐蚀膨胀、开闭运算与形态学梯度。', en: 'Binary/adaptive/Otsu threshold, erosion, dilation, opening, closing and morphological gradient.' },
    howItWorks: { zh: '形态学工坊：二值化/自适应/Otsu 阈值与腐蚀、膨胀、开闭、梯度。', en: 'Morphology studio: binary/adaptive/Otsu thresholding plus erode, dilate, open, close, gradient.' },
    icon: 'i-lucide-shapes',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/morphology',
    tags: ['OpenCV.js', 'Threshold']
  },
  {
    slug: 'edge',
    category: 'vision',
    title: { zh: '边缘与形状检测', en: 'Edge & Shape Detection' },
    description: { zh: 'Sobel、Canny、Harris 角点、Hough 直线与圆检测。', en: 'Sobel, Canny, Harris corners, Hough lines and circles.' },
    howItWorks: { zh: '边缘检测工坊：Sobel/Canny/Harris 角点/Hough 直线圆检测。', en: 'Edge & shape studio: Sobel, Canny, Harris corners, Hough lines and circles.' },
    icon: 'i-lucide-scan-line',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/edge',
    tags: ['OpenCV.js', 'Edge']
  },
  {
    slug: 'object',
    category: 'vision',
    title: { zh: '颜色与物体检测', en: 'Color & Object Detection' },
    description: { zh: '颜色分割、轮廓检测、物体计数、包围盒与形状识别。', en: 'Color segmentation, contours, object counting, bounding boxes and shape recognition.' },
    howItWorks: { zh: '颜色与物体检测：颜色分割、轮廓检测、物体计数与形状识别。', en: 'Color & object detection: color segmentation, contours, counting and shape recognition.' },
    icon: 'i-lucide-target',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/object',
    tags: ['OpenCV.js', 'Contour']
  },
  {
    slug: 'features',
    category: 'vision',
    title: { zh: '特征检测', en: 'Feature Detection' },
    description: { zh: 'ORB/BRISK 关键点与特征匹配。', en: 'ORB/BRISK keypoints and feature matching.' },
    howItWorks: { zh: '特征检测：ORB/BRISK 关键点提取与两图特征匹配。', en: 'Feature detection: ORB/BRISK keypoints and two-image matching.' },
    icon: 'i-lucide-crosshair',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/features',
    tags: ['OpenCV.js', 'Feature']
  },
  {
    slug: 'face',
    category: 'vision',
    title: { zh: '人脸视觉', en: 'Face Vision' },
    description: { zh: '人脸检测、关键点、模糊、马赛克与双图验证（MediaPipe + insightface）。', en: 'Face detection, landmarks, blur, pixelation and two-image verification (MediaPipe + insightface).' },
    howItWorks: { zh: '人脸工坊：检测/关键点/模糊/像素化/证件照等工具对图像做处理，参数即时生效。', en: 'Face studio: detection, landmarks, blur, pixelation, ID photo and more with live parameters.' },
    icon: 'i-lucide-scan-face',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/face',
    tags: ['MediaPipe', 'Face']
  },
  {
    slug: 'face-recognition',
    classroomSafe: true,
    category: 'vision',
    title: { zh: '人脸注册与识别', en: 'Face Registration & Recognition' },
    description: { zh: '一人可上传多张照片或使用摄像头注册，之后上传照片/实时摄像头即可识别身份；支持合影选脸（insightface + 浏览器本地注册库）。', en: 'Enroll a person with multiple photos or your camera, then recognize them via photo upload or live camera; supports picking a face in group photos (insightface + local registry).' },
    howItWorks: { zh: '先注册人脸库（照片/摄像头），之后上传或实时摄像头提取特征与库中比对识别身份。', en: 'Enroll faces first, then match new photos or live camera frames against the registry to identify people.' },
    icon: 'i-lucide-user-check',
    status: 'ready',
    runtime: 'server',
    requirements: { needsServer: true },
    pythonModule: 'image/face-recognition',
    tags: ['InsightFace', 'Face']
  },
  {
    slug: 'ocr',
    category: 'vision',
    title: { zh: 'OCR 与文档视觉', en: 'OCR & Document Vision' },
    description: { zh: '文字识别（Tesseract.js）与文档扫描校正（OpenCV.js）。', en: 'Text recognition (Tesseract.js) and document scanning (OpenCV.js).' },
    howItWorks: { zh: '输入图片，OCR 引擎（tesseract.js）识别其中的文字并输出可复制文本。', en: 'OCR (tesseract.js) reads text from an image and outputs copyable text.' },
    icon: 'i-lucide-file-text',
    status: 'ready',
    runtime: 'browser',
    featured: true,
    pythonModule: 'image/ocr',
    tags: ['Tesseract.js', 'OCR']
  },
  {
    slug: 'ai-vision',
    category: 'vision',
    title: { zh: 'AI 目标与图像视觉', en: 'AI Object & Image Vision' },
    description: { zh: '图像分类、目标检测、分割、抠图、嵌入与相似度（MediaPipe）。', en: 'Classification, detection, segmentation, background removal, embedding and similarity (MediaPipe).' },
    howItWorks: { zh: 'AI 视觉 6 合一：图像分类/目标检测/分割/抠图/嵌入/相似度对比。', en: 'AI vision in one: classification, detection, segmentation, matting, embedding and similarity.' },
    icon: 'i-lucide-eye',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/ai-vision',
    tags: ['MediaPipe', 'Transformers.js']
  },
  {
    slug: 'multimodal',
    category: 'vision',
    title: { zh: 'AI 视觉与多模态', en: 'AI Vision & Multimodal' },
    description: { zh: '图像描述与深度估计（Transformers.js），问答/修复/风格迁移见 AIGC。', en: 'Image captioning and depth estimation (Transformers.js); QA/inpainting/style transfer under AIGC.' },
    howItWorks: { zh: '多模态视觉：图像描述、深度估计、图像问答与修复。', en: 'Multimodal vision: captioning, depth estimation, visual QA and inpainting.' },
    icon: 'i-lucide-layers',
    status: 'ready',
    runtime: 'browser',
    pythonModule: 'image/multimodal',
    tags: ['Transformers.js', 'Multimodal']
  },
  {
    slug: 'rebot-arm',
    category: 'robot',
    title: { zh: 'ReBot Arm 机械臂仿真器', en: 'ReBot Arm Simulator' },
    description: {
      zh: 'ROS2 ReBot Arm B601-RS 机械臂仿真器：浏览器本地 Three.js 渲染、关节/夹爪手动控制，可连真实机械臂（需 rosbridge）。',
      en: 'ROS2 ReBot Arm B601-RS simulator: in-browser Three.js rendering with manual joint/gripper control; connect a real arm via rosbridge.'
    },
    howItWorks: {
      zh: '纯前端机械臂仿真：加载 URDF/STL 模型，浏览器本地解算关节运动；连实体机械臂需 rosbridge（ws://机械臂IP:9090）。',
      en: 'Pure front-end arm simulation: loads URDF/STL and solves joint motion in-browser; connecting a real arm requires rosbridge (ws://ARM_IP:9090).'
    },
    icon: 'i-lucide-robot',
    status: 'ready',
    runtime: 'browser',
    tags: ['Robotics', 'ROS2', 'Three.js']
  },
  {
    slug: 'microduck',
    category: 'robot',
    title: { zh: 'MicroDuck 微鸭仿真器', en: 'MicroDuck Simulator' },
    description: {
      zh: 'Hugging Face / Pollen Robotics 开源双足机器鸭的浏览器仿真：MuJoCo 物理 + 真实 RL 策略（ONNX）全本地运行，可走/坐/翻滚/踢球，双腿与轮滑两种形态。',
      en: 'In-browser simulation of the Hugging Face / Pollen Robotics open-source bipedal duck: MuJoCo physics + real RL policies (ONNX) run fully locally; walk/sit/roll/kick, legs & rollers variants.'
    },
    howItWorks: {
      zh: 'MuJoCo 编译为 WebAssembly 跑物理，onnxruntime-web 以 50Hz 运行导出自 microduck_rl 的真实强化学习策略；全部离线本地化，无后端。',
      en: 'MuJoCo compiled to WebAssembly steps the physics while onnxruntime-web runs the real RL policies exported from microduck_rl at 50 Hz; fully offline and local, no backend.'
    },
    icon: 'i-lucide-bird',
    status: 'ready',
    runtime: 'browser',
    tags: ['Robotics', 'MuJoCo', 'ONNX', 'RL', 'Three.js']
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
