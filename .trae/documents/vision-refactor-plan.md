# 视觉（vision）分类重构实施方案

## Context（背景）

用户反馈视觉分类功能「混乱」：同一能力存在多种入口（独立静态页 / 图像工坊 ImagePlayground / MediaPipe 单项），命名两级并存，且部分页面输入方式不统一。经梳理确认三条决策：

1. **逻辑分组**：不改文件/URL，给 demos.ts 的 vision 条目加 `group`（Localized），分类页按子分组展示标题；非 vision 分类保持现状。
2. **重复功能共存**：ai-vision（六合一）、multimodal（四合一）与独立的抠图/深度/描述/嵌入/分割页都保留，归入对应分组。
3. **输入统一**：所有视觉页面图片输入支持「上传 + 示例图 + 实时摄像头」三选一。纯图像处理工具（基于 ImageData 的工坊）用「拍照截帧一帧作为输入」；AI/分割/检测类保持实时逐帧。

## 现状关键事实

- 三套入口：`ImagePlayground`（15 工坊页，`[slug].vue`→image-tools）、`MediaVisionRunner`（8 MediaPipe 页，`[slug].vue`→mediapipe-vision）、独立静态页 `app/pages/vision/*.vue`。
- MediaVisionRunner 8 页、image-segmenter、face-recognition **已支持摄像头+上传+示例**，不改。
- **缺摄像头**的页面：ImagePlayground 15 页、bg-removal / depth-estimation / image-captioning / image-embedder / interactive-segmenter、YoloRealtime（仅摄像头，缺上传/示例）。
- 复用件：`FaceCameraCapture.vue`（完整相机，移除 face-api 即可复用）、`useVisionSamples.ts`（示例图→File）、`SampleImagePicker.vue`、`MediaInput.vue`（拖拽+示例，无摄像头）、`processImageFile`（File→可解码 URL）。
- 数据层：`demos.ts` 的 `Demo` 无 group 字段；`useDemos.ts` 的 `byCategory()` 被首页/侧边栏/首页页共用，**不得改动**。

## 实施方案

### 1. 分组定义（demos.ts / useDemos.ts / CategoryPage）

**分组（稳定 key → Localized 名），顺序即展示顺序：**

| key | zh | en | slug 归属 |
|---|---|---|---|
| `image-workbench` | 图像处理工坊 | Image Workbench | viewer, transform, pixel, color, adjustment, filters, enhancement, morphology, edge, object, features |
| `face` | 人脸视觉 | Face Vision | face, face-detection, face-landmarker, face-recognition |
| `hand-pose` | 手势与姿态 | Hands & Pose | hand-landmarker, gesture-recognizer, pose-landmarker, holistic-landmarker |
| `ai-object` | AI 检测与识别 | AI Detection & Recognition | object-detector, image-classifier, ai-vision, yolo-detection |
| `segmentation` | 图像分割与抠图 | Segmentation & Matting | bg-removal, image-segmenter, interactive-segmenter |
| `multimodal` | 深度与图像描述 | Depth & Captioning | multimodal, depth-estimation, image-captioning |
| `embedding-ocr` | 嵌入与文字识别 | Embedding & OCR | image-embedder, ocr |

**改动：**
- `app/utils/demos.ts`：`Demo` 接口加**可选** `group?: string`；导出 `visionGroupKeys`（顺序数组）、`visionGroupLabels: Record<key, Localized>`；给 31 个 vision 条目加 `group`.
- `app/composables/useDemos.ts`：新增 `byCategoryGrouped()`（复用现有 `byCategory()` 与 `pick()`），按 groupOrder 出桶，未分组项收纳为单个未分组 bucket；`byCategory()` 保持原样。
- `app/components/CategoryPage.vue`：改用 `byCategoryGrouped()`；仅当 `title` 分组 ≥2 个时渲染组标题，否则保持原平铺。其他分类（speech/nlp/aigc/ml/robot 全无 group）落单 bucket，**不显示标题**。
- `DemoCard.vue`：不改。

### 2. 通用相机组件 WebcamCapture（新增）

新建 `app/components/WebcamCapture.vue`，从 `FaceCameraCapture.vue` 抽取（去掉 face-api/live/overlay）：
- Props：`facing?: 'user'|'environment'`（默认 user）、`mirror?: boolean`（默认 true）。
- Emits：`capture: [File]`（JPEG 帧）、`close: []`。
- 复用 `mediaError` 友好错误；`onBeforeUnmount(() => stop())` 释放轨道。
- i18n：新增通用 `webcam.*` 键。

### 3. 逐页补齐摄像头

统一原则：新拍照按钮打开 WebcamCapture，捕获的 File 当作用户上传文件走各自既有 load 函数。

| 组件/页面 | 当前 | 接入点 |
|---|---|---|
| `ImagePlayground.vue`（15 页） | 拖拽+示例 | `v-if="!original"` 上传占位区（约 793-828）示例按钮行旁加「拍照」→ `loadFile` |
| `YoloRealtime.vue` | 仅摄像头 | 加 `fileInput` + SampleImagePicker + 拍照；拆 `inferImage(src)` 单帧入口（画到 canvas → 复用 `preprocess`+`postprocess`+`draw*`），不动摄像头 loop；验证 `useYolo.preprocess` 是否兼容静态 source |
| `bg-removal.vue` | 上传+示例 | 按钮行（约 209-221）加拍照 → `onCamFile`（`processImageFile`+`removeBg`） |
| `depth-estimation.vue` | 上传+示例 | 加拍照 → `processImageFile`+`run` |
| `image-captioning.vue` | 上传+示例 | 加拍照 → `processImageFile`+`run` |
| `image-embedder.vue` | 上传+示例(双图) | 加拍照 → 取为第二图（复用 useSample 路径） |
| `interactive-segmenter.vue` | 上传+示例 | 加拍照 → 复用 `onFileChange`/`createImageBitmap` |

**不改**：image-segmenter、face-recognition、MediaVisionRunner 8 页、pixel（教学页）。

## 风险

- `Demo.group` 必须可选；`visionGroupLabels[key]` 需 guard，undefined 兜底空串。
- WebcamCapture 必须释放轨道，拍照后立即 close，避免多实例占摄像头。
- **勿改 `byCategory()`**（首页/侧边栏/首页页依赖）；分组逻辑放 `byCategoryGrouped`。
- YoloRealtime 静态源需验证 `preprocess` 签名（当前吃 video 元素）。

## 验证

1. `pnpm typecheck` —— 可选 group 不破坏其他分类、`byCategoryGrouped` 通过。
2. `pnpm lint` && `pnpm build`。
3. 手动回归：
   - `/vision` 出现 7 个分组标题、顺序正确；`/speech`、`/nlp`、`/aigc`、`/ml`、`/robot` 无标题、卡片一致。
   - 首页与侧边栏计数/顺序不变。
   - 逐页：任一工坊页拍照截帧→出结果；bg-removal/depth/caption/embedder/interactive 拍照→出结果；YOLO 静态图/拍照单帧出框；image-segmenter 回归正常。
   - 摄像头拒绝/非 https → 显示友好错误不白屏；切走后指示灯熄灭（轨道已停）。