# 自然语言处理（NLP）信息架构重构

> 状态：**实施中**（2026-09-15）。本文是逐引擎实现的唯一事实来源 + 验收口径。
> 对照：`vision-ia-refactor-plan.md`（已完成）、`speech-ia-refactor-plan.md`（已完成）。

## 1. 审计结论（与视觉/语音对比）

NLP 的情况**与前两个分类都不同**，必须先说清：

| 维度 | 视觉 | 语音 | **NLP** |
|---|---|---|---|
| 页面文件 | 4 个 / 1253 行 | 17 个 → 14 个 | **3 个 / 317 行** |
| 分发器 | `vision/[slug].vue` 59 行 | `speech/[slug].vue` | **`nlp/[slug].vue` 193 行** |
| 统一注册表（带 `pages[]`） | 有 | 有（本轮新建） | **无** |
| 注册表分散程度 | 1 个聚合 + 5 个模块 | 1 聚合 + 6 模块 | **2 个按 slug 索引的 map，散在 2 个文件** |
| 左栏（ToolSidebar） | 有 | 有 | **无** |
| 能力×引擎双轴 | 有 | 有 | **无（一个任务只能属于一个页面）** |
| 执行层抽象 | `ImageTool.run` | `AudioTool.run` | **最成熟**（见下） |

**结论：NLP 的执行层是三者中最好的，信息架构是三者中最差的。**

好在哪里 —— `TransformersTextTaskConfig`（`utils/transformers.ts`）已经把任务**完整数据化**了：

```ts
{ task, model, inputs[], buildArgs(), callOptions(), params(), parseItems(), parseText(), examples[] }
```

`inputs` 连「textarea / text、默认值、placeholder 的 i18n key」都声明了，`parseItems/parseText` 连结果解析都声明了。
这比视觉的 `ImageTool` 走得更远（视觉的结果渲染还是 `#result` 手写）。

差在哪里 —— 两份注册表**按 slug 索引**：
- `utils/mediapipe-text.ts` → `textTasks: Record<string, TextTaskConfig>`（2 项）
- `utils/transformers.ts` → `transformersTextTasks: Record<string, …>`（5 项）

`nlp/[slug].vue` 靠 `onMounted` 动态 import + **隐式优先级**（「先查 MediaPipe，再查 Transformers」）来解析 slug。
后果：
1. **一个任务只能属于一个页面** → 无法「在同一页横向对比两个引擎的文本分类」，双轴不成立；
2. 结果渲染（两个大 `#result` 模板）与解析逻辑（`parseItems/parseText`）**分离**，前者在页面里手写；
3. 没有「一个引擎的全部任务」这个视角 —— 用户看不到「这 7 个任务其实都属于 Transformers.js」；
4. 8 个页面各是单功能页，没有左栏。

另：`MediaTextRunner.vue` / `TransformersTextRunner.vue` 与两份注册表**只被 `nlp/[slug].vue` 引用**（已 grep 确认），可自由重构。

### 诚实的保留意见

NLP 只有**一个真正的跨引擎重叠点**：文本分类（MediaPipe `bert_classifier.tflite` vs Transformers.js 情感分类）。
其余 7 个任务当前都只有单一实现。所以照搬双轴会产生 **7 个只有 1 个条目的能力页**。

这与语音侧我提过的「空壳」警告是同一类问题，但结论不同 —— 视觉侧的 `depth` 页今天也只有 1 条目，
它是**预留第 2 个实现的槽位**；NLP 的 `ner`/`qa`/`summarization` 同样成立（这些都是标准 NLP 任务，
第二实现（如 pipe 版、ONNX Runtime GenAI）是现实存在的）。因此**保留单条目能力页是可接受的**，
但引擎页是这次真正的价值所在（`/nlp/transformers` 一页切换 7 个任务）。

## 2. 目标 IA

### 2.1 页面表

