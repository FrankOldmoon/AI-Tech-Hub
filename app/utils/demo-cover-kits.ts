/**
 * 封面绘图件库：把「手掌 + 关键点」「人脸 + 68 点」「文档 + 文本框」这类
 * 功能效果图拆成可复用的零件，场景文件只负责摆放。
 *
 * 约定：
 * - 每个件都接收中心点 (cx, cy) 与缩放 s，s=1 大约是 70~90px 的尺寸，坐标全部是绝对坐标；
 * - 所有件都必须画在画布内（测试会逐点校验），需要出血的效果不要做成件；
 * - 描边宽度也随 s 缩放，缩小时不会显得毛糙。
 */
import type { CoverShape, Point } from './demo-cover-shapes'
import {
  arcPoints, circle, ellipsePoints, fillPoly, line, rect, r1, roundRectPoints, strokePoly
} from './demo-cover-shapes'

// ===== 音频 =====

/** 声波柱：中间高两端低的包络 + 逐条随机高度，读起来像一段音频 */
export function bars(cx: number, cy: number, w: number, h: number, count: number, rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = []
  const step = w / count
  for (let i = 0; i < count; i++) {
    const envelope = Math.sin(((i + 0.5) / count) * Math.PI)
    const bh = h * (0.1 + rand() * 0.26 + envelope * 0.6)
    shapes.push(rect(
      cx - w / 2 + i * step + step * 0.3,
      cy - bh / 2,
      step * 0.4,
      bh,
      r1(0.55 + rand() * 0.35),
      r1(step * 0.2)
    ))
  }
  return shapes
}

/** 频谱：以中线为基线的上下对称柱状，配一条细基线 */
export function spectrum(cx: number, cy: number, w: number, h: number, count: number, rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [rect(cx - w / 2, cy - 1, w, 2, 0.35)]
  const step = w / count
  for (let i = 0; i < count; i++) {
    const envelope = Math.sin(((i + 0.5) / count) * Math.PI)
    const bh = h * (0.08 + rand() * 0.5 + envelope * 0.42)
    shapes.push(rect(
      cx - w / 2 + i * step + step * 0.28,
      cy - bh / 2,
      step * 0.42,
      bh,
      r1(0.5 + rand() * 0.4),
      r1(step * 0.2)
    ))
  }
  return shapes
}

/** 麦克风 */
export function mic(cx: number, cy: number, s: number, opacity = 0.92): CoverShape[] {
  return [
    fillPoly(roundRectPoints(cx - 9 * s, cy - 30 * s, 18 * s, 36 * s, 9 * s), opacity),
    strokePoly(arcPoints(cx, cy + 2 * s, 16 * s, 0.12 * Math.PI, 0.88 * Math.PI), opacity, 3 * s),
    line(cx, cy + 18 * s, cx, cy + 27 * s, opacity, 3 * s),
    line(cx - 11 * s, cy + 27 * s, cx + 11 * s, cy + 27 * s, opacity, 3 * s)
  ]
}

/** 扬声器（喇叭 + 右侧声弧） */
export function speaker(cx: number, cy: number, s: number, arcs = 2): CoverShape[] {
  const body: Point[] = [[-26, -9], [-12, -9], [0, -26], [0, 26], [-12, 9], [-26, 9]]
  const shapes: CoverShape[] = [
    fillPoly(body.map(([x, y]) => [r1(cx + (x ?? 0) * s), r1(cy + (y ?? 0) * s)] as Point), 0.92)
  ]
  for (let i = 0; i < arcs; i++) {
    shapes.push(strokePoly(arcPoints(cx + 4 * s, cy, (14 + i * 10) * s, -0.62, 0.62), r1(0.85 - i * 0.22), 3 * s))
  }
  return shapes
}

/** 向右侧扩散的声弧（单独用，比如「播放中」的角标） */
export function soundArcs(cx: number, cy: number, s: number, count = 3): CoverShape[] {
  const shapes: CoverShape[] = []
  for (let i = 0; i < count; i++) {
    shapes.push(strokePoly(arcPoints(cx, cy, (11 + i * 9) * s, -0.6, 0.6), r1(0.8 - i * 0.2), 2.6 * s))
  }
  return shapes
}

/** 音符（四分音符：符头 + 符干 + 符尾） */
export function noteGlyph(cx: number, cy: number, s: number, opacity = 0.92): CoverShape[] {
  return [
    fillPoly(ellipsePoints(cx - 3 * s, cy + 8 * s, 7 * s, 5 * s, 16), opacity),
    line(cx + 3.4 * s, cy + 7 * s, cx + 3.4 * s, cy - 20 * s, opacity, 2.6 * s),
    strokePoly(arcPoints(cx + 3.4 * s, cy - 12 * s, 8 * s, -1.4, 0.2), opacity, 2.6 * s)
  ]
}

/** 门式电平表（麦克风输入电平 / 语速计） */
export function gauge(cx: number, cy: number, r: number, value: number): CoverShape[] {
  const shapes: CoverShape[] = [
    strokePoly(arcPoints(cx, cy, r, Math.PI, Math.PI * 2), 0.45, 3),
    strokePoly(arcPoints(cx, cy, r * 0.82, Math.PI * 1.25, Math.PI * 1.75), 0.9, 5)
  ]
  for (let i = 0; i <= 6; i++) {
    const angle = Math.PI + (i / 6) * Math.PI
    shapes.push(line(
      cx + Math.cos(angle) * (r - 7), cy + Math.sin(angle) * (r - 7),
      cx + Math.cos(angle) * (r - 1), cy + Math.sin(angle) * (r - 1),
      0.5, 2
    ))
  }
  const needle = Math.PI + Math.min(1, Math.max(0, value)) * Math.PI
  shapes.push(line(cx, cy, cx + Math.cos(needle) * r * 0.74, cy + Math.sin(needle) * r * 0.74, 0.95, 3))
  shapes.push(circle(cx, cy, 4, 0.95))
  return shapes
}

