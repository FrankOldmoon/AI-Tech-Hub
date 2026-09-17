/**
 * 逐页封面场景：每个 demo 一张「功能效果图」。
 *
 * 这里不做抽象底纹，而是画这个页面到底在干什么：
 *   手势识别 → 手掌 + 21 个关键点 + 骨架；OCR → 文档 + 文本行 + 检测框；
 *   语音合成 → 扬声器 + 声弧 + 声波；机械臂 → 连杆 + 关节。
 * 具体零件都在 demo-cover-kits.ts，本文件只负责摆放与点缀。
 *
 * 三条硬约束（测试会逐点校验）：
 * 1. 绝不写文字：所有案子都是纯几何图形，中英文通用、也不会被截断；
 * 2. 所有坐标必须落在 320×180 画布内，贴边或出界一律视为 bug；
 * 3. 必须是纯函数：同样的 (分类, slug) 每次、以及在 SSR 与客户端都得到完全相同的几何。
 *
 * 允许同一张案子被多个 demo 复用（例如 ASR 与 Whisper 引擎页是同一件事），
 * 但每张案子都由 slug 播种，细节（柱子高度、点的位置）各不相同。
 */
import type { CoverShape, Point } from './demo-cover-shapes'
import { arcPoints, circle, ellipsePoints, fillPoly, line, rect, r1, roundRectPoints, strokePoly } from './demo-cover-shapes'
import {
  arrow, axes, bars, birdGlyph, blob, book, bubble, cart, checker, chip, clusterRing, codeBrackets, colorWheel,
  crosshair, cube, depthBands, detectCorners, docPage, eraser, face, fileCard, filmFrames, fingerprint,
  gauge, globe, gridCell, gridLines, hand, imageFrame, keyDots, labelBox, magnifier, mic, nn, noteGlyph,
  pianoKeys, polyline, probBars, quadruped, robotArm, routePath, scatter, skeleton, sliderGroup, soundArcs,
  sparkles, speaker, spectrum, timeline, treeNodes, verdict
} from './demo-cover-kits'

/** 场景：吃一个确定性随机源，吐出一组图元 */
export type CoverScene = (rand: () => number) => CoverShape[]

/** 确定性正弦采样，用于波动类图形 */
function sine(count: number, cycles: number, phase = 0): number[] {
  return Array.from({ length: count }, (_, i) => 0.5 + 0.45 * Math.sin(phase + (i / (count - 1)) * Math.PI * 2 * cycles))
}

/** 抖动过的小虫（神经进化觅食） */
function bugGlyph(cx: number, cy: number, s: number, opacity: number): CoverShape[] {
  const shapes: CoverShape[] = [
    fillPoly(ellipsePoints(cx, cy, 11 * s, 7.5 * s, 16), opacity),
    line(cx - 10 * s, cy - 5 * s, cx - 17 * s, cy - 11 * s, opacity, 2 * s),
    line(cx - 10 * s, cy + 5 * s, cx - 17 * s, cy + 11 * s, opacity, 2 * s)
  ]
  for (const side of [-1, 1]) {
    for (const offset of [-4, 0, 4]) {
      shapes.push(line(cx + offset * s, cy + side * 6 * s, cx + (offset + 4) * s, cy + side * 13 * s, opacity * 0.8, 1.8 * s))
    }
  }
  shapes.push(circle(cx + 7 * s, cy - 2 * s, 3.4 * s, opacity))
  return shapes
}

// ==================== 语音 ====================

/** 语音合成：扬声器 + 声弧 + 一段输出声波 */
export function sceneTts(rand: () => number): CoverShape[] {
  return [
    ...speaker(86, 84, 1.05),
    ...soundArcs(104, 84, 1.75, 3),
    ...bars(224, 84, 128, 72, 12, rand)
  ]
}

/** 语音识别：麦克风 + 声波 + 识别出的文本行 */
export function sceneAsr(rand: () => number): CoverShape[] {
  return [
    ...mic(58, 84, 0.92),
    ...bars(152, 84, 118, 66, 11, rand),
    rect(228, 54, 78, 7, 0.7, 3.5),
    rect(228, 72, 62, 7, 0.45, 3.5),
    rect(228, 94, 74, 7, 0.5, 3.5),
    rect(228, 112, 48, 7, 0.32, 3.5)
  ]
}

/** 音频分类：波形 + 分类概率条 */
export function sceneSpeechClassify(rand: () => number): CoverShape[] {
  return [
    ...bars(112, 88, 146, 74, 12, rand),
    ...probBars(240, 88, 96, 4, rand)
  ]
}

/** 音高检测：底部波形 + 上升的音高曲线与采样点 */
export function scenePitch(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [...bars(160, 130, 252, 42, 22, rand)]
  const points: Point[] = []
  for (let i = 0; i <= 8; i++) {
    const value = 0.16 + i * 0.098
    points.push([r1(40 + (i / 8) * 240), r1(102 - value * 72)])
  }
  shapes.push(strokePoly(points, 0.95, 3.2))
  for (const [x, y] of points) shapes.push(circle(x, y, 3, 0.95))
  return shapes
}

/** 音频可视化：上下对称的频谱 */
export function sceneSpectrum(rand: () => number): CoverShape[] {
  return [...spectrum(160, 88, 268, 104, 26, rand)]
}

/** 变声：波形 → 旋钮 → 波形 */
export function sceneVoiceFx(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [
    ...bars(74, 88, 96, 62, 8, rand),
    ...bars(246, 88, 96, 62, 8, rand),
    rect(138, 66, 44, 44, 0.14, 22),
    strokePoly(ellipsePoints(160, 88, 22, 22, 24), 0.85, 3),
    line(160, 88, 173, 73, 0.95, 3.4),
    circle(160, 88, 3.6, 0.95)
  ]
  for (let i = 0; i < 4; i++) {
    const angle = -2.2 + i * 0.62
    shapes.push(line(
      160 + Math.cos(angle) * 15, 88 + Math.sin(angle) * 15,
      160 + Math.cos(angle) * 20, 88 + Math.sin(angle) * 20,
      0.4, 2
    ))
  }
  return shapes
}

/** 哼唱转简谱：哼唱声波 → 音符 */
export function sceneHumNotes(rand: () => number): CoverShape[] {
  return [
    ...bars(110, 128, 150, 40, 11, rand),
    ...noteGlyph(212, 74, 1, 0.9),
    ...noteGlyph(252, 58, 0.86, 0.72),
    ...noteGlyph(286, 76, 0.6, 0.5)
  ]
}

/** 语速计：门式仪表 + 逐词的字幕条 */
export function sceneSpeechRate(): CoverShape[] {
  const shapes: CoverShape[] = [...gauge(104, 122, 62, 0.68)]
  shapes.push(rect(196, 96, 104, 7, 0.7, 3.5), rect(196, 114, 82, 7, 0.5, 3.5), rect(196, 132, 96, 7, 0.38, 3.5))
  return shapes
}

/** 节拍器：摆杆 + 摆动弧 + 拍点 */
export function sceneMetronome(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [
    strokePoly(arcPoints(104, 44, 108, 0.62, 1.16), 0.35, 2.4, { dash: '7 6' }),
    circle(104, 44, 6, 0.9),
    line(104, 44, 178, 132, 0.9, 4),
    circle(184, 138, 8, 0.95)
  ]
  for (let i = 0; i < 4; i++) {
    shapes.push(circle(238, 54 + i * 24, i === 1 ? 7 : 4.6, r1(0.9 - i * 0.16)))
  }
  shapes.push(...bars(160, 152, 252, 22, 14, rand))
  return shapes
}

/** 迷你合成器：一排旋钮 + 键盘 */
export function sceneSynth(rand: () => number): CoverShape[] {
  return [
    ...sliderGroup(160, 46, 158, rand, 2),
    ...pianoKeys(160, 122, 256, 60, 12)
  ]
}

/** 语音口令：麦克风 + 四向指令箭头 */
export function sceneVoiceCommand(): CoverShape[] {
  return [
    ...mic(160, 88, 0.84),
    ...arrow(118, 88, 86, 88),
    ...arrow(202, 88, 234, 88),
    ...arrow(160, 46, 160, 28),
    ...arrow(160, 130, 160, 148)
  ]
}

/** 语音克隆：两个人脸 + 麦克风 + 声弧 */
export function sceneVoiceClone(): CoverShape[] {
  return [
    ...face(70, 84, 0.6),
    ...soundArcs(104, 84, 1.1, 2),
    ...mic(160, 84, 0.62),
    ...soundArcs(196, 84, 1.1, 2),
    ...face(250, 84, 0.6)
  ]
}

