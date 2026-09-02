# AI 技术演示合集 (AI Tech Hub)

基于 **Nuxt 4 + Nuxt UI** 构建的 AI 技术演示平台。绝大多数 AI 能力在**浏览器本地**运行（MediaPipe / Transformers.js / WebLLM / TensorFlow.js / ONNX Runtime Web 等），数据不出设备、无需注册；另有**云端 LLM 对话**与**在线语音合成**（edge-tts）可选联网使用。支持中英文界面。

> ⚠️ 本项目自开源模板改造而来，已移除本地 Python 模型执行层，全部能力直接在浏览器 / 轻量服务接口中完成。所有模型文件**不纳入版本控制**，首次启动会自动下载（见下文「模型管理」）。

---

## ✨ 功能一览

| 分类 | 功能 | 技术 |
|---|---|---|
| 🎵 语音 | 在线语音合成 (TTS) | edge-tts（在线合成） |
| 🎵 语音 | 语音识别 (ASR) | Web Speech API |
| 🎵 语音 | 音频分类 | MediaPipe YAMNet |
| 🎵 语音 | 语音情感识别 / 实时音高检测 / 音频可视化 | transformers.js / YIN / Web Audio |
| 👁 视觉 | 人脸检测 / 关键点 / 手势 / 姿态 / 整体检测 | MediaPipe Tasks |
| 👁 视觉 | 目标检测 / 图像分类 / 图像嵌入 | MediaPipe Tasks |
| 👁 视觉 | 图像分割 / 交互式分割 | MediaPipe Tasks |
| 👁 视觉 | 深度估计 / 图像描述 | Transformers.js |
| 👁 视觉 | 智能抠图（背景移除） | MODNet（Transformers.js，浏览器本地） |
| 🪄 AI 生成 | 浏览器本地 LLM 对话 | WebLLM（Qwen/Llama，WebGPU） |
| 🪄 AI 生成 | 云端 LLM 对话（Kimi K3 / DeepSeek，可切换） | Moonshot / DeepSeek 云端 API（`.env` 配置密钥） |
| 🪄 AI 生成 | 推理对话（DeepSeek-R1 蒸馏，思考流式输出） | Transformers.js + WebGPU/WASM |
| 🪄 AI 生成 | 文生图 / 图像修复 / 多模态对话 | Janus-Pro / Moebius / SmolVLM（浏览器本地） |
| 🪄 AI 生成 | 代码生成与执行 | Qwen2.5-Coder + Pyodide（浏览器内运行 Python） |
| 📝 自然语言 | 文本分类 / 语言检测 / 文本嵌入 | MediaPipe Tasks |
| 📝 自然语言 | 命名实体识别 / 零样本分类 / 摘要 / 问答 / 完形填空 | Transformers.js |
| 🧠 机器学习 | 图像 / 声音 / 姿态 / 文本迁移学习训练 | TensorFlow.js / MediaPipe + KNN |
| 🧠 机器学习 | 神经网络游乐场 / K-Means / 回归 / 决策树 / MNIST / CartPole / Flappy | TensorFlow.js |
| 👁 视觉 | 图像处理 Playground（15 页：查看/变换/像素/颜色/调整/滤镜/增强/形态学/边缘/物体/特征/人脸/OCR/AI视觉/多模态） | Canvas + OpenCV.js + MediaPipe + Tesseract.js |
| 🤖 机械人 | ReBot Arm 机械臂仿真 / MicroDuck 微鸭仿真（MuJoCo + RL 策略） | Three.js / MuJoCo(WASM) / ONNX Runtime Web |

> 🎨 **图像处理 Playground（位于 /vision 视觉分类下）**：15 个页面，每页承载一组相关工具（工具列表 + 参数面板 + 原图/结果双画布 + 下载）。
> 经典 CV（阈值/边缘/物体/特征）使用本地 `public/opencv/opencv.js`（OpenCV 4.10，约 10MB，懒加载）；
> 人脸/分类/分割/嵌入用 MediaPipe；OCR 用 Tesseract.js（CDN 懒加载）；多模态用 Transformers.js。

