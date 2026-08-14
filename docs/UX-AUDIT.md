# 用户体验审计报告（UX Audit）

> 审计日期：2026-08-13
> 审计对象：nuxt_AI 全站（app/、server/、i18n/）
> 审计视角：通用使用者（兼顾学生群体）
> 审计方法：4 个维度静态代码走查，所有问题均定位到文件：行号，可验证、有改法

---

## 审计框架

### 四大维度

| 维度 | 检查内容 |
|---|---|
| 1. 文案与国际化 | i18n key 一致性、硬编码文本、术语友好度、错误/加载文案、数据自洽 |
| 2. 界面组件与交互状态 | 交互五态、暗色模式、响应式（375px）、上传体验、结果展示、空状态、进度三态 |
| 3. 错误处理与降级 | 权限失败、模型加载失败、任务超时、资源清理、上传校验、环境缺失、SSR 安全 |
| 4. 导航/信息架构/示例素材 | 首屏价值传达、预期管理、示例素材、demo 间导航、教育价值、结果出口、隐私卖点、帮助入口、SEO |

### 严重度分级

- **P0** — 功能断点：用户无法完成核心流程，或界面直接暴露 bug
- **P1** — 明显伤害体验：用户会困惑/失望/流失，但有办法绕过
- **P2** — 质感问题：不影响完成，影响精致度和口碑

### 统计概览

| 级别 | 数量（约） | 代表问题 |
|---|---|---|
| P0 | 4 | 轮询无超时、离开页面轮询不停、i18n key 缺失、全站无示例素材 |
| P1 | ~20 | 原始报错直出、权限提示不统一、Runner 无下载进度、无预期管理标签、demo 页无导航 |
| P2 | ~15 | 暗色模式局部翻车、术语腔、无 og 图、无复制按钮 |

---

## 一、P0 问题清单（必须优先修复）

### P0-1 服务端任务轮询无超时上限，任务卡死则前端无限等待

- **位置**：`app/pages/aigc/sd-turbo.vue:78-90`，同模式存在于 `speech/lip-sync.vue:69`、`aigc/photo-restore.vue:58`、`speech/midi.vue:66`、`denoise.vue:64`、`speech-translate.vue:59`、`meeting.vue:61`、`musicgen.vue:56`、`voice-clone.vue:125`、`separation.vue:97`、`vad.vue:64`
- **现状**：`pollTask` 为 `while (true)` + 1.5s 轮询，仅 `done/error/cancelled` 或请求失败才退出。Python worker 卡死或服务重启丢任务时，前端无限 loading。ML 类页面（`forecast.vue:78-106` 等 setInterval 版本）同样无最大尝试次数。
- **改法**：加入超时上限（累计 N 次或 wall-clock 10/30 分钟），超时后提示「任务超时，可能服务已重启，请重试」并停止轮询、复位 loading。

### P0-2 离开页面后轮询不停止

- **位置**：`app/pages/aigc/sd-turbo.vue:100-102`（`onBeforeUnmount` 只 revoke previewUrl）；同样问题见 `lip-sync.vue`、`photo-restore.vue`、`midi.vue`、`meeting.vue`、`musicgen.vue`、`speech-translate.vue` 等所有 `while(true)` 轮询页面
- **现状**：组件卸载后 `pollTask` 循环仍在跑，继续 `$fetch` 并写已卸载组件的状态，切回页面后状态错乱。对比 `forecast.vue:147`、`dim-reduction.vue:129` 有 `stopPolling()` 正确清理，两种实现不统一。
- **改法**：统一封装 `useTaskPoller` composable（含超时、卸载取消、重试容忍），所有任务页接入。

### P0-3 `demo.inputRequired` i18n key 双语均缺失

- **位置**：`app/pages/aigc/sd-turbo.vue:49-50`、`app/pages/aigc/photo-restore.vue:37`
- **现状**：代码调用 `t('demo.inputRequired')`，但 zh.json / en.json 的 `demo` 节点均无此 key（只有 `tf.inputRequired`），运行时渲染原始键名。
- **改法**：`demo` 节点补 `"inputRequired": "请先填写输入内容"` / `"Please fill in the input"`。

