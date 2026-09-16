# 语音信息架构重构（Speech IA Refactor）—— 与视觉侧对齐

> 状态：**实施中**（2026-09-15）。本文是逐引擎实现的唯一事实来源 + 验收口径。
> 对照文档：`.trae/documents/vision-ia-refactor-plan.md`（视觉侧同名重构，已完成）。

## 1. 问题（为什么要动）

视觉侧已经完成「注册表 + 通用 playground + 能力×引擎双轴 + 多归属」：24 个入口 / 105 个工具
由 `vision/[slug].vue`（59 行）＋ `ImagePlayground.vue` 一份组件驱动，4 个页面文件共 1253 行。

语音侧相反：**17 个手写页面 / 5619 行**，零注册表、零通用 playground，`ToolSidebar` 全仓库只有视觉在用。
具体症状：

| 症状 | 证据（实测计数） |
|---|---|
| 麦克风 + `createScriptProcessor` 样板复制 | ×4（audio-classifier / emotion / hum-to-notes / pitch-detector） |
| `new MediaRecorder` 录音样板复制 | ×3（speech-translate / voice-clone / voiceprint） |
| YIN 音高算法两份实现 | ×2（pitch-detector 页面内自建 + `utils/pitch.ts`） |
| WAV 编码两份、且负半周缩放不一致 | ×2（`kokoro.ts` / `voice-clone.vue`） |
| WAV 解码+重采样两份（一份到 48k） | ×2（`utils/audio.ts` / `voice-clone.vue`） |
| 模型下载进度回调样板复制 | ×7 |
| Web Speech API 启动样板复制 | ×3（asr / speech-rate / voice-command） |
| 公共 i18n 串散落在无关页面 | `asr.start` 被 6 个页面引用、`emotion.recordStart` 被 5 个引用 |

**最有价值的一条**：「同一任务的多实现」已经存在，但只以页面内 `mode`/`engine` ref 的形式存在，
无法对比、无法复用：
- `asr.vue`：`mode: 'live' | 'file'` = Web Speech API vs 本地 Whisper
- `tts.vue`：`engine: 'kokoro' | 'edge'` = 本地合成 vs 服务端合成
这两个恰好就是视觉侧「能力页」想表达的东西。

## 2. 目标 IA

### 2.1 页面表（v1）

| slug | 类型 | 侧栏分组依据 | 工具 |
|---|---|---|---|
| `asr` | 能力页 | 按**引擎** | `webspeech-live`(Web Speech API)、`whisper-transcribe`(Whisper) |
| `whisper` | 引擎页 | 按**任务族** | `whisper-transcribe`、`whisper-translate` |
| `tts` | 能力页 | 按**引擎** | `edge-tts`(Edge 服务端)、`kokoro-synthesize`(Kokoro 本地) |
| `kokoro` | 引擎页 | 按**任务族** | `kokoro-synthesize` |
| `audio-classification` | 能力页 | 按**引擎** | `yamnet-classify`(MediaPipe)、`speech-emotion`(Transformers.js) |
| `yamnet` | 引擎页 | 按**任务族** | `yamnet-classify` |

被吸收并删除的页面：`asr.vue`、`tts.vue`、`audio-classifier.vue`、`emotion.vue`。
301：`/speech/audio-classifier` → `/speech/audio-classification`、`/speech/emotion` → `/speech/audio-classification`。

### 2.2 保留为专用页（**不**进注册表）及理由

| 页面 | 理由 |
|---|---|
| `audiobook` | 多步流程（解析剧本 → 选角 → 逐句合成 → 拼接），且依赖右侧「选角表」交互 |
| `voice-clone` | 输入是**文本 + 参考音**两种模态的组合，且第 2 步依赖第 1 步的说话人嵌入 |
| `speech-translate` | 三段级联（Whisper → opus-mt → Kokoro），不是「一个任务的多种实现」 |
| `voiceprint` | 注册/识别跨调用共享 localStorage 声纹库，右栏是状态化资产 |
| `pitch-detector`、`hum-to-notes`、`visualizer`、`voice-changer`、`metronome`、`mini-synth` | 实时仪表/乐器：打开即持续运行，不存在「引擎」维度 |
| `speech-rate`、`voice-command` | Web Speech 的特定用法（计时统计 / 关键词驱动动画），并页会牵强 |