---

## 🛠 技术栈

- **前端框架**: [Nuxt 4](https://nuxt.com) + [Nuxt UI](https://ui.nuxt.com) + Tailwind CSS
- **i18n**: @nuxtjs/i18n（中/英）
- **浏览器端 AI**:
  - [MediaPipe Tasks](https://ai.google.dev/edge/mediapipe)（视觉/文本/音频）
  - [Transformers.js](https://huggingface.co/docs/transformers.js)（NLP/深度估计/图像描述/AIGC）
  - [WebLLM](https://github.com/mlc-ai/web-llm)（浏览器本地 LLM）
  - [TensorFlow.js](https://www.tensorflow.org/js/)（迁移学习/模型训练）
  - Pyodide（浏览器内运行 Python，代码生成演示）
- **服务端接口（轻量）**: edge-tts 协议（在线 TTS）、云端 LLM 代理
- **包管理**: pnpm

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 20、pnpm ≥ 9（建议 11.x）
- 浏览器建议 Chrome / Edge（WebLLM 需要 WebGPU；其余功能 WASM 兜底）

### 安装与启动

```bash
# 1. 克隆
git clone https://github.com/FrankOldmoon/AI-Tech-Hub.git
cd AI-Tech-Hub

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
- 模型下载器日志输出在 dev server 控制台

---

## 📡 API 文档

### `POST /api/speech/tts`
在线语音合成（edge-tts）。

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

### `POST /api/aigc/llm-chat`
云端 LLM 对话代理（Kimi K3 / DeepSeek，流式 SSE），密钥从 `.env` 读取，不入库。参数与返回结构请参考页面源码。

### `GET /api/hf/**`
HuggingFace 模型代理（转发 hf-mirror.com），供 Transformers.js 远程回退使用，带路径校验。

---

## 🧭 常见问题 (FAQ)

**Q: 页面提示模型 404 / 无法加载？**
首次使用需要下载模型（数百 MB）。请等待服务器启动时的自动下载完成，或检查 dev server 控制台 `[model-downloader]` 输出。WebLLM 大模型（1.5B/3B）默认未下载，按需手动下载。

**Q: WebLLM 提示不支持 WebGPU？**
WebLLM 需要 Chrome/Edge 且开启 WebGPU（`chrome://flags` 检查）。不支持时请使用其他功能（WASM 兜底）。

**Q: 上传图片报 "source image could not be decoded"？**
页面会自动将图片转为标准 PNG（canvas 预处理），请使用 PNG/JPG/WebP 格式，避免 HEIC/TIFF/SVG。

**Q: 局域网 / 其他设备如何访问？摄像头在局域网能用吗？**
生产模式（`node .output/server/index.mjs`）默认监听所有网卡，同一局域网设备直接访问 `http://<本机IP>:3000` 即可（本机 IP 用 `ipconfig` 查询；Windows 防火墙需放行 node.exe 入站）。摄像头（`getUserMedia`）要求安全上下文，局域网 HTTP 下不可用；如需局域网使用摄像头，可用自签证书以 HTTPS 启动：设置环境变量 `NITRO_SSL_CERT` / `NITRO_SSL_KEY`（PEM 内容）后再运行 `node .output/server/index.mjs`，其他设备首次访问需接受证书警告。

**Q: 为什么有些模型（BLIP 等）不可用？**
部分 HuggingFace 仓库为 gated（受限）仓库，匿名无法下载（如 `Xenova/blip-image-captioning-base`、`onnx-community/depth-anything-v1-small`），项目已替换为可用的非受限模型（如 Depth-Anything-Small-hf）。

---

## 📝 开发备注

- 模型下载器：`server/utils/model-downloader.ts`（自动下载/跳过已存在）
- 云端 LLM 服务商：`server/utils/llm-providers.ts`
- 上传校验：`server/utils/upload-validation.ts`
- 演示注册表：`app/utils/demos.ts`（新增演示只需在此注册 + 创建页面）

## 📄 License

MIT