# nuxt_AI 新增功能规划（基于 AnySearch 调研）

> 调研时间：2026-08-11
> 调研工具：AnySearch（通用搜索 + 多查询并行）
> 原则：**能在浏览器实现的用浏览器（WebGPU/WASM/Web API），浏览器实现不了或效果差的用后台 Python 处理并传回浏览器。**

---

## 0. 执行状态（2026-08-12 更新）

### AIGC Phase 1（纯浏览器）✅ 已完成并验证

- ✅ **A1 浏览器文生图 + 图像理解（Janus-Pro-1B）**：`app/pages/aigc/text-to-image.vue`，transformers.js v4 `MultiModalityCausalLM.generate_images()`，`onnx-community/Janus-Pro-1B-ONNX`（q4），WebGPU→WASM 逐模块回退；文生图 + 图像理解双 Tab；已注册 demos.ts + i18n（zh/en）。模型加载链路已验证（无 404 噪音、进度正常）。
- ✅ **A3 浏览器图像修复（Moebius-0.2B）**：`app/pages/aigc/inpainting.vue` + `app/utils/moebius/`（pipeline/ddim/imaging/modelcache 移植自 simonw/moebius-web，Apache-2.0）；onnxruntime-web 1.27.0（webgpu bundle，动态加载）；hf 代理已支持 Range/Content-Length。**端到端验证通过**：上传→涂抹→下载 1.24GB 模型→WebGPU 推理→输出画布渲染→下载 PNG（211s 含下载）。
- ✅ **B5 WebGPU 能力诊断**：`app/pages/aigc/capabilities.vue`（navigator.gpu 适配器/特性/限制/COOP-COEP/fp16，零依赖）。浏览器验证通过（Intel gen-12lp、shader-f16）。
- 🔧 `server/api/hf/[...].get.ts` 增强：转发 Range、回写 Content-Length/Content-Range/Accept-Ranges（ORT Web 大模型下载需要）。
- 🔧 依赖：`onnxruntime-web@1.27.0`（Moebius 用）。

### 待办（Phase 2 / 后续）

### AIGC Phase 2（Python 后端）✅ 已完成并验证

### AIGC Phase 3（2026-08-13 浏览器新增 4 项 + planned 3 项）✅ 已实现并验证

- ✅ **智能抠图（背景移除）**：`app/pages/vision/bg-removal.vue`，Xenova/modnet（~25MB，已加入预下载），WebGPU→WASM，阈值滑块 + 透明 PNG 导出；端到端验证（上传→抠图 1.9s→下载）。
- ✅ **推理对话（DeepSeek-R1 蒸馏）**：`app/pages/aigc/reasoning-chat.vue`，DeepSeek-R1-Distill-Qwen-1.5B / MiniThinky-v2-1B，TextStreamer 流式输出“思考过程→回答”，可中断。
- ✅ **代码生成与执行**：`app/pages/aigc/codegen.vue`，Qwen2.5-Coder-0.5B 补全 + Pyodide 浏览器内运行 Python（新增 `app/composables/usePyodide.ts` 共享单例）。
- ✅ **多模态对话（SmolVLM）**：`app/pages/aigc/multimodal-chat.vue`，SmolVLM-256M 多图多轮图文对话。
- 📌 新增 `app/pages/aigc/[slug].vue` 兜底页 + planned：tripo3d（TripoSR）/ talking-photo（SadTalker）/ video-gen（Wan2.1）。
- 📌 /aigc 演示数：6 → 13。
- ✅ **A2 文生图 + B1 图生图（SD-Turbo）**：`python/aigc/sd-turbo/`（diffusers `AutoPipelineForText2Image/Image2Image`，常驻 worker，1-8 步，CPU 约 3.7s/步）；`server/utils/sd-turbo-queue.ts`（支持无文件文生图 + 多图结果）+ `/api/aigc/sd-turbo`；页面 `app/pages/aigc/sd-turbo.vue`（文生图/图生图双 Tab：提示词/负提示词/步数/CFG/种子/批量/分辨率/strength）。
  - API 端到端验证：POST→taskId→done→图片；**worker 二次调用复用**（无加载等待）；UI 端到端出图 + 下载。
- ✅ **A4 老照片修复（Real-ESRGAN x2 + CodeFormer）**：`python/aigc/photo-restore/`（常驻 worker；CodeFormer 源码克隆到 `repo/`，`facelib/` + `vqgan_arch/codeformer_arch` 由 `download_model.py` 拷贝；权重 codeformer.pth 359MB + RealESRGAN_x2plus.pth 64MB 存 `~/.cache/photo-restore`）；`server/utils/photo-restore-queue.ts` + `/api/aigc/photo-restore`；页面 `app/pages/aigc/photo-restore.vue`（fidelity 滑杆 + 放大倍数 + 前后对比 + 下载）。
  - API/UI 端到端验证通过（检测 4 张人脸，输出 1.88MB PNG）。

