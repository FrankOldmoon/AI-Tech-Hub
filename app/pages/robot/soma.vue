<script setup lang="ts">
/**
 * SOMA · 仿人机器人解剖图谱（原生页面版）
 *
 * 由独立单文件页（SOMA Humanoid Anatomy Atlas）移植，参考 robot/vacusim 的页面模式：
 *   - 3D 机器人建模 / 装配树 / 三级爆炸拆解 / 显示模式 / 拟人步态行走住在 utils/soma/engine.ts
 *     （three 走 npm 依赖，无 CDN）；
 *   - 这里只负责「静态外壳 markup + 按需挂载引擎 + 教学进度上报」。
 *
 * 完成条件（5 个，权重均分）：
 *   1. 五大功能系统各筛选一次（感知/结构/计算/驱动/电源）
 *   2. 在七大结构总成中各选中一个零件
 *   3. 整机爆炸到 100% 再合并回 0
 *   4. X-Ray 与线框两种显示模式各试一次
 *   5. 行走演示完整跑完两圈
 */
import { createSoma, type Lang, type SomaHandle } from '~/utils/soma/engine'
import { reportCorrectRate } from '~/utils/embed-report'
import { pickText, type LocalizedText } from '~/utils/localized'

const APP_ID = 'robot/soma'

const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'soma')!)
const { locale } = useI18n()
const lang = computed<Lang>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: LocalizedText) => pickText(o, lang.value)

const rootEl = ref<HTMLElement | null>(null)
const errorMsg = ref('')
let handle: SomaHandle | null = null

const T_GUIDE: LocalizedText = { zh: '使用指南', en: 'User Guide' }

/* ---------- 教学进度（上报用） ---------- */
const systemsUsed = ref<Set<string>>(new Set())
const assembliesTouched = ref<Set<string>>(new Set())
const modesUsed = ref<Set<string>>(new Set())
const explodedFull = ref(false)
const mergedBack = ref(false)
const walkedDone = ref(false)
const explodeNow = ref(0)

const tasks = computed(() => [
  {
    key: 'systems',
    label: { zh: '切换查看 5 大功能系统', en: 'Browse all 5 functional systems' } as LocalizedText,
    done: systemsUsed.value.size,
    total: 5,
    weight: 0.2
  },
  {
    key: 'parts',
    label: { zh: '在 7 大总成中各选中一个零件', en: 'Select a part in each of the 7 assemblies' } as LocalizedText,
    done: assembliesTouched.value.size,
    total: 7,
    weight: 0.2
  },
  {
    key: 'explode',
    label: { zh: '整机爆炸到 100% 再合并回去', en: 'Explode the unit to 100% and merge back' } as LocalizedText,
    done: (explodedFull.value ? 1 : 0) + (mergedBack.value ? 1 : 0),
    total: 2,
    weight: 0.2
  },
  {
    key: 'modes',
    label: { zh: '用 X-Ray 与线框模式各看一次', en: 'Try both X-Ray and Wireframe modes' } as LocalizedText,
    done: modesUsed.value.size,
    total: 2,
    weight: 0.2
  },
  {
    key: 'walk',
    label: { zh: '行走演示完整跑完两圈', en: 'Let the walk demo finish two full laps' } as LocalizedText,
    done: walkedDone.value ? 1 : 0,
    total: 1,
    weight: 0.2
  }
])

const rate = computed(() => tasks.value.reduce((acc, t) => acc + t.weight * Math.min(1, t.done / t.total), 0))
const finished = computed(() => rate.value >= 0.999)

function onTask(task: string) {
  if (task.startsWith('system:')) systemsUsed.value = new Set(systemsUsed.value).add(task.slice(7))
  else if (task.startsWith('assembly:')) assembliesTouched.value = new Set(assembliesTouched.value).add(task.slice(9))
  else if (task.startsWith('mode:')) modesUsed.value = new Set(modesUsed.value).add(task.slice(5))
  else if (task === 'explode:full') explodedFull.value = true
  else if (task === 'explode:merged') mergedBack.value = true
  else if (task === 'walk:done') walkedDone.value = true
}

/** 上报契约：parent.postMessage({ type:'correct_rate', rate, ... })，详见 utils/embed-report.ts */
watch([rate, finished], () => {
  reportCorrectRate({
    app: APP_ID,
    rate: rate.value,
    finished: finished.value,
    locale: locale.value,
    extra: {
      explode: explodeNow.value,
      systemsViewed: [...systemsUsed.value],
      assembliesTouched: [...assembliesTouched.value],
      modesUsed: [...modesUsed.value],
      explodedFull: explodedFull.value,
      mergedBack: mergedBack.value,
      walked: walkedDone.value
    }
  })
})

/* ---------- 引擎 ---------- */
function unmount() {
  handle?.dispose()
  handle = null
}

function mount() {
  unmount()
  const root = rootEl.value
  if (!root) return
  try {
    handle = createSoma(root, {
      getLocale: () => lang.value,
      onTask,
      onStat: (stats) => {
        explodeNow.value = stats.explode
      }
    })
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  }
}

// 语言切换后重渲染引擎内的静态文本（树 / 详情 / 标签）
watch(lang, () => handle?.refresh())

/* ---------- 全屏（右上角按钮） ---------- */
const isFullscreen = ref(false)
const fsLabel = computed(() => pick({
  zh: isFullscreen.value ? '退出全屏' : '全屏',
  en: isFullscreen.value ? 'Exit fullscreen' : 'Fullscreen'
}))

async function toggleFullscreen() {
  const el = rootEl.value
  if (!el) return
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await el.requestFullscreen()
  } catch (err) {
    console.warn('[robot/soma] requestFullscreen failed', err)
  }
}

function syncFullscreenState() {
  isFullscreen.value = !!document.fullscreenElement
}

