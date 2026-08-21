# /vision 各 Demo 样本图搜索关键词表

> 用途：为 /vision 下每个 demo 选"最能体现其能力"的示例图。选图原则：
> 1. 特征明显 > 美观：清晰、正面、无遮挡、主体大，确保模型稳定出结果
> 2. 人物图优先 Pexels/Unsplash（模特已授权）或 Wikimedia Commons CC0/公有领域；避免商业图库
> 3. 来源优先级：Wikimedia Commons(CC0/PD) > Unsplash > Pexels > Google Images(需核许可)
> 4. 验收：下载后在对应 demo 页面实测能否出结果再入库
> 5. 更新于 2026-08-21（配合 ImageLab 按页样本机制）

## A. MediaPipe 检测类

| Demo | 能力要点 | 中文关键词 | English keywords | 推荐来源 |
|---|---|---|---|---|
| face-detection 人脸检测 | 多人、正面、无遮挡 | 多人合影正面脸部高清图 | group photo frontal faces HD | Unsplash/Pexels/Wikimedia(CC0) |
| face-landmarker 人脸关键点 | 单人正面大脸、五官清晰 | 单人正面大头照五官清晰无遮挡 | single frontal face close-up clear features | Pexels/Wikimedia(CC0) |
| hand-landmarker 手势关键点 | 张开手、五指分明 | 张开手掌五指分开特写 | open palm hand close-up fingers spread | Pexels/Unsplash |
| gesture-recognizer 手势识别 | 识别出具体手势 | 拇指点赞手势特写 / 胜利V手势特写 | thumbs up / victory peace sign hand | Unsplash/Wikimedia(CC0) |
| pose-landmarker 姿态估计 | 全身、动作明显 | 瑜伽全身姿势照 | yoga pose full body | Wikimedia(PD)/Pexels |
| holistic-landmarker 整体检测 | 脸+双手+姿态全可见 | 演讲者双手比划全身照 / 手语演示 | speaker gesturing / sign language full body | Wikimedia(CC0)/Pexels |
| object-detector 目标检测 | 多类物体 | 桌面多物体杂乱照 / 街道车辆行人 | desk multiple objects / street cars people | Unsplash/Pexels |
| image-classifier 图像分类 | 单一主体、类别明确 | 单一主体清晰照（猫/狗/水果） | single clear subject cat dog fruit | Unsplash/Pexels |

## B. 分割/深度/描述类

| Demo | 能力要点 | 中文关键词 | English keywords | 推荐来源 |
|---|---|---|---|---|
| image-segmenter 图像分割 | 单人物、前景背景分明 | 单人半身像纯净背景 | single person clean background | Pexels/Wikimedia(CC0) |
| interactive-segmenter 交互式分割 | 主体边界清晰、点一下分开 | 人物与背景对比强烈照 | person strong contrast vs background | Pexels/Wikimedia(CC0) |
| depth-estimation 深度估计 | 近中远景层次 | 街道近远景层次分明照 | street scene depth layers | Unsplash |
| image-captioning 图像描述 | 元素丰富可描述 | 风景多元素（山/水/人/动物） | landscape scene with people animals | Unsplash/Wikimedia |
| bg-removal 智能抠图 | 复杂边缘（发丝） | 人物发丝清晰背景杂乱照 | person detailed hair busy background | Pexels/Wikimedia(CC0) |
| image-embedder 图像嵌入 | 语义对比 | 单人照 vs 多人照对比组 | portrait vs group pair | Pexels |

## C. 图像工坊（Image Lab）

| Demo | 能力要点 | 中文关键词 | English keywords | 推荐来源 | 当前/建议样本 |
|---|---|---|---|---|---|
| viewer 图像查看器 | 高清细节 | 高清风景大图 | high-res landscape | Unsplash | urban-street.jpg |
| transform 图像变换 | 缩放/旋转等 | 高清人物半身像 | high-res portrait | Pexels | portrait.jpg |
| pixel 像素处理 | 色块/马赛克 | 色彩分块几何图案 | color blocks geometric | Wikimedia(PD) | portrait/landscape |
| color 颜色处理 | 色彩变化 | 色彩鲜艳高对比 | vibrant high-contrast | Unsplash | urban-street.jpg |
| adjustment 图像调整 | 明暗/色温 | 逆光明暗对比强烈照 | backlit strong contrast | Unsplash | street.jpg |
| filters 图像滤镜 | 风格化 | 人像或风景原图 | portrait or landscape original | Pexels/Unsplash | portrait/landscape |
| enhancement 噪声与增强 | 降噪/去模糊 | 低光噪点照片 / 轻微模糊照 | low-light noisy / slightly blurry | Pexels | noisy.jpg（生成，高斯噪点） |
| morphology 阈值与形态学 | 二值化/形状 | 黑白印刷文字 / 几何形状 | printed text / geometric shapes | Wikimedia(PD) | shapes.jpg（生成，几何图形） |
| edge 边缘与形状检测 | 高对比线条 | 建筑棱角线条清晰照 | building sharp edges lines | Unsplash | street.jpg（既有，含建筑线条） |
| object 颜色与物体检测 | 色块识别 | 彩色水果或玩具摆拍 | colorful fruits toys | Pexels | colorful.jpg（生成，彩色块） |
| features 特征检测 | 角点/纹理 | 棋盘格或纹理丰富墙面 | checkerboard textured wall | Wikimedia(PD) | checkerboard.jpg（生成） |
| face 人脸视觉 | 人脸处理 | 正面人像清晰五官 | frontal portrait clear features | Pexels/Wikimedia(CC0) | portrait.jpg |

## D. 综合视觉类

| Demo | 能力要点 | 中文关键词 | English keywords | 推荐来源 |
|---|---|---|---|---|
| face-recognition 人脸注册与识别 | 注册单人+识别多人 | 单人正面照 + 多人合影（各1张） | single frontal + group photo | Pexels/Wikimedia(CC0) |
| ocr OCR 与文档视觉 | 文字识别 | 印刷体文字文档 / 手写文字照 | printed text / handwriting | Wikimedia(PD)/Google Images |
| ai-vision AI目标与图像视觉 | 多类目标+标签 | 街景多物体（人/车/建筑/路标） | street scene people cars buildings signs | Unsplash |
| multimodal AI视觉与多模态 | 图文混合理解 | 含文字与物体的场景（广告牌/菜单） | scene with text and objects | Unsplash/Wikimedia |