| slug | 类型 | 侧栏分组依据 | 工具（引擎） |
|---|---|---|---|
| `text-classifier` | 能力页 | 按**引擎** | MediaPipe Bert + **Transformers 情感（新增）** |
| `language-detector` | 能力页 | 按**引擎** | MediaPipe（单实现，预留槽位） |
| `text-embedder` | 能力页 | 按**引擎** | Transformers（单实现） |
| `ner` | 能力页 | 按**引擎** | Transformers |
| `zero-shot` | 能力页 | 按**引擎** | Transformers |
| `summarization` | 能力页 | 按**引擎** | Transformers |
| `qa` | 能力页 | 按**引擎** | Transformers |
| `fill-mask` | 能力页 | 按**引擎** | Transformers |
| `mediapipe-text` | 引擎页（新增） | 按**任务族** | 文本分类、语言检测 |
| `transformers` | 引擎页（新增） | 按**任务族** | 情感、NER、零样本、摘要、问答、完形填空、文本嵌入 |

**8 个现有 URL 全部保留，无 301**（与语音侧「保留能力页 slug + 新增引擎页」同一手法）。

### 2.2 唯一的新实现

`text-classifier` 要成为真能力页，需要注册 Transformers.js 的情感分类：
- 模型 `Xenova/distilbert-base-uncased-finetuned-sst-2-english`（约 67MB，SST-2 二分类：POSITIVE / NEGATIVE）
- 在 `utils/transformers.ts` 的 `transformersModels` 里加一个 `sentiment` 键（**只加键，不动既有键**）
- 它的标签空间只有 2 类，而 MediaPipe Bert 的 `bert_classifier.tflite` 标签空间不同 —— **两者结果不可直接比较**，
  这正是能力页要暴露的教学点，必须写进 `howItWorks`。

## 3. 目标架构

```
app/utils/nlp-tools.ts              NlpTool 类型 + 统一注册表（adapter 层）
app/utils/nlp-engines/mediapipe.ts  2 个工具（改造自 utils/mediapipe-text.ts）
app/utils/nlp-engines/transformers.ts 7 个工具（改造自 utils/transformers.ts 的 transformersTextTasks + 新增情感）
app/components/NlpPlayground.vue    左栏 + 输入区 + 参数 + 通用结果渲染
app/pages/nlp/[slug].vue            分发（从 193 行瘦身为薄分发）
```

**设计要点：registry 是 adapter，不是重写。** 既有 `textTasks` / `transformersTextTasks` 的声明式配置
（`inputs` / `buildArgs` / `callOptions` / `params` / `parseItems` / `parseText` / `examples`）**继续保留并复用**，
`nlp-tools.ts` 在其上补 `pages[]` / `name` / `section`，并把 Runner 里的执行逻辑抽进 `run`。
这样风险最小：行为等价性由「复用原配置」保证，而不是靠人肉搬移。

## 4. 接口契约（已冻结在 `app/utils/nlp-tools.ts`）

```ts
type NlpEngine = 'mediapipe' | 'transformers'
type NlpPageSlug = 'text-classifier' | 'language-detector' | 'text-embedder' | 'ner'
  | 'zero-shot' | 'summarization' | 'qa' | 'fill-mask' | 'mediapipe-text' | 'transformers'

interface NlpInputSpec { key: string; labelKey: string; type: 'textarea' | 'text'; default?: string; placeholderKey?: string }
interface NlpResultItem { label: string; value?: string; score?: number }
interface NlpToolResult {
  items?: NlpResultItem[]        // 表格行；带 score(0..1) 时渲染进度条
  text?: string                  // 纯文本（摘要）
  info?: { label: string; value: string }[]
  headline?: { label: string; value: string }  // 大字指标（余弦相似度）
}
interface NlpToolContext {
  lang: 'zh' | 'en'
  values: Record<string, string>       // 输入框当前值（key → 文本）
  params: Record<string, number | string | boolean>
  onProgress?: (p: DownloadProgress) => void
  isCancelled?: () => boolean
}
interface NlpTool {
  id: string
  pages: NlpPageSlug[]
  name: LocalizedText
  description?: LocalizedText
  engine: NlpEngine
  section?: Record<string, string>
  inputs: NlpInputSpec[]
  params?: LocalizedParamSpec[]
  examples?: { labelKey: string; values: Record<string, string> }[]
  run: (ctx: NlpToolContext) => Promise<NlpToolResult>
}
```