这些页面**保留自身 UI**，但必须改用 §3 的公共 composable（消除 §1 的重复）。
`metronome` / `mini-synth` 这类本来就没有「第二个实现」的页面**不设左栏**——左栏是「多实现/多任务」的载体，
硬塞进去只是空壳。

### 2.3 与视觉侧的关键差异（决定了 AudioPlayground 的形状）

视觉侧所有工具都是 `run(ImageData, params)`：统一输入、纯函数、无状态，所以能塞进一个 playground。

语音侧输入有**三种互不兼容的模态**，必须由工具声明：

- `file`：音频文件 → 16kHz 单声道 `Float32Array`
- `text`：文本（TTS）
- `live`：麦克风实时

而 `live` 又分两类，必须分开建模（混成一个接口会逼出一堆 `if (kind === 'web-speech')`）：

- `live.mode === 'frames'`：模型逐帧吃样本（YAMNet、wav2vec2）→ playground 开麦喂帧
- `live.mode === 'session'`：识别由浏览器自己驱动、**没有样本可喂**（Web Speech API 只有 `onresult`）→ 工具自管会话

## 3. 已落地的公共层（复用，不要重写）

| 文件 | 内容 | 替代了 |
|---|---|---|
| `app/utils/audio-tools.ts` | `AudioTool` / `AudioToolContext` / `AudioToolResult` / `AudioLiveSpec` 类型 + 注册表聚合 + `audioPageSamples` | — |
| `app/utils/localized.ts` | `LocalizedText` / `LocalizedParamSpec` / `pickText` / `buildParamSpecs`（从 image-tools 抽出） | 视觉/语音共用同一套数据模型 |
| `app/utils/audio-progress.ts` | `parseDownloadProgress()` | transformers 进度样板 ×7 |
| `app/utils/wav.ts` | `encodeWav()` / `downloadBlob()` / `formatClock()` | WAV ×2、下载 ×5、mm:ss ×2 |
| `app/utils/audio.ts` | `decodeAudio()` / `decodeToRate()` / `decodeTo16k()` / `AUDIO_ACCEPT` | 解码重采样 ×2、accept 串 ×6 |
| `app/composables/useMicStream.ts` | 开麦 + 16kHz + 4096 帧回调 + 卸载 teardown | 麦克风样板 ×4 |
| `app/composables/useRecorder.ts` | MediaRecorder → File + 秒表 | 录音样板 ×3 |
| `app/composables/useAudioSource.ts` | 文件/示例 + objectURL 生命周期 + 解码缓存 + 时长 | 输入样板 ×8 |

## 4. 逐引擎实现要求（并行任务）

**通用硬性规则**（违反会导致 lint/typecheck 失败）：

1. 只创建/修改你被指定的那个文件。**不要**改 `audio-tools.ts`、i18n、`demos.ts`、`nuxt.config.ts`（其余批次统一处理）。
2. 行为必须与源页面**逐项等价**：模型 id、dtype、device 回退、滑窗参数、阈值默认值都不能改。这是搬移，不是重新设计。
3. 优先复用 §3 的 helper；`run` 收到的 `ctx.samples` 已是 playground 解码好的 16kHz 单声道，**不要再自己解码**。
4. `name` / `description` / 参数 `label`/`help` 用**内联** `{ zh, en }`，**不要**新增 i18n key。
5. `section` 只能使用下列 i18n key（由我统一添加）：
   - 引擎名（能力页用）：`speech.sections.webSpeech` / `whisper` / `kokoro` / `edge` / `mediapipe` / `transformers`
   - 任务族（引擎页用）：`speech.sections.transcribe` / `translate` / `synthesize` / `eventClassify` / `emotion`
   - 必须提供 `'*'` 兜底。
6. 结果行 label 用内联 `lang === 'zh' ? … : …`。
7. `live.frame` 无更新时**返回 `null`**（类型是 `AudioToolResult | null`，不是 `void`）。
8. 风格（项目 lint 很严，逐条对照）：
   - 每行最多 1 条语句（`@stylistic/max-statements-per-line`）
   - 内联对象类型成员用 `;` 分隔（`@stylistic/member-delimiter-style`）
   - `quote-props: consistent-as-needed`：**只要有 1 个键需要引号，同一对象所有键都要加引号**
   - 开启 `noUncheckedIndexedAccess`：下标访问得到 `T | undefined`，用 `?? 兜底`
   - 开启 `@typescript-eslint/no-explicit-any`：需要 `any` 时在文件首行加 `/* eslint-disable @typescript-eslint/no-explicit-any */`
   - 注释用中文，解释**为什么**（本仓库惯例：注释密度高、说明取舍）

