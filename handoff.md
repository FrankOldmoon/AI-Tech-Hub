# 项目交接文档（Handoff）

> 整理时间：2026-08-14（架构速查已按 2026-09 迭代刷新，见「五」）
> 项目：nuxt_AI（Nuxt 4 全栈 AI Demo 集合站，包名 "nn"）
> 当前分支：main（基线 v0.11.0，2026-08-14 发布完成）
> 基线标签：`pre-ux-audit`（UX 修复前）→ `v0.11.0`（当前基线）

---

## 一、背景：正在进行的工作

依据 `docs/UX-AUDIT.md`（用户体验审计报告）按批次修复 UX 问题。
**工作方式已约定**（用户确认）：

- 按批次切短期特性分支（`fix/<主题>` / `feat/<主题>`），验证通过后 `--no-ff` 合并回 main
- 合并门槛 = 改动文件 lint 无新增错误 + typecheck 无新增错误 + 人工冒烟清单；
  2026-09 起新增 `check:i18n`（script）与 vitest，并接入 GitHub Actions（`.github/workflows/quality.yml`）
- 每批完成在 UX-AUDIT.md 上勾掉对应项

> **2026-09 迭代已收尾**：P0（图标/i18n/CI）、P1（示例素材、iframe locale 同步、中屏导航、部署瘦身）、P2（模型清单 lock、教学纵深、cookie/WebGPU 提示）已按 `docs/model-manifest.md` 与 `docs/DEPLOY-AIHUB.md` 落地，具体见文末「六」。2026-09-10 追加：模型 5.2GB 由 `public/model/` 迁入 `.models/`，新增 `server/routes/model/[...].ts`（Range/206）接管 `/model/*`，构建产物不再含模型，详见 `docs/DEPLOY-AIHUB.md` 第八节。

## 二、已完成的任务

| # | 任务 | 分支（已合并删除） | 结果 |
|---|---|---|---|
| 1 | 提交 WIP + 打基线标签 | 直接在 main | commit `ee91217`，tag `pre-ux-audit` |
| 2 | 分支1：补 i18n 缺失 key | `fix/i18n-missing-keys` → 合并 | commit `3bb8f00`：补 `demo.inputRequired`（P0-3）、en.json 4 处 `?` 改回 `…`、删未用 `welcome`、zh「语音 / Speech」→「语音」 |
| 3 | 分支2：统一任务轮询 | `fix/task-poller` → 合并 | commit `be505e0`：新增 `app/composables/useTaskPoller.ts`（超时 10 分钟上限 + 卸载自动停止 + 网络失败容忍 3 次），替换 **11 个页面**的 `while(true)` 无限轮询（sd-turbo、photo-restore、denoise、separation、voice-clone、meeting、vad、midi、lip-sync、musicgen、speech-translate），各页 `run()` 补防重守卫，新增 i18n key `demo.taskTimeout`。修复 P0-1、P0-2 |

### useTaskPoller 用法（后续页面接入参考）

```ts
const { poll, stop: stopPolling } = useTaskPoller({
  interval: 2000,               // 默认 1500
  progress, progressText, error, // 传入 ref，自动更新
  failMessage: t('demo.backendUnavailable'),   // 查询失败兜底
  cancelledMessage: t('xxx.cancelled'),
  timeoutMessage: t('demo.taskTimeout'),
  onDone: (task) => { resultUrl.value = task.audioUrl || '' },
  onError: task => task.message || task.error  // 可选，自定义消息优先级
})
// 提交任务后：await poll(`/api/xxx/${taskId}`)
// 取消按钮：先 stopPolling() 再 DELETE
```

## 三、当前进行中的任务（卡住/未竟）

### ✅ 任务：发布基线（已完成，2026-08-14）

- 用户最新指示：版本号定为 **0.11**（覆盖此前 v0.1 计划），落为 `0.11.0`
- 已完成：`package.json` 补 `"version": "0.11.0"`；commit `chore: release v0.11.0`；tag `v0.11.0`；合并 `chore/release-v0.1` → main
- 待办（可选）：`git push github main --tags`——远端 `github/main` 领先状态见 git

### 待办任务队列

完整改进计划见 **`docs/IMPROVEMENT-PLAN.md`**（批次 0-6，含验收标准与 git 策略）。摘要：

| 批次 | 分支 | 内容 | 状态 |
|---|---|---|---|
| 1 | `feat/sample-assets` + `fix/ml-poller` | P0-4 示例素材；ML 4 页轮询补齐；demos.ts ready/规划中矛盾 | 待开始 |
| 2 | `fix/error-messages` | 错误 util（86 处）+ 权限 util + i18n 硬编码 + 上传校验 | 待开始 |
| 3 | `fix/runner-ux` | Runner 下载进度/摄像头竞态 + 网格 + 暗色 + 上传组件统一 | 待开始 |
| 4 | `feat/demo-metadata` + `fix/nav-seo` | 注册表 runtime/requirements/featured + 徽章 + 面包屑 + SEO + GitHub 链接 | 待开始 |
| 5 | `fix/polish` | P2 质感清单（复制/空态/历史/教育字段/FAQ） | 待开始 |
| 6 | `chore/quality-gates` | 最小测试（vitest）+ a11y + 性能 | 待开始 |

## 四、踩过的坑（重要）

