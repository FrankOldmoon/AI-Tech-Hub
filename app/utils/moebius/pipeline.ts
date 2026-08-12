// Moebius 浏览器推理管线（移植自 simonw/moebius-web，Apache-2.0）
// ONNX Runtime Web（WebGPU 优先 / WASM 兜底）+ 自定义 DDIM/CFG 采样循环
import { IMG, LAT, randn, canvasToCHW, maskCanvasToBinary, makeMaskedCHW, maskToLatent, chwToImageData, pasteBack } from './imaging'
import { makeDDIM, ddimStep } from './ddim'
import { loadModelBytes, requestPersistentStorage } from './modelcache'

const SCALING_FACTOR = 0.13025
const NOISE_OFFSET = 0.0357
const HALF_IDS = 10 // num_embeddings/2

export interface MoebiusProgress {
  (stage: string, step?: number, total?: number): void
}

export interface MoebiusRunOptions {
  steps: number
  guidance: number
  seed: number
  paste: boolean
  onProgress?: MoebiusProgress
}

let ortPromise: Promise<any> | null = null

/** 动态加载 onnxruntime-web（webgpu bundle，wasm 内嵌，无需 wasmPaths） */
export function loadOrt(): Promise<any> {
  ortPromise ??= import('onnxruntime-web/webgpu').catch((e) => {
    ortPromise = null // 允许重试
    throw e
  })
  return ortPromise
}

export class MoebiusPipeline {
  private enc: any = null
  private dec: any = null
  private unet: any = null
  public backend = 'unknown'

  async load(modelBase: string, onProgress?: MoebiusProgress): Promise<void> {
    const ort = await loadOrt()
    const ep: string[] = 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm']
    const opts = { executionProviders: ep, graphOptimizationLevel: 'all' }
    void requestPersistentStorage()

    const get = (file: string, label: string, idx: number) =>
      loadModelBytes(`${modelBase}/${file}`, (loaded, total, fromCache) =>
        onProgress?.(fromCache ? `${label} (cached, ${idx}/3)` : `Downloading ${label} (${idx}/3)`, loaded, total))

    this.enc = await ort.InferenceSession.create(await get('vae_encoder.onnx', 'VAE encoder', 1), opts)
    this.dec = await ort.InferenceSession.create(await get('vae_decoder.onnx', 'VAE decoder', 2), opts)
    this.unet = await ort.InferenceSession.create(await get('unet.onnx', 'UNet', 3), opts)
    this.backend = ep[0]
  }

  private async encode(chw: Float32Array): Promise<Float32Array> {
    const ort = await loadOrt()
    const t = new ort.Tensor('float32', chw, [1, 3, IMG, IMG])
    const { moments } = await this.enc.run({ image: t })
    const m = moments.data as Float32Array
    const out = new Float32Array(4 * LAT * LAT)
    for (let i = 0; i < out.length; i++) out[i] = m[i] * SCALING_FACTOR
    return out
  }

  private async decode(latent: Float32Array): Promise<ImageData> {
    const ort = await loadOrt()
    const scaled = new Float32Array(latent.length)
    for (let i = 0; i < latent.length; i++) scaled[i] = latent[i] / SCALING_FACTOR
    const t = new ort.Tensor('float32', scaled, [1, 4, LAT, LAT])
    const { image } = await this.dec.run({ latent: t })
    return chwToImageData(image.data as Float32Array)
  }

  /** 组装 (2,9,64,64) CFG 输入并跑 UNet，返回 CFG 融合后的噪声预测 */
  private async unetCFG(
    latents: Float32Array,
    mask64: Float32Array,
    maskedLat: Float32Array,
    t: number,
    guidance: number,
  ): Promise<Float32Array> {
    const ort = await loadOrt()
    const plane = LAT * LAT
    const nine = new Float32Array(9 * plane)
    nine.set(latents.subarray(0, 4 * plane), 0)
    nine.set(mask64, 4 * plane)
    nine.set(maskedLat.subarray(0, 4 * plane), 5 * plane)

    const nine2 = new Float32Array(2 * 9 * plane)
    nine2.set(nine, 0)
    nine2.set(nine, 9 * plane)

    const ids = new BigInt64Array(2 * HALF_IDS)
    for (let i = 0; i < HALF_IDS; i++) {
      ids[i] = BigInt(HALF_IDS + i) // uncond [10..19]
      ids[HALF_IDS + i] = BigInt(i) // cond   [0..9]
    }
    const ts = new BigInt64Array([BigInt(t), BigInt(t)])

    const out = await this.unet.run({
      latent: new ort.Tensor('float32', nine2, [2, 9, LAT, LAT]),
      timesteps: new ort.Tensor('int64', ts, [2]),
      input_ids: new ort.Tensor('int64', ids, [2, HALF_IDS]),
    })
    const noise = out.noise.data as Float32Array
    const n = 4 * plane
    const cfg = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const u = noise[i]
      const c = noise[n + i]
      cfg[i] = u + guidance * (c - u)
    }
    return cfg
  }

  async run(
    imageCanvas: HTMLCanvasElement,
    maskCanvas: HTMLCanvasElement,
    opts: MoebiusRunOptions,
  ): Promise<HTMLCanvasElement> {
    const { steps, guidance, seed, paste, onProgress } = opts
    const ddim = makeDDIM(steps)

    onProgress?.('Encoding image')
    const imgCHW = canvasToCHW(imageCanvas)
    const maskBin = maskCanvasToBinary(maskCanvas)
    const maskedCHW = makeMaskedCHW(imgCHW, maskBin)
    const mask64 = maskToLatent(maskBin)

    const maskedLat = await this.encode(maskedCHW)

    const plane = LAT * LAT
    let latents = randn(4 * plane, seed)
    const off = randn(4, seed ^ 0x9e3779b9)
    for (let c = 0; c < 4; c++) {
      for (let p = 0; p < plane; p++) latents[c * plane + p] += NOISE_OFFSET * off[c]
    }

    const tl = ddim.timesteps
    for (let i = 0; i < tl.length; i++) {
      const t = tl[i]
      const prevT = i + 1 < tl.length ? tl[i + 1] : -1
      onProgress?.('Denoising', i + 1, tl.length)
      const eps = await this.unetCFG(latents, mask64, maskedLat, t, guidance)
      latents = ddimStep(eps, latents, t, prevT, ddim)
      await new Promise((r) => setTimeout(r, 0)) // 让 UI 刷新
    }

    onProgress?.('Decoding')
    const resultData = await this.decode(latents)

    const out = document.createElement('canvas')
    out.width = IMG
    out.height = IMG
    if (paste) {
      return pasteBack(resultData, imageCanvas, maskBin)
    }
    out.getContext('2d')!.putImageData(resultData, 0, 0)
    return out
  }
}