/** 声纹：指纹 + 声波 */
export function sceneVoiceprint(rand: () => number): CoverShape[] {
  return [
    ...fingerprint(110, 86, 1.22, 0.85),
    ...bars(238, 86, 106, 68, 9, rand)
  ]
}

/** 语音翻译：麦克风 + 一问一答两个气泡 */
export function sceneSpeechTranslate(rand: () => number): CoverShape[] {
  return [
    ...mic(52, 88, 0.72),
    ...bubble(130, 58, 118, 42, 'left', rand),
    ...bubble(214, 122, 118, 42, 'right', rand),
    ...arrow(186, 86, 200, 100, 0.7, 2.6, 7)
  ]
}

/** 有声书：书 + 声弧 + 多个朗读音色 */
export function sceneAudiobook(): CoverShape[] {
  return [
    ...book(112, 96, 1.05),
    ...soundArcs(160, 92, 1.4, 3),
    ...speaker(240, 68, 0.5, 1),
    ...speaker(286, 68, 0.5, 1),
    ...speaker(264, 124, 0.5, 1)
  ]
}

/** 录音工具：麦克风 + 录制红点 + 输入电平 */
export function sceneAudioRecord(rand: () => number): CoverShape[] {
  return [
    ...mic(94, 78, 0.94),
    circle(94, 140, 13, 0.3),
    circle(94, 140, 7.6, 0.95),
    ...bars(240, 88, 108, 64, 9, rand)
  ]
}

/** 音频转格式：一个音频文件 → 另一个容器 */
export function sceneAudioConvert(rand: () => number): CoverShape[] {
  return [
    ...fileCard(76, 90, 62, 80, 'wave', rand),
    ...arrow(116, 90, 164, 90, 0.85, 3.4, 9),
    ...fileCard(212, 98, 62, 80, 'note', rand),
    ...fileCard(240, 86, 62, 80, 'wave', rand)
  ]
}

/** 视频提取音频：视频帧 → 音符与声弧 */
export function sceneVideoToAudio(): CoverShape[] {
  return [
    ...filmFrames(110, 68, 132, 72, 1),
    ...arrow(110, 112, 110, 132, 0.8, 3, 7),
    ...noteGlyph(104, 152, 0.74, 0.92),
    ...soundArcs(122, 152, 1.25, 2)
  ]
}

/** 音频压缩：大波形 → 小波形 */
export function sceneAudioCompress(rand: () => number): CoverShape[] {
  return [
    ...bars(160, 54, 214, 44, 14, rand),
    ...arrow(160, 86, 160, 104, 0.8, 3, 7),
    ...bars(160, 138, 132, 26, 9, rand)
  ]
}

/** 音频裁剪：波形时间轴 + 选区把手 */
export function sceneAudioTrim(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [...timeline(160, 84, 250, 50, rand, 0.28, 0.68)]
  shapes.push(rect(35, 142, 60, 6, 0.3, 3), rect(225, 142, 60, 6, 0.3, 3))
  return shapes
}

// ==================== NLP ====================

/** 文本分类：段落 + 概率条 */
export function sceneTextClassify(rand: () => number): CoverShape[] {
  return [
    rect(36, 46, 116, 11, 0.75, 5),
    rect(36, 66, 100, 8, 0.45, 4),
    rect(36, 84, 120, 8, 0.4, 4),
    rect(36, 102, 88, 8, 0.34, 4),
    ...probBars(240, 88, 96, 4, rand)
  ]
}

/** 语言检测：段落 + 地球 + 候选语言条 */
export function sceneLanguageDetect(): CoverShape[] {
  return [
    rect(30, 54, 96, 10, 0.72, 5),
    rect(30, 74, 78, 7, 0.44, 3.5),
    rect(30, 90, 92, 7, 0.38, 3.5),
    rect(30, 106, 62, 7, 0.3, 3.5),
    ...globe(196, 86, 34, 0.85),
    rect(246, 70, 58, 13, 0.55, 3.5),
    rect(246, 92, 42, 13, 0.3, 3.5)
  ]
}

/** 文本嵌入：段落 → 向量空间的点云 */
export function sceneTextEmbedder(rand: () => number): CoverShape[] {
  return [
    rect(26, 58, 88, 10, 0.72, 5),
    rect(26, 78, 70, 7, 0.46, 3.5),
    rect(26, 94, 84, 7, 0.38, 3.5),
    ...axes(140, 40, 148, 104, 0.32),
    ...scatter(152, 46, 128, 90, 26, rand, 2.6),
    ...clusterRing(186, 72, 26, 0.45),
    ...clusterRing(248, 118, 22, 0.4)
  ]
}

/** 命名实体识别：段落 + 高亮出的实体片段 */
export function sceneNer(): CoverShape[] {
  const shapes: CoverShape[] = [
    rect(36, 62, 76, 15, 0.42, 3),
    rect(36, 98, 108, 15, 0.32, 3),
    rect(36, 134, 62, 15, 0.42, 3)
  ]
  shapes.push(
    rect(36, 46, 180, 9, 0.7, 4.5),
    rect(36, 64, 62, 9, 0.72, 4.5),
    rect(104, 64, 96, 9, 0.62, 4.5),
    rect(36, 82, 150, 9, 0.45, 4.5),
    rect(36, 100, 92, 9, 0.72, 4.5),
    rect(134, 100, 70, 9, 0.5, 4.5),
    rect(36, 118, 168, 9, 0.42, 4.5),
    rect(36, 136, 48, 9, 0.72, 4.5),
    rect(90, 136, 104, 9, 0.4, 4.5),
    rect(36, 154, 120, 9, 0.3, 4.5)
  )
  return shapes
}

/** 零样本文本分类：段落 + 候选标签（命中打勾） */
export function sceneZeroShot(): CoverShape[] {
  return [
    rect(30, 46, 150, 10, 0.72, 5),
    rect(30, 66, 128, 8, 0.45, 4),
    rect(30, 84, 140, 8, 0.4, 4),
    rect(222, 44, 78, 24, 0.22, 5),
    ...verdict(238, 56, 0.8, true, 0.95),
    rect(258, 52, 34, 7, 0.5, 3.5),
    rect(222, 78, 78, 24, 0.14, 5),
    ...verdict(238, 90, 0.55, false, 0.4),
    rect(258, 86, 34, 7, 0.25, 3.5),
    rect(222, 112, 78, 24, 0.14, 5),
    ...verdict(238, 124, 0.55, false, 0.4),
    rect(258, 120, 34, 7, 0.25, 3.5)
  ]
}

/** 文本摘要：长段落 → 短摘要 */
export function sceneSummarize(): CoverShape[] {
  return [
    rect(24, 40, 116, 9, 0.66, 4.5),
    rect(24, 58, 96, 7, 0.42, 3.5),
    rect(24, 74, 112, 7, 0.38, 3.5),
    rect(24, 90, 84, 7, 0.34, 3.5),
    rect(24, 106, 104, 7, 0.3, 3.5),
    rect(24, 122, 70, 7, 0.26, 3.5),
    ...arrow(150, 88, 184, 88, 0.8, 2.8, 8),
    rect(196, 62, 100, 11, 0.78, 5),
    rect(196, 84, 84, 11, 0.6, 5),
    rect(196, 106, 62, 11, 0.42, 5)
  ]
}

/** 问答抽取：段落里的答案片段 + 一个提问气泡 */
export function sceneQa(rand: () => number): CoverShape[] {
  return [
    rect(26, 60, 104, 15, 0.36, 3),
    rect(26, 58, 168, 9, 0.68, 4.5),
    rect(26, 76, 150, 9, 0.45, 4.5),
    rect(26, 94, 92, 9, 0.72, 4.5),
    rect(124, 94, 68, 9, 0.5, 4.5),
    rect(26, 112, 158, 9, 0.42, 4.5),
    rect(26, 130, 120, 9, 0.3, 4.5),
    ...bubble(252, 54, 82, 38, 'left', rand),
    ...arrow(212, 74, 200, 78, 0.55, 2.4, 6)
  ]
}

/** 完形填空：句子中间留出待填的空格 */
export function sceneFillMask(rand: () => number): CoverShape[] {
  return [
    rect(40, 56, 148, 10, 0.62, 5),
    rect(40, 80, 58, 10, 0.62, 5),
    strokePoly(roundRectPoints(106, 76, 70, 18, 5), 0.9, 2.6, { close: true, dash: '6 5' }),
    rect(184, 80, 68, 10, 0.62, 5),
    rect(40, 104, 180, 10, 0.42, 5),
    rect(40, 128, 132, 10, 0.32, 5),
    ...sparkles(146, 40, 2, rand, 22, 7)
  ]
}

