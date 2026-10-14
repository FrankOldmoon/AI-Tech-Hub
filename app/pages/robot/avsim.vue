<script setup lang="ts">
/**
 * AutoDrive 智能驾驶 3D 仿真（原生页面版）
 *
 * 由独立单文件页（SmartTown AV · 3D Autonomous Driving Sim）移植，参考 robot/vacusim 的页面模式：
 *   - 小镇路网 / 交通流 / EGO 规划 / LiDAR 点云 / 检测框 / 迷你地图住在 utils/avsim/engine.ts
 *     （three 走 npm 依赖，无 CDN）；
 *   - 这里只负责「静态外壳 markup + 按需挂载引擎 + 教学进度上报」。
 *
 * 移植要点：原版 HUD/侧栏/底栏是 position:fixed 铺满视口的，这里收进 .av-root 改 absolute；
 * 会被引擎持续写入的节点（速度/模式/信号/风险/电量/感知列表/警示横幅）不绑 Vue，交给引擎写。
 * 教学完成条件（5 项）：4 种视角、3 种天气、6 个感知层、红灯停车+障碍急刹、点选目标。
 */
import { createAvSim, type AvView, type AvWeather, type Lang } from '~/utils/avsim/engine'
import { reportCorrectRate } from '~/utils/embed-report'
import { pickText, type LocalizedText } from '~/utils/localized'

const APP_ID = 'robot/avsim'

const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'avsim')!)
const { locale } = useI18n()
const lang = computed<Lang>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: LocalizedText) => pickText(o, lang.value)

const rootEl = ref<HTMLElement | null>(null)
const errorMsg = ref('')
let handle: ReturnType<typeof createAvSim> | null = null

/* ---------- 教学进度（上报用） ---------- */
const viewsUsed = ref<Set<string>>(new Set())
const weatherUsed = ref<Set<string>>(new Set())
const sensorsUsed = ref<Set<string>>(new Set())
const redStopDone = ref(false)
const brakeDone = ref(false)
const inspected = ref(false)

const tasks = computed(() => [
  {
    key: 'views',
    label: { zh: '切换全部 4 种视角', en: 'Try all four camera views' } as LocalizedText,
    done: viewsUsed.value.size,
    total: 4,
    weight: 0.2
  },
  {
    key: 'weather',
    label: { zh: '体验全部 3 种天气', en: 'Try all three weather presets' } as LocalizedText,
    done: weatherUsed.value.size,
    total: 3,
    weight: 0.15
  },
  {
    key: 'sensors',
    label: { zh: '打开全部 6 个感知可视化层', en: 'Enable all six perception layers' } as LocalizedText,
    done: sensorsUsed.value.size,
    total: 6,
    weight: 0.2
  },
  {
    key: 'events',
    label: { zh: '亲历红灯停车与障碍急刹', en: 'Experience a red-light stop and an obstacle brake' } as LocalizedText,
    done: (redStopDone.value ? 1 : 0) + (brakeDone.value ? 1 : 0),
    total: 2,
    weight: 0.25
  },
  {
    key: 'inspect',
    label: { zh: '点选目标查看信息卡', en: 'Click a target to open its info card' } as LocalizedText,
    done: inspected.value ? 1 : 0,
    total: 1,
    weight: 0.2
  }
])

const rate = computed(() => tasks.value.reduce((acc, t) => acc + t.weight * Math.min(1, t.done / t.total), 0))
const finished = computed(() => rate.value >= 0.999)

function onTask(task: string) {
  if (task.startsWith('view:')) viewsUsed.value = new Set(viewsUsed.value).add(task.slice(5))
  else if (task.startsWith('weather:')) weatherUsed.value = new Set(weatherUsed.value).add(task.slice(8))
  else if (task.startsWith('sensor:')) sensorsUsed.value = new Set(sensorsUsed.value).add(task.slice(7))
  else if (task === 'red-stop') redStopDone.value = true
  else if (task === 'brake') brakeDone.value = true
  else if (task === 'inspect') inspected.value = true
}