onMounted(() => {
  mount()
  document.addEventListener('fullscreenchange', syncFullscreenState)
})
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreenState)
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  unmount()
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div
      ref="rootEl"
      class="sa-root"
    >
      <!-- 顶栏 -->
      <header class="topbar">
        <div class="brand">
          <span
            class="brand-mark"
            aria-hidden="true"
          />
          <div>
            <div class="brand-title">
              SOMA
            </div>
            <div class="brand-sub">
              {{ pick({ zh: '仿人机器人解剖图谱', en: 'Humanoid Anatomy Atlas' }) }}
            </div>
          </div>
        </div>
        <div class="commandbar">
          <div class="command-info">
            <div class="command-label">
              {{ pick({ zh: '型号', en: 'Model' }) }}
            </div>
            <div class="command-value">
              H-01 / {{ pick({ zh: '瓷壳仿生验证单元', en: 'Porcelain Bionic Unit' }) }}
            </div>
          </div>
          <div class="command-info">
            <div class="command-label">
              {{ pick({ zh: '总装状态', en: 'Assembly Status' }) }}
            </div>
            <div
              id="sa-status-top"
              class="command-value live"
            >
              {{ pick({ zh: '已组装', en: 'Assembled' }) }}
            </div>
          </div>
          <div class="command-info">
            <div class="command-label">
              {{ pick({ zh: '当前选中', en: 'Current Selection' }) }}
            </div>
            <div
              id="sa-selection-top"
              class="command-value"
            >
              —
            </div>
          </div>
          <div
            class="mode-switch js-mode-group"
            aria-label="Display Mode"
          >
            <button
              class="mode-btn active"
              type="button"
              data-mode="solid"
            >
              {{ pick({ zh: '常规', en: 'Solid' }) }}
            </button>
            <button
              class="mode-btn"
              type="button"
              data-mode="xray"
            >
              X-Ray
            </button>
            <button
              class="mode-btn"
              type="button"
              data-mode="wire"
            >
              {{ pick({ zh: '线框', en: 'Wire' }) }}
            </button>
          </div>
        </div>
        <div class="top-actions">
          <button
            id="sa-guide-toggle"
            class="btn"
            type="button"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
            ><circle
              cx="12"
              cy="12"
              r="9"
            /><path d="M9.8 9a2.3 2.3 0 0 1 4.4 1c0 1.8-2.2 2-2.2 3.6M12 17v.2" /></svg>
            <span>{{ pick(T_GUIDE) }}</span>
          </button>
          <button
            id="sa-nav-toggle"
            class="btn mobile-only"
            type="button"
            aria-expanded="false"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
            ><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            <span>{{ pick({ zh: '装配树', en: 'Tree' }) }}</span>
          </button>
          <button
            id="sa-info-toggle"
            class="btn mobile-only"
            type="button"
            aria-expanded="false"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
            ><circle
              cx="12"
              cy="12"
              r="9"
            /><path d="M12 10v6M12 7v.2" /></svg>
            <span>{{ pick({ zh: '详情', en: 'Details' }) }}</span>
          </button>
          <button
            id="sa-reset"
            class="btn"
            type="button"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
            ><path d="M4 9V4h5M20 15v5h-5M5.2 5.2A9 9 0 0 1 20.5 10M18.8 18.8A9 9 0 0 1 3.5 14" /></svg>
            <span>{{ pick({ zh: '重置', en: 'Reset' }) }}</span>
          </button>
          <button
            class="btn fsbtn"
            type="button"
            :title="fsLabel"
            :aria-label="fsLabel"
            @click="toggleFullscreen"
          >
            <svg
              v-if="!isFullscreen"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M8 3v3a2 2 0 0 1-2 2H3" />
              <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
              <path d="M3 16h3a2 2 0 0 1 2 2v3" />
              <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
            </svg>
          </button>
        </div>
      </header>

      <!-- 左侧：装配树 -->
      <aside
        id="sa-sidebar"
        class="sidebar"
      >
        <button
          id="sa-close-nav"
          class="icon-btn panel-close"
          type="button"
        >
          ×
        </button>
        <div class="panel-head">
          <div class="eyebrow">
            {{ pick({ zh: '结构导航', en: 'Structure Navigation' }) }}
          </div>
          <h2 class="panel-title">
            {{ pick({ zh: '机器人装配树', en: 'Robot Assembly Tree' }) }}
          </h2>
          <div class="search">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
            ><circle
              cx="10.7"
              cy="10.7"
              r="6.4"
            /><path d="m15.8 15.8 4.2 4.2" /></svg>
            <input
              id="sa-search"
              type="search"
              autocomplete="off"
              :placeholder="pick({ zh: '按名称 / 系统 / 编号搜索', en: 'Search by name / system / ID' })"
            >
            <button
              id="sa-search-clear"
              class="search-clear"
              type="button"
            >
              ×
            </button>
          </div>
        </div>
        <div
          id="sa-systems"
          class="systems"
        />
        <div class="tree-meta">
          <span>{{ pick({ zh: '零件层级', en: 'Part Hierarchy' }) }}</span>
          <span id="sa-result-count">25 / 25</span>
        </div>
        <div
          id="sa-assembly-tree"
          class="assembly-tree"
        />
        <div
          id="sa-empty"
          class="empty"
        >
          {{ pick({ zh: '没有匹配的节点。', en: 'No matching nodes.' }) }}<br>{{ pick({ zh: '清除搜索或切换系统。', en: 'Clear the search or switch systems.' }) }}
        </div>
      </aside>

      <!-- 中间：3D 舞台 -->
      <main class="stage">
        <div
          class="stage-title"
          aria-hidden="true"
        >
          <h1>
            <span>{{ pick({ zh: '外层拟人壳体', en: 'Outer Anthropomorphic Layer' }) }}</span>
            <em>{{ pick({ zh: '内层精密核心', en: 'Inner Precision Layer' }) }}</em>
          </h1>
          <div class="stage-meta">
            THREE.JS · {{ pick({ zh: '自由环绕', en: 'Free Orbit' }) }} · GLB
          </div>
        </div>

        <div
          id="sa-status-stage"
          class="status-chip"
        >
          {{ pick({ zh: '已组装 · 拖拽旋转', en: 'Assembled · drag to orbit' }) }}
        </div>

        <div
          id="sa-view-cube"
          class="view-cube"
        >
          <button
            class="view-btn"
            type="button"
            data-view="front"
          >
            {{ pick({ zh: '前', en: 'Front' }) }}
          </button>
          <button
            class="view-btn"
            type="button"
            data-view="top"
          >
            {{ pick({ zh: '顶', en: 'Top' }) }}
          </button>
          <button
            class="view-btn"
            type="button"
            data-view="right"
          >
            {{ pick({ zh: '右', en: 'Right' }) }}
          </button>
          <button
            class="view-btn iso"
            type="button"
            data-view="iso"
          >
            {{ pick({ zh: '等轴测', en: 'Isometric' }) }}
          </button>
        </div>

        <div
          class="stage-mode-switch js-mode-group"
          aria-label="Display Mode"
        >
          <button
            class="mode-btn active"
            type="button"
            data-mode="solid"
          >
            {{ pick({ zh: '常规', en: 'Solid' }) }}
          </button>
          <button
            class="mode-btn"
            type="button"
            data-mode="xray"
          >
            X-Ray
          </button>
          <button
            class="mode-btn"
            type="button"
            data-mode="wire"
          >
            {{ pick({ zh: '线框', en: 'Wire' }) }}
          </button>
        </div>

        <div
          id="sa-webgl-host"
          class="webgl-host"
        />
        <div
          id="sa-labels-host"
          class="labels-host"
        />

        <div class="canvas-tools">
          <button
            id="sa-label-toggle"
            class="icon-btn active"
            type="button"
          >
            <span aria-hidden="true">⌖</span><span class="tool-label">{{ pick({ zh: '零件标签', en: 'Labels' }) }}</span>
          </button>
          <button
            id="sa-rotate-toggle"
            class="icon-btn"
            type="button"
          >
            <span aria-hidden="true">↻</span><span class="tool-label">{{ pick({ zh: '自动旋转', en: 'Auto-Rotate' }) }}</span>
          </button>
          <button
            id="sa-walk-toggle"
            class="icon-btn"
            type="button"
            aria-pressed="false"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
            ><circle
              cx="13.5"
              cy="4.2"
              r="1.7"
            /><path d="m11.5 7-2 4.1 3 2.2-2.2 6.2M11.5 7l3.2 2.7 3.3.2M12.5 13.3l3.4 5.7M9.5 11.1 6.8 13" /></svg>
            <span
              id="sa-walk-label"
              class="tool-label"
            >{{ pick({ zh: '行走演示', en: 'Walk' }) }}</span>
          </button>
          <button
            id="sa-show-all"
            class="icon-btn"
            type="button"
            disabled
          >
            <span aria-hidden="true">◫</span><span class="tool-label">{{ pick({ zh: '显示全部', en: 'Show All' }) }}</span>
          </button>
        </div>

        <div class="explode-bar">
          <select
            id="sa-scope"
            aria-label="Explode Scope"
          >
            <option value="all">
              {{ pick({ zh: '范围：整机', en: 'Scope: Full Unit' }) }}
            </option>
            <option value="assembly">
              {{ pick({ zh: '范围：当前总成', en: 'Scope: Current Assembly' }) }}
            </option>
            <option value="system">
              {{ pick({ zh: '范围：当前系统', en: 'Scope: Current System' }) }}
            </option>
          </select>
          <div class="range-wrap">
            <input
              id="sa-explode-range"
              class="range"
              type="range"
              min="0"
              max="100"
              value="0"
            >
            <output
              id="sa-explode-value"
              class="range-value"
            >000%</output>
          </div>
          <button
            id="sa-merge"
            class="btn"
            type="button"
          >
            {{ pick({ zh: '合并', en: 'Merge' }) }}
          </button>
          <button
            id="sa-explode-btn"
            class="btn primary"
            type="button"
          >
            <span class="long">{{ pick({ zh: '整体', en: 'Full' }) }}</span>{{ pick({ zh: '爆炸', en: 'Explode' }) }}
          </button>
          <button
            id="sa-play"
            class="icon-btn"
            type="button"
            aria-label="Auto-play"
          >
            ▶
          </button>
        </div>

        <div
          id="sa-loading"
          class="loading"
        >
          <div class="loader-box">
            <div class="loader-title">
              {{ pick({ zh: '正在唤醒瓷壳仿生单元', en: 'Waking the porcelain bionic unit' }) }}
            </div>
            <div class="loader-copy">
              {{ pick({ zh: '正在加载 3D 场景、可拆解节点与交互控件…', en: 'Loading 3D scene, detachable nodes, and interaction controls…' }) }}
            </div>
            <div class="loader-track">
              <div class="loader-fill" />
            </div>
          </div>
        </div>
      </main>

      <!-- 右侧：零件详情 + 教学进度 -->
      <aside
        id="sa-inspector"
        class="inspector"
      >
        <button
          id="sa-close-info"
          class="icon-btn panel-close"
          type="button"
        >
          ×
        </button>
        <div
          id="sa-insp-scroll"
          class="inspector-scroll"
        >
          <div
            id="sa-hero"
            class="inspector-hero"
            data-no="00"
            style="--c: #d2dad6"
          >
            <div
              id="sa-hero-index"
              class="inspector-index"
            >
              {{ pick({ zh: '整机 / 00', en: 'Full Unit / 00' }) }}
            </div>
            <h2
              id="sa-hero-name"
              class="inspector-name"
            >
              {{ pick({ zh: '瓷壳仿生验证单元', en: 'Porcelain Bionic Validation Unit' }) }}
            </h2>
            <div
              id="sa-hero-code"
              class="inspector-code"
            >
              SOMA H-01
            </div>
            <div
              id="sa-hero-tags"
              class="tags"
            />
          </div>
          <div
            id="sa-tabs"
            class="tabs"
            role="tablist"
          >
            <button
              class="tab active"
              type="button"
              data-tab="overview"
            >
              {{ pick({ zh: '总览', en: 'Overview' }) }}
            </button>
            <button
              class="tab"
              type="button"
              data-tab="structure"
            >
              {{ pick({ zh: '可见结构', en: 'Structure' }) }}
            </button>
            <button
              class="tab"
              type="button"
              data-tab="relations"
            >
              {{ pick({ zh: '功能关系', en: 'Relations' }) }}
            </button>
          </div>
          <div
            id="sa-insp-body"
            class="inspector-body"
            style="--c: #d2dad6"
          />

          <!-- 教学进度（同时决定给宿主的 rate） -->
          <div class="lesson-progress">
            <div class="pg-head">
              <span>{{ pick({ zh: '教学进度', en: 'Lesson Progress' }) }}</span>
              <b>{{ Math.round(rate * 100) }}%</b>
            </div>
            <div class="pg-track">
              <span
                class="pg-fill"
                :style="{ width: `${Math.round(rate * 100)}%` }"
              />
            </div>
            <ul class="pg-list">
              <li
                v-for="t in tasks"
                :key="t.key"
                :class="{ done: t.done >= t.total }"
              >
                <span>{{ pick(t.label) }}</span>
                <b>{{ t.done }}/{{ t.total }}</b>
              </li>
            </ul>
          </div>
        </div>
      </aside>

      <!-- 使用指南 -->
      <div
        id="sa-guide-overlay"
        class="guide-overlay"
        aria-hidden="true"
      >
        <section
          class="guide-panel"
          role="dialog"
          aria-modal="true"
        >
          <button
            id="sa-guide-close"
            class="icon-btn guide-close"
            type="button"
          >
            ×
          </button>
          <div class="eyebrow">
            {{ pick({ zh: '初次使用', en: 'First Use' }) }}
          </div>
          <h2 class="guide-title">
            {{ pick({ zh: '三步看懂这台机器人', en: 'Understand the Robot in Three Steps' }) }}
          </h2>
          <p class="guide-copy">
            {{ pick({ zh: '默认先浏览 7 大总成，需要时再展开 25 个零件。移动指针可以看到眼睛自然跟随；「行走演示」可以演示拟人步态两圈往返。', en: 'View the 7 assemblies first, expand the 25 parts when needed. Move the pointer to see the eyes naturally follow it; "Walk" demos two round trips of anthropomorphic gait.' }) }}
          </p>
          <div class="guide-diagram">
            <article class="guide-step">
              <div
                class="guide-visual"
                aria-hidden="true"
              >
                ↔
              </div>
              <div class="guide-step-no">
                {{ pick({ zh: '01 · 观察', en: '01 · Observe' }) }}
              </div>
              <h3>{{ pick({ zh: '拖拽与缩放', en: 'Drag and Zoom' }) }}</h3>
              <p>{{ pick({ zh: '左键拖拽环绕，滚轮缩放；视角漂移后点「等轴测」归位。', en: 'Left-drag to orbit, scroll to zoom; use "Isometric" to return when the view drifts.' }) }}</p>
            </article>
            <article class="guide-step">
              <div
                class="guide-visual"
                aria-hidden="true"
              >
                ◎
              </div>
              <div class="guide-step-no">
                {{ pick({ zh: '02 · 选择', en: '02 · Select' }) }}
              </div>
              <h3>{{ pick({ zh: '点击查看详情', en: 'Click to view details' }) }}</h3>
              <p>{{ pick({ zh: '点击模型或装配树选中零件；双击模型或树节点可快速定位。', en: 'Click the model or assembly tree to select a part; double-click to locate it quickly.' }) }}</p>
            </article>
            <article class="guide-step">
              <div
                class="guide-visual"
                aria-hidden="true"
              >
                ≋
              </div>
              <div class="guide-step-no">
                {{ pick({ zh: '03 · 爆炸', en: '03 · Explode' }) }}
              </div>
              <h3>{{ pick({ zh: '滑杆连续爆炸', en: 'Slide to explode continuously' }) }}</h3>
              <p>{{ pick({ zh: '拖动底部滑杆检视结构；也可以把范围限定到当前总成或功能系统。', en: 'Drag the bottom slider to inspect the structure; you can also limit the scope to the current assembly or functional system.' }) }}</p>
            </article>
          </div>
          <div class="guide-actions">
            <button
              id="sa-guide-done"
              class="btn primary"
              type="button"
            >
              {{ pick({ zh: '开始探索', en: 'Start Exploring' }) }}
            </button>
          </div>
        </section>
      </div>

      <div
        id="sa-backdrop"
        class="backdrop"
      />
      <div
        id="sa-toast"
        class="toast"
        role="status"
        aria-live="polite"
      />

      <p
        v-if="errorMsg"
        class="err"
      >
        {{ errorMsg }}
      </p>
    </div>
  </MediaDemoShell>
