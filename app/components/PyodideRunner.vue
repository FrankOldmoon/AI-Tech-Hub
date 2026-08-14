<script setup lang="ts">
/**
 * 浏览器端 Python 编辑器与运行器。
 * - Monaco Editor（CDN）：VS Code 风格的代码编辑器
 * - Pyodide（CDN）：WebAssembly 版 Python 运行时
 * - 下方左右分栏：Input（可编辑 stdin）/ Output（只读结果）
 * - 支持一键运行 Python 代码，input() 从 Input 框读取
 * - 跟随系统颜色模式切换编辑器主题
 */

const props = withDefaults(defineProps<{
  /** 可选：从后端加载初始代码（复用 usePythonSource） */
  feature?: string
  /** 可选：直接传入初始代码（优先于 feature） */
  initialCode?: string
}>(), {})

const { t } = useI18n()
const { fetchSource } = usePythonSource()
const colorMode = useColorMode()

const DEFAULT_CODE = `# 在浏览器中运行 Python（Pyodide）
# 下方 Input 框可输入 stdin，供 input() 读取
import sys
print(f"Python {sys.version}")
print("Hello from Pyodide!")

name = input("你的名字？")
print(f"你好, {name}!")

import math
print(f"π = {math.pi}")
`

// ===== 工具：动态加载 script（模块级缓存）=====
const scriptCache = new Map<string, Promise<void>>()
function loadScript(src: string): Promise<void> {
  if (scriptCache.has(src)) return scriptCache.get(src)!
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptCache.delete(src)
      reject(new Error(`Failed to load ${src}`))
    }
    document.head.appendChild(script)
  })
  scriptCache.set(src, promise)
  return promise
}

// ===== Monaco Editor =====
const MONACO_VERSION = '0.52.2'
const MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min`

const editorContainer = ref<HTMLElement>()
let editor: any = null
const code = ref(props.initialCode ?? '')

const monacoTheme = computed(() =>
  colorMode.value === 'dark' ? 'vs-dark' : 'vs'
)

async function initMonaco() {
  if (import.meta.server || !editorContainer.value) return

  const w = window as any

  // 配置 worker 路径（解决 CDN 跨域问题）
  w.MonacoEnvironment = {
    getWorkerUrl: () => {
      return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        self.MonacoEnvironment = { baseUrl: '${MONACO_BASE}/' };
        importScripts('${MONACO_BASE}/vs/base/worker/workerMain.js');
      `)}`
    }
  }

  await loadScript(`${MONACO_BASE}/vs/loader.js`)
  w.require.config({ paths: { vs: `${MONACO_BASE}/vs` } })

  await new Promise<void>((resolve, reject) => {
    w.require(['vs/editor/editor.main'], () => resolve(), (err: any) => reject(err))
  })

  // 确保 code ref 与编辑器初始值同步
  if (!code.value) {
    code.value = DEFAULT_CODE
  }

  editor = w.monaco.editor.create(editorContainer.value, {
    value: code.value,
    language: 'python',
    theme: monacoTheme.value,
    automaticLayout: true,
    fontSize: 13,
    lineHeight: 20,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 4,
    padding: { top: 8, bottom: 8 },
    smoothScrolling: true
  })

  editor.onDidChangeModelContent(() => {
    code.value = editor.getValue()
  })
}

watch(monacoTheme, (theme) => {
  if (editor) editor.updateOptions({ theme })
})

// ===== Pyodide =====
const PYODIDE_VERSION = '0.27.7'
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full`

const pyodideLoading = ref(false)
const pyodideReady = ref(false)
const pyodideError = ref<string | null>(null)
let pyodideInstance: any = null
let pyodidePromise: Promise<any> | null = null

async function ensurePyodide(): Promise<any | null> {
  if (import.meta.server) return null
  if (pyodideInstance) return pyodideInstance
  if (pyodidePromise) return pyodidePromise

  pyodideLoading.value = true
  pyodideError.value = null

  pyodidePromise = (async () => {
    await loadScript(`${PYODIDE_BASE}/pyodide.js`)
    const w = window as any
    const instance = await w.loadPyodide({ indexURL: `${PYODIDE_BASE}/` })
    pyodideInstance = instance
    pyodideReady.value = true
    return instance
  })()

  try {
    return await pyodidePromise
  } catch (e) {
    pyodideError.value = (e as Error)?.message || String(e)
    pyodidePromise = null
    return null
  } finally {
    pyodideLoading.value = false
  }
}

