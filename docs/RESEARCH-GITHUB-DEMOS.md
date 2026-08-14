# GitHub Demo 调研报告（新增候选精选）

> 调研时间：2026-08-13
> 调研方式：GitHub 检索 + GitHub API 元数据核验（star / license / 描述）
> 原则：**能在浏览器实现的用浏览器（WebGPU / WASM / Web API），浏览器实现不了或效果差的用后台 Python 处理并传回浏览器（异步队列 + 常驻 worker）。**
> 本机约束：Intel i5-13500H、16GB 内存、**无 NVIDIA GPU**（Iris Xe 核显 2GB，支持 WebGPU 但显存/内存有限）→ 浏览器端走 WebGPU/WASM；Python 侧只跑 CPU 友好小模型。
> 收录范围：**精选**（每类 3~6 个、共 19 个，均为真新增且本机可落地）；另附「已有 planned 项替代建议」与「备选/远期参考」。

---

## 1. 执行摘要

| 分类 | 精选候选数 | P0 | P1 | P2 | 核心方向 |
|---|---|---|---|---|---|
| speech 语音 | 4 | 2 | 2 | 0 | 浏览器离线 TTS、SenseVoice 多任务语音理解、实时流式转写、浏览器音频分离 |
| vision 视觉 | 5 | 2 | 3 | 0 | Florence-2 统一视觉、CLIP 图文搜索、YOLO11 多任务、SAM2 点击分割、视频背景虚化 |
| nlp 自然语言 | 4 | 1 | 3 | 0 | 浏览器 RAG、NLLB 翻译、Cross-Encoder 重排、Python 文档解析 |
| aigc AI 生成 | 3 | 0 | 3 | 0 | 浏览器语音助手、智能体工具调用、WebSD 浏览器文生图 |
| ml 机器学习 | 3 | 0 | 1 | 2 | DQN 游戏、Token/注意力可视化、嵌入基准 |
| **合计** | **19** | **5** | **12** | **2** | |

**浏览器 13 个 / Python 6 个**（Python 仅用于浏览器做不到或效果差的：中文多任务 ASR、文档版面解析）。

---

## 2. 候选清单（按分类）

> 🖥 = 纯浏览器（WebGPU/WASM）；🐍 = Python 后端（异步队列 + 常驻 worker，传回浏览器）
> 工作量：S <1天 / M 1-3天 / L 3-5天

### 2.1 speech 语音（4 个）

| # | 候选 | 来源（repo / star / 许可） | 实现 | 依赖/模型 | 优先级 | 与现有 demo 关系 |
|---|---|---|---|---|---|---|
| S1 | **浏览器离线 TTS（Kokoro-82M）** | hexgrad/kokoro 8.4k★ Apache-2.0；rhulha/StreamingKokoroJS 367★ | 🖥 | kokoro-js + onnx-community/Kokoro-82M-v1.0-ONNX | **P0** | `tts` 现有 edge-tts 在线合成 → 新增全本地离线版，互补 |
| S2 | **多任务语音理解（SenseVoice）** | FunAudioLLM/SenseVoice 9.1k★ MIT；modelscope/FunASR 19.8k★ MIT | 🐍 | SenseVoiceSmall 234M（ASR+语种+情感+音频事件） | **P0** | `asr`/`emotion` 为单任务 → 一模型多任务、中文强，真新增 |
| S3 | **实时流式转写（Whisper/Moonshine）** | huggingface/transformers.js-examples（realtime-whisper-webgpu / moonshine-web）；tanpreetjolly/browser-whisper 195★ MIT | 🖥 | transformers.js + whisper tiny/base 或 Moonshine（~300MB q8） | P1 | `asr` 是文件转写 + Web Speech 实时 → 补浏览器流式 + 词级时间戳 |
| S4 | **浏览器音频分离（Demucs-rs）** | nikhilunni/demucs-rs 137★ Apache-2.0；YouStem（htdemucs WebGPU） | 🖥 | Rust→WASM/WebGPU，htdemucs | P1 | `separation` 是 Python Demucs → 浏览器版纯前端、隐私好（可选） |