</template>

<style scoped>
/* =========================================================
   SOMA · porcelain bionic atlas —— 由原单文件页三套样式层合并：
   结构取自 v1/v3（三栏持久布局），配色取自 v2（瓷壳青色调），
   position:fixed 收进 .sa-root 改 absolute/grid。
   ========================================================= */
.sa-root {
  --bg: #090c0d;
  --panel: rgba(17, 21, 22, 0.92);
  --line: rgba(228, 238, 236, 0.1);
  --line-strong: rgba(228, 238, 236, 0.2);
  --text: #f2f4f1;
  --muted: #98a3a0;
  --dim: #66716e;
  --accent: #9deaff;
  --accent-soft: rgba(157, 234, 255, 0.12);
  --header-h: 60px;
  --left-w: 272px;
  --right-w: 330px;
  --sans: 'Hiragino Sans GB', 'PingFang SC', 'Noto Sans CJK SC', sans-serif;
  --condensed: 'STSong', 'Songti SC', 'Noto Serif CJK SC', serif;
  --mono: 'SFMono-Regular', 'Menlo', monospace;

  position: relative;
  display: grid;
  grid-template-columns: var(--left-w) minmax(0, 1fr) var(--right-w);
  grid-template-rows: var(--header-h) minmax(0, 1fr);
  width: 100%;
  height: min(88vh, 880px);
  min-height: 600px;
  overflow: hidden;
  border-radius: 16px;
  color: var(--text);
  background:
    radial-gradient(circle at 50% 28%, rgba(91, 126, 128, 0.14), transparent 38%),
    #090c0d;
  font-family: var(--sans);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}