/** 钢琴键盘（迷你合成器） */
export function pianoKeys(cx: number, cy: number, w: number, h: number, keys = 9): CoverShape[] {
  const shapes: CoverShape[] = [rect(cx - w / 2, cy - h / 2, w, h, 0.28, 3)]
  const step = w / keys
  for (let i = 0; i <= keys; i++) {
    shapes.push(line(cx - w / 2 + i * step, cy - h / 2, cx - w / 2 + i * step, cy + h / 2, 0.6, 1.6))
  }
  const blackPattern = [0, 1, 3, 4, 5]
  for (let i = 0; i < keys - 1; i++) {
    if (!blackPattern.includes(i % 7)) continue
    shapes.push(rect(cx - w / 2 + (i + 1) * step - step * 0.28, cy - h / 2, step * 0.56, h * 0.58, 0.85, 2))
  }
  return shapes
}

// ===== 人体 / 人脸 / 手势 =====

/** MediaPipe 手部 21 个关键点（腕 1 + 每指 4），坐标以掌心为原点、指尖朝上 */
const HAND_LANDMARKS: Point[] = [
  [0, 44], [-14, 30], [-24, 18], [-30, 8], [-34, -2],
  [-10, 14], [-12, 0], [-13, -10], [-13, -20],
  [-2, 12], [-3, -2], [-4, -13], [-4, -23],
  [6, 14], [7, 0], [8, -10], [8, -19],
  [13, 20], [15, 8], [16, 0], [16, -8]
]
const HAND_BONES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
]
const PALM_OUTLINE: Point[] = [[0, 47], [-13, 32], [-21, 14], [-10, 9], [-1, 11], [9, 10], [17, 17], [16, 34]]

/** 手掌 + 21 个关键点 + 骨架：手势识别 / 手部关键点检测的效果图 */
export function hand(cx: number, cy: number, s: number): CoverShape[] {
  const at = (index: number): Point => {
    const p = HAND_LANDMARKS[index] ?? [0, 0]
    return [r1(cx + (p[0] ?? 0) * s), r1(cy + (p[1] ?? 0) * s)]
  }
  const shapes: CoverShape[] = [
    fillPoly(PALM_OUTLINE.map(([x, y]) => [r1(cx + (x ?? 0) * s), r1(cy + (y ?? 0) * s)] as Point), 0.2)
  ]
  for (const [a, b] of HAND_BONES) {
    const p = at(a)
    const q = at(b)
    shapes.push(line(p[0], p[1], q[0], q[1], 0.8, 2.4 * s))
  }
  for (let i = 0; i < HAND_LANDMARKS.length; i++) {
    const p = at(i)
    shapes.push(circle(p[0], p[1], 2.6 * s, 0.95))
  }
  for (const tip of [4, 8, 12, 16, 20]) {
    const p = at(tip)
    shapes.push(circle(p[0], p[1], 5.4 * s, 0.4))
  }
  return shapes
}

/** 人脸：轮廓 + 眉眼鼻嘴；landmarks 打开时叠加一圈特征点（人脸工作室 / 68 点） */
export function face(cx: number, cy: number, s: number, options: { landmarks?: boolean } = {}): CoverShape[] {
  const shapes: CoverShape[] = [
    strokePoly(ellipsePoints(cx, cy, 29 * s, 35 * s, 26), 0.9, 2.6 * s, { close: true }),
    circle(cx - 11 * s, cy - 7 * s, 3.4 * s, 0.92),
    circle(cx + 11 * s, cy - 7 * s, 3.4 * s, 0.92),
    line(cx - 17 * s, cy - 17 * s, cx - 5 * s, cy - 18 * s, 0.66, 2.2 * s),
    line(cx + 5 * s, cy - 18 * s, cx + 17 * s, cy - 17 * s, 0.66, 2.2 * s),
    line(cx, cy - 3 * s, cx - 2 * s, cy + 7 * s, 0.4, 2 * s),
    strokePoly(arcPoints(cx, cy + 11 * s, 10 * s, 0.22 * Math.PI, 0.78 * Math.PI), 0.7, 2.2 * s)
  ]
  if (options.landmarks) {
    // 下颌一圈：下半椭圆采样（-0.15π → 1.15π 走下半圈）
    const jaw = arcPoints(cx, cy, 33 * s, 0.12 * Math.PI, 0.88 * Math.PI, 8)
    for (const [x, y] of jaw) shapes.push(circle(x, y, 2, 0.8))
    shapes.push(circle(cx, cy + 35 * s, 2, 0.8))
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2
        shapes.push(circle(cx + side * 11 * s + Math.cos(angle) * 5.6 * s, cy - 7 * s + Math.sin(angle) * 4.6 * s, 1.7, 0.75))
      }
      shapes.push(circle(cx + side * 11 * s, cy - 7 * s, 1.6, 0.95))
      shapes.push(line(cx + side * 17 * s, cy - 17 * s, cx + side * 5 * s, cy - 18 * s, 0.4, 1.6))
    }
    for (let i = 0; i <= 6; i++) {
      const angle = 0.22 * Math.PI + (i / 6) * 0.56 * Math.PI
      shapes.push(circle(cx + Math.cos(angle) * 10 * s, cy + 11 * s + Math.sin(angle) * 10 * s, 1.7, 0.75))
    }
  }
  return shapes
}

