# 语音（Speech）类别深度调研报告

> 调研时间：2026-08-11 ｜ 调研工具：AnySearch（多轮 batch_search）
> 本机约束：无 NVIDIA GPU、16GB 内存 → Python 侧只考虑 CPU 友好模型；浏览器侧依赖 WebGPU/WASM。

---

## 0. 代码逻辑重叠判定（2026-08-11 更新）

基于现有代码逐项核对（`app/pages/speech/*.vue`、`server/api/speech/*`、`python/speech/*/main.py`），结论：

| 候选 | 对照代码 | 判定 |
|---|---|---|
| S1 Whisper 转写 | `asr.vue` 仅 Web Speech API 实时麦克风，无文件/离线/字幕路径 | ✅ 新增（已实现） |
| S2 Voxtral 实时字幕 | 与 S1 同族 | 🔀 并入 S1 |
| S3 Kokoro 浏览器 TTS | `tts.vue` + `tts.post.ts`（edge-tts）已完成文本→语音 | ❌ 重叠，不重复造轮子 |
| S4 情感识别 | YAMNet 标签无情感维度 | ✅ 新增 |
| S5 VAD | 代码无静音检测 | ✅ 新增 |
| S6 音高检测 | 无 F0 代码 | ✅ 新增 |
| S7 可视化 | 无波形/频谱组件 | ✅ 新增（组件） |
| S8 RVC 变声 | voice-clone 只有"参考+文本→合成"，无"音频→换声" | ✅ 新增 |
| S9 说话人分离 | 无 diarization | ✅ 新增 |
| S10 降噪 | Demucs 是分轨，非噪声抑制 | ✅ 新增 |
| S11 文生音乐 | 无音频生成 | ✅ 新增 |
| S12 音频转 MIDI | 无 | ✅ 新增 |
| S13 语音翻译 | 无 | ✅ 新增 |
| S14 口型同步 | 无 | ✅ 新增 |
| S15 歌声合成 | 无歌声合成 | ✅ 新增 |

**结论：15 候选 → 剔除 S3、合并 S2 → 13 个真正新增**（TTS 与 Whisper 是逆任务，不重叠）。

---

## 0.1 实现进度

**2026-08-11 全部完成**：语音类别 15 个候选功能中 12 个已实现并验证（全部带「Python 最简实现」面板），2 个受限（S8 RVC / S15 歌声：需 MSVC 编译工具或 GPU+声库，已注册/说明），1 个合并（S2 并入 S1）。

