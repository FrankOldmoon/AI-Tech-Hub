import * as faceapi from './face-api.esm.js';
window.faceapi = faceapi;

const $ = (s) => document.querySelector(s);
const stage = $('#stage'), overlay = $('#overlay');
const ctx = overlay.getContext('2d');
const card = $('#card'), cardWho = $('#cardWho'), cardMeta = $('#cardMeta'), cardRows = $('#cardRows');
const shutter = $('#shutter'), btnExit = $('#btnExit'), btnFlip = $('#btnFlip'), zoomBadge = $('#zoomBadge'), perfEl = $('#perf'), cropCanvas = $('#crop');
const choiceUpload = $('#choiceUpload'), choiceCamera = $('#choiceCamera');
const intro = $('#intro'), statusEl = $('#status'), fileInput = $('#file');

const params = new URLSearchParams(location.search);
const thresholdParam = parseFloat(params.get('threshold'));

// ---------- state ----------
let mode = null;              // 'image' | 'camera'
let media = null;             // <img> | <video>
let stream = null;
let facing = 'environment';   // rear by default on phones
let mirrored = false;
let results = [];             // latest detection results, in source pixels
let sourceSize = { w: 0, h: 0 };
let busy = false, loopId = null;

// ---------- boot ----------
// 这里是 Nuxt 页面 /face 的客户端主体（旧 public/face/index.html 的 <script type="module">）。
// 资源必须写绝对路径：页面 URL 是 /face（无尾斜杠），相对路径会解析到站点根目录，
// 变成 /students-face-data.json、/models —— 全都 404。
const rec = await createFaceRecognizer({
  faceapi,
  dataUrl: '/face/students-face-data.json',
  modelUrl: '/face/models',
  // 检测器：tinyFaceDetector 比 ssdMobilenetv1 快约 3.9×（实测同图检出结果一致），
  // 代价是更远/更小的脸容易漏检。想换回来：控制台执行 rec.setDetector('ssdMobilenetv1')
  // （SSD 模型会按需加载，不必重启页面）。inputSize 可再降到 320 换更多速度。
  detector: 'tinyFaceDetector',
  scoreThreshold: 0.35,
  topK: 1,
  debug: true,
});
if (Number.isFinite(thresholdParam)) rec.setThreshold(thresholdParam);
window.rec = rec;   // for console debugging

// Two calibrated thresholds: a photo is the same domain as the gallery (strict),
// a live camera frame is not (looser). See meta.calibration in the JSON.
const T_IMAGE  = rec.meta.suggestedMatchThreshold;         // 0.24
const T_CAMERA = rec.meta.suggestedMatchThresholdLiveCam;  // 0.35
const useThreshold = (t) => rec.setThreshold(Number.isFinite(thresholdParam) ? thresholdParam : t);

for (const btn of [choiceUpload, choiceCamera]) btn.setAttribute('aria-disabled', 'false');
statusEl.textContent = '';   // #status only speaks when loading or on error

// ---------- geometry: view transform (source px -> dest px) ----------
// 基准是 contain（完整画面都留在屏内、不裁切），再叠加显示层缩放 displayZoom()：
//   p -> anchor + (p*fit + o0 - anchor) * z
// 展开即 scale = fit*z、offset = anchor + (o0 - anchor)*z。
// 注意 displayZoom() 在摄像头模式下恒为 1 —— 那时放大由摄像头流本身（设备变焦）或
// 裁剪画布（数字变焦，sourceSize 就是裁剪尺寸）承担，显示层不能再叠一次。
function viewTransform(sw, sh, dw, dh){
  const z = displayZoom();
  const fit = Math.min(dw / sw, dh / sh);          // contain
  const scale = fit * z;
  const o0x = (dw - sw * fit) / 2, o0y = (dh - sh * fit) / 2;
  return {
    scale,
    ox: zoomAnchor.x + (o0x - zoomAnchor.x) * z,
    oy: zoomAnchor.y + (o0y - zoomAnchor.y) * z,
  };
}
function mapBox(b, tf, dw){
  let x = b.x * tf.scale + tf.ox;
  let y = b.y * tf.scale + tf.oy;
  const w = b.width * tf.scale, h = b.height * tf.scale;
  if (mirrored) x = dw - x - w;   // front camera preview is mirrored
  // 数字变焦时整块画面被平移（让捏合点停在原地），框必须跟着平移，否则会错位
  if (usesCropZoom()){ x += cropOffset.x; y += cropOffset.y; }
  return { x, y, w, h };
}

