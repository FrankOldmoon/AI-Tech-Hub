/**
 * 模型仓库下载器（服务器预取 + 手动预取共用）
 *
 * 源优先级：ModelScope（国内直连，速度快）→ hf-mirror.com → huggingface.co
 * 之所以不再只用 hf-mirror：国内网络下 hf-mirror.com 可能 308 跳转到被墙的
 * huggingface.co，导致整个模型预取链路失效；ModelScope 上有 Xenova /
 * onnx-community 的完整镜像，可直接替换。
 *
 * 被两处使用：
 *   - server/utils/model-downloader.ts（Nuxt 启动时预取）
 *   - scripts/fetch-models.mjs（手动 `pnpm models:fetch`）
 */
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const MODELSCOPE = 'https://www.modelscope.cn'
const HF_MIRROR = process.env.HF_MIRROR_URL || 'https://hf-mirror.com'
const HF_OFFICIAL = 'https://huggingface.co'

/** 下载源的可读名字，用于日志 */
export function sourceLabel(url) {
  if (url.startsWith(MODELSCOPE)) return 'ModelScope'
  if (url.startsWith(HF_MIRROR)) return 'hf-mirror'
  return 'huggingface'
}

/** 列出 ModelScope 镜像仓库的文件；源不可用或仓库不存在时返回 null */
export async function listModelScopeFiles(modelId) {
  const url = `${MODELSCOPE}/api/v1/models/${modelId}/repo/files?Revision=master&Recursive=true`
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) return null
    const json = await res.json()
    const files = json?.Data?.Files
    if (!Array.isArray(files)) return null
    return files
      .filter(f => f.Type === 'blob')
      .map(f => ({ path: String(f.Path), size: Number(f.Size) || 0 }))
  } catch {
    return null
  }
}

/** 列出 HuggingFace 仓库的文件；失败返回 null */
export async function listHfFiles(modelId, mirror = HF_MIRROR) {
  try {
    const res = await fetch(`${mirror}/api/models/${modelId}`, { redirect: 'follow' })
    if (!res.ok) return null
    const json = await res.json()
    const siblings = json?.siblings
    if (!Array.isArray(siblings)) return null
    return siblings.map(s => ({ path: String(s.rfilename), size: 0 }))
  } catch {
    return null
  }
}

/**
 * 按源优先级列出仓库文件。
 * 返回 { files, urls } —— urls 给出每个文件的候选下载地址（已按优先级排序）。
 */
export async function resolveRepoFiles(modelId) {
  const msFiles = await listModelScopeFiles(modelId)
  if (msFiles && msFiles.length) {
    return {
      source: 'ModelScope',
      files: msFiles,
      url: path => `${MODELSCOPE}/api/v1/models/${modelId}/repo?Revision=master&FilePath=${encodeURIComponent(path)}`
    }
  }
  const mirrorFiles = await listHfFiles(modelId, HF_MIRROR)
  if (mirrorFiles && mirrorFiles.length) {
    return {
      source: 'hf-mirror',
      files: mirrorFiles,
      url: path => `${HF_MIRROR}/${modelId}/resolve/main/${encodeURI(urlPath(path))}`
    }
  }
  const hfFiles = await listHfFiles(modelId, HF_OFFICIAL)
  if (hfFiles && hfFiles.length) {
    return {
      source: 'huggingface',
      files: hfFiles,
      url: path => `${HF_OFFICIAL}/${modelId}/resolve/main/${encodeURI(urlPath(path))}`
    }
  }
  return null
}

/** 只对空格和 # 之类的字符转义，保留路径分隔符 */
function urlPath(p) {
  return p.split('/').map(encodeURIComponent).join('/')
}

