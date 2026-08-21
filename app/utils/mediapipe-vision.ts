// MediaPipe 视觉任务配置：8 个标准 demo 的 create / method / draw / params
// 本文件只在客户端被动态 import（vision/[slug].vue 的 onMounted），SSR 不会加载
import {
  DrawingUtils,
  FaceDetector,
  FaceLandmarker,
  HandLandmarker,
  GestureRecognizer,
  PoseLandmarker,
  HolisticLandmarker,
  ObjectDetector,
  ImageClassifier
} from '@mediapipe/tasks-vision'
import type { ParamSpec } from './params'
import { mediapipeModels } from './mediapipe'

export interface VisionTaskConfig {
  /** 创建检测器/标记器 */
  create: (vision: any) => Promise<any>
  /** 视频/图片推理方法名（统一 VIDEO runningMode，图片也用 ForVideo 方法） */
  method: 'detectForVideo' | 'classifyForVideo' | 'recognizeForVideo'
  /** 绘制结果到 canvas（可选，分类任务无） */
  draw?: (ctx: CanvasRenderingContext2D, result: any) => void
  /** 可调参数（label 通过 i18n t 函数本地化）；param key 与 setOptions 选项键一一对应 */
  params?: (t: (key: string) => string) => ParamSpec[]
  /** 该 demo 专属示例图（label 通过 i18n t 函数本地化）；未配置时用通用示例列表 */
  samples?: (t: (key: string) => string) => Array<{ label: string, url: string }>
}

const GPU = 'GPU'

function drawing(ctx: CanvasRenderingContext2D) {
  return new DrawingUtils(ctx)
}

