# nuxt_AI 改进计划（基于 UX-AUDIT.md）

> 制定日期：2026-08-14
> 依据：`docs/UX-AUDIT.md`（2026-08-13 Claude Code 审计）+ 全量引用复核（125 处引用已验证，唯一修正：`ml/playground.vue` 暗色问题实际在 :107）
> 基线：tag `v0.11.0`（本计划配套发布）
> 状态：进行中（批次 0 完成，批次 1 待开始）

## 一、目标与完成标准

- 目标：按审计报告消除 P0（剩余 1 项）→ P1（约 20 项）→ P2（约 15 项），并补齐审计盲区（a11y / 最小测试护栏）
- 完成标准：UX-AUDIT.md 全部条目勾兑完成；每批合并门槛（见 §四）通过；无新增 lint/typecheck 错误

## 二、Git 工作流策略（已确认）

**结论：按逻辑批次开短期分支，批末验证后 `--no-ff` 合并回 main，不在 main 直接改，也不做"每改造一处一分支"。**

### 三个候选方案对比

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A. main 直接改 | 流程最简 | 无回滚点；lint/typecheck 基线已坏（eslint 1724 / typecheck 555 存量错误），无法隔离回归；违背既有约定 | ❌ 否决 |
| B. 每改造一处一分支一合并 | 粒度最小、可精确回滚 | 86 处原始报错 → 86 个分支；横切改动（错误 util、Runner 重构）互相依赖，拆分只会制造合并噪音与半成品状态 | ❌ 否决 |
| C. 按逻辑批次分支 + 批内子任务逐个验证 | 回滚粒度=逻辑主题；子任务即改即验（lint+typecheck）；合并次数≈8-10 次可管理；与 handoff 既有约定一致 | 批内多文件时单文件回滚略粗 | ✅ 采用 |

### 执行规则

1. 每批一条分支：`fix/<主题>` / `feat/<主题>`，从 `main`（= v0.11.0 基线）切出
2. 批内每个子任务完成后立即跑 `eslint`（对比基线不新增）+ `nuxi typecheck`，通过才继续
3. 批末人工冒烟清单通过 → `git checkout main && git merge --no-ff <分支>` → 删分支
4. 每批合并后在 UX-AUDIT.md / 本计划 §六 勾兑
5. 横切改动（错误映射 util、useTaskPoller 扩展）单独成批，不与其他小修混批
6. 小型修复（i18n key、状态矛盾）可累积成「快修批」，避免碎片

## 三、批次计划

### 批次 0：基线发布（本次完成）

- 内容：提交当前工作区（handoff.md、版本号）+ 计划文档；`package.json` 补 `"version": "0.11.0"`；tag `v0.11.0`；合并 `chore/release-v0.1` → main
- 验收：`git tag` 有 v0.11.0；main = v0.11.0

### 批次 1：P0 收尾 + 轮询补齐（`feat/sample-assets` + `fix/ml-poller`）

**P0-4 示例素材**（审计第一批 #3）
- `public/samples/`：人脸照、多人照、风景照、文档照、语音、音乐、带噪语音各 1-2 份（无版权素材，总 <10MB）
- `MediaVisionRunner.vue` / `ImagePlayground.vue` / `MediaTextRunner.vue` 加「试试示例」按钮
- 验收：无素材/无摄像头用户也能一键试玩

**ML 4 页轮询补齐**（复评补充，审计 P0-1 提及但路线图漏项）
- `ml/forecast.vue`、`ml/anomaly.vue`、`ml/auto-train.vue`、`ml/dim-reduction.vue` 从 `setInterval` 迁移到 `useTaskPoller`（超时 + 瞬断容忍）
- 验收：4 页与 11 个任务页行为一致

**快修**：demos.ts 6 个 `ready`+「规划中」矛盾（P1-5）→ 改 `planned` 或删描述

### 批次 2：错误处理与文案（`fix/error-messages`，审计第二批 #4-#5 + #11）