/** 候选下载地址（按优先级），用于单文件回退 */
export function candidateUrls(modelId, path) {
  return [
    `${MODELSCOPE}/api/v1/models/${modelId}/repo?Revision=master&FilePath=${encodeURIComponent(path)}`,
    `${HF_MIRROR}/${modelId}/resolve/main/${urlPath(path)}`,
    `${HF_OFFICIAL}/${modelId}/resolve/main/${urlPath(path)}`
  ]
}

/**
 * 下载单个文件到 destDir/path。
 * - 已存在且大小与期望一致 → 跳过（可断点续跑）
 * - 期望大小 > 1KB 时校验下载字节数，不一致视为失败（ModelScope 出错时会返回 JSON）
 * 返回 'ok' | 'skip' | 'fail'
 */
export async function downloadRepoFile(modelId, path, destDir, { expectedSize = 0, quiet = false, log = console.log } = {}) {
  const dest = join(destDir, path)
  const expect = Number(expectedSize) || 0
  if (existsSync(dest)) {
    const size = statSync(dest).size
    if (size > 0 && (!expect || size === expect)) {
      if (!quiet) log(`    skip  ${path}`)
      return 'skip'
    }
    try {
      unlinkSync(dest)
    } catch { /* ignore */ }
  }
  mkdirSync(dirname(dest), { recursive: true })

  for (const url of candidateUrls(modelId, path)) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok || !res.body) continue
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
      const size = existsSync(dest) ? statSync(dest).size : 0
      if (size === 0 || (expect > 1024 && size !== expect)) {
        log(`    FAIL  ${path}（${sourceLabel(url)} 返回 ${size} 字节，期望 ${expect || '?'}）`)
        try {
          unlinkSync(dest)
        } catch { /* ignore */ }
        continue
      }
      if (!quiet) log(`    ok    ${(size / 1048576).toFixed(2).padStart(8)} MB  ${path}  [${sourceLabel(url)}]`)
      return 'ok'
    } catch {
      continue
    }
  }
  log(`    FAIL  ${path}（所有源均失败）`)
  return 'fail'
}

// ============================================================
// 语音模块需要的 transformers.js 仓库清单
// 只保留 transformers.js 实际会请求的文件（见其 MODEL_SESSION_CONFIG /
// DEFAULT_DTYPE_SUFFIX_MAPPING）：
//   - Seq2Seq（whisper / Marian）只用 encoder_model + decoder_model_merged，
//     不用 decoder_model / decoder_with_past_model
//   - q8 对应 _quantized 后缀、fp32 无后缀
// 原则：**UI 能选到的 dtype 才下**。whisper 页面有 q8/fp32 选择器 → 两套都下；
// Marian 页面固定 q8 → 只下 q8（fp32 两件套还要多 425MB/方向，没人会选就不下）。
// ============================================================

/** Seq2Seq 的 encoder/decoder 文件名（whisper 与 Marian 同一套约定） */
const SEQ2SEQ_ONNX = new Set([
  'encoder_model.onnx',
  'encoder_model_quantized.onnx',
  'decoder_model_merged.onnx',
  'decoder_model_merged_quantized.onnx'
])
const seq2seqKeep = p => !p.startsWith('onnx/') || SEQ2SEQ_ONNX.has(p.split('/').pop())

/** 同上，但只保留 q8 两件套（Marian 用） */
const SEQ2SEQ_Q8_ONNX = new Set(['encoder_model_quantized.onnx', 'decoder_model_merged_quantized.onnx'])
const seq2seqQ8Keep = p => !p.startsWith('onnx/') || SEQ2SEQ_Q8_ONNX.has(p.split('/').pop())

/** 单图模型（wav2vec2 分类 / WavLM 声纹）：fp32 + q8 */
const AUDIO_MODEL_ONNX = new Set(['model.onnx', 'model_quantized.onnx'])
const audioModelKeep = p => !p.startsWith('onnx/') || AUDIO_MODEL_ONNX.has(p.split('/').pop())

