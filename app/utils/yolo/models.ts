// YOLO26 nano 模型配置（7 个任务，模型文件位于 .models/yolo/，经 /model/yolo/ API 路由 Range 服务）
export type YoloTask = 'detect' | 'seg' | 'sem' | 'depth' | 'cls' | 'pose' | 'obb'

export interface YoloModel {
  id: YoloTask
  nameZh: string
  nameEn: string
  file: string
  imgsz: number
  icon: string
  // 分类/语义/深度不使用置信度阈值
  needConf: boolean
}

export const MODELS: YoloModel[] = [
  { id: 'detect', nameZh: '目标检测', nameEn: 'Detection', file: '/model/yolo/yolo26n.onnx', imgsz: 640, icon: 'i-lucide-box-select', needConf: true },
  { id: 'seg', nameZh: '实例分割', nameEn: 'Segmentation', file: '/model/yolo/yolo26n-seg.onnx', imgsz: 640, icon: 'i-lucide-scissors', needConf: true },
  { id: 'sem', nameZh: '语义分割', nameEn: 'Semantic', file: '/model/yolo/yolo26n-sem.onnx', imgsz: 1024, icon: 'i-lucide-layers', needConf: false },
  { id: 'depth', nameZh: '深度估计', nameEn: 'Depth', file: '/model/yolo/yolo26n-depth.onnx', imgsz: 768, icon: 'i-lucide-mountain', needConf: false },
  { id: 'cls', nameZh: '图像分类', nameEn: 'Classification', file: '/model/yolo/yolo26n-cls.onnx', imgsz: 224, icon: 'i-lucide-tags', needConf: false },
  { id: 'pose', nameZh: '姿态估计', nameEn: 'Pose', file: '/model/yolo/yolo26n-pose.onnx', imgsz: 640, icon: 'i-lucide-person-standing', needConf: true },
  { id: 'obb', nameZh: '有向检测', nameEn: 'Oriented Box', file: '/model/yolo/yolo26n-obb.onnx', imgsz: 1024, icon: 'i-lucide-rotate-3d', needConf: true }
]
