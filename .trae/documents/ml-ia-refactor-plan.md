# 机器学习（ML）信息架构整理 + 跨分类归属

> 状态：**已完成**（2026-09-15）。对照：`vision-ia-refactor-plan.md`、`speech-ia-refactor-plan.md`、`nlp-ia-refactor-plan.md`。

## 1. 需求

1. ML 也要做「多分类处理」（与视觉/语音/NLP 一致的规范化）。
2. **跨分类归属**：像「图像分类训练」这类演示，既该在**视觉**里能进，也该在**机器学习**里能进。

（用户原文「放到试卷里面去」按其与「视觉」同音推断为 `vision`，并据此实施。）

## 2. 审计：ML 的 28 个入口是三类东西

| 组 | 项数 | 现状 | 结论 |
|---|---|---|---|
| `neural-*` 可视化 | **15** | 每个 `.vue` **11 行 / 210 字节**，全都是 `<NeuralDemoShell :demo name="xxx"/>` | 纯重复：**一个入口一个文件**，15 个文件合计 165 行只为了把 slug 映射成一个字符串 |
| `*-training` 训练 | **4** | 329–418 行，**不共享组件** | 同一任务（训练自己的分类器）的 4 种实现，差别在特征来源 |
| 算法/交互页 | 9 | kmeans / regression / mnist / cartpole / palette / decision-tree / flappy / playground / cnn-explainer | 各自完整的独立 UI，无复用空间 |

4 个训练页与它们的天然归属：

| 页面 | 特征来源 | 归属 |
|---|---|---|
| `image-training` | TF.js MobileNet 嵌入 | 机器学习 **+ 视觉** |
| `pose-training` | MediaPipe Pose 关键点 | 机器学习 **+ 视觉** |
| `audio-training` | TF.js Speech Commands | 机器学习 **+ 语音** |
| `text-training` | Transformers.js 句子嵌入 | 机器学习 **+ NLP** |

## 3. 与用户确认后定的范围

两个决策点（跨分类做到什么程度 / ML 双轴做到哪一步）已向用户提出，用户选择跳过 → 按推荐项实施：

- **跨分类走「列表级」**：训练演示同时出现在两个分类的**列表**里，URL 仍是唯一的规范地址。不做「工具级」（塞进视觉能力页左栏）与「深度统一」（重写 1454 行训练代码）。
- **ML 只做合并**：15 个 `neural-*` 合成 1 个分发页；**不新建** `/ml/training` 能力页 —— ML 的 28 项大多是「主题家族」而非「一个任务多种实现」，硬造能力页只会得到一堆单条目空壳（与语音侧我拒绝把节拍器塞进双轴是同一个判断）。

## 4. 实施

| 文件 | 变化 |
|---|---|
| `app/pages/ml/[slug].vue` | 新增：按 `neural-` 前缀分发到 `NeuralDemoShell` |
| `app/utils/neural-demos.ts` | 新增：15 个合法 name 的清单（也是 iframe 目录名的唯一事实来源） |
| `app/pages/ml/neural-*.vue` | **删除 15 个文件**（合计 165 行） |
| `app/utils/demos.ts` | `Demo` 加 `alsoIn?: DemoCategory[]`；`demosByCategory` 纳入跨分类项；4 个训练页各加 `alsoIn` |
| `app/composables/useDemos.ts` | `byCategory` 纳入跨分类项；`byCategoryGrouped` 把跨分类项单独成组放最后 |
| `app/components/CategoryPage.vue` | 有 1 个带标题的组就显示标题（否则跨分类组会渲染成无标题网格） |
| `app/components/AppSidebar.vue` | **修 bug**：链接改用 `demoPath(demo)`（见 §5） |
| `i18n/locales/{zh,en}.json` | 加 `demo.crossListed` |

`ml` 页面文件数：**29 → 15**。

### 跨分类的语义

