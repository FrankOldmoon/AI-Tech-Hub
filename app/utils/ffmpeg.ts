/**
 * ffmpeg.wasm 懒加载（CDN）+ 录制文件转码。
 *
 * 为什么用单线程核心（`@ffmpeg/core` 的 umd 构建）：多线程核心依赖 SharedArrayBuffer，
 * 而本项目的 COOP/COEP 默认关闭（见 nuxt.config.ts 的 NUXT_ENABLE_CROSS_ORIGIN_ISOLATION），
 * 没有 SAB 就跑不起来。单线程版不依赖 SAB，代价是慢——长视频转码要等。
 *
 * 加载方式沿用 app/utils/tesseract.ts：脚本注入 + 缓存 Promise + 集中一个 BASE 常量。
 * 若以后内网部署无法访问公网，把 CDN_BASE 换成自托管目录即可（例如 /model/vendor/ffmpeg）。
 */

export type ConvertTarget = 'mp4' | 'gif' | 'mp3'

export interface FfmpegLogEvent {
  type: string
  message: string
}

export interface FfmpegProgressEvent {
  progress: number
  time: number
}

/** @ffmpeg/ffmpeg 实例的最小接口（脚本从 CDN 注入，拿不到官方类型） */
export interface FfmpegLike {
  load(options: { coreURL: string, wasmURL: string, classWorkerURL?: string }): Promise<void>
  writeFile(path: string, data: Uint8Array): Promise<boolean>
  readFile(path: string): Promise<Uint8Array | string>
  deleteFile(path: string): Promise<boolean>
  exec(args: string[]): Promise<number>
  on(event: 'log', handler: (e: FfmpegLogEvent) => void): void
  on(event: 'progress', handler: (e: FfmpegProgressEvent) => void): void
  terminate(): void
}

interface FfmpegGlobals {
  FFmpegWASM?: { FFmpeg: new () => FfmpegLike }
  FFmpegUtil?: { toBlobURL: (url: string, mime: string) => Promise<string> }
}

const CDN_BASE = 'https://cdn.jsdelivr.net/npm'
const FFMPEG_VERSION = '0.12.10'
const UTIL_VERSION = '0.12.1'
/** 单线程核心：不依赖 SharedArrayBuffer（多线程版是 @ffmpeg/core-mt） */
const CORE_VERSION = '0.12.6'

let ffmpegPromise: Promise<FfmpegLike> | null = null
let logSink: ((message: string) => void) | null = null
let progressSink: ((ratio: number) => void) | null = null

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`加载失败：${src}`))
    document.head.appendChild(script)
  })
}

export function loadFfmpeg(): Promise<FfmpegLike> {
  if (import.meta.server) {
    return Promise.reject(new Error('ffmpeg.wasm 只能在浏览器里运行'))
  }
  if (ffmpegPromise) return ffmpegPromise
  ffmpegPromise = (async () => {
    const g = globalThis as unknown as FfmpegGlobals
    if (!g.FFmpegWASM || !g.FFmpegUtil) {
      await Promise.all([
        injectScript(`${CDN_BASE}/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/umd/ffmpeg.js`),
        injectScript(`${CDN_BASE}/@ffmpeg/util@${UTIL_VERSION}/dist/umd/index.js`)
      ])
    }
    const Ctor = g.FFmpegWASM?.FFmpeg
    const toBlobURL = g.FFmpegUtil?.toBlobURL
    if (!Ctor || !toBlobURL) {
      throw new Error('ffmpeg CDN 脚本已加载，但全局对象缺失')
    }
    const instance = new Ctor()
    instance.on('log', (e) => {
      logSink?.(e.message)
    })
    instance.on('progress', (e) => {
      progressSink?.(e.progress)
    })
    // core 必须用 esm 版：库的 worker 是 module worker，它用 (await import(coreURL)).default
    // 取 core，UMD 版只挂全局变量、没有 default 导出（实测会报 "failed to import ffmpeg-core.js"）
    const core = `${CDN_BASE}/@ffmpeg/core@${CORE_VERSION}/dist/esm`
    const umd = `${CDN_BASE}/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/umd`
    // 三处都要用 blob URL 包一层：core 与库自身的 worker（814.ffmpeg.js）都会以 URL 构造
    // Worker，而 Worker 不接受跨域脚本（实测不包会报 "cannot be accessed from origin"）。
    await instance.load({
      coreURL: await toBlobURL(`${core}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${core}/ffmpeg-core.wasm`, 'application/wasm'),
      classWorkerURL: await toBlobURL(`${umd}/814.ffmpeg.js`, 'text/javascript')
    })
    return instance
  })()
  // 失败后清掉缓存，允许用户重试（例如换了网络）
  ffmpegPromise.catch(() => {
    ffmpegPromise = null
  })
  return ffmpegPromise
}

