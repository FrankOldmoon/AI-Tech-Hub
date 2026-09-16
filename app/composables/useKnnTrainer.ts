/**
 * KNN 迁移学习训练器的共享状态与操作。
 *
 * image / pose / text 三个训练页的流程完全一致：
 *   采集样本 → 交给 @tensorflow-models/knn-classifier → 展示各类置信度
 * 三者的差异只在「样本从哪来」（摄像头帧 / 姿态特征 / 文本嵌入），因此把类别名、样本计数、
 * 预测结果、重命名迁移、清空这些**与输入模态无关**的部分抽到这里，页面只保留采集逻辑。
 *
 * classifier 参数放宽为 KnnClassifierLike：knn-classifier 是动态 import 的 CJS 包、没有类型
 * 声明，页面侧拿到的是 any，所以这里按实际用到的成员声明一个最小接口而不是 any 传递。
 */

export interface KnnPrediction {
  name: string
  score: number
}

/** knn-classifier 实例的最小接口（按本项目实际调用的成员声明） */
export interface KnnClassifierLike {
  addExample(example: unknown, classIndex: string): void
  predictClass(example: unknown, k?: number): Promise<{ label: string, confidences: Record<string, number> }>
  getNumClasses(): number
  getClassExampleCount(): Record<string, number>
  clearClass(classIndex: string): void
  clearAllClasses(): void
}

/** 三个类别是各训练页模板的固定列数（sm:grid-cols-3） */
export const DEFAULT_CLASS_NAMES = ['Class A', 'Class B', 'Class C']

export function useKnnTrainer(defaultNames: string[] = [...DEFAULT_CLASS_NAMES]) {
  const classNames = ref<string[]>([...defaultNames])
  const sampleCounts = ref<number[]>(defaultNames.map(() => 0))
  const predictions = ref<KnnPrediction[]>([])
  const topClass = ref('')

  /** 类别名。idx 来自模板 v-for，恒在界内；`?? ''` 只是给类型收窄一个出口 */
  const classNameAt = (idx: number) => classNames.value[idx] ?? ''

  const totalSamples = computed(() => sampleCounts.value.reduce((a, b) => a + b, 0))

  function resetResults() {
    predictions.value = []
    topClass.value = ''
  }

  /** 采集完一批样本后，从 classifier 回读该类别的实际样本数 */
  function syncCount(idx: number, classifier: KnnClassifierLike | null) {
    if (!classifier) return
    sampleCounts.value[idx] = classifier.getClassExampleCount()[classNameAt(idx)] ?? 0
  }

  /**
   * 按 KNN 返回的 confidences 回填结果。
   * threshold 只用于「低于阈值就不显示 top-1」（图像训练页传 0，等价于始终显示）。
   */
  function applyPrediction(
    res: { label: string, confidences: Record<string, number> },
    threshold: number
  ) {
    const confidences = res.confidences
    topClass.value = (confidences[res.label] ?? 0) >= threshold ? res.label : ''
    predictions.value = classNames.value
      .map((name, i) => ({ name, score: confidences[name] ?? confidences[i] ?? 0 }))
      .sort((a, b) => b.score - a.score)
  }

  /**
   * 重命名类别。返回 false 表示「该类已有样本，拒绝改名」，由页面决定怎么提示。
   *
   * 这里刻意拒绝而不是迁移样本：knn-classifier 没有「按标签取子数据集」的公开方法
   * （只有整体的 getClassifierDataset），迁移得拆张量后逐条 addExample，属于必须浏览器
   * 实测的高风险改动。音频训练页同样是「有样本则不允许改名」，四个训练页就此行为一致。
   */
  function renameClass(idx: number, name: string, classifier: KnnClassifierLike | null): boolean {
    const oldName = classNameAt(idx)
    if (oldName === name) return true
    if (classifier && (classifier.getClassExampleCount()[oldName] ?? 0) > 0) return false
    classNames.value[idx] = name
    return true
  }

  function clearClass(idx: number, classifier: KnnClassifierLike | null) {
    if (!classifier) return
    classifier.clearClass(classNameAt(idx))
    sampleCounts.value[idx] = 0
    resetResults()
  }

  function clearAll(classifier: KnnClassifierLike | null) {
    if (!classifier) return
    classifier.clearAllClasses()
    sampleCounts.value = sampleCounts.value.map(() => 0)
    resetResults()
  }

  return {
    classNames,
    sampleCounts,
    predictions,
    topClass,
    classNameAt,
    totalSamples,
    syncCount,
    resetResults,
    applyPrediction,
    renameClass,
    clearClass,
    clearAll
  }
}