.sa-root :deep(*),
.sa-root {
  box-sizing: border-box;
}
.sa-root :deep(button) {
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.sa-root :deep(button:focus-visible),
.sa-root :deep(input:focus-visible),
.sa-root :deep(select:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* ---------- 顶栏 ---------- */
.topbar {
  position: relative;
  z-index: 50;
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: var(--left-w) minmax(0, 1fr) auto;
  border-bottom: 1px solid var(--line-strong);
  background: linear-gradient(180deg, rgba(11, 14, 15, 0.96), rgba(11, 14, 15, 0.78));
  backdrop-filter: blur(18px);
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 0 18px;
}
.brand-mark {
  position: relative;
  width: 26px;
  height: 34px;
  flex: 0 0 auto;
  border: 1px solid rgba(223, 239, 238, 0.68);
  border-radius: 50% 50% 44% 44%;
  box-shadow: inset 0 0 18px rgba(157, 234, 255, 0.08), 0 0 22px rgba(157, 234, 255, 0.08);
}
.brand-mark::before {
  content: '';
  position: absolute;
  inset: 7px 5px;
  border: 1px solid rgba(157, 234, 255, 0.65);
  border-radius: 50%;
}
.brand-mark::after {
  content: '';
  position: absolute;
  bottom: 5px;
  left: 7px;
  width: 11px;
  border-top: 1px solid var(--accent);
  box-shadow: 0 0 10px var(--accent);
}
.brand-title {
  font: 600 17px/1 var(--condensed);
  letter-spacing: 0.12em;
  white-space: nowrap;
}
.brand-sub {
  margin-top: 6px;
  color: var(--muted);
  font: 7px/1 var(--sans);
  letter-spacing: 0.18em;
  white-space: nowrap;
}
.commandbar {
  display: flex;
  align-items: center;
  gap: 26px;
  min-width: 0;
  padding: 0 20px;
}
.command-label {
  color: var(--dim);
  font-size: 9px;
  letter-spacing: 0.12em;
}
.command-value {
  margin-top: 6px;
  overflow: hidden;
  color: #c7d1ce;
  font: 9px/1 var(--mono);
  letter-spacing: 0.08em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.command-value.live::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 7px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent);
}
.mode-switch {
  display: flex;
  margin-left: auto;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.025);
}
.mode-btn {
  min-width: 46px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  color: var(--muted);
  background: transparent;
  font-size: 9px;
  letter-spacing: 0.07em;
}
.mode-btn.active {
  color: #081013;
  background: #d7f8ff;
  box-shadow: 0 0 28px rgba(157, 234, 255, 0.18);
}
.top-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  padding: 0 14px;
}
.btn,
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 32px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  color: #c6ceca;
  background: rgba(255, 255, 255, 0.025);
  transition: border-color 0.18s ease, color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}
.btn {
  padding: 0 11px;
  font-size: 10px;
  letter-spacing: 0.06em;
}
.icon-btn {
  width: 32px;
  padding: 0;
  border-radius: 50%;
  font-size: 15px;
}
.btn:hover,
.icon-btn:hover {
  border-color: var(--accent);
  color: #fff;
  background: var(--accent-soft);
}
.btn:active,
.icon-btn:active {
  transform: translateY(1px);
}
.btn.primary {
  border-color: #c9f5ff;
  color: #071013;
  background: #c9f5ff;
  font-weight: 650;
  box-shadow: 0 0 28px rgba(157, 234, 255, 0.16);
}
.btn.active,
.icon-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.btn svg,
.icon-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
}
.fsbtn {
  width: 32px;
  padding: 0;
  border-radius: 50%;
}
.fsbtn svg {
  width: 15px;
  height: 15px;
}
.mobile-only {
  display: none;
}

