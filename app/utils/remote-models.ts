/**
 * 远程模型资源配置
 *
 * 本地开发（localhost）使用 public/model/ 本地文件；
 * 云端部署（Vercel 等，无静态模型文件）自动切换到远程 URL：
 * - MediaPipe WASM -> jsdelivr CDN（与 npm 包同源）
 * - MediaPipe 模型 -> Google 官方模型存储（带 CORS）
 * - TF.js 模型     -> Google 官方存储 / tfhub.dev
 * - transformers.js -> 仍走 /api/hf 本地代理（Vercel 上转发 huggingface.co）
 */

/** 自托管部署配置（由 app/plugins/deploy-config.ts 在客户端初始化） */
interface DeployConfig {
  selfHosted: boolean
  enablePython: boolean
}

let deployConfig: DeployConfig = { selfHosted: false, enablePython: false }

/** 应用启动时注入部署配置（读自 runtimeConfig.public） */
export function initDeployConfig(cfg: DeployConfig): void {
  deployConfig = cfg
}

export function isRemoteDeploy(): boolean {
  if (import.meta.server) return false
  // 自托管部署（学校/内网服务器等）：runtimeConfig 注入 selfHosted=true 时
  // 视为本地完整部署（浏览器端走本地模型文件，transformers.js 走 /api/hf 代理）
  if (deployConfig.selfHosted) return false
  const host = window.location.hostname
  return host !== 'localhost' && host !== '127.0.0.1'
}

/**
 * 本地 Python 后端是否启用。
 * 仅自托管部署（NUXT_PUBLIC_SELF_HOSTED=true）且构建时 NUXT_PUBLIC_ENABLE_PYTHON=true
 * 时返回 true；云端（Vercel）始终为 false（没有本地 Python 后端）。
 */
export function pythonBackendEnabled(): boolean {
  if (import.meta.server) return false
  return deployConfig.enablePython && !isRemoteDeploy()
}

export const REMOTE_MEDIAPIPE_WASM = {
  vision: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
  text: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@1.0.1/wasm',
  audio: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.0.1/wasm',
}

export const REMOTE_MEDIAPIPE_MODELS = {
  faceDetector: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
  faceLandmarker: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  gestureRecognizer: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
  handLandmarker: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  holisticLandmarker: 'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task',
  imageClassifier: 'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite',
  imageEmbedder: 'https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite',
  selfieSegmenter: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  hairSegmenter: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite',
  magicTouch: 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task',
  objectDetector: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite',
  poseLandmarker: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  audioClassifier: 'https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite',
  languageDetector: 'https://storage.googleapis.com/mediapipe-models/language_detector/language_detector/float32/1/language_detector.tflite',
  textClassifier: 'https://storage.googleapis.com/mediapipe-models/text_classifier/bert_classifier/float32/1/bert_classifier.tflite',
  textEmbedder: 'https://storage.googleapis.com/mediapipe-models/text_embedder/universal_sentence_encoder/float32/1/universal_sentence_encoder.tflite',
}

export const REMOTE_TFJS = {
  // MobileNet v2 1.0（tfhub.dev TF.js 端点，带 CORS）
  mobilenet: 'https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/classification/2/default/1/model.json?tfjs-format=file',
  // Speech Commands 18w
  speechCommandsBase: 'https://storage.googleapis.com/tfjs-models/tfjs/speech-commands/v0.5/browser_fft/18w',
}