- `category` 仍是**规范归属**：决定 `demoPath` 与 `getDemo` 的校验，也是 URL 的唯一来源。
- `alsoIn` 只影响**列表展示**：出现在那些分类的列表页与左栏里，链接指向规范地址。
- 因此**不产生第二个 URL、不需要 301**，也不存在「同一页面两个地址」的 SEO 问题。

## 5. 过程中发现的两个真问题

### 5.1 我引入的坏链（只有客户端才看得见）

`AppSidebar`（全站左栏）用 `byCategory(cat.slug)` 取当前分类的子项，但链接是**用当前分类拼**的：
`` :to="`/${cat.slug}/${demo.slug}`" ``。加了 `alsoIn` 之后，在 `/vision/*` 页面上它会给
`image-training` 生成 `/vision/image-training` —— 这个路由不存在，页面显示「不存在」却仍返回 **HTTP 200**。

- 为什么 SSR 冒烟没抓到：分类列表页用的是 `bare` 布局（不含左栏），而带左栏的是 demo 页；我的第一轮冒烟只查了 `/vision`，那里只有网格（用 `demoPath`，是对的）。
- 修法：`AppSidebar` 改用 `demoPath(demo)`，`isDemoActive` 同步改为比对规范路径。这样 URL 由构造保证正确，不再依赖「当前分类 == 规范分类」这个前提。
- 已复查全仓库，**没有其它地方**用「当前分类 + slug」拼 demo URL（其余 `/${cat.slug}` 都是分类首页链接，正确）。
- 验证：`/vision/pose` 内 `href="/vision/image-training"` = **0**，`href="/ml/image-training"` = 1。

### 5.2 我自己加的侧栏是冗余的（已撤）

我先给 `NeuralDemoShell` 加了一条列出这 15 项的左栏（ToolSidebar）。但全站本来就有 `AppSidebar`
按分类列出**全部** demo —— 在 `/ml/*` 页面上它已经把 15 个 neural demo 全列出来了。
所以这条新侧栏是**同一批链接、同一分类**的第二份，纯重复。

- 撤掉侧栏后实测：`/ml/neural-boids` 里仍有 **15** 个 neural 链接（来自 `AppSidebar`）→ 证实冗余。
- 保留的只有「15 → 1 个分发页」这个真正的收益。
- 顺带撤回的还有家族分组（群体/生成/优化/搜索/数学）与 `neuralSandbox.toolbox`、`family.*` 两组 i18n key。家族分组若要做得对，应该走 `demos.ts` **已有的 `group` 机制**（视觉分类已在用），而不是另起一条侧栏 —— 这是个独立、更大的改动，未做。

## 6. 验收（全部实跑）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | **452**（与 ML 开工前一致，无新增） |
| `pnpm exec eslint`（本次新增/改动文件） | **0 error**；`AppSidebar.vue` 的 8 个问题用 `git show HEAD:` 对照确认**改动前就有** |
| `pnpm check:i18n` | 897 处引用 / 711 key，en·zh 均在 |
| `pnpm build` | **EXIT=0** |
| 冒烟：`neural-*` | **15/15 → 200** |
| 冒烟：其余 ml 页面 | 9 个实体页 + 4 个训练页 **全 200** |
| 冒烟：跨分类列表 | `/vision`、`/speech`、`/nlp` 各出现 1 个跨分类分组；`/ml` 自己为 0（正确） |
| 冒烟：跨分类链接 | 指向 `/ml/*-training`（规范地址），无坏链 |
| 冒烟：中英双语 | 英文（SSR 默认）与 `Accept-Language: zh-CN` 下都命中 |

## 7. 未完成（诚实清单）

