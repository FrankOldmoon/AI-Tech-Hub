/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 简笔画识别数据层（/vision/sketch 能力页的两条实现路径）。
 *
 * ① 预置模型：DoodleNet —— CNN，用 Google Quick, Draw! 数据集（345 类）训练。
 *    ml5.js 从本地 `/model/vendor/ml5/ml5.min.js` 懒加载（产物由
 *    scripts/sync-runtime-libs.mjs 从 package.json 的 ml5 依赖同步），不再走 CDN。
 *    仍以 script 注入而非 `import('ml5')`：ml5 是 UMD 单包且 4.3MB，
 *    静态引入会把它拉进视觉页的公共 chunk。
 *    模型权重由 ml5 运行时获取（首次使用可能需联网）；类别名为 345 类英文名，
 *    中文对照见 utils/doodle-labels。
 *
 * ② 现场教学：MobileNet 提特征 + KNN 分类器（项目已有依赖与本地模型），
 *    用户画几笔 → 归入自定义类别 → 立刻能预测，零训练循环。
 */
import { isRemoteDeploy, REMOTE_TFJS } from '~/utils/remote-models'

const ML5_LOCAL = '/model/vendor/ml5/ml5.min.js'

export type DoodleHit = { label: string, confidence: number }

// ===== ① DoodleNet（ml5.js）=====

let ml5Promise: Promise<any> | null = null
let redirectInstalled = false

/**
 * ml5 把 DoodleNet 权重地址硬编码为 jsdelivr，这里重写到本地 /model/doodle/。
 * 可无条件重写：本地缺失时 server/routes/model/[...].ts 会 302 回退到原地址，
 * 因此离线可用、缺失也能降级。（与 utils/kokoro.ts 的 installFetchRedirect 同一模式）
 */
function installDoodleRedirect() {
  if (redirectInstalled) return
  redirectInstalled = true
  const REMOTE = 'https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models@master/models/doodlenet/'
  const LOCAL = '/model/doodle/'
  const rewrite = (url: string) => (url.startsWith(REMOTE) ? LOCAL + url.slice(REMOTE.length) : null)

  const origFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') {
      const to = rewrite(input)
      if (to) return origFetch(to, init)
    } else if (input instanceof URL) {
      const to = rewrite(input.href)
      if (to) return origFetch(new URL(to, window.location.origin), init)
    } else if (input instanceof Request) {
      const to = rewrite(input.url)
      if (to) return origFetch(new Request(new URL(to, window.location.origin), input), init)
    }
    return origFetch(input as RequestInfo, init)
  }

  // tfjs 在部分代码路径上用 XHR 拉权重，一并拦截
  const origOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
    const raw = typeof url === 'string' ? url : url.href
    return origOpen.apply(this, [method, rewrite(raw) ?? raw, ...rest] as any)
  } as typeof XMLHttpRequest.prototype.open
}

/** ml5.js 懒加载（本地产物，与 tesseract.js 同策略：首次使用时动态注入 script） */
export function loadMl5(): Promise<any> {
  if (import.meta.server) {
    return Promise.reject(new Error('ml5.js is client-only'))
  }
  installDoodleRedirect()
  const w = window as any
  if (w.ml5) return Promise.resolve(w.ml5)
  if (ml5Promise) return ml5Promise
  ml5Promise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = ML5_LOCAL
    script.async = true
    script.onload = () => {
      if (w.ml5) resolve(w.ml5)
      else reject(new Error('ml5.js loaded but global is undefined'))
    }
    script.onerror = () => {
      ml5Promise = null
      reject(new Error('Failed to load ml5.js from /model/vendor — run `node scripts/sync-runtime-libs.mjs`'))
    }
    document.head.appendChild(script)
  })
  return ml5Promise
}

let doodleNetPromise: Promise<any> | null = null