export const visionTasks: Record<string, VisionTaskConfig> = {
  'face-detection': {
    create: vision => FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: mediapipeModels.faceDetector, delegate: GPU },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5
    }),
    method: 'detectForVideo',
    draw: (ctx, result) => {
      const d = drawing(ctx)
      for (const det of result.detections) {
        d.drawBoundingBox(det.boundingBox, { color: '#00DC82', lineWidth: 4, fillColor: 'transparent' })
      }
    },
    params: t => [
      { key: 'minDetectionConfidence', label: t('params.minDetectionConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'minSuppressionThreshold', label: t('params.minSuppressionThreshold'), type: 'slider', default: 0.3, min: 0, max: 1, step: 0.05 }
    ],
    samples: t => [
      { label: t('samples.face'), url: '/samples/images/face.jpg' },
      { label: t('samples.group'), url: '/samples/images/group.jpg' }
    ]
  },

  'face-landmarker': {
    create: vision => FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: mediapipeModels.faceLandmarker, delegate: GPU },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true
    }),
    method: 'detectForVideo',
    draw: (ctx, result) => {
      const d = drawing(ctx)
      for (const lm of result.faceLandmarks) {
        d.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: '#C0C0C070', lineWidth: 1 })
        d.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: '#FF3030' })
        d.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, { color: '#FF3030' })
        d.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, { color: '#FF3030' })
        d.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: '#30FF30' })
        d.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, { color: '#30FF30' })
        d.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, { color: '#30FF30' })
        d.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: '#E0E0E0' })
        d.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_LIPS, { color: '#E0E0E0' })
      }
    },
    params: t => [
      { key: 'numFaces', label: t('params.numFaces'), type: 'slider', default: 1, min: 1, max: 4, step: 1 },
      { key: 'minDetectionConfidence', label: t('params.minDetectionConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'minPresenceConfidence', label: t('params.minPresenceConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'minTrackingConfidence', label: t('params.minTrackingConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'outputFaceBlendshapes', label: t('params.outputFaceBlendshapes'), type: 'switch', default: true }
    ],
    samples: t => [
      { label: t('samples.face'), url: '/samples/images/face.jpg' },
      { label: t('samples.group'), url: '/samples/images/group.jpg' }
    ]
  },

  'hand-landmarker': {
    create: vision => HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: mediapipeModels.handLandmarker, delegate: GPU },
      runningMode: 'VIDEO',
      numHands: 2
    }),
    method: 'detectForVideo',
    draw: (ctx, result) => {
      const d = drawing(ctx)
      for (const lm of result.landmarks) {
        d.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 })
        d.drawLandmarks(lm, { color: '#FF0000', lineWidth: 2 })
      }
    },
    params: t => [
      { key: 'numHands', label: t('params.numHands'), type: 'slider', default: 2, min: 1, max: 4, step: 1 },
      { key: 'minDetectionConfidence', label: t('params.minDetectionConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'minHandPresenceConfidence', label: t('params.minHandPresenceConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'minTrackingConfidence', label: t('params.minTrackingConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 }
    ],
    samples: t => [
      { label: t('samples.hand'), url: '/samples/images/hand.jpg' }
    ]
  },

  'gesture-recognizer': {
    create: vision => GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: mediapipeModels.gestureRecognizer, delegate: GPU },
      runningMode: 'VIDEO',
      numHands: 2
    }),
    method: 'recognizeForVideo',
    draw: (ctx, result) => {
      const d = drawing(ctx)
      for (const lm of result.landmarks) {
        d.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 })
        d.drawLandmarks(lm, { color: '#FF0000', lineWidth: 2 })
      }
    },
    params: t => [
      { key: 'numHands', label: t('params.numHands'), type: 'slider', default: 2, min: 1, max: 4, step: 1 },
      { key: 'minHandDetectionConfidence', label: t('params.minHandDetectionConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'minHandPresenceConfidence', label: t('params.minHandPresenceConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'minTrackingConfidence', label: t('params.minTrackingConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 }
    ],
    samples: t => [
      { label: t('samples.hand'), url: '/samples/images/hand.jpg' }
    ]
  },

  'pose-landmarker': {
    create: vision => PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: mediapipeModels.poseLandmarker, delegate: GPU },
      runningMode: 'VIDEO',
      numPoses: 1
    }),
    method: 'detectForVideo',
    draw: (ctx, result) => {
      const d = drawing(ctx)
      for (const lm of result.landmarks) {
        d.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: '#00DC82' })
        d.drawLandmarks(lm, { color: '#FF0000', radius: 2 })
      }
    },
    params: t => [
      { key: 'numPoses', label: t('params.numPoses'), type: 'slider', default: 1, min: 1, max: 10, step: 1 },
      { key: 'minDetectionConfidence', label: t('params.minDetectionConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'minPosePresenceConfidence', label: t('params.minPosePresenceConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'minTrackingConfidence', label: t('params.minTrackingConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 }
    ],
    samples: t => [
      { label: t('samples.group'), url: '/samples/images/group.jpg' }
    ]
  },

  'holistic-landmarker': {
    create: vision => HolisticLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: mediapipeModels.holisticLandmarker, delegate: GPU },
      runningMode: 'VIDEO'
    }),
    method: 'detectForVideo',
    draw: (ctx, result) => {
      const d = drawing(ctx)
      if (result.faceLandmarks) {
        d.drawConnectors(result.faceLandmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: '#C0C0C070', lineWidth: 1 })
        d.drawConnectors(result.faceLandmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: '#E0E0E0' })
        d.drawConnectors(result.faceLandmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, { color: '#E0E0E0' })
      }
      if (result.poseLandmarks) {
        d.drawConnectors(result.poseLandmarks, PoseLandmarker.POSE_CONNECTIONS, { color: '#FFFFFF' })
        d.drawLandmarks(result.poseLandmarks, { color: '#FF0000', radius: 2 })
      }
      if (result.leftHandLandmarks) {
        d.drawConnectors(result.leftHandLandmarks, HandLandmarker.HAND_CONNECTIONS, { color: '#CC0000' })
        d.drawLandmarks(result.leftHandLandmarks, { color: '#00FF00', radius: 2 })
      }
      if (result.rightHandLandmarks) {
        d.drawConnectors(result.rightHandLandmarks, HandLandmarker.HAND_CONNECTIONS, { color: '#00CC00' })
        d.drawLandmarks(result.rightHandLandmarks, { color: '#FF0000', radius: 2 })
      }
    },
    params: t => [
      { key: 'minDetectionConfidence', label: t('params.minDetectionConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'minTrackingConfidence', label: t('params.minTrackingConfidence'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 }
    ],
    samples: t => [
      { label: t('samples.group'), url: '/samples/images/group.jpg' }
    ]
  },

  'object-detector': {
    create: vision => ObjectDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: mediapipeModels.objectDetector, delegate: GPU },
      runningMode: 'VIDEO',
      maxResults: 5,
      scoreThreshold: 0.5
    }),
    method: 'detectForVideo',
    draw: (ctx, result) => {
      const d = drawing(ctx)
      for (const det of result.detections) {
        d.drawBoundingBox(det.boundingBox, { color: '#00DC82', lineWidth: 4, fillColor: 'transparent' })
      }
    },
    params: t => [
      { key: 'maxResults', label: t('params.maxResults'), type: 'slider', default: 5, min: 1, max: 20, step: 1 },
      { key: 'scoreThreshold', label: t('params.scoreThreshold'), type: 'slider', default: 0.5, min: 0, max: 1, step: 0.05 }
    ],
    samples: t => [
      { label: t('samples.street'), url: '/samples/images/street.jpg' },
      { label: t('samples.landscape'), url: '/samples/images/landscape.jpg' }
    ]
  },

  'image-classifier': {
    create: vision => ImageClassifier.createFromOptions(vision, {
      baseOptions: { modelAssetPath: mediapipeModels.imageClassifier, delegate: GPU },
      runningMode: 'VIDEO',
      maxResults: 5
    }),
    method: 'classifyForVideo'
    // 无 canvas 绘制，分类结果通过 result slot 显示
    , params: t => [
      { key: 'maxResults', label: t('params.maxResults'), type: 'slider', default: 5, min: 1, max: 20, step: 1 },
      { key: 'scoreThreshold', label: t('params.scoreThreshold'), type: 'slider', default: 0, min: 0, max: 1, step: 0.05 }
    ],
    samples: t => [
      { label: t('samples.landscape'), url: '/samples/images/landscape.jpg' },
      { label: t('samples.street'), url: '/samples/images/street.jpg' }
    ]
  }
}