### 待办（后续）

- B3 代码生成（Qwen2.5-Coder + Pyodide）；B4 图生 3D（TripoSR）；B2 多模态对话（Gemma 3n）。
- 远期：C1 SadTalker / C2 FLUX.2 / C3 Wan2.1 视频 / C4 音效。

### Phase 2 踩坑记录（已解决）

- 脚手架 API 路由生成在 `server/api/<cat>/<slug>/<slug>.post.ts`，与本项目约定（`server/api/<cat>/<slug>.post.ts` 根目录 + `[id]` 子目录）不一致 → 手动移到根目录后路由才生效。
- 脚手架向 demos.ts 连续插入两次产生 `} ,,` 数组空洞（`demos.map` 不跳过空洞 → SSR 崩溃）→ 修复为单逗号。
- pip basicsr 1.4.2 与新版 torchvision 不兼容（`functional_tensor` 移除）→ main.py 用 `sys.modules` 注入兼容模块。
- pip basicsr 缺 `utils.misc.get_device` → main.py 注入；`RealESRGANer` 应从 `realesrgan.utils` 导入（vendored basicsr 才有 realesrgan_utils）。
- huggingface_hub 经 hf-mirror HEAD 返回 308 失败 → Python 侧直连 `https://huggingface.co`（本机可直连）。
- 队列模板把提示词放 `text`、worker 读 `params.prompt` → 队列发送时合并。

---

## 1. 项目现状

- 框架：Nuxt 4 + Nitro，`@huggingface/transformers`、`@mediapipe/*`、`@mlc-ai/web-llm`、`@tensorflow/*` 已安装。
- 分类：Speech / Vision / NLP / AIGC / ML 五大类，全部 demo 已 `ready`。
- 浏览器端已有：MediaPipe（人脸/手/姿态/手势/整体/目标检测/图像分类/嵌入/分割）、TF.js 迁移学习（图像/音频训练）、web-llm 对话、Web Speech API 语音识别。
- Python 后端已有：edge-tts（TTS）、Demucs（分离）、XTTS-v2（声音克隆）、Transformers（NER/QA/摘要/完形/零样本/深度估计/图像描述），均走 `server/api/python/run.post.ts` + 常驻 worker 队列。
- 本机硬件：**无 NVIDIA GPU、16GB 内存** → Python 侧只能跑 CPU 友好的小模型，重模型（SDXL、视频生成）受限。

---

## 2. 调研结论摘要

### 浏览器端（2026 年已成熟，WebGPU 已全平台可用）

- **OCR**：Tesseract.js 可在浏览器跑图片/PDF OCR，离线可用，隐私好（`simonwillison.net/ocr` 等成熟案例）。
- **背景移除**：Transformers.js + MODNet，WebGPU 加速，纯前端（多篇教程 + 开源 demo）。
- **Whisper ASR**：whisper-web（transformers.js）支持 100+ 语言、文件/麦克风/URL 输入，WebGPU 加速，可离线。
- **浏览器 RAG/语义搜索**：EmbeddingGemma（308M，多语言）+ transformers.js + IndexedDB/Voy(HNSW)，全本地向量检索。
- **超分辨率**：浏览器有 Real-ESRGAN 等 ONNX 方案，但模型较大、效果一般，优先级低。
- **WebGPU 能力诊断**：检测 GPU/特性/跨域隔离，提升演示专业感。

### Python 后端（浏览器做不到或效果差）

- **文生图**：Diffusers + SD-Turbo / LCM-LoRA（CPU 上 4-5 秒/张可接受），成熟方案：web-stable-diffusion、stable-diffusion-webui API。
- **文生音乐/音效**：Meta AudioCraft（MusicGen / AudioGen），小模型可 CPU 运行。
- **说话人分离（Diarization）**：pyannote，可与现有 ASR 组合成"会议纪要"。
- **文档解析**：DocStrange（PDF/图片/DOCX/PPTX → Markdown/JSON，本地模式）、unstructured、natural-pdf。
- **视频生成**：Wan2.1 / FastVideo 等开源方案很火，但需 GPU（本机受限）→ 远期可选。

---

## 3. 候选功能清单