/** 姿态骨架：头 + 躯干 + 四肢 + 关节点 */
export function skeleton(cx: number, cy: number, s: number, kind: 'stand' | 'run' | 'reach' = 'stand'): CoverShape[] {
  const poses: Record<string, Record<string, Point>> = {
    stand: {
      head: [0, -42], neck: [0, -30], chest: [0, -14], hip: [0, 8],
      shoulderL: [-15, -26], shoulderR: [15, -26],
      elbowL: [-21, -6], elbowR: [21, -6],
      wristL: [-23, 15], wristR: [23, 15],
      kneeL: [-9, 30], kneeR: [9, 30],
      ankleL: [-11, 54], ankleR: [11, 54]
    },
    reach: {
      head: [0, -42], neck: [0, -30], chest: [0, -14], hip: [0, 8],
      shoulderL: [-15, -26], shoulderR: [15, -26],
      elbowL: [-24, -40], elbowR: [24, -40],
      wristL: [-28, -58], wristR: [28, -58],
      kneeL: [-9, 30], kneeR: [9, 30],
      ankleL: [-11, 54], ankleR: [11, 54]
    },
    run: {
      head: [0, -42], neck: [0, -30], chest: [0, -14], hip: [0, 8],
      shoulderL: [-15, -26], shoulderR: [15, -26],
      elbowL: [-25, -8], elbowR: [19, -2],
      wristL: [-31, 8], wristR: [15, -16],
      kneeL: [-17, 26], kneeR: [14, 30],
      ankleL: [-27, 44], ankleR: [20, 54]
    }
  }
  const pose = poses[kind] ?? poses.stand ?? {}
  const at = (name: string): Point => {
    const p = pose[name] ?? [0, 0]
    return [r1(cx + (p[0] ?? 0) * s), r1(cy + (p[1] ?? 0) * s)]
  }
  const bones: Array<[string, string]> = [
    ['neck', 'chest'], ['chest', 'hip'],
    ['shoulderL', 'shoulderR'],
    ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
    ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
    ['hip', 'kneeL'], ['kneeL', 'ankleL'],
    ['hip', 'kneeR'], ['kneeR', 'ankleR']
  ]
  const shapes: CoverShape[] = [
    circle(at('head')[0], at('head')[1], 9 * s, 0.92)
  ]
  for (const [a, b] of bones) {
    const p = at(a)
    const q = at(b)
    shapes.push(line(p[0], p[1], q[0], q[1], 0.85, 3 * s))
  }
  for (const name of ['neck', 'chest', 'hip', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']) {
    const p = at(name)
    shapes.push(circle(p[0], p[1], 3 * s, 0.95))
  }
  return shapes
}

/** 半身人形（抠图 / 深度图这类需要「主体」的场景） */
export function bust(cx: number, cy: number, s: number, opacity = 0.9): CoverShape[] {
  return [
    fillPoly(ellipsePoints(cx, cy - 30 * s, 18 * s, 21 * s, 20), opacity),
    fillPoly([
      [cx - 34 * s, cy + 48 * s], [cx - 30 * s, cy + 4 * s], [cx - 14 * s, cy - 8 * s],
      [cx + 14 * s, cy - 8 * s], [cx + 30 * s, cy + 4 * s], [cx + 34 * s, cy + 48 * s]
    ].map(([x, y]) => [r1(x ?? 0), r1(y ?? 0)] as Point), opacity)
  ]
}

// ===== 文档 / 图像 / 标注 =====

/** 纸张：右上角折角 + 若干文本行 */
export function docPage(cx: number, cy: number, w: number, h: number, rand: () => number, lines = 6): CoverShape[] {
  const x = cx - w / 2
  const y = cy - h / 2
  const fold = Math.min(w, h) * 0.24
  const shapes: CoverShape[] = [
    fillPoly([
      [x, y], [x + w - fold, y], [x + w, y + fold], [x + w, y + h], [x, y + h]
    ].map(([px, py]) => [r1(px ?? 0), r1(py ?? 0)] as Point), 0.16),
    strokePoly([[x, y], [x + w - fold, y], [x + w, y + fold], [x + w, y + h], [x, y + h]], 0.8, 3, { close: true }),
    strokePoly([[x + w - fold, y], [x + w - fold, y + fold], [x + w, y + fold]], 0.8, 3)
  ]
  const left = x + w * 0.14
  const usable = w * 0.72
  for (let i = 0; i < lines; i++) {
    shapes.push(rect(left, y + h * (0.26 + i * 0.12), usable * (0.52 + rand() * 0.48), 5, r1(0.3 + rand() * 0.3), 2.5))
  }
  return shapes
}

/** 文本行骨架（NLP 场景的「段落」） */
export function textLines(x: number, y: number, w: number, count: number, rand: () => number, options: { gap?: number, height?: number } = {}): CoverShape[] {
  const gap = options.gap ?? 17
  const height = options.height ?? 8
  const shapes: CoverShape[] = []
  for (let i = 0; i < count; i++) {
    const isTitle = i === 0
    shapes.push(rect(
      x,
      y + i * gap,
      w * (isTitle ? 0.36 + rand() * 0.14 : 0.5 + rand() * 0.5),
      isTitle ? height + 4 : height,
      isTitle ? 0.82 : r1(0.3 + rand() * 0.3),
      isTitle ? 4.5 : 4
    ))
  }
  return shapes
}

/** 相框：山与太阳的简笔风景（「这是一张图」的通用符号） */
export function imageFrame(cx: number, cy: number, w: number, h: number, opacity = 0.9): CoverShape[] {
  const x = cx - w / 2
  const y = cy - h / 2
  const shapes: CoverShape[] = [
    rect(x, y, w, h, 0.14, 5),
    strokePoly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], opacity, 2.6, { close: true }),
    circle(x + w * 0.26, y + h * 0.3, Math.min(w, h) * 0.1, opacity * 0.85),
    fillPoly([
      [x + w * 0.08, y + h * 0.86], [x + w * 0.36, y + h * 0.42],
      [x + w * 0.58, y + h * 0.86]
    ].map(([px, py]) => [r1(px ?? 0), r1(py ?? 0)] as Point), opacity * 0.7),
    fillPoly([
      [x + w * 0.44, y + h * 0.86], [x + w * 0.68, y + h * 0.52],
      [x + w * 0.94, y + h * 0.86]
    ].map(([px, py]) => [r1(px ?? 0), r1(py ?? 0)] as Point), opacity * 0.45)
  ]
  return shapes
}