#### S1 浏览器离线 TTS（P0）实现要点
- 页面 `app/pages/speech/tts-local.vue`（或并入 tts 页加「离线模式」Tab）；用 `@huggingface/transformers` 的 `pipeline('text-to-speech')` 或 kokoro-js 封装加载 Kokoro-82M（~330MB q8）。
- 中文用 `@uzen/kokoro-js`（支持普通话 4 女 4 男 + 中英混读 v1.1-zh 模型）；WebGPU 优先、WASM 兜底，加载进度条。
- 参数：音色下拉、语速；结果 WAV 播放 + 下载；与现有 edge-tts（在线）对比展示「离线 vs 在线」。
- 注意：Kokoro-82M 有 v1.0/v1.1 多版本，先验证 onnx-community 仓库可用性与中文音色（VOICES.md）。

#### S2 SenseVoice 多任务语音理解（P0）实现要点
- `python/speech/sensevoice/`：FunASR `AutoModel(model="iic/SenseVoiceSmall")`，常驻 worker + 队列 + `server/api/speech/sensevoice`（照 voice-clone 模板）。
- 输出按段返回 `{ text, language, emotion, events }`（事件如笑声/掌声/音乐/咳嗽），CPU 秒级，中/英/日/韩/粤。
- 页面 `app/pages/speech/sensevoice.vue`：录音/上传 → 分段时间轴 + 情感/事件标签高亮 + 导出。
- 踩坑：FunASR 依赖较多（onnxruntime/torch 二选一），优先 onnxruntime 版；模型 ~1GB 首次下载走 `download_model.py` + hf-mirror。

### 2.2 vision 视觉（5 个）

| # | 候选 | 来源（repo / star / 许可） | 实现 | 依赖/模型 | 优先级 | 与现有 demo 关系 |
|---|---|---|---|---|---|---|
| V1 | **Florence-2 统一视觉任务** | huggingface/transformers.js-examples/florence2-webgpu；onnx-community/Florence-2-base（0.23B，MIT） | 🖥 | transformers.js v4，Florence-2-base ONNX（~1GB q4） | **P0** | `image-captioning` 仅 ViT-GPT2 描述 → 升级为描述/检测/分割/OCR 一模型多任务 |
| V2 | **CLIP 图文语义搜索** | transformers.js-examples（webgpu-clip / semantic-image-search-web）；dev48v/clip-from-zero MIT | 🖥 | CLIP ViT-B/32 ONNX（量化 ~40MB） | **P0** | 现有 `image-embedder` 是 MediaPipe 同类图相似 → 新增文搜图/零样本匹配 |
| V3 | **YOLO11 多任务实时检测** | nomi30701/yolo-multi-task-onnxruntime-web 13★ MIT；ultralytics/inference web 版（AGPL-3.0） | 🖥 | onnxruntime-web + YOLO11 ONNX（检测/姿态/实例分割/OBB），WebGPU→WASM | P1 | `object-detector` 是 MediaPipe EfficientDet → YOLO 更强 + 可加载自定义模型 |
| V4 | **SAM2 点击分割** | lucasgelfond/webgpu-sam2 183★；transformers.js-examples/segment-anything-webgpu | 🖥 | SAM2 tiny ONNX（~150MB+）+ WebGPU | P1 | `interactive-segmenter` 是 MediaPipe → SAM2 点/框提示分割任意物体，效果更强 |
| V5 | **实时视频背景虚化/替换** | transformers.js-examples/video-background-removal；segmo / @vpalmisano/virtual-background | 🖥 | 复用 MODNet/SAM 掩码 + canvas 合成 | P1 | `bg-removal` 是静态图 MODNet → 摄像头实时虚化/换背景，真新增 |

#### V1 Florence-2（P0）实现要点
- 页面 `app/pages/vision/florence.vue`（或并入 ai-vision Playground 页）；`Florence2ForConditionalGeneration` + 任务 prompt（`<CAPTION>/<DETAILED_CAPTION>/<OD>/<OCR>/<REGION_PROPOSAL>`）。
- 输出统一渲染：文本框 + 检测框叠加 + 分割掩码；WebGPU 优先、WASM 兜底。
- 模型：`onnx-community/Florence-2-base`（q4 ~1GB）或 base-ft；先验证 hf 代理下载（Range 已支持）。
- 与现有 `image-captioning` 的关系：建议在页面内提供「经典 ViT-GPT2 vs Florence-2」对比 Tab，保留旧 demo。

