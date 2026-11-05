<script setup lang="ts">
/**
 * 功能页底部的「延伸学习」区：最简 Python / 可运行 HTML / 原理说明。
 *
 * 挂在 default / bare 两个布局的 slot 之后，一处改动覆盖全站 demo 页面 ——
 * 每页自己不用加任何东西（要写内容只改 utils/demo-notes/<分类>.ts）。
 * 没登记过内容的页面整段不渲染，所以分类页、首页不受影响。
 *
 * 三段都默认收起：底部区域是「有需要才展开」的参考资料，不该抢演示本身的位置。
 */
import { MARKDOWN_CLASS, highlightCodeToHtml, renderMarkdown } from '~/utils/markdown'
import { loadDemoNote } from '~/utils/demo-notes'
import { pickText } from '~/utils/localized'
import { uiLangOf } from '~/utils/zh-hk'

const route = useRoute()
const { t, locale } = useI18n()

const uiLang = computed(() => uiLangOf(String(locale.value)))

// lazy：折叠区默认收起，没必要进首屏 SSR 的关键路径；data 为 null 时整段不渲染
const { data: note } = await useAsyncData(
  () => `demo-note:${route.path}`,
  () => loadDemoNote(route.path),
  { watch: [() => route.path], lazy: true, default: () => undefined }
)

/**
 * 告诉页面上方的「工作原理」折叠块：本页还有更详细的内容。
 *
 * 为什么需要：同一个页面上有两处原理入口 —— 页头那个「工作原理」只有两三句话，
 * 这里的「原理说明」有好几个小节加代码。大多数人展开上面那个、看完就以为完了，
 * 根本不会往下滚（实测反馈就是这个）。所以由这边主动登记，让上面那个能给出跳转。
 */
const noteOwner = useState<string>('demo-note-owner', () => '')
watchEffect(() => {
  if (note.value) noteOwner.value = route.path
})

/**
 * 第二段有两种形态：
 *  - 新内容（vision）：完整 HTML 文档，右上角给「运行」按钮，点了在沙箱 iframe 里执行；
 *  - 旧内容（robot）：只有一段 JS，没有运行入口（片段本身跑不起来，给按钮是骗人）。
 */
const isRunnable = computed(() => Boolean(note.value?.html))
const secondKey = computed(() => (isRunnable.value ? 'html' : 'javascript'))
const secondCode = computed(() => note.value?.html ?? note.value?.javascript ?? '')

/** 三段各自的展开状态（彼此独立，允许同时打开做对照） */
const open = ref<Record<string, boolean>>({ python: false, html: false, javascript: false, principle: false })

const sections = computed(() => [
  { key: 'python', icon: 'i-simple-icons-python', title: t('learning.python') },
  {
    key: secondKey.value,
    icon: isRunnable.value ? 'i-lucide-globe' : 'i-simple-icons-javascript',
    title: isRunnable.value ? t('learning.html') : t('learning.javascript')
  },
  { key: 'principle', icon: 'i-lucide-book-open', title: t('learning.principle') }
])

const pythonHtml = computed(() => note.value ? highlightCodeToHtml(note.value.python, 'python') : '')
const secondHtml = computed(() =>
  secondCode.value ? highlightCodeToHtml(secondCode.value, isRunnable.value ? 'html' : 'javascript') : ''
)
const principleHtml = computed(() =>
  note.value ? renderMarkdown(pickText(note.value.principle, uiLang.value)) : ''
)

/* ---------- 运行：把整段 HTML 塞进沙箱 iframe ---------- */
const running = ref(false)
/** 换 key 强制重建 iframe —— 「重新运行」就是让上一份脚本的副作用全部丢掉 */
const runVersion = ref(0)

function runDemo() {
  if (!secondCode.value) return
  runVersion.value++
  running.value = true
}

function stopDemo() {
  running.value = false
}

/* ---------- 复制（代码块没复制按钮，学生要手抄，等于没法用） ---------- */
const copied = ref('')
let copyTimer: ReturnType<typeof setTimeout> | null = null

function codeOf(key: string): string {
  if (key === 'python') return note.value?.python ?? ''
  if (key === 'html' || key === 'javascript') return secondCode.value
  return ''
}

