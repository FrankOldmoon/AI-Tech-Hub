/**
 * ffmpeg.wasm 懒加载（CDN）+ 媒体转码：录制产物、用户导入的音视频与图片都走这里。
 *
 * 为什么用单线程核心（`@ffmpeg/core` 的 umd 构建）：多线程核心依赖 SharedArrayBuffer，
 * 而本项目的 COOP/COEP 默认关闭（见 nuxt.config.ts 的 NUXT_ENABLE_CROSS_ORIGIN_ISOLATION），
 * 没有 SAB 就跑不起来。单线程版不依赖 SAB，代价是慢——长视频转码要等。
 *
 * 加载方式沿用 app/utils/tesseract.ts：脚本注入 + 缓存 Promise + 集中一个 BASE 常量。
 * 若以后内网部署无法访问公网，把 CDN_BASE 换成自托管目录即可（例如 /model/vendor/ffmpeg）。
 */

export type ConvertTarget = 'mp4' | 'gif' | 'mp3' | 'wav' | 'ogg' | 'm4a' | 'flac' | 'png' | 'jpg' | 'webp' | 'bmp'

/** 转换可选参数；不传的项一律保持原样（不额外改这一维） */
export interface ConvertOptions {
  /** 长边上限（像素）：视频/图片等比缩到不超过该值，并保证偶数（h264 要求） */
  maxDimension?: number
  /** 视频码率 kbps（仅 mp4；越大越清晰、文件越大） */
  videoBitrate?: number
  /** 音频码率 kbps（mp3/ogg/m4a；不传时用各编码器自己的默认质量） */
  audioBitrate?: number
  /** 有损图片画质 1~100（仅 jpg/webp） */
  imageQuality?: number
  /** GIF 帧率（默认 12） */
  gifFps?: number
  /** GIF 输出宽度（默认 480） */
  gifWidth?: number
  /** 截取起点（秒）；-ss 放输入侧做快速定位 */
  startTime?: number
  /** 截取终点（秒），需大于 startTime；换算成 -t 放输出侧 */
  endTime?: number
  /** 音频重采样率（如 24000）：降采样能省不少体积 */
  sampleRate?: number
  /** 声道数（1 = 单声道；语音场景体积几乎减半） */
  channels?: number
}

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

/** 等比缩放到「长边不超过 max」，并保证偶数尺寸（h264 要求宽高都是偶数） */
function scaleFilter(max: number): string {
  return `scale='min(${max},iw)':'min(${max},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`
}

/** 页面上的「画质 1~100」→ mjpeg 的 -q:v（2 最好、31 最差，方向相反） */
function qualityToQscale(quality: number): number {
  const q = Math.round(31 - (Math.min(100, Math.max(1, quality)) / 100) * 29)
  return Math.min(31, Math.max(2, q))
}

/** 输入侧参数：-ss 放在 -i 之前做快速定位；紧接着用 -t 限制时长（输出侧选项，放这里合法） */
function inputArgs(input: string, o: ConvertOptions): string[] {
  const args: string[] = []
  const start = o.startTime ?? 0
  if (start > 0) args.push('-ss', start.toFixed(3))
  args.push('-i', input)
  if (o.endTime && o.endTime > start) args.push('-t', (o.endTime - start).toFixed(3))
  return args
}

/** 音频输出统一追加的重采样/单声道选项（压缩用；不传就沿用原样） */
function audioShapeArgs(o: ConvertOptions): string[] {
  const args: string[] = []
  if (o.sampleRate) args.push('-ar', String(o.sampleRate))
  if (o.channels) args.push('-ac', String(o.channels))
  return args
}

/**
 * 各目标格式的 ffmpeg 参数；输入容器由 mediaExt 按 MIME 判定。
 * 图片目标一律「只取一帧 + -update 1」，这样视频/GIF 输入时取首帧、单帧 muxer 也不会去拼序列名。
 */
