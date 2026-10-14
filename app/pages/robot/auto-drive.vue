<script setup lang="ts">
/**
 * AutoDrive Lab 智能驾驶实验室（原生页面版）
 *
 * 由独立单文件页（AutoDrive Lab · Interactive Autonomous Driving Simulator）移植，
 * 参考 robot/vacusim / robot/avsim 的页面模式：
 *   - 白天城市路网 / 可点选传感器硬件 / 行车记录仪 / 障碍工坊 / 手动驾驶
 *     住在 utils/autodrive/engine.ts（three 走 npm 依赖，无 CDN）；
 *   - 这里只负责「三栏外壳 markup + 按需挂载引擎 + 教学进度上报」。
 *
 * 教学完成条件（6 项，权重合计 1）：
 *   1. 体验全部 4 个教学场景（巡航/红灯/行人/障碍）
 *   2. 切换全部 4 个可视化层（相机/LiDAR/雷达/检测框）
 *   3. 切换全部 3 种视角（环绕/俯视/驾驶员）
 *   4. 放置自定义障碍并触发一次安全刹停
 *   5. 手动模式行驶满 15 m
 *   6. 探查全部 4 个车载传感器（相机/LiDAR/雷达/计算单元）
 */
import { createAutoDrive, type Lang, type ScenarioKey } from '~/utils/autodrive/engine'
import { reportCorrectRate } from '~/utils/embed-report'
import { pickText, type LocalizedText } from '~/utils/localized'

const APP_ID = 'robot/auto-drive'

const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'auto-drive')!)
const { locale } = useI18n()
const lang = computed<Lang>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: LocalizedText) => pickText(o, lang.value)

const rootEl = ref<HTMLElement | null>(null)
const errorMsg = ref('')
let handle: ReturnType<typeof createAutoDrive> | null = null

/* ---------- 教学进度（上报用） ---------- */
const scenariosUsed = ref<Set<string>>(new Set())
const layersUsed = ref<Set<string>>(new Set())
const viewsUsed = ref<Set<string>>(new Set())
const placed = ref(false)
const safeStop = ref(false)
const manualDriven = ref(false)
const sensorsInspected = ref<Set<string>>(new Set())

const ONBOARD_SENSORS = ['camera', 'lidar', 'radar', 'compute']

const tasks = computed(() => [
  {
    key: 'scenario',
    label: { zh: '体验全部 4 个教学场景', en: 'Try all four teaching scenarios' } as LocalizedText,
    done: scenariosUsed.value.size,
    total: 4,
    weight: 0.2
  },
  {
    key: 'layers',
    label: { zh: '切换全部 4 个可视化层', en: 'Toggle all four visualization layers' } as LocalizedText,
    done: layersUsed.value.size,
    total: 4,
    weight: 0.15
  },
  {
    key: 'views',
    label: { zh: '切换全部 3 种视角', en: 'Try all three camera views' } as LocalizedText,
    done: viewsUsed.value.size,
    total: 3,
    weight: 0.15
  },
  {
    key: 'workshop',
    label: { zh: '放置障碍并触发一次安全刹停', en: 'Place an obstacle and trigger a safe stop' } as LocalizedText,
    done: (placed.value ? 1 : 0) + (safeStop.value ? 1 : 0),
    total: 2,
    weight: 0.25
  },
  {
    key: 'manual',
    label: { zh: '手动模式行驶满 15 m', en: 'Drive 15 m in manual mode' } as LocalizedText,
    done: manualDriven.value ? 1 : 0,
    total: 1,
    weight: 0.15
  },
  {
    key: 'inspect',
    label: { zh: '探查全部 4 个车载传感器', en: 'Inspect all four onboard sensors' } as LocalizedText,
    done: sensorsInspected.value.size,
    total: 4,
    weight: 0.1
  }
])

const rate = computed(() => tasks.value.reduce((acc, t) => acc + t.weight * Math.min(1, t.done / t.total), 0))
const finished = computed(() => rate.value >= 0.999)

function onTask(task: string) {
  if (task.startsWith('scenario:')) scenariosUsed.value = new Set(scenariosUsed.value).add(task.slice(9))
  else if (task.startsWith('layer:')) layersUsed.value = new Set(layersUsed.value).add(task.slice(6))
  else if (task.startsWith('view:')) viewsUsed.value = new Set(viewsUsed.value).add(task.slice(5))
  else if (task === 'place') placed.value = true
  else if (task === 'safe-stop') safeStop.value = true
  else if (task === 'manual-drive') manualDriven.value = true
  else if (task.startsWith('inspect:')) {
    const id = task.slice(8)
    if (ONBOARD_SENSORS.includes(id)) sensorsInspected.value = new Set(sensorsInspected.value).add(id)
  }
}