1. **真机未验**：15 个 iframe 子应用的实际加载与切换、4 个训练页的采集/训练/预测流程、全站左栏在小屏抽屉里的表现 —— 需在浏览器点一遍。本轮是静态验证（类型 + lint + SSR 冒烟 + 路由）。
2. **9 个 ml 实体页仍有 ~140 个既有类型错误**（`noUncheckedIndexedAccess` 下的下标访问等，`total 452` 里的大头）。这是 ML 分类最大的一块技术债，本轮**未动**（属类型加固，不是 IA 问题）。
3. **4 个训练页未抽公共层**：它们共享同一套「采集样本 → 训练分类头 → 预测」流程，只是特征来源不同，1454 行里有不少重复。抽成「特征源 + 训练器」是「深度统一」方案的内容，本轮按用户选择未做。
4. **家族分组未落地**：若要给 ml 的 28 项分组，正确做法是复用 `demos.ts` 的 `group` 字段（目前仅 vision 用 `visionGroupKeys`/`visionGroupLabels`），需要把这套机制推广到 ml。
5. **`alsoIn` 目前只有 4 个使用者**（即 4 个训练页）。机制是通用的，后续任何横跨两个方向的演示都能直接加。

## 8. 批 2：ml 页面的类型加固（133 个错误）

### 8.1 现状

`pnpm typecheck` 全仓库 **452** 个错误，其中 **133 个在 `app/pages/ml/` 的 12 个文件**里，
全部是 `noUncheckedIndexedAccess` 一族（数组/对象下标访问返回 `T | undefined`）：

| 错误码 | 数量 | 含义 |
|---|---|---|
| TS2532 | 85 | `Object is possibly 'undefined'` |
| TS18048 | 20 | `'x' is possibly 'undefined'` |
| TS2345 | 13 | `Argument of type 'X \| undefined' is not assignable to 'X'` |
| TS2538 | 8 | `Type 'undefined' cannot be used as an index type` |
| TS2322 / TS18046 / TS2571 | 4 / 2 / 1 | 赋值、`unknown` 相关 |

按文件：`palette` 40、`kmeans` 29、`decision-tree` 15、`mnist` 10、`flappy` 9、
`audio-training` 7、`playground` 6、`regression` 5、`text-training` 4、`pose-training` 3、
`image-training` 3、`cartpole` 2。

### 8.2 硬性规则（这是**类型加固**，不是重写）

1. **只改你被指定的文件**。不要动其它页面、`app/utils/*`、i18n、`demos.ts`、组件。
2. **绝不允许为了消错而改变运行时行为**。这些文件是画布动画、游戏循环与 ML 算法（kmeans 距离、
   flappy 碰撞、palette 取色、decision-tree 分裂），**一个凭空补的默认值就会静默改变结果**。
3. 按下列优先级选修法：
   - **首选用 `for...of` 替掉下标循环**（`for (const p of points)`）—— 这一条能消掉大部分 TS2532，
     而且代码更短。仅在确实需要下标时才保留 `for (let i = 0; ...)`。
   - 循环上界已保证在界内时（如 `for (let i = 0; i < arr.length; i++)`），可用非空断言 `arr[i]!`，
     并在注释里写明「下标由循环上界保证」。
   - 确实可能越界/缺失时，**加显式的守卫**（`if (!x) return` / `continue`），不要用 `?? 0` 之类
     的默认值把问题掩盖过去 —— 除非该处的业务语义本来就是「缺失即 0」（此时注释说明）。
   - 解构出来的可能是 `undefined` 的对象（如 `const [a, b] = pair`）→ 用守卫或 `for...of` 重构。
   - `Type 'undefined' cannot be used as an index type`（TS2538）→ 说明**键的来源本身**没保证，
     必须在上游加守卫或收窄类型，不要用 `as` 硬转。
4. **不要新增 `any`、不要新增 `as unknown as`、不要加 `@ts-expect-error` / `@ts-ignore`** ——
   那只是把错误换个地方藏起来，与本批目标相反。