function argsFor(target: ConvertTarget, input: string, output: string, o: ConvertOptions): string[] {
  if (target === 'png' || target === 'jpg' || target === 'webp' || target === 'bmp') {
    const codec = target === 'jpg' ? 'mjpeg' : (target === 'webp' ? 'libwebp' : target)
    const args = [...inputArgs(input, o), '-frames:v', '1', '-c:v', codec]
    if (o.maxDimension) args.push('-vf', scaleFilter(o.maxDimension))
    if (target === 'jpg') args.push('-q:v', String(qualityToQscale(o.imageQuality ?? 85)))
    if (target === 'webp') args.push('-quality', String(Math.min(100, Math.max(1, o.imageQuality ?? 85))))
    args.push('-update', '1', output)
    return args
  }
  if (target === 'mp4') {
    // yuv420p + faststart：手机与剪辑软件都能直接播/拖进度
    const args = [...inputArgs(input, o), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p']
    if (o.maxDimension) args.push('-vf', scaleFilter(o.maxDimension))
    if (o.videoBitrate) {
      // 要按码率压（目标体积就靠它）：ABR + maxrate/bufsize。
      // 关键：这时候**不能**再给 -crf —— x264 在两者同时存在时会走 CRF，码率被忽略（实测过：
      // 传 -crf 23 -b:v 1000k 与只传 -crf 23 出来的体积一样）。两者必须二选一。
      args.push(
        '-b:v', `${o.videoBitrate}k`,
        '-maxrate', `${Math.round(o.videoBitrate * 1.5)}k`,
        '-bufsize', `${o.videoBitrate * 2}k`
      )
    } else {
      args.push('-crf', '23')
    }
    args.push('-c:a', 'aac', '-b:a', `${o.audioBitrate ?? 128}k`, ...audioShapeArgs(o), '-movflags', '+faststart', output)
    return args
  }
  if (target === 'gif') {
    // 一趟内做完 palettegen/paletteuse，比两趟省一次完整解码
    const fps = o.gifFps ?? 12
    const width = o.gifWidth ?? 480
    return [
      ...inputArgs(input, o),
      '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`,
      '-an', '-loop', '0',
      output
    ]
  }
  if (target === 'wav') {
    // PCM 16bit；默认 44.1kHz，压缩时可降采样
    const args = [...inputArgs(input, o), '-vn', '-c:a', 'pcm_s16le', '-ar', String(o.sampleRate ?? 44100)]
    if (o.channels) args.push('-ac', String(o.channels))
    args.push(output)
    return args
  }
  if (target === 'ogg') {
    const rate = o.audioBitrate ? ['-b:a', `${o.audioBitrate}k`] : ['-q:a', '5']
    return [...inputArgs(input, o), '-vn', '-c:a', 'libvorbis', ...rate, ...audioShapeArgs(o), output]
  }
  if (target === 'm4a') {
    return [...inputArgs(input, o), '-vn', '-c:a', 'aac', '-b:a', `${o.audioBitrate ?? 192}k`, ...audioShapeArgs(o), output]
  }
  if (target === 'flac') {
    return [...inputArgs(input, o), '-vn', '-c:a', 'flac', '-compression_level', '8', ...audioShapeArgs(o), output]
  }
  // 兜底 = MP3
  const rate = o.audioBitrate ? ['-b:a', `${o.audioBitrate}k`] : ['-q:a', '2']
  return [...inputArgs(input, o), '-vn', '-c:a', 'libmp3lame', ...rate, ...audioShapeArgs(o), output]
}

/**
 * 输入文件的容器后缀，按 MIME 判定：Chrome 录音是 webm/Opus、Safari 是 m4a/AAC。
 * ffmpeg 主要靠内容探测，但给它对得上的后缀能少一层歧义；下载名也用同一套判断，
 * 免得把 AAC 内容存成 .webm（打不开）或把 PNG 存成 .bin。
 */
export function mediaExt(blob: Blob): string {
  const type = (blob.type || '').toLowerCase()
  if (type.startsWith('image/')) {
    if (type.includes('png')) return 'png'
    if (type.includes('webp')) return 'webp'
    if (type.includes('bmp')) return 'bmp'
    if (type.includes('gif')) return 'gif'
    return 'jpg'
  }
  if (type.startsWith('audio/')) {
    if (type.includes('mp4') || type.includes('aac')) return 'm4a'
    if (type.includes('ogg')) return 'ogg'
    if (type.includes('wav')) return 'wav'
    if (type.includes('mpeg')) return 'mp3'
    if (type.includes('flac')) return 'flac'
    return 'webm'
  }
  if (type.includes('webm')) return 'webm'
  if (type.includes('quicktime')) return 'mov'
  if (type.includes('matroska')) return 'mkv'
  return 'mp4'
}

const EXT: Record<ConvertTarget, string> = {
  mp4: 'mp4', gif: 'gif', mp3: 'mp3', wav: 'wav', ogg: 'ogg', m4a: 'm4a', flac: 'flac',
  png: 'png', jpg: 'jpg', webp: 'webp', bmp: 'bmp'
}
const MIME: Record<ConvertTarget, string> = {
  mp4: 'video/mp4', gif: 'image/gif', mp3: 'audio/mpeg',
  wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp'
}

export interface ConvertHooks {
  onLog?: (message: string) => void
  onProgress?: (ratio: number) => void
}

/** 输出文件名：优先沿用输入文件名（只有 File 才有 name），并清掉路径分隔符等非法字符 */
function outputNameFor(input: Blob, target: ConvertTarget): string {
  const src = input instanceof File ? input.name : ''
  const base = (src || 'output').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
  return `${base || 'output'}.${EXT[target]}`
}

/**
 * 把媒体（录制产物 / 用户导入的文件）转成目标格式。
 * 注意：ffmpeg 实例与 log/progress 回调都是模块级单例，请勿并发调用本函数（页面同时只跑一个转换）。
 */
export async function convertMedia(
  input: Blob,
  target: ConvertTarget,
  hooks: ConvertHooks = {},
  options: ConvertOptions = {}
): Promise<{ blob: Blob, name: string }> {
  const ff = await loadFfmpeg()
  let lastLog: string | undefined
  logSink = (message) => {
    lastLog = message
    hooks.onLog?.(message)
  }
  progressSink = hooks.onProgress ?? null
  const inputName = `input.${mediaExt(input)}`
  const outputName = outputNameFor(input, target)
  try {
    await ff.writeFile(inputName, new Uint8Array(await input.arrayBuffer()))
    lastLog = ''
    const code = await ff.exec(argsFor(target, inputName, outputName, options))
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

/** 目标体积压缩的画质阶梯：从高到低逐档试，命中目标立刻停 */
const IMAGE_QUALITY_LADDER = [92, 85, 78, 70, 62, 54, 46, 38, 30]

export interface CompressResult {
  blob: Blob
  name: string
  /** 最终采用的画质（1~100） */
  quality: number
  /** 实际尝试的轮数 */
  attempts: number
  /** 是否压到了目标体积以内 */
  reached: boolean
}

/**
 * 把图片压到目标体积以内（有损格式）。
 *
 * 为什么是阶梯试而不是一次算准：webp/jpeg 的体积对画质高度非线性，编码结果还依赖图像内容，
 * 只能编码一遍再量实际大小。最坏情况会跑满整个阶梯（每档一次完整 ffmpeg 调用，都要把输入
 * 写进虚拟文件系统），命中目标就立刻返回；整条阶梯都压不下去时，返回其中最小的那个并置
 * reached=false —— 由页面去提示用户「再调小长边」。
 */
export async function compressImageUnder(
  input: Blob,
  targetBytes: number,
  options: {
    format?: 'jpg' | 'webp'
    maxDimension?: number
    hooks?: ConvertHooks
    onStep?: (step: { quality: number, size: number, reached: boolean }) => void
  } = {}
): Promise<CompressResult> {
  const format = options.format ?? 'webp'
  let best: { blob: Blob, name: string, quality: number } | null = null
  let attempts = 0
  for (const quality of IMAGE_QUALITY_LADDER) {
    attempts++
    const out = await convertMedia(input, format, options.hooks ?? {}, {
      imageQuality: quality,
      maxDimension: options.maxDimension
    })
    const reached = out.blob.size <= targetBytes
    if (!best || out.blob.size < best.blob.size) best = { blob: out.blob, name: out.name, quality }
    options.onStep?.({ quality, size: out.blob.size, reached })
    if (reached) return { blob: out.blob, name: out.name, quality, attempts, reached: true }
  }
  if (!best) throw new Error('压缩没有产出文件')
  return { blob: best.blob, name: best.name, quality: best.quality, attempts, reached: false }
}