/** 检测框四角（目标检测最通用的符号） */
export function detectCorners(cx: number, cy: number, w: number, h: number, opacity = 0.9, width = 4, arm = 0.22): CoverShape[] {
  const x = cx - w / 2
  const y = cy - h / 2
  const a = Math.min(w, h) * arm
  return [
    strokePoly([[x, y + a], [x, y], [x + a, y]], opacity, width),
    strokePoly([[x + w - a, y], [x + w, y], [x + w, y + a]], opacity, width),
    strokePoly([[x + w, y + h - a], [x + w, y + h], [x + w - a, y + h]], opacity, width),
    strokePoly([[x + a, y + h], [x, y + h], [x, y + h - a]], opacity, width)
  ]
}

/** 一带实线矩形框 + 左上角标签条（检测结果） */
export function labelBox(cx: number, cy: number, w: number, h: number, opacity = 0.85): CoverShape[] {
  const x = cx - w / 2
  const y = cy - h / 2
  return [
    rect(x, y, w, h, 0.1, 3),
    strokePoly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], opacity, 2.6, { close: true }),
    rect(x, y - 9, Math.min(w * 0.42, 52), 9, opacity, 2)
  ]
}

/** 关键点（可选带十字准星的小圈） */
export function keyDots(points: Point[], r = 2.6, opacity = 0.95): CoverShape[] {
  return points.map(([x, y]) => circle(x, y, r, opacity))
}

/** 十字准星（特征点定位 / 追踪） */
export function crosshair(cx: number, cy: number, s: number, opacity = 0.9): CoverShape[] {
  return [
    strokePoly(ellipsePoints(cx, cy, 13 * s, 13 * s, 20), opacity, 2.4 * s, { close: true }),
    line(cx - 20 * s, cy, cx - 6 * s, cy, opacity, 2.2 * s),
    line(cx + 6 * s, cy, cx + 20 * s, cy, opacity, 2.2 * s),
    line(cx, cy - 20 * s, cx, cy - 6 * s, opacity, 2.2 * s),
    line(cx, cy + 6 * s, cx, cy + 20 * s, opacity, 2.2 * s),
    circle(cx, cy, 2.4 * s, opacity)
  ]
}

/** 透明棋盘格（抠图底纹） */
export function checker(cx: number, cy: number, w: number, h: number, cell: number, opacity = 0.16): CoverShape[] {
  const shapes: CoverShape[] = []
  const x = cx - w / 2
  const y = cy - h / 2
  const cols = Math.floor(w / cell)
  const rows = Math.floor(h / cell)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if ((i + j) % 2) continue
      shapes.push(rect(x + i * cell, y + j * cell, cell, cell, opacity))
    }
  }
  return shapes
}

/** 横向条带（深度图的远近分层；远端更淡，另加一圈外框保证在小尺寸下也看得见） */
export function depthBands(cx: number, cy: number, w: number, h: number, levels = 5): CoverShape[] {
  const x = cx - w / 2
  const y = cy - h / 2
  const bandH = h / levels
  const shapes: CoverShape[] = []
  for (let i = 0; i < levels; i++) {
    shapes.push(rect(x, y + i * bandH, w, bandH - 3, r1(0.64 - i * 0.1), 2))
  }
  shapes.push(strokePoly(roundRectPoints(x, y, w, h, 4), 0.4, 2.2, { close: true }))
  return shapes
}

/** 横向概率条（分类结果） */
export function probBars(cx: number, cy: number, w: number, count: number, rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = []
  const gap = 13
  const top = cy - ((count - 1) * gap) / 2
  const weights = Array.from({ length: count }, () => 0.25 + rand() * 0.75)
  const max = Math.max(...weights)
  weights.forEach((weight, i) => {
    shapes.push(rect(cx - w / 2, top + i * gap - 3.5, w, 7, 0.18, 3.5))
    shapes.push(rect(cx - w / 2, top + i * gap - 3.5, w * (weight / max), 7, r1(0.55 + (weight / max) * 0.4), 3.5))
  })
  return shapes
}

// ===== 结构 / 图表 / 网络 =====

/** 多层全连接网络 */
export function nn(cx: number, cy: number, s: number, layout: number[], rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = []
  const spanX = 44 * s
  const gapY = 21 * s
  const nodes: Point[] = []
  const layerStart: number[] = []
  layout.forEach((count, layerIndex) => {
    layerStart.push(nodes.length)
    const x = cx + (layerIndex - (layout.length - 1) / 2) * spanX
    for (let i = 0; i < count; i++) {
      nodes.push([r1(x), r1(cy + (i - (count - 1) / 2) * gapY)])
    }
  })
  for (let layerIndex = 0; layerIndex < layout.length - 1; layerIndex++) {
    const from = layerStart[layerIndex] ?? 0
    const to = layerStart[layerIndex + 1] ?? 0
    for (let a = 0; a < (layout[layerIndex] ?? 0); a++) {
      for (let b = 0; b < (layout[layerIndex + 1] ?? 0); b++) {
        const p = nodes[from + a]
        const q = nodes[to + b]
        if (!p || !q) continue
        shapes.push(line(p[0], p[1], q[0], q[1], r1(0.16 + rand() * 0.16), 1.8))
      }
    }
  }
  for (const [x, y] of nodes) {
    shapes.push(circle(x, y, 5.4 * s, 0.92))
  }
  return shapes
}

/** 散点（聚类 / 回归 / 嵌入空间的点云） */
export function scatter(x: number, y: number, w: number, h: number, count: number, rand: () => number, r = 2.6): CoverShape[] {
  const shapes: CoverShape[] = []
  for (let i = 0; i < count; i++) {
    shapes.push(circle(x + rand() * w, y + rand() * h, r1(r * (0.7 + rand() * 0.6)), r1(0.5 + rand() * 0.45)))
  }
  return shapes
}

/** 聚类圈：把点云分组包围起来 */
export function clusterRing(cx: number, cy: number, r: number, opacity = 0.5): CoverShape[] {
  return [strokePoly(ellipsePoints(cx, cy, r, r * 0.82, 24), opacity, 2.4, { dash: '6 5' })]
}

