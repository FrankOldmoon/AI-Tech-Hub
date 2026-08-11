/**
 * 预下载所有 AI 模型到 public/model/ 目录。
 *
 * 在 Nuxt 服务器启动时通过 server plugin 自动触发；
 * 已存在的文件会跳过，缺失的文件才下载。
 *
 * 使用 hf-mirror.com 作为 Hugging Face 镜像，
 * jsdelivr CDN 作为 npm/GitHub 镜像。
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, relative, basename, extname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const BASE = join(process.cwd(), 'public', 'model')
const MIRROR = 'https://hf-mirror.com'

// 防止并发重复执行
let running = false

/** 下载单个文件，跳过已存在且非空的文件；流式写入避免大文件占用内存。 */
async function downloadFile(url: string, dest: string): Promise<boolean> {
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`  SKIP (exists): ${relative(BASE, dest)}`)
    return true
  }
  mkdirSync(dirname(dest), { recursive: true })
  console.log(`  GET: ${url}`)
  try {
    const resp = await fetch(url, { redirect: 'follow' })
    if (!resp.ok || !resp.body) {
      console.log(`  ERROR: HTTP ${resp.status} ${resp.statusText}`)
      return false
    }
    // 流式写入文件
    const stream = Readable.fromWeb(resp.body as any)
    await pipeline(stream, createWriteStream(dest))
    const size = existsSync(dest) ? statSync(dest).size : 0
    console.log(`  OK: ${relative(BASE, dest)} (${Math.floor(size / 1024)} KB)`)
    return true
  } catch (e: any) {
    console.log(`  ERROR: ${e?.message || String(e)}`)
    if (existsSync(dest)) {
      try { unlinkSync(dest) } catch { /* ignore */ }
    }
    return false
  }
}

/** 用 jsdelivr API 列出 npm 包 wasm 目录下的文件。 */
async function listJsdelivrFiles(pkg: string, version: string): Promise<string[]> {
  const url = `https://data.jsdelivr.com/v1/packages/npm/${pkg}@${version}`
  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json() as any
    const files: string[] = []
    for (const node of data.files || []) {
      if (node.type === 'directory' && node.name === 'wasm') {
        for (const f of node.files || []) {
          if (f.type === 'file') files.push(`wasm/${f.name}`)
        }
      }
    }
    return files
  } catch (e: any) {
    console.log(`  WARN: jsdelivr API 失败: ${e?.message || e}`)
    // 回退到已知文件列表
    return [
      'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm',
      'wasm/vision_wasm_nosimd_internal.js', 'wasm/vision_wasm_nosimd_internal.wasm',
      'wasm/vision_wasm_simd_internal.js', 'wasm/vision_wasm_simd_internal.wasm',
      'wasm/vision_wasm_threaded_simd_internal.js', 'wasm/vision_wasm_threaded_simd_internal.wasm'
    ]
  }
}

/** 用 HF API 列出仓库中所有文件。 */
async function listHfFiles(modelId: string): Promise<string[]> {
  const url = `${MIRROR}/api/models/${modelId}`
  try {
    const resp = await fetch(url, { redirect: 'follow' })
    if (!resp.ok) {
      console.log(`  ERROR listing HF files for ${modelId}: HTTP ${resp.status}`)
      return []
    }
    const data = await resp.json() as any
    return (data.siblings || []).map((s: any) => s.rfilename)
  } catch (e: any) {
    console.log(`  ERROR listing HF files for ${modelId}: ${e?.message || e}`)
    return []
  }
}

/** 下载 HF 仓库所有文件（跳过指定后缀/文件名）。 */
async function downloadHfRepo(
  modelId: string,
  destSubdir: string,
  skipExts: string[] = ['.gitattributes'],
  skipNames: string[] = ['.gitattributes', 'README.md', 'LICENSE']
): Promise<void> {
  const destDir = join(BASE, destSubdir)
  const files = await listHfFiles(modelId)
  if (!files.length) {
    console.log(`  WARN: 未获取到文件列表，跳过 ${modelId}`)
    return
  }
  console.log(`  ${modelId}: ${files.length} 个文件`)
  for (const f of files) {
    const bname = basename(f)
    const ext = extname(f)
    if (skipNames.includes(bname) || skipExts.includes(ext)) continue
    const url = `${MIRROR}/${modelId}/resolve/main/${f}`
    const dest = join(destDir, f)
    await downloadFile(url, dest)
  }
}

/** 读取并解析 JSON 文件。 */
function readJson(filePath: string): any | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