/* ---------- 左右面板 ---------- */
.sidebar,
.inspector {
  position: relative;
  z-index: 30;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  backdrop-filter: blur(18px);
}
.sidebar {
  grid-column: 1;
  grid-row: 2;
  border-right: 1px solid var(--line-strong);
}
.inspector {
  grid-column: 3;
  grid-row: 2;
  border-left: 1px solid var(--line-strong);
}
.panel-close {
  position: absolute;
  z-index: 5;
  top: 12px;
  right: 12px;
  display: none;
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(7, 10, 11, 0.54);
}
.panel-head {
  padding: 16px 18px 14px;
  border-bottom: 1px solid var(--line);
}
.eyebrow {
  color: var(--accent);
  font-size: 8px;
  letter-spacing: 0.17em;
  text-transform: uppercase;
}
.panel-title {
  margin: 8px 0 0;
  font: 600 21px/1.15 var(--condensed);
  letter-spacing: 0.06em;
}
.search {
  position: relative;
  margin-top: 13px;
}
.search svg {
  position: absolute;
  top: 50%;
  left: 11px;
  width: 13px;
  height: 13px;
  fill: none;
  stroke: var(--muted);
  stroke-width: 1.7;
  transform: translateY(-50%);
  pointer-events: none;
}
.search input {
  width: 100%;
  height: 34px;
  padding: 0 32px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  color: var(--text);
  background: rgba(0, 0, 0, 0.2);
  font-size: 11px;
}
.search input::placeholder {
  color: #66736f;
}
.search-clear {
  position: absolute;
  top: 50%;
  right: 4px;
  display: none;
  width: 26px;
  height: 26px;
  border: 0;
  color: var(--muted);
  background: transparent;
  transform: translateY(-50%);
}
.search-clear.visible {
  display: block;
}

/* 系统（功能）筛选 */
.systems {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--line);
}
.sa-root :deep(.system-btn) {
  --c: var(--accent);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: #83908b;
  background: transparent;
  font-size: 9px;
}
.sa-root :deep(.system-btn::before) {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--c);
}
.sa-root :deep(.system-btn.active) {
  border-color: var(--c);
  color: #fff;
  background: color-mix(in srgb, var(--c) 13%, transparent);
}

/* 装配树 */
.tree-meta {
  display: flex;
  justify-content: space-between;
  padding: 10px 18px 7px;
  color: var(--dim);
  font: 8px/1 var(--sans);
  letter-spacing: 0.12em;
}
.assembly-tree {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 0 9px 20px;
  scrollbar-width: thin;
  scrollbar-color: #414d49 transparent;
}
.sa-root :deep(.assembly) {
  margin-bottom: 3px;
}
.sa-root :deep(.assembly-head) {
  --c: var(--accent);
  display: grid;
  grid-template-columns: 15px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  min-height: 33px;
  padding: 0 9px;
  border: 0;
  border-radius: 9px;
  color: #aeb8b4;
  background: transparent;
  text-align: left;
}
.sa-root :deep(.assembly-head:hover),
.sa-root :deep(.assembly-head.active) {
  color: #fff;
  background: rgba(255, 255, 255, 0.04);
}
.sa-root :deep(.assembly-arrow) {
  color: var(--c);
  font: 11px/1 var(--mono);
  transition: transform 0.18s ease;
}
.sa-root :deep(.assembly.collapsed .assembly-arrow) {
  transform: rotate(-90deg);
}
.sa-root :deep(.assembly-name) {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sa-root :deep(.assembly-count) {
  color: #64706c;
  font: 8px/1 var(--mono);
}
.sa-root :deep(.tree-children) {
  margin-left: 13px;
  border-left: 1px solid var(--line);
}
.sa-root :deep(.assembly.collapsed .tree-children) {
  display: none;
}
.sa-root :deep(.tree-item) {
  --c: var(--accent);
  position: relative;
  display: grid;
  grid-template-columns: 25px minmax(0, 1fr) 21px;
  gap: 7px;
  align-items: center;
  width: 100%;
  min-height: 42px;
  padding: 5px 6px 5px 10px;
  border: 0;
  border-bottom: 1px solid rgba(219, 230, 224, 0.07);
  color: #9da9a4;
  background: transparent;
  text-align: left;
}
.sa-root :deep(.tree-item::before) {
  content: '';
  position: absolute;
  top: 7px;
  bottom: 7px;
  left: -1px;
  width: 2px;
  background: var(--c);
  opacity: 0;
}
.sa-root :deep(.tree-item:hover) {
  color: #e7ece9;
  background: rgba(255, 255, 255, 0.03);
}
.sa-root :deep(.tree-item.active) {
  color: #fff;
  background: rgba(255, 255, 255, 0.055);
}
.sa-root :deep(.tree-item.active::before) {
  opacity: 1;
}
.sa-root :deep(.tree-no) {
  color: #697570;
  font: 8px/1 var(--mono);
}
.sa-root :deep(.tree-name) {
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sa-root :deep(.visibility-dot) {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 0;
  color: #68746f;
  background: transparent;
}
.sa-root :deep(.visibility-dot.hidden-part) {
  color: var(--accent);
}
.empty {
  display: none;
  margin: 22px 10px;
  padding: 20px 10px;
  border: 1px dashed var(--line-strong);
  color: var(--muted);
  text-align: center;
  font-size: 11px;
  line-height: 1.7;
}
.empty.visible {
  display: block;
}

/* ---------- 舞台 ---------- */
.stage {
  position: relative;
  z-index: 1;
  grid-column: 2;
  grid-row: 2;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  isolation: isolate;
  background:
    radial-gradient(ellipse at 50% 43%, rgba(87, 116, 119, 0.38) 0%, rgba(35, 48, 49, 0.28) 26%, transparent 55%),
    radial-gradient(circle at 50% 112%, rgba(150, 206, 211, 0.13), transparent 42%),
    linear-gradient(160deg, #111718 0%, #090c0d 58%, #07090a 100%);
}
.stage::before {
  content: '';
  position: absolute;
  z-index: 3;
  inset: 0;
  background:
    linear-gradient(90deg, rgba(0, 0, 0, 0.32), transparent 18%, transparent 82%, rgba(0, 0, 0, 0.32)),
    radial-gradient(circle at 50% 44%, transparent 0 31%, rgba(0, 0, 0, 0.08) 48%, rgba(0, 0, 0, 0.5) 100%);
  pointer-events: none;
}
.stage::after {
  content: '';
  position: absolute;
  z-index: 0;
  inset: 50% auto auto 50%;
  width: min(68vh, 52vw);
  aspect-ratio: 1;
  border: 1px solid rgba(202, 232, 232, 0.08);
  border-radius: 50%;
  box-shadow: 0 0 120px rgba(113, 200, 216, 0.05);
  transform: translate(-50%, -51%);
  pointer-events: none;
}
.webgl-host {
  position: absolute;
  inset: 0;
}
.webgl-host :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
  outline: 0;
  touch-action: none;
}
.labels-host {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  pointer-events: none;
}
.sa-root :deep(.part-label) {
  padding: 5px 9px;
  border: 1px solid rgba(207, 239, 240, 0.24);
  border-radius: 999px;
  color: #dce8e5;
  background: rgba(9, 13, 14, 0.72);
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.25);
  font: 8px/1 var(--mono);
  letter-spacing: 0.05em;
  white-space: nowrap;
  backdrop-filter: blur(10px);
}
.sa-root :deep(.part-label::after) {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  height: 14px;
  border-left: 1px solid rgba(231, 238, 234, 0.35);
}
.sa-root :deep(.part-label.selected) {
  border-color: var(--accent);
  color: var(--accent);
}

.stage-title {
  position: absolute;
  z-index: 5;
  top: 24px;
  left: 30px;
  width: 205px;
  max-width: calc(100% - 190px);
  pointer-events: none;
}
.stage-title h1 {
  display: grid;
  gap: 2px;
  width: max-content;
  max-width: 100%;
  margin: 0;
  font: 500 clamp(20px, 1.8vw, 27px) / 1.12 var(--condensed);
  letter-spacing: 0.08em;
  text-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
}
.stage-title h1 em {
  color: var(--accent);
  font-style: normal;
}
.stage-title h1 span,
.stage-title h1 em {
  white-space: nowrap;
}
.stage-meta {
  margin-top: 9px;
  color: #74817d;
  font: 7px/1.4 var(--sans);
  letter-spacing: 0.1em;
  white-space: nowrap;
}

.status-chip {
  position: absolute;
  z-index: 8;
  top: 104px;
  left: 30px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: #a8b5b1;
  background: rgba(12, 16, 17, 0.45);
  font: 8px/1 var(--mono);
  letter-spacing: 0.08em;
  pointer-events: none;
  backdrop-filter: blur(8px);
}
.status-chip::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--blue, #75d9f4);
  box-shadow: 0 0 10px var(--blue, #75d9f4);
}
.status-chip.animating::before {
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent);
}

