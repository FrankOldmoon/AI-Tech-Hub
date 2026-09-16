# 视觉（vision）重构 · 最终设计方案

> 状态：**设计定稿，未实施代码**
> 起草：2026-09-15
> 前置：`vision-refactor-plan.md`（已落地，commit `22182fe`，做了「7 个子分组 + 统一输入 + 抽取共享工具栏」）。
> 本文取代该文档的后续规划地位：那份只解决了"分桶"，没解决"粒度"和"重复入口"。

---

## 0. 一页速览

**核心改动：把"一个网格里混着工具箱和单功能页"，改成"按 5 类页面组织、每类页面行为可预期"。**

| | 现在 | 定稿 |
|---|---|---|
| 视觉入口 | 31 | **24**（含追加的 `sketch`） |
| 带左工具栏的页面 | 16（15 工坊 + yolo） | **21**（11 图像工坊 + 1 人脸工坊 + 6 能力页 + 3 引擎页） |
| 无工具栏 | 15（含 9 个 1:1 重复） | **2**（`face-recognition` 应用 + `pixel` 教学页） |
| 1:1 重复入口 | **9 个** | **0** |
| 导航轴 | 1 维（混排） | **2 维**（能力 × 引擎，多对多） |
| 死代码 | `pixel` 3 个工具不可达 | 0 |

**五类页面**：

| 类型 | 数量 | 回答的问题 | 有工具栏 |
|---|---|---|---|
| 图像工坊 | 11 | "我要处理这张图" | ✅（≥4 工具） |
| 能力页 | 6 | "我要做目标检测，哪个引擎更合适" | ✅（≥2 实现） |
| 人脸工坊 | 1 | "人脸这一整套" | ✅ |
| 引擎页 | 3 | "我想把 MediaPipe 玩一遍" | ✅ |
| 应用 / 教学页 | 2 | 完整工作流 / 原理讲解 | ❌ / 章节导航 |

---

## 1. 现状与问题（全部核实过，数字可复现）

### 1.1 硬数字

| 维度 | 数量 | 依据 |
|---|---|---|
| 视觉 demo 入口 | **31** | `demos.ts` 中 `category: 'vision'` 计数 |
| 子分组 | 7 | `demos.ts` 的 `visionGroupKeys` |
| 带左工具栏 | **16** | 15 个走 `ImagePlayground` + 1 个走 `YoloRealtime` |
| 无工具栏 | **15** | 8 个 MediaPipe 页 + 7 个独立静态页 |
| 工坊工具总数 | **85**（**3 个不可达**） | `image-tools.ts` 的 `imageTools` |

各工坊工具数：`adjustment` 9、`transform`/`filters`/`morphology`/`edge`/`object` 各 8、`color`/`enhancement`/`ai-vision` 各 6、`face`/`multimodal` 各 4、`pixel`/`features` 各 3、`viewer`/`ocr` 各 2。

> `object` 源码里是 7 条 `page: 'object'`，但 `hsvRangeTool` 被复用实例化 2 次（color-mask / color-segment），实际 8 个工具。

### 1.2 三个根因

**根因 1 · 粒度混排**：`DemoCard.vue` 只渲染标题/描述/标签，**不区分"工具箱（N 项）"和"单功能"**。用户点开 `adjustment` 有 9 个工具，点开 `depth-estimation` 只有一张图一个按钮，但卡片外观完全一致。

**根因 2 · 9 个入口是 1:1 冗余重复**（同一引擎 + 同一能力，两个页面做同一件事）：

| 冗余入口 | 与哪个工坊工具重复 | 位置 |
|---|---|---|
| `face-detection` | `face` › 人脸检测 | `image-tools.ts` 1602-1620 |
| `face-landmarker` | `face` › 人脸关键点 | 1621-1638 |
| `object-detector` | `ai-vision` › 目标检测 | 1854-1883 |
| `image-classifier` | `ai-vision` › 图像分类 | 1823-1853 |
| `image-segmenter` | `ai-vision` › 图像分割 | 1884-1890 |
| `bg-removal` | `ai-vision` › 背景移除 | 1891-1900 |
| `image-embedder` | `ai-vision` › 图像嵌入 + 图像相似度 | 1901-1939 |
| `depth-estimation` | `multimodal` › 深度估计 | 1976-2008 |
| `image-captioning` | `multimodal` › 图像描述 | 1944-1975 |

**关键**：`face`/`ai-vision`/`multimodal` 里这些工具**已经是 `kind: 'mediapipe'` / `'transformers'`**（走 `ai.mediaPipeImageResult()` / Transformers pipeline），说明"把模型引擎当工坊工具跑"这条路项目里已跑通。

**根因 3 · 影子页面 / 过瘦工坊 / 命名撞车**

- **死代码**：`pixel` 有两套实现。`image-tools.ts` 注册了 3 个工具（387-468），但 `app/pages/vision/pixel.vue` 是静态教学页（存储原理/RGB/图片大小/像素绘制）。静态路由优先于 `[slug].vue`，**那 3 个工具不可达**。
- **描述不符**：`demos.ts` 里 `pixel` 的描述仍是工坊口径（"读取像素、像素网格放大与像素级数学运算"），与实际渲染的教学页对不上。
- **过瘦工坊**：`viewer`(2)、`ocr`(2) 撑不起左工具栏。
- **命名撞车**：`object`(OpenCV 工坊) vs `object-detector`(MediaPipe)；`face` vs `face-detection`/`face-recognition`；`multimodal` vs `/aigc/multimodal-chat`。
- **工坊内部重复**：像素取色 **3 份**（`viewer`›pixel-picker、`pixel`›read-pixel、`color`›color-space-info）；去噪 2 份（`filters`›median-blur ≈ `enhancement`›denoise）；轮廓/多边形 2 份（`object`›contour-detect ≈ `edge`›polygon-detect）。
- **承诺未兑现**：`face` 工坊 `howItWorks` 写了"检测/关键点/模糊/像素化/**证件照**等工具"，实际只有 4 个，**没有证件照**。

---

## 2. 设计原则

**P1 · 一个页面 = 一个主题。** 用户从卡片名就能预判进去会看到什么。

**P2 · 粒度分档，各有门槛：**

| 类型 | 门槛 | 存在理由 |
|---|---|---|
| 工坊 | **≥4 个工具** | 同一主题下的多个算子/任务 |
| 能力页 | **≥2 个引擎实现** | 同一任务的不同实现，供横向对比 |
| 引擎页 | 该引擎的**全部任务** | 完整枚举一个模型库 |
| 应用 | 完整工作流 | 多步骤 + 跨会话状态，不适合当"工具" |

**P3 · 冗余重复必须删，多实现并列必须留。** 判据是"同一引擎同一能力"还是"同一能力不同引擎"：

| | 定义 | 例 | 处理 |
|---|---|---|---|
| 冗余重复 | 同一引擎 + 同一能力 | `object-detector` 与 `ai-vision`›目标检测，用**同一个 `mediapipeModels.objectDetector`、同一份 `visionTasks['object-detector']`** | **删** |
| 多实现并列 | 同一能力，不同引擎 | MediaPipe `objectDetector` vs YOLO `yolo26n.onnx`（模型/速度/类别表都不同） | **留，且聚到同一页** |

**P4 · 多对多是刻意的。** 同一工具同时出现在能力页和引擎页，是设计意图，不是重复。

---

## 3. 双轴模型（能力 × 引擎）

### 3.1 实际矩阵（从代码核对）