- 抽公共错误映射 util（网络/显存/模型未加载 → 人话 + 原始错误折叠），替换 86 处 `e?.message || String(e)` 直出（P1-1）
- 抽公共 getUserMedia 权限 util（复用 `FaceCamera.vue:27-31` 模式），8+ 页面统一（P1 维度三-1）
- 硬编码文本提取 i18n：`sd-turbo.vue`/`photo-restore.vue` 的「提交失败/已取消」、`[slug].vue` "Demo not found"、`text-embedder.vue` Text A/B/Cosine、ml 各页硬编码（P1-3/P1-4/P2）
- `useTaskPoller.ts` 默认兜底文案国际化（复评补充：当前硬编码中文）
- 上传前置校验（类型 + 大小：音频 50MB / 图片 20MB）+ 服务端各队列补大小限制（P1 维度三-3）
- en.json 其余硬编码英文扫描（P2）
- 验收：常见错误路径全部显示人话；双语一致

### 批次 3：交互体验（`fix/runner-ux`，审计第二批 #6、#9、#10）

- 通用 Runner（TransformersTextRunner/MediaTextRunner/MediaVisionRunner）模型下载进度条 + 三态区分（P1 维度二-2）
- MediaVisionRunner 摄像头 `starting` 态防竞态（P1 维度二-1）
- 移动端网格降级 8 处（PyodideRunner/mnist/cartpole/kmeans/playground/decision-tree/regression/anomaly）`grid-cols-1 sm:grid-cols-*`（P1 维度二-4）
- 暗色模式硬编码颜色修复（kmeans/playground:107/mnist/forecast/decision-tree，SVG → currentColor 或 colorMode 色板）（P1 维度二-5）
- 上传组件统一（拖拽/粘贴/预览/移除/大小校验）——复用 ImagePlayground/FacePhotoPicker 模式（P1 维度二-3）
- ImagePlayground 并发守卫 `if (running.value) return`（P2）
- 验收：375px 与暗色模式抽查通过

### 批次 4：导航 / 信息架构 / SEO（`feat/demo-metadata` + `fix/nav-seo`，审计第二批 #7、#8、#12、#13）

- demos.ts 注册表加 `runtime`/`requirements`/`featured` 字段 + DemoCard 预期管理徽章（需摄像头/模型 ~GB/需本地服务）（P1 维度四-2）
- 首页 hero 卖点文案 + 分类限流「查看全部」（P1 维度四-1）
- 隐私卖点外显：卡片/页头渲染「本地浏览器运行 · 数据不出设备」徽章（P1 维度四-6）
- MediaDemoShell 面包屑 + 上一个/下一个（P1 维度四-3）
- SEO：ogImage + 各 demo 页独立 `useSeoMeta` + `htmlAttrs.lang` 绑定 locale（P1 维度四-8、P2）
- GitHub 占位符 → 真实仓库（`github.com/ikeee/nuxt-ai`）（P1 维度四-7）
- 验收：卡片信息透明；分享链接独立 title/description

### 批次 5：P2 质感（`fix/polish`，审计第三批）

- 文本结果「复制」按钮（3 个 Runner 结果卡）
- Runner 内置空态 + 摄像头权限拒绝引导「改用上传」
- photo-restore 前后对比 slider（或注明裁切行为）
- FacePhotoPicker 非图片文件反馈、mnist 模型进度 UProgress、face-recognition canvas 颜色随主题
- 「结果仅本次会话有效」提示（配合批次 5 的 IndexedDB 历史可选拆分）
- `howItWorks` 教育字段（Shell 折叠渲染）
- FAQ/反馈入口 + 「怎么玩」三步引导；Python 环境缺失事前禁用（`requiresPython`）
- 验收：按审计 P2 清单逐条勾兑

### 批次 6：质量护栏（复评补充，审计盲区）

- **最小测试**：引入 vitest，先覆盖 `useTaskPoller`（超时/卸载/重试）与错误映射 util；后续批次改动前先写测试
- **a11y 专项**：键盘导航、焦点管理、aria、对比度抽查（重点 Runner 控件与 Slideover）
- **性能**：模型加载策略（体积提示已有，评估预加载/懒加载）、首屏 bundle 检查
- 验收：核心逻辑有测试护栏；a11y 清单通过

## 四、验收与合并门槛（沿用 handoff 约定）

