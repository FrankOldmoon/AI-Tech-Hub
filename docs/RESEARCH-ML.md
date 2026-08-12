# ML 分类页新增项目深度调研（/ml）

> 调研时间：2026-08-11
> 调研工具：AnySearch（通用搜索 + 并行批量查询），依据 `nuxt-ai-feature-dev` 与 `python-tool-integration` 两个 skill 的架构决策
> 目标：为 http://127.0.0.1:3000/ml（机器学习分类页）筛选适合新增的演示项目
> 原则：**能浏览器实现的用浏览器（WebGPU/WASM/Web API），浏览器实现不了或效果差的再用 Python 处理并传回浏览器**；本机无 NVIDIA GPU、16GB 内存，Python 侧只跑 CPU 友好的小模型

> **执行状态（2026-08-12）：本路线图已全部按顺序实现并逐个验证通过**，
> `/ml` 现共 17 个 demo（原 2 个 + 新增 15 个），页面均 200、注册/i18n 完整、
> Python 端（auto-train / forecast / anomaly / dim-reduction / svd）API 端到端验证通过。

---

## 1. /ml 页面现状

- 分类定义：`采集样本并训练自定义图像/声音分类器（迁移学习）`
- 现有 demo 仅 2 个，均为浏览器端 Teachable Machine 风格：
  | slug | 方案 | 技术栈 | Python 对照 |
  |------|------|--------|------------|
  | `ml/image-training` | 摄像头采集 → MobileNetV2 特征 → KNN 分类 | TF.js（mobilenet + knn-classifier，已装） | `python/ml/image-training`（MobileNetV2 + sklearn KNN） |
  | `ml/audio-training` | 麦克风采集 → Speech Commands transfer 训练 | TF.js（speech-commands，已装） | `python/ml/audio-training`（YAMNet + sklearn KNN） |
- 已具备的可复用资产：
  - `@tensorflow/tfjs`、`@tensorflow-models/{mobilenet,knn-classifier,speech-commands}`（已装）
  - `@mediapipe/tasks-vision`：`pose-landmarker` 已配置好（`app/utils/mediapipe-vision.ts`），可复用做姿态训练
  - `@huggingface/transformers` + `setupTransformersEnv()` + `/api/hf` 代理（模型本地优先、远程兜底）
  - Python 侧 `python/ml/` 已有 venv，装好了 `scikit-learn / tensorflow / numpy / pillow`
  - 异步任务队列模板（`python-tool-integration` skill 的 `create-python-feature.mjs`）
  - 云端部署（Vercel）自动切换远程模型（`app/utils/remote-models.ts`）
- 结论：/ml 目前只有「图像 + 声音」两种迁移学习训练，**模式单一**；但 ML 教学/演示空间非常大，且大量可零依赖或复用现有依赖实现。

---

## 2. 候选项目总览

> 🖥 = 纯浏览器；🐍 = Python 后端（异步队列 + 常驻 worker，传回浏览器）；工作量 S<1天 / M 1-3天 / L 3-5天

| # | 项目 | 实现方式 | 关键依赖 / 模型 | 工作量 | 优先级 |
|---|------|---------|----------------|--------|--------|
| 1 | **姿态训练 Pose Training** | 🖥 ✅ | 复用 MediaPipe pose-landmarker + KNN（零新增） | S-M | **P0** |
| 2 | **文本训练 Text Training** | 🖥 ✅ | transformers.js 嵌入（MiniLM ~23MB，走 /api/hf）+ KNN | S-M | **P0** |
| 3 | **神经网络游乐场 Neural Playground** | 🖥 ✅ | 手写 MLP + canvas（零模型下载，可参考 TensorFlow Playground） | M | **P0** |
| 4 | **CSV 自动训练 AutoTrain** | 🐍 ✅ | sklearn（已装）逻辑回归/随机森林/SVM 对比 | M | **P0** |
| 5 | **MNIST 手写数字训练** | 🖥 ✅ | TF.js CNN + 内置 MNIST 数据（~10MB） | M | P1 |
| 6 | **K-Means 聚类可视化** | 🖥 ✅ | 手写 K-Means++（<200 行） | S | P1 |
| 7 | **回归拟合 Regression** | 🖥 ✅ | TF.js layers + canvas | S | P1 |
| 8 | **强化学习 CartPole** | 🖥 ✅ | TF.js policy gradient（参考 tfjs-examples/cart-pole） | M-L | P1 |
| 9 | **时间序列预测 Forecasting** | 🐍 ✅ | statsmodels ARIMA/Holt-Winters（新增依赖，CPU 友好） | M | P1 |
| 10 | **异常检测 Anomaly Detection** | 🐍 ✅ | sklearn IsolationForest（已装） | S-M | P1 |
| 11 | **决策树可视化 Decision Tree** | 🖥 ✅ | 手写 ID3/CART + canvas 树图 | M | P2 |
| 12 | **神经进化 Flappy Bird** | 🖥 ✅ | 手写 NN + 遗传算法（参考 xviniette/FlappyLearning） | M-L | P2 |
| 13 | **图像主色调提取（K-Means 应用）** | 🖥 ✅ | 手写 K-Means + canvas | S | P2 |
| 14 | **降维可视化 PCA/t-SNE** | 🐍 ✅ | sklearn（已装） | M | P2 |
| 15 | **推荐系统（MovieLens SVD）** | 🐍 ✅ | 手写 ALS-SVD（MovieLens 100K，~2MB 内置数据） | M | P2 |