**验收（每个实现者都要自己跑）**：

```bash
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd /Users/oldmoon/Documents/github/AI-Tech-Hub
pnpm exec eslint <你的文件>                      # 必须 0 error
pnpm nuxt prepare >/dev/null 2>&1
pnpm typecheck 2>&1 | grep -cE "error TS"         # 全仓库总数必须仍是 476（基线）
pnpm typecheck 2>&1 | grep "<你的文件>"           # 必须无输出
```

### 4.1 `audio-engines/whisper.ts` → `whisperAudioTools`

源：`app/pages/speech/asr.vue` 的「文件模式」半部分（脚本约 113–254 行、模板约 334–411 行）。

- 工具 1 `whisper-transcribe`：`pages: ['whisper', 'asr']`，`inputs: ['file']`，
  `section: { whisper: 'speech.sections.transcribe', asr: 'speech.sections.whisper', '*': 'speech.sections.transcribe' }`
- 工具 2 `whisper-translate`：`pages: ['whisper']`，`inputs: ['file']`，`section` 用 `speech.sections.translate`
- 两者用一个工厂函数生成（只差 `task`），体现「同引擎的两个任务」。
- 参数（内联 zh/en）：
  - `model` select：`Xenova/whisper-tiny`(~75MB 最快) / `whisper-base`(~145MB 均衡) / `whisper-small`(~460MB 更准)，默认 `Xenova/whisper-base`
  - `lang` select：auto/chinese/english/japanese/korean/french/german/spanish（默认 chinese；auto → 传 `undefined`）
  - `dtype` select：q8 / fp32，默认 q8
- `run` 逻辑（照搬 asr.vue）：
  - `setupTransformersEnv()` → `pipeline('automatic-speech-recognition', model, { dtype, device: preferredDevice(), progress_callback })`
  - 进度回调走 `parseDownloadProgress(p)` + `ctx.onProgress`
  - WebGPU 失败时回退 `device: 'wasm'` 重建 pipeline（`preferredDevice()` 来自 `~/utils/transformers`）
  - 调用 `transcriber(ctx.samples, { language, task, chunk_length_s: 30, stride_length_s: 5, return_timestamps: true })`
  - 每个耗时步骤前检查 `ctx.isCancelled?.()`
- 返回：`{ text, segments, device, info }`；`segments` 来自 `output.chunks[].timestamp`（`[start, end]`，缺省 0）

### 4.2 `audio-engines/kokoro.ts` → `kokoroAudioTools`

源：`app/pages/speech/tts.vue` 的 Kokoro 分支 + `app/utils/kokoro.ts`。

- 工具 `kokoro-synthesize`：`pages: ['kokoro', 'tts']`，`inputs: ['text']`，
  `section: { kokoro: 'speech.sections.synthesize', tts: 'speech.sections.kokoro', '*': 'speech.sections.synthesize' }`
- 参数：
  - `voice` select（**分组**用 `options: ParamOption[][]`，组标题用 `{ type: 'label', label }`），来源 `kokoroVoiceGroups` + `kokoroVoices`（`~/utils/kokoro`）
  - `speed` slider 0.5–2.0 step 0.05 默认 1
- `run`：`loadKokoroModel(onProgress)` → `kokoroSynthesize(text, voice, speed, onProgress)`，
  `ctx.text` 为空时返回一条 info 提示（类似 tts.vue 的 `tts.emptyText`）。
- 返回：`{ audio: { blob, filename: 'kokoro-tts.wav' }, device, info }`（`info` 里给耗时 ms）

### 4.3 `audio-engines/mediapipe.ts` → `mediapipeAudioTools`（YAMNet）

源：`app/pages/speech/audio-classifier.vue` **全文**（含文件滑窗与实时两半）。

- 工具 `yamnet-classify`：`pages: ['yamnet', 'audio-classification']`，`inputs: ['file', 'live']`，
  `section: { yamnet: 'speech.sections.eventClassify', 'audio-classification': 'speech.sections.mediapipe', '*': 'speech.sections.eventClassify' }`