### P0-4 全站无预置示例素材，一半以上 demo「点开没法玩」

- **位置**：`app/components/MediaVisionRunner.vue:215-242`、`MediaTextRunner.vue:28`、`ImagePlayground.vue`（无 sample 逻辑）；`public/` 下无 samples 目录
- **现状**：视觉类 demo 必须用户自己上传图片或开摄像头；音频类必须自备音频文件。无摄像头设备即为死路。
- **改法**：建 `public/samples/`（人脸照、多人照、风景照、文档照、语音、音乐、带噪语音各 1-2 份），Runner 组件统一加「试试示例」按钮。
- **必须自备素材的 demo 清单**：

| 分类 | demo | 所需素材 |
|---|---|---|
| speech | asr(上传)、audio-classifier、separation、voice-clone、emotion、denoise、vad、visualizer、meeting、midi、speech-translate、lip-sync | 音频/视频 |
| vision | face-*、hand/gesture/pose/holistic、object-detector、image-classifier/embedder/segmenter、interactive-segmenter、depth-estimation、image-captioning、bg-removal、face-recognition | 图片 |
| vision | 图像工坊 15 页（经 ImagePlayground） | 图片 |
| nlp | text-classifier、language-detector、text-embedder | 文本（输入框为空） |
| aigc | inpainting、multimodal-chat、photo-restore | 图片 |
| ml | auto-train、forecast、palette | CSV/图片 |

---

## 二、维度一：文案与国际化

### P1

1. **原始技术报错直出给用户（系统性，20+ 处）**
   - 位置：`vision/depth-estimation.vue:58,74,92`、`image-captioning.vue:59,76,97`、`bg-removal.vue:59,76,121`、`face-recognition.vue:98,117`、`aigc/webllm.vue:155,198`、`codegen.vue:130,172,193`、`text-to-image.vue:111,143,157,187`、`ml/image-training.vue:73`、`nlp/text-embedder.vue:41,68` 等
   - 现状：`error.value = e?.message || String(e)` 直接渲染，用户看到 "fetch failed" / "out of memory"
   - 改法：统一错误兜底 `t('demo.processFailed')`，原始 message 放 description/console；常见错误（网络、显存、模型未加载）映射成人话。

2. **en.json 省略号"…"被错写成问号"?"（疑似编码事故）**
   - 位置：`i18n/locales/en.json:169-172, 190`
   - 现状：`"Downloading model? {progress}%"`、`"Analyzing emotion?"` —— 加载文案变成疑问句
   - 改法：全部改回 `…`。

3. **硬编码中文（英文界面下露馅）**
   - 位置：`aigc/sd-turbo.vue:68,81,86,87,97`、`aigc/photo-restore.vue:48,61,65,66,76`
   - 现状：`'提交失败'`、`'任务查询失败'`、`'处理失败'`、`'已取消'` 写死
   - 改法：提取 `demo.submitFailed/taskQueryFailed/processFailed/cancelled`。

4. **硬编码英文**
   - 位置：`vision/[slug].vue:131`、`aigc/[slug].vue:37`（`title="Demo not found"`）；`nlp/text-embedder.vue:79,83,107`（`Text A`/`Text B`/`Cosine Similarity`）
   - 改法：补 i18n key。

5. **6 个 demo 状态与描述自相矛盾**
   - 位置：`app/utils/demos.ts:818-876`（filters、enhancement、morphology、edge、object、features）
   - 现状：`status: 'ready'`（绿色"可用"徽章）但 description 写「（规划中）」
   - 改法：改 `status: 'planned'` 或删描述中的「（规划中）」。

### P2

- `en.json:2` 多出未使用的 `welcome` key —— 删除或补齐
- 后端错误文案技术黑话：`zh.json:43`「请创建虚拟环境并安装依赖」/`en.json:44` "create the venv and install deps" —— 改为人话 + 文档链接
- 术语腔：`zh.json:66-67`（嵌入/零样本）、`zh.json:513-517`（L2 归一化/量化）、`zh.json:352-378` capabilities 页 —— 补通俗解释
- `zh.json:23` 中英混用「搜索 demo…」；`zh.json:14` 分类标题「语音 / Speech」中英混排
- `demos.ts:691` sd-turbo tags 混入标题文本 `'Text/Image-to-Image (SD-Turbo)'`
- `zh.json:337`/`en.json:338` `inpainting.paste` 中英语义不对等
- 其他硬编码：`ml/audio-training.vue:168`、`ml/mnist.vue:63`、`aigc/inpainting.vue:104`、`vision/bg-removal.vue:104`、`speech/visualizer.vue:57`
- 任务型 demo 通用文案 `processing` 无 `{progress}%` 占位（separation/voiceClone/denoise/vad/musicgen/meeting/midi/translate/lipSync），但代码已轮询到 `task.progress` —— 文案加百分比

