/**
 * 预下载所有 AI 模型到 .models/ 目录。
 *
 * 模型不再放入 public/（构建时会被复制进 .output），而是存到项目根 .models/，
 * 由 server/routes/model/[...].ts 以 HTTP Range(206) 方式提供给浏览器端推理库。
 *
 * 在 Nuxt 服务器启动时通过 server plugin 自动触发；
 * 已存在的文件会跳过，缺失的文件才下载。
 *
 * 仓库级下载统一走 server/utils/model-fetch.mjs：源优先级 ModelScope → hf-mirror.com
 * → huggingface.co（只认 hf-mirror 时，国内网络下它 308 跳去被墙的 huggingface.co，
 * 整条预取链路会失效）；npm/GitHub 产物用 jsdelivr CDN。
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, relative, basename } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
// 仓库级下载（ModelScope → hf-mirror → huggingface 自动回退）与语音模型清单共用，
// 手动预取入口见 scripts/fetch-models.mjs（pnpm models:fetch）
import { SPEECH_REPOS, fetchModelRepo } from './model-fetch.mjs'
// 远程来源清单（与 server/routes/model/[...].ts 的回退重定向共用同一事实来源）
import { DOODLE_BASE, FACEAPI_BASES, MEDIAPIPE_BASE, MEDIAPIPE_MODELS, MEDIAPIPE_WASM, TFJS_MOBILENET_BASE, TFJS_SPEECH_BASE } from './model-sources'

// 模型根目录：默认 <cwd>/.models，可用 MODELS_DIR 环境变量覆盖
// （与 server/routes/model/[...].ts 的服务路径保持一致；
//  不用 storage/：全局 gitignore 有 storage 规则会阻断 yolo 入库例外）
const BASE = process.env.MODELS_DIR || join(process.cwd(), '.models')

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

/** 下载 HF 仓库所有文件（跳过指定后缀/文件名）。
 *  实际下载交给 model-fetch.mjs：优先 ModelScope（国内可直连），
 *  再回退 hf-mirror.com / huggingface.co —— 单靠 hf-mirror 时，
 *  其 308 跳转到被墙的 huggingface.co 会让整条预取链路失效。 */
async function downloadHfRepo(
  modelId: string,
  destSubdir: string,
  skipExts: string[] = ['.gitattributes'],
  skipNames: string[] = ['.gitattributes', 'README.md', 'LICENSE']
): Promise<void> {
  await fetchModelRepo(modelId, join(BASE, destSubdir), { skipExts, skipNames })
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
  for (const [path, dest] of Object.entries(MEDIAPIPE_MODELS)) {
    await downloadFile(`${MEDIAPIPE_BASE}/${path}`, join(BASE, dest))
  }
}

// ============================================================
// 2. MediaPipe WASM
// ============================================================
async function downloadMediapipeWasm(): Promise<void> {
  console.log('\n=== MediaPipe WASM ===')
  for (const [name, entry] of Object.entries(MEDIAPIPE_WASM)) {
    console.log(`  --- ${name} ---`)
    const files = await listJsdelivrFiles(entry.pkg, entry.version)
    for (const f of files) {
      const url = `https://cdn.jsdelivr.net/npm/${entry.pkg}@${entry.version}/${f}`
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
    'Xenova/vit-gpt2-image-captioning',
    'Xenova/modnet'
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
// 3.5 语音模块模型（ASR / 情感识别 / 语音克隆）
// ============================================================
async function downloadSpeechModels(): Promise<void> {
  console.log('\n=== 语音模块模型（whisper / wav2vec2-SER / chatterbox / wavlm-SV / opus-mt） ===')
  for (const repo of SPEECH_REPOS) {
    console.log(`  --- ${repo.id}（${repo.label}）---`)
    await fetchModelRepo(repo.id, join(BASE, 'transformers', repo.id), { keep: repo.keep })
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
  for (const modelId of models) {
    console.log(`  --- ${modelId} ---`)
    // WebLLM 会给 model URL 追加 /resolve/main/{filename}，本地也照这个层级放，
    // 页面侧才能用 /model/webllm/{owner}/{repo}/resolve/main/... 命中。
    // 仓库级下载（ModelScope → hf-mirror → huggingface）：只认 hf-mirror 时，
    // 国内网络下它 308 跳去被墙的 huggingface.co，这批权重就一直下不下来。
    await downloadHfRepo(modelId, `webllm/${modelId}/resolve/main`)
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
  const mobilenetBase = TFJS_MOBILENET_BASE
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
  const scBase = TFJS_SPEECH_BASE
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

// ============================================================
// 6. face-api 人脸注册/识别模型（@vladmandic/face-api）
// ============================================================
async function downloadFaceApiModels(): Promise<void> {
  console.log('\n=== face-api 人脸模型 ===')
  const files = [
    'tiny_face_detector_model-weights_manifest.json',
    'tiny_face_detector_model.bin',
    'face_landmark_68_model-weights_manifest.json',
    'face_landmark_68_model.bin',
    'face_recognition_model-weights_manifest.json',
    'face_recognition_model.bin'
  ]
  const jsdelivr = FACEAPI_BASES[0]!
  const raw = FACEAPI_BASES[1]!
  for (const f of files) {
    const dest = join(BASE, 'faceapi', f)
    const ok = await downloadFile(`${jsdelivr}/${f}`, dest)
    if (!ok) await downloadFile(`${raw}/${f}`, dest)
  }
}

// ============================================================
// 7. ml5 DoodleNet 简笔画模型（/vision/sketch）
// ============================================================
/**
 * ml5 把 DoodleNet 的地址硬编码为 jsdelivr，且 345 个类别标签烘焙在 ml5 包内，
 * 因此只本地化权重：前端把该地址重写到 /model/doodle/，此处负责把文件拉下来。
 * 本地缺失时 /model/* 会 302 回退到 DOODLE_BASE（见 model-sources.ts）。
 */
async function downloadDoodleNet(): Promise<void> {
  console.log('\n=== ml5 DoodleNet（简笔画） ===')
  const dir = join(BASE, 'doodle')
  const modelJson = join(dir, 'model.json')
  const ok = await downloadFile(`${DOODLE_BASE}/model.json`, modelJson)
  if (!ok) return
  const data = readJson(modelJson)
  if (!data) return
  for (const group of data.weightsManifest || []) {
    for (const path of group.paths || []) {
      await downloadFile(`${DOODLE_BASE}/${path}`, join(dir, path))
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
 * 下载所有模型到 .models/。
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
    await downloadSpeechModels()
    await downloadTfjsModels()
    await downloadWebllmModels()
    await downloadFaceApiModels()
    await downloadDoodleNet()
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`\n[model-downloader] 下载完成，总大小 ${totalSizeMb(BASE).toFixed(1)} MB，耗时 ${elapsed}s`)
  } catch (e: any) {
    console.error(`[model-downloader] 下载出错: ${e?.message || e}`)
  } finally {
    running = false
  }
}
