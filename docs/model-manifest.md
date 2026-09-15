# 模型清单 Lock（Model Manifest）

> 本文档是 AI Tech Hub 全部 AI 模型的**权威清单**（lock 语义：新增/替换模型必须先改这里）。
> 数据实测日期：2026-09-11（`du -sh .models/*`），2026-09-11 新增语音模块 4 个仓库（whisper ×3 / SER / chatterbox，约 +4.0 GB）。
> 相关实现：`server/utils/model-downloader.ts`（预下载）、`server/utils/model-fetch.mjs`（仓库级下载，**ModelScope 优先**）、`scripts/fetch-models.mjs`（手动预取 `pnpm models:fetch`）、`server/api/hf/[...].get.ts`（HF 镜像代理，仅作为回退）、`server/routes/model/[...].ts`（本地模型 API，Range/206）、`scripts/trim-production-assets.mjs`（构建防御清理，见 `docs/DEPLOY-AIHUB.md` 第八节）。

## 0. 总览

| 目录 | 用途 | 磁盘占用 | 加载方式 | 是否随构建产物 |
| --- | --- | --- | --- | --- |
| `.models/yolo/` | YOLO26 全任务检测（7 个 onnx） | 78 MB | 站点自带（gitignore 例外） | ❌ 不入库，随代码分发例外 |
| `.models/transformers/` | Transformers.js（Xenova/onnx-community 16 仓，含语音 7 仓） | 9.7 GB | 预下载 + `/api/hf` 回退 | ❌ 不打包 |
| `.models/mediapipe/` | MediaPipe Tasks（16 模型 + WASM） | 209 MB | 预下载 | ❌ 不打包 |
| `.models/tfjs/` | TensorFlow.js（MobileNet + Speech Commands） | 19 MB | 预下载 | ❌ 不打包 |
| `.models/webllm/` | WebLLM Q4 小模型 + WASM libs | 20 MB | 预下载 | ❌ 不打包 |
| `.models/faceapi/` | 人脸检测/关键点/识别（6 文件） | 6.7 MB | 预下载 | ❌ 不打包 |
| `public/vendor/wavesurfer/` | wavesurfer.js 7.12.12 ESM（音频可视化） | 84 KB | 站点自带（vendor 自托管） | ✅ 随构建产物 |

**合计**：预置模型 ≈ 9.3 GB。模型文件不再进入 `public/`，**构建产物不含任何模型**；运行时由 `server/routes/model/[...].ts` 以 HTTP Range(206) 从 `.models/` 提供给浏览器端推理库（前端 URL 仍为 `/model/*`，保持不变）。

## 1. 预下载清单（server/utils/model-downloader.ts）

服务器生产模式启动时由 `downloadAllModels()` 检查/补齐，**跳过已存在文件**。仓库级下载统一走 `server/utils/model-fetch.mjs`，源优先级 **ModelScope → hf-mirror.com → huggingface.co**（2026-09-11 起）。之所以不再只依赖 hf-mirror：部分网络下 hf-mirror.com 会 308 跳转到被墙的 huggingface.co，导致整条预取链路失效，而 ModelScope 上有 Xenova / onnx-community 的完整镜像可直接替换。