.view-cube {
  position: absolute;
  z-index: 7;
  top: 22px;
  right: 24px;
  display: grid;
  grid-template-columns: repeat(3, 28px);
  grid-template-rows: repeat(2, 28px);
  gap: 4px;
}
.view-btn {
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  color: #899690;
  background: rgba(12, 16, 17, 0.5);
  font: 8px/1 var(--sans);
  backdrop-filter: blur(8px);
}
.view-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.view-btn.iso {
  grid-column: 1 / -1;
  border-radius: 999px;
}

.stage-mode-switch {
  position: absolute;
  z-index: 8;
  top: 18px;
  right: 22px;
  display: none;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(12, 16, 17, 0.72);
  backdrop-filter: blur(14px);
}
.stage-mode-switch .mode-btn {
  min-width: 44px;
}

.canvas-tools {
  position: absolute;
  z-index: 8;
  right: 26px;
  bottom: 118px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 7px;
}
.canvas-tools .icon-btn {
  width: auto;
  min-width: 92px;
  padding: 0 12px;
  gap: 8px;
  border-radius: 999px;
  background: rgba(12, 16, 17, 0.55);
  backdrop-filter: blur(14px);
}
.canvas-tools .tool-label {
  font-size: 9px;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.canvas-tools .icon-btn:disabled {
  opacity: 0.34;
  cursor: not-allowed;
}
#sa-walk-toggle.active {
  border-color: var(--blue, #75d9f4);
  color: #bdefff;
  background: var(--accent-soft);
}
#sa-walk-toggle.active svg {
  animation: walk-icon 0.58s ease-in-out infinite alternate;
}
@keyframes walk-icon {
  from {
    transform: translateY(-1px) rotate(-4deg);
  }
  to {
    transform: translateY(1px) rotate(4deg);
  }
}

.explode-bar {
  position: absolute;
  z-index: 10;
  right: auto;
  bottom: 20px;
  left: 50%;
  display: grid;
  grid-template-columns: auto minmax(150px, 1fr) auto auto auto;
  gap: 10px;
  align-items: center;
  width: min(720px, calc(100% - 44px));
  padding: 9px 10px;
  border: 1px solid rgba(228, 240, 238, 0.17);
  border-radius: 999px;
  background: rgba(12, 16, 17, 0.74);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.38);
  transform: translateX(-50%);
  backdrop-filter: blur(24px) saturate(120%);
}
.scope-select {
  width: 118px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: #b8c2bd;
  background: rgba(255, 255, 255, 0.035);
  font-size: 9px;
}
.range-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px;
  gap: 10px;
  align-items: center;
  min-width: 0;
}
.range {
  width: 100%;
  height: 18px;
  margin: 0;
  accent-color: #b9f3ff;
  cursor: ew-resize;
}
.range-value {
  color: #b9f3ff;
  font: 9px/1 var(--mono);
  text-align: right;
}
.explode-bar .btn {
  white-space: nowrap;
}
.explode-bar .icon-btn {
  background: rgba(255, 255, 255, 0.025);
}

/* 加载遮罩 */
.loading {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 50% 45%, rgba(77, 111, 114, 0.34), transparent 34%),
    #090c0d;
  transition: opacity 0.4s ease, visibility 0.4s ease;
}
.loading.done {
  display: none;
}
.loader-box {
  width: min(320px, calc(100% - 50px));
  text-align: center;
}
.loader-title {
  font: 500 22px/1.2 var(--condensed);
  letter-spacing: 0.12em;
}
.loader-copy {
  margin-top: 9px;
  color: var(--muted);
  font: 9px/1.6 var(--sans);
  letter-spacing: 0.08em;
}
.loader-track {
  height: 2px;
  margin-top: 18px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.1);
}
.loader-fill {
  width: 35%;
  height: 100%;
  background: var(--accent);
  box-shadow: 0 0 16px var(--accent);
  animation: soma-loading 1.2s ease-in-out infinite;
}
@keyframes soma-loading {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(390%);
  }
}

