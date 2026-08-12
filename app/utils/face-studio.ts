import type { FaceAnalysis } from './face-registry'

/** 一张待处理的人脸照片（注册/识别共用） */
export interface PickedPhoto {
  id: string
  fileName: string
  /** 预览图 blob URL（processImageFile 产物，移除照片时需要 revoke） */
  src: string
  imageData: ImageData
  status: 'analyzing' | 'ok' | 'no-face' | 'error'
  /** 分析中的后端状态文案（如模型加载进度） */
  statusText?: string
  error?: string
  analysis: FaceAnalysis | null
  selectedFace: number
}