| 能力 | Canvas/OpenCV | MediaPipe | YOLO | Transformers | 实现数 | 建能力页 |
|---|---|---|---|---|---|---|
| 目标检测 | 颜色/轮廓（性质不同） | `object-detector` | `detect` | | 2 | ✅ `detection` |
| 图像分类 | | `image-classifier` | `cls` | | 2 | ✅ `classification` |
| 图像分割 | | `selfieSegmenter` | `seg`(实例)+`sem`(语义) | | 3 | ✅ `segmentation` |
| 抠图 | | `selfieSegmenter` | | MODNet | 2 | ✅ `matting` |
| 深度估计 | | | `depth` | Depth Anything | 2 | ✅ `depth` |
| 全身姿态 | | `pose-landmarker`(33 点) | `pose`(17 点) | | 2 | ✅ `pose` |
| 人脸/手部关键点 | | `face`/`hand-landmarker` | | | 1 | ❌ 只有全身做双模型 |
| 嵌入/相似度 | | `image-embedder` | | | 1 | ❌ 留引擎页 |
| 有向检测 OBB | | | `obb` | | 1 | ❌ |
| 图像描述 | | | | ViT-GPT2 | 1 | ❌ |
| 图像问答 | | | | Janus-Pro | 1 | ❌ |
| OCR | 文档扫描（**定位**） | | | Tesseract（**识别**） | 1~2 | ❌ 保留 `ocr` 工坊（定位≠识别） |
| 边缘/形态学/滤镜/调整 | OpenCV/Canvas | | | | 1 | ❌ 保持工坊 |

### 3.2 六个能力页

| slug | 实现 1（前） | 实现 2 |
|---|---|---|
| `detection` 目标检测 | MediaPipe `object-detector` | YOLO `detect` |
| `classification` 图像分类 | MediaPipe `image-classifier` | YOLO `cls` |
| `segmentation` 图像分割 | MediaPipe `selfieSegmenter` | YOLO `seg` + `sem`，+ 交互式分割 |
| `matting` 抠图 | MediaPipe `selfieSegmenter` | Transformers MODNet |
| `depth` 深度估计 | YOLO `depth` | Transformers Depth Anything |
| `pose` 全身姿态 | MediaPipe `pose-landmarker`(33 点) | YOLO `pose`(17 点) |

**排序**：MediaPipe 在前（模型小、出结果快）。

### 3.3 三个引擎页

| slug | 收录 | 数量 |
|---|---|---|
| `mediapipe` | `visionTasks` 全部 8 个 + 底层同为 MediaPipe 的 3 个（`image-segmenter` 的 selfie segmenter、`image-embedder`、`interactive-segmenter`） | **11** |
| `yolo` | `utils/yolo/models.ts` 的 `MODELS`：detect / seg / sem / depth / cls / pose / obb | **7** |
| `transformers` | 图像描述(ViT-GPT2) / 深度(Depth Anything) / 抠图(MODNet) / 图像问答(Janus-Pro) / 图像修复(规划中) | **5** |

> 经典算法（Canvas + OpenCV）没有独立引擎页：它算子太多（40+），扁平列表不可用，**入口就是那 11 个图像工坊**（按算子主题切分）。

---

## 4. 定稿页面清单（24 个入口）

### 4.1 图像工坊（11）—— 经典算法与文档

| slug | 名称 | 工具数 | 变更 |
|---|---|---|---|
| `viewer` | 图像信息与像素 | 2 → **4** | +`pixel-grid` +`pixel-math` +`color-space-info`；−`read-pixel`（与 pixel-picker 重复） |
| `transform` | 几何变换 | 8 | 不变 |
| `color` | 颜色处理 | 6 → **5** | `color-space-info` 移出 |
| `adjustment` | 图像调整 | 9 → **10** | + 色阶 / Levels |
| `filters` | 图像滤镜 | 8 → **9** | + 双边滤波 |
| `enhancement` | 噪声与增强 | 6 → **7** | + 直方图匹配 |
| `morphology` | 阈值与形态学 | 8 → **10** | + 顶帽/黑帽 + 骨架化 |
| `edge` | 边缘与形状 | 8 → **8** | −`polygon-detect`（与 `object.contour-detect` 重复）+ 霍夫椭圆 |
| `object` | **颜色与轮廓检测**（改名，避与 `detection` 撞车） | 8 | 不变 |
| `features` | 特征检测 | 3 → **5** | + 模板匹配 + 图像拼接/全景 |
| `ocr` | OCR 与文档视觉 | 2 → **4** | + 表格结构识别 + 手写识别 |

### 4.2 能力页（6）

见 §3.2。共 14 条工具位，其中 8 条复用现有实现。

### 4.3 人脸工坊（1）

| slug | 名称 | 工具数 | 变更 |
|---|---|---|---|
| `face` | 人脸工作室 | 4 → **6** | + 证件照（`howItWorks` 已承诺未实现）+ 人脸比对 1:1 |

### 4.4 引擎页（3）

见 §3.3。

### 4.5 应用（1）

| slug | 名称 | 说明 |
|---|---|---|
| `face-recognition` | 人脸注册与识别 | **不动**。注册人脸库 → 识别 → 管理，多步骤 + `localStorage` 跨会话状态，属于应用不是工具集合 |

### 4.6 教学页（1）

| slug | 名称 | 说明 |
|---|---|---|
| `pixel` | **像素原理（教学）** | 改标题/描述对齐实际内容（存储原理/RGB/图片大小/像素绘制）。左侧是**章节导航**不是工具列表 |

### 4.7 子分组（5 组）

| 组 | 入口 | 数量 |
|---|---|---|
| 图像处理工坊 | §4.1 | 11 |
| 人脸 | `face` + `face-recognition` | 2 |
| 能力对比 | §4.2 | 6 |
| 引擎全览 | §3.3 | 3 |
| 教学 | `pixel` | 1 |

---

## 5. URL 与 301 迁移

**保留 slug（13）**：`viewer` `transform` `color` `adjustment` `filters` `enhancement` `morphology` `edge` `object` `features` `ocr` `face` `face-recognition`

**新增 slug（9）**：`detection` `classification` `segmentation` `matting` `depth` `pose`（能力页）+ `mediapipe` `yolo` `transformers`（引擎页）

**下线 slug（13）→ 必须 301（与删 slug 同一次改动，否则中间态 404）**：

| 下线 | → | 理由 |
|---|---|---|
| `/vision/face-detection` | `/vision/face` | 冗余重复 |
| `/vision/face-landmarker` | `/vision/face` | 冗余重复 |
| `/vision/object-detector` | `/vision/detection` | 成为能力页的实现之一 |
| `/vision/image-classifier` | `/vision/classification` | 同上 |
| `/vision/image-segmenter` | `/vision/segmentation` | 同上 |
| `/vision/interactive-segmenter` | `/vision/segmentation` | 同上 |
| `/vision/bg-removal` | `/vision/matting` | 同上 |
| `/vision/depth-estimation` | `/vision/depth` | 同上 |
| `/vision/image-captioning` | `/vision/transformers` | 描述只有单一实现 |
| `/vision/image-embedder` | `/vision/mediapipe` | 嵌入只有单一实现 |
| `/vision/multimodal` | `/vision/transformers` | slug 重定位为引擎页 |
| `/vision/ai-vision` | `/vision/detection` | 6 合 1 杂项工坊被能力页拆解（目标为人工指定） |
| `/vision/yolo-detection` | `/vision/yolo` | slug 重定位为引擎页（与 `mediapipe` 对称） |

落点：`nuxt.config.ts` 的 `routeRules`（当前是空对象 `{}`，可直接加 `redirect`）。