| # | 功能 | 分类 | 实现方式 | 依赖/模型 | 工作量 | 优先级 |
|---|------|------|----------|-----------|--------|--------|
| 1 | **OCR 文字识别**（图片/PDF→文本） | Vision/NLP | 🖥 浏览器 | Tesseract.js + pdf.js | S | **P0** |
| 2 | **图片背景移除/抠图** | Vision | 🖥 浏览器 | transformers.js + MODNet (WebGPU) | S | **P0** |
| 3 | **Whisper 离线语音识别**（增强现有 ASR：支持文件/多语言/导出字幕） | Speech | 🖥 浏览器 | transformers.js + whisper-small | M | **P0** |
| 4 | **文生图（Text-to-Image）** | AIGC | 🐍 Python | diffusers + SD-Turbo/LCM-LoRA (CPU) | M | **P0** |
| 5 | **文生音乐/音效** | Speech | 🐍 Python | AudioCraft MusicGen-small / AudioGen | M | **P0** |
| 6 | **浏览器 RAG 语义搜索**（文档问答/相似检索） | NLP | 🖥 浏览器 | EmbeddingGemma + IndexedDB/Voy | L | P1 |
| 7 | **说话人分离 + 会议纪要**（转写→分人→摘要） | Speech | 🐍 Python | pyannote + 现有 TTS/摘要能力 | L | P1 |
| 8 | **文档解析**（PDF/图片→Markdown/JSON） | 新分类 Document | 🐍 Python | DocStrange / unstructured | M | P1 |
| 9 | **WebGPU 能力诊断页** | AIGC/工具 | 🖥 浏览器 | 原生 API（无依赖） | S | P1 |
| 10 | **图生图/图片编辑**（img2img） | AIGC | 🐍 Python | diffusers（接 #4 复用 worker） | M | P2 |
| 11 | **图像超分辨率/增强** | Vision | 🖥 浏览器 | transformers.js + Real-ESRGAN ONNX | M | P2 |
| 12 | **趣味 AR 滤镜**（贴纸/虚拟试妆，基于已有 Landmark） | Vision | 🖥 浏览器 | 已有 MediaPipe + canvas | M | P2 |
| 13 | **文生视频** | AIGC | 🐍 Python | Wan2.1（需 GPU，本机受限） | XL | 远期 |

> 🖥 = 纯浏览器；🐍 = Python 后端（异步队列 + 常驻 worker，传回浏览器）。

---

## 4. 分阶段实施计划

### Phase 1（P0 · 纯浏览器 · 约 1-2 天）

1. **OCR 文字识别**
   - 新增 `app/pages/vision/ocr.vue`（或 nlp 分类），拖拽/上传图片或 PDF。
   - 依赖：`tesseract.js` + `pdfjs-dist`（按需动态加载，不塞进主包）。
   - 支持语言选择（chi_sim/eng…）、结果编辑、复制/下载 .txt。
2. **图片背景移除**
   - 新增 `app/pages/vision/background-removal.vue`。
   - transformers.js 加载 `Xenova/modnet`（约 25MB），WebGPU 优先、WASM 兜底；输出透明 PNG 下载。
   - 注意生产部署需配置 COOP/COEP 头（见 §6）。
3. **Whisper 离线识别（增强 ASR）**
   - 在现有 `speech/asr.vue` 增加"文件/拖拽 + Whisper 模型"模式（保留 Web Speech API 实时模式）。
   - 加载 `Xenova/whisper-small`（WASM）或 tiny（更快），支持 100+ 语言自动检测、导出 TXT/SRT。
   - 全部 demo 注册进 `app/utils/demos.ts` + i18n（zh/en）。

### Phase 2（P0 · Python 后端 · 约 2-3 天）

4. **文生图**
   - 用 `python-tool-integration` 脚手架生成 `python/aigc/text-to-image/`：
     - `main.py`：diffusers `StableDiffusionPipeline`（SD-Turbo 或 LCM-LoRA，CPU 约 4-8s/图），输出 PNG。
     - `worker.py` 常驻加载模型；队列 + 进度 + 取消，参考 `speech/voice-clone`。
   - 前端 `app/pages/aigc/text-to-image.vue`：提示词、负提示词、步数、尺寸、批量生成、下载。
5. **文生音乐/音效**
   - `python/speech/music-gen/`：AudioCraft `MusicGen-small`（CPU 可跑），参数：描述、时长；输出 WAV/MP3 播放下载。
   - 可再加 AudioGen 音效模式（同一 worker 双模型，或只做 MusicGen 先）。
   - 前端：描述输入、时长滑块、生成进度、试听。

### Phase 3（P1 · 混合 · 约 2-3 天）

