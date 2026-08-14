# AI 技术演示合集 (Nuxt AI)

基于 **Nuxt 4 + Nuxt UI** 构建的全栈 AI 技术演示平台。所有 AI 能力在**浏览器本地或本地服务端**运行，无需外部 API Key，支持中英文界面。

> ⚠️ 本项目由社区模板开发而来，经过完整调试与功能补全。所有模型文件**不纳入版本控制**，首次启动会自动下载（见下文「模型管理」）。

---

## ✨ 功能一览

| 分类 | 功能 | 技术 |
|---|---|---|
| 🎵 语音 | 文本转语音 (TTS) | edge-tts（在线合成） |
| 🎵 语音 | 语音识别 (ASR) | Web Speech API |
| 🎵 语音 | 音频分类 | MediaPipe YAMNet |
| 🎵 语音 | 音频分离（人声/伴奏） | Demucs (Python) + 异步任务队列 |
| 👁 视觉 | 人脸检测 / 关键点 / 手势 / 姿态 / 整体检测 | MediaPipe Tasks |
| 👁 视觉 | 目标检测 / 图像分类 / 图像嵌入 | MediaPipe Tasks |
| 👁 视觉 | 图像分割 / 交互式分割 | MediaPipe Tasks |
| 👁 视觉 | 深度估计 | Transformers.js (Depth-Anything) |
| 👁 视觉 | 图像描述 | Transformers.js (ViT-GPT2) |
| 👁 视觉 | 人脸注册与识别（一人多样张注册、合影选脸、上传/摄像头实时识别） | InsightFace (ArcFace) + 浏览器本地注册库 |
| 📝 自然语言 | 文本分类 / 语言检测 / 文本嵌入 | MediaPipe Tasks |
| 📝 自然语言 | 命名实体识别 / 零样本分类 / 摘要 / 问答 / 完形填空 | Transformers.js |
| 🤖 AI 生成 | 浏览器本地 LLM 对话 | WebLLM (Qwen2.5) |
| 🪄 AI 生成 | 智能抠图（背景移除） | MODNet（transformers.js，浏览器本地） |
| 🪄 AI 生成 | 推理对话（DeepSeek-R1 蒸馏，思考过程流式输出） | transformers.js + WebGPU/WASM |
| 🪄 AI 生成 | 代码生成与执行（Qwen2.5-Coder + Pyodide） | transformers.js + Pyodide |
| 🪄 AI 生成 | 多模态对话（SmolVLM-256M，多图多轮） | transformers.js + WebGPU |
| 🧠 机器学习 | 图像迁移学习训练 (摄像头) | TensorFlow.js MobileNet + KNN |
| 🧠 机器学习 | 声音迁移学习训练 (麦克风) | TensorFlow.js Speech Commands |
| 👁 视觉 | 图像处理 Playground（15 页：查看/变换/像素/颜色/调整/滤镜/增强/形态学/边缘/物体/特征/人脸处理/OCR/AI视觉/多模态） | Canvas + OpenCV.js + MediaPipe + Tesseract.js + Transformers.js |

每个功能页面还附带 **Python 最简参考实现源码**（可展开查看，部分可通过 API 直接执行）。

> 🎨 **图像处理 Playground（位于 /vision 视觉分类下）**：15 个页面，每页承载一组相关工具（工具列表 + 参数面板 + 原图/结果双画布 + 下载 + Python 参考实现）。
> 经典 CV（阈值/边缘/物体/特征）使用本地 `public/opencv/opencv.js`（OpenCV 4.10，约 10MB，懒加载）；
> 人脸/分类/分割/嵌入用 MediaPipe；OCR 用 Tesseract.js（CDN 懒加载）；多模态用 Transformers.js。

---

## 🛠 技术栈

