/* @deps: none */
/* =====================================================================
   `input()` 的跨线程通道（worker ↔ 主线程）

   Python 跑在 module worker 里，而 **worker 没有 prompt** —— pyodide 的默认
   stdin 实现会直接抛 "ReferenceError: prompt is not defined"。要做出真正的
   交互式输入，worker 必须能**同步**等主线程把值送进来，手段只有一个：
   SharedArrayBuffer + Atomics.wait。页面的 COOP/COEP（nuxt.config.ts）已经让
   crossOriginIsolated 为真，所以 SAB 可用。

   布局：control 是 4 个 Int32，text 是 8KB（前半放 prompt，后半放答案，
   这样主线程回写答案时不会覆盖掉它正在显示的提示语）。
   ===================================================================== */

/** control 的下标 */
export const STDIN_STATE = 0
export const STDIN_PROMPT_LEN = 1
export const STDIN_ANSWER_LEN = 2

/** control[STDIN_STATE] 的取值 */
export const STDIN_IDLE = 0
export const STDIN_WAIT = 1 // worker 已挂起，等主线程
export const STDIN_ANSWER = 2 // 主线程写好了答案
export const STDIN_EOF = 3 // 用户取消 → 按 EOF 处理（Python 抛 EOFError）

/** text 的两半 */
const HALF = 4096
export const PROMPT_OFFSET = 0
export const ANSWER_OFFSET = HALF
/** 留 1 字节余量，避免解码到半截多字节字符 */
export const TEXT_LIMIT = HALF - 1

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function createStdinBuffers() {
  /* 没有跨域隔离时 SharedArrayBuffer 不能跨线程共享（Chrome 直接抛）。调用方据此
     退回「无桥」模式：input() 给人话错误，而不是让整个 Python 运行时崩掉。 */
  if (typeof SharedArrayBuffer !== 'function' || globalThis.crossOriginIsolated !== true) {
    return null
  }
  try {
    return {
      control: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4),
      text: new SharedArrayBuffer(HALF * 2)
    }
  } catch {
    return null
  }
}

/** 写入 UTF-8，返回实际字节数（超长截断，绝不越界） */
export function putText(sab, offset, value, limit) {
  const bytes = encoder.encode(value == null ? '' : String(value))
  const n = Math.min(bytes.length, limit)
  new Uint8Array(sab, offset, n).set(bytes.subarray(0, n))
  return n
}

export function getText(sab, offset, length) {
  if (!length) return ''
  const n = Math.min(length, TEXT_LIMIT)
  /* 必须先拷出来：TextDecoder.decode 拒绝 SharedArrayBuffer 上的视图
     （TypeError: The provided ArrayBufferView value must not be shared）。
     少了这一步，主线程一读提示语就抛，弹框永远弹不出来。 */
  const copy = new Uint8Array(n)
  copy.set(new Uint8Array(sab, offset, n))
  return decoder.decode(copy)
}
