# 人脸注册与识别调研报告（/vision/face）

> 调研时间：2026-08-12
> 调研对象：http://127.0.0.1:3000/vision/face（人脸视觉 → 人脸注册与识别）
> 调研方式：源码走读（前端 + Nitro API + Python worker）+ 页面/接口实测（Playwright + curl）+ 行业/学术资料检索
> 结论先行：**当前「注册/识别」逻辑确实有问题，且应当支持为同一人一次性上传多张人脸照片（多样张注册），这是人脸识别行业的主流做法。** 除此之外还发现两个更严重的阻断性问题：后端 Python 环境未就绪导致任务必失败；前端轮询接口解包错误导致页面卡死 10 分钟。

---

## 1. 现状：功能是怎么实现的

### 1.1 相关代码位置

| 层 | 文件 | 作用 |
|---|---|---|
| 页面 | `app/pages/vision/[slug].vue` | `/vision/face` 走 ImagePlayground 分发 |
| 工具注册 | `app/utils/image-tools.ts`（`faceTools`，约 1666-1830 行） | `face-register` / `face-verification` 两个工具 |
| 注册面板 | `app/components/FaceRegisterPanel.vue` | 姓名输入 + 「注册此人脸 / 识别此人脸」按钮 + 已注册列表 |
| 注册库逻辑 | `app/utils/face-registry.ts` | localStorage 注册库、嵌入提取、余弦比对 |
| 提交/轮询助手 | `app/utils/image-tools.ts`（`submitAndPoll`，约 1641-1652 行） | face-verification 用 |
| API | `server/api/image/face-recognition.post.ts` | 接收 `file`（+`file2`），`mode=recognition\|verification` |
| 任务查询 | `server/api/image/face-recognition/[id].get.ts` | 返回 `{ ok, task }` |
| 队列 | `server/utils/face-recognition-queue.ts` | insightface 常驻 worker，单并发 |
| Python | `python/image/face-recognition/{main,worker}.py` | insightface `buffalo_l`，返回 512 维嵌入 |
| i18n | `i18n/locales/{zh,en}.json` → `image.faceRegister.*` | 文案 |

### 1.2 当前注册/识别流程

```
注册：上传 1 张照片 + 姓名
  → POST /api/image/face-recognition (mode=recognition, file=照片)
  → worker 用 insightface 提取该图全部人脸的 embedding（后端返回 faces 数组）
  → 前端只取 embeddings[0]（第一张脸）
  → 存入 localStorage：{ id, name, embedding, thumb, createdAt }
  → ⚠️ 若同名已存在，直接 filter 掉旧记录，用新 embedding 替换

识别：上传 1 张待识别照片
  → 同样提取 embeddings[0]
  → 与注册库里每个人的单条 embedding 算余弦相似度
  → 取最高分，≥ 0.4 判定为"识别为 XX"，否则"未识别"
```

### 1.3 页面/接口实测结果

| 项目 | 实测结果 |
|---|---|
| 页面 | `/vision/face` 200，可正常打开，注册面板正常渲染 |
| 上传 | 只能上传**一张**主图；「第二张图」上传区仅对 `face-verification`（双图验证）开放 |
| POST 接口 | `curl -F mode=recognition -F file=...` → `{"ok":true,"taskId":"..."}` ✅ |
| GET 任务 | `{"ok":true,"task":{"status":"error","message":"Python 环境尚未就绪，请等待后台安装完成","error":"venv not found"}}` ❌ |
| 前端表现 | 点击「注册此人脸」后，输入框与两个按钮**永久置灰**（busy 卡死），页面不报错；浏览器 Network 里同一个 taskId 被**无限轮询**（实测十几秒内轮询 30+ 次） |

> 实测截图：`docs/face-register-stuck-evidence.png`（点击注册后按钮卡死状态）

---

## 2. 发现的三个层面问题

### 2.1 🔴 P0-1：后端 Python 环境未就绪，任务 100% 失败

- `python/image/face-recognition/` 下**没有 `.venv`**（同项目 `python/aigc/photo-restore`、`python/speech/*` 等均已装好 venv），requirements.txt 是 2026-08-12 13:39 才新增的。
- 队列在 `runTask` 里先检查 `findVenvPython()`，找不到直接 `status=error`，返回「Python 环境尚未就绪，请等待后台安装完成」。
- 当前跑的是 production 构建（`node .output/server/index.mjs`，进程 14:23:59 启动），`setup-python` 插件会为含 requirements.txt 的目录自动建 venv，但该目录至今无 `.venv`，需要确认插件日志/重启服务或手动安装。
- 结论：**即便前端修好，注册/识别也一个都跑不通**，必须先解决 venv。