### 良好实践（保持）

- `asr.whisper.downloading`、`emotion.downloading` 含 `{progress}%`；`textToImage.firstDownload` 等明确告知下载体积
- 除 `welcome` 外 zh/en key 结构完全一致
- faceStudio 摄像头权限文案是「人话 + 指引」标杆

---

## 三、维度二：界面组件与交互状态

### P1

1. **MediaVisionRunner 摄像头启动竞态**
   - 位置：`app/components/MediaVisionRunner.vue:216-223`
   - 现状：`getUserMedia` 等待授权期间无反馈、按钮可重复点击，会拿到多路 stream（旧 stream 未 stop）
   - 改法：新增 `starting` 状态覆盖整个 startWebcam，期间禁用按钮。

2. **通用 Runner 模型下载无进度、三态不分**
   - 位置：`TransformersTextRunner.vue:168-174`、`MediaTextRunner.vue:36-50`、`MediaVisionRunner.vue:60-78`
   - 现状：`loading`（下载）与 `running`（推理）共用一个按钮 spinner；几百 MB 下载无进度条。对比 `codegen.vue:252`、`bg-removal.vue:172` 有 `UProgress + progress_callback`，通用 Runner 反而没有
   - 改法：传 `progress_callback` 显示下载百分比；按钮 label 随状态切换（「下载模型…」/「推理中…」）。

3. **上传区体验薄弱**
   - 位置：`MediaVisionRunner.vue:240`、`aigc/photo-restore.vue:98-101`、`speech/denoise.vue:117-122`
   - 现状：裸 file input，无拖拽、无粘贴、无预览缩略图、无移除重传、无格式/大小事前说明
   - 改法：复用 ImagePlayground 的虚线拖拽区为统一上传组件，监听 `paste`，加 hint 文案。

4. **移动端网格未降级（7+ 处）**
   - 位置：`PyodideRunner.vue:255`（`grid-cols-2`）；`ml/mnist.vue:260`、`cartpole.vue:220`、`kmeans.vue:284`、`playground.vue:285`、`decision-tree.vue:247`、`regression.vue:222`、`anomaly.vue:242`（`grid-cols-3` 无 `sm:` 前缀）
   - 现状：375px 下指标卡被压至 ~100px，大数字溢出
   - 改法：改 `grid-cols-1 sm:grid-cols-2/3`。

5. **暗色模式硬编码颜色**
   - 位置：`ml/decision-tree.vue:297`（SVG 节点 `fill="#1E293B"` 暗背景下不可见）、`ml/forecast.vue:237-239`、`ml/kmeans.vue:182-191`、`ml/playground.vue:309`（`stroke="#FFFFFF"`）、`ml/mnist.vue:248`（`bg-white` 画板）
   - 改法：SVG 改用 `currentColor` + 语义 class，或按 `colorMode` 切换色板；mnist 白底画板如属有意为之请加注释。

### P2

- `ImagePlayground.vue:443`：自动重跑与手动点击可并发，加 `if (running.value) return`
- `MediaVisionRunner.vue:232-239`：大图 decode + detect 同步阻塞 UI，detect 前 `await nextTick()`
- `vision/face-recognition.vue:232`：Canvas 标签底色 `#0b1220` 写死
- `photo-restore.vue:134-151`：无 slider 式前后对比；`aspect-square` 裁切非方形图
- 文本类结果卡无「复制」按钮（MediaTextRunner/TransformersTextRunner）
- 空状态依赖各页面自觉，Runner 未内置默认空态（`MediaTextRunner.vue:117-125` 等）
- `ml/mnist.vue:239` 模型加载进度用 UAlert 文本，建议统一 UProgress
- `FacePhotoPicker.vue:54` 非图片文件静默 `continue`，无反馈