### 4.1 逐模块实现要求

**通用硬性规则**（违反会导致 lint/typecheck 失败）：

1. **只创建/修改你被指定的那个文件**（除 §2.2 明确允许给 `transformersModels` 加键）。不要动 `nlp-tools.ts`、i18n、`demos.ts`、`NlpPlayground.vue`、`nlp/[slug].vue`。
2. **行为必须与源实现逐项等价**：模型 id、dtype、device 回退、默认值、解析逻辑都不能改。这是搬移。
3. **优先复用既有声明式配置**（`textTasks` / `transformersTextTasks`）：`run` 里直接调它们的 `buildArgs` / `callOptions` / `parseItems` / `parseText`，不要重写解析。
4. `name` / `description` 用**内联** `{ zh, en }`；输入框 label 继续用 `labelKey`（i18n key，**不要新建**，复用 `tf.*` 既有 key）。
5. `section` 只能使用下列 i18n key（由我统一添加）：
   - 引擎名：`nlp.sections.mediapipe` / `nlp.sections.transformers`
   - 任务族：`nlp.sections.classify` / `langDetect` / `embed` / `extract` / `summarize` / `answer` / `fill`
   - 每个工具都要有 `'*'` 兜底
6. 结果行 label 用内联 `lang === 'zh' ? … : …`。
7. 风格：每行最多 1 条语句；内联对象类型成员用 `,`；`quote-props: consistent-as-needed`；
   `noUncheckedIndexedAccess` 下下标访问要 `?? 兜底`；需要 `any` 时文件首行加 `/* eslint-disable @typescript-eslint/no-explicit-any */`。
   中文注释解释**为什么**。

**验收（每个实现者都要自己跑）**：

```bash
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd /Users/oldmoon/Documents/github/AI-Tech-Hub
pnpm exec eslint <你的文件>                  # 必须 0 error
pnpm nuxt prepare >/dev/null 2>&1
pnpm typecheck 2>&1 | grep "<你的文件>"       # 必须无输出
```

（全仓库基线数已被并行改动扰动，**以「你的文件 0 错误」为准**，不要试图复现某个总数。）

### 4.2 `nlp-engines/mediapipe.ts` → `mediapipeTextTools`（2 个工具）

源：`utils/mediapipe-text.ts` 的 `textTasks` + `components/MediaTextRunner.vue` 的执行逻辑。

| id | pages | section | 任务族 |
|---|---|---|---|
| `mediapipe-text-classify` | `['text-classifier', 'mediapipe-text']` | `{ 'mediapipe-text': 'nlp.sections.classify', 'text-classifier': 'nlp.sections.mediapipe', '*': 'nlp.sections.classify' }` | 文本分类 |
| `mediapipe-language-detect` | `['language-detector', 'mediapipe-text']` | `{ 'mediapipe-text': 'nlp.sections.langDetect', 'language-detector': 'nlp.sections.mediapipe', '*': 'nlp.sections.langDetect' }` | 语言检测 |

- `run`：从 `MediaTextRunner.vue` 抽出「按需创建任务实例（缓存）→ 调用 `classify`/`detect` → 归一化结果」。
  - 文本分类 → `items`（label = `categoryName`，score = `score`）
  - 语言检测 → `items`（label = `languageCode`，score = `probability`）