5. 模板（`<template>`）、文案、默认参数值、变量名一律不动。
6. 风格照旧：每行最多 1 条语句；内联对象类型成员用 `,`；`quote-props: consistent-as-needed`；
   注释用中文解释**为什么**。

### 8.3 验收（每个实现者都要自己跑）

```bash
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd /Users/oldmoon/Documents/github/AI-Tech-Hub
pnpm exec eslint <你的文件>                    # 必须 0 error
pnpm nuxt prepare >/dev/null 2>&1
pnpm typecheck 2>&1 | grep "<你的文件>"         # 必须无输出（该文件 0 错误）
pnpm typecheck 2>&1 | grep -cE "error TS"      # 全仓库总数必须从 452 降到 452 减去你的文件错误数
```

例：`palette.vue` 有 40 个错误，改完后全仓库总数应为 **412**。**若总数没降，说明你只是把错误
移到了别处（或改坏了别的文件）。**

### 8.4 批 3：4 个训练页抽公共层（本批之后再做）

`image-training`(329) / `audio-training`(379) / `pose-training`(418) / `text-training`(328) 共 1454 行，
共享同一套流程：**采集样本 → 训练分类头 → 预测**，差别只在**特征来源**
（MobileNet 嵌入 / Speech Commands / MediaPipe Pose 关键点 / Transformers 句子嵌入）。

**必须等 §8 完成后再动这 4 个文件**（两边都会改同一批文件，并行会冲突）。

## 9. 实施记录：批 2 + 批 3（已完成）

### 9.1 批 2：ml 页面类型加固 —— 全仓库 452 → 319

按 §8 逐文件加固，**未新增 `any` / `as` / `@ts-ignore`，未改运行时行为**。手法分四类：

| 手法 | 用在哪 |
|---|---|
| 循环上界可证在界内 → `x[i]!` + 注释写明依据 | cartpole / kmeans / regression / playground / decision-tree / mnist / flappy |
| **收窄成定长形状** | palette 的 `type RGB = [number, number, number]`、kmeans 的 `Array<[number, number]>`。一步消掉「RGB / 中心点三元组」的全部下标报错，比逐个补 `!` 更贴合语义（40 个错里有 30 个属此类） |
| `Array.from<number>(...)` 显式元素类型 | cartpole / mnist（`pred.dataSync()` 是 `any`，不写会推成 `unknown[]`） |
| 上游加守卫 / 收窄类型 | 训练页的 `classNames.value[idx]` → `classNameAt(idx)`。TS2538（`undefined` 作索引）的正解是修**键的来源**，不是就地断言 |

**两个「不能用 `?? 0`」的坑**：`weights[i] -= ...` / `grads[i] += ...` 这类**复合赋值会先读回左值**，
在 `noUncheckedIndexedAccess` 下左值类型是 `number | undefined`。此处既不能给左值加 `!`（语法不允许），
也不能用 `?? 0`（会静默改变梯度与权重更新），只能改写为 `weights[i] = weights[i]! - ...`。
另注：`probs[1]` 同理 —— 写 `(probs[1] ?? 0) < 0.5` 会把 `undefined < 0.5 → false` 变成
`0 < 0.5 → true`，**直接翻转 CartPole 的动作选择**。

### 9.2 批 3：4 个训练页抽公共层

新增 3 个文件：

- `app/composables/useKnnTrainer.ts` —— 与输入模态无关的部分：类别名 / 样本数 / 预测结果、
  改名、清空、`applyPrediction`（回填各类置信度 + 阈值判定 top-1）。`KnnClassifierLike` 是按
  实际调用面声明的最小接口。
- `app/components/ClassTrainerGrid.vue` —— 三类别卡片区（改名 / 样本数 / 清空）。采集控件走
  `#collect` 插槽（按住采样 / 按住录音 / 加入类别），`#extra` 插槽放样本文本框。
- `app/components/PredictionBars.vue` —— 置信度结果条。只渲染行，卡片外壳由调用方决定
  （文本页要把它嵌在「预测」卡片里）。