### 良好实践（保持）

- 核心组件全部使用 `text-highlighted/bg-elevated/border-default` 语义 token，暗色模式自动适配
- `ImagePlayground.vue:325-337` 拖拽上传 + 三格式下载；`FacePhotoPicker.vue:139-158` 拖拽 + 多文件 + 缩略图
- `photo-restore.vue:129-132`、`denoise.vue:150-158` 进度条 + 百分比 + 取消按钮
- 服务端任务类页面（webllm/codegen/text-to-image/inpainting 等）均有模型下载 UProgress

---

## 四、维度三：错误处理与降级

### P1

1. **摄像头/麦克风权限拒绝提示不统一，多数页面直出英文原始报错**
   - 位置：`MediaVisionRunner.vue:103-105`、`vision/image-segmenter.vue:70-72`、`ml/image-training.vue:89-91`、`ml/pose-training.vue:155-157`、`speech/emotion.vue:65-67`、`voice-clone.vue:71`、`audio-classifier.vue`、`pitch-detector.vue`
   - 现状：catch 后 `error.value = e?.message`，权限被拒显示 "Permission denied" 英文原文，无 i18n、无指引
   - 改法：把 `FaceCamera.vue:27-31` 的 `permissionMessage`（区分 NotAllowedError/NotFoundError/NotReadableError/非 HTTPS）抽成公共 util，全站统一。

2. **模型下载失败无重试/降级引导**
   - 位置：`TransformersTextRunner.vue:75-76`、`aigc/webllm.vue:154-155`、`codegen.vue`、`reasoning-chat.vue`、`multimodal-chat.vue`、`text-to-image.vue`
   - 现状：HF 代理失败（`server/api/hf/[...].get.ts:48-59` 返回 502）时用户看到 "Failed to fetch"；WebGPU 中途失败仅 `speech/emotion.vue:127-129`、`speech/asr.vue:222-225` 有 webgpu→wasm 回退，其余 transformers.js 页面无回退
   - 改法：统一 catch 识别网络类错误 → i18n 文案 + 重试按钮；WebGPU 失败自动以 wasm 重试一次（复用 asr.vue 模式）。

3. **上传文件无大小事前校验**
   - 位置：前端各上传点（`denoise.vue:119`、`meeting.vue:130`、`lip-sync.vue:121-130`、`sd-turbo.vue:36-46` 均无 size 检查）；服务端仅 `dim-reduction-queue.ts:73`、`forecast-queue.ts:75` 有 10MB 限制
   - 现状：大文件直接上传，事后才报错（denoise/separation 等队列甚至无服务端限制）
   - 改法：`onFileChange` 统一前置校验（类型 + 大小上限：音频 50MB / 图片 20MB），超限立即提示。

4. **重复提交缺少入口守卫**
   - 位置：`aigc/sd-turbo.vue:48-76`
   - 现状：`run()` 无 `if (loading.value) return`，回车/快速双击可并发提交，taskId 互相覆盖
   - 改法：所有 `run()` 入口加守卫（`webllm.vue:162`、`emotion.vue:45` 已做对）。

### P2

- **Python 环境缺失无事前禁用**：队列会报中文错误（文案清晰，做得对），但 Vercel 环境下用户要走完「选文件→上传→提交→轮询→报错」全程才知道不可用。改法：demo 元数据标注 `requiresPython`，云端部署时页面顶部 UAlert + 禁用提交
- `voice-clone.vue:125-150`：轮询 GET 一次网络瞬断即放弃整个任务 —— 加 3 次重试容忍
- `webllm.vue:105-107`：WebLLM import 失败 `supported=false`，需确认模板有「不支持」分支
- `ml/image-training.vue:80-81`、`pose-training.vue:146-147`：loadModels 失败静默 return，点「开启摄像头」无反馈
- 任务 error 文案（sd-turbo `'任务查询失败'` 等）无 i18n（与文案维度 P1-3 同源）

### 良好实践（保持）