/** 上报契约：parent.postMessage({ type:'correct_rate', rate, ... })，详见 utils/embed-report.ts */
watch([rate, finished], () => {
  reportCorrectRate({
    app: APP_ID,
    rate: rate.value,
    finished: finished.value,
    locale: locale.value,
    extra: {
      scenariosUsed: [...scenariosUsed.value],
      layersUsed: [...layersUsed.value],
      viewsUsed: [...viewsUsed.value],
      placed: placed.value,
      safeStop: safeStop.value,
      manualDriven: manualDriven.value,
      sensorsInspected: [...sensorsInspected.value]
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
    handle = createAutoDrive(root, {
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
    console.warn('[robot/auto-drive] requestFullscreen failed', err)
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

/* ---------- 静态元数据 ---------- */
const scenarioRows: { id: ScenarioKey, icon: string, label: LocalizedText, desc: LocalizedText }[] = [
  { id: 'cruise', icon: '⌁', label: { zh: '城市巡航', en: 'City Cruise' }, desc: { zh: '沿车道行驶，自由探索。', en: 'Follow the lane and explore.' } },
  { id: 'signal', icon: '🚦', label: { zh: '红灯识别', en: 'Traffic Light' }, desc: { zh: '识别红灯并停在停止线。', en: 'Recognize a red signal and stop.' } },
  { id: 'pedestrian', icon: '♙', label: { zh: '行人过街', en: 'Pedestrian Crossing' }, desc: { zh: '检测行人并停车让行。', en: 'Detect a person and yield.' } },
  { id: 'hazard', icon: '△', label: { zh: '道路障碍', en: 'Road Hazard' }, desc: { zh: '识别障碍并安全制动。', en: 'Identify an obstacle and brake.' } }
]

const obstacleTools: { id: string, label: LocalizedText }[] = [
  { id: 'cone', label: { zh: '＋ 锥桶', en: '＋ Traffic Cone' } },
  { id: 'crate', label: { zh: '＋ 货箱', en: '＋ Cargo Box' } },
  { id: 'barrier', label: { zh: '＋ 护栏', en: '＋ Road Barrier' } },
  { id: 'tire', label: { zh: '＋ 轮胎', en: '＋ Tire' } }
]

const sensorCards: { id: string, icon: string, label: LocalizedText, desc: LocalizedText }[] = [
  { id: 'camera', icon: '◉', label: { zh: '摄像头', en: 'Camera' }, desc: { zh: '色彩 · 车道 · 标志', en: 'Color · Lanes · Signs' } },
  { id: 'lidar', icon: '◎', label: { zh: 'LiDAR', en: 'LiDAR' }, desc: { zh: '3D 测距点云', en: '3D distance points' } },
  { id: 'radar', icon: ')))', label: { zh: '毫米波雷达', en: 'Radar' }, desc: { zh: '距离 · 相对速度', en: 'Range · Relative speed' } },
  { id: 'compute', icon: '▦', label: { zh: 'AI 计算单元', en: 'AI Computer' }, desc: { zh: '融合 · 规划', en: 'Fusion · Planning' } }
]

const layerRows: { id: string, label: LocalizedText, desc: LocalizedText }[] = [
  { id: 'camera', label: { zh: '相机视场', en: 'Camera Field of View' }, desc: { zh: '前向视觉锥', en: 'Forward visual cone' } },
  { id: 'lidar', label: { zh: 'LiDAR 点云扫描', en: 'LiDAR Point Scan' }, desc: { zh: '测距采样射线', en: 'Distance sampling rays' } },
  { id: 'radar', label: { zh: '雷达波弧', en: 'Radar Waves' }, desc: { zh: '目标距离弧线', en: 'Object range arcs' } },
  { id: 'boxes', label: { zh: 'AI 检测框', en: 'AI Detection Boxes' }, desc: { zh: '已检测目标', en: 'Detected objects' } }
]

const manualKeys: { id: string, glyph: string, label: LocalizedText, brake?: boolean }[] = [
  { id: 'forward', glyph: '▲', label: { zh: '油门', en: 'ACCEL' } },
  { id: 'left', glyph: '◀', label: { zh: '左转', en: 'LEFT' } },
  { id: 'brake', glyph: '▼', label: { zh: '刹车/倒车', en: 'BRAKE' }, brake: true },
  { id: 'right', glyph: '▶', label: { zh: '右转', en: 'RIGHT' } }
]
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div
      ref="rootEl"
      class="ad-root"
    >
      <!-- 左栏：驾驶控制 / 场景 / 障碍工坊 -->
      <aside class="panel side left">
        <div class="eyebrow">
          {{ pick({ zh: '学习任务 01', en: 'Learning Mission 01' }) }}
        </div>
        <div class="intro">
          <h2>{{ pick({ zh: '自动驾驶车如何看世界？', en: 'How Does a Self-Driving Car See?' }) }}</h2>
          <p>{{ pick({ zh: '在多路城市路网中探索交通、障碍与防碰撞驾驶。', en: 'Explore a busy multi-road city with traffic, obstacles, and collision-aware driving.' }) }}</p>
          <div class="tags">
            <span class="tag">LEVEL 01</span>
            <span class="tag">3D</span>
            <span class="tag">AI + ROBOTICS</span>
          </div>
        </div>

        <section class="grp">
          <div class="head">
            <strong>{{ pick({ zh: '车辆控制', en: 'Vehicle Controls' }) }}</strong>
            <span class="micro">EGO</span>
          </div>
          <div class="btnrow two">
            <button
              id="ad-auto-mode"
              class="btn active"
              type="button"
            >
              🤖 {{ pick({ zh: '自动', en: 'Auto' }) }}
            </button>
            <button
              id="ad-manual-mode"
              class="btn"
              type="button"
            >
              🎮 {{ pick({ zh: '手动', en: 'Manual' }) }}
            </button>
          </div>
          <div class="btnrow two">
            <button
              id="ad-start"
              class="btn primary"
              type="button"
            >
              ▶ {{ pick({ zh: '开始行驶', en: 'Start Drive' }) }}
            </button>
            <button
              id="ad-reset"
              class="btn"
              type="button"
              :title="pick({ zh: '重置仿真', en: 'Reset simulation' })"
            >
              ↺
            </button>
          </div>
          <div
            id="ad-manual-controls"
            class="manual-wrap"
            style="display:none"
          >
            <div class="manual-caption">
              <strong>{{ pick({ zh: '手动驾驶', en: 'Manual Driving' }) }}</strong>
              <span>WASD / ↑↓←→</span>
            </div>
            <div class="manual-pad">
              <span />
              <button
                v-for="k in manualKeys"
                :key="k.id"
                class="manual-key"
                :class="{ 'brake-key': k.brake }"
                type="button"
                :data-ad-key="k.id"
              >
                {{ k.glyph }}<small>{{ pick(k.label) }}</small>
              </button>
            </div>
            <p class="manual-help">
              {{ pick({ zh: '先点「启用手动驾驶」。长按 ▲ 加速 · ▼ 刹车/倒车 · A/D 或 ←/→ 转向 · 空格急停。', en: 'Press Enable Driving first. Hold ▲ to accelerate · Hold ▼ to brake / reverse · A / D or ← / → to steer · Space for a full stop.' }) }}
            </p>
          </div>
          <div class="range-wrap">
            <div class="range-meta">
              <span>{{ pick({ zh: '目标车速', en: 'Target Speed' }) }}</span>
              <b><span id="ad-speed-target">40</span> km/h</b>
            </div>
            <input
              id="ad-speed-slider"
              class="range"
              type="range"
              min="20"
              max="60"
              value="40"
              step="5"
            >
          </div>
        </section>

        <section class="grp">
          <div class="head">
            <strong>{{ pick({ zh: '选择场景', en: 'Choose a Scenario' }) }}</strong>
            <span class="micro">{{ pick({ zh: '4 个任务', en: '4 MISSIONS' }) }}</span>
          </div>
          <div class="scenarios">
            <button
              v-for="s in scenarioRows"
              :key="s.id"
              class="scenario-btn"
              :class="{ active: s.id === 'cruise' }"
              type="button"
              :data-ad-scenario="s.id"
            >
              <span class="ic">{{ s.icon }}</span>
              <span>
                <strong>{{ pick(s.label) }}</strong>
                <span class="desc">{{ pick(s.desc) }}</span>
              </span>
            </button>
          </div>
        </section>

        <section class="grp">
          <div class="head">
            <strong>{{ pick({ zh: '障碍工坊', en: 'Obstacle Workshop' }) }}</strong>
            <span class="micro">{{ pick({ zh: '放置 / 移动', en: 'PLACE / MOVE' }) }}</span>
          </div>
          <div class="obstacle-tools">
            <button
              v-for="o in obstacleTools"
              :key="o.id"
              class="btn small"
              type="button"
              :data-ad-place="o.id"
            >
              {{ pick(o.label) }}
            </button>
            <button
              id="ad-remove-obstacle"
              class="btn small danger"
              type="button"
            >
              {{ pick({ zh: '移除选中', en: 'Remove Selected' }) }}
            </button>
            <button
              id="ad-clear-obstacles"
              class="btn small"
              type="button"
            >
              {{ pick({ zh: '全部清空', en: 'Clear All' }) }}
            </button>
          </div>
          <p
            id="ad-obstacle-hint"
            class="tool-hint"
          />
        </section>
      </aside>

      <!-- 中间：3D 场景 -->
      <section class="scene-panel">
        <div id="ad-scene" />
        <div class="scene-top">
          <div class="scene-heading">
            LIVE SIMULATION
            <span id="ad-scene-mode">—</span>
          </div>
          <div class="chips">
            <span class="chip"><b>●</b> 3D</span>
          </div>
        </div>
        <div class="view-btns">
          <button
            class="view-btn active"
            type="button"
            data-ad-view="orbit"
            :title="pick({ zh: '环绕视角', en: 'Orbit view' })"
          >
            ◉
          </button>
          <button
            class="view-btn"
            type="button"
            data-ad-view="top"
            :title="pick({ zh: '俯视视角', en: 'Top view' })"
          >
            ⌗
          </button>
          <button
            class="view-btn"
            type="button"
            data-ad-view="driver"
            :title="pick({ zh: '驾驶员视角', en: 'Driver view' })"
          >
            ◍
          </button>
          <button
            class="view-btn"
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
        <div
          id="ad-toast"
          class="toast"
        />
        <div class="scene-bottom">
          <div class="mission">
            <span class="micro">{{ pick({ zh: '自主决策', en: 'AUTONOMOUS DECISION' }) }}</span>
            <div
              id="ad-decision-main"
              class="mission-main"
            >
              —
            </div>
            <div
              id="ad-decision-sub"
              class="mission-sub"
            >
              —
            </div>
          </div>
        </div>
      </section>

      <!-- 右栏：行车记录仪 / 传感器 / 图层 / 详情 / 管线 / 遥测 / 进度 -->
      <aside class="panel side right">
        <section class="sec">
          <div class="head">
            <strong>{{ pick({ zh: '实时相机画面', en: 'Live Camera Feed' }) }}</strong>
            <span class="micro">CAM 01 · LIVE</span>
          </div>
          <div class="dash-frame">
            <div id="ad-dashcam" />
            <canvas id="ad-dash-overlay" />
            <span class="dash-stamp">FRONT CAMERA / 30 FPS SIM</span>
            <span class="dash-rec"><i /> LIVE</span>
          </div>
          <div class="dash-meta">
            <span id="ad-camera-objects">—</span>
            <span id="ad-camera-range">—</span>
          </div>
        </section>

        <section class="sec">
          <div class="eyebrow">
            {{ pick({ zh: '车辆智能', en: 'Vehicle Intelligence' }) }}
          </div>
          <div class="head title">
            <strong>{{ pick({ zh: '传感器套件', en: 'Sensor Suite' }) }}</strong>
          </div>
          <div class="sensor-grid">
            <button
              v-for="c in sensorCards"
              :key="c.id"
              class="sensor-card"
              :class="{ selected: c.id === 'camera' }"
              type="button"
              :data-ad-sensor="c.id"
            >
              <span class="sic">{{ c.icon }}</span>
              <b>{{ pick(c.label) }}</b>
              <small>{{ pick(c.desc) }}</small>
            </button>
          </div>
        </section>

        <section class="sec">
          <div class="head">
            <strong>{{ pick({ zh: '可视化图层', en: 'Visualization Layers' }) }}</strong>
            <span class="micro">ON / OFF</span>
          </div>
          <div
            v-for="l in layerRows"
            :key="l.id"
            class="toggle-row"
          >
            <div class="toggle-copy">
              <strong>{{ pick(l.label) }}</strong>
              <small>{{ pick(l.desc) }}</small>
            </div>
            <button
              class="switch on"
              type="button"
              :data-ad-layer="l.id"
              :aria-label="pick(l.label)"
            />
          </div>
          <button
            id="ad-signal-btn"
            class="btn full small"
            type="button"
          >
            ↻ {{ pick({ zh: '切换信号灯：', en: 'Switch Traffic Light: ' }) }} <span id="ad-signal-label">—</span>
          </button>
        </section>

        <section class="sec ad-optional">
          <div class="head">
            <strong>{{ pick({ zh: '组件详情', en: 'Component Explorer' }) }}</strong>
            <span class="micro">{{ pick({ zh: '点击查看', en: 'CLICK TO INSPECT' }) }}</span>
          </div>
          <div class="detail">
            <div class="detail-top">
              <div
                id="ad-detail-title"
                class="detail-title"
              >
                —
              </div>
              <span
                id="ad-detail-type"
                class="detail-type"
              >—</span>
            </div>
            <p id="ad-detail-desc" />
            <div class="spec">
              <span>{{ pick({ zh: '主要输出', en: 'Primary Output' }) }}</span>
              <b id="ad-detail-output">—</b>
            </div>
            <div class="spec">
              <span>{{ pick({ zh: '优势', en: 'Strength' }) }}</span>
              <b id="ad-detail-strength">—</b>
            </div>
            <div class="spec">
              <span>{{ pick({ zh: '局限', en: 'Limitation' }) }}</span>
              <b id="ad-detail-limit">—</b>
            </div>
          </div>
        </section>

        <section class="sec ad-optional">
          <div class="head">
            <strong>{{ pick({ zh: '自动驾驶管线', en: 'Autonomy Pipeline' }) }}</strong>
            <span class="micro">AI LOOP</span>
          </div>
          <div class="pipeline">
            <div
              id="ad-pipe-sense"
              class="pipe-node active"
            >
              <strong>{{ pick({ zh: '感知', en: 'Sense' }) }}</strong>
              <small>{{ pick({ zh: '采集', en: 'Collect' }) }}</small>
            </div>
            <span class="pipe-arrow">›</span>
            <div
              id="ad-pipe-plan"
              class="pipe-node"
            >
              <strong>{{ pick({ zh: '规划', en: 'Plan' }) }}</strong>
              <small>{{ pick({ zh: '预测', en: 'Predict' }) }}</small>
            </div>
            <span class="pipe-arrow">›</span>
            <div
              id="ad-pipe-act"
              class="pipe-node"
            >
              <strong>{{ pick({ zh: '控制', en: 'Act' }) }}</strong>
              <small>{{ pick({ zh: '执行', en: 'Control' }) }}</small>
            </div>
          </div>
        </section>

        <section class="sec">
          <div class="head">
            <strong>{{ pick({ zh: '实时遥测', en: 'Live Telemetry' }) }}</strong>
            <span class="micro">{{ pick({ zh: '仿真数据', en: 'SIMULATED' }) }}</span>
          </div>
          <div class="metrics">
            <div>
              <div class="metric-line">
                <span>{{ pick({ zh: '车速', en: 'Vehicle Speed' }) }}</span>
                <b><span id="ad-speed-now">0</span> km/h</b>
              </div>
              <div class="metric-bar">
                <span id="ad-speed-bar" />
              </div>
            </div>
            <div>
              <div class="metric-line">
                <span>{{ pick({ zh: '行驶里程', en: 'Route Distance' }) }}</span>
                <b><span id="ad-distance-now">0.0</span> m</b>
              </div>
              <div class="metric-bar">
                <span id="ad-distance-bar" />
              </div>
            </div>
            <div>
              <div class="metric-line">
                <span>{{ pick({ zh: '检测目标数', en: 'Objects Detected' }) }}</span>
                <b id="ad-object-count">00</b>
              </div>
              <div class="metric-bar">
                <span id="ad-object-bar" />
              </div>
            </div>
            <div>
              <div class="metric-line">
                <span>{{ pick({ zh: '系统置信度', en: 'System Confidence' }) }}</span>
                <b id="ad-confidence-now">—</b>
              </div>
              <div class="metric-bar">
                <span id="ad-confidence-bar" />
              </div>
            </div>
          </div>
        </section>

        <!-- 教学进度（同时决定给宿主的 rate） -->
        <section class="sec progress">
          <div class="head">
            <strong>{{ pick({ zh: '教学进度', en: 'Lesson Progress' }) }}</strong>
            <b class="pg-pct">{{ Math.round(rate * 100) }}%</b>
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
        </section>
      </aside>

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
/* 原样式是整页全局写法，这里收进 .ad-root（三栏 grid），配色沿用站点深色玻璃风 */
.ad-root {
  --line:rgba(120,160,220,.2); --panel:rgba(13,20,33,.9); --txt:#dbe7f5; --dim:#8aa0bd;
  --cyan:#43e1e8; --green:#50e3a4; --amber:#ffca68; --red:#ff667d;

  position:relative; width:100%; height:min(88vh,900px); min-height:600px;
  display:grid; grid-template-columns:258px minmax(0,1fr) 306px; gap:10px; padding:10px;
  overflow:hidden; border-radius:16px; color:var(--txt); font-size:12px;
  background:radial-gradient(ellipse at 48% -10%,#16304a 0%,#091725 48%,#060d16 100%);
  -webkit-font-smoothing:antialiased;
}
.ad-root :deep(*), .ad-root { box-sizing:border-box; }
.ad-root button { font-family:inherit; cursor:pointer; }
.av-fs, .ad-root:fullscreen { height:100vh; min-height:0; border-radius:0; grid-template-columns:258px minmax(0,1fr) 306px; }
.ad-root:-webkit-full-screen { height:100vh; min-height:0; border-radius:0; }

.panel { min-height:0; overflow:auto; background:var(--panel); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
  border:1px solid var(--line); border-radius:14px; scrollbar-width:thin; scrollbar-color:rgba(120,160,220,.3) transparent; }
.side { padding:14px 13px; display:flex; flex-direction:column; gap:14px; }
.side::-webkit-scrollbar { width:6px; }
.side::-webkit-scrollbar-thumb { background:rgba(120,160,220,.28); border-radius:3px; }

.eyebrow { font-size:9px; font-weight:800; letter-spacing:.2em; color:var(--dim); text-transform:uppercase; }
.grp, .sec { display:flex; flex-direction:column; gap:8px; padding-bottom:13px; border-bottom:1px solid var(--line); }
.grp:last-child, .sec:last-child { border-bottom:0; padding-bottom:0; }
.head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.head.title { margin-top:2px; }
.head strong { font-size:11px; font-weight:750; color:#dcecf9; }
.head .micro { font-size:9px; color:var(--dim); letter-spacing:.08em; text-transform:uppercase; }
.head .pg-pct { color:var(--cyan); font-size:13px; font-variant-numeric:tabular-nums; }

/* 介绍卡 */
.intro { border:1px solid rgba(90,180,200,.25); background:linear-gradient(145deg,rgba(40,80,105,.35),rgba(15,30,45,.5)); border-radius:10px; padding:11px; }
.intro h2 { font-size:15px; line-height:1.25; margin:0 0 6px; color:#eaf6ff; }
.intro p { font-size:10px; line-height:1.55; color:#9fb8cb; margin:0; }
.tags { display:flex; gap:5px; flex-wrap:wrap; margin-top:9px; }
.tag { font-size:9px; padding:4px 7px; border:1px solid rgba(90,180,200,.3); border-radius:6px; color:#a6d9df; background:rgba(30,70,90,.35); }

/* 按钮 */
.btnrow { display:flex; gap:7px; }
.btnrow.two > * { flex:1; }
.btn { border:1px solid rgba(120,170,210,.28); background:rgba(40,70,95,.35); color:var(--txt); border-radius:8px;
  padding:8px 9px; font-size:10px; font-weight:750; transition:all .18s; display:inline-flex; align-items:center; justify-content:center; gap:6px; }
.btn:hover { border-color:rgba(90,200,220,.6); background:rgba(50,90,115,.5); }
.btn.primary { border-color:rgba(70,220,220,.6); background:linear-gradient(135deg,rgba(62,225,212,.85),rgba(79,175,255,.85)); color:#06202b; }
.btn.active { color:#65f3d3; border-color:rgba(49,168,160,.7); background:rgba(16,58,59,.5); }
.btn.full { width:100%; }
.btn.small { padding:7px 8px; font-size:9px; }
.btn.danger { border-color:rgba(160,80,110,.5); color:#ff9daf; background:rgba(80,35,55,.35); }
.btn:disabled { opacity:.55; cursor:not-allowed; }

/* 速度滑杆 */
.range-wrap { margin-top:2px; }
.range-meta { display:flex; justify-content:space-between; color:var(--dim); font-size:10px; margin-bottom:6px; }
.range-meta b { color:#e3f9ff; font-size:11px; }
.range { appearance:none; -webkit-appearance:none; width:100%; height:4px; border-radius:99px; background:linear-gradient(90deg,#43e1e8,#5da7ff); outline:none; }
.range::-webkit-slider-thumb { appearance:none; -webkit-appearance:none; width:14px; height:14px; border:3px solid #d4ffff; border-radius:50%; background:#1b8c9b; box-shadow:0 0 0 4px rgba(67,225,232,.16); }

/* 手动驾驶 */
.manual-wrap { border:1px solid var(--line); border-radius:10px; padding:9px; background:rgba(20,40,58,.4); }
.manual-caption { display:flex; justify-content:space-between; align-items:center; margin-bottom:7px; gap:6px; }
.manual-caption strong { font-size:10px; }
.manual-caption span { font-size:8px; letter-spacing:.08em; color:var(--dim); }
.manual-pad { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; max-width:210px; margin:0 auto; }
.manual-key { height:42px; border:1px solid rgba(120,170,210,.3); border-radius:8px; background:rgba(40,70,95,.35);
  color:var(--txt); font-size:15px; font-weight:800; touch-action:none; user-select:none; line-height:1.1; }
.manual-key small { display:block; font-size:7px; letter-spacing:.08em; color:var(--dim); margin-top:2px; }
.manual-key.pressed, .manual-key:active { background:rgba(70,210,190,.4); border-color:rgba(114,205,191,.8); }
.manual-key.brake-key { background:rgba(120,60,45,.35); color:#ffb9a3; border-color:rgba(200,110,90,.4); }
.manual-help { font-size:8.5px; line-height:1.5; color:var(--dim); margin:8px 0 0; }

/* 场景列表 */
.scenarios { display:grid; gap:7px; }
.scenario-btn { display:flex; width:100%; gap:9px; text-align:left; align-items:center; padding:9px;
  background:rgba(25,45,65,.5); border:1px solid var(--line); border-radius:9px; color:#d4e7f6; }
.scenario-btn .ic { width:28px; height:28px; flex:0 0 28px; border-radius:8px; background:rgba(45,90,110,.5); color:#57dce1; display:grid; place-items:center; font-size:13px; }
.scenario-btn strong { display:block; font-size:10px; margin-bottom:3px; }
.scenario-btn .desc { font-size:9px; color:var(--dim); }
.scenario-btn.active { border-color:rgba(63,205,210,.7); background:linear-gradient(90deg,rgba(16,52,60,.6),rgba(16,36,54,.6)); box-shadow:inset 3px 0 #43e1e8; }
.scenario-btn.active .ic { background:rgba(26,85,88,.7); color:#a2ffec; }

/* 障碍工坊 */
.obstacle-tools { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
.tool-hint { margin:0; padding:9px; border-radius:8px; background:rgba(30,55,75,.4); border:1px solid var(--line); color:#8ba4bb; font-size:9px; line-height:1.5; }
.tool-hint :deep(b) { color:#7fd8e2; }

/* 场景区 */
.scene-panel { position:relative; overflow:hidden; min-width:0; min-height:0; border-radius:14px;
  border:1px solid var(--line); background:#9fd2f2; }
#ad-scene { position:absolute; inset:0; overflow:hidden; }
#ad-scene :deep(canvas) { display:block; width:100%; height:100%; outline:none; }
.scene-top { position:absolute; left:14px; right:14px; top:12px; display:flex; align-items:flex-start; justify-content:space-between; pointer-events:none; gap:10px; z-index:5; }
.scene-heading { font-size:10px; letter-spacing:.18em; font-weight:800; color:#123246; text-shadow:0 1px 0 rgba(255,255,255,.5); }
.scene-heading span { display:block; color:#2d5470; font-size:9px; font-weight:600; letter-spacing:.08em; margin-top:4px; text-transform:uppercase; }
.chips { display:flex; gap:6px; }
.chip { font-size:9px; color:#b8d2e4; background:rgba(12,32,48,.85); border:1px solid rgba(90,140,170,.4); padding:6px 9px; border-radius:7px; backdrop-filter:blur(5px); }
.chip b { color:#5bf0db; margin-right:4px; }
.view-btns { position:absolute; top:74px; right:12px; display:grid; gap:6px; z-index:6; }
.view-btn { width:34px; height:32px; border:1px solid rgba(120,170,210,.35); border-radius:8px; background:rgba(12,32,48,.88);
  color:#9dc7dc; display:grid; place-items:center; font-size:13px; }
.view-btn svg { width:14px; height:14px; }
.view-btn:hover, .view-btn.active { border-color:#46d9df; color:#61f3e2; background:rgba(18,52,70,.95); }
.toast { position:absolute; left:50%; top:64px; transform:translate(-50%,-8px); opacity:0; pointer-events:none;
  padding:9px 13px; border:1px solid rgba(57,140,161,.8); background:rgba(11,41,57,.92); color:#d9fbff;
  border-radius:9px; font-size:10px; transition:all .2s; z-index:7; white-space:nowrap; }
.toast.show { opacity:1; transform:translate(-50%,0); }
.scene-bottom { position:absolute; left:12px; right:12px; bottom:12px; display:flex; justify-content:flex-end; pointer-events:none; z-index:5; }
.mission { background:rgba(9,26,41,.92); border:1px solid rgba(90,140,170,.4); border-radius:10px; padding:9px 11px; min-width:170px; max-width:60%; backdrop-filter:blur(8px); }
.mission .micro { margin-bottom:5px; display:block; font-size:8px; color:#7e9db1; letter-spacing:.1em; text-transform:uppercase; }
.mission-main { font-size:11px; font-weight:800; color:#edfbff; }
.mission-sub { font-size:9px; color:#83a1b8; margin-top:4px; line-height:1.4; }

/* 行车记录仪 */
.dash-frame { position:relative; aspect-ratio:16/9; min-height:130px; overflow:hidden; border-radius:10px;
  background:#0c2135; border:1px solid var(--line); }
#ad-dashcam { position:absolute; inset:0; }
#ad-dashcam :deep(canvas) { width:100%; height:100%; display:block; }
#ad-dash-overlay { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:2; }
.dash-stamp { position:absolute; left:8px; top:7px; z-index:3; font:700 8px/1.2 ui-monospace,SFMono-Regular,monospace;
  letter-spacing:.08em; color:#fff; background:rgba(19,44,59,.75); border:1px solid rgba(255,255,255,.35); border-radius:4px; padding:4px 6px; }
.dash-rec { position:absolute; right:8px; top:8px; z-index:3; display:flex; gap:5px; align-items:center;
  background:rgba(19,44,59,.75); color:#fff; border-radius:4px; padding:4px 6px; font:700 8px ui-monospace,monospace; }
.dash-rec i { width:6px; height:6px; border-radius:50%; background:#ff5555; box-shadow:0 0 7px #ff5555; }
.dash-meta { display:flex; justify-content:space-between; gap:8px; color:var(--dim); font:700 8.5px ui-monospace,monospace; letter-spacing:.04em; }

/* 传感器卡 */
.sensor-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
.sensor-card { text-align:left; padding:9px 8px; border:1px solid var(--line); border-radius:9px; background:rgba(25,45,65,.45); color:var(--txt); transition:all .15s; }
.sensor-card:hover { border-color:rgba(70,180,200,.6); }
.sensor-card.selected { border-color:rgba(67,217,217,.8); background:linear-gradient(145deg,rgba(16,51,60,.65),rgba(16,36,54,.65)); }
.sic { height:24px; width:26px; display:grid; place-items:center; border-radius:7px; color:#6de8e4; background:rgba(45,90,110,.5); font-size:12px; margin-bottom:7px; }
.sensor-card b { display:block; font-size:10px; margin-bottom:3px; }
.sensor-card small { font-size:9px; color:var(--dim); line-height:1.3; display:block; }

/* 图层开关 */
.toggle-row { display:flex; align-items:center; justify-content:space-between; padding:6px 0; gap:9px; }
.toggle-copy strong { font-size:10px; display:block; margin-bottom:2px; }
.toggle-copy small { font-size:9px; color:var(--dim); }
.switch { width:28px; height:16px; border:1px solid rgba(120,170,210,.35); background:rgba(40,70,95,.5); border-radius:99px;
  display:inline-flex; align-items:center; padding:2px; flex-shrink:0; transition:background .2s; }
.switch:after { content:""; width:10px; height:10px; background:#8ba1af; border-radius:50%; transition:transform .2s; }
.switch.on { background:rgba(22,122,120,.55); border-color:rgba(66,221,213,.7); }
.switch.on:after { background:#dcfffa; transform:translateX(11px); }

/* 详情卡 */
.detail { background:linear-gradient(145deg,rgba(40,80,105,.3),rgba(15,30,45,.5)); border:1px solid var(--line); border-radius:10px; padding:11px; }
.detail-top { display:flex; justify-content:space-between; align-items:center; gap:10px; }
.detail-title { font-size:12px; font-weight:800; }
.detail-type { font-size:8px; letter-spacing:.1em; border-radius:5px; padding:4px 6px; background:rgba(20,60,72,.7); color:#72eee7; }
.detail p { font-size:10px; line-height:1.5; color:#a0b7c9; margin:9px 0; }
.spec { display:grid; grid-template-columns:1fr auto; gap:8px; font-size:9px; padding-top:7px; border-top:1px solid var(--line); margin-top:7px; color:var(--dim); }
.spec b { font-weight:700; color:#d1e8f7; text-align:right; }

/* 管线 */
.pipeline { display:flex; align-items:center; gap:4px; }
.pipe-node { flex:1; min-width:0; text-align:center; padding:8px 4px 7px; background:rgba(30,60,85,.4); border:1px solid var(--line); border-radius:7px; opacity:.6; }
.pipe-node.active { border-color:rgba(56,191,193,.8); background:rgba(18,60,67,.6); opacity:1; }
.pipe-node strong { font-size:9px; display:block; color:#d8f4f8; }
.pipe-node small { display:block; font-size:8px; color:var(--dim); margin-top:3px; }
.pipe-arrow { color:#4b8ba1; font-size:10px; }

/* 遥测 */
.metrics { display:grid; gap:8px; }
.metric-line { display:flex; align-items:center; justify-content:space-between; font-size:10px; color:#86a4b9; }
.metric-line b { font-size:10px; color:#dff8ff; font-variant-numeric:tabular-nums; }
.metric-bar { height:3px; border-radius:5px; background:rgba(120,160,220,.14); margin-top:4px; overflow:hidden; }
.metric-bar span { display:block; height:100%; width:0%; background:linear-gradient(90deg,#34dfc6,#5caeff); border-radius:5px; transition:width .4s; }

/* 教学进度 */
.progress .pg-track { height:6px; border-radius:99px; background:rgba(120,160,220,.16); overflow:hidden; }
.progress .pg-fill { display:block; height:100%; border-radius:99px; background:linear-gradient(90deg,var(--cyan),var(--green)); transition:width .3s ease; }
.pg-list { list-style:none; margin:4px 0 0; padding:0; display:flex; flex-direction:column; gap:3px; }
.pg-list li { display:flex; justify-content:space-between; gap:8px; color:var(--dim); font-size:10px; line-height:1.5; }
.pg-list li b { color:#fff; font-variant-numeric:tabular-nums; flex:none; }
.pg-list li.done { color:var(--green); }
.pg-list li.done b { color:var(--green); }

.err { position:absolute; z-index:50; left:50%; bottom:16px; transform:translateX(-50%);
  background:rgba(61,11,22,.94); color:#ffdce1; border:1px solid rgba(255,90,111,.7);
  padding:8px 12px; border-radius:10px; font-size:12px; margin:0; }

/* 全屏时根容器铺满 */
.ad-root:fullscreen { height:100vh; }
.ad-root:-webkit-full-screen { height:100vh; }

@media (max-width:1360px) {
  .ad-root { grid-template-columns:232px minmax(0,1fr) 286px; }
}
@media (max-width:1180px) {
  .ad-root { grid-template-columns:226px minmax(0,1fr) 276px; }
  .ad-optional { display:none; }
}
@media (max-width:980px) {
  .ad-root { height:auto; max-height:none; overflow:auto; grid-template-columns:1fr; }
  .scene-panel { order:-1; height:52vh; min-height:380px; }
  .panel { overflow:visible; }
}
</style>