**元数据迁移（易漏，漏了不报错但会静默变化）**：
- `featured: true`：现挂在 `face-detection`、`bg-removal`（另 `yolo-detection`、`ocr`、`face-recognition` 保留）→ 需转移到 `face`、`matting`。
- `requirements.camera`：现挂在 8 个 MediaPipe 页 + `image-segmenter`/`interactive-segmenter`/`yolo-detection` → 转移到收编后的 `face`、`ai-vision` 拆出的能力页、`segmentation`、`mediapipe`、`yolo`、`pose`。
- `classroomSafe`：按"合并后整页是否课堂安全"重判。
- 影响面：`useDemos().stats.total`、首页精选计数、侧边栏、`classroomDemos`。

---

## 6. 组件与数据层改动（代码级）

### 6.1 `ImageTool` 从"单页"变"多页"（双轴的地基）

```ts
// 现在
page: ImagePageSlug                                    // 单值
export function imageToolsByPage(slug: string) {
  return imageTools.filter(t => t.page === slug)
}

// 改为
pages: string[]                                        // 多值
export function imageToolsByPage(slug: string) {
  return imageTools.filter(t => t.pages.includes(slug))
}
```

### 6.2 新增 `kind: 'yolo'`

`ImagePlayground` 的 `kindLabels` 目前只有 `Canvas / OpenCV.js / MediaPipe / Transformers.js / Tesseract`。加 `yolo: 'YOLO'`，并把 `utils/yolo/models.ts` 的 `MODELS` 映射成 `ImageTool`（字段形状几乎同构：`id`/`nameZh`/`nameEn`/`icon`）。

> ✅ **已验证可行**：YOLO **已支持静态图输入** —— `YoloRealtime.vue` 的 `runOnBitmap()` 用 `staticCanvas.captureStream(10)` 把静态图喂给同一推理循环，`runOnFile`/`onPickSample` 也在。所以"YOLO 目标检测"作为工具塞进能力页没有技术障碍。上一轮方案里"需验证 `preprocess` 静态源签名"的疑虑可划掉。

### 6.3 新增实时模式（路线 A，**必做**）

现在 8 个 MediaPipe 单功能页支持**摄像头逐帧实时**（`MediaVisionRunner.vue` 的 `mode: 'webcam' | 'image'`），而工坊只支持"上传/示例/拍照**单帧**"（`ImagePlayground` 的 `webcamOpen` + `WebcamCapture.vue`）。**不做实时模式，收编 MediaPipe 页就是能力降级。**

```ts
interface ImageTool {
  // 新增：实时帧推理入口
  live?: { runFrame: (video: HTMLVideoElement, ts: number) => ImageToolResult | null }
}
```

- 用独立 `runFrame` 而非复用 `run`：MediaPipe 原生接口是 `detectForVideo(video, ts)`（`visionTasks[].method`），比"每帧抓 ImageData 再 run"高效得多。
- `ImagePlayground`：`activeTool.live` 存在时渲染"实时"开关；开启后走 `requestAnimationFrame` 循环，video → 结果 canvas 叠加；复用现成 `webcamOpen` 生命周期与 `onBeforeUnmount` 释放轨道。
- YOLO 侧 `runFrame` 走 `getYoloSession()` + `preprocess(video)`，与现有 `YoloRealtime` 同源。

### 6.4 新增 `interactive: 'prompt'`

**现有机制不够用**：`interactive: 'click'` 的 `onPick` **只返回信息行、不改结果**（`pixel-picker`/`color-space-info` 就是这么用的）。而交互式分割要把**点击坐标喂回推理**（point prompt，业界标准即 SAM/SAM 2 的 prompt 范式）。需新增一档：拾取点存入参数并触发重跑。

```ts
interactive?: 'click' | 'crop' | 'prompt'
```

### 6.5 `ToolSidebarItem` 新增 `section`

`ToolSidebarItem` 已有 `kind` 字段且 `ImagePlayground` 已在渲染（`kindLabel(tool.kind)`），所以"同能力并列 MediaPipe / YOLO"用现有 UI 就能表达。再补一个 `section`，一物两用：

- **引擎页/大工坊**分组（MediaPipe 引擎页 11 项 → 人脸 / 手 / 姿态 / 检测分类 / 分割抠图 / 嵌入）
- **能力页**按实现分组，读起来自带解释：

```
MediaPipe
  目标检测
YOLO
  目标检测
```

### 6.6 抠图与分割共用模型 → 合并为单工具

`image-segment`（overlay 叠加）与 `background-removal`（透明输出）用的都是 `mediapipeModels.selfieSegmenter`，现在是两份实现。合并为**一个工具 + `mode` 参数**，`pages: ['segmentation', 'matting']` —— 这是多值 `pages` 的第一个真实用例。不合并的代价：改模型路径要改两处。

---

## 7. 分批实施

沿用项目约定：短特性分支（`feat/*` / `fix/*`），验证通过 `--no-ff` 合并回 main；合并门槛 = 改动文件 `eslint`/`typecheck` **对比基线不新增错误** + `check:i18n` + 手动冒烟。

| 批 | 分支 | 内容 | 依赖 |
|---|---|---|---|
| 0 | `fix/vision-cleanup` | 零风险清理：`pixel` 死代码拆解 + 文案对齐教学页；像素取色三合一；`edge.polygon-detect` 去重；`viewer`→4、`features`→5、`ocr`→4 | 无 |
| 1 | `feat/vision-multipage-core` | **双轴地基**：`page`→`pages: string[]`；`kind: 'yolo'` + `MODELS`→`ImageTool`；`interactive: 'prompt'`；`ToolSidebarItem.section`；抠图/分割合并为单工具 + `mode` | 批 0 |
| 2 | `feat/vision-live-mode` | 路线 A：`ImageTool.live` + `ImagePlayground` 实时循环（能力页/引擎页共用） | 批 1 |
| 3 | `feat/vision-engine-pages` | 三个引擎页：新建 `/vision/mediapipe`(11)；`yolo-detection`→`/vision/yolo`(7)；`multimodal`→`/vision/transformers`(5)；全部含 301 | 批 2 |
| 4 | `feat/vision-capability-pages` | 6 个能力页；`ai-vision` 下线 + 301；其余冗余单功能入口下线 + 301 | 批 3 |
| 5 | `feat/vision-face-studio` | `face` 扩到 6 工具（+证件照 +人脸比对）；`face-detection`/`face-landmarker` 并入 + 301 | 批 4 |
| 6 | `feat/vision-new-tools` | 新增工具：色阶、直方图匹配、双边滤波、顶帽/黑帽、骨架化、霍夫椭圆、模板匹配、图像拼接、表格识别、手写识别 | 批 4 |

---

## 8. 风险

1. **`routeRules.redirect`** 必须在删 slug 的**同一次**改动里加，13 条一次性到位，否则中间态 404。
2. **元数据迁移**（`featured`/`requirements`/`classroomSafe`）易漏，不报错但首页与徽章会静默变化 —— 逐条核对 §5。
3. **`useDemos().byCategory()` 不得改动**（首页/侧边栏/分类页共用）；分组逻辑在 `byCategoryGrouped()`。
4. **i18n**：新增/改名 demo 的 `title`/`description` 是 `demos.ts` 里的 `Localized`（zh+en 必须都写）；`visionGroupLabels` 同样是 `Localized`（不走 i18n json）；只有组件内 UI 文案走 `t()`，受 `check:i18n` 约束。
5. **实时模式竞态**：多页面同页切换、摄像头未释放、参数改动与推理重入 —— 参照 `MediaVisionRunner` 的 `starting` 防重与 `onBeforeUnmount` 释放轨道。
6. **不要顺手"修"存量 lint 错误**：仓库基线 eslint/typecheck 本就有大量存量错误（约 1724 / 555），验收用"对比基线不新增"。
7. **同一模型跨两页的边界**：`selfieSegmenter` 会同时出现在 `segmentation` 与 `matting` —— 必须按 §6.6 合并为单工具，否则就是新的冗余重复。

