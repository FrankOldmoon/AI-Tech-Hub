/**
 * 麦克风实时流：getUserMedia → AudioContext → 定长帧回调。
 *
 * 替代了 4 份逐行相同的样板（speech/audio-classifier、emotion、hum-to-notes、pitch-detector）：
 * 都需要「16kHz 单声道 + 4096 样本帧 + 组件卸载时彻底 teardown」，区别只在拿到帧后干什么。
 *
 * 保留 ScriptProcessorNode：它虽已 deprecated 但全站如此、可用性经过验证；
 * 换成 AudioWorklet 需要额外 worklet 模块且改动超出「消除重复」的范围（见文件末尾备注）。
 */
export interface MicStreamOptions {
  /** AudioContext 采样率，默认 16000（YAMNet / Whisper / wav2vec 的期望输入） */
  sampleRate?: number
  /** 每帧样本数，默认 4096 */
  bufferSize?: number
  /** 逐帧回调（已是单声道 Float32Array，长度 = bufferSize） */
  onFrame?: (frame: Float32Array) => void
  /**
   * 需要**自己掌控音频图**的场景（如变声效果链：麦克风 → 滤波/波形整形 → 输出节点）。
   * 提供后不再挂 ScriptProcessor，只把裸 stream 与 audioCtx 交出去。
   * 流与 context 的关闭仍由本 composable 负责，调用方不要再关一次（会双重释放）。
   */
  onReady?: (ctx: { stream: MediaStream, audioCtx: AudioContext }) => void
  /** 采集链路出错（含权限被拒）时回调，回调后流会被自动停止 */
  onError?: (error: unknown) => void
}

export function useMicStream() {
  const running = ref(false)

  let stream: MediaStream | null = null
  let audioCtx: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let processor: ScriptProcessorNode | null = null

  function stop() {
    running.value = false
    if (processor) {
      processor.disconnect()
      processor.onaudioprocess = null
      processor = null
    }
    if (source) {
      source.disconnect()
      source = null
    }
    if (audioCtx) {
      audioCtx.close()
      audioCtx = null
    }
    if (stream) {
      stream.getTracks().forEach(t => t.stop())
      stream = null
    }
  }

  async function start(options: MicStreamOptions) {
    const { sampleRate = 16000, bufferSize = 4096, onFrame, onReady, onError } = options
    // 先停掉上一路，避免重复 start 时残留两条采集链
    stop()
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      })
      audioCtx = new AudioContext({ sampleRate })

      // 只要裸流的场景（效果链）不接 ScriptProcessor：多挂一个节点既没用还可能引入延迟
      if (!onFrame) {
        if (onReady) onReady({ stream, audioCtx })
        running.value = true
        return
      }

      source = audioCtx.createMediaStreamSource(stream)
      processor = audioCtx.createScriptProcessor(bufferSize, 1, 1)
      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        try {
          onFrame(e.inputBuffer.getChannelData(0))
        } catch (err) {
          stop()
          onError?.(err)
        }
      }
      source.connect(processor)
      // 必须连到 destination，否则部分浏览器不触发 onaudioprocess
      processor.connect(audioCtx.destination)
      running.value = true
    } catch (err) {
      stop()
      onError?.(err)
    }
  }

  onBeforeUnmount(stop)

  return { running, start, stop }
}