| 分组 | 模型/资源 | 版本/来源 | 落盘位置 | 实测大小 |
| --- | --- | --- | --- | --- |
| MediaPipe 模型 | blaze_face_short_range / face_landmarker / gesture_recognizer / hand_landmarker / holistic_landmarker / efficientnet_lite0 / mobilenet_v3_small / selfie_segmenter / hair_segmenter / interactive_segmentation / efficientdet_lite0 / pose_landmarker_lite / yamnet / language_detector / bert_classifier / universal_sentence_encoder | MediaPipe Models（Google Storage，float16/float32） | `.models/mediapipe/models/*` | 135 MB |
| MediaPipe WASM | tasks-vision / tasks-text / tasks-audio | @mediapipe/tasks-*@1.0.1（jsdelivr） | `.models/mediapipe/wasm/{vision,text,audio}/*` | 74 MB |
| Transformers.js（NLP/视觉） | Xenova/bert-base-NER-uncased、distilbert-base-uncased-mnli、distilbart-cnn-6-6、distilbert-base-cased-distilled-squad、bert-base-uncased、depth-anything-v1-small、vit-gpt2-image-captioning、modnet | 跳过 `.bin/.h5/.safetensors/.ot` 与 `model_bnb4/q4` 变体 | `.models/transformers/Xenova/...` | 4.9 GB |
| **Transformers.js（语音）** | `Xenova/whisper-tiny` / `whisper-base` / `whisper-small`、`onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX`、`onnx-community/chatterbox-ONNX`、`onnx-community/Kokoro-82M-v1.0-ONNX`、`Xenova/wavlm-base-plus-sv`、`Xenova/opus-mt-zh-en` / `opus-mt-en-zh` | ModelScope 镜像；whisper 取 `encoder_model` + `decoder_model_merged` 的 fp32/q8 两套；SER / 声纹取 fp32+q8；chatterbox 取 fp32/q4/q4f16；opus-mt 只取 q8 | `.models/transformers/{Xenova,onnx-community}/...` | 4.7 GB |
| WebLLM | Qwen2.5-0.5B/1.5B-Instruct、Llama-3.2-1B/3B-Instruct（q4f16_1） | mlc-ai MLC 仓库 + binary-mlc-llm-libs（v0_2_84） | `.models/webllm/{model}/resolve/main/...` + `.models/webllm/libs/*.wasm` | 20 MB |
| TensorFlow.js | MobileNet v2 1.0（tfhub.dev）、Speech Commands v0.5 18w（Google Storage） | weight manifest 动态拉取 | `.models/tfjs/{mobilenet,speech-commands}/*` | 19 MB |
| face-api | tiny_face_detector / face_landmark_68 / face_recognition | vladmandic/face-api master（jsdelivr → GitHub raw 回退） | `.models/faceapi/*`（6 文件） | 6.7 MB |

### 1.1 语音模型逐仓明细（2026-09-11 实测）

| 仓库 | 别名（`pnpm models:fetch <别名>`） | 保留文件策略 | 实测大小 |
| --- | --- | --- | --- |
| `Xenova/whisper-tiny` | `whisper-tiny` | `encoder_model` + `decoder_model_merged` 的 fp32 与 `_quantized` | 206 MB |
| `Xenova/whisper-base` | `whisper-base` | 同上 | 368 MB |
| `Xenova/whisper-small` | `whisper-small` | 同上 | 1.2 GB |
| `onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX` | `ser` | `onnx/model.onnx`（fp32）+ `model_quantized.onnx`（q8） | 466 MB |
| `onnx-community/chatterbox-ONNX` | `chatterbox` | `embed_tokens`/`speech_encoder`/`conditional_decoder` 的 fp32 + `language_model` 的 q4 与 q4f16（含 `.onnx_data`） | 1.8 GB |
| `onnx-community/Kokoro-82M-v1.0-ONNX` | —（原有，TTS） | 全量 | 116 MB |
| `Xenova/wavlm-base-plus-sv` | `voiceprint` | `onnx/model.onnx`（fp32）+ `model_quantized.onnx`（q8） | 481 MB |
| `Xenova/opus-mt-zh-en` | `mt-zh-en` | Seq2Seq 的 **q8 两件套**（encoder + decoder_merged），fp32 不下 | 117 MB |
| `Xenova/opus-mt-en-zh` | `mt-en-zh` | 同上 | 117 MB |

> 说明：whisper 在 transformers.js 里属于 `Seq2Seq`（MODEL_SESSION_CONFIG），只请求 `onnx/encoder_model*` 与 `onnx/decoder_model_merged*`；`decoder_model*` / `decoder_with_past*` 等变体不会被请求，故一律不下载（否则单仓要多吃 1 GB+）。`q8` 对应 `_quantized` 后缀、`fp32` 无后缀，见 `DEFAULT_DTYPE_SUFFIX_MAPPING`。

## 2. 前端按需拉取清单（/api/hf 代理，不预下载）

