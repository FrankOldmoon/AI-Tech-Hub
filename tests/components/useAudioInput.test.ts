/**
 * 音频输入统一入口：把三路输入（文件 / 麦克风 / 录音）收敛成一个状态机。
 *
 * 三个底层 composable 全部换成替身，这里验证的是「接线」本身 —— 选项有没有透传下去、
 * 录音产物有没有默认变成当前文件、stop() 有没有把两路采集都收干净。
 * （真实采集链的行为由各自 composable 与使用它的页面覆盖。）
 */
import '../support/nuxt-env'
import type { Ref } from 'vue'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAudioInput } from '~/composables/useAudioInput'

type Spy = ReturnType<typeof vi.fn>

interface FileApi {
  file: Ref<File | null>
  url: Ref<string>
  seconds: Ref<number>
  accept: string
  setFile: Spy
  pick: Spy
  onFileChange: Spy
  useSample: Spy
  toSamples16k: Spy
}

interface MicApi {
  running: Ref<boolean>
  start: Spy
  stop: Spy
}

interface RecordApi {
  recording: Ref<boolean>
  seconds: Ref<number>
  stream: Ref<MediaStream | null>
  start: Spy
  stop: Spy
}

interface RecorderOptions {
  namePrefix?: string
  onStop: (file: File) => void
  onError?: (error: unknown) => void
}

let fileApi: FileApi
let micApi: MicApi
let recordApi: RecordApi
let recorderOptions: RecorderOptions | undefined
let useAudioSourceMock: Spy
let useMicStreamMock: Spy
let useRecorderMock: Spy

function setGlobal(name: string, value: unknown) {
  (globalThis as unknown as Record<string, unknown>)[name] = value
}

beforeEach(() => {
  recorderOptions = undefined
  fileApi = {
    file: ref<File | null>(null),
    url: ref(''),
    seconds: ref(0),
    accept: 'audio/*',
    setFile: vi.fn(),
    pick: vi.fn(),
    onFileChange: vi.fn(),
    useSample: vi.fn(),
    toSamples16k: vi.fn(async () => new Float32Array([1, 2]))
  }
  micApi = { running: ref(false), start: vi.fn(async () => {}), stop: vi.fn() }
  recordApi = {
    recording: ref(false),
    seconds: ref(0),
    stream: ref<MediaStream | null>(null),
    start: vi.fn(async () => {}),
    stop: vi.fn()
  }

  useAudioSourceMock = vi.fn(() => fileApi)
  useMicStreamMock = vi.fn(() => micApi)
  useRecorderMock = vi.fn((options: RecorderOptions) => {
    recorderOptions = options
    return recordApi
  })
  setGlobal('useAudioSource', useAudioSourceMock)
  setGlobal('useMicStream', useMicStreamMock)
  setGlobal('useRecorder', useRecorderMock)
})

describe('useAudioInput 组成', () => {
  it('三路输入各接一个底层 composable', () => {
    useAudioInput()
    expect(useAudioSourceMock).toHaveBeenCalledTimes(1)
    expect(useMicStreamMock).toHaveBeenCalledTimes(1)
    expect(useRecorderMock).toHaveBeenCalledTimes(1)
  })

  it('默认停在「文件」，可用 initialMode 指定', () => {
    expect(useAudioInput().mode.value).toBe('file')
    expect(useAudioInput({ initialMode: 'record' }).mode.value).toBe('record')
  })

  it('把选项透传给对应的一路（示例音频、文件名前缀、统一错误出口）', () => {
    const onError = vi.fn()
    useAudioInput({ defaultSampleUrl: '/samples/a.wav', namePrefix: 'ref', onError })

    expect(useAudioSourceMock).toHaveBeenCalledWith({ defaultSampleUrl: '/samples/a.wav', onError })
    expect(useRecorderMock).toHaveBeenCalledWith(
      expect.objectContaining({ namePrefix: 'ref', onError })
    )
  })

  it('把下层的 refs 原样暴露出来（页面据此渲染，不复制状态）', () => {
    const input = useAudioInput()
    expect(input.file).toBe(fileApi.file)
    expect(input.url).toBe(fileApi.url)
    expect(input.seconds).toBe(fileApi.seconds)
    expect(input.micRunning).toBe(micApi.running)
    expect(input.recording).toBe(recordApi.recording)
    expect(input.recordSeconds).toBe(recordApi.seconds)
    expect(input.recordStream).toBe(recordApi.stream)
  })
})