/** chatterbox：4 个子图，按页面 DTYPE 表只留 fp32 / q4 / q4f16 三套 */
const CHATTERBOX_ONNX = new Set([
  'embed_tokens.onnx', 'embed_tokens.onnx_data',
  'speech_encoder.onnx', 'speech_encoder.onnx_data',
  'conditional_decoder.onnx', 'conditional_decoder.onnx_data',
  'language_model_q4.onnx', 'language_model_q4.onnx_data',
  'language_model_q4f16.onnx', 'language_model_q4f16.onnx_data'
])
const chatterboxKeep = p => !p.startsWith('onnx/') || CHATTERBOX_ONNX.has(p.split('/').pop())

export const SPEECH_REPOS = [
  { alias: 'whisper-tiny', id: 'Xenova/whisper-tiny', label: 'ASR 文件转写 · whisper-tiny（最快）', keep: seq2seqKeep },
  { alias: 'whisper-base', id: 'Xenova/whisper-base', label: 'ASR 文件转写 · whisper-base（均衡）', keep: seq2seqKeep },
  { alias: 'whisper-small', id: 'Xenova/whisper-small', label: 'ASR 文件转写 · whisper-small（更准）', keep: seq2seqKeep },
  { alias: 'ser', id: 'onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX', label: '语音情感识别 (SER)', keep: audioModelKeep },
  { alias: 'chatterbox', id: 'onnx-community/chatterbox-ONNX', label: '语音克隆 Chatterbox（很大）', keep: chatterboxKeep },
  { alias: 'voiceprint', id: 'Xenova/wavlm-base-plus-sv', label: '声纹识别 / 说话人验证', keep: audioModelKeep },
  { alias: 'mt-zh-en', id: 'Xenova/opus-mt-zh-en', label: '语音翻译 · 中→英', keep: seq2seqQ8Keep },
  { alias: 'mt-en-zh', id: 'Xenova/opus-mt-en-zh', label: '语音翻译 · 英→中', keep: seq2seqQ8Keep }
]

/**
 * 下载整个模型仓库到 destDir。
 * @param {string} modelId  如 'Xenova/whisper-tiny'
 * @param {string} destDir  目标目录（该仓库根）
 * @param {object} opts
 *   - keep: (path: string) => boolean  只保留匹配的文件（默认全部）
 *   - skipExts / skipNames: 排除项
 *   - quiet / log
 */
export async function fetchModelRepo(modelId, destDir, opts = {}) {
  const { keep = null, skipExts = ['.gitattributes'], skipNames = ['.gitattributes', 'README.md', 'LICENSE'], quiet = false, log = console.log } = opts
  const resolved = await resolveRepoFiles(modelId)
  if (!resolved) {
    log(`  ERROR 无法列出 ${modelId} 的文件（ModelScope / hf-mirror / huggingface 均不可用）`)
    return { ok: 0, skip: 0, fail: 0, error: 'list-failed' }
  }
  const files = resolved.files.filter((f) => {
    const base = f.path.split('/').pop() || ''
    const ext = base.includes('.') ? `.${base.split('.').pop()}` : ''
    if (skipNames.includes(base) || skipExts.includes(ext)) return false
    if (keep && !keep(f.path)) return false
    return true
  })
  const totalMb = files.reduce((s, f) => s + f.size, 0) / 1048576
  log(`  ${modelId} → ${relative(process.cwd(), destDir)}（${files.length} 个文件，约 ${totalMb.toFixed(1)} MB，源：${resolved.source}）`)

  let ok = 0
  let skip = 0
  let fail = 0
  for (const f of files) {
    const r = await downloadRepoFile(modelId, f.path, destDir, { expectedSize: f.size, quiet, log })
    if (r === 'ok') ok++
    else if (r === 'skip') skip++
    else fail++
  }
  if (!quiet) log(`  合计：新增 ${ok} · 已存在 ${skip} · 失败 ${fail}`)
  return { ok, skip, fail }
}