---

## 9. 验收清单

1. `./node_modules/.bin/nuxi typecheck`、`./node_modules/.bin/eslint`（改动文件对比基线，不新增错误）。
2. `check:i18n`（`scripts/check-i18n.mjs`）+ `vitest run`。
3. `pnpm build`（或本地等价命令）。
4. 手动回归：
   - `/vision` 5 个分组、23 个入口；每张卡片点进去的形态与卡片粒度徽章一致。
   - **13 条 301 逐条走通**，无 404。
   - 首页精选 / 侧边栏 / `stats` 计数与 `featured` 迁移结果一致。
   - **双轴专项**：同一个"目标检测"能从 `/vision/detection`（侧栏两个 section：MediaPipe / YOLO）、`/vision/mediapipe`、`/vision/yolo` 三个入口进到，结果一致。
   - **实时专项**：实时开关 → 出结果 → 切工具 → 摄像头指示灯熄灭（轨道已停）；拒绝授权 → 友好错误不白屏。
   - **交互专项**：`segmentation` 的交互式分割，点击提示点后掩码随之改变（验证 `interactive: 'prompt'` 生效）。
   - `/vision/pixel` 文案与教学页内容一致；`image-tools.ts` 中无不可达工具。

---

## 实施记录（as-built，2026-09-15）

> ⚠️ **环境坑（已解决）**：工具 shell 的 PATH 被注入成仅含 TRAE 自身目录，**缺 `/usr/local/bin`、`/bin`、`/usr/bin`**。
> 导致 `node`/`pnpm`/`sed`/`dirname`/`ls` 全部 `command not found`，并曾误判为"机器上没装 node_modules 与 node"。
> 实际 `node` v24.13.0、`pnpm` 9.12.0 都在 `/usr/local/bin`，`node_modules` 也早已存在（1082 个包）。
> **正确姿势**：`export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"` 后再跑命令。

### 已落地

| 批次 | 状态 | 说明 |
|---|---|---|
| 0 | ✅ | `pixelTools` 删除（`pixel-grid`/`pixel-math` 移入 `viewer`，`read-pixel`/`color-space-info` 与既有取色器三合一）；`edge.polygon-detect` 去重；`pixel` 文案改为教学页口径 |
| 1 | ✅ | `ImageTool` 新增 `pages`／`section`／`live`／`resolvedParams`；`interactive` 增加 `'prompt'`；`ToolSidebarItem.section`；新增 `kind: 'yolo' \| 'tfjs'` |
| 2 | ✅ | `ImageTool.live` + `ImagePlayground` 实时逐帧循环（busy 守卫、切工具即断流、`onBeforeUnmount` 释放轨道） |
| 3 | ✅ | 三个引擎页 `mediapipe`(11) / `yolo`(7) / `transformers`(5) |
| 4 | ✅ | 六个能力页 `detection`/`classification`/`segmentation`/`matting`/`depth`/`pose`；`ai-vision` 下线 |
| 5 | ✅ | `face` 工坊扩到 6 工具（+证件照 +人脸比对）；`face-detection`/`face-landmarker` 并入 |
| 6 | ✅ | 色阶、直方图匹配、双边滤波、顶帽/黑帽、骨架化、椭圆拟合、模板匹配、图像拼接、表格结构、手写识别 |
| 收尾 | ✅ | `demos.ts` 23 条 vision 条目 / 5 个分组；13 条 301；i18n 双语 key；删除 7 个旧静态页 + 3 个死组件 |

### 统计核对（grep 计数）

- 视觉入口：**31 → 24**（workbench 11 / capability 7 / engine 3 / face 2 / lesson 1）
- 工具总数：**97**（追加前 95 + sketch 2），**无不可达工具**
- 各页工具数：viewer 4、transform 8、color 5、adjustment 10、filters 9、enhancement 7、morphology 10、edge 8、object 8、features 5、ocr 4、face 6、mediapipe 11、yolo 7、transformers 5、detection 2、classification 2、segmentation 4、matting 2、depth 2、pose 2、sketch 2（追加）

### 与原设计的偏差（重要）

1. **`page` 改为可选 + 新增 `pages`（而非把 `page` 全量改成数组）**：`toolPages(t) = t.pages ?? (page ? [page] : [])`。单页工具零改动，避免 81 处机械改写带来的风险。
2. **`section` 做成「按页面 slug 的映射」**（`Record<slug, i18nKey>`）：因为同一工具在能力页要显示**引擎名**（MediaPipe / YOLO），在引擎页要显示**任务族**（人脸 / 手部与姿态），单值字段无法同时表达。
3. **MediaPipe 工具集中在新文件 `app/utils/mediapipe-tools.ts`**：8 个 `visionTasks` 任务 + selfie segmenter + MagicTouch 交互分割 + image embedder = 11，避免引擎页与能力页各写一份。
4. **`ai-vision` 的 6 个工具就地拆分**，`aiVisionTools` / `multimodalTools` 两个数组整体删除（后者改名为 `transformersTools` 并新增 MODNet 抠图），而不是新建重复工具。
5. **`YoloRealtime.vue` / `MediaVisionRunner.vue` / `SampleImagePicker.vue` 删除**：前者被引擎页取代，中者被 `ImagePlayground` 取代，后者失去全部引用。
6. **`[slug].vue` 收敛为纯注册表分发**：删掉了「命中 `visionTasks` → `MediaVisionRunner`」的旧分支（该分支已无 slug 可达）。
7. **`morphology` 只加了 2 个工具**（顶帽/黑帽合一为 `morph-shape` + 骨架化），以守住「工坊 ≤10 项」约束。
8. **交互式分割用 MediaPipe MagicTouch 的点提示**（`brushMode: 1` + 像素坐标），GPU 失败自动降级 CPU —— 沿用原 `interactive-segmenter.vue` 验证过的调用方式。

### 验证结果（已实跑，2026-09-15）

门禁全部通过（口径 = 对比基线、不新增错误）：

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型 | `nuxt typecheck` | **476 vs 基线 487（净 −11）**，逐文件比对**无任何文件错误数增加** |
| Lint | `eslint`（变更文件） | 新文件 `mediapipe-tools.ts`/`yolo/tools.ts` **0**；`ImagePlayground.vue`/`ToolSidebar.vue`/`demos.ts` **0**；`image-tools.ts` 46→**27** |
| i18n | `node scripts/check-i18n.mjs` | ✔ 922 处引用 / 721 个 key，en+zh 均存在 |
| 单测 | `vitest run` | ✔ 71 passed（8 files） |
| 构建 | `pnpm build` | ✔ `✨ Build complete!`（Σ 266 MB） |
| 301 | 起 `.output/server` 实测 | **13 条旧 URL 全部 301 到正确目标** |
| 新入口 | 同上 | **17 个入口全部 200** |
| 分类页 | `curl /vision` SSR | 23 个入口链接；5 个分组标题按设计顺序渲染 |

### 过程中被验证抓出的 3 个真实缺陷（已修）

1. **`demos.ts` 语法错误**：删 `bg-removal` 条目时 sed 范围少删 1 行（该条目闭合 `},` 在 964 行，我删的是 `952..963`），留下一个多余 `}`，导致 289 个级联语法错误 → 已删该行并复验括号平衡。
2. **`kindLabels` 漏 `tfjs`**：新增了 `ImageToolKind` 的 `'tfjs'` 却没补 label，`Record<ImageToolKind, string>` 报缺键。
3. **`yolo/tools.ts` 的 `section` 仍是字符串**：`section` 已改为按页面映射，已改为 `{ '*': 'image.sections.yolo' }`。