/** 加载 DoodleNet 分类器（ml5 v1 返回 Promise；旧版走回调，两种都兼容） */
export function loadDoodleNet(): Promise<any> {
  if (doodleNetPromise) return doodleNetPromise
  doodleNetPromise = (async () => {
    const ml5 = await loadMl5()
    return await new Promise((resolve, reject) => {
      try {
        const c = ml5.imageClassifier('DoodleNet', () => resolve(c))
        if (c && typeof c.then === 'function') c.then(resolve).catch(reject)
      } catch (e) {
        doodleNetPromise = null
        reject(e)
      }
    })
  })()
  return doodleNetPromise
}

/** DoodleNet 分类（返回 Top-K）。
 *  `label` 为模型原始类别名（含下划线/连字符，如 `hot_dog`、`t-shirt`），
 *  需要展示文案时请走 utils/doodle-labels 的 formatDoodleLabel() 做本地化。 */
export async function doodleClassify(input: HTMLCanvasElement, topK: number): Promise<DoodleHit[]> {
  const classifier = await loadDoodleNet()
  const raw: any = await new Promise((resolve, reject) => {
    try {
      const r = classifier.classify(input, (err: any, res: any) => (err ? reject(err) : resolve(res)))
      if (r && typeof r.then === 'function') r.then(resolve).catch(reject)
    } catch (e) {
      reject(e)
    }
  })
  const list = Array.isArray(raw) ? raw : [raw]
  const k = Math.max(1, Math.min(345, Math.round(topK) || 5))
  return list.slice(0, k).map((x: any) => ({
    label: String(x?.label ?? '?'),
    confidence: Number(x?.confidence ?? 0)
  }))
}

// ===== ② MobileNet 特征 + KNN（现场教学）=====

let teachCache: { mobilenet: any, knn: any } | null = null

async function ensureTeachModel() {
  if (teachCache) return teachCache
  const tf = await import('@tensorflow/tfjs')
  await tf.ready()
  const mobilenetMod = await import('@tensorflow-models/mobilenet')
  const knnMod = await import('@tensorflow-models/knn-classifier')
  // 与 ml/image-training 一致：本地 /model/tfjs 提供，云端回退 tfhub.dev
  const modelUrl = isRemoteDeploy() ? REMOTE_TFJS.mobilenet : '/model/tfjs/mobilenet/model.json'
  const mobilenet = await mobilenetMod.load({ version: 2, alpha: 1.0, modelUrl })
  teachCache = { mobilenet, knn: knnMod.create() }
  return teachCache
}

/** 当前 KNN 的类别与样本数（供采集/清空后回显） */
function teachStats(): { labels: string[], counts: number[] } {
  if (!teachCache) return { labels: [], counts: [] }
  const labels = (teachCache.knn.getClassLabels() ?? []) as string[]
  const byIndex = (teachCache.knn.getClassExampleCount() ?? {}) as Record<string, number>
  return { labels, counts: labels.map((_, i) => byIndex[String(i)] ?? 0) }
}

/** 采集一个样本（把当前画作的特征向量归入 label） */
export async function teachDoodle(input: HTMLCanvasElement, label: string) {
  const { mobilenet, knn } = await ensureTeachModel()
  const logits = mobilenet.infer(input, true)
  try {
    knn.addExample(logits, label)
  } finally {
    logits.dispose()
  }
  return teachStats()
}

/** 预测当前画作（无样本时返回 null） */
export async function predictDoodle(input: HTMLCanvasElement) {
  const { mobilenet, knn } = await ensureTeachModel()
  if (knn.getNumClasses() === 0) return null
  const logits = mobilenet.infer(input, true)
  try {
    const res: any = await knn.predictClass(logits)
    return (res?.confidences ?? {}) as Record<string, number>
  } finally {
    logits.dispose()
  }
}

/** 清空全部样本 */
export async function resetDoodleSamples() {
  const { knn } = await ensureTeachModel()
  knn.clearAllClasses()
  return teachStats()
}