### 2.2 🔴 P0-2：前端轮询接口解包错误，注册/识别永远卡死 10 分钟

`face-registry.ts` 的 `extractFaceEmbedding` 与 `image-tools.ts` 的 `submitAndPoll`：

```ts
task = await $fetch<any>(`/api/image/face-recognition/${res.taskId}`)
if (task && ['done', 'error', 'cancelled'].includes(task.status)) break
```

而 `[id].get.ts` 返回的是 `{ ok: true, task: {...} }`，`task.status` 恒为 `undefined`，永远不满足终止条件 → 每 1 秒轮询一次，直到 10 分钟超时才抛「任务超时」。

- 影响：`face-register`（注册/识别）和 `face-verification`（双图验证，走 `submitAndPoll`）**全部中招**；按钮 busy 状态卡死，错误提示要等 10 分钟才出现，用户完全无法使用。
- 修复方向：解包 `res.task` 再判断状态（其余队列若返回同样结构需一并检查）。

### 2.3 🟠 P1：注册模型只支持"一人一张照片"

即使前两个问题解决，当前逻辑仍不满足"多张照片注册"：

1. **同名注册即覆盖**：`registerFace` 里 `list.filter(f => f.name !== face.name)` 后 push 新记录——同一人再注册一张，旧 embedding 被直接替换，而不是追加。用户想"补一张不同角度的照片"会丢失原有样张。
2. **多脸照片无法选择**：后端 recognition 模式返回 `{ faces: N, embeddings: [...] }`（整张图所有人脸），前端只取 `embeddings[0]`，用户无法指定"注册的是哪张脸"；合影里想注册其中一人做不到。
3. **数据模型单例**：`RegisteredFace` 只有单个 `embedding: number[]`，没有 `samples: []` 结构，无法表达多样张。
4. **UI 不支持多选上传**：主上传 input 无 `multiple`，ImagePlayground 一次只加载一张；注册面板只能用"当前这张图"。
5. **阈值不一致**：识别用 0.4（前端），验证用 0.5（`python/image/face-recognition/main.py` 的 `verify`），同一套模型两套标准。

---

## 3. 行业/学术调研：注册时应该传几张照片？

### 3.1 结论：**强烈建议多张（每人多张样张注册）**，这是几乎所有商用 SDK 与学术研究的共识

| 来源 | 结论 |
|---|---|
| Neurotechnology VeriLook 技术规范 | "Several images during enrollment are recommended for better facial template quality which results in user experience improvement during recognition"；多样本还能把头部俯仰容差从 ±15° 提到 ±25° |
| 大阪大学博士论文（人脸识别 EER 实验） | 每人 1 张图时 EER=3.83%，2 张以上时降到 1.16%（错误率下降约 70%） |
| Tessl 人脸注册校准 skill（dlib ResNet 实测） | 每人 **5–7 张**最佳；<3 张"脆弱易错"，>10 张收益递减且混入离群样本 |
| HDIAC（美国国防信息分析中心）综述 | 某算法单张图识别率 54%，用平均人脸提升到 100%；某手机 App 单张 86% → 平均 100% |
| arXiv 2212.10108（去中心化生物认证） | 每模板建议 **3 张**（正面 + 左右各一）；对比多种聚合策略后，**逐维取平均**的聚合嵌入精度最高且与现有 pipeline 兼容 |
| InsightFace 官方 Server 方案 | 用 Collection/Person/FaceSample 组织身份，**支持每个 Person 添加多个 FaceSample（多图注册）**、批量注册与部分成功 |
| VisioForge Face SDK / FaceGallery | "enroll 2–3 photos per person from different angles/lighting"；每个身份可存多个 L2 归一化嵌入，比对时对全部嵌入取最大余弦 |
| NIST JHU-MIT 评测系统说明 | 注册用多张增强嵌入，评分时"enrollment vs test 全部配对取最大" |

### 3.2 多样张的两种主流聚合方式

1. **均值模板（template averaging）**：把同一个人 N 张图的 embedding 逐维求平均并重新 L2 归一化，得到一个"代表模板"。计算量小、内存省，识别时只比一次（arXiv 2212.10108 认为该法最优）。
2. **最大相似度（max-similarity / score fusion）**：保留每人全部样张，probe 与每人每个样张都比，取该人最高分作为最终分。更鲁棒（能覆盖不同姿态/表情），代价是比对次数 = 注册库总样张数（本项目样本量小，完全可接受；VisioForge、Flutter face_liveness 等均采用）。