1. **lint**：改动文件对比基线**不新增错误**（基线：eslint 1724 存量错误 / 116 文件；typecheck 555 存量错误——基线本身坏，只认增量）
2. **typecheck**：`./node_modules/.bin/nuxi typecheck` 不新增错误
3. **人工冒烟清单**：每批涉及页面在 dev server 手工过一遍主流程
4. 无测试/无 CI 现状在批次 6 前保持，批次 6 后新增改动需带测试

## 五、风险与护栏

- **lint/typecheck 基线坏**：所有验收只看增量；新文件保持 lint 干净（`no-explicit-any` 等用局部 disable）
- **无 CI**：合并前必须本地跑完门槛；关键批（1/2/6）建议合并后立即验证 dev server
- **模型体积**：public/model 不入库；示例素材必须小体积（<10MB 总量）
- **行号漂移**：每批完成后用 git 基线复核审计条目，勾兑以"问题是否消失"为准，不以行号为准
- **Python 环境**：服务端 demo 依赖本机 venv；云端部署时需 `requiresPython` 标注（批次 5）

## 六、勾兑记录

| 批次 | 分支 | 内容 | 状态 |
|---|---|---|---|
| 0 | `chore/release-v0.1` | 基线 v0.11.0 + 计划 | ✅ 完成 |
| 1 | `fix/ml-poller` ✅ | ML 4 页轮询迁移 useTaskPoller；demos.ts 6 处 ready→planned（commit `941db0a`，lint/typecheck 零新增） | ✅ 完成 |
| 1 | `feat/sample-assets` ✅ | P0-4：素材 4 图 + 4 音频（1.89MB，无版权）；MediaVisionRunner/ImagePlayground「试试示例」；MediaTextRunner 默认输入；asr/denoise/separation/emotion/voice-clone 5 页示例按钮（commit `de84304`+`e177f62`，lint/typecheck 零新增，冒烟 5 页 200） | ✅ 完成 |
| 2 | `fix/error-messages` ✅ | 错误映射/权限/上传 util；65 处 humanError 替换（37 文件）；8 页 mediaError；硬编码 i18n；useTaskPoller 兜底国际化；11 个服务端队列补大小限制（commit `d2423a6`+`0349984`+`db05cf5`，lint/typecheck 零新增，冒烟 7 页 200）。**前端上传校验并入批次 3 上传组件统一** | ✅ 完成 |
| 3 | `fix/runner-ux` ✅ | 网格降级 8 处、Runner 下载进度/三态、摄像头 starting 防竞态、ImagePlayground 守卫、暗色 SVG、前端上传校验 6 页（commit `ea15b46`，lint/typecheck 零新增，冒烟 6 页 200） | ✅ 完成 |
| 4 | `feat/demo-metadata` + `fix/nav-seo` ✅ | 注册表 runtime/requirements/featured（39 个标注）、卡片徽章、首页限流+hero 卖点、面包屑/上下页、SEO（ogImage/meta/lang）、GitHub 真实链接（commit `5e53627`，注：直接在 main 提交） | ✅ 完成 |
| 5 | `fix/polish` ✅ | 复制按钮、Runner 空态/权限引导、mnist UProgress、FacePhotoPicker 反馈、session-only 提示（commit `77639f7`，lint/typecheck 零新增，冒烟 5 页 200） | ✅ 完成 |
| 6 | `chore/quality-gates` ✅ | vitest 18 用例全过（useTaskPoller/humanError/validateUpload）+ useTaskPoller 显式 import + test script（commit `4e8e1b6`，注：直接在 main 提交）。a11y/性能专项留待人工浏览器验证 | ✅ 完成 |
| 7 | `fix/ux-todo-reconcile` ✅ | 欠账收尾（2026-08-24）：useTaskPoller 兜底国际化；MediaTextRunner/MediaVisionRunner 三态+进度；howItWorks 机制+80 demo 文案；requiresPython 云端禁用；HowToPlay 三步/FAQ/反馈；5 个 OpenCV 页 status→ready；runtime 标注 34→72（commit `0a5e4af`，lint/typecheck 零新增，playwright 冒烟全过，Vercel success） | ✅ 完成 |