- `inputs`：单个 `{ key: 'text', labelKey: 'tf.inputText', type: 'textarea' }`。
  **注意：`tf.*` 命名空间里没有 text-classifier / language-detector 专用的 placeholder key，不要发明** ——
  这两个工具**省略 `placeholderKey`**（`NlpInputSpec.placeholderKey` 可选）。
- `examples`：复用 `nlp/[slug].vue` 里 `textSamples` 的例句 —— 分类工具用 `samples.exSentimentPos` /
  `exSentimentNeg` / `exTopicNews`（labelKey 即这三个 key），语言检测工具用 4 条多语言例句
  （`labelKey` 需要新建 `nlp.examples.*`，**这 4 个 key 由我统一添加**：`nlp.examples.en` / `zh` / `ja` / `fr`）。
- 模型名展示（教学模式）：沿用 `utils/mediapipe-text.ts` 里 `model` 字段的字符串，放进 `run` 返回的 `info` 里。
- **不要**删除 `utils/mediapipe-text.ts`（它仍是 `create` 工厂的来源，且出问题时可回退）

### 4.3 `nlp-engines/transformers.ts` → `transformersNlpTools`（7 个工具）

源：`utils/transformers.ts` 的 `transformersTextTasks` + `components/TransformersTextRunner.vue` + `pages/nlp/text-embedder.vue`。

6 个来自 `transformersTextTasks`，1 个是 text-embedder：

| id | pages | 任务族 section | 源 |
|---|---|---|---|
| `transformers-sentiment` | `['text-classifier', 'transformers']` | classify | **新增**（§2.2） |
| `transformers-ner` | `['ner', 'transformers']` | extract | `transformersTextTasks.ner` |
| `transformers-zero-shot` | `['zero-shot', 'transformers']` | extract | `.`zero-shot`` |
| `transformers-summarization` | `['summarization', 'transformers']` | summarize | `.summarization` |
| `transformers-qa` | `['qa', 'transformers']` | answer | `.qa` |
| `transformers-fill-mask` | `['fill-mask', 'transformers']` | fill | `.fill-mask` |
| `transformers-embedder` | `['text-embedder', 'transformers']` | embed | `text-embedder.vue` |

- 通用 `run` 骨架（对前 5 个 + 情感）：`setupTransformersEnv()` → 按 `device`（`preferredDevice()`，WebGPU 失败回退 `wasm`）建 `pipeline(task, model, options)`（**实例按 `${task}|${model}|${device}` 缓存**，源 Runner 就是这么做的）→ `pipe(...buildArgs(values), callOptions(values, params))` → 归一化：
  - 有 `parseItems` → `items`
  - 有 `parseText` → `text`
  - `progress_callback` 走 `parseDownloadProgress` + `ctx.onProgress`
- 情感分类（新增）：`task: 'text-classification'`，模型 `transformersModels.sentiment`，
  归一化为 `items`（label = 模型返回的 `label`，score = `score`）。**这是唯一允许你改 `utils/transformers.ts` 的地方：给 `transformersModels` 加一个 `sentiment` 键。**
- 文本嵌入：两个输入框（`key: 'text1'` / `'text2'`，label 复用 `textEmbedder.*` 或 `tf.inputText`，**以 `text-embedder.vue` 现有文案为准**），
  结果为 `headline: { label: 余弦相似度, value: similarity.toFixed(4) }` + `info`（后端、耗时）。
  注意：`TextEmbedder` 与 `cosineSimilarity` 的用法照搬 `text-embedder.vue`（第 60–70 行附近）。
- `section` 一律 `{ '<任务族 slug>': 'nlp.sections.<族>', 'transformers': 'nlp.sections.transformers', '*': 'nlp.sections.<族>' }`

### 4.4 `NlpPlayground.vue`（我做，不派给你）

## 5. 实施记录（as-built）

### 落地清单

