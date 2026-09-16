/**
 * demo 卡片封面：按页面的功能给出一张效果图。
 *
 * 分工：
 * - demo-cover-shapes.ts  图元与几何工具（rect / circle / poly）
 * - demo-cover-kits.ts    绘图件（手掌 + 关键点、人脸、骨架、文档、检测框、神经网络、机械臂…）
 * - demo-cover-scenes.ts  逐页场景（107 个 demo 各一张），以及 `分类/slug` → 场景的映射
 * - 本文件                 对外只暴露一个入口：demoCoverArt()
 *
 * 为什么用「按页面画」而不是「按分类画」：分类级图案只能说明「这是视觉类的页面」，
 * 而卡片真正要回答的是「这个页面干什么」。所以这里画的是页面本身的效果图 ——
 * 手势识别出的是手掌与关键点，OCR 出的是文档与文本框，机械臂出的是连杆与关节。
 *
 * 真图入口一直留着：demos.ts 的 `cover` 填了路径就用真图，生成物自动让位；
 * 两者占的是同一个 16:9 格子，所以替换不会引起布局跳动。
 */
import { COVER_HEIGHT, COVER_WIDTH, coverHash, seriesFrom } from './demo-cover-shapes'
import type { CoverShape } from './demo-cover-shapes'
import { DEMO_SCENES, sceneGeneric } from './demo-cover-scenes'
import type { CoverScene } from './demo-cover-scenes'

export interface DemoCoverArt {
  /** 画布尺寸，组件据此设置 viewBox */
  width: number
  height: number
  /** 命中的场景名（兜底时为 'generic'），便于调试与测试断言 */
  scene: string
  shapes: CoverShape[]
}

/**
 * 由卡片自身的信息生成封面图元。
 * 纯函数：同样的 (slug, category) 永远得到同样的结果 —— SSR 与客户端必须一致，否则会水合不匹配。
 */
export function demoCoverArt(slug: string, category: string): DemoCoverArt {
  const key = `${category}/${slug}`
  const scene: CoverScene | undefined = DEMO_SCENES[key]
  const rand = seriesFrom(coverHash(key))
  return {
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    scene: scene ? key : 'generic',
    shapes: (scene ?? sceneGeneric)(rand)
  }
}

/** 该 demo 是否已经配了专属场景（测试用；也方便排查漏配） */
export function hasSceneFor(slug: string, category: string): boolean {
  return `${category}/${slug}` in DEMO_SCENES
}
