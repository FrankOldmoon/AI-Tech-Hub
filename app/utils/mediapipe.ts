// MediaPipe Tasks JS 共用配置：wasm 文件集路径与模型资源路径
// wasm 和模型均从本地 public/model/ 加载

/** @mediapipe/tasks-* wasm 文件集本地路径 */
export const mediapipeWasm = {
  vision: '/model/mediapipe/wasm/vision',
  text: '/model/mediapipe/wasm/text',
  audio: '/model/mediapipe/wasm/audio'
}

/** 各 MediaPipe 任务的默认模型资源路径（本地） */
export const mediapipeModels = {
  faceDetector: '/model/mediapipe/models/blaze_face_short_range.tflite',
  faceLandmarker: '/model/mediapipe/models/face_landmarker.task',
  gestureRecognizer: '/model/mediapipe/models/gesture_recognizer.task',
  handLandmarker: '/model/mediapipe/models/hand_landmarker.task',
  holisticLandmarker: '/model/mediapipe/models/holistic_landmarker.task',
  imageClassifier: '/model/mediapipe/models/efficientnet_lite0.tflite',
  imageEmbedder: '/model/mediapipe/models/mobilenet_v3_small.tflite',
  selfieSegmenter: '/model/mediapipe/models/selfie_segmenter.tflite',
  hairSegmenter: '/model/mediapipe/models/hair_segmenter.tflite',
  magicTouch: '/model/mediapipe/models/interactive_segmentation.task',
  objectDetector: '/model/mediapipe/models/efficientdet_lite0.tflite',
  poseLandmarker: '/model/mediapipe/models/pose_landmarker_lite.task',
  audioClassifier: '/model/mediapipe/models/yamnet.tflite',
  languageDetector: '/model/mediapipe/models/language_detector.tflite',
  textClassifier: '/model/mediapipe/models/bert_classifier.tflite',
  textEmbedder: '/model/mediapipe/models/universal_sentence_encoder.tflite'
}