/** 坐标轴（L 形） */
export function axes(x: number, y: number, w: number, h: number, opacity = 0.45): CoverShape[] {
  return [
    strokePoly([[x, y], [x, y + h], [x + w, y + h]], opacity, 2.4),
    line(x, y + h, x + w, y + h, opacity, 2.4)
  ]
}

/** 折线（曲线 / 路径 / 轨迹）；values 为 0~1 的纵向比例，0 在底部 */
export function polyline(values: number[], x: number, y: number, w: number, h: number, opacity = 0.9, width = 3, close = false): CoverShape[] {
  const points: Point[] = values.map((value, i) => [
    r1(x + (i / Math.max(1, values.length - 1)) * w),
    r1(y + h - value * h)
  ])
  return [strokePoly(points, opacity, width, { close })]
}

/** 网格线（棋盘世界 / 元胞自动机 / 网格搜索） */
export function gridLines(x: number, y: number, w: number, h: number, cols: number, rows: number, opacity = 0.28): CoverShape[] {
  const shapes: CoverShape[] = []
  for (let i = 0; i <= cols; i++) shapes.push(line(x + (i / cols) * w, y, x + (i / cols) * w, y + h, opacity, 1.8))
  for (let j = 0; j <= rows; j++) shapes.push(line(x, y + (j / rows) * h, x + w, y + (j / rows) * h, opacity, 1.8))
  return shapes
}

/** 网格里的一格（0-based） */
export function gridCell(x: number, y: number, w: number, h: number, cols: number, rows: number, col: number, row: number, opacity: number, inset = 2): CoverShape {
  const cw = w / cols
  const ch = h / rows
  return rect(x + col * cw + inset, y + row * ch + inset, cw - inset * 2, ch - inset * 2, opacity, 2)
}

/** 箭头（含箭头帽） */
export function arrow(x0: number, y0: number, x1: number, y1: number, opacity = 0.85, width = 3, head = 8): CoverShape[] {
  const angle = Math.atan2(y1 - y0, x1 - x0)
  return [
    line(x0, y0, x1, y1, opacity, width),
    fillPoly([
      [r1(x1), r1(y1)],
      [r1(x1 - Math.cos(angle - 0.5) * head), r1(y1 - Math.sin(angle - 0.5) * head)],
      [r1(x1 - Math.cos(angle + 0.5) * head), r1(y1 - Math.sin(angle + 0.5) * head)]
    ], opacity)
  ]
}

/** 对话气泡（带小尾巴 + 两行字） */
export function bubble(cx: number, cy: number, w: number, h: number, tail: 'left' | 'right' = 'left', rand: () => number): CoverShape[] {
  const x = cx - w / 2
  const y = cy - h / 2
  const shapes: CoverShape[] = [
    fillPoly(roundRectPoints(x, y, w, h, Math.min(9, h / 2.4)), 0.16),
    strokePoly(roundRectPoints(x, y, w, h, Math.min(9, h / 2.4)), 0.8, 2.6, { close: true })
  ]
  const tailX = tail === 'left' ? x + w * 0.24 : x + w * 0.76
  const dir = tail === 'left' ? -1 : 1
  shapes.push(fillPoly([
    [r1(tailX), r1(y + h - 1)],
    [r1(tailX + dir * 11), r1(y + h + 9)],
    [r1(tailX + dir * 15), r1(y + h - 1)]
  ], 0.8))
  shapes.push(rect(x + w * 0.14, y + h * 0.32, w * (0.36 + rand() * 0.2), 5, 0.55, 2.5))
  shapes.push(rect(x + w * 0.14, y + h * 0.58, w * (0.2 + rand() * 0.34), 5, 0.35, 2.5))
  return shapes
}

/** 代码尖括号 */
export function codeBrackets(cx: number, cy: number, s: number, opacity = 0.9): CoverShape[] {
  return [
    strokePoly([[cx - 22 * s, cy - 26 * s], [cx - 46 * s, cy], [cx - 22 * s, cy + 26 * s]], opacity, 4 * s),
    strokePoly([[cx + 22 * s, cy - 26 * s], [cx + 46 * s, cy], [cx + 22 * s, cy + 26 * s]], opacity, 4 * s),
    line(cx + 6 * s, cy - 24 * s, cx - 6 * s, cy + 24 * s, opacity * 0.7, 4 * s)
  ]
}

/** 胶片格：一排帧（视频相关场景） */
export function filmFrames(cx: number, cy: number, w: number, h: number, count = 3, opacity = 0.8): CoverShape[] {
  const shapes: CoverShape[] = []
  const gap = 9
  const fw = (w - gap * (count - 1)) / count
  for (let i = 0; i < count; i++) {
    const x = cx - w / 2 + i * (fw + gap)
    const dim = i === count - 1 ? opacity : opacity * (0.42 + i * 0.16)
    shapes.push(rect(x, cy - h / 2, fw, h, r1(dim * 0.24), 4))
    shapes.push(strokePoly([[x, cy - h / 2], [x + fw, cy - h / 2], [x + fw, cy + h / 2], [x, cy + h / 2]], dim, 2.4, { close: true }))
    shapes.push(fillPoly([
      [r1(x + fw * 0.38), r1(cy - h * 0.16)], [r1(x + fw * 0.7), r1(cy)], [r1(x + fw * 0.38), r1(cy + h * 0.16)]
    ], dim))
  }
  return shapes
}

/** 时间线 + 选区（裁剪场景）：wave 为 0~1 的柱子高度 */
export function timeline(cx: number, cy: number, w: number, h: number, rand: () => number, from = 0.3, to = 0.66): CoverShape[] {
  const x = cx - w / 2
  const top = cy - h / 2
  const shapes: CoverShape[] = []
  const count = 26
  for (let i = 0; i < count; i++) {
    const bh = h * (0.28 + rand() * 0.72)
    shapes.push(rect(x + (i / count) * w + 1.5, cy - bh / 2, w / count - 3, bh, 0.26, 1.5))
  }
  const sx = x + from * w
  const ex = x + to * w
  shapes.push(rect(sx, top - 4, ex - sx, h + 8, 0.2, 3))
  shapes.push(strokePoly([[sx, top - 4], [ex, top - 4], [ex, top + h + 4], [sx, top + h + 4]], 0.92, 2.6, { close: true }))
  shapes.push(rect(sx - 2.5, top - 8, 5, h + 16, 0.92, 2))
  shapes.push(rect(ex - 2.5, top - 8, 5, h + 16, 0.92, 2))
  return shapes
}

