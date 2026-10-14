<script setup lang="ts">
/**
 * Swarm Studio 无人机灯光秀（原生页面版）
 *
 * 由独立单文件页（Swarm Studio · 3D Drone Light Show）移植，参考 robot/drone /
 * robot/avsim 的页面模式：
 *   - 浅色场景 / InstancedMesh 机队 / 编队库（13 种几何 + 文字编队）/ LED 主题 /
 *     自动编排 / 拖尾 / 航迹 / 实时遥测住在 utils/drone-dance/engine.ts
 *     （three 走 npm 依赖，无 CDN）；
 *   - 这里只负责「静态外壳 markup + 按需挂载引擎 + 教学进度上报」。
 *
 * 移植要点：原版 topbar/侧栏/底栏是 position:fixed 铺满视口的，这里收进 .dd-root 改 absolute；
 * 引擎持续写入的节点（遥测读数/进度/提示）不绑 Vue，交给引擎写。
 *
 * 教学完成条件（5 项，权重合计 1）：
 *   1. 切换一次几何编队
 *   2. 生成一次文字编队
 *   3. 更换一次 LED 主题
 *   4. 开启自动编排
 *   5. 调整一次机队规模
 */
import { createDroneDance, type DroneDanceTask, type Lang } from '~/utils/drone-dance/engine'
import { reportCorrectRate } from '~/utils/embed-report'
import { pickText, type LocalizedText } from '~/utils/localized'

const APP_ID = 'robot/drone_dance'

const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'drone_dance')!)
const { locale } = useI18n()
const lang = computed<Lang>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: LocalizedText) => pickText(o, lang.value)

const rootEl = ref<HTMLElement | null>(null)
const errorMsg = ref('')
let handle: ReturnType<typeof createDroneDance> | null = null

/* ---------- 教学进度（上报用） ---------- */
const didFormation = ref(false)
const didText = ref(false)
const didTheme = ref(false)
const didAuto = ref(false)
const didFleet = ref(false)

const tasks = computed(() => [
  {
    key: 'formation',
    label: { zh: '切换一种几何编队', en: 'Switch to a geometric formation' } as LocalizedText,
    done: didFormation.value ? 1 : 0,
    total: 1,
    weight: 0.25
  },
  {
    key: 'text',
    label: { zh: '生成一次文字编队', en: 'Build a text formation' } as LocalizedText,
    done: didText.value ? 1 : 0,
    total: 1,
    weight: 0.2
  },
  {
    key: 'theme',
    label: { zh: '更换一次 LED 主题', en: 'Change the LED theme' } as LocalizedText,
    done: didTheme.value ? 1 : 0,
    total: 1,
    weight: 0.15
  },
  {
    key: 'auto',
    label: { zh: '开启自动编排', en: 'Enable auto choreography' } as LocalizedText,
    done: didAuto.value ? 1 : 0,
    total: 1,
    weight: 0.2
  },
  {
    key: 'fleet',
    label: { zh: '调整一次机队规模', en: 'Resize the drone fleet' } as LocalizedText,
    done: didFleet.value ? 1 : 0,
    total: 1,
    weight: 0.2
  }
])

const rate = computed(() => tasks.value.reduce((acc, t) => acc + t.weight * Math.min(1, t.done / t.total), 0))
const finished = computed(() => rate.value >= 0.999)

function onTask(task: DroneDanceTask) {
  if (task === 'formation') didFormation.value = true
  else if (task === 'text') didText.value = true
  else if (task === 'theme') didTheme.value = true
  else if (task === 'auto') didAuto.value = true
  else if (task === 'fleet') didFleet.value = true
}