1. **lint/typecheck 基线本来就是坏的**：main 上 eslint 有 1724 个存量错误（116 个文件）、typecheck 有 555 个存量错误。「lint 通过」不能作为验收标准——只能用**对比基线、不新增错误**的方式验收（做法：`git show HEAD:<file> > tmp/base-x.vue`，eslint 加 `--no-ignore` 对比改动前后错误数）。
2. **pnpm 不在 PATH**：本机只有 node/npm/npx。用 `./node_modules/.bin/eslint`、`./node_modules/.bin/nuxi typecheck` 直接调本地 bin。
3. **Git Bash 转义地狱**：`node -e` 内联脚本里写 `\\` 正则会被 bash 吃掉，`--eslintrc` 这类 ESLint9 已废弃选项会报错。经验：复杂脚本写成 `tmp/*.cjs` 文件再跑（`tmp/` 已 gitignore，是项目约定的草稿目录）。
4. **`cd` 在 Bash 工具会话间会保持**：曾经 `cd tmp` 后忘了回来，导致后续命令报 `No such file or directory`。跑项目命令前确认在 `/d/YIN-PROJE/nuxt_AI`。
5. **代码库 eslint 规则与存量代码风格冲突**（`no-explicit-any`、`vue/singleline-html-element-content-newline` 等）：新文件要保持 lint 干净（`useTaskPoller.ts` 用 `TaskData = Record<string, any>` + 单行 eslint-disable 注释解决），但不要顺手"修复"存量文件的风格错误——会让 diff 爆炸。
6. **子代理 API 超时**：此前派 Explore 代理用 `very thorough` 广度多次超时失败，降到 `medium` 后成功。大任务拆小、降低搜索广度更稳。

## 五、项目关键事实速查

- **架构**：Nuxt 4（`app/` 目录）+ Nitro；浏览器端推理（transformers.js/WebLLM/MediaPipe/TF.js/ONNX/Pyodide）为主，重任务走 server 队列（`server/utils/*-queue.ts`，内存 Map，**重启即丢**）spawn Python venv 子进程
- **前后端通信**：纯 HTTP + 轮询，无 SSE/WebSocket
- **无数据库**：localStorage（人脸库）、Cache API（模型分片）、`public/generated/<taskId>/`（任务产物）
- **测试**：vitest（24 例）+ `check:i18n`（`.github/workflows/quality.yml`，pnpm 11 + node 22）；lint/typecheck 基线仍有存量错误（~1724/555），验收用「对比基线、不新增错误」，见坑 #1
- **关键文件**：`app/utils/demos.ts`（demo 中央注册表）、`app/layouts/default.vue` + `app/layouts/bare.vue`（布局）、`app/components/DemoIframeLoader.vue`（重型 iframe 按需加载）、`nuxt.config.ts`、`server/api/hf/[...].get.ts`（HF 反代，模型按需拉取）、`server/routes/model/[...].ts`（本地模型 API，Range/206，从 `.models/` 服务 `/model/*`）、`server/utils/model-downloader.ts`（预下载到 `.models/`）、`scripts/trim-production-assets.mjs`（构建防御清理）、`scripts/check-i18n.mjs`（i18n 校验）
- **模型清单**：`docs/model-manifest.md`（权威 lock：目录/占用/预下载/按需清单/裁剪方法）
- **模型目录**：`.models/`（2026-09-10 由 `public/model/` 迁入；不随构建产物，`MODELS_DIR` env 可覆盖；不用 `storage/` 命名是为避开全局 gitignore 的 `storage` 规则导致 yolo 入库例外失效）
- **审计报告**：`docs/UX-AUDIT.md`；**标杆实践参考**：`FaceCamera.vue`（权限处理）、`denoise.vue`（进度+取消）、`asr.vue`（WebGPU→WASM 回退）
- **远端**：`github/main`，本地多个提交未推送

## 六、2026-09 迭代成果（P0-P2 已收尾）

| 批次 | 成果 | 落地位置 / 说明 |
| --- | --- | --- |
| P0-1 | 无效 lucide 图标名修复 | `demos.ts` 两处（`i-lucide-bot` / `i-lucide-mic-vocal`） |
| P0-2 | i18n 缺 key 补齐 | `neuralSandbox.externalNote` 等；此后由 check:i18n 防回归 |
| P0-3 | i18n 校验 + CI | `scripts/check-i18n.mjs` + `.github/workflows/quality.yml`（check:i18n + vitest 24 例） |
| P1-1 | 示例素材「试试示例」 | transformers 5 任务 × 2 groups + MediaTextRunner samples（13 双语 key） |
| P1-2 | iframe locale 同步 | `useIframeLocale.ts`（src 追加 `?locale=`）；**21 个子应用 index.html 统一改为 query 优先/浏览器语言回落**（此前参数不消费、语言不跟随） |
| P1-3 | 中屏导航断层 | `app.config.ts` 覆盖 UHeader center/toggle、AppHeader 断点与 `UNavigationMenu` 微调；852px 实测可达 |
| P1-4 | 部署瘦身 | `DemoIframeLoader.vue`（7 重型页点击后加载）；`scripts/trim-production-assets.mjs` 接入 build；`DEPLOY-AIHUB.md` 第八节 |
| P2-1 | 模型清单 lock | `docs/model-manifest.md`（含裁剪方法，与 download-models.ts 联动） |
| P2-2 | 教学纵深 | `RuntimeStats.vue`（fps 徽章，接入 flappy）；Runner 模型卡（TransformersTextRunner/MediaTextRunner）；robot 分类文案去「敬请期待」；本文档架构速查刷新 |
| P2-3 | 合规与提示 | cookie 告知组件 + WebGPU 兼容提示（见下批次备注） |
