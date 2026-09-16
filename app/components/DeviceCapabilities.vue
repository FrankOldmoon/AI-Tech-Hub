<script setup lang="ts">
/**
 * 本机能力探测面板（课堂/内网场景）。
 *
 * 学生机器差异很大（无独显、旧浏览器、禁用摄像头、内存不足），提前把
 * 「这台机器能跑什么」摆出来，比点开能力页再报错体验好得多。
 * 全部探测在客户端完成，不上报任何数据；不主动申请摄像头权限。
 */
type Level = 'ok' | 'warn' | 'no'
type SummaryKey = 'full' | 'slow' | 'limited'

interface Row { key: string, level: Level, value: string }
interface MinimalGpu {
  requestAdapter: () => Promise<{ info?: { architecture?: string } } | null>
}

const { t } = useI18n()

const rows = ref<Row[]>([])
const summaryKey = ref<SummaryKey>('limited')

const levelIcon: Record<Level, string> = {
  ok: 'i-lucide-check',
  warn: 'i-lucide-alert-triangle',
  no: 'i-lucide-x'
}
const levelClass: Record<Level, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  no: 'text-error'
}

/** 最小含 v128 指令的 wasm 模块，可验证 WASM SIMD */
function detectSimd(): boolean {
  try {
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
    ]))
  } catch {
    return false
  }
}

/** MediaPipe 的 GPU 委托走 WebGL，故探测 WebGL2 而非仅 WebGPU */
function detectWebgl2(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'))
  } catch {
    return false
  }
}

async function detectWebgpu(): Promise<{ level: Level, value: string }> {
  const na = t('home.devcaps.na')
  try {
    const gpu = (navigator as Navigator & { gpu?: MinimalGpu }).gpu
    if (!gpu) return { level: 'no', value: na }
    const adapter = await gpu.requestAdapter()
    if (!adapter) return { level: 'warn', value: t('home.devcaps.noAdapter') }
    return { level: 'ok', value: adapter.info?.architecture || 'WebGPU' }
  } catch {
    return { level: 'no', value: na }
  }
}

async function probe() {
  const out: Row[] = []
  const push = (key: string, level: Level, value: string) => out.push({ key, level, value })

  const gpu = await detectWebgpu()
  push('webgpu', gpu.level, gpu.value)

  // 多线程 WASM：需要跨域隔离（COOP/COEP）才有 SharedArrayBuffer
  const mt = typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true
  push('threads', mt ? 'ok' : 'warn', mt ? t('home.devcaps.mtOn') : t('home.devcaps.mtOff'))

  const simd = detectSimd()
  push('simd', simd ? 'ok' : 'no', simd ? 'SIMD' : t('home.devcaps.na'))

  const cores = navigator.hardwareConcurrency || 0
  push('cores', cores >= 4 ? 'ok' : (cores ? 'warn' : 'no'), cores ? String(cores) : t('home.devcaps.na'))

  const webgl2 = detectWebgl2()
  push('webgl2', webgl2 ? 'ok' : 'no', webgl2 ? 'WebGL2' : t('home.devcaps.na'))

  const cam = Boolean(navigator.mediaDevices?.getUserMedia)
  push('camera', cam ? 'ok' : 'no', cam ? t('home.devcaps.available') : t('home.devcaps.unavailable'))

  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  push('memory', mem ? (mem >= 4 ? 'ok' : 'warn') : 'warn', mem ? `${mem} GB` : t('home.devcaps.unknown'))

  try {
    const est = await navigator.storage?.estimate?.()
    if (est?.quota) {
      push('storage', est.quota > 2 ** 30 ? 'ok' : 'warn', `${(est.quota / 2 ** 30).toFixed(0)} GB`)
    }
  } catch { /* 部分浏览器不支持 estimate，忽略 */ }

  rows.value = out
  summaryKey.value = gpu.level === 'ok' ? 'full' : (webgl2 ? 'slow' : 'limited')
}

onMounted(() => {
  probe()
})
</script>

<template>
  <div
    v-if="rows.length"
    class="rounded-xl border border-default p-4 space-y-3"
  >
    <div class="flex flex-wrap items-center gap-2">
      <UIcon
        name="i-lucide-cpu"
        class="size-5 text-primary"
      />
      <h2 class="text-sm font-semibold text-highlighted">
        {{ t('home.devcaps.title') }}
      </h2>
      <span class="ms-auto text-xs text-dimmed">{{ t(`home.devcaps.summary.${summaryKey}`) }}</span>
    </div>
    <p class="text-xs text-dimmed">
      {{ t('home.devcaps.desc') }}
    </p>
    <ul class="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
      <li
        v-for="r in rows"
        :key="r.key"
        class="flex min-w-0 items-center gap-1.5 text-xs"
      >
        <UIcon
          :name="levelIcon[r.level]"
          :class="['size-3.5 shrink-0', levelClass[r.level]]"
        />
        <span class="text-muted shrink-0">{{ t(`home.devcaps.label.${r.key}`) }}</span>
        <span class="truncate text-dimmed">{{ r.value }}</span>
      </li>
    </ul>
  </div>
</template>