/** 上报契约：parent.postMessage({ type:'correct_rate', rate, ... })，详见 utils/embed-report.ts */
watch([rate, finished], () => {
  reportCorrectRate({
    app: APP_ID,
    rate: rate.value,
    finished: finished.value,
    locale: locale.value,
    extra: {
      formation: didFormation.value,
      text: didText.value,
      theme: didTheme.value,
      auto: didAuto.value,
      fleet: didFleet.value
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
    handle = createDroneDance(root, {
      getLocale: () => lang.value,
      onTask
    })
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  }
}

/* ---------- 全屏 ---------- */
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
    console.warn('[robot/drone_dance] requestFullscreen failed', err)
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
      class="dd-root"
    >
      <div
        id="dd-scene"
        class="dd-stage"
      />

      <header class="dd-topbar">
        <div class="dd-brand">
          <div
            class="dd-brand-mark"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 32 32"
              fill="none"
            ><path
              d="M16 12.5v7M12.5 16h7M8 8l4 4m8 8 4 4M24 8l-4 4m-8 8-4 4"
              stroke="white"
              stroke-width="2"
              stroke-linecap="round"
            /><circle
              cx="8"
              cy="8"
              r="3"
              stroke="white"
              stroke-width="1.7"
            /><circle
              cx="24"
              cy="8"
              r="3"
              stroke="white"
              stroke-width="1.7"
            /><circle
              cx="8"
              cy="24"
              r="3"
              stroke="white"
              stroke-width="1.7"
            /><circle
              cx="24"
              cy="24"
              r="3"
              stroke="white"
              stroke-width="1.7"
            /><circle
              cx="16"
              cy="16"
              r="3"
              fill="white"
            /></svg>
          </div>
          <div>
            <div class="dd-brand-title">
              SWARM STUDIO
            </div>
            <div class="dd-brand-sub">
              {{ pick({ zh: '三维无人机灯光秀', en: '3D DRONE LIGHT SHOW' }) }}
            </div>
          </div>
        </div>
        <div class="dd-live-pill">
          <span class="dd-live-dot" /> {{ pick({ zh: '实时仿真', en: 'LIVE SIMULATION' }) }}
        </div>
        <div class="dd-top-actions">
          <button
            id="dd-play"
            class="dd-icon-button"
            type="button"
            :title="pick({ zh: '播放或暂停仿真', en: 'Play or pause the simulation' })"
          >
            Ⅱ &nbsp; {{ pick({ zh: '暂停', en: 'Pause' }) }}
          </button>
          <button
            id="dd-reset-view"
            class="dd-icon-button"
            type="button"
            :title="pick({ zh: '复位相机视角', en: 'Reset camera view' })"
          >
            ↻ &nbsp; {{ pick({ zh: '复位视角', en: 'Reset View' }) }}
          </button>
          <button
            class="dd-icon-button"
            type="button"
            :title="fsLabel"
            :aria-label="fsLabel"
            @click="toggleFullscreen"
          >
            {{ isFullscreen ? '⤡' : '⛶' }} &nbsp; {{ isFullscreen ? pick({ zh: '退出全屏', en: 'Exit' }) : pick({ zh: '全屏', en: 'Fullscreen' }) }}
          </button>
        </div>
      </header>

      <main class="dd-layout">
        <aside class="dd-panel">
          <div class="dd-section-head">
            <h2 class="dd-section-title">
              {{ pick({ zh: '飞行控制', en: 'Flight Controls' }) }}
            </h2><span class="dd-section-no">01 / CONTROL</span>
          </div>
          <div class="dd-field-head">
            <label for="dd-drone-count">{{ pick({ zh: '机队规模', en: 'Drone Fleet' }) }}</label><strong id="dd-drone-count-value">420</strong>
          </div>
          <input
            id="dd-drone-count"
            type="range"
            min="100"
            max="800"
            step="20"
            value="420"
          >
          <div class="dd-range-ends">
            <span>100</span><span>800</span>
          </div>
          <div class="dd-field-head">
            <label for="dd-speed">{{ pick({ zh: '变换速度', en: 'Transition Speed' }) }}</label><strong id="dd-speed-value">1.0×</strong>
          </div>
          <input
            id="dd-speed"
            type="range"
            min="0.3"
            max="2.5"
            step="0.1"
            value="1"
          >
          <div class="dd-range-ends">
            <span>{{ pick({ zh: '平滑', en: 'SMOOTH' }) }}</span><span>{{ pick({ zh: '快速', en: 'FAST' }) }}</span>
          </div>
          <div class="dd-field-head">
            <label for="dd-altitude">{{ pick({ zh: '飞行高度', en: 'Flight Altitude' }) }}</label><strong id="dd-altitude-value">18 m</strong>
          </div>
          <input
            id="dd-altitude"
            type="range"
            min="8"
            max="34"
            step="1"
            value="18"
          >
          <div class="dd-range-ends">
            <span>8 M</span><span>34 M</span>
          </div>

          <div class="dd-divider" />
          <div class="dd-section-head">
            <h2 class="dd-section-title">
              {{ pick({ zh: '编队库', en: 'Formation Library' }) }}
            </h2><span class="dd-section-no">02 / SHAPES</span>
          </div>
          <div
            id="dd-formation-grid"
            class="dd-formation-grid"
          >
            <button
              class="dd-formation active"
              type="button"
              data-shape="sphere"
            >
              <svg viewBox="0 0 28 24"><ellipse
                cx="14"
                cy="12"
                rx="10"
                ry="10"
              /><ellipse
                cx="14"
                cy="12"
                rx="4.5"
                ry="10"
              /><path d="M4 12h20M6 7.5h16M6 16.5h16" /></svg>{{ pick({ zh: '球体', en: 'Globe' }) }}
            </button>
            <button
              class="dd-formation"
              type="button"
              data-shape="heart"
            >
              <svg viewBox="0 0 28 24"><path d="M14 21S2.5 13.6 2.5 7.5A5.2 5.2 0 0 1 14 5.3a5.2 5.2 0 0 1 11.5 2.2C25.5 13.6 14 21 14 21Z" /></svg>{{ pick({ zh: '爱心', en: 'Heart' }) }}
            </button>
            <button
              class="dd-formation"
              type="button"
              data-shape="star"
            >
              <svg viewBox="0 0 28 24"><path d="m14 2 3.6 7.1 7.9 1.1-5.7 5.5 1.4 7.8-7.2-3.7-7.2 3.7 1.4-7.8-5.7-5.5 7.9-1.1Z" /></svg>{{ pick({ zh: '星形', en: 'Star' }) }}
            </button>
            <button
              class="dd-formation"
              type="button"
              data-shape="ring"
            >
              <svg viewBox="0 0 28 24"><ellipse
                cx="14"
                cy="12"
                rx="11"
                ry="4.2"
              /><ellipse
                cx="14"
                cy="12"
                rx="5.5"
                ry="9.5"
                transform="rotate(-20 14 12)"
              /></svg>{{ pick({ zh: '轨道', en: 'Orbit' }) }}
            </button>
            <button
              class="dd-formation"
              type="button"
              data-shape="helix"
            >
              <svg viewBox="0 0 28 24"><path d="M5 2c18 5 0 15 18 20M23 2C5 7 23 17 5 22M8 4h12M7 9h14M7 15h14M8 20h12" /></svg>{{ pick({ zh: '螺旋链', en: 'Helix' }) }}
            </button>
            <button
              class="dd-formation"
              type="button"
              data-shape="spiral"
            >
              <svg viewBox="0 0 28 24"><path d="M14 12c0-2.5 4-3 5-1s-.5 5-4 5-7-3-6-7 6-7 11-4 5 9 1 13" /></svg>{{ pick({ zh: '星系', en: 'Spiral' }) }}
            </button>
            <button
              class="dd-formation"
              type="button"
              data-shape="wave"
            >
              <svg viewBox="0 0 28 24"><path d="M2 7c4-8 7 8 12 0s8 8 12 0M2 12c4-8 7 8 12 0s8 8 12 0M2 17c4-8 7 8 12 0s8 8 12 0" /></svg>{{ pick({ zh: '波浪', en: 'Wave' }) }}
            </button>
            <button
              class="dd-formation"
              type="button"
              data-shape="cube"
            >
              <svg viewBox="0 0 28 24"><path d="m14 2 11 5.5v9L14 22 3 16.5v-9Z M3 7.5l11 6 11-6M14 13.5V22" /></svg>{{ pick({ zh: '立方体', en: 'Cube' }) }}
            </button>
            <button
              class="dd-formation"
              type="button"
              data-shape="infinity"
            >
              <svg viewBox="0 0 28 24"><path d="M14 12C8 3 2 6 2 12s6 9 12 0 12-9 12 0-6 9-12 0Z" /></svg>{{ pick({ zh: '无限', en: 'Infinity' }) }}
            </button>
            <button
              class="dd-formation"
              type="button"
              data-shape="arrow"
            >
              <svg viewBox="0 0 28 24"><path d="M2 12 14 3v5h12v8H14v5Z" /></svg>{{ pick({ zh: '箭头', en: 'Arrow' }) }}
            </button>
            <button
              class="dd-formation"
              type="button"
              data-shape="butterfly"
            >
              <svg viewBox="0 0 28 24"><path d="M14 11C9 0 1 2 2 9s7 7 12 4c-5 11-11 9-10 5s5-3 10-7c5-9 13-9 12-2s-7 7-12 4c5 11 11 9 10 5s-5-3-10-7Z" /></svg>{{ pick({ zh: '蝴蝶', en: 'Butterfly' }) }}
            </button>
            <button
              class="dd-formation"
              type="button"
              data-shape="scatter"
            >
              <svg viewBox="0 0 28 24"><circle
                cx="5"
                cy="6"
                r="1.5"
              /><circle
                cx="13"
                cy="4"
                r="1.5"
              /><circle
                cx="23"
                cy="7"
                r="1.5"
              /><circle
                cx="9"
                cy="14"
                r="1.5"
              /><circle
                cx="19"
                cy="12"
                r="1.5"
              /><circle
                cx="5"
                cy="21"
                r="1.5"
              /><circle
                cx="15"
                cy="20"
                r="1.5"
              /><circle
                cx="24"
                cy="19"
                r="1.5"
              /></svg>{{ pick({ zh: '散飞', en: 'Scatter' }) }}
            </button>
          </div>
          <div class="dd-text-form">
            <input
              id="dd-custom-text"
              type="text"
              maxlength="12"
              value="AI"
              :aria-label="pick({ zh: '自定义文字编队', en: 'Custom text formation' })"
              :placeholder="pick({ zh: '输入文字…', en: 'Enter text...' })"
            >
            <button
              id="dd-text-btn"
              class="dd-primary"
              type="button"
            >
              {{ pick({ zh: '生成文字', en: 'Build Text' }) }}
            </button>
          </div>

          <div class="dd-divider" />
          <div class="dd-section-head">
            <h2 class="dd-section-title">
              {{ pick({ zh: '灯光效果', en: 'Show Effects' }) }}
            </h2><span class="dd-section-no">03 / FX</span>
          </div>
          <div class="dd-field-head">
            <span>{{ pick({ zh: 'LED 色彩主题', en: 'LED Color Theme' }) }}</span>
          </div>
          <div
            id="dd-color-themes"
            class="dd-swatches"
          >
            <button
              class="dd-swatch active"
              type="button"
              data-theme="ice"
              :aria-label="pick({ zh: '冰蓝主题', en: 'Ice color theme' })"
              style="background:linear-gradient(135deg,#22dcff 0 48%,#316bff 52% 100%)"
            />
            <button
              class="dd-swatch"
              type="button"
              data-theme="rainbow"
              :aria-label="pick({ zh: '彩虹主题', en: 'Rainbow color theme' })"
              style="background:conic-gradient(#ff4f78,#ffcb52,#48df93,#25cfff,#7e62ff,#ff4f78)"
            />
            <button
              class="dd-swatch"
              type="button"
              data-theme="sunset"
              :aria-label="pick({ zh: '日落主题', en: 'Sunset color theme' })"
              style="background:linear-gradient(135deg,#ff4e68,#ffb438)"
            />
            <button
              class="dd-swatch"
              type="button"
              data-theme="emerald"
              :aria-label="pick({ zh: '翡翠主题', en: 'Emerald color theme' })"
              style="background:linear-gradient(135deg,#00d49d,#57ec72)"
            />
          </div>
          <div class="dd-toggle-row">
            <span>{{ pick({ zh: '自动编排', en: 'Auto Choreography' }) }}</span><label class="dd-toggle"><input
              id="dd-auto"
              type="checkbox"
            ><span /></label>
          </div>
          <div class="dd-toggle-row">
            <span>{{ pick({ zh: '编队拖尾', en: 'Formation Trails' }) }}</span><label class="dd-toggle"><input
              id="dd-trails"
              type="checkbox"
            ><span /></label>
          </div>
          <div class="dd-toggle-row">
            <span>{{ pick({ zh: '显示航迹', en: 'Show Flight Paths' }) }}</span><label class="dd-toggle"><input
              id="dd-paths"
              type="checkbox"
            ><span /></label>
          </div>
          <div class="dd-two-buttons">
            <button
              id="dd-scatter"
              class="dd-secondary"
              type="button"
            >
              ✣ &nbsp; {{ pick({ zh: '打散', en: 'Randomize' }) }}
            </button>
            <button
              id="dd-reform"
              class="dd-primary"
              type="button"
            >
              ▶ &nbsp; {{ pick({ zh: '重排', en: 'Re-form' }) }}
            </button>
          </div>

          <div class="dd-divider" />
          <!-- 教学进度（同时决定给宿主的 rate） -->
          <div class="dd-progress">
            <div class="dd-pg-head">
              <span>{{ pick({ zh: '教学进度', en: 'Lesson Progress' }) }}</span>
              <b>{{ Math.round(rate * 100) }}%</b>
            </div>
            <div class="dd-pg-track">
              <span
                class="dd-pg-fill"
                :style="{ width: `${Math.round(rate * 100)}%` }"
              />
            </div>
            <ul class="dd-pg-list">
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

          <div class="dd-footer-note">
            {{ pick({ zh: '拖拽旋转 · 滚轮缩放 · 右键平移。全部无人机均在本地实时仿真。', en: 'Drag to orbit · Scroll to zoom · Right-drag to pan. All drones are simulated locally in real time.' }) }}
          </div>
        </aside>

        <aside
          class="dd-panel dd-right"
          :aria-label="pick({ zh: '实时遥测', en: 'Live telemetry' })"
        >
          <div class="dd-section-head">
            <h2 class="dd-section-title">
              {{ pick({ zh: '实时遥测', en: 'Live Telemetry' }) }}
            </h2><span class="dd-section-no">SYS / 01</span>
          </div>
          <div class="dd-metric">
            <div class="dd-metric-top">
              <span>{{ pick({ zh: '在线机队', en: 'Active Fleet' }) }}</span><span class="dd-metric-icon">✣</span>
            </div>
            <div
              id="dd-stat-fleet"
              class="dd-metric-value"
            >
              420 <small>UAVs</small>
            </div>
            <div class="dd-metric-foot">
              {{ pick({ zh: '全部单元已连接', en: 'All units connected' }) }}
            </div>
          </div>
          <div class="dd-metric">
            <div class="dd-metric-top">
              <span>{{ pick({ zh: '平均高度', en: 'Average Altitude' }) }}</span><span class="dd-metric-icon">↟</span>
            </div>
            <div
              id="dd-stat-altitude"
              class="dd-metric-value"
            >
              18.0 <small>m</small>
            </div>
            <div class="dd-metric-foot">
              {{ pick({ zh: '相对地面高度', en: 'Above ground level' }) }}
            </div>
          </div>
          <div class="dd-metric">
            <div class="dd-metric-top">
              <span>{{ pick({ zh: '当前编队', en: 'Formation' }) }}</span><span class="dd-metric-icon">⌘</span>
            </div>
            <div
              id="dd-stat-formation"
              class="dd-metric-value"
              style="font-size:19px"
            >
              GLOBE
            </div>
            <div
              id="dd-stat-formation-sub"
              class="dd-metric-foot"
            >
              {{ pick({ zh: '球面星座编队', en: 'Spherical constellation' }) }}
            </div>
          </div>
          <div class="dd-metric">
            <div class="dd-metric-top">
              <span>{{ pick({ zh: '变换进度', en: 'Transition' }) }}</span><span class="dd-metric-icon">◷</span>
            </div>
            <div
              id="dd-stat-progress"
              class="dd-metric-value"
            >
              100<small>%</small>
            </div>
            <div class="dd-progress-track">
              <div
                id="dd-progress-bar"
                class="dd-progress-bar"
              />
            </div>
            <div
              id="dd-progress-text"
              class="dd-metric-foot"
            >
              {{ pick({ zh: '编队已锁定', en: 'Formation locked' }) }}
            </div>
          </div>
          <div class="dd-divider" />
          <div class="dd-section-head">
            <h2 class="dd-section-title">
              {{ pick({ zh: '系统状态', en: 'System Status' }) }}
            </h2><span class="dd-section-no">NOMINAL</span>
          </div>
          <div class="dd-status-line">
            <span>{{ pick({ zh: '飞行控制器', en: 'Flight Controller' }) }}</span><strong style="color:#17986d">● {{ pick({ zh: '在线', en: 'ONLINE' }) }}</strong>
          </div>
          <div class="dd-status-line">
            <span>{{ pick({ zh: '定位锁定', en: 'Position Lock' }) }}</span><strong style="color:#17986d">● {{ pick({ zh: '稳定', en: 'STABLE' }) }}</strong>
          </div>
          <div class="dd-status-line">
            <span>{{ pick({ zh: '链路质量', en: 'Link Quality' }) }}</span><strong>99.8%</strong>
          </div>
          <div class="dd-status-line">
            <span>{{ pick({ zh: '帧率', en: 'Frame Rate' }) }}</span><strong id="dd-stat-fps">60 FPS</strong>
          </div>
          <div class="dd-status-line">
            <span>{{ pick({ zh: '仿真时间', en: 'Simulation Time' }) }}</span><strong id="dd-stat-time">00:00</strong>
          </div>
          <div class="dd-footer-note">
            {{ pick({ zh: '模拟遥测数据 · 非真实飞行数据', en: 'SIMULATED TELEMETRY · NOT REAL FLIGHT DATA' }) }}
          </div>
        </aside>
      </main>

      <div class="dd-bottom-hint">
        <b>{{ pick({ zh: '拖拽', en: 'DRAG' }) }}</b> {{ pick({ zh: '旋转', en: 'ORBIT' }) }} &nbsp;·&nbsp; <b>{{ pick({ zh: '滚轮', en: 'SCROLL' }) }}</b> {{ pick({ zh: '缩放', en: 'ZOOM' }) }} &nbsp;·&nbsp; <b>{{ pick({ zh: '点击', en: 'CLICK' }) }}</b> {{ pick({ zh: '编队即变换', en: 'A FORMATION TO TRANSFORM' }) }}
      </div>
      <div
        id="dd-toast"
        class="dd-toast"
      >
        {{ pick({ zh: '编队已更新', en: 'Formation updated' }) }}
      </div>

      <p
        v-if="errorMsg"
        class="dd-err"
      >
        {{ errorMsg }}
      </p>
    </div>
  </MediaDemoShell>
</template>

<style scoped>
/* 原样式是整页全局写法，这里收进 .dd-root，并把 position:fixed 改成 absolute */
.dd-root {
  --dd-ink: #10233e;
  --dd-muted: #6c7d94;
  --dd-panel: rgba(255, 255, 255, .88);
  --dd-line: rgba(29, 69, 115, .12);
  --dd-blue: #2267f2;
  --dd-cyan: #18c8df;
  --dd-shadow: 0 18px 50px rgba(43, 78, 125, .14);

  position: relative;
  width: 100%;
  height: min(88vh, 880px);
  min-height: 560px;
  overflow: hidden;
  border-radius: 16px;
  color: var(--dd-ink);
  background: #eaf4ff;
  font-size: 13px;
}
.dd-root :deep(*),
.dd-root {
  box-sizing: border-box;
}
.dd-stage {
  position: absolute;
  inset: 0;
  z-index: 0;
}
.dd-stage :deep(canvas) {
  display: block;
  outline: none;
}

.dd-topbar {
  position: absolute;
  z-index: 5;
  top: 18px;
  left: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  pointer-events: none;
}
.dd-brand,
.dd-top-actions {
  pointer-events: auto;
}
.dd-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 15px 10px 10px;
  border: 1px solid rgba(255, 255, 255, .9);
  border-radius: 17px;
  background: rgba(255, 255, 255, .78);
  box-shadow: var(--dd-shadow);
  backdrop-filter: blur(16px);
}
.dd-brand-mark {
  width: 40px;
  height: 40px;
  border-radius: 13px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(145deg, #246aff, #17bfd5);
  box-shadow: 0 7px 18px rgba(34, 103, 242, .25);
}
.dd-brand-mark svg {
  width: 25px;
  height: 25px;
}
.dd-brand-title {
  font-size: 15px;
  font-weight: 850;
  letter-spacing: .12em;
  line-height: 1.15;
}
.dd-brand-sub {
  margin-top: 4px;
  color: var(--dd-muted);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .16em;
}
.dd-live-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid rgba(37, 181, 127, .22);
  border-radius: 999px;
  padding: 8px 11px;
  background: rgba(237, 255, 247, .94);
  color: #188b66;
  font-size: 10px;
  font-weight: 850;
  letter-spacing: .12em;
}
.dd-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 99px;
  background: #24c58a;
  box-shadow: 0 0 0 4px rgba(36, 197, 138, .12);
  animation: dd-blink 1.6s ease-in-out infinite;
}
@keyframes dd-blink {
  50% {
    opacity: .45;
  }
}
.dd-top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dd-icon-button {
  border: 1px solid rgba(255, 255, 255, .95);
  background: rgba(255, 255, 255, .82);
  color: var(--dd-ink);
  height: 40px;
  padding: 0 13px;
  border-radius: 13px;
  font-size: 12px;
  font-weight: 750;
  cursor: pointer;
  box-shadow: 0 8px 25px rgba(43, 78, 125, .1);
  backdrop-filter: blur(12px);
  transition: transform .18s, background .18s;
}
.dd-icon-button:hover {
  transform: translateY(-2px);
  background: #fff;
}
.dd-layout {
  position: absolute;
  z-index: 4;
  inset: 82px 20px 20px;
  pointer-events: none;
  display: flex;
  justify-content: space-between;
  gap: 14px;
}
.dd-panel {
  pointer-events: auto;
  width: 292px;
  max-height: 100%;
  overflow: auto;
  padding: 16px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, .92);
  background: var(--dd-panel);
  box-shadow: var(--dd-shadow);
  backdrop-filter: blur(18px);
  scrollbar-width: thin;
  scrollbar-color: #d3dfed transparent;
}
.dd-panel.dd-right {
  width: 245px;
  align-self: flex-start;
}
.dd-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 1px 0 12px;
}
.dd-section-title {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .16em;
  font-weight: 900;
}
.dd-section-no {
  color: #8b9ab0;
  font: 800 10px ui-monospace, monospace;
}
.dd-divider {
  height: 1px;
  background: var(--dd-line);
  margin: 15px 0;
}
.dd-field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 11px 0 8px;
  color: #526681;
  font-size: 11px;
  font-weight: 750;
}
.dd-field-head strong {
  color: var(--dd-blue);
  font-size: 12px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.dd-root :deep(input[type="range"]) {
  width: 100%;
  accent-color: var(--dd-blue);
  cursor: pointer;
}
.dd-range-ends {
  display: flex;
  justify-content: space-between;
  color: #93a1b4;
  font-size: 9px;
  margin-top: 3px;
}
.dd-formation-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}
.dd-root :deep(.dd-formation) {
  min-width: 0;
  padding: 9px 5px 8px;
  border: 1px solid #e3ebf5;
  border-radius: 12px;
  background: rgba(255, 255, 255, .7);
  color: #536984;
  font-size: 10px;
  font-weight: 800;
  cursor: pointer;
  transition: all .18s;
}
.dd-root :deep(.dd-formation svg) {
  display: block;
  width: 27px;
  height: 24px;
  margin: 0 auto 6px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.dd-root :deep(.dd-formation:hover) {
  border-color: #9ebcff;
  color: var(--dd-blue);
  transform: translateY(-1px);
}
.dd-root :deep(.dd-formation.active) {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, #286cf6, #16b7d9);
  box-shadow: 0 6px 14px rgba(34, 103, 242, .2);
}
.dd-text-form {
  display: flex;
  gap: 6px;
  margin-top: 9px;
}
.dd-text-form input {
  width: 100%;
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid #dce6f1;
  border-radius: 10px;
  color: var(--dd-ink);
  background: #fff;
  outline: none;
  font-weight: 750;
  font-size: 12px;
  text-transform: uppercase;
}
.dd-text-form input:focus {
  border-color: #84a8ff;
  box-shadow: 0 0 0 3px rgba(34, 103, 242, .09);
}
.dd-root :deep(button.dd-primary),
.dd-root :deep(button.dd-secondary) {
  border: 0;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 850;
  cursor: pointer;
  white-space: nowrap;
  transition: transform .16s, filter .16s;
}
.dd-root :deep(button.dd-primary) {
  background: var(--dd-blue);
  color: #fff;
  box-shadow: 0 5px 14px rgba(34, 103, 242, .2);
}
.dd-root :deep(button.dd-secondary) {
  color: #536984;
  background: #eef3fa;
}
.dd-root :deep(button.dd-primary:hover),
.dd-root :deep(button.dd-secondary:hover) {
  transform: translateY(-1px);
  filter: brightness(1.03);
}
.dd-two-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  margin-top: 12px;
}
.dd-swatches {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dd-root :deep(.dd-swatch) {
  border: 2px solid rgba(255, 255, 255, .9);
  width: 27px;
  height: 27px;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 0 1px #d7e1ed;
  position: relative;
}
.dd-root :deep(.dd-swatch.active::after) {
  content: '';
  position: absolute;
  inset: -5px;
  border: 2px solid var(--dd-blue);
  border-radius: 50%;
}
.dd-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 10px 0;
  font-size: 11px;
  color: #526681;
  font-weight: 750;
}
.dd-root :deep(.dd-toggle) {
  position: relative;
  width: 34px;
  height: 19px;
  flex: 0 0 auto;
}
.dd-root :deep(.dd-toggle input) {
  opacity: 0;
  width: 0;
  height: 0;
}
.dd-root :deep(.dd-toggle span) {
  position: absolute;
  cursor: pointer;
  inset: 0;
  border-radius: 20px;
  background: #c9d5e5;
  transition: .2s;
}
.dd-root :deep(.dd-toggle span::before) {
  content: '';
  position: absolute;
  width: 13px;
  height: 13px;
  left: 3px;
  top: 3px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px #8293a9;
  transition: .2s;
}
.dd-root :deep(.dd-toggle input:checked + span) {
  background: var(--dd-blue);
}
.dd-root :deep(.dd-toggle input:checked + span::before) {
  transform: translateX(15px);
}
.dd-metric {
  padding: 11px 12px;
  border: 1px solid #e5edf6;
  border-radius: 13px;
  background: rgba(255, 255, 255, .62);
  margin-bottom: 8px;
}
.dd-metric-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #7d8ea5;
  font-size: 9px;
  font-weight: 850;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.dd-metric-value {
  color: var(--dd-ink);
  font-size: 23px;
  font-weight: 900;
  line-height: 1.3;
  letter-spacing: -.04em;
  font-variant-numeric: tabular-nums;
}
.dd-metric-value small {
  color: #7b8ea7;
  font-size: 10px;
  letter-spacing: 0;
  font-weight: 800;
}
.dd-metric-foot {
  color: #91a0b4;
  font-size: 10px;
  margin-top: 2px;
}
.dd-metric-icon {
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  border-radius: 8px;
  background: #edf4ff;
  color: var(--dd-blue);
  font-size: 13px;
}
.dd-progress-track {
  height: 5px;
  background: #e8eef7;
  border-radius: 10px;
  overflow: hidden;
  margin-top: 8px;
}
.dd-progress-bar {
  height: 100%;
  width: 100%;
  background: linear-gradient(90deg, #2267f2, #18c8df);
  border-radius: inherit;
  transition: width .15s;
}
.dd-status-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: #7c8fa7;
  padding: 6px 1px;
}
.dd-status-line strong {
  color: #3e5572;
  font-weight: 850;
  text-align: right;
}
.dd-bottom-hint {
  position: absolute;
  z-index: 3;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  color: #60758e;
  background: rgba(255, 255, 255, .68);
  border: 1px solid rgba(255, 255, 255, .9);
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 24px rgba(43, 78, 125, .09);
  border-radius: 999px;
  padding: 9px 15px;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 750;
  pointer-events: none;
}
.dd-bottom-hint b {
  color: #2e4e77;
}
.dd-toast {
  position: absolute;
  z-index: 10;
  left: 50%;
  top: 78px;
  transform: translate(-50%, -10px);
  opacity: 0;
  pointer-events: none;
  border-radius: 12px;
  background: #173451;
  color: #fff;
  padding: 11px 16px;
  font-size: 12px;
  font-weight: 750;
  box-shadow: 0 10px 25px rgba(20, 50, 80, .2);
  transition: .22s;
}
.dd-toast.show {
  opacity: 1;
  transform: translate(-50%, 0);
}
.dd-footer-note {
  margin-top: 12px;
  color: #9aa8ba;
  font-size: 9px;
  line-height: 1.5;
}