- **前端框架**: [Nuxt 4](https://nuxt.com) + [Nuxt UI](https://ui.nuxt.com) + Tailwind CSS
- **i18n**: @nuxtjs/i18n（中/英）
- **浏览器端 AI**:
  - [MediaPipe Tasks](https://ai.google.dev/edge/mediapipe)（视觉/文本/音频）
  - [Transformers.js](https://huggingface.co/docs/transformers.js)（NLP/深度估计/图像描述）
  - [WebLLM](https://github.com/mlc-ai/web-llm)（浏览器本地 LLM）
  - [TensorFlow.js](https://www.tensorflow.org/js)（迁移学习）
- **服务端 AI**: Python + [Demucs](https://github.com/facebookresearch/demucs)（音频分离）、edge-tts 协议（TTS）
- **包管理**: pnpm

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 20、pnpm ≥ 9（建议 11.x）
- Python ≥ 3.10（服务端 Python 功能需要；仅浏览器端功能可跳过）
- 浏览器建议 Chrome / Edge（WebLLM 需要 WebGPU；其余功能 WASM 兜底）

### 安装与启动

```bash
# 1. 克隆
git clone https://github.com/ikeee/nuxt-ai.git
cd nuxt-ai

# 2. 安装依赖（使用 pnpm）
pnpm install

# 3. 启动开发服务器
pnpm dev

# 4. 打开 http://localhost:3000
```

> Windows 提示：如果 `pnpm` / `npm` 因 PowerShell 执行策略被拦截，请使用 `npx.cmd` / `corepack pnpm` 或先执行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。

### 模型管理

模型默认下载到 `public/model/`（**不纳入 git**）：

- 服务器启动时 `server/plugins/download-models.ts` 会自动检查并下载缺失模型（MediaPipe 模型/WASM、Transformers.js 模型、WebLLM 模型），已存在的文件跳过
- 模型源：hf-mirror.com（HuggingFace 国内镜像）+ jsdelivr CDN
- 目录结构：

```
public/model/
├── mediapipe/          # MediaPipe 模型 + WASM
├── transformers/       # Transformers.js ONNX 模型
├── tfjs/               # MobileNet / Speech Commands
└── webllm/             # WebLLM 模型 + wasm 运行库
```

- 若模型缺失，前端会通过 `/api/hf/**` 本地代理自动回退下载（绕过 CORS）
- 模型下载器日志输出在 dev server 控制台 / `dev-server.log`

> 注：人脸识别模型 `buffalo_l`（InsightFace）不在 `public/model/`，由 Python 侧首次使用时自动下载到用户目录 `~/.insightface/`。

### 服务端 Python 功能（音频分离）

首次调用 `/api/speech/separate` 前会自动（或手动）准备环境：

```bash
cd python/speech/separation
py -3 -m venv .venv
.venv\Scripts\pip install -r requirements.txt   # demucs + torchaudio + soundfile + numpy
```

> 服务器插件 `server/plugins/setup-python.ts` 会扫描 `python/**/requirements.txt` 自动创建虚拟环境（Windows 上自动回退 `py -3`）。

### 服务端 Python 功能（人脸注册与识别）

「人脸注册与识别」页（`/vision/face-recognition`）的后端使用 **InsightFace（ArcFace，buffalo_l）** 提取 512 维人脸嵌入；注册库保存在浏览器 localStorage（本机隐私友好，换浏览器会丢失）。

首次调用前会自动（或手动）准备环境：

```bash
cd python/image/face-recognition
py -3 -m venv .venv
.venv\Scripts\pip install -r requirements.txt   # insightface + onnxruntime + opencv-python
```

- 模型 `buffalo_l`（约 300MB）首次使用时自动下载到用户目录 `~/.insightface/`（不在 `public/model/`，不纳入 git）
- 常驻 worker 只加载一次模型，之后每次分析复用；空闲 30 分钟自动退出
- 摄像头拍照注册 / 实时识别需在 `localhost` 或 HTTPS 下使用（浏览器 `getUserMedia` 安全策略）

---

## 📡 API 文档

### `POST /api/speech/tts`
文本转语音（edge-tts 在线合成）。

```json
{
  "text": "你好",
  "voice": "zh-CN-XiaoxiaoNeural",
  "rate": "+0%",
  "pitch": "+0Hz",
  "volume": "+0%"
}
```
返回 `audio/mpeg` 音频流。

### `POST /api/speech/separate`（异步任务）
音频分离采用**异步任务队列**：提交后立即返回 `taskId`，后台排队执行（并发上限 2），前端轮询进度，可取消。

```bash
# 1. 提交任务（multipart/form-data：file / model / twoStems）
curl -F "file=@song.mp3" -F "model=htdemucs" -F "twoStems=vocals" \
  http://localhost:3000/api/speech/separate
# => { "ok": true, "taskId": "uuid" }

# 2. 轮询进度（queued → converting → separating → done/error/cancelled）
curl http://localhost:3000/api/speech/separate/<taskId>
# => { "ok": true, "task": { "status": "separating", "progress": 15, "message": "...", "stems": [...] } }

# 3. 取消任务
curl -X DELETE http://localhost:3000/api/speech/separate/<taskId>
```

参数：
- `model`: `htdemucs`（默认）/ `htdemucs_ft` / `mdx` / `mdx_extra`
- `twoStems`: `vocals`（默认，人声+伴奏）/ `drums` / `bass` / `other` / 空（四轨）

线程控制：环境变量 `SEPARATION_THREADS`（默认 6）限制 torch 线程数，避免分离时拖慢系统。

### `POST /api/image/face-recognition`（异步任务）
人脸识别/验证，采用与音频分离一致的异步任务队列（单并发、常驻 insightface worker）。

```bash
# 1. 提交任务（multipart/form-data）
#    mode=recognition 单图提取全部人脸嵌入；mode=verification 双图比对（需 file + file2）
curl -F "mode=recognition" -F "file=@photo.jpg" \
  http://localhost:3000/api/image/face-recognition
# => { "ok": true, "taskId": "uuid" }

# 2. 轮询结果（queued → loading/processing → done/error/cancelled）
curl http://localhost:3000/api/image/face-recognition/<taskId>
# => { "ok": true, "task": { "status": "done", "result": { "faces": 1, "dim": 512, "embeddings": [...], "bboxes": [[x1,y1,x2,y2]] } } }

# 3. 取消任务
curl -X DELETE http://localhost:3000/api/image/face-recognition/<taskId>
```

- `recognition` 结果包含每张脸的 `embeddings`（512 维）与 `bboxes`（像素坐标），前端据此支持合影选脸
- `verification` 结果包含 `similarity` 与 `verdict`（`same` / `different` / `no-face`）

### `GET /api/python/source?feature=...`
读取 Python 参考实现源码（如 `feature=mediapipe/face-detection`）。

### `POST /api/python/run`
执行 Python 参考实现（argparse 约定：`main.py <input> [--key value]`）。

```json
{ "feature": "mediapipe/face-detection", "input": "/path/to/image.jpg" }
```

### `GET /api/hf/**`
HuggingFace 模型代理（转发 hf-mirror.com），供 Transformers.js 远程回退使用，带路径校验。

---

## 🐍 Python 参考实现

`python/` 下每个功能目录包含独立的 `main.py` + `requirements.txt`：

```
python/
├── mediapipe/          # 视觉/文本/音频（MediaPipe Tasks API）
├── transformers/       # NLP / 深度估计 / 图像描述
├── speech/             # TTS / 分离（Demucs）
├── ml/                 # 图像/声音训练参考
├── image/              # 视觉图像模块（15 个 Playground 页面对应，OpenCV 为主）+ 人脸识别（insightface）
└── aigc/               # 文生图 / 老照片修复
```

> 已全部适配新版 MediaPipe Tasks API（`mp.tasks`），并可在 Windows 上直接运行。

---

## 🧭 常见问题 (FAQ)

**Q: 页面提示模型 404 / 无法加载？**
首次使用需要下载模型（数百 MB）。请等待服务器启动时的自动下载完成，或检查 `dev-server.log` 中 `[model-downloader]` 输出。WebLLM 大模型（1.5B/3B）默认未下载，按需手动下载。

**Q: WebLLM 提示不支持 WebGPU？**
WebLLM 需要 Chrome/Edge 且开启 WebGPU（`chrome://flags` 检查）。不支持时请使用其他功能（WASM 兜底）。

**Q: 音频分离很慢 / 系统卡顿？**
分离是 CPU 密集任务。默认限制 6 线程（`SEPARATION_THREADS` 可调），并通过异步队列限制并发 2。若仍嫌慢，可换 `htdemucs` 小模型或缩短音频。

**Q: 上传图片报 "source image could not be decoded"？**
页面会自动将图片转为标准 PNG（canvas 预处理），请使用 PNG/JPG/WebP 格式，避免 HEIC/TIFF/SVG。

**Q: 局域网 / 其他设备如何访问？摄像头在局域网能用吗？**
生产模式（`node .output/server/index.mjs`）默认监听所有网卡，同一局域网设备直接访问 `http://<本机IP>:3000` 即可（本机 IP 用 `ipconfig` 查询；Windows 防火墙需放行 node.exe 入站）。摄像头（`getUserMedia`）要求安全上下文，局域网 HTTP 下不可用；如需局域网使用摄像头，可用自签证书以 HTTPS 启动：设置环境变量 `NITRO_SSL_CERT` / `NITRO_SSL_KEY`（PEM 内容）后再运行 `node .output/server/index.mjs`，其他设备首次访问需接受证书警告。可参考 `tmp/start-https.ps1`（一键生成/启动脚本）。

**Q: 为什么有些模型（BLIP 等）不可用？**
部分 HuggingFace 仓库为 gated（受限）仓库，匿名无法下载（如 `Xenova/blip-image-captioning-base`、`onnx-community/depth-anything-v1-small`），项目已替换为可用的非受限模型（如 Depth-Anything-Small-hf）。

---

## 📝 开发备注

- 模型下载器：`server/utils/model-downloader.ts`（自动下载/跳过已存在）
- Python 环境初始化：`server/utils/python-setup.ts`（跨平台：Windows 回退 `py -3`）
- 音频分离队列：`server/utils/separation-queue.ts`
- 人脸识别队列：`server/utils/face-recognition-queue.ts`（insightface 常驻 worker）
- 演示注册表：`app/utils/demos.ts`（新增演示只需在此注册 + 创建页面）

## 📄 License

MIT