// ============================================================
// 1. MediaPipe 模型
// ============================================================
async function downloadMediapipeModels(): Promise<void> {
  console.log('\n=== MediaPipe 模型 ===')
  const MP = 'https://storage.googleapis.com/mediapipe-models'
  const models: Record<string, string> = {
    'face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite': 'mediapipe/models/blaze_face_short_range.tflite',
    'face_landmarker/face_landmarker/float16/1/face_landmarker.task': 'mediapipe/models/face_landmarker.task',
    'gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task': 'mediapipe/models/gesture_recognizer.task',
    'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task': 'mediapipe/models/hand_landmarker.task',
    'holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task': 'mediapipe/models/holistic_landmarker.task',
    'image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite': 'mediapipe/models/efficientnet_lite0.tflite',
    'image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite': 'mediapipe/models/mobilenet_v3_small.tflite',
    'image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite': 'mediapipe/models/selfie_segmenter.tflite',
    'image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite': 'mediapipe/models/hair_segmenter.tflite',
    'interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task': 'mediapipe/models/interactive_segmentation.task',
    'object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite': 'mediapipe/models/efficientdet_lite0.tflite',
    'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task': 'mediapipe/models/pose_landmarker_lite.task',
    'audio_classifier/yamnet/float32/1/yamnet.tflite': 'mediapipe/models/yamnet.tflite',
    'language_detector/language_detector/float32/1/language_detector.tflite': 'mediapipe/models/language_detector.tflite',
    'text_classifier/bert_classifier/float32/1/bert_classifier.tflite': 'mediapipe/models/bert_classifier.tflite',
    'text_embedder/universal_sentence_encoder/float32/1/universal_sentence_encoder.tflite': 'mediapipe/models/universal_sentence_encoder.tflite'
  }
  for (const [path, dest] of Object.entries(models)) {
    await downloadFile(`${MP}/${path}`, join(BASE, dest))
  }
}

// ============================================================
// 2. MediaPipe WASM
// ============================================================
async function downloadMediapipeWasm(): Promise<void> {
  console.log('\n=== MediaPipe WASM ===')
  const packages: Record<string, [string, string]> = {
    vision: ['@mediapipe/tasks-vision', '1.0.1'],
    text: ['@mediapipe/tasks-text', '1.0.1'],
    audio: ['@mediapipe/tasks-audio', '1.0.1']
  }
  for (const [name, [pkg, ver]] of Object.entries(packages)) {
    console.log(`  --- ${name} ---`)
    const files = await listJsdelivrFiles(pkg, ver)
    for (const f of files) {
      const url = `https://cdn.jsdelivr.net/npm/${pkg}@${ver}/${f}`
      const dest = join(BASE, 'mediapipe/wasm', name, basename(f))
      await downloadFile(url, dest)
    }
  }
}

// ============================================================
// 3. Transformers.js 模型
// ============================================================
async function downloadTransformersModels(): Promise<void> {
  console.log('\n=== Transformers.js 模型 ===')
  const models = [
    'Xenova/bert-base-NER-uncased',
    'Xenova/distilbert-base-uncased-mnli',
    'Xenova/distilbart-cnn-6-6',
    'Xenova/distilbert-base-cased-distilled-squad',
    'Xenova/bert-base-uncased',
    'onnx-community/depth-anything-v1-small',
    'Xenova/vit-gpt2-image-captioning'
  ]
  // 跳过 PyTorch/TF 原始权重和不需要的 ONNX 变体
  // 保留: model.onnx, model_quantized.onnx, model_int8.onnx, model_fp16.onnx
  // 跳过: model_bnb4.onnx, model_q4.onnx（体积大，非必需）
  const skipExts = ['.bin', '.h5', '.msgpack', '.ot', '.safetensors']
  const skipNames = [
    '.gitattributes', 'README.md', 'LICENSE',
    'pytorch_model.bin.index.json', 'tf_model.h5.index.json',
    'model_bnb4.onnx', 'model_q4.onnx'
  ]
  for (const modelId of models) {
    console.log(`  --- ${modelId} ---`)
    await downloadHfRepo(modelId, `transformers/${modelId}`, skipExts, skipNames)
  }
}

