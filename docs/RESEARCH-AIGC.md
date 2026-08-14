# AIGC 分类页深度调研报告（/aigc）

> 调研时间：2026-08-12
> 调研工具：AnySearch（多轮 batch_search + 网页抽取），依据 `nuxt-ai-feature-dev` 与 `python-tool-integration` skill 的架构决策
> 目标：为 http://127.0.0.1:3000/aigc（AI 生成分类页）筛选适合新增的演示项目
> 本机约束：Intel i5-13500H（12C/16T）、16GB 内存、**无 NVIDIA GPU**（Intel Iris Xe 核显 2GB，支持 WebGPU 但显存/内存有限）→ 浏览器端走 WebGPU/WASM；Python 侧只跑 CPU 友好小模型

> **执行状态（2026-08-12）：Phase 1 纯浏览器三项已实现并验证**
> - ✅ A1 Janus-Pro-1B 文生图/图像理解（text-to-image.vue）
> - ✅ A3 Moebius-0.2B 图像修复（inpainting.vue + app/utils/moebius/，端到端 WebGPU 推理通过）
> - ✅ B5 WebGPU 能力诊断（capabilities.vue，浏览器验证通过）
>
> **Phase 2（Python 后端）已实现并验证（2026-08-12）**
> - ✅ A2 **文生图 + B1 图生图**：`python/aigc/sd-turbo/`（SD-Turbo，常驻 worker，1-8 步，CPU 约 3.7s/步），API/UI 端到端 + worker 二次复用通过
> - ✅ A4 **老照片修复**：`python/aigc/photo-restore/`（Real-ESRGAN x2 + CodeFormer，权重 ~450MB 在 `~/.cache/photo-restore`），API/UI 端到端通过（4 张人脸）
> - A2 按用户确认改用 **SD-Turbo**（不选 SANA-Sprint，避免 Gemma2-2B 编码器 ~5GB 下载）

---

## 1. 现状与重叠判定（2026-08-12）

### 1.1 /aigc 现状

- 分类定义：`在浏览器中运行的 LLM 对话与流式文本生成等 AI 内容生成演示`（`app/utils/demos.ts`）
- 现有 demo：仅 1 个 `webllm`（WebLLM + Qwen2.5 0.5B/1.5B + Llama3.2 1B/3B 浏览器对话）
- 结论：**aigc 是全站最空的分类**（speech 17 个、vision 14 个、nlp 8 个、ml 17 个），且分类描述仅限"LLM 对话/文本生成"，需要随新增图像类能力同步扩写分类描述 + i18n（zh/en）

### 1.2 与既有 demo 的重叠判定

| 候选方向 | 对照现有代码 | 判定 |
|---|---|---|
| 文生音乐/音效 | `speech/musicgen`（MusicGen-small）已有文生音乐 | ❌ 不重复；音效扩展属 speech（AudioGen/Stable Audio Open） |
| 语音克隆/变声 | `speech/voice-clone`（XTTS-v2）、`speech/voice-convert`（受限）已有 | ❌ 不重复 |
| 背景移除（RMBG-1.4） | 无，但 FEATURE-PLAN 已规划在 Vision | 🔀 跨类复用，不放进 aigc |
| 浏览器 RAG 语义搜索 | 无，FEATURE-PLAN 已规划在 NLP | 🔀 跨类复用，不放进 aigc |
| 图像超分 Real-ESRGAN | 无 | ✅ 并入 aigc「老照片修复」（单独做超分效果一般且浏览器 ONNX 方案弱） |
| 文生图 / 图生图 / 图像修复 / 3D / 数字人 / 多模态对话 / 代码生成 | 无 | ✅ **真正新增，全部归 aigc** |

**结论：本次调研产出 11 个候选（4 个 P0 / 4 个 P1 / 3 个远期），全部为 aigc 真新增。**

---

## 2. 候选项目总览

> 🖥 = 纯浏览器（WebGPU/WASM）；🐍 = Python 后端（异步队列 + 常驻 worker）；工作量 S<1天 / M 1-3天 / L 3-5天 / XL >5天