/** 文件卡片（带折角 + 一个功能小图标） */
export function fileCard(
  cx: number, cy: number, w: number, h: number, glyph: 'wave' | 'note' | 'image' | 'film' | 'plain', rand: () => number
): CoverShape[] {
  const shapes = docPage(cx, cy, w, h, rand, 0)
  const gx = cx
  const gy = cy + h * 0.12
  const s = w / 46
  if (glyph === 'wave') {
    for (let i = 0; i < 5; i++) {
      const bh = (5 + (i % 3) * 5) * s
      shapes.push(rect(gx - 9 * s + i * 4.5 * s, gy - bh / 2, 2.6 * s, bh, 0.8, 1.3 * s))
    }
  } else if (glyph === 'note') {
    shapes.push(...noteGlyph(gx, gy, s * 0.8, 0.8))
  } else if (glyph === 'image') {
    shapes.push(rect(gx - 10 * s, gy - 7 * s, 20 * s, 14 * s, 0.7, 2 * s))
  } else if (glyph === 'film') {
    shapes.push(rect(gx - 11 * s, gy - 7 * s, 22 * s, 14 * s, 0.7, 2 * s))
    shapes.push(fillPoly([
      [r1(gx - 3 * s), r1(gy - 4 * s)], [r1(gx + 5 * s), r1(gy)], [r1(gx - 3 * s), r1(gy + 4 * s)]
    ], 0.9))
  }
  return shapes
}

/** 两根滑块（图像调整） */
export function sliderGroup(cx: number, cy: number, w: number, rand: () => number, count = 3): CoverShape[] {
  const shapes: CoverShape[] = []
  const gap = 20
  for (let i = 0; i < count; i++) {
    const y = cy + (i - (count - 1) / 2) * gap
    const value = 0.18 + rand() * 0.64
    shapes.push(rect(cx - w / 2, y - 2.5, w, 5, 0.22, 2.5))
    shapes.push(rect(cx - w / 2, y - 2.5, w * value, 5, 0.8, 2.5))
    shapes.push(circle(cx - w / 2 + w * value, y, 7, 0.95))
  }
  return shapes
}

/**
 * 色环（颜色处理）。
 * 扇区透明度绕一圈由亮到暗 —— 全同透明度会看成一个「饼图」，加一圈轮辐才像色轮。
 */
export function colorWheel(cx: number, cy: number, r: number, rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = []
  const wedges = 8
  for (let i = 0; i < wedges; i++) {
    const a0 = (i / wedges) * Math.PI * 2
    const a1 = ((i + 1) / wedges) * Math.PI * 2
    const points: Point[] = [[r1(cx), r1(cy)]]
    for (const angle of arcPoints(cx, cy, r, a0, a1, 5)) points.push(angle)
    shapes.push(fillPoly(points, r1(0.9 - (i / wedges) * 0.62 + rand() * 0.06)))
  }
  shapes.push(strokePoly(ellipsePoints(cx, cy, r, r, 26), 0.55, 2.4, { close: true }))
  shapes.push(circle(cx, cy, r * 0.2, 0.95))
  return shapes
}

/** 放大镜 */
export function magnifier(cx: number, cy: number, s: number, opacity = 0.9): CoverShape[] {
  return [
    strokePoly(ellipsePoints(cx, cy - 4 * s, 22 * s, 22 * s, 24), opacity, 3.4 * s, { close: true }),
    line(cx + 15 * s, cy + 12 * s, cx + 30 * s, cy + 28 * s, opacity, 5 * s)
  ]
}

/** 星火（生成类场景的点缀） */
export function sparkles(cx: number, cy: number, count: number, rand: () => number, spread = 52, maxR = 13): CoverShape[] {
  const shapes: CoverShape[] = []
  for (let i = 0; i < count; i++) {
    const x = r1(cx + (rand() - 0.5) * spread * 2)
    const y = r1(cy + (rand() - 0.5) * spread)
    const r = r1(5 + rand() * maxR)
    const waist = r1(r * 0.18)
    shapes.push(fillPoly([
      [x, r1(y - r)], [r1(x + waist), r1(y - waist)], [r1(x + r), y], [r1(x + waist), r1(y + waist)],
      [x, r1(y + r)], [r1(x - waist), r1(y + waist)], [r1(x - r), y], [r1(x - waist), r1(y - waist)]
    ], r1(0.62 + rand() * 0.34)))
  }
  return shapes
}

/** 橡皮擦 / 笔刷 + 虚线选区（局部重绘、修复） */
export function eraser(cx: number, cy: number, s: number, opacity = 0.9): CoverShape[] {
  return [
    fillPoly([
      [cx - 26 * s, cy + 12 * s], [cx - 14 * s, cy - 14 * s], [cx + 8 * s, cy - 20 * s],
      [cx + 20 * s, cy - 4 * s], [cx + 2 * s, cy + 16 * s]
    ], opacity * 0.45),
    strokePoly([
      [cx - 26 * s, cy + 12 * s], [cx - 14 * s, cy - 14 * s], [cx + 8 * s, cy - 20 * s],
      [cx + 20 * s, cy - 4 * s], [cx + 2 * s, cy + 16 * s]
    ], opacity, 3 * s, { close: true }),
    line(cx - 26 * s, cy + 12 * s, cx + 2 * s, cy + 16 * s, opacity, 3 * s)
  ]
}

