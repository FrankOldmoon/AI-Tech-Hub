import { humanError } from '~/utils/errors'
<script setup lang="ts">
/**
 * 从后端读取并展示对应功能的最简 Python 实现源码。
 * - 通过 feature 路径定位 python/<feature>/main.py
 * - 默认折叠，点击 header 展开/收起
 * - 支持复制源码到剪贴板
 * - 使用 highlight.js（CDN 引入）进行语法高亮，跟随系统颜色模式切换主题
 */
const props = defineProps<{
  /** 模块路径，如 'speech/tts' -> python/speech/tts/main.py */
  feature?: string
}>()

const { t } = useI18n()
const { fetchSource } = usePythonSource()

// 根据颜色模式切换 highlight.js 主题（github / github-dark）
const colorMode = useColorMode()
const hljsThemeUrl = computed(() =>
  colorMode.value === 'dark'
    ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css'
    : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css'
)
useHead({
  link: [{ rel: 'stylesheet', href: hljsThemeUrl, key: 'hljs-theme' }]
})

// 模块级缓存 highlight.js 加载 Promise，避免重复加载
let hljsPromise: Promise<any> | null = null

async function loadHighlighter(): Promise<any> {
  if (import.meta.server) return null
  const w = window as any
  if (w.hljs) return w.hljs
  if (hljsPromise) return hljsPromise
  hljsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js'
    script.onload = () => resolve(w.hljs)
    script.onerror = () => {
      hljsPromise = null
      reject(new Error('Failed to load highlight.js'))
    }
    document.head.appendChild(script)
  })
  return hljsPromise
}

const loading = ref(false)
const source = ref('')
const fileName = ref('')
const notFound = ref(false)
const error = ref<string | null>(null)
const expanded = ref(false)
const copied = ref(false)
const highlightedHtml = ref('')

async function load() {
  if (!props.feature) return
  loading.value = true
  error.value = null
  notFound.value = false
  try {
    const res = await fetchSource(props.feature)
    if (!res.available) {
      notFound.value = true
    } else if (!res.ok) {
      error.value = res.error || 'error'
    } else {
      source.value = res.source || ''
      fileName.value = res.fileName || ''
      await highlightCode()
    }
  } catch (e) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}

async function highlightCode() {
  if (!source.value || import.meta.server) {
    highlightedHtml.value = ''
    return
  }
  try {
    const hljs = await loadHighlighter()
    if (hljs) {
      highlightedHtml.value = hljs.highlight(source.value, { language: 'python' }).value
    }
  } catch {
    highlightedHtml.value = ''
  }
}

/** 高亮未就绪时回退为转义纯文本，保证 SSR 与客户端初始渲染一致 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const displayHtml = computed(() => {
  if (!source.value) return ''
  if (highlightedHtml.value) return highlightedHtml.value
  return escapeHtml(source.value)
})

watch(() => props.feature, load, { immediate: true })

async function copy() {
  if (!source.value) return
  try {
    await navigator.clipboard.writeText(source.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <UCard v-if="feature">
    <template #header>
      <button
        type="button"
        class="flex items-center gap-2 text-sm font-medium text-highlighted w-full cursor-pointer"
        :disabled="loading"
        @click="expanded = !expanded"
      >
        <UIcon name="i-lucide-file-code-2" class="size-4 text-primary" />
        <span>{{ t('pythonSource.title') }}</span>
        <span v-if="fileName" class="text-xs text-muted font-mono truncate">{{ fileName }}</span>
        <UIcon
          name="i-lucide-chevron-down"
          class="size-4 ms-auto text-muted transition-transform"
          :class="expanded ? 'rotate-180' : ''"
        />
      </button>
    </template>

    <!-- 展开后的内容 -->
    <div v-if="expanded">
      <!-- 加载中 -->
      <div v-if="loading" class="flex items-center gap-2 text-sm text-muted py-4">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        {{ t('pythonSource.loading') }}
      </div>

      <!-- 未找到 -->
      <UAlert
        v-else-if="notFound"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        :title="t('pythonSource.notFound')"
      />

      <!-- 错误 -->
      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        :title="error"
      />

      <!-- 源码 -->
      <div v-else-if="source" class="space-y-2">
        <div class="flex justify-end">
          <UButton
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            :label="copied ? t('pythonSource.copied') : t('pythonSource.copy')"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="copy"
          />
        </div>
        <pre class="hljs overflow-auto max-h-[60vh] text-xs leading-relaxed rounded-lg m-0"><code class="language-python" v-html="displayHtml" /></pre>
      </div>
    </div>
  </UCard>
</template>