/** 各目标格式的 ffmpeg 参数；输入固定是录制出来的 webm */
function argsFor(target: ConvertTarget, input: string, output: string): string[] {
  if (target === 'mp4') {
    // yuv420p + faststart：手机与剪辑软件都能直接播/拖进度
    return [
      '-i', input,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      output
    ]
  }
  if (target === 'gif') {
    // 一趟内做完 palettegen/paletteuse，比两趟省一次完整解码
    return [
      '-i', input,
      '-vf', 'fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
      '-an', '-loop', '0',
      output
    ]
  }
  return ['-i', input, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', output]
}

const EXT: Record<ConvertTarget, string> = { mp4: 'mp4', gif: 'gif', mp3: 'mp3' }
const MIME: Record<ConvertTarget, string> = { mp4: 'video/mp4', gif: 'image/gif', mp3: 'audio/mpeg' }

export interface ConvertHooks {
  onLog?: (message: string) => void
  onProgress?: (ratio: number) => void
}

/**
 * 把录制产物转成目标格式。注意：ffmpeg 实例是复用的，log/progress 回调是模块级单例，
 * 因此请勿并发调用本函数（页面上也只会有一个转换在跑）。
 */
export async function convertRecording(
  input: Blob,
  target: ConvertTarget,
  hooks: ConvertHooks = {}
): Promise<{ blob: Blob, name: string }> {
  const ff = await loadFfmpeg()
  let lastLog: string | undefined
  logSink = (message) => {
    lastLog = message
    hooks.onLog?.(message)
  }
  progressSink = hooks.onProgress ?? null
  const inputName = 'recording.webm'
  const outputName = `recording.${EXT[target]}`
  try {
    await ff.writeFile(inputName, new Uint8Array(await input.arrayBuffer()))
    lastLog = ''
    const code = await ff.exec(argsFor(target, inputName, outputName))
    if (code !== 0) {
      // 带上 ffmpeg 的最后一行输出：常见原因（源文件没有音轨、编码器不支持该参数）都在里面
      const detail = lastLog ? `：${lastLog}` : ''
      throw new Error(`ffmpeg 退出码 ${code}${detail}`)
    }
    const data = await ff.readFile(outputName)
    const raw = typeof data === 'string' ? new TextEncoder().encode(data) : data
    if (!raw.length) {
      throw new Error('ffmpeg 没有产出文件')
    }
    // 再拷一层：readFile 给的是 wasm 堆上的视图（Uint8Array<ArrayBufferLike>），
    // 而 TS 的 BlobPart 只接受由 ArrayBuffer 支撑的视图
    const bytes = new Uint8Array(raw)
    return { blob: new Blob([bytes], { type: MIME[target] }), name: outputName }
  } finally {
    logSink = null
    progressSink = null
    // 清掉虚拟文件系统里的临时文件，避免连续转换时越积越大
    await ff.deleteFile(inputName).catch(() => false)
    await ff.deleteFile(outputName).catch(() => false)
  }
}