// ============================================================
// 4. WebLLM 模型
// ============================================================
async function downloadWebllmModels(): Promise<void> {
  console.log('\n=== WebLLM 模型 ===')
  const models = [
    'mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    'mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    'mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC',
    'mlc-ai/Llama-3.2-3B-Instruct-q4f16_1-MLC'
  ]
  const skipExts = ['.gitattributes']
  const skipNames = ['.gitattributes', 'README.md', 'LICENSE']
  for (const modelId of models) {
    console.log(`  --- ${modelId} ---`)
    // WebLLM 会给 model URL 追加 /resolve/main/{filename}，
    // 因此本地文件也需存到 {model_id}/resolve/main/ 下
    const destDir = join(BASE, `webllm/${modelId}/resolve/main`)
    const files = await listHfFiles(modelId)
    if (!files.length) {
      console.log(`  WARN: 未获取到文件列表，跳过 ${modelId}`)
      continue
    }
    console.log(`  ${modelId}: ${files.length} 个文件`)
    for (const f of files) {
      const bname = basename(f)
      const ext = extname(f)
      if (skipNames.includes(bname) || skipExts.includes(ext)) continue
      const url = `${MIRROR}/${modelId}/resolve/main/${f}`
      const dest = join(destDir, f)
      await downloadFile(url, dest)
    }
  }
  // 下载 model_lib (.wasm) — 使用 jsdelivr CDN 镜像 GitHub raw
  console.log('\n  --- WebLLM model libs ---')
  const libs: [string, string][] = [
    ['Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm', 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'],
    ['Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm', 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'],
    ['Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm', 'Llama-3.2-1B-Instruct-q4f16_1-MLC'],
    ['Llama-3.2-3B-Instruct-q4f16_1_cs1k-webgpu.wasm', 'Llama-3.2-3B-Instruct-q4f16_1-MLC']
  ]
  for (const [libName] of libs) {
    const url = `https://cdn.jsdelivr.net/gh/mlc-ai/binary-mlc-llm-libs@main/web-llm-models/v0_2_84/base/${libName}`
    const dest = join(BASE, 'webllm/libs', libName)
    const ok = await downloadFile(url, dest)
    if (!ok) {
      // 回退到 raw.githubusercontent.com
      const url2 = `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/${libName}`
      await downloadFile(url2, dest)
    }
  }
}

// ============================================================
// 5. TensorFlow.js 模型 (MobileNet + Speech Commands)
// ============================================================
async function downloadTfjsModels(): Promise<void> {
  console.log('\n=== TensorFlow.js 模型 ===')
  // MobileNet v2 alpha 1.0
  console.log('  --- MobileNet v2 1.0 ---')
  // storage.googleapis.com 旧路径已失效，改用 tfhub.dev 的 TF.js 模型端点
  // 注意：此端点对部分客户端（如 curl 的 UA）会返回 HTML 页面，
  // 但 Node fetch（undici，无自定义 UA）可正常返回二进制，下载器保持默认 fetch 即可
  const mobilenetBase = 'https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/classification/2/default/1'
  const mobilenetDir = join(BASE, 'tfjs/mobilenet')
  const mobilenetJson = join(mobilenetDir, 'model.json')
  // 删除可能已损坏的旧文件
  if (existsSync(mobilenetJson) && !readJson(mobilenetJson)) {
    try { unlinkSync(mobilenetJson) } catch { /* ignore */ }
  }
  await downloadFile(`${mobilenetBase}/model.json?tfjs-format=file`, mobilenetJson)
  const mobData = readJson(mobilenetJson)
  if (mobData) {
    for (const group of mobData.weightsManifest || []) {
      for (const path of group.paths || []) {
        await downloadFile(`${mobilenetBase}/${path}?tfjs-format=file`, join(mobilenetDir, path))
      }
    }
  }

  // Speech Commands v0.5 browser_fft 18w
  console.log('  --- Speech Commands v0.5 ---')
  const scBase = 'https://storage.googleapis.com/tfjs-models/tfjs/speech-commands/v0.5/browser_fft/18w'
  const scDir = join(BASE, 'tfjs/speech-commands')
  const scJson = join(scDir, 'model.json')
  await downloadFile(`${scBase}/model.json`, scJson)
  await downloadFile(`${scBase}/metadata.json`, join(scDir, 'metadata.json'))
  const scData = readJson(scJson)
  if (scData) {
    for (const group of scData.weightsManifest || []) {
      for (const path of group.paths || []) {
        await downloadFile(`${scBase}/${path}`, join(scDir, path))
      }
    }
  }
}

/** 统计目录总大小（MB）。 */
function totalSizeMb(dir: string): number {
  let total = 0
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else total += statSync(full).size
    }
  }
  if (existsSync(dir)) walk(dir)
  return total / 1024 / 1024
}

/**
 * 下载所有模型到 public/model/。
 * 已存在的文件会跳过，只下载缺失的文件。
 * 通过 server plugin 在服务器启动时自动调用。
 */
export async function downloadAllModels(): Promise<void> {
  if (running) {
    console.log('[model-downloader] 已在运行中，跳过本次触发')
    return
  }
  running = true
  const t0 = Date.now()
  console.log(`[model-downloader] 开始检查/下载模型到 ${BASE}`)
  mkdirSync(BASE, { recursive: true })
  try {
    await downloadMediapipeModels()
    await downloadMediapipeWasm()
    await downloadTransformersModels()
    await downloadTfjsModels()
    await downloadWebllmModels()
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`\n[model-downloader] 下载完成，总大小 ${totalSizeMb(BASE).toFixed(1)} MB，耗时 ${elapsed}s`)
  } catch (e: any) {
    console.error(`[model-downloader] 下载出错: ${e?.message || e}`)
  } finally {
    running = false
  }
}