/** MediaPipe Text 引擎：段落 + 三个文本任务的标签牌 */
export function sceneMediapipeText(): CoverShape[] {
  return [
    rect(28, 54, 112, 10, 0.7, 5),
    rect(28, 74, 92, 7, 0.44, 3.5),
    rect(28, 90, 106, 7, 0.38, 3.5),
    rect(28, 106, 74, 7, 0.3, 3.5),
    rect(170, 40, 112, 26, 0.16, 6),
    rect(184, 50, 44, 6, 0.6, 3),
    rect(184, 60, 30, 6, 0.35, 3),
    rect(170, 74, 112, 26, 0.16, 6),
    ...globe(190, 87, 9, 0.7),
    rect(206, 83, 52, 7, 0.5, 3.5),
    rect(170, 108, 112, 26, 0.16, 6),
    circle(186, 121, 3.4, 0.75),
    circle(198, 121, 3.4, 0.6),
    circle(210, 121, 3.4, 0.45),
    rect(222, 117, 44, 7, 0.4, 3.5)
  ]
}

/** Transformers.js 引擎：层堆叠 → 文本 */
export function sceneTransformersText(): CoverShape[] {
  const shapes: CoverShape[] = []
  for (let i = 0; i < 4; i++) {
    shapes.push(rect(36, 30 + i * 30, 112, 24, r1(0.16 + i * 0.07), 5))
    shapes.push(strokePoly(roundRectPoints(36, 30 + i * 30, 112, 24, 5), 0.45, 2, { close: true }))
  }
  shapes.push(
    ...arrow(156, 88, 184, 88, 0.8, 2.8, 8),
    rect(196, 60, 100, 9, 0.66, 4.5),
    rect(196, 78, 80, 7, 0.42, 3.5),
    rect(196, 94, 94, 7, 0.36, 3.5),
    rect(196, 110, 66, 7, 0.3, 3.5)
  )
  return shapes
}

// ==================== AIGC ====================

/** 浏览器内 LLM：本机芯片 + 两个对话气泡 */
export function sceneWebllm(rand: () => number): CoverShape[] {
  return [
    ...chip(58, 92, 0.76),
    ...bubble(196, 60, 146, 42, 'left', rand),
    ...bubble(216, 124, 118, 40, 'right', rand)
  ]
}

/** 文生图：文本 → 图像 + 星火 */
export function sceneTextToImage(rand: () => number): CoverShape[] {
  return [
    rect(24, 62, 88, 9, 0.7, 4.5),
    rect(24, 80, 70, 8, 0.45, 4),
    rect(24, 96, 84, 8, 0.38, 4),
    rect(24, 112, 56, 8, 0.3, 4),
    ...arrow(124, 90, 156, 90, 0.8, 2.8, 8),
    ...imageFrame(222, 90, 116, 84, 0.88),
    ...sparkles(176, 46, 2, rand, 20, 7)
  ]
}

/** 图像修复：画面中的一块虚线选区 + 笔刷 */
export function sceneInpaint(): CoverShape[] {
  return [
    ...imageFrame(150, 88, 210, 112, 0.85),
    strokePoly(roundRectPoints(112, 62, 82, 50, 6), 0.9, 2.8, { close: true, dash: '7 6' }),
    ...eraser(222, 126, 0.62)
  ]
}

/** WebGPU 能力诊断：芯片 + 逐项检测结论 */
export function sceneCapabilities(): CoverShape[] {
  const shapes: CoverShape[] = [...chip(74, 90, 0.92)]
  const rows = [46, 84, 122]
  rows.forEach((y, i) => {
    shapes.push(...verdict(140, y, 0.8, i !== 1, i === 1 ? 0.5 : 0.95))
    shapes.push(rect(164, y - 6, i === 1 ? 92 : 128, 12, i === 1 ? 0.2 : 0.42, 3))
  })
  return shapes
}

/** 云端 LLM：云 + 一问一答 */
export function sceneCloudChat(rand: () => number): CoverShape[] {
  return [
    circle(118, 56, 19, 0.55),
    circle(146, 47, 25, 0.55),
    circle(176, 57, 18, 0.55),
    rect(100, 56, 94, 20, 0.4, 10),
    ...bubble(216, 104, 130, 42, 'left', rand),
    ...bubble(148, 148, 112, 36, 'right', rand)
  ]
}

/** 推理对话：网络 + 一步步的思考链 */
export function sceneReasoning(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [...nn(66, 90, 0.56, [3, 4, 3], rand)]
  shapes.push(...arrow(108, 90, 136, 90, 0.7, 2.6, 7))
  const xs = [148, 184, 220, 256]
  xs.forEach((x, i) => {
    shapes.push(rect(x, 78, 22, 24, r1(0.28 + i * 0.16), 4))
    if (i < xs.length - 1) shapes.push(...arrow(x + 23, 90, x + 34, 90, 0.5, 2.2, 6))
  })
  return shapes
}

/** 代码生成与执行：代码尖括号 + 终端窗口 */
export function sceneCodegen(): CoverShape[] {
  const shapes: CoverShape[] = [
    ...codeBrackets(72, 74, 0.86),
    rect(140, 38, 152, 104, 0.14, 6),
    strokePoly(roundRectPoints(140, 38, 152, 104, 6), 0.8, 2.8, { close: true }),
    rect(152, 52, 96, 8, 0.6, 4),
    rect(152, 70, 118, 8, 0.4, 4),
    rect(164, 88, 84, 8, 0.36, 4),
    rect(152, 106, 62, 8, 0.3, 4)
  ]
  shapes.push(fillPoly([[228, 112], [248, 122], [228, 132]], 0.95))
  return shapes
}

/** 多模态对话：图像 + 气泡 */
export function sceneMultimodalChat(rand: () => number): CoverShape[] {
  return [
    ...imageFrame(84, 90, 118, 92, 0.85),
    ...arrow(152, 90, 178, 90, 0.7, 2.6, 7),
    ...bubble(240, 90, 116, 50, 'left', rand)
  ]
}

/** 图生 3D：图像 → 立方体 */
export function sceneTripo3d(rand: () => number): CoverShape[] {
  return [
    ...imageFrame(74, 92, 104, 88, 0.85),
    ...arrow(134, 92, 162, 92, 0.8, 2.8, 8),
    ...cube(234, 92, 1.12),
    ...sparkles(206, 50, 2, rand, 18, 6)
  ]
}

/** 照片说话：肖像 + 声弧 */
export function sceneTalkingPhoto(): CoverShape[] {
  return [
    strokePoly(roundRectPoints(62, 34, 106, 122, 8), 0.3, 2.6, { close: true }),
    ...face(115, 86, 0.94),
    ...soundArcs(178, 86, 1.7, 3)
  ]
}

/** 文生视频：三帧画面 + 星火 */
export function sceneVideoGen(rand: () => number): CoverShape[] {
  return [
    rect(58, 30, 72, 8, 0.4, 4),
    ...filmFrames(150, 88, 200, 84, 3),
    ...sparkles(272, 44, 2, rand, 22, 8)
  ]
}

// ==================== 视觉 ====================

/** YOLO26 引擎页：一张画面上的多个检测框 */
export function sceneYolo(): CoverShape[] {
  return [
    ...imageFrame(160, 92, 252, 128, 0.8),
    ...labelBox(96, 78, 74, 62, 0.92),
    ...labelBox(198, 70, 62, 56, 0.72),
    ...labelBox(238, 124, 48, 38, 0.55)
  ]
}

/** MediaPipe 引擎页：手部、人脸、姿态三种任务的并排 */
export function sceneMediapipe(): CoverShape[] {
  return [
    ...hand(72, 100, 0.68),
    ...face(160, 74, 0.6),
    ...skeleton(248, 98, 0.5, 'stand')
  ]
}

/** Transformers.js 引擎（视觉）：层堆叠 → 图像 */
export function sceneTransformersVision(): CoverShape[] {
  const shapes: CoverShape[] = []
  for (let i = 0; i < 4; i++) {
    shapes.push(rect(36, 30 + i * 30, 108, 24, r1(0.16 + i * 0.07), 5))
    shapes.push(strokePoly(roundRectPoints(36, 30 + i * 30, 108, 24, 5), 0.45, 2, { close: true }))
  }
  shapes.push(
    ...arrow(152, 88, 180, 88, 0.8, 2.8, 8),
    ...imageFrame(240, 88, 108, 86, 0.85)
  )
  return shapes
}

