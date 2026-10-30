/**
 * 浏览器端人声分离（MDX-Net + onnxruntime-web）。
 *
 * - 模型：Kim_Vocal_2（约 67MB），输出「人声 / 伴奏」两轨
 * - 模型文件走 /model/uvr/…（本地 .models 目录，缺失时路由 302 回退到发布源）
 * - 首次加载后由库写入 CacheStorage，再次使用不再走网络
 * - 推理 WebGPU 优先、WASM 兜底；音频不出浏览器
 *
 * 所有函数只在浏览器端调用；模块顶层不访问 window/navigator（SSR 安全）。
 */
import type { SeparationProgress } from 'web-audio-separation'

const MODEL_NAME = 'Kim_Vocal_2' as const
const MODEL_URL = '/model/uvr/Kim_Vocal_2.onnx'
/** 自托管的 onnxruntime wasm 目录（.models/vendor/onnx，由 scripts/sync-runtime-libs.mjs 从 npm 同步） */
const ORT_WASM_PATH = '/model/vendor/onnx/'

export type VocalStage = 'loading' | 'demixing' | 'writing'

export interface VocalProgress {
  stage: VocalStage
  /** 0-100，跨阶段的总进度 */
  percent: number
}

export interface VocalStems {
  /** 人声轨（blob URL） */
  vocals: string
  /** 伴奏轨（blob URL） */
  instrumental: string
}

let ortPinned = false

/**
 * 把 onnxruntime-web 的 wasm 路径固定到自托管目录。
 * 分离库在 loadModel() 里会强制改回 jsDelivr CDN，因此在它写入前把
 * wasmPaths 定义成只读 getter，保证离线部署也能加载 wasm。
 */
async function pinOrtWasmPath(): Promise<void> {
  if (ortPinned) return
  const ort = await import('onnxruntime-web')
  try {
    ort.env.wasm.wasmPaths = ORT_WASM_PATH
    ort.env.wasm.numThreads = 1
    Object.defineProperty(ort.env.wasm, 'wasmPaths', {
      configurable: true,
      get: () => ORT_WASM_PATH,
      set: () => {}
    })
  } catch {
    // 定义失败时保留库的默认 CDN 路径，联网环境仍可用
  }
  ortPinned = true
}

/** 把库的「阶段内进度」换算成 0-100 的总进度 */
function overallProgress(p: SeparationProgress): VocalProgress {
  switch (p.stage as string) {
    case 'loading-model':
      return { stage: 'loading', percent: Math.round(p.fraction * 10) }
    case 'demixing':
      return { stage: 'demixing', percent: 10 + Math.round(p.fraction * 85) }
    default:
      return { stage: 'writing', percent: 95 + Math.round(p.fraction * 5) }
  }
}

/**
 * 分离一首歌，返回人声与伴奏的 blob URL。
 * 调用方负责在不再使用时 revoke 这两个 URL。
 */
export async function separateVocals(
  audioUrl: string,
  onProgress?: (p: VocalProgress) => void
): Promise<VocalStems> {
  if (typeof window === 'undefined') throw new Error('仅可在浏览器端运行')
  await pinOrtWasmPath()

  const { createSeparator } = await import('web-audio-separation')
  const hasGpu = 'gpu' in navigator
  const separator = createSeparator(MODEL_NAME, {
    common: {
      modelUrl: MODEL_URL,
      logLevel: 'info',
      onProgress: p => onProgress?.(overallProgress(p))
    },
    mdx: {
      segmentSize: 256,
      overlap: 0.25,
      batchSize: 1,
      executionProviders: hasGpu ? ['webgpu', 'wasm'] : ['wasm']
    }
  })

  await separator.loadModel()
  // 返回顺序固定为 [secondary, primary]；Kim_Vocal_2 的主轨是人声
  const [instrumental, vocals] = await separator.separate(audioUrl)
  if (!vocals || !instrumental) throw new Error('分离未返回完整音轨')
  return { vocals, instrumental }
}