- `FaceCamera.vue`：权限错误分类 i18n、非安全上下文检测、卸载停轨道、切摄像头先停后开 —— 全场最佳
- `asr.vue:222-225`、`emotion.vue:127-129` WebGPU→WASM 自动回退
- `face-recognition.vue:28` localStorage 延迟到 onMounted（SSR 安全）
- `forecast.vue:147`、`dim-reduction.vue:129` 等 ML 页面 `stopPolling()` 规范清理

---

## 五、维度四：导航、信息架构与示例素材

### P1

1. **首屏未传达核心卖点**
   - 位置：`i18n/locales/zh.json`（home.heroTitle/heroDescription）
   - 现状：仅「探索各类 AI 技术演示」，没说「浏览器本地运行 / 数据不上传 / 无需注册 / 70+ demo 点开即玩」
   - 改法：heroDescription 改为卖点导向文案。

2. **无筛选与预期管理标签**
   - 位置：`app/pages/index.vue:100-109`、`app/components/CategoryPage.vue`、`DemoCard.vue:29-43`
   - 现状：70 个卡片平铺，无精选/热门/标签筛选；卡片只有 status 徽章和技术 tags，用户点进 webllm 才知道要下载 1GB+ 模型、点进 face-detection 才知道需要摄像头、点进 sd-turbo 才知道需要本地 Python
   - 改法：注册表加 `featured`、`runtime: 'browser' | 'server'`、`requirements: { camera?, mic?, modelSizeMB?, needsServer? }`，卡片渲染「需摄像头」「模型 ~1.2GB」「需本地服务」徽章；首页每类只显示 6-8 个 + 「查看全部」。

3. **demo 页无任何上下文导航**
   - 位置：`MediaDemoShell.vue:16-41` 及所有 Runner
   - 现状：无返回按钮、无面包屑、无上一个/下一个、无相关推荐；移动端 Slideover 关闭后只能靠浏览器后退
   - 改法：MediaDemoShell 标题区加 UBreadcrumb，页底加上一个/下一个（按注册顺序取相邻项）。

4. **无教育性原理解释**
   - 位置：`app/utils/demos.ts` 全部 description
   - 现状：描述全是「做什么」，没有「原理是什么/能用来干什么」；页面模板无承载解释的区块
   - 改法：Demo 接口加 `howItWorks?: Localized` 字段，Shell 折叠渲染 2-3 句通俗原理。

5. **任务结果无法回访**
   - 位置：`server/utils/*-queue.ts`（14 个队列元数据在进程内 Map，重启即丢）；前端无「历史生成」入口
   - 改法：短期前端 IndexedDB 记录任务 ID + 结果 URL（「我的生成」页）；中期任务元数据落盘。至少在 UI 提示「结果仅本次会话有效，请及时下载」。

6. **隐私卖点未外显**
   - 位置：全局；仅 `asr.vue:378` 和个别 demo 描述提及
   - 现状：「浏览器端推理、数据不上传」是最大差异化卖点，但首页/分类页/卡片/demo 页头部均无体现；且浏览器端与服务端两种运行时用户无从区分
   - 改法：结合 `runtime` 字段统一渲染「本地浏览器运行 · 数据不出设备」/「本地服务端处理」徽章。

7. **无帮助与反馈入口**
   - 位置：`AppFooter.vue:5-22`、`AppHeader.vue:48-55`
   - 现状：无 FAQ/使用说明/反馈；GitHub 链接是占位符 `https://github.com`
   - 改法：修正真实仓库链接；footer 加「常见问题/反馈」；首页加「怎么玩」三步引导。

8. **SEO 缺口**
   - 位置：`app/app.vue:20-26`
   - 现状：无 ogImage（`summary_large_image` 无图可显示）；全站一份 meta，各 demo 页无独立 title/description，分享出去全是同一标题
   - 改法：添加 ogImage；各 Shell 组件按 demo.title/description 调 `useSeoMeta`。

### P2