/** 目标检测（能力对比）：并排两个实现，各给出一个框 */
export function sceneDetectCompare(): CoverShape[] {
  return [
    rect(30, 32, 124, 116, 0.1, 6),
    strokePoly(roundRectPoints(30, 32, 124, 116, 6), 0.4, 2.4, { close: true }),
    ...detectCorners(92, 92, 84, 72, 0.9),
    line(160, 26, 160, 154, 0.22, 2),
    rect(166, 32, 124, 116, 0.1, 6),
    strokePoly(roundRectPoints(166, 32, 124, 116, 6), 0.4, 2.4, { close: true }),
    ...detectCorners(228, 92, 84, 72, 0.9)
  ]
}

/** 图像分类：一张图 + 分类概率 */
export function sceneClassify(rand: () => number): CoverShape[] {
  return [
    ...imageFrame(96, 90, 124, 104, 0.85),
    ...probBars(240, 90, 100, 4, rand)
  ]
}

/** 图像分割：同一主体被切成若干区域 */
export function sceneSegmentation(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [
    fillPoly(ellipsePoints(160, 92, 62, 54, 24), 0.16),
    strokePoly(ellipsePoints(160, 92, 62, 54, 24), 0.5, 2.4, { close: true, dash: '7 6' })
  ]
  shapes.push(...blob(136, 74, 26, rand, 0.62))
  shapes.push(...blob(188, 106, 24, rand, 0.45))
  shapes.push(...blob(146, 118, 20, rand, 0.34))
  shapes.push(...blob(190, 66, 18, rand, 0.5))
  return shapes
}

/** 抠图：主体 + 透明棋盘格 + 虚线描边 */
export function sceneMatting(): CoverShape[] {
  return [
    ...checker(160, 92, 244, 132, 21, 0.2),
    strokePoly(roundRectPoints(120, 82, 80, 62, 18), 0.8, 2.6, { close: true, dash: '7 6' }),
    strokePoly(ellipsePoints(160, 66, 26, 30, 22), 0.8, 2.6, { close: true, dash: '7 6' }),
    fillPoly(ellipsePoints(160, 66, 20, 24, 20), 0.95),
    fillPoly([
      [132, 142], [136, 100], [146, 92], [174, 92], [184, 100], [188, 142]
    ].map(([x, y]) => [r1(x ?? 0), r1(y ?? 0)] as Point), 0.95)
  ]
}

/** 深度估计：主体 + 远近分层的深度条带 */
export function sceneDepth(): CoverShape[] {
  return [
    rect(30, 44, 96, 96, 0.1, 6),
    strokePoly(roundRectPoints(30, 44, 96, 96, 6), 0.3, 2.2, { close: true }),
    fillPoly(ellipsePoints(78, 76, 21, 23, 20), 0.9),
    fillPoly([[55, 140], [59, 102], [69, 96], [87, 96], [97, 102], [101, 140]]
      .map(([x, y]) => [r1(x ?? 0), r1(y ?? 0)] as Point), 0.9),
    ...arrow(140, 92, 166, 92, 0.7, 2.6, 7),
    ...depthBands(240, 92, 112, 100, 5)
  ]
}

/** 全身姿态：骨架 + 人体检测框 */
export function scenePose(): CoverShape[] {
  return [
    ...detectCorners(160, 92, 112, 122, 0.45, 3, 0.18),
    ...skeleton(160, 92, 0.84, 'stand')
  ]
}

/** 简笔画识别：手绘的猫 + 识别结果 */
export function sceneSketch(): CoverShape[] {
  const shapes: CoverShape[] = [
    strokePoly(ellipsePoints(110, 96, 34, 28, 24), 0.9, 2.8, { close: true }),
    fillPoly([[88, 74], [80, 46], [104, 64]], 0.85),
    fillPoly([[132, 74], [140, 46], [116, 64]], 0.85),
    circle(98, 92, 3.6, 0.95),
    circle(122, 92, 3.6, 0.95),
    line(110, 100, 110, 106, 0.7, 2.2)
  ]
  shapes.push(strokePoly(arcPoints(110, 106, 9, 0.25 * Math.PI, 0.75 * Math.PI), 0.7, 2.2))
  for (const [x0, y0, x1, y1] of [[78, 96, 60, 90], [78, 104, 60, 110], [142, 96, 160, 90], [142, 104, 160, 110]]) {
    shapes.push(line(x0 ?? 0, y0 ?? 0, x1 ?? 0, y1 ?? 0, 0.45, 1.8))
  }
  shapes.push(rect(196, 84, 100, 26, 0.22, 6), rect(206, 93, 52, 8, 0.85, 4), rect(262, 93, 26, 8, 0.4, 3))
  return shapes
}

/** 图像查看器：画面 + 放大镜 + 信息条 */
export function sceneViewer(): CoverShape[] {
  return [
    ...imageFrame(120, 90, 152, 116, 0.85),
    ...magnifier(232, 66, 0.95),
    rect(206, 106, 88, 7, 0.4, 3.5),
    rect(206, 120, 66, 7, 0.3, 3.5),
    rect(206, 134, 76, 7, 0.24, 3.5)
  ]
}

/** 图像变换：网格上被平移旋转的四边形 */
export function sceneTransform(): CoverShape[] {
  return [
    ...gridLines(40, 32, 240, 116, 8, 4, 0.16),
    strokePoly([[96, 74], [148, 74], [148, 120], [96, 120]], 0.4, 2.4, { close: true }),
    strokePoly([[176, 52], [272, 74], [246, 140], [168, 116]], 0.92, 3, { close: true }),
    ...arrow(150, 76, 168, 62, 0.7, 2.4, 7),
    ...arrow(150, 118, 168, 128, 0.7, 2.4, 7)
  ]
}

/** 像素原理：小图与放大后的像素块 */
export function scenePixel(): CoverShape[] {
  const shapes: CoverShape[] = [
    ...gridLines(52, 46, 92, 92, 4, 4, 0.3),
    gridCell(52, 46, 92, 92, 4, 4, 1, 1, 0.85),
    gridCell(52, 46, 92, 92, 4, 4, 2, 1, 0.55),
    gridCell(52, 46, 92, 92, 4, 4, 1, 2, 0.4),
    ...arrow(156, 92, 186, 92, 0.8, 2.8, 8),
    ...gridLines(200, 52, 88, 88, 2, 2, 0.3),
    gridCell(200, 52, 88, 88, 2, 2, 0, 0, 0.8),
    gridCell(200, 52, 88, 88, 2, 2, 1, 0, 0.45),
    gridCell(200, 52, 88, 88, 2, 2, 0, 1, 0.3),
    gridCell(200, 52, 88, 88, 2, 2, 1, 1, 0.18)
  ]
  return shapes
}

/** 颜色处理：色环 + 色卡 */
export function sceneColor(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [...colorWheel(94, 90, 58, rand)]
  shapes.push(
    rect(180, 50, 116, 20, 0.85, 5),
    rect(180, 80, 116, 20, 0.5, 5),
    rect(180, 110, 116, 20, 0.28, 5)
  )
  return shapes
}

/** 图像调整：滑块 + 直方图 */
export function sceneAdjustment(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [...sliderGroup(94, 90, 108, rand, 3)]
  for (let i = 0; i < 8; i++) {
    const h = 12 + rand() * 62
    shapes.push(rect(184 + i * 13.6, 142 - h, 10, h, r1(0.3 + rand() * 0.4), 2))
  }
  shapes.push(line(178, 146, 296, 146, 0.4, 2.4))
  return shapes
}

/** 图像滤镜：原图 + 三种风格化结果 */
export function sceneFilters(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [
    ...imageFrame(74, 88, 104, 92, 0.85),
    ...arrow(136, 88, 158, 88, 0.7, 2.6, 7)
  ]
  const rows = [44, 84, 124]
  rows.forEach((y, i) => {
    shapes.push(rect(172, y, 120, 36, 0.14, 5))
    if (i === 0) {
      const values = sine(14, 1.6, i)
      shapes.push(...polyline(values, 182, y + 6, 100, 24, 0.8, 2.4))
    } else if (i === 1) {
      shapes.push(...scatter(186, y + 8, 92, 20, 10, rand, 1.6))
    } else {
      shapes.push(...polyline([0.2, 0.75, 0.3, 0.85, 0.35, 0.7, 0.25], 182, y + 6, 100, 24, 0.75, 2.4))
    }
  })
  return shapes
}

