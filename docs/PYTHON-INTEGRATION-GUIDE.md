# Python 工具集成指南（Nuxt AI 技术演示）

本文档把本项目多次集成 Python 工具（音频分离、语音克隆等）的经验沉淀成标准流程，
目标是：**新工具集成更快、更稳、不重复踩坑**。

---

## 一、总体架构（先理解再动手）

```
前端页面 (app/pages/<category>/<slug>.vue)
    │  multipart 上传（文件 + 参数）
    ▼
API (server/api/<category>/<slug>.post.ts) ── 立即返回 taskId
    │
    ▼
异步任务队列 (server/utils/<slug>-queue.ts)
    │  并发限制 + 进度 + 取消 + 线程限制
    ▼
Python 常驻 Worker (python/<category>/<slug>/worker.py)
    │  模型只加载一次，stdin/stdout JSON 协议
    ▼
输出 → public/generated/<slug>/xxx → 前端播放/下载
```

**为什么必须异步？** Python 的 CPU 密集任务（模型加载/推理）通常耗时几十秒到几分钟，
同步请求会让 HTTP 超时；必须"提交即返回 taskId + 前端轮询"。

**为什么必须常驻 Worker？** 大模型（如 XTTS 1.8GB）每次重新加载要 40-60 秒，
常驻进程只加载一次，后续任务秒级复用。

---

## 二、集成 7 步流程

### 第 1 步：创建 Python 模块 `python/<category>/<slug>/`

必须包含：

| 文件 | 作用 |
|---|---|
| `main.py` | 命令行入口（argparse），供测试/调试 |
| `worker.py` | 常驻 worker：加载模型一次，循环处理 stdin JSON |
| `requirements.txt` | 依赖清单 |
| `.python-version` | 指定 Python 版本（如 `3.11`），**没有则用系统默认** |
| `download_model.py` | 模型下载（断点续传 + hf-mirror 镜像支持） |

**worker.py 协议（stdin/stdout 每行一个 JSON）**：
```python
# 输入（Node 写入 stdin）：
{"ref": "...", "text": "...", "lang": "zh-cn", "out": "..."}
# 输出（Python 打印到 stdout）：
{"type": "ready", "device": "cpu"}        # worker 启动
{"type": "loaded"}                         # 模型加载完成
{"type": "done", "out": "..."}             # 任务完成
{"type": "error", "error": "..."}          # 任务失败
```

### 第 2 步：后端异步队列 `server/utils/<slug>-queue.ts`

直接复制 `server/utils/voice-clone-queue.ts` 改造（它是当前最完整的模板）：
- `enqueue<Name>()` — 创建任务（校验参数）
- `get<Name>Task()` — 查询
- `cancel<Name>Task()` — 取消（kill worker）
- 状态机：`queued → preparing → loading → synthesizing → done/error/cancelled`
- 并发上限 1（大模型），线程数用环境变量限制

### 第 3 步：API 路由 `server/api/<category>/<slug>/`

```
<slug>.post.ts        # 接收 multipart，创建任务，返回 { ok, taskId }
[id].get.ts           # 轮询状态
[id].delete.ts        # 取消
```

### 第 4 步：前端页面 `app/pages/<category>/<slug>.vue`

复制 `voice-clone.vue` 模板：上传 → 参数 → 提交 → 轮询进度（进度条+取消）→ 播放/下载。

### 第 5 步：注册 + 文案

- `app/utils/demos.ts`：在 `demos` 数组加对象（**图标必须是 lucide 集合里真实存在的**）
- `i18n/locales/zh.json` / `en.json`：加 `<slug>` 文案块

### 第 6 步：环境与模型

- 首次启动自动建 venv（`python-setup` 插件扫描 requirements.txt）
- 首次使用自动下载模型（`download_model.py` 走 `HF_ENDPOINT` 镜像）
- 大模型放用户目录（不进 git），`tmp/` 与 `public/generated/` 已 gitignore

### 第 7 步：验收（对照检查清单）

**推荐用脚手架脚本一键生成骨架**：
```bash
node scripts/create-python-feature.mjs \
  --category speech --slug my-tool \
  --title-zh "我的工具" --title-en "My Tool" \
  --desc-zh "描述" --desc-en "Description" \
  --python 3.11 --icon i-lucide-radio
```

---

## 三、血泪踩坑清单（务必对照）

### 🔴 P0（必踩，导致功能不可用）

| 坑 | 症状 | 解决 |
|---|---|---|
| **Windows stdin/stdout 编码** | 中文乱码 / `TextInputSequence must be str` | worker.py 里 `sys.stdin/stdout/stderr.reconfigure(encoding="utf-8")`；Node 发送 JSON 默认 UTF-8 |
| **Python 版本不符** | coqui 要 3.11，demucs 要 3.13，装了跑不起来 | `.python-version` 约定 + python-setup 自动 `py -x.y` |
| **模型未下载/路径错误** | 运行时卡在下载/报错 | 用 `download_model.py`（hf-mirror + 断点续传）；模型放用户目录 |
| **每次任务重载大模型** | 每次合成/分离 40-60 秒 | 必须用常驻 worker（模型只加载一次） |

### 🟡 P1（体验差）

| 坑 | 解决 |
|---|---|
| torch 吃满 CPU 拖慢系统 | `torch.set_num_threads()` / 环境变量限制 |
| 前端干等无反馈 | 异步队列 + 进度条 + 取消按钮 |
| 文案误导（"首次需下载"写死） | 检测模型缓存，区分"加载中/下载中" |
| lucide 图标不存在 | 用 `@iconify-json/lucide` 校验图标名（如 `scan-voice` 不存在 → `mic-vocal`） |
| 上传格式多样 | 统一 ffmpeg 转标准格式（wav 44.1k 单/双声道按需） |

### 🟢 P2（规范）

- Python 输出加 `flush=True`（否则管道读不到）
- worker 空闲超时自动退出（释放内存），下次任务自动重启
- 单任务超时保护（kill + 报错）
- 取消任务 = kill worker（下次任务重新加载，可接受）
- 前端轮询间隔 1.5-2s；离开页面停止轮询

---

## 四、验收检查清单

- [ ] 页面 200，图标正常渲染，i18n 无警告
- [ ] API：POST 返回 taskId，GET 状态流转正确，DELETE 取消生效
- [ ] 首次调用：环境自动建好 / 模型下载完成（日志无报错）
- [ ] 第二次调用：worker 复用，无"加载模型"等待（或文案正确）
- [ ] 系统 CPU 不被吃满（线程已限制）
- [ ] 中文输出无乱码（stdin/stdout 编码已处理）
- [ ] 结果文件可播放/下载
- [ ] 云端（如有）：无 Python 时优雅提示
- [ ] git push 后 `.venv/tmp/public/generated/模型` 均未被提交

---

## 五、模板参考

| 现成模板 | 位置 |
|---|---|
| 完整异步队列 + worker | `python/speech/voice-clone/` + `server/utils/voice-clone-queue.ts` |
| 前端页面 | `app/pages/speech/voice-clone.vue` |
| 环境自动搭建 | `server/utils/python-setup.ts` |
| 模型下载 | `python/speech/voice-clone/download_model.py` |