| 文件 | 变化 |
|---|---|
| `app/utils/nlp-tools.ts` | 新增：`NlpTool` 类型 + 统一注册表（adapter 层） |
| `app/utils/nlp-engines/mediapipe.ts` | 新增：3 个工具（分类 / 语言检测 / **文本嵌入**） |
| `app/utils/nlp-engines/transformers.ts` | 新增：6 个工具（情感 / NER / 零样本 / 摘要 / 问答 / 完形填空） |
| `app/components/NlpPlayground.vue` | 新增：左栏 + 多输入框 + 参数 + 四通道结果渲染 |
| `app/pages/nlp/[slug].vue` | 重写：**193 行 → 48 行**，两个手写 `#result` 模板删除 |
| `app/pages/nlp/text-embedder.vue` | **删除**（见问题 3） |
| `app/utils/transformers.ts` | 仅加 `transformersModels.sentiment` 一个键 |
| `app/utils/demos.ts` | `text-classifier` 升级为能力页文案；新增 `mediapipe-text` / `transformers` 两个引擎页条目 |
| `i18n/locales/{zh,en}.json` | 新增 `nlp.sections.*`(9) + `nlp.examples.*`(4) + `nlp.playground.*`(5) + `nlp.tryExample` + `samples.ex*`(10) |

**9 个注册表工具**：

| 工具 | pages | 引擎 |
|---|---|---|
| `mediapipe-text-classify` | text-classifier, mediapipe-text | MediaPipe |
| `mediapipe-language-detect` | language-detector, mediapipe-text | MediaPipe |
| `transformers-embedder` | text-embedder, mediapipe-text | MediaPipe |
| `transformers-sentiment` | text-classifier, transformers | Transformers.js |
| `transformers-ner` | ner, transformers | Transformers.js |
| `transformers-zero-shot` | zero-shot, transformers | Transformers.js |
| `transformers-summarization` | summarization, transformers | Transformers.js |
| `transformers-qa` | qa, transformers | Transformers.js |
| `transformers-fill-mask` | fill-mask, transformers | Transformers.js |

**双轴生效的实证**：`mediapipe-text-classify` 同时挂 `text-classifier`（能力页，与 `transformers-sentiment` 并列 → 同一段文本两种引擎横向对比）与 `mediapipe-text`（引擎页，与语言检测、文本嵌入并列 → 同一引擎三个任务）。**8 个原有 URL 全部保留，无 301。**

侧栏条目数：`/nlp/text-classifier` 2 项、`/nlp/mediapipe-text` 3 项、`/nlp/transformers` 6 项，其余 7 个能力页各 1 项（预留第 2 实现的槽位，与视觉 `depth` 页同理）。

### 过程中发现并修掉的问题

1. **我的方案把 `text-embedder` 的引擎归错了**（写成 Transformers.js，实际是 MediaPipe 的 `TextEmbedder` + `universal_sentence_encoder.tflite`）。
   实现者先按方案落地、再如实报告了矛盾，随后把整块实现搬到 `nlp-engines/mediapipe.ts` 并把 `engine` 改成 `'mediapipe'`、pages 改成 `['text-embedder','mediapipe-text']`。
   **教训：归引擎要看 import 与模型注册处，不能凭 slug 名字猜。**
2. **10 个 `samples.ex*` i18n key 缺失**（`exNerPerson`/`exNerNews`/`exZsMovie`/`exZsNews`/`exSummaryAI`/`exSummaryEiffel`/`exQaEiffel`/`exQaMars`/`exMaskCapital`/`exMaskPlanets`）——
   它们被 `transformersTextTasks.examples` 引用，于是**改造前线上 NLP 页面的「试试示例」按钮就在显示原始 key 串**（因为不是静态 `t('…')`，`check:i18n` 抓不到）。已补齐两种语言。