下列模型**只在前端引用**（transformers.js `env.remoteHost='/api/hf'`），缺失时经 `server/api/hf/[...].get.ts` 从 `HF_MIRROR_URL`（默认 hf-mirror.com）实时拉取、不走服务器磁盘。按需拉取的模型**不占用部署产物**，首次使用需要外网可达镜像。

| 用途 | 模型仓库 | 前端引用点 |
| --- | --- | --- |
| 代码生成 | Xenova/codegen-350M-mono、Xenova/tiny_starcoder_py、Qwen2.5-Coder-0.5B-ONNX | `app/utils/transformers.ts` |
| 对话/推理 | onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX、Janus-Pro-1B-ONNX | 同上（chat/多模态管线） |
| 深度估计 | onnx-community/depth-anything-v2-small（新）+ Xenova/depth-anything-small-hf（预下载替代） | 同上（vision 管线） |
| 文本嵌入 | Xenova/all-MiniLM-L6-v2、paraphrase-multilingual-MiniLM-L12-v2 | `app/components/MediaTextRunner.vue` 等 |

> **语音模块已全部转为预下载**（whisper ×3 / SER / chatterbox / Kokoro），因此 speech 页面在无外网环境也可完整工作；`/api/hf` 只是这些模型缺失时的回退。
>
> **兼容说明**：预下载清单与前端引用存在少量版本漂移（如 depth-anything v1 vs v2）——因下载器有跳过/裁剪策略（跳过 bnb4/q4、.bin 等大文件），同模型尽量先落预下载目录从而免网络；未落盘的走 `/api/hf` 回退，两者互补，功能不影响。

## 3. YOLO26（站点自带，不参与下载器）

- 来源：`app/utils/yolo/models.ts` 配置 7 个任务模型，全部 ONNX、路由 `/model/yolo/*`：
  - `yolo26n.onnx`（检测 9.5M）/ `yolo26n-seg.onnx`（分割 11M）/ `yolo26n-sem.onnx`（语义 6.0M）/ `yolo26n-depth.onnx`（深度 20M）/ `yolo26n-cls.onnx`（分类 11M）/ `yolo26n-pose.onnx`（姿态 12M）/ `yolo26n-obb.onnx`（有向检测 9.7M）
- 特殊规则（`.gitignore`）：`.models/*` 全排除，但 `!.models/yolo/` 与 `!.models/yolo/yolo26*.onnx` 例外——**必须随代码分发**（内网离线可用）。
- YOLO 推理走 `app/composables/useYolo.ts` + `app/utils/yolo/models.ts`，运行时即已自带，无需下载。

## 4. 裁剪 / 运维方法

| 场景 | 做法 |
| --- | --- |
| 构建产物瘦身（默认） | 模型已迁至 `.models/`，构建产物不再含模型；`pnpm build`（内含 `node scripts/trim-production-assets.mjs`）作防御性清理，若产物残留 `.output/public/model` 则删除 |
| 指定模型目录 | `MODELS_DIR=/path/to/models` 环境变量覆盖默认 `.models/`（下载器与模型 API 路由共用） |
| 需要离线预置全部模型 | 把模型目录放到服务器 `.models/`（或 `MODELS_DIR` 指向的目录），模型 API 路由自动服务（Range/206，见 `docs/DEPLOY-AIHUB.md` 第八节） |
| **手动预取语音模型** | `pnpm models:list`（看清单与体积）→ `pnpm models:fetch`（全部）或 `pnpm models:fetch whisper-base ser`（按别名）。走 ModelScope 优先源，已存在文件跳过、中断可重跑续传 |
| 跳过构建后防御清理 | `SKIP_TRIM_MODELS=1 node scripts/trim-production-assets.mjs` |
| 服务器生产启动自动补齐 | `server/plugins/download-models.ts`：生产模式 + 非 Vercel + 未设 `NUXT_SKIP_MODEL_DOWNLOAD=1` 时自动运行 |
| Vercel/云端 | 模型不落盘：`server/api/hf/[...].get.ts` 在 Vercel 自动指向 huggingface.co，前端 `/api/hf` 按需拉取 |
| 删除某个模型目录 | 先删 `.models/<group>/`，再同步更新本清单第 1 节与 `server/utils/model-downloader.ts` 对应分组 |