### 3.3 多脸/合影场景

商用系统（如 InsightFace Server、DeepFace 批量注册）都支持一张图多人：先检测出所有人脸 + bbox，再让用户**指定/逐个确认**把哪张脸注册给哪个姓名。当前项目后端其实已返回全部 embedding（只是前端丢弃了），扩展成本很低。

---

## 4. 结论与建议

### 4.1 回答用户问题

> 「是不是应该可以同时上传多张人脸照片？」

**是。** 无论从行业实践、学术数据还是本项目"注册库很小、想演示准确识别"的目标看，都应当支持：

- **每名被注册人可以一次上传多张照片**（建议至少 2–3 张，5–7 张最佳），不同角度/光照/表情；
- 同一人可**追加样张**（而不是同名覆盖）；
- 合影/多脸图应允许**选择要注册的人脸**；
- 识别时用多样张（均值模板或最大相似度）提升准确率。

### 4.2 建议改造方案（供后续实现）

**数据模型（`face-registry.ts`）**
```ts
interface FaceSample { id: string; embedding: number[]; thumb?: string; createdAt: number }
interface RegisteredFace {
  id: string
  name: string
  samples: FaceSample[]          // 每人多个样张
  template?: number[]            // 可选：均值模板（L2 归一化）
  createdAt: number
}
```

**前端**
1. 注册面板增加多图选择（`<input type="file" multiple>` 或拖拽多张），逐张提取嵌入；
2. 提供「新增样张」（同名追加）与「重建/覆盖」两种操作，UI 上区分；
3. 后端 recognition 返回 `embeddings` + 每张脸的 bbox/序号时，前端在图上**框选/点选**要注册或识别的人脸；
4. 识别结果返回 Top-N 候选与相似度列表（不只一个最佳匹配）。

**后端**
1. `face-recognition.post.ts` 支持多文件（`files[]` / `fileN`）或一次提交多张图；
2. recognition 结果增加 bbox 与序号，方便前端选择人脸；
3. 阈值统一（识别/验证共用一个可配置阈值，如 0.4–0.5 可调）。

**必须先行修复（否则一切免谈）**
1. 修复 `extractFaceEmbedding` / `submitAndPoll` 对 `{ ok, task }` 的解包；
2. 确保 `python/image/face-recognition/.venv` 就绪（重启服务让 setup-python 插件执行，或手动 `py -3 -m venv .venv && .venv\Scripts\pip install -r requirements.txt`），并验证 POST→GET 任务能到 `done`。

### 4.3 验收标准（改完后）
- [ ] 上传同一人 2–3 张不同照片，输入姓名注册一次 → 注册列表显示该人 1 条记录、3 个样张（或可见缩略图列表）；
- [ ] 用未参与注册的第 4 张照片识别 → 命中该人，相似度合理（>0.4）；
- [ ] 合影上传后能选择其中一张脸注册/识别；
- [ ] 同名再次注册提示"已存在，追加样张 / 覆盖"二选一；
- [ ] API 任务失败（如无脸、venv 未就绪）能在 5 秒内把错误显示到页面，按钮恢复可用；
- [ ] 中文/英文文案同步更新（`image.faceRegister.*`）。

---

## 5. 参考资料

- Neurotechnology VeriLook 技术规格与使用建议：https://www.neurotechnology.com/sandbox/verilook-technical-specifications.html
- InsightFace Server（多图注册 / FaceSample）：https://www.insightface.ai/solutions/insightface-server
- 大阪大学博士论文（单图 vs 多图 EER 对比）：https://ir.library.osaka-u.ac.jp/repo/ouka/all/2120/24617_Dissertation.pdf
- Tessl face-recognition-calibration（每人 5–7 张的经验阈值）：https://tessl.io/registry/jbaruch/face-recognition-calibration/files/skills/face-recognition-enrollment/SKILL.md
- HDIAC《Current Issues in Face Recognition and Photo-ID》：https://hdiac.dtic.mil/articles/current-issues-in-face-recognition-and-photo-id/
- arXiv 2212.10108（3 图模板 + 均值聚合）：https://arxiv.org/pdf/2212.10108
- VisioForge Face Recognition SDK / FaceGallery（多嵌入 + 最大余弦）：https://www.visioforge.com/help/docs/dotnet/general/ai/face-recognition/
- NIST JHU-MIT 系统描述（最大评分融合）：https://www.ll.mit.edu/sites/default/files/publication/doc/JHU-MIT-system-description-nist-villalba-124945.pdf