/** 上报契约：parent.postMessage({ type:'correct_rate', rate, ... })，详见 utils/embed-report.ts */
watch([rate, finished], () => {
  reportCorrectRate({
    app: APP_ID,
    rate: rate.value,
    finished: finished.value,
    locale: locale.value,
    extra: {
      viewsUsed: [...viewsUsed.value],
      weatherUsed: [...weatherUsed.value],
      sensorsUsed: [...sensorsUsed.value],
      redStop: redStopDone.value,
      obstacleBrake: brakeDone.value,
      inspected: inspected.value
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
    handle = createAvSim(root, {
      getLocale: () => lang.value,
      onTask
    })
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  }
}

/* ---------- 全屏（右上角按钮）----------
   全屏只作用在页面根容器上：渲染尺寸由引擎里的 ResizeObserver 自己跟，不需要额外通知。 */
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
    // iframe 宿主没给 allow="fullscreen" 时会走到这里：提示一下就够，不打断页面
    console.warn('[robot/avsim] requestFullscreen failed', err)
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
  // 离开页面别把浏览器留在全屏里
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  unmount()
})

/* ---------- 控件静态元数据（按钮文字走 pick，开关状态归引擎管） ---------- */
const sensorChips: { id: string, label: LocalizedText }[] = [
  { id: 'lidar', label: { zh: 'LiDAR', en: 'LiDAR' } },
  { id: 'camera', label: { zh: '相机', en: 'Camera' } },
  { id: 'radar', label: { zh: '雷达', en: 'Radar' } },
  { id: 'boxes', label: { zh: '检测框', en: 'BBox' } },
  { id: 'labels', label: { zh: '标签', en: 'Labels' } },
  { id: 'traj', label: { zh: '轨迹', en: 'Path' } }
]

const viewChips: { id: AvView, label: LocalizedText }[] = [
  { id: 'chase', label: { zh: '追踪', en: 'Chase' } },
  { id: 'orbit', label: { zh: '环绕', en: 'Orbit' } },
  { id: 'top', label: { zh: '俯视', en: 'Top' } },
  { id: 'cockpit', label: { zh: '舱内', en: 'Cabin' } }
]

const weatherChips: { id: AvWeather, label: LocalizedText }[] = [
  { id: 'day', label: { zh: '白天', en: 'Day' } },
  { id: 'night', label: { zh: '夜晚', en: 'Night' } },
  { id: 'rain', label: { zh: '雨天', en: 'Rain' } }
]
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div
      ref="rootEl"
      class="av-root"
    >
      <div
        id="av-stage"
        class="stage"
      >
        <canvas id="av-canvas" />
      </div>
      <div
        id="av-alert-frame"
        class="alert-frame"
      />
      <div
        id="av-labels"
        class="labels"
      />
      <div
        id="av-warn"
        class="warn"
      />

      <!-- 左上 HUD -->
      <div
        id="av-hud"
        class="panel hud"
      >
        <button
          class="fsbtn"
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
        <div class="veh">
          VEHICLE · EGO-01
        </div>
        <div class="big">
          <span id="av-speed-val">0</span><span class="unit"> km/h</span>
        </div>
        <div class="row">
          <span class="k">{{ pick({ zh: '驾驶模式', en: 'Drive Mode' }) }}</span>
          <span
            id="av-mode-val"
            class="v"
          >AUTO</span>
        </div>
        <div class="row">
          <span class="k">{{ pick({ zh: '感知目标', en: 'Objects' }) }}</span>
          <span
            id="av-det-val"
            class="v"
          >0</span>
        </div>
        <div class="row">
          <span class="k">{{ pick({ zh: '推理延迟', en: 'Latency' }) }}</span>
          <span
            id="av-lat-val"
            class="v"
          >18 ms</span>
        </div>
        <div class="row">
          <span class="k">{{ pick({ zh: '前方信号', en: 'Signal' }) }}</span>
          <span
            id="av-sig-val"
            class="v"
            style="color:var(--green)"
          >—</span>
        </div>
        <div class="row">
          <span class="k">{{ pick({ zh: '风险', en: 'Risk' }) }}</span>
          <span
            id="av-risk-val"
            class="v"
            style="color:var(--green)"
          >—</span>
        </div>
        <div class="row">
          <span class="k">{{ pick({ zh: '电量', en: 'Battery' }) }}</span>
          <span
            id="av-bat-val"
            class="v"
          >92%</span>
        </div>
        <div class="bar">
          <i id="av-bat-bar" />
        </div>
        <div class="row gps">
          <span class="k">GNSS</span>
          <span
            id="av-gps-val"
            class="v"
          >—</span>
        </div>
      </div>

      <!-- 右侧：感知列表 + 教学进度 -->
      <div class="side-right">
        <div
          id="av-detect"
          class="panel detect"
        >
          <div class="ttl">
            <span>{{ pick({ zh: '感知目标', en: 'DETECTED OBJECTS' }) }}</span>
            <span id="av-det-count">0</span>
          </div>
          <div id="av-det-list">
            <div class="empty">
              {{ pick({ zh: '探测范围内没有目标…', en: 'No objects in range…' }) }}
            </div>
          </div>
        </div>

        <!-- 教学进度（同时决定给宿主的 rate） -->
        <div class="panel progress">
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

      <!-- 目标信息卡 -->
      <div
        id="av-infocard"
        class="panel infocard"
      >
        <div
          id="av-ic-close"
          class="close"
        >
          ✕
        </div>
        <div class="hd">
          <span
            id="av-ic-sw"
            class="sw"
          />
          <span id="av-ic-name">—</span>
        </div>
        <div class="bd">
          <div class="li">
            <span class="k">{{ pick({ zh: '类型', en: 'Type' }) }}</span>
            <span
              id="av-ic-type"
              class="v"
            >—</span>
          </div>
          <div class="li">
            <span class="k">{{ pick({ zh: '距离', en: 'Distance' }) }}</span>
            <span
              id="av-ic-dist"
              class="v"
            >—</span>
          </div>
          <div class="li">
            <span class="k">{{ pick({ zh: '相对速度', en: 'Rel. Speed' }) }}</span>
            <span
              id="av-ic-spd"
              class="v"
            >—</span>
          </div>
          <div class="li">
            <span class="k">{{ pick({ zh: '置信度', en: 'Confidence' }) }}</span>
            <span
              id="av-ic-conf"
              class="v"
            >—</span>
          </div>
          <div class="li">
            <span class="k">{{ pick({ zh: '状态', en: 'Heading' }) }}</span>
            <span
              id="av-ic-dir"
              class="v"
            >—</span>
          </div>
        </div>
        <div
          id="av-ic-focus"
          class="focus"
        >
          ◎ {{ pick({ zh: '相机对准该目标', en: 'Focus camera on target' }) }}
        </div>
      </div>

      <!-- 左下迷你地图 -->
      <div
        id="av-minimap"
        class="panel minimap"
      >
        <canvas id="av-mm" />
        <div class="cap">
          {{ pick({ zh: '局部俯视 · 雷达', en: 'LOCAL TOP-DOWN · RADAR' }) }}
        </div>
      </div>

      <!-- 右下控制台 -->
      <div
        id="av-controls"
        class="panel controls"
      >
        <div class="grp">
          <div class="ttl">
            {{ pick({ zh: '感知层', en: 'Sensors' }) }}
          </div>
          <div class="btnrow">
            <button
              v-for="s in sensorChips"
              :key="s.id"
              class="chip"
              type="button"
              :data-av-s="s.id"
            >
              {{ pick(s.label) }}
            </button>
          </div>
        </div>
        <div class="grp">
          <div class="ttl">
            {{ pick({ zh: '视角', en: 'View' }) }}
          </div>
          <div class="btnrow">
            <button
              v-for="v in viewChips"
              :key="v.id"
              class="chip"
              :class="{ on: v.id === 'chase' }"
              type="button"
              :data-av-v="v.id"
            >
              {{ pick(v.label) }}
            </button>
          </div>
        </div>
        <div class="grp">
          <div class="ttl">
            {{ pick({ zh: '天气', en: 'Weather' }) }}
          </div>
          <div class="btnrow">
            <button
              v-for="w in weatherChips"
              :key="w.id"
              class="chip"
              :class="{ on: w.id === 'night' }"
              type="button"
              :data-av-w="w.id"
            >
              {{ pick(w.label) }}
            </button>
          </div>
        </div>
        <div class="grp">
          <div class="ttl">
            {{ pick({ zh: '巡航速度', en: 'Speed' }) }}
          </div>
          <div class="slider">
            <input
              id="av-speed-range"
              type="range"
              min="0"
              max="80"
              value="34"
            >
            <span
              id="av-speed-show"
              class="val"
            >34</span>
          </div>
        </div>
        <div class="grp">
          <div class="btnrow">
            <button
              id="av-btn-pause"
              class="chip"
              type="button"
            >
              ⏸ {{ pick({ zh: '暂停', en: 'Pause' }) }}
            </button>
            <button
              id="av-btn-reset"
              class="chip"
              type="button"
            >
              ↺ {{ pick({ zh: '重置', en: 'Reset' }) }}
            </button>
          </div>
        </div>
      </div>

      <!-- 底部提示 -->
      <p class="hint">
        {{ pick({ zh: '点选房屋 / 车辆 / 行人 / 红绿灯查看详情 · 拖拽空白处环绕视角 · 点空白处退出聚焦', en: 'Click any house / vehicle / pedestrian / signal to inspect · drag empty space to orbit · click empty space to exit focus' }) }}
      </p>

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
/* 原样式是整页全局写法，这里收进 .av-root，并把 position:fixed 改成 absolute */
.av-root {
  --bg:#070b14; --panel:rgba(13,20,36,.72); --line:rgba(120,180,255,.18);
  --cyan:#39e7ff; --green:#3dffa6; --yellow:#ffd23f; --orange:#ff8a3d; --red:#ff4d6d;
  --txt:#dbe7ff; --dim:#8aa0c8;

  position:relative; width:100%; height:min(88vh,880px); min-height:560px;
  overflow:hidden; border-radius:16px; background:var(--bg); color:var(--txt);
  font-size:13px; -webkit-font-smoothing:antialiased;
}
.av-root :deep(*), .av-root { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
.av-root button { font-family:inherit; }
.panel { background:var(--panel); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
  border:1px solid var(--line); border-radius:14px; box-shadow:0 8px 30px rgba(0,0,0,.45); }

.stage { position:absolute; inset:0; z-index:0; }
.stage :deep(canvas), #av-canvas { display:block; width:100%; height:100%; }

/* 警示层 */
.alert-frame { position:absolute; inset:0; z-index:14; pointer-events:none;
  box-shadow:inset 0 0 120px 36px rgba(255,77,109,.55); opacity:0; transition:opacity .1s; }
.labels { position:absolute; inset:0; z-index:15; pointer-events:none; overflow:hidden; }
#av-warn { position:absolute; top:56px; left:50%; transform:translateX(-50%); z-index:30; padding:6px 18px;
  border-radius:20px; font-size:13px; font-weight:700; letter-spacing:1px; opacity:0; transition:.15s; pointer-events:none; }
#av-warn.on { opacity:1; }
#av-warn.danger { background:rgba(255,77,109,.2); border:1px solid var(--red); color:#ff8aa0; box-shadow:0 0 18px rgba(255,77,109,.4); }
#av-warn.caution { background:rgba(255,210,63,.18); border:1px solid var(--yellow); color:#ffe08a; }
.av-root :deep(.lab) { position:absolute; transform:translate(-50%,-100%); font-size:10px; line-height:1.2;
  padding:2px 5px; border-radius:5px; background:rgba(7,11,20,.78); border:1px solid var(--line);
  white-space:nowrap; font-variant-numeric:tabular-nums; }
.av-root :deep(.lab b) { font-weight:700; }

/* HUD */
#av-hud { position:absolute; top:12px; left:12px; z-index:20; padding:12px 14px; width:214px; }
#av-hud .veh { font-size:10px; color:var(--dim); letter-spacing:.6px; }
#av-hud .big { font-size:30px; font-weight:700; color:var(--cyan); line-height:1; margin:2px 0; }
#av-hud .unit { font-size:12px; color:var(--dim); font-weight:400; }
#av-hud .row { display:flex; justify-content:space-between; align-items:baseline; margin:5px 0 0; font-size:12px; }
#av-hud .row .k { color:var(--dim); }
#av-hud .row .v { font-variant-numeric:tabular-nums; font-weight:600; }
#av-hud .row.gps .v { font-size:11px; }
#av-hud .bar { height:5px; border-radius:4px; background:rgba(255,255,255,.08); overflow:hidden; margin-top:4px; }
#av-hud .bar i { display:block; height:100%; background:linear-gradient(90deg,var(--cyan),var(--green)); width:92%; }
.fsbtn { position:absolute; top:8px; right:8px; display:inline-flex; align-items:center; justify-content:center;
  width:30px; height:30px; padding:0; cursor:pointer; color:var(--dim);
  background:rgba(255,255,255,.05); border:1px solid var(--line); border-radius:8px; transition:.15s; }
.fsbtn:hover { color:#fff; background:rgba(120,180,255,.14); }
.fsbtn svg { width:14px; height:14px; }
.av-root:fullscreen { height:100vh; min-height:0; border-radius:0; }
.av-root:-webkit-full-screen { height:100vh; min-height:0; border-radius:0; }

/* 感知列表 + 教学进度（右侧栏） */
.side-right { position:absolute; top:12px; right:12px; z-index:20; width:246px; max-height:calc(100% - 24px);
  display:flex; flex-direction:column; gap:10px; overflow:hidden; }
#av-detect { position:relative; padding:10px 12px; flex:0 1 auto; overflow:auto; }
#av-detect .ttl { font-size:11px; color:var(--dim); text-transform:uppercase; letter-spacing:.6px;
  margin-bottom:8px; display:flex; justify-content:space-between; }
.av-root :deep(.ditem) { display:flex; align-items:center; gap:8px; padding:5px 6px; border-radius:8px;
  font-size:12px; cursor:pointer; transition:.12s; }
.av-root :deep(.ditem:hover) { background:rgba(120,180,255,.12); }
.av-root :deep(.ditem .sw) { width:8px; height:8px; border-radius:2px; flex:0 0 auto; }
.av-root :deep(.ditem .nm) { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.av-root :deep(.ditem .ds) { color:var(--dim); font-variant-numeric:tabular-nums; }
.av-root :deep(.empty) { font-size:12px; color:var(--dim); padding:6px 2px; }

/* 教学进度 */
.progress { position:relative; padding:10px 12px; }
.pg-head { display:flex; align-items:baseline; justify-content:space-between;
  color:var(--dim); font-size:10px; letter-spacing:.8px; text-transform:uppercase; }
.pg-head b { color:var(--cyan); font-size:14px; font-variant-numeric:tabular-nums; }
.pg-track { height:6px; margin-top:6px; border-radius:99px; background:rgba(120,160,220,.16); overflow:hidden; }
.pg-fill { display:block; height:100%; border-radius:99px;
  background:linear-gradient(90deg,var(--cyan),var(--green)); transition:width .3s ease; }
.pg-list { list-style:none; margin:7px 0 0; padding:0; display:flex; flex-direction:column; gap:3px; }
.pg-list li { display:flex; justify-content:space-between; gap:8px; color:var(--dim); font-size:10.5px; line-height:1.5; }
.pg-list li b { color:#fff; font-variant-numeric:tabular-nums; flex:none; }
.pg-list li.done { color:var(--green); }
.pg-list li.done b { color:var(--green); }

/* 信息卡 */
#av-infocard { position:absolute; left:12px; top:268px; z-index:25; width:238px; overflow:hidden;
  transform:translateY(-8px); opacity:0; pointer-events:none; transition:.2s; }
#av-infocard.show { transform:translateY(0); opacity:1; pointer-events:auto; }
#av-infocard .hd { padding:10px 12px; font-weight:600; font-size:13px; display:flex; align-items:center; gap:8px;
  border-bottom:1px solid var(--line); }
#av-infocard .hd .sw { width:10px; height:10px; border-radius:3px; }
#av-infocard .bd { padding:10px 12px; }
#av-infocard .li { display:flex; justify-content:space-between; font-size:12px; margin:4px 0; }
#av-infocard .li .k { color:var(--dim); }
#av-infocard .li .v { font-weight:600; font-variant-numeric:tabular-nums; }
#av-infocard .close { position:absolute; top:8px; right:10px; cursor:pointer; color:var(--dim); font-size:14px; }
#av-infocard .close:hover { color:#fff; }
#av-infocard .focus { margin:0 12px 10px; font-size:11px; color:var(--cyan); cursor:pointer; }
#av-infocard .focus:hover { text-decoration:underline; }

/* 迷你地图 */
#av-minimap { position:absolute; left:12px; bottom:12px; z-index:20; padding:8px; }
#av-minimap canvas { width:170px; height:170px; border-radius:8px; display:block; }
#av-minimap .cap { font-size:10px; color:var(--dim); text-align:center; margin-top:4px; letter-spacing:.5px; }

/* 控制台 */
#av-controls { position:absolute; right:12px; bottom:12px; z-index:20; padding:12px; width:250px; }
#av-controls .grp { margin-bottom:10px; }
#av-controls .grp:last-child { margin-bottom:0; }
#av-controls .ttl { font-size:11px; color:var(--dim); text-transform:uppercase; letter-spacing:.6px; margin-bottom:6px; }
.btnrow { display:flex; flex-wrap:wrap; gap:6px; }
.chip { flex:1 1 auto; min-width:56px; cursor:pointer; color:var(--txt);
  background:rgba(255,255,255,.05); border:1px solid var(--line); border-radius:9px;
  padding:7px 6px; font-size:12px; transition:.15s; }
.chip:hover { background:rgba(120,180,255,.14); }
.chip.on { background:rgba(57,231,255,.18); border-color:var(--cyan); color:#fff; box-shadow:0 0 12px rgba(57,231,255,.25); }
.slider { display:flex; align-items:center; gap:8px; }
.slider input[type=range] { flex:1; accent-color:var(--cyan); }
.slider .val { font-size:12px; width:40px; text-align:right; font-variant-numeric:tabular-nums; }

/* 底部提示 */
.hint { position:absolute; bottom:12px; left:50%; transform:translateX(-50%); z-index:18; font-size:11px;
  color:var(--dim); background:rgba(7,11,20,.55); padding:6px 12px; border-radius:20px;
  border:1px solid var(--line); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
  white-space:nowrap; margin:0; }

.av-root :deep(::-webkit-scrollbar) { width:6px; height:6px; }
.av-root :deep(::-webkit-scrollbar-thumb) { background:rgba(120,180,255,.25); border-radius:3px; }

.err { position:absolute; z-index:50; left:50%; bottom:16px; transform:translateX(-50%);
  background:rgba(61,11,22,.94); color:#ffdce1; border:1px solid rgba(255,90,111,.7);
  padding:8px 12px; border-radius:10px; font-size:12px; margin:0; }

@media (max-width:1100px) {
  #av-minimap { display:none; }
}
@media (max-width:820px) {
  .hint, #av-detect { display:none; }
  #av-controls { width:212px; }
}
</style>