/* 教学进度 */
.dd-progress {
  border: 1px solid #e5edf6;
  border-radius: 13px;
  padding: 10px 11px;
  background: rgba(255, 255, 255, .62);
}
.dd-pg-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: #7d8ea5;
  font-size: 9px;
  font-weight: 850;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.dd-pg-head b {
  color: var(--dd-blue);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.dd-pg-track {
  height: 5px;
  margin-top: 6px;
  border-radius: 99px;
  background: #e8eef7;
  overflow: hidden;
}
.dd-pg-fill {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, #2267f2, #18c8df);
  transition: width .3s ease;
}
.dd-pg-list {
  list-style: none;
  margin: 7px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dd-pg-list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #8b9ab0;
  font-size: 10px;
  line-height: 1.5;
}
.dd-pg-list li b {
  color: #526681;
  font-variant-numeric: tabular-nums;
  flex: none;
}
.dd-pg-list li.done {
  color: #17986d;
}
.dd-pg-list li.done b {
  color: #17986d;
}

.dd-err {
  position: absolute;
  z-index: 50;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  background: rgba(61, 11, 22, .94);
  color: #ffdce1;
  border: 1px solid rgba(255, 90, 111, .7);
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12px;
  margin: 0;
}

.dd-root:fullscreen {
  height: 100vh;
  min-height: 0;
  border-radius: 0;
}

@media (max-width: 900px) {
  .dd-layout {
    inset: 76px 12px 12px;
  }
  .dd-panel {
    width: 270px;
    padding: 13px;
  }
  .dd-panel.dd-right {
    width: 205px;
  }
  .dd-brand-title {
    font-size: 13px;
  }
  .dd-topbar {
    left: 12px;
    right: 12px;
    top: 12px;
  }
  .dd-bottom-hint {
    bottom: 12px;
    font-size: 9px;
  }
}
@media (max-width: 650px) {
  .dd-layout {
    inset: 70px 8px 8px;
    overflow: hidden;
  }
  .dd-panel {
    width: min(275px, calc(100vw - 16px));
    max-height: calc(100% - 80px);
  }
  .dd-panel.dd-right {
    display: none;
  }
  .dd-topbar {
    left: 8px;
    right: 8px;
  }
  .dd-live-pill {
    display: none;
  }
  .dd-top-actions {
    gap: 5px;
  }
  .dd-icon-button {
    height: 36px;
    padding: 0 9px;
    font-size: 10px;
  }
  .dd-bottom-hint {
    left: auto;
    right: 8px;
    transform: none;
    bottom: 8px;
  }
}
</style>
