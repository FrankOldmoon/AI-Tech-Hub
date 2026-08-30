# AI Hub AI体验中心 - 部署与维护手册

> 部署日期：2026-08-28
> 服务器：10.28.1.152（Ubuntu 26.04，hostname `aihub`，VMware 虚拟机 4vCPU/8G/1.9T）
> 分支：`feat/self-host-deploy`（自托管部署模式）
> 访问地址：**https://10.28.1.152**（HTTP 自动跳转 HTTPS）

---

## 一、架构

```
学生浏览器 ──HTTPS(443)──> nginx (10.28.1.152)
                              │ 反向代理
                              ▼
                   node .output/server/index.mjs (127.0.0.1:3000)
                              │
                              ▼
             /www/wwwroot/aihub/.output/public/model/  (本地模型，~28GB)
```

- **Nitro 独立部署**：`systemd` 服务 `aihub.service`，以 `www` 用户运行，端口 127.0.0.1:3000
- **nginx**：443 HTTPS（自签名证书）+ 80 强制跳转 443；`/model/` 长缓存 + Range 支持
- **全部模型本地化**（约 28GB）：transformers.js / webllm / MediaPipe / TF.js / whisper
- **无数据库**：任务队列在内存（重启即丢），产物在 `.output/public/generated/`

## 二、维护常用命令（SSH: mxadmin@10.28.1.152）

```bash
# 服务状态 / 重启
systemctl status aihub          # 状态
systemctl restart aihub         # 重启
journalctl -u aihub -n 100 -f   # 看日志

# nginx
nginx -t                        # 配置检查
systemctl reload nginx

# 站点目录
cd /www/wwwroot/aihub
```

## 三、更新网站代码

```bash
cd /www/wwwroot/aihub
sudo -i
git config --global --add safe.directory /www/wwwroot/aihub   # 一次即可
export PATH=/usr/local/bin:$PATH
export NUXT_PUBLIC_SELF_HOSTED=true
cd /www/wwwroot/aihub
git pull origin feat/self-host-deploy
pnpm build                      # 构建（约 5-30 分钟，视改动）
chown -R www:www .output public
mkdir -p .output/public/generated
systemctl restart aihub
```

## 四、模型管理

模型存两处（`public/model/` 为源，构建时拷入 `.output/public/model/`）：
- 改动源 `public/model/` 后需重新 `pnpm build` 才会生效
- 已上传模型：`transformers/`（NLP/视觉/whisper/全部 ASR）、`webllm/`（4 个对话模型）、`mediapipe/`、`tfjs/`、`mnist/`

**已知缺口（未上传，对应 demo 会报错）**：
- `Xenova/paraphrase-multilingual-MiniLM-L12-v2`（text-training 多语言）
- `Xenova/codegen-350M-mono`、`Xenova/tiny_starcoder_py`（codegen 的 2/3 选项）
- `onnx-community/Qwen2.5-Coder-0.5B-ONNX`（codegen 的 Qwen 选项）
- `onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX`（推理对话）
- `onnx-community/Janus-Pro-1B-ONNX`（多模态备选）
- `onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX`（情绪识别）
- `HuggingFaceTB/SmolVLM-256M-Instruct`（多模态对话）

补传工具：本机 `D:\YIN-PROJE\_tools\stream_models.py`（HF→本机管道→服务器，不占本地磁盘）。
用法：`$env:SRVPW="密码"; py -3 -X utf8 stream_models.py <repo_id>...`（只传 quantized/int8/uint8/fp16 + 元数据）。
⚠️ HF 被学校网络墙，只有**本机**能连 huggingface.co；服务器只能通过 `/api/hf` 反代 hf-mirror，但 **hf-mirror 现在 308 重定向回 huggingface.co（被墙）**，所以服务器侧无法直接补模型，必须走本机管道。

## 五、HTTPS 与证书

- 当前为**自签名证书**（/etc/nginx/ssl/aihub.crt，有效期 10 年，SAN 含 10.28.1.152）
- 浏览器首次访问会提示"不安全"：点 **高级 → 继续前往** 即可
- **让全校免告警**：把 `aihub.crt` 分发给学生机，装入"受信任的根证书颁发机构"（建议 IT 统一推送）
- **更正规方案**：若学校给 `aihub.oldmoon.cn` 之类域名 + 内网 DNS，可改用 Let's Encrypt 证书（需 80 端口对外可达或 DNS-01 验证）

## 六、已知限制与 Phase 2

1. **Python 后端未启用**（`NUXT_SKIP_PYTHON_SETUP=1`）：人声分离/照片修复/SD/声音克隆等服务端 demo 显示"后端未启用"。启用需：装 `python3-venv` + 各模块依赖（torch 等，8G 内存需评估并发），然后把 systemd 里 `NUXT_SKIP_PYTHON_SETUP` 去掉、`pnpm build` 加 `NUXT_PUBLIC_ENABLE_PYTHON=true`
2. **云端 LLM 对话未配 key**：`.env` 里 `MOONSHOT_API_KEY`/`DEEPSEEK_API_KEY` 为空
3. **任务产物**存内存队列，服务重启后丢失
4. **服务器内存 8G**：构建时峰值占用高（Vite 6G），多 demo 并发注意
5. 服务器是 **VMware 虚拟机**（非采购单上的 2288HV6 物理配置，4vCPU/8G），硬件与采购单不符需与 IT 确认