- `app.vue:13` `htmlAttrs.lang` 硬编码 `'en'` —— 绑定 `locale`
- `zh.json` site.description 讲技术栈而非用户价值
- 分类 slug（nlp/aigc）出现在 URL 与搜索匹配，对非技术用户不友好；vision 分类描述是内部清单式堆砌（`demos.ts:57`）
- `AppSidebar.vue:78-89` vision 类 20+ 项无子分组
- `MediaTextRunner.vue:28` MediaPipe 文本 demo 输入框无默认值（同类 Transformers demo 都有）
- `MediaVisionRunner.vue` 标注结果（叠加 canvas）无法导出图片
- 摄像头权限被拒的错误 Alert 无「改用上传图片」引导
- 参数 help 依赖页面作者自觉，无强制

### 良好实践（保持）

- 首页全文搜索（名称/描述/标签/分类）
- Transformers NLP 任务全部带默认输入；AIGC 文本类有提示词示例 chips
- demo 页底部挂 PythonSourceViewer 源码对照
- 下载覆盖较好（ImagePlayground 三格式、asr txt/srt、meeting txt/JSON）

---

## 六、修复路线图

### 第一批（P0，体验断点）

| # | 事项 | 影响面 | 预估改动 |
|---|---|---|---|
| 1 | 封装 `useTaskPoller`（超时上限 + 卸载取消 + 重试容忍），替换 11+ 页面的 `while(true)` 轮询 | 全部服务端任务页 | 新增 1 个 composable + 改 11 页 |
| 2 | 补 `demo.inputRequired` i18n key | sd-turbo、photo-restore | 2 行 locale |
| 3 | `public/samples/` 示例素材 + Runner 统一「试试示例」按钮 | 50+ demo | 素材制作 + 改 3 个 Runner |

### 第二批（P1，体验质量）

| # | 事项 | 影响面 |
|---|---|---|
| 4 | 统一错误兜底：人话文案 + 原始错误折叠；常见错误映射（网络/显存/模型） | 20+ 处 |
| 5 | 抽公共 getUserMedia 错误 util（复用 FaceCamera 模式） | 8+ 页面 |
| 6 | 通用 Runner 加模型下载进度条 + 三态区分 | 全部 transformers.js/MediaPipe demo |
| 7 | 注册表加 `runtime`/`requirements`/`featured` 字段，卡片渲染预期管理徽章 + 首页筛选 | 全站导航 |
| 8 | demo 页面包屑 + 上一个/下一个 | 全部 demo 页 |
| 9 | 上传组件统一（拖拽/粘贴/预览/大小校验） | MediaVisionRunner、photo-restore、denoise 等 |
| 10 | 移动端网格降级 + 暗色模式 SVG 颜色修复 | 8+ 页面 |
| 11 | 硬编码文本提取到 i18n + en.json 问号修复 | 10+ 处 |
| 12 | 首页 hero 卖点文案 + 隐私徽章 | 首页 + 卡片 |
| 13 | SEO：ogImage + 各 demo 页独立 meta | 全站 |

### 第三批（P2，质感打磨）

- 文本结果「复制」按钮、Runner 内置空态、前后对比 slider
- 「我的生成」历史记录（IndexedDB）+ 「结果仅本次会话有效」提示
- `howItWorks` 教育解释字段
- GitHub 真实链接 + FAQ/反馈入口 + 「怎么玩」引导
- Python 环境缺失的事前禁用（`requiresPython` 元数据）

---

## 七、标杆实践（全站对齐基准）

以下模块的处理是当前代码库中的最佳实践，修复时应复用/推广：

| 实践 | 位置 |
|---|---|
| 权限错误分类 + i18n + 指引 | `app/components/FaceCamera.vue:27-31` |
| WebGPU→WASM 自动回退 | `app/pages/speech/asr.vue:222-225`、`emotion.vue:127-129` |
| 轮询规范清理（stopPolling） | `app/pages/ml/forecast.vue:147`、`dim-reduction.vue:129` |
| 任务进度条 + 取消按钮 | `app/pages/speech/denoise.vue:150-158`、`aigc/photo-restore.vue:129-132` |
| 拖拽上传 + 缩略图 + 移除 | `app/components/FacePhotoPicker.vue:139-158`、`ImagePlayground.vue:325-337` |
| SSR 安全的 localStorage | `app/pages/vision/face-recognition.vue:28` |
| 模型下载进度（progress_callback） | `app/pages/aigc/codegen.vue:252`、`vision/bg-removal.vue:172` |