// ---------- overlay sizing ----------
function sizeOverlay(){
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cw = stage.clientWidth, ch = stage.clientHeight;
  overlay.width = Math.round(cw * dpr);
  overlay.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // draw in CSS pixels from here on
  return { cw, ch };
}

// ---------- paint boxes ----------
function paint(target, dets, sw, sh, tf, renderedW){
  const fs = Math.max(12, Math.min(22, renderedW / 26));
  const pad = fs * 0.42;
  target.font = `600 ${fs}px -apple-system,"Segoe UI",Roboto,sans-serif`;
  target.textBaseline = 'middle';

  for (const d of dets){
    const b = mapBox(d.box, tf, renderedW);
    const hit = d.matched;
    const color = hit ? '#10b981' : '#ef4444';

    // box
    target.lineWidth = Math.max(2.5, fs / 4.5);
    target.strokeStyle = color;
    target.strokeRect(b.x, b.y, b.w, b.h);

    // label
    const text = hit
      ? `${d.student.class} ${d.student.chineseName}${d.student.preferredName ? ' / ' + d.student.preferredName : ''} · ${d.distance.toFixed(3)}`
      : `Unknown · ${d.distance.toFixed(3)}`;
    const tw = Math.min(target.measureText(text).width + pad * 2, Math.max(fs * 4, renderedW - b.x));
    const th = fs + pad * 1.5;
    const ty = b.y - th >= 0 ? b.y - th : b.y;
    target.fillStyle = color;
    if (target.roundRect){
      target.beginPath();
      target.roundRect(b.x, ty, tw, th, Math.min(6, th / 3));
      target.fill();
    } else {
      target.fillRect(b.x, ty, tw, th);
    }
    target.fillStyle = '#fff';
    target.fillText(text, b.x + pad, ty + th / 2 + 0.5, tw - pad * 2);
  }
}
function render(){
  const { cw, ch } = sizeOverlay();
  ctx.clearRect(0, 0, cw, ch);
  if (!results.length || !sourceSize.w) return;
  const tf = viewTransform(sourceSize.w, sourceSize.h, cw, ch);
  paint(ctx, results, sourceSize.w, sourceSize.h, tf, cw);
}

// ---------- zoom：三种实现方式 ----------
// #stage 已是 touch-action:none，且下面拦掉了 iOS 的 gesturestart，所以双指缩放由这里自己实现。
// 1) 图片模式：CSS 放大 —— 只影响显示。上传的图不必因为放大而重跑推理，所以保持这个简单做法。
// 2) 摄像头 + 设备支持 zoom 能力：直接驱动摄像头真变焦，流本身就变了，
//    于是显示 / 识别输入 / 拍下来的照片三者一致，放大真正有效。
// 3) 摄像头 + 设备不支持（iOS Safari、许多摄像头）：把「裁剪后的画面」同时喂给显示与模型。
//    这仍是数字变焦，但放大后远处小脸在模型输入里占比变大，能实打实改善检出
//    —— 正好补 tiny 检测器最容易漏小脸的短板。
const ZOOM_MIN = 1, ZOOM_MAX = 8;
let zoom = 1;
let zoomAnchor = { x: 0, y: 0 };       // 屏幕坐标锚点（只给图片模式的 CSS 放大用）
let zoomFocus = { x: 0.5, y: 0.5 };    // 原始帧归一化焦点（只给摄像头的裁剪变焦用）
let zoomMode = 'digital';              // 'camera' = 设备变焦可用 | 'digital' = 走裁剪
let deviceZoom = null;                 // MediaSettingsRange | null
let videoTrack = null;
let cropRect = null;                   // 当前裁剪区域（源像素）；null = 未裁剪
let cropOffset = { x: 0, y: 0 };       // 裁剪画布的屏幕平移：让捏合点下的画面停在原地（否则会跳到屏幕中心）
const pointers = new Map();
let pinch = null;                      // { dist, zoom }：手势起始的两指间距与当时的 zoom
let badgeTimer = null;