- 参数：`maxResults`（slider 1–10 默认 5）、`scoreThreshold`（slider 0–1 step 0.01 默认 0.3）——沿用源页面的默认值
- 模型/资源：沿用源页面用的 `mediapipeModels.audioClassifier` / `mediapipeWasm.audio`（`~/utils/mediapipe`）与 `AudioClassifier.createFromOptions`
- `run`（文件）：整段 1s 窗口 / 0.5s 步进逐段 `classify(slice, 16000)`，收集 top 命中；每片前查 `isCancelled`
- `live`：`mode: 'frames'`；`prepare` 里创建分类器；`frame(samples)` 里 `classify(samples, 16000)`，
  返回 top 类别；无结果返回 `null`

### 4.4 `audio-engines/transformers.ts` → `transformersAudioTools`（语音情绪）

源：`app/pages/speech/emotion.vue` **全文** + `app/utils/emotion-stream.ts`。

- 工具 `speech-emotion`：`pages: ['audio-classification']`，`inputs: ['file', 'live']`，
  `section: { 'audio-classification': 'speech.sections.transformers', '*': 'speech.sections.emotion' }`
- 模型：`onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX`，`pipeline('audio-classification', …)`，
  dtype/device 沿用源页面（含 webgpu → wasm 回退）
- `run`（文件）：沿用源页面的窗口策略（**以源页面为准**，不要发明新参数）
- `live`：`mode: 'frames'`，滑窗状态机复用 `utils/emotion-stream.ts`（3s 窗 / 1.5s 步进）
- 参数：沿用源页面已有的（dtype 等）

### 4.5 `audio-engines/web-speech.ts` → `webSpeechAudioTools`

源：`app/pages/speech/asr.vue` 的「实时模式」半部分（脚本约 16–111 行）。

- 工具 `webspeech-live`：`pages: ['asr']`，`inputs: ['live']`，
  `live: { mode: 'session', … }`，`section: { asr: 'speech.sections.webSpeech', '*': 'speech.sections.webSpeech' }`
- 参数：`lang` select（中文 zh-CN / English en-US / English en-GB / 日本語 ja-JP，默认 zh-CN）、
  `continuous` switch（默认 true）、`interimResults` switch（默认 true）、`maxAlternatives` slider 1–5 默认 1
- `live.session.supported()`：`window.SpeechRecognition || window.webkitSpeechRecognition` 存在性
- `live.session.start(ctx, emit)`：
  - 新建识别器，按 `ctx.params` 设置 lang/continuous/interimResults/maxAlternatives
  - 累积 `finalText`（**注意**：跨 `onresult` 累积，`start()` 时必须清零）
  - `emit({ text: finalText, info: [中间结果行] })`
  - `onerror` → `emit({ info: [{ label: 错误, value: e.error }] })`
  - 重复 `start()` 抛 `InvalidStateError`，需吞掉（源页面有注释说明）
- `live.session.stop()`：`recognition.stop()`

## 5. 实施记录（as-built，2026-09-15）

### 已落地

| 批 | 内容 | 文件 |
|---|---|---|
| 1 | 公共层：`localized.ts`（从 image-tools 抽出，视觉/语音共用）、`audio-progress.ts`、`wav.ts`、`audio.ts`(+`decodeToRate`…)、`useMicStream` / `useRecorder` / `useAudioSource` | 8 个新文件 + 改 `audio.ts`/`kokoro.ts`/`voice-clone.vue` |
| 2 | 注册表 `utils/audio-tools.ts` + 5 个引擎模块 | `audio-tools.ts` + `audio-engines/{web-speech,whisper,kokoro,mediapipe,transformers}.ts` |
| 3 | `AudioPlayground.vue`（自带页头，与 ImagePlayground 同构）+ `speech/[slug].vue` 分发 | 2 个新文件 |
| 4 | `demos.ts` 新增 `whisper` / `kokoro` / `yamnet` 引擎页条目，`audio-classifier`→`audio-classification` 升级为能力页，删除 `emotion` 条目；2 条 301；i18n `speech.sections.*` + `speech.playground.*` + `samples.speechZh` | `demos.ts` / `nuxt.config.ts` / `i18n/locales/{zh,en}.json` |
| 4 | 删除被吸收的 4 个页面 | `speech/{asr,tts,audio-classifier,emotion}.vue` |