/** 芯片（GPU 诊断 / 本地推理） */
export function chip(cx: number, cy: number, s: number, opacity = 0.88): CoverShape[] {
  const shapes: CoverShape[] = [
    fillPoly(roundRectPoints(cx - 24 * s, cy - 24 * s, 48 * s, 48 * s, 7 * s), opacity * 0.28),
    strokePoly(roundRectPoints(cx - 24 * s, cy - 24 * s, 48 * s, 48 * s, 7 * s), opacity, 3 * s, { close: true }),
    strokePoly(roundRectPoints(cx - 11 * s, cy - 11 * s, 22 * s, 22 * s, 4 * s), opacity * 0.7, 2.4 * s, { close: true })
  ]
  const pins = [-14, -4, 6, 16]
  for (const offset of pins) {
    shapes.push(line(cx + offset * s, cy - 24 * s, cx + offset * s, cy - 32 * s, opacity, 2.6 * s))
    shapes.push(line(cx + offset * s, cy + 24 * s, cx + offset * s, cy + 32 * s, opacity, 2.6 * s))
    shapes.push(line(cx - 24 * s, cy + offset * s, cx - 32 * s, cy + offset * s, opacity, 2.6 * s))
    shapes.push(line(cx + 24 * s, cy + offset * s, cx + 32 * s, cy + offset * s, opacity, 2.6 * s))
  }
  return shapes
}

/** 对勾 / 叉（能力诊断） */
export function verdict(cx: number, cy: number, s: number, ok: boolean, opacity = 0.95): CoverShape[] {
  if (ok) {
    return [strokePoly([[cx - 9 * s, cy + 1 * s], [cx - 2 * s, cy + 9 * s], [cx + 11 * s, cy - 8 * s]], opacity, 3.4 * s)]
  }
  return [
    line(cx - 8 * s, cy - 8 * s, cx + 8 * s, cy + 8 * s, opacity, 3.4 * s),
    line(cx + 8 * s, cy - 8 * s, cx - 8 * s, cy + 8 * s, opacity, 3.4 * s)
  ]
}

/** 立方体（等轴测，图生 3D / 空间概念） */
export function cube(cx: number, cy: number, s: number, opacity = 0.9): CoverShape[] {
  const top: Point[] = [[cx, cy - 24 * s], [cx + 24 * s, cy - 12 * s], [cx, cy], [cx - 24 * s, cy - 12 * s]]
  const left: Point[] = [[cx - 24 * s, cy - 12 * s], [cx, cy], [cx, cy + 24 * s], [cx - 24 * s, cy + 12 * s]]
  const right: Point[] = [[cx + 24 * s, cy - 12 * s], [cx, cy], [cx, cy + 24 * s], [cx + 24 * s, cy + 12 * s]]
  return [
    fillPoly(top, opacity * 0.5),
    fillPoly(left, opacity * 0.28),
    fillPoly(right, opacity * 0.72),
    strokePoly(top, opacity, 2.4 * s, { close: true }),
    strokePoly(left, opacity, 2.4 * s, { close: true }),
    strokePoly(right, opacity, 2.4 * s, { close: true })
  ]
}

/** 有机团块（斑点 / 掩膜 / 团簇） */
export function blob(cx: number, cy: number, r: number, rand: () => number, opacity = 0.7): CoverShape[] {
  const points: Point[] = []
  const steps = 22
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    const wobble = 0.72 + rand() * 0.42
    points.push([r1(cx + Math.cos(angle) * r * wobble), r1(cy + Math.sin(angle) * r * wobble * 0.86)])
  }
  return [fillPoly(points, opacity)]
}

// ===== 机器人 =====

/** 平面二连杆机械臂：base（底座）→ 三个关节 + 夹爪 */
export function robotArm(cx: number, cy: number, s: number, a0 = -1.9, a1 = -0.5): CoverShape[] {
  const shoulder: Point = [r1(cx - 46 * s), r1(cy + 40 * s)]
  const elbow: Point = [r1(shoulder[0] + Math.cos(a0) * 44 * s), r1(shoulder[1] + Math.sin(a0) * 44 * s)]
  const wrist: Point = [r1(elbow[0] + Math.cos(a1) * 36 * s), r1(elbow[1] + Math.sin(a1) * 36 * s)]
  const shapes: CoverShape[] = [
    fillPoly([[shoulder[0] - 16 * s, shoulder[1]], [shoulder[0] + 16 * s, shoulder[1]], [shoulder[0] + 12 * s, shoulder[1] + 14 * s], [shoulder[0] - 12 * s, shoulder[1] + 14 * s]], 0.75),
    line(shoulder[0], shoulder[1], elbow[0], elbow[1], 0.9, 9 * s),
    line(elbow[0], elbow[1], wrist[0], wrist[1], 0.9, 7 * s),
    circle(shoulder[0], shoulder[1], 7 * s, 0.95),
    circle(elbow[0], elbow[1], 6 * s, 0.95),
    circle(wrist[0], wrist[1], 5 * s, 0.95)
  ]
  const clawAngle = a1 + 0.35
  for (const side of [-1, 1]) {
    shapes.push(line(
      wrist[0], wrist[1],
      wrist[0] + Math.cos(clawAngle + side * 0.42) * 15 * s,
      wrist[1] + Math.sin(clawAngle + side * 0.42) * 15 * s,
      0.85, 3.4 * s
    ))
  }
  return shapes
}

