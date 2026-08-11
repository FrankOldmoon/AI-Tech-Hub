// MediaPipe Tasks JS 共用配置：wasm 文件集路径与模型资源路径
// wasm 和模型均从本地 public/model/ 加载
import { isRemoteDeploy, REMOTE_MEDIAPIPE_WASM, REMOTE_MEDIAPIPE_MODELS } from './remote-models'

/** @mediapipe/tasks-* wasm 文件集本地路径 */
export const mediapipeWasm = {
  get vision() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_WASM.vision : '/model/mediapipe/wasm/vision' },
  get text() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_WASM.text : '/model/mediapipe/wasm/text' },
  get audio() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_WASM.audio : '/model/mediapipe/wasm/audio' },
}

/** 各 MediaPipe 任务的默认模型资源路径（本地） */
export const mediapipeModels = {
  get faceDetector() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.faceDetector : '/model/mediapipe/models/blaze_face_short_range.tflite' },
  get faceLandmarker() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.faceLandmarker : '/model/mediapipe/models/face_landmarker.task' },
  get gestureRecognizer() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.gestureRecognizer : '/model/mediapipe/models/gesture_recognizer.task' },
  get handLandmarker() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.handLandmarker : '/model/mediapipe/models/hand_landmarker.task' },
  get holisticLandmarker() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.holisticLandmarker : '/model/mediapipe/models/holistic_landmarker.task' },
  get imageClassifier() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.imageClassifier : '/model/mediapipe/models/efficientnet_lite0.tflite' },
  get imageEmbedder() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.imageEmbedder : '/model/mediapipe/models/mobilenet_v3_small.tflite' },
  get selfieSegmenter() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.selfieSegmenter : '/model/mediapipe/models/selfie_segmenter.tflite' },
  get hairSegmenter() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.hairSegmenter : '/model/mediapipe/models/hair_segmenter.tflite' },
  get magicTouch() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.magicTouch : '/model/mediapipe/models/interactive_segmentation.task' },
  get objectDetector() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.objectDetector : '/model/mediapipe/models/efficientdet_lite0.tflite' },
  get poseLandmarker() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.poseLandmarker : '/model/mediapipe/models/pose_landmarker_lite.task' },
  get audioClassifier() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.audioClassifier : '/model/mediapipe/models/yamnet.tflite' },
  get languageDetector() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.languageDetector : '/model/mediapipe/models/language_detector.tflite' },
  get textClassifier() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.textClassifier : '/model/mediapipe/models/bert_classifier.tflite' },
  get textEmbedder() { return isRemoteDeploy() ? REMOTE_MEDIAPIPE_MODELS.textEmbedder : '/model/mediapipe/models/universal_sentence_encoder.tflite' },
}