async function copy(key: string) {
  const text = codeOf(key)
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = ''
    }, 1600)
  } catch {
    // 非 https / 无权限时静默失败：不弹错误打断演示，用户手动选中即可
    copied.value = ''
  }
}

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<template>
  <section
    v-if="note"
    id="demo-learning"
    class="border-t border-default"
  >
    <UContainer>
      <div class="py-8 sm:py-10">
        <div class="flex items-start gap-3">
          <div class="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <UIcon
              name="i-lucide-graduation-cap"
              class="size-5"
            />
          </div>
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-highlighted">
              {{ t('learning.title') }}
            </h2>
            <p class="text-sm text-muted mt-0.5">
              {{ t('learning.subtitle') }}
            </p>
          </div>
        </div>

        <div class="mt-4 space-y-2">
          <UCollapsible
            v-for="s in sections"
            :key="s.key"
            v-model:open="open[s.key]"
          >
            <template #default="{ open: isOpen }">
              <button
                type="button"
                class="flex items-center gap-2 px-4 py-3 text-sm font-medium text-highlighted w-full cursor-pointer border border-default rounded-lg hover:bg-elevated/40 transition-colors"
                :class="isOpen ? 'rounded-b-none border-b-0' : ''"
              >
                <UIcon
                  :name="s.icon"
                  class="size-4 text-primary"
                />
                <span>{{ s.title }}</span>
                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 ms-auto text-muted transition-transform"
                  :class="isOpen ? 'rotate-180' : ''"
                />
              </button>
            </template>

            <template #content>
              <div class="border border-t-0 border-default rounded-b-lg overflow-hidden">
                <!-- 代码段：shiki 已按双主题上色，暗色由 main.css 的 .dark .shiki 接管 -->
                <template v-if="s.key !== 'principle'">
                  <div class="relative">
                    <div
                      class="code-body overflow-x-auto p-3"
                      v-html="s.key === 'python' ? pythonHtml : secondHtml"
                    />
                    <div class="absolute top-2 right-2 flex items-center gap-1.5">
                      <UButton
                        v-if="s.key === 'html' && !running"
                        icon="i-lucide-play"
                        :label="t('learning.run')"
                        color="primary"
                        variant="soft"
                        size="xs"
                        @click="runDemo"
                      />
                      <UButton
                        v-else-if="s.key === 'html' && running"
                        icon="i-lucide-stop-circle"
                        :label="t('learning.stop')"
                        color="warning"
                        variant="soft"
                        size="xs"
                        @click="stopDemo"
                      />
                      <UButton
                        :icon="copied === s.key ? 'i-lucide-check' : 'i-lucide-copy'"
                        :label="copied === s.key ? t('learning.copied') : t('learning.copy')"
                        color="neutral"
                        variant="soft"
                        size="xs"
                        class="opacity-70 hover:opacity-100 transition-opacity"
                        @click="copy(s.key)"
                      />
                    </div>
                  </div>

                  <!-- 运行结果：沙箱 iframe。
                       sandbox 只给 allow-scripts（不给 allow-same-origin），
                       示例里的脚本无法碰到父页面，也拿不到本站的 storage。 -->
                  <div
                    v-if="s.key === 'html' && running"
                    class="border-t border-default"
                  >
                    <div class="flex items-center gap-2 px-3 py-1.5 text-xs text-muted bg-elevated/40">
                      <UIcon
                        name="i-lucide-monitor-play"
                        class="size-3.5"
                      />
                      <span>{{ t('learning.result') }}</span>
                      <UButton
                        icon="i-lucide-rotate-cw"
                        :label="t('learning.rerun')"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        class="ms-auto"
                        @click="runDemo"
                      />
                      <UButton
                        icon="i-lucide-x"
                        :label="t('learning.close')"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        @click="stopDemo"
                      />
                    </div>
                    <iframe
                      :key="runVersion"
                      :srcdoc="secondCode"
                      class="w-full h-[440px] block bg-white"
                      sandbox="allow-scripts"
                      :title="t('learning.result')"
                    />
                  </div>
                </template>

                <!-- 原理说明：Markdown（可含表格、列表、行内代码） -->
                <template v-else>
                  <div
                    class="px-4 py-3"
                    :class="MARKDOWN_CLASS"
                    v-html="principleHtml"
                  />
                </template>
              </div>
            </template>
          </UCollapsible>
        </div>
      </div>
    </UContainer>
  </section>
</template>

<style scoped>
/* v-html 出来的 shiki 节点拿不到 scoped 属性，用 :deep 从容器往下打。
   背景与 margin 都归零：shiki 会把 background-color 写成内联样式（浅色主题白底），
   这里要 !important 才能盖掉，让代码块贴合站点的卡片背景。 */
.code-body :deep(pre) {
  margin: 0;
  padding: 0;
  background: transparent !important;
  /* shiki 只出颜色，不管字体：不显式给等宽字体，代码会跟着站点的
     sans 字体渲染，缩进对齐全乱（Python 全靠缩进读） */
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.6;
}
.code-body :deep(code) {
  font-family: inherit;
  font-size: 0.8rem;
}
</style>
