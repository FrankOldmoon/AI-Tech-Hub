/**
 * 音频输入统一入口：上传文件 / 麦克风实时 / 录音，三条路径收敛到一个状态机。
 *
 * 底层仍是三个各司其职的 composable，这里只做三件事，避免各页再自己拼：
 * 1. 提供一个 `mode`，页面不必再自己维护「当前用哪种输入」；
 * 2. 三者的错误统一走一个 onError，页面只处理一处；
 * 3. 提供 `stop()`：一次把麦克风与录音都收干净（切模式 / 重跑 / 离开页面前用）。
 *
 * 产物也统一：文件与录音最终都是 File（都能继续走 toSamples16k 解码成 16kHz 单声道），
 * 实时麦克风则通过 onFrame 逐帧交出去。UI 见 components/AudioInput.vue。
 */
export type AudioInputMode = 'file' | 'mic' | 'record'

export interface AudioInputOptions {
  /** 「试用示例」的默认音频（未传则用 speech.wav） */
  defaultSampleUrl?: string
  /** 初始输入形态，默认 file */
  initialMode?: AudioInputMode
  /** 麦克风采样率，默认 16000（语音模型的期望输入） */
  sampleRate?: number
  /** 每帧样本数，默认 4096 */
  bufferSize?: number
  /** 麦克风逐帧回调（16kHz 单声道，长度 = bufferSize） */
  onFrame?: (frame: Float32Array) => void
  /** 需要自己掌控音频图时（可视化 / 效果链）拿到裸流与 AudioContext */
  onMicReady?: (ctx: { stream: MediaStream, audioCtx: AudioContext }) => void
  /**
   * 录音结束的回调。录音产物默认就成为「当前文件」（与上传同一条后续路径），
   * 需要额外处理（如页面自己留一份结果）时再传这个回调，它在默认行为之后调用。
   */
  onRecorded?: (file: File) => void
  /** 录音文件名前缀，默认 record */
  namePrefix?: string
  /** 统一错误出口（三类输入的错误都从这里出） */
  onError?: (error: unknown) => void
}

export function useAudioInput(options: AudioInputOptions = {}) {
  const mode = ref<AudioInputMode>(options.initialMode ?? 'file')

  const file = useAudioSource({
    defaultSampleUrl: options.defaultSampleUrl,
    onError: options.onError
  })
  const mic = useMicStream()
  const recorder = useRecorder({
    namePrefix: options.namePrefix,
    onStop: (recorded) => {
      // 录音产物即当前文件：后续解码/推理与「上传文件」完全同一条路径
      file.setFile(recorded)
      options.onRecorded?.(recorded)
    },
    onError: options.onError
  })

  /** 麦克风或录音正在采集 */
  const active = computed(() => mic.running.value || recorder.recording.value)

  /**
   * 停掉两条采集链。底层各自都注册了卸载钩子，所以重复调用是安全的；
   * 页面在「切模式 / 重新开始前」显式调一次，能立刻灭掉摄像头灯而不是等卸载。
   */
  function stop() {
    mic.stop()
    recorder.stop()
  }

  /** 开麦：把本 composable 的选项透传给 useMicStream */
  function startMic() {
    return mic.start({
      sampleRate: options.sampleRate,
      bufferSize: options.bufferSize,
      onFrame: options.onFrame,
      onReady: options.onMicReady,
      onError: options.onError
    })
  }

  /** 解码成 16kHz 单声道（Whisper / YAMNet / WavLM 等的期望输入），结果带缓存 */
  function toSamples16k(): Promise<Float32Array> {
    return file.toSamples16k()
  }

  return {
    /** 当前输入形态（文件 / 麦克风 / 录音） */
    mode,
    // —— 文件 ——
    file: file.file,
    url: file.url,
    seconds: file.seconds,
    accept: file.accept,
    setFile: file.setFile,
    pick: file.pick,
    onFileChange: file.onFileChange,
    useSample: file.useSample,
    toSamples16k,
    // —— 麦克风 ——
    micRunning: mic.running,
    startMic,
    stopMic: mic.stop,
    // —— 录音 ——
    recording: recorder.recording,
    recordSeconds: recorder.seconds,
    recordStream: recorder.stream,
    startRecord: recorder.start,
    stopRecord: recorder.stop,
    // —— 统一 ——
    active,
    stop
  }
}
