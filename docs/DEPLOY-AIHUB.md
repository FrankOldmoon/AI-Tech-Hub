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