> ✅ = 已实现并验证通过

---

## 3. P0 重点项目详述

### 3.1 姿态训练 Pose Training（🖥 浏览器，延续 Teachable Machine 第三模式）

**做什么**：摄像头实时检测身体姿态 → 关键点归一化 → 按住采集样本 → KNN 实时分类自定义动作（Y/M/C/A 字母、挥拳、比心等）。

**为什么适合**：
- Google Teachable Machine 官方三大模式为 images / sounds / poses，本项目已有图像、声音两种训练，补上姿态即构成完整闭环；
- `@mediapipe/tasks-vision` 的 `pose-landmarker` 已配置好（`mediapipe-vision.ts` 中 `detectForVideo` + 33 个关键点绘制），**零新增依赖**；
- 与现有 `image-training` 交互模式一致（3 类、按住训练、实时预测），可大量复用页面结构。

**实现要点**：
- 新建 `app/pages/ml/pose-training.vue`（复用 `MediaDemoShell` + `DemoParams`）；
- 关键点**归一化**：以髋部（或肩部中心）为原点、以关键点包围盒尺寸缩放，避免人物距离/体型影响；
- 特征向量 = 33×2（或 33×3）归一化坐标 → `knn-classifier.addExample()`；
- 注册 `demos.ts` + i18n（zh/en），Python 对照 `python/ml/pose-training/main.py`（MediaPipe Python 版 + sklearn KNN）。

### 3.2 文本训练 Text Training（🖥 浏览器，Teachable Machine 文本版）

**做什么**：输入文本样本分若干类（如 好评/差评/中性，或任意主题），用句子嵌入 + KNN 实时分类；是「少样本文本分类」的教学 demo（MIT Media Lab 有同款 Text Classifier）。

**为什么适合**：
- 把「训练分类器」从图像/声音扩展到文本，展示迁移学习在不同模态的通用性；
- 用已装的 `@huggingface/transformers` 做 `feature-extraction`（`Xenova/all-MiniLM-L6-v2`，量化约 23MB，走 `/api/hf` 代理，本地优先），**无需新增 npm 依赖**；
- 可加多语言模型（`paraphrase-multilingual-MiniLM-L12-v2`，~118MB）做中文场景。

**实现要点**：
- `pipeline('feature-extraction', model)` 输出 token 向量 → **mean pooling** → L2 归一化 → KNN；
- 输入为多行文本框（每行一条样本），可添加/删除类；实时输入单条文本做预测；
- 注意首次加载模型进度条（复用 transformers.js 的 `progress_callback` 模式）。

### 3.3 神经网络游乐场 Neural Playground（🖥 浏览器，经典教学标杆）

**做什么**：2D 数据点分类/回归，可调网络层数/神经元数/激活函数/学习率/正则化，实时训练并可视化决策边界与神经元权重（即 playground.tensorflow.org）。

**为什么适合**：
- 是机器学习教育领域最经典的交互演示，**零模型下载**、纯前端 canvas + 手写 MLP（或 tfjs layers）；
- 与「机器学习」分类定位完全一致，视觉冲击力强、演示效果好；
- 官方开源（Apache-2.0），可移植或参考实现。