image / pose / text 三页改用 `useKnnTrainer` + 上述两个组件；`audio-training` 走 speech-commands
的 transfer 头、后端不同，因此**保留自己的类别状态**，但卡片区与结果条同样复用这两个组件
（这正是「统一 4 个训练页观感」的部分）。

顺带修掉/收敛的 4 件事（都不改算法）：

1. **发现一个必然抛错的潜伏 bug**：三个 KNN 页「重命名含样本的类别」时调用了
   `classifier.getClassDatasetObject(oldName)` —— 该方法在 `knn-classifier` 里**根本不存在**
   （只有整体的 `getClassifierDataset`）。此前 `classifier` 是 `any`，编译期看不出来；运行时一旦该类
   已有样本，改名就会 TypeError 中断，`classNames.value[idx] = name` 永远执行不到 —— 表现为
   **改名静默失败**。现统一为「有样本则拒绝改名」并提示 `ml.renameAfterSamples`（与音频页原本
   行为一致），且 `ClassTrainerGrid` 在 emit 后把输入框回滚为真实类别名（emit 同步，父级若接受
   改名则回滚值为新值，视觉无变化），避免输入框显示与状态不一致。
2. `audio-training` 的 `scMod.create('BROWSER_FFT', null, …)` → `undefined`：该库断言是
   `vocabulary == null`（松散相等），且提供自定义 modelURL 的分支不读取该参数，两者运行期等价。
3. `image-training` / `pose-training` 的 `trainingClass` 由普通 `let` 改为 `ref`：模板要据此高亮
   当前采集卡片，非响应式变量只是「碰巧」靠别的 ref 变化带动重渲染。
4. 清空按钮禁用条件 `!sampleCounts.some(c => c > 0)` → `totalSamples === 0`（等价且已类型化）；
   文本页的样本数改为与其它三页一致的大字号计数（原先是一行小字）。

### 9.3 门禁（全部实跑）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | **319**（452 − 133，与 §8 预算一致）；`app/pages/ml/` **0 错误** |
| `pnpm exec eslint`（12 个改动页） | 与 HEAD **逐文件错误数完全一致**（cartpole 24、regression 21、playground 28、kmeans 23、palette 10、decision-tree 18、mnist 24、flappy 20）→ **未新增 lint 债**；4 个训练页**变好**：image 14→9、pose 14→9、audio 14→10、text 5→4 |
| 3 个新文件 eslint | 0 error |
| `pnpm check:i18n` | OK（897 处引用 / 711 个 key 全部存在） |
| `pnpm build` | Build complete，EXIT=0，产物无模型残留 |
| SSR 冒烟 | 12 个 ml 页全 200；4 个训练页中英双语均渲染出 3 个类别卡片；`/ml`、`/ml/neural-*` 200；跨分类链接指向规范分类、无 `/vision/image-training` 坏链；中文「来自其它分类」正常 |

### 9.4 仍然诚实要说的

1. **真机未验**：类型 / lint / 构建 / SSR 都过了，但「按住采集 → 训练 → 预测」这条交互链，以及
   改名被拒时的输入框回滚，只有在浏览器里点得出来。
2. **`ml.samples` 的 `{n}` 占位符从来没被填过**：en 是 `"{n} samples"`，四个训练页都只写
   `t('ml.samples')` 而不传 `n`，所以界面上就是字面量 `{n} samples`。这是**既有**问题（本次重构
   按「不改文案」保持原样）。要修就是「把计数传进去 + 去掉旁边那个大字号数字」。
3. **改名时迁移样本的能力被放弃**（见 9.2-1）：现在有样本就不许改名。真要支持迁移，得用
   `getClassifierDataset()` 拆 `[n, dim]` 张量逐行 `addExample`，属必须浏览器实测的改动。
4. §7 的其余未完成项（家族分组、真机验证）不受本次影响。