/* ---------- 右侧详情 ---------- */
.inspector-scroll {
  min-height: 0;
  flex: 1;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: #414d49 transparent;
  display: flex;
  flex-direction: column;
}
.inspector-hero {
  --c: var(--accent);
  position: relative;
  min-height: 150px;
  padding: 20px 20px 18px;
  overflow: hidden;
  border-bottom: 1px solid var(--line);
  background:
    radial-gradient(circle at 16% 15%, color-mix(in srgb, var(--c) 20%, transparent), transparent 44%),
    linear-gradient(150deg, rgba(255, 255, 255, 0.04), transparent 48%);
}
.inspector-hero::after {
  content: attr(data-no);
  position: absolute;
  right: -6px;
  bottom: -22px;
  color: rgba(255, 255, 255, 0.035);
  font: 120px/0.8 var(--condensed);
  pointer-events: none;
}
.inspector-index {
  color: var(--c);
  font: 8px/1 var(--sans);
  letter-spacing: 0.16em;
}
.inspector-name {
  position: relative;
  z-index: 1;
  max-width: 250px;
  margin: 13px 0 0;
  font: 600 24px/1.1 var(--condensed);
  letter-spacing: 0.03em;
}
.inspector-code {
  position: relative;
  z-index: 1;
  margin-top: 7px;
  color: #7d8985;
  font: 8px/1.4 var(--mono);
  letter-spacing: 0.1em;
}
.tags {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 12px;
}
.sa-root :deep(.tag) {
  padding: 5px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  color: #9ba7a2;
  font: 8px/1 var(--mono);
}
.sa-root :deep(.tag.system) {
  border-color: var(--c, var(--accent));
  color: var(--c, var(--accent));
  background: color-mix(in srgb, var(--c, var(--accent)) 10%, transparent);
}
.tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-bottom: 1px solid var(--line);
}
.tab {
  height: 38px;
  border: 0;
  border-right: 1px solid var(--line);
  color: #77837e;
  background: transparent;
  font-size: 9px;
  letter-spacing: 0.07em;
}
.tab:last-child {
  border-right: 0;
}
.tab.active {
  color: #fff;
  box-shadow: inset 0 -2px var(--accent);
  background: rgba(255, 255, 255, 0.025);
}
.inspector-body {
  --c: var(--accent);
  padding: 18px 20px 24px;
}
.sa-root :deep(.info-section + .info-section) {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}
.sa-root :deep(.section-label) {
  color: var(--accent);
  font-size: 8px;
  letter-spacing: 0.15em;
}
.sa-root :deep(.section-copy) {
  margin: 9px 0 0;
  color: #b8c2be;
  font-size: 11px;
  line-height: 1.8;
}
.sa-root :deep(.section-copy code) {
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  font-family: var(--mono);
  font-size: 10px;
  color: var(--accent);
}
.sa-root :deep(.detail-list) {
  display: grid;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}
.sa-root :deep(.detail-list li) {
  position: relative;
  padding-left: 14px;
  color: #a8b3ae;
  font-size: 10px;
  line-height: 1.55;
}
.sa-root :deep(.detail-list li::before) {
  content: '';
  position: absolute;
  top: 0.58em;
  left: 0;
  width: 5px;
  height: 5px;
  border: 1px solid var(--c);
  transform: rotate(45deg);
}
.sa-root :deep(.evidence) {
  margin-top: 18px;
  padding: 10px 12px;
  border-left: 2px solid var(--accent);
  color: #8f9b96;
  background: var(--accent-soft);
  font-size: 9px;
  line-height: 1.65;
}
.sa-root :deep(.actions-grid) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  margin-bottom: 18px;
}
.sa-root :deep(.action) {
  min-height: 34px;
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  color: #b9c3be;
  background: rgba(255, 255, 255, 0.025);
  font-size: 9px;
}
.sa-root :deep(.action:hover) {
  border-color: var(--accent);
  color: #fff;
}
.sa-root :deep(.action.primary) {
  border-color: var(--c);
  color: #fff;
  background: color-mix(in srgb, var(--c) 15%, transparent);
}
.sa-root :deep(.stat-grid) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  margin-top: 14px;
  border: 1px solid var(--line);
  background: var(--line);
}
.sa-root :deep(.stat) {
  min-height: 58px;
  padding: 11px;
  background: #151b1b;
}
.sa-root :deep(.stat-value) {
  font: 19px/1 var(--condensed);
}
.sa-root :deep(.stat-label) {
  margin-top: 6px;
  color: #68746f;
  font: 8px/1.3 var(--sans);
}
.sa-root :deep(.assembly-summary) {
  display: grid;
  gap: 7px;
  margin-top: 13px;
}
.sa-root :deep(.assembly-summary button) {
  --c: var(--accent);
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: #b8c2be;
  background: rgba(255, 255, 255, 0.02);
  text-align: left;
}
.sa-root :deep(.assembly-summary button:hover) {
  border-color: var(--c);
  color: #fff;
  background: color-mix(in srgb, var(--c) 8%, transparent);
}
.sa-root :deep(.assembly-summary-dot) {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c);
}
.sa-root :deep(.assembly-summary-count) {
  color: #6e7a76;
  font: 8px/1 var(--mono);
}
.sa-root :deep(.relation-flow) {
  display: grid;
  margin-top: 14px;
}
.sa-root :deep(.relation-node) {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  min-height: 50px;
  color: #b7c1bd;
}
.sa-root :deep(.relation-node:not(:last-child)::after) {
  content: '';
  position: absolute;
  top: 38px;
  bottom: -12px;
  left: 13px;
  border-left: 1px solid rgba(157, 234, 255, 0.25);
}
.sa-root :deep(.relation-node strong) {
  display: block;
  font-size: 10px;
  font-weight: 550;
}
.sa-root :deep(.relation-node small) {
  display: block;
  margin-top: 5px;
  color: #74807c;
  font-size: 8px;
  line-height: 1.45;
}
.sa-root :deep(.relation-index) {
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  border: 1px solid rgba(157, 234, 255, 0.3);
  border-radius: 50%;
  color: var(--accent);
  font: 8px/1 var(--mono);
  background: rgba(157, 234, 255, 0.05);
}

/* 教学进度（常驻详情底部） */
.lesson-progress {
  border-top: 1px solid var(--line);
  padding: 12px 20px 14px;
  background: rgba(10, 14, 14, 0.65);
}
.pg-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
}
.pg-head b {
  color: var(--accent);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.pg-track {
  height: 6px;
  margin-top: 6px;
  border-radius: 99px;
  background: rgba(120, 160, 220, 0.16);
  overflow: hidden;
}
.pg-fill {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--accent), #39e6a0);
  transition: width 0.3s ease;
}
.pg-list {
  list-style: none;
  margin: 7px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.pg-list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.5;
}
.pg-list li b {
  color: #fff;
  font-variant-numeric: tabular-nums;
  flex: none;
}
.pg-list li.done {
  color: #39e6a0;
}
.pg-list li.done b {
  color: #39e6a0;
}