**7 个注册表工具**：

| 工具 | pages | inputs | 引擎 |
|---|---|---|---|
| `webspeech-live` | asr | live | Web Speech API（session 模式） |
| `whisper-transcribe` | whisper, asr | file | Whisper |
| `whisper-translate` | whisper | file | Whisper |
| `kokoro-synthesize` | kokoro, tts | text | Kokoro |
| `edge-tts` | tts | text | Edge TTS（服务端） |
| `yamnet-classify` | yamnet, audio-classification | file, live | MediaPipe |
| `speech-emotion` | audio-classification | file, live | Transformers.js |

**双轴生效的实证**：`whisper-transcribe` 同时挂 `whisper` 与 `asr` 两页 —— 在 `/speech/asr` 能力页它与 `webspeech-live` 并列（两种实现 side-by-side），在 `/speech/whisper` 引擎页它与 `whisper-translate` 并列（同引擎两个任务）。同一份数据、两种视角，正是视觉侧 `face-detector` 的做法。

### 过程中发现并修掉的问题

1. **`ImagePlayground` 是自包含的**（自带页头 + `HowItWorksSection`，不由页面文件包壳）→ `AudioPlayground` 必须同构，否则页面看起来少一块。
2. **`LocalizedParamSpec.options` 只有平铺形式**，而 Kokoro/Edge 的音色选择器需要**分组**（几十到 300+ 个音色按语言分组）→ 扩成 `LocalizedParamOption[] | LocalizedParamOption[][]`，让 `buildParamSpecs` 正确透传；否则分组选项会被压平成 `label: undefined`（实现者报了这个问题，是真缺陷不是风格问题）。
3. **Web Speech 的「实时」与模型的「实时」不是一回事**：模型逐帧吃样本，而 Web Speech 只有 `onresult`、没有样本可喂 → `AudioLiveSpec` 拆成 `frames` / `session` 两种模式；并补 `onEnd` 回调，否则 `continuous=false` 时浏览器说完自行结束，界面会一直显示「聆听中」。
4. **删掉 `tts.vue` 一度让 Edge TTS 在 UI 上不可达**（服务端接口是好的，但入口没了）—— 这是本次自己制造的**功能回退**。修法不是保留旧页面，而是补上 `AudioTool.asyncParams`：Edge 的音色列表来自 `/api/speech/tts-voices`（322 个 voice，服务端缓存 12h），静态 `params` 装不下「选项要等接口」。修完 `/speech/tts` 能力页为 Kokoro + Edge 两个工具并列。
5. **`activateTool` 不能写成 `watch(..., { immediate: true })`**：那会在 setup 阶段同步执行，而它调用的 `resetRun()` 引用的 `result` / `liveHistory` 等 ref 还没初始化（TDZ）。改为 `watch(activeToolId, activateTool)` + `onMounted(activateTool)`。
6. **image-tools 的 re-export 会触发 Nuxt 自动导入重复警告** → 改为不 re-export，3 处引用方直接引 `~/utils/localized`。
7. **参数被搬错**（规范化比对手工核对更可靠）：实现者按我写错的 §4 数值实现了 YAMNet 阈值（`default 0.3`）与 Kokoro 语速步长（`0.05`），与源页面（`default 0` / `0.1`）不符 —— 阈值默认 0.3 会**把结果滤空**，属实质缺陷，已改回源页面数值。
8. **`image-tools.ts` 的 48 个错误、`cosineSimilarity` 重复导入警告均为改动前既有**（改动前后逐项计数核对过，不是本次引入）。

### 验收（全部实跑）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | **473**（改动前 476；差额来自删除 4 个旧页带走的既有错误，**无新增**） |
| `pnpm exec eslint`（全部改动/新增文件） | **0 error** |
| `pnpm check:i18n` | 894 处引用 / 716 key，en·zh 均在 |
| `pnpm build` | **EXIT=0**，264 MB（93.7 MB gzip） |
| 冒烟：6 个注册表页面 | 全部 **200**，SSR 里无「演示不存在」迹象（demo + 工具均已解析） |
| 冒烟：301 | `/speech/audio-classifier`、`/speech/emotion` → **301** `/speech/audio-classification` |
| 冒烟：其余 12 个专用页 | **12/12 均为 200**（未被本次重构破坏） |
| 冒烟：`/api/speech/tts-voices` | **200，返回 322 个音色**（真机取到，非兜底）→ `asyncParams` 路径可用 |
| `speech.sections.*` 引用完整性 | 模块引用的 10 个 key 在 zh/en **全部存在** |