#### V2 CLIP 图文搜索（P0）实现要点
- 页面 `app/pages/vision/clip-search.vue`：一次多选本地图片 → `feature-extraction` 提 CLIP 图像嵌入（IndexedDB 缓存）→ 输入文本实时算余弦相似度排序。
- 可扩展「文搜图」+「图搜图」双 Tab；参考 tomayac/clip-image-sorter 的 File System Access 目录选择。
- 模型：`Xenova/clip-vit-base-patch32`（量化 ~40MB，走 /api/hf 代理）；嵌入维度 512。
- 注意：CLIP 对中文文本支持弱（英文 prompt 效果佳），页面给中英双语提示词示例。

### 2.3 nlp 自然语言（4 个）

| # | 候选 | 来源（repo / star / 许可） | 实现 | 依赖/模型 | 优先级 | 与现有 demo 关系 |
|---|---|---|---|---|---|---|
| N1 | **浏览器 RAG 文档问答** | transformers.js-examples（adaptive-retrieval / pglite-semantic-search）；tantaraio/voy 1.1k★ Apache-2.0；LocalMind / academic-copilot | 🖥 | pdf.js + all-MiniLM-L6-v2（23MB）/EmbeddingGemma + IndexedDB/Voy + 复用 WebLLM | **P0** | 现有 nlp 无检索/问答闭环 → 真新增（FEATURE-PLAN 第 6 项，补具体实现） |
| N2 | **浏览器翻译（NLLB）** | transformers.js-examples/react-translator；Xenova/nllb-200-distilled-600M | 🖥 | NLLB-200-distilled-600M ONNX（q8 ~600MB） | P1 | `speech-translate` 只做语音→英文 → 新增纯文本 200 语互译 |
| N3 | **Cross-Encoder 文本重排** | transformers.js-examples/cross-encoder | 🖥 | MiniLM cross-encoder ONNX（~90MB）或 bge-reranker-base | P1 | 与 N1 配套：召回 top-k → 精排；也可单独演示重排效果 |
| N4 | **文档解析（PDF/图片→Markdown/JSON）** | microsoft/markitdown 173k★ MIT；DS4SD/docling 64k★ MIT；PaddlePaddle/PaddleOCR 87k★ Apache-2.0 | 🐍 | markitdown（轻）/ PaddleOCR（中文版面、表格） | P1 | 浏览器 OCR 已有（Tesseract）但版面/表格弱 → Python 后端补强，归 nlp（文档→结构化文本） |

#### N1 浏览器 RAG（P0）实现要点
- 页面 `app/pages/nlp/rag.vue`：拖拽 PDF/文本 → pdf.js 抽文本 → 分块（~300 字重叠）→ MiniLM 嵌入 → IndexedDB 持久化。
- 检索：Voy（WASM HNSW）或暴力余弦，top-k 高亮片段；生成：复用现有 webllm（Qwen2.5）流式回答并附引用。
- 中文场景换 `paraphrase-multilingual-MiniLM-L12-v2`（~118MB）或 EmbeddingGemma（308M，多语言）。
- 隐私卖点：全流程不出浏览器；限制文档 ≤ 10MB、chunk ≤ 1 万，防卡死。

### 2.4 aigc AI 生成（3 个）

| # | 候选 | 来源（repo / star / 许可） | 实现 | 依赖/模型 | 优先级 | 与现有 demo 关系 |
|---|---|---|---|---|---|---|
| A1 | **浏览器语音对话助手（全本地）** | muthuspark/ava 28★ MIT；proj-airi/webai-examples 34★ MIT | 🖥 | Silero VAD + Whisper + WebLLM + Kokoro 组合 | P1 | 现有 webllm/asr/tts 是单点 → 组合成「语音对话闭环」亮点 demo |
| A2 | **浏览器智能体（工具调用 Loop）** | a-matson/agentic-llm；mlc-ai/web-llm 18.5k★（支持 function calling） | 🖥 | WebLLM 工具调用 + Pyodide + 内置工具 | P1 | `codegen` 是单轮补全+执行 → 升级为多工具自主循环 |
| A3 | **浏览器文生图（Web Stable Diffusion）** | mlc-ai/web-stable-diffusion 3.7k★ Apache-2.0；microsoft/webnn-developer-preview 68★ MIT | 🖥 | SD1.5/SD-Turbo WebGPU（~2GB）；WebNN 备选 | P2 | `text-to-image` 是 Janus-Pro → 经典 SD 风格互补（核显慢，可选） |