| # | 项目 | 实现 | 依赖 / 模型 | 下载体积 | 许可证 | CPU/核显可行性 | 工作量 | 优先级 |
|---|------|------|------------|---------|--------|--------------|--------|--------|
| A1 | **浏览器文生图 + 图像理解（Janus-Pro-1B）** | 🖥 | transformers.js v4 `MultiModalityCausalLM.generate_images()`，`onnx-community/Janus-Pro-1B-ONNX` | ~1.2GB（q4） | DeepSeek 模型许可（研究用途可） | ✅ WebGPU 优先 / WASM 兜底 | S-M | **P0** |
| A2 | **Python 文生图（SANA-Sprint-0.6B）** | 🐍 | diffusers `SanaPipeline` 或 optimum-intel OpenVINO int4（`rupeshs/sana-sprint-0.6b-openvino-int4`） | ~1.3GB（另需 Gemma2-2B 文本编码器） | Apache-2.0（NVlabs/Sana） | ✅ CPU 秒级~十几秒 | M | **P0** |
| A3 | **浏览器图像修复（Moebius-0.2B）** | 🖥 | onnxruntime-web WebGPU（新增依赖），`simonw/Moebius-ONNX`（unet 907MB + vae 335MB） | ~1.24GB | Apache-2.0 | ✅ WebGPU（Iris Xe 需实测） | M | **P0** |
| A4 | **老照片修复（Real-ESRGAN + CodeFormer）** | 🐍 | Real-ESRGAN（BSD-3）+ CodeFormer（MIT）/GFPGAN（Apache-2.0） | ~500MB+ | 均宽松开源 | ✅ CPU 10-30s | M | **P0** |
| B1 | **图生图 / 图片编辑（img2img）** | 🐍 | 复用 A2 worker：`image` + `strength`；可选 SANA ControlNet | 复用 A2 | Apache-2.0 | ✅ | M | P1 |
| B2 | **浏览器多模态对话（Gemma 3n E2B）** | 🖥 | transformers.js / WebLLM，`onnx-community/gemma-3n-E2B-it-ONNX` | ~2GB | Gemma 使用条款（需接受） | ⚠️ Iris Xe 2GB 内存吃紧 | M-L | P1 |
| B3 | **代码生成 / 解释器（Qwen2.5-Coder）** | 🖥 | WebLLM（已装）+ Pyodide（动态加载），参考 `cfahlgren1/qwen-2.5-code-interpreter`（289★） | 1.5B q4 ~1GB | Apache-2.0（Qwen2.5） | ✅ | M | P1 |
| B4 | **图生 3D（TripoSR）** | 🐍 | `VAST-AI-Research/TripoSR`（MIT）+ torchmcubes + three.js 预览 | ~1GB | MIT | ✅ CPU 30-60s/个 | L | P1 |
| B5 | **WebGPU 能力诊断页** | 🖥 | `navigator.gpu` 原生 API（零依赖） | 0 | - | ✅ | S | P1 |
| C1 | **照片说话（SadTalker）** | 🐍 | OpenTalker/SadTalker（Apache-2.0 + 个人/研究免责声明） | ~1GB | ⚠️ 非商用 | ⚠️ CPU 1-3min | L | P2 |
| C2 | **FLUX.2 Klein 4B 浏览器文生图** | 🖥 | 自定义 WebGPU runtime（`ryanhlewis/flux2-webgpu`），模型 3.5GB | 3.5GB | 需核对（FLUX 系） | ⚠️ 下载大，Iris Xe 不现实 | XL | 远期 |
| C3 | **文生视频（Wan2.1-1.3B）** | 🐍 | diffusers `WanPipeline`，Wan-Video/Wan2.1-1.3B（Apache-2.0） | ~2GB | Apache-2.0 | ⚠️ CPU 极慢（分钟级/几秒片段） | XL | 远期 |
| C4 | **音效生成（AudioGen / Stable Audio Open）** | 🐍 | AudioCraft AudioGen-small / stabilityai/stable-audio-open-1.0（1.2B） | 1-2GB | Meta 非商用 / Stability 非商用 | ⚠️ CPU 慢 | M | 远期（属 speech） |

---

## 3. P0 重点项目详述

### A1. 浏览器文生图 + 图像理解（Janus-Pro-1B）⭐ 最优先