/** 显示层/映射用的缩放倍数：摄像头模式下放大由「流」或「裁剪」承担，显示层不再叠 CSS 变换 */
function displayZoom(){ return mode === 'image' ? zoom : 1 }
function usesCropZoom(){ return mode === 'camera' && zoomMode === 'digital' && zoom > 1 }

function fullSourceSize(){
  const src = media;
  if (!src) return { w: 0, h: 0 };
  return { w: src.videoWidth || src.naturalWidth || 0, h: src.videoHeight || src.naturalHeight || 0 };
}

function clampZoom(z){
  const hasRange = zoomMode === 'camera' && deviceZoom;
  const lo = hasRange ? Math.max(ZOOM_MIN, deviceZoom.min) : ZOOM_MIN;
  const hi = hasRange ? Math.min(ZOOM_MAX, deviceZoom.max) : ZOOM_MAX;
  return Math.min(hi, Math.max(lo, z));
}

/** 读摄像头的 zoom 能力；拿不到有效范围就当作不支持（Safari 没有 getCapabilities） */
function readZoomRange(track){
  try {
    const caps = track && track.getCapabilities ? track.getCapabilities() : null;
    const z = caps && caps.zoom;
    if (z && typeof z.max === 'number' && z.max > (typeof z.min === 'number' ? z.min : 1)) {
      return {
        min: typeof z.min === 'number' ? z.min : 1,
        max: z.max,
        step: typeof z.step === 'number' ? z.step : 0.1,
      };
    }
  } catch (_) { /* 忽略：按不支持处理 */ }
  return null;
}

/** 屏幕点 → 原始帧归一化坐标（裁剪变焦用；以当前实际显示的裁剪区域为基准反算） */
function computeFocus(screenX, screenY){
  const cw = stage.clientWidth, ch = stage.clientHeight;
  const full = fullSourceSize();
  if (!full.w || !full.h) return zoomFocus;
  const rect = cropRect || { x: 0, y: 0, w: full.w, h: full.h };
  const fit = Math.min(cw / rect.w, ch / rect.h);
  const o0x = (cw - rect.w * fit) / 2, o0y = (ch - rect.h * fit) / 2;
  const sx = (screenX - o0x) / fit, sy = (screenY - o0y) / fit;
  return {
    x: Math.min(1, Math.max(0, (rect.x + sx) / full.w)),
    y: Math.min(1, Math.max(0, (rect.y + sy) / full.h)),
  };
}

/**
 * 按 zoomFocus 与 zoom 从原始帧裁一块、缩放画到 #crop。
 * 这块画布同时充当「显示」与「模型输入」，所以框的映射就是它的 contain 铺满（viewTransform 里
 * displayZoom() 恒为 1）。不处于裁剪变焦时返回 null 并清掉 cropRect。
 */
function drawCrop(){
  if (!usesCropZoom()){ cropRect = null; return null; }
  const src = media;
  const full = fullSourceSize();
  if (!src || !full.w || !full.h){ cropRect = null; return null; }
  const cw = Math.max(16, Math.round(full.w / zoom));
  const ch = Math.max(16, Math.round(full.h / zoom));
  const x = Math.max(0, Math.min(full.w - cw, Math.round(zoomFocus.x * full.w - cw / 2)));
  const y = Math.max(0, Math.min(full.h - ch, Math.round(zoomFocus.y * full.h - ch / 2)));
  cropRect = { x, y, w: cw, h: ch };
  if (cropCanvas.width !== cw) cropCanvas.width = cw;
  if (cropCanvas.height !== ch) cropCanvas.height = ch;
  cropCanvas.getContext('2d').drawImage(src, x, y, cw, ch, 0, 0, cw, ch);
  return cropCanvas;
}

// 备选布局（未采用，留作说明）：数字变焦本可以「裁剪成与舞台同比例」再 cover 铺满，
// 那样天生没有黑边；但 zoom=1 时画面会突然从 contain 变成 cover（开始裁切），与
// 「默认完整画面」冲突，所以还是保持「contain 铺满 + 平移」。

/**
 * 让 focus 这个点回到 point 处所需的屏幕平移量。
 * 因为裁剪块是 contain 居中铺满的，若不平移，捏合点会跑到屏幕中心 —— 实测最大偏 320px。
 * 注意镜像时屏幕位置是镜像后的（与 mapBox 的先后顺序一致：先变换、后关于中线镜像）。
 */