### 批 5 完成记录（13 个专用页改用公共层）

| 页面 | 搬掉了什么 |
|---|---|
| `pitch-detector` | 自建 mic+ScriptProcessor → `useMicStream`；**删掉页内 60 行 YIN 副本**改用 `~/utils/pitch`（并给 `pitch.ts` 补了 `freqToNote`，音名仍复用 `freqToName`，避免第二份音名换算） |
| `hum-to-notes` | mic 采集 → `useMicStream`（YIN/切分算法逐行未改） |
| `visualizer` | 输入 → `useAudioSource`（含收敛掉两处 `initFile`、4 处 objectURL 样板）；`fmt` → `formatClock`；3 处硬编码中文错误 → `humanError`/`mediaError`；`accept` 串 → `AUDIO_ACCEPT` |
| `voice-changer` | mic 采集 → `useMicStream` 的 `onReady` 裸流模式（显式 `sampleRate: 48000`）；效果链拓扑与全部参数未动 |
| `voiceprint` | 录音 → `useRecorder`；输入 → `useAudioSource`；右栏声纹库（localStorage）未动 |
| `speech-translate` | 录音 → `useRecorder`；输入 → `useAudioSource`；三段级联未动 |
| `voice-clone` | 录音 → `useRecorder`；参考音输入 → `useAudioSource`；`decodeToRate`/`encodeWav` 保持 |
| `speech-rate` | Web Speech 样板 → `useSpeechRecognition`；秒表/CPM 算法未动 |
| `voice-command` | Web Speech 样板 → `useSpeechRecognition`；关键词表与角色动画未动（自动重启靠 `wantListening` + `onEnd`，不能靠 `listening`——composable 的 `onend` 先置 false 再回调） |
| `audiobook` | `fmt` → `formatClock`；下载样板 → `downloadBlob` |
| `metronome`、`mini-synth` | **按计划不改**（纯 Web Audio，没有上述任何样板） |

**重复样板清零**（`app/pages/speech/` 内实测）：`createScriptProcessor` 0 个文件、`new MediaRecorder` 0 个文件、`webkitSpeechRecognition` 0 个文件。

**新增公共件**：`useSpeechRecognition`（Web Speech 样板 ×3 收拢；`supported` 只能在 `onMounted` 后探测，否则 SSR/CSR 不一致）、`useMicStream` 增加 `onReady`（给需要自己掌控音频图的场景）。

### i18n 公共串收拢（完成）

`app/pages/speech/` 里对 `asr.*` / `emotion.*` 的**借用从 21 处降到 0 处**，全部落到 `speech.*`：
`start` / `stop` / `listening` / `unsupported` / `unsupportedRecognition` / `recordStart` / `recordStop` / `cancel` / `downloadingModel`（后 5 个为本次新增；`unsupportedRecognition` 保留了「不支持 SpeechRecognition」这条更具体的文案，没有降级成通用提示）。
独立 key 数因此从 716 降到 713（重复消除）。

**过程中又踩了一次同名 key 的坑**：`recordStart`/`recordStop` 在 `voiceClone` 命名空间里也有一对，`SearchReplace` 命中了那一处，把 `cancel`/`downloadingModel` 插进了 `voiceClone`。已发现并挪回 `speech`（用 `awk` 定位行号确认所属命名空间）。**教训：i18n 里插 key 必须先用命名空间内的相邻 key 做锚点，不能只靠 `"key": "value"` 两行。**

### 最终验收（批 5 全部实跑）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | **452**（本次会话开始前 **476**；净减 24，其中 16 条来自删除 `pitch-detector` 的 YIN 副本、5 条来自修掉 `speech-translate` 的既有类型问题、3 条来自删除 4 个旧页） |
| 语音模块类型错误 | **0**（`app/pages/speech/**`、`utils/pitch`、`utils/audio*`、`composables/use{Mic,Recorder,AudioSource,Speech}*` 全部干净） |
| `pnpm exec eslint`（本次全部新增/改动文件） | **0 error** |
| `pnpm check:i18n` | 894 处引用 / 713 key，en·zh 均在 |
| `pnpm build` | **EXIT=0** |
| 冒烟 | `/speech` 首页 + 18 个子页 **全部 200**，无「演示不存在」；2 条 301 正确；`/api/speech/tts-voices` 200 |
| 与本次无关的既有 lint 债务 | `useIframeLocale.ts`、`usePyodide.ts`（后者是更早阶段改的，本轮未触碰）——已用 `git status` 区分，不冒充为本轮产出 |