另外修掉我新增行上的 25 处严格索引告警（`TS2532`/`TS18048`）与 15 处 lint（`quote-props`／`max-statements-per-line`／`no-explicit-any`）。

### 仍需人工确认（无法自动化）

- **OpenCV.js 4 个新工具的运行时行为**（椭圆拟合、模板匹配、图像拼接、表格结构）—— 依赖 `cv.fitEllipse`/`cv.matchTemplate`/`cv.findHomography`/`cv.getStructuringElement`，构建期无法验证；**「图像拼接」逻辑最复杂，风险最高**，需在真浏览器点一次。
- **实时模式**（摄像头逐帧、切工具断流、授权拒绝）需真机+摄像头。
- **`eslint` 用的是全局基线对比**，未对 `image-tools.ts` 做逐行归属核对（已用 `git diff` 交叉定位并修完新增行）。


### 追加：`/vision/sketch` 简笔画识别能力页（2026-09-15）

用户要求补充"简笔画识别"demo。新技术点：**输入不是上传图片，而是手绘画布**。

- 新增 `app/components/SketchCanvas.vue`：白底 + 粗黑圆头笔画（简笔画模型的训练画风），只在笔画结束时 emit `ImageData`，`clearToken` 递增即清空。
- 新增 `app/utils/doodle.ts` 数据层：
  - ① DoodleNet（CNN，Quick, Draw! 345 类）：ml5.js 已改为**本地 npm 依赖 + 本地文件加载**（见下节），标签为英文；模型权重仍由 ml5 运行时获取。
  - ② MobileNet 特征 + KNN（复用项目已有依赖与 `/model/tfjs/mobilenet` 本地模型），现场采集自定义类别、零训练循环。
- 新增 `app/utils/sketch-tools.ts`：两个 `ImageTool`（`doodlenet` / `doodle-teach`），`pages: ['sketch']`，`needsDrawing: true`，侧栏按方案分组（预置模型 / 现场教学）。
- `ImageTool` 新增 `needsDrawing?: boolean`；`ImagePlayground` 增加**手绘输入模式**（画布 + 笔刷滑块 + 清空；开启后隐藏上传/示例/拍照，并把「原图」列收起、结果列跨两列）。
- `ImagePageSlug` 增加 `'sketch'`；`demos.ts` 增加 capability 分组条目（视觉入口 23 → **24**）；i18n 新增 6 个 key（`image.sketchTitle/sketchHint/brush/clearCanvas` + `image.sections.pretrained/teach`）。

**顺手修掉一个自己引入的循环依赖**：`sketch-tools.ts` 起初从 `image-tools.ts` 引 `toCanvasLocal`，而 `image-tools.ts` 又引 `sketchTools` —— 已改为各自持有 canvas 助手，依赖恢复单向。

**验证**：`typecheck` 476（与加功能前持平 → **新代码 0 错误**）；`eslint` 新增文件全 0（`image-tools.ts` 仍 27 = 无新增）；`check:i18n` ✔（927 引用 / 725 key）；`pnpm build` **EXIT=0**；产物实测 `/vision/sketch` **200**、`/vision` 入口 **24**、新卡片与分组顺序正确。

**未验证（需真浏览器 + 联网）**：手绘画布的绘制手感、DoodleNet 首次加载（CDN + 模型下载）与 345 类识别效果、MobileNet+KNN 的现场教学准确度。

### 追加：CDN 库脚本 → 本地 npm 包（2026-09-15）

盘点出浏览器端**从公网 CDN 动态加载 script** 的库共 4 个，全部改为 npm 依赖 + 本地加载：

| 库 | 原 CDN | 改为 | 本地路径 |
|---|---|---|---|
| tesseract.js | `cdn.jsdelivr.net/npm/tesseract.js@5.1.1` | `tesseract.js@5.1.1` | `/model/vendor/tesseract/`（脚本 + worker + core 4 变体 + eng/chi_sim 语言数据） |
| ml5 | `cdn.jsdelivr.net/npm/ml5@1` | `ml5@1.4.0` | `/model/vendor/ml5/ml5.min.js` |
| pyodide | `cdn.jsdelivr.net/pyodide/v0.27.7/full` | `pyodide@0.27.7` | `/model/vendor/pyodide/`（pyodide.js + asm.wasm + stdlib + lock） |
| monaco-editor | `cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min` | `monaco-editor@0.52.2` | `/model/vendor/monaco/min/`（排除 .map） |

**架构选择（为什么不是 `import` 而是「npm 依赖 + 本地产物」）**：这 4 个库里 3 个（ml5/pyodide/tesseract）是需要独立 worker/wasm/语言数据目录的自带运行时，静态 `import` 会把 4.3MB 的 UMD 单包拉进视觉页公共 chunk，并需要重配 bundler 的 worker 链路。改为「npm 依赖（版本可审计、可升级）+ 构建期从 node_modules 同步产物到本地静态目录」，浏览器端零 CDN 请求，代码侧只改基址常量，风险最低。

- 新增 `scripts/sync-runtime-libs.mjs`：从 node_modules 复制**必需文件**（不整目录搬 ml5 dist 74MB / tesseract.js-core 29MB），并按需下载 Tesseract 语言数据；幂等，已存在即跳过。产物落在 `.models/vendor/`（98MB，**已被 .gitignore 排除**）。
- `postinstall` 改为 `nuxt prepare && node scripts/sync-runtime-libs.mjs`，随安装自动就位。
- `server/routes/model/[...].ts` 的 MIME 表补齐 `js/mjs/css/html/svg/map/gz/zip/woff2/ttf` —— 否则 `.js` 会以 `application/octet-stream` 返回，浏览器拒绝执行。
- 代码侧只改基址：`tesseract.ts`（+ 新增 `tesseractLocalOptions()` 传入 workerPath/corePath/langPath，`image-tools.ts` 两处 `createWorker` 接入）、`doodle.ts`、`usePyodide.ts`、`PyodideRunner.vue`。

**仍在用外部地址的（属另一范畴，未动）**：
- `app/utils/stats.ts`：百度统计 / Google Analytics —— 第三方统计 SDK，必须实时打点到外部域，不能打进 npm。
- `app/utils/remote-models.ts`：MediaPipe **wasm 路径**与模型权重 URL —— 是「云端部署回退分支」(`isRemoteDeploy()`) 用的**数据**而非库脚本；本地分支走 `/model/*`。
- `server/utils/model-downloader.ts` / `model-fetch.mjs`：服务端**下载来源**，非浏览器运行时依赖。

**验证**：旧 4 个 CDN 库地址在 `.output` 中**残留 0 处**；`/model/vendor/` 出现在 3 个客户端 chunk；本地产物实测 `200` + 正确 MIME（js→text/javascript、wasm→application/wasm、gz→application/gzip、zip→application/zip）；wasm 分段请求 **206**；路径穿越 **400**、缺失文件 **404**；`/`、`/ide`、`/vision`、`/vision/sketch`、`/vision/ocr` 全 **200**；`typecheck` 476（无新增）、`eslint` 改动文件**无新增错误**（7→7 / 10→10 / 3→3）、`pnpm build` **EXIT=0**。

**风险与未验证**：
1. **lockfile 由本机 pnpm 9 重写**（仓库声明 `packageManager: pnpm@11.18.0`）。lockfileVersion 同为 `9.0` 理论兼容，但**建议在 pnpm 11 环境重跑一次 `pnpm install` 规范化**，并确认 CI 的 `--frozen-lockfile` 通过。
2. Tesseract / pyodide / monaco 的**真机运行**未验证（需浏览器；CLI 只能验证产物可服务、MIME 正确）。
3. ml5 的 **DoodleNet 权重仍需联网获取**（不在 npm 包内）—— 这是唯一残留的远程数据依赖，若要彻底离线需另行 vendored 模型文件。