- **为什么**：aigc 缺"文生图"；Janus-Pro-1B 是 2026 年在浏览器跑通的最成熟多模态生成模型之一（DeepSeek，1.5B 参数、384×384 输出、图像理解 + 文生图双能力）；项目已装 `@huggingface/transformers@^4.2.0`，**零新增 Python 依赖、零后端**，完全符合站点"浏览器本地"卖点。
- **参考实现**：
  - HF Space：`webml-community/janus-pro-webgpu`
  - 官方示例：`huggingface/transformers.js-examples` 下 `janus-pro-webgpu`
  - 教程：Running DeepSeek Janus-Pro-1B in the Browser（dev.to）
- **实现要点**（遵循 nuxt-ai-feature-dev skill）：
  - `app/pages/aigc/text-to-image.vue`（或 `janus.vue`）：动态 `import('@huggingface/transformers')` + `setupTransformersEnv()`
  - `MultiModalityCausalLM.from_pretrained('onnx-community/Janus-Pro-1B-ONNX', { dtype: { language_model: 'q4', ... }, device: { language_model: 'webgpu', ... } })`；WebGPU 不可用时逐模块回退 `wasm`
  - 文生图：`processor(conversation, { chat_template: 'text_to_image' })` → `model.generate_images(...)`；图像理解：多模态对话输入图片 URL/File
  - 单例缓存模型（二次调用不等待）；`progress_callback` 下载进度条；离开页面释放
- **体积/性能**：q4 约 1.2GB 首次下载；Iris Xe 上以 WebGPU 跑 1.5B 生成预计 10-30s/张（可接受），无 WebGPU 时 WASM 兜底更慢（提示用户换 Chrome/Edge）
- **验证**：端到端出图 → 下载 PNG；多模态问答示例图（如公式转 LaTeX）→ 文本回复；第二次调用无加载等待
- **踩坑**：输出分辨率固定 384×384（可 canvas 放大到 512/768）；`prepare_inputs_embeds` 部分在 wasm 上跑（官方示例做法）；fp16 需先检测 `adapter.features.has('shader-f16')`

### A2. Python 文生图（SANA-Sprint-0.6B）⭐ 最高质量/性能比

- **为什么**：FEATURE-PLAN 原推 SD-Turbo（CPU 4-8s/张）；调研发现更新的 **SANA-Sprint-0.6B**（NVIDIA，2025-2026）1 步生成 1024px，DPG-Bench/GenEval 1 步超过 FLUX-schnell，参数 0.6B（比 FLUX-12B 小 20 倍、快 100+ 倍），且有社区 OpenVINO int4 优化（FastSD CPU 已集成，i7-12700 上 512px 约 1s 级）→ **CPU 上比 SD-Turbo 更值得做**
- **参考**：NVlabs/Sana（Apache-2.0，diffusers `SanaPipeline` 已支持）；`rupeshs/sana-sprint-0.6b-openvino-int4`；FastSD CPU（`rupeshs/fastsdcpu`，2.1k★，含 OpenVINO 全套 CPU 加速方案）
- **实现要点**：
  - 用 python-tool-integration 脚手架生成 `python/aigc/text-to-image/`：`main.py` + `worker.py`（常驻加载，参考 `speech/musicgen`/`speech/voice-clone` 队列模式）
  - 前端 `app/pages/aigc/text-to-image.vue`：提示词（含中文示例）、负提示词、步数（1/2/4）、尺寸（512/768/1024）、批量 1-4 张、进度、下载
  - CPU 线程限制 `torch.set_num_threads()`；模型下载走 HF 镜像；OpenVINO 方案需 `optimum-intel` + `nncf`（独立 venv 更稳）
- **验证**：首次含加载、第二次 worker 复用无等待；中文提示词出图质量检查
- **踩坑**：SANA-Sprint 用 Gemma2-2B-IT 作文本编码器（编码器本身约 5GB 下载，首次久）→ 落地前先确认体积可接受；若不可接受，备选 SD-Turbo（1 步 512px，~2.5GB 总大小）或 SDXL-Lightning LoRA（4 步）

### A3. 浏览器图像修复（Moebius-0.2B）⭐ 前沿亮点