> A1 说明：严格归 aigc（LLM 对话为核心），但实现会复用 speech 的 VAD/ASR/TTS 组件，跨类协作。

### 2.5 ml 机器学习（3 个）

| # | 候选 | 来源（repo / star / 许可） | 实现 | 依赖/模型 | 优先级 | 与现有 demo 关系 |
|---|---|---|---|---|---|---|
| M1 | **DQN 游戏（Snake）** | Sappymukherjee214/Snake-Game-AI；tensorflow/tfjs-examples 6.8k★ Apache-2.0 | 🖥 | TF.js 手写 DQN + canvas | P1 | `cartpole`（策略梯度）/`flappy`（遗传算法）→ 补价值型 RL（DQN） |
| M2 | **Token / 注意力可视化** | transformers.js-examples（the-tokenizer-playground / attention-visualization） | 🖥 | 轻量（可零模型） | P2 | 现有 ml 偏训练 → 补模型内部机制教学 |
| M3 | **嵌入模型基准（WebGPU）** | transformers.js-examples/webgpu-embedding-benchmark | 🖥 | transformers.js 多模型对比 | P2 | 与 nlp 嵌入互补 → 性能/质量对比教学 |

---

## 3. 已有 planned / 受限 demo 的替代建议

| 现有项 | 原方案 | 建议 | 依据 |
|---|---|---|---|
| `talking-photo`（aigc） | SadTalker（非商用许可） | **换 EchoMimic**（antgroup/echomimic 4.3k★，Apache-2.0，AAAI 2025）或 **LivePortrait**（KwaiVGI/LivePortrait 18.9k★，动作迁移） | 许可更宽松、效果更好；本机无 GPU → EchoMimic 仅标注「GPU 推荐」，LivePortrait 可 CPU 试跑短片段 |
| `video-gen`（aigc） | Wan2.1（需 GPU） | 补充 **LTX-Video**（Lightricks/LTX-Video 10.8k★ Apache-2.0，2B 更小）为备选 | 仍需 CUDA，本机不可行 → 维持 planned，等服务器部署 |
| `tripo3d`（aigc） | TripoSR | 保持；可补 **Brush**（ArthurBrussee/brush 4.9k★ Apache-2.0，浏览器 3DGS）为浏览器端参考 | TripoSR CPU 30-60s 可行；Brush 做「多图→3D 高斯」浏览器预览 |
| `voice-convert`（speech，受限） | RVC（需 MSVC 编译） | 备选 **CosyVoice**（FunAudioLLM/CosyVoice 22.7k★ Apache-2.0，3s 零样本克隆）或 **GPT-SoVITS**（RVC-Boss/GPT-SoVITS 60.8k★ MIT，1 分钟数据微调） | 中文音色克隆更强；安装成本高（M-L），标注受限风险 |
| `singing`（speech，planned） | DiffSinger（需 GPU+声库） | 维持现状；本机无 GPU 无法落地 | — |

---

## 4. 备选 / 远期参考（不占精选名额）

