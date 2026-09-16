/**
 * 模型远程来源清单 —— 单一事实来源（server 侧）。
 *
 * 两处共用，避免「下载地址」与「回退地址」两套字面量漂移：
 * 1. server/utils/model-downloader.ts —— 部署/启动时预下载到 .models/
 * 2. server/routes/model/[...].ts   —— 本地文件缺失时 302 回退到远程
 *    （解决「自托管但模型不全」直接 404 的问题；被墙环境下也可换镜像改这里一处）
 *
 * 未纳入本表的目录及原因见 remoteUrlFor() 末尾注释。
 */

export const MEDIAPIPE_BASE = 'https://storage.googleapis.com/mediapipe-models'

/** MediaPipe 模型：远程相对路径 → .models/ 下的本地相对路径 */
export const MEDIAPIPE_MODELS: Record<string, string> = {
  'face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite': 'mediapipe/models/blaze_face_short_range.tflite',
  'face_landmarker/face_landmarker/float16/1/face_landmarker.task': 'mediapipe/models/face_landmarker.task',
  'gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task': 'mediapipe/models/gesture_recognizer.task',
  'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task': 'mediapipe/models/hand_landmarker.task',
  'holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task': 'mediapipe/models/holistic_landmarker.task',
  'image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite': 'mediapipe/models/efficientnet_lite0.tflite',
  'image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite': 'mediapipe/models/mobilenet_v3_small.tflite',
  'image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite': 'mediapipe/models/selfie_segmenter.tflite',
  'image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite': 'mediapipe/models/hair_segmenter.tflite',
  'interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task': 'mediapipe/models/interactive_segmentation.task',
  'object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite': 'mediapipe/models/efficientdet_lite0.tflite',
  'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task': 'mediapipe/models/pose_landmarker_lite.task',
  'audio_classifier/yamnet/float32/1/yamnet.tflite': 'mediapipe/models/yamnet.tflite',
  'language_detector/language_detector/float32/1/language_detector.tflite': 'mediapipe/models/language_detector.tflite',
  'text_classifier/bert_classifier/float32/1/bert_classifier.tflite': 'mediapipe/models/bert_classifier.tflite',
  'text_embedder/universal_sentence_encoder/float32/1/universal_sentence_encoder.tflite': 'mediapipe/models/universal_sentence_encoder.tflite'
}

/** MediaPipe WASM 包（本地目录名 → npm 包与版本） */
export const MEDIAPIPE_WASM: Record<string, { pkg: string, version: string }> = {
  vision: { pkg: '@mediapipe/tasks-vision', version: '1.0.1' },
  text: { pkg: '@mediapipe/tasks-text', version: '1.0.1' },
  audio: { pkg: '@mediapipe/tasks-audio', version: '1.0.1' }
}

/** TF.js MobileNet v2 1.0（tfhub.dev 的 TF.js 模型端点） */
export const TFJS_MOBILENET_BASE = 'https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/classification/2/default/1'

/** TF.js Speech Commands v0.5 browser_fft 18w */
export const TFJS_SPEECH_BASE = 'https://storage.googleapis.com/tfjs-models/tfjs/speech-commands/v0.5/browser_fft/18w'

/** face-api 模型（jsdelivr 优先，GitHub raw 兜底） */
export const FACEAPI_BASES = [
  'https://cdn.jsdelivr.net/gh/vladmandic/face-api@master/model',
  'https://raw.githubusercontent.com/vladmandic/face-api/master/model'
]

/** 简笔画 DoodleNet（ml5 硬编码此地址；345 个标签烘焙在 ml5 包内，故只本地化权重） */
export const DOODLE_BASE = 'https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models@master/models/doodlenet'

/** 本地相对路径 → 远程 URL；无远程对应返回 null */
export function remoteUrlFor(localRel: string): string | null {
  const rel = localRel.replace(/^\/+/, '')

  for (const [remotePath, local] of Object.entries(MEDIAPIPE_MODELS)) {
    if (rel === local) return `${MEDIAPIPE_BASE}/${remotePath}`
  }

  const wasm = /^mediapipe\/wasm\/([^/]+)\/(.+)$/.exec(rel)
  if (wasm) {
    const entry = MEDIAPIPE_WASM[wasm[1]!]
    if (entry) return `https://cdn.jsdelivr.net/npm/${entry.pkg}@${entry.version}/wasm/${wasm[2]}`
  }

  if (rel.startsWith('tfjs/mobilenet/')) {
    return `${TFJS_MOBILENET_BASE}/${rel.slice('tfjs/mobilenet/'.length)}?tfjs-format=file`
  }
  if (rel.startsWith('tfjs/speech-commands/')) {
    return `${TFJS_SPEECH_BASE}/${rel.slice('tfjs/speech-commands/'.length)}`
  }
  if (rel.startsWith('faceapi/')) {
    return `${FACEAPI_BASES[0]}/${rel.slice('faceapi/'.length)}`
  }
  if (rel.startsWith('doodle/')) {
    return `${DOODLE_BASE}/${rel.slice('doodle/'.length)}`
  }

  // 无远程回退的目录：
  // - yolo/         随仓库分发（.gitignore 有 yolo 入库例外），无远程同构地址
  // - transformers/  transformers.js 自带 allowRemoteModels 回退，且经 /api/hf 自家代理
  // - webllm/       由 web-llm 自身按 CDN 回退
  // - vendor/       来自 npm（scripts/sync-runtime-libs.mjs），无远程对应
  return null
}
