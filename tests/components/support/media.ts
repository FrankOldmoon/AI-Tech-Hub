/**
 * 补上 happy-dom 缺的浏览器媒体能力。
 *
 * 被测链路（拍照 / 实时帧）依赖这些 API，而 happy-dom 要么没实现、要么返回空值：
 * - `<video>`：videoWidth / videoHeight 恒为 0、play() 未实现；
 * - `<canvas>`：没有 2D 上下文实现，拿不到 ctx 就走不到 toBlob。
 * 这里只补「让链路能走下去」的最小实现，不做像素级仿真 —— 断言的是组件的行为，
 * 不是浏览器画出来的像素。
 */
import { vi } from 'vitest'

export interface FakeStream {
  stream: MediaStream
  /** 该流的轨道 stop()，用来断言组件把摄像头关干净了 */
  stop: ReturnType<typeof vi.fn>
}

/** 假 MediaStream：只关心轨道有没有被停掉 */
export function fakeStream(): FakeStream {
  const stop = vi.fn()
  const track = { stop }
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [track]
  }
  return { stream: stream as unknown as MediaStream, stop }
}

/** 把 navigator.mediaDevices.getUserMedia 换成可控 mock，返回该 mock 以便断言调用 */
export function mockGetUserMedia(impl: () => Promise<MediaStream>) {
  const getUserMedia = vi.fn(impl)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia }
  })
  return getUserMedia
}

/** 每个用例前调一次：把 video / canvas 的关键能力补上 */
export function patchMediaElements() {
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    get: () => 640
  })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    get: () => 480
  })
  HTMLMediaElement.prototype.play = (() => Promise.resolve()) as HTMLMediaElement['play']
  HTMLMediaElement.prototype.pause = (() => {}) as HTMLMediaElement['pause']
  // happy-dom 把 srcObject 做成只读：赋值在严格模式下会抛 TypeError，直接中断 open()，
  // 于是「开流成功」这条链路根本走不到 ready。换成可写的数据属性。
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    writable: true,
    value: null
  })

  HTMLCanvasElement.prototype.getContext = (() => ({
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    strokeRect: () => {},
    fillRect: () => {},
    fillText: () => {},
    measureText: () => ({ width: 10 })
  })) as unknown as HTMLCanvasElement['getContext']

  HTMLCanvasElement.prototype.toBlob = ((cb: BlobCallback) => {
    cb(new Blob(['frame'], { type: 'image/jpeg' }))
  }) as HTMLCanvasElement['toBlob']
}
