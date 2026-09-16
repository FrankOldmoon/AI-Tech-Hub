/**
 * 录音（MediaRecorder → File）+ 秒表。
 *
 * 替代了 3 份近似代码（speech/voice-clone、voiceprint、speech-translate）：
 * 都是「点开始 → 收 chunk → 点停止 → 拼 Blob 包成 File」，只差文件名前缀。
 * 产物统一是 File，因此后续可直接走 decodeTo16k（与上传文件同一条路径）。
 */
export function useRecorder(options: {
  /** 生成的文件名前缀，如 'voice' → voice-1712345678.webm */
  namePrefix?: string
  /** 录音结束拿到 File 时回调 */
  onStop?: (file: File) => void
  /** 采集/录音失败（含权限被拒）时回调 */
  onError?: (error: unknown) => void
} = {}) {
  const { namePrefix = 'record', onStop, onError } = options

  const recording = ref(false)
  const seconds = ref(0)

  let mediaRecorder: MediaRecorder | null = null
  let recordStream: MediaStream | null = null
  let chunks: Blob[] = []
  let timer: number | null = null

  function stop() {
    try {
      mediaRecorder?.stop()
    } catch {
      /* 已停止时 stop() 会抛，忽略 */
    }
    recordStream?.getTracks().forEach(t => t.stop())
    recordStream = null
    mediaRecorder = null
    recording.value = false
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  async function start() {
    if (recording.value) return
    try {
      recordStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(recordStream)
      chunks = []
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunks, { type })
        chunks = []
        seconds.value = 0
        onStop?.(new File([blob], `${namePrefix}-${Date.now()}.webm`, { type }))
      }
      recorder.start()
      mediaRecorder = recorder
      recording.value = true
      seconds.value = 0
      timer = window.setInterval(() => {
        seconds.value++
      }, 1000)
    } catch (err) {
      stop()
      onError?.(err)
    }
  }

  onBeforeUnmount(stop)

  return { recording, seconds, start, stop }
}
