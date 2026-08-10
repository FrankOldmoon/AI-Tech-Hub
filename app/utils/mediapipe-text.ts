// MediaPipe 文本任务配置：text-classifier / language-detector（单输入同步任务）
// 本文件只在客户端被动态 import（nlp/[slug].vue 的 onMounted），SSR 不会加载
import { TextClassifier, LanguageDetector } from '@mediapipe/tasks-text'
import { mediapipeModels } from './mediapipe'

export interface TextTaskConfig {
  /** 创建任务实例 */
  create: (text: any) => Promise<any>
  /** 同步推理方法名 */
  method: 'classify' | 'detect'
}

export const textTasks: Record<string, TextTaskConfig> = {
  'text-classifier': {
    create: text => TextClassifier.createFromOptions(text, {
      baseOptions: { modelAssetPath: mediapipeModels.textClassifier }
    }),
    method: 'classify'
  },
  'language-detector': {
    create: text => LanguageDetector.createFromOptions(text, {
      baseOptions: { modelAssetPath: mediapipeModels.languageDetector }
    }),
    method: 'detect'
  }
}