3. **`app/pages/nlp/text-embedder.vue` 会遮蔽 `[slug].vue`**：Nuxt 里具体路由优先于动态路由，不删它则 `/nlp/text-embedder` 仍走旧页面，新架构对它不生效。已删除（其逻辑已进注册表）。
4. **`nlp/[slug].vue` 里两个手写 `#result` 模板（约占 120 行）** 由 `NlpPlayground` 的通用渲染取代，不再需要「按结果形状分支写模板」。
5. **`watch(..., { immediate: true })` 的 TDZ 坑**（与语音侧同款）：`activateTool` 里会调 `resetRun()`，而它引用的 ref 在 setup 后段才声明 → 改为 `watch(activeToolId, activateTool)` + `onMounted(activateTool)`。
6. **方案文档自身有两处错**，实现者指出后按正确形态落地：
   - §4.3 的 `section` 模板方向写反了（能力页应显示**引擎名**、引擎页显示**任务族**）；
   - 让实现者用 `tf.textClassifierPlaceholder` / `tf.langDetectPlaceholder`，这两个 key **并不存在**（`tf.*` 里只有 `inputText`、`nerPlaceholder`、`qaQPlaceholder` 等）→ 改为省略 `placeholderKey`。

### 验收（全部实跑）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | **452**（与 NLP 开工前一致，**无新增**；`grep nlp` 无任何命中） |
| `pnpm exec eslint`（NLP 全部新增/改动文件） | **0 error / 0 warning** |
| `pnpm check:i18n` | 903 处引用 / 717 key，en·zh 均在 |
| `pnpm build` | **EXIT=0** |
| 冒烟：NLP 全部入口 | `/nlp` 首页 + 10 个 slug **全部 200**，无「演示不存在/无工具」 |
| 冒烟：相邻分类 | `ml` 4/4、`robot` 5/5、`aigc/chat`、`vision/detection`、`speech/asr` 均 200 |
| 既有 lint 债务 | `utils/transformers.ts:185` 的 `comma-style` 已用 `git show HEAD:` 版本对照确认**改动前就有**，非本次引入 |

### 未完成（诚实清单）

1. **真机未验（唯一实质缺口）**：MediaPipe 文本任务与 7 个 Transformers pipeline 的实际推理结果、模型下载进度、WebGPU 回退、示例按钮填充 —— 都需要在浏览器点一遍。本轮验证是静态的（类型 + lint + SSR 冒烟）+ 注册表归属的静态核对。
2. **新增的 `distilbert-base-uncased-finetuned-sst-2-english` 未做模型供给处理**：它走 `setupTransformersEnv` 的「本地优先 → `/api/hf` 代理回退」，因此能用；但 `.models/` 里没有它、`/status` 页也看不出（`GROUPS` 无 transformers 组）。这与视觉侧 `modnet`/`depth-anything`/`squad` 是同一类情况。
3. **其余 7 个单条目能力页**（`language-detector`/`ner`/`zero-shot`/`summarization`/`qa`/`fill-mask`/`text-embedder`）的第二实现未做。它们是槽位，不是缺陷；但「能力页」这个词在它们身上目前还只是框架意义。
4. **`mediapipe-text.ts` 与 `transformers.ts` 里的旧声明式配置仍保留**（这是刻意的：注册表是 adapter，源配置是行为等价的依据，也留作回退）。代价是同一件事的描述存在两处，属可接受的技术债。
5. **`transformers.ts` 的 `TaskFamily` 里 `'embed'` 成员现已无人使用**（嵌入工具搬走后遗留），未清理。

## 6. 验收口径

| 项 | 要求 |
|---|---|
| 全仓库 `pnpm typecheck` | 不得高于改动前（改动前 **452**；并行的无关改动可能扰动，以「你的文件 0 错误」为准） |
| 改动文件 `eslint` | 0 error |
| `pnpm check:i18n` | 引用的 key 在 en/zh 均存在 |
| `pnpm build` | EXIT=0 |
| 冒烟 | 8 个能力页 + 2 个引擎页 = 10 个 slug 均 200；`/nlp/transformers` 侧栏 7 项、`/nlp/text-classifier` 侧栏 2 项 |
