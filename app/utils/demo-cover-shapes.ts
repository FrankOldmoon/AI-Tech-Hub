/**
 * 封面几何的最小工具箱：图元类型 + 构造器 + 稳定的伪随机。
 *
 * 图元只用 rect / circle / poly 三种，其中 poly 是主力：
 * - 点坐标是数组，场景里可以任意平移缩放，不必去解析路径字符串；
 * - 既能描边也能填充，画手掌、人脸、骨架这类真实轮廓全靠它。
 *
 * 颜色约定：这里只产出白色形状（数值仅描述几何与透明度），底色由外层的分类渐变提供，
 * 所以同一个场景在浅色与暗色主题下都成立，配色也永远和卡片上的分类色图标一致。
 */

export const COVER_WIDTH = 320
export const COVER_HEIGHT = 180

export type Point = [number, number]

/** 封面里的一枚图元 */
export type CoverShape = { kind: 'rect', x: number, y: number, w: number, h: number, rx: number, opacity: number }
  | { kind: 'circle', cx: number, cy: number, r: number, opacity: number }
  | {
    kind: 'poly'
    points: Point[]
    opacity: number
    mode: 'fill' | 'stroke'
    width: number
    close: boolean
    dash: string
  }

/** 保留一位小数：坐标不需要更高精度，短一点的属性串能省 DOM 体积 */
export function r1(value: number): number {
  return Math.round(value * 10) / 10
}

export function rect(x: number, y: number, w: number, h: number, opacity: number, rx = 0): CoverShape {
  return { kind: 'rect', x: r1(x), y: r1(y), w: r1(w), h: r1(h), rx, opacity }
}

export function circle(cx: number, cy: number, r: number, opacity: number): CoverShape {
  return { kind: 'circle', cx: r1(cx), cy: r1(cy), r: r1(r), opacity }
}

export function fillPoly(points: Point[], opacity: number): CoverShape {
  return { kind: 'poly', points, opacity, mode: 'fill', width: 0, close: true, dash: '' }
}

export function strokePoly(
  points: Point[],
  opacity: number,
  width = 3,
  options: { close?: boolean, dash?: string } = {}
): CoverShape {
  return {
    kind: 'poly',
    points,
    opacity,
    mode: 'stroke',
    width,
    close: options.close ?? false,
    dash: options.dash ?? ''
  }
}

/** 两点直线（描边的退化形式，省得到处写 strokePoly([[x0,y0],[x1,y1]])） */
export function line(x0: number, y0: number, x1: number, y1: number, opacity: number, width = 3): CoverShape {
  return strokePoly([[r1(x0), r1(y0)], [r1(x1), r1(y1)]], opacity, width)
}

/** 圆弧采样成折线：a0/a1 为弧度，0 指向右侧、顺时针为正（SVG 坐标系） */
export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, steps = 14): Point[] {
  const points: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const angle = a0 + (a1 - a0) * (i / steps)
    points.push([r1(cx + Math.cos(angle) * r), r1(cy + Math.sin(angle) * r)])
  }
  return points
}

/** 椭圆采样成闭合折线（画脑袋、气泡、圆角轮廓用） */
export function ellipsePoints(cx: number, cy: number, rx: number, ry: number, steps = 22): Point[] {
  const points: Point[] = []
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    points.push([r1(cx + Math.cos(angle) * rx), r1(cy + Math.sin(angle) * ry)])
  }
  return points
}

/** 圆角矩形采样成闭合折线（rect 只能给 rx，画需要精确轮廓的东西时用这个） */
export function roundRectPoints(x: number, y: number, w: number, h: number, r: number, steps = 5): Point[] {
  const points: Point[] = []
  const corners: Array<[number, number, number]> = [
    [x + w - r, y + r, -Math.PI / 2],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, Math.PI / 2],
    [x + r, y + r, Math.PI]
  ]
  for (const [ccx, ccy, start] of corners) {
    for (let i = 0; i <= steps; i++) {
      const angle = start + (i / steps) * (Math.PI / 2)
      points.push([r1(ccx + Math.cos(angle) * r), r1(ccy + Math.sin(angle) * r)])
    }
  }
  return points
}

/**
 * FNV-1a 32 位散列，输入是 demo 的唯一键 `分类/slug`。
 *
 * 用完整键而不是光用 slug：slug 并不全局唯一（`transformers` 同时存在于 vision 与 nlp），
 * 只按 slug 播种会让两个不同的 demo 得到一样的细节。换实现等于把所有封面抖动重来一遍，
 * 所以它是一份需要保持稳定的「素材」。
 */
export function coverHash(key: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** xorshift32：由种子展开的确定性伪随机序列，返回值落在 [0,1) */
export function seriesFrom(seed: number): () => number {
  // 种子为 0 时 xorshift 会卡死在 0，兜一个非零值
  let state = seed || 0x9e3779b9
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x100000000
  }
}