---

## 6. 实施记录（2026-08-12，已按用户要求落地为独立页面）

**入口**：新页面 `/vision/face-recognition`（侧边栏「视觉 → 人脸注册与识别」）。

### 改动清单

| 文件 | 改动 |
|---|---|
| `app/pages/vision/face-recognition.vue` | **新增**独立页面：多样张注册 + 多图识别 + 注册库管理 |
| `app/components/FacePhotoPicker.vue` | **新增**多图选择器：一次多选、逐张分析、bbox 标注、合影点选人脸 |
| `app/utils/face-studio.ts` | **新增**共享照片类型 |
| `app/utils/face-registry.ts` | **重写**：修复 `{ok,task}` 轮询解包；数据模型升级为每人 `samples[]`（v1→v2 自动迁移）；同名追加样张；多 probe 聚合识别 |
| `app/utils/image-tools.ts` | 修复共享 `submitAndPoll` 解包（face-verification 同步修复）；移除 `face-register` 工具 |
| `app/components/ImagePlayground.vue` | 移除旧 FaceRegisterPanel 挂载点 |
| `app/components/FaceRegisterPanel.vue` | **删除**（被独立页面取代） |
| `app/utils/demos.ts` | 注册 `face-recognition` demo；更新 `face` 描述 |
| `i18n/locales/{zh,en}.json` | `image.faceRegister.*` → `image.faceStudio.*` |
| `python/image/face-recognition/main.py` | `recognize()` 增加 `bboxes`/`det_scores`（支持选脸） |
| `python/image/face-recognition/.venv` | 已安装 insightface 1.0.1 + onnxruntime（buffalo_l 模型已缓存） |

### 摄像头功能（2026-08-12 追加）

| 文件 | 改动 |
|---|---|
| `app/components/FaceCamera.vue` | **新增**：getUserMedia 摄像头组件（镜像预览、多摄像头切换、拍照 `capturePhoto()` / 取帧 `grabFrame()`、卸载自动停止轨道） |
| `app/components/FacePhotoPicker.vue` | 暴露 `addFiles()`，摄像头拍的照片可直接作为样张走同一套分析/选脸/注册流程 |
| `app/pages/vision/face-recognition.vue` | 注册区「使用摄像头拍照 → 拍照添加样张」；识别区「实时识别」（每 1.2s 节流取帧 → 全脸提取嵌入 → 注册库比对 → 叠加框+姓名/相似度，绿色=命中/红色=未识别） |
| `i18n/locales/{zh,en}.json` | `image.faceStudio.*` 新增摄像头/实时识别文案 |
| `app/utils/demos.ts` | 描述补充「摄像头注册/实时识别」 |

摄像头实测（Playwright + Chrome 假摄像头流）：打开出流 1280×720 ✓；拍照生成 `camera-*.jpg` 样张并进入分析（无脸正确显示「未检测到人脸」）✓；实时识别叠加层渲染、停止后视频轨道全部清理 ✓；无 JS 报错 ✓；权限被拒时显示友好错误 ✓。

**镜像修复（2026-08-12）**：叠加层 canvas 原本放在被 CSS 镜像（`scaleX(-1)`）的预览容器内，导致框上的文字镜像。已改为：叠加层移出镜像容器（文字正向），绘制时对 bbox 的 x 坐标做水平映射（`x' = 宽 - x`），框仍与镜像后的预览视频精确对齐。结构断言：`videoMirrored=true`、`canvasMirrored=false`。

### 端到端实测（Playwright + curl）

- 同人多样张注册：3 张 Lena 变体 → 「已注册「Alice」（3 个样张）」✅
- 未参与注册的变体照片识别 → 「识别为：Alice · 相似度 0.9752」✅
- 负样本（宇航员）→ 「未识别（相似度 0.0120）」✅
- 合影（Lena + 宇航员合成图）→ 「2 张脸」，可选第 1/2 张脸 ✅
- 生产构建（`node .output/server/index.mjs`，:3000）页面 200、API 任务 loading→done 返回 embeddings+bboxes ✅
- 旧页面 `/vision/face` 保留 5 个工具（检测/关键点/模糊/马赛克/验证）✅