describe('useAudioInput 麦克风', () => {
  it('startMic 透传采样率、帧回调与裸流回调', async () => {
    const onFrame = vi.fn()
    const onMicReady = vi.fn()
    const onError = vi.fn()
    const input = useAudioInput({ sampleRate: 8000, bufferSize: 1024, onFrame, onMicReady, onError })

    await input.startMic()

    expect(micApi.start).toHaveBeenCalledWith({
      sampleRate: 8000,
      bufferSize: 1024,
      onFrame,
      onReady: onMicReady,
      onError
    })
  })

  it('没指定采样率时把 undefined 交给下层（默认值由 useMicStream 兜底，不在这里硬编码）', async () => {
    await useAudioInput().startMic()
    expect(micApi.start).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: undefined }))
  })
})

describe('useAudioInput 录音', () => {
  it('录音结束：产物默认成为当前文件（与上传同一条后续路径）', () => {
    useAudioInput()
    const file = new File(['x'], 'record-1.webm', { type: 'audio/webm' })

    recorderOptions?.onStop(file)

    expect(fileApi.setFile).toHaveBeenCalledWith(file)
  })

  it('页面自己的 onRecorded 在默认行为之后追加调用', () => {
    const onRecorded = vi.fn()
    useAudioInput({ onRecorded })
    const file = new File(['x'], 'record-1.webm', { type: 'audio/webm' })

    recorderOptions?.onStop(file)

    expect(fileApi.setFile).toHaveBeenCalledWith(file)
    expect(onRecorded).toHaveBeenCalledWith(file)
  })

  it('录音下的错误也走统一的 onError', () => {
    const onError = vi.fn()
    useAudioInput({ onError })
    const error = new Error('boom')
    recorderOptions?.onError?.(error)
    expect(onError).toHaveBeenCalledWith(error)
  })
})

describe('useAudioInput 统一状态与收尾', () => {
  it('active 表示「麦克风或录音正在采集」', () => {
    const input = useAudioInput()
    expect(input.active.value).toBe(false)

    micApi.running.value = true
    expect(input.active.value).toBe(true)

    micApi.running.value = false
    recordApi.recording.value = true
    expect(input.active.value).toBe(true)
  })

  it('stop() 一次收干净两路采集', () => {
    useAudioInput().stop()
    expect(micApi.stop).toHaveBeenCalledTimes(1)
    expect(recordApi.stop).toHaveBeenCalledTimes(1)
  })

  it('stopMic / stopRecord 分别对应各自的一路', () => {
    const input = useAudioInput()
    input.stopMic()
    expect(micApi.stop).toHaveBeenCalledTimes(1)
    input.stopRecord()
    expect(recordApi.stop).toHaveBeenCalledTimes(1)
  })
})

describe('useAudioInput 文件代理', () => {
  it('setFile / useSample 直接转发给文件那一路', () => {
    const input = useAudioInput()
    const file = new File(['x'], 'a.wav', { type: 'audio/wav' })

    input.setFile(file)
    input.useSample('/samples/a.wav')

    expect(fileApi.setFile).toHaveBeenCalledWith(file)
    expect(fileApi.useSample).toHaveBeenCalledWith('/samples/a.wav')
  })

  it('toSamples16k 转发并保留下层的解码缓存（同一文件不重复解码）', async () => {
    const input = useAudioInput()
    const samples = await input.toSamples16k()
    expect(samples).toBeInstanceOf(Float32Array)
    expect(fileApi.toSamples16k).toHaveBeenCalledTimes(1)
  })
})