6. **浏览器 RAG 语义搜索**
   - 新增 `app/pages/nlp/rag-search.vue`：粘贴/上传文本 → EmbeddingGemma 建索引（IndexedDB 持久化）→ 语义检索 + 相似度可视化。
   - 依赖 transformers.js（已装）+ `voy`（可选 HNSW）。
7. **说话人分离 + 会议纪要**
   - `python/speech/diarization/`：pyannote small 模型（CPU），输出分段说话人标签。
   - 组合：Whisper（浏览器或 Python）转写 → diarization 分人 → 现有 summarization 摘要 → 生成会议纪要 Markdown。
8. **文档解析**
   - 新分类 `Document`：`python/document/parser/`，DocStrange 本地模式或 unstructured，PDF/图片 → Markdown/JSON 下载。
9. **WebGPU 能力诊断页**
   - `app/pages/aigc/capabilities.vue`：navigator.gpu 检测、适配器信息、特性、COOP/COEP 状态、建议。

### Phase 4（P2/远期 · 可选）

- 图生图/图片编辑（复用 Phase 2 worker）。
- 图像超分辨率（浏览器 ONNX）。
- 趣味 AR 滤镜（基于已有 MediaPipe landmark + canvas 贴纸/妆容）。
- 文生视频（Wan2.1，**需 GPU，本机暂不具备**，可留作服务器部署后）。

---

## 5. 浏览器 vs Python 决策依据

| 场景 | 选浏览器 | 选 Python 后端 |
|------|----------|----------------|
| 高频、轻量、隐私敏感（OCR/抠图/短语音转写/小模型分类） | ✅ | |
| 需要 WebGPU 实时交互（摄像头/拖拽即处理） | ✅ | |
| 大模型生成（图/音乐/视频）、长音频、重文档解析 | | ✅ |
| 需要统一后端资源、批量任务、结果落盘 | | ✅ |
| 无 GPU 的 CPU 主机跑大扩散模型 | | ⚠️ 仅小模型（SD-Turbo/LCM/MusicGen-small） |

---

## 6. 技术要点与踩坑

### 浏览器功能
- **COOP/COEP 头**：transformers.js 多线程 WASM 需要 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`。Nuxt dev 下 Vite 可直接注入；生产部署需在 Nitro 配置 headers（`.output` 部署到 Vercel 时用 `vercel.json`/`nitro.config` 加）。
- **动态加载**：tesseract.js / whisper / modnet 模型较大，用动态 import + 模型 CDN（HF），避免首屏 bundle 膨胀；给出下载/加载进度条。
- **WebGPU 兜底**：`navigator.gpu` 不存在时回退 WASM 并提示。

### Python 功能
- 严格按 `python-tool-integration` skill 流程：脚手架 `create-python-feature.mjs` → 队列 `server/utils/<slug>-queue.ts` → API `post/get/delete` → 页面注册 demos.ts + i18n。
- `worker.py` 必须 `sys.stdin/stdout/stderr.reconfigure(encoding="utf-8")`（Windows 中文乱码坑）。
- 模型下载用 `download_model.py`，可配 `HF_ENDPOINT=https://hf-mirror.com`（国内）。
- CPU 限制：`torch.set_num_threads()`；模型首次加载后常驻复用，二次调用不等待。
- 大模型（>100MB）放用户目录，勿提交 git（`tmp/`、`public/generated/` 已在 .gitignore）。

---

## 7. 风险与取舍

- **本机无 GPU**：文生图/音乐只能选 CPU 友好小模型，出图/出音频速度一般（4-10 秒级）；视频生成暂不可行。
- **模型下载体积**：Whisper-small ~460MB、MusicGen-small ~1.5GB，首次使用需等待；建议每个 demo 页展示模型状态（未下载/加载中/就绪）。
- **浏览器内存**：16GB 机器同时开多个大模型 demo 会吃力，页面做好"离开即释放/仅按需加载"。
- **许可证**：MusicGen 需 Meta 非商用许可（学术/演示可）；SD 模型注意各自 license；文档内标注。

---

## 8. 建议执行顺序

```text
Phase 1 (纯前端, 快见效) ──► OCR + 抠图 + Whisper ASR
        │
Phase 2 (Python 后端) ────► 文生图 + 文生音乐
        │
Phase 3 (混合进阶) ────────► RAG 搜索 + 会议纪要 + 文档解析 + 能力诊断
        │
Phase 4 (可选/远期) ───────► img2img / 超分 / AR 滤镜 / 文生视频
```

> 下一步：确认后即可从 **Phase 1** 开工（纯浏览器实现，无需后端依赖，当天可见效果）。