### 未完成（诚实清单）

1. **真机未验（唯一的实质缺口）**：麦克风权限链路、`frames` 模式实时分类、`session` 模式的 `onEnd` 复位、录音/下载/复制按钮、变声器换采样率后的听感、`pitch-detector` 由「设备默认采样率」改为固定 16k 后的音准观感 —— 都需要在浏览器里点一遍。本轮全部验证都是**静态的**（类型 + lint + SSR 冒烟 + 301 + 接口可用性）。各页实现者已各自列出「不等价之处」清单，集中在：`useMicStream` 固定的 `getUserMedia` 约束（新增了 AEC/NS）、`formatClock` 分钟不补零（与原来的 `00:12` 差一个前导零）、部分错误文案不再带「哪一步失败」前缀。
2. **`audioPageSamples` 只覆盖 4 页**（asr/whisper/audio-classification/yamnet）：`tts`/`kokoro` 是文本输入工具，本来不需要示例音频，**按设计如此**，不改。
3. **`asr.*` / `emotion.*` 命名空间里的死 key** 未删除（`asr.vue`/`emotion.vue` 已删，其中多数已无人引用）。`check:i18n` 只校验「被引用的 key 存在」，不检测未引用 key，所以它们不会报错；清理属可选收尾。
4. **各页模板里仍硬编码的 `accept` 串**（voiceprint / speech-translate / voice-clone 等）：与 `AUDIO_ACCEPT` 逐字相同，但改模板超出「只做被点名替换」的范围，实现者按规则未动。

### 关于「回退不了」的风险提示

仓库里有**大量未提交改动**（视觉侧重构 + P0–P3 优化都在工作区），因此 `git checkout <file>` 拿到的是**更早的历史版本**，不能用来撤销本次改动。批 2 的 5 个引擎模块之所以用「先写 stub 再并行实现」的方式推进，就是为了让 typecheck 全程可跑、问题能立刻定位。

## 6. 验收口径（后续批次沿用）

| 项 | 要求 |
|---|---|
| `pnpm typecheck` | 全仓库错误数 **476**（改动前基线，不得增加） |
| `pnpm exec eslint <改动文件>` | 0 error |
| `pnpm check:i18n` | 所有引用的 key 在 en/zh 均存在 |
| `pnpm build` | EXIT=0 |
| 冒烟 | `/speech/asr`、`/speech/tts`、`/speech/audio-classification`、`/speech/whisper`、`/speech/kokoro`、`/speech/yamnet` 均 200；两条 301 生效 |

## 7. 批 5：13 个专用页改用公共层（消重复）——**已完成**，实施结果见 §5 的「批 5 完成记录」

目标：把 §1 表里的重复样板从各页删掉，**页面行为与 UI 完全不变**。这是搬移，不是重设计。

### 7.1 三个公共件的用法（已就绪，先读再改）

| 公共件 | 替代的样板 | 关键约束 |
|---|---|---|
| `useMicStream()` | 开麦 + `AudioContext` + `ScriptProcessor` + teardown（×4） | `start({ onFrame })` 逐帧回调；**卸载自动 teardown**，各页自己那份 `stop()` 与 `onBeforeUnmount` 要删掉而不是留着 |
| `useRecorder({ namePrefix, onStop, onError })` | `MediaRecorder` + chunk 累积 + 秒表（×3） | `onStop` 收到的已是 `File`；秒表在 `seconds` |
| `useAudioSource({ defaultSampleUrl, onError })` | file ref + objectURL + 隐藏 input + `onFileChange` + `useSample`（×8） | `toSamples16k()` 自带解码缓存与时长；**objectURL 生命周期由它管**，不要再自己 `URL.createObjectURL/revokeObjectURL` |
| `useSpeechRecognition()` | Web Speech API 样板（×3） | `supported` 在 `onMounted` 后才可信（SSR 不能探测）；`onEnd` 必须接，否则 `continuous=false` 时界面卡在「聆听中」 |