/** 噪声与增强：噪点图 → 干净图 */
export function sceneEnhancement(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [
    rect(30, 44, 110, 96, 0.1, 6),
    strokePoly(roundRectPoints(30, 44, 110, 96, 6), 0.5, 2.4, { close: true }),
    ...arrow(152, 92, 180, 92, 0.8, 2.8, 8),
    rect(196, 44, 110, 96, 0.1, 6),
    strokePoly(roundRectPoints(196, 44, 110, 96, 6), 0.7, 2.4, { close: true }),
    fillPoly(ellipsePoints(252, 92, 34, 30, 20), 0.8)
  ]
  shapes.push(...scatter(38, 52, 94, 80, 26, rand, 2))
  shapes.push(...scatter(204, 52, 94, 80, 4, rand, 1.6))
  return shapes
}

/** 阈值与形态学：形状被膨胀/腐蚀 */
export function sceneMorphology(): CoverShape[] {
  return [
    strokePoly(ellipsePoints(72, 92, 32, 26, 22), 0.45, 2.4, { close: true, dash: '6 5' }),
    fillPoly(ellipsePoints(72, 92, 22, 17, 18), 0.85),
    ...arrow(120, 92, 152, 92, 0.8, 2.8, 8),
    fillPoly(ellipsePoints(222, 92, 40, 34, 22), 0.5),
    fillPoly(ellipsePoints(196, 76, 17, 14, 16), 0.5),
    fillPoly(ellipsePoints(250, 108, 16, 13, 16), 0.5),
    strokePoly(ellipsePoints(222, 92, 40, 34, 22), 0.8, 2.4, { close: true })
  ]
}

/** 边缘与形状检测：原图 + 只保留轮廓 */
export function sceneEdge(): CoverShape[] {
  return [
    fillPoly(ellipsePoints(74, 92, 34, 30, 22), 0.4),
    fillPoly([[74, 62], [104, 92], [74, 122]].map(([x, y]) => [r1(x ?? 0), r1(y ?? 0)] as Point), 0.6),
    ...arrow(126, 92, 158, 92, 0.8, 2.8, 8),
    strokePoly(ellipsePoints(222, 92, 34, 30, 22), 0.9, 2.6, { close: true }),
    strokePoly([[222, 62], [252, 92], [222, 122]], 0.9, 2.6, { close: true }),
    strokePoly(ellipsePoints(222, 92, 18, 15, 18), 0.5, 2, { close: true })
  ]
}

/** 颜色与轮廓检测：轮廓 + 外接框 + 取色结果 */
export function sceneContour(): CoverShape[] {
  const outline: Point[] = [
    [86, 58], [126, 46], [158, 70], [150, 116], [112, 140], [74, 124], [66, 88]
  ]
  return [
    fillPoly(outline, 0.22),
    strokePoly(outline, 0.92, 3, { close: true }),
    ...detectCorners(112, 92, 100, 102, 0.6, 2.6, 0.16),
    rect(196, 46, 96, 22, 0.8, 4),
    rect(196, 80, 96, 22, 0.5, 4),
    rect(196, 114, 96, 22, 0.3, 4)
  ]
}

/** 特征检测：主体 + 特征点 + 准星 */
export function sceneFeatures(): CoverShape[] {
  const shapes: CoverShape[] = [
    fillPoly(roundRectPoints(96, 42, 104, 100, 8), 0.16),
    strokePoly(roundRectPoints(96, 42, 104, 100, 8), 0.6, 2.6, { close: true })
  ]
  const points: Point[] = [[116, 62], [148, 58], [178, 74], [126, 92], [164, 96], [140, 118], [186, 118], [110, 128]]
  shapes.push(...keyDots(points, 3, 0.9))
  shapes.push(...crosshair(164, 96, 0.9, 0.95))
  return shapes
}

/** 人脸工作室：人脸 + 68 点特征 */
export function sceneFace(): CoverShape[] {
  return [
    ...detectCorners(160, 88, 96, 112, 0.45, 3, 0.18),
    ...face(160, 88, 1, { landmarks: true })
  ]
}

/** 人脸注册与识别：两张脸 + 匹配结论 */
export function sceneFaceRecognition(): CoverShape[] {
  return [
    ...face(80, 88, 0.7),
    ...face(240, 88, 0.7),
    ...arrow(116, 88, 132, 88, 0.55, 2.4, 6),
    ...arrow(204, 88, 188, 88, 0.55, 2.4, 6),
    circle(160, 88, 26, 0.2),
    strokePoly(ellipsePoints(160, 88, 26, 26, 22), 0.45, 2.2, { close: true }),
    ...verdict(160, 88, 1.25, true, 0.95)
  ]
}

/** OCR：文档 + 文本行 + 检测框 + 放大镜 */
export function sceneOcr(rand: () => number): CoverShape[] {
  return [
    ...docPage(120, 88, 130, 130, rand, 6),
    ...detectCorners(120, 90, 96, 22, 0.85, 3, 0.3),
    ...detectCorners(120, 124, 96, 22, 0.6, 3, 0.3),
    ...magnifier(252, 68, 0.82),
    rect(232, 110, 68, 7, 0.42, 3.5),
    rect(232, 126, 52, 7, 0.3, 3.5)
  ]
}

/** 录制工具：摄像头 + 录制红点 + 录制画面 */
export function sceneRecorder(): CoverShape[] {
  const shapes: CoverShape[] = [
    rect(30, 56, 108, 74, 0.14, 8),
    strokePoly(roundRectPoints(30, 56, 108, 74, 8), 0.7, 2.6, { close: true }),
    rect(46, 44, 34, 14, 0.5, 3)
  ]
  shapes.push(fillPoly(ellipsePoints(74, 93, 25, 25, 22), 0.2))
  shapes.push(strokePoly(ellipsePoints(74, 93, 25, 25, 22), 0.8, 2.4, { close: true }))
  shapes.push(fillPoly(ellipsePoints(74, 93, 13, 13, 18), 0.65))
  shapes.push(circle(116, 70, 7, 0.95), strokePoly(ellipsePoints(116, 70, 12, 12, 18), 0.4, 2, { close: true }))
  shapes.push(
    rect(176, 50, 122, 86, 0.1, 6),
    strokePoly(roundRectPoints(176, 50, 122, 86, 6), 0.6, 2.6, { close: true }),
    fillPoly([[222, 76], [246, 93], [222, 110]], 0.85)
  )
  return shapes
}

/** 图片格式转换：一张图 → 三种容器 */
export function sceneImageConvert(rand: () => number): CoverShape[] {
  return [
    ...imageFrame(62, 90, 88, 92, 0.85),
    ...arrow(116, 90, 142, 90, 0.8, 2.8, 8),
    ...fileCard(176, 90, 40, 58, 'image', rand),
    ...fileCard(230, 90, 40, 58, 'image', rand),
    ...fileCard(284, 90, 40, 58, 'image', rand)
  ]
}

/** 视频格式转换：视频帧 → 不同容器 */
export function sceneVideoConvert(rand: () => number): CoverShape[] {
  return [
    ...filmFrames(76, 90, 104, 72, 1),
    ...arrow(138, 90, 162, 90, 0.8, 2.8, 8),
    ...fileCard(196, 90, 40, 56, 'film', rand),
    ...fileCard(240, 90, 40, 56, 'plain', rand),
    ...fileCard(284, 90, 40, 56, 'film', rand)
  ]
}

/** 图片压缩：大图 → 小图（体积下降） */
export function sceneImageCompress(): CoverShape[] {
  return [
    ...imageFrame(94, 84, 130, 108, 0.85),
    ...arrow(170, 84, 200, 84, 0.8, 2.8, 8),
    ...imageFrame(250, 92, 80, 56, 0.6),
    rect(228, 136, 44, 8, 0.4, 4),
    rect(228, 150, 28, 8, 0.26, 4)
  ]
}

/** 视频裁剪：帧条 + 时间轴选区 */
export function sceneVideoTrim(rand: () => number): CoverShape[] {
  return [
    ...filmFrames(160, 44, 200, 30, 3),
    ...timeline(160, 104, 250, 46, rand, 0.26, 0.62)
  ]
}

/** 视频压缩：帧条 + 码率阶梯下降 */
export function sceneVideoCompress(): CoverShape[] {
  return [
    ...filmFrames(160, 52, 220, 52, 3),
    ...arrow(160, 90, 160, 108, 0.7, 2.6, 7),
    rect(94, 122, 44, 30, 0.5, 3),
    rect(146, 132, 44, 20, 0.4, 3),
    rect(198, 140, 44, 12, 0.3, 3)
  ]
}