- **为什么**：2026-06 Hacker News 热门项目（ECCV'26 论文），0.2B 参数达到 10B 级修复效果；`simonw/moebius-web` 已完整移植到浏览器（ONNX Runtime Web + WebGPU），Apache-2.0；"涂抹去物/补全"交互感强，演示效果好
- **模型**：`simonw/Moebius-ONNX`（unet ~907MB + vae_encoder 137MB + vae_decoder 198MB ≈ 1.24GB，fp32，固定 512×512，无文本编码器）
- **实现要点**：
  - 新增依赖 `onnxruntime-web`（动态 import，不塞主包）；参考 `simonw/moebius-web` 的 `web/src/pipeline.ts`（DDIM + CFG + 9 通道 latent 组装 + 前后处理）
  - 页面 `app/pages/aigc/inpainting.vue`：上传 → canvas 涂抹（橡皮擦）→ 修复 → 对比/下载；非方形图片 letterbox
  - 模型经 `/api/hf` 代理下载（需确认 ONNX Runtime Web 支持 range 请求/代理路径）
  - 关键常量：VAE `scaling_factor=0.13025`（非 SD 的 0.18215）；`input_ids` 前 10 行条件 / 后 10 行无条件（CFG）
- **验证**：端到端涂抹→修复→下载；Safari/Chrome WebGPU 各测一次；无 WebGPU 时提示
- **踩坑**：fp16 数值不稳定（保持 fp32 或先验证）；Iris Xe 上 1.24GB 模型 + 推理内存（16GB RAM 可承受，但 WebGPU 分配可能失败，需实测 + 提供"未支持"提示）

### A4. 老照片修复（Real-ESRGAN + CodeFormer）⭐ 中文社区最受欢迎

- **为什么**：人脸修复/老照片增强是中文用户高频需求；两个模型均 CPU 可跑、许可证宽松（Real-ESRGAN BSD-3 / CodeFormer MIT / GFPGAN Apache-2.0）；FastSD CPU 2026 已把 photo restoration/colorization 并入 OpenVINO 流程
- **实现要点**：
  - `python/aigc/photo-restore/`：上传 → Real-ESRGAN（x2/x4 超分）→ CodeFormer（人脸细节修复，可选 fidelity 滑杆）→ 前后对比 + 下载
  - 限制输入尺寸（长边 ≤1024）控制 CPU 耗时；异步队列 + 进度
- **验证**：旧照片样例端到端；中文注释/UI；模型二次调用复用
- **踩坑**：CodeFormer 依赖 facexlib/detection 下载（国内走 HF 镜像）；首次依赖安装较久；CPU 10-30s/张需进度提示

---

## 4. P1 候选

### B1. 图生图 / 图片编辑（img2img）
- 复用 A2 worker：上传图片 + 提示词 + `strength` 滑杆（0.3-0.9）；SANA 官方有 ControlNet 支持（线条/深度条件），可后续加
- 工作量 M，与 A2 共用模型加载，性价比高

### B2. 浏览器多模态对话（Gemma 3n E2B）
- Gemma 3n（Google，E2B/E4B）原生支持图像+音频+视频+文本，ONNX 版 `onnx-community/gemma-3n-E2B-it-ONNX` 已出；PyImageSearch 2026-07 有 transformers.js + WebGPU 完整教程（Gemma 4）
- 注意：Iris Xe 2GB 显存跑 E2B（~2GB 权重）会很吃力，建议作为"WebGPU 强机器可选"功能；或先在现有 `webllm.vue` 增加 Gemma 模型选项做多模态
- 许可证：Gemma 使用条款（需接受），页面标注

### B3. 代码生成 / 解释器（Qwen2.5-Coder + Pyodide）
- WebLLM 已集成；新页面 `aigc/codegen.vue`：选 Qwen2.5-Coder-1.5B（q4f16，WebLLM 支持）→ 生成代码 → Pyodide 在浏览器直接执行（Python/JS），参考 `cfahlgren1/qwen-2.5-code-interpreter`（289★，WebLLM + Pyodide 验证过）
- 演示感强（"AI 编程助手"）；Pyodide ~10MB 动态加载

### B4. 图生 3D（TripoSR）
- 单图 → 3D mesh（glb/obj），MIT 许可，CPU 30-60s/个（A100 上 <0.5s）；异步队列正好适配
- 踩坑：`torchmcubes` 无 CUDA 时静默编译 CPU 版（慢但可用，本机无 CUDA 反而没坑）；前端 three.js 预览（动态加载）
- 输出：glb 下载 + 旋转预览，效果惊艳