/* ---------- 使用指南 ---------- */
.guide-overlay {
  position: absolute;
  z-index: 110;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  border-radius: inherit;
  background: rgba(3, 6, 7, 0.7);
  backdrop-filter: blur(10px);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.22s ease, visibility 0.22s ease;
}
.guide-overlay.visible {
  opacity: 1;
  visibility: visible;
}
.guide-panel {
  position: relative;
  width: min(700px, 100%);
  max-height: calc(100% - 20px);
  overflow: auto;
  padding: 28px;
  border: 1px solid rgba(220, 238, 237, 0.2);
  border-radius: 18px;
  background:
    radial-gradient(circle at 50% 0, rgba(99, 185, 202, 0.14), transparent 42%),
    rgba(13, 18, 19, 0.98);
  box-shadow: 0 32px 100px rgba(0, 0, 0, 0.62);
}
.guide-close {
  position: absolute;
  top: 14px;
  right: 14px;
}
.guide-title {
  margin: 9px 0 0;
  font: 500 26px/1.12 var(--condensed);
  letter-spacing: 0.06em;
}
.guide-copy {
  max-width: 560px;
  margin: 10px 0 0;
  color: #94a19d;
  font-size: 11px;
  line-height: 1.7;
}
.guide-diagram {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 22px;
}
.guide-step {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.025);
}
.guide-visual {
  position: relative;
  display: grid;
  place-items: center;
  height: 80px;
  margin-bottom: 14px;
  overflow: hidden;
  border-radius: 8px;
  color: var(--accent);
  background: radial-gradient(circle, rgba(157, 234, 255, 0.12), transparent 68%);
  font: 28px/1 var(--mono);
}
.guide-visual::after {
  content: '';
  position: absolute;
  inset: 12px;
  border: 1px solid rgba(157, 234, 255, 0.12);
  border-radius: 50%;
}
.guide-step-no {
  color: var(--accent);
  font: 8px/1 var(--mono);
  letter-spacing: 0.12em;
}
.guide-step h3 {
  margin: 8px 0 0;
  font-size: 13px;
  font-weight: 550;
}
.guide-step p {
  margin: 8px 0 0;
  color: #87938f;
  font-size: 9px;
  line-height: 1.65;
}
.guide-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

/* ---------- 遮罩 / 提示 ---------- */
.backdrop {
  position: absolute;
  z-index: 39;
  inset: var(--header-h) 0 0;
  display: none;
  background: rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(3px);
}
.backdrop.visible {
  display: block;
}
.toast {
  position: absolute;
  z-index: 90;
  left: 50%;
  bottom: 84px;
  max-width: min(440px, calc(100% - 28px));
  padding: 10px 14px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  color: #dce4e0;
  background: rgba(16, 21, 21, 0.97);
  box-shadow: 0 15px 45px rgba(0, 0, 0, 0.45);
  font-size: 10px;
  line-height: 1.5;
  opacity: 0;
  transform: translate(-50%, 10px);
  pointer-events: none;
  transition: 0.22s ease;
}
.toast.visible {
  opacity: 1;
  transform: translate(-50%, 0);
}
.err {
  position: absolute;
  z-index: 120;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  margin: 0;
  padding: 8px 12px;
  border: 1px solid rgba(255, 90, 111, 0.7);
  border-radius: 10px;
  color: #ffdce1;
  background: rgba(61, 11, 22, 0.94);
  font-size: 12px;
}

/* ---------- 全屏 ---------- */
.sa-root:fullscreen {
  height: 100vh;
  min-height: 0;
  border-radius: 0;
}
.sa-root:-webkit-full-screen {
  height: 100vh;
  min-height: 0;
  border-radius: 0;
}

/* ---------- 响应式 ---------- */
@media (max-width: 1179px) {
  .sa-root {
    grid-template-columns: minmax(0, 1fr) var(--right-w);
  }
  .topbar {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .commandbar {
    display: none;
  }
  .stage-title {
    left: 20px;
  }
  .sidebar {
    position: absolute;
    z-index: 45;
    top: var(--header-h);
    bottom: 0;
    left: 0;
    width: min(var(--left-w), calc(100vw - 45px));
    border-right: 1px solid var(--line-strong);
    box-shadow: 20px 0 55px rgba(0, 0, 0, 0.5);
    transform: translateX(-102%);
    transition: transform 0.25s cubic-bezier(0.2, 0.75, 0.2, 1);
  }
  .sidebar.mobile-open {
    transform: translateX(0);
  }
  .stage {
    grid-column: 1;
  }
  .inspector {
    grid-column: 2;
  }
  .stage-mode-switch {
    display: flex;
  }
  .view-cube {
    top: 60px;
  }
  .mobile-only,
  .panel-close {
    display: inline-flex;
  }
}

@media (max-width: 759px) {
  .sa-root {
    grid-template-columns: minmax(0, 1fr);
    --header-h: 54px;
  }
  .topbar {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .brand {
    padding: 0 12px;
    gap: 9px;
  }
  .brand-mark {
    width: 23px;
    height: 30px;
  }
  .brand-title {
    font-size: 14px;
  }
  .brand-sub {
    display: none;
  }
  .top-actions {
    padding: 0 8px;
    gap: 5px;
  }
  .top-actions .btn {
    height: 32px;
    padding: 0;
    border-radius: 50%;
  }
  .top-actions .btn span {
    display: none;
  }
  .stage {
    grid-column: 1;
    grid-row: 2;
  }
  .sidebar {
    top: var(--header-h);
  }
  .inspector {
    position: absolute;
    z-index: 47;
    top: auto;
    right: 8px;
    bottom: 8px;
    left: 8px;
    width: auto;
    max-height: 62vh;
    border: 1px solid var(--line-strong);
    border-radius: 14px;
    box-shadow: 0 -18px 70px rgba(0, 0, 0, 0.6);
    transform: translateY(calc(100% + 20px));
    transition: transform 0.26s cubic-bezier(0.2, 0.75, 0.2, 1);
  }
  .inspector.mobile-open {
    transform: translateY(0);
  }
  .stage-title {
    top: 16px;
    left: 15px;
    width: 150px;
  }
  .stage-title h1 {
    font-size: 19px;
  }
  .stage-meta {
    display: none;
  }
  .status-chip {
    top: 88px;
    left: 15px;
  }
  .stage-mode-switch {
    top: 12px;
    right: 12px;
  }
  .view-cube {
    top: 54px;
    right: 14px;
    grid-template-columns: repeat(3, 25px);
    grid-template-rows: repeat(2, 25px);
  }
  .canvas-tools {
    right: 14px;
    bottom: 112px;
  }
  .canvas-tools .icon-btn {
    min-width: 32px;
    padding: 0;
  }
  .canvas-tools .tool-label {
    display: none;
  }
  .explode-bar {
    bottom: 8px;
    width: calc(100% - 16px);
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 7px;
    padding: 7px;
  }
  .scope-select {
    display: none;
  }
  .range-wrap {
    grid-column: 1 / -1;
    order: -1;
  }
  .explode-bar .btn {
    padding: 0 9px;
  }
  .explode-bar .btn .long {
    display: none;
  }
  .guide-overlay {
    padding: 10px;
  }
  .guide-panel {
    padding: 20px 16px 16px;
  }
  .guide-title {
    font-size: 22px;
  }
  .guide-diagram {
    grid-template-columns: 1fr;
  }
  .toast {
    bottom: 100px;
  }
}

@media (prefers-reduced-motion: reduce) {
  #sa-walk-toggle.active svg {
    animation: none;
  }
}
</style>