- ✅ **S1 Whisper 离线转写已实现（2026-08-11）**：`app/pages/speech/asr.vue` 新增"文件转写"模式（模型 tiny/base/small、语言、转写/翻译、q8/fp32、WebGPU→WASM 回退、进度条、导出 TXT/SRT），已端到端验证通过。
- ✅ **S4 语音情感识别已实现（2026-08-11）**：pp/pages/speech/emotion.vue（录音/上传 → wav2vec2 SER 模型 → 情感概率条，transformers.js + WebGPU/WASM 回退），端到端验证通过（中文测试音频 → 开心 54.5%）。
- ✅ **S6 实时音高检测已实现（2026-08-11）**：pp/pages/speech/pitch-detector.vue（Web Audio + 自实现 YIN 算法，实时音高/音名/音分 + 曲线），YIN 单元测试 6/6 频率精确通过。
- ✅ **S1 Python 示例已添加（2026-08-11）**：python/speech/asr/main.py（faster-whisper 文件转写 + TXT/SRT 导出，供对照展示），demos.ts 注册 pythonModule: 'speech/asr'，ASR 页面底部自动出现「Python 最简实现」面板。
- ✅ **S10 音频降噪增强已实现（2026-08-11）**：python/speech/denoise/（DeepFilterNet3，异步队列 denoise-queue.ts + API + 页面 denoise.vue 原/增强对比播放），CPU 端到端验证通过（带噪音频 → 增强 wav 1.2MB）。含 Python 最简实现面板。
- ✅ **S5 语音活动检测已实现（2026-08-11）**：python/speech/vad/（Silero VAD，异步队列 + API + 页面 ad.vue 时间轴可视化），验证通过（中文音频 → 2 个语音段，语音 5.56s/总 6.34s）。含 Python 最简实现面板。
- ✅ **S11 文生音乐已实现（2026-08-11）**：python/speech/musicgen/（MusicGen-small，**常驻 worker** musicgen-queue.ts 模型只加载一次 + API + 页面 musicgen.vue 提示词/示例/时长/播放下载），端到端验证通过：首次 100s（含模型加载）、**第二次 25s 无加载等待（worker 复用）**。含 Python 最简实现面板。注意：模型 Meta 非商用许可，页面已标注。
- ✅ **S9 会议纪要已实现（2026-08-11）**：python/speech/meeting/（faster-whisper 转写 + WeSpeaker 说话人分离 + 合并标注，异步队列 + 页面 meeting.vue 分段列表/导出），验证通过（中文音频 → SPEAKER_0 标注）。含 Python 最简实现面板。踩坑：wespeaker 需 git 安装、UMAP/HDBSCAN 与 sklearn 版本冲突（统一升级）、diarize 返回 (utt,start,end,label) 元组。
- ✅ **S7 音频可视化已实现（2026-08-11）**：pp/pages/speech/visualizer.vue（wavesurfer.js CDN 动态加载，波形 + 频谱图 + 播放控制），验证通过。含 Python 最简实现面板（librosa 提取波形/频谱数据）。
- ✅ **S12 音频转 MIDI 已实现（2026-08-11）**：python/speech/midi/（Spotify basic-pitch 多乐器转录，异步队列 + 页面 midi.vue 乐器选择/下载），验证通过（和弦音频 → MIDI 文件）。含 Python 最简实现面板。踩坑：hf-midi-transcription 与 huggingface_hub/模型不兼容 → 换 basic-pitch；新版 predict_and_save 需显式模型路径；跨盘 os.replace 失败 → shutil。
- ✅ **S13 语音翻译已实现（2026-08-11）**：python/speech/speech-translate/（faster-whisper task=translate，异步队列 + 页面），验证通过（中文 → 英文）。含 Python 最简实现面板。
- ✅ **S14 口型同步已实现（2026-08-11）**：python/speech/lip-sync/（Wav2Lip-GAN，权重从 HF 镜像下载 wav2lip_gan.pth + s3fd.pth，异步队列 + 页面 上传视频+音频），验证通过（Lena 测试视频 → 同步视频）。含 Python 最简实现面板。踩坑：librosa API 变更 patch、ffmpeg 分支 Windows shell 问题（预转 wav）。
- ⚠️ **S8 RVC 变声受限（2026-08-11）**：python/speech/voice-convert/ 依赖 fairseq（需 MSVC 编译工具，本机缺失）；seed-vc 依赖链在无编译环境安装失败。标注为受限，Python 示例保留。
- ⚠️ **S15 歌声合成受限（2026-08-11）**：DiffSinger 需 GPU + 声库训练数据（本机无 GPU）；注册为 planned + Python 示例（python/speech/singing/main.py 说明）。
- ✅ **S4/S6 Python 示例已添加（2026-08-11）**：python/speech/emotion/main.py（wav2vec2 情感分类）、python/speech/pitch-detector/main.py（librosa PYIN 音高检测），均已注册 pythonModule，两个页面底部出现「Python 最简实现」面板。
- 🔧 **S1 修复记录（2026-08-11，对照 python-tool-integration 验收标准）**：
  - 本地模型路径 404 噪音：加载 whisper 时临时 `env.allowLocalModels=false`（本地无 whisper 模型，避免先探测 public/model 再回退）
  - 语言默认 `auto` → `chinese`（WebGPU 下自动检测回退英文，导致中文被跳过）+ 帮助文案提示
  - 默认模型 tiny → base（中文识别更准）+ modelHelp 文案
  - 进度条显示具体下载文件名；离开页面 `onBeforeUnmount` 取消转写
  - 结果区提示"Whisper 中文输出可能为繁体（模型特性）"
  - 顺手修复项目原有 `DemoRunner.vue` 的 `i-lucide-alert-triangle`（lucide 已改名 triangle-alert）

---## 1. 现状（已有 5 个语音 demo）

| demo | 实现 | 说明 |
|---|---|---|
| TTS | 🐍 Python (edge-tts) | 文本转语音（云端微软接口） |
| ASR | 🖥 浏览器 (Web Speech API) | 仅实时麦克风、依赖浏览器/网络 |
| 音频分类 | 🖥 浏览器 (MediaPipe + YAMNet) | 声音事件分类 |
| 音频分离 | 🐍 Python (Demucs) | 人声/伴奏分离 |
| 声音克隆 | 🐍 Python (XTTS-v2) | 参考录音克隆音色 + 合成任意文本 |