### B5. WebGPU 能力诊断页
- `navigator.gpu.requestAdapter()` → 适配器信息/特性/COOP-COEP 状态/建议；无依赖，S 工作量；作为 aigc 工具页

---

## 5. P2 / 远期

### C1. 照片说话（SadTalker）
- 单张照片 + 音频 → 说话视频（与现有 Wav2Lip 互补：Wav2Lip 是视频换口型，SadTalker 是照片驱动）；Apache-2.0 但有"个人/研究/非商业"免责声明，需页面标注
- CPU 1-3min/段，可接受但慢；L 工作量 → P2

### C2. FLUX.2 Klein 4B 浏览器文生图
- `ryanhlewis/flux2-webgpu`：静态 WebGPU 应用，512×512 约 4.4s，但模型 3.5GB 下载 + Iris Xe 2GB 显存不现实 → 留作独立 GPU 环境或远期

### C3. 文生视频（Wan2.1-1.3B）
- Wan2.1 有 1.3B 小模型（Apache-2.0）；本机 CPU 生成 5s 480P 需分钟级，体验差 → 远期（服务器/GPU 部署后）
- 更新：2026 开源视频已到 Wan2.2/LTX-2.5/HunyuanVideo 1.5，但均需 GPU，本机策略不变

### C4. 音效生成（AudioGen / Stable Audio Open）
- 属 speech 分类扩展（MusicGen 已有）；AudioGen-small（Meta 非商用）、Stable Audio Open 1.0（1.2B，非商用，CPU 慢）→ 远期

---

## 6. 与 FEATURE-PLAN.md 的关系（更新点）

| FEATURE-PLAN 原条目 | 本次调研结论 |
|---|---|
| #4 文生图：SD-Turbo/LCM | ⬆️ 升级为 **SANA-Sprint-0.6B**（更快更好，Apache-2.0；注意 Gemma2 文本编码器体积）；新增纯浏览器方案 **Janus-Pro-1B**（零后端，P0 优先） |
| #10 图生图/图片编辑 | 保留，复用 A2；新增 **Moebius 浏览器 inpainting** 作为图像修复方案 |
| #11 图像超分辨率 | ⬇️ 浏览器 ONNX 方案弱 → 改为并入 **老照片修复（Real-ESRGAN + CodeFormer）** Python 方案 |
| #9 WebGPU 能力诊断 | 保留（B5） |
| #13 文生视频 Wan2.1 | 维持远期，补充 Wan2.1-1.3B 小模型信息 |
| （无） | 🆕 新增：**浏览器多模态对话 Gemma 3n**（B2）、**代码生成/解释器**（B3）、**图生 3D TripoSR**（B4）、**照片说话 SadTalker**（C1）、**FLUX.2 Klein WebGPU**（C2） |

---

## 7. 技术要点与踩坑（aigc 专项）

### 浏览器功能
- **transformers.js v4**：Janus 用 `MultiModalityCausalLM` + `generate_images()`；dtype 按模块配置（`language_model: 'q4'`、`gen_head: 'fp16'` 等）；WebGPU 不可用时逐模块回退 wasm
- **onnxruntime-web**（Moebius）：新依赖动态加载；模型走 `/api/hf` 代理时确认支持 range 请求；fp32 保持数值稳定
- **COOP/COEP**：多线程 WASM 需要跨域隔离头（生产部署配 headers）
- **WebGPU 限制**：Iris Xe 2GB 显存 → 建议每页显示"模型体积 + 所需显存"；>2GB 模型（Gemma 3n / FLUX.2）标注"可能无法运行"
- **动态加载**：所有模型/库按需 import，避免主包膨胀；进度条显示具体下载文件

### Python 功能
- 严格按 python-tool-integration 流程：脚手架 → 队列 → API（`/api/aigc/<slug>`）→ demos.ts + i18n 注册 → 端到端验证
- worker 必须 `sys.stdin/stdout/stderr.reconfigure(encoding="utf-8")`（Windows 中文）
- 模型下载走 `HF_ENDPOINT=https://hf-mirror.com`；大模型放用户目录，不入 git（`tmp/`、`public/generated/` 已 ignore）
- CPU 限制线程数；模型常驻复用（二次调用不等待）
- 许可证页面标注：DeepSeek（研究）、SANA（Apache-2.0）、Moebius（Apache-2.0）、CodeFormer（MIT）、Real-ESRGAN（BSD-3）、TripoSR（MIT）、SadTalker（非商用）、Gemma（条款）、Qwen（Apache-2.0）