/** 四足 / 机器鸭（microduck 这类仿真体） */
export function quadruped(cx: number, cy: number, s: number, opacity = 0.9): CoverShape[] {
  const shapes: CoverShape[] = [
    fillPoly(ellipsePoints(cx, cy - 4 * s, 26 * s, 15 * s, 20), opacity * 0.5),
    strokePoly(ellipsePoints(cx, cy - 4 * s, 26 * s, 15 * s, 20), opacity, 3 * s, { close: true }),
    circle(cx + 26 * s, cy - 18 * s, 9 * s, opacity),
    fillPoly([
      [r1(cx + 33 * s), r1(cy - 18 * s)], [r1(cx + 44 * s), r1(cy - 15 * s)], [r1(cx + 33 * s), r1(cy - 12 * s)]
    ], opacity * 0.85)
  ]
  for (const legX of [-16, -6, 8, 18]) {
    shapes.push(line(cx + legX * s, cy + 10 * s, cx + legX * s, cy + 30 * s, opacity * 0.85, 3 * s))
    shapes.push(line(cx + legX * s, cy + 30 * s, cx + (legX + 5) * s, cy + 30 * s, opacity * 0.85, 3 * s))
  }
  shapes.push(strokePoly(arcPoints(cx - 28 * s, cy - 12 * s, 10 * s, -0.9, 1.1), opacity * 0.7, 3 * s))
  return shapes
}

/** 小鸟 / 群集个体（boids、flappy） */
export function birdGlyph(cx: number, cy: number, s: number, angle: number, opacity = 0.9): CoverShape[] {
  const point = (dx: number, dy: number): Point => [r1(cx + (dx * Math.cos(angle) - dy * Math.sin(angle)) * s), r1(cy + (dx * Math.sin(angle) + dy * Math.cos(angle)) * s)]
  return [
    fillPoly([point(13, 0), point(-8, 8), point(-3, 0), point(-8, -8)], opacity)
  ]
}

/** 小车（CartPole / 滑板） */
export function cart(cx: number, cy: number, s: number, opacity = 0.9): CoverShape[] {
  return [
    fillPoly([[cx - 24 * s, cy - 9 * s], [cx + 24 * s, cy - 9 * s], [cx + 20 * s, cy + 9 * s], [cx - 20 * s, cy + 9 * s]], opacity * 0.55),
    strokePoly([[cx - 24 * s, cy - 9 * s], [cx + 24 * s, cy - 9 * s], [cx + 20 * s, cy + 9 * s], [cx - 20 * s, cy + 9 * s]], opacity, 3 * s, { close: true }),
    circle(cx - 13 * s, cy + 10 * s, 5 * s, opacity),
    circle(cx + 13 * s, cy + 10 * s, 5 * s, opacity)
  ]
}

/** 书（有声书） */
export function book(cx: number, cy: number, s: number, opacity = 0.9): CoverShape[] {
  return [
    fillPoly([[cx - 30 * s, cy - 16 * s], [cx, cy - 9 * s], [cx, cy + 16 * s], [cx - 30 * s, cy + 9 * s]], opacity * 0.32),
    fillPoly([[cx + 30 * s, cy - 16 * s], [cx, cy - 9 * s], [cx, cy + 16 * s], [cx + 30 * s, cy + 9 * s]], opacity * 0.5),
    strokePoly([[cx - 30 * s, cy - 16 * s], [cx, cy - 9 * s], [cx, cy + 16 * s], [cx - 30 * s, cy + 9 * s]], opacity, 2.8 * s, { close: true }),
    strokePoly([[cx + 30 * s, cy - 16 * s], [cx, cy - 9 * s], [cx, cy + 16 * s], [cx + 30 * s, cy + 9 * s]], opacity, 2.8 * s, { close: true }),
    line(cx, cy - 9 * s, cx, cy + 16 * s, opacity, 2.4 * s)
  ]
}

/** 指纹（声纹） */
export function fingerprint(cx: number, cy: number, s: number, opacity = 0.85): CoverShape[] {
  const shapes: CoverShape[] = []
  for (let i = 0; i < 5; i++) {
    const r = (9 + i * 7) * s
    shapes.push(strokePoly(arcPoints(cx, cy, r, -2.35, 2.35), r1(opacity * (1 - i * 0.11)), 2.4 * s))
  }
  shapes.push(line(cx - 5 * s, cy - 6 * s, cx - 5 * s, cy + 6 * s, opacity * 0.7, 2.2 * s))
  return shapes
}

/** 地球（语言 / 翻译） */
export function globe(cx: number, cy: number, r: number, opacity = 0.85): CoverShape[] {
  return [
    strokePoly(ellipsePoints(cx, cy, r, r, 26), opacity, 2.6, { close: true }),
    strokePoly(ellipsePoints(cx, cy, r * 0.45, r, 20), opacity * 0.7, 2, { close: true }),
    line(cx - r, cy, cx + r, cy, opacity * 0.7, 2),
    strokePoly(arcPoints(cx, cy, r * 0.86, -0.6, 2.5), opacity * 0.5, 2)
  ]
}

/** 树木状分叉（决策树） */
export function treeNodes(cx: number, cy: number, s: number, opacity = 0.85): CoverShape[] {
  const levels: Point[][] = [
    [[cx, cy - 42 * s]],
    [[cx - 30 * s, cy - 8 * s], [cx + 30 * s, cy - 8 * s]],
    [[cx - 46 * s, cy + 34 * s], [cx - 14 * s, cy + 34 * s], [cx + 14 * s, cy + 34 * s], [cx + 46 * s, cy + 34 * s]]
  ]
  const shapes: CoverShape[] = []
  for (let i = 0; i < levels.length - 1; i++) {
    for (const p of levels[i] ?? []) {
      for (const q of levels[i + 1] ?? []) {
        if (Math.abs((p?.[0] ?? 0) - (q?.[0] ?? 0)) > 48 * s) continue
        shapes.push(line(p?.[0] ?? 0, p?.[1] ?? 0, q?.[0] ?? 0, q?.[1] ?? 0, opacity * 0.45, 2))
      }
    }
  }
  for (const level of levels) {
    for (const [x, y] of level) shapes.push(circle(x, y, 6.6 * s, opacity))
  }
  return shapes
}

/** 路径（网格寻路 / TSP 路线）：传 0~1 的归一化坐标 */
export function routePath(points: Point[], x: number, y: number, w: number, h: number, opacity = 0.9, dash = ''): CoverShape[] {
  return [strokePoly(
    points.map(([px, py]) => [r1(x + px * w), r1(y + py * h)] as Point),
    opacity, 3, { close: false, dash }
  )]
}