// ==================== 机器学习 ====================

/** CNN 内部可视化：输入 → 特征图 → 分类输出 */
export function sceneCnnExplainer(rand: () => number): CoverShape[] {
  return [
    rect(24, 52, 54, 72, 0.12, 4),
    strokePoly(roundRectPoints(24, 52, 54, 72, 4), 0.6, 2.4, { close: true }),
    ...gridLines(24, 52, 54, 72, 3, 4, 0.22),
    ...arrow(86, 88, 108, 88, 0.7, 2.6, 7),
    rect(116, 40, 52, 48, 0.5, 4),
    rect(116, 96, 52, 48, 0.32, 4),
    ...arrow(176, 88, 198, 88, 0.7, 2.6, 7),
    ...probBars(258, 88, 76, 4, rand)
  ]
}

/** 训练图片分类器：相机 + 累积的样本 + 完成结论 */
export function sceneTrainImage(): CoverShape[] {
  const shapes: CoverShape[] = [
    strokePoly(roundRectPoints(26, 56, 88, 62, 6), 0.6, 2.4, { close: true }),
    rect(40, 46, 34, 12, 0.45, 3),
    strokePoly(ellipsePoints(70, 87, 17, 17, 20), 0.75, 2.2, { close: true }),
    circle(70, 87, 9, 0.6),
    rect(126, 48, 62, 46, 0.18, 4),
    rect(134, 60, 62, 46, 0.3, 4),
    rect(142, 72, 62, 46, 0.5, 4),
    circle(248, 88, 26, 0.18)
  ]
  shapes.push(...verdict(248, 88, 1.15, true))
  return shapes
}

/** 训练声音分类器：麦克风 + 样本卡 + 完成结论 */
export function sceneTrainAudio(): CoverShape[] {
  const shapes: CoverShape[] = [
    ...mic(62, 84, 0.78),
    rect(126, 48, 62, 46, 0.18, 4),
    rect(134, 60, 62, 46, 0.3, 4),
    rect(142, 72, 62, 46, 0.5, 4),
    circle(248, 88, 26, 0.18)
  ]
  shapes.push(...verdict(248, 88, 1.15, true))
  return shapes
}

/** 训练姿态分类器：骨架 + 样本卡 + 完成结论 */
export function sceneTrainPose(): CoverShape[] {
  const shapes: CoverShape[] = [
    ...skeleton(64, 92, 0.58, 'stand'),
    rect(126, 48, 62, 46, 0.18, 4),
    rect(134, 60, 62, 46, 0.3, 4),
    rect(142, 72, 62, 46, 0.5, 4),
    circle(248, 88, 26, 0.18)
  ]
  shapes.push(...verdict(248, 88, 1.15, true))
  return shapes
}

/** 训练文本分类器：段落 + 样本卡 + 完成结论 */
export function sceneTrainText(): CoverShape[] {
  const shapes: CoverShape[] = [
    rect(26, 60, 74, 10, 0.68, 5),
    rect(26, 80, 60, 8, 0.44, 4),
    rect(26, 96, 72, 8, 0.38, 4),
    rect(26, 112, 48, 8, 0.3, 4),
    rect(126, 48, 62, 46, 0.18, 4),
    rect(134, 60, 62, 46, 0.3, 4),
    rect(142, 72, 62, 46, 0.5, 4),
    circle(248, 88, 26, 0.18)
  ]
  shapes.push(...verdict(248, 88, 1.15, true))
  return shapes
}

/** 神经网络游乐场：小网络 + 收敛曲线 */
export function scenePlayground(rand: () => number): CoverShape[] {
  const values = [0.86, 0.68, 0.52, 0.42, 0.34, 0.29, 0.25, 0.22]
  return [
    ...nn(70, 88, 0.68, [3, 4, 3], rand),
    ...axes(130, 40, 154, 100, 0.28),
    ...polyline(values, 138, 46, 138, 86, 0.95, 3)
  ]
}

/** K-Means：点云被三种颜色（透明度）圈成三簇 */
export function sceneKmeans(rand: () => number): CoverShape[] {
  return [
    ...axes(40, 34, 240, 106, 0.28),
    ...scatter(52, 44, 216, 86, 34, rand, 2.6),
    ...clusterRing(104, 72, 30, 0.45),
    ...clusterRing(196, 62, 26, 0.45),
    ...clusterRing(154, 118, 26, 0.45),
    circle(104, 72, 4.4, 0.95),
    circle(196, 62, 4.4, 0.95),
    circle(154, 118, 4.4, 0.95)
  ]
}

/** 回归拟合：散点 + 拟合曲线 */
export function sceneRegression(rand: () => number): CoverShape[] {
  return [
    ...axes(40, 34, 240, 106, 0.34),
    ...scatter(56, 46, 208, 84, 22, rand, 3),
    ...polyline([0.15, 0.3, 0.42, 0.55, 0.7, 0.85], 56, 44, 208, 86, 0.95, 3.4)
  ]
}

/** MNIST：手写数字 + 画布网格 + 输出概率 */
export function sceneMnist(rand: () => number): CoverShape[] {
  return [
    rect(36, 32, 100, 112, 0.1, 6),
    strokePoly(roundRectPoints(36, 32, 100, 112, 6), 0.6, 2.4, { close: true }),
    ...gridLines(36, 32, 100, 112, 4, 4, 0.12),
    strokePoly([[62, 58], [122, 58], [86, 124]], 0.95, 5),
    ...arrow(146, 88, 176, 88, 0.7, 2.6, 7),
    ...probBars(250, 88, 96, 4, rand)
  ]
}

/** CartPole：小车 + 摆杆 + 轨道 */
export function sceneCartpole(): CoverShape[] {
  return [
    line(40, 150, 280, 150, 0.28, 2.6),
    strokePoly([[160, 44], [160, 122]], 0.18, 2, { dash: '6 6' }),
    ...cart(160, 132, 0.9),
    line(160, 124, 206, 50, 0.92, 4.6),
    circle(208, 47, 5.6, 0.9)
  ]
}

/** 图像主色调：取出的主色卡 + 对应的像素点 */
export function scenePalette(rand: () => number): CoverShape[] {
  return [
    rect(36, 52, 76, 76, 0.85, 8),
    rect(122, 52, 76, 76, 0.5, 8),
    rect(208, 52, 76, 76, 0.28, 8),
    ...scatter(40, 136, 240, 22, 18, rand, 2.4)
  ]
}

/** 决策树：分叉结构 + 叶子结论 */
export function sceneDecisionTree(): CoverShape[] {
  return [
    ...treeNodes(160, 92, 0.95, 0.88),
    rect(96, 140, 44, 14, 0.5, 3),
    rect(160, 140, 44, 14, 0.34, 3),
    rect(224, 140, 44, 14, 0.24, 3)
  ]
}

/** Flappy Bird 神经进化：小鸟 + 管道 + 地面 */
export function sceneFlappy(): CoverShape[] {
  return [
    line(16, 152, 304, 152, 0.28, 2.6),
    rect(60, 14, 42, 54, 0.32, 3),
    rect(60, 104, 42, 44, 0.32, 3),
    rect(224, 14, 42, 62, 0.45, 3),
    rect(224, 108, 42, 40, 0.45, 3),
    fillPoly(ellipsePoints(150, 84, 24, 18, 20), 0.9),
    fillPoly([[138, 78], [152, 68], [158, 88]], 0.55),
    circle(162, 78, 3.4, 0.95),
    fillPoly([[170, 82], [186, 90], [170, 96]], 0.85)
  ]
}

/** 神经进化觅食：小虫 + 食物点 */
export function sceneForagers(rand: () => number): CoverShape[] {
  return [
    ...scatter(40, 40, 240, 110, 12, rand, 2),
    ...bugGlyph(74, 62, 1.25, 0.9),
    ...bugGlyph(150, 116, 1.1, 0.7),
    ...bugGlyph(246, 76, 1.15, 0.85)
  ]
}

/** 鸟群涌现：一群朝向各异的小鸟 + 邻近连线 */
export function sceneBoids(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = []
  const spots: Point[] = []
  for (let i = 0; i < 9; i++) {
    const x = r1(50 + rand() * 220)
    const y = r1(40 + rand() * 100)
    spots.push([x, y])
    shapes.push(...birdGlyph(x, y, 1.1, rand() * Math.PI * 2, r1(0.6 + rand() * 0.35)))
  }
  for (let i = 0; i < spots.length - 1; i++) {
    const p = spots[i]
    const q = spots[i + 1]
    if (!p || !q) continue
    shapes.push(line(p[0], p[1], q[0], q[1], 0.12, 1.6))
  }
  return shapes
}