---

## 8. 建议执行顺序

```text
Phase 1（纯浏览器，当天见效）──► A1 Janus 文生图 + A3 Moebius 图像修复 + B5 WebGPU 诊断
        │
Phase 2（Python 后端）────────► A2 SANA 文生图 + A4 老照片修复 + B1 图生图
        │
Phase 3（P1 进阶）────────────► B3 代码生成 + B4 图生3D + B2 多模态对话
        │
远期 ────────────────────────► C1 照片说话 / C2 FLUX.2 / C3 文生视频 / C4 音效
```

> 说明：A1/A3 纯浏览器实现，无需后端，是投入产出比最高的第一步；A2/A4 需要 Python 依赖安装（diffusers/torch/facexlib 等），按 `python-tool-integration` skill 流程走。

---

## 9. 参考资料

- Janus-Pro-1B 浏览器运行：https://huggingface.co/spaces/webml-community/janus-pro-webgpu ｜ https://github.com/huggingface/transformers.js-examples/tree/main/janus-pro-webgpu ｜ https://huggingface.co/onnx-community/Janus-Pro-1B-ONNX ｜ https://dev.to/emojiiii/running-deepseek-janus-pro-1b-in-the-browser-a-step-by-step-guide-kj2
- Moebius 浏览器修复：https://github.com/simonw/moebius-web ｜ https://huggingface.co/simonw/Moebius-ONNX ｜ https://simonwillison.net/2026/Jun/22/porting-moebius/
- SANA / SANA-Sprint：https://github.com/NVlabs/Sana ｜ https://huggingface.co/Efficient-Large-Model/Sana_Sprint_0.6B_1024px ｜ https://medium.com/@bakh2001ssa/how-do-i-run-the-sana-sprint-0-6b-text-to-image-model-on-a-cpu-using-openvino-7d883071eade
- FastSD CPU（CPU 文生图/修复/上色参考）：https://github.com/rupeshs/fastsdcpu
- 老照片修复：https://github.com/xinntao/Real-ESRGAN ｜ https://github.com/sczhou/CodeFormer ｜ https://github.com/TencentARC/GFPGAN
- 图生 3D：https://github.com/VAST-AI-Research/TripoSR（MIT） ｜ https://github.com/Stability-AI/stable-fast-3d
- 代码生成：https://github.com/cfahlgren1/qwen-2.5-code-interpreter ｜ https://github.com/QwenLM/Qwen2.5-Coder
- 多模态对话：https://pyimagesearch.com/2026/07/27/running-gemma-4-in-the-browser-with-transformers-js-and-webgpu/ ｜ https://huggingface.co/onnx-community/gemma-3n-E2B-it-ONNX
- 照片说话：https://github.com/OpenTalker/SadTalker（Apache-2.0，个人/研究用途）
- FLUX.2 WebGPU：https://github.com/ryanhlewis/flux2-webgpu
- 文生视频：https://github.com/Wan-Video/Wan2.1 ｜ https://github.com/Lightricks/LTX-Video
- 音效：https://github.com/haoheliu/AudioLDM2 ｜ https://huggingface.co/stabilityai/stable-audio-open-1.0


---

# ??????2026-08-13?GitHub ????/aigc ??

> ?????GitHub API + ??????????huggingface/transformers.js-examples?mlc-ai/web-llm?google-ai-edge/mediapipe-samples-web?onnx-community ????
> ??????????????WebGPU/WASM?transformers.js/ONNX Runtime Web?????????????? Python ?????

## 1. GitHub ???????????