**缺口**：无文件型离线转写、无浏览器原生 TTS、无情感/说话人/增强/生成类音频功能。

---

## 2. 调研发现：浏览器端可实现（WebGPU/WASM/Web Audio）

### S1. Whisper 离线转写（升级现有 ASR）⭐ P0
- **方案**：transformers.js + `Xenova/whisper-small`（或 tiny 更快）；参考 [xenova/whisper-web](https://github.com/xenova/whisper-web)（3.3k★）、[whisperweb.dev](https://whisperweb.dev)。
- **能力**：文件/拖拽（MP3/WAV/M4A/视频抽音）、100+ 语言自动检测、WebGPU 加速、离线可用、导出 TXT/SRT/VTT。
- **体积**：tiny ~40MB / small ~460MB（按需选择，缓存后离线）。
- **评估**：✅ 浏览器完全可做；与现有 Web Speech API 实时模式并存（实时→网页 API，文件→Whisper）。

### S2. 实时流式 ASR（Voxtral）⭐ P0（亮点）
- **方案**：Mistral **Voxtral-Mini-4B-Realtime** 已支持 transformers.js + WebGPU，**<500ms 延迟**、13 种语言、本地实时字幕；官方 demo：[mistralai/Voxtral-Realtime-WebGPU](https://huggingface.co/spaces/mistralai/Voxtral-Realtime-WebGPU)（2026 年新能力）。
- **评估**：✅ 浏览器可做；4B 模型偏大（需 WebGPU + 足够显存/内存），作为"实时字幕"增强，可先做 S1、S2 视硬件情况列为可选。

### S3. Kokoro 浏览器 TTS ⭐ P0
- **方案**：[kokoro-js](https://www.npmjs.com/package/kokoro-js)（Apache-2.0，周下载 12.7 万）+ `onnx-community/Kokoro-82M-v1.0/v1.1-ONNX`，transformers.js 全本地合成，支持 WebGPU/WASM、流式输出。
- **亮点**：**82M 参数极小**；官方 VOICES.md 显示支持美式/英式英语、**普通话（4 女 4 男）**、日语、西/法/印/意/葡语；中文 fork [`@uzen/kokoro-js`](https://github.com/uzen-zone/kokoro-js) 支持普通话 + 中英混读（v1.1-zh 模型）。
- **对比现有 TTS**：edge-tts 是云端、需联网；Kokoro 全本地、离线、隐私好 → 与现有 Python TTS 互补，可做一个"浏览器离线 TTS"新 demo。

### S4. 语音情感识别（SER）⭐ P1
- **方案**：transformers.js + `onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX`（已转 ONNX，浏览器可直接跑）。
- **能力**：录音/文件 → 情绪标签（angry/happy/sad/neutral…）+ 概率条。
- **评估**：✅ 浏览器可做，模型小；也可用 Python（r-f/wav2vec-english-SER，Wav2Vec2 XLSR）。

### S5. 语音活动检测（Silero VAD）⭐ P1（支撑性）
- **方案**：Silero VAD（ONNX，~2MB）浏览器运行；为 ASR 预切分语音段、跳过静音，提升转写体验（实时字幕/录音降噪前置）。
- **评估**：✅ 浏览器可做，纯支撑功能，可并入 ASR 页面或作为独立小 demo。

### S6. 实时音高检测/练声工具 ⭐ P1
- **方案**：Web Audio API + [`pitchfinder`](https://github.com/peterkhayes/pitchfinder)（YIN/McLeod/AMDF）或 [`@audio/pitch`](https://github.com/audiojs/pitch)（YIN/pYIN/HPS/SWIPE，还带 chroma/chord/key）。
- **能力**：麦克风实时显示音高（Hz/音名）、波形、可做"练声/乐器调音"趣味 demo。
- **评估**：✅ 纯浏览器，无模型依赖，轻量好玩。

### S7. 音频可视化（wavesurfer.js）⭐ P1（体验增强）
- **方案**：[wavesurfer.js](https://github.com/katspaugh/wavesurfer.js)（10.3k★）：波形/频谱图/选区/录音插件，TypeScript。
- **用途**：给所有语音 demo（TTS/克隆/分离/生成）统一加波形 + 播放进度 + 区域选择，专业感大幅提升。
- **评估**：✅ 纯前端库，建议作为语音类别的基础组件先落地。

---

## 3. 调研发现：Python 后端实现（浏览器做不了/效果差）

### S8. RVC 变声（Retrieval-based Voice Conversion）⭐ P0
- **方案**：[RVC-Project](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion)（609★，MIT）/ [rvc-python](https://github.com/daswer123/rvc-python)（153★，API 模式）。
- **能力**：把已有音频/歌声换成目标音色（上传 .pth 模型 + .index）；支持 CPU/GPU，实时延迟 90-170ms（ASIO）；可用 ≥10 分钟音频训练自己的模型（远期）。
- **与现有 voice-clone 区别**：XTTS-v2 是"参考音色 + 合成文本"；RVC 是"任意音频换声/翻唱" → 强互补。
- **评估**：⚠️ CPU 可跑（推理轻），模型训练重（GPU 更佳）；先做推理（换声），训练作为远期。

### S9. 说话人分离 + 会议纪要 ⭐ P1
- **方案**：WhisperX/Whisper（转写）+ [pyannote.audio](https://github.com/pyannote)（diarization）+ 现有 summarization（摘要）。
- **参考架构**：[sergiopesch/diarization-demo](https://github.com/sergiopesch/diarization-demo)：Next.js 前端 + Python worker（WhisperX + pyannote，CPU 用 tiny）。
- **注意**：pyannote 模型在 HF 需同意许可 + access token（gated）；CPU 上 small 模型可用。
- **替代**：[WeSpeaker](https://github.com/wenet-e2e/wespeaker)（1.3k★，Apache-2.0）自带 embedding/similarity/diarization，且有中文预训练模型，Apache 许可更宽松 → 优先推荐。
- **产出**：分段对话 → 说话人标注 → 摘要 → 会议纪要 Markdown 下载。

### S10. 音频降噪/增强（DeepFilterNet）⭐ P0/P1
- **方案**：[DeepFilterNet](https://ieeexplore.ieee.org/document/9747055/)（RTF 0.19，单线程 CPU 即可实时）；备选 RNNoise（更快）/ Facebook Denoiser；整合 CLI：[denoise-audio](https://github.com/Surya-Rayala/denoise-audio)。
- **能力**：上传嘈杂音频 → 降噪增强 → 对比播放/下载；可作 ASR 前置。
- **与现有 separation 区别**：Demucs 分离"人声 vs 伴奏"；DeepFilterNet 是"噪声抑制/语音增强" → 互补。
- **评估**：✅ CPU 完全可行，模型小，值得 P0。

### S11. 文生音乐/音效（AudioCraft）⭐ P0
- **方案**：Meta [AudioCraft](https://ai.meta.com/resources/models-and-libraries/audiocraft)：MusicGen（文本→音乐）+ AudioGen（文本→音效）+ EnCodec。
- **评估**：✅ CPU 可跑 small/medium（1.5GB 级）；⚠️ 许可：MusicGen 为 Meta 非商用许可（演示/学习 OK），需在页面标注。
- **产出**：描述词 → WAV/MP3 播放下载；参数：时长、温度、top-k。

### S12. 音频转 MIDI（MuScriptor）⭐ P1
- **方案**：[MuScriptor](https://github.com/muscriptor/muscriptor)（Kyutai×Mirelo，首个大规模多乐器转写模型，170k 歌曲训练；small 103M / medium 307M）。
- **注意**：HF gated + CC BY-NC 4.0（需免费 HF token + 同意许可）。
- **备选**：hf-midi-transcription（sax/bass/guitar/piano 单乐器，MIT）。
- **产出**：上传音频 → MIDI 文件下载 + 可选的音符可视化。
- **评估**：✅ CPU 可跑 small；新颖度高（音乐类 demo 加分）。

### S13. 语音翻译（SeamlessM4T）⭐ P2
- **方案**：Meta [SeamlessM4T](https://github.com/facebookresearch/seamless_communication)：语音→文本/语音、文本→语音/文本，多语种全合一。
- **评估**：⚠️ 2.3B 模型，CPU 慢、内存吃紧（16GB 勉强）；列为 P2/远期。

### S14. 视频口型同步（Wav2Lip）⭐ P2
- **方案**：[Wav2Lip](https://huggingface.co/Nekochu/Wav2Lip)：视频 + 音频 → 嘴型同步视频；CPU 可跑短片段（<60s、≤720p）。
- **评估**：⚠️ 研究许可（非商用），且属视频类，放语音/视频交界，P2。

### S15. 歌声合成（DiffSinger）⭐ P2
- **方案**：[openvpi/DiffSinger](https://github.com/openvpi/DiffSinger)：歌声合成（44.1kHz，中文社区活跃，需声库训练数据）。
- **评估**：⚠️ 上手门槛高（需声库/标注）；作为"唱歌"demo 远期可选。

---

## 4. 优先级路线图（语音类别）

### 第一批（P0 · 快见效 · 3-5 天）
| # | 功能 | 实现 | 理由 |
|---|---|---|---|
| S3 | **Kokoro 浏览器离线 TTS**（中/英多音色） | 🖥 | 82M 极小、全本地、Apache 许可、中文可用，与现有 edge-tts 互补 |
| S1 | **Whisper 离线转写**（升级 ASR：文件+字幕导出） | 🖥 | 成熟方案（whisper-web），补足现有 ASR 只能实时麦克风 |
| S8 | **RVC 变声**（任意音频换音色） | 🐍 | 与声音克隆互补，翻唱/换声演示效果好，CPU 可推理 |
| S11 | **文生音乐/音效**（MusicGen/AudioGen） | 🐍 | CPU 可跑，演示效果炸裂，注意非商用许可标注 |
| S10 | **音频降噪增强**（DeepFilterNet） | 🐍 | 模型小、CPU 实时，与分离互补 |

### 第二批（P1 · 进阶 · 3-4 天）
| # | 功能 | 实现 | 理由 |
|---|---|---|---|
| S7 | **wavesurfer.js 音频可视化**（波形/频谱/选区） | 🖥 | 所有语音 demo 的基础体验组件 |
| S4 | **语音情感识别 SER** | 🖥 | ONNX 模型现成，浏览器直跑 |
| S6 | **实时音高检测/练声** | 🖥 | 纯 Web Audio，轻量有趣 |
| S9 | **说话人分离 + 会议纪要** | 🐍 | WeSpeaker/pyannote + 现有摘要，产出实用 |
| S12 | **音频转 MIDI**（MuScriptor） | 🐍 | 音乐类新 demo，新颖 |
| S5 | **VAD 语音活动检测** | 🖥 | 支撑 ASR 体验，可并入 |

### 第三批（P2/远期）
| # | 功能 | 实现 | 说明 |
|---|---|---|---|
| S2 | Voxtral 实时流式字幕 | 🖥 | 4B 模型，需 WebGPU 强机 |
| S13 | SeamlessM4T 语音翻译 | 🐍 | 2.3B，CPU 慢 |
| S14 | Wav2Lip 口型同步 | 🐍 | 研究许可 + 视频类 |
| S15 | DiffSinger 歌声合成 | 🐍 | 需声库训练，门槛高 |

---

## 5. 架构与实现要点

- **浏览器功能**：新增页面 + `app/utils/demos.ts` 注册 + i18n；transformers.js 动态加载（模型从 HF CDN），WebGPU 优先、WASM 兜底；生产部署需 COOP/COEP 头。
- **Python 功能**：按 `python-tool-integration` skill 脚手架生成 `python/speech/<slug>/` + `server/utils/<slug>-queue.ts`（常驻 worker、进度、取消），参考 `voice-clone`。
- **模型许可清单**（页面标注）：Kokoro Apache-2.0 ✅ / Whisper MIT ✅ / RVC MIT ✅ / DeepFilterNet MIT ✅ / WeSpeaker Apache-2.0 ✅ / MuScriptor CC BY-NC ⚠️ / MusicGen Meta 非商用 ⚠️ / pyannote gated ⚠️。
- **模型体积预估**：Kokoro ~100MB、Whisper tiny 40MB / small 460MB、RVC ~100-500MB/模型、MusicGen-small ~1.5GB、DeepFilterNet ~10-50MB、WeSpeaker ~100MB、MuScriptor-small ~400MB。
- **中文乱码**：worker.py 必须 `reconfigure(encoding="utf-8")`；模型下载可用 `HF_ENDPOINT=https://hf-mirror.com`。

---

## 6. 建议

1. **先做 S3（Kokoro TTS）+ S1（Whisper 转写）**：纯浏览器、Apache/MIT 许可、当天见效，且直接补齐"浏览器离线语音"短板。
2. **接着 S8（RVC）+ S10（降噪）+ S11（音乐生成）**：三个 Python 后端功能复用同一套队列架构，工作量可控。
3. **S7（可视化）作为基础组件**尽早引入，后续所有语音 demo 复用。
4. 会议纪要（S9）建议放到 Phase 3，与 NLP 摘要联动。

> 下一步：确认从哪些功能开始实现（默认建议 S3 + S1 先行）。