/** 扩散模型：从纯噪声四步去噪成清晰图像 */
export function sceneDiffusion(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = []
  for (let i = 0; i < 4; i++) {
    const x = 20 + i * 74
    shapes.push(rect(x, 52, 62, 80, r1(0.08 + i * 0.04), 4))
    shapes.push(strokePoly(roundRectPoints(x, 52, 62, 80, 4), r1(0.3 + i * 0.2), 2.2, { close: true }))
    shapes.push(...scatter(x + 6, 58, 50, 68, 12 - i * 3, rand, 2))
    if (i > 0) shapes.push(...blob(x + 31, 92, 20, rand, r1(0.1 + i * 0.2)))
  }
  return shapes
}

/** Q-Learning 网格世界：格盘 + 一条折线路径 + 起终点 */
export function sceneGridworld(): CoverShape[] {
  return [
    ...gridLines(40, 30, 240, 120, 6, 3, 0.2),
    gridCell(40, 30, 240, 120, 6, 3, 5, 2, 0.4),
    ...routePath([[0.08, 0.83], [0.08, 0.17], [0.42, 0.17], [0.42, 0.83], [0.75, 0.83], [0.92, 0.83]], 40, 30, 240, 120, 0.9),
    circle(59.2, 129.6, 5, 0.95)
  ]
}

/** 波函数坍缩：格盘中已确定与未定的格子 */
export function sceneWaveCollapse(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [...gridLines(40, 30, 240, 120, 6, 3, 0.18)]
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      const resolved = rand() > 0.5
      shapes.push(gridCell(40, 30, 240, 120, 6, 3, col, row, resolved ? r1(0.55 + rand() * 0.3) : 0.1, 3))
    }
  }
  return shapes
}

/** 优化器竞赛：三条下降速度不同的曲线 */
export function sceneOptimizers(): CoverShape[] {
  return [
    ...axes(40, 30, 240, 110, 0.3),
    ...polyline([0.9, 0.4, 0.22, 0.16, 0.13, 0.11], 48, 36, 224, 96, 0.95, 3),
    ...polyline([0.9, 0.7, 0.55, 0.44, 0.36, 0.31], 48, 36, 224, 96, 0.6, 3),
    ...polyline([0.9, 0.86, 0.7, 0.66, 0.5, 0.44], 48, 36, 224, 96, 0.34, 3)
  ]
}

/** 反应-扩散：一圈斑点花纹 */
export function sceneReactionDiffusion(rand: () => number): CoverShape[] {
  return [
    ...blob(70, 58, 22, rand, 0.6),
    ...blob(140, 44, 16, rand, 0.44),
    ...blob(212, 62, 20, rand, 0.54),
    ...blob(96, 116, 18, rand, 0.5),
    ...blob(170, 108, 24, rand, 0.62),
    ...blob(250, 122, 16, rand, 0.4),
    circle(126, 84, 4, 0.5),
    circle(196, 130, 4, 0.5),
    circle(56, 96, 3.4, 0.42)
  ]
}

/** 元胞自动机：格盘上随机存活的细胞 */
export function sceneAutomata(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [...gridLines(32, 34, 256, 112, 8, 4, 0.16)]
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) {
      if (rand() > 0.58) shapes.push(gridCell(32, 34, 256, 112, 8, 4, col, row, 0.85, 3))
    }
  }
  return shapes
}

/** 奇怪吸引子：螺旋轨迹 */
export function sceneAttractor(): CoverShape[] {
  const points: Point[] = []
  for (let i = 0; i <= 27; i++) {
    const radius = 8 + i * 4.4
    const angle = i * 0.55
    points.push([r1(160 + Math.cos(angle) * radius), r1(90 + Math.sin(angle) * radius * 0.58)])
  }
  return [
    strokePoly(points, 0.85, 2.6),
    circle(160, 90, 3.4, 0.9)
  ]
}

/** 傅里叶本轮：大圆 + 本轮 + 展开出的正弦 */
export function sceneFourier(): CoverShape[] {
  return [
    strokePoly(ellipsePoints(92, 88, 50, 50, 26), 0.28, 2.4, { close: true }),
    line(92, 88, 128.6, 54, 0.4, 2),
    strokePoly(ellipsePoints(128.6, 54, 15, 15, 20), 0.7, 2.2, { close: true }),
    circle(143.6, 54, 3.4, 0.95),
    ...polyline(sine(18, 2.2), 170, 66, 126, 44, 0.85, 2.6)
  ]
}

/** 黏菌寻路：节点网络 + 食物源 */
export function sceneSlimeMold(): CoverShape[] {
  const nodes: Point[] = [[74, 52], [140, 40], [208, 58], [92, 120], [178, 132], [248, 112], [152, 88]]
  const edges: Array<[number, number]> = [[0, 1], [1, 2], [0, 3], [3, 6], [6, 4], [4, 5], [2, 5], [1, 6], [6, 3]]
  const shapes: CoverShape[] = []
  for (const [a, b] of edges) {
    const p = nodes[a]
    const q = nodes[b]
    if (!p || !q) continue
    shapes.push(line(p[0], p[1], q[0], q[1], 0.34, 3))
  }
  shapes.push(circle(74, 52, 10, 0.3), circle(248, 112, 10, 0.3))
  for (const [x, y] of nodes) shapes.push(circle(x, y, 5, 0.8))
  return shapes
}

/** 遗传算法解旅行商：城市 + 闭合路线 */
export function sceneTsp(rand: () => number): CoverShape[] {
  const cities: Point[] = []
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2 - Math.PI / 2
    const radius = 60 + (rand() - 0.5) * 16
    cities.push([r1(160 + Math.cos(angle) * radius), r1(90 + Math.sin(angle) * radius * 0.72)])
  }
  cities.push([150, 62], [190, 120])
  const shapes: CoverShape[] = [strokePoly(cities, 0.5, 2.4, { close: true })]
  for (const [x, y] of cities) shapes.push(circle(x, y, 4, 0.9))
  return shapes
}

/** 寻路可视化：格盘 + 绕开障碍的路径 */
export function scenePathfinding(): CoverShape[] {
  const shapes: CoverShape[] = [
    ...gridLines(36, 30, 248, 120, 7, 3, 0.18),
    gridCell(36, 30, 248, 120, 7, 3, 2, 0, 0.55),
    gridCell(36, 30, 248, 120, 7, 3, 3, 0, 0.55),
    gridCell(36, 30, 248, 120, 7, 3, 0, 2, 0.55),
    gridCell(36, 30, 248, 120, 7, 3, 1, 2, 0.55),
    ...routePath([[0.05, 0.5], [0.35, 0.5], [0.35, 0.85], [0.65, 0.85], [0.65, 0.5], [0.95, 0.5]], 36, 30, 248, 120, 0.92, '5 5')
  ]
  return shapes
}

/** 图像处理流水线：三帧连着走，左帧噪点、右帧提纯 —— 中间用箭头表示「上一步的输出是下一步的输入」 */
export function scenePipeline(): CoverShape[] {
  const noise: Point[] = [[40, 74], [54, 88], [46, 104], [66, 70], [72, 96], [60, 110], [36, 92], [78, 82]]
  const edges: Point[] = [[238, 74], [250, 86], [266, 74], [281, 90], [244, 104], [262, 110], [281, 102]]
  return [
    ...imageFrame(56, 92, 74, 62, 0.5),
    ...keyDots(noise, 2.2, 0.75),
    ...arrow(98, 92, 120, 92, 0.75, 2.6, 7),
    ...imageFrame(158, 92, 74, 62, 0.7),
    strokePoly([[132, 92], [150, 76], [168, 92], [184, 78]], 0.6, 2.4),
    ...arrow(200, 92, 222, 92, 0.75, 2.6, 7),
    ...imageFrame(260, 92, 74, 62, 0.92),
    ...keyDots(edges, 2.2, 0.9),
    ...detectCorners(260, 92, 84, 72, 0.9, 3, 0.22)
  ]
}

// ==================== 机器人 ====================

/** 机械臂仿真器：二连杆 + 底座 */
export function sceneRebotArm(): CoverShape[] {
  return [
    line(30, 140, 290, 140, 0.24, 2.6),
    ...robotArm(150, 84, 1, -1.15, -0.25)
  ]
}