### 追加：模型供给的两个缺口（2026-09-15）

排查「模型是否都在部署阶段落到服务器」时确认：模型供给分三态 —— 受 `isRemoteDeploy()` 控制的一批（MediaPipe / TF.js / web-llm）、始终本地的一批（YOLO / face-api / kokoro / transformers / 本次的 vendor 库）、以及**唯一始终远程的 DoodleNet 权重**。据此补掉两个缺口：

**缺口 1：DoodleNet 权重本地化**

- ml5 把 DoodleNet 地址**硬编码**为 `cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models@master/models/doodlenet/model.json`，且**345 个类别标签烘焙在 ml5 包内** —— 所以只能本地化权重，不能改用自定义 `modelUrl`（否则丢标签）。
- `model-downloader.ts` 新增 `downloadDoodleNet()`（读 `weightsManifest` 拉全部分片），已把 `model.json` + `group1-shard1of1.bin`（2.1MB）落到 `.models/doodle/`。
- `doodle.ts` 新增 `installDoodleRedirect()`：把该 jsdelivr 前缀重写到 `/model/doodle/`，同时拦截 `fetch` 与 `XHR`（tfjs 部分路径走 XHR），与 `kokoro.ts` 的既有模式一致。

**缺口 2：`/model/*` 本地缺失 → 302 回退远程**

- 新增 `server/utils/model-sources.ts` 作为**单一事实来源**：MediaPipe（16 模型 + 3 wasm 包）、TF.js（mobilenet / speech-commands）、face-api、DoodleNet 的远程地址，并导出 `remoteUrlFor(localRel)` 反查。
- `model-downloader.ts` 原本内联的 4 处 URL 表改为引用该模块，**消除「下载地址」与「回退地址」两套字面量漂移**。
- `server/routes/model/[...].ts`：文件缺失时先查 `remoteUrlFor`，命中则 `302`（带 `Location` + `Cache-Control: no-cache`），未登记目录仍 `404`。
- 两个缺口**互相配合**：客户端无条件重写到 `/model/doodle/`，本地缺失时由服务端 302 送回原地址 —— 离线可用，缺失也能降级。
- 被墙环境只需改 `model-sources.ts` 的常量即可整体切镜像（含镜像地址），这是把散落 URL 收敛成单一来源的附带收益。

**验证**：`/model/doodle/model.json` 与 shard 均 **200**；已有媒体模型 **200 + Range 206**；未登记目录（`/model/yolo/nope.onnx`）**404**；**临时移走 `faceapi/tiny_face_detector_model.bin` → 302 且 `Location` 正确指向 jsdelivr**（测试后已恢复文件）；`/vision/sketch`、`/vision`、`/ide` 均 **200**；客户端产物含重写逻辑、服务端产物含回退表；`typecheck` **476**（无新增）、`eslint` **无新增**（`model-downloader.ts` HEAD 11 → 11，已与 HEAD 逐文件对比）、`pnpm build` **EXIT=0**。

**未验证**：DoodleNet 在真机的识别效果（需浏览器 + 摄像头/手绘）；302 回退后跨域响应是否被目标站点 CORS 放行（jsdelivr / storage.googleapis.com / tfhub.dev 均返回 `Access-Control-Allow-Origin: *`，理论可行，但**未实测**）。

### 追加：全量安装 + 构建回归，及 pnpm 策略两处修复（2026-09-15）

**回归方式（关键：不是增量，是从零）**：先 `rm -rf .models/vendor`（模拟新机器），再 `pnpm install --frozen-lockfile` → postinstall 的 `sync-runtime-libs.mjs` **从零重建 98MB 产物**（含重新下载 eng 10.4MB + chi_sim 19.2MB 语言数据），0 缺失；随后 `pnpm build` **EXIT=0**。

**回归中发现两个真问题（都是我引入的，已修）**：

1. **pnpm 11 的 `minimumReleaseAge` 供应链策略拒绝 lockfile**（CI 会挂）
   - 报错：`brace-expansion@1.1.21 was published ... within the minimumReleaseAge cutoff`
   - 根因：ml5 的传递依赖链 `ml5 → @tensorflow-models/* → rimraf@3 → glob@7 → minimatch@3 → brace-expansion@1.1.21`，而该版本 **2026-09-14T21:59 才发布**（同一时刻 1.x/2.x/3.x/5.x 全部维护线被协调打补丁，特征上像安全回补）。
   - **注意**：早先那次「pnpm 11 EXIT=0」是**假阳性** —— node_modules 已完整时 pnpm 短路为 "Already up to date"，根本没做策略校验。
   - 修法：`pnpm-workspace.yaml` 显式化 `minimumReleaseAge: 1440`（锚定例外语义），并只对 `brace-expansion@1.1.21` **一个版本**开 `minimumReleaseAgeExclude` —— 不降级到旧 1.x（会重新引入该漏洞），也不放开整个包。
2. **pnpm 11 报 `ERR_PNPM_IGNORED_BUILDS`**：`preact@8.2.9`（ml5 传递依赖）与 `tesseract.js` 的构建脚本未登记。两者都只是"请捐赠"打印脚本，产物不需要它们 → 在 `allowBuilds` 中登记为 `false`（显式忽略即不再报错）。
3. **顺带修正一处放错位置的配置**：我上一轮把禁用 ml5 脚本写在 `package.json` 的 `pnpm.neverBuiltDependencies`，pnpm 11 已不再读取该字段（会告警）。改为项目既有的 `pnpm-workspace.yaml.allowBuilds` 约定（`ml5: false`）。
   - **但该字段仍需保留**：pnpm 9 **不读** `pnpm-workspace.yaml` 的设置，实测删掉后 ml5 的 postinstall 必然失败（`patch-package: command not found` → ELIFECYCLE）。故两处并存：yaml 给 pnpm 10/11，package.json 给 pnpm 9。代价是 pnpm 11 会告警"`pnpm` 字段已不再读取"——**属预期噪声，不影响退出码**。
   - 另注：pnpm 11 遇到被忽略的构建脚本时会**自动往 `pnpm-workspace.yaml` 写入 `set this to true or false` 占位行**，需人工填值（本次已填）。

**最终验证**