// ===== 运行 =====
const running = ref(false)
const output = ref('')
const hasError = ref(false)
const inputText = ref('')

async function run() {
  const pyodide = await ensurePyodide()
  if (!pyodide) return

  running.value = true
  output.value = ''
  hasError.value = false

  let stdout = ''
  let stderr = ''

  pyodide.setStdout({ batched: (msg: string) => { stdout += msg + '\n' } })
  pyodide.setStderr({ batched: (msg: string) => { stderr += msg + '\n' } })

  // 设置 stdin：从 Input 框逐字符读取，供 input() 使用
  const stdinText = inputText.value
  let stdinPos = 0
  pyodide.setStdin({
    stdin: () => {
      if (stdinPos >= stdinText.length) return null
      return stdinText.charCodeAt(stdinPos++)
    }
  })

  try {
    const currentCode = editor?.getValue?.() ?? code.value
    await pyodide.runPythonAsync(currentCode)
    output.value = stdout + (stderr ? stderr : '')
  } catch (e: any) {
    hasError.value = true
    output.value = stdout + (stderr ? stderr : '') + (e?.message || String(e))
  } finally {
    running.value = false
  }
}

// ===== 生命周期 =====
onMounted(async () => {
  if (props.initialCode) {
    code.value = props.initialCode
  } else if (props.feature) {
    const res = await fetchSource(props.feature)
    if (res.ok && res.source) {
      code.value = res.source
    }
  }

  await initMonaco()
  ensurePyodide()
})

onBeforeUnmount(() => {
  editor?.dispose?.()
})
</script>

<template>
  <div class="flex flex-col h-full border border-default rounded-lg overflow-hidden">
    <!-- 顶部工具栏 -->
    <div class="flex items-center gap-2 px-3 py-2 border-b border-default bg-elevated/40 shrink-0">
      <UIcon name="i-lucide-code" class="size-4 text-primary" />
      <span class="text-sm font-medium text-highlighted">{{ t('pyodide.title') }}</span>

      <!-- Pyodide 状态 -->
      <UBadge v-if="pyodideReady" color="success" variant="subtle" size="sm">
        <UIcon name="i-lucide-check" class="size-3" />
        {{ t('pyodide.ready') }}
      </UBadge>
      <UBadge v-else-if="pyodideLoading" color="neutral" variant="subtle" size="sm">
        <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
        {{ t('pyodide.loading') }}
      </UBadge>
      <UBadge v-else-if="pyodideError" color="error" variant="subtle" size="sm">
        <UIcon name="i-lucide-alert-triangle" class="size-3" />
        {{ t('pyodide.error') }}
      </UBadge>

      <UButton
        icon="i-lucide-play"
        :label="t('pyodide.run')"
        :loading="running"
        :disabled="pyodideLoading && !pyodideReady"
        color="primary"
        size="sm"
        class="ms-auto"
        @click="run"
      />
    </div>

    <!-- Monaco 编辑器（占据剩余空间） -->
    <div class="flex-1 min-h-0">
      <div ref="editorContainer" class="w-full h-full" />
    </div>

    <!-- Input / Output 分栏 -->
    <div class="grid grid-cols-1 sm:grid-cols-2 border-t border-default h-[30vh] shrink-0">
      <!-- Input（可编辑 stdin） -->
      <div class="flex flex-col p-2 border-r border-default min-h-0">
        <div class="flex items-center gap-1.5 text-xs text-muted mb-1 shrink-0">
          <UIcon name="i-lucide-keyboard" class="size-3" />
          {{ t('pyodide.input') }}
        </div>
        <textarea
          v-model="inputText"
          :placeholder="t('pyodide.inputPlaceholder')"
          class="flex-1 w-full resize-none bg-transparent text-xs font-mono text-highlighted focus:outline-none placeholder:text-dimmed min-h-0"
        />
      </div>

      <!-- Output（只读） -->
      <div class="flex flex-col p-2 min-h-0">
        <div class="flex items-center gap-1.5 text-xs text-muted mb-1 shrink-0">
          <UIcon name="i-lucide-terminal" class="size-3" />
          {{ t('pyodide.output') }}
        </div>
        <pre class="flex-1 overflow-auto text-xs font-mono m-0 whitespace-pre-wrap min-h-0" :class="hasError ? 'text-error' : 'text-highlighted'"><code>{{ output || '—' }}</code></pre>
      </div>
    </div>
  </div>
</template>
