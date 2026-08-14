# 项目交接文档（Handoff）

> 整理时间：2026-08-14
> 项目：nuxt_AI（Nuxt 4 全栈 AI Demo 集合站，包名 "nn"）
> 当前分支：main（基线 v0.11.0，2026-08-14 发布完成）
> 基线标签：`pre-ux-audit`（UX 修复前）→ `v0.11.0`（当前基线）

---

## 一、背景：正在进行的工作

依据 `docs/UX-AUDIT.md`（用户体验审计报告）按批次修复 UX 问题。
**工作方式已约定**（用户确认）：

- 按批次切短期特性分支（`fix/<主题>` / `feat/<主题>`），验证通过后 `--no-ff` 合并回 main
- 本项目**无测试、无 CI**，合并门槛 = 改动文件 lint 无新增错误 + typecheck 无新增错误 + 人工冒烟清单
- 每批完成在 UX-AUDIT.md 上勾掉对应项

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
- **零测试**：只有 lint + typecheck（且基线已坏，见坑 #1）
- **关键文件**：`app/utils/demos.ts`（demo 中央注册表）、`app/app.vue`（唯一布局）、`nuxt.config.ts`、`server/api/hf/[...].get.ts`（HF 反代）
- **审计报告**：`docs/UX-AUDIT.md`；**标杆实践参考**：`FaceCamera.vue`（权限处理）、`denoise.vue`（进度+取消）、`asr.vue`（WebGPU→WASM 回退）
- **远端**：`github/main`，本地多个提交未推送