function panToKeep(point, focus){
  const cw = stage.clientWidth, ch = stage.clientHeight;
  const rect = cropRect;
  const full = fullSourceSize();
  if (!rect || !full.w || !full.h) return { x: 0, y: 0 };
  const fit = Math.min(cw / rect.w, ch / rect.h);
  const o0x = (cw - rect.w * fit) / 2, o0y = (ch - rect.h * fit) / 2;
  let sx = o0x + (focus.x * full.w - rect.x) * fit;
  const sy = o0y + (focus.y * full.h - rect.y) * fit;
  if (mirrored) sx = cw - sx;
  return { x: point.x - sx, y: point.y - sy };
}

// 设备变焦：applyConstraints 是异步的、pointermove 又很密，所以合并成「最新值优先」只推一次
let zoomApplying = false, zoomQueued = false;
async function pushDeviceZoom(){
  if (zoomMode !== 'camera' || !videoTrack || !deviceZoom) return;
  if (zoomApplying){ zoomQueued = true; return; }
  zoomApplying = true;
  try {
    await videoTrack.applyConstraints({ advanced: [{ zoom }] });
  } catch (_) { /* 个别驱动会在切换模式时拒绝，忽略 */ }
  finally { zoomApplying = false; }
  if (zoomQueued){ zoomQueued = false; void pushDeviceZoom(); }
}

// 每帧推理耗时（detect() 里测）：显示瞬时值 + EMA 平滑值，避免数字乱跳
let inferMs = 0;
let inferAvg = 0;
let lastInferAt = 0;

function noteInference(ms){
  inferMs = ms;
  inferAvg = inferAvg ? inferAvg * 0.75 + ms * 0.25 : ms;
  const now = performance.now();
  const rate = lastInferAt ? 1000 / Math.max(1, now - lastInferAt) : 0;
  lastInferAt = now;
  perfEl.textContent = 'Inference ' + ms.toFixed(0) + ' ms · avg ' + inferAvg.toFixed(0) + ' ms'
    + (rate ? ' · ' + rate.toFixed(1) + '/s' : '');
  perfEl.classList.add('show');
}

function twoPointers(){
  const pts = [...pointers.values()];
  if (pts.length < 2) return null;
  const [a, b] = pts;
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

// 把「显示层缩放」写到 media 元素上，并同步裁剪画布的显隐。
// 注意作用对象是「object-fit:contain 布局之后」的元素坐标 —— fit 已经由 contain 施加过了，
// 所以这里只需再叠一个 displayZoom()，绝不能再乘 fit。
// displayZoom()===1 时清掉内联样式，让 CSS 的 contain（以及 .mirror 的 scaleX(-1)）保持原样；
// 摄像头模式下就是这种情况（放大的活由流/裁剪干），所以这条路径等于把显示交给 contain。
// 镜像时必须显式合成：内联 transform 会覆盖 .mirror 类；且顺序必须与 mapBox() 一致
// —— 都是「先按锚点缩放、再关于屏幕中线镜像」，否则放大后识别框会和脸错位。
function applyMediaTransform(){
  const z = displayZoom();
  const crop = usesCropZoom();
  cropCanvas.hidden = !crop;
  cropCanvas.classList.toggle('mirror', mirrored);
  // 平移用 origin 0 0 的矩阵显式合成，镜像时先关于中线镜像再平移（顺序与 mapBox 一致）
  const cw0 = stage.clientWidth;
  cropCanvas.style.transformOrigin = '0 0';
  cropCanvas.style.transform = !crop
    ? ''
    : (mirrored
      ? `matrix(-1,0,0,1,${cw0 + cropOffset.x},${cropOffset.y})`
      : `translate(${cropOffset.x}px, ${cropOffset.y}px)`);
  if (!media){ return; }
  if (z === 1){ media.style.transform = ''; media.style.transformOrigin = ''; return; }
  const cw = stage.clientWidth;
  if (mirrored){
    media.style.transformOrigin = '0 0';
    media.style.transform =
      `matrix(${-z},0,0,${z},${cw - zoomAnchor.x * (1 - z)},${zoomAnchor.y * (1 - z)})`;
  } else {
    media.style.transformOrigin = `${zoomAnchor.x}px ${zoomAnchor.y}px`;
    media.style.transform = `scale(${z})`;
  }
}

function setZoom(z, screenAnchor){
  zoom = clampZoom(z);
  if (mode === 'image'){
    // 图片：CSS 放大，锚点就是屏幕点
    if (screenAnchor) zoomAnchor = screenAnchor;
  } else {
    // 摄像头：先按当前画面把屏幕点换算成源图焦点，再决定推设备变焦还是重画裁剪
    if (screenAnchor) zoomFocus = computeFocus(screenAnchor.x, screenAnchor.y);
    if (zoomMode === 'camera'){
      void pushDeviceZoom();
      cropOffset = { x: 0, y: 0 };
    } else {
      drawCrop();
      // 裁剪块默认居中，这里平移一下，让捏合点下的画面停在原地（未裁剪时归零）
      cropOffset = (screenAnchor && usesCropZoom()) ? panToKeep(screenAnchor, zoomFocus) : { x: 0, y: 0 };
    }
  }
  applyMediaTransform();
  render();
  // 标注是「真变焦」还是「数字变焦」，避免让人以为当前已经是镜头变焦
  zoomBadge.textContent = zoom.toFixed(1) + '× ' + (zoomMode === 'camera' ? 'camera' : 'digital');
  zoomBadge.classList.add('show');
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => zoomBadge.classList.remove('show'), 900);
}

