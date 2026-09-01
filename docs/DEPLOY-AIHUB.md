# AI Hub AI体验中心 - 部署与维护手册（v2，2026-08-31）

> 服务器：10.28.1.152（Ubuntu 26.04，hostname `aihub`，VM 4vCPU/8G/1.9T）
> 访问地址：**http://10.28.1.152**（2026-09-01 起暂停 SSL，恢复 HTTP 80 直连；证书保留可随时恢复 HTTPS）
> 分支：main（含 feat/self-host-deploy + fix/deploy-runtimeconfig）

---

## 一、架构（v2）

```
学生浏览器 ──HTTP:80──> nginx（2026-09-01 起暂停 SSL/443，证书保留在 /etc/nginx/ssl/，可随时恢复）
   ├── / → 反代 node (.output/server/index.mjs @127.0.0.1:3000)   [Nitro + 页面/API]
   ├── /model/     → alias public/model/     [60G 本地模型，nginx 直出，长缓存 + Range]
   ├── /generated/ → alias public/generated/ [Python 任务产物，nginx 直出]
   ├── /apps/rebot-arm/   → Nitro 静态（public/apps/rebot-arm/）[独立应用前端，iframe 嵌入]
   ├── /api/apps/rebot-arm/ → Nitro API（URDF/STL/配置；模型在 server/assets/apps/rebot-arm/）
   └── /api/hf/    → 反代 node（转 hf-mirror，备用）
```

**关键变化（v2）**：
1. **模型/产物不再走 Node**（Nitro 静态清单不含构建后加入的文件，且 60G 会让构建 OOM）
   → nginx 直接 `alias` 源码 `public/model` 与 `public/generated`
2. **自托管/Python 标志用 `runtimeConfig.public`**（`import.meta.env` 不内联 `NUXT_PUBLIC_*`，此前是隐藏 bug）
   → `nuxt.config.ts` 声明 `runtimeConfig.public.selfHosted/enablePython`，构建/运行环境变量 `NUXT_PUBLIC_SELF_HOSTED=true`、`NUXT_PUBLIC_ENABLE_PYTHON=true`
   → `app/plugins/deploy-config.ts` 启动时注入 `remote-models.ts`
3. **Python 后端已启用**（服务端 worker 队列，非全部 demo）

## 二、维护常用命令

```bash
systemctl status/restart aihub     # 服务
journalctl -u aihub -n 100 -f      # 日志
nginx -t && systemctl reload nginx # nginx
cd /www/wwwroot/aihub
```

## 三、更新网站代码

```bash
cd /www/wwwroot/aihub
sudo -i
export PATH=/usr/local/bin:$PATH
export NUXT_PUBLIC_SELF_HOSTED=true NUXT_PUBLIC_ENABLE_PYTHON=true
# ⚠️ 60G 模型会让构建 OOM：构建前暂移模型，构建后放回（nginx 直读源码目录，无需拷进 .output）
mv public/model /opt/aihub-model-stash
git pull origin main
pnpm build
mv /opt/aihub-model-stash public/model
chown -R www:www .output public python
mkdir -p .output/public/generated
systemctl restart aihub
```

## 四、Python 后端状态（2026-08-31 实测）

