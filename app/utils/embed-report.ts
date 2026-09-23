/**
 * 嵌入上报契约（iframe → 宿主页）
 *
 * 页面被课程平台/工作台用 iframe 嵌进来时，把「完成度」回传给宿主：
 *
 *   parent.postMessage({ type: 'correct_rate', rate: 0~1, ... }, '*')
 *
 * 这套字段与既有交互页（test.html 像素原理等）和 edu_games 老游戏保持一致，
 * 宿主只需要判 `type === 'correct_rate'` 再读 `rate` 即可；后面的字段（app /
 * progress / finished / locale / 页面自有指标）都是附加信息，宿主不读也不影响。
 *
 * 三件事一起做，方便本机调试与直嵌（不经 iframe）场景：
 *   1. postMessage 给 parent —— 仅当自己确实被嵌（window.parent !== window）
 *   2. 派发同名 DOM 事件 `<app>:report`，直嵌时可 `window.addEventListener` 拿到
 *   3. console.log 一条，肉眼可查（工具类保留调试输出是项目约定）
 *
 * 去重：rate 与 finished 都没变时不再重复发（模拟类页面进度随时在涨，
 * 不节流会把宿主淹了）。
 */

/** 上报的消息形状（`correct_rate` 契约） */
export interface EmbedReportMessage {
  type: 'correct_rate'
  /** 页面标识，`<分类>/<slug>`，宿主据此区分是哪个页面报上来的 */
  app: string
  /** 完成度 0~1，宿主判定「这个页面做完了没有」就看它 */
  rate: number
  /** `rate` 的语义别名，与 edu_games 新契约对齐 */
  progress: number
  /** 是否已全部完成 */
  finished: boolean
  /** 页面语言，便于宿主做多语言记录 */
  locale: string
  /** 上报时间戳（毫秒） */
  at: number
  /** 页面自有指标（传感器参观数、覆盖率……），宿主可忽略 */
  [key: string]: unknown
}

export interface ReportOptions {
  /** 页面标识，如 'robot/envsense' */
  app: string
  /** 完成度 0~1（会被夹到 [0,1]） */
  rate: number
  /** 当前语言，默认 'zh' */
  locale?: string
  /** 是否已完成；不传则按 rate >= 0.999 判定 */
  finished?: boolean
  /** 额外字段，直接摊到消息里 */
  extra?: Record<string, unknown>
}

/** 每个页面记住上一条，用于去重 */
const lastSent = new Map<string, string>()

/**
 * 上报一次完成度。返回值是实际发出的消息（被去重跳过时返回 null）。
 */
export function reportCorrectRate(options: ReportOptions): EmbedReportMessage | null {
  const rate = clamp01(options.rate)
  const finished = options.finished ?? rate >= 0.999
  const message: EmbedReportMessage = {
    type: 'correct_rate',
    app: options.app,
    rate: round3(rate),
    progress: round3(rate),
    finished,
    locale: options.locale || 'zh',
    at: Date.now(),
    ...(options.extra || {})
  }

  // 去重：rate 与 finished 都没变就不重复发（首次一定发）
  const fingerprint = `${message.rate}|${message.finished}|${message.locale}`
  if (lastSent.get(options.app) === fingerprint) return null
  lastSent.set(options.app, fingerprint)

  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      window.parent.postMessage(message, '*')
    }
  } catch {
    /* 跨域/沙箱下只发本地事件，不打断页面 */
  }

  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(`${options.app}:report`, { detail: message }))
    }
  } catch {
    /* ignore */
  }

  console.log(`[${options.app}] report`, message)
  return message
}

/** 只重置去重状态（不改页面进度），用于「重置」按钮后强制补发一次 */
export function resetReportDedup(app: string): void {
  lastSent.delete(app)
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}