/** 四足仿真器：机器鸭 + 地面 */
export function sceneMicroduck(): CoverShape[] {
  return [
    line(24, 126, 296, 126, 0.24, 2.6),
    ...quadruped(150, 88, 1.05)
  ]
}

/** 人形 + 滑板 + 倒立摆 */
export function sceneG1Cartpole(): CoverShape[] {
  return [
    line(36, 150, 284, 150, 0.24, 2.6),
    ...cart(140, 132, 0.9),
    line(140, 124, 186, 52, 0.9, 4.6),
    circle(188, 49, 5.6, 0.9),
    ...skeleton(248, 100, 0.42, 'stand')
  ]
}

/** 人形动作跟踪：骨架 + 关节扫过的弧线 */
export function sceneG1Motion(): CoverShape[] {
  return [
    ...skeleton(150, 92, 0.8, 'reach'),
    strokePoly(arcPoints(150, 92, 54, -1.9, -0.9), 0.3, 2.2, { dash: '6 5' }),
    strokePoly(arcPoints(150, 92, 60, -1.85, -0.95), 0.24, 2, { dash: '6 5' }),
    strokePoly(arcPoints(150, 92, 66, -1.8, -1), 0.18, 1.8, { dash: '6 5' })
  ]
}

/** 机械臂运动学：连杆 + 关节角度弧 */
export function sceneUaibotKinematics(): CoverShape[] {
  return [
    line(30, 140, 290, 140, 0.24, 2.6),
    ...robotArm(150, 84, 0.9, -1, -0.35),
    strokePoly(arcPoints(108.6, 120, 30, -1, 0), 0.5, 2.2, { dash: '5 5' }),
    strokePoly(arcPoints(130, 86.7, 26, -1, -0.35), 0.5, 2.2, { dash: '5 5' })
  ]
}

// ==================== 兜底 ====================

/**
 * 兜底场景：新增分类或漏配场景时的中性图形。
 * 刻意做得没有语义（一个模块 + 几个点），避免误导成某个具体功能；
 * 测试会断言所有 demo 都有专属场景，所以正常情况下它只服务于「未来新增的分类」。
 */
export function sceneGeneric(rand: () => number): CoverShape[] {
  const shapes: CoverShape[] = [
    strokePoly(roundRectPoints(122, 50, 76, 76, 12), 0.7, 3, { close: true }),
    fillPoly(roundRectPoints(140, 68, 40, 40, 8), 0.5)
  ]
  for (let i = 0; i < 5; i++) {
    shapes.push(circle(r1(56 + rand() * 208), r1(28 + rand() * 124), r1(2.4 + rand() * 2.6), r1(0.25 + rand() * 0.35)))
  }
  return shapes
}

// ==================== 映射 ====================

/**
 * demo 唯一键（`分类/slug`）→ 场景。
 *
 * 覆盖率由测试强制：新增 demo 忘了配场景会直接测试失败，不会静默用兜底图。
 */
export const DEMO_SCENES: Record<string, CoverScene> = {
  // 语音
  'speech/tts': sceneTts,
  'speech/kokoro': sceneTts,
  'speech/asr': sceneAsr,
  'speech/whisper': sceneAsr,
  'speech/audio-classification': sceneSpeechClassify,
  'speech/yamnet': sceneSpeechClassify,
  'speech/pitch-detector': scenePitch,
  'speech/visualizer': sceneSpectrum,
  'speech/voice-changer': sceneVoiceFx,
  'speech/hum-to-notes': sceneHumNotes,
  'speech/speech-rate': sceneSpeechRate,
  'speech/metronome': sceneMetronome,
  'speech/mini-synth': sceneSynth,
  'speech/voice-command': sceneVoiceCommand,
  'speech/voice-clone': sceneVoiceClone,
  'speech/voiceprint': sceneVoiceprint,
  'speech/speech-translate': sceneSpeechTranslate,
  'speech/audiobook': sceneAudiobook,
  'speech/audio-recorder': sceneAudioRecord,
  'speech/audio-convert': sceneAudioConvert,
  'speech/video-to-audio': sceneVideoToAudio,
  'speech/audio-compress': sceneAudioCompress,
  'speech/audio-trim': sceneAudioTrim,

  // 视觉
  'vision/yolo': sceneYolo,
  'vision/mediapipe': sceneMediapipe,
  'vision/transformers': sceneTransformersVision,
  'vision/detection': sceneDetectCompare,
  'vision/classification': sceneClassify,
  'vision/segmentation': sceneSegmentation,
  'vision/matting': sceneMatting,
  'vision/depth': sceneDepth,
  'vision/pose': scenePose,
  'vision/sketch': sceneSketch,
  'vision/viewer': sceneViewer,
  'vision/transform': sceneTransform,
  'vision/pixel': scenePixel,
  'vision/color': sceneColor,
  'vision/adjustment': sceneAdjustment,
  'vision/filters': sceneFilters,
  'vision/enhancement': sceneEnhancement,
  'vision/morphology': sceneMorphology,
  'vision/edge': sceneEdge,
  'vision/object': sceneContour,
  'vision/features': sceneFeatures,
  'vision/face': sceneFace,
  'vision/face-recognition': sceneFaceRecognition,
  'vision/ocr': sceneOcr,
  'vision/recorder': sceneRecorder,
  'vision/pipeline': scenePipeline,
  'vision/image-convert': sceneImageConvert,
  'vision/video-convert': sceneVideoConvert,
  'vision/image-compress': sceneImageCompress,
  'vision/video-trim': sceneVideoTrim,
  'vision/video-compress': sceneVideoCompress,

  // NLP
  'nlp/text-classifier': sceneTextClassify,
  'nlp/language-detector': sceneLanguageDetect,
  'nlp/text-embedder': sceneTextEmbedder,
  'nlp/ner': sceneNer,
  'nlp/zero-shot': sceneZeroShot,
  'nlp/summarization': sceneSummarize,
  'nlp/qa': sceneQa,
  'nlp/fill-mask': sceneFillMask,
  'nlp/mediapipe-text': sceneMediapipeText,
  'nlp/transformers': sceneTransformersText,

  // AIGC
  'aigc/webllm': sceneWebllm,
  'aigc/text-to-image': sceneTextToImage,
  'aigc/inpainting': sceneInpaint,
  'aigc/capabilities': sceneCapabilities,
  'aigc/llm-chat': sceneCloudChat,
  'aigc/reasoning-chat': sceneReasoning,
  'aigc/codegen': sceneCodegen,
  'aigc/multimodal-chat': sceneMultimodalChat,
  'aigc/tripo3d': sceneTripo3d,
  'aigc/talking-photo': sceneTalkingPhoto,
  'aigc/video-gen': sceneVideoGen,

  // 机器学习
  'ml/cnn-explainer': sceneCnnExplainer,
  'ml/image-training': sceneTrainImage,
  'ml/audio-training': sceneTrainAudio,
  'ml/pose-training': sceneTrainPose,
  'ml/text-training': sceneTrainText,
  'ml/playground': scenePlayground,
  'ml/kmeans': sceneKmeans,
  'ml/regression': sceneRegression,
  'ml/mnist': sceneMnist,
  'ml/cartpole': sceneCartpole,
  'ml/palette': scenePalette,
  'ml/decision-tree': sceneDecisionTree,
  'ml/flappy': sceneFlappy,
  'ml/neural-foragers': sceneForagers,
  'ml/neural-boids': sceneBoids,
  'ml/neural-diffusion': sceneDiffusion,
  'ml/neural-rl-gridworld': sceneGridworld,
  'ml/neural-wave-collapse': sceneWaveCollapse,
  'ml/neural-optimizers': sceneOptimizers,
  'ml/neural-playground': scenePlayground,
  'ml/neural-reaction-diffusion': sceneReactionDiffusion,
  'ml/neural-automata': sceneAutomata,
  'ml/neural-attractor': sceneAttractor,
  'ml/neural-kmeans': sceneKmeans,
  'ml/neural-fourier': sceneFourier,
  'ml/neural-slime-mold': sceneSlimeMold,
  'ml/neural-genetic-tsp': sceneTsp,
  'ml/neural-pathfinding': scenePathfinding,

  // 机器人
  'robot/rebot-arm': sceneRebotArm,
  'robot/microduck': sceneMicroduck,
  'robot/g1-cartpole': sceneG1Cartpole,
  'robot/g1-motion-tracking': sceneG1Motion,
  'robot/uaibot-kinematics': sceneUaibotKinematics
}
