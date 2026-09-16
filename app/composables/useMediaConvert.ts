import { humanError } from '~/utils/errors'
import { convertMedia, type ConvertHooks, type ConvertOptions, type ConvertTarget } from '~/utils/ffmpeg'
import { sizeDelta } from '~/utils/format'

/**
 * 「媒体处理」各页共用的状态机：选文件 → 预览 URL → 转换 → 结果 URL、体积、错误、清理。
 *
 * 用于格式转换（4 页）、目标体积压缩、按时间裁剪等：各页只管控件与模板，
 * 需要多轮尝试的流程（压缩阶梯）用 run 覆盖默认的单次 convertMedia。
 */
export function useMediaConvert(config: {
  /** 默认输出格式 */
  defaultTarget: ConvertTarget
  /** 转换时取一次 ffmpeg 参数（各页的控件自己管；不传就用编码器默认值）。参数是当前选中的输出格式 */
  buildOptions?: (format: ConvertTarget) => ConvertOptions
  /** 覆盖默认的单次转换（默认走 convertMedia）；用于「目标体积压缩」这类要跑多轮的流程 */
  run?: (input: File, format: ConvertTarget, hooks: ConvertHooks, options: ConvertOptions) => Promise<{ blob: Blob, name: string }>
}) {
  const { t } = useI18n()

  const file = ref<File | null>(null)
  /** 源文件预览 URL（objectURL 的回收交给 useObjectUrl，与 useAudioSource 共用同一实现） */
  const source = useObjectUrl()
  const sourceSize = ref(0)
  /** 由各页在预览元素 metadata 就绪后填（分辨率/时长），纯展示 */
  const sourceMeta = ref('')

  const target = ref<ConvertTarget>(config.defaultTarget)
  const converting = ref(false)
  const ratio = ref(0)
  const log = ref('')
  const error = ref<string | null>(null)

  const output = useObjectUrl()
  const outName = ref('')
  const outSize = ref(0)
  /** 体积变化百分比（负数=变小）；原始与结果都已知时才有值 */
  const delta = computed(() => (outSize.value ? sizeDelta(sourceSize.value, outSize.value) : null))

  function clearOutput() {
    ratio.value = 0
    log.value = ''
    outSize.value = 0
    outName.value = ''
    output.clear()
  }

  function select(f: File) {
    clearOutput()
    error.value = null
    file.value = f
    sourceSize.value = f.size
    sourceMeta.value = ''
    source.set(f)
  }

  function reset() {
    clearOutput()
    file.value = null
    sourceSize.value = 0
    sourceMeta.value = ''
    error.value = null
    source.clear()
  }

  async function convert() {
    const f = file.value
    if (!f || converting.value) return
    converting.value = true
    error.value = null
    clearOutput()
    try {
      const hooks: ConvertHooks = {
        onLog: (message) => { log.value = message },
        onProgress: (r) => { ratio.value = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0 }
      }
      const options = config.buildOptions?.(target.value) ?? {}
      const out = config.run
        ? await config.run(f, target.value, hooks, options)
        : await convertMedia(f, target.value, hooks, options)
      output.set(out.blob)
      outName.value = out.name
      outSize.value = out.blob.size
    } catch (e: unknown) {
      error.value = humanError(e, t)
    } finally {
      converting.value = false
    }
  }

  function download() {
    if (!output.url.value) return
    const a = document.createElement('a')
    a.href = output.url.value
    a.download = outName.value
    a.click()
  }

  // 换了输出格式，上一次的结果就不再对应，直接清掉免得看错
  watch(target, clearOutput)
  onBeforeUnmount(reset)

  return {
    file,
    sourceUrl: source.url,
    sourceSize,
    sourceMeta,
    target,
    converting,
    ratio,
    log,
    error,
    outUrl: output.url,
    outName,
    outSize,
    delta,
    select,
    reset,
    convert,
    download
  }
}
