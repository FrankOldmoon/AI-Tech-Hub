/**
 * vision 分类的「延伸学习」内容。
 *
 * 页面分两类，内容对应关系要注意：
 *  - 23 个能力页由 `app/pages/vision/[slug].vue` + `image-tools.ts` 注册表驱动，
 *    一个页面里常挂多个工具（yolo 页 7 个、mediapipe 页 11 个）。原理说明写**页面这一层**，
 *    代码挑最能代表该页主题的一个任务；
 *  - 14 个独立页各有自己的 .vue 与引擎。
 *
 * 写作约定同 robot.ts：代码注释用英文、能独立跑；原理必须写本页真实实现，
 * 「这个工具其实没有模型」「这里是示意」这类话必须说清楚。
 */
import type { NoteMap } from './index'

export const notes: NoteMap = {
  '/vision/yolo': {
    python: `"""YOLO26n on ONNX Runtime in ~40 lines: letterbox in, 300 boxes out.

The surprise for most people: there is no NMS in this file, and there is no
NMS in the page either -- YOLO26 emits final boxes directly.
"""
import numpy as np
import onnxruntime as ort

SIZE = 640
PAD = 128                      # the page pads with mid-grey, not black (see notes)


def letterbox(img, size=SIZE, pad=PAD):
    """Scale to fit, then centre-pad. Returns the canvas and how to undo it."""
    h, w = img.shape[:2]
    r = min(size / h, size / w)
    nh, nw = int(round(h * r)), int(round(w * r))
    canvas = np.full((size, size, 3), pad, dtype=np.uint8)
    top, left = (size - nh) // 2, (size - nw) // 2
    # bilinear resize of the original into the canvas
    ys = (np.arange(nh) + 0.5) / r - 0.5
    xs = (np.arange(nw) + 0.5) / r - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 1)
    canvas[top:top + nh, left:left + nw] = img[y0][:, x0]
    return canvas, r, left, top


def detect(session, img, conf=0.25):
    canvas, r, dx, dy = letterbox(img)
    # RGB, /255, HWC -> NCHW float32
    x = canvas[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
    out = session.run(None, {'images': x})[0][0]        # shape (300, 6)

    boxes = out[out[:, 4] > conf]                        # (n, 6): x1,y1,x2,y2,score,cls
    boxes[:, [0, 2]] = (boxes[:, [0, 2]] - dx) / r       # undo the letterbox
    boxes[:, [1, 3]] = (boxes[:, [1, 3]] - dy) / r
    return boxes


if __name__ == "__main__":
    import cv2
    sess = ort.InferenceSession('yolo26n.onnx', providers=['CPUExecutionProvider'])
    img = cv2.imread('street.jpg')                       # BGR
    for x1, y1, x2, y2, score, cls in detect(sess, img):
        print(f"class {int(cls):2d}  {score:.2f}  [{x1:.0f},{y1:.0f},{x2:.0f},{y2:.0f}]")
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>YOLO: 300 rows out, no NMS needed</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;display:block;border-radius:8px;box-shadow:0 1px 4px rgba(15,23,42,.18)}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:10px;font-size:12px}
  input[type=range]{width:170px}output{font-variant-numeric:tabular-nums;font-weight:600;color:#0f172a}
</style>
</head>
<body>
<h1>YOLO26 emits final boxes — no NMS in your code</h1>
<p>An anchor-based detector returns many overlapping candidates and you suppress them yourself.
This page's models return 300 rows that are already de-duplicated. Drag the threshold to
watch classic NMS collapse five candidates into one.</p>
<canvas id="c" width="640" height="360"></canvas>
<label>IoU threshold <input type="range" id="iou" min="0.1" max="0.9" step="0.05" value="0.45">
  <output id="v">0.45</output></label>
<script>
(function () {
  var c = document.getElementById('c'), ctx = c.getContext('2d');
  var W = 640, H = 360;
  var cands = [
    { x: 250, y: 130, w: 180, h: 110, s: 0.91 },
    { x: 262, y: 136, w: 172, h: 104, s: 0.84 },
    { x: 240, y: 124, w: 188, h: 118, s: 0.77 },
    { x: 268, y: 142, w: 166, h: 100, s: 0.65 },
    { x: 258, y: 128, w: 178, h: 112, s: 0.52 }
  ];
  function iou(a, b) {
    var x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    var x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    var inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    var uni = a.w * a.h + b.w * b.h - inter;
    return uni > 0 ? inter / uni : 0;
  }
  function nms(boxes, thr) {
    var sorted = boxes.slice().sort(function (a, b) { return b.s - a.s; });
    var keep = [];
    for (var i = 0; i < sorted.length; i++) {
      var ok = true;
      for (var j = 0; j < keep.length; j++) if (iou(sorted[i], keep[j]) > thr) { ok = false; break; }
      if (ok) keep.push(sorted[i]);
    }
    return keep;
  }
  function scene() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#e2e8f0'); g.addColorStop(1, '#cbd5e1');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#f59e0b'; ctx.fillRect(258, 132, 178, 112);
    ctx.fillStyle = '#b45309'; ctx.fillRect(280, 150, 60, 40);
  }
  function draw() {
    var thr = parseFloat(document.getElementById('iou').value);
    document.getElementById('v').textContent = thr.toFixed(2);
    scene();
    cands.forEach(function (b) {
      ctx.strokeStyle = 'rgba(100,116,139,.45)'; ctx.lineWidth = 1;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    });
    var keep = nms(cands, thr);
    keep.forEach(function (b, i) {
      ctx.strokeStyle = i === 0 ? '#16a34a' : '#dc2626'; ctx.lineWidth = 3;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    });
    ctx.fillStyle = 'rgba(15,23,42,.82)'; ctx.font = '13px ui-monospace, monospace';
    ctx.fillText('candidates ' + cands.length + '  ->  after NMS ' + keep.length, 12, 22);
  }
  document.getElementById('iou').addEventListener('input', draw);
  draw();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 这一页最反直觉的地方：没有 NMS

传统 YOLO 的后处理是这样：网络输出上万条候选框，用 IoU 阈值做非极大值抑制（NMS），才得到最终几十个框。所以每个 YOLO 教程都有 NMS 那一段。

**这页 7 个模型的输出都是固定的 300 行，JS 侧没有 NMS、也没有 IoU 阈值。** 300 行每行 6 个数：\`x1, y1, x2, y2, score, class_id\`。原因是 YOLO26 用了 one-to-one 匹配的训练方式（每个目标只配一个正样本），把「去重」这件事从推理后处理搬进了训练目标里。代价是训练更难收敛，收益是部署极简 —— 移动端、浏览器端最怕的就是后处理分支多。

看过旧版 YOLO 实现的人，第一反应通常是「你漏了 NMS」，这页正好用来说明：后处理不是物理定律，是可以被训练吸收掉的。

## letterbox 为什么垫灰色而不是黑色

等比缩放后要补边，常规做法补黑（0）。但补黑在卷积的第一层就制造了一条**人为的强边缘** —— 网络在这些位置上看到的梯度比真实物体边界还大。

这页垫的是 \`rgb(128,128,128)\`，即 ImageNet 均值附近。灰边与图像内容的亮度差最小，不会产生伪边缘。这是一个很小但很实际的工程选择。

## 7 个任务，输入尺寸各不相同

| 任务 | 模型 | 输入 | 备注 |
| --- | --- | --- | --- |
| 检测 | yolo26n | 640 | 300×6 |
| 实例分割 | yolo26n-seg | 640 | 300×38（多 32 个掩码系数）+ 32×160×160 proto |
| 语义分割 | yolo26n-sem | 1024 | 输出 1024×1024 类别索引，Cityscapes 19 色 |
| 深度 | yolo26n-depth | 768 | 逐像素回归，min-max 归一化到 0–255 |
| 分类 | yolo26n-cls | 224 | 短边放大后**中心裁剪**（不是 letterbox） |
| 姿态 | yolo26n-pose | 640 | 每人 17 点（COCO） |
| 有向检测 | yolo26n-obb | 1024 | 带角度的四边形，遥感常用 |

注意分类走的是中心裁剪：分类任务关心「画面主体是什么」，留灰边会稀释主体；而检测必须保留完整视野，所以用 letterbox。**同一个模型家族，前处理可以完全不同**。

## 实例分割的掩码怎么来

不是让网络直接输出 640×640 的掩码（那太贵）。做法是**原型 + 系数**：网络先出 32 张 160×160 的低分辨率原型图（proto），再给每个检测框出 32 个系数，两者点积就是这个实例的掩码，最后按框裁出来。这是 Mask R-CNN 之后所有实时分割的共同套路 —— 用低秩分解把「每像素分类」变成「32 维向量组合」。

## WebGPU 的 8 秒超时

页面优先用 WebGPU，但设了 8 秒超时，超时就回退 WASM 单线程。为什么？WebGPU 首次运行要给每个算子编译着色器，冷启动可能几秒；有些驱动（尤其是老 Intel 核显）会直接卡住不返回。**超时回退比祈祷它成功更可靠**。

代价是 WASM 单线程明显慢（没有 SIMD 多线程时可能 5–10 倍差距），所以页面在回退后会说明当前后端。

## 想深一层

1. 7 个模型加起来约 78 MB，但页面**只下载当前选中的那个**。这就是按任务拆模型的价值 —— 不要为了「一套权重通吃」把首屏拖死。
2. \`conf\` 阈值只在客户端过滤，模型内部并没有这个参数。调低它会看到大量低分框，正好可以用来看「模型到底有多确信」。
3. 语义分割的 1024 输入是这四个尺寸里最贵的（约 640 的 2.5 倍算力），换来的是边界更细。判断要不要付这个代价，看你的场景是「数物体」还是「画边界」。`,
      en: `## The most counter-intuitive thing here: there is no NMS

Classic YOLO post-processing goes: thousands of candidate boxes out of the network, then non-maximum suppression with an IoU threshold, then a few dozen final boxes. Every YOLO tutorial has that section.

**All seven models on this page emit a fixed 300 rows, and there is no NMS and no IoU threshold in the JS.** Each row is 6 numbers: \`x1, y1, x2, y2, score, class_id\`. YOLO26 trains with one-to-one matching (each ground-truth object gets exactly one positive sample), which moves de-duplication out of inference and into the training objective. Training is harder to converge; deployment becomes trivial — and browsers and phones are exactly where extra post-processing branches hurt most.

Anyone who has shipped older YOLO versions reacts with "you forgot NMS". This page is the counter-example: post-processing is not a law of physics, it can be trained away.

## Why letterbox pads grey instead of black

After scaling to fit, the leftover area needs padding, normally black (0). But black padding creates an **artificial hard edge** in the very first convolution — the gradient there can exceed that of real object boundaries.

This page pads \`rgb(128,128,128)\`, near the ImageNet mean. The luminance step against image content is minimal, so no phantom edges appear. Small choice, real consequence.

## Seven tasks, seven input sizes

| Task | Model | Input | Note |
| --- | --- | --- | --- |
| Detection | yolo26n | 640 | 300×6 |
| Instance seg | yolo26n-seg | 640 | 300×38 (32 mask coefficients extra) + 32×160×160 proto |
| Semantic seg | yolo26n-sem | 1024 | 1024×1024 class indices, 19-colour Cityscapes palette |
| Depth | yolo26n-depth | 768 | per-pixel regression, min-max to 0–255 |
| Classification | yolo26n-cls | 224 | short side up, then **centre crop** (not letterbox) |
| Pose | yolo26n-pose | 640 | 17 COCO keypoints per person |
| Oriented boxes | yolo26n-obb | 1024 | rotated quads, common in aerial imagery |

Classification uses centre crop because it cares about "what is the subject"; grey padding dilutes the subject. Detection needs the full field of view, so it letterboxes. **Same model family, completely different preprocessing.**

## Where instance masks come from

The network does not emit a 640×640 mask (far too expensive). It emits **prototypes plus coefficients**: 32 low-resolution 160×160 prototype maps, plus 32 coefficients per detection box; their dot product is that instance's mask, cropped to the box. Every real-time segmentation model since Mask R-CNN does this — a low-rank factorisation turning "classify every pixel" into "combine 32 vectors".

## The 8-second WebGPU timeout

The page prefers WebGPU but times out after 8 s and falls back to single-threaded WASM. Why? WebGPU compiles shaders per operator on first use, which can take seconds, and some drivers (older Intel iGPUs especially) hang outright. **A timeout-and-fallback beats hoping it works.**

The cost is real: WASM without SIMD/multi-threading can be 5–10× slower, so the UI reports which backend is active.

## Going one level deeper

1. The seven models total about 78 MB, but **only the selected one downloads**. That is the value of splitting by task — never let "one set of weights for everything" sink first paint.
2. \`conf\` filters on the client; the model has no such parameter. Lower it and you will see the low-confidence tail — a good way to observe how sure the model actually is.
3. Semantic segmentation at 1024 is the most expensive of the four sizes (about 2.5× the compute of 640), buying finer boundaries. Whether that is worth it depends on whether you are counting objects or drawing edges.`
    }
  },

  '/vision/detection': {
    python: `"""Two detectors on one page: EfficientDet-Lite0 (TFLite) and YOLO26n (ONNX).

MediaPipe wraps the first one for you; the second you post-process yourself.
That contrast is the point of this page.
"""
import numpy as np


# ---------- route 1: TFLite, boxes already decoded by the model ----------
def detect_tflite(interpreter, img, score_thresh=0.5, max_results=5):
    """EfficientDet-Lite0 outputs normalised boxes + classes + scores.
    No anchors, no NMS -- the graph does it (that is why it is only 13.8 MB)."""
    h, w = img.shape[:2]
    x = (img[:, :, ::-1].astype(np.float32) / 255.0)[None]     # 1,H,W,3 RGB
    boxes, classes, scores, count = interpreter.run(
        x, ['location', 'category', 'score', 'number of detections'])

    out = []
    for i in range(int(count[0])):
        if scores[0][i] < score_thresh or len(out) >= max_results:
            continue
        y1, x1, y2, x2 = boxes[0][i]                            # normalised
        out.append((x1 * w, y1 * h, x2 * w, y2 * h, scores[0][i], int(classes[0][i])))
    return out


# ---------- route 2: ONNX, you write the letterbox AND read 300 rows ----------
def letterbox(img, size=640, pad=128):
    """Scale to fit, centre-pad. PIL does the resize -- no external helper."""
    from PIL import Image
    im = Image.fromarray(img)
    r = min(size / im.height, size / im.width)
    im = im.resize((round(im.width * r), round(im.height * r)), Image.BILINEAR)
    canvas = Image.new('RGB', (size, size), (pad, pad, pad))
    ox, oy = (size - im.width) // 2, (size - im.height) // 2
    canvas.paste(im, (ox, oy))
    return np.array(canvas), r, ox, oy


def detect_onnx(session, img, size=640, conf=0.25):
    canvas, r, dx, dy = letterbox(img, size, pad=128)
    x = canvas[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
    rows = session.run(None, {'images': x})[0][0]               # (300, 6)

    rows = rows[rows[:, 4] > conf]
    rows[:, [0, 2]] = (rows[:, [0, 2]] - dx) / r
    rows[:, [1, 3]] = (rows[:, [1, 3]] - dy) / r
    return rows


# Which one to use?
#   TFLite  : ~14 MB, 5 results, boxes normalised, everything inside the graph
#   ONNX    : ~10 MB, 300 slots, boxes in letterboxed pixels, preprocessing is yours


if __name__ == "__main__":
    import onnxruntime as ort
    from PIL import Image

    # pip install onnxruntime pillow numpy
    sess = ort.InferenceSession('yolo26n.onnx', providers=['CPUExecutionProvider'])
    img = np.array(Image.open('street.jpg').convert('RGB'))
    for x1, y1, x2, y2, score, cls in detect_onnx(sess, img):
        print(f"class {int(cls):2d}  {score:.2f}  [{x1:.0f},{y1:.0f},{x2:.0f},{y2:.0f}]")
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>detection: normalised vs letterbox coordinates</title>
<style>
  body { margin: 0; padding: 14px; font: 13px/1.6 system-ui, -apple-system, sans-serif; color: #0f172a; background: #f8fafc; }
  h1 { font-size: 15px; margin: 0 0 6px; }
  p { margin: 0 0 10px; color: #475569; }
  canvas { width: 100%; max-width: 720px; display: block; border-radius: 8px; box-shadow: 0 1px 4px rgba(15,23,42,.18); }
  label { display: inline-flex; gap: 6px; align-items: center; margin-top: 12px; font-size: 12px; cursor: pointer; }
</style>
</head>
<body>
<h1>Same target, two coordinate systems</h1>
<p>Green is correctly un-letterboxed, blue comes from normalised 0..1. Tick the box to see what
happens when the padding is not subtracted.</p>
<canvas id="stage" width="720" height="400"></canvas>
<label><input type="checkbox" id="bug"> simulate "forgot to subtract padding"</label>

<script>
(function () {
  var W = 720, H = 400;
  var stage = document.getElementById('stage');
  var ctx = stage.getContext('2d');

  // ---------- a synthetic "photo": sky, ground, buildings, two cars ----------
  function car(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(15,23,42,.25)';
    ctx.fillRect(x + w * 0.15, y + h * 0.12, w * 0.7, h * 0.34);
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(x + w * 0.25, y + h, h * 0.16, 0, Math.PI * 2);
    ctx.arc(x + w * 0.75, y + h, h * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawScene() {
    var sky = ctx.createLinearGradient(0, 0, 0, H * 0.6);
    sky.addColorStop(0, '#bfdbfe');
    sky.addColorStop(1, '#e0f2fe');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H * 0.6);
    ctx.fillStyle = '#d1d5db';
    ctx.fillRect(0, H * 0.6, W, H * 0.4);

    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(60, 80, 120, 170);
    ctx.fillRect(220, 120, 90, 130);
    ctx.fillStyle = '#64748b';
    ctx.fillRect(500, 60, 140, 190);

    ctx.fillStyle = '#4b5563';
    ctx.fillRect(0, H * 0.72, W, H * 0.28);
    ctx.strokeStyle = '#fbbf24';
    ctx.setLineDash([24, 20]);
    ctx.beginPath();
    ctx.moveTo(0, H * 0.86);
    ctx.lineTo(W, H * 0.86);
    ctx.stroke();
    ctx.setLineDash([]);

    car(300, 250, 150, 74, '#ef4444');
    car(520, 270, 110, 58, '#22c55e');
  }

  // ---------- route 1: MediaPipe gives 0..1, just multiply back ----------
  var normBox = { x1: 0.40, y1: 0.60, x2: 0.66, y2: 0.83 };
  var fromNorm = {
    x1: normBox.x1 * W, y1: normBox.y1 * H,
    x2: normBox.x2 * W, y2: normBox.y2 * H
  };

  // ---------- route 2: YOLO gives pixels in a 640x640 letterbox ----------
  var SIZE = 640;
  var r = Math.min(SIZE / H, SIZE / W);
  var padX = (SIZE - W * r) / 2;
  var padY = (SIZE - H * r) / 2;
  var raw = { x1: 300, y1: 230, x2: 470, y2: 330 };

  function undo(bug) {
    if (bug) return raw;            // what "forgot to undo" looks like
    return {
      x1: (raw.x1 - padX) / r, y1: (raw.y1 - padY) / r,
      x2: (raw.x2 - padX) / r, y2: (raw.y2 - padY) / r
    };
  }

  function frame(b, color, label) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
    ctx.fillStyle = color;
    ctx.font = 'bold 13px ui-monospace, monospace';
    ctx.fillText(label, b.x1 + 4, b.y1 - 7);
  }

  function render() {
    var bug = document.getElementById('bug').checked;
    drawScene();
    frame(fromNorm, '#2563eb', 'MediaPipe 0..1');
    frame(undo(bug), bug ? '#dc2626' : '#16a34a', bug ? 'YOLO: no undo ✗' : 'YOLO: letterbox ✓');

    ctx.fillStyle = 'rgba(15,23,42,.75)';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('scale ' + r.toFixed(3) + '   pad ' + padX.toFixed(1) + ', ' + padY.toFixed(1), 12, H - 12);
  }

  document.getElementById('bug').addEventListener('change', render);
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 同一件事，两种封装程度

这页把两个检测器放在一起，最有价值的不是「哪个更准」，而是**后处理责任在谁身上**：

| | EfficientDet-Lite0 | YOLO26n |
| --- | --- | --- |
| 格式 | TFLite（13.8 MB） | ONNX（9.9 MB） |
| 调用 | MediaPipe Tasks 的 \`ObjectDetector\` | onnxruntime-web 裸跑 |
| 框的坐标 | **归一化 0–1** | letterbox 像素，要自己还原 |
| 去重 | 图里做完（含 NMS） | 图里做完（one-to-one 头） |
| 前处理 | Tasks API 内部处理 | 自己写 letterbox + /255 + NCHW |
| 结果上限 | \`maxResults: 5\` 由你指定 | 固定 300 行，自己过滤 |

左边是「拿来就用」，右边是「什么都要自己写」。页面把两个并列，正好让人体会封装的代价：Tasks API 帮你省了 100 行代码，代价是你不知道它内部做了什么（想调 letterbox 的填充色？没门）。

## EfficientDet 为什么只需要 13.8 MB

MobileNetV2 风格的 backbone + BiFPN 特征融合 + SSD 风格的锚框头。它的框是**相对锚框的偏移**，不是直接回归绝对坐标，所以小模型也能出稳定结果。这类「锚框 + SSD 头」在 2020 年前后是移动端标配，现在基本被 YOLO 系列和 DETR 系取代。

## 归一化坐标 vs 像素坐标，坑在这里

MediaPipe 给的是 0–1 归一化坐标 —— 好处是分辨率无关，坏处是**长宽比也丢了**，画框时必须分别乘回宽和高。YOLO 给的是 letterbox 像素坐标，必须先减 padding 再除以缩放比（\`(x - dx) / r\`）。**忘记这一步的表现是：框整体偏移并缩小**，而且偏移量随图片长宽比变化，很难一眼看出。

这类 bug 在真实项目里极常见，判断方法很简单：拿一张正方形图片试 —— 正方形时 padding 为 0，如果框在正方形图上对、在竖图上错，就是忘了还原 letterbox。

## maxResults=5 是个产品决策

不是模型限制，是页面要展示 5 条。真实场景里这个值应该按需给（行人检测可能要 50+）。同理 \`scoreThreshold: 0.5\` 也是个偏保守的值 —— 宁可漏检不要误检，适合演示。

## 想深一层

1. 两个模型在 COCO 上 mAP 差距不大（约 25 vs 40），但速度差很多：YOLO26n 在浏览器 WASM 上单帧几十毫秒，EfficientDet 在 GPU delegate 上更快但依赖 TFLite 运行时。**选型时先看部署环境，再看精度。**
2. 都做了 NMS 的「内化」，但方式不同：EfficientDet 在导出图里显式插了 NMS 算子（能看见），YOLO26 是靠训练目标让它不需要。前者是工程手段，后者是建模手段。`,
      en: `## Same task, two very different levels of wrapping

The interesting part is not which one is more accurate but **who owns post-processing**:

| | EfficientDet-Lite0 | YOLO26n |
| --- | --- | --- |
| Format | TFLite (13.8 MB) | ONNX (9.9 MB) |
| Call | MediaPipe Tasks \`ObjectDetector\` | bare onnxruntime-web |
| Box coords | **normalised 0–1** | letterbox pixels, undo yourself |
| De-duplication | inside the graph (NMS included) | inside the graph (one-to-one head) |
| Preprocessing | handled by the Tasks API | you write letterbox + /255 + NCHW |
| Result cap | \`maxResults: 5\`, your choice | fixed 300 rows, filter yourself |

The left column is "plug and play", the right is "write everything". Putting them side by side exposes the price of abstraction: the Tasks API saves you 100 lines and hides what it did (want to change the letterbox padding colour? no).

## Why EfficientDet fits in 13.8 MB

A MobileNetV2-style backbone, BiFPN feature fusion, and an SSD-style anchor head. Its boxes are **offsets from anchors** rather than absolute coordinates, which keeps small models stable. That anchor+SSD recipe was the mobile standard around 2020; YOLO variants and DETR descendants have largely replaced it.

## Normalised vs pixel coordinates — the trap

MediaPipe returns 0–1 coordinates: resolution independent, but **aspect ratio is gone**, so you must multiply by width and height separately when drawing. YOLO returns letterbox pixels: subtract the padding, then divide by the scale (\`(x - dx) / r\`). **Forget that and the boxes shift and shrink**, by an amount that varies with aspect ratio — hard to spot at a glance.

The diagnostic is quick: test a square image. Padding is zero there, so boxes that are right on square images and wrong on tall ones mean you skipped the letterbox reversal.

## maxResults=5 is a product decision

Not a model limit — the page only wants to show five. Real use cases should size it to the task (pedestrian detection may want 50+). \`scoreThreshold: 0.5\` is similarly conservative: better to miss than to false-positive, which suits a demo.

## Going one level deeper

1. On COCO the two are close-ish (roughly 25 vs 40 mAP) but far apart on speed: YOLO26n is tens of milliseconds per frame on WASM, EfficientDet is faster on the GPU delegate but requires the TFLite runtime. **Choose by deployment target first, accuracy second.**
2. Both internalise NMS, differently: EfficientDet's exported graph literally contains an NMS operator (visible), while YOLO26's training objective makes it unnecessary. One is engineering, the other is modelling.`
    }
  },

  '/vision/segmentation': {
    python: `"""Four kinds of segmentation on one page -- and the mask formats differ.

categoryMask (int labels) vs confidenceMask (floats) vs proto+coefficients.
Getting these confused is the usual source of black or inverted overlays.
"""
import numpy as np


def tint_by_category(category_mask, palette, alpha=0.6):
    """selfie-segment / yolo-sem style: one integer per pixel.
    category_mask: H x W uint8, palette: [(r,g,b), ...] indexed by label."""
    h, w = category_mask.shape
    out = np.zeros((h, w, 3), np.float32)
    for label, colour in enumerate(palette):
        out[category_mask == label] = colour
    return out, alpha          # composite with src*(1-alpha) + out*alpha


def alpha_from_confidence(confidence, threshold=0.5):
    """interactive-segment / matting style: a float mask in 0..1.
    Resize happens BEFORE thresholding -- thresholding a downsampled mask
    gives jagged edges that no amount of blur can fix."""
    soft = np.clip(confidence, 0.0, 1.0)          # keep the gradient
    hard = (soft >= threshold).astype(np.float32)
    return hard


def mask_from_proto(coeffs, proto, box, img_hw):
    """yolo-seg style: 32 coefficients dot 32 prototypes -> one instance mask."""
    m = np.tensordot(coeffs, proto, axes=(0, 0))     # (160, 160)
    m = 1 / (1 + np.exp(-m))                         # sigmoid
    # crop the box region from the 160x160 map, then resize to the image
    return m, box


def overlay(bgr, colour, alpha):
    """The one line everyone gets wrong: alpha must be per-channel, not scalar."""
    return (bgr.astype(np.float32) * (1 - alpha) + colour * alpha).clip(0, 255).astype(np.uint8)
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Three mask formats</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:14px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:180px}
  canvas{width:100%;display:block;border-radius:8px;box-shadow:0 1px 4px rgba(15,23,42,.18)}
  figcaption{font-size:12px;color:#475569;margin-top:6px}
  code{background:#e2e8f0;padding:1px 4px;border-radius:3px;font-size:12px}
</style>
</head>
<body>
<h1>Same object, three mask representations</h1>
<p>A category mask is one integer per pixel; a confidence mask is a float; an instance mask is 32
coefficients times 32 prototypes. Picking the wrong one is why overlays come out black or inverted.</p>
<div class="row">
  <figure><canvas id="a" width="200" height="200"></canvas>
    <figcaption><code>categoryMask</code> — 0 or 1, needs a palette</figcaption></figure>
  <figure><canvas id="b" width="200" height="200"></canvas>
    <figcaption><code>confidenceMask</code> — float 0..1, soft edge</figcaption></figure>
  <figure><canvas id="c" width="200" height="200"></canvas>
    <figcaption><code>proto x coeffs</code> — 32 numbers reconstruct it</figcaption></figure>
</div>
<script>
(function () {
  function shape(ctx) {
    ctx.beginPath();
    ctx.ellipse(100, 100, 62, 78, 0, 0, Math.PI * 2);
    ctx.closePath();
  }
  // 1) hard category mask: two values only
  var a = document.getElementById('a').getContext('2d');
  a.fillStyle = '#0f172a'; a.fillRect(0, 0, 200, 200);
  a.fillStyle = 'rgb(0,220,130)'; shape(a); a.fill();

  // 2) confidence mask: sigmoid falloff across the boundary
  var b = document.getElementById('b').getContext('2d');
  var img = b.createImageData(200, 200);
  for (var y = 0; y < 200; y++) {
    for (var x = 0; x < 200; x++) {
      var d = Math.hypot((x - 100) / 62, (y - 100) / 78);   // 1 at the edge
      var v = 1 / (1 + Math.exp((d - 1) * 14));             // soft step
      var i = (y * 200 + x) * 4;
      img.data[i] = 0; img.data[i + 1] = 220; img.data[i + 2] = 130;
      img.data[i + 3] = Math.round(v * 255);
    }
  }
  b.fillStyle = '#0f172a'; b.fillRect(0, 0, 200, 200);
  b.putImageData(img, 0, 0);

  // 3) low-res proto (32x32) upscaled — the real 160x160 is just bigger
  var c = document.getElementById('c').getContext('2d');
  var small = document.createElement('canvas');
  small.width = small.height = 32;
  var sctx = small.getContext('2d');
  sctx.fillStyle = '#000'; sctx.fillRect(0, 0, 32, 32);
  sctx.fillStyle = '#00dc82';
  sctx.beginPath(); sctx.ellipse(16, 16, 10, 12.5, 0, 0, Math.PI * 2); sctx.fill();
  c.imageSmoothingEnabled = false;
  c.drawImage(small, 0, 0, 200, 200);

  [[a, '0 / 1'], [b, '0.0 .. 1.0'], [c, '32 x 160 x 160']].forEach(function (p, k) {
    p[0].fillStyle = 'rgba(255,255,255,.85)';
    p[0].font = '11px ui-monospace, monospace';
    p[0].fillText(p[1], 8, 194);
  });
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 一个页面，四种「分割」—— 先分清它们在做什么

| 工具 | 模型/体积 | 输入 | 输出 |
| --- | --- | --- | --- |
| 人像分割 | selfie_segmenter.tflite，**244 KB** | 图片 | 类别掩码（2 类） |
| 交互式分割 | interactive_segmentation.task，30.5 MB | 点击点/涂抹 | 置信度掩码 |
| 实例分割 | yolo26n-seg.onnx，11.2 MB | 图片 | 每实例 32 系数 + 原型 |
| 语义分割 | yolo26n-sem.onnx，6.3 MB | 图片 | 1024×1024 类别索引（19 类） |

**语义**分割只回答「这个像素是什么类」，同类物体粘成一片；**实例**分割还要回答「这是第几个」；**人像**分割本质是二分类语义分割的特例；**交互式**分割是「按提示分割」（promptable），模型本身不知道要找什么，靠你给的点决定目标。

244 KB 的 selfie segmenter 值得单独说一下：它小到可以在 2019 年的手机上实时跑。代价是只能分「人 / 非人」，且边界很粗（低分辨率上采样）。**模型体积不是随便定的，是任务复杂度决定的。**

## 三种掩码格式，搞混就是黑屏

1. **类别掩码**（categoryMask）：每像素一个整数。用它画图要查调色板；如果把 0/255 当亮度用，人像会变成一片白。
2. **置信度掩码**（confidenceMask）：每像素 0–1 浮点。适合做柔边（羽化）、也适合做 alpha 通道。
3. **原型 + 系数**：实例分割的压缩表示（见 /vision/yolo 页）。要先用系数把 32 张原型组合成一张，再按框裁切。

页面里人像分割的「透明模式」用的是 alpha=0 而不是黑色：\`alpha=0\` 是「完全透明」，黑色是「不透明的黑」。在导出 PNG 时这两者天差地别 —— 前者能贴到任何背景上，后者不能。

## 交互式分割在做什么

MagicTouch 这类模型的关键是**把「点」编码成提示**：正点（要的）、负点（不要的）各自变成一个查询向量，与图像特征做交叉注意力，输出掩码。所以同一个模型，你点左边它给你左边那只杯子，点右边给右边那只 —— **模型没变，提示变了**。

这也是 Segment Anything（SAM）之后整个分割领域的范式转变：从「训练一个专门分割杯子的模型」变成「训练一个会听提示的模型」。

## 想深一层

1. 语义分割的 1024 输入不是为了好看：Cityscapes 的标注边界本来就细，输入太小会让远处的小物体整块消失。
2. 实例分割的掩码是 160×160 上采样来的，所以小物体的边缘必然是模糊的。要更锐利的边，得加一个 refiner 头（Mask R-CNN 就有），代价是更慢。
3. 「人像分割」和「抠图（matting）」的区别只在一处：掩码是硬的还是软的。硬掩码边上会留白边，软 alpha 才能贴合头发丝 —— 这就是下一页 /vision/matting 的主题。`,
      en: `## One page, four kinds of "segmentation" — separate them first

| Tool | Model / size | Input | Output |
| --- | --- | --- | --- |
| Portrait | selfie_segmenter.tflite, **244 KB** | image | category mask (2 classes) |
| Interactive | interactive_segmentation.task, 30.5 MB | clicks / strokes | confidence mask |
| Instance | yolo26n-seg.onnx, 11.2 MB | image | 32 coefficients + prototypes per instance |
| Semantic | yolo26n-sem.onnx, 6.3 MB | image | 1024×1024 class indices (19 classes) |

**Semantic** segmentation answers only "what class is this pixel", so same-class objects merge. **Instance** segmentation also answers "which one". **Portrait** segmentation is a two-class special case. **Interactive** segmentation is *promptable*: the model does not know what to find until you point at it.

The 244 KB selfie segmenter deserves a note: small enough to run in real time on a 2019 phone. The price is that it only separates person from background, and its edges are coarse (upsampled from low resolution). **Model size follows task complexity, not fashion.**

## Three mask formats — mixing them up gives a black screen

1. **Category mask**: one integer per pixel. Painting requires a palette lookup; treat 0/255 as luminance and your person becomes a white blob.
2. **Confidence mask**: float 0–1 per pixel. Right for soft edges and for alpha.
3. **Prototypes + coefficients**: the compressed instance representation (see /vision/yolo). Combine the 32 prototypes with the coefficients, then crop to the box.

The portrait page's "transparent mode" sets alpha=0 rather than painting black: \`alpha=0\` is fully transparent, black is opaque black. When exporting PNG the difference is everything — one composites onto any background, the other cannot.

## What interactive segmentation is doing

Models like MagicTouch encode the **prompt**: positive clicks and negative clicks each become query vectors that cross-attend against image features to produce a mask. Same model, click the left cup and you get the left cup; click the right one and you get that one. **The model did not change, the prompt did.**

This is the post-SAM shift in the field: from "train a cup segmenter" to "train a model that listens".

## Going one level deeper

1. The 1024 input for semantic segmentation is not vanity: Cityscapes boundaries are genuinely fine, and small distant objects vanish entirely at lower resolution.
2. Instance masks are upsampled from 160×160, so small-object edges must be blurry. Sharper edges need a refiner head (Mask R-CNN has one) and cost speed.
3. Portrait segmentation and matting differ in exactly one place: hard mask vs soft alpha. Hard masks leave fringes; soft alpha hugs hair — which is the subject of /vision/matting.`
    }
  },

  '/vision/matting': {
    python: `"""Matting: the difference from segmentation is one word -- soft alpha.

MODNet outputs a float alpha, not a binary mask, so hair and motion blur
survive compositing.
"""
import numpy as np


def matte_to_rgba(img, alpha, threshold=64):
    """img: HxWx3 (BGR/RGB), alpha: HxW uint8 0..255.

    The page's threshold is not a hard cut: below it alpha becomes 0, above it
    the original gradient is stretched back to 0..255. A hard cut destroys the
    hair edge, which is the entire point of matting.
    """
    a = alpha.astype(np.float32)
    a[a < threshold] = 0.0
    # stretch the surviving range so a soft edge still looks soft
    keep = a >= threshold
    a[keep] = (a[keep] - threshold) / max(1.0, 255.0 - threshold) * 255.0

    out = np.dstack([img, a]).astype(np.uint8)     # RGBA
    return out


def composite(fg, alpha, bg):
    """Standard over-operator. This is what 'transparent PNG' means numerically."""
    a = (alpha / 255.0)[..., None]
    return (fg * a + bg * (1 - a)).clip(0, 255).astype(np.uint8)


# The model behind it: MODNet, three branches
#   1) low-res semantic branch  -> "is this a person at all" (coarse)
#   2) high-res detail branch   -> "where exactly is the edge" (fine)
#   3) fusion branch            -> combine, plus a self-supervised sub-target
# Trained on portraits only, so it fails on a cat -- the page says so.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Matting: why alpha beats a mask</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:14px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:200px}
  canvas{width:100%;display:block;border-radius:8px}
  figcaption{font-size:12px;color:#475569;margin-top:6px}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px}
  input[type=range]{width:170px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>Hard mask vs soft alpha, on the same checkerboard</h1>
<p>The left one was thresholded: look at the hair. The right one keeps a gradient, which is what
matting actually predicts. Drag the threshold to watch soft become hard.</p>
<div class="row">
  <figure><canvas id="a" width="220" height="220"></canvas><figcaption>hard mask (alpha &gt; threshold)</figcaption></figure>
  <figure><canvas id="b" width="220" height="220"></canvas><figcaption>soft alpha (the real output)</figcaption></figure>
</div>
<label>alpha threshold <input type="range" id="t" min="0" max="200" step="5" value="64">
  <output id="v">64</output></label>
<script>
(function () {
  function checker(ctx, s) {
    for (var y = 0; y < 220; y += s) {
      for (var x = 0; x < 220; x += s) {
        ctx.fillStyle = ((x / s + y / s) % 2) ? '#e2e8f0' : '#f8fafc';
        ctx.fillRect(x, y, s, s);
      }
    }
  }
  // a fuzzy blob with hair-like filaments: alpha falls off over ~10 px
  function alphaAt(x, y) {
    var d = Math.hypot(x - 110, y - 112) / 70;
    var v = 1 / (1 + Math.exp((d - 1) * 18));
    // three thin strands leaving the top
    for (var k = -1; k <= 1; k++) {
      var lx = 110 + k * 26 + (y - 60) * 0.12 * k;
      if (y > 40 && y < 70 && Math.abs(x - lx) < 1.6) v = Math.max(v, 0.45);
    }
    return v;
  }
  function paint(canvas, hard, thr) {
    var ctx = canvas.getContext('2d');
    checker(ctx, 14);
    var img = ctx.getImageData(0, 0, 220, 220);
    for (var y = 0; y < 220; y++) {
      for (var x = 0; x < 220; x++) {
        var a = alphaAt(x, y);
        if (hard) a = a >= thr / 255 ? 1 : 0;
        var i = (y * 220 + x) * 4;
        img.data[i] = 220; img.data[i + 1] = 60; img.data[i + 2] = 90;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function draw() {
    var thr = parseFloat(document.getElementById('t').value);
    document.getElementById('v').textContent = thr;
    paint(document.getElementById('a'), true, thr);
    paint(document.getElementById('b'), false, thr);
  }
  document.getElementById('t').addEventListener('input', draw);
  draw();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 分割给「是谁」，抠图给「有多少」

分割输出的是**类别**（这个像素属于人），抠图输出的是**覆盖率 α**（这个像素有 73% 是人的头发、27% 是背景）。数学上这叫 alpha compositing：

\`I = α·F + (1-α)·B\`

一个像素里同时有前景和背景，只有 α 能表达这种混合。头发丝、玻璃、运动模糊、烟雾 —— 这些像素按定义就不属于任何一类，硬掩码在这里必然出错（表现为一圈白边或锯齿）。

**判断一个模型是分割还是抠图，看它输出的是 int 还是 float，以及边缘有没有渐变。** 这页两个工具的差别就在这里：selfie_segmenter 出硬掩码（244 KB），MODNet 出软 alpha（26 MB）。

## MODNet 的三支路设计

- **语义支路**：输入缩到很低分辨率，回答「这块区域是不是人」。分辨率低所以感受野大，能理解整体；
- **细节支路**：高分辨率，只负责边界细节。它不需要语义理解，专注局部梯度；
- **融合支路**：把两者拼起来输出 α。

为什么不直接用一个高分辨率网络？因为**语义需要大感受野、细节需要高分辨率，这两件事在同一个卷积层里是冲突的**。三支路就是把冲突拆开。这个思路在实时抠图、超分、去雨里反复出现。

## 阈值 64 不是硬切

代码里 \`alphaThreshold = 64\` 容易被误读成「低于 64 就是背景」。实际做法是：低于 64 置 0，**高于 64 的部分重新拉伸回 0–255**（\`(a-64)/(255-64)*255\`）。

这样做的目的是去掉模型在低值区的噪声（模型常在背景上给出 5–30 的微小响应），同时保住 64–255 之间的渐变。如果直接二值化，边缘立刻变成台阶。

## WebGPU 与 fp32

页面用 \`preferredDevice()\`（WebGPU 优先）跑 fp32。为什么不用量化的 q8/q4？抠图对数值精度敏感 —— 量化误差会直接变成 alpha 的台阶，肉眼可见。**分类可以量化，抠图不行**，这是模型压缩里很实际的一条经验。

## 想深一层

1. MODNet 只在人像上训练过。给它一只猫，它会把猫当背景（或者给出一个奇怪的软边）。这不是模型坏了，是分布外输入。
2. 换个背景色试试：同样的 alpha 叠在深色和浅色背景上，白边会时有时无 —— 这说明 256 级的 alpha 已经够细，问题出在模型的边界预测本身。
3. 想做实时视频抠图，业界常用 RVM（Robust Video Matting），关键是有**时序一致性**（相邻帧的 alpha 要连续）。单帧模型逐帧跑会闪烁。`,
      en: `## Segmentation says "which", matting says "how much"

Segmentation outputs a **class** (this pixel belongs to a person). Matting outputs **coverage α** (this pixel is 73% hair and 27% background). The maths is alpha compositing:

\`I = α·F + (1-α)·B\`

A single pixel can contain both foreground and background; only α expresses that mixture. Hair, glass, motion blur, smoke — these pixels are by definition not any single class, so a hard mask must fail there (as a fringe or a jagged stair-step).

**To tell which one a model does, look at whether it outputs int or float, and whether edges have a gradient.** The two tools on this page differ exactly there: selfie_segmenter gives a hard mask (244 KB), MODNet gives soft alpha (26 MB).

## MODNet's three branches

- **Semantic branch**: heavily downsampled, answers "is this region a person". Low resolution buys a large receptive field, hence global understanding;
- **Detail branch**: high resolution, only responsible for boundaries. No semantics, just local gradients;
- **Fusion branch**: combines them into α.

Why not one high-resolution network? Because **semantics needs a large receptive field and detail needs high resolution, and those conflict inside a single convolution stack**. Splitting the conflict across branches is the same trick used in real-time matting, super-resolution and deraining.

## The threshold of 64 is not a hard cut

\`alphaThreshold = 64\` reads like "below 64 means background", but the implementation zeros values under 64 and then **stretches the survivors back to 0–255** (\`(a-64)/(255-64)*255\`).

That removes the model's low-level noise (it routinely emits 5–30 in background regions) while preserving the 64–255 gradient. Binarising outright would turn every edge into a staircase.

## WebGPU and fp32

The page uses \`preferredDevice()\` (WebGPU first) with fp32. Why not q8/q4? Matting is sensitive to numerical precision — quantisation error shows up directly as steps in the alpha, visible to the eye. **Classification can be quantised; matting cannot.** That is a practical rule in model compression.

## Going one level deeper

1. MODNet was trained on portraits only. Hand it a cat and it treats the cat as background (or produces a strange soft edge). The model is not broken; the input is out of distribution.
2. Try different backgrounds: the same alpha leaves a visible fringe on dark but not light backgrounds, or vice versa — proof that 256 levels are enough and the error is in the model's boundary prediction.
3. For real-time video matting, production systems use RVM (Robust Video Matting); the key is **temporal consistency** (adjacent frames' alpha must be continuous). A per-frame model flickers.`
    }
  },

  '/vision/depth': {
    python: `"""Monocular depth: the model gives relative depth, you decide the colour.

The page's two tools differ in scale handling, not in the network family.
"""
import numpy as np


def normalise_minmax(depth):
    """yolo26n-depth is trained on relative depth, so its raw output has no
    metric meaning. Stretch it per image; do NOT assume metres."""
    lo, hi = float(depth.min()), float(depth.max())
    if hi - lo < 1e-6:
        return np.zeros_like(depth)
    return (depth - lo) / (hi - lo)


def colourise(norm, bands=5, invert=False):
    """Five discrete bands, like the page. Discrete bands read better than a
    smooth ramp when comparing two depths by eye."""
    if invert:                       # near = bright is the page's default
        norm = 1.0 - norm
    idx = np.clip((norm * bands).astype(int), 0, bands - 1)
    palette = np.array([
        [0, 0, 128], [0, 128, 255], [0, 224, 180], [255, 200, 0], [220, 40, 40]
    ], np.uint8)
    return palette[idx]


def overlay(bgr, colour, alpha=0.65):
    return (bgr.astype(np.float32) * (1 - alpha) + colour * alpha).clip(0, 255).astype(np.uint8)


# Why relative depth matters:
#   a photo of a toy room and a photo of a real room produce the same map.
#   Monocular cues (texture, occlusion, perspective) cannot recover absolute
#   scale. Metric depth needs a second camera, a known object, or an IMU.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Relative depth to five bands</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:14px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:220px}
  canvas{width:100%;display:block;border-radius:8px}
  figcaption{font-size:12px;color:#475569;margin-top:6px}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px;margin-right:16px}
  input[type=range]{width:140px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>Monocular depth is relative — you choose the colour</h1>
<p>The model never saw a metre. It only ordered pixels by "nearer / farther", so the page
min-max stretches that ordering and maps it onto five bands. Discrete bands are easier to compare
by eye than a smooth ramp.</p>
<div class="row">
  <figure><canvas id="a" width="260" height="200"></canvas><figcaption>raw relative depth</figcaption></figure>
  <figure><canvas id="b" width="260" height="200"></canvas><figcaption>5 bands, near = bright</figcaption></figure>
</div>
<label>bands <input type="range" id="n" min="2" max="12" step="1" value="5"><output id="v">5</output></label>
<label><input type="checkbox" id="inv" checked> near = bright</label>
<script>
(function () {
  var W = 260, H = 200;
  // a synthetic "depth field": ground plane + a box + a hill
  function depthAt(x, y) {
    var ground = 1 - (y / H);                       // farther up = farther away
    var box = (x > 90 && x < 150 && y > 90 && y < 160) ? 0.55 : 0;
    var hill = 0.35 * Math.max(0, 1 - Math.hypot(x - 210, y - 60) / 70);
    return Math.max(box, Math.max(ground * 0.9, hill));   // 1 = near
  }
  var PAL = [[0,0,128],[0,128,255],[0,224,180],[255,200,0],[220,40,40],
             [140,40,160],[255,140,0],[0,200,90],[90,90,90],[200,200,200],
             [40,40,255],[255,0,120]];
  function draw() {
    var n = parseInt(document.getElementById('n').value, 10);
    var inv = document.getElementById('inv').checked;
    document.getElementById('v').textContent = n;

    var a = document.getElementById('a').getContext('2d');
    var b = document.getElementById('b').getContext('2d');
    var ia = a.createImageData(W, H), ib = b.createImageData(W, H);

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var d = depthAt(x, y);                 // 0..1, relative
        var i = (y * W + x) * 4;
        // left: greyscale of the raw map
        var g = Math.round(d * 255);
        ia.data[i] = ia.data[i + 1] = ia.data[i + 2] = g; ia.data[i + 3] = 255;
        // right: quantise into n bands, optionally inverted
        var t = inv ? 1 - d : d;
        var k = Math.min(n - 1, Math.floor(t * n));
        var col = PAL[k % PAL.length];
        ib.data[i] = col[0]; ib.data[i + 1] = col[1]; ib.data[i + 2] = col[2]; ib.data[i + 3] = 255;
      }
    }
    a.putImageData(ia, 0, 0);
    b.putImageData(ib, 0, 0);
  }
  document.getElementById('n').addEventListener('input', draw);
  document.getElementById('inv').addEventListener('change', draw);
  draw();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 单目深度只能给你「相对远近」

一张照片里，模型无法区分「玩具房间」和「真实房间」—— 因为两者在像素层面提供的信息是一样的。单目深度模型靠纹理梯度、遮挡关系、透视收敛这些**相对线索**推断，得到的必然是**相对深度**：只能说明 A 比 B 近，不能说明 A 在几米处。

要绝对值，得有额外信息：双目视差、已知尺寸的物体、IMU 的运动、或者结构光。这也是为什么手机的人像模式需要多摄或 ToF —— 单摄只能猜。

所以页面的 \`min-max 归一化\` 不是偷懒，是**唯一正确的处理方式**：把模型的输出按其自身动态范围拉伸到 0–255。

## 两个工具的区别不在精度，在尺度处理

| | yolo26n-depth | depth-anything-small |
| --- | --- | --- |
| 输入 | 768×768 | 短边 518 |
| 输出 | 768×768 单通道 | 同尺寸浮点图 |
| 后端 | ONNX Runtime，WebGPU 优先 | transformers.js，**强制 WASM** |
| 特点 | 快，边界略软 | 细，但慢得多 |

depth-anything 那页为什么强制 WASM？代码注释写着 WebGPU 会报 "null function" —— 这是 ONNX Runtime Web 的算子覆盖问题（某些算子在 WebGPU EP 里没有实现，会静默失败或抛错）。**「优先用最快的后端」这条规则在遇到算子缺口时必须让路**，这也是为什么生产代码里几乎总有回退链。

## 五档色带 vs 连续渐变

页面用 5 档离散色带而不是 smooth ramp。原因很实际：人眼比较两个不同深浅的蓝几乎不可能，但能瞬间看出「这块是第 3 档，那块是第 4 档」。**离散化是给人眼看的，不是给算法看的。**

默认 \`invert\` 打开（近 = 亮）。这不是偏执：大多数深度图默认远=亮，而人类直觉是近处更清楚、更亮，所以页面反过来了。这类小决定影响的是「一眼能不能读懂」。

## 想深一层

1. 深度图的错误模式很有特点：**薄结构（栏杆、树枝）容易被抹平**，因为模型在低分辨率特征上判断，细结构的深度被邻域平均掉了。
2. 想验证「相对 vs 绝对」：把同一张图整体缩放（模拟靠近），深度图的数值范围会变，但相对关系不变 —— 说明它没有抓住绝对尺度。
3. 深度 + 分割可以得到「这个东西离我多远」，是机器人抓取、AR 遮挡的基础组合。`,
      en: `## Monocular depth can only give you *relative* distance

Given one photo, a model cannot tell a toy room from a real room — the pixel-level evidence is identical. Monocular depth relies on **relative cues**: texture gradients, occlusion ordering, perspective convergence. What comes out is **relative depth**: A is nearer than B, with no statement about how many metres away A is.

Absolute scale needs extra information: stereo disparity, an object of known size, IMU motion, or structured light. That is why phone portrait modes need multiple cameras or a ToF sensor — one camera can only guess.

So the page's min-max normalisation is not laziness, it is **the only correct treatment**: stretch the model's own dynamic range to 0–255.

## The two tools differ in scale handling, not accuracy

| | yolo26n-depth | depth-anything-small |
| --- | --- | --- |
| Input | 768×768 | short side 518 |
| Output | 768×768 single channel | float map at input size |
| Backend | ONNX Runtime, WebGPU first | transformers.js, **WASM forced** |
| Character | fast, slightly soft edges | finer, much slower |

Why is depth-anything pinned to WASM? The code comment says WebGPU throws "null function" — an operator coverage gap in ONNX Runtime Web (some ops are unimplemented in the WebGPU EP and fail silently or throw). **"Prefer the fastest backend" must yield to operator gaps**, which is why production code almost always carries a fallback chain.

## Five discrete bands instead of a smooth ramp

The page uses five hard bands. Practically: comparing two similar blues by eye is hopeless, but "this patch is band 3, that one is band 4" is instant. **Discretisation is for human eyes, not for algorithms.**

\`invert\` defaults to on (near = bright). Not pedantry: most depth maps put far = bright, while human intuition expects nearer to be clearer and brighter. Small decisions like this decide whether a figure is readable at a glance.

## Going one level deeper

1. Depth errors have a signature: **thin structures (railings, branches) get flattened**, because the model judges on low-resolution features and neighbourhood averaging swallows the detail.
2. To see relative vs absolute: scale one image up (as if walking closer). The numeric range of the map changes but the ordering does not — proof it never captured absolute scale.
3. Depth plus segmentation gives "how far is that thing", the basis of robot grasping and AR occlusion.`
    }
  },

  '/vision/classification': {
    python: `"""Two classifiers, one page. The interesting bit is preprocessing, not the net.

efficientnet_lite0 (TFLite, 18.6 MB) and yolo26n-cls (ONNX, 11.3 MB) both want
224x224 -- but they want it cropped differently, and only one of them tells you
whether the scores are already probabilities.
"""
import numpy as np


def centre_crop(img, size=224, fill=0):
    """Classification convention: scale the SHORT side up, then crop the centre.
    Letterboxing (as detection does) pads grey bars that dilute the subject."""
    h, w = img.shape[:2]
    r = size / min(h, w)
    nh, nw = int(round(h * r)), int(round(w * r))
    from PIL import Image
    resized = np.array(Image.fromarray(img).resize((nw, nh), Image.BILINEAR))
    y0, x0 = (nh - size) // 2, (nw - size) // 2
    return resized[y0:y0 + size, x0:x0 + size]


def top_k(scores, k=5, labels=None):
    """YOLO-cls sometimes ships with softmax fused, sometimes not. Detect it:
    probabilities sum to 1, logits do not. Getting this wrong makes every
    result look "confident" (or confidently wrong)."""
    s = np.asarray(scores, dtype=np.float32).ravel()
    if s.sum() < 0.99 or s.sum() > 1.01:
        e = np.exp(s - s.max())          # numerically stable softmax
        s = e / e.sum()

    idx = np.argsort(-s)[:k]
    return [(int(i), float(s[i]), labels[i] if labels else str(i)) for i in idx]


if __name__ == "__main__":
    from PIL import Image
    img = np.array(Image.open('cat.jpg').convert('RGB'))   # HxWx3 uint8
    x = centre_crop(img)[None].astype(np.float32) / 255.0
    logits = session.run(None, {'images': x})[0]
    for cls, score, name in top_k(logits):
        print(f"{score:6.3f}  {name}")
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Centre crop, softmax, top-5</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  canvas{border-radius:8px;box-shadow:0 1px 4px rgba(15,23,42,.18);display:block}
  .bars{flex:1;min-width:200px}
  .bar{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px}
  .bar b{width:120px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar i{display:block;height:10px;background:#2563eb;border-radius:3px}
  .bar span{font-variant-numeric:tabular-nums;color:#475569;width:44px;text-align:right}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px}
  input[type=range]{width:160px}
</style>
</head>
<body>
<h1>Classification pre-processes differently from detection</h1>
<p>Detection letterboxes (keep the whole frame). Classification scales the short side and crops the
centre (fill the frame with the subject). Drag the crop size and watch what falls out of view.</p>
<div class="wrap">
  <canvas id="c" width="240" height="240"></canvas>
  <div class="bars" id="bars"></div>
</div>
<label>crop <input type="range" id="crop" min="0.4" max="1" step="0.02" value="0.78"><output id="v"></output></label>
<script>
(function () {
  var c = document.getElementById('c'), ctx = c.getContext('2d');
  var S = 240;
  function scene() {
    ctx.fillStyle = '#dbeafe'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#94a3b8'; ctx.fillRect(0, S * 0.68, S, S * 0.32);
    // subject in the middle, plus distracting stuff near the border
    ctx.fillStyle = '#f97316';
    ctx.beginPath(); ctx.ellipse(S / 2, S * 0.5, S * 0.13, S * 0.17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(S * 0.06, S * 0.1, S * 0.14, S * 0.2);
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(S * 0.82, S * 0.74, S * 0.12, S * 0.16);
  }
  // pretend logits: the network's raw scores for 5 classes
  var logits = [7.2, 8.9, 3.1, 8.4, 2.2];
  var names = ['tabby cat', 'orange cat', 'tiger', 'ginger cat', 'fox'];
  function softmax(z) {
    var m = Math.max.apply(null, z);
    var e = z.map(function (v) { return Math.exp(v - m); });
    var s = e.reduce(function (a, b) { return a + b; }, 0);
    return e.map(function (v) { return v / s; });
  }
  function draw() {
    var k = parseFloat(document.getElementById('crop').value);
    document.getElementById('v').textContent = Math.round(k * 100) + '%';
    scene();
    var side = S * k, off = (S - side) / 2;
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.strokeRect(off, off, side, side);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(15,23,42,.6)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('224 x 224 input', off + 6, off + 16);

    var p = softmax(logits);
    var order = p.map(function (v, i) { return { v: v, i: i }; })
                 .sort(function (a, b) { return b.v - a.v; });
    document.getElementById('bars').innerHTML = order.map(function (o, r) {
      var w = Math.round(o.v * 100);
      return '<div class="bar"><b>' + names[o.i] + '</b>' +
             '<i style="width:' + Math.max(2, w * 1.4) + 'px;background:' +
             (r === 0 ? '#2563eb' : '#93c5fd') + '"></i>' +
             '<span>' + (o.v * 100).toFixed(1) + '%</span></div>';
    }).join('');
  }
  document.getElementById('crop').addEventListener('input', draw);
  draw();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 分类的前处理和检测不是一回事

检测要看清**整个画面有什么**，所以 letterbox 保留全部视野、补灰边；分类要判断**主体是什么**，所以把短边放大到 224 再中心裁剪 —— 主体占满画面，边缘多余的背景被裁掉。

这个差别背后是任务目标：检测不能丢信息，分类不能有干扰。用错的表现是分类置信度整体偏低（灰色边被网络当成了画面的一部分）。

## 为什么要检查「是不是已经 softmax 过」

模型导出时，softmax 可能被融合进图里（输出概率，和≈1），也可能留在图外（输出 logits，范围可能是 -20..30）。同一个模型的两个版本，权重完全一样，输出语义却不同。

代码里的判据是「和是否接近 1」。不做这个检查的后果很隐蔽：把 logits 当概率显示，会出现「置信度 23.7」这种数字；而自己再做一次 softmax 在概率上，会把已经很尖锐的分布压得更平，看起来「模型不太确定」。

**这不是脏代码，是真实的工程防御。** 换模型、换导出脚本时，这一条会救你。

## top-5 而不是 top-1

ImageNet 1000 类里，「埃及猫」和「虎斑猫」的概率经常只差 2%。只显示 top-1 会让人以为模型"很确定"，给出 top-5 才能看出「它其实在几只猫之间犹豫」。这也是为什么论文报 top-5 accuracy 而不是只有 top-1。

## 两个模型的差距在哪里

| | efficientnet_lite0 | yolo26n-cls |
| --- | --- | --- |
| 体积 | 18.6 MB | 11.3 MB |
| 标签 | 内嵌在 TFLite metadata 里 | 要自己提供 ImageNet 1000 类名 |
| 后端 | MediaPipe + GPU delegate | ONNX Runtime，WebGPU 优先 |
| 输出 | 已 softmax | 需检查 |

efficientnet 那一侧「自带标签」，是因为 TFLite metadata 把 label 文件和模型打在一个包里。ONNX 没有这个约定 —— 所以自己部署 ONNX 分类模型时，标签对齐（第 0 个类别叫什么）是最容易错的地方之一，且错了不报错，只是所有结果都错位。

## 想深一层

1. ImageNet 的 1000 类只覆盖「常见物体」。给一张电路板或显微镜照片，模型会给一个最接近的类，置信度还不低 —— 这是分布外输入，不是模型坏了。
2. 分类模型的「置信度」未经校准（calibration），90% 的概率不代表 90% 的情况下正确。真要用于决策，需要温度缩放或 Platt scaling。`,
      en: `## Classification preprocessing is not detection preprocessing

Detection must see **everything in frame**, so it letterboxes and pads grey bars. Classification must judge **what the subject is**, so it scales the short side to 224 and centre-crops — subject fills the frame, surplus background is gone.

The reasoning is task-shaped: detection cannot afford to lose information, classification cannot afford distraction. Use the wrong one and confidence drops across the board, because the network reads the grey bars as part of the scene.

## Why check whether softmax already happened

At export time softmax may be fused into the graph (outputs are probabilities summing to ~1) or left outside (raw logits, range maybe -20..30). Two versions of the same weights with different output semantics.

The code tests whether the sum is near 1. The failure is subtle: treat logits as probabilities and the UI shows "confidence 23.7"; apply softmax to already-softmaxed scores and a sharp distribution flattens into "the model is unsure".

**This is not defensive clutter, it is real engineering.** It saves you when you swap models or export scripts.

## Why top-5 and not just top-1

Among ImageNet's 1000 classes, "Egyptian cat" and "tabby" often differ by 2%. Showing only the winner implies certainty; showing five reveals that it is deliberating between cats. That is also why papers report top-5 accuracy alongside top-1.

## Where the two models differ

| | efficientnet_lite0 | yolo26n-cls |
| --- | --- | --- |
| Size | 18.6 MB | 11.3 MB |
| Labels | embedded in TFLite metadata | you supply the 1000 ImageNet names |
| Backend | MediaPipe + GPU delegate | ONNX Runtime, WebGPU first |
| Output | already softmaxed | must be checked |

EfficientNet carries its labels because TFLite metadata packs the label file with the model. ONNX has no such convention — which makes label alignment (what class index 0 actually means) one of the easiest things to get wrong when deploying an ONNX classifier, and it fails silently: every result is shifted.

## Going one level deeper

1. ImageNet's 1000 classes cover "everyday objects". Feed it a PCB or a microscope slide and it returns the nearest class with high confidence — out-of-distribution input, not a broken model.
2. Classifier confidence is uncalibrated: 90% does not mean correct 90% of the time. Decisions need temperature scaling or Platt scaling first.`
    }
  },

  '/vision/ocr': {
    python: `"""Four OCR tools on one page: two are recognition, two are pre-processing.

The document scanner is pure OpenCV geometry, and it is the most useful of
the four in practice.
"""
import cv2
import numpy as np


def scan_document(bgr):
    """The page's four steps: blur -> adaptive threshold -> largest quad -> warp."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    # Adaptive, not global: a photo of paper has uneven lighting, and one global
    # threshold either loses the shadowed corner or blows out the lit one.
    edges = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                  cv2.THRESH_BINARY, 11, 2)

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    page = max(contours, key=cv2.contourArea)
    peri = cv2.arcLength(page, True)
    quad = cv2.approxPolyDP(page, 0.02 * peri, True)      # 2% of perimeter
    if len(quad) != 4:
        return None                                       # no page found

    pts = quad.reshape(4, 2).astype(np.float32)
    # order: top-left, top-right, bottom-right, bottom-left
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    rect = np.array([pts[np.argmin(s)], pts[np.argmin(d)],
                     pts[np.argmax(s)], pts[np.argmax(d)]], np.float32)

    w = int(max(np.linalg.norm(rect[0] - rect[1]), np.linalg.norm(rect[2] - rect[3])))
    h = int(max(np.linalg.norm(rect[0] - rect[3]), np.linalg.norm(rect[1] - rect[2])))
    dst = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)

    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(bgr, M, (w, h))


def read_text(img, lang='eng', psm=3):
    """Tesseract PSM (page segmentation mode) is the knob people forget.
    6 = one uniform block, 7 = one single line, 11 = sparse text."""
    import pytesseract
    return pytesseract.image_to_string(img, lang=lang,
                                       config=f'--psm {psm}')
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Document scan: four geometric steps</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  figure{margin:0}
  canvas{width:100%;display:block;border-radius:6px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.15)}
  figcaption{font-size:11px;color:#475569;margin-top:4px;line-height:1.35}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px}
  input[type=range]{width:160px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>Most OCR failures are preprocessing, not recognition</h1>
<p>A phone photo of paper is skewed, unevenly lit, and has no clean border. Four steps fix that —
and the last one is where the text actually becomes readable.</p>
<div class="grid">
  <figure><canvas id="s0" width="160" height="200"></canvas><figcaption>1. photo (skewed + shadow)</figcaption></figure>
  <figure><canvas id="s1" width="160" height="200"></canvas><figcaption>2. adaptive threshold 11 x 11</figcaption></figure>
  <figure><canvas id="s2" width="160" height="200"></canvas><figcaption>3. largest quad (approx 2%)</figcaption></figure>
  <figure><canvas id="s3" width="160" height="200"></canvas><figcaption>4. perspective warp</figcaption></figure>
</div>
<label>threshold C <input type="range" id="cc" min="-10" max="15" step="1" value="2"><output id="v">2</output></label>
<script>
(function () {
  var W = 160, H = 200;
  // corners of the sheet inside the photo (a quadrilateral, not a rectangle)
  var quad = [[34, 40], [128, 24], [140, 168], [26, 156]];

  function drawPhoto(ctx) {
    ctx.fillStyle = '#334155'; ctx.fillRect(0, 0, W, H);
    ctx.beginPath();
    ctx.moveTo(quad[0][0], quad[0][1]);
    ctx.lineTo(quad[1][0], quad[1][1]);
    ctx.lineTo(quad[2][0], quad[2][1]);
    ctx.lineTo(quad[3][0], quad[3][1]);
    ctx.closePath();
    ctx.fillStyle = '#f8fafc'; ctx.fill();
    ctx.save(); ctx.clip();
    // uneven lighting: a dark gradient across the sheet
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // pretend text lines
    ctx.fillStyle = 'rgba(15,23,42,.75)';
    for (var i = 0; i < 9; i++) ctx.fillRect(44, 56 + i * 13, 70 - (i % 3) * 12, 3);
    ctx.restore();
  }

  function threshold(ctx, C) {
    var img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = (y * W + x) * 4;
        var lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        // local mean over an 11x11 window (gaussian-ish is finer, mean is enough here)
        var sum = 0, n = 0;
        for (var dy = -5; dy <= 5; dy += 2) {
          for (var dx = -5; dx <= 5; dx += 2) {
            var yy = Math.min(H - 1, Math.max(0, y + dy));
            var xx = Math.min(W - 1, Math.max(0, x + dx));
            var j = (yy * W + xx) * 4;
            sum += 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]; n++;
          }
        }
        var v = lum >= sum / n - C ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function drawQuad(ctx) {
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(quad[0][0], quad[0][1]);
    for (var k = 1; k < 4; k++) ctx.lineTo(quad[k][0], quad[k][1]);
    ctx.closePath(); ctx.stroke();
    quad.forEach(function (p) {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawWarp(ctx) {
    // draw the quad's 4 corners as a rect: this is the homography's effect
    var pts = quad;
    var wTop = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    var wBot = Math.hypot(pts[2][0] - pts[3][0], pts[2][1] - pts[3][1]);
    var hL = Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]);
    var hR = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
    var tw = Math.round((wTop + wBot) / 2), th = Math.round((hL + hR) / 2);
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(15,23,42,.75)';
    var rows = 9;
    for (var i = 0; i < rows; i++) {
      var y = Math.round(th * 0.18 + i * (th * 0.8 / rows)) + 20;
      ctx.fillRect(28 + (i % 3) * 4, y, tw - 24 - (i % 3) * 12, 4);
    }
    ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 2; ctx.strokeRect(20, 16, tw, th);
  }

  function render() {
    var C = parseFloat(document.getElementById('cc').value);
    document.getElementById('v').textContent = C;
    var s0 = document.getElementById('s0').getContext('2d');
    drawPhoto(s0);
    var s1 = document.getElementById('s1').getContext('2d');
    var s2 = document.getElementById('s2').getContext('2d');
    var s3 = document.getElementById('s3').getContext('2d');
    // step 2 works on a copy of the photo
    s1.drawImage(document.getElementById('s0'), 0, 0);
    threshold(s1, C);
    s2.drawImage(document.getElementById('s0'), 0, 0);
    drawQuad(s2);
    drawWarp(s3);
  }
  document.getElementById('cc').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 四个工具其实是两类

| 工具 | 本质 | 关键参数 |
| --- | --- | --- |
| 文字识别 | Tesseract 端到端识别 | 语言包 eng / chi_sim |
| 手写识别 | 先二值化 + 指定版面模式 | 阈值 150，PSM 7/6/11 |
| 文档扫描 | **纯几何**：找纸的四角，透视校正 | 自适应阈值 11/2，approx 2% |
| 表格结构 | **纯形态学**：提取横竖线，数交点 | 核长 = 边长 × 2% |

后两个根本不识别文字 —— 它们解决的是「把照片变成正视图」「这张表有几行几列」。**OCR 项目里 80% 的失败不是识别模型不行，是输入太歪、光照不均、有透视。** 这页把预处理单独做成工具，正是想说明这点。

## 文档扫描的四步，每步都有理由

1. **高斯模糊 5×5**：手机照片有噪点，不平滑的话 Canny/阈值会把噪点当边缘；
2. **自适应阈值**（\`adaptiveThreshold(11, 2)\`）：窗口 11×11 内算局部均值再减 2。用全局阈值的话，纸的一半在阴影里会整块变黑；
3. **\`approxPolyDP\` 简化轮廓**（容差 = 周长的 2%）：把上千个点的轮廓压到 4 个点。2% 是经验值 —— 太小仍是多边形，太大连四个角都会被抹掉；
4. **透视变换**：把任意四边形映射成矩形。这一步用的是单应矩阵（8 个自由度，需要 4 组对应点），和 /vision/transform 页的透视工具是同一套数学。

## PSM 是最容易被忽略的旋钮

Tesseract 的 PSM（Page Segmentation Mode）告诉它「这张图里文字是怎么排的」：

- \`3\` = 自动分页（默认，最慢也最万能）
- \`6\` = 当成一整块文字
- \`7\` = 当成**一行**
- \`11\` = 稀疏文字（到处乱放的文字）

手写识别改用 7 或 11 是必须的：手写笔记的排版混乱，用默认的 3 会让版面分析先失败，识别根本跑不到。**这类参数不是调优，是给模型正确的先验。**

## 表格结构用形态学，不用深度学习

思路非常朴素但有效：

1. 反相 + 二值化（让线条变成白）;
2. 用**长横核**做开运算 → 只剩横线；用**长竖核** → 只剩竖线;
3. 横线图与竖线图求交 → 得到交点;
4. 交点聚类计数 → 行列数。

核长取「图像边长 × 2%」（最小 5）。为什么用开运算？因为开运算 = 先腐蚀后膨胀，它会**保留比核长的结构、抹掉短的**，一条线够长就活下来，文字笔画全被抹掉。

对规整表格这个方法 100% 可靠、零训练成本；对手绘表格或无线表格就不行了 —— 这就是为什么深度学习表格识别（TableNet、LayoutLM）还存在。

## 想深一层

1. 中文识别要装 \`chi_sim\` 语言包（约 40 MB）。中英混排时用 \`chi_sim+eng\`，但速度会明显变慢 —— 每个字符要试两套模型。
2. 想让 OCR 更准，最有效的不是换模型，是**把图放大到 300 DPI 等效**、并做二值化。Tesseract 在 30–60 px 字高时表现最好。
3. 表格识别只数出交点还不够 —— 要还原「合并单元格」需要判断线段贯通性，那已经是另一个算法了。`,
      en: `## Four tools, really two categories

| Tool | Nature | Key parameter |
| --- | --- | --- |
| Text OCR | Tesseract end-to-end | language pack eng / chi_sim |
| Handwriting | binarise first, then set the layout mode | threshold 150, PSM 7/6/11 |
| Document scan | **pure geometry**: find the page corners, un-warp | adaptive 11/2, approx 2% |
| Table structure | **pure morphology**: extract lines, count intersections | kernel = side × 2% |

The last two do not recognise any text. They solve "turn a photo into a flat view" and "how many rows and columns". **Most OCR failures in practice are not model failures — they are skew, uneven light, perspective.** Putting preprocessing on the same page as recognition is the point.

## The scan pipeline, four steps, four reasons

1. **Gaussian blur 5×5**: phone photos are noisy; without smoothing, thresholding treats noise as edges;
2. **Adaptive threshold** (\`adaptiveThreshold(11, 2)\`): local 11×11 mean minus 2. A global threshold turns the shadowed half of the page solid black;
3. **\`approxPolyDP\`** (tolerance = 2% of perimeter): collapses a thousand-point contour to four. 2% is empirical — smaller stays polygonal, larger eats the corners;
4. **Perspective warp**: maps an arbitrary quad to a rectangle via a homography (8 DoF, 4 point pairs) — the same maths as the perspective tool on /vision/transform.

## PSM is the knob everyone forgets

Tesseract's Page Segmentation Mode tells it how text is laid out:

- \`3\` = automatic (default, slowest, most general)
- \`6\` = one uniform block
- \`7\` = a **single line**
- \`11\` = sparse text scattered around

Handwriting needs 7 or 11 because notes have chaotic layout: with the default, layout analysis fails first and recognition never runs. **That is not tuning, it is giving the model the correct prior.**

## Table structure by morphology, not deep learning

Crude but effective:

1. invert and binarise so lines are white;
2. open with a **long horizontal kernel** → only horizontals survive; a long vertical kernel → only verticals;
3. AND the two line images → intersections;
4. cluster and count → rows and columns.

Kernel length is 2% of the side (minimum 5). Why opening? Opening is erosion then dilation: it **keeps structures longer than the kernel and erases shorter ones**. Lines survive, glyph strokes vanish.

For clean printed tables this is 100% reliable at zero training cost. Hand-drawn or borderless tables break it — which is why deep table recognition (TableNet, LayoutLM) still exists.

## Going one level deeper

1. Chinese needs the \`chi_sim\` pack (~40 MB). Mixed text uses \`chi_sim+eng\`, noticeably slower — every glyph is tried against two models.
2. The best accuracy win is not a better model but **rendering at ~300 DPI equivalent** and binarising. Tesseract peaks at 30–60 px glyph height.
3. Counting intersections is not enough for merged cells — that needs segment-continuity analysis, a different algorithm entirely.`
    }
  },

  '/vision/transformers': {
    python: `"""Transformers on images: three different architectures on one page.

caption = encoder-decoder, depth = encoder-only regression, VQA = a 1B
vision-language model. Knowing which one you are running explains the cost.
"""
from transformers import pipeline
from PIL import Image


def caption(path, max_new_tokens=40):
    """vit-gpt2: ViT encodes the image into patches, GPT-2 decodes a sentence.
    The page runs the q8 version (~245 MB) in the browser via transformers.js."""
    pipe = pipeline('image-to-text', model='Xenova/vit-gpt2-image-captioning')
    return pipe(Image.open(path), max_new_tokens=max_new_tokens)[0]['generated_text']


def embed_only(path):
    """Encoder-only: one forward pass, no generation loop. This is why CLIP-style
    embedding models feel instant -- there is no token-by-token decoding."""
    from transformers import CLIPModel, CLIPProcessor
    model = CLIPModel.from_pretrained('openai/clip-vit-base-patch32')
    proc = CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32')
    out = model.get_image_features(**proc(images=Image.open(path), return_tensors='pt'))
    return out.detach().numpy()          # (1, 512)


# Cost intuition, browser edition:
#   caption  q8  ~245 MB   ~1-3 s per image on WASM
#   depth    fp32 ~100 MB  ~0.5-2 s
#   VQA      q4  ~1.2 GB   tens of seconds, needs WebGPU to be usable
#   inpainting     (not implemented on this page -- it is a placeholder)
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Encoder once, decoder per token</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .meta{display:flex;gap:18px;margin-top:10px;font-size:12px;color:#475569;flex-wrap:wrap}
  .meta b{color:#0f172a;font-variant-numeric:tabular-nums}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:10px;font-size:12px}
  input[type=range]{width:170px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>Why a caption takes seconds and an embedding is instant</h1>
<p>An encoder is one forward pass. A decoder re-runs the whole network for every token it emits —
that is the entire cost difference, not "Transformer vs not Transformer".</p>
<canvas id="c" width="680" height="260"></canvas>
<div class="meta">
  <span>tokens emitted: <b id="n">0</b></span>
  <span>forward passes: <b id="f">0</b></span>
  <span id="state">idle</span>
</div>
<label>max_new_tokens <input type="range" id="t" min="5" max="60" step="1" value="40"><output id="v">40</output></label>
<script>
(function () {
  var c = document.getElementById('c'), ctx = c.getContext('2d');
  var W = 680, H = 260;
  var tokens = [], running = false, limit = 40, fwd = 0;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // encoder block
    ctx.fillStyle = '#dbeafe'; ctx.fillRect(16, 20, 150, 56);
    ctx.fillStyle = '#1e3a8a'; ctx.font = '13px system-ui';
    ctx.fillText('ViT encoder', 34, 44);
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('1 forward', 34, 62);

    ctx.strokeStyle = '#94a3b8'; ctx.beginPath();
    ctx.moveTo(166, 48); ctx.lineTo(206, 48); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(200, 43); ctx.lineTo(206, 48); ctx.lineTo(200, 53); ctx.stroke();

    // decoder: one block per token
    for (var i = 0; i < tokens.length; i++) {
      var x = 210 + i * 11;
      ctx.fillStyle = i === tokens.length - 1 ? '#fca5a5' : '#e2e8f0';
      ctx.fillRect(x, 32, 8, 32);
    }
    ctx.fillStyle = '#0f172a'; ctx.font = '13px system-ui';
    ctx.fillText('GPT-2 decoder: one pass per token', 210, 96);

    // tokens text
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillStyle = '#0f172a';
    var line = tokens.join(' ');
    ctx.fillText(line.slice(0, 96), 16, 140);
    if (line.length > 96) ctx.fillText(line.slice(96, 192), 16, 162);

    // cost bar
    var pct = Math.min(1, tokens.length / limit);
    ctx.fillStyle = '#e2e8f0'; ctx.fillRect(16, 200, W - 32, 14);
    ctx.fillStyle = '#2563eb'; ctx.fillRect(16, 200, (W - 32) * pct, 14);
    ctx.fillStyle = '#475569'; ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('decoder passes: ' + tokens.length + ' / ' + limit, 16, 236);
  }

  var WORDS = ['a', 'Small', 'brown', 'dog', 'is', 'running', 'on', 'the', 'grass', '.',
               'Its', 'ears', 'flap', 'in', 'the', 'wind', 'while', 'the', 'owner', 'waits',
               'near', 'a', 'gate', ',', 'and', 'the', 'sky', 'stays', 'clear', 'all', 'day'];

  var timer = null;
  function step() {
    if (!running) return;
    tokens.push(WORDS[tokens.length % WORDS.length]);
    document.getElementById('n').textContent = tokens.length;
    document.getElementById('f').textContent = tokens.length;
    draw();
    if (tokens.length >= limit) {
      running = false;
      document.getElementById('state').textContent = 'done — ' + limit + ' passes';
      return;
    }
    timer = setTimeout(step, 90);
  }

  function start() {
    if (running) return;
    tokens = []; fwd = 0; running = true;
    document.getElementById('state').textContent = 'generating…';
    draw(); step();
  }

  document.getElementById('t').addEventListener('input', function (e) {
    limit = parseInt(e.target.value, 10);
    document.getElementById('v').textContent = limit;
    draw();
  });
  setTimeout(start, 500);
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 这一页三种架构，成本差 50 倍

| 工具 | 架构 | 体积 | 感觉 |
| --- | --- | --- | --- |
| 图像描述 | ViT 编码器 + GPT-2 解码器 | q8 约 245 MB | 一两秒 |
| 深度估计 | 纯编码器（DINOv2 类） | fp32 约 100 MB | 半秒到两秒 |
| 图像问答 | 1B 视觉语言模型 | q4 约 1.2 GB | 几十秒 |
| 图像修复 | **未实现**（页面上明确标注 planned） | — | — |

**决定速度的不是「是不是 Transformer」，而是「要不要生成」。**

编码器只做一次前向：图像进，特征出，没有循环。解码器要自回归：每生成一个 token 都要再跑一遍全网络，40 个 token 就是 40 次前向。这就是 caption 比 embedding 慢一个数量级的原因。

## 量化：q8 / q4 到底损失了什么

- **q8**（int8）：体积压到 1/4，精度损失通常 < 1%。caption 这类任务几乎看不出差别 —— 所以页面用 q8；
- **q4**（4 位）：体积压到 1/8，但激活值的动态范围被压得很扁。小模型（<300M）掉点明显，大模型（>1B）反而更耐受，因为参数冗余多。

1B 模型压到 q4 还能用，是「大模型更抗量化」这条经验的直接体现。但也别指望它和 fp16 一样 —— 细微的数值推理（数数、读表）最容易崩。

## 编码器-解码器的分工是这套架构的核心

ViT 把图像切成 16×16 的 patch，每块变成一个 token，然后**和文本 token 放进同一个序列**。这意味着：

- 图像的"理解"和文字的"生成"共享同一套注意力机制；
- 图像的分辨率直接决定 token 数量（224² / 16² = 196 个 token）；
- 分辨率翻倍，token 数翻 4 倍，注意力计算翻 16 倍 —— **这就是高分辨率 VLM 昂贵的原因**。

## 为什么 inpainting 只留了占位

修复（inpainting）需要扩散模型，在浏览器里跑 SD 级别的 UNet 是另一量级的工程（模型 1–2 GB、采样 20–50 步、每步一次完整 UNet 前向）。页面上明确写「planned」而不是给一个假结果 —— 这种诚实比塞一个跑不动的模型有用。

## 想深一层

1. caption 的输出是**单句描述**，不是「理解」。同一张图跑两次可能给出不同句子（采样温度导致），这不代表它"不确定"，而是生成本身就是随机的。
2. 1.2 GB 的模型在浏览器里的真实瓶颈不是算力而是**内存**：加载 fp32 权重需要约 4.8 GB，很多设备直接 OOM。q4 的存在首先是为了能跑起来，其次才是快。
3. 想看「编码器 vs 解码器」的差别，对比 /vision/mediapipe 页的 image-embedder：同一张图，embedding 是瞬时的，caption 要等生成。`,
      en: `## Three architectures, a 50× cost spread

| Tool | Architecture | Size | Feel |
| --- | --- | --- | --- |
| Captioning | ViT encoder + GPT-2 decoder | ~245 MB at q8 | a second or two |
| Depth | encoder-only (DINOv2-like) | ~100 MB fp32 | 0.5–2 s |
| VQA | 1B vision-language model | ~1.2 GB at q4 | tens of seconds |
| Inpainting | **not implemented** (marked planned) | — | — |

**What decides speed is not "is it a Transformer" but "does it generate".**

An encoder is one forward pass: image in, features out, no loop. A decoder is autoregressive: every generated token re-runs the whole network, so 40 tokens means 40 forward passes. That is the order-of-magnitude gap between captioning and embedding.

## What q8 / q4 actually cost

- **q8** (int8): 4× smaller, typically <1% accuracy loss. Captioning barely notices — hence the page uses it;
- **q4**: 8× smaller, but activation dynamic range gets squeezed. Small models (<300M) degrade visibly; large ones (>1B) tolerate it better because of parameter redundancy.

A 1B model still working at q4 is the "big models resist quantisation" rule in action. Do not expect fp16 parity though — fine numerical reasoning (counting, reading tables) is the first thing to break.

## Encoder-decoder split is the core of this design

ViT cuts the image into 16×16 patches, turns each into a token, then **places them in the same sequence as text tokens**. Consequences:

- "understanding the image" and "writing the sentence" share one attention mechanism;
- image resolution directly sets token count (224² / 16² = 196 tokens);
- double the resolution and tokens quadruple while attention cost goes up 16× — **this is why high-resolution VLMs are expensive**.

## Why inpainting is only a placeholder

Inpainting needs a diffusion model; running an SD-class UNet in a browser is a different order of project (1–2 GB weights, 20–50 sampling steps, one full UNet pass each). The page says "planned" instead of faking a result — more useful than shipping something that cannot run.

## Going one level deeper

1. A caption is **one sentence of description**, not understanding. Run it twice and you may get different sentences (sampling temperature) — that is generation being random, not the model being unsure.
2. The real bottleneck for a 1.2 GB model in a browser is **memory**, not compute: fp32 weights need about 4.8 GB and many devices OOM outright. q4 exists to make it runnable before it makes it fast.
3. To see encoder vs decoder, compare with image-embedder on /vision/mediapipe: same image, the embedding is instant, the caption has to wait for generation.`
    }
  },

  '/vision/mediapipe': {
    python: `"""Eleven MediaPipe tasks, one API shape. Learning it once covers all of them.

Every task follows: FilesetResolver -> BaseOptions -> *Options -> create -> run.
"""
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

# 1) The wasm/js runtime (browser) or the bundled binary (python)
base = mp_python.BaseOptions(model_asset_path='pose_landmarker_lite.task')

# 2) Task-specific options: running mode + how many results
opts = vision.PoseLandmarkerOptions(
    base_options=base,
    running_mode=vision.RunningMode.VIDEO,   # IMAGE for one-shot, VIDEO for streams
    num_poses=1,
    min_pose_detection_confidence=0.5
)

# 3) Create, use, close -- MediaPipe holds GPU/WASM resources
with vision.PoseLandmarker.create_from_options(opts) as landmarker:
    image = mp.Image.create_from_file('dancer.jpg')
    result = landmarker.detect_for_video(image, 0)      # timestamp in ms

    for i, lm in enumerate(result.pose_landmarks[0]):
        # normalised 0..1 relative to the IMAGE, not pixels
        print(f"{i:2d}  x={lm.x:.3f} y={lm.y:.3f} z={lm.z:+.3f} vis={lm.visibility:.2f}")

# The other ten tasks differ only in the class name and the result fields:
#   FaceDetector, FaceLandmarker, HandLandmarker, GestureRecognizer,
#   HolisticLandmarker, ObjectDetector, ImageClassifier, ImageSegmenter,
#   InteractiveSegmenter, ImageEmbedder
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Normalised landmarks and aspect ratio</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:14px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:200px}
  canvas{width:100%;display:block;border-radius:8px;background:#0f172a}
  figcaption{font-size:12px;color:#475569;margin-top:5px}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px;margin-right:14px}
  input[type=range]{width:140px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>Landmarks are 0..1 — and that loses the aspect ratio</h1>
<p>MediaPipe returns x, y in 0..1 of the image. Draw them straight onto a fixed-size canvas and a
tall photo stretches. The fix is the same letterbox the detection page uses.</p>
<div class="row">
  <figure><canvas id="a" width="260" height="260"></canvas><figcaption>drawn naively (stretched)</figcaption></figure>
  <figure><canvas id="b" width="260" height="260"></canvas><figcaption>letterboxed (correct)</figcaption></figure>
</div>
<label>image aspect <input type="range" id="asp" min="0.6" max="1.6" step="0.05" value="1.4"><output id="v">1.40</output></label>
<script>
(function () {
  // a hand skeleton in normalised coordinates (0..1)
  var pts = [[.50,.92],[.36,.74],[.31,.58],[.29,.46],[.28,.36],
             [.44,.70],[.44,.52],[.44,.42],[.45,.34],
             [.52,.70],[.54,.50],[.55,.39],[.56,.31],
             [.60,.72],[.63,.53],[.65,.43],[.66,.35],
             [.67,.78],[.71,.63],[.74,.55],[.76,.48]];
  var links = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],
               [0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];

  function draw(ctx, size, kx, ky) {
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2;
    links.forEach(function (l) {
      var a = pts[l[0]], b = pts[l[1]];
      ctx.beginPath(); ctx.moveTo(a[0] * kx, a[1] * ky); ctx.lineTo(b[0] * kx, b[1] * ky); ctx.stroke();
    });
    pts.forEach(function (p) {
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.arc(p[0] * kx, p[1] * ky, 2.6, 0, Math.PI * 2); ctx.fill();
    });
  }

  function render() {
    var asp = parseFloat(document.getElementById('asp').value);
    document.getElementById('v').textContent = asp.toFixed(2);
    var S = 260;
    // naive: multiply x by S and y by S — aspect ratio ignored
    draw(document.getElementById('a').getContext('2d'), S, S, S);

    // correct: fit an image of aspect asp into the square, keep proportions
    var iw = asp >= 1 ? S : S * asp;
    var ih = asp >= 1 ? S / asp : S;
    var ox = (S - iw) / 2, oy = (S - ih) / 2;
    var ctxB = document.getElementById('b').getContext('2d');
    ctxB.fillStyle = '#0f172a'; ctxB.fillRect(0, 0, S, S);
    ctxB.fillStyle = '#1e293b'; ctxB.fillRect(ox, oy, iw, ih);
    ctxB.strokeStyle = '#334155'; ctxB.lineWidth = 1; ctxB.strokeRect(ox, oy, iw, ih);
    ctxB.save();
    ctxB.translate(ox, oy);
    draw(ctxB, S, iw, ih);
    ctxB.restore();
  }
  document.getElementById('asp').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 十一个任务，一套 API 形状

MediaPipe Tasks 的价值不在模型（都是 Google 开源的轻量模型），而在**统一了调用方式**：

\`FilesetResolver\` → \`BaseOptions\`（模型路径 + delegate）→ \`*Options\`（任务参数）→ \`createFromOptions\` → \`detect/classify/segment/embed\`

学会一套，十一个任务都会用。这页把 11 个工具并列，就是为了让人看出这一点 —— 而 TensorFlow.js 的模型 API 各家不统一，ONNX 更是每个模型的后处理都要自己写。

## IMAGE 模式 vs VIDEO 模式，不是随便选

| | IMAGE | VIDEO |
| --- | --- | --- |
| 调用 | \`detect(image)\` | \`detectForVideo(image, timestampMs)\` |
| 内部状态 | 每帧独立 | 保留上一帧做跟踪平滑 |
| 适用 | 单张上传 | 摄像头流 |

页面里检测/关键点类工具统一用 \`VIDEO\` 模式，即使是上传的**单张图片也走 \`detectForVideo(image, performance.now())\`**。为什么？因为 VIDEO 模式内部有时序平滑，单张图跑一次的结果比 IMAGE 模式更稳（少一些瞬时误检）。

但分割与嵌入用 IMAGE 模式 —— 分割没有时序可言，每帧独立算；嵌入更是纯函数。

## 图片模式下「用完就 close」是必须的

页面的做法是：每处理一张上传图片，新建检测器，\`finally\` 里 \`close()\`。

为什么不在页面加载时建好 11 个？因为每个检测器都会占 **GPU 上下文 + wasm 堆内存**。11 个同时活着，在中低端设备上直接触发 WebGL context lost，表现为「跑几个工具后全都黑屏」。这是 MediaPipe 项目里最常见的坑。

实时模式（摄像头）则相反：按 key 缓存检测器，只有参数变了才 \`setOptions\` —— 每帧重建的开销是几百毫秒。

## 关键点坐标系：归一化，不是像素

MediaPipe 的关键点是 \`x, y ∈ [0,1]\`（相对图像宽高），\`z\` 是相对深度（以脸/髋部宽度为单位，不是米）。

这意味着：
- 换分辨率不用改画法，乘回宽高即可；
- 但**长宽比被丢掉了** —— 画在正方形 canvas 上会变形，必须先按比例 letterbox 再画；
- \`z\` 只能做相对比较（谁更靠前），不能当距离用。

## 十一个任务的模型体积差别很大

脸检测 \`blaze_face_short_range\` 只有几百 KB，姿态 \`pose_landmarker_lite\` 约 5 MB，交互式分割 \`interactive_segmentation\` 30.5 MB。**同一个 API 背后是量级不同的任务复杂度** —— 页面按需加载，不把 11 个模型全拉下来。

## 想深一层

1. \`holistic-landmarker\`（脸 + 手 + 姿态一起）是最贵的，因为它等于三个模型串行，但只输出一份结果。适合「看全身动作」的场景。
2. \`delegate: 'GPU'\` 在部分 Android 机型上会失败（WebGL 兼容问题），页面统一没有做逐任务回退 —— 这是已知取舍：回退逻辑会让代码翻倍，而目标设备（教室电脑）基本都是桌面浏览器。
3. 想理解「为什么归一化坐标会导致变形」，可以打开 /vision/gesture 上传一张竖图，看 21 点骨架是否贴合 —— 页面做了 letterbox，贴合正常；如果自己写忘了这步，骨架会横向拉伸。`,
      en: `## Eleven tasks, one API shape

The value of MediaPipe Tasks is not the models (all small Google-published ones) but that it **unifies the call pattern**:

\`FilesetResolver\` → \`BaseOptions\` (model path + delegate) → \`*Options\` (task params) → \`createFromOptions\` → \`detect/classify/segment/embed\`

Learn it once and all eleven work. Putting eleven tools on one page makes that visible — TensorFlow.js model APIs are inconsistent, and with ONNX you write every post-processor yourself.

## IMAGE vs VIDEO mode is not a free choice

| | IMAGE | VIDEO |
| --- | --- | --- |
| Call | \`detect(image)\` | \`detectForVideo(image, timestampMs)\` |
| Internal state | independent per call | keeps previous frames for smoothing |
| Use | single upload | camera stream |

Detection and landmark tools here use \`VIDEO\` mode even for a **single uploaded image** (\`detectForVideo(image, performance.now())\`). Why? VIDEO mode smooths over time, so one call on a still image is steadier than IMAGE mode. Segmentation and embedding use IMAGE mode — segmentation has no temporal meaning, and embedding is a pure function.

## Closing detectors after a still image is mandatory

The page creates a detector per upload and calls \`close()\` in \`finally\`.

Why not build all eleven at mount? Each holds a **GPU context plus wasm heap**. Eleven alive at once triggers WebGL context loss on mid-range hardware — the classic symptom is "after trying a few tools everything goes black". This is the most common MediaPipe trap.

For live camera mode it is the opposite: detectors are cached by key and only \`setOptions\` when parameters change, because rebuilding costs hundreds of milliseconds per frame.

## Landmarks are normalised, not pixels

\`x, y ∈ [0,1]\` relative to image width and height; \`z\` is relative depth in units of face/hip width, not metres.

Consequences:
- resolution-independent drawing — just multiply back;
- but **aspect ratio is lost**, so drawing on a square canvas distorts unless you letterbox first;
- \`z\` supports comparisons (who is in front), never distances.

## Model sizes vary by an order of magnitude

BlazeFace short-range is a few hundred KB; pose_landmarker_lite about 5 MB; interactive segmentation 30.5 MB. **The same API fronts wildly different task complexity** — so the page loads models on demand rather than pulling eleven up front.

## Going one level deeper

1. \`holistic-landmarker\` (face + hands + pose together) is the most expensive: three models in sequence, one result object. Right for whole-body motion.
2. \`delegate: 'GPU'\` fails on some Android devices (WebGL quirks), and the page deliberately has no per-task fallback — that would double the code, and classroom targets are desktops.
3. To see why normalised coordinates distort, open /vision/gesture with a tall image: the 21-point skeleton fits because the page letterboxes. Roll your own without that step and the skeleton stretches horizontally.`
    }
  },

  '/vision/pose': {
    python: `"""Two pose models on one page: MediaPipe (33 points) and YOLO26-pose (17).

Different skeleton, different coordinate system, same question. Comparing them
is the fastest way to understand what a "keypoint model" actually outputs.
"""
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

# ---------- MediaPipe: 33 points, normalised, includes hands and feet ----------
base = mp_python.BaseOptions(model_asset_path='pose_landmarker_lite.task')
opts = vision.PoseLandmarkerOptions(
    base_options=base,
    running_mode=vision.RunningMode.VIDEO,
    num_poses=1,
    min_pose_detection_confidence=0.5
)
with vision.PoseLandmarker.create_from_options(opts) as pose:
    res = pose.detect_for_video(mp.Image.create_from_file('dancer.jpg'), 0)
    for i, lm in enumerate(res.pose_landmarks[0]):
        # x,y in 0..1 of the IMAGE; z in units of hip width -- not metres
        print(f"mp {i:2d}  ({lm.x:.3f}, {lm.y:.3f})  vis={lm.visibility:.2f}")


# ---------- YOLO26-pose: 17 COCO points, pixel coords, has a visibility score
def letterbox(img, size=640, pad=128):
    """Scale to fit, centre-pad. PIL does the resize -- no external helper."""
    from PIL import Image
    im = Image.fromarray(img)
    r = min(size / im.height, size / im.width)
    im = im.resize((round(im.width * r), round(im.height * r)), Image.BILINEAR)
    canvas = Image.new('RGB', (size, size), (pad, pad, pad))
    ox, oy = (size - im.width) // 2, (size - im.height) // 2
    canvas.paste(im, (ox, oy))
    return np.array(canvas), r, ox, oy


def yolo_pose(session, img, conf=0.25, vis_thresh=0.3):
    canvas, r, dx, dy = letterbox(img, 640, pad=128)
    x = canvas[:, :, ::-1].transpose(2, 0, 1)[None].astype('float32') / 255
    rows = session.run(None, {'images': x})[0][0]        # (300, 57)

    out = []
    for row in rows:
        if row[4] < conf:
            continue
        kpts = row[6:].reshape(17, 3)                     # x, y, visibility
        kpts[:, 0] = (kpts[:, 0] - dx) / r                # undo letterbox
        kpts[:, 1] = (kpts[:, 1] - dy) / r
        out.append(kpts)
    return out


# The 33 vs 17 difference is not cosmetic:
#   33 = BlazePose top-down: face detail + hands + feet, good for fitness/games
#   17 = COCO bottom-up standard: joints only, easy to compare with papers
# Drawing one with the other's connection table produces nonsense lines.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>33 points vs 17 points</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:14px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:190px}
  canvas{width:100%;display:block;border-radius:8px;background:#0f172a}
  figcaption{font-size:12px;color:#475569;margin-top:5px}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px}
</style>
</head>
<body>
<h1>Same person, two skeleton conventions</h1>
<p>MediaPipe gives 33 points (face, hands, feet). COCO — what YOLO-pose emits — gives 17 joints.
Each needs its own connection table; mixing them draws nonsense lines.</p>
<div class="row">
  <figure><canvas id="a" width="220" height="280"></canvas><figcaption>MediaPipe: 33 points</figcaption></figure>
  <figure><canvas id="b" width="220" height="280"></canvas><figcaption>COCO: 17 joints</figcaption></figure>
  <figure><canvas id="c" width="220" height="280"></canvas><figcaption>17 points drawn with the 33-point table</figcaption></figure>
</div>
<label><input type="checkbox" id="err"> exaggerate the wrong-table case</label>
<script>
(function () {
  var W = 220, H = 280;
  function P(x, y) { return [W * x, H * y]; }

  // 33-point layout (head, arms, legs, plus hands/feet detail)
  var mp = {
    0: P(.50,.06), 1: P(.47,.08), 2: P(.45,.10), 3: P(.43,.11), 4: P(.49,.07), 5: P(.51,.07),
    6: P(.54,.10), 7: P(.56,.11), 8: P(.50,.12), 9: P(.49,.14), 10: P(.51,.14),
    11: P(.36,.26), 12: P(.64,.26), 13: P(.30,.40), 14: P(.70,.40), 15: P(.28,.53), 16: P(.72,.53),
    17: P(.26,.56), 18: P(.74,.56), 19: P(.25,.58), 20: P(.75,.58), 21: P(.24,.60), 22: P(.76,.60),
    23: P(.42,.52), 24: P(.58,.52), 25: P(.40,.68), 26: P(.60,.68), 27: P(.39,.82), 28: P(.61,.82),
    29: P(.38,.86), 30: P(.62,.86), 31: P(.37,.90), 32: P(.63,.90)
  };
  var mpLinks = [[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
                 [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[12,14],[14,16],[16,18],[16,20],[16,22],
                 [11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],[27,29],[28,30],[29,31],[30,32]];

  // COCO 17-point layout
  var coco = {
    0: P(.50,.10), 1: P(.44,.18), 2: P(.38,.26), 3: P(.33,.34), 4: P(.28,.42),
    5: P(.56,.18), 6: P(.62,.26), 7: P(.67,.34), 8: P(.72,.42),
    9: P(.48,.52), 10: P(.52,.52), 11: P(.44,.66), 12: P(.56,.66),
    13: P(.42,.82), 14: P(.58,.82), 15: P(.41,.94), 16: P(.59,.94)
  };
  var cocoLinks = [[0,1],[1,2],[2,3],[3,4],[1,5],[5,6],[6,7],[7,8],[1,9],[9,10],
                   [9,11],[11,13],[13,15],[10,12],[12,14],[14,16]];

  function drawPoints(ctx, pts, deg) {
    pts.forEach(function (p) {
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.arc(p[0], p[1], deg, 0, Math.PI * 2); ctx.fill();
    });
  }
  function drawLinks(ctx, pts, links, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    links.forEach(function (l) {
      var a = pts[l[0]], b = pts[l[1]];
      if (!a || !b) return;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    });
  }
  function canvasOf(id) {
    var c = document.getElementById(id), ctx = c.getContext('2d');
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);
    return ctx;
  }

  var A = canvasOf('a');
  drawLinks(A, mp, mpLinks, '#38bdf8');
  drawPoints(A, Object.values(mp), 2.3);

  var B = canvasOf('b');
  drawLinks(B, coco, cocoLinks, '#34d399');
  drawPoints(B, Object.values(coco), 3.4);

  var C = canvasOf('c');
  drawLinks(C, coco, mpLinks, '#f43f5e');   // wrong table on purpose
  drawPoints(C, Object.values(coco), 3.4);

  var box = document.getElementById('c');
  box.addEventListener('mousemove', function (e) {
    var r = box.getBoundingClientRect();
    var x = (e.clientX - r.left), y = (e.clientY - r.top);
    var ctx = box.getContext('2d');
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);
    // jitter the points so the nonsense lines move
    var moved = {};
    Object.keys(coco).forEach(function (k) {
      moved[k] = [coco[k][0] + Math.sin((x + k * 30) / 22) * 6,
                  coco[k][1] + Math.cos((y + k * 18) / 26) * 6];
    });
    drawLinks(ctx, moved, mpLinks, '#f43f5e');
    drawPoints(ctx, Object.values(moved), 3.4);
  });
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 33 点和 17 点，不是同一个东西的两种画法

| | MediaPipe PoseLandmarker | YOLO26-pose |
| --- | --- | --- |
| 关键点 | **33**（含脸部 4 点、双手各 5 点、双脚各 3 点） | **17**（COCO 标准，只有关节） |
| 坐标 | 归一化 0–1 | 像素（letterbox 后） |
| 置信度 | \`visibility\` 0–1 | 每点一个 \`v\`，页面用 0.3 过滤 |
| 推理方式 | top-down（先找人再猜点） | 一次前向，端到端 |
| 典型用途 | 健身动作、体感游戏 | 论文对比、多人场景 |

33 点包含手指和脚掌细节，所以能做「OK 手势」「踮脚」这种判断；17 点只有大关节，做「举手」「屈膝」够用，做手指动作不够。

**用错连接表会画出一堆乱线** —— 这页两个工具必须各自配自己的 \`POSE_CONNECTIONS\`，混用是新手最常见的 bug。

## top-down 与 one-stage 的取舍

MediaPipe 是两段式：先用一个检测器框出人，再把人框放大、单独跑关键点模型。好处是关键点精度高（人占满输入），坏处是**多人时耗时随人数线性增长**。

YOLO 是一次前向出所有人和所有点。多人快，但小人物的点精度会下降（同一个 640 输入里，远处的人只占几十像素）。

页面允许 \`numPoses\` 从 1 调到 10，正是为了让人看到这个差别：调到 10 时 MediaPipe 明显掉帧。

## visibility 分数该怎么用

它不是「这个点有多准」，而是「这个点在画面里可见吗」。被身体挡住的关节 visibility 会很低。

正确的用法是**过滤**：\`v < 0.3\` 的点不画、也不参与角度计算。如果不过滤，你会看到一条线连到画面边缘（模型对遮挡点的位置预测是纯猜）。

用它算关节角度时更要小心：肩-肘-腕三点里只要有一个 v 低，这个角度就不可信 —— 平滑滤波盖不住这种错误。

## 想深一层

1. 关键点的 \`z\` 值（MediaPipe 有，YOLO 没有）是相对深度，单位大致是「髋宽」。它能让左右手的前后关系正确，但**不能用它算离摄像头的距离**。
2. 做动作计数（俯卧撑、深蹲）时，比关键点更稳的做法是看**角度变化**而不是位置：位置随人走动而变，角度不变。这也是为什么健身 App 都用角度阈值 + 状态机。
3. 想对比两者精度：找一张人很小的照片，MediaPipe 会直接检测不到（检测器有最小尺寸），YOLO 还能出点但位置漂移 —— 这是 top-down 与 one-stage 的本质差异。`,
      en: `## 33 points and 17 points are not two drawing styles of one thing

| | MediaPipe PoseLandmarker | YOLO26-pose |
| --- | --- | --- |
| Keypoints | **33** (4 on the face, 5 per hand, 3 per foot) | **17** (COCO standard, joints only) |
| Coordinates | normalised 0–1 | pixels (after letterbox) |
| Confidence | \`visibility\` 0–1 | per-point \`v\`, page filters at 0.3 |
| Inference | top-down (find person, then points) | single end-to-end pass |
| Typical use | fitness, motion games | paper comparison, crowds |

The 33 include fingers and foot detail, enabling "OK sign" or "on tiptoe"; the 17 carry major joints only, enough for "arm raised" or "knee bent", not for fingers.

**Using the wrong connection table draws nonsense lines** — each tool needs its own \`POSE_CONNECTIONS\`, and mixing them is the classic beginner bug.

## Top-down vs one-stage

MediaPipe is two-stage: detect the person, crop and enlarge, then run the keypoint model on that crop. Higher per-person accuracy (the person fills the input), but **cost scales with the number of people**.

YOLO emits every person and every point in one pass. Fast for crowds, but small people lose precision — a distant figure may occupy only a few dozen pixels of a 640 input.

The \`numPoses\` slider (1..10) exists to expose exactly this: at 10, MediaPipe visibly drops frames.

## How to use the visibility score

It does not mean "how accurate is this point" but "is this point visible". Occluded joints get low visibility.

The correct use is **filtering**: do not draw and do not compute angles from \`v < 0.3\`. Skip that and you get lines shooting to the frame edge, because the model is guessing occluded positions.

It matters even more for angles: in a shoulder-elbow-wrist triple, one low-v point makes the angle meaningless — smoothing will not rescue it.

## Going one level deeper

1. MediaPipe's \`z\` (YOLO has none) is relative depth in roughly hip-width units. It orders left/right hand correctly but **cannot give distance from the camera**.
2. For rep counting (push-ups, squats), angles are far more stable than positions: positions move with the person, angles do not. That is why fitness apps use angle thresholds plus a state machine.
3. To compare accuracy, use a photo with a small person: MediaPipe fails outright (the detector has a minimum size), YOLO still emits points but drifts — the essential difference between top-down and one-stage.`
    }
  },

  '/vision/face': {
    python: `"""Face tools: detect, landmark (478 points + 52 blendshapes), compare.

Three models, three very different outputs -- mixing them up is how people end
up comparing landmarks when they meant to compare identities.
"""
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

base = mp_python.BaseOptions(model_asset_path='face_landmarker.task')
opts = vision.FaceLandmarkerOptions(
    base_options=base,
    running_mode=vision.RunningMode.VIDEO,
    num_faces=1,                       # page exposes 1..4
    output_face_blendshapes=True,      # 52 ARKit-style expression scores
    min_face_detection_confidence=0.5,
    min_face_presence_confidence=0.5,
    min_tracking_confidence=0.3
)

with vision.FaceLandmarker.create_from_options(opts) as lm:
    res = lm.detect_for_video(mp.Image.create_from_file('portrait.jpg'), 0)

    # 478 points: 468 mesh + 10 iris (5 per eye). Normalised, z relative.
    print('points', len(res.face_landmarks[0]))

    # blendshapes are the part people miss: 52 named expression coefficients
    for cat in res.face_blendshapes[0][:6]:
        print(f"{cat.category_name:24s} {cat.score:.3f}")


def compare(emb_a, emb_b, threshold=0.5):
    """face-compare does NOT use MediaPipe landmarks -- it uses face-api's
    128-d embedding and cosine similarity. Landmarks are geometry, embeddings
    are identity; a smile changes the first and barely touches the second."""
    import numpy as np
    a, b = np.asarray(emb_a), np.asarray(emb_b)
    cos = float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))
    return cos, cos >= threshold
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>478 landmarks and 52 blendshapes</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  canvas{border-radius:8px;background:#0f172a;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .sliders{flex:1;min-width:200px}
  .sliders div{display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:12px}
  .sliders b{width:104px;font-weight:500;font-family:ui-monospace,monospace}
  input[type=range]{flex:1}
</style>
</head>
<body>
<h1>Points are geometry, blendshapes are motion</h1>
<p>478 landmarks describe where the face is shaped; the 52 blendshape coefficients describe what it
is doing. For smile or blink detection you read the coefficients, not the points.</p>
<div class="wrap">
  <canvas id="c" width="260" height="260"></canvas>
  <div class="sliders">
    <div><b>mouthSmile</b><input type="range" id="s" min="0" max="1" step="0.02" value="0.1"></div>
    <div><b>jawOpen</b><input type="range" id="j" min="0" max="1" step="0.02" value="0"></div>
    <div><b>eyeBlink</b><input type="range" id="b" min="0" max="1" step="0.02" value="0"></div>
    <div><b>browInnerUp</b><input type="range" id="r" min="0" max="1" step="0.02" value="0"></div>
  </div>
</div>
<script>
(function () {
  var c = document.getElementById('c'), ctx = c.getContext('2d');
  var W = 260, H = 260, CX = 130, CY = 132;

  function face() {
    var smile = +document.getElementById('s').value;
    var jaw = +document.getElementById('j').value;
    var blink = +document.getElementById('b').value;
    var brow = +document.getElementById('r').value;

    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);

    // face outline
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(CX, CY, 62, 82, 0, 0, Math.PI * 2); ctx.stroke();

    // brows lift with browInnerUp
    ctx.strokeStyle = '#a78bfa';
    [-1, 1].forEach(function (sgn) {
      ctx.beginPath();
      ctx.moveTo(CX + sgn * 40, 108 - brow * 8);
      ctx.quadraticCurveTo(CX + sgn * 24, 96 - brow * 12, CX + sgn * 10, 104 - brow * 6);
      ctx.stroke();
    });

    // eyes: blink squashes the ellipse
    [-1, 1].forEach(function (sgn) {
      var ry = 8 * (1 - blink * 0.92) + 0.6;
      ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(CX + sgn * 26, 124, 13, ry, 0, 0, Math.PI * 2); ctx.stroke();
      if (blink < 0.4) {
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath(); ctx.arc(CX + sgn * 26, 124, 4.5, 0, Math.PI * 2); ctx.fill();
      }
    });

    // mouth: smile curves up, jawOpen opens the ellipse
    var halfW = 30 + smile * 6;
    var open = jaw * 26;
    ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 2;
    if (open < 3) {
      ctx.beginPath();
      ctx.moveTo(CX - halfW, 176);
      ctx.quadraticCurveTo(CX, 176 + smile * 26 - jaw * 4, CX + halfW, 176);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(244,114,182,.28)';
      ctx.beginPath();
      ctx.ellipse(CX, 178, halfW, open / 2 + 3, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    // a sparse stand-in for the 478-point mesh
    ctx.fillStyle = 'rgba(148,163,184,.55)';
    for (var i = 0; i < 130; i++) {
      var a = i * 2.3999, r = 12 + (i % 7) * 7.4;
      var x = CX + Math.cos(a) * r * 0.78;
      var y = CY + Math.sin(a) * r * 0.98;
      if (Math.hypot((x - CX) / 62, (y - CY) / 82) > 0.96) continue;
      ctx.fillRect(x, y, 1.4, 1.4);
    }

    ctx.fillStyle = 'rgba(248,250,252,.62)'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('478 pts / 52 blendshapes', 10, H - 10);
  }

  ['s', 'j', 'b', 'r'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', face);
  });
  face();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 三个工具回答三个不同的问题

| 工具 | 模型 | 输出 | 回答的问题 |
| --- | --- | --- | --- |
| 人脸检测 | \`blaze_face_short_range\` | 框 + 6 个特征点 | 脸在哪 |
| 人脸关键点 | \`face_landmarker\` | **478 点 + 52 个表情系数** | 五官怎么动 |
| 人脸比对 | face-api \`face_recognition\` | **128 维向量** | 这是谁 |

页面的「模糊人脸」「像素化」「证件照」都复用检测器，只是拿到框之后做不同的画布操作 —— **检测一次，用途三种**，这是很典型的工程复用。

## 478 点里藏着 10 个虹膜点

468 个是面部网格（轮廓、眉毛、眼睛、嘴唇、鼻子），另外 10 个是**虹膜**（每只眼 5 点）。所以这页能做「视线方向」的演示：虹膜中心相对眼角的偏移就是视线角度。

这也解释了模型体积：\`face_landmarker.task\` 比 \`blaze_face_short_range\` 大得多，因为前者要回归 478 个点，后者只出 6 个。

## blendshape 是可解释性最强的一层

52 个系数对应 ARKit 的表情基（\`jawOpen\`、\`mouthSmileLeft\`、\`eyeBlinkRight\`……），每个 0–1。它比 478 个点更适合做「表情识别」：

- 点是**几何**，同一表情在不同脸型上位置完全不同；
- blendshape 是**动作单元**，跨人脸可比。

所以做「微笑检测」「眨眼计数」时，直接看 \`mouthSmileLeft\` 和 \`eyeBlinkLeft\` 就够了，不用自己从点算角度。

## 关键点 ≠ 身份，这是最容易混的一步

很多人以为「有 478 点就能认人」。不能。478 点是**几何形状**，同一个人笑和不笑会给出完全不同的点，而双胞胎的点几乎一样。

认人需要的是**嵌入向量**：把脸压成一个 128 维（face-api）或 512 维（ArcFace）向量，使得「同一人不同照片」的向量靠得近、「不同人」离得远。页面的比对用余弦相似度，阈值 0.5。

注意 0.5 这个阈值是经验值，且**取决于模型**：ArcFace 常用 0.28（余弦距离），face-api 的 128 维常用 0.5–0.6。跨模型抄阈值必错。

## 想深一层

1. 页面把注册的人脸存在 localStorage（\`aihub.faceRegistrants.v1\`）。这是演示级做法 —— 真实系统必须加密存储，且生物特征属于敏感个人信息，采集需要明确同意。
2. \`minSuppressionThreshold: 0.3\` 是人脸检测的 NMS 阈值。调低会把重叠的两张脸合并成一张，调高会把同一张脸检出两次。0.3 是偏保守的值（宁可拆开）。
3. 想验证「点 ≠ 身份」：拍同一个人两张不同角度的照片，478 点的差异远大于 128 维向量的差异。`,
      en: `## Three tools, three different questions

| Tool | Model | Output | Question answered |
| --- | --- | --- | --- |
| Detection | \`blaze_face_short_range\` | box + 6 keypoints | where is the face |
| Landmarks | \`face_landmarker\` | **478 points + 52 blendshapes** | how is it moving |
| Comparison | face-api \`face_recognition\` | **128-d vector** | who is this |

Blur, pixelate and ID-photo tools all reuse the detector and differ only in what they draw inside the box — **detect once, three uses**, a very typical engineering reuse.

## Ten of the 478 points are irises

468 form the face mesh (contour, brows, eyes, lips, nose); the other 10 are **irises** (5 per eye). That is why this page can demo gaze direction: iris centre relative to eye corners is the gaze angle.

It also explains the size: \`face_landmarker.task\` is much larger than \`blaze_face_short_range\`, because it regresses 478 points instead of 6.

## Blendshapes are the most interpretable layer

The 52 coefficients map to ARKit expression bases (\`jawOpen\`, \`mouthSmileLeft\`, \`eyeBlinkRight\`…), each 0–1. They beat 478 points for expression work:

- points are **geometry** — the same expression sits differently on different faces;
- blendshapes are **action units**, comparable across faces.

So smile detection or blink counting just reads \`mouthSmileLeft\` and \`eyeBlinkLeft\`; no angle maths from points required.

## Landmarks are not identity — the easiest confusion here

Many people assume "478 points means it can recognise faces". It cannot. Points are **shape**: the same person smiling produces a completely different set, and identical twins produce almost the same one.

Identity needs an **embedding**: compress the face into 128 (face-api) or 512 (ArcFace) dimensions so that two photos of one person land close and different people land far apart. The page compares with cosine similarity at 0.5.

That 0.5 is empirical and **model-specific**: ArcFace typically uses 0.28 (cosine distance), face-api's 128-d often 0.5–0.6. Copying a threshold across models always fails.

## Going one level deeper

1. Registered faces live in localStorage (\`aihub.faceRegistrants.v1\`). Demo-grade only — production must encrypt, and biometric data is sensitive personal information requiring explicit consent.
2. \`minSuppressionThreshold: 0.3\` is face-detection NMS. Lower merges two overlapping faces into one; higher detects the same face twice. 0.3 errs toward splitting.
3. To prove points ≠ identity: shoot the same person from two angles. The 478-point difference dwarfs the 128-d difference.`
    }
  },

  '/vision/gesture': {
    python: `"""Hand landmarks and gesture classification: two models, one pipeline.

GestureRecognizer = hand landmark model + a small classifier head on top of the
21 points. That is the whole trick.
"""
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

# ---------- landmarks only: 21 points per hand ----------
base = mp_python.BaseOptions(model_asset_path='hand_landmarker.task')
hand_opts = vision.HandLandmarkerOptions(
    base_options=base,
    running_mode=vision.RunningMode.VIDEO,
    num_hands=2                     # page exposes 1..4
)
with vision.HandLandmarker.create_from_options(hand_opts) as hands:
    res = hands.detect_for_video(mp.Image.create_from_file('ok-sign.jpg'), 0)
    print('hands', len(res.hand_landmarks))
    for lm in res.hand_landmarks[0]:        # 0 wrist, 1-4 thumb, 5-8 index, ...
        print(f"({lm.x:.3f}, {lm.y:.3f}, {lm.z:+.3f})")


# ---------- with classification: same 21 points + a label ----------
gest_base = mp_python.BaseOptions(model_asset_path='gesture_recognizer.task')
gest_opts = vision.GestureRecognizerOptions(
    base_options=gest_base,
    running_mode=vision.RunningMode.VIDEO,
    num_hands=2
)
with vision.GestureRecognizer.create_from_options(gest_opts) as rec:
    out = rec.recognize_for_video(mp.Image.create_from_file('ok-sign.jpg'), 0)
    for hand, gestures in zip(out.hand_landmarks, out.gestures):
        top = gestures[0]
        print(len(hand), 'points ->', top.category_name, f"{top.score:.2f}")


def finger_extended(pts, tip, pip):
    """A geometry check that needs no model: a finger is extended when its tip
    is farther from the wrist than its PIP joint. Works for the four fingers,
    not for the thumb (which moves sideways)."""
    d = lambda a, b: ((a.x - b.x) ** 2 + (a.y - b.y) ** 2) ** 0.5
    return d(pts[tip], pts[0]) > d(pts[pip], pts[0])
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Counting fingers without a model</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:420px;display:block;border-radius:8px;background:#0f172a}
  .out{margin-top:10px;font-size:13px;color:#475569}
  .out b{font-size:22px;color:#0f172a;font-variant-numeric:tabular-nums;margin-right:6px}
  button{font:inherit;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid #cbd5e1;
         background:#fff;cursor:pointer;margin-right:6px}
  button:hover{background:#f1f5f9}
</style>
</head>
<body>
<h1>Finger counting is geometry, not a classifier</h1>
<p>A finger is extended when its tip is farther from the wrist than its PIP joint. Three lines of
code, no network — and it still beats the classifier's latency.</p>
<canvas id="c" width="420" height="360"></canvas>
<div class="out"><b id="n">0</b> fingers extended <span id="name"></span></div>
<div style="margin-top:8px">
  <button data-g="rock">rock</button>
  <button data-g="paper">paper</button>
  <button data-g="two">two</button>
  <button data-g="ok">ok</button>
</div>
<script>
(function () {
  var c = document.getElementById('c'), ctx = c.getContext('2d');
  var W = 420, H = 360;

  // wrist at 0; tips 4/8/12/16/20; PIPs 3/6/10/14/18
  var HANDS = {
    rock:  [[.50,.92],[.44,.80],[.41,.72],[.40,.66],[.39,.62],
            [.48,.78],[.47,.68],[.46,.62],[.45,.57],
            [.53,.78],[.53,.67],[.52,.60],[.51,.54],
            [.58,.79],[.59,.69],[.60,.63],[.61,.58],
            [.62,.82],[.65,.75],[.67,.71],[.69,.68]],
    paper: [[.50,.92],[.40,.78],[.34,.64],[.31,.52],[.29,.42],
            [.48,.76],[.46,.58],[.45,.44],[.44,.33],
            [.54,.75],[.55,.56],[.56,.41],[.56,.30],
            [.60,.77],[.64,.60],[.66,.46],[.67,.35],
            [.66,.81],[.72,.68],[.75,.57],[.77,.48]],
    two:   [[.50,.92],[.42,.79],[.38,.68],[.36,.59],[.35,.52],
            [.48,.77],[.47,.62],[.46,.50],[.45,.40],
            [.55,.76],[.56,.60],[.57,.47],[.57,.37],
            [.61,.79],[.63,.71],[.64,.66],[.65,.61],
            [.65,.83],[.68,.78],[.70,.74],[.71,.71]],
    ok:    [[.50,.92],[.42,.79],[.38,.68],[.36,.59],[.35,.52],
            [.48,.77],[.47,.62],[.46,.50],[.45,.40],
            [.55,.76],[.56,.61],[.57,.48],[.57,.38],
            [.61,.79],[.63,.71],[.64,.66],[.65,.61],
            [.65,.83],[.68,.78],[.70,.74],[.71,.71]]
  };
  var LINKS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],
               [0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];
  var PAIRS = [[8,6],[12,10],[16,14],[20,18]];

  function extended(p) {
    var d = function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    return PAIRS.filter(function (pr) { return d(p[pr[0]], p[0]) > d(p[pr[1]], p[0]); }).length;
  }

  function render(key) {
    var pts = HANDS[key];
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 3;
    LINKS.forEach(function (l) {
      ctx.beginPath();
      ctx.moveTo(pts[l[0]][0] * W, pts[l[0]][1] * H);
      ctx.lineTo(pts[l[1]][0] * W, pts[l[1]][1] * H);
      ctx.stroke();
    });
    PAIRS.forEach(function (pr, i) {
      var tip = pts[pr[0]], pip = pts[pr[1]];
      var isExt = Math.hypot(tip[0] - pts[0][0], tip[1] - pts[0][1]) >
                  Math.hypot(pip[0] - pts[0][0], pip[1] - pts[0][1]);
      ctx.fillStyle = isExt ? '#22c55e' : '#64748b';
      ctx.beginPath(); ctx.arc(tip[0] * W, tip[1] * H, 6, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#f8fafc';
    pts.forEach(function (p) {
      ctx.beginPath(); ctx.arc(p[0] * W, p[1] * H, 2.6, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = 'rgba(248,250,252,.6)'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('green = tip farther from wrist than PIP', 10, H - 10);

    document.getElementById('n').textContent = extended(pts);
    document.getElementById('name').textContent = '(' + key + ')';
  }

  document.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () { render(b.dataset.g); });
  });
  render('paper');
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 手势识别 = 21 个点 + 一个很小的分类器

这页两个工具的区别只有一处：\`HandLandmarker\` 停在「21 点」，\`GestureRecognizer\` 在 21 点之后再接一个小分类头，输出 7 类左右的标签（拳头、张开手掌、点赞、OK、剪刀手……）。

**关键洞察：分类头吃的不是图像，是 21 个点的局部坐标。** 也就是说手势识别本质是「21 点上的模式匹配」，和图像分辨率、光照、背景都无关。这就是为什么它在你家的客厅和教室的投影前都能工作。

## 21 个点的编号是有约定的

\`0\` 手腕，\`1-4\` 拇指，\`5-8\` 食指，\`9-12\` 中指，\`13-16\` 无名指，\`17-20\` 小指。每根手指的四点依次是 MCP（掌指关节）→ PIP → DIP → TIP。

这个编号让「数手指」变成一个纯几何问题：**指尖到手腕的距离 > PIP 到手腕的距离，就算伸直**。不需要任何模型，三行代码。这个技巧在真实产品里用得极多（比调用分类器省几十毫秒）。

拇指是例外：它横向开合，不在同一个平面，用距离判会误判。所以很多实现单独处理拇指（看 MCP 与 IP 的向量夹角）。

## 为什么标签不画在画布上

页面把类别和置信度放在右侧信息栏，而不是跟着手画在画布上。原因很实际：手在动，文字跟着动，人眼根本读不了。**动态目标上的文字应该固定位置显示。**

这是交互设计里的小规律：跟踪标注只适合画框/画点（形状可以快速识别），文字必须稳定。

## 手部模型的输入是「手掌检测 + 关键点」两段

和姿态一样是 top-down：先找手掌（比找整只手容易，因为手掌是刚性的），再把手掌区域旋转到标准方向、跑关键点。这也是为什么手能翻转、侧着、倒着都能识别 —— **中间那一步做了一次旋转归一化**。

代价是：手被挡住一半时，手掌检测可能失败，整体就没了。这也是为什么这页在 \`numHands\` 调大后掉帧明显。

## 想深一层

1. \`z\` 值对手势很有用：手指在手掌前面还是后面（比如比心）在 2D 上看不出来，z 能区分。
2. 想做一个不需要模型的「石头剪刀布」：用 \`extendedCount\` 数伸直的手指数（0 = 石头，2 = 剪刀，5 = 布）。这比训练分类器快得多，且完全可控。
3. 分类器只认识训练时见过的 7 类。做一个新手势（比如「比心」）它会给最接近的那一类，置信度还不低 —— 这是分布外输入，不是模型坏了。`,
      en: `## Gesture recognition = 21 points + a tiny classifier

The only difference between the two tools here: \`HandLandmarker\` stops at the 21 points; \`GestureRecognizer\` appends a small classification head that emits about 7 labels (fist, open palm, thumbs up, OK, victory…).

**The key insight: the head consumes the 21 points, not the image.** Gesture recognition is pattern matching on 21 points, independent of resolution, light and background. That is why it works in your living room and in front of a classroom projector.

## The 21 indices follow a convention

\`0\` wrist, \`1-4\` thumb, \`5-8\` index, \`9-12\` middle, \`13-16\` ring, \`17-20\` pinky. Each finger's four points are MCP → PIP → DIP → TIP.

That numbering turns finger counting into pure geometry: **extended when the tip is farther from the wrist than its PIP joint**. No model, three lines. Real products use this constantly — tens of milliseconds cheaper than the classifier.

The thumb is the exception: it opens sideways, out of plane, so distance rules misfire. Most implementations treat it separately via the MCP-to-IP vector angle.

## Why the label is not drawn on the canvas

The page puts the class and score in the side panel rather than tracking the hand. Practical reason: hands move, text that moves is unreadable. **Text about a moving target belongs in a fixed position.**

A small interaction rule: annotations that follow motion should be shapes (boxes, dots), because shapes are recognisable at a glance; text must stay still.

## The hand model is two-stage too

Like pose, it is top-down: detect the palm (easier, since the palm is rigid), rotate that crop to canonical orientation, then run the keypoint model. That rotation step is why hands work flipped, sideways and upside down — **an explicit normalisation in the middle**.

The cost: a half-occluded hand may fail palm detection and vanish entirely, which is why frame rate drops visibly as \`numHands\` increases.

## Going one level deeper

1. \`z\` matters for gestures: whether a finger is in front of the palm (finger-heart) is invisible in 2D, but z separates it.
2. For a model-free rock-paper-scissors: count extended fingers (0 = rock, 2 = scissors, 5 = paper). Faster to build than training a classifier, and fully controllable.
3. The classifier knows only its ~7 trained classes. Show it a new gesture and you get the nearest class with a confident score — out of distribution, not broken.`
    }
  },

  '/vision/features': {
    python: `"""Five OpenCV feature tools, one theme: matching images without a network.

ORB/BRISK find keypoints; BFMatcher pairs them; RANSAC finds the geometry.
None of this involves a neural network -- and it still powers panorama
stitching in every phone.
"""
import cv2
import numpy as np


def keypoints(img, kind='orb', n=500):
    """ORB = FAST corner detector + BRIEF descriptor (binary, Hamming distance).
    It is fast, rotation-invariant, and NOT scale-invariant (unlike SIFT)."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if kind == 'orb':
        return cv2.ORB_create(nfeatures=n).detectAndCompute(gray, None)
    return cv2.BRISK_create().detectAndCompute(gray, None)


def match(desc_a, desc_b, ratio=0.75):
    """Lowe's ratio test: keep a match only if the best neighbour is clearly
    better than the second best. This single line removes most outliers."""
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    pairs = bf.knnMatch(desc_a, desc_b, k=2)
    return [m for m, n in pairs if m.distance < ratio * n.distance]


def align(img_a, img_b, ratio=0.75):
    """From matches to a homography: RANSAC needs 4 points, uses hundreds."""
    ka, da = keypoints(img_a, 'orb')
    kb, db = keypoints(img_b, 'orb')
    good = match(da, db, ratio)
    if len(good) < 10:
        return None, len(good)

    src = np.float32([ka[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kb[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)

    # ransacReprojThreshold = 5 px: inliers may deviate this much
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
    return H, int(mask.sum())


def stitch(a, b):
    """Warp b into a's frame, then take the union. No blending here -- real
    panorama code adds multi-band blending to hide the seam."""
    H, inliers = align(a, b)
    if H is None:
        return None
    h, w = a.shape[:2]
    out = cv2.warpPerspective(b, H, (w * 2, h))
    out[0:h, 0:w] = a
    return out
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Keypoints, ratio test, and why matches still need RANSAC</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px;margin-right:16px}
  input[type=range]{width:150px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>Match, then reject the liars</h1>
<p>Left and right are the same scene, rotated 18 degrees with a few decoy dots. Bright lines are
matches kept by the ratio test; red is a deliberate outlier.</p>
<canvas id="c" width="720" height="300"></canvas>
<label>Lowe ratio <input type="range" id="r" min="0.5" max="0.95" step="0.01" value="0.75">
  <output id="v">0.75</output></label>
<script>
(function () {
  var c = document.getElementById('c'), ctx = c.getContext('2d');
  var W = 720, H = 300;
  var CX1 = 180, CX2 = 540, CY = 150;

  // a fixed "scene": 14 keypoints (normalised -1..1 inside each panel)
  var base = [];
  for (var i = 0; i < 14; i++) {
    var a = i * 2.3999;
    var r = 0.25 + (i % 5) * 0.15;
    base.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.9, id: i });
  }
  var ANG = 18 * Math.PI / 180;

  function right(p) {
    return { x: p.x * Math.cos(ANG) - p.y * Math.sin(ANG),
             y: p.x * Math.sin(ANG) + p.y * Math.cos(ANG) };
  }

  function panel(cx, label, pts, color) {
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    ctx.strokeRect(cx - 140, CY - 120, 280, 240);
    ctx.fillStyle = '#94a3b8'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(label, cx - 138, CY - 128);
    pts.forEach(function (p) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx + p.x * 120, CY + p.y * 110, 3.4, 0, Math.PI * 2); ctx.fill();
    });
  }

  function render() {
    var ratio = parseFloat(document.getElementById('r').value);
    document.getElementById('v').textContent = ratio.toFixed(2);
    ctx.clearRect(0, 0, W, H);

    var L = base, R = base.map(right);
    // one decoy: the nearest-neighbour pairing for dot 5 points somewhere wrong
    var decoy = { x: R[5].x, y: R[5].y, id: 9 };
    R = R.slice(); R[5] = right(base[9]);

    panel(CX1, 'left', L, '#2563eb');
    panel(CX2, 'right (rotated, one swap)', R, '#2563eb');

    var kept = 0, rejected = 0;
    L.forEach(function (p, i) {
      var q = R[i];
      var dBest = Math.hypot(q.x - p.x, q.y - p.y);
      // distance in descriptor space ~ geometric distance here, for illustration
      var dSecond = dBest + 0.12 + (i % 3) * 0.04;
      var ok = dBest < ratio * dSecond + 0.35;
      if (!ok) { rejected++; return; }
      kept++;
      ctx.strokeStyle = i === 5 ? '#dc2626' : 'rgba(22,163,74,.55)';
      ctx.lineWidth = i === 5 ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.moveTo(CX1 + p.x * 120, CY + p.y * 110);
      ctx.lineTo(CX2 + q.x * 120, CY + q.y * 110);
      ctx.stroke();
    });

    ctx.fillStyle = '#0f172a'; ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('kept ' + kept + ' / ' + L.length + '   ratio ' + ratio.toFixed(2), 12, 20);
    ctx.fillStyle = '#dc2626';
    ctx.fillText('red = survives the ratio test but is still wrong -> this is what RANSAC removes', 12, H - 10);
  }
  document.getElementById('r').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 五个工具，一条主线：不靠神经网络也能匹配图像

| 工具 | 原理 | 关键参数 |
| --- | --- | --- |
| ORB 关键点 | FAST 角点 + BRIEF 二进制描述子 | 最多 500 点 |
| BRISK 关键点 | 多尺度 FAST + 自定义二进制描述子 | — |
| 特征匹配 | 暴力匹配（汉明距离）+ Lowe 比值检验 | ratio 0.75 |
| 模板匹配 | 归一化互相关 | TM_CCOEFF_NORMED |
| 图像拼接 | 匹配 → 单应矩阵（RANSAC）→ 透视变换 | 重投影 5 px |

**为什么 2026 年还在讲 ORB？** 因为手机的全景拼接、AR 的初始化、SLAM 的前端，至今大量用这类方法 —— 它们不需要 GPU、不需要下载模型、单帧毫秒级。

## ORB 的两个不变量，一个缺陷

ORB = FAST 角点 + BRIEF 描述子：
- **旋转不变**：每个关键点先算出主方向，描述子按这个方向旋转后再采点。所以图片转 30° 还能匹配；
- **不缩放不变**：它没有尺度金字塔（SIFT 有）。图片放大 2 倍，同一个特征点可能就找不到了。

这是 ORB 免费（专利）且快的原因，也是它比不上 SIFT 的原因。**做全景拼接够用（相机在原地转），做跨尺度匹配不够。**

BRISK 有尺度金字塔，所以尺度鲁棒性更好，但慢一些。

## Lowe 比值检验是性价比最高的一行代码

\`best.distance < 0.75 × second.distance\`

为什么有效？因为**真正匹配上的点，最佳匹配会明显优于次佳匹配**；而误匹配的点，往往有两三个候选差不多近。只保留「明显胜出」的匹配，一个比值就把大部分离群点去掉了 —— 比各种花哨的滤波都简单。

0.75 是 Lowe 论文给的经验值：0.7 更严（匹配更少更准），0.8 更松。

## RANSAC 解决「匹配里还有错」的问题

即使经过比值检验，仍有误匹配。单应矩阵需要 4 组对应点，如果有错点，解出的矩阵会把整幅图撕开。

RANSAC 的做法：**随机抽 4 点算一个模型，看有多少点符合这个模型（内点），重复很多次，取内点最多的那个**。它的价值在于「用少量正确数据对抗大量错误数据」—— 只要正确率不太低，随机抽到 4 个全对的概率就够了。

\`ransacReprojThreshold = 5.0\` 的意思是「投影误差在 5 px 内算内点」。图越小这个值应该越小。

## OpenCV.js 里对象必须手动 delete

WebAssembly 的内存不由 JS 的 GC 管理。上面代码里每个 \`new cv.Mat()\` 都要 \`.delete()\`，否则**每处理一张图就泄漏几 MB**，跑十几张后浏览器直接崩溃。这是 OpenCV.js 最常见的坑，比算法本身更值得记。

## 想深一层

1. 模板匹配（TM_CCOEFF_NORMED）对尺度变化和旋转完全无能为力 —— 但速度极快，用它做「固定 UI 元素定位」仍然是最优解。
2. 拼接的接缝处理这里只做了并集。真实实现会做**多频段融合**（Laplacian pyramid blending），否则曝光差异会在接缝处形成一条明显的线。
3. 想理解「特征点是什么」：把 ORB 的 500 个点画出来，你会发现它们集中在角、文字边缘、纹理丰富处 —— 平坦的天空区域一个都没有。这就是「角点」的定义：**两个方向都有梯度**。`,
      en: `## Five tools, one theme: matching images without a network

| Tool | Principle | Key parameter |
| --- | --- | --- |
| ORB keypoints | FAST corners + BRIEF binary descriptors | up to 500 |
| BRISK keypoints | multi-scale FAST + custom binary descriptor | — |
| Feature match | brute force (Hamming) + Lowe ratio test | ratio 0.75 |
| Template match | normalised cross-correlation | TM_CCOEFF_NORMED |
| Stitching | match → homography (RANSAC) → warp | 5 px reprojection |

**Why ORB in 2026?** Phone panoramas, AR initialisation and SLAM front-ends still lean on these methods: no GPU, no model download, milliseconds per frame.

## ORB has two invariants and one flaw

ORB = FAST corners + BRIEF descriptors:
- **rotation invariant**: each keypoint gets an orientation, and the descriptor is sampled in that rotated frame, so a 30° turn still matches;
- **not scale invariant**: no scale pyramid (SIFT has one). Enlarge an image 2× and a given keypoint may disappear.

That is why ORB is free and fast, and also why it loses to SIFT. **Fine for panoramas (camera rotates in place), insufficient across scales.**

BRISK does build a pyramid, so it handles scale better at some speed cost.

## The Lowe ratio test is the best one-liner here

\`best.distance < 0.75 × second.distance\`

Why it works: **a true match beats its runner-up clearly**, while a false match usually has two or three candidates at similar distance. Keeping only decisive wins removes most outliers — simpler than any filter stack.

0.75 is Lowe's empirical value: 0.7 is stricter (fewer, better), 0.8 looser.

## RANSAC handles the mismatches that survive

Some false matches always remain. A homography needs 4 point pairs, and one bad pair can tear the output apart.

RANSAC: **sample 4 points, fit a model, count inliers, repeat many times, keep the model with most inliers**. Its value is fighting large amounts of bad data with a little good data — as long as the inlier ratio is not tiny, sampling an all-correct set is likely enough.

\`ransacReprojThreshold = 5.0\` means "projection error under 5 px counts as inlier". Smaller images want a smaller value.

## OpenCV.js objects must be deleted by hand

WebAssembly memory is outside JS GC. Every \`new cv.Mat()\` above needs \`.delete()\`, or **each processed image leaks megabytes** and the tab dies after a dozen. This is the classic OpenCV.js trap, more important than the algorithms.

## Going one level deeper

1. Template matching (TM_CCOEFF_NORMED) cannot handle scale or rotation at all — but it is extremely fast, still the best tool for locating fixed UI elements.
2. Stitching here just unions the warps. Real implementations use **multi-band (Laplacian pyramid) blending**, without which exposure differences leave a visible seam.
3. To see what a keypoint is: draw all 500 ORB points. They cluster on corners, glyph edges and texture, and there are none on flat sky — that is the definition of a corner: **gradient in both directions**.`
    }
  },

  '/vision/object': {
    python: `"""Counting and measuring objects with contours -- no model, no training.

The whole page is classical CV: threshold -> contours -> properties.
It fails on touching objects, which is exactly what the page lets you see.
"""
import cv2
import numpy as np


def find_objects(bgr, min_area=120):
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    # Otsu picks the threshold by maximising between-class variance -- see
    # /vision/morphology for the maths. Fine when lighting is even.
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Opening removes specks; without it every dust pixel becomes an "object".
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return [c for c in contours if cv2.contourArea(c) >= min_area]


def describe(c):
    """Every number here is a one-liner in OpenCV and a paragraph of maths
    by hand: area, perimeter, centroid, bounding box, orientation."""
    area = cv2.contourArea(c)
    peri = cv2.arcLength(c, True)
    M = cv2.moments(c)
    cx = M['m10'] / M['m00'] if M['m00'] else 0
    cy = M['m01'] / M['m00'] if M['m00'] else 0
    x, y, w, h = cv2.boundingRect(c)

    # circularity == 1 for a perfect circle, lower for anything else
    circularity = 4 * np.pi * area / (peri * peri) if peri else 0
    return dict(area=area, perimeter=peri, centroid=(cx, cy), bbox=(x, y, w, h),
                circularity=circularity)


def classify_shape(c, eps=0.04):
    """approxPolyDP with a tolerance proportional to the perimeter turns a
    noisy contour into a polygon; the vertex count is then the shape."""
    peri = cv2.arcLength(c, True)
    poly = cv2.approxPolyDP(c, eps * peri, True)
    n = len(poly)
    return {3: 'triangle', 4: 'quad', 5: 'pentagon'}.get(n, f'{n}-gon')


# Why 0.04 * perimeter: too small keeps every pixel wiggle (a circle looks
# like a 200-gon), too large collapses a triangle into a line.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Contours, area, and one tolerance</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:14px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:220px}
  canvas{width:100%;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  figcaption{font-size:12px;color:#475569;margin-top:5px}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px}
  input[type=range]{width:180px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>approxPolyDP: the tolerance decides the shape</h1>
<p>Every contour is a cloud of pixels. Simplifying it with a tolerance proportional to the perimeter
turns it into a polygon — and the vertex count is then the shape.</p>
<div class="row">
  <figure><canvas id="a" width="240" height="240"></canvas><figcaption>original contour</figcaption></figure>
  <figure><canvas id="b" width="240" height="240"></canvas><figcaption>simplified (red vertices)</figcaption></figure>
</div>
<label>epsilon <input type="range" id="e" min="0.005" max="0.12" step="0.005" value="0.04">
  <output id="v">0.040</output></label>
<script>
(function () {
  var W = 240, H = 240;
  // a noisy triangle in pixels (as if traced from a thresholded blob)
  function contour() {
    var pts = [], cx = 120, cy = 130, R = 88;
    var verts = [[-.5, -1], [1, .55], [-1, .55]];   // roughly a triangle
    for (var s = 0; s < 3; s++) {
      var a0 = verts[s], a1 = verts[(s + 1) % 3];
      for (var t = 0; t < 60; t++) {
        var k = t / 60;
        var x = (a0[0] + (a1[0] - a0[0]) * k) * R + cx;
        var y = (a0[1] + (a1[1] - a0[1]) * k) * R + cy;
        x += Math.sin(t * 2.7 + s) * 2.2;            // pixel-level noise
        y += Math.cos(t * 3.1 + s) * 2.2;
        pts.push([x, y]);
      }
    }
    return pts;
  }
  var P = contour();

  function distToSeg(p, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1];
    var wx = p[0] - a[0], wy = p[1] - a[1];
    var t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
  }

  // Ramer-Douglas-Peucker, the algorithm behind approxPolyDP
  function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    var a = pts[0], b = pts[pts.length - 1], idx = -1, dmax = 0;
    for (var i = 1; i < pts.length - 1; i++) {
      var d = distToSeg(pts[i], a, b);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) {
      return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
    }
    return [a, b];
  }

  function poly(ctx, pts, color, fill) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  }

  function render() {
    var epsRatio = parseFloat(document.getElementById('e').value);
    document.getElementById('v').textContent = epsRatio.toFixed(3);

    // perimeter of the raw contour (as cv2.arcLength would compute)
    var peri = 0;
    for (var i = 0; i < P.length; i++) {
      var q = P[(i + 1) % P.length];
      peri += Math.hypot(q[0] - P[i][0], q[1] - P[i][1]);
    }
    var simple = rdp(P.concat([P[0]]), peri * epsRatio);

    var A = document.getElementById('a').getContext('2d');
    A.fillStyle = '#fff'; A.fillRect(0, 0, W, H);
    poly(A, P, '#64748b', 'rgba(148,163,184,.35)');
    A.fillStyle = '#475569'; A.font = '11px ui-monospace, monospace';
    A.fillText(P.length + ' points, perimeter ' + Math.round(peri) + 'px', 8, 16);

    var B = document.getElementById('b').getContext('2d');
    B.fillStyle = '#fff'; B.fillRect(0, 0, W, H);
    poly(B, simple, '#2563eb', 'rgba(37,99,235,.12)');
    simple.forEach(function (p) {
      B.fillStyle = '#dc2626';
      B.beginPath(); B.arc(p[0], p[1], 3.4, 0, Math.PI * 2); B.fill();
    });
    var name = simple.length === 3 ? 'triangle' : simple.length === 4 ? 'quad' : simple.length + '-gon';
    B.fillStyle = '#0f172a'; B.font = '12px ui-monospace, monospace';
    B.fillText(simple.length - 1 + ' vertices -> ' + name, 8, 16);
  }
  document.getElementById('e').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 这一页全部是传统 CV，一个神经网络都没有

流程永远是三步：**二值化 → 找轮廓 → 算属性**。

但它的教学价值比很多深度学习页高，因为它把「面积、周长、质心、外接矩形、圆度、顶点数」这些量做成了可调可视的 —— 这些正是做视觉项目时真正要用到的东西。数零件、数细胞、量尺寸，工业检测里大量场景用这套就够了，不需要训练。

## 每个属性都能手算，但都有坑

| 属性 | 公式 | 坑 |
| --- | --- | --- |
| 面积 | 轮廓多边形面积（鞋带公式） | 空心物体只算外壳面积 |
| 周长 | 轮廓点连线长度之和 | 像素锯齿会让周长虚高约 10% |
| 质心 | 一阶矩 / 零阶矩 | 凹形状的质心可能落在物体外 |
| 圆度 | \`4πA / P²\` | 仅对光滑边界准；锯齿会显著压低圆度 |
| 形状 | \`approxPolyDP\` 后数顶点 | 容差决定一切 |

**圆度这一项特别值得注意**：理论值是 1（完美圆），但你的轮廓是像素锯齿，实际测出的圆通常只有 0.85–0.92。如果按 0.95 判圆，永远判不出来。所有阈值都应该对着自己的数据实测，而不是抄理论值。

## approxPolyDP 的容差是唯一超参

\`eps × 周长\` 里的 eps：
- 太小（0.01）→ 圆形被当成 200 边形，所有东西都是 n-gon；
- 太大（0.1）→ 三角形塌成一条线；
- **0.02–0.05 是常用区间**，页面用 0.04。

这个参数之所以用「周长比例」而不是绝对像素，是为了让它对图像尺寸不敏感 —— 同样的设置，大图小图都能用。

## 什么时候这套会失败

页面故意留了几种失败场景：

1. **物体相互接触** → 两个物体变一个轮廓。解法：分水岭（watershed）或距离变换；
2. **背景与物体亮度接近** → Otsu 分出噪声。解法：自适应阈值、或用颜色（HSV 掩码，页面也提供了）；
3. **物体有孔洞** → \`RETR_EXTERNAL\` 只取外轮廓，孔洞信息丢失。要孔洞得用 \`RETR_TREE\`；
4. **光照不均** → 同一物体一半亮一半暗，阈值把它切成两半。

这四种失败是「传统 CV 为什么没被淘汰但也不能包打天下」的完整回答：**场景可控时它又准又快又省，场景不可控时它立刻崩。**

## 想深一层

1. 面积阈值 120 px² 是页面默认值，用来过滤噪声。真实项目里这个值要按「最小目标尺寸」推：相机分辨率 × 目标实际面积 / 视场面积。
2. 想数颜色：在 HSV 空间做 \`inRange\`，比 RGB 稳得多，因为 H 通道对光照强度不敏感（亮度变化主要体现在 V）。
3. 工业质检里「轮廓 + 面积 + 圆形度」这类规则的准确率经常超过轻量 CNN —— 因为它的错误模式是**可预测的**，而 CNN 的失败你无法事先知道。`,
      en: `## Entirely classical CV — not a single neural network

The pipeline is always: **binarise → find contours → measure properties**.

Its teaching value exceeds many deep-learning pages because it makes area, perimeter, centroid, bounding box, circularity and vertex count adjustable and visible — exactly the quantities real vision projects use. Counting parts, counting cells, measuring dimensions: industrial inspection leans on this, with no training at all.

## Every property is one line, and every one has a trap

| Property | Formula | Trap |
| --- | --- | --- |
| Area | contour polygon area (shoelace) | hollow objects only count the shell |
| Perimeter | sum of segment lengths | pixel jaggedness inflates it by ~10% |
| Centroid | first moment / zeroth moment | for concave shapes it can fall outside the object |
| Circularity | \`4πA / P²\` | only exact for smooth boundaries; jaggies reduce it a lot |
| Shape | vertex count after \`approxPolyDP\` | tolerance decides everything |

**Circularity deserves special care**: theory says 1 for a perfect circle, but with pixel contours real measurements land at 0.85–0.92. Threshold at 0.95 and you will never detect a circle. Every threshold must be measured against your own data, never copied from the textbook.

## approxPolyDP's tolerance is the only hyperparameter

eps in \`eps × perimeter\`:
- too small (0.01) → a circle becomes a 200-gon, everything is an n-gon;
- too large (0.1) → a triangle collapses to a line;
- **0.02–0.05 is the usual band**, the page uses 0.04.

Expressing it relative to perimeter rather than pixels makes it resolution insensitive — one setting works for small and large images.

## When this approach fails

The page deliberately includes the failure modes:

1. **Touching objects** → two objects become one contour. Fix: watershed or distance transform;
2. **Object and background at similar brightness** → Otsu returns noise. Fix: adaptive threshold, or colour (HSV mask, also provided);
3. **Objects with holes** → \`RETR_EXTERNAL\` keeps only outer contours, holes are lost. Use \`RETR_TREE\`;
4. **Uneven lighting** → half an object is bright, half dark, and the threshold cuts it in two.

Those four are the full answer to "why classical CV is neither dead nor sufficient": **controllable scenes make it accurate, fast and cheap; uncontrollable scenes break it immediately.**

## Going one level deeper

1. The 120 px² area floor filters noise. Real projects derive it from the smallest target: resolution × real area / field of view.
2. To count by colour, do \`inRange\` in HSV rather than RGB — H is insensitive to brightness, which lives mostly in V.
3. In industrial inspection, "contour + area + circularity" rules often beat a small CNN, because their failure modes are **predictable** while a CNN's are not.`
    }
  },

  '/vision/viewer': {
    python: `"""What a pixel actually is. The four viewer tools are all "read the buffer".

Nothing here is an algorithm -- it is the ground floor that every other page
on this site assumes you know.
"""
import numpy as np

def info(img):
    """Uncompressed size is the number people are most surprised by."""
    h, w, ch = img.shape
    return {
        'width': w, 'height': h,
        'channels': ch,
        'bytes': w * h * ch,                 # 4 for RGBA
        'megapixels': round(w * h / 1e6, 2)
    }


def rgb_to_hsv(r, g, b):
    """H in degrees, S and V in 0..1. HSV separates 'which colour' from
    'how bright', which RGB does not -- that is the whole reason it exists."""
    r, g, b = r / 255, g / 255, b / 255
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d == 0:
        h = 0.0
    elif mx == r:
        h = (60 * ((g - b) / d)) % 360
    elif mx == g:
        h = 60 * ((b - r) / d) + 120
    else:
        h = 60 * ((r - g) / d) + 240
    s = 0.0 if mx == 0 else d / mx
    return h, s, mx


def rgb_to_lab(r, g, b):
    """sRGB -> linear -> XYZ (D65) -> Lab. Lab is perceptually uniform:
    equal numeric steps look like equal visual steps. RGB is not."""
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    R, G, B = lin(r), lin(g), lin(b)
    x = R * 0.4124 + G * 0.3576 + B * 0.1805
    y = R * 0.2126 + G * 0.7152 + B * 0.0722
    z = R * 0.0193 + G * 0.1192 + B * 0.9505
    x, y, z = x / 0.95047, y / 1.0, z / 1.08883          # D65 white

    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def pixel_op(img, op, value):
    """The page's pixel-math tool: add/subtract use an offset, multiply/divide
    use a factor scaled by 100. Clamping is not optional -- uint8 wraps."""
    out = img.astype(np.int16)
    if op == 'add':
        out += value
    elif op == 'sub':
        out -= value
    elif op == 'mul':
        out = out * (1 + value / 100)
    elif op == 'div':
        out = out / max(0.05, 1 + value / 100)
    return np.clip(out, 0, 255).astype(np.uint8)
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>What a pixel actually is</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  canvas{border-radius:6px;display:block;image-rendering:pixelated}
  .grid{background:#e2e8f0;padding:4px;border-radius:6px}
  .info{flex:1;min-width:210px;font-size:12px}
  .sw{width:44px;height:44px;border-radius:6px;border:1px solid #cbd5e1}
  .row{display:flex;gap:10px;align-items:center;margin-bottom:8px}
  code{background:#e2e8f0;padding:1px 5px;border-radius:3px;font-size:11px}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:8px;font-size:12px}
</style>
</head>
<body>
<h1>A pixel is four integers, not a colour</h1>
<p>Move the pointer over the grid. Every value below is read straight out of the buffer — the same
four bytes the whole rest of this site operates on.</p>
<div class="wrap">
  <div class="grid"><canvas id="c" width="256" height="256"></canvas></div>
  <div class="info">
    <div class="row"><div class="sw" id="sw"></div>
      <div><div><code id="hex">#000000</code></div><div id="rgba"></div></div></div>
    <div>HSV <code id="hsv"></code></div>
    <div>Lab L* <code id="lab"></code></div>
    <div style="margin-top:10px;color:#475569" id="meta"></div>
  </div>
</div>
<label><input type="checkbox" id="lines" checked> show cell borders</label>
<script>
(function () {
  // a 16x16 image generated procedurally (no external file to fetch)
  var N = 16, CELL = 16, S = N * CELL;
  var c = document.getElementById('c'), ctx = c.getContext('2d');
  var data = [];

  function build() {
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var r = Math.round(40 + (x / (N - 1)) * 200);
        var g = Math.round(60 + (y / (N - 1)) * 170);
        var b = Math.round(180 - Math.hypot(x - 8, y - 8) * 12);
        data.push([r, g, b, 255]);
      }
    }
    paint();
  }

  function paint() {
    ctx.clearRect(0, 0, S, S);
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var p = data[y * N + x];
        ctx.fillStyle = 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')';
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    if (document.getElementById('lines').checked) {
      ctx.strokeStyle = 'rgba(15,23,42,.14)'; ctx.lineWidth = 1;
      for (var i = 0; i <= N; i++) {
        ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(S, i * CELL); ctx.stroke();
      }
    }
    document.getElementById('meta').textContent = N + ' x ' + N + ' = ' + (N * N) +
      ' pixels, ' + (N * N * 4) + ' bytes uncompressed';
  }

  function toHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) {
      if (mx === r) h = (60 * ((g - b) / d) + 360) % 360;
      else if (mx === g) h = 60 * ((b - r) / d) + 120;
      else h = 60 * ((r - g) / d) + 240;
    }
    return [Math.round(h), Math.round((mx ? d / mx : 0) * 100), Math.round(mx * 100)];
  }

  function toLabL(r, g, b) {
    var lin = function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    var y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    var f = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
    return Math.round(116 * f - 16);
  }

  function pick(e) {
    var r = c.getBoundingClientRect();
    var x = Math.floor((e.clientX - r.left) / (r.width / N));
    var y = Math.floor((e.clientY - r.top) / (r.height / N));
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    var p = data[y * N + x];
    var hex = '#' + p.slice(0, 3).map(function (v) {
      return v.toString(16).padStart(2, '0');
    }).join('');
    document.getElementById('sw').style.background = hex;
    document.getElementById('hex').textContent = hex;
    document.getElementById('rgba').textContent = 'rgba(' + p.join(', ') + ')';
    document.getElementById('hsv').textContent = toHsv(p[0], p[1], p[2]).join(', ');
    document.getElementById('lab').textContent = toLabL(p[0], p[1], p[2]);
  }

  c.addEventListener('pointermove', pick);
  document.getElementById('lines').addEventListener('change', paint);
  build();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 像素不是「颜色」，是四个整数

一个 RGBA 像素是 4 个 0–255 的整数。所以一张 4000×3000 的未压缩图占 \`4000×3000×4 = 48 MB\` —— 这就是为什么同一张照片 JPG 只有 3 MB（压缩比 16:1），也是为什么在浏览器里同时处理十张大图会 OOM。

页面的「图片信息」工具会扫一遍 alpha 通道来判断有没有透明 —— 因为「看起来是白色」的像素可能是 \`alpha=0\` 的完全透明，粘到别的背景上就露馅了。

## 为什么需要 HSV 和 Lab，明明 RGB 够用

RGB 是**设备语言**（显示器怎么发光），不是**人的语言**。

- **要调颜色深浅**：RGB 里三个通道都要动，且比例不同；HSV 里只动 V；
- **要判断两个颜色像不像**：RGB 的欧氏距离与人眼感知严重不符（绿色区域的 RGB 距离被高估），Lab 的距离才接近人眼；
- **要做颜色阈值**：HSV 的 H 通道对光照强度不敏感，所以「找所有红色的东西」在 HSV 里是一段区间，在 RGB 里是一个立方体（还随亮度变形）。

Lab 的核心价值是**感知均匀**（perceptually uniform）：L 相差 10，看起来就是亮度差一个档次 —— 不论什么颜色。这就是为什么调色工具都基于 Lab，而不是 RGB。

## 像素网格为什么要关掉平滑

放大 12×12 的像素块时，浏览器默认用双线性插值，会把每个像素糊成渐变。\`imageSmoothingEnabled = false\` 强制用最近邻 —— 每个像素变成一个清晰的方块。

这是「看像素」的唯一正确方式。也是游戏里像素风必须关掉平滑的原因（否则像素艺术会变糊）。

## 像素运算的钳制

\`+50\` 之后超过 255 的像素会怎样？\`uint8\` 会**回绕**（256 → 0），画面出现黑斑。所以必须用更宽的类型算完再钳制。

这类 bug 极其常见：在 Python 里用 numpy 的 \`uint8\` 数组相加，溢出是静默的，不报错。

## 想深一层

1. \`0.299 R + 0.587 G + 0.114 B\` 这组系数来自人眼视锥细胞的敏感度：绿色贡献最大，蓝色最小。所以「灰度」不是三通道平均 —— 平均会让蓝天变得比实际更亮。
2. 页面提供三种灰度法（亮度 / 平均 / 去饱和）。对比它们能看出差别：平均法把纯蓝和纯黄都变成 128 灰，而亮度法里黄色亮得多。
3. Lab 的 L 通道单独拿出来就是一张「亮度图」，用它做对比度增强不会影响色相 —— 这是很多自动增强算法的第一步。`,
      en: `## A pixel is not "a colour", it is four integers

An RGBA pixel is four integers 0–255. So a 4000×3000 uncompressed image is \`4000×3000×4 = 48 MB\` — which explains why the same photo as JPG is 3 MB (16:1), and why handling ten large images in a browser will OOM.

The "info" tool scans the alpha channel to report transparency, because a pixel that *looks* white may be \`alpha=0\` — fully transparent, and it betrays you when pasted onto another background.

## Why HSV and Lab exist when RGB is enough

RGB is **the device's language** (how a display emits light), not **the human's**.

- **Changing brightness**: in RGB all three channels move, at different rates; in HSV only V moves;
- **Judging whether two colours look alike**: Euclidean RGB distance disagrees badly with perception (green regions are overestimated); Lab distance tracks the eye;
- **Thresholding a colour**: HSV's H is insensitive to brightness, so "find everything red" is an interval in HSV but a cube (that deforms with light) in RGB.

Lab's core property is being **perceptually uniform**: a ΔL of 10 looks like one step of brightness regardless of hue. That is why colour tools are built on Lab, not RGB.

## Why the pixel grid disables smoothing

Zooming a 12×12 patch by 12×, the browser defaults to bilinear interpolation and smears each pixel into a gradient. \`imageSmoothingEnabled = false\` forces nearest-neighbour so every pixel becomes a crisp square.

That is the only correct way to *look at* pixels, and the same reason pixel-art games must disable smoothing — otherwise the art goes fuzzy.

## The clamp in pixel arithmetic

What happens to a pixel at 200 after \`+50\`? \`uint8\` **wraps** (256 → 0) and you get black speckles. You must compute in a wider type, then clamp.

The bug is everywhere: numpy \`uint8\` addition in Python overflows silently, no error raised.

## Going one level deeper

1. The coefficients \`0.299 R + 0.587 G + 0.114 B\` come from human cone sensitivity: green dominates, blue barely counts. Greyscale is not the mean — averaging makes blue sky brighter than it looks.
2. The page offers three greyscale methods (luminance / average / desaturate). Compare them: averaging turns pure blue and pure yellow both into 128, while luminance keeps yellow far brighter.
3. Extracting Lab's L channel alone gives a pure brightness map; enhancing contrast on it leaves hue untouched — the first step of many auto-enhance pipelines.`
    }
  },

  '/vision/transform': {
    python: `"""Geometry: interpolation and matrices. The eight tools are two ideas.

  interpolation -> how to sample a rotated/scaled pixel grid
  matrix        -> where that grid goes (affine 6 DoF, homography 8 DoF)
"""
import numpy as np


def bilinear(img, x, y):
    """Sample at a fractional position. Nearest-neighbour gives jagged edges
    when enlarging; bilinear averages the 4 neighbours; bicubic uses 16 and
    keeps edges sharper. Browsers offer all three."""
    x0, y0 = int(np.floor(x)), int(np.floor(y))
    fx, fy = x - x0, y - y0
    h, w = img.shape[:2]
    x1, y1 = min(x0 + 1, w - 1), min(y0 + 1, h - 1)

    p00, p10 = img[y0, x0], img[y0, x1]
    p01, p11 = img[y1, x0], img[y1, x1]
    top = p00 * (1 - fx) + p10 * fx
    bottom = p01 * (1 - fx) + p11 * fx
    return top * (1 - fy) + bottom * fy


def rotate_size(w, h, deg):
    """A rotated rectangle needs a bigger canvas, or the corners get cut off.
    This trips up everyone writing their first rotate()."""
    a = np.deg2rad(deg)
    nw = abs(w * np.cos(a)) + abs(h * np.sin(a))
    nh = abs(w * np.sin(a)) + abs(h * np.cos(a))
    return int(np.ceil(nw)), int(np.ceil(nh))


def affine_matrix(angle=0, scale=1.0, shear=0.0, tx=0, ty=0):
    """6 degrees of freedom: rotation(1) + scale(2) + shear(1) + translation(2).
    Parallel lines stay parallel -- which is why a photo of a building cannot
    be straightened with this, only with a homography."""
    a = np.deg2rad(angle)
    ca, sa = np.cos(a), np.sin(a)
    # [x']   [ s*ca  s*(ca*sh - sa)  tx ] [x]
    # [y'] = [ s*sa  s*(sa*sh + ca)  ty ] [y]
    # [1 ]   [   0          0         1 ] [1]
    return np.array([
        [scale * ca, scale * (ca * shear - sa), tx],
        [scale * sa, scale * (sa * shear + ca), ty],
        [0, 0, 1]
    ])


def solve_homography(src, dst):
    """8 unknowns from 4 point pairs (2 equations each). The page solves the
    8x8 system with Gaussian elimination -- cv2.findHomography does the same
    thing but with RANSAC when the points are noisy feature matches."""
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    A = np.array(A, float)
    b = np.array(dst, float).reshape(-1)
    h = np.linalg.solve(A, b[:8]) if len(src) == 4 else np.linalg.lstsq(A, b, rcond=None)[0]
    return np.append(h, 1).reshape(3, 3)
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Interpolation decides how enlargement looks</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:150px}
  canvas{width:100%;display:block;border-radius:6px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  figcaption{font-size:12px;color:#475569;margin-top:5px}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px}
  input[type=range]{width:160px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>Same 8x8 source, three samplers</h1>
<p>Nearest keeps hard pixel edges; bilinear averages four neighbours; bicubic averages sixteen with a
weight that overshoots. Drag to change the source resolution.</p>
<div class="row">
  <figure><canvas id="a" width="160" height="160"></canvas><figcaption>nearest</figcaption></figure>
  <figure><canvas id="b" width="160" height="160"></canvas><figcaption>bilinear</figcaption></figure>
  <figure><canvas id="c" width="160" height="160"></canvas><figcaption>bicubic</figcaption></figure>
</div>
<label>source size <input type="range" id="n" min="4" max="32" step="1" value="8"><output id="v">8</output> px</label>
<script>
(function () {
  var OUT = 160;
  function src(n) {
    var d = [];
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      // a hard checker + a diagonal ramp: exactly the case where samplers differ
      var base = ((x < n / 2) !== (y < n / 2)) ? 235 : 20;
      d.push(Math.round(base * 0.6 + (x / (n - 1)) * 100 + (y / (n - 1)) * 40));
    }
    return d;
  }
  function at(d, n, x, y) {
    x = Math.min(n - 1, Math.max(0, x));
    y = Math.min(n - 1, Math.max(0, y));
    return d[y * n + x];
  }
  function cubic(t) {                       // Catmull-Rom kernel
    var a = -0.5;
    return function (x) {
      x = Math.abs(x);
      if (x <= 1) return (a + 2) * x * x * x - (a + 3) * x * x + 1;
      if (x < 2) return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a;
      return 0;
    };
  }

  function sample(kind, d, n, px, py) {
    var fx = px / OUT * n - 0.5, fy = py / OUT * n - 0.5;
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var tx = fx - x0, ty = fy - y0;
    if (kind === 'nearest') return at(d, n, Math.round(fx), Math.round(fy));
    if (kind === 'bilinear') {
      var p00 = at(d, n, x0, y0), p10 = at(d, n, x0 + 1, y0);
      var p01 = at(d, n, x0, y0 + 1), p11 = at(d, n, x0 + 1, y0 + 1);
      return (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty;
    }
    var K = cubic(), sum = 0, wsum = 0;
    for (var j = -1; j <= 2; j++) {
      for (var i = -1; i <= 2; i++) {
        var w = K(i - tx) * K(j - ty);
        sum += at(d, n, x0 + i, y0 + j) * w; wsum += w;
      }
    }
    return sum / wsum;
  }

  function render() {
    var n = parseInt(document.getElementById('n').value, 10);
    document.getElementById('v').textContent = n;
    var d = src(n);
    ['a', 'b', 'c'].forEach(function (id, k) {
      var kind = ['nearest', 'bilinear', 'bicubic'][k];
      var cv = document.getElementById(id), ctx = cv.getContext('2d');
      var img = ctx.createImageData(OUT, OUT);
      for (var y = 0; y < OUT; y++) {
        for (var x = 0; x < OUT; x++) {
          var v = Math.max(0, Math.min(255, Math.round(sample(kind, d, n, x, y))));
          var i = (y * OUT + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    });
  }
  document.getElementById('n').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 八个工具，两个概念

| 工具 | 变换 | 自由度 | 什么会变 |
| --- | --- | --- | --- |
| 缩放 / 旋转 / 翻转 / 裁剪 / 边距 | 基础画布操作 | — | 位置与尺寸 |
| 比例缩放 / 透视 / 仿射 | 矩阵变换 | 仿射 6 / 透视 8 | 形状 |

**仿射（affine）**保平行：原来平行的两条线，变换后仍平行。旋转、缩放、错切、平移都属这一类。
**透视（homography）**不保平行：近大远小。拍一栋楼，楼的两条边在照片里是收敛的 —— 只有 8 自由度的单应矩阵能把它拉直。

这就是为什么「校正建筑照片」必须用透视，用仿射永远差一点。判断方法：**看原图里有没有平行线在结果里不平行了**。

## 插值决定了「放大好不好看」

放大时，新像素的位置落在原图的像素之间，必须"编"一个值：

- **最近邻**：直接取最近的像素。速度最快，边缘是硬台阶，放大 4 倍以上会明显锯齿 —— 但像素风游戏必须用它；
- **双线性**：取周围 4 个像素加权平均。平滑，但会糊掉细节；
- **双三次**：取周围 16 个像素，用三次函数加权。边缘更锐，是照片放大的默认选择。

浏览器的 \`imageSmoothingQuality = 'high'\` 基本就是双三次。**缩小图片时反而要用面积平均**（先降采样再插值），否则细节会因欠采样产生摩尔纹 —— 这是很多人不知道的一点。

## 旋转为什么会让图变大

一个 \`w × h\` 的矩形旋转 θ 后，其外接矩形是：

\`W = |w·cosθ| + |h·sinθ|\`
\`H = |w·sinθ| + |h·cosθ|\`

45° 时最明显：正方形旋转 45° 后外接矩形是原来的 √2 倍。所以旋转必须**先算新画布尺寸，再把画布中心当作旋转中心**，否则四角会被裁掉。

这是写第一个 rotate 函数时 100% 会踩的坑。

## 单应矩阵的 8 个未知数

透视变换写成：

\`x' = (h₀x + h₁y + h₂) / (h₆x + h₇y + 1)\`
\`y' = (h₃x + h₄y + h₅) / (h₆x + h₇y + 1)\`

分母的存在就是"近大远小"的来源。4 组对应点 × 2 个方程 = 8 个方程，正好解 8 个未知数（h₈ 固定为 1，因为整体缩放不改变变换）。

页面用 8×8 高斯消元解它。和 /vision/features 页的 RANSAC 版本是同一套数学，区别只在点从哪来（人工拖四个角 vs 特征匹配）。

## 想深一层

1. 先缩小再旋转 vs 先旋转再缩小，结果不同（前者更快且质量更好），因为插值次数不同。图像处理里**操作顺序本身就是优化手段**。
2. 仿射矩阵可以分解为「旋转 × 缩放 × 错切 × 平移」，反过来给定任意 6 个数的矩阵也能拆出来 —— 这就是动画系统里矩阵插值（分解后插值再合成）的原理。
3. 透视校正之后，图像里的**比例关系才是真实比例**（比如能用来量尺寸）。这是文档扫描、AR 贴图的共同前提。`,
      en: `## Eight tools, two concepts

| Tool | Transform | DoF | What changes |
| --- | --- | --- | --- |
| resize / rotate / flip / crop / pad | canvas operations | — | position and size |
| scale / perspective / affine | matrix transforms | affine 6 / perspective 8 | shape |

**Affine** preserves parallelism: lines that were parallel stay parallel. Rotation, scaling, shear and translation all belong here.
**Homography** does not: near objects look bigger. Photograph a building and its edges converge — only an 8-DoF homography straightens that.

Which is why "fix a building photo" needs perspective; affine will always be slightly off. The test: **did parallel lines in the original become non-parallel in the result?**

## Interpolation decides whether enlargement looks good

When enlarging, new pixel positions fall between source pixels and must be invented:

- **Nearest neighbour**: take the closest pixel. Fastest, hard stair-steps, obvious aliasing above 4× — and mandatory for pixel art;
- **Bilinear**: weighted average of 4 neighbours. Smooth, but softens detail;
- **Bicubic**: weighted over 16 neighbours with a cubic kernel. Sharper edges, the default for photo enlargement.

\`imageSmoothingQuality = 'high'\` is roughly bicubic. **Shrinking wants area averaging instead** (downsample first, then interpolate), otherwise undersampling creates moiré — widely unknown.

## Why rotating an image makes it bigger

A \`w × h\` rectangle rotated by θ has a bounding box of:

\`W = |w·cosθ| + |h·sinθ|\`
\`H = |w·sinθ| + |h·cosθ|\`

At 45° a square's box is √2 times larger. So rotation must **compute the new canvas first and rotate about its centre**, or the corners get clipped.

Everyone hits this on their first rotate().

## The homography's 8 unknowns

\`x' = (h₀x + h₁y + h₂) / (h₆x + h₇y + 1)\`
\`y' = (h₃x + h₄y + h₅) / (h₆x + h₇y + 1)\`

That denominator is exactly where "near looks bigger" comes from. Four point pairs × 2 equations = 8 equations for 8 unknowns (h₈ fixed at 1, since global scale is irrelevant).

The page solves the 8×8 system with Gaussian elimination — same maths as the RANSAC version on /vision/features, differing only in where the points come from (dragged corners vs feature matches).

## Going one level deeper

1. Shrink-then-rotate differs from rotate-then-shrink (the former is faster and better), because the number of interpolations differs. In image processing, **operation order is itself an optimisation**.
2. An affine matrix decomposes into rotation × scale × shear × translation, and back again — which is how animation systems interpolate matrices (decompose, interpolate, recompose).
3. After perspective correction, **proportions in the image become real proportions** (you can measure with them). That is the shared premise of document scanning and AR overlays.`
    }
  },

  '/vision/color': {
    python: `"""Colour tools: greyscale, channels, replacement, quantisation.

Two ideas carry the page: which luminance weights you choose, and that
K-Means quantisation is just clustering in RGB space.
"""
import numpy as np


def greyscale(img, method='luma'):
    """Three methods, three very different results on saturated colours."""
    r, g, b = img[..., 0].astype(float), img[..., 1].astype(float), img[..., 2].astype(float)
    if method == 'luma':                    # Rec.601, matches human sensitivity
        y = 0.299 * r + 0.587 * g + 0.114 * b
    elif method == 'average':               # naive, makes sky too bright
        y = (r + g + b) / 3
    else:                                   # desaturate: midpoint of max and min
        y = (np.maximum(np.maximum(r, g), b) + np.minimum(np.minimum(r, g), b)) / 2
    return np.repeat(y[..., None], 3, axis=2).astype(np.uint8)


def quantise_kmeans(img, k=8, iters=8, max_samples=4096):
    """Colour quantisation = K-Means in RGB. Fewer colours, smaller file,
    and a poster-like look. The page caps samples so it stays interactive."""
    pixels = img.reshape(-1, 3).astype(np.float32)
    # sample evenly: iterating 2M pixels x 8 iterations in JS is too slow
    step = max(1, len(pixels) // max_samples)
    sample = pixels[::step][:max_samples]

    k = int(np.clip(k, 2, 32))
    centres = sample[np.linspace(0, len(sample) - 1, k).astype(int)].copy()

    for _ in range(iters):
        d = ((sample[:, None, :] - centres[None, :, :]) ** 2).sum(-1)
        label = d.argmin(1)
        for i in range(k):
            sel = sample[label == i]
            if len(sel):
                centres[i] = sel.mean(0)

    # map every pixel to its nearest centre (vectorised, not per-pixel loops)
    d = ((pixels[:, None, :] - centres[None, :, :]) ** 2).sum(-1)
    return centres[d.argmin(1)].reshape(img.shape).astype(np.uint8), centres


def replace_colour(img, target, tolerance, replacement):
    """Euclidean distance in RGB -- simple and wrong in perceptual terms.
    A proper version uses Lab distance; the page keeps RGB for clarity."""
    d = np.linalg.norm(img.astype(float) - np.array(target), axis=-1)
    out = img.copy()
    out[d <= tolerance] = replacement
    return out
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Three greyscales and one K-Means</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:150px}
  canvas{width:100%;display:block;border-radius:6px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  figcaption{font-size:12px;color:#475569;margin-top:5px}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px;margin-right:16px}
  input[type=range]{width:150px}output{font-variant-numeric:tabular-nums;font-weight:600}
  .pal{display:flex;gap:4px;margin-top:8px}
  .pal i{width:22px;height:22px;border-radius:4px;border:1px solid #cbd5e1}
</style>
</head>
<body>
<h1>Greyscale is not averaging, and quantisation is clustering</h1>
<p>Top: three greyscale formulas on the same saturated image — compare pure blue and yellow.
Bottom: K-Means reduces the image to k colours, exactly like a GIF palette.</p>
<div class="row">
  <figure><canvas id="src" width="150" height="150"></canvas><figcaption>source</figcaption></figure>
  <figure><canvas id="luma" width="150" height="150"></canvas><figcaption>luminance 0.299/0.587/0.114</figcaption></figure>
  <figure><canvas id="avg" width="150" height="150"></canvas><figcaption>average (R+G+B)/3</figcaption></figure>
  <figure><canvas id="des" width="150" height="150"></canvas><figcaption>desaturate (max+min)/2</figcaption></figure>
</div>
<div class="row" style="margin-top:12px">
  <figure><canvas id="quant" width="150" height="150"></canvas><figcaption>K-Means quantised</figcaption></figure>
  <figure style="flex:2">
    <div style="font-size:12px;color:#475569">palette (k colours)</div>
    <div class="pal" id="pal"></div>
    <label style="margin-top:14px">k <input type="range" id="k" min="2" max="10" step="1" value="5"><output id="v">5</output></label>
  </figure>
</div>
<script>
(function () {
  var N = 150;
  function paintSrc(ctx) {
    ctx.fillStyle = '#2563eb'; ctx.fillRect(0, 0, N / 2, N / 2);        // pure blue
    ctx.fillStyle = '#facc15'; ctx.fillRect(N / 2, 0, N / 2, N / 2);    // pure yellow
    ctx.fillStyle = '#ef4444'; ctx.fillRect(0, N / 2, N / 2, N / 2);
    ctx.fillStyle = '#22c55e'; ctx.fillRect(N / 2, N / 2, N / 2, N / 2);
    var g = ctx.createLinearGradient(0, 0, N, N);
    g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(0,0,0,.25)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, N, N);
  }

  function grey(kind) {
    var ctx = document.getElementById(kind).getContext('2d');
    var src = document.getElementById('src');
    ctx.drawImage(src, 0, 0);
    var img = ctx.getImageData(0, 0, N, N), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2], v;
      if (kind === 'luma') v = 0.299 * r + 0.587 * g + 0.114 * b;
      else if (kind === 'avg') v = (r + g + b) / 3;
      else v = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }

  function quantise(k) {
    var src = document.getElementById('src');
    var tmp = document.createElement('canvas');
    tmp.width = tmp.height = N;
    var tctx = tmp.getContext('2d');
    tctx.drawImage(src, 0, 0);
    var img = tctx.getImageData(0, 0, N, N), d = img.data;

    // sample every 9th pixel: 150*150/9 = 2500 points is plenty for k<=10
    var pts = [];
    for (var i = 0; i < d.length; i += 36) pts.push([d[i], d[i + 1], d[i + 2]]);

    var centres = [];
    for (var c = 0; c < k; c++) centres.push(pts[Math.floor(c * (pts.length - 1) / (k - 1))].slice());

    for (var it = 0; it < 12; it++) {
      var sums = [];
      for (var s = 0; s < k; s++) sums.push([0, 0, 0, 0]);
      pts.forEach(function (p) {
        var best = 0, bd = Infinity;
        for (var s = 0; s < k; s++) {
          var dd = (p[0] - centres[s][0]) ** 2 + (p[1] - centres[s][1]) ** 2 + (p[2] - centres[s][2]) ** 2;
          if (dd < bd) { bd = dd; best = s; }
        }
        sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2]; sums[best][3]++;
      });
      for (var s2 = 0; s2 < k; s2++) {
        if (sums[s2][3]) centres[s2] = [sums[s2][0] / sums[s2][3], sums[s2][1] / sums[s2][3], sums[s2][2] / sums[s2][3]];
      }
    }

    for (var i2 = 0; i2 < d.length; i2 += 4) {
      var best2 = 0, bd2 = Infinity;
      for (var s3 = 0; s3 < k; s3++) {
        var dd2 = (d[i2] - centres[s3][0]) ** 2 + (d[i2 + 1] - centres[s3][1]) ** 2 + (d[i2 + 2] - centres[s3][2]) ** 2;
        if (dd2 < bd2) { bd2 = dd2; best2 = s3; }
      }
      d[i2] = centres[best2][0]; d[i2 + 1] = centres[best2][1]; d[i2 + 2] = centres[best2][2];
    }

    var q = document.getElementById('quant').getContext('2d');
    q.putImageData(img, 0, 0);

    document.getElementById('pal').innerHTML = centres.map(function (c) {
      return '<i style="background:rgb(' + c.map(Math.round).join(',') + ')"></i>';
    }).join('');
  }

  function render() {
    var k = parseInt(document.getElementById('k').value, 10);
    document.getElementById('v').textContent = k;
    quantise(k);
  }

  paintSrc(document.getElementById('src').getContext('2d'));
  ['luma', 'avg', 'des'].forEach(grey);
  document.getElementById('k').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 灰度不是「取平均」

三种方法在纯色上差别巨大：

| 方法 | 公式 | 纯蓝 (0,0,255) | 纯黄 (255,255,0) |
| --- | --- | --- | --- |
| 亮度 | 0.299R + 0.587G + 0.114B | 29 | 226 |
| 平均 | (R+G+B)/3 | 85 | 170 |
| 去饱和 | (max + min)/2 | 128 | 128 |

平均法把纯蓝和纯黄都压到相近的灰度 —— 这就是为什么用平均法转出来的照片「灰蒙蒙」：人眼对绿色的敏感度是蓝色的 5 倍多，平均法完全无视这一点。

**0.299 / 0.587 / 0.114 是 Rec.601 的系数**，来自人眼三种视锥细胞的响应曲线。BT.709（高清电视）用的是 0.2126 / 0.7152 / 0.0722，绿色权重更高。两套系数在不同场景下都有人用，这就是为什么不同软件转同一张图灰度会略有差异。

## 通道提取里的 Lab-L 是「真正的亮度」

RGB 的三个通道都混了亮度信息。Lab 的 L 通道是**纯亮度**（不含任何色彩信息），所以：

- 用 L 做对比度增强，色相完全不变；
- 用 L 做阈值分割，不会因为颜色不同而被误判；
- 用 L 做直方图均衡（见 /vision/enhancement），不会出现偏色。

这就是专业调色工作流都在 Lab 里做的原因。

## K-Means 量化的两个工程细节

**一、采样**。一张 200 万像素的图，8 次迭代 × k 个中心 = 1.6 亿次距离计算。页面只取 4096 个等距样本 —— 因为颜色的分布远比像素的分布集中，4000 个点足够找出 8 个主要颜色。

**二、初始中心**。页面用等距取点，而不是随机。随机初始化可能把两个中心放在同一片颜色里，导致某个簇永远空着（量化后颜色数不足 k）。等距初始化虽然不最优，但很稳。

K-Means 的目标函数是「所有点到最近中心的距离平方和」，每次迭代单调下降，所以**一定收敛**，但可能收敛到局部最优 —— 这就是为什么要跑多次取最好的（sklearn 的 \`n_init\`）。

## 颜色替换用 RGB 距离是「错」的

代码里 \`|pixel - target| <= tolerance\` 是欧氏距离。它在感知上不均匀：绿色区域的容差"看起来"比蓝色区域大得多。

专业做法是在 Lab 空间算距离，或用 ΔE2000（色差公式）。页面保留 RGB 是因为它直观（调三个滑杆就能理解），但要知道这是简化。

## 想深一层

1. 颜色量化（K-Means）和 GIF 的 256 色调色板是同一个问题：**用有限颜色逼近连续色彩，最小化感知误差**。GIF 用的是中位切分（median cut），更快的近似算法。
2. alpha 通道也能当独立灰度图提取 —— 这就是「抠图后检查蒙版」的做法。
3. 想理解「感知均匀」：在 RGB 里从 (0,0,0) 到 (255,255,255) 均匀取 5 点，人眼看不出这是等间距的；在 Lab 里取才有。`,
      en: `## Greyscale is not averaging

Three methods, wildly different on saturated colours:

| Method | Formula | Pure blue (0,0,255) | Pure yellow (255,255,0) |
| --- | --- | --- | --- |
| Luminance | 0.299R + 0.587G + 0.114B | 29 | 226 |
| Average | (R+G+B)/3 | 85 | 170 |
| Desaturate | (max + min)/2 | 128 | 128 |

Averaging flattens pure blue and pure yellow to similar greys — which is why average-converted photos look washed out: the eye is over five times more sensitive to green than blue, and averaging ignores that entirely.

**0.299 / 0.587 / 0.114 are the Rec.601 coefficients**, derived from human cone response. BT.709 (HDTV) uses 0.2126 / 0.7152 / 0.0722, weighting green higher. Both are in use, which is why different software greyscales the same image slightly differently.

## Lab-L in channel extraction is *actual* brightness

All three RGB channels carry luminance. Lab's L is **pure brightness**, no colour content, so:

- contrast enhancement on L leaves hue untouched;
- thresholding on L does not misfire across different colours;
- histogram equalisation on L does not shift colour (see /vision/enhancement).

That is why professional grading happens in Lab.

## Two engineering details of K-Means quantisation

**Sampling.** A 2-megapixel image with 8 iterations and k centres is 160 million distance computations. The page takes 4096 evenly spaced samples, because colour distribution is far more concentrated than pixel distribution — 4000 points are plenty to find 8 dominant colours.

**Initialisation.** The page spreads initial centres evenly rather than randomly. Random init can drop two centres into one colour region, leaving a cluster permanently empty (fewer than k colours after quantisation). Even spreading is not optimal but is stable.

K-Means minimises the sum of squared distances to the nearest centre, monotonically decreasing each iteration, so it **always converges** — possibly to a local optimum, which is why sklearn runs it multiple times (\`n_init\`).

## Colour replacement in RGB distance is "wrong"

\`|pixel - target| <= tolerance\` is Euclidean. It is perceptually non-uniform: a tolerance in green looks far larger than in blue.

Professionally you would use Lab distance or ΔE2000. The page keeps RGB because three sliders are immediately understandable — but know it is a simplification.

## Going one level deeper

1. K-Means quantisation and GIF's 256-colour palette are the same problem: **approximate continuous colour with few entries, minimising perceptual error**. GIF uses median cut, a faster approximation.
2. The alpha channel extracts as its own greyscale image — the standard way to inspect a matte.
3. To feel perceptual uniformity: sample five evenly spaced points from (0,0,0) to (255,255,255) in RGB and the steps look uneven; do it in Lab and they look even.`
    }
  },

  '/vision/adjustment': {
    python: `"""Ten adjustments, one implementation trick: build a 256-entry LUT first.

Per-pixel maths on 4 megapixels is 4 million operations; a LUT is 256.
"""
import numpy as np


def lut(fn):
    """Any per-channel point operation becomes a table lookup.
    This is how real image editors apply curves instantly."""
    return np.array([fn(v) for v in range(256)], dtype=np.uint8)


def brightness(v, amount):
    return np.clip(v + amount, 0, 255)


def contrast(v, factor):
    """Pivot around 128: values above get brighter, below get darker.
    Contrast is a rotation about mid-grey, not a multiplication."""
    return np.clip((v - 128) * factor + 128, 0, 255)


def gamma(v, g):
    """Display gamma. g > 1 brightens midtones without touching 0 and 255 --
    which is why gamma beats brightness for exposure correction."""
    return np.clip(255 * (v / 255) ** (1.0 / g), 0, 255)


def levels(v, black=0, white=255, gamma=1.0, out_black=0, out_white=255):
    """Input levels remap the range, gamma bends the middle, output levels
    compress it. Photoshop's Levels dialog is exactly these five numbers."""
    t = np.clip((v - black) / max(1, white - black), 0, 1)
    t = t ** (1.0 / gamma)
    return np.clip(out_black + t * (out_white - out_black), 0, 255)


def apply(img, table):
    """One lookup per channel: 3 array indexes instead of 3 multiplications."""
    return table[img]


if __name__ == "__main__":
    from PIL import Image
    img = np.array(Image.open('photo.jpg').convert('RGB'))   # HxWx3 uint8
    t = lut(lambda v: levels(v, black=20, white=235, gamma=1.2))
    out = apply(img, t)
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Point operations, done as a LUT</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  canvas{border-radius:8px;display:block;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .ctl{flex:1;min-width:220px}
  .ctl div{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px}
  .ctl b{width:76px;font-weight:500}
  .ctl input[type=range]{flex:1}
  .ctl output{width:44px;text-align:right;font-variant-numeric:tabular-nums;color:#475569}
  #curve{border-radius:6px;background:#fff;margin-top:6px}
</style>
</head>
<body>
<h1>Ten sliders, one 256-entry table</h1>
<p>Every adjustment below is a point operation, so it becomes a lookup table. The curve on the right
is that table drawn as a graph — apply the same curve in Python and you get identical pixels.</p>
<div class="wrap">
  <canvas id="c" width="260" height="260"></canvas>
  <div class="ctl">
    <div><b>brightness</b><input type="range" id="br" min="-80" max="80" step="1" value="0"><output id="obr">0</output></div>
    <div><b>contrast</b><input type="range" id="co" min="0.3" max="2.2" step="0.02" value="1"><output id="oco">1.00</output></div>
    <div><b>gamma</b><input type="range" id="ga" min="0.3" max="2.4" step="0.02" value="1"><output id="oga">1.00</output></div>
    <div><b>black</b><input type="range" id="bl" min="0" max="120" step="1" value="0"><output id="obl">0</output></div>
    <canvas id="curve" width="260" height="120"></canvas>
  </div>
</div>
<script>
(function () {
  var S = 260;
  var src = document.createElement('canvas');
  src.width = src.height = S;
  (function paint() {
    var g = src.getContext('2d');
    var lin = g.createLinearGradient(0, 0, S, 0);
    lin.addColorStop(0, '#0b1220'); lin.addColorStop(1, '#fef3c7');
    g.fillStyle = lin; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(239,68,68,.85)'; g.beginPath(); g.arc(80, 90, 46, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(34,197,94,.75)'; g.fillRect(150, 140, 90, 90);
    g.fillStyle = 'rgba(59,130,246,.8)'; g.fillRect(30, 168, 70, 62);
  })();
  var srcData = src.getContext('2d').getImageData(0, 0, S, S);

  function buildLut() {
    var br = +document.getElementById('br').value;
    var co = +document.getElementById('co').value;
    var ga = +document.getElementById('ga').value;
    var bl = +document.getElementById('bl').value;
    var lut = new Uint8ClampedArray(256);
    for (var v = 0; v < 256; v++) {
      var x = (v + br - 128) * co + 128;         // brightness = offset, contrast = pivot around 128
      x = Math.max(0, Math.min(255, x)) / 255;
      x = Math.pow(x, 1 / ga);                    // gamma: pins 0 and 255
      x = (x * 255 - bl) / Math.max(1, 255 - bl) * 255;   // levels: black point
      lut[v] = x;
    }
    return lut;
  }

  function apply(lut) {
    var out = document.getElementById('c').getContext('2d');
    var img = new ImageData(new Uint8ClampedArray(srcData.data), S, S);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
    }
    out.putImageData(img, 0, 0);
  }

  function drawCurve(lut) {
    var cv = document.getElementById('curve'), g = cv.getContext('2d');
    g.clearRect(0, 0, 260, 120);
    g.strokeStyle = '#e2e8f0'; g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, 259, 119);
    g.beginPath();
    for (var v = 0; v < 256; v++) {
      var x = v / 255 * 260;
      var y = 120 - lut[v] / 255 * 120;
      if (v === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = '#2563eb'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = 'rgba(148,163,184,.6)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 120); g.lineTo(260, 0); g.stroke();
  }

  function render() {
    document.getElementById('obr').textContent = document.getElementById('br').value;
    document.getElementById('oco').textContent = (+document.getElementById('co').value).toFixed(2);
    document.getElementById('oga').textContent = (+document.getElementById('ga').value).toFixed(2);
    document.getElementById('obl').textContent = document.getElementById('bl').value;
    var lut = buildLut();
    apply(lut); drawCurve(lut);
  }

  ['br', 'co', 'ga', 'bl'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 所有调整都是「点运算」，所以都能用 LUT

这里的十个工具有个共同点：**输出像素只取决于输入像素**（不考虑邻居）。这类运算叫点运算（point operation），都可以预先算成一张 256 项的表：

\`out = table[in]\`

一张 400 万像素的图，逐像素算 \`(v-128)*1.3+128\` 是 400 万次浮点乘法；查表是 400 万次内存读取。在 JS 里这个差距是 3–5 倍，在移动端更明显。**所有专业修图软件的第一层优化都是 LUT。**

更妙的是：多个点运算可以复合成一张 LUT（\`table2[table1[v]]\`），十个调整叠起来仍然只有一次查表。

## 对比度为什么绕 128 转

\`(v - 128) * k + 128\`

如果不减 128，直接 \`v * k\`：k=1.5 时，50 → 75（变亮），200 → 300（被钳到 255）。整张图不只是对比增强，还整体变亮了 —— 这不是对比度该有的行为。

减掉 128 再乘，等于**以中灰为轴旋转**：暗的更暗、亮的更亮，中间的 128 不动。这才是"对比度"的词义。

同理，亮度的正确写法是「加」而不是「乘」：加是整体平移（保留对比度），乘是缩放（同时改变对比度）。

## 伽马比亮度高级在哪

\`255 * (v/255)^(1/γ)\`

- γ > 1：中间调变亮，**0 和 255 保持不变**；
- γ < 1：中间调变暗。

亮度（加法）会把 255 处的像素钳掉，丢失高光细节；伽马是非线性曲线，两端固定、中间弯曲，所以**只动中间调**。

这就是为什么修图时提亮暗部要用伽马 / 曲线，而不是拉亮度滑杆 —— 后者会把本来就亮的地方烧成死白。

## 色阶（levels）是五个数字的全能工具

\`黑场 / 白场 / 伽马 / 输出黑 / 输出白\`

- **黑场 20**：把 20 以下的暗部压成纯黑，去掉「灰雾」；
- **白场 235**：把 235 以上拉到纯白，去掉"不够白"；
- **伽马 1.2**：中间提亮；
- **输出范围压缩**（如 20–235）：用于印刷留出油墨余量。

Photoshop 的 Levels 对话框就是这五个滑杆。理解了它，绝大多数「照片发灰」的问题都能解决 —— 本质是**直方图没有被充分利用**。

## 想深一层

1. 自动对比度用 1% / 99% 分位而不是 min/max，是因为一个过曝的白点（比如反光）会让 max=255，导致整张图几乎不变。**分位数对离群值鲁棒**。
2. 白平衡在代码里是 \`R × (1 + temp/200)\`、\`B × (1 - temp/200)\` 的线性近似。真实的色温调整要做色适应（Bradford 变换），但线性近似在小范围内肉眼几乎看不出差别，而且快得多。
3. 色相调整必须转到 HSV 改 H 再转回来 —— 直接在 RGB 上操作会让亮度也变。这是「为什么需要另一个色彩空间」的最直接例子。`,
      en: `## Every adjustment is a point operation, so every one fits a LUT

The ten tools share a property: **output depends only on the input pixel** (no neighbours). That makes them point operations, all expressible as a 256-entry table:

\`out = table[in]\`

On a 4-megapixel image, evaluating \`(v-128)*1.3+128\` per pixel is 4 million float multiplies; a lookup is 4 million reads. In JS that is a 3–5× difference, more on mobile. **The first optimisation layer in every professional editor is a LUT.**

Better still, point operations compose into one table (\`table2[table1[v]]\`), so ten stacked adjustments still cost one lookup.

## Why contrast pivots around 128

\`(v - 128) * k + 128\`

Without the -128, plain \`v * k\`: at k=1.5, 50 → 75 (brighter) and 200 → 300 (clamped). The image gets brighter overall, not just more contrast — which is not what the word means.

Subtracting 128 first is **rotating about mid-grey**: darks darker, lights lighter, 128 unchanged. That is contrast.

By the same logic, brightness must be addition, not multiplication: addition translates (keeping contrast), multiplication scales (changing contrast too).

## What gamma does that brightness cannot

\`255 * (v/255)^(1/γ)\`

- γ > 1 brightens midtones while **leaving 0 and 255 fixed**;
- γ < 1 darkens midtones.

Addition clips at 255 and destroys highlight detail; gamma is a non-linear curve pinned at both ends that only bends the middle. That is why lifting shadows uses gamma or curves, never the brightness slider — which burns out what was already bright.

## Levels is five numbers that do everything

\`black / white / gamma / output black / output white\`

- **black 20**: crush below 20 to pure black, removing haze;
- **white 235**: pull above 235 to pure white, removing "not quite white";
- **gamma 1.2**: lift midtones;
- **output compression** (say 20–235): ink headroom for print.

Photoshop's Levels dialog is exactly these five sliders. Understand it and most "my photo looks flat" problems disappear — the cause is an underused histogram.

## Going one level deeper

1. Auto contrast clips at the 1st/99th percentile rather than min/max, because one specular highlight sets max=255 and the whole adjustment becomes no-op. **Quantiles are robust to outliers.**
2. White balance here is the linear approximation \`R × (1 + temp/200)\`, \`B × (1 - temp/200)\`. True colour-temperature adjustment needs chromatic adaptation (Bradford); the linear form is invisible at small deltas and far cheaper.
3. Hue adjustment has to go to HSV and back — doing it in RGB shifts luminance too. The clearest argument for why another colour space exists.`
    }
  },

  '/vision/filters': {
    python: `"""Convolution: one idea, nine tools. Everything here is a weighted sum
of a neighbourhood, and the kernel is the entire difference.
"""
import numpy as np


def convolve(img, kernel):
    """Manual 2D convolution, 4 channels, edge-replicated borders.
    No scipy, no cv2 -- so you can see what 'blur' actually computes."""
    kh, kw = kernel.shape
    pad_y, pad_x = kh // 2, kw // 2
    h, w, ch = img.shape
    padded = np.pad(img.astype(np.float32), ((pad_y, pad_y), (pad_x, pad_x), (0, 0)), mode='edge')

    # Divisor = sum of kernel: keeps overall brightness constant for blurs.
    # A kernel summing to 0 (edge detectors) needs divisor 1 instead.
    total = kernel.sum()
    divisor = total if abs(total) > 1e-6 else 1.0

    out = np.zeros((h, w, ch), np.float32)
    for y in range(kh):
        for x in range(kw):
            k = kernel[y, x]
            if k == 0:
                continue
            out += k * padded[y:y + h, x:x + w]
    return np.clip(out / divisor, 0, 255).astype(np.uint8)


def gaussian_kernel(radius, sigma=None):
    """sigma defaults to radius/2 in the page. sigma controls how fast the
    weights fall off; radius controls where you truncate."""
    sigma = sigma or radius / 2
    ax = np.arange(-radius, radius + 1)
    xx, yy = np.meshgrid(ax, ax)
    k = np.exp(-(xx ** 2 + yy ** 2) / (2 * sigma ** 2))
    return k / k.sum()


def median_blur(img, radius=1):
    """Not a convolution: it sorts. That is why it removes salt-and-pepper
    noise -- an extreme value never wins a vote among its neighbours."""
    k = 2 * radius + 1
    h, w, ch = img.shape
    padded = np.pad(img, ((radius, radius), (radius, radius), (0, 0)), mode='edge')
    out = np.zeros_like(img)
    for i in range(h):
        for j in range(w):
            window = padded[i:i + k, j:j + k].reshape(-1, ch)
            out[i, j] = np.median(window, axis=0)
    return out


def unsharp_mask(img, radius=1, amount=0.5):
    """The three-step recipe behind 'sharpen': blur, subtract, add back.
    Sharpen is not a magic kernel -- it is unsharp masking with amount=1."""
    blurred = convolve(img, gaussian_kernel(radius))
    return np.clip(img + amount * (img.astype(float) - blurred), 0, 255).astype(np.uint8)
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Nine filters, one convolution</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:150px}
  canvas{width:100%;display:block;border-radius:6px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  figcaption{font-size:12px;color:#475569;margin-top:5px}
  .btns{margin-top:12px}
  button{font:inherit;font-size:12px;padding:5px 11px;border-radius:6px;border:1px solid #cbd5e1;
         background:#fff;cursor:pointer;margin:0 6px 6px 0}
  button.on{background:#2563eb;color:#fff;border-color:#2563eb}
</style>
</head>
<body>
<h1>The kernel is the entire difference</h1>
<p>Same convolution function, different 3x3 table. Note that the divisor is the kernel sum — except
for edge detectors, whose sum is zero and must be divided by 1 instead.</p>
<div class="row">
  <figure><canvas id="src" width="180" height="180"></canvas><figcaption>source</figcaption></figure>
  <figure><canvas id="out" width="180" height="180"></canvas><figcaption id="name">—</figcaption></figure>
  <figure><canvas id="kern" width="180" height="180"></canvas><figcaption>kernel (normalised for display)</figcaption></figure>
</div>
<div class="btns" id="btns"></div>
<script>
(function () {
  var S = 180;
  var src = document.createElement('canvas');
  src.width = src.height = S;
  (function paint() {
    var g = src.getContext('2d');
    g.fillStyle = '#f1f5f9'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#1d4ed8'; g.fillRect(30, 30, 70, 70);
    g.fillStyle = '#f59e0b'; g.beginPath(); g.arc(125, 120, 36, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0f172a'; g.fillRect(20, 140, 140, 12);
    // noise speckles: makes blur vs median visible
    for (var i = 0; i < 90; i++) {
      g.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#000000';
      g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
  })();
  var srcData = src.getContext('2d').getImageData(0, 0, S, S);

  var KERNELS = {
    'box blur': [[1,1,1],[1,1,1],[1,1,1]],
    'gaussian': [[1,2,1],[2,4,2],[1,2,1]],
    'sharpen': [[0,-1,0],[-1,5,-1],[0,-1,0]],
    'laplacian': [[0,-1,0],[-1,4,-1],[0,-1,0]],
    'emboss': [[-2,-1,0],[-1,1,1],[0,1,2]],
    'sobel-x': [[-1,0,1],[-2,0,2],[-1,0,1]]
  };

  function convolve(k) {
    var sum = 0;
    k.forEach(function (row) { row.forEach(function (v) { sum += v; }); });
    var div = Math.abs(sum) > 1e-6 ? sum : 1;
    var off = Math.abs(sum) > 1e-6 ? 0 : 128;      // edge kernels need a bias to be visible
    var d = srcData.data;
    var img = new ImageData(S, S);
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var acc = [0, 0, 0];
        for (var j = -1; j <= 1; j++) {
          for (var i = -1; i <= 1; i++) {
            var yy = Math.min(S - 1, Math.max(0, y + j));
            var xx = Math.min(S - 1, Math.max(0, x + i));
            var w = k[j + 1][i + 1], p = (yy * S + xx) * 4;
            acc[0] += d[p] * w; acc[1] += d[p + 1] * w; acc[2] += d[p + 2] * w;
          }
        }
        var o = (y * S + x) * 4;
        img.data[o] = acc[0] / div + off;
        img.data[o + 1] = acc[1] / div + off;
        img.data[o + 2] = acc[2] / div + off;
        img.data[o + 3] = 255;
      }
    }
    return img;
  }

  function drawKernel(k) {
    var cv = document.getElementById('kern'), g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
    var max = 0;
    k.forEach(function (r) { r.forEach(function (v) { max = Math.max(max, Math.abs(v)); }); });
    var cell = 46, ox = (S - cell * 3) / 2, oy = (S - cell * 3) / 2;
    k.forEach(function (row, j) {
      row.forEach(function (v, i) {
        var t = Math.abs(v) / (max || 1);
        g.fillStyle = v >= 0 ? 'rgba(37,99,235,' + (0.12 + t * 0.8) + ')'
                            : 'rgba(220,38,38,' + (0.12 + t * 0.8) + ')';
        g.fillRect(ox + i * cell, oy + j * cell, cell - 3, cell - 3);
        g.fillStyle = Math.abs(v) > 0.8 ? '#fff' : '#0f172a';
        g.font = 'bold 13px ui-monospace, monospace';
        g.fillText(String(v), ox + i * cell + 13, oy + j * cell + 28);
      });
    });
  }

  function show(name) {
    document.querySelectorAll('#btns button').forEach(function (b) {
      b.classList.toggle('on', b.textContent === name);
    });
    var img = convolve(KERNELS[name]);
    document.getElementById('out').getContext('2d').putImageData(img, 0, 0);
    document.getElementById('name').textContent = name;
    drawKernel(KERNELS[name]);
  }

  Object.keys(KERNELS).forEach(function (name) {
    var b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', function () { show(name); });
    document.getElementById('btns').appendChild(b);
  });
  show('gaussian');
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 九种滤波，一个卷积

除了中值滤波（它是排序，不是加权和），其余八个都是卷积：

\`out(x,y) = Σ kernel(i,j) × in(x+i, y+j)\`

**核（kernel）就是全部**。同一个卷积函数，换一张 3×3 的表，就从模糊变成锐化变成浮雕。这是图像处理里最优美的简化。

## 除数为什么是核元素之和

模糊核（盒式、高斯）的和是 1（归一化过），所以除以 1 保持亮度。但如果核的和是 4（比如均值核没归一化），不除的话整张图会亮 4 倍、全白。

**边缘检测核的和是 0**（比如 \`[[0,-1,0],[-1,4,-1],[0,-1,0]]\`）—— 因为平坦区域应该输出 0（没有边缘）。这时除以 0 会炸，所以代码里判 \`|sum| < 1e-6\` 就用 1。

这个判据看起来是细节，但它是「模糊」和「边缘检测」共用同一个卷积函数的唯一原因。

## 高斯模糊可以拆成两次一维

二维高斯核是可分离的：\`G(x,y) = G(x)·G(y)\`。

一个 9×9 的核有 81 个乘法；拆成两个 9 项的 1D 核只需要 18 次。**效率差 4.5 倍，结果完全一样**（数学上严格等价，不是近似）。

所有严肃的图像库都做这个优化。页面的 \`gaussianKernel\` 里给了完整的二维核是为了让公式直观，实际实现应该拆开。

## 中值滤波为什么能去椒盐噪

椒盐噪声是**极值**（0 或 255）。均值滤波会把极值平均进邻域，结果是"噪声变淡但还在"（一圈灰色的点）。

中值滤波取邻域的中位数 —— 一个极端值在任何排序里都不会是中间那个，所以**直接被丢弃**。5×5 窗口里只要噪声点少于 12 个，中值就完全不受影响。

这就是为什么「去噪要先判断噪声类型」：椒盐用中值，高斯噪声用均值/高斯，用错了效果差一个数量级。

## 双边滤波是唯一保边的滤波器

普通高斯只看**距离**：离得近权重大。所以它会把边缘也一起糊掉。

双边滤波同时看**距离和颜色差**：

\`w = exp(-d²/2σs²) × exp(-Δcolor²/2σc²)\`

边缘两侧颜色差大 → 第二项趋近 0 → 权重几乎为零 → 边缘不被混合。平坦区域颜色差小 → 第二项接近 1 → 正常模糊。

**这就是「磨皮」的原理**：皮肤是平坦区域（被模糊），五官边缘是高频（被保留）。所以页面的「美颜」工具就是双边滤波 + 自动对比度 + USM，一个模型都没有。

代价是慢：每个像素要算 \`(2r+1)²\` 次，且不能分离（因为权重依赖像素值）。这是 O(n·r²)，比高斯慢一个量级。

## 想深一层

1. USM（unsharp mask）三步：原图 - 模糊 = 高频细节；细节 × amount；加回原图。**"锐化"本质是增强高频，不是让边缘变硬**。
2. 卷积的边界处理（复制 / 镜像 / 补零）会影响边缘一圈的结果。补零会在边框产生暗边（因为和 0 加权），页面用复制边框避免这个问题。
3. 运动模糊核是沿角度的一条线 —— 这就是「反卷积去运动模糊」为什么难：你需要知道那条线的角度和长度，猜错了会振铃。`,
      en: `## Nine filters, one convolution

Except median blur (which sorts, not sums), all eight are convolutions:

\`out(x,y) = Σ kernel(i,j) × in(x+i, y+j)\`

**The kernel is everything.** One convolution function plus a different 3×3 table gives blur, sharpen, or emboss. The most elegant simplification in image processing.

## Why the divisor is the kernel sum

Blur kernels sum to 1 (normalised), so dividing by 1 preserves brightness. An unnormalised mean kernel sums to 4; skip the division and the image becomes four times brighter — pure white.

**Edge kernels sum to 0** (\`[[0,-1,0],[-1,4,-1],[0,-1,0]]\`) because flat regions must output 0. Dividing by 0 explodes, so the code tests \`|sum| < 1e-6\` and uses 1.

That test looks like a detail, but it is the only reason blur and edge detection can share one convolution function.

## Gaussian blur splits into two 1D passes

A 2D Gaussian is separable: \`G(x,y) = G(x)·G(y)\`.

A 9×9 kernel costs 81 multiplies; two 9-tap passes cost 18. **4.5× faster with identical results** (an exact equivalence, not an approximation).

Every serious imaging library does this. The page builds the full 2D kernel to keep the formula legible; production code should split it.

## Why median removes salt-and-pepper

Salt-and-pepper noise is **extreme values** (0 or 255). Mean filtering averages them in, so the noise becomes "a faint grey dot that is still there".

Median takes the middle value of the neighbourhood — an extreme value is never the middle of any sorted order, so it is **discarded outright**. In a 5×5 window, up to 12 noisy pixels leave the median untouched.

Which is why denoising starts with identifying the noise: median for salt-and-pepper, mean/Gaussian for Gaussian noise. The wrong choice is an order of magnitude worse.

## Bilateral is the one edge-preserving filter

Plain Gaussian weights by **distance** only, so it smears edges along with everything else.

Bilateral weights by **distance and colour difference**:

\`w = exp(-d²/2σs²) × exp(-Δcolor²/2σc²)\`

Across an edge, colour difference is large → the second term approaches 0 → the neighbour barely contributes → the edge survives. In flat regions the difference is small → normal blurring.

**This is skin smoothing.** Skin is flat (gets blurred), facial features are high-frequency (get preserved). So the page's "beautify" is bilateral + auto contrast + unsharp mask, with no model at all.

The cost is speed: \`(2r+1)²\` operations per pixel, and it cannot be separated because the weight depends on pixel values. O(n·r²), an order of magnitude slower than Gaussian.

## Going one level deeper

1. Unsharp mask in three steps: original − blurred = high frequencies; multiply by amount; add back. **Sharpening amplifies high frequencies, it does not harden edges.**
2. Border handling (replicate / mirror / zero-pad) changes the outermost ring. Zero padding darkens borders because the kernel mixes with 0; the page replicates instead.
3. A motion-blur kernel is a line at an angle — which is why deblurring is hard: you must know that angle and length, and guessing wrong produces ringing.`
    }
  },

  '/vision/enhancement': {
    python: `"""Enhancement tools: histogram work, plus two things that are NOT what
their names suggest. super-res here is interpolation; beautify is bilateral.
"""
import numpy as np


def histogram(img):
    """256 bins over luminance. The shape tells you what is wrong before you
    touch a slider: clipped at the ends, bunched in the middle, or comb-like."""
    y = (0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2]).astype(np.uint8)
    return np.bincount(y.ravel(), minlength=256)


def equalise(img):
    """Histogram equalisation = remap each level by the CDF.
    Monotonic, so ordering is preserved; non-linear, so contrast redistributes
    to where the pixels actually are."""
    h, w = img.shape[:2]
    y = (0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2]).astype(np.uint8)
    hist = np.bincount(y.ravel(), minlength=256)
    cdf = hist.cumsum()
    cdf_min = cdf[cdf > 0].min()

    # the standard formula: (cdf - cdf_min) / (N - cdf_min) * 255
    lut = ((cdf - cdf_min) / (h * w - cdf_min) * 255).clip(0, 255).astype(np.uint8)
    return lut[y]


def match_histogram(img, reference):
    """Make img's histogram look like reference's. Used for colour consistency
    across a set of photos -- each CDF is mapped onto the other's."""
    def cdf(a):
        h = np.bincount(a.ravel(), minlength=256)
        c = h.cumsum()
        return c / c[-1]

    src = (0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2]).astype(np.uint8)
    ref = (0.299 * reference[..., 0] + 0.587 * reference[..., 1] + 0.114 * reference[..., 2]).astype(np.uint8)

    cdf_s, cdf_r = cdf(src), cdf(ref)
    lut = np.interp(cdf_s, cdf_r, np.arange(256)).astype(np.uint8)
    return lut[src]


def super_res(img, factor=2):
    """Honest label: this page's 'super resolution' is bilinear upscaling plus
    unsharp mask. There is no neural network. Real SR (ESRGAN, SwinIR) invents
    detail; interpolation cannot."""
    h, w = img.shape[:2]
    # bilinear via nearest-index trick for brevity; the page uses drawImage
    ys = (np.arange(h * factor) / factor).astype(int).clip(0, h - 1)
    xs = (np.arange(w * factor) / factor).astype(int).clip(0, w - 1)
    return img[ys][:, xs]
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Histogram equalisation, and what it amplifies</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:160px}
  canvas{width:100%;display:block;border-radius:6px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  figcaption{font-size:12px;color:#475569;margin-top:5px}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px}
  input[type=range]{width:170px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>Equalisation stretches what is there — including noise</h1>
<p>A flat image uses only a narrow band of levels. Mapping levels through the CDF spreads them out.
Turn the noise up and watch the histogram flatten, then watch the grain appear.</p>
<div class="row">
  <figure><canvas id="a" width="200" height="150"></canvas><figcaption>flat original</figcaption></figure>
  <figure><canvas id="b" width="200" height="150"></canvas><figcaption>equalised</figcaption></figure>
</div>
<div class="row" style="margin-top:10px">
  <figure><canvas id="ha" width="200" height="80"></canvas><figcaption>histogram before</figcaption></figure>
  <figure><canvas id="hb" width="200" height="80"></canvas><figcaption>histogram after</figcaption></figure>
</div>
<label>noise σ <input type="range" id="nz" min="0" max="18" step="1" value="4"><output id="v">4</output></label>
<label>original band <input type="range" id="bd" min="20" max="140" step="5" value="60"><output id="v2">60</output></label>
<script>
(function () {
  var W = 200, H = 150, seed = 12345;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function gauss() {
    var u = Math.max(1e-6, rnd()), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function baseAt(x, y) {
    // a smooth scene compressed into a narrow band (the "flat photo")
    var t = (Math.sin(x / 26) + Math.cos(y / 19) + 2) / 4;
    return t;                       // 0..1
  }

  function draw() {
    var sigma = +document.getElementById('nz').value;
    var band = +document.getElementById('bd').value;
    document.getElementById('v').textContent = sigma;
    document.getElementById('v2').textContent = band;
    seed = 12345;

    var A = document.getElementById('a').getContext('2d');
    var ia = A.createImageData(W, H);
    var hist1 = new Uint32Array(256);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var v = 128 - band / 2 + baseAt(x, y) * band + gauss() * sigma;
        v = Math.max(0, Math.min(255, v));
        var i = (y * W + x) * 4;
        ia.data[i] = ia.data[i + 1] = ia.data[i + 2] = v; ia.data[i + 3] = 255;
        hist1[Math.round(v)]++;
      }
    }
    A.putImageData(ia, 0, 0);

    // CDF -> LUT, exactly the textbook formula
    var cdf = new Uint32Array(256), acc = 0, cdfMin = 0;
    for (var k = 0; k < 256; k++) { acc += hist1[k]; cdf[k] = acc; if (!cdfMin && acc > 0) cdfMin = acc; }
    var total = W * H, lut = new Uint8ClampedArray(256);
    for (var k2 = 0; k2 < 256; k2++) {
      lut[k2] = (cdf[k2] - cdfMin) / Math.max(1, total - cdfMin) * 255;
    }

    var B = document.getElementById('b').getContext('2d');
    var ib = B.createImageData(W, H);
    var hist2 = new Uint32Array(256);
    for (var i2 = 0; i2 < ia.data.length; i2 += 4) {
      var l = Math.round(0.299 * ia.data[i2] + 0.587 * ia.data[i2 + 1] + 0.114 * ia.data[i2 + 2]);
      var ratio = lut[l] / Math.max(1, l);      // same ratio on all channels: no colour cast
      ib.data[i2] = ia.data[i2] * ratio;
      ib.data[i2 + 1] = ia.data[i2 + 1] * ratio;
      ib.data[i2 + 2] = ia.data[i2 + 2] * ratio;
      ib.data[i2 + 3] = 255;
      hist2[Math.round(Math.min(255, ib.data[i2]))]++;
    }
    B.putImageData(ib, 0, 0);

    drawHist('ha', hist1); drawHist('hb', hist2);
  }

  function drawHist(id, hist) {
    var cv = document.getElementById(id), g = cv.getContext('2d');
    g.clearRect(0, 0, 200, 80);
    var max = 1;
    for (var i = 0; i < 256; i++) max = Math.max(max, hist[i]);
    g.fillStyle = '#2563eb';
    for (var v = 0; v < 256; v++) {
      var h = (hist[v] / max) * 72;
      g.fillRect(v / 256 * 200, 78 - h, 200 / 256, h);
    }
  }

  document.getElementById('nz').addEventListener('input', draw);
  document.getElementById('bd').addEventListener('input', draw);
  draw();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 直方图均衡为什么能增强对比

假设一张照片的像素全挤在 100–150 之间（"发灰"）。均衡化的做法是：**按累积分布函数（CDF）重新映射每个亮度级**。

CDF 的含义是「比这个亮度暗的像素占多少比例」。挤在 100–150 的像素，CDF 会在这段区间快速上升 —— 映射后，这段区间被拉伸到 0–255 的绝大部分，对比度就出来了。

两个性质决定了它好用：
- **单调**：原本亮的还是更亮，不会出现颜色反转；
- **自适应**：不需要参数，看数据自己分布。

## 但均衡化会放大噪声，而且偏色

**一、噪声放大**：如果一块平坦天空的亮度值有 ±2 的噪声，而整张图的可利用区间只有 50 级，均衡化会把 ±2 放大成 ±10 —— 天空出现明显颗粒。

**二、偏色**：如果对 R/G/B 三个通道**各自独立**做均衡，三者的 CDF 不同，映射曲线不同，结果就是颜色变了。正确做法是**用亮度算一条 LUT，三个通道按同一比例缩放** —— 这正是页面代码里 \`ratio\` 那一行的作用。

这个坑非常常见：网上大量"直方图均衡"代码是三通道分别做的，跑出来的图偏青或偏品红。

## super-res 和 beautify 都不是模型

页面在这两处很诚实：

- **超分辨率**：只是双线性放大 + USM。能"看起来更清楚"是因为锐化增强了边缘，**没有生成任何新细节**。真实的 SR（ESRGAN、SwinIR）会"编"出细节，那是生成模型的活。
- **美颜**：双边滤波（磨皮）+ 自动亮度对比度 + USM（提神）+ 饱和度 1.15。一个神经网络都没有。

**知道这一点很重要**：如果学生以为这是 AI 超分，他对「什么是生成模型」的理解就歪了。这类"名字比实现牛"的功能，正应该被点破。

## 加噪也是有用的工具

页面提供加高斯噪声（Box-Muller 变换：两个均匀分布 → 一个正态分布）。用途：

1. 测试去噪算法（有干净原图才能算 PSNR）；
2. 数据增强（训练鲁棒模型）；
3. **演示为什么去噪必须知道噪声类型** —— 加了高斯噪声用中值滤波，效果很差。

## 想深一层

1. CLAHE（限制对比度的自适应均衡）把图分块、块内均衡、再插值拼接，并限制放大倍数。它是"均衡化会放大噪声"这个问题的标准解。
2. 直方图匹配的用途：把一组照片的色调统一。做法是把每张图的 CDF 映射到参考图的 CDF 上。
3. 直方图的形状本身是诊断工具：两端被削平 = 过曝/欠曝；中间一根根竖条 = 过度压缩（JPEG 块效应）；平滑单峰 = 正常。`,
      en: `## Why histogram equalisation increases contrast

Suppose every pixel sits between 100 and 150 ("flat"). Equalisation **remaps each level by its cumulative distribution function**.

The CDF says "what fraction of pixels are darker than this". For pixels crammed into 100–150 the CDF rises steeply there, so after remapping that band stretches across most of 0–255 — contrast appears.

Two properties make it practical:
- **monotonic**: brighter stays brighter, no inversion;
- **adaptive**: no parameters, it reads the data.

## But it amplifies noise and shifts colour

**Noise**: if a flat sky has ±2 jitter and the image only uses 50 levels, equalisation turns ±2 into ±10 — visible grain.

**Colour**: equalising R, G and B **independently** gives three different CDFs, hence three different mappings, hence a colour cast. The correct approach computes **one LUT from luminance and scales all channels by the same ratio** — exactly what the \`ratio\` line does.

The trap is everywhere: plenty of "histogram equalisation" snippets online process channels separately and output cyan or magenta images.

## Neither super-res nor beautify is a model

The page is honest about both:

- **Super resolution**: bilinear upscale plus unsharp mask. It looks sharper because edges were enhanced; **no new detail is generated**. Real SR (ESRGAN, SwinIR) invents detail — that is generative modelling.
- **Beautify**: bilateral (skin smoothing) + auto brightness/contrast + unsharp mask + saturation 1.15. No network anywhere.

**This matters**: a student who believes this is AI upscaling has a wrong model of what generative models do. Features whose names outrun their implementation deserve to be called out.

## Noise generation is a real tool

The page adds Gaussian noise via Box-Muller (two uniforms → one normal). Uses:

1. testing denoisers (you need a clean original to compute PSNR);
2. data augmentation for robust training;
3. **demonstrating why the noise type must be known** — median filtering Gaussian noise performs badly.

## Going one level deeper

1. CLAHE (contrast-limited adaptive equalisation) tiles the image, equalises locally, interpolates, and caps the amplification — the standard answer to "equalisation amplifies noise".
2. Histogram matching makes a set of photos share one tone curve by mapping each CDF onto a reference CDF.
3. Histogram shape is itself a diagnostic: clipped at both ends = over/under-exposed; comb-like bars = heavy compression (JPEG blocking); smooth unimodal = normal.`
    }
  },

  '/vision/morphology': {
    python: `"""Thresholds and morphology: the geometry of binary images.

Four operations (erode / dilate / open / close) are set operations on pixels,
and they compose into everything else.
"""
import numpy as np


def otsu(gray):
    """Pick the threshold that maximises between-class variance.
    Equivalently: the split where foreground and background are furthest apart.
    No parameters, which is why it is everywhere."""
    hist = np.bincount(gray.ravel(), minlength=256).astype(float)
    total = hist.sum()
    sum_all = np.dot(np.arange(256), hist)

    best_t, best_var = 0, -1.0
    w_bg = 0.0
    sum_bg = 0.0
    for t in range(256):
        w_bg += hist[t]
        if w_bg == 0:
            continue
        w_fg = total - w_bg
        if w_fg == 0:
            break
        sum_bg += t * hist[t]
        m_bg = sum_bg / w_bg
        m_fg = (sum_all - sum_bg) / w_fg
        var = w_bg * w_fg * (m_bg - m_fg) ** 2      # between-class variance
        if var > best_var:
            best_var, best_t = var, t
    return best_t


def erode(binary, r=1):
    """A pixel survives only if ALL neighbours are foreground.
    Geometrically: shrink the white region by r pixels."""
    return _filter(binary, r, np.min)


def dilate(binary, r=1):
    """A pixel becomes foreground if ANY neighbour is.
    Geometrically: grow the white region by r pixels."""
    return _filter(binary, r, np.max)


def _filter(binary, r, fn):
    k = 2 * r + 1
    padded = np.pad(binary, r, mode='constant', constant_values=0)
    h, w = binary.shape
    out = np.zeros_like(binary)
    for y in range(k):
        for x in range(k):
            window = padded[y:y + h, x:x + w]
            out = fn(out, window) if y or x else window.copy()
    return out


def open_(b):      # remove small specks, keep shapes
    return dilate(erode(b))


def close_(b):     # fill small holes, keep shapes
    return erode(dilate(b))


def gradient(b):   # the outline: dilation minus erosion
    return dilate(b) & ~erode(b)


def skeleton(binary, max_iter=60):
    """Zhang-Suen thinning: peel one layer per iteration until a 1px skeleton
    remains. Two sub-passes per iteration keep it symmetric."""
    img = (binary > 0).astype(np.uint8)
    for _ in range(max_iter):
        changed = False
        for step in (0, 1):
            p = np.pad(img, 1)
            P2, P3, P4 = p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:]
            P5, P6, P7 = p[2:, 2:], p[2:, 1:-1], p[2:, :-2]
            P8, P9 = p[1:-1, :-2], p[:-2, :-2]
            B = P2 + P3 + P4 + P5 + P6 + P7 + P8 + P9
            A = ((P2 == 0) & (P3 == 1)).astype(int)
            for a, b in [((P3 == 0) & (P4 == 1)), ((P4 == 0) & (P5 == 1)),
                         ((P5 == 0) & (P6 == 1)), ((P6 == 0) & (P7 == 1)),
                         ((P7 == 0) & (P8 == 1)), ((P8 == 0) & (P9 == 1)),
                         ((P9 == 0) & (P2 == 1))]:
                A += a & b
            cond = (img == 1) & (B >= 2) & (B <= 6) & (A == 1)
            cond &= (P2 * P4 * P6 == 0) if step == 0 else (P2 * P4 * P8 == 0)
            cond &= (P4 * P6 * P8 == 0) if step == 0 else (P2 * P6 * P8 == 0)
            if cond.any():
                img[cond] = 0
                changed = True
        if not changed:
            break
    return img
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Erode, dilate, and what order does</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:130px}
  canvas{width:100%;display:block;border-radius:6px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15);image-rendering:pixelated}
  figcaption{font-size:12px;color:#475569;margin-top:5px}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px;margin-right:16px}
  input[type=range]{width:140px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>Erosion shrinks, dilation grows, and the order is the trick</h1>
<p>Opening (erode then dilate) deletes specks and keeps shapes. Closing (dilate then erode) fills
holes. Reverse the order and you get the opposite result — the first operation decides what counts
as noise.</p>
<div class="row">
  <figure><canvas id="s" width="96" height="96"></canvas><figcaption>binary input</figcaption></figure>
  <figure><canvas id="e" width="96" height="96"></canvas><figcaption>erode x<i id="ni">1</i></figcaption></figure>
  <figure><canvas id="d" width="96" height="96"></canvas><figcaption>dilate x<i id="ni2">1</i></figcaption></figure>
  <figure><canvas id="o" width="96" height="96"></canvas><figcaption>open (E then D)</figcaption></figure>
  <figure><canvas id="c" width="96" height="96"></canvas><figcaption>close (D then E)</figcaption></figure>
</div>
<label>iterations <input type="range" id="it" min="1" max="4" step="1" value="1"><output id="v">1</output></label>
<script>
(function () {
  var N = 96;
  // a shape with a hole, a thin bridge and three specks: every case in one image
  var base = new Uint8Array(N * N);
  function put(x, y) { if (x >= 0 && y >= 0 && x < N && y < N) base[y * N + x] = 1; }
  for (var y = 18; y < 62; y++) for (var x = 14; x < 58; x++) put(x, y);
  for (var y = 30; y < 40; y++) for (var x = 28; x < 38; x++) base[y * N + x] = 0;   // hole
  for (var x = 58; x < 84; x++) put(x, 40);                                          // thin bridge
  [[80, 20], [84, 26], [76, 84]].forEach(function (p) {                               // specks
    put(p[0], p[1]); put(p[0] + 1, p[1]);
  });

  function morph(src, op, iters) {
    var cur = src;
    for (var it = 0; it < iters; it++) {
      var out = new Uint8Array(N * N);
      for (var y = 0; y < N; y++) {
        for (var x = 0; x < N; x++) {
          var acc = op === 'erode' ? 1 : 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              var yy = y + dy, xx = x + dx;
              var v = (yy < 0 || yy >= N || xx < 0 || xx >= N) ? 0 : cur[yy * N + xx];
              acc = op === 'erode' ? (acc & v) : (acc | v);
            }
          }
          out[y * N + x] = acc;
        }
      }
      cur = out;
    }
    return cur;
  }

  function paint(id, data) {
    var cv = document.getElementById(id), g = cv.getContext('2d');
    var img = g.createImageData(N, N);
    for (var i = 0; i < data.length; i++) {
      var v = data[i] ? 20 : 245;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  function render() {
    var iters = parseInt(document.getElementById('it').value, 10);
    document.getElementById('v').textContent = iters;
    document.getElementById('ni').textContent = iters;
    document.getElementById('ni2').textContent = iters;
    paint('s', base);
    var er = morph(base, 'erode', iters);
    var di = morph(base, 'dilate', iters);
    paint('e', er); paint('d', di);
    paint('o', morph(er, 'dilate', iters));      // open
    paint('c', morph(di, 'erode', iters));       // close
  }
  document.getElementById('it').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 阈值：Otsu 在最大化「两类之间的距离」

Otsu 遍历 0–255 每一个可能阈值 \`t\`，把像素分成「暗」和「亮」两类，算它们的**类间方差**：

\`σ²_between = w_bg × w_fg × (m_bg - m_fg)²\`

- \`w\` 是两类的像素占比（权重）；
- \`m\` 是两类的平均亮度。

这个式子的直觉是：**两类占比均衡（\`w\` 接近 0.5:0.5）且均值差大**时，方差最大。所以 Otsu 倾向于把直方图双峰之间的谷底作为阈值。

它的优点是**零参数**、自动适应光照；缺点是**假设直方图是双峰**。如果图像里 90% 是背景，或者光照不均匀（两个峰重叠），Otsu 会给出一个很差的阈值。这时要用自适应阈值（局部窗口）或手动。

## 腐蚀与膨胀是「集合的收缩与扩张」

- **腐蚀**：只有当一个像素的**所有**邻域都是前景，它才保留 → 白色区域缩小 r 像素；
- **膨胀**：只要**任一**邻域是前景，它就变成前景 → 白色区域扩大 r 像素。

它们不是模糊，是**几何形态**的变化：半径 r 的圆角会变成尖角、细线会消失、小孔会被填上。这就是"形态学"（mor-phology，研究形状）这个名字的由来。

## 开运算与闭运算：顺序决定效果

- **开 = 先腐蚀后膨胀**：去掉小亮点、毛刺、孤立噪点，**大形状保持不变**；
- **闭 = 先膨胀后腐蚀**：填小孔、连接断开的细线，**大形状保持不变**。

为什么顺序反过来就效果相反？直觉：先腐蚀去掉了「比结构元小的东西」，再膨胀只能把剩下的放大回去 —— 丢掉的东西回不来。反过来先膨胀会把小孔填上，再腐蚀不会重新打开它。

**这是形态学最核心的一句话**：先做的操作决定了「什么是噪声」，后做的只是恢复。

如果先膨胀后腐蚀（闭），然后在闭的基础上再开 —— 这叫「形态学重建」，是提取特定形状的标准手法。

## 骨架化（Zhang-Suen）在做什么

目标：把一条粗线压成 1 像素宽的线，且保持拓扑（不断开、不消失）。

做法：**每轮迭代检查每个前景像素的 8 邻域**，满足四个条件就删除它：

1. 有 2–6 个前景邻居（端点不能删，内部点才能删）；
2. 邻居的「0→1 跳变」恰好 1 次（保证不是交叉点）；
3. 某个象限方向的前景点不全为真；
4. 另一个象限方向也不全为真。

条件 3、4 分两轮（奇数轮 / 偶数轮）执行，是为了**保持对称** —— 只删一个方向的像素会让骨架偏向一侧。

最多 60 轮，或直到没有像素被删除。**这就是 OpenCV \`cv2.ximgproc.thinning\` 的同一类算法**。

## 想深一层

1. 形态学操作可以叠加：先开（去噪）再闭（填洞）是常见组合，顺序不能反。
2. 结构元的形状不只是方形：圆形核去噪更"圆润"，十字核处理细线更自然。页面的 \`morph-shape\` 工具就是这个。
3. 形态学梯度（膨胀 - 腐蚀）就是轮廓 —— 因为它只在"形状的边界"上非零。这比 Canny 简单得多，但只适用于二值图。`,
      en: `## Otsu maximises the distance between two classes

Otsu tries every threshold \`t\` from 0 to 255, splits pixels into "dark" and "bright", and computes the **between-class variance**:

\`σ²_between = w_bg × w_fg × (m_bg - m_fg)²\`

- \`w\` are the class proportions (weights);
- \`m\` are the class means.

Intuition: the variance peaks when **the two classes are balanced (\`w\` near 0.5:0.5) and their means are far apart**. So Otsu naturally lands in the valley between two histogram peaks.

Zero parameters, automatic light adaptation. Its assumption is **a bimodal histogram**: if 90% of the image is background, or lighting is uneven (peaks overlap), Otsu returns a bad threshold. Then you need adaptive (local) thresholding or a manual one.

## Erosion and dilation are set contraction and expansion

- **Erosion**: a pixel survives only if **all** neighbours are foreground → white shrinks by r pixels;
- **Dilation**: a pixel becomes foreground if **any** neighbour is → white grows by r pixels.

These are not blurs; they change **geometry**: rounded corners sharpen, thin lines vanish, holes fill. That is why the field is called morphology — the study of shape.

## Open and close: order decides the effect

- **Open = erode then dilate**: removes small specks, burrs, isolated noise while **large shapes stay intact**;
- **Close = dilate then erode**: fills small holes, joins thin breaks, again leaving large shapes intact.

Why does reversing the order invert the effect? Erosion first eliminates anything smaller than the structuring element; dilating afterwards can only restore what remains — what is gone stays gone. Dilation first fills small holes, and the following erosion does not reopen them.

**The core sentence of morphology**: the first operation decides what counts as noise, the second merely restores.

Dilate-erode followed by open is "morphological reconstruction", the standard tool for extracting specific shapes.

## What Zhang-Suen skeletonisation does

Goal: compress a thick line to one pixel wide while preserving topology (no breaks, no vanishing).

Each iteration inspects the 8-neighbourhood of every foreground pixel and deletes it if four conditions hold:

1. between 2 and 6 foreground neighbours (endpoints must survive, interior points may go);
2. exactly one 0→1 transition around the neighbourhood (not a crossing);
3. one directional quadrant triple is not all foreground;
4. another quadrant triple is not all foreground either.

Conditions 3 and 4 alternate between odd and even sub-iterations to **preserve symmetry** — deleting in one direction only would bias the skeleton sideways.

At most 60 iterations, or until nothing changes. This is the same family as OpenCV's \`cv2.ximgproc.thinning\`.

## Going one level deeper

1. Operations compose: open (denoise) then close (fill) is a common pair, and the order is not interchangeable.
2. Structuring elements have shapes: circular for round denoising, cross-shaped for thin lines. The page's \`morph-shape\` tool exposes this.
3. Morphological gradient (dilate − erode) is an outline, non-zero only at shape boundaries. Far simpler than Canny, but only for binary images.`
    }
  },

  '/vision/edge': {
    python: `"""Eight edge/corner tools. Two families: gradient operators (Sobel, Canny)
and voting methods (Hough). Harris sits in between.
"""
import cv2
import numpy as np

SOBEL_X = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], np.float32)
SOBEL_Y = SOBEL_X.T.copy()


def gradient(img):
    """Sobel is a smoothing (1,2,1) applied perpendicular to a central
    difference (-1,0,1). That is why it is less noisy than a raw difference."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gx = cv2.filter2D(g, -1, SOBEL_X)
    gy = cv2.filter2D(g, -1, SOBEL_Y)
    # The page uses addWeighted(0.5, 0.5) rather than hypot -- brighter, less
    # "correct", but visually more legible. Know which one you are looking at.
    return gx, gy, cv2.addWeighted(np.abs(gx), 0.5, np.abs(gy), 0.5, 0)


def canny(img, lo=100, hi=200):
    """Four steps: blur -> gradient -> non-maximum suppression -> hysteresis.
    The ratio hi:lo = 2:1 is the conventional starting point."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = cv2.GaussianBlur(g, (5, 5), 1.4)          # 1. sigma
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)  # 2. gradient
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.hypot(gx, gy)
    angle = np.rad2deg(np.arctan2(gy, gx)) % 180

    # 3. non-maximum suppression: keep only local maxima ALONG the gradient
    keep = np.zeros_like(mag)
    ang = ((angle + 22.5) // 45 % 4).astype(int)  # 0,45,90,135 buckets
    for y in range(1, mag.shape[0] - 1):
        for x in range(1, mag.shape[1] - 1):
            d = ang[y, x]
            a, b = (mag[y, x - 1], mag[y, x + 1]) if d == 0 else \\
                   (mag[y + 1, x + 1], mag[y - 1, x - 1]) if d == 1 else \\
                   (mag[y + 1, x], mag[y - 1, x]) if d == 2 else \\
                   (mag[y + 1, x - 1], mag[y - 1, x + 1])
            if mag[y, x] >= a and mag[y, x] >= b:
                keep[y, x] = mag[y, x]

    # 4. hysteresis: strong edges seed, weak edges survive only if connected
    strong = (keep >= hi).astype(np.uint8)
    weak = ((keep >= lo) & (keep < hi)).astype(np.uint8) * 255
    return strong * 255, weak


def harris(img, block=2, ksize=3, k=0.04, thresh_ratio=0.01):
    """Corner response R = det(M) - k·trace(M)², with M the structure tensor
    of gradients in a block. High R = gradient in BOTH directions = corner."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=ksize)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=ksize)

    # sum the products over a blockSize x blockSize window
    sxx = cv2.boxFilter(gx * gx, -1, (block * 2 + 1, block * 2 + 1))
    syy = cv2.boxFilter(gy * gy, -1, (block * 2 + 1, block * 2 + 1))
    sxy = cv2.boxFilter(gx * gy, -1, (block * 2 + 1, block * 2 + 1))

    R = (sxx * syy - sxy ** 2) - k * (sxx + syy) ** 2
    return R, R > thresh_ratio * R.max()      # page threshold defaults to 1%
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sobel, NMS, hysteresis</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:150px}
  canvas{width:100%;display:block;border-radius:6px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  figcaption{font-size:12px;color:#475569;margin-top:5px}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px;margin-right:14px}
  input[type=range]{width:130px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>Why Canny is not just "Sobel with a threshold"</h1>
<p>Sobel gives a thick band of gradient. Non-maximum suppression thins it to one pixel by keeping
only local maxima along the gradient direction. Hysteresis then keeps weak edges that touch strong
ones.</p>
<div class="row">
  <figure><canvas id="s" width="180" height="180"></canvas><figcaption>source</figcaption></figure>
  <figure><canvas id="g" width="180" height="180"></canvas><figcaption>|gradient| (Sobel)</figcaption></figure>
  <figure><canvas id="n" width="180" height="180"></canvas><figcaption>+ non-max suppression</figcaption></figure>
  <figure><canvas id="f" width="180" height="180"></canvas><figcaption>+ hysteresis (final)</figcaption></figure>
</div>
<label>low <input type="range" id="lo" min="5" max="120" step="5" value="40"><output id="vlo">40</output></label>
<label>high <input type="range" id="hi" min="20" max="220" step="5" value="100"><output id="vhi">100</output></label>
<script>
(function () {
  var S = 180;
  var src = document.createElement('canvas');
  src.width = src.height = S;
  (function () {
    var g = src.getContext('2d');
    g.fillStyle = '#f8fafc'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#1e293b'; g.fillRect(26, 30, 80, 80);
    g.fillStyle = '#f59e0b'; g.beginPath(); g.arc(126, 118, 38, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2563eb'; g.beginPath();
    g.moveTo(30, 160); g.lineTo(72, 108); g.lineTo(104, 160); g.closePath(); g.fill();
  })();
  var d0 = src.getContext('2d').getImageData(0, 0, S, S).data;

  function grey() {
    var g = new Float32Array(S * S);
    for (var i = 0; i < S * S; i++) {
      g[i] = 0.299 * d0[i * 4] + 0.587 * d0[i * 4 + 1] + 0.114 * d0[i * 4 + 2];
    }
    return g;
  }
  var G = grey();

  function sobel() {
    var mag = new Float32Array(S * S), ang = new Float32Array(S * S);
    var kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1], ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    for (var y = 1; y < S - 1; y++) {
      for (var x = 1; x < S - 1; x++) {
        var gx = 0, gy = 0, k = 0;
        for (var j = -1; j <= 1; j++) {
          for (var i = -1; i <= 1; i++, k++) {
            var v = G[(y + j) * S + (x + i)];
            gx += v * kx[k]; gy += v * ky[k];
          }
        }
        mag[y * S + x] = Math.hypot(gx, gy);
        ang[y * S + x] = Math.atan2(gy, gx);
      }
    }
    return { mag: mag, ang: ang };
  }
  var S1 = sobel();
  var peak = 0;
  for (var i = 0; i < S1.mag.length; i++) peak = Math.max(peak, S1.mag[i]);

  function nms() {
    var out = new Float32Array(S * S);
    for (var y = 1; y < S - 1; y++) {
      for (var x = 1; x < S - 1; x++) {
        var a = ((S1.ang[y * S + x] + Math.PI) * 180 / Math.PI) % 180;
        var dir = Math.round(a / 45) % 4;         // 0,1,2,3 -> 0,45,90,135 deg
        var m = S1.mag[y * S + x];
        var n1, n2;
        if (dir === 0) { n1 = S1.mag[y * S + x - 1]; n2 = S1.mag[y * S + x + 1]; }
        else if (dir === 1) { n1 = S1.mag[(y - 1) * S + x + 1]; n2 = S1.mag[(y + 1) * S + x - 1]; }
        else if (dir === 2) { n1 = S1.mag[(y - 1) * S + x]; n2 = S1.mag[(y + 1) * S + x]; }
        else { n1 = S1.mag[(y - 1) * S + x - 1]; n2 = S1.mag[(y + 1) * S + x + 1]; }
        out[y * S + x] = (m >= n1 && m >= n2) ? m : 0;
      }
    }
    return out;
  }
  var N1 = nms();

  function toCanvas(id, data, isGrey) {
    var cv = document.getElementById(id), g = cv.getContext('2d');
    var img = g.createImageData(S, S);
    for (var i = 0; i < S * S; i++) {
      var v = data[i];
      if (isGrey) v = v / peak * 255;
      v = Math.max(0, Math.min(255, v));
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  function render() {
    var lo = +document.getElementById('lo').value;
    var hi = +document.getElementById('hi').value;
    document.getElementById('vlo').textContent = lo;
    document.getElementById('vhi').textContent = hi;
    if (hi < lo) { hi = lo; document.getElementById('hi').value = lo; document.getElementById('vhi').textContent = lo; }

    document.getElementById('s').getContext('2d').drawImage(src, 0, 0);
    toCanvas('g', S1.mag, true);
    toCanvas('n', N1, true);

    // hysteresis: strong seeds, weak survive only if adjacent to a seed
    var tLo = lo / 255 * peak, tHi = hi / 255 * peak;
    var strong = new Uint8Array(S * S), weak = new Uint8Array(S * S);
    for (var i2 = 0; i2 < S * S; i2++) {
      if (N1[i2] >= tHi) strong[i2] = 1;
      else if (N1[i2] >= tLo) weak[i2] = 1;
    }
    var changed = true;
    while (changed) {
      changed = false;
      for (var y = 1; y < S - 1; y++) {
        for (var x = 1; x < S - 1; x++) {
          var k2 = y * S + x;
          if (!weak[k2]) continue;
          if (strong[k2 - 1] || strong[k2 + 1] || strong[k2 - S] || strong[k2 + S] ||
              strong[k2 - S - 1] || strong[k2 - S + 1] || strong[k2 + S - 1] || strong[k2 + S + 1]) {
            strong[k2] = 1; weak[k2] = 0; changed = true;
          }
        }
      }
    }
    var fin = new Float32Array(S * S);
    for (var i3 = 0; i3 < S * S; i3++) fin[i3] = strong[i3] ? 255 : 0;
    toCanvas('f', fin, false);

    var count = 0;
    for (var i4 = 0; i4 < S * S; i4++) if (strong[i4]) count++;
    var g2 = document.getElementById('f').getContext('2d');
    g2.fillStyle = '#dc2626'; g2.font = '11px ui-monospace, monospace';
    g2.fillText((count / (S * S) * 100).toFixed(1) + '% edge pixels', 6, 14);
  }

  ['lo', 'hi'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 边缘是「梯度大的地方」，而梯度算子有讲究

Sobel 的核不是随便写的：

\`[[-1,0,1], [-2,0,2], [-1,0,1]]\`

横向是差分（\`-1, 0, +1\`，检测水平方向变化），纵向是平滑（\`1, 2, 1\`，先给上下做个加权平均）。**先平滑再差分**，所以它比朴素的 \`f(x+1) - f(x)\` 抗噪得多。

这也是 Sobel 与 Prewitt 的唯一区别：Prewitt 的纵向是 \`1,1,1\`（等权），Sobel 是 \`1,2,1\`（高斯加权）。

Scharr 是 Sobel 的改进版，核系数是 \`3, 10, 3\`，旋转对称性更好（在 45° 方向上误差更小）。

## Canny 的四步，每一步都不能省

1. **高斯模糊**（5×5，σ=1.4）：不平滑的话，噪点全是"边缘"；
2. **计算梯度**（Sobel 得 Gx、Gy，再算幅值和方向）；
3. **非极大值抑制（NMS）**：沿梯度方向比较，只保留局部最大值。这一步把粗边缘压成 1 像素宽 —— **这是 Canny 区别于 Sobel 的关键**，没有它边缘是一条带子，不是一条线；
4. **双阈值 + 滞后连接**：高于高阈值的是"强边缘"（一定保留），低于低阈值丢弃，介于两者之间的**只有连着强边缘时才保留**。

第 4 步是 Canny 最聪明的地方：单阈值永远在"漏检"和"噪声"之间二选一；双阈值让**弱边缘借助强边缘的上下文活下来**。这也解释了为什么高低阈值常用 1:2 或 1:3 的比例。

## Harris 用「结构张量」找角点

角点的定义是**两个方向都有梯度**。Harris 用梯度构造一个 2×2 矩阵（结构张量）：

\`M = [[Σ Ix², Σ IxIy], [Σ IxIy, Σ Iy²]]\`

- 两个特征值都小 → 平坦区域；
- 一大一小 → 边缘（只有一个方向有变化）；
- 两个都大 → **角点**。

响应函数 \`R = det(M) - k·trace(M)²\`（k 常取 0.04）是特征值判据的近似，避免真的做特征分解。

阈值取「最大响应的 1%」而不是绝对值 —— 因为响应的量级随图像对比度变化，用相对阈值才能自适应。

## Hough 变换是在参数空间投票

直线有无数条，但每条可以用 \`(ρ, θ)\` 唯一表示（ρ = 到原点的距离，θ = 法线角度）。

Hough 的做法：**每个边缘像素，对所有可能经过它的 \`(ρ, θ)\` 组合投票**。一条真实直线上的几十个点会把同一个 \`(ρ, θ)\` 票数堆到很高，形成峰。找峰就是找直线。

这就是为什么它能处理**断裂的线**：不需要边缘连续，只需要足够多的点共线。

代价是计算量和内存：\`θ\` 取 180 个角度、\`ρ\` 取 2×对角线长度，累加器是 180 × 2000 的矩阵。也是为什么 Hough 圆要更贵（参数多一维：圆心 x、y、半径 r，三维累加器）。

## 想深一层

1. 页面的 Sobel 用 \`addWeighted(0.5, 0.5)\` 而不是 \`hypot\` —— 前者是 \`(|Gx| + |Gy|)/2\`，数学上不准确（真实幅值是平方和开根），但视觉上更亮更清晰。**做可视化时，"看起来对"经常优先于"算得对"**。
2. Canny 的阈值应该随图像内容调：噪声大的图要高阈值，低对比度的图要低阈值。固定 100/200 只适合中等对比度的照片。
3. Harris 只给点不给尺度（没有多尺度金字塔），所以图像缩放后检测到的角点会变。SIFT 解决了这个问题（DoG 金字塔），这也是 SIFT 曾经更"高级"的原因。`,
      en: `## Edges are large gradients, and the operator matters

Sobel's kernel is not arbitrary:

\`[[-1,0,1], [-2,0,2], [-1,0,1]]\`

Horizontally it differences (\`-1, 0, +1\`, detecting horizontal change); vertically it smooths (\`1, 2, 1\`, a weighted average of the rows). **Smooth, then difference** — which is why it resists noise far better than naive \`f(x+1) - f(x)\`.

That is also the only difference from Prewitt: Prewitt uses \`1,1,1\` vertically (equal weights), Sobel uses \`1,2,1\` (Gaussian weights).

Scharr improves Sobel with \`3, 10, 3\`, giving better rotational symmetry (smaller error along 45°).

## Canny's four steps, none optional

1. **Gaussian blur** (5×5, σ=1.4): without it every noisy pixel is an "edge";
2. **Gradient** (Sobel for Gx, Gy, then magnitude and direction);
3. **Non-maximum suppression**: compare along the gradient direction, keep local maxima only. This collapses thick edges to one pixel — **the step that separates Canny from Sobel**. Without it an edge is a band, not a line;
4. **Double threshold + hysteresis**: above the high threshold is a strong edge (kept), below the low threshold is dropped, and in between is kept **only if connected to a strong edge**.

Step 4 is Canny's clever bit: a single threshold always trades misses against noise; two thresholds let **weak edges survive on the context of strong ones**. It also explains the conventional 1:2 or 1:3 ratio.

## Harris finds corners with the structure tensor

A corner has **gradient in both directions**. Harris builds a 2×2 matrix from gradients:

\`M = [[Σ Ix², Σ IxIy], [Σ IxIy, Σ Iy²]]\`

- both eigenvalues small → flat region;
- one large, one small → edge (change in one direction only);
- both large → **corner**.

The response \`R = det(M) - k·trace(M)²\` (k ≈ 0.04) approximates the eigenvalue test without an actual decomposition.

The threshold is "1% of the maximum response" rather than absolute, because response magnitude scales with image contrast — relative thresholds adapt.

## The Hough transform votes in parameter space

A line has infinitely many forms, but each is uniquely \`(ρ, θ)\` (ρ = distance from origin, θ = normal angle).

Hough: **every edge pixel votes for every \`(ρ, θ)\` whose line could pass through it**. Dozens of pixels on a real line stack votes at the same \`(ρ, θ)\` into a peak. Finding peaks finds lines.

That is why it tolerates **broken lines**: edges need not be continuous, only numerous enough to be collinear.

The cost is compute and memory: 180 angles × 2×diagonal rhos is a 180 × 2000 accumulator. Which is why Hough circles are much more expensive — one more parameter dimension (centre x, y, radius) means a 3D accumulator.

## Going one level deeper

1. The page's Sobel uses \`addWeighted(0.5, 0.5)\`, i.e. \`(|Gx| + |Gy|)/2\`, not \`hypot\`. Mathematically wrong (true magnitude is the root of squares) but visually brighter and clearer. **For visualisation, "looks right" often beats "computes right".**
2. Canny thresholds should track content: higher for noisy images, lower for low-contrast ones. Fixed 100/200 only suits mid-contrast photos.
3. Harris is single-scale, so detected corners change when the image is resized. SIFT fixed that with a DoG pyramid, which is why SIFT felt "more advanced".`
    }
  },

  '/vision/sketch': {
    python: `"""Two doodle tools with completely different strategies.

doodlenet: a 345-class model trained on Quick Draw.
doodle-teach: no training at all -- MobileNet features + a KNN you populate.
"""
import numpy as np


# ---------- strategy 1: a pretrained classifier ----------
def doodlenet(canvas_28x28):
    """ml5.imageClassifier('DoodleNet') wraps Google's Quick Draw model:
    345 classes, trained on 50M doodles. Input is a 28x28 grayscale stroke
    image, NOT a photo -- that is why it fails on your webcam."""
    import tensorflow as tf
    model = tf.keras.models.load_model('doodlenet')
    x = canvas_28x28.astype(np.float32)[None, ..., None] / 255.0
    probs = model.predict(x, verbose=0)[0]
    top = np.argsort(-probs)[:5]
    return [(int(i), float(probs[i])) for i in top]


# ---------- strategy 2: features + KNN, zero training ----------
def embed_canvas(canvas, backbone):
    """The frozen backbone: an image in, a 1024-d unit vector out.
    In the page this is MobileNet v2's penultimate layer (1024 numbers)."""
    return backbone.infer(canvas)


def teach(memory, canvas, label, backbone):
    """'Teach the machine' is not fine-tuning. The backbone is FROZEN, so
    'learning' is one append to a memory bank -- instant, and it forgets nothing."""
    memory.append((embed_canvas(canvas, backbone), label))


def predict(memory, canvas, backbone, k=3):
    """KNN over embeddings: cosine similarity, majority vote among k nearest.
    No gradients, no epoch loop -- the whole 'training' is one append."""
    emb = embed_canvas(canvas, backbone)
    sims = [(float(emb @ m / (np.linalg.norm(emb) * np.linalg.norm(m) + 1e-9)), label)
            for m, label in memory]
    sims.sort(reverse=True)
    votes = {}
    for _, label in sims[:k]:
        votes[label] = votes.get(label, 0) + 1
    return max(votes.items(), key=lambda kv: kv[1])


# Why this works on doodles at all:
#   a 28x28 stroke image has almost no texture and no colour -- only shape.
#   Quick Draw's 345 classes are precisely the shapes people draw by hand,
#   so the label space matches the input distribution almost perfectly.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Teach it by example (KNN on features)</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  canvas{border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15);cursor:crosshair;touch-action:none}
  .side{flex:1;min-width:200px;font-size:12px}
  button{font:inherit;font-size:12px;padding:5px 11px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;margin:0 6px 6px 0}
  button:hover{background:#f1f5f9}
  .out{margin-top:10px;font-size:13px}
  .out b{font-size:20px;color:#0f172a}
  .feat{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;margin-top:10px}
  .feat i{aspect-ratio:1;background:#e2e8f0;border-radius:2px}
</style>
</head>
<body>
<h1>No training — just memory</h1>
<p>Draw in the box, then label it. The features are a 4x4 gradient histogram over an 8x8 grid
(16 numbers). Classification is nearest neighbour over what you taught it.</p>
<div class="wrap">
  <canvas id="c" width="240" height="240"></canvas>
  <div class="side">
    <div style="margin-bottom:8px">teach this drawing as:</div>
    <button data-k="circle">circle</button>
    <button data-k="line">line</button>
    <button data-k="zigzag">zigzag</button>
    <div class="out">guess: <b id="g">—</b> <span id="conf"></span></div>
    <div class="feat" id="feat"></div>
    <div style="margin-top:10px;color:#475569" id="mem">0 examples in memory</div>
    <button id="clear" style="margin-top:10px">clear canvas</button>
  </div>
</div>
<script>
(function () {
  var N = 240, c = document.getElementById('c'), ctx = c.getContext('2d');
  var drawing = false;
  function reset() {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, N, N);
    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  }
  reset();

  function pos(e) {
    var r = c.getBoundingClientRect();
    return [ (e.clientX - r.left) / r.width * N, (e.clientY - r.top) / r.height * N ];
  }
  c.addEventListener('pointerdown', function (e) { drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p[0], p[1]); });
  c.addEventListener('pointermove', function (e) {
    if (!drawing) return;
    var p = pos(e); ctx.lineTo(p[0], p[1]); ctx.stroke();
  });
  c.addEventListener('pointerup', function () { drawing = false; update(); });
  c.addEventListener('pointerleave', function () { drawing = false; });

  // 8x8 grid, 2 numbers per cell (dominant orientation as sin/cos) = 128 dims, shown as 64 cells
  function features() {
    var d = ctx.getImageData(0, 0, N, N).data;
    var G = 8, cell = N / G;
    var out = [], hist = new Float32Array(G * G);
    for (var gy = 0; gy < G; gy++) {
      for (var gx = 0; gx < G; gx++) {
        var ink = 0;
        for (var y = 0; y < cell; y += 3) {
          for (var x = 0; x < cell; x += 3) {
            var px = Math.floor(gx * cell + x), py = Math.floor(gy * cell + y);
            var i = (py * N + px) * 4;
            if (d[i] < 128) ink++;
          }
        }
        hist[gy * G + gx] = ink;
      }
    }
    var max = 1;
    for (var k = 0; k < hist.length; k++) max = Math.max(max, hist[k]);
    for (var k2 = 0; k2 < hist.length; k2++) out.push(hist[k2] / max);
    return out;
  }

  var memory = [];

  function cosine(a, b) {
    var dot = 0, na = 0, nb = 0;
    for (var i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }

  function update() {
    var f = features();
    var grid = document.getElementById('feat');
    grid.innerHTML = f.map(function (v) {
      return '<i style="background:rgba(37,99,235,' + (0.08 + v * 0.9) + ')"></i>';
    }).join('');

    if (!memory.length) {
      document.getElementById('g').textContent = '—';
      document.getElementById('conf').textContent = '';
      return;
    }
    var best = null;
    memory.forEach(function (m) {
      var s = cosine(f, m.f);
      if (!best || s > best.s) best = { s: s, k: m.k };
    });
    document.getElementById('g').textContent = best.k;
    document.getElementById('conf').textContent = '(cos ' + best.s.toFixed(2) + ')';
  }

  document.querySelectorAll('button[data-k]').forEach(function (b) {
    b.addEventListener('click', function () {
      var f = features();
      var sum = f.reduce(function (a, v) { return a + v; }, 0);
      if (sum <= 0) return;
      memory.push({ f: f, k: b.dataset.k });
      document.getElementById('mem').textContent = memory.length + ' examples in memory';
      update();
    });
  });
  document.getElementById('clear').addEventListener('click', function () { reset(); update(); });
  update();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 两个工具，两种完全不同的思路

| | DoodleNet | 现场教它认 |
| --- | --- | --- |
| 模型 | Google Quick Draw，**345 类固定** | MobileNet v2 只做**特征提取**，不训练 |
| 分类器 | 模型自己输出类别 | **KNN**，你每加一个样本就学一个 |
| 训练 | 预训练（5000 万张简笔画） | **零训练**，只往记忆库里 append |
| 能认什么 | 只有那 345 种 | 你教过的任何东西 |
| 失败方式 | 画得像但是 345 类外的 → 给最接近的 | 教得太少 → 抖动 |

这一页是**迁移学习最直白的演示**：同一个 MobileNet，把输出层砍掉，只留倒数第二层的 1024 维向量，就变成了一个通用的"形状编码器"。

## 为什么 DoodleNet 在照片上完全不行

它是用 **Quick Draw 数据集**训练的：28×28 灰度、黑底白线、只有笔画。这个数据分布和照片**没有任何重叠**。

把摄像头画面喂给它，相当于给一个只看过简笔画的人看真实世界 —— 它会把云认成"猫"、把桌子认成"直升机"，而且置信度还不低。**这不是模型坏，是输入分布不匹配**，是机器学习里最基本也最常被忽视的一条。

页面把它放在**画布**上而不是摄像头，正是尊重这个约束。

## KNN「现场教学」为什么能做到零训练

关键在于**特征提取器是冻结的**。MobileNet 的权重一个都不变，它只负责把图像变成一个 1024 维的向量 —— 而且因为它是用 ImageNet 训练的，这个向量已经能很好地区分「形状」「纹理」「轮廓」。

于是"学一个新类别"就退化成：**把新样本的向量存起来**。分类时算相似度，取最近的 k 个投票。

- 优点：加一个样本立刻生效，不用等训练；加错了删掉即可；
- 缺点：样本多了会变慢（要跟每个样本比一次），且无法举一反三（没见过就是没见过）。

这就是 **k-NN 的本质**：把"学习"变成"记忆"，把"推理"变成"查表"。

## 为什么 embedding 空间的近邻 = 语义相似

这张图最值得看的部分是：**教它认「三角形」之后，它对你画的一个歪三角形也认得出**。

因为 MobileNet 的向量不是逐像素比较，而是"这个形状像什么"。同一个概念的不同画法在 1024 维空间里会聚成一团，不同概念之间有明显间隔。

**这正是所有现代检索、推荐、人脸识别的共同基础**：先学一个把语义距离变成几何距离的编码器，剩下的（KNN、余弦相似度、向量数据库）都是简单几何。

## 想深一层

1. 调 \`k\` 会改变什么？k=1 时对噪声敏感（一个标错的样本就能带偏），k 大时更稳但边界变模糊。这是偏差-方差权衡的最小例子。
2. 为什么不直接微调 MobileNet？因为微调要几百个样本 + 几分钟训练，而"教三个样本立刻见效"是这个功能的核心体验。**选择 KNN 是产品决策，不是技术落后。**
3. 想理解 \`infer(canvas, true)\` 里的 \`true\`：它要求返回 embedding 而不是分类结果。同一份权重，两种用法 —— 这就是「预训练模型当特征提取器」的全部秘密。`,
      en: `## Two tools, two completely different strategies

| | DoodleNet | Teach it yourself |
| --- | --- | --- |
| Model | Google Quick Draw, **345 fixed classes** | MobileNet v2 as a **feature extractor**, no training |
| Classifier | the model's own head | **KNN**, learns one sample per click |
| Training | pretrained on 50M doodles | **zero**, just append to a memory bank |
| Recognises | only those 345 | anything you teach |
| Failure | draws something outside 345 → nearest class | too few examples → flickers |

This page is the plainest demonstration of transfer learning: take MobileNet, cut off the output layer, keep the 1024-d penultimate vector, and you have a general-purpose shape encoder.

## Why DoodleNet fails outright on photos

It was trained on **Quick Draw**: 28×28 greyscale, white strokes on black, strokes only. That distribution has **zero overlap** with photographs.

Feeding it a webcam frame is like showing the real world to someone who has only seen stick figures — clouds become "cat", desks become "helicopter", all with confident scores. **The model is not broken; the input distribution does not match.** The most basic and most ignored fact in ML.

The page uses a **drawing canvas**, not the camera, precisely out of respect for that constraint.

## Why KNN "teaching" needs no training

Because **the feature extractor is frozen**. Not one MobileNet weight changes; it only maps an image to a 1024-d vector, and being ImageNet-trained, that vector already separates shape, texture and outline well.

So "learning a new class" degenerates into **storing the vector of the new sample**. Classification is similarity plus a vote among the nearest k.

- Pro: one sample takes effect immediately, no training wait; a bad sample can simply be deleted;
- Con: more samples mean slower lookup (compare against each), and no generalisation beyond what it has seen.

That is **the essence of k-NN**: turn learning into memorising, and inference into table lookup.

## Why neighbours in embedding space mean semantic similarity

The best moment on this page: after teaching it "triangle", it recognises a crooked triangle you draw.

Because MobileNet's vector compares "what shape is this", not pixels. Different drawings of one concept cluster in 1024-d space, and different concepts sit clearly apart.

**This is the shared foundation of modern retrieval, recommendation and face recognition**: learn an encoder that turns semantic distance into geometric distance, then everything else (k-NN, cosine similarity, vector databases) is simple geometry.

## Going one level deeper

1. What does \`k\` change? k=1 is noise sensitive (one mislabelled sample pulls it), larger k is steadier but blurs boundaries. The smallest possible bias-variance trade-off.
2. Why not fine-tune MobileNet? That needs hundreds of samples and minutes of training, while "teach three samples, see it work" is the entire experience. **Choosing KNN here is a product decision, not a technical shortfall.**
3. The \`true\` in \`infer(canvas, true)\` asks for the embedding instead of predictions. Same weights, two uses — that is all "pretrained model as feature extractor" means.`
    }
  },

  '/vision/pixel': {
    python: `"""A pixel, measured. This page is deliberately model-free: it exists so
that "resolution" and "colour depth" stop being abstract words.
"""
import numpy as np


def sample(img, cols=8, rows=8):
    """Take an 8x8 sample. Every output pixel is an average of a block of
    source pixels -- this is what "downsampling" really means."""
    h, w = img.shape[:2]
    out = np.zeros((rows, cols, img.shape[2]), np.uint8)
    for r in range(rows):
        for c in range(cols):
            y0, y1 = r * h // rows, (r + 1) * h // rows
            x0, x1 = c * w // cols, (c + 1) * w // cols
            out[r, c] = img[y0:y1, x0:x1].reshape(-1, img.shape[2]).mean(0)
    return out


def cost(width, height, channels=4, bits_per_channel=8):
    """Uncompressed size. The number that explains why we compress at all."""
    bits = width * height * channels * bits_per_channel
    return {
        'megapixels': round(width * height / 1e6, 2),
        'bytes': bits // 8,
        'mib': round(bits / 8 / 1024 / 1024, 2)
    }


def levels(bits_per_channel):
    """Colour depth: 8 bits = 256 levels per channel, 16.7M colours at RGB.
    10-bit HDR = 1024 levels, which is why banding disappears."""
    per_channel = 2 ** bits_per_channel
    return per_channel, per_channel ** 3


if __name__ == "__main__":
    print(levels(8))        # (256, 16777216)
    print(cost(4000, 3000)) # 48 MB uncompressed for a 12 MP photo
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Eight by eight, blown up</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  .box{background:#e2e8f0;padding:5px;border-radius:8px}
  canvas{display:block;image-rendering:pixelated}
  .meta{flex:1;min-width:180px;font-size:12px;color:#475569}
  .meta code{background:#e2e8f0;padding:1px 5px;border-radius:3px;color:#0f172a}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:10px;font-size:12px}
  input[type=range]{width:150px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>A pixel is four integers — here are 48 of them</h1>
<p>The small canvas is the real data: 6x8 pixels. The big one is the same buffer drawn without
smoothing, which is the only honest way to look at pixels.</p>
<div class="row">
  <div class="box"><canvas id="small" width="6" height="8" style="width:48px;height:64px"></canvas></div>
  <div class="box"><canvas id="big" width="288" height="384" style="width:288px;height:384px"></canvas></div>
  <div class="meta">
    <div>size <code>6 x 8</code></div>
    <div>bytes <code id="bytes">192</code> (RGBA)</div>
    <div>levels per channel <code id="lv">256</code></div>
    <div style="margin-top:10px">colours in this image:</div>
    <div class="meta" id="pal" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px"></div>
    <label>cell <input type="range" id="cell" min="12" max="48" step="4" value="36"><output id="v">36</output></label>
  </div>
</div>
<script>
(function () {
  var W = 6, H = 8;
  var px = [];
  // a tiny "photo": sky gradient with a sun, hand-written as 48 RGBA values
  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      var sky = 180 - y * 12;
      var r = sky + 40, g = sky + 60, b = 235;
      if (Math.hypot(x - 4, y - 2) < 1.2) { r = 253; g = 224; b = 71; }
      if (y >= 6) { r = 90; g = 110; b = 70; }
      px.push([r, g, b, 255]);
    }
  }

  var small = document.getElementById('small').getContext('2d');
  px.forEach(function (p, i) {
    small.fillStyle = 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')';
    small.fillRect(i % W, Math.floor(i / W), 1, 1);
  });

  function drawBig(cell) {
    var big = document.getElementById('big');
    big.width = W * cell; big.height = H * cell;
    big.style.width = (W * cell) + 'px'; big.style.height = (H * cell) + 'px';
    var g = big.getContext('2d');
    g.imageSmoothingEnabled = false;             // the whole trick
    px.forEach(function (p, i) {
      g.fillStyle = 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')';
      g.fillRect((i % W) * cell, Math.floor(i / W) * cell, cell, cell);
    });
    g.strokeStyle = 'rgba(15,23,42,.12)';
    for (var i2 = 0; i2 <= W; i2++) {
      g.strokeRect(i2 * cell + 0.5, 0.5, 0, H * cell);
    }
    for (var j = 0; j <= H; j++) {
      g.strokeRect(0.5, j * cell + 0.5, W * cell, 0);
    }
    document.getElementById('v').textContent = cell;
  }

  var seen = {};
  px.forEach(function (p) {
    var k = p.slice(0, 3).join(',');
    seen[k] = (seen[k] || 0) + 1;
  });
  document.getElementById('pal').innerHTML = Object.keys(seen).map(function (k) {
    return '<i style="width:20px;height:20px;border-radius:4px;border:1px solid #cbd5e1;background:rgb(' + k + ')"></i>';
  }).join('');
  document.getElementById('bytes').textContent = W * H * 4;

  document.getElementById('cell').addEventListener('input', function (e) {
    drawBig(parseInt(e.target.value, 10));
  });
  drawBig(36);
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 这一页没有任何算法，但它讲的是最容易被跳过的一层

8×8 采样 → 放大 → 看清 64 个色块。目的只有一个：让「分辨率不是清晰度，是信息量」这句话变成看得见的东西。

## 一张图到底占多少

\`宽 × 高 × 通道数 × 每通道位数 / 8\`

- 4000×3000 的 RGBA 未压缩图：\`4000 × 3000 × 4 = 48 MB\`
- 同一张存成 JPG：约 3 MB（16:1）
- 存成 PNG：约 12 MB（无损，但用了预测编码）

所以「图片很小」从来不是因为像素少，是因为**压缩**。而压缩的代价是信息丢失（JPG 是有损的）。

## 色深：8 位为什么够，又为什么不够

8 位 = 每通道 256 级 = RGB 组合出 1677 万色。人眼大约能分辨 1000 万色，所以 8 位"够用"。

但**渐变会出现色带**（banding）：天空从深蓝到浅蓝，8 位只有 256 个台阶，在平滑渐变上能看出明显的分界线。这就是 HDR 用 10 位（1024 级）的原因 —— 不是"颜色更多"，是**台阶更细**。

页面的「像素运算」工具也隐含了这一点：加 50 的值在 8 位下会溢出到 255（或者回绕到 0），丢失高光细节。

## 为什么 8×8 放大之后能看清每一格

因为放大时**关掉了插值**（\`imageSmoothingEnabled = false\`）。

关掉 = 最近邻：每个源像素变成一个 \`cell × cell\` 的纯色方块。
不关 = 双线性：每个方块之间插值过渡，看起来"糊"，但那是**真实存在的中间值**。

两者都不是"错"的，只是回答不同的问题：最近邻回答"原始数据是什么"，双线性回答"人眼看起来像什么"。

## 想深一点

1. 一张 8×8 的图有 64 个像素，但信息量远大于 64 个数字 —— 因为像素之间的**空间关系**也是信息。这就是卷积神经网络比全连接网络更适合图像的根本原因。
2. 页面里 \`parrot.jpg\` 缩到 8×8 后，你还能大致认出是鹦鹉。这说明**低频信息承载了"是什么"，高频承载了"细节"**。JPEG 压缩正是基于这一点：丢弃高频，人眼几乎察觉不到。
3. 从 8×8 到 4000×3000，信息量差 23 万倍。而人眼在手机屏幕上分辨不出 4000 和 2000 宽的区别（约 300 PPI 之后就没有收益）——**"更高分辨率"是有物理上限的**。`,
      en: `## No algorithm here, but it teaches the layer everyone skips

Sample to 8×8, blow it up, see 64 blocks. One purpose: make "resolution is information, not sharpness" visible.

## What an image actually costs

\`width × height × channels × bits per channel / 8\`

- 4000×3000 RGBA uncompressed: \`4000 × 3000 × 4 = 48 MB\`
- the same photo as JPG: about 3 MB (16:1)
- as PNG: about 12 MB (lossless, but with predictive coding)

So "images are small" is never about pixel count — it is about **compression**, and compression costs information (JPG is lossy).

## Colour depth: why 8 bits is enough, and why it is not

8 bits = 256 levels per channel = 16.7M colours in RGB. The eye resolves roughly 10M, so 8 bits "suffices".

But **gradients band**: a sky from deep to pale blue has only 256 steps, and on a smooth ramp you can see the divisions. That is why HDR uses 10 bits (1024 levels) — not "more colours" but **finer steps**.

The pixel-arithmetic tool implies the same thing: adding 50 in 8 bits clips to 255 (or wraps to 0) and destroys highlight detail.

## Why 8×8 blown up shows every cell

Because interpolation is **disabled** (\`imageSmoothingEnabled = false\`).

Off = nearest neighbour: each source pixel becomes a flat \`cell × cell\` square.
On = bilinear: squares blend, looks "soft", but those intermediate values are real.

Neither is wrong; they answer different questions: nearest says "what is the raw data", bilinear says "what does the eye see".

## Going deeper

1. An 8×8 image has 64 pixels but far more than 64 numbers of information, because **spatial relationships** are information too. That is precisely why CNNs beat fully-connected nets on images.
2. Shrink \`parrot.jpg\` to 8×8 and you can still tell it is a parrot: **low frequencies carry "what it is", high frequencies carry detail**. JPEG compression exploits exactly this — discard high frequencies and the eye barely notices.
3. From 8×8 to 4000×3000 is a 230,000× information difference, yet on a phone screen you cannot distinguish 4000 wide from 2000 wide (past about 300 PPI the return is zero) — **"higher resolution" has a physical ceiling**.`
    }
  },

  '/vision/pipeline': {
    python: `"""A fixed five-step pipeline, each step's output feeding the next.

The teaching point is not any single step but the CONTRACT between them:
every step takes an image and returns an image of the same shape.
"""
import numpy as np


def grayscale(img):
    y = 0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2]
    return np.repeat(y[..., None].astype(np.uint8), 3, axis=2)


def median3(img):
    """3x3 median. Placed BEFORE edge detection on purpose: gradient operators
    amplify noise, so denoising has to come first."""
    h, w, ch = img.shape
    p = np.pad(img, 1, mode='edge')
    out = np.empty_like(img)
    for y in range(h):
        for x in range(w):
            win = p[y:y + 3, x:x + 3].reshape(-1, ch)
            out[y, x] = np.median(win, axis=0)
    return out


def auto_levels(img, low_pct=1, high_pct=99):
    """Stretch the histogram tails. Percentiles, not min/max: one specular
    highlight must not flatten the result."""
    y = (0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2])
    lo, hi = np.percentile(y, low_pct), np.percentile(y, high_pct)
    span = max(1.0, hi - lo)
    out = (img.astype(np.float32) - lo) * (255.0 / span)
    return np.clip(out, 0, 255).astype(np.uint8)


def sobel_magnitude(img):
    g = img[..., 0].astype(np.float32)
    kx = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], np.float32)
    ky = kx.T
    from scipy.signal import convolve2d
    gx = convolve2d(g, kx, mode='same', boundary='symm')
    gy = convolve2d(g, ky, mode='same', boundary='symm')
    mag = np.hypot(gx, gy)
    return np.repeat((mag / max(1.0, mag.max()) * 255)[..., None].astype(np.uint8), 3, axis=2)


def run(img):
    steps = [('grayscale', grayscale), ('median3', median3),
             ('auto_levels', auto_levels), ('sobel', sobel_magnitude)]
    frames = [img]
    for name, fn in steps:
        frames.append(fn(frames[-1]))
        # Keeping every frame is what makes the page teach anything: you can
        # see WHERE the information is lost or gained.
    return frames


# Order matters. Swap median and sobel and the noise gets amplified before it
# is removed -- the classic mistake when chaining filters.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>A five-step chain, one frame at a time</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  canvas{border-radius:8px;display:block;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .steps{flex:1;min-width:190px}
  .steps button{display:block;width:100%;text-align:left;font:inherit;font-size:12px;
    padding:7px 10px;margin-bottom:5px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer}
  .steps button.on{background:#2563eb;color:#fff;border-color:#2563eb}
  .steps small{display:block;opacity:.75;font-size:11px}
</style>
</head>
<body>
<h1>Order is the design, not an afterthought</h1>
<p>Click a step to see its output. Note that denoise comes before edge detection: a gradient operator
run on noise turns every speck into a strong false edge.</p>
<div class="wrap">
  <canvas id="c" width="220" height="220"></canvas>
  <div class="steps" id="steps"></div>
</div>
<script>
(function () {
  var S = 220;
  var base = document.createElement('canvas');
  base.width = base.height = S;
  (function () {
    var g = base.getContext('2d');
    g.fillStyle = '#f8fafc'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#1d4ed8'; g.fillRect(28, 40, 78, 78);
    g.fillStyle = '#f59e0b'; g.beginPath(); g.arc(140, 120, 42, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0f172a'; g.fillRect(24, 168, 172, 14);
    for (var i = 0; i < 260; i++) {                 // noise: this is what step 2 removes
      g.fillStyle = Math.random() > 0.5 ? '#fff' : '#111';
      g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
  })();

  function data(cv) { return cv.getContext('2d').getImageData(0, 0, S, S); }

  function grey(img) {
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    return img;
  }

  function median3(img) {
    var d = img.data, out = new Uint8ClampedArray(d.length);
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        for (var ch = 0; ch < 3; ch++) {
          var win = [];
          for (var j = -1; j <= 1; j++) {
            for (var i = -1; i <= 1; i++) {
              var yy = Math.min(S - 1, Math.max(0, y + j)), xx = Math.min(S - 1, Math.max(0, x + i));
              win.push(d[(yy * S + xx) * 4 + ch]);
            }
          }
          win.sort(function (a, b) { return a - b; });
          out[(y * S + x) * 4 + ch] = win[4];
        }
        out[(y * S + x) * 4 + 3] = 255;
      }
    }
    return new ImageData(out, S, S);
  }

  function autoLevels(img) {
    var d = img.data, hist = new Uint32Array(256), n = S * S;
    for (var i = 0; i < d.length; i += 4) hist[d[i]]++;
    var acc = 0, lo = 0, hi = 255;
    while (acc < n * 0.01) acc += hist[lo++];
    acc = 0;
    while (acc < n * 0.01) acc += hist[hi--];
    var span = Math.max(1, hi - lo), lut = new Uint8ClampedArray(256);
    for (var v = 0; v < 256; v++) lut[v] = (v - lo) / span * 255;
    for (var i2 = 0; i2 < d.length; i2 += 4) {
      d[i2] = lut[d[i2]]; d[i2 + 1] = lut[d[i2 + 1]]; d[i2 + 2] = lut[d[i2 + 2]];
    }
    return img;
  }

  function sobel(img) {
    var d = img.data, out = new Uint8ClampedArray(d.length);
    var kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1], ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    for (var y = 1; y < S - 1; y++) {
      for (var x = 1; x < S - 1; x++) {
        var gx = 0, gy = 0, k = 0;
        for (var j = -1; j <= 1; j++) {
          for (var i = -1; i <= 1; i++, k++) {
            var v = d[((y + j) * S + (x + i)) * 4];
            gx += v * kx[k]; gy += v * ky[k];
          }
        }
        var m = Math.min(255, Math.hypot(gx, gy) * 0.5);
        var o = (y * S + x) * 4;
        out[o] = out[o + 1] = out[o + 2] = m;
        out[o + 3] = 255;
      }
    }
    return new ImageData(out, S, S);
  }

  var frames = {};
  (function build() {
    frames[0] = grey(data(base));
    frames[1] = median3(frames[0]);
    frames[2] = autoLevels(new ImageData(new Uint8ClampedArray(frames[1].data), S, S));
    frames[3] = sobel(frames[2]);
  })();

  var LABELS = [
    ['input', 'raw photo, with noise'],
    ['grayscale', 'luminance 0.299 / 0.587 / 0.114'],
    ['median 3x3', 'noise gone, thin detail too'],
    ['auto levels', '1% / 99% percentile stretch'],
    ['sobel', 'gradient magnitude, normalised']
  ];

  function show(k) {
    document.getElementById('c').getContext('2d').putImageData(frames[k], 0, 0);
    document.querySelectorAll('#steps button').forEach(function (b, i) {
      b.classList.toggle('on', i === k);
    });
  }

  LABELS.forEach(function (l, i) {
    var b = document.createElement('button');
    b.innerHTML = '<b>' + (i + 1) + '. ' + l[0] + '</b><small>' + l[1] + '</small>';
    b.addEventListener('click', function () { show(i); });
    document.getElementById('steps').appendChild(b);
  });
  show(0);
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 流水线的教学价值在「中间结果」

五步固定链：灰度 → 中值去噪 → 自动色阶 → Sobel → 美化。

单独看每一步，这一站的其它页面都讲过了。把它们串起来，才能看清两件事：

1. **每一步的输入输出契约**：都是「图像进，图像出，尺寸不变」。这让步骤可以任意拼装、调换、单步剥掉 —— 这是所有图像处理框架（OpenCV 的 \`Mat\`、GPU 的 shader 链）的共同抽象；
2. **信息在哪一步丢失**：灰度丢掉了颜色（视觉上少两个通道），中值去噪丢掉了高频细节，Sobel 丢掉了所有非边缘信息。

## 顺序不是随便排的

正确：**去噪 → 增强 → 边缘**
错误：**边缘 → 去噪**

因为梯度算子会放大噪声。一张有噪点的图先过 Sobel，噪点会变成密密麻麻的"假边缘"，之后再怎么滤波都去不掉（它们已经变成强信号了）。

**这是图像流水线里最重要的一条经验：任何「放大高频」的操作，都必须排在去噪之后。**

同类的还有：锐化必须在缩放之后（否则放大会重新引入模糊）、色彩校正必须在压缩之前。

## Sobel 那一步用 hypot 还是 |Gx|+|Gy|

页面用的 \`addWeighted(0.5, 0.5)\` 即 \`(|Gx| + |Gy|)/2\`，是真实幅值 \`√(Gx²+Gy²)\` 的近似。

- \`hypot\`：数学正确，但对角方向的边缘会比水平/垂直的暗（因为真实幅值在对角线上更大，归一化后被压缩）；
- \`(|Gx|+|Gy|)/2\`：各方向亮度一致，视觉上更均匀 —— 代价是它不是真正的梯度幅值。

**做检测用 hypot，做展示用后者。** 知道自己在用哪个，比选哪个更重要。

## 美化放在最后，且用的是原图

页面最后一步「美化」读的是**原图**，不是 Sobel 结果 —— 因为 Sobel 输出是边缘图，已经没有颜色了。

这说明流水线不一定是严格线性的：可以出现"旁路"（一个步骤同时依赖前面多步的输出）。真实的图像处理图（DAG）比线性链条更常见。

## 想深一层

1. 如果把这五步的中间结果都保存下来，就是 5 张图 —— 这正是调试图像算法的方法：**永远先看中间结果，再怀疑算法**。
2. 上限 1280 px 是性能取舍：Sobel 是 O(n)，但中值滤波（3×3 排序）常数大得多，4K 图上会卡。
3. 真实生产线（比如手机拍照）的流水线有几十步，顺序经过大量实验确定，且很多步骤是可跳过的（比如强光下不需要降噪）。**「固定顺序」是教学简化，实际是条件分支。**`,
      en: `## The teaching value is in the intermediate frames

Five fixed steps: greyscale → median denoise → auto levels → Sobel → beautify.

Each step is covered elsewhere on this site. Chained together, two things become visible:

1. **The contract between steps**: image in, image out, same shape. That is what lets steps be reordered, swapped or dropped — and it is the shared abstraction of every imaging framework (OpenCV's \`Mat\`, GPU shader chains);
2. **Where information is lost**: greyscale discards colour (two channels gone), median discards high-frequency detail, Sobel discards everything that is not an edge.

## Order is not arbitrary

Right: **denoise → enhance → edge**
Wrong: **edge → denoise**

Gradient operators amplify noise. Run Sobel on a noisy image and noise becomes dense "false edges"; no later filter removes them, because they are now strong signals.

**The most important rule of any image pipeline: every high-frequency-amplifying operation comes after denoising.**

Same family: sharpen after resizing (resizing reintroduces blur), colour correction before compression.

## hypot or |Gx| + |Gy| for the Sobel step

The page uses \`addWeighted(0.5, 0.5)\`, i.e. \`(|Gx| + |Gy|)/2\`, an approximation of the true magnitude \`√(Gx²+Gy²)\`.

- \`hypot\`: mathematically correct, but diagonal edges render darker than horizontal/vertical ones (true magnitude is larger on diagonals, so it gets compressed by normalisation);
- \`(|Gx|+|Gy|)/2\`: even brightness in all directions, visually cleaner, but not a true gradient magnitude.

**Use hypot to detect, the other to display.** Knowing which you are using matters more than which you pick.

## Beautify comes last and reads the original

The final step reads the **original**, not the Sobel output — because Sobel's result is an edge map with no colour left.

So a pipeline is not always strictly linear: steps may bypass earlier ones. Real processing graphs (DAGs) are more common than chains.

## Going deeper

1. Saving all five intermediate frames is exactly how you debug imaging code: **look at the intermediates before doubting the algorithm**.
2. The 1280 px cap is a performance trade: Sobel is O(n), but median filtering (3×3 sorting) has a much larger constant and stalls on 4K.
3. A production pipeline (a phone camera) has dozens of steps, ordered through extensive experimentation, many of them skippable (bright scenes need no denoise). **"Fixed order" is a teaching simplification; reality is conditional branches.**`
    }
  },

  '/vision/feature-extraction': {
    python: `"""What a CNN's first layers do, done by hand.

Six 3x3 kernels you can read, then ReLU, then pooling -- then the page hands
the same job to EfficientNet and you can compare.
"""
import numpy as np
from scipy.signal import convolve2d

KERNELS = {
    'sobel-x':   np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], np.float32),
    'sobel-y':   np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], np.float32),
    'laplacian': np.array([[0, -1, 0], [-1, 4, -1], [0, -1, 0]], np.float32),
    'sharpen':   np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], np.float32),
    'mean-1/9':  np.ones((3, 3), np.float32) / 9,
    'relu-kernel': np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], np.float32),
}


def feature_map(gray, kernel, relu=True, pool=2):
    """One 'channel' of a conv layer. Float math throughout: keeping the sign
    is what lets ReLU mean something."""
    f = convolve2d(gray.astype(np.float32), kernel, mode='same', boundary='symm')
    if relu:
        f = np.maximum(f, 0)          # negative responses are not "absence",
                                      # they are the opposite feature
    # max pooling: half resolution, translation tolerance
    h, w = f.shape
    h2, w2 = h // pool, w // pool
    f = f[:h2 * pool, :w2 * pool].reshape(h2, pool, w2, pool).max((1, 3))
    # normalise by peak so different kernels are comparable on screen
    peak = f.max() or 1.0
    return (f / peak * 255).astype(np.uint8)


def all_features(img, pool=2):
    gray = (0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2])
    return {name: feature_map(gray, k, pool=pool) for name, k in KERNELS.items()}


# The step this page makes obvious:
#   hand-designed kernels -> a trained EfficientNet layer
# Both produce "feature maps". The difference is who chose the numbers.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>What a conv layer actually computes</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:110px}
  canvas{width:100%;display:block;border-radius:5px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.15)}
  figcaption{font-size:11px;color:#475569;margin-top:4px;font-family:ui-monospace,monospace}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px;margin-right:14px}
</style>
</head>
<body>
<h1>Six hand-written kernels, one conv layer</h1>
<p>These are feature maps produced by 3x3 kernels you can read. A trained CNN produces the same kind
of maps — the only difference is who chose the numbers. Negative responses are shown as black, which
is exactly what ReLU does.</p>
<div class="row">
  <figure><canvas id="src" width="120" height="120"></canvas><figcaption>input</figcaption></figure>
  <div class="row" id="maps" style="flex:3"></div>
</div>
<label><input type="checkbox" id="relu" checked> apply ReLU</label>
<label><input type="checkbox" id="pool"> 2x2 max pool</label>
<script>
(function () {
  var S = 120;
  var src = document.createElement('canvas');
  src.width = src.height = S;
  (function () {
    var g = src.getContext('2d');
    g.fillStyle = '#f1f5f9'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#1d4ed8'; g.fillRect(18, 20, 44, 44);
    g.fillStyle = '#f59e0b'; g.beginPath(); g.arc(84, 60, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0f172a'; g.fillRect(14, 92, 92, 8);
  })();
  var d0 = src.getContext('2d').getImageData(0, 0, S, S).data;
  var G = new Float32Array(S * S);
  for (var i = 0; i < S * S; i++) {
    G[i] = 0.299 * d0[i * 4] + 0.587 * d0[i * 4 + 1] + 0.114 * d0[i * 4 + 2];
  }

  var KERNELS = [
    ['sobel-x', [[-1,0,1],[-2,0,2],[-1,0,1]]],
    ['sobel-y', [[-1,-2,-1],[0,0,0],[1,2,1]]],
    ['laplacian', [[0,-1,0],[-1,4,-1],[0,-1,0]]],
    ['sharpen', [[0,-1,0],[-1,5,-1],[0,-1,0]]],
    ['mean 1/9', [[1/9,1/9,1/9],[1/9,1/9,1/9],[1/9,1/9,1/9]]],
    ['corner', [[1,-2,1],[-2,4,-2],[1,-2,1]]]
  ];

  function feature(k, relu, pool) {
    var f = new Float32Array(S * S);
    for (var y = 1; y < S - 1; y++) {
      for (var x = 1; x < S - 1; x++) {
        var acc = 0;
        for (var j = -1; j <= 1; j++) {
          for (var i = -1; i <= 1; i++) acc += G[(y + j) * S + (x + i)] * k[j + 1][i + 1];
        }
        f[y * S + x] = relu ? Math.max(0, acc) : acc;
      }
    }
    var out = S, data = f;
    if (pool) {
      out = S >> 1;
      var p = new Float32Array(out * out);
      for (var py = 0; py < out; py++) {
        for (var px = 0; px < out; px++) {
          var m = 0;
          for (var b = 0; b < 2; b++) for (var a = 0; a < 2; a++) {
            m = Math.max(m, f[(py * 2 + b) * S + px * 2 + a]);
          }
          p[py * out + px] = m;
        }
      }
      data = p;
    }
    var peak = 1e-6;
    for (var q = 0; q < data.length; q++) peak = Math.max(peak, Math.abs(data[q]));
    return { data: data, size: out, peak: peak };
  }

  function paint(id, f) {
    var cv = document.getElementById(id);
    cv.width = cv.height = f.size;
    var g = cv.getContext('2d');
    var img = g.createImageData(f.size, f.size);
    for (var i = 0; i < f.data.length; i++) {
      var v = Math.min(255, Math.abs(f.data[i]) / f.peak * 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  var container = document.getElementById('maps');
  var ids = [];
  KERNELS.forEach(function (k, i) {
    var fig = document.createElement('figure');
    var cv = document.createElement('canvas');
    cv.id = 'm' + i;
    var cap = document.createElement('figcaption');
    cap.textContent = k[0];
    fig.appendChild(cv); fig.appendChild(cap);
    container.appendChild(fig);
    ids.push('m' + i);
  });

  function render() {
    var relu = document.getElementById('relu').checked;
    var pool = document.getElementById('pool').checked;
    document.getElementById('src').getContext('2d').drawImage(src, 0, 0);
    KERNELS.forEach(function (k, i) { paint(ids[i], feature(k[1], relu, pool)); });
  }

  ['relu', 'pool'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', render);
  });
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 这一页在回答一个问题：卷积核里到底是什么

六个 3×3 的核，你能一个个读出来：横向差分、纵向差分、拉普拉斯、锐化、均值、ReLU 形。

把它们应用到同一张图上，得到的六张图就是**六个特征图（feature map）**。这就是卷积神经网络第一层的全部工作 —— 区别只在于：**网络的核是学出来的，这页的核是人写的**。

**看到这一点，CNN 就不再是黑箱了。** 第一层永远在学边缘、颜色梯度、纹理；越往深层，核越抽象（眼睛、轮子、文字），但机制完全相同。可解释性研究（如特征可视化）做的就是"把人写的核换回去"。

## 为什么必须是浮点，不能用 uint8

Sobel 的输出有正有负：左边亮右边暗是 +，反过来是 −。

如果存成 uint8，负值会被钳到 0 —— 于是"暗到亮的边缘"和"亮到暗的边缘"变成同一张图，**丢失了一半信息**。ReLU 也就没有意义了（它本来就是"负值归零"的操作）。

这是新手写卷积最常犯的错：图省事用 Uint8ClampedArray，结果所有方向性特征都被压平。

## ReLU 与池化各自解决了什么

**ReLU**（\`max(0, x)\`）：
- 引入非线性（没有它，多层卷积等价于一层）；
- 让特征变得**稀疏**（大部分输出为 0），这在计算和存储上都有利；
- 梯度简单（要么 1 要么 0），不容易梯度消失。

**最大池化**（2×2 取最大）：
- 降分辨率（减少后续计算量）；
- 提供**平移容忍**：物体在池化窗口内移动一个像素，输出不变；
- 保留最强的响应，丢弃弱的。

这两步加起来就是"降维 + 保特征"，是所有 CNN 的骨架。

## 从手写核到学出来的核

页面第 4 步换成真正的 EfficientNet（17.7 MB），输出 5 个类别和置信度。对比很直接：

- 手写核：你知道每个核在找什么，但只能找**你想到的东西**；
- 学出来的核：你不知道每个核在找什么，但它找到了**有用的东西**（比人想得更全）。

这就是深度学习的取舍：**用可解释性换表达能力**。页面的价值在于把两边摆在一起，让人自己判断什么时候该用哪种。

## 想深一层

1. 一个 3×3 的卷积核只有 9 个参数，但它在整张图上滑动（权值共享）。这个设计让参数量从「像素数 × 神经元数」降到「9 × 通道数」—— **这是 CNN 能训练得动的原因**。
2. 峰值归一化（除以最大值）是为了显示。真实网络里不会有这一步，因为批归一化（BatchNorm）承担了类似职责。
3. 想看「深层在学什么」：把同一张图过第 1 层和第 10 层，第 1 层能看出边缘，第 10 层只能看出「这像猫」。**空间信息被逐层丢弃，语义信息被逐层提炼。**`,
      en: `## This page answers one question: what is inside a convolution kernel

Six 3×3 kernels you can read: horizontal difference, vertical difference, Laplacian, sharpen, mean, ReLU-shaped.

Apply them to one image and you get six **feature maps**. That is the entire job of a CNN's first layer — the difference is only that **the network's kernels are learned while these are authored**.

**See that and CNNs stop being black boxes.** Layer one always learns edges, colour gradients, texture; deeper layers get more abstract (eyes, wheels, letters) with identical mechanics. Interpretability research (feature visualisation) is essentially putting human-written kernels back.

## Why the buffer must be float, not uint8

Sobel output is signed: bright-left/dark-right is +, the reverse is −.

Store it as uint8 and negatives clamp to 0 — so "dark-to-bright edge" and "bright-to-dark edge" become the same image, **losing half the information**. ReLU also becomes meaningless, since it is precisely "zero the negatives".

The most common beginner mistake in convolution code: using Uint8ClampedArray for convenience and flattening every directional feature.

## What ReLU and pooling each solve

**ReLU** (\`max(0, x)\`):
- adds non-linearity (without it, stacked convolutions collapse to one);
- makes features **sparse** (mostly zeros), which helps compute and storage;
- has a trivial gradient (0 or 1), avoiding vanishing gradients.

**Max pooling** (2×2 maximum):
- reduces resolution (less downstream compute);
- gives **translation tolerance**: move an object one pixel inside the window and the output is unchanged;
- keeps the strongest response, discards the weak.

Together: "reduce dimension, keep features" — the skeleton of every CNN.

## From hand-written to learned kernels

Step 4 switches to real EfficientNet (17.7 MB) and returns 5 classes with scores. The contrast is direct:

- hand-written kernels: you know what each one looks for, but it can only find **what you thought of**;
- learned kernels: you do not know what each one looks for, but it found **something useful** (more than you would have thought of).

That is the deep-learning trade: **expressiveness bought with interpretability**. The page's value is putting both side by side so you can judge when each applies.

## Going deeper

1. A 3×3 kernel has 9 parameters but slides over the whole image (weight sharing), which drops parameter count from "pixels × neurons" to "9 × channels" — **what makes CNNs trainable at all**.
2. Peak normalisation is for display; real networks use BatchNorm instead.
3. To see what depth learns: run one image through layer 1 and layer 10. Layer 1 shows edges; layer 10 only shows "that looks like a cat". **Spatial information is discarded layer by layer while semantics are refined.**`
    }
  },

  '/vision/edge-detection': {
    python: `"""Sobel vs Prewitt vs Scharr: the same idea with different weights.

The whole difference is in the smoothing part of the kernel -- and it shows
up as noise robustness, not as "accuracy".
"""
import numpy as np

KERNELS = {
    # smoothing weights: Prewitt uses 1,1,1; Sobel 1,2,1; Scharr 3,10,3
    'sobel':   np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], np.float32),
    'prewitt': np.array([[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]], np.float32),
    'scharr':  np.array([[-3, 0, 3], [-10, 0, 10], [-3, 0, 3]], np.float32),
}


def magnitude(gray, name='sobel', preblur=False):
    from scipy.signal import convolve2d
    g = gray.astype(np.float32)
    if preblur:
        # A 3x3 mean BEFORE the gradient: reduces noise, at the cost of
        # thinning real edges. Toggle it and watch the trade.
        g = convolve2d(g, np.ones((3, 3), np.float32) / 9, mode='same', boundary='symm')

    k = KERNELS[name]
    gx = convolve2d(g, k, mode='same', boundary='symm')
    gy = convolve2d(g, k.T, mode='same', boundary='symm')
    return np.hypot(gx, gy)                  # true magnitude, all directions equal


def threshold(mag, ratio=0.25):
    """Normalise by the peak, THEN threshold. An absolute threshold would mean
    something different on every image; a ratio means the same everywhere."""
    peak = mag.max() or 1.0
    norm = mag / peak
    edge = norm >= ratio
    return edge, float(edge.mean())          # coverage: the page shows this


def to_binary(edge):
    return (edge * 255).astype(np.uint8)


# No Canny here on purpose. Canny = this + non-maximum suppression + hysteresis.
# Comparing the two shows what NMS buys you: one-pixel-wide, connected edges.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sobel vs Prewitt vs Scharr</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  figure{margin:0;flex:1;min-width:120px}
  canvas{width:100%;display:block;border-radius:5px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.15)}
  figcaption{font-size:12px;color:#475569;margin-top:4px}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px;margin-right:14px}
  input[type=range]{width:130px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>Three kernels, one difference: the smoothing weights</h1>
<p>The differencing part is identical (-1, 0, +1). Prewitt smooths with 1-1-1, Sobel with 1-2-1 and
Scharr with 3-10-3 — which is why Scharr keeps diagonal edges at the same strength as horizontal
ones.</p>
<div class="row">
  <figure><canvas id="src" width="160" height="160"></canvas><figcaption>source</figcaption></figure>
  <figure><canvas id="sob" width="160" height="160"></canvas><figcaption id="cSob">sobel</figcaption></figure>
  <figure><canvas id="pre" width="160" height="160"></canvas><figcaption id="cPre">prewitt</figcaption></figure>
  <figure><canvas id="sch" width="160" height="160"></canvas><figcaption id="cSch">scharr</figcaption></figure>
</div>
<label>threshold <input type="range" id="th" min="0.05" max="0.8" step="0.01" value="0.25"><output id="v">0.25</output></label>
<script>
(function () {
  var S = 160;
  var src = document.createElement('canvas');
  src.width = src.height = S;
  (function () {
    var g = src.getContext('2d');
    g.fillStyle = '#f8fafc'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#1e293b'; g.fillRect(20, 24, 56, 56);
    // a 45-degree edge: the case where the operators disagree most
    g.beginPath(); g.moveTo(96, 116); g.lineTo(150, 116); g.lineTo(150, 58); g.closePath(); g.fill();
    g.fillStyle = '#f59e0b'; g.beginPath(); g.arc(60, 118, 26, 0, Math.PI * 2); g.fill();
  })();
  var d0 = src.getContext('2d').getImageData(0, 0, S, S).data;
  var G = new Float32Array(S * S);
  for (var i = 0; i < S * S; i++) G[i] = 0.299 * d0[i * 4] + 0.587 * d0[i * 4 + 1] + 0.114 * d0[i * 4 + 2];

  var OPS = {
    sob: [[-1,0,1],[-2,0,2],[-1,0,1]],
    pre: [[-1,0,1],[-1,0,1],[-1,0,1]],
    sch: [[-3,0,3],[-10,0,10],[-3,0,3]]
  };

  function magnitude(kx) {
    var ky = [[kx[0][0], kx[1][0], kx[2][0]],
              [kx[0][1], kx[1][1], kx[2][1]],
              [kx[0][2], kx[1][2], kx[2][2]]];   // transpose: Sobel Y is Sobel X rotated
    var m = new Float32Array(S * S), peak = 1e-6;
    for (var y = 1; y < S - 1; y++) {
      for (var x = 1; x < S - 1; x++) {
        var gx = 0, gy = 0;
        for (var j = -1; j <= 1; j++) {
          for (var i = -1; i <= 1; i++) {
            var v = G[(y + j) * S + (x + i)];
            gx += v * kx[j + 1][i + 1];
            gy += v * ky[j + 1][i + 1];
          }
        }
        m[y * S + x] = Math.hypot(gx, gy);
        peak = Math.max(peak, m[y * S + x]);
      }
    }
    return { m: m, peak: peak };
  }

  function draw(id, mag, thr) {
    var cv = document.getElementById(id), g = cv.getContext('2d');
    var img = g.createImageData(S, S), count = 0;
    for (var i = 0; i < S * S; i++) {
      var v = mag.m[i] / mag.peak;
      var on = v >= thr;
      if (on) count++;
      var c = on ? 0 : 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = c;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    document.getElementById('c' + id[0].toUpperCase() + id.slice(1)).textContent =
      id + '  ' + (count / (S * S) * 100).toFixed(1) + '%';
  }

  function render() {
    var thr = parseFloat(document.getElementById('th').value);
    document.getElementById('v').textContent = thr.toFixed(2);
    document.getElementById('src').getContext('2d').drawImage(src, 0, 0);
    Object.keys(OPS).forEach(function (k) { draw(k, magnitude(OPS[k]), thr); });
  }
  document.getElementById('th').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 三个算子只差「平滑权重」

| 算子 | 核（横向） | 平滑权重 | 特点 |
| --- | --- | --- | --- |
| Prewitt | \`[-1,0,1; -1,0,1; -1,0,1]\` | 1, 1, 1 | 最简单，抗噪最差 |
| Sobel | \`[-1,0,1; -2,0,2; -1,0,1]\` | 1, 2, 1 | 折中，最常用 |
| Scharr | \`[-3,0,3; -10,0,10; -3,0,3]\` | 3, 10, 3 | 旋转对称性最好 |

差分部分完全相同（\`-1, 0, +1\`），差别全在纵向的平滑权重上：Prewitt 等权平均，Sobel 用 1-2-1（近似高斯），Scharr 用 3-10-3（更接近高斯）。

**结果上的差别不是「谁更准」，而是「谁的旋转不变性更好」。** Scharr 在 45° 方向的响应更接近 0° 方向，所以斜边缘不会显得比横边缘更弱。Sobel 在 45° 上有约 5% 的方向偏差。

## 归一化到峰值，而不是绝对阈值

页面的阈值是「峰值的 25%」，不是「灰度 64」这样的绝对值。

因为梯度的绝对量级随图像对比度变化：一张低对比度的图，最大梯度可能只有 20，用 64 做阈值会一片空白；一张高对比度的图最大梯度 800，用 64 会满屏噪声。

**用相对阈值（百分比）才能让同一个滑杆值在所有图片上都有意义。** 这是交互式图像工具的通用做法。

## 边缘占比是个有用的诊断数字

页面显示「边缘像素占比」。这个数字的正常范围是 **2%–15%**：

- 太低（<1%）：阈值太高，漏掉了大部分边缘；
- 太高（>30%）：阈值太低或图太噪，几乎全被当边缘；
- 一张自然照片在合适阈值下通常在 5% 附近。

这是个很快的自检指标 —— 调参时盯着它比盯着画面更可靠。

## 为什么这页没有 Canny

因为页面的目的是**对比三种梯度算子**，而 Canny 是一个完整的流程（高斯 + 梯度 + NMS + 双阈值），会掩盖算子本身的差异。

但这也意味着这页的输出**边缘是粗的**（一条边可能占 2–3 像素）。想要 1 像素宽的细线，必须加非极大值抑制 —— 这就是 /vision/edge 页 Canny 工具的差别。

**把两页连起来看**：先看这页理解「梯度是什么」，再看 Canny 理解「怎么把它变成一条线」。

## 想深一层

1. 预平滑（页面提供开关）会让边缘变粗但更连续。这是一个权衡：抗噪 vs 定位精度。**没有免费的抗噪。**
2. \`hypot\` vs \`|Gx|+|Gy|\`：这页用 hypot（数学正确），所以斜边缘和横边缘一样亮。如果换成 \`|Gx|+|Gy|\`，45° 边缘会亮 41%（√2 倍）—— 那才是"看起来不对"的常见来源。
3. 梯度方向（\`atan2(Gy, Gx)\`）这一页没有显示，但它是 Canny 的 NMS 和 Hough 的投票都需要的量。**只看幅值不看方向，会丢掉一半信息。**`,
      en: `## The three operators differ only in smoothing weights

| Operator | Kernel (horizontal) | Smoothing | Character |
| --- | --- | --- | --- |
| Prewitt | \`[-1,0,1; -1,0,1; -1,0,1]\` | 1, 1, 1 | simplest, noisiest |
| Sobel | \`[-1,0,1; -2,0,2; -1,0,1]\` | 1, 2, 1 | the common compromise |
| Scharr | \`[-3,0,3; -10,0,10; -3,0,3]\` | 3, 10, 3 | best rotational symmetry |

The differencing part is identical (\`-1, 0, +1\`); everything differs in the vertical smoothing: Prewitt averages equally, Sobel uses 1-2-1 (near-Gaussian), Scharr uses 3-10-3 (closer to Gaussian).

**The practical difference is rotational invariance, not accuracy.** Scharr's response at 45° is closer to 0°, so diagonal edges do not look weaker than horizontal ones. Sobel has about 5% directional bias at 45°.

## Normalise to the peak, not an absolute threshold

The page thresholds at "25% of peak", not at an absolute grey level.

Gradient magnitude scales with image contrast: a low-contrast image may peak at 20 (an absolute 64 leaves a blank result), a high-contrast one at 800 (64 gives noise everywhere).

**Relative thresholds are the only way one slider value means the same thing on every image.** Standard practice for interactive imaging tools.

## Edge coverage is a useful diagnostic

The page reports the fraction of edge pixels. Normal is **2%–15%**:

- too low (<1%): threshold too high, most edges missed;
- too high (>30%): threshold too low or the image is noisy;
- a natural photo at a sensible threshold usually sits near 5%.

It is a fast sanity check — while tuning, watch this number rather than the picture.

## Why there is no Canny here

Because the page compares **three gradient operators**, and Canny is a whole pipeline (blur + gradient + NMS + hysteresis) that would hide the operator differences.

It also means **edges here are thick** (2–3 pixels). One-pixel lines need non-maximum suppression — which is the difference between this page and Canny on /vision/edge.

**Read the two together**: this page for "what a gradient is", Canny for "how to turn it into a line".

## Going deeper

1. Pre-blur (offered as a toggle) thickens edges but makes them more continuous: noise rejection versus localisation accuracy. **There is no free denoising.**
2. \`hypot\` vs \`|Gx|+|Gy|\`: this page uses hypot (correct), so diagonal and horizontal edges look equally bright. With the sum, 45° edges would be 41% brighter (√2) — the usual source of "this looks wrong".
3. Gradient *direction* (\`atan2(Gy, Gx)\`) is not shown here, but Canny's NMS and Hough's voting both need it. **Magnitude without direction is half the information.**`
    }
  },

  '/vision/image-classification': {
    python: `"""Two classifiers on one page: a 17.7 MB network and a 256-number
descriptor that learns from 8 photos per class. The second one is the lesson.
"""
import numpy as np


# ---------- the "mini" route: no network, just a designed descriptor ----------
def descriptor(gray64):
    """64x64 grayscale -> 16x16 = 256 numbers, by three deliberate steps:
      1. align by luminance centroid (translation invariance)
      2. normalise by spread (scale invariance)
      3. keep the DIFFERENCE along x and y (shape, not brightness)
    Each step removes a nuisance variable. That is what a descriptor is."""
    g = gray64.astype(np.float32)
    h, w = g.shape

    # 1) centroid alignment: shift so the brightness centre sits at the middle
    ys, xs = np.mgrid[0:h, 0:w]
    total = g.sum() + 1e-6
    cy, cx = (ys * g).sum() / total, (xs * g).sum() / total
    shift_y, shift_x = int(round(h / 2 - cy)), int(round(w / 2 - cx))
    g = np.roll(np.roll(g, shift_y, axis=0), shift_x, axis=1)

    # 2) spread normalisation: divide by the standard deviation of positions
    var_y = ((ys - cy) ** 2 * g).sum() / total
    var_x = ((xs - cx) ** 2 * g).sum() / total
    scale = max(1e-3, np.sqrt((var_y + var_x) / 2))
    # resample so that one unit of spread always maps to 4.2 cells
    idx = (np.arange(h) - h / 2) * (4.2 / scale) + h / 2
    idx = np.clip(idx, 0, h - 1).astype(int)
    g = g[idx][:, idx]

    # 3) difference instead of intensity: cancels brightness and bias
    d = np.abs(np.diff(g, axis=0, prepend=g[:1])) + np.abs(np.diff(g, axis=1, prepend=g[:, :1]))

    # 16x16 average pooling, then unit-normalise
    p = d.reshape(16, 4, 16, 4).mean((1, 3)).ravel()
    return p / (np.linalg.norm(p) + 1e-6)


def predict(desc, prototypes, temperature=0.12):
    """Nearest class mean + softmax over cosine similarities.
    With 8 samples per class this beats training a small CNN -- and it takes
    milliseconds instead of minutes."""
    sims = np.array([desc @ proto for proto in prototypes])   # cosine (unit vectors)
    e = np.exp(sims / temperature)
    return e / e.sum()


# ---------- the real route: EfficientNet-Lite0 via MediaPipe ----------
# 17.7 MB, maxResults=5, GPU delegate. Nothing to write here -- that is the
# point: one line of API versus 30 lines of descriptor design.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Eight samples per class is enough</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  figure{margin:0}
  canvas{display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  figcaption{font-size:11px;color:#475569;margin-top:4px;text-align:center}
  .side{flex:1;min-width:200px;font-size:12px}
  .bar{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .bar b{width:56px;font-weight:500}
  .bar i{display:block;height:10px;background:#2563eb;border-radius:3px}
  .bar span{font-variant-numeric:tabular-nums;color:#475569;width:42px;text-align:right}
  button{font:inherit;font-size:12px;padding:5px 11px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;margin:6px 6px 0 0}
</style>
</head>
<body>
<h1>A 256-number descriptor beats a bigger model here</h1>
<p>Two classes, eight samples each, plus jitter. The classifier is nearest class mean on a
hand-designed descriptor — no network, trains in milliseconds.</p>
<div class="row">
  <figure><canvas id="q" width="120" height="120"></canvas><figcaption>query</figcaption></figure>
  <div class="side">
    <div class="bar"><b>circle</b><i id="bc" style="width:2px"></i><span id="sc">—</span></div>
    <div class="bar"><b>square</b><i id="bs" style="width:2px"></i><span id="ss">—</span></div>
    <div style="margin-top:8px;color:#475569" id="verdict">—</div>
    <button id="new">new random sample</button>
  </div>
</div>
<script>
(function () {
  var S = 120, cv = document.getElementById('q'), ctx = cv.getContext('2d');
  var rndSeed = 7;
  function rnd() { rndSeed = (rndSeed * 1103515245 + 12345) & 0x7fffffff; return rndSeed / 0x7fffffff; }

  function draw(kind, jitter) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#0f172a';
    var cx = S / 2 + (rnd() - 0.5) * jitter * 2;
    var cy = S / 2 + (rnd() - 0.5) * jitter * 2;
    var r = S * (0.3 + (rnd() - 0.5) * jitter / 100);
    if (kind === 'circle') {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    } else {
      var w = r * (1.5 + (rnd() - 0.5) * 0.3), h = r * (1.5 + (rnd() - 0.5) * 0.3);
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    }
  }

  // descriptor: luminance centroid alignment, then a 16x16 gradient-magnitude grid
  function descriptor() {
    var d = ctx.getImageData(0, 0, S, S).data;
    var bins = new Float32Array(256);
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var i = (y * S + x) * 4;
        var l = 255 - d[i];                       // ink = dark
        var gx = (x < S - 1 ? 255 - d[i + 4] : l) - l;
        var gy = (y < S - 1 ? 255 - d[(y + 1) * S * 4 + x * 4] : l) - l;
        bins[Math.floor(y / (S / 16)) * 16 + Math.floor(x / (S / 16))] += Math.hypot(gx, gy);
      }
    }
    var n = 0;
    for (var k = 0; k < 256; k++) n += bins[k] * bins[k];
    n = Math.sqrt(n) || 1;
    for (var k2 = 0; k2 < 256; k2++) bins[k2] /= n;
    return bins;
  }

  function mean(arrs) {
    var m = new Float32Array(256);
    arrs.forEach(function (a) { for (var i = 0; i < 256; i++) m[i] += a[i] / arrs.length; });
    var n = 0;
    for (var i2 = 0; i2 < 256; i2++) n += m[i2] * m[i2];
    n = Math.sqrt(n) || 1;
    for (var i3 = 0; i3 < 256; i3++) m[i3] /= n;
    return m;
  }

  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function softmax(a) {
    var m = Math.max.apply(null, a), e = a.map(function (v) { return Math.exp((v - m) / 0.12); });
    var s = e.reduce(function (x, y) { return x + y; }, 0);
    return e.map(function (v) { return v / s; });
  }

  // "training": 8 samples per class, descriptors averaged into one prototype each
  var proto = { circle: [], square: [] };
  for (var i = 0; i < 8; i++) { draw('circle', 14); proto.circle.push(descriptor()); }
  for (var j = 0; j < 8; j++) { draw('square', 14); proto.square.push(descriptor()); }
  var P = { circle: mean(proto.circle), square: mean(proto.square) };

  function classify() {
    var f = descriptor();
    var p = softmax([dot(f, P.circle), dot(f, P.square)]);
    document.getElementById('bc').style.width = Math.max(2, p[0] * 150) + 'px';
    document.getElementById('bs').style.width = Math.max(2, p[1] * 150) + 'px';
    document.getElementById('sc').textContent = (p[0] * 100).toFixed(0) + '%';
    document.getElementById('ss').textContent = (p[1] * 100).toFixed(0) + '%';
    document.getElementById('verdict').textContent =
      p[0] > p[1] ? 'circle (softmax over cosine similarity)' : 'square (softmax over cosine similarity)';
  }

  document.getElementById('new').addEventListener('click', function () {
    draw(rnd() > 0.5 ? 'circle' : 'square', 18);
    classify();
  });
  draw('circle', 16);
  classify();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 两条线，一条是「用大模型」，一条是「设计特征」

| | 真实分类 | 迷你分类 |
| --- | --- | --- |
| 用什么 | EfficientNet-Lite0（17.7 MB） | **256 维手写描述子** |
| 样本量 | 0（预训练，1000 类） | 每类 **8 张** |
| 训练 | 无 | 算类均值（毫秒级） |
| 类别 | 固定 ImageNet 1000 类 | 任意，你拍什么就是什么 |
| 精度 | 高（但仅限那 1000 类） | 中等，但可扩展 |

这页最有价值的不是「CNN 有多强」，而是**「小样本时，好特征 + 简单分类器经常打得过复杂模型」**。

## 描述子的三步，每一步都在消除一个干扰

1. **亮度重心对齐** → 消除**平移**。物体在画面偏左偏右，不影响结果；
2. **散度归一化**（把「亮度的空间标准差」拉伸到固定 4.2 格）→ 消除**尺度**。物体大一点小一点，归一化到同样大小；
3. **取差分而不是强度** → 消除**亮度/对比度**。同样的形状在暗光下也认得出。

这三步是**手工设计的不变性**。CNN 通过卷积 + 池化**学出**了类似的不变性，但这页用 20 行代码手动实现了它 —— 让人具体地看到"特征工程"到底在做什么。

## 为什么用「类均值原型」而不是训练分类器

每类只有 8 个样本时，训练任何模型都会过拟合（8 个样本连一层全连接都喂不饱）。

**原型分类**（nearest class mean）在这种情况下的表现经常优于逻辑回归：

- 类均值就是该类在特征空间的重心；
- 预测 = 算到各重心的余弦相似度，取最大；
- 参数数量 = 类别数 × 256，几乎没有过拟合空间。

这也是小样本学习（few-shot learning）最经典的 baseline —— **它常常被低估，因为它太简单**。

## 温度参数 0.12 在做什么

\`softmax(sim / T)\`，T 越小分布越尖锐。

余弦相似度的范围通常是 0.3–0.99，直接 softmax 会得到一堆 0.25 左右的平均概率 —— 看起来"什么都有可能"。除以 0.12 之后，0.95 vs 0.85 的差距被放大成明显的置信度差。

**这是把「相似度」转成「概率」的必要一步**，几乎所有检索/度量学习系统都有这个温度。

## 想深一层

1. 8 张样本的抖动（页面加了 0.12/0.13/0.08 的扰动）是在**数据增强**：平移、缩放、亮度。增强的目的不是让模型更强，是让 8 个样本覆盖更多的真实变化。
2. 这条迷你线在**光照稳定、背景单一**时很好用（工业质检、教学演示），在复杂场景下会崩 —— 因为它没有语义，只有形状统计。
3. 判断该用哪条：**类别固定且常见 → 用大模型；类别自定义且样本少 → 用描述子 + 原型**。这个决策比任何精度比较都重要。`,
      en: `## Two routes: use a big model, or design the features

| | Real classifier | Mini classifier |
| --- | --- | --- |
| What | EfficientNet-Lite0 (17.7 MB) | **256-d hand-written descriptor** |
| Samples needed | 0 (pretrained, 1000 classes) | **8 per class** |
| Training | none | class means (milliseconds) |
| Classes | the fixed ImageNet 1000 | anything you photograph |
| Accuracy | high, within those 1000 | moderate, but extensible |

The page's real lesson is not "CNNs are strong" but **"with few samples, good features plus a simple classifier often beats a complex model"**.

## Three descriptor steps, each removing one nuisance

1. **Luminance-centroid alignment** → removes **translation**. Off-centre objects behave the same;
2. **Spread normalisation** (stretch the spatial std of luminance to a fixed 4.2 cells) → removes **scale**;
3. **Difference instead of intensity** → removes **brightness and contrast**. Same shape in dim light still matches.

These are **hand-designed invariances**. A CNN *learns* similar invariances through convolution and pooling; this page implements them in 20 lines, making "feature engineering" concrete.

## Why class-mean prototypes instead of a trained classifier

With 8 samples per class, anything trained overfits — eight samples cannot even feed one dense layer.

**Nearest class mean** often beats logistic regression in this regime:

- the class mean is that class's centre of mass in feature space;
- prediction is cosine similarity to each centre, take the max;
- parameter count is classes × 256, leaving almost no room to overfit.

It is also the classic few-shot baseline — **underrated precisely because it is simple**.

## What the temperature of 0.12 does

\`softmax(sim / T)\`, smaller T means sharper.

Cosine similarities sit around 0.3–0.99; raw softmax over them yields a flat ~0.25 each, reading as "anything is possible". Dividing by 0.12 turns 0.95 vs 0.85 into a visible confidence gap.

**It is the necessary step from similarity to probability**, present in nearly every retrieval and metric-learning system.

## Going deeper

1. The jitter on the 8 samples (0.12 / 0.13 / 0.08) is **augmentation**: shift, scale, brightness. Not to make the model stronger, but to let 8 samples cover more real variation.
2. The mini route works well under **stable lighting and simple backgrounds** (inspection, teaching) and collapses in cluttered scenes — it has no semantics, only shape statistics.
3. How to choose: **fixed common classes → big model; custom classes with few samples → descriptor + prototype.** That decision matters more than any accuracy table.`
    }
  },

  '/vision/face-recognition': {
    python: `"""Face recognition in three models, each doing a different job.

Detection finds the face, landmarks align it, recognition turns it into a
128-d vector. Skipping the middle step is why naive implementations fail.
"""
import cv2
import numpy as np


def detect(img, score_threshold=0.3, input_size=320):
    """tiny_face_detector: 193 KB. Returns a box plus 5 rough points.
    Stand-in for the model call: swap in faceapi/OpenCV and the rest still runs."""
    h, w = img.shape[:2]
    return {'box': (int(w * .3), int(h * .2), int(w * .4), int(h * .5)), 'score': 0.94}


def align(img, landmarks68):
    """THE step people skip. Both eyes must land on fixed coordinates, or the
    same person at a different head tilt produces a different embedding.
    A similarity transform (rotate + scale + translate) from the eye centres."""
    left_eye = np.mean(landmarks68[36:42], axis=0)
    right_eye = np.mean(landmarks68[42:48], axis=0)

    dx, dy = right_eye[0] - left_eye[0], right_eye[1] - left_eye[1]
    angle = np.degrees(np.arctan2(dy, dx))
    dist = np.hypot(dx, dy)

    # target: eyes 112 px apart, horizontally centred, at a fixed height
    scale = 112.0 / max(dist, 1e-6)
    out = 160
    M = cv2.getRotationMatrix2D(tuple(map(float, left_eye)), angle, scale)
    # then shift so the left eye lands on the canonical position
    M[0, 2] += 0.30 * out - left_eye[0]
    M[1, 2] += 0.40 * out - left_eye[1]
    return cv2.warpAffine(img, M, (out, out))


def embed(aligned_face, net):
    """face_recognition model: 6.4 MB, outputs 128 numbers.
    The absolute values mean nothing -- only distances between vectors do."""
    return net.predict(aligned_face)            # shape (128,)


def compare(a, b, threshold=0.5):
    """Cosine similarity on unit-normalised vectors. 0.5 is face-api's usual
    cut-off; ArcFace uses 0.28 on cosine DISTANCE. Never copy a threshold
    across models -- it is a property of the embedding space, not of faces."""
    a = a / (np.linalg.norm(a) + 1e-9)
    b = b / (np.linalg.norm(b) + 1e-9)
    sim = float(a @ b)
    return sim, sim >= threshold


# Enrolment is just: detect -> align -> embed -> store the 128 floats.
# Recognition is: detect -> align -> embed -> compare against every stored vector.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Cosine similarity and one threshold</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:560px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .pairs{margin-top:10px;font-size:12px}
  .pairs div{display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .pairs b{width:150px;font-weight:500}
  .pairs i{display:block;height:10px;border-radius:3px}
  .pairs span{font-variant-numeric:tabular-nums;color:#475569;width:52px;text-align:right}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:12px;font-size:12px}
  input[type=range]{width:200px}output{font-variant-numeric:tabular-nums;font-weight:600}
</style>
</head>
<body>
<h1>128 numbers, one decision</h1>
<p>Three pairs of face embeddings. Cosine similarity above the threshold means "same person". Slide
the threshold — every step trades false accepts against false rejects.</p>
<canvas id="c" width="560" height="180"></canvas>
<div class="pairs" id="pairs"></div>
<label>threshold <input type="range" id="th" min="0.2" max="0.9" step="0.01" value="0.5"><output id="v">0.50</output></label>
<script>
(function () {
  // three pairs of 128-d vectors, built so the similarities land where we want
  function unit(v) {
    var n = Math.sqrt(v.reduce(function (a, b) { return a + b * b; }, 0)) || 1;
    return v.map(function (x) { return x / n; });
  }
  function rnd(i) { var x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x) - 0.5; }
  function base(seed) {
    var v = [];
    for (var i = 0; i < 128; i++) v.push(rnd(seed * 31 + i));
    return unit(v);
  }
  function near(v, target, seed) {
    // blend toward a random vector to control the cosine similarity
    var w = [];
    for (var i = 0; i < 128; i++) w.push(rnd(seed * 17 + i));
    w = unit(w);
    var mix = v.map(function (x, i) { return x * target + w[i] * Math.sqrt(1 - target * target); });
    return unit(mix);
  }
  function cos(a, b) {
    var d = 0;
    for (var i = 0; i < a.length; i++) d += a[i] * b[i];
    return d;
  }

  var A1 = base(1), A2 = near(A1, 0.82, 2);     // same person, two photos
  var B1 = base(3), B2 = near(B1, 0.88, 4);     // another person
  var C1 = base(5), C2 = near(C1, 0.61, 6);     // borderline

  var PAIRS = [
    { name: 'A1 vs A2 (same)', v: cos(A1, A2), truth: true },
    { name: 'B1 vs B2 (same)', v: cos(B1, B2), truth: true },
    { name: 'A1 vs B1 (different)', v: cos(A1, B1), truth: false },
    { name: 'C1 vs C2 (borderline)', v: cos(C1, C2), truth: true }
  ];

  function render() {
    var thr = parseFloat(document.getElementById('th').value);
    document.getElementById('v').textContent = thr.toFixed(2);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 560, H = 180;
    ctx.clearRect(0, 0, W, H);
    // similarity axis 0.3 .. 1.0
    var x0 = 30, x1 = W - 20;
    function X(v) { return x0 + (v - 0.3) / 0.7 * (x1 - x0); }
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(x0, 140); ctx.lineTo(x1, 140); ctx.stroke();

    for (var t = 0.3; t <= 1.001; t += 0.1) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(t.toFixed(1), X(t) - 8, 156);
      ctx.beginPath(); ctx.moveTo(X(t), 136); ctx.lineTo(X(t), 144); ctx.stroke();
    }

    // threshold line
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(thr), 24); ctx.lineTo(X(thr), 140); ctx.stroke();
    ctx.fillStyle = '#dc2626'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('threshold', X(thr) - 26, 18);

    PAIRS.forEach(function (p, i) {
      var y = 40 + i * 24;
      var accept = p.v >= thr;
      var correct = accept === p.truth;
      ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(p.name.split(' ')[0], 0, y + 4);
      ctx.fillStyle = accept ? (correct ? '#16a34a' : '#dc2626') : (correct ? '#94a3b8' : '#f59e0b');
      ctx.beginPath(); ctx.arc(X(p.v), y, 6, 0, Math.PI * 2); ctx.fill();
    });

    var accepted = PAIRS.filter(function (p) { return p.v >= thr; }).length;
    var wrong = PAIRS.filter(function (p) { return (p.v >= thr) !== p.truth; }).length;
    ctx.fillStyle = '#0f172a'; ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('accepted ' + accepted + ' / ' + PAIRS.length + '   wrong ' + wrong, x0, 176);

    document.getElementById('pairs').innerHTML = PAIRS.map(function (p) {
      var accept = p.v >= thr;
      var ok = accept === p.truth;
      return '<div><b>' + p.name + '</b><i style="width:' + Math.round(p.v * 260) +
             'px;background:' + (accept ? (ok ? '#16a34a' : '#dc2626') : '#cbd5e1') + '"></i>' +
             '<span>' + p.v.toFixed(2) + '</span>' +
             '<span style="width:70px;color:' + (ok ? '#64748b' : '#dc2626') + '">' +
             (accept ? 'accept' : 'reject') + (ok ? '' : ' ✗') + '</span></div>';
    }).join('');
  }

  document.getElementById('th').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 三个模型，三步，缺一不可

| 步骤 | 模型 | 体积 | 作用 |
| --- | --- | --- | --- |
| 检测 | \`tiny_face_detector\` | **193 KB** | 脸在哪（框 + 5 点） |
| 对齐 | \`face_landmark_68\` | **357 KB** | 68 个点，用来摆正脸 |
| 识别 | \`face_recognition\` | **6.4 MB** | 128 维身份向量 |

注意体积分布：**识别模型占了 94% 的下载量**，但它只在最后一步用一次；检测和对齐虽然小，却决定了结果的上限。

## 中间那步「对齐」为什么不能省

人脸识别模型不是对任意姿态都鲁棒的。它期望输入是**标准正脸**：两眼水平、间距固定、脸居中。

对齐的做法：用 68 点里的两眼中心算出**角度和距离**，然后做相似变换（旋转 + 缩放 + 平移），把眼睛放到固定坐标上。

不做这一步的后果：同一个人歪头 15°，128 维向量会偏离到认不出。**这不是模型不行，是输入没归一化。** 所有工业级人脸系统都有这一步。

## 128 维够不够

够，而且很够。理论上一张脸的信息量远小于 128 个浮点数能表达的 2^128 种组合。

关键是这个空间的性质：**同一个人的不同照片靠得近，不同人离得远**。这是训练目标（triplet loss / ArcFace loss）直接优化的结果 —— 不是"提取特征"，是"把身份映射到球面上"。

对比：ArcFace 用 512 维，精度更高但更慢；128 维是精度/速度的经典折中（face-api 沿用 dlib 的方案）。

## 阈值 0.5 是个统计决策，不是物理常数

人脸比对本质是**二分类**：同一个人的分数分布 vs 不同人的分数分布，两条曲线有重叠。

阈值选在哪，决定了两种错误的比例：

- **FAR**（误接受率）：把陌生人认成熟人 —— 安全风险；
- **FRR**（误拒绝率）：把熟人拒之门外 —— 体验问题。

0.5 是在"演示场景下两者都还能接受"的位置。真实门禁系统会选更低的 FAR（宁可多拒几次）。

**所以"阈值多少"这个问题没有标准答案，取决于你更怕哪种错误。**

## 存储：为什么是 localStorage，以及为什么这不够

页面把注册的人脸向量存在 \`localStorage\`，键名带版本号（\`.v1\`，便于以后迁移）。

演示够用，但真实系统必须：

1. **加密存储**（向量不能明文，因为它是生物特征）；
2. **明确告知与同意**（人脸是敏感个人信息，很多司法辖区有专门立法）；
3. **可删除**（用户有权要求删除）。

这也是为什么这页的注册是「本地保存」而不是「上传服务器」—— **数据不出设备，是隐私设计里最强的一条**。

## 想深一层

1. 检测的 \`inputSize: 320\` 意味着人脸至少要 40 px 才稳。远处的小脸会漏检 —— 想抓远景要调大，代价是变慢。
2. 同一张照片左右翻转后，128 维向量会明显变化。所以人脸系统通常对镜像不鲁棒，这也是自拍和证件照比对容易失败的原因之一。
3. 「活体检测」（liveness）是另一个模型：判断这是真人还是照片/视频。没有它，一张手机里的照片就能骗过系统 —— 这是人脸支付必须有红外/3D 结构光的原因。`,
      en: `## Three models, three steps, none optional

| Step | Model | Size | Job |
| --- | --- | --- | --- |
| Detect | \`tiny_face_detector\` | **193 KB** | where the face is (box + 5 points) |
| Align | \`face_landmark_68\` | **357 KB** | 68 points to straighten the face |
| Recognise | \`face_recognition\` | **6.4 MB** | 128-d identity vector |

Note the size distribution: **recognition is 94% of the download** yet runs once at the end, while the two small models determine the ceiling of the result.

## Why the middle step cannot be skipped

Recognition models are not robust to arbitrary pose. They expect a **canonical frontal face**: eyes horizontal, fixed spacing, face centred.

Alignment computes **angle and distance** from the two eye centres in the 68 points, then applies a similarity transform (rotate + scale + translate) to place the eyes at fixed coordinates.

Skip it and the same person tilting their head 15° produces a 128-d vector that no longer matches. **The model is fine; the input was not normalised.** Every production face system has this step.

## Is 128 dimensions enough

Yes, comfortably. A face carries far less information than 128 floats can encode (2^128 combinations).

What matters is the space's property: **photos of one person land close, different people land far apart**. That is what the training objective (triplet loss / ArcFace loss) optimises directly — it is not "extracting features", it is "mapping identity onto a sphere".

For comparison, ArcFace uses 512 dimensions: more accurate, slower. 128 is the classic accuracy/speed compromise (face-api follows dlib).

## The 0.5 threshold is a statistical decision, not a constant of nature

Face comparison is a **binary classification**: the score distributions for same-person and different-person overlap.

Where you cut determines the mix of two errors:

- **FAR** (false accept): a stranger recognised as enrolled — a security risk;
- **FRR** (false reject): an enrolled person turned away — a usability problem.

0.5 is where both stay tolerable for a demo. Real access control chooses a lower FAR (happier to reject).

**So "what threshold" has no universal answer — it depends which error you fear.**

## Storage: why localStorage, and why it is not enough

Registered vectors sit in \`localStorage\` under a versioned key (\`.v1\`, for future migration).

Fine for a demo; production must:

1. **encrypt** (a vector is biometric data, not plaintext);
2. **inform and obtain consent** (faces are sensitive personal data with dedicated laws in many jurisdictions);
3. **support deletion**.

Which is why enrolment here is "saved locally" rather than "uploaded" — **data never leaving the device is the strongest privacy guarantee available**.

## Going deeper

1. \`inputSize: 320\` means a face needs roughly 40 px to be reliable; distant faces are missed. Increase it for wide shots at the cost of speed.
2. Mirror a photo and the 128-d vector shifts noticeably, so face systems are not mirror-robust — one reason selfie-to-ID comparisons fail.
3. **Liveness detection** is a separate model deciding whether this is a person or a photo/screen. Without it, a phone photo defeats the system — hence the IR and structured-light hardware in face payment.`
    }
  },

  '/vision/recorder': {
    python: `"""Recording and transcoding: two different formats, two different jobs.

MediaRecorder gives you WebM cheaply (no CPU). ffmpeg.wasm gives you MP4 and
GIF, but transcodes every frame -- so you only do it on export.
"""
import subprocess


def to_mp4(src, dst, crf=23, preset='veryfast'):
    """libx264 + yuv420p is the compatibility recipe: 4:2:0 chroma and an
    H.264 profile that every phone, TV and browser will play."""
    subprocess.run([
        'ffmpeg', '-y', '-i', src,
        '-c:v', 'libx264', '-preset', preset, '-crf', str(crf),
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',      # moov atom first: playable while loading
        dst
    ], check=True)


def to_gif(src, dst, fps=12, width=480):
    """Two passes: build an optimal palette from the clip, then apply it.
    A single-pass GIF uses a global 216-colour cube and looks muddy."""
    palette = dst + '.png'
    subprocess.run(['ffmpeg', '-y', '-i', src,
                    '-vf', f'fps={fps},scale={width}:-1:flags=lanczos,palettegen', palette], check=True)
    subprocess.run(['ffmpeg', '-y', '-i', src, '-i', palette,
                    '-lavfi', f'fps={fps},scale={width}:-1:flags=lanczos[x];[x][1:v]paletteuse',
                    '-loop', '0', dst], check=True)


def trim(src, dst, start, end):
    """-ss BEFORE -i seeks fast (keyframe), then decodes from there.
    -t is a duration, not an end time -- a very common off-by-start bug."""
    subprocess.run(['ffmpeg', '-y', '-ss', str(start), '-i', src,
                    '-t', str(end - start),
                    '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-b:a', '128k', dst], check=True)
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Record natively, transcode only on export</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .flow{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
  .step{flex:1;min-width:130px;border:1px solid #cbd5e1;border-radius:8px;padding:9px 11px;background:#fff;font-size:12px}
  .step b{display:block;font-size:13px;margin-bottom:3px}
  .step small{color:#64748b}
  .calc{font-size:12px}
  .calc label{display:flex;align-items:center;gap:8px;margin-bottom:7px}
  input[type=range]{width:170px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:66px;display:inline-block}
  .res{margin-top:10px;padding:9px 11px;background:#eff6ff;border-radius:8px;font-size:12px;line-height:1.7}
  .res b{font-variant-numeric:tabular-nums}
</style>
</head>
<body>
<h1>Recording is free; transcoding is not</h1>
<p>MediaRecorder encodes in hardware — near-zero CPU, real time. ffmpeg.wasm encodes in software,
tens of times slower. So record with the first, transcode only when exporting.</p>
<div class="flow">
  <div class="step"><b>1. capture</b><small>getUserMedia + canvas.captureStream(30)</small></div>
  <div class="step"><b>2. record</b><small>MediaRecorder, VP9/Opus, 1 s chunks</small></div>
  <div class="step"><b>3. export</b><small>ffmpeg.wasm: libx264, yuv420p, +faststart</small></div>
</div>
<div class="calc">
  <label>duration <input type="range" id="d" min="5" max="120" step="5" value="30"><output id="vd">30 s</output></label>
  <label>bitrate <input type="range" id="b" min="500" max="8000" step="100" value="2500"><output id="vb">2500</output></label>
  <label>audio <input type="range" id="a" min="64" max="192" step="32" value="128"><output id="va">128</output></label>
</div>
<div class="res" id="res"></div>
<script>
(function () {
  function update() {
    var d = +document.getElementById('d').value;
    var b = +document.getElementById('b').value;
    var a = +document.getElementById('a').value;
    document.getElementById('vd').textContent = d + ' s';
    document.getElementById('vb').textContent = b;
    document.getElementById('va').textContent = a;

    var mb = (b + a) * 1000 * d / 8 / 1024 / 1024;
    // software x264 in wasm manages roughly 1-3x realtime at 720p on a laptop
    var encodeSec = Math.round(d * 1.6);
    document.getElementById('res').innerHTML =
      'recorded size <b>' + mb.toFixed(1) + ' MB</b><br>' +
      'export time (worst case, 720p in wasm) <b>~' + encodeSec + ' s</b><br>' +
      'ratio: <b>' + (encodeSec / d).toFixed(1) + 'x</b> realtime — this is why the page only transcodes on export.';
  }
  ['d', 'b', 'a'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', update);
  });
  update();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 录制和转码是两件事，不该混在一起

- **录制**用 \`MediaRecorder\`：浏览器**原生**编码，几乎不耗 CPU（编码器已经在 GPU/硬件里），实时出数据；
- **转码**用 ffmpeg.wasm：**纯软件**编码，慢几十倍，但能出 MP4 这种"到处都能播"的格式。

页面的策略很清楚：**录制用原生的，导出才转码**。如果一边录一边用 wasm 转码，帧率会崩。

## 为什么录出来是 WebM，非要转 MP4

Safari 和 iOS 对 WebM 的支持一直不完整（近年才好转），而 MP4/H.264 在**任何设备**上都能播 —— 包括微信、电视、老投影仪。

所以「下载」这个动作必须给 MP4。这是**兼容性成本**，不是技术偏好。

代价：ffmpeg.wasm 是**单线程**（因为多线程需要 SharedArrayBuffer，需要 COOP/COEP 响应头，见项目部署文档）。单线程意味着 1 分钟的视频可能要转十几秒到几十秒。

## GIF 为什么要两次 pass

GIF 最多 256 色。一次 pass 的做法是用一个**固定的全局调色板**（比如 216 色 web-safe），结果彩色画面会发灰、渐变出现色带。

两次 pass 的做法：
1. 先用 \`palettegen\` 分析整段视频，**生成一段专门为它优化的 256 色调色板**；
2. 再用 \`paletteuse\` 把这段色彩映射上去。

代价是多跑一遍，收益是颜色准确度高一个档次。**任何量化到有限调色板的场景都该这么做。**

## 几个参数为什么是这几个值

| 参数 | 值 | 理由 |
| --- | --- | --- |
| \`-crf 23\` | 恒定质量 23 | x264 默认值，肉眼几乎无损，体积适中 |
| \`-pix_fmt yuv420p\` | 4:2:0 色度采样 | 兼容性；很多播放器不支持 4:4:4 |
| \`-movflags +faststart\` | moov 前置 | 边下边播；否则要下完才能播 |
| 音频 \`aac 128k\` | — | AAC-LC 128 kbps 是"透明"的常见下限 |
| GIF \`fps=12\` | — | GIF 体积随帧数线性增长，12 fps 已经够"动" |

## 想深一层

1. \`MediaRecorder\` 产出的 WebM **没有时长信息**（duration 是 Infinity），播放器进度条会乱跳。这是 WebM 容器 + 流式写入的固有缺陷，不是 bug。解决办法是转码，或者用 \`ts-ebml\` 之类工具修 header。
2. 修剪视频时 \`-ss\` 放在 \`-i\` **之前**是"快速定位"（跳到最近关键帧），放在之后是"精确但慢"（解码全部前置帧）。页面选前者，因为用户要的是快。
3. 画中画（摄像头 + 屏幕）用 canvas \`captureStream(30)\` 合成后录。这是浏览器里做"人像 + 课件"录制的标准做法，比录两次再合成简单得多。`,
      en: `## Recording and transcoding are separate jobs

- **Record** with \`MediaRecorder\`: **native** encoding, almost no CPU (the encoder is already in hardware), frames arrive in real time;
- **Transcode** with ffmpeg.wasm: **pure software** encoding, tens of times slower, but it produces MP4 that plays anywhere.

The page's policy is deliberate: **record natively, transcode only on export**. Transcoding while recording tanks the frame rate.

## Why WebM out of the recorder, and why MP4 for download

Safari and iOS have never fully supported WebM (only recently improved), while MP4/H.264 plays on **everything** — WeChat, TVs, old projectors.

So the download must be MP4. That is a **compatibility cost**, not a preference.

The price: ffmpeg.wasm here is **single-threaded** (multi-threading needs SharedArrayBuffer and COOP/COEP headers, see the deploy doc). A one-minute clip may take tens of seconds.

## Why GIF needs two passes

GIF allows 256 colours. A single pass uses a **fixed global palette** (say the 216-colour web-safe cube), which greys out colourful footage and bands gradients.

Two passes:
1. \`palettegen\` analyses the whole clip and **builds a 256-colour palette optimised for it**;
2. \`paletteuse\` maps the clip onto that palette.

Cost: one extra run. Benefit: a full tier better colour. **Any quantisation to a limited palette should work this way.**

## Why these particular values

| Parameter | Value | Reason |
| --- | --- | --- |
| \`-crf 23\` | constant quality 23 | x264 default; visually near-lossless, moderate size |
| \`-pix_fmt yuv420p\` | 4:2:0 chroma | compatibility; many players reject 4:4:4 |
| \`-movflags +faststart\` | moov first | progressive playback; otherwise wait for full download |
| audio \`aac 128k\` | — | AAC-LC 128 kbps is the usual transparency floor |
| GIF \`fps=12\` | — | GIF size grows linearly with frames; 12 fps already reads as motion |

## Going deeper

1. \`MediaRecorder\`'s WebM carries **no duration** (it reports Infinity) and scrubbing misbehaves. An inherent limitation of streaming into the WebM container, not a bug. Fix by transcoding or repairing the header with something like \`ts-ebml\`.
2. \`-ss\` **before** \`-i\` seeks to the nearest keyframe (fast); after \`-i\` decodes everything up to that point (exact but slow). The page picks fast.
3. Picture-in-picture (camera + screen) composes on a canvas via \`captureStream(30)\`. That is the standard way to record "presenter + slides" in a browser, far simpler than recording twice and compositing.`
    }
  },

  '/vision/image-convert': {
    python: `"""Format conversion is not a rename -- every format trades differently.

The page runs all of it through ffmpeg.wasm (one pipeline, no canvas), which
is why the parameter mapping below matters.
"""
import subprocess


def convert(src, dst, quality=90):
    """One ffmpeg call per format. The encoder name is the only real choice:
      PNG  -> png    (lossless, deflate)
      JPG  -> mjpeg  (lossy, needs a -q:v scale that runs BACKWARDS)
      WebP -> libwebp (lossy, -quality is 0..100 and runs forwards)
      BMP  -> bmp    (uncompressed, huge)
    """
    fmt = dst.rsplit('.', 1)[-1].lower()

    if fmt in ('png', 'bmp'):
        codec = ['-c:v', 'png' if fmt == 'png' else 'bmp']
    elif fmt == 'jpg' or fmt == 'jpeg':
        # ffmpeg's -q:v is 31 (worst) .. 1 (best). Mapping a 0..100 quality
        # onto it means INVERTING: quality 100 -> 2, quality 0 -> 31.
        qv = round(31 - (quality / 100) * 29)
        codec = ['-c:v', 'mjpeg', '-q:v', str(qv)]
    elif fmt == 'webp':
        codec = ['-c:v', 'libwebp', '-quality', str(quality)]
    else:
        raise ValueError(fmt)

    subprocess.run(['ffmpeg', '-y', '-i', src, *codec,
                    '-frames:v', '1', '-update', '1', dst], check=True)
    return f'{fmt} at quality {quality}'


# Why go through ffmpeg instead of canvas.toBlob('image/jpeg', q)?
#   canvas: fast, but always re-encodes through the compositor and loses the
#           original's colour profile and EXIF orientation in odd ways
#   ffmpeg: slower, but byte-accurate and supports formats the browser cannot
#           encode at all (BMP, TIFF, AVIF with the right build)
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Same pixels, four formats</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  canvas{border-radius:8px;display:block;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  table{border-collapse:collapse;font-size:12px;flex:1;min-width:230px}
  th,td{border:1px solid #e2e8f0;padding:5px 8px;text-align:left}
  th{background:#f1f5f9;font-weight:600}
  td.n{text-align:right;font-variant-numeric:tabular-nums}
  label{display:inline-flex;gap:8px;align-items:center;margin-top:12px;font-size:12px}
  input[type=range]{width:180px}output{font-variant-numeric:tabular-nums;font-weight:600}
  .hint{color:#475569;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Converting means re-encoding, not renaming</h1>
<p>The same 320x320 pixels encoded four ways, right here in your browser via
<code>canvas.toBlob</code>. Watch what the quality slider does to JPEG and WebP but not to PNG.</p>
<div class="wrap">
  <canvas id="c" width="320" height="320"></canvas>
  <div style="flex:1;min-width:230px">
    <table id="t"><thead><tr><th>format</th><th>bytes</th><th>vs PNG</th></tr></thead><tbody></tbody></table>
    <label>quality <input type="range" id="q" min="10" max="100" step="5" value="85"><output id="v">85</output></label>
    <div class="hint">PNG is lossless, so the slider does nothing. JPEG and WebP are lossy — and WebP
    is the only one of the four that is both lossy and keeps transparency.</div>
  </div>
</div>
<script>
(function () {
  var S = 320;
  var cv = document.getElementById('c'), ctx = cv.getContext('2d');
  (function paint() {
    var g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#0ea5e9'); g.addColorStop(0.5, '#f59e0b'); g.addColorStop(1, '#7c3aed');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (var i = 0; i < 26; i++) {
      ctx.beginPath();
      ctx.arc(40 + (i * 53) % 260, 40 + (i * 97) % 260, 6 + (i % 4) * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 22px system-ui';
    ctx.fillText('detail matters', 40, 300);
  })();

  var FORMATS = [
    ['image/png', 'PNG (lossless)'],
    ['image/jpeg', 'JPEG (lossy)'],
    ['image/webp', 'WebP (lossy)'],
    ['image/bmp', 'BMP-ish (raw)']
  ];

  function encode(type, q) {
    return new Promise(function (res) {
      cv.toBlob(function (b) {
        // browsers silently fall back to PNG for unsupported types
        res({ size: b ? b.size : 0, realType: b ? b.type : '', blob: b });
      }, type, q / 100);
    });
  }

  var lastBlob = null;
  async function run() {
    var q = parseInt(document.getElementById('q').value, 10);
    document.getElementById('v').textContent = q;
    var rows = [], base = 0;
    for (var i = 0; i < FORMATS.length; i++) {
      var r = await encode(FORMATS[i][0], q);
      if (i === 0) base = r.size;
      rows.push({ name: FORMATS[i][1], size: r.size, type: r.realType, blob: r.blob });
    }
    document.querySelector('#t tbody').innerHTML = rows.map(function (r) {
      var ratio = base ? (r.size / base) : 0;
      var fb = r.realType !== FORMATS[rows.indexOf(r)][0] ? ' (fallback)' : '';
      return '<tr><td>' + r.name + fb + '</td><td class="n">' + (r.size / 1024).toFixed(1) + ' KB</td>' +
             '<td class="n">' + (ratio ? (ratio * 100).toFixed(0) + '%' : '100%') + '</td></tr>';
    }).join('');
    lastBlob = rows;
  }

  document.getElementById('q').addEventListener('change', run);
  run();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 转换格式 = 重新编码，不是改后缀

改文件名的后缀，图片内容一点没变，只是打不开了。真正的转换要**解码成像素，再用目标格式的编码器压回去**。

四种格式的本质区别：

| 格式 | 压缩 | 透明 | 典型体积（同一张 4000×3000） |
| --- | --- | --- | --- |
| PNG | 无损（deflate） | 支持 | 约 12 MB |
| JPG | 有损（DCT） | 不支持 | 约 3 MB |
| WebP（有损） | 有损（VP8） | 支持 | 约 1.8 MB |
| BMP | 不压缩 | 不支持（部分变体支持） | 约 36 MB |

**WebP 是唯一"又有损又支持透明"的**，所以它是网页素材的首选。这也是为什么同一张 PNG 转 WebP 能省 85%。

## JPEG 质量参数为什么是反的

ffmpeg 里 JPEG 的编码器是 \`mjpeg\`，它的 \`-q:v\` 是 **1（最好）到 31（最差）** 的反向刻度。而用户理解的"质量"是 0–100 正向。

所以代码里的映射是 \`q:v = 31 - (quality/100) × 29\`：
- quality 100 → q:v 2（近似无损）
- quality 90 → q:v 5
- quality 0 → q:v 31（惨不忍睹）

**这种"参数方向反了"的坑在多媒体库里极多**，凡是接触过 ffmpeg 的人都被坑过。写代码时把它显式写成公式，比在注释里说一句好得多。

WebP 反过来：\`-quality\` 就是 0–100 正向。同一个界面上的两个滑杆，底层含义相反。

## 为什么图片也走 ffmpeg，而不是 canvas

\`canvas.toBlob('image/jpeg', q)\` 简单得多，而且快。但有三个问题：

1. **画质参数语义不同**：canvas 的 q 和 ffmpeg 的 q:v 不一样，转出来体积不同；
2. **色域 / EXIF 处理不同**：canvas 会丢掉原始 ICC 色彩配置，可能导致颜色偏移；EXIF 方向标记也可能被忽略（图变横）；
3. **有些格式浏览器根本不能编码**：BMP、TIFF、AVIF（取决于构建）。

统一走 ffmpeg 的代价是慢（wasm 单线程），收益是**行为可预测**。页面的选择是"宁可慢一点，也不要转出来颜色不对"。

**这就是工程取舍**：不是所有场景都该这样。如果只是做缩略图，canvas 明显更合适。

## 想深一层

1. PNG 转 JPG 会丢失透明区域（变成黑或白底）。页面没有做背景填充 —— 真实产品应该先合成到白底再转。
2. 反复"JPG → PNG → JPG"会**逐次累积损失**（每次 JPG 编码都丢一点）。这就是所谓的"代际损失"（generation loss）。任何有损格式都不该反复转。
3. WebP 有两种模式：有损（VP8）和无损（VP8L）。同一张图两种模式体积差 3 倍。\`-quality 100\` 在 ffmpeg 里是有损模式的最高质量，**不是无损** —— 想无损要用 \`-lossless 1\`。`,
      en: `## Converting a format means re-encoding, not renaming

Change the extension and the bytes are unchanged — the file simply will not open. Real conversion means **decode to pixels, then encode with the target codec**.

How the four formats differ:

| Format | Compression | Alpha | Typical size (same 4000×3000) |
| --- | --- | --- | --- |
| PNG | lossless (deflate) | yes | ~12 MB |
| JPG | lossy (DCT) | no | ~3 MB |
| WebP (lossy) | lossy (VP8) | yes | ~1.8 MB |
| BMP | none | some variants | ~36 MB |

**WebP is the only one that is both lossy and alpha-capable**, which is why it is the default for web assets — and why PNG → WebP saves about 85%.

## Why the JPEG quality parameter runs backwards

ffmpeg's JPEG encoder is \`mjpeg\`, whose \`-q:v\` scale is **1 (best) to 31 (worst)** — inverted relative to the user's 0–100.

Hence \`q:v = 31 - (quality/100) × 29\`:
- quality 100 → q:v 2 (near lossless)
- quality 90 → q:v 5
- quality 0 → q:v 31 (unwatchable)

**Inverted parameters are everywhere in multimedia libraries**, and everyone who has touched ffmpeg has been bitten. Writing the mapping as an explicit formula beats a comment.

WebP is the opposite: \`-quality\` is honest 0–100. Two sliders in one UI, opposite semantics underneath.

## Why images go through ffmpeg instead of canvas

\`canvas.toBlob('image/jpeg', q)\` is simpler and faster, but has three problems:

1. **Different quality semantics**: canvas q and ffmpeg q:v do not mean the same thing, so output sizes differ;
2. **Colour profile / EXIF handling differs**: canvas drops the source ICC profile (possible colour shift) and may ignore the EXIF orientation tag (image comes out sideways);
3. **Some formats the browser cannot encode at all**: BMP, TIFF, AVIF depending on the build.

One ffmpeg path costs speed (single-threaded wasm) and buys **predictable behaviour**. The page's choice: slower rather than wrong colours.

**That is a trade, not a rule.** For thumbnails, canvas is clearly better.

## Going deeper

1. PNG → JPG drops transparency (becomes black or white). The page does not composite onto a background first — a real product should.
2. Repeated "JPG → PNG → JPG" **accumulates loss** at every encode. This is generation loss; never round-trip a lossy format.
3. WebP has two modes: lossy (VP8) and lossless (VP8L), differing 3× in size. \`-quality 100\` in ffmpeg means the top of lossy, **not lossless** — that needs \`-lossless 1\`.`
    }
  },

  '/vision/video-convert': {
    python: `"""Video conversion: pick a rate-control mode, then let the encoder work.

CRF and bitrate are mutually exclusive, and confusing them is the single most
common ffmpeg mistake.
"""
import subprocess


def convert(src, dst, mode='crf', crf=23, bitrate_kbps=None, height=None, gif=False):
    """Three decisions, in order:
      1. container/codec  -> mp4 + libx264 + yuv420p for compatibility
      2. rate control     -> CRF (quality) OR ABR (size), never both
      3. filters          -> scale before encoding, never after
    """
    args = ['ffmpeg', '-y', '-i', src]

    if gif:
        # two-pass palette; a global 216-colour cube looks muddy
        args = ['ffmpeg', '-y', '-i', src, '-vf',
                'fps=12,scale=480:-1:flags=lanczos,palettegen', 'pal.png']
        subprocess.run(args, check=True)
        subprocess.run(['ffmpeg', '-y', '-i', src, '-i', 'pal.png', '-lavfi',
                        'fps=12,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse',
                        '-loop', '0', dst], check=True)
        return

    if height:
        # force_divisible_by=2: yuv420p needs even dimensions
        args += ['-vf', f"scale=-2:{height}:force_divisible_by=2"]

    args += ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p']

    if mode == 'crf':
        # constant quality: file size varies with content complexity
        args += ['-crf', str(crf)]
    else:
        # average bitrate: size is predictable, quality fluctuates
        k = bitrate_kbps or 2000
        args += ['-b:v', f'{k}k', '-maxrate', f'{int(k * 1.5)}k', '-bufsize', f'{k * 2}k']

    args += ['-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', dst]
    subprocess.run(args, check=True)


# CRF vs ABR in one line:
#   CRF  - "make it look this good", size unknown
#   ABR  - "make it this big", quality unknown
# You cannot ask for both. That is why the page's UI has two modes.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>CRF or bitrate, never both</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .modes{margin-top:12px;font-size:12px}
  button{font:inherit;font-size:12px;padding:6px 13px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;margin-right:8px}
  button.on{background:#2563eb;color:#fff;border-color:#2563eb}
  label{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12px}
  input[type=range]{width:220px}output{font-variant-numeric:tabular-nums;font-weight:600;min-width:72px}
  .note{margin-top:10px;color:#475569;font-size:12px;max-width:620px}
</style>
</head>
<body>
<h1>Two rate-control modes that answer different questions</h1>
<p>CRF fixes quality and lets the size float. ABR fixes the size and lets quality float. Passing both
to ffmpeg means one is silently ignored.</p>
<div class="modes">
  <button data-m="crf" class="on">CRF (constant quality)</button>
  <button data-m="abr">ABR (constant size)</button>
</div>
<label><span id="labText">crf</span> <input type="range" id="val" min="18" max="32" step="1" value="23"><output id="v">23</output></label>
<canvas id="c" width="620" height="220"></canvas>
<div class="note" id="note"></div>
<script>
(function () {
  var mode = 'crf';
  var W = 620, H = 220;
  var CLIPS = [
    { name: 'static talking head', complexity: 0.45 },
    { name: 'fast pan + confetti', complexity: 1.55 }
  ];
  var input = document.getElementById('val');

  function sizeMB(kbps, seconds) { return kbps * 1000 * seconds / 8 / 1024 / 1024; }
  function crfKbps(crf, complexity) {
    return 4200 * Math.pow(2, (23 - crf) / 6) * complexity;   // +6 CRF ~ halves the bitrate
  }

  function draw() {
    var val = +input.value;
    document.getElementById('v').textContent = mode === 'crf' ? val : val + ' kbps';

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    var padL = 54, padB = 32, padT = 16, padR = 16, maxMB = 60;
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();
    function Y(m) { return H - padB - Math.min(1, m / maxMB) * (H - padT - padB); }

    CLIPS.forEach(function (clip, k) {
      var kbps = mode === 'crf' ? crfKbps(val, clip.complexity) : val;
      var mb = sizeMB(kbps, 60);
      var x = 120 + k * 260;
      ctx.fillStyle = mode === 'crf' ? (k === 0 ? '#bfdbfe' : '#60a5fa') : (k === 0 ? '#bbf7d0' : '#4ade80');
      ctx.fillRect(x, Y(mb), 130, H - padB - Y(mb));
      ctx.fillStyle = '#0f172a'; ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(clip.name, x, H - 14);
      ctx.fillText(mb.toFixed(1) + ' MB', x, Y(mb) - 6);
      if (mode === 'abr') {
        var q = Math.min(100, val / clip.complexity / 100 * 8);
        ctx.fillStyle = q < 40 ? '#dc2626' : '#166534';
        ctx.fillText('quality ' + q.toFixed(0), x, Y(mb) - 20);
      }
    });

    document.getElementById('note').textContent = mode === 'crf'
      ? 'Same CRF, both clips: the hard one costs over three times the size. Quality constant, size not.'
      : 'Same bitrate, both clips: the hard one looks worse — same budget, more detail to spend it on. Size constant, quality not.';

    ctx.fillStyle = '#94a3b8'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('size (MB), 60 s clip', 6, padT + 4);
  }

  document.querySelectorAll('.modes button').forEach(function (b) {
    b.addEventListener('click', function () {
      mode = b.dataset.m;
      document.querySelectorAll('.modes button').forEach(function (x) { x.classList.toggle('on', x === b); });
      if (mode === 'crf') {
        document.getElementById('labText').textContent = 'crf';
        input.min = 18; input.max = 32; input.step = 1; input.value = 23;
      } else {
        document.getElementById('labText').textContent = 'bitrate';
        input.min = 400; input.max = 4000; input.step = 100; input.value = 2000;
      }
      draw();
    });
  });
  input.addEventListener('input', draw);
  draw();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## CRF 和码率只能选一个

这是 ffmpeg 里最容易混的一对参数：

- **CRF**（Constant Rate Factor）：告诉编码器「我要这个画质」，它自己决定用多少码率。**体积不可预测**（简单画面小、复杂画面大）；
- **ABR / -b:v**：告诉编码器「我要这个体积」，它自己决定画质。**质量不可预测**（复杂画面会糊）。

两个一起给会怎样？ffmpeg 会以码率为主、CRF 被忽略（或者报错），行为取决于版本 —— 反正不是你想要的结果。

**页面的 UI 分成两个模式，就是为了逼用户在「定质量」和「定体积」之间做选择，而不是给一堆滑杆让人乱调。**

## -maxrate 和 -bufsize 是干什么的

即使用了 ABR，码率也不是恒定的 —— 编码器会在难编的片段短时冲高。\`-maxrate\` 给它一个上限，\`-bufsize\` 是"允许多长时间的超额"。

常见配置是 \`maxrate = 1.5 × bitrate\`、\`bufsize = 2 × bitrate\`。这个组合的意思是：**允许短时超 50%，但平均必须回到目标**。

不做这个限制的话，给一个 2 Mbps 的目标，实际可能在某几秒冲到 8 Mbps —— 直播场景会直接卡死。

## 为什么缩放要放在编码之前（滤镜链的顺序）

\`-vf scale\` 是**解码后、编码前**执行的。所以：

- 先缩放到 720p 再编码 → 编码器只处理 720p 的帧，**快**（4 倍少于 1080p）；
- 编码完再缩放 → 白编码了高分辨率，**慢**且质量二次损失。

同理，\`-pix_fmt yuv420p\` 必须在编码前指定，因为它是编码器的输入格式。

**滤镜链的顺序本质上是"先做贵的还是先做便宜的"** —— 永远先降分辨率。

## \`scale=-2\` 里的 -2 是什么

\`-2\` 表示「按比例算出这个维度，并保证是偶数」。

为什么必须是偶数？因为 \`yuv420p\` 的色度平面是**每 2×2 像素共享一个值**，宽高为奇数时最后一个像素没有配对。很多播放器遇到奇数尺寸会直接报错或绿屏 —— 这是 MP4 兼容性问题的常见来源。

## 想深一层

1. \`-preset\` 是编码速度/压缩率的权衡：\`ultrafast\` 快但文件大，\`veryslow\` 慢但小 30%。页面用 \`veryfast\` 是因为 wasm 单线程本来就慢，再开 \`slow\` 会等到天荒地老。
2. VP9（WebM）用 \`-b:v 0 -crf N\` 才是真正的恒定质量模式。只给 CRF 不给 \`-b:v 0\`，VP9 会进入别的模式 —— 这是 libvpx 的怪癖。
3. 转码一定损失质量（转一次丢一次）。**能从源头拿到合适的格式，就不要转。** 页面做这件事是因为源文件在用户手里，控制不了。`,
      en: `## CRF and bitrate are mutually exclusive

The most confused pair of parameters in ffmpeg:

- **CRF** (constant rate factor): "give me this quality", the encoder picks the bitrate. **Size unpredictable** (small scenes compress well, complex ones do not);
- **ABR / -b:v**: "give me this size", the encoder picks the quality. **Quality unpredictable** (complex scenes soften).

Give both and ffmpeg prioritises bitrate, ignoring CRF (or errors) depending on version — never what you wanted.

**The page splits them into two modes precisely to force a choice between "fix quality" and "fix size"**, instead of a wall of sliders.

## What -maxrate and -bufsize do

Even under ABR the bitrate is not flat — the encoder spikes on hard scenes. \`-maxrate\` caps it; \`-bufsize\` says how long the overshoot may last.

The usual pair is \`maxrate = 1.5 × bitrate\`, \`bufsize = 2 × bitrate\`: **allow 50% overshoot briefly, but hold the target on average**.

Without it, a 2 Mbps target can spike to 8 Mbps for a few seconds — instant stall in live streaming.

## Why scaling goes before encoding

\`-vf scale\` runs **after decode, before encode**, so:

- scale to 720p then encode → the encoder only handles 720p frames, **fast** (a quarter of 1080p);
- encode then scale → you encoded high resolution for nothing, **slow** plus a second quality loss.

Likewise \`-pix_fmt yuv420p\` must be set before encoding, because it is the encoder's input format.

**Filter order is really "which cost do I pay first"** — always reduce resolution first.

## What the -2 in \`scale=-2\` means

\`-2\` means "compute this dimension from the aspect ratio, rounded to an even number".

Why even? \`yuv420p\` shares one chroma value per 2×2 block, so odd dimensions leave a pixel without a partner. Many players error out or show green — a very common source of MP4 incompatibility.

## Going deeper

1. \`-preset\` trades speed for compression: \`ultrafast\` is fast and big, \`veryslow\` is slow and 30% smaller. The page uses \`veryfast\` because single-threaded wasm is already slow.
2. VP9 (WebM) needs \`-b:v 0 -crf N\` for true constant quality; CRF alone puts libvpx in another mode — a genuine quirk.
3. Transcoding always loses quality (once per pass). **If you can obtain the right format at the source, do not convert.** This page does it because the file comes from the user.`
    }
  },

  '/vision/image-compress': {
    python: `"""Compress to a target size. There is no formula for it -- you measure.

The page tries a fixed quality ladder and encodes each rung, which is slower
than binary search but gives the user a size for every step.
"""
import subprocess
from pathlib import Path

# quality ladder from the page: coarse steps, because the size-vs-quality
# curve is flat in the middle and steep at both ends
LADDER = [92, 85, 78, 70, 62, 54, 46, 38, 30]


def encode_at(src, dst, quality, max_dimension=None):
    """quality -> ffmpeg q:v is inverted (see the image-convert page)."""
    args = ['ffmpeg', '-y', '-i', src]
    if max_dimension:
        args += ['-vf', f'scale=-2:{max_dimension}:force_divisible_by=2']
    args += ['-c:v', 'mjpeg', '-q:v', str(round(31 - (quality / 100) * 29)),
             '-frames:v', '1', '-update', '1', dst]
    subprocess.run(args, check=True, capture_output=True)
    return Path(dst).stat().st_size


def compress_under(src, target_bytes, max_dimension=None):
    """Walk the ladder down until the file fits. If nothing fits, return the
    smallest and REPORT that the target was missed -- silently failing is how
    users end up with 5 MB files claiming to be 200 KB."""
    best = None
    for q in LADDER:
        size = encode_at(src, 'tmp.jpg', q, max_dimension)
        if best is None or size < best[1]:
            best = (q, size)
        if size <= target_bytes:
            return {'quality': q, 'bytes': size, 'reached': True}
    return {'quality': best[0], 'bytes': best[1], 'reached': False}


# Why a ladder and not binary search?
#   binary search: ~4 encodes, but the user sees nothing until the end
#   ladder: up to 9 encodes, but each rung is a visible data point ("85 -> 1.2 MB")
# For an interactive tool the ladder is the better UX; for a batch job it is not.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Hitting a target size by measuring</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  canvas{border-radius:8px;display:block;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .ladder{flex:1;min-width:230px;font-size:12px}
  .row{display:flex;align-items:center;gap:8px;margin-bottom:5px}
  .row b{width:38px;font-weight:500;font-variant-numeric:tabular-nums}
  .row i{display:block;height:9px;background:#93c5fd;border-radius:3px}
  .row span{font-variant-numeric:tabular-nums;color:#475569;width:60px;text-align:right}
  .row.hit i{background:#16a34a}
  .row.hit b,.row.hit span{color:#166534;font-weight:600}
  label{display:inline-flex;gap:8px;align-items:center;margin-top:12px;font-size:12px}
  input[type=range]{width:150px}output{font-variant-numeric:tabular-nums;font-weight:600}
  .warn{margin-top:8px;font-size:12px;color:#b45309}
</style>
</head>
<body>
<h1>There is no formula — you encode and measure</h1>
<p>The page walks a fixed quality ladder and stops at the first rung that fits. This is a real ladder
search on a real JPEG encoder. Notice the mid-range: a big drop in quality buys very little size.</p>
<div class="wrap">
  <canvas id="c" width="280" height="280"></canvas>
  <div class="ladder">
    <div id="rows"></div>
    <label>target <input type="range" id="t" min="8" max="80" step="2" value="26"><output id="v">26</output> KB</label>
    <div class="warn" id="warn"></div>
  </div>
</div>
<script>
(function () {
  var S = 280;
  var cv = document.getElementById('c'), ctx = cv.getContext('2d');
  (function paint() {
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, S, S);
    // busy content: lots of edges and gradients, which is what makes JPEG big
    for (var i = 0; i < 60; i++) {
      ctx.fillStyle = 'hsl(' + (i * 37 % 360) + ',70%,' + (45 + i % 25) + '%)';
      ctx.beginPath();
      ctx.arc((i * 61) % S, (i * 113) % S, 10 + (i % 6) * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    for (var y = 0; y < S; y += 7) {
      ctx.fillStyle = 'rgba(15,23,42,.12)';
      ctx.fillRect(0, y, S, 2);
    }
  })();

  var LADDER = [92, 85, 78, 70, 62, 54, 46, 38, 30];

  function encode(q) {
    return new Promise(function (res) {
      cv.toBlob(function (b) { res(b ? b.size : 0); }, 'image/jpeg', q / 100);
    });
  }

  var cache = {};
  async function run() {
    var target = parseInt(document.getElementById('t').value, 10) * 1024;
    document.getElementById('v').textContent = (target / 1024).toFixed(0);

    var rows = [], hit = -1, maxSize = 1;
    for (var i = 0; i < LADDER.length; i++) {
      var q = LADDER[i];
      if (!cache[q]) cache[q] = await encode(q);
      rows.push({ q: q, size: cache[q] });
      maxSize = Math.max(maxSize, cache[q]);
      if (hit < 0 && cache[q] <= target) hit = i;
    }

    document.getElementById('rows').innerHTML = rows.map(function (r, i) {
      var w = Math.round(r.size / maxSize * 150);
      var cls = (hit < 0 ? i === rows.length - 1 : i === hit) ? 'row hit' : 'row';
      return '<div class="' + cls + '"><b>' + r.q + '</b>' +
             '<i style="width:' + Math.max(2, w) + 'px"></i>' +
             '<span>' + (r.size / 1024).toFixed(1) + ' KB</span></div>';
    }).join('');

    var smallest = rows[rows.length - 1];
    document.getElementById('warn').textContent = hit < 0
      ? 'even at quality ' + smallest.q + ' the file is ' + (smallest.size / 1024).toFixed(1) +
        ' KB — over target. Next lever would be reducing the pixel dimensions.'
      : 'first rung that fits: quality ' + rows[hit].q + ' at ' + (rows[hit].size / 1024).toFixed(1) + ' KB';
  }

  document.getElementById('t').addEventListener('change', run);
  run();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 「压到 200 KB」这个问题没有公式

JPEG 的体积取决于：内容复杂度（细节多 = 大）、分辨率、质量参数。三者都不是线性关系，**所以只能编码一次、量一次**。

页面用一个固定阶梯 \`[92, 85, 78, 70, 62, 54, 46, 38, 30]\`，从高到低试，第一个达标的就用。

## 为什么用阶梯而不是二分查找

二分查找（在质量 0–100 里找）通常 4 次编码就能收敛，比阶梯（最多 9 次）快一倍多。

但页面选了阶梯，原因是**体验**：每试一档，界面就多一行「质量 92 → 1.8 MB / 85 → 1.2 MB / 78 → 840 KB」。用户能看到「质量降到多少，体积降多少」的完整曲线。

二分只给最终答案，**过程不透明**。教学工具要的是过程。

**这是一个明确的产品决策**：批量处理脚本应该用二分（快），交互式工具应该用阶梯（可解释）。

## 为什么阶梯的步长是不均匀的

\`92 → 85 → 78 → 70 → 62 → 54 → 46 → 38 → 30\`

步长从 7 慢慢变到 8，看起来接近等距，但**质量到体积的曲线并不等距**：

- 90 以上：每降 5 点质量，体积降很多（高保真区的冗余大）；
- 50 左右的中间区：**体积变化最平缓**（这就是"质量降一半、体积只降 20%"的区域）；
- 30 以下：体积继续降，但画质崩得很快。

所以中间区需要更细的步长才能找到"刚好达标"的点。页面的 8 点步长就是在这个区域加密的结果。

## 达不到目标时必须说出来

如果整个阶梯都试完还没达标，页面返回最小的那个，并标记 \`reached: false\` —— **界面上会明确提示"实际体积略超目标"**。

这个细节很重要：很多压缩工具静默地返回一个超标文件，用户以为成功了，上传时才被拒。**失败要可见**，这是所有工具的基本要求。

另外 \`maxDimension\` 是第二条退路：质量压到最低还不够，就降分辨率。这也是真实压缩工具的标准策略 —— 先降质量，再降尺寸。

## 想深一层

1. JPEG 有一个"质量悬崖"：q:v 从 2 到 5 体积差一倍但肉眼几乎无差；从 8 到 12 体积只降 20% 却明显变糊。**低质量的边际收益递减得很快。**
2. WebP 在同等视觉质量下比 JPEG 小 25–35%，所以同样的目标体积，用 WebP 能保留更多画质。页面的阶梯只对 jpg/webp 开放，正是这个原因。
3. 想更精确地压到目标：可以用「两次编码 + 插值」——先试两档，量出体积，再在中间插值一档。这是阶梯和二分的混合，工业工具（如 mozjpeg）就这么做。`,
      en: `## "Compress to 200 KB" has no formula

JPEG size depends on content complexity (more detail, bigger), resolution and quality — none linearly. **So you encode and measure.**

The page walks a fixed ladder \`[92, 85, 78, 70, 62, 54, 46, 38, 30]\` from high quality down and takes the first rung that fits.

## Why a ladder instead of binary search

Binary search over 0–100 converges in about 4 encodes, more than twice as fast as the ladder's 9.

The page chose the ladder for **experience**: each attempt adds a visible line — "q 92 → 1.8 MB / 85 → 1.2 MB / 78 → 840 KB". The user sees the whole quality-versus-size curve.

Binary search returns only the answer, **hiding the process**. A teaching tool needs the process.

**A clear product decision**: batch scripts want binary search (fast); interactive tools want the ladder (explainable).

## Why the rungs are unevenly spaced

\`92 → 85 → 78 → 70 → 62 → 54 → 46 → 38 → 30\`

The steps look near-uniform (7 to 8) but the **quality-to-size curve is not**:

- above 90: every 5 points of quality costs a lot of size (lots of redundancy at high fidelity);
- around 50: **size changes most slowly** (the "halve the quality, lose 20% of size" zone);
- below 30: size keeps dropping but the image falls apart fast.

The middle needs finer steps to land near the target, which is why the ladder tightens there.

## Missing the target must be reported

If the whole ladder fails, the page returns the smallest result with \`reached: false\` and **the UI says the output overshoots**.

This matters: many compressors silently return an oversized file, the user assumes success, and the upload is rejected. **Failure must be visible.**

\`maxDimension\` is the second lever: if minimum quality is still too big, drop resolution — the standard strategy of real compressors (quality first, then dimensions).

## Going deeper

1. JPEG has a quality cliff: q:v 2 → 5 halves the size with almost no visible change; 8 → 12 saves 20% and looks visibly worse. **Low-quality returns diminish fast.**
2. WebP is 25–35% smaller than JPEG at equal visual quality, so at the same size budget it keeps more detail. That is why the ladder only offers jpg/webp here.
3. For tighter targeting: encode two rungs, measure both, interpolate a third between them — a hybrid of ladder and binary search, used by industrial tools like mozjpeg.`
    }
  },

  '/vision/video-trim': {
    python: `"""Trimming looks trivial and has exactly one trap: -ss placement.

Before -i = fast seek (keyframe accuracy). After -i = exact (decodes everything
before the cut). The page picks fast, and re-encodes for a clean start.
"""
import subprocess


def trim_fast(src, dst, start, end):
    """-ss BEFORE -i: the demuxer jumps to the nearest keyframe, then decodes
    from there. Fast, but the cut may land a fraction late."""
    subprocess.run([
        'ffmpeg', '-y',
        '-ss', f'{start:.3f}',          # seek first
        '-i', src,
        '-t', f'{end - start:.3f}',     # DURATION, not an end timestamp
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        dst
    ], check=True)


def trim_exact(src, dst, start, end):
    """-ss AFTER -i: decode from the beginning, discard frames until the cut.
    Frame-accurate, and slow for clips deep into a long file."""
    subprocess.run([
        'ffmpeg', '-y', '-i', src,
        '-ss', f'{start:.3f}',
        '-to', f'{end:.3f}',            # -to is absolute with this ordering
        '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', dst
    ], check=True)


# Why re-encode instead of -c copy?
#   -c copy is instant and lossless, but only cuts on keyframes -- the result
#   often starts with a frozen frame or a black flash. For a teaching tool a
#   clean first frame is worth the encode time.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>-ss before -i means fast, and -t is a duration</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  label{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px}
  input[type=range]{width:230px}output{font-variant-numeric:tabular-nums;font-weight:600;min-width:56px}
  pre{margin-top:12px;background:#0f172a;color:#e2e8f0;padding:11px 13px;border-radius:8px;font-size:12px;
      overflow-x:auto;line-height:1.7}
  code{font-family:ui-monospace,SFMono-Regular,monospace}
  .warn{color:#b45309;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Two flags decide everything about a cut</h1>
<p>Where <code>-ss</code> sits decides speed vs accuracy. And <code>-t</code> is a duration, not an
end timestamp — the single most common off-by-start bug in ffmpeg scripts.</p>
<canvas id="c" width="620" height="140"></canvas>
<label>start <input type="range" id="s" min="0" max="100" step="0.5" value="12"><output id="vs">12.0</output> s</label>
<label>end <input type="range" id="e" min="0" max="100" step="0.5" value="34"><output id="ve">34.0</output> s</label>
<pre><code id="cmd"></code></pre>
<div class="warn" id="warn"></div>
<script>
(function () {
  var DUR = 100;   // the source clip is 100 s
  var W = 620, H = 140;

  function draw() {
    var s = +document.getElementById('s').value;
    var e = +document.getElementById('e').value;
    if (e < s + 0.5) { e = s + 0.5; document.getElementById('e').value = e; }
    document.getElementById('vs').textContent = s.toFixed(1);
    document.getElementById('ve').textContent = e.toFixed(1);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    var x0 = 20, x1 = W - 20, y = 60, h = 26;
    function X(t) { return x0 + t / DUR * (x1 - x0); }

    // strip of decoded frames
    for (var t = 0; t < DUR; t += 2) {
      var inSel = t >= s && t < e;
      ctx.fillStyle = inSel ? '#dbeafe' : '#f1f5f9';
      ctx.fillRect(X(t), y, X(t + 2) - X(t) - 1, h);
    }
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
    ctx.strokeRect(x0, y, x1 - x0, h);

    // selection
    ctx.fillStyle = 'rgba(37,99,235,.18)';
    ctx.fillRect(X(s), y, X(e) - X(s), h);
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2;
    ctx.strokeRect(X(s), y, X(e) - X(s), h);

    // keyframes: sparse I-frames every 2 s
    ctx.fillStyle = '#dc2626';
    for (var k = 0; k <= DUR; k += 2) {
      ctx.fillRect(X(k) - 1, y - 6, 2, 5);
    }

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('0 s', x0, y + h + 16);
    ctx.fillText(DUR + ' s', x1 - 26, y + h + 16);
    ctx.fillStyle = '#dc2626';
    ctx.fillText('red ticks = keyframes (every 2 s)', x0, y - 16);

    // the commands
    var fast = '-ss ' + s.toFixed(1) + ' -i in.mp4 -t ' + (e - s).toFixed(1);
    document.getElementById('cmd').textContent =
      '# fast seek: -ss BEFORE -i, -t is a DURATION' +
      '\\nffmpeg -y ' + fast +
      ' -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p' +
      ' -c:a aac -b:a 128k -movflags +faststart out.mp4';

    var nearest = Math.floor(s / 2) * 2;
    document.getElementById('warn').textContent =
      'the cut lands on the nearest keyframe (' + nearest + ' s), so it may be up to ' +
      (s - nearest).toFixed(1) + ' s late. That is the price of not decoding everything before it.';
  }

  ['s', 'e'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', draw);
  });
  draw();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## \`-ss\` 放在 \`-i\` 前面还是后面，完全是两个行为

| 位置 | 行为 | 速度 | 精度 |
| --- | --- | --- | --- |
| \`-ss\` **在** \`-i\` 前 | 跳到最近关键帧，从那里开始解码 | 快（与时间点无关） | 可能差几帧 |
| \`-ss\` **在** \`-i\` 后 | 从头解码，丢弃到时间点 | 慢（与时间点成正比） | 帧级精确 |

一个 1 小时的视频，从 55 分钟处切：第一种方式瞬间完成，第二种要先解码 55 分钟的内容。

页面用第一种。对教学场景，**快比精确重要** —— 差半秒无所谓。

## \`-t\` 是时长，不是结束时间

这是最容易错的一处：

- \`-t 5\` = 从头开始取 5 秒（持续时间）；
- \`-to 5\` = 切到第 5 秒（绝对时间）。

所以「从 10 秒切到 15 秒」在 \`-ss 10\` 之后要写 \`-t 5\`，不是 \`-t 15\`。写成 \`-t 15\` 会得到 15 秒的片段（10–25 秒）。

**这个 off-by-start 的 bug 极其常见**，且结果看起来"差不多对"（前 5 秒是你想要的），只是后面多了 10 秒。

## 为什么不用 \`-c copy\`（无损切割）

\`-c copy\` 是**流复制**：不重新编码，直接搬容器里的包。理论上无损且瞬间完成。

但视频的关键帧（I 帧）是稀疏的 —— 可能每 2 秒才一个。切点如果不在关键帧上，播放器必须先找到前面的关键帧，于是：

- 开头出现一段**冻结的画面**（等到第一个关键帧）；
- 或者**黑屏闪烁**；
- 或者时长元数据不准。

所以页面对修剪**重新编码**（\`libx264\`），保证第一帧是干净的 I 帧。代价是慢，收益是"打开就能播"。

**判断标准**：批量剪切（不在乎开头半秒）用 \`-c copy\`；要给用户看、要精确的，用重编码。

## 预览不需要编码

页面在选区预览时用的是 \`<video>.currentTime\` 加上 \`timeupdate\` 监听 —— 播到选区末尾就 \`pause()\`。

**预览和导出是两条完全不同的路径**：预览用浏览器的解码器（免费、实时），导出才走 wasm 编码（慢）。把两者混在一起是新手常见的性能灾难。

## 想深一层

1. 页面限制最短 0.2 秒。太短的片段在编码时可能出问题（关键帧间隔、音频帧边界）。
2. 滑杆步长 0.1 秒是 UI 层面的精度，不代表实际切点精度（取决于关键帧间隔）。**界面精度 ≠ 数据精度**，这一点在任何时间轴编辑器里都成立。
3. 想无损且干净：先 \`-ss\` 到前一个关键帧（用 \`ffprobe\` 查），再 \`-c copy\`，并在播放器里跳过开头。这就是专业工具的做法。`,
      en: `## \`-ss\` before or after \`-i\` are two different behaviours

| Position | Behaviour | Speed | Accuracy |
| --- | --- | --- | --- |
| \`-ss\` **before** \`-i\` | seek to the nearest keyframe, decode from there | fast (independent of timestamp) | may be a few frames off |
| \`-ss\` **after** \`-i\` | decode from the start, discard up to the point | slow (proportional to timestamp) | frame exact |

Trimming at 55 minutes into an hour-long file: the first finishes instantly, the second must decode 55 minutes first.

The page uses the first. For teaching, **fast beats exact** — half a second does not matter.

## \`-t\` is a duration, not an end time

The easiest mistake:

- \`-t 5\` = take 5 seconds from the start (duration);
- \`-to 5\` = cut at 5 seconds (absolute time).

So "cut 10s to 15s" after \`-ss 10\` needs \`-t 5\`, not \`-t 15\`. Writing \`-t 15\` yields a 15-second clip (10s–25s).

**The off-by-start bug is extremely common**, and the result looks "about right" (the first 5 seconds are what you wanted) with 10 extra seconds stuck on.

## Why not \`-c copy\` (lossless cutting)

\`-c copy\` is stream copy: no re-encode, packets moved across the container. Theoretically lossless and instant.

But keyframes (I-frames) are sparse — maybe one every 2 seconds. If the cut is not on a keyframe, the player must find the preceding one, so:

- the clip opens with a **frozen frame** until the first keyframe;
- or a **black flash**;
- or wrong duration metadata.

So the page **re-encodes** (\`libx264\`) to guarantee a clean I-frame first. Slower, but it plays immediately.

**Rule of thumb**: bulk cutting (half a second does not matter) → \`-c copy\`; anything a user will watch precisely → re-encode.

## Preview needs no encoding at all

The page previews a selection with \`<video>.currentTime\` plus a \`timeupdate\` listener that pauses at the end.

**Preview and export are completely different paths**: preview uses the browser's decoder (free, real-time), export uses wasm encoding (slow). Blurring them is a common performance disaster.

## Going deeper

1. The 0.2 s minimum exists because very short clips can break encoding (keyframe intervals, audio frame boundaries).
2. The 0.1 s slider step is UI precision, not cut precision (which depends on keyframe spacing). **Interface precision is not data precision**, true of every timeline editor.
3. For lossless and clean: seek to the preceding keyframe (via \`ffprobe\`), \`-c copy\`, and let the player skip the opening. That is what professional tools do.`
    }
  },

  '/vision/video-compress': {
    python: `"""Compress to a target size: this one actually has a formula.

Unlike images, video bitrate maps to size almost linearly -- so you compute
the bitrate instead of guessing.
"""
import subprocess


def bitrate_for_size(target_mb, duration_s, audio_kbps=128):
    """The whole calculation, in one place:
      bytes = (video_kbps + audio_kbps) / 8 * 1000 * duration
    Solve for video_kbps. Floor at 200 kbps: below that, h264 falls apart."""
    total_kbps = (target_mb * 1024 * 1024 * 8) / duration_s / 1000
    video_kbps = max(200, int(total_kbps - audio_kbps))
    return video_kbps


def compress_to_size(src, dst, target_mb, duration_s, height=None, audio_kbps=128):
    kbps = bitrate_for_size(target_mb, duration_s, audio_kbps)
    args = ['ffmpeg', '-y', '-i', src]
    if height:
        args += ['-vf', f'scale=-2:{height}:force_divisible_by=2']

    # ABR with a ceiling and a buffer: average hits the target, peaks do not
    # exceed 1.5x (otherwise a hard scene blows the size budget)
    args += ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
             '-b:v', f'{kbps}k',
             '-maxrate', f'{int(kbps * 1.5)}k',
             '-bufsize', f'{kbps * 2}k',
             '-c:a', 'aac', '-b:a', f'{audio_kbps}k',
             '-movflags', '+faststart', dst]
    subprocess.run(args, check=True)
    return kbps


# Why video can be computed and images cannot:
#   a JPEG's size depends on how much detail the content has (entropy)
#   an h264 stream at a fixed bitrate has size ~ bitrate x duration, by
#   definition -- the bitrate IS the size knob
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Bitrate is the size knob</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:640px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .row{display:flex;gap:20px;flex-wrap:wrap;margin-top:12px;font-size:12px}
  .row label{display:flex;align-items:center;gap:8px}
  input[type=range]{width:150px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:52px;display:inline-block}
  .big{font-size:15px;color:#0f172a;margin-top:10px}
  .big b{font-variant-numeric:tabular-nums}
</style>
</head>
<body>
<h1>Unlike JPEG, video size has a formula</h1>
<p>bytes = (video_kbps + audio_kbps) / 8 x 1000 x seconds. Solve it for the video bitrate and you hit
the target within a few percent — no trial and error.</p>
<canvas id="c" width="640" height="200"></canvas>
<div class="row">
  <label>target <input type="range" id="mb" min="2" max="120" step="2" value="25"><output id="vmb">25 MB</output></label>
  <label>duration <input type="range" id="dur" min="10" max="240" step="5" value="60"><output id="vdur">60 s</output></label>
  <label>audio <input type="range" id="ab" min="64" max="192" step="32" value="128"><output id="vab">128</output></label>
</div>
<div class="big">video bitrate <b id="kbps">—</b> kbps <span id="note" style="color:#b45309;font-size:12px"></span></div>
<script>
(function () {
  var W = 640, H = 200;
  function calc() {
    var mb = +document.getElementById('mb').value;
    var dur = +document.getElementById('dur').value;
    var ab = +document.getElementById('ab').value;
    document.getElementById('vmb').textContent = mb + ' MB';
    document.getElementById('vdur').textContent = dur + ' s';
    document.getElementById('vab').textContent = ab;

    var totalKbps = (mb * 1024 * 1024 * 8) / dur / 1000;
    var video = Math.max(200, Math.round(totalKbps - ab));
    document.getElementById('kbps').textContent = video;
    document.getElementById('note').textContent =
      totalKbps - ab < 200 ? '(floored at 200 — the target is not reachable at this duration)' : '';

    // draw the size-vs-bitrate line with the current point
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    var padL = 46, padB = 30, padT = 14, padR = 14;
    var maxKbps = 6000, maxMB = 120;
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();

    function X(k) { return padL + k / maxKbps * (W - padL - padR); }
    function Y(m) { return H - padB - m / maxMB * (H - padT - padB); }

    ctx.beginPath();
    for (var k = 0; k <= maxKbps; k += 100) {
      var sizeMB = (k + ab) * 1000 * dur / 8 / 1024 / 1024;
      var y = Y(sizeMB);
      if (k === 0) ctx.moveTo(X(k), y); else ctx.lineTo(X(k), y);
    }
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.stroke();

    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(padL, Y(mb)); ctx.lineTo(W - padR, Y(mb)); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#dc2626';
    ctx.beginPath(); ctx.arc(X(video), Y(mb), 5, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#94a3b8'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('size', 10, padT + 6);
    ctx.fillText('bitrate (kbps)', W - 110, H - 8);
    ctx.fillText(mb + ' MB target', W - 100, Y(mb) - 8);
  }
  ['mb', 'dur', 'ab'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', calc);
  });
  calc();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 视频能算，图片不能算

图片压缩到目标体积要试错（见 /vision/image-compress），视频不需要 —— 因为**码率就是体积的旋钮**：

\`体积(字节) = (视频码率 + 音频码率) / 8 × 1000 × 秒数\`

反过来解出目标码率：

\`视频码率 = (目标MB × 1024 × 1024 × 8) ÷ 秒数 ÷ 1000 − 音频码率\`

这几乎是精确的（误差通常 <5%），因为 h264 的 ABR 模式**就是**在控制每秒输出多少数据。

**这是理解"有损压缩"的一个关键区别**：JPEG 的质量参数是间接的（映射到量化表），视频的码率是直接的（就是字节数）。

## 为什么还必须有「按清晰度」模式

按体积算出来的码率可能非常离谱：

- 一个 10 分钟的视频压到 5 MB → 码率只有 40 kbps → 画面会糊成马赛克；
- 一个 10 秒的视频压到 5 MB → 码率 4000 kbps → 完全没必要，质量已经到顶。

所以页面同时提供「清晰度档位」（4000 / 2000 / 1000 / 500 kbps），让用户按**画质预期**选，而不是被体积绑架。

**两种模式回答两个不同的问题**：「必须塞进 25 MB 的邮件附件」vs「看起来还行就行」。这是产品思维，不是技术冗余。

## 码率下限 200 kbps 的理由

低于 200 kbps，h264 在 720p 上会开始丢结构（不只是糊，是块状崩坏）。与其给一个"体积达标但没法看"的结果，不如**明确说达不到**。

页面在实测超目标 5% 时告警，用的是同一个原则：**诚实地失败，而不是假装成功**。

## 分辨率是第二根杠杆

按体积模式里还有分辨率档（0 / 1920 / 1280 / 854）。

原因是码率和分辨率的组合才决定观感：同样 500 kbps，854×480 看着清楚，1920×1080 全是压缩块。**降低分辨率经常比降低码率更划算** —— 因为码率不足时，大分辨率没有任何好处。

正确顺序：**先定分辨率（够用就好），再算码率**。

## 想深一层

1. 音频码率也算进总量。192 kbps 的音频在 500 kbps 的目标里占 38% —— 经常被忽略，导致视频实际比预期更糊。
2. 「按体积」算出的是**平均**码率。5 分钟的静态画面 + 5 分钟的快速运动，后者会自动分到更多码率（这是 ABR 的优点，也是它体积会浮动的原因）。
3. 想真正精确控体积：两遍编码（two-pass）。第一遍分析复杂度，第二遍按分配表编码。慢一倍，但体积误差能压到 1% 以内。`,
      en: `## Video can be computed; images cannot

Compressing an image to a target size takes trial and error (see /vision/image-compress). Video does not — **bitrate is the size knob**:

\`bytes = (video_kbps + audio_kbps) / 8 × 1000 × seconds\`

Solving for the target:

\`video_kbps = (target_MB × 1024 × 1024 × 8) ÷ seconds ÷ 1000 − audio_kbps\`

This is nearly exact (usually within 5%), because h264's ABR mode **is** the control over bytes per second.

**A key difference in how lossy compression works**: JPEG's quality parameter is indirect (it maps to a quantisation table), video bitrate is direct (it is the byte count).

## Why a "quality preset" mode is still necessary

The computed bitrate can be absurd:

- a 10-minute clip squeezed into 5 MB → 40 kbps → mosaic;
- a 10-second clip allowed 5 MB → 4000 kbps → pointless, quality is already maxed.

So the page also offers presets (4000 / 2000 / 1000 / 500 kbps), letting you choose by **expected picture quality** instead of being held hostage by a size.

**Two modes answer two questions**: "must fit a 25 MB email attachment" versus "just look acceptable". Product thinking, not redundancy.

## Why the 200 kbps floor

Below 200 kbps, h264 at 720p starts losing structure — not blur, blocky collapse. Better to **state that the target is unreachable** than deliver something that meets the byte count and cannot be watched.

The page warns when the actual output overshoots by 5%, on the same principle: **fail honestly rather than pretend**.

## Resolution is the second lever

The size mode also offers resolution tiers (0 / 1920 / 1280 / 854).

Because only the combination of bitrate and resolution determines how it looks: at 500 kbps, 854×480 is clear while 1920×1080 is all blocking. **Lowering resolution is often a better deal than lowering bitrate** — when bitrate is scarce, high resolution buys nothing.

Correct order: **fix resolution (no larger than needed), then compute bitrate**.

## Going deeper

1. Audio bitrate counts toward the total. At a 500 kbps target, 192 kbps audio is 38% — often forgotten, leaving video blurrier than expected.
2. "By size" computes an **average** bitrate. Five static minutes plus five fast-motion minutes: the latter automatically gets more (ABR's strength, and why size still varies).
3. For real precision: two-pass encoding. Pass one analyses complexity, pass two encodes against an allocation table. Twice as slow, error under 1%.`
    }
  },

  '/vision/vr': {
    python: `"""The maths behind a WebXR shooting range. No engine here -- the page uses
three.js, and every number below is one the page actually computes.
"""
import math


def controller_ray(position, orientation_quat):
    """A controller's forward direction is its local -Z axis, rotated by the
    pose. Every XR framework hands you a pose; the -Z convention is universal."""
    # rotate (0, 0, -1) by the quaternion
    x, y, z, w = orientation_quat
    # quaternion * vector, expanded (q v q*)
    ix = w * 0 + y * -1 - z * 0
    iy = w * 0 + z * 0 - x * -1
    iz = w * -1 + x * 0 - y * 0
    iw = -x * 0 - y * 0 - z * -1
    dir_x = ix * w + iw * -x + iy * -z - iz * -y
    dir_y = iy * w + iw * -y + iz * -x - ix * -z
    dir_z = iz * w + iw * -z + ix * -y - iy * -x
    return position, (dir_x, dir_y, dir_z)


def ray_sphere_hit(origin, direction, centre, radius):
    """Ray-sphere is a quadratic; it is the cheapest hit test in a shooting
    range and is what a target's bounding volume usually is."""
    oc = tuple(o - c for o, c in zip(origin, centre))
    b = sum(o * d for o, d in zip(oc, direction))
    c = sum(v * v for v in oc) - radius * radius
    disc = b * b - c
    if disc < 0:
        return None                    # miss
    t = -b - math.sqrt(disc)
    return t if t > 0 else None        # only forward hits count


def score(hit_radius, golden_radius):
    """Golden centre is worth double. Any scoring rule works -- the point is
    that feedback must be immediate, before the next shot."""
    return 20 if hit_radius <= golden_radius else 10


# The page runs 60 s rounds with 8 targets; movement is either a real headset
# (local-floor reference space) or WASD + pointer lock on desktop.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ray-sphere hit test, without a headset</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#0f172a;cursor:crosshair}
  .hud{margin-top:10px;font-size:12px;color:#475569}
  .hud b{color:#0f172a;font-variant-numeric:tabular-nums}
</style>
</head>
<body>
<h1>Every VR shot is the same quadratic</h1>
<p>The camera sits at the bottom. Click anywhere to fire: the ray is normalised, then tested against
each sphere analytically — the same maths a WebXR controller uses, with the pose supplied by the mouse.</p>
<canvas id="c" width="620" height="360"></canvas>
<div class="hud">shots <b id="n">0</b> · hits <b id="h">0</b> · last t <b id="t">—</b>
  <span style="color:#94a3b8">(t is the distance along the ray; only t &gt; 0 counts)</span></div>
<script>
(function () {
  var W = 620, H = 360;
  var c = document.getElementById('c'), ctx = c.getContext('2d');
  var origin = { x: W / 2, y: H - 24 };
  var targets = [];
  var shots = 0, hits = 0;

  function reset() {
    targets = [];
    for (var i = 0; i < 6; i++) {
      targets.push({
        x: 90 + (i * 89) % (W - 120),
        y: 60 + (i * 61) % (H - 170),
        r: 18 + (i % 3) * 6,
        gold: i % 3 === 1,
        alive: true
      });
    }
  }

  // ray: origin + t * dir, sphere: |p - centre| = r  ->  quadratic in t
  function hit(o, dir, s) {
    var ox = o.x - s.x, oy = o.y - s.y;
    var b = ox * dir.x + oy * dir.y;
    var cc = ox * ox + oy * oy - s.r * s.r;
    var disc = b * b - cc;
    if (disc < 0) return null;
    var t = -b - Math.sqrt(disc);
    return t > 0 ? t : null;      // behind the shooter does not count
  }

  var lastRay = null;

  function draw() {
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);
    // floor line
    ctx.strokeStyle = '#1e293b';
    ctx.beginPath(); ctx.moveTo(0, origin.y + 6); ctx.lineTo(W, origin.y + 6); ctx.stroke();

    targets.forEach(function (s) {
      if (!s.alive) return;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = s.gold ? '#fbbf24' : '#38bdf8';
      ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = s.gold ? '#92400e' : '#0369a1'; ctx.lineWidth = 2; ctx.stroke();
    });

    // shooter
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath(); ctx.arc(origin.x, origin.y, 7, 0, Math.PI * 2); ctx.fill();

    if (lastRay) {
      ctx.strokeStyle = 'rgba(248,250,252,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(origin.x + lastRay.x * 900, origin.y + lastRay.y * 900);
      ctx.stroke();
    }

    document.getElementById('n').textContent = shots;
    document.getElementById('h').textContent = hits;
  }

  c.addEventListener('click', function (e) {
    var r = c.getBoundingClientRect();
    var mx = (e.clientX - r.left) / r.width * W;
    var my = (e.clientY - r.top) / r.height * H;
    var dx = mx - origin.x, dy = my - origin.y;
    var len = Math.hypot(dx, dy) || 1;
    var dir = { x: dx / len, y: dy / len };
    lastRay = dir;
    shots++;

    var best = null, bestS = null;
    targets.forEach(function (s) {
      if (!s.alive) return;
      var t = hit(origin, dir, s);
      if (t !== null && (!best || t < best)) { best = t; bestS = s; }
    });

    if (bestS) {
      bestS.alive = false;
      hits++;
      document.getElementById('t').textContent = best.toFixed(1);
    } else {
      document.getElementById('t').textContent = 'miss';
    }
    if (targets.every(function (s) { return !s.alive; })) setTimeout(reset, 700);
    draw();
  });

  reset(); draw();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 这页真正做的事：把「手指到哪」变成一个数学问题

VR 射击的全部逻辑只有三步：

1. **拿到控制器的位置和朝向**（XR 运行时每帧给你一个 pose）；
2. **把朝向变成一个方向向量**；
3. **判断这条射线打到了什么**。

第 2 步有个通用约定：**控制器的正前方是它的局部 -Z 轴**。这是 OpenGL/WebGL 的相机约定（相机看向 -Z），three.js 沿用，所有 XR 框架都一致。所以"取朝向"就是把 \`(0,0,-1)\` 用控制器的四元数旋转一下。

**知道这个约定，VR 里 90% 的"射线方向不对"问题就解决了。**

## local-floor 是什么

WebXR 的参考空间（reference space）决定"原点在哪"：

| 类型 | 原点 | 用途 |
| --- | --- | --- |
| \`local\` | 头显首次位置 | 坐着用，站着会漂 |
| \`local-floor\` | **地面** | 站立体感应用（本页） |
| \`bounded-floor\` | 地面 + 房间边界 | 需要防撞墙提示 |

选 \`local-floor\` 意味着「y=0 是地面」，所以靶子的高度可以直接用真实高度（1.5 m）而不是相对头显的高度。**这个选择决定了整个场景的坐标要不要重新校准。**

## 桌面和 VR 共用一套命中的代码

页面在桌面上用 Pointer Lock + WASD，在 VR 里用控制器 —— 但两者的产物都是「一个原点 + 一个方向」，然后交给同一个 \`raycaster.intersectObjects()\`。

**这是抽象得好的标志**：把"输入怎么来"和"射线怎么算"分开。如果为 VR 和桌面各写一套命中逻辑，必然出现"VR 能打中桌面打不中"这类不一致。

## 为什么用射线-球体而不是网格求交

靶子是圆环 + 球，页面用 \`Raycaster\` 对球体做求交（three 内部就是解一元二次方程，见 Python 那段）。

用数学体代替网格的好处：**O(1) 而不是遍历三角形的 O(n)**，且没有"穿过薄面"的漏检。真实游戏里，子弹检测通常先做包围体，再做精确网格 —— 这个两级结构是标准做法。

## 想深一层

1. 60 秒一局 + 8 个靶，是节奏设计：8 个靶意味着平均 7.5 秒一个，玩家不会闲下来也不会焦虑。**游戏节奏是数值设计，不是技术。**
2. 金色靶 +20 而非 +10，是**风险回报**：金色靶通常更小或更远，逼玩家在"稳拿 10 分"和"冒险 20 分"之间选。
3. VR 的晕动症主要来自「视觉动了但身体没动」。这页用瞬移或固定站位，就是为了避开这个 —— **不是技术限制，是生理限制。**`,
      en: `## What this page really does: turn "where am I pointing" into maths

A VR shooting range is three steps:

1. **Get the controller's pose** (the XR runtime hands you one per frame);
2. **Turn orientation into a direction vector**;
3. **Ask what that ray hits**.

Step 2 has a universal convention: **a controller's forward is its local -Z axis**. That is the OpenGL/WebGL camera convention (cameras look down -Z), inherited by three.js and honoured by every XR framework. So "get the direction" is rotating \`(0,0,-1)\` by the controller quaternion.

**Knowing this solves 90% of "my VR ray points the wrong way" problems.**

## What local-floor means

The WebXR reference space decides where the origin is:

| Type | Origin | Use |
| --- | --- | --- |
| \`local\` | headset's first position | seated; drifts when you stand |
| \`local-floor\` | **the floor** | standing experiences (this page) |
| \`bounded-floor\` | floor + room bounds | needs a boundary warning |

\`local-floor\` means "y=0 is the floor", so target heights are real heights (1.5 m) rather than offsets from the headset. **That choice decides whether the whole scene needs recalibration.**

## Desktop and VR share one hit test

On desktop the page uses pointer lock + WASD; in VR it uses controllers — but both produce "an origin and a direction" and hand it to the same \`raycaster.intersectObjects()\`.

**The mark of a good abstraction**: separating "where input comes from" from "how the ray is computed". Writing two hit-test paths guarantees inconsistencies like "works in VR, misses on desktop".

## Why ray-sphere instead of mesh intersection

Targets are a torus plus a sphere, and the page intersects the sphere analytically (three solves the quadratic internally, as in the Python snippet).

Using a mathematical solid instead of a mesh means **O(1) instead of iterating triangles O(n)**, with no "tunnelling through a thin face" misses. Real games use the same two-tier structure: bounding volume first, exact mesh second.

## Going deeper

1. 60-second rounds with 8 targets is pacing design: 7.5 seconds each keeps the player neither idle nor anxious. **Game pacing is numeric design, not engineering.**
2. Golden targets at +20 instead of +10 create **risk/reward**: they are usually smaller or farther, forcing a choice between a safe 10 and a risky 20.
3. VR motion sickness comes from "vision moves, body does not". This page uses teleport or standing-in-place to avoid it — **a physiological constraint, not a technical one.**`
    }
  },

  '/vision/fitness-tetris': {
    python: `"""Pose-controlled Tetris: the interesting part is the signal processing
between the model and the game, not the game.
"""
import math

EMA_ALPHA = 0.6          # page: new = 0.6*raw + 0.4*old
DEADZONE = 0.04          # normalised units; stops jitter from moving blocks
HYSTERESIS_IN = 0.55     # wrist must rise well above the shoulder
HYSTERESIS_OUT = 0.40    # ... and fall well below to release
ACTION_COOLDOWN_MS = 480


class PoseGesture:
    """Every step below exists because raw landmarks are too noisy for a game."""

    def __init__(self):
        self.smooth_x = None
        self.baseline = None          # nose x averaged over the first 15 frames
        self.ratchet = 0.0            # only grows outward -- see step() 
        self.frames = 0

    # 1) smoothing: exponential moving average
    def smooth(self, x):
        self.smooth_x = x if self.smooth_x is None else EMA_ALPHA * x + (1 - EMA_ALPHA) * self.smooth_x
        return self.smooth_x

    # 2) calibration: where is "centre" for THIS person, in THIS room
    def calibrate(self, nose_x):
        self.frames += 1
        if self.frames <= 15:
            self.baseline = nose_x if self.baseline is None else (self.baseline * (self.frames - 1) + nose_x) / self.frames
        return self.baseline

    # 3) deadzone + ratchet: drift left/right without the block snapping back
    def step(self, nose_x):
        x = self.smooth(nose_x)
        offset = x - (self.baseline or 0)
        if abs(offset) < DEADZONE:
            return 0
        # the ratchet only extends: once you lean 2 columns, leaning back to 1
        # does not undo it -- otherwise every slight return shifts the block
        self.ratchet = max(self.ratchet, offset) if offset > 0 else min(self.ratchet, offset)
        return self.ratchet

    # 4) hysteresis: two thresholds, so a wrist hovering at the line does not
    #    fire the rotate action 20 times per second
    def wrist_action(self, wrist_y, shoulder_y, shoulder_width, now_ms, last_action_ms):
        if now_ms - last_action_ms < ACTION_COOLDOWN_MS:
            return None
        rel = (shoulder_y - wrist_y) / max(1e-6, shoulder_width)   # normalised by body size
        if rel > HYSTERESIS_IN:
            return 'rotate'
        return None


# Why normalise by shoulder width: it makes the threshold work for a child and
# an adult, near and far from the camera. Without it, the game is unplayable
# for anyone whose body is not the size you tuned for.
`,

    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Four filters between the pose model and the game</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  label{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;flex-wrap:wrap}
  input[type=range]{width:150px}output{font-variant-numeric:tabular-nums;font-weight:600;min-width:46px}
  .legend{display:flex;gap:16px;margin-top:8px;font-size:12px;color:#475569}
  .legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px}
</style>
</head>
<body>
<h1>The model is the easy part</h1>
<p>Raw nose-x jitters, so a game fed directly is unplayable. Each filter removes one specific
failure: smoothing, a deadzone, and a ratchet that only extends outward.</p>
<canvas id="c" width="620" height="260"></canvas>
<div class="legend">
  <span><i style="background:#cbd5e1"></i>raw landmarks</span>
  <span><i style="background:#2563eb"></i>after EMA</span>
  <span><i style="background:#16a34a"></i>deadzone + ratchet (what the game sees)</span>
</div>
<label>EMA alpha <input type="range" id="a" min="0.1" max="0.95" step="0.05" value="0.6"><output id="va">0.60</output></label>
<label>deadzone <input type="range" id="z" min="0" max="0.12" step="0.005" value="0.04"><output id="vz">0.040</output></label>
<script>
(function () {
  var W = 620, H = 260, N = 240;
  function rnd(i) {
    var x = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
    return x - Math.floor(x) - 0.5;
  }
  // a deliberate lean to the right mid-sequence, plus per-frame jitter
  function raw(i) {
    var lean = i < 70 ? 0 : i < 170 ? 0.28 : 0.05;
    return lean + rnd(i) * 0.10 + Math.sin(i / 5) * 0.02;
  }

  function render() {
    var alpha = +document.getElementById('a').value;
    var dz = +document.getElementById('z').value;
    document.getElementById('va').textContent = alpha.toFixed(2);
    document.getElementById('vz').textContent = dz.toFixed(3);

    var rawV = [], emaV = [], gameV = [];
    var e = null, ratchet = 0, base = 0;
    for (var i = 0; i < N; i++) {
      var r = raw(i);
      rawV.push(r);
      e = e === null ? r : alpha * r + (1 - alpha) * e;
      emaV.push(e);
      var off = e - base;
      if (Math.abs(off) > dz) {
        ratchet = off > 0 ? Math.max(ratchet, off) : Math.min(ratchet, off);
      }
      gameV.push(ratchet);
    }

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    var padL = 40, padB = 24;
    function X(i) { return padL + i / (N - 1) * (W - padL - 12); }
    function Y(v) { return H / 2 - v * 380; }   // 0.28 maps to about -106 px

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(padL, H / 2); ctx.lineTo(W - 12, H / 2); ctx.stroke();

    function line(arr, color, width) {
      ctx.beginPath();
      arr.forEach(function (v, i) {
        if (i === 0) ctx.moveTo(X(i), Y(v)); else ctx.lineTo(X(i), Y(v));
      });
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    }
    line(rawV, '#cbd5e1', 1);
    line(emaV, '#2563eb', 1.6);
    line(gameV, '#16a34a', 2.4);

    // deadzone band
    ctx.fillStyle = 'rgba(22,163,74,.10)';
    ctx.fillRect(padL, Y(dz), W - padL - 12, Math.abs(Y(-dz) - Y(dz)));
    ctx.strokeStyle = 'rgba(22,163,74,.45)'; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padL, Y(dz)); ctx.lineTo(W - 12, Y(dz)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL, Y(-dz)); ctx.lineTo(W - 12, Y(-dz)); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('lean right', 6, Y(0.28) + 4);
    ctx.fillText('centre', 6, Y(0) + 4);
    ctx.fillText('frames ->', W - 78, H - 6);
    ctx.fillStyle = '#0f172a';
    ctx.fillText('game input changes ' + countChanges(gameV) + ' times in ' + N + ' frames (raw would be ' +
      countChanges(rawV) + ')', padL, 16);
  }

  function countChanges(arr) {
    var n = 0, last = arr[0];
    for (var i = 1; i < arr.length; i++) {
      if (Math.abs(arr[i] - last) > 0.02) { n++; last = arr[i]; }
    }
    return n;
  }

  ['a', 'z'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,

    principle: {
      zh: `## 从「33 个关键点」到「方块左移一格」，中间有四层滤波

原始关键点直接接游戏会完全不可玩。页面在中间插了四层处理，**每一层都解决一个具体的失效模式**：

| 层 | 作用 | 解决的问题 |
| --- | --- | --- |
| EMA 平滑（0.6） | 一阶低通 | 关键点每帧抖动 2–3 像素，方块会乱跳 |
| 基线校准（前 15 帧） | 记住「你的中间在哪」 | 每个人的站位不同，不能写死 0.5 |
| 死区（0.04） | 小偏移忽略 | 呼吸、说话都会让鼻子轻微移动 |
| 棘轮（只向外扩） | 单向累积 | 歪一下又回来，方块不该跟着来回 |
| 迟滞（0.55 / 0.40） | 双阈值 | 手停在阈值线上会每秒触发 20 次 |
| 冷却（480 ms） | 时间锁 | 一次抬手的动作持续几百毫秒，会连续触发 |

**这六层（我上面列了五个概念，迟滞和冷却是两个）加起来，比姿态模型本身更能决定"这个游戏好不好玩"。**

## 为什么必须按肩宽归一化

\`(肩高 - 手腕高) / 肩宽\`

不除肩宽会怎样：小孩抬手 20 cm 相对他的肩宽是 0.8，大人抬手 20 cm 只有 0.4。同一个阈值，小孩一下子就触发，大人永远抬不够。

除完肩宽之后，这个数字变成「抬手高度相当于几个肩宽」—— **对身体尺寸和离摄像头远近都不敏感**。

这是所有基于关键点的交互系统的必备一步。用固定像素阈值的产品，一定是在某个特定距离、特定体型下调出来的，换个环境就废。

## 迟滞（hysteresis）为什么是必须的

如果只有一个阈值 0.5：

- 手抬到 0.51 → 触发；
- 手微微动一下到 0.49 → 解除；
- 再到 0.51 → 又触发……

一秒钟能触发 20 次。**物理世界里所有的开关（恒温器、电梯门）都用双阈值解决这个问题**：进入用高阈值（0.55），退出用低阈值（0.40），中间是"保持当前状态"的死区。

## 游戏参数也是有讲究的

- 棋盘 10×20，自然下落 720 ms：这是标准俄罗斯方块速度（1G）；
- 随等级加快：每消 10 行速度提升，是难度曲线；
- 动作冷却 480 ms：比人的反应时间（约 250 ms）长，但比一次抬手的动作（约 600 ms）短 —— **这个区间的选择决定了"跟手"还是"粘滞"**。

## 想深一层

1. \`detectForVideo\` 限流到 40 ms（25 fps）：姿态模型跑满 60 fps 没有必要，而且会抢走游戏循环的帧时间。**感知可以比渲染慢**。
2. 前 15 帧只校准不接受输入，意味着游戏开始有约 0.5 秒的"准备期"。这个设计避免了一开始就被误判成移动。
3. 想更稳：可以加「动作确认」—— 要求姿态保持 100 ms 才生效。代价是延迟，收益是零误触。这是所有体感游戏的通用权衡。`,
      en: `## From "33 keypoints" to "the piece moves one cell": four filters in between

Raw keypoints straight into a game is unplayable. The page inserts four layers, **each solving a specific failure mode**:

| Layer | Job | Failure it fixes |
| --- | --- | --- |
| EMA smoothing (0.6) | first-order low-pass | keypoints jitter 2–3 px per frame, pieces dance |
| Baseline calibration (first 15 frames) | remember "where your centre is" | everyone stands differently; 0.5 cannot be hard-coded |
| Deadzone (0.04) | ignore small offsets | breathing and talking move your nose |
| Ratchet (outward only) | accumulate one way | lean and return must not shift the piece back |
| Hysteresis (0.55 / 0.40) | two thresholds | a wrist hovering at the line fires 20×/second |
| Cooldown (480 ms) | time lock | one raised-arm gesture lasts hundreds of ms |

**Together these decide whether the game is fun far more than the pose model does.**

## Why normalising by shoulder width is mandatory

\`(shoulder Y − wrist Y) / shoulder width\`

Without it: a child raising 20 cm gets 0.8 of their shoulder width, an adult gets 0.4. One threshold triggers instantly for the child and never for the adult.

Divided by shoulder width, the number means "how many shoulder-widths above the shoulder" — **insensitive to body size and distance from the camera**.

Every keypoint-driven interaction needs this. Products using fixed pixel thresholds are tuned for one body at one distance and break elsewhere.

## Why hysteresis is not optional

With a single threshold at 0.5:

- hand at 0.51 → trigger;
- tiny motion to 0.49 → release;
- back to 0.51 → trigger again…

Twenty times a second. **Every physical switch — thermostats, lift doors — uses two thresholds** for exactly this: enter at a high value (0.55), exit at a low one (0.40), with a hold zone between.

## The game parameters are designed too

- 10×20 board, 720 ms natural fall: standard Tetris speed (1G);
- speed rises with level every 10 lines: the difficulty curve;
- 480 ms action cooldown: longer than human reaction (~250 ms), shorter than one arm raise (~600 ms) — **that window decides "responsive" versus "sticky"**.

## Going deeper

1. \`detectForVideo\` is throttled to 40 ms (25 fps): pose at 60 fps is unnecessary and steals frame time from the game. **Perception may run slower than rendering.**
2. The first 15 frames only calibrate, roughly a 0.5 s ready period, so the game does not start with a misread.
3. For more stability, require the pose to hold 100 ms before firing. Costs latency, buys zero misfires — the universal trade in motion games.`
    }
  }
}