| 模块 | 状态 | 说明 |
|---|---|---|
| 语音克隆 voice-clone | ✅ 实测通过 | XTTS-v2 1.8G，首次加载 40-60s，之后秒级；**coqui-tts 降到 0.26.2**（0.27 硬性要求 torchcodec，pip 版为 CUDA 专属、CPU 版不兼容 FFmpeg 8），worker 显式 `torchaudio.set_audio_backend("soundfile")` |
| 人声分离 separation | ✅ 依赖就绪 | demucs 4.1 + torch 2.13 CPU + ffmpeg；main.py 用 soundfile 直读音频，不受 torchcodec 影响；模型首次使用自动下载 |
| 异常检测/自动训练/降维/预测 ml/* | ✅ 实测异常检测通过 | sklearn/pandas，纯 CPU 无模型 |
| TTS | ✅ | 纯 Node 实现（edge-tts 协议），无需 Python |
| 图像/人脸/MediaPipe 参考实现 | ✅ 依赖就绪 | opencv/insightface/mediapipe（已装 libgl1） |
| 照片修复/文生图/音乐生成/唇形/降噪/VAD/会议/翻译 | ⚠️ 未装依赖 | torch 大模型 + HF 模型被墙，Phase 3 |

**启用/禁用 Python demo**：改 `NUXT_PUBLIC_ENABLE_PYTHON`（构建时）→ 重建。当前=开。
**venv 管理**：手动（`NUXT_SKIP_PYTHON_SETUP=1` 关掉开机自动建 venv，因为其在 3.11 下会建出无 pip 的 venv 且失败安装不会重试）。各模块 venv 已按 `.python-version` 建好（3.11/3.13/3.14）。

## 五、已知限制 / 踩坑

1. **HF 被学校网络墙**，hf-mirror 也 308 回源（被墙）。补模型只能**本机管道**：`D:\YIN-PROJE\_tools\stream_models.py`（HF→本机→服务器，不占本地磁盘）
2. **构建 OOM**：public/model 60G 时 `pnpm build` 在 Nitro 打包阶段被 OOM kill（exit 137）。必须"暂移模型→构建→放回"（见第三节）
3. **torchcodec 坑**：pip torchcodec 需 CUDA torch；PyTorch CPU 源的 torchcodec 需旧 FFmpeg（libavutil 56-59），服务器是 FFmpeg 8（libavutil 60）→ 均不可用。解法=coqui-tts 降到 0.26.2 + soundfile 后端
4. **产物路径**：worker 写 `public/generated/`（源码），nginx alias 直出（勿改）
5. **HTTP 80 模式（2026-09-01 起）**：已暂停 SSL/443，证书保留可随时恢复；⚠️ 浏览器只在 HTTPS/localhost 允许麦克风/摄像头，停 SSL 后依赖摄像头/麦克风的 demo（人脸/手势/姿态、图像/声音训练、语音识别录音）在学生会浏览器被禁止，其余 demo 不受影响；如需恢复 HTTPS 或换域名+Let's Encrypt 另说
6. **服务器是 VM**（4vCPU/8G），非采购单 2288HV6 实体配置，需与 IT 确认
7. **云端 LLM 对话**：`.env` 未配 MOONSHOT/DEEPSEEK key
8. 任务队列在内存，重启即丢

## 六、独立应用集成（机械人分类示例）

- **ReBot Arm B601-RS 机械臂仿真器**（`robot/rebot-arm`）：浏览器本地 Three.js 仿真，可选连实体机械臂（rosbridge）或舵机（motorbridge）；LLM 对话未部署（text-agent 未起）
- 目录约定与接入流程见 **`docs/APP-INTEGRATION-GUIDE.md`**：应用前端放 `public/apps/<slug>/`，API 前缀 `/api/apps/<slug>/`，模型放 `server/assets/apps/<slug>/`（gitignore，部署时上传），路径适配用 `scripts/adapt-app-paths.py`
- 原 3002 独立服务（`rebot-arm-web.service`）已下线；模型 68.5MB 在 `server/assets/apps/rebot-arm/`，从本地 `D:\YIN-PROJE\nuxt_AI\server\assets\apps\rebot-arm` 上传（`_tools\upload_rebot_models.py`）

## 七、定时自动部署（2026-09-01 起）

**模式**：本地 push → GitHub(main) → 152 定时从仓库拉取并部署（systemd timer 轮询，非 webhook）。

### 部署脚本（服务器 /opt/aihub-deploy/）
- `sudo /opt/aihub-deploy/deploy.sh`          # 有变更才部署（无变更 SKIP）
- `sudo /opt/aihub-deploy/deploy.sh --force`  # 忽略变更检测，强制部署
- `/opt/aihub-deploy/status.sh`               # 查看状态/日志/定时器（任意用户可跑）

### 定时器
- `aihub-deploy.timer`：每天 03:00 强制 + 每 6h 轮询（`systemctl list-timers aihub-deploy.timer`）
- 触发 `aihub-deploy.service`（Type=oneshot，root 执行 deploy.sh）

### 流程与自愈
1. fetch origin/main，与 `deploy-state.json` 的 `last_success_commit` 比较，无变更则跳过
2. 暂移 `public/model`（60G，防构建 OOM）→ 备份旧 `.output` → `pnpm build`（4 个 env）→ 放回模型
3. 重启 aihub → curl 冒烟（首页 / rebot urdf / 模型文件）
4. 成功：写 state（success）；失败：恢复 `.output.bak` + git 回退到 last_success + 重启（rolled_back）
5. **连续失败 3 次 → `degraded=true` 自动停表**，待人工介入

### 状态与日志
- `/www/wwwroot/aihub/deploy-state.json`：last_success_commit / last_result / consecutive_failures / history(20)
- `/www/wwwroot/aihub/logs/deploy.log`：滚动日志

### 注意
- deploy.sh 需 root 运行（非 root 会提示用 sudo）；手动入口用 `sudo`
- `server/assets/apps/` 已并入 git（rebot 模型随部署自动到位，不再单独上传）；60G `public/model` 仍为服务器持久资产（不入库、部署不动、构建时暂移）
- 更新本地代码后只需 push 到 github main，定时器会在下个周期自动部署