另：`utils/wav.ts` 的 `encodeWav` / `downloadBlob` / `formatClock`、`utils/audio.ts` 的 `AUDIO_ACCEPT` / `decodeToRate` 也要复用。`useAudioSource` 已返回 `accept`。

### 7.2 逐页要求

| 页面 | 要替换掉什么 | 注意 |
|---|---|---|
| `pitch-detector.vue` | ①自建 mic+ScriptProcessor → `useMicStream`；②**页面内那份 YIN 实现（约 42–101 行的 `yinPitch`/`freqToNote`/`NOTE_NAMES`）删掉，改用 `~/utils/pitch`** | 必须确认 `utils/pitch.ts` 的导出能覆盖页面所需（缺什么就往 `pitch.ts` 补，不要在页面里再留一份） |
| `hum-to-notes.vue` | mic+ScriptProcessor → `useMicStream` | 它已经用 `utils/pitch`，不要动算法 |
| `visualizer.vue` | ①file/sample 输入 → `useAudioSource`；②`fmt(sec)` → `formatClock`；③3 处硬编码中文错误串 → 走 `humanError`/`mediaError` | wavesurfer 与 AnalyserNode 两条渲染路径**不要改**，只换输入与错误处理 |
| `voice-changer.vue` | mic 采集 → `useMicStream` 的 `onReady`（拿裸 `stream`+`audioCtx` 搭效果链） | 效果链与 teardown 逻辑不变；`useMicStream` 负责关流与关 context，页面不要再关一次。**它不喂帧，请显式传 `sampleRate: 48000`** —— `useMicStream` 默认 16kHz 是给语音分析模型用的，拿来放声音会明显发闷 |
| `voiceprint.vue` | ①录音 → `useRecorder`；②file/sample → `useAudioSource` | 右栏「声纹库」卡片（localStorage）**完全不动** |
| `speech-translate.vue` | ①录音 → `useRecorder`；②file/sample → `useAudioSource` | 三段级联（Whisper→opus-mt→Kokoro）逻辑不动 |
| `voice-clone.vue` | ①录音 → `useRecorder`；②参考音上传/示例 → `useAudioSource` | 它已改用 `decodeToRate`/`encodeWav`，别改回去 |
| `speech-rate.vue` | Web Speech 样板 → `useSpeechRecognition` | 计时/CPM 统计逻辑不动；`unsupported` 提示改用 `supported` |
| `voice-command.vue` | Web Speech 样板 → `useSpeechRecognition` | 关键词表与角色动画不动 |
| `audiobook.vue` | `mm:ss` 格式化 → `formatClock`；下载 → `downloadBlob` | 选角表与逐句合成逻辑不动 |
| `metronome.vue` / `mini-synth.vue` | **无需改动** | 纯 Web Audio，没有上述任何样板；不要为了「统一」而硬套 composable |

### 7.3 硬性规则

1. **只改你被指定的文件**。不要动 `audio-tools.ts`、`audio-engines/`、`AudioPlayground.vue`、i18n、`demos.ts`、`nuxt.config.ts`、其它页面。
2. **UI 与交互不得变化**：模板结构、文案 key、控件类型、默认参数都保持原样。
3. 删掉被替代的本地实现（`stop()`、`onBeforeUnmount`、`recordChunks`、`recordTimer`、自建 objectURL 等），**不要留着形成两份**。
4. 注释用中文解释**为什么换**（本仓库惯例），不要只写「改用 composable」。
5. 风格：每行最多 1 条语句；内联对象类型成员用 `,`；`quote-props: consistent-as-needed`（同对象有键要引号则全加）；`noUncheckedIndexedAccess` 下下标访问要 `?? 兜底`；需要 `any` 时文件首行加 `/* eslint-disable @typescript-eslint/no-explicit-any */`。

### 7.4 验收（每页都要自己跑）

```bash
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd /Users/oldmoon/Documents/github/AI-Tech-Hub
pnpm exec eslint <你的文件>                  # 必须 0 error
pnpm nuxt prepare >/dev/null 2>&1
pnpm typecheck 2>&1 | grep -cE "error TS"     # 全仓库总数必须仍是 473
pnpm typecheck 2>&1 | grep "<你的文件>"        # 必须无输出
```

