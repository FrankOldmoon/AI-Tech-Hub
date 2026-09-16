/**
 * 音频输入源（上传文件 / 预置示例）统一状态机。
 *
 * 替代了 8 份重复样板：各页都在自己维护「file ref + objectURL + 隐藏 input + onFileChange +
 * useSample + pickFile + 旧的 URL revoke」。这里把 objectURL 生命周期、解码缓存、时长都收进来，
 * 并统一走 utils/samples 的 fetchSample（此前 audio-classifier / visualizer / pitch-detector /
 * hum-to-notes 各自手写 fetch + new File）。
 */
import { AUDIO_ACCEPT, decodeTo16k } from '~/utils/audio'
import { fetchSample } from '~/utils/samples'

export function useAudioSource(options: {
  /** 该页「试用示例」的默认音频路径 */
  defaultSampleUrl?: string
  onError?: (error: unknown) => void
} = {}) {
  const { defaultSampleUrl = '/samples/audio/speech.wav', onError } = options

  const file = ref<File | null>(null)
  /** 供 <audio src> 播放的 object URL（随文件切换自动回收） */
  const url = ref('')
  const inputRef = ref<HTMLInputElement>()
  /** 最近一次解码得到的秒数（未解码时为 0） */
  const seconds = ref(0)

  /** 已解码缓存：同一 File 只解一次（文件模式常常「先试听再分析」） */
  let decoded: { file: File, samples: Float32Array } | null = null

  function revoke() {
    if (url.value) {
      URL.revokeObjectURL(url.value)
      url.value = ''
    }
  }

  function setFile(next: File | null) {
    revoke()
    decoded = null
    seconds.value = 0
    file.value = next
    if (next) url.value = URL.createObjectURL(next)
  }

  function pick() {
    inputRef.value?.click()
  }

  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    const picked = input.files?.[0]
    if (picked) setFile(picked)
    // 允许连续选同一个文件（否则第二次不触发 change）
    input.value = ''
  }

  async function useSample(path = defaultSampleUrl) {
    try {
      setFile(await fetchSample(path))
    } catch (err) {
      onError?.(err)
    }
  }

  /** 解码为 16kHz 单声道（Whisper / YAMNet / wav2vec / WavLM 的期望输入） */
  async function toSamples16k(): Promise<Float32Array> {
    const current = file.value
    if (!current) throw new Error('no audio file selected')
    if (decoded?.file === current) return decoded.samples
    const samples = await decodeTo16k(current)
    decoded = { file: current, samples }
    seconds.value = Math.round((samples.length / 16000) * 10) / 10
    return samples
  }

  onBeforeUnmount(revoke)

  return { file, url, inputRef, seconds, accept: AUDIO_ACCEPT, setFile, pick, onFileChange, useSample, toSamples16k }
}