| 项 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile`（pnpm **11.18.0**，CI 同款） | **EXIT=0** |
| `pnpm install --frozen-lockfile`（pnpm **9.12.0**，本机） | **EXIT=0** |
| 库产物从零重建 | 98MB / 11 个关键文件 **0 缺失** |
| 4 个库均在 `package.json` | ✓ tesseract.js 5.1.1 / ml5 1.4.0 / monaco-editor 0.52.2 / pyodide 0.27.7 |
| `pnpm build` | **EXIT=0**，0 错误行 |
| 重建产物在线服务 | 全部 **200** + 正确 MIME；`/`、`/ide`、`/vision`、`/vision/sketch`、`/vision/ocr` **200** |

**遗留**：pnpm 11 的"`pnpm` 字段不再读取"告警（见上，有意保留以兼容 pnpm 9）；若将来 brace-expansion 1.x 线再发新版并落入 24h 隔离窗口，CI 会再次拦截（属该策略的预期行为）。

### 追加：两项此前"未验证"的静态补验（2026-09-15）

**① OpenCV.js API 面：项目用到的 74 个 `cv.*` 符号全部存在，0 缺失**

- 起因：批 6 新增的 4 个 OpenCV 工具（椭圆拟合 / 模板匹配 / 图像拼接 / 表格结构）此前只有"构建通过"，运行时 API 是否存在未验。缺符号 = 点开就 `cv.xxx is not a function`。
- **踩了两个坑，都是方法错**：
  1. 先在 `opencv.js` **JS 明文里 grep 符号名** → 报告 54/74 缺失，但 `threshold`/`Canny`/`findContours` 明明在用，**结论显然错误**。
  2. 原因：`public/opencv/opencv.js` 是 **single-file 构建**，wasm 以 `wasmBinaryFile="data:application/octet-stream;base64,…"` **内嵌**，符号名不在 JS 明文里。提取 base64 时又踩一次坑 —— 直接 `indexOf('data:application/octet-stream;base64,')` 命中的是文件前部的 `dataURIPrefix` 常量声明，解出 0 字节。
- **正确做法**：锚定 `wasmBinaryFile=` 赋值取 base64 → 解码得 **7,616,022 字节**（magic `0061736d` ✓）→ 直接在 WASM 二进制里查绑定名（embind 把名字以 UTF-8 存在数据段）。
- 结果：**72/74 命中 wasm**；余下 2 个经查均非真问题 —— `then` 是我的正则把 `opencv.ts` 自己的 `cv.then(...)` thenable 判断误抓；`matFromArray` 是 **JS 侧助手**，以 `Module["matFromArray"]=function(...)` 方括号形式定义（故 wasm 里没有，且 `cv.X=` 形式的正则也抓不到），实际可用。
- **结论：包含 4 个高风险新工具在内，API 面零缺失。** 仍未覆盖的是"调用参数与算法结果正确性"，那需要真机。

**② 302 回退目标的跨域与 Range：全部可行**

此前只验到"302 与 `Location` 正确"，跨域能否被浏览器读取标注为未实测。带 `Origin` 头实测各回退目标：

| 目标 | 结果 |
|---|---|
| jsdelivr（face-api / doodlenet / mediapipe wasm） | **206 + `Access-Control-Allow-Origin: *`** |
| storage.googleapis.com（mediapipe 模型 / speech-commands） | **206 + `ACAO: *`** |
| tfhub.dev（mobilenet） | 302 + `ACAO: *`（终点为 GCS，同样 `ACAO: *`） |

**③ 顺带验证了回退映射的正确性**：`/model/mediapipe/wasm/<name>/<file>` → `…/@mediapipe/<pkg>@<ver>/wasm/<file>` 这个反查，用本机真实产物文件名核对 —— `vision_wasm_internal.js/.wasm`、`vision_wasm_module_internal.*`、`vision_wasm_nosimd_internal.*` 共 6 个在 jsdelivr 上**全部 200**。

（补充说明：过程中我用不存在的文件名 `vision.js` 测过一次，得到 404 —— 那是测试用例的问题，不是映射缺陷，故此项单独复核。）

---

### 追加：改进建议 P0–P3 全量落地（2026-09-15）

按「运行时可信 → 可用性 → 部署与离线 → 细节」四批做完 10 项。每项都给了**它防的是什么错**，便于以后判断能不能摘掉。

**P0.1 单次运行耗时 + 实际后端标注**（`ImagePlayground.vue` + `image-tools.ts`）

- 防的错：能力页的价值是「同一任务多实现对比」，但学生会把 **后端差距（webgpu vs wasm）误读成模型差距**。不标后端，对比结论就是错的。
- 实现：`ImageToolResult` 新增 `device?`（工具自己能确定就填，如 depth 的 `wasm`、抠图的 `preferredDevice()`）；否则由 `effectiveDevice()` 按 `kind` + 本机 WebGPU 探测推断。`run()` 里 `performance.now()` 计时，与后端一起显示在结果区。
- 边界：canvas 类工具每帧重跑（<16ms），**显示耗时只会是噪声**，故 `showRunMeta` 排除 `kind === 'canvas'`；实时循环只更新后端、不动耗时（逐帧耗时不可比）。

**P0.2 本机能力探测面板**（新增 `app/components/DeviceCapabilities.vue`，挂首页非搜索态）

- 防的错：学生机器差异大（无独显/旧浏览器/禁摄像头/内存不足），先摆出「这台机器能跑什么」，好过点开能力页再报错。
- 探测项：WebGPU（`requestAdapter` + `adapter.info.architecture`）、多线程（`SharedArrayBuffer` **且** `crossOriginIsolated`）、WASM SIMD（内联 v128 模块走 `WebAssembly.validate`）、CPU 核数、WebGL2（MediaPipe GPU 委托走 WebGL，故探 WebGL2 而非只看 WebGPU）、摄像头 API、`deviceMemory`、`storage.estimate`。
- 全部客户端完成、不上报；**不主动申请摄像头权限**（只探 API 是否存在）。

**P0.3 `depth` 硬编码 `device:'wasm'` 复核 → 判定「有意为之」**

- 依据是代码里的既有注释：depth-anything 在 WebGPU（onnxruntime jsep）执行报 `null function`，故强制 wasm 稳定。
- 处理：**不改行为，改文案** —— 把这个原因写进 `demos.ts` 的 `howItWorks`，否则下一个人看到「明明有 WebGPU 却显示 wasm」会当成 bug 去"修"。

**P1.4 深链（URL ↔ 工具/参数）** —— 过程中发现并修掉一个时序缺陷

- 防的错：老师想「把指定工具 + 指定参数」发给学生，点开即落在同一状态。
- **缺陷（只有读代码才能发现，构建/类型检查都不会报）**：`activeToolId` 的 watcher 会在 pre-flush 里把 `paramValues` 重置成默认值，而它**排在 `onMounted` 的 `applyDeepLink()` 之后执行** → URL 参数被默认值覆盖，深链实际失效。
- 修法：深链要切工具时，先把 URL 参数放进 `pendingParams`，**由那个 watcher 自己消费**（`{...defaults, ...pendingParams}`），工具没变则直接赋值。这样不依赖 watcher 的触发时机。
- 顺带两处收尾：只把**偏离默认值**的参数写进 URL（链接保持 `?tool=yolo-detect&conf=0.4` 这种短形态），并用 `writtenParams` 记录上次写了哪些键，切工具后据此清掉旧工具残留；`onUnmounted` 取消挂起的写 URL，避免离开页面后 400ms 又回写地址栏。

**P1.5 首次加载提示**（`startSlowHint` / `stopSlowHint`，阈值 1200ms）

- 防的错：模型首次下载 + 初始化期间界面只有转圈，容易被当成卡死。`run()` 前启动、`finally` 里停止，因此**成功和失败都不会留下过期提示**。

**P1.6 模型状态页**（新增 `app/pages/status.vue` + `server/api/models/status.get.ts`，页脚入口）

- 用途：自托管的**部署自检** —— 本地模型是否齐备、缺什么、缺失项会不会 302 回退远程。
- 只回传统计量（组名/文件数/MB）与**相对路径**，不暴露服务器绝对路径；`GROUPS` 8 组，关键文件表 = MediaPipe 全部 + doodle + vendor。

**P2.7 COOP/COEP 跨域隔离（默认关闭）**

- 打开后才有 `SharedArrayBuffer` → onnxruntime-web / MediaPipe / Tesseract / Pyodide 可启用多线程 WASM（相对单线程有数倍差距）。
- **为什么默认关**：开它是个「要么全好要么全坏」的开关，有三条链路必须先真机复验 —— ① 模型缺失 → 302 回退 CDN；② 站内 iframe 子应用（`public/apps/*`）；③ 统计脚本（百度/GA）。任一条被 COEP 拦掉就是线上事故。
- 开关形式：构建时 `NUXT_ENABLE_CROSS_ORIGIN_ISOLATION=true` 才注入 `routeRules['/**'].headers`；用 `credentialless` 而非 `require-corp`（对无凭据跨域子资源更宽容，不支持的浏览器会忽略该值退化为非隔离，**不会硬失败**）。生产 nginx 需同步同名响应头。

**P2.8 PWA / Service Worker（只缓存外壳）**（新增 `public/sw.js`、`app/plugins/pwa.client.ts`、`public/manifest.webmanifest`、`public/icon-{192,512}.png`）

- 手写 SW 而非引入 `@vite-pwa/nuxt`：本项目部署链路很定制（静态 + Nitro + nginx alias），少一个依赖少一处漂移。
- 四条**必须遵守的边界**（都对应一个已知坑，已写进 `sw.js` 顶部注释）：
  1. `/model/*` **不缓存**：模型几十 MB，`/model/*` 本身已带长缓存头，SW 再存一份等于磁盘翻倍；且该路由会 302 回退 CDN，缓存 302 会污染结果。
  2. `/api/*` 不缓存（状态页必须实时）。
  3. `/_nuxt/builds/*` **不缓存**：那是 Nuxt 的构建版本探针，缓存住会让旧页面误判「已是最新」，继而请求新部署已删除的 chunk。只缓存 `/_nuxt/` 下带内容哈希的资源（天然安全）。
  4. 导航请求 network-first，**仅断网**回落缓存外壳；`Range` 请求直接放行（否则命中缓存会返回 200 全量、破坏 206 语义）。
- 仅生产注册（dev 下 SW 会缓存 Vite 模块，改代码不生效）；等 `load` 后再注册，不抢首屏带宽；注册失败静默降级。
- 图标是按掩码安全区（内容 ≤ 0.4d）程序化生成的，`512` 同时声明 `any` 与 `maskable`。

**P3.9 模型缓存 TTL 对齐长缓存**：`/model/*` 由 `no-cache` 改为 `public, max-age=604800`（dev 下 60）。模型是内容寻址式的大文件，改动频率远低于 7 天。

**P3.10 DoodleNet 345 类中文映射**（新增 `app/utils/doodle-labels.ts`）

- 标签来源：ml5 包内烘焙的 345 项数组（`ml5.min.js` 里那串 snake_case 列表），**不是**同文件里那套带 `/m/xxx` 的 displayName 表（那是 MobileNet 的）。
- 放 `doodle-labels.ts` 而不塞 i18n：这些是**模型输出的类别名**而非界面文案，键必须与模型输出逐字一致（含下划线/连字符），混进 i18n 会同时污染 key 空间与「未引用 key」检查。
- 键的合法性被**脚本核对过**：345 模型类 ↔ 345 映射键，**0 缺失、0 多余、0 重复**。核对过程中抓出两处我自己的错 —— 多写了 `orange`（**该模型的 345 类里确实没有 orange**）、漏了 `dresser`。这条核对命令值得保留到以后改这张表时再跑。
- `doodleClassify()` 现在返回**模型原始标签**，展示层统一走 `formatDoodleLabel(raw, zh)`；未收录的类别回退为「英文去下划线」，**漏译只显示英文、不会报错**。
- lint 折衷：`t-shirt`/`teddy-bear` 不是合法标识符必须加引号，而项目启用的 `quote-props: consistent-as-needed` 要求「全加或全不加」，于是 345 行会全被套上引号、反而看不出哪几个键特殊。故在文件内对该规则做了**带理由的局部 disable**。

**门禁与实测（全部实跑）**

| 项 | 结果 |
|---|---|
| `nuxt typecheck` | **476**（与改动前基线一致，新代码 0 新增错误） |
| `eslint`（全部改动/新增文件） | **0 error** |
| `check:i18n` | 958 处引用 / 753 key，en·zh 均在 |
| `pnpm build` | **EXIT=0**，265 MB（93.7 MB gzip），trim 无残留 |
| 冒烟：`/`、`/status`、`/vision/sketch` | 200 |
| 冒烟：`/manifest.webmanifest`、`/sw.js`、`/icon-{192,512}.png` | 200，MIME 正确（`application/manifest+json` / `text/javascript` / `image/png`） |
| 冒烟：`/api/models/status` | 200，`ready=true`，8 组全在、`missing=0`、监测到 10319 MB |
| 冒烟：301 迁移 | `face-detection→face`、`bg-removal→matting`、`yolo-detection→yolo` 均 301 |
| 冒烟：302 回退 | 临时移走 `faceapi/…-weights_manifest.json` → **302 且 Location 为 jsdelivr**，还原后 200；无远程对应的缺失文件 → 404 |
| 冒烟：`/model/*` 头 | `Cache-Control: public, max-age=604800` + `Accept-Ranges: bytes`；`Range: bytes=0-99` → **206 / 100B**（`.bin` 与 `ml5.min.js` 均过） |
| `sw.js` 语法 | `node --check` 通过 |

**仍未验证（需真机/浏览器，无法在此环境自动化）**：① 深链的浏览器行为（时序缺陷是按调度语义推出来的，未在真实浏览器点过）；② PWA 安装与断网外壳回落；③ COOP/COEP 开启后那三条链路的复验；④ DoodleNet 真机识别效果。

---

## 10. 决策记录

| # | 问题 | 决定 | 来源 |
|---|---|---|---|
| 1 | MediaPipe 引擎页收几个任务 | **全收 11 个** | 用户 |
| 2 | 能力页内实现排序 | **MediaPipe 在前**（模型小、先出结果） | 用户"随便"，定为默认 |
| 3 | `ai-vision` 是否下线 | **下线**；`image-classify`→`classification`、`object-detect`→`detection`、`image-segment`→`segmentation`、`background-removal`→`matting`；`image-embed`+`image-similarity`→MediaPipe 引擎页 | 用户 |
| 4 | "关键点"要不要建能力页 | **只有全身（`pose`）建**：MediaPipe 33 点 vs YOLO 17 点；人脸/手部关键点不建 | 用户 |
| 5 | 实时模式路线 A / B | **路线 A（必做）**——不做则收编 MediaPipe 页即降级 | 本方案 |
| 6 | `pixel` 教学页 | **保留独立入口**，改名「像素原理（教学）」，文案对齐教学内容；`pixelTools` 拆解后废弃 | 本方案 |
| 7 | `face` 是否升级为能力页 | **保持工坊形态**（它是主题不是单一任务），扩到 6 工具 | 本方案 |
| 8 | 经典算法（Canvas/OpenCV）是否建引擎页 | **不建**，入口就是 11 个图像工坊（算子太多，扁平列表不可用） | 本方案 |

---

## 附录 · 候选引擎（未来扩"第 2/3 个实现"用）

三条最有价值的扩充路径：

| 能力页 | 可加的实现 | 收益 |
|---|---|---|
| `detection` / `classification` / `segmentation` | **WebAI.js**（OpenCV.js + ONNXRuntime 封装，直跑 PaddleDetection/Clas/Seg 导出模型） | 第三个实现，自带预处理配置，省写 `preprocess` |
| `matting` | **@imgly/background-removal**（RMBG 系） | 抠图效果通常强于 MediaPipe selfie / MODNet |
| `segmentation`（交互式） | **SAM / SAM 2** | `interactive: 'prompt'` 的上游标准；照它设计接口，换模型不改交互 |

其他可选运行时：**LiteRT.js**（Google 2026-07 发布，`.tflite` + WebGPU/WebNN）。

**边界**：`Fabric.js` / `Konva` 是画布**对象编辑器**（图层/拖拽/序列化），不是像素算法库，属于另一个维度，**不进引擎矩阵**。`jsfeat`（11 年未更新）、`tracking.js`（10 年未更新）不建议引入。