### ?????transformers.js v4 / onnxruntime-web / WebGPU?
| ?? | ??/?? | ?? | ?? | ?? |
|---|---|---|---|---|
| ????/?? | transformers.js-examples/remove-background-webgpu | Xenova/modnet | ~25MB | ? ??? bg-removal |
| ?????????+??? | transformers.js-examples/deepseek-r1-webgpu?llama-3.2-reasoning-webgpu | DeepSeek-R1-Distill-Qwen-1.5B / MiniThinky-v2-1B | 1.1GB / 700MB | ? ??? reasoning-chat |
| ????+????? | transformers.js-examples/code-completion + Pyodide | Qwen2.5-Coder-0.5B ? | 350-500MB | ? ??? codegen |
| ??????? | transformers.js-examples/smolvlm-webgpu | SmolVLM-256M-Instruct | ~500MB | ? ??? multimodal-chat |
| ??????? | transformers.js-examples/musicgen-web | Xenova/musicgen-small (q8) | 656MB | ? ???WASM ??????? speech/aigc ??? |
| ??? TTS | transformers.js-examples/text-to-speech-webgpu | OuteTTS | ~500MB | ? ?? speech??? TTS ???? |
| ????? Whisper | transformers.js-examples/realtime-whisper-webgpu | whisper-small | ~460MB | ? ?? speech?asr ?????? Whisper? |
| ????????? | transformers.js-examples/video-background-removal | RMBG | - | ? ??????????? bg-removal |
| ?????? | transformers.js-examples/semantic-image-search-web | CLIP/ViT | - | ? ?? vision/nlp |
| ??????/Tokenizer | transformers.js-examples/attention-visualization?the-tokenizer-playground | ?/??? | ? | ? ?????? ML/NLP |
| Qwen3 / Phi-3.5 / SmolLM ?? | transformers.js-examples/qwen3-webgpu?phi-3.5-webgpu?smollm-webgpu | 0.6B-3.8B | 0.5-2GB | ? webllm ????????????? |

### Python ?????????/????CPU ???
| ?? | ?? | ??/?? | ?? | ?? |
|---|---|---|---|---|
| ?? 3D | VAST-AI-Research/TripoSR | TripoSR + torchmcubes | ~1GB | ? planned?tripo3d? |
| ???? | OpenTalker/SadTalker | SadTalker + ???? | ~1GB | ? planned?talking-photo????? |
| ???? | Wan-Video/Wan2.1?Lightricks/LTX-Video | Wan2.1-1.3B | ~2GB | ? planned?video-gen?? GPU? |
| ????? | piddnad/ddcolor_modelscope?DDColor? | onnx/pytorch | ~100-200MB | ? ??? photo-restore ????? |
| ???/???? | AnimeGANv2?White-box Cartoonization | ONNX | ~50MB | ? ??? vision ???? |

## 2. ????2026-08-13???????????????

| demo | ?? | ?? | ???? |
|---|---|---|---|
| ???? | /vision/bg-removal | Xenova/modnet | AutoModel + AutoProcessor?mask ? uint8 ????? alpha????? + ????????? PNG |
| ???? | /aigc/reasoning-chat | DeepSeek-R1-Distill-Qwen-1.5B / MiniThinky-v2-1B | AutoModelForCausalLM + TextStreamer?token_callback ?? <think>/<|thinking|> ??"??/??"???InterruptableStoppingCriteria ?? |
| ??????? | /aigc/codegen | Qwen2.5-Coder-0.5B / tiny_starcoder_py / codegen-350M-mono | pipeline text-generation ?????Pyodide?CDN??????? Python??? usePyodide composable |
| ????? | /aigc/multimodal-chat | SmolVLM-256M-Instruct | AutoModelForVision2Seq????????q8 decoder + fp32 vision encoder?WebGPU ?? |

???? /aigc/[slug].vue ?????? 3 ? planned ???tripo3d / talking-photo / video-gen??/aigc ? 6 ??? 12 ?????????????????????/vision/bg-removal??

## 3. ???????

- transformers.js v4 ?? import + setupTransformersEnv()????? env.allowLocalModels=false ? /api/hf ??????? 404 ??
- dtype ???WebGPU+fp16 ? q4f16??? q4?LLM?? q8?0.5B ?????MODNet ?? fp32
- ???????TextStreamer token_callback_function ? token id ???????DeepSeek <think></think>=151648/151649?MiniThinky <|thinking|><|answer|>?
- ?????InterruptableStoppingCriteria?????? new??? worker?
- Pyodide ????? composable?app/composables/usePyodide.ts??????????????
- ????????model-downloader.ts ?? Xenova/modnet?~25MB??????????????????
- ???/aigc?/vision ?????? 200?bg-removal ?????????????? 1.9s??? PNG??codegen Pyodide ?????????????
- ???3000 ??????????node .output/server/index.mjs??????? pnpm build ??????