stage.addEventListener('pointerdown', (e) => {
  if (!mode) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2){
    const t = twoPointers();
    pinch = (t && t.dist) ? { dist: t.dist, zoom } : null;
  }
});
stage.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size !== 2 || !pinch) return;
  const t = twoPointers();
  if (!t || !t.dist) return;
  setZoom(pinch.zoom * (t.dist / pinch.dist), t.mid);
});
const dropPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
};
stage.addEventListener('pointerup', dropPointer);
stage.addEventListener('pointercancel', dropPointer);
stage.addEventListener('pointerleave', dropPointer);

// 桌面端没有双指：滚轮就是缩放，锚点是光标位置（与捏合同一套 setZoom 路径，
// 所以「滚到哪里放大哪里」和捏合的行为一致）。preventDefault 同时挡掉浏览器整页缩放。
stage.addEventListener('wheel', (e) => {
  if (!mode) return;
  e.preventDefault();
  // deltaY 一格约 ±100：每格约 16%，触控板的连续小量也顺滑
  setZoom(zoom * Math.exp(-e.deltaY * 0.0015), { x: e.clientX, y: e.clientY });
}, { passive: false });
// 双击回到 1×（桌面端把画面放得太大后，一键还原）
stage.addEventListener('dblclick', (e) => {
  if (!mode || zoom === ZOOM_MIN) return;
  e.preventDefault();
  setZoom(ZOOM_MIN, { x: stage.clientWidth / 2, y: stage.clientHeight / 2 });
});

// ---------- result card ----------
function showCard(dets){
  if (!dets.length){
    card.hidden = false; card.className = 'miss';
    cardWho.textContent = 'No face detected';
    cardMeta.textContent = 'Move closer and keep the face inside the frame.';
    cardRows.innerHTML = '';
    return;
  }
  const main = dets.reduce((a, b) => (a.box.width * a.box.height >= b.box.width * b.box.height ? a : b));
  const extra = dets.length > 1 ? ` · ${dets.length} faces` : '';
  card.hidden = false;

  if (main.matched){
    const s = main.student;
    card.className = 'hit';
    cardWho.innerHTML = `${escapeHtml(s.chineseName)}${s.preferredName ? ` <span class="pref">/ ${escapeHtml(s.preferredName)}</span>` : ''}`;
    cardMeta.textContent = `Class ${s.class} · Student No. ${s.studentNo} · distance ${main.distance.toFixed(3)}${extra}`;
    cardRows.innerHTML = row('Class', s.class) + row('Chinese Name', s.chineseName)
      + row('Preferred Name', s.preferredName || '—') + row('Student No.', s.studentNo)
      + row('Class No.', s.classNo ?? '—') + row('English Name', s.englishName || '—');
  } else {
    card.className = 'miss';
    cardWho.textContent = 'Unknown';
    const near = main.nearest;
    cardMeta.textContent = `Best distance ${main.distance.toFixed(3)} (threshold ${rec.state.threshold.toFixed(2)})${extra}`
      + (near ? ` · closest: ${near.class} ${near.chineseName}` : '');
    cardRows.innerHTML = '';
  }
}
const row = (k, v) => `<b>${k}</b><span>${escapeHtml(String(v))}</span>`;
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// ---------- detection ----------
async function detect(input, sw, sh){
  const t0 = performance.now();
  const dets = await rec.matchAll(input);
  noteInference(performance.now() - t0);
  sourceSize = { w: sw, h: sh };
  results = dets;
  render();
  showCard(dets);
}