| 候选 | 来源 | 说明 |
|---|---|---|
| 浏览器图像超分（Real-ESRGAN/SwinIR ONNX） | upscalejs / josephrocca/super-resolution-js | 可并入 photo-restore 页加「浏览器超分」Tab，或独立小 demo |
| LaMa 物体移除（浏览器） | g-ronimo/lama ONNX + onnxruntime-web（wipe.photos） | 并入现有 `inpainting`（Moebius）加「快速模式」 |
| 人脸属性分析（年龄/性别/表情/注视） | vladmandic/human 3.2k★ MIT | 基于现有 face-landmarker 扩展，效果展示佳 |
| 手写公式识别 | ink-on（npm，INT8 编码器 3.4MB+解码器 4MB） | 画布输入，浏览器本地；数学教学场景 |
| 实时说话人分离转写（浏览器） | beekmarks/whisper-real-time-speaker-diarization | 实验性，精度一般 → P2 观察 |
| 语义音频搜索（CLAP） | transformers.js-examples/semantic-audio-search | 音频→嵌入→文搜音；可与 S2 结合 |
| 浏览器 SpeechT5 TTS | transformers.js-examples/speecht5-web | 已被 S1 Kokoro 覆盖，仅参考 |
| 3D 重建（视频→3DGS） | johannes-kaindl/autosplat（AGPL-3.0） | 远期；Apple Silicon 为主，本机不可行 |
| FLUX.2 浏览器文生图 | ryanhlewis/flux2-webgpu | 模型 3.5GB，Iris Xe 不现实 → 远期 |
| 浏览器文生音效/音乐（MusicGen 浏览器版） | transformers.js-examples/musicgen-web；flatsiedatsie/transformers_js_musicgen | 浏览器跑 MusicGen 实验性、慢 → 保持 Python 版即可 |

---

## 5. 建议执行顺序

```text
Phase 1（P0 · 纯浏览器优先，当天见效）
  ├─ S1 浏览器离线 TTS（Kokoro）          ← 与现有 tts 对比，演示效果好
  ├─ V1 Florence-2 统一视觉               ← 一模型多任务，替换/对比 image-captioning
  ├─ V2 CLIP 图文搜索                     ← 轻量（40MB），交互感强
  └─ N1 浏览器 RAG 文档问答               ← 复用 webllm + 嵌入，闭环亮点

Phase 2（P0 · Python 后端 + P1 浏览器）
  ├─ S2 SenseVoice 多任务语音理解（🐍 常驻 worker + 队列 + API）
  ├─ V3 YOLO11 / V4 SAM2 / V5 视频背景虚化（🖥 按兴趣逐个做）
  └─ N2 翻译 / N3 重排（🖥，与 RAG 配套）

Phase 3（P1/P2 · 组合与进阶）
  ├─ A1 浏览器语音助手（组合 S1+VAD+ASR+webllm）
  ├─ A2 智能体工具调用（扩展 codegen）
  ├─ M1 Snake DQN / M2 可视化 / M3 基准
  └─ N4 文档解析（🐍 markitdown + PaddleOCR）

远期
  └─ A3 WebSD、EchoMimic/LivePortrait 照片说话、LTX-Video 视频（等服务器部署）
```

> 实现规范：所有新增 demo 注册进 `app/utils/demos.ts` + i18n（zh/en）；Python 功能严格走 `python-tool-integration` 流程（脚手架 → 队列 → API → 页面）；浏览器功能复用 `app/utils/` 现有工具（mediapipe-vision、image-tools、usePyodide、hf 代理）。

---

## 6. 主要参考资料

- huggingface/transformers.js-examples：https://github.com/huggingface/transformers.js-examples
- mlc-ai/web-llm：https://github.com/mlc-ai/web-llm
- mlc-ai/web-stable-diffusion：https://github.com/mlc-ai/web-stable-diffusion
- FunAudioLLM/SenseVoice：https://github.com/FunAudioLLM/SenseVoice
- hexgrad/kokoro（Kokoro-82M）：https://github.com/hexgrad/kokoro
- nomi30701/yolo-multi-task-onnxruntime-web：https://github.com/nomi30701/yolo-multi-task-onnxruntime-web
- lucasgelfond/webgpu-sam2：https://github.com/lucasgelfond/webgpu-sam2
- vladmandic/human：https://github.com/vladmandic/human
- antgroup/echomimic：https://github.com/antgroup/echomimic
- KwaiVGI/LivePortrait：https://github.com/KwaiVGI/LivePortrait
- microsoft/markitdown：https://github.com/microsoft/markitdown
- DS4SD/docling：https://github.com/DS4SD/docling
- opendatalab/MinerU：https://github.com/opendatalab/mineru
- PaddlePaddle/PaddleOCR：https://github.com/PaddlePaddle/PaddleOCR
- ArthurBrussee/brush：https://github.com/ArthurBrussee/brush
- muthuspark/ava：https://github.com/muthuspark/ava