**实现要点**：
- 参考 [tensorflow/playground](https://github.com/tensorflow/playground) 简化移植：内置 circle/exclusive-or/gaussian/spiral 等数据集 + 手写 2 层 MLP + canvas 渲染决策边界；
- 训练用分帧（requestAnimationFrame 每帧跑若干 batch），避免卡死 UI；
- 可先用简化版（固定 1-2 隐藏层）上线，再逐步补齐参数。

### 3.4 CSV 自动训练 AutoTrain（🐍 Python 后端，最实用的「机器学习工作台」）

**做什么**：上传 CSV → 选择目标列 → 自动判别分类/回归 → 同时训练逻辑回归 / 随机森林 / SVM / KNN → 展示准确率、F1、R²、混淆矩阵、特征重要性 → 支持对单行/上传文件预测。

**为什么适合**：
- 「机器学习」分类最实用的演示：让用户用自己的表格数据体验完整训练流程；
- `python/ml/` venv **已装 sklearn**，纯 CPU 秒级训练，无 torch 依赖；
- 完全符合 `python-tool-integration` skill 的标准流程（脚手架 → 异步队列 → API → 页面），模板可直接套用。

**实现要点**：
- `python/ml/auto-train/`：`main.py`（pandas 读 CSV → 自动预处理 → 多模型训练 → 输出 JSON 指标）+ `worker.py` 常驻（可选，sklearn 模型较小，可先同步 + 队列兜底）；
- 前端 `app/pages/ml/auto-train.vue`：上传 + 选列 + 训练进度 + 结果图表（前端渲染后端 JSON，不依赖 echarts 也能用 Nuxt UI 表格 + 自绘 chart）；
- 限制：文件 ≤ 10MB、行数 ≤ 5 万、类别数 ≤ 20，防卡死；
- 云端（Vercel）优雅降级提示（与 speech 模块一致的 `cloudUnavailable` 文案）。

---

## 4. P1 项目简述

| 项目 | 说明 | 备注 |
|------|------|------|
| **MNIST 手写数字训练** | 浏览器内训练 CNN/MLP 识别 0-9，实时 loss/accuracy、画板手写测试、混淆矩阵 | 参考 [nomi30701/mnist-playground-tfjs](https://github.com/nomi30701/mnist-playground-tfjs)（WebGPU 优先、WebGL 兜底）；MNIST 数据压缩约 10MB 放 `public/model/` |
| **K-Means 聚类可视化** | 画布点集 + 步进迭代（Lloyd），可调 K、显示质心与 inertia 下降 | 参考 visualize-it / kanaries 交互；手写 K-Means++ 约 200 行，零依赖，无监督学习入门 |
| **回归拟合** | 画布点出数据 → 选线性/多项式 → SGD 实时拟合曲线 + loss 曲线 | 参考 tfjs-examples/polynomial-regression、Google Codelab tfjs-training-regression |
| **强化学习 CartPole** | 浏览器内 policy gradient 训练倒立摆，canvas 可视化，实时观看学习过程 | 官方 [tfjs-examples/cart-pole](https://github.com/tensorflow/tfjs-examples/blob/master/cart-pole/README.md) 可移植；分帧训练防卡 UI；支持 IndexedDB 保存模型 |
| **时间序列预测** | 上传 CSV（日期+数值）→ ARIMA/Holt-Winters 拟合并外推 N 天，图表展示历史+预测+置信区间 + 回测 MAE/MAPE | 参考 [forecasting-demo-app](https://github.com/vahdetkaratas/forecasting-demo-app)；需新增 `statsmodels` 依赖（CPU 友好） |
| **异常检测** | 上传 2D 点集或生成数据 → IsolationForest → 图表显示正常/异常点与决策边界 | sklearn 已装，CPU 毫秒级；参考官方 IsolationForest 示例 |

---

## 5. P2 / 远期项目简述

| 项目 | 说明 | 备注 |
|------|------|------|
| **决策树可视化** | 2D 点集上交互构建/展示决策树分裂（信息增益、划分边界） | 教育价值高；暂无成熟开源 playground，需自实现（ID3/CART + canvas 树图） |
| **神经进化 Flappy Bird** | 遗传算法 + 神经网络训练小鸟飞过管道 | 参考 [xviniette/FlappyLearning](https://github.com/xviniette/FlappyLearning)、[DerWaldi/neuroevolution-flappy-birds](https://github.com/DerWaldi/neuroevolution-flappy-birds)；演示性强 |
| **图像主色调提取** | 上传图片 → K-Means（RGB 空间）→ 提取 3-8 色配色板 | 参考 [sen-ltd/color-from-image](https://github.com/sen-ltd/color-from-image)；K-Means 应用型变体，趣味性高 |
| **降维可视化 PCA/t-SNE** | 上传 CSV → PCA/t-SNE 降维 2D 散点 + KMeans 着色 | sklearn 已装；t-SNE 在浏览器也有 karpathy/tsnejs 可选 |
| **推荐系统（MovieLens SVD）** | 内置 MovieLens 100K 小样本 → SVD 矩阵分解 → 输入用户 ID 输出 Top-N 推荐 + 隐因子可视化 | 数据约 5MB 可内置；手写 SGD-SVD 约 100 行或加 `surprise` |

---

## 6. 不建议 / 暂缓

- **自定义目标检测训练**（YOLO 微调等）：训练需要 GPU 与较长时间，与本机「无 GPU」约束冲突；浏览器端只有「加载预训练检测模型」而无训练能力（tfjs-automl 仅支持加载 AutoML Edge 产物），**暂缓**，可留 `planned` 占位。
- **浏览器端 LLM 微调/训练**：LLM 对话已归 AIGC 分类，且浏览器训练大模型不现实。
- **文生图/文生视频**：属 AIGC 分类，不放入 ML；文生视频需 GPU，远期。
- **超参数自动搜索（AutoML 全量）**：网格搜索过重，可并入 AutoTrain 的「模型对比」即可。

---

## 7. 执行顺序建议

```text
Phase 1（P0 · 纯前端 · 快见效 2-3 天）
  └─ 姿态训练（复用 MediaPipe+KNN，零新增依赖）
  └─ 文本训练（transformers.js 嵌入+KNN）
  └─ 神经网络游乐场（canvas + 手写 MLP，零模型下载）
        │
        ▼
Phase 2（P0 · Python · 1-2 天）
  └─ CSV 自动训练（sklearn 已装，套用队列脚手架）
        │
        ▼
Phase 3（P1 · 3-5 天）
  └─ MNIST 手写数字训练 / K-Means 聚类 / 回归拟合 / CartPole
  └─ 时间序列预测（statsmodels）/ 异常检测（IsolationForest）
        │
        ▼
Phase 4（P2/远期 · 可选）
  └─ 决策树 / Flappy Bird / 主色调提取 / 降维可视化 / SVD 推荐
```

---

## 8. 风险与踩坑（对照 skill）

- **注册与 i18n**：每个新 demo 必须注册 `app/utils/demos.ts`（`icon` 用 lucide 校验：`node -e "JSON.parse(...).icons['name']"`），并同时在 `zh.json` / `en.json` 的 `"mp"` 键**前**插入文案；改完用 `JSON.parse` 校验；PowerShell 写文件注意 UTF-8 无 BOM、中文经管道传给 node 会变 `?`。
- **云端部署**：Vercel 上模型走远程源（`remote-models.ts` 扩展）：文本训练用 `/api/hf` 代理；MNIST 数据若本地打包需确认 Vercel 静态资源路径可用，否则改为 CDN（如 jsdelivr）加载。
- **Python worker**：`worker.py` 必须 `sys.stdin/stdout/stderr.reconfigure(encoding="utf-8")`（Windows 中文乱码坑）；`torch.set_num_threads()` 限制 CPU 占用；大任务必须异步队列 + 取消 + 空闲 30 分钟退出。
- **浏览器训练不卡 UI**：Playground / CartPole / MNIST 训练要分帧或放 Web Worker，避免主线程阻塞；离开页面停止训练循环。
- **模型体积提示**：文本训练 MiniLM ~23MB、MNIST 数据 ~10MB，页面要给「下载/加载进度条」并区分「加载中 vs 就绪」。
- **COOP/COEP**：仅 transformers.js 多线程 WASM 需要；文本训练单线程 WASM 可不启用（与现有 NLP demo 一致）。
- **姿态特征归一化**：必须做相对坐标归一化（以髋部为原点 / 除以 bbox），否则同一动作不同距离/身位无法识别。

---

## 9. 参考来源（调研时收集）

- TensorFlow Playground：https://playground.tensorflow.org/ （Apache-2.0，开源）
- tfjs-examples（MNIST / iris / polynomial-regression / cart-pole）：https://github.com/tensorflow/tfjs-examples
- MNIST Training Playground：https://github.com/nomi30701/mnist-playground-tfjs
- Google Codelab（Teachable Machine 迁移学习、TF.js 回归）：https://codelabs.developers.google.com/tensorflowjs-transfer-learning-teachable-machine
- Teachable Machine（官方 images/sounds/poses 三模式）：https://teachablemachine.withgoogle.com
- MIT Media Lab 文本分类器（USE + KNN）：https://robots.media.mit.edu/wp-content/uploads/sites/7/2021/01/Text_classifier.pdf
- tfjs-models KNN demo：https://github.com/tensorflow/tfjs-models/tree/master/knn-classifier/demo
- K-Means 交互：https://visualize-it.github.io/clustering/simulation.html 、https://ml.kanaries.net/playground/kmeans
- 图像主色调 K-Means：https://github.com/sen-ltd/color-from-image
- CartPole：https://github.com/tensorflow/tfjs-examples/blob/master/cart-pole/README.md
- Flappy Learning（神经进化）：https://github.com/xviniette/FlappyLearning
- 时间序列预测参考：https://github.com/vahdetkaratas/forecasting-demo-app 、https://timeseriesdashboard.streamlit.app/
- 异常检测 IsolationForest：https://scikit-learn.org/stable/auto_examples/ensemble/plot_isolation_forest.html
- t-SNE JS：https://github.com/karpathy/tsnejs
- WebSHAP（浏览器内可解释性，P2 备选）：https://poloclub.github.io/webshap/