// ---------- image mode ----------
fileInput.onchange = async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    await startImage(img);
  } finally { setTimeout(() => URL.revokeObjectURL(url), 10000); }
};

async function startImage(img){
  resetMedia();
  mode = 'image';
  useThreshold(T_IMAGE);
  intro.classList.add('hide');
  btnExit.hidden = false;
  btnFlip.hidden = true;
  shutter.hidden = true;
  img.className = 'media';
  stage.insertBefore(img, overlay);
  media = img;
  mirrored = false;
  card.hidden = false; card.className = '';
  cardWho.textContent = 'Recognising…'; cardMeta.textContent = ''; cardRows.innerHTML = '';
  await new Promise(r => requestAnimationFrame(r));
  await detect(img, img.naturalWidth, img.naturalHeight);
}

choiceUpload.onclick = () => fileInput.click();

// ---------- camera mode ----------
choiceCamera.onclick = () => openCamera();

async function openCamera(){
  resetMedia();
  mode = 'camera';
  useThreshold(T_CAMERA);
  intro.classList.add('hide');
  btnExit.hidden = false;
  btnFlip.hidden = false;
  shutter.hidden = false;
  card.hidden = false; card.className = '';
  cardWho.textContent = 'Starting camera…'; cardMeta.textContent = ''; cardRows.innerHTML = '';

  let s;
  try {
    // 不再硬塞 9:16：只给方向偏好 + 一个宽度偏好，让设备按自己真实的传感器比例出流。
    // 原来的 width:720/height:1280 会被横屏设备换成别的模式，再被 cover 裁切放大成「焦距变大」；
    // 现在显示层是 contain（完整可见），且不指定 height —— 比例完全由设备决定。
    // 宽度给 1280 的偏好，是防止某些设备在完全不加约束时只返回 640×480 而损失识别精度。
    s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (err) {
    resetMedia();
    btnExit.hidden = true; btnFlip.hidden = true; shutter.hidden = true;
    card.hidden = true;
    intro.classList.remove('hide');
    statusEl.className = 'err';
    statusEl.textContent = 'Camera unavailable: ' + err.message;
    return;
  }
  stream = s;
  const trackSettings = s.getVideoTracks()[0].getSettings() || {};
  const realFacing = trackSettings.facingMode;
  mirrored = realFacing === 'user';
  // 变焦能力探测：有 zoom 范围就驱动摄像头真变焦（显示/识别/拍照三者一致）；
  // 没有（iOS Safari、多数摄像头）就退到「裁剪后同时喂显示与模型」的数字变焦。
  videoTrack = s.getVideoTracks()[0] || null;
  deviceZoom = readZoomRange(videoTrack);
  zoomMode = deviceZoom ? 'camera' : 'digital';
  zoom = clampZoom(typeof trackSettings.zoom === 'number' ? trackSettings.zoom : ZOOM_MIN);
  zoomFocus = { x: 0.5, y: 0.5 };
  cropRect = null;
  console.log('[demo] zoom', zoomMode,
    deviceZoom ? `range ${deviceZoom.min}–${deviceZoom.max} step ${deviceZoom.step}` : '(设备无 zoom 能力 → 数字裁剪变焦)');
  // 把设备实际给的分辨率打出来：真机上核对「真实尺寸」用，调上面那个 width 偏好时也对照它
  console.log('[demo] camera stream', `${trackSettings.width}×${trackSettings.height}`,
    trackSettings.frameRate ? `@${trackSettings.frameRate}fps` : '');

  const video = document.createElement('video');
  video.autoplay = true; video.muted = true; video.playsInline = true; video.setAttribute('playsinline', '');
  if (mirrored) video.classList.add('mirror');
  video.srcObject = s;
  stage.insertBefore(video, overlay);
  media = video;
  await video.play();
  sizeOverlay();
  startLoop();
}

btnFlip.onclick = async () => {
  facing = facing === 'environment' ? 'user' : 'environment';
  await openCamera();
};

function startLoop(){
  stopLoop();
  const tick = async () => {
    if (mode !== 'camera' || !media) return;
    if (!busy && media.readyState >= 2 && media.videoWidth){
      busy = true;
      try {
        // 数字变焦时喂「裁剪后的画面」：模型也因此看到放大，远处小脸更容易检出
        const crop = usesCropZoom() ? drawCrop() : null;
        if (crop) await detect(crop, crop.width, crop.height);
        else await detect(media, media.videoWidth, media.videoHeight);
      }
      catch (err) { console.warn('[demo] detect failed', err); }
      finally { busy = false; }
    }
    loopId = setTimeout(tick, 200);
  };
  loopId = setTimeout(tick, 250);
}
function stopLoop(){ if (loopId) clearTimeout(loopId); loopId = null; busy = false; }

// ---------- save frame (camera only) ----------
shutter.onclick = () => {
  // 数字变焦时存「屏幕上看到的那块裁剪」，而不是未放大的整帧（否则与画面不一致）
  const crop = usesCropZoom() ? cropCanvas : null;
  const v = (crop && crop.width) ? crop : media;
  if (!v) return;
  const sw = v.width || v.videoWidth, sh = v.height || v.videoHeight;
  if (!sw || !sh) return;
  const cv = document.createElement('canvas');
  cv.width = sw; cv.height = sh;
  const c2 = cv.getContext('2d');
  c2.drawImage(v, 0, 0, sw, sh);
  const saved = mirrored; mirrored = false;           // export the un-mirrored frame
  paint(c2, results, sw, sh, { scale: 1, ox: 0, oy: 0 }, sw);
  mirrored = saved;
  cv.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `recognition-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }, 'image/png');
};

// ---------- exit ----------
btnExit.onclick = () => {
  resetMedia();
  intro.classList.remove('hide');
  statusEl.className = '';
  statusEl.textContent = '';
};

function resetMedia(){
  stopLoop();
  if (stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (media && media.tagName === 'VIDEO'){ media.srcObject = null; }
  if (media && media.parentNode) media.parentNode.removeChild(media);
  media = null;
  results = []; sourceSize = { w: 0, h: 0 };
  mode = null; mirrored = false;
  // 复位缩放：换摄像头 / 换图片 / 退出时都要回到「完整画面」
  zoom = 1; zoomAnchor = { x: 0, y: 0 };
  zoomFocus = { x: 0.5, y: 0.5 };
  zoomMode = 'digital'; deviceZoom = null; videoTrack = null; cropRect = null;
  cropOffset = { x: 0, y: 0 };
  cropCanvas.hidden = true;
  pointers.clear(); pinch = null;
  clearTimeout(badgeTimer); zoomBadge.classList.remove('show');
  perfEl.classList.remove('show');
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.restore();
  card.hidden = true; cardRows.innerHTML = '';
  btnExit.hidden = true; btnFlip.hidden = true; shutter.hidden = true;
}

// ---------- housekeeping ----------
window.addEventListener('resize', () => { if (mode){ applyMediaTransform(); render(); } });
window.addEventListener('orientationchange', () => { setTimeout(() => { if (mode){ applyMediaTransform(); render(); } }, 260); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else if (mode === 'camera') startLoop();
});
document.addEventListener('gesturestart', (e) => e.preventDefault());
// 桌面端习惯：Esc = 退出返回首屏
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') btnExit.click();
});

// Nuxt 页面在路由离开时调用：停掉摄像头与检测循环。监听器仍留在 document/window 上，
// 但 resetMedia() 把 mode 归 null 后它们都是空操作，不会继续抓帧或占用摄像头。
export function teardown(){
  try { resetMedia(); } catch (_) { /* 首屏还没就绪时忽略 */ }
}
