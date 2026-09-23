<script setup lang="ts">
/**
 * VacuSim 扫地机器人 3D 仿真（原生页面版）
 *
 * 由独立单文件页 2.html 移植：
 *   - 3D 房间 / 覆盖率栅格 / 路径规划状态机 / 迷你地图住在 utils/vacusim/engine.ts
 *     （three 走 npm 依赖，无 CDN）；
 *   - 这里只负责「静态外壳 markup + 按需挂载引擎 + 教学进度上报」。
 *
 * 移植要点：原版 HUD/侧栏/底栏是 position:fixed 铺满视口的，这里收进 .vs-root 改 absolute；
 * 会被引擎持续写入的节点（覆盖率、电量、传感器读数、日志行）不绑 Vue，交给引擎写。
 */
import { VACUSIM_KNOWLEDGE, createVacuSim, type Lang } from '~/utils/vacusim/engine'
import { reportCorrectRate } from '~/utils/embed-report'
import { pickText, type LocalizedText } from '~/utils/localized'

const APP_ID = 'robot/vacusim'

const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'vacusim')!)
const { locale } = useI18n()
const lang = computed<Lang>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: LocalizedText) => pickText(o, lang.value)

const rootEl = ref<HTMLElement | null>(null)
const errorMsg = ref('')
let handle: ReturnType<typeof createVacuSim> | null = null

/* ---------- 教学进度（上报用） ---------- */
const modesUsed = ref<Set<string>>(new Set())
const coverage = ref(0)
const dockedOnce = ref(false)
const vizUsed = ref<Set<string>>(new Set())

const COVERAGE_GOAL = 90

const tasks = computed(() => [
  {
    key: 'modes',
    label: { zh: '三种清洁模式各跑一次', en: 'Run each of the three cleaning modes' } as LocalizedText,
    done: modesUsed.value.size,
    total: 3,
    weight: 0.25
  },
  {
    key: 'coverage',
    label: { zh: `覆盖率做到 ${COVERAGE_GOAL}%`, en: `Reach ${COVERAGE_GOAL}% coverage` } as LocalizedText,
    done: Math.min(COVERAGE_GOAL, Math.floor(coverage.value)),
    total: COVERAGE_GOAL,
    weight: 0.3
  },
  {
    key: 'dock',
    label: { zh: '跑一次「返回充电」并充满', en: 'Return to dock and finish charging' } as LocalizedText,
    done: dockedOnce.value ? 1 : 0,
    total: 1,
    weight: 0.2
  },
  {
    key: 'viz',
    label: { zh: '打开 LiDAR 射线与跟随相机', en: 'Turn on LiDAR rays and follow camera' } as LocalizedText,
    done: vizUsed.value.size,
    total: 2,
    weight: 0.25
  }
])

const rate = computed(() => tasks.value.reduce((acc, t) => acc + t.weight * Math.min(1, t.done / t.total), 0))
const finished = computed(() => rate.value >= 0.999)

function onTask(task: string) {
  if (task.startsWith('mode:')) modesUsed.value = new Set(modesUsed.value).add(task.slice(5))
  else if (task === 'docked') dockedOnce.value = true
  else if (task === 'rays' || task === 'follow') vizUsed.value = new Set(vizUsed.value).add(task)
}

/** 上报契约：parent.postMessage({ type:'correct_rate', rate, ... })，详见 utils/embed-report.ts */
watch([rate, finished], () => {
  reportCorrectRate({
    app: APP_ID,
    rate: rate.value,
    finished: finished.value,
    locale: locale.value,
    extra: {
      coverage: Math.round(coverage.value * 10) / 10,
      modesUsed: [...modesUsed.value],
      docked: dockedOnce.value,
      visualizations: [...vizUsed.value]
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
    handle = createVacuSim(root, {
      getLocale: () => lang.value,
      onTask,
      onStat: (stats) => {
        coverage.value = stats.coverage
        if (stats.mode === 'dock') dockedOnce.value = dockedOnce.value || stats.battery >= 99.5
      }
    })
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(mount)
onBeforeUnmount(unmount)

/* ---------- 传感器行 / 模式按钮的静态元数据 ---------- */
const sensorRows = [
  { id: 'lidar', icon: '📡', name: { zh: 'LiDAR（前向）', en: 'LiDAR (front)' } as LocalizedText },
  { id: 'bump', icon: '🛡️', name: { zh: '碰撞条', en: 'Bumper' } as LocalizedText },
  { id: 'cliffL', icon: '⬅️', name: { zh: '悬崖探头（左）', en: 'Cliff L' } as LocalizedText },
  { id: 'cliffR', icon: '➡️', name: { zh: '悬崖探头（右）', en: 'Cliff R' } as LocalizedText }
]

const modes = [
  { id: 'auto', label: { zh: '自动', en: 'Auto' } as LocalizedText },
  { id: 'spot', label: { zh: '定点', en: 'Spot' } as LocalizedText },
  { id: 'edge', label: { zh: '沿边', en: 'Edge' } as LocalizedText }
]
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div
      ref="rootEl"
      class="vs-root"
    >
      <div
        id="vs-stage"
        class="stage"
      >
        <canvas id="vs-canvas" />
        <p class="hint">
          {{ pick({ zh: '拖拽旋转 · 滚轮缩放 · 点底部知识卡看扫地机器人的原理', en: 'Drag to orbit · Scroll to zoom · Click a knowledge card to learn how robot vacuums work' }) }}
        </p>
      </div>

      <!-- 顶部 HUD -->
      <div
        id="vs-hud"
        class="panel hud"
      >
        <div class="brand">
          <b>Vacu<span>Sim</span></b>
          <small>{{ pick({ zh: '扫地机器人 3D 仿真', en: 'Robot Vacuum 3D Simulation' }) }}</small>
        </div>
        <div class="hud-block">
          <div class="k">
            {{ pick({ zh: '模式', en: 'Mode' }) }}
          </div>
          <div
            id="vs-hud-mode"
            class="v"
          >
            Auto
          </div>
        </div>
        <div class="hud-block">
          <div class="k">
            {{ pick({ zh: '覆盖率', en: 'Coverage' }) }}
          </div>
          <div
            id="vs-hud-cov"
            class="v"
          >
            0%
          </div>
        </div>
        <div class="hud-block">
          <div class="k">
            {{ pick({ zh: '剩余灰尘', en: 'Dust Left' }) }}
          </div>
          <div
            id="vs-hud-dust"
            class="v"
          >
            0
          </div>
        </div>
        <div class="hud-block">
          <div class="k">
            {{ pick({ zh: '运行时长', en: 'Runtime' }) }}
          </div>
          <div
            id="vs-hud-time"
            class="v"
          >
            0:00
          </div>
        </div>
        <div
          class="hud-block"
          style="min-width:150px"
        >
          <div class="k">
            {{ pick({ zh: '电量', en: 'Battery' }) }}
          </div>
          <div
            id="vs-hud-batt"
            class="v"
          >
            100%
          </div>
          <div class="batt-wrap">
            <div
              id="vs-batt-bar"
              class="batt-bar"
            />
          </div>
        </div>
        <div class="hud-actions">
          <button
            id="vs-btn-play"
            class="active"
            type="button"
          >
            ⏸ {{ pick({ zh: '暂停', en: 'Pause' }) }}
          </button>
        </div>
      </div>

      <!-- 左侧 -->
      <div
        id="vs-side-left"
        class="panel side-left"
      >
        <div class="side-title">
          {{ pick({ zh: '清洁模式', en: 'Cleaning Mode' }) }}
        </div>
        <div class="mode-btns">
          <button
            v-for="m in modes"
            :id="`vs-m-${m.id}`"
            :key="m.id"
            type="button"
            :class="{ active: m.id === 'auto' }"
          >
            {{ pick(m.label) }}
          </button>
        </div>

        <div class="side-title">
          {{ pick({ zh: '机身传感器', en: 'On-board Sensors' }) }}
        </div>
        <div class="sensors">
          <div
            v-for="s in sensorRows"
            :key="s.id"
            class="sensor"
          >
            <div class="ic">
              {{ s.icon }}
            </div>
            <div class="meta">
              <div class="nm">
                {{ pick(s.name) }}
              </div>
              <div
                :id="`vs-sv-${s.id}`"
                class="vv"
              >
                —
              </div>
            </div>
            <div
              :id="`vs-ss-${s.id}`"
              class="st"
            />
          </div>
        </div>

        <div class="map-wrap">
          <div class="side-title">
            {{ pick({ zh: '覆盖率地图', en: 'Coverage Map' }) }}
          </div>
          <canvas id="vs-mini-map" />
          <div class="map-legend">
            <span><i style="background:#1f6b46" />{{ pick({ zh: '已清扫', en: 'Cleaned' }) }}</span>
            <span><i style="background:#2a3340" />{{ pick({ zh: '未清扫', en: 'Dirty' }) }}</span>
            <span><i style="background:#55606e" />{{ pick({ zh: '家具', en: 'Furniture' }) }}</span>
            <span><i style="background:#ff8c42" />{{ pick({ zh: '悬崖', en: 'Cliff' }) }}</span>
            <span><i style="background:#ff5470" />{{ pick({ zh: '机器人', en: 'Robot' }) }}</span>
          </div>
        </div>
      </div>

      <!-- 右侧 -->
      <div
        id="vs-side-right"
        class="side-right"
      >
        <div class="panel detail">
          <div class="side-title">
            {{ pick({ zh: '覆盖率与电量曲线', en: 'Coverage & Battery History' }) }}
          </div>
          <canvas id="vs-big-chart" />
          <div class="stats">
            <div class="stat-box">
              <div class="l">
                {{ pick({ zh: '里程', en: 'Distance' }) }}
              </div><div
                id="vs-s-dist"
                class="n"
              >
                0 m
              </div>
            </div>
            <div class="stat-box">
              <div class="l">
                {{ pick({ zh: '速度', en: 'Speed' }) }}
              </div><div
                id="vs-s-spd"
                class="n"
              >
                0 m/s
              </div>
            </div>
            <div class="stat-box">
              <div class="l">
                {{ pick({ zh: '转向次数', en: 'Turns' }) }}
              </div><div
                id="vs-s-turn"
                class="n"
              >
                0
              </div>
            </div>
          </div>

          <!-- 教学进度（同时决定给宿主的 rate） -->
          <div class="progress">
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

        <div
          id="vs-alerts"
          class="panel alerts"
        >
          <div class="side-title">
            {{ pick({ zh: '事件日志', en: 'Event Log' }) }}
          </div>
          <div id="vs-alert-log" />
        </div>
      </div>

      <!-- 底部 -->
      <div
        id="vs-bottom"
        class="panel bottom"
      >
        <div class="grp">
          <span class="lab">{{ pick({ zh: '速度', en: 'Speed' }) }}</span>
          <input
            id="vs-speed"
            type="range"
            min="1"
            max="12"
            value="5"
          >
          <span id="vs-speed-val">5×</span>
        </div>
        <div class="ksep" />
        <div class="grp">
          <button
            id="vs-btn-follow"
            type="button"
          >
            🎥 {{ pick({ zh: '跟随相机', en: 'Follow Cam' }) }}
          </button>
          <button
            id="vs-btn-rays"
            type="button"
          >
            📡 {{ pick({ zh: 'LiDAR 射线', en: 'LiDAR Rays' }) }}
          </button>
          <button
            id="vs-btn-dock"
            type="button"
          >
            🔌 {{ pick({ zh: '返回充电', en: 'Return to Dock' }) }}
          </button>
        </div>
        <div class="ksep" />
        <div class="grp">
          <button
            id="vs-btn-reset"
            type="button"
          >
            ↺ {{ pick({ zh: '重置地图', en: 'Reset Map' }) }}
          </button>
          <button
            id="vs-btn-dirt"
            type="button"
          >
            + {{ pick({ zh: '撒灰尘', en: 'Add Dirt' }) }}
          </button>
          <button
            id="vs-btn-charge"
            type="button"
          >
            ⚡ {{ pick({ zh: '充电', en: 'Recharge' }) }}
          </button>
        </div>
        <div class="ksep" />
        <div class="grp">
          <span class="lab">{{ pick({ zh: '知识卡', en: 'Knowledge' }) }}</span>
          <button
            v-for="k in VACUSIM_KNOWLEDGE"
            :key="k.id"
            type="button"
            class="kbtn"
            :data-k="k.id"
            :title="pick(k.label)"
          >
            {{ k.icon }}
          </button>
        </div>
      </div>

      <!-- 知识弹窗 -->
      <div id="vs-info-modal">
        <div class="modal">
          <div class="mh">
            <div
              id="vs-mi-icon"
              class="mic"
            >
              📡
            </div>
            <div>
              <h2 id="vs-mi-name">
                —
              </h2>
              <div
                id="vs-mi-sub"
                class="ms"
              >
                —
              </div>
            </div>
            <div
              id="vs-mi-close"
              class="mclose"
            >
              ✕
            </div>
          </div>
          <div class="mb">
            <div class="mrow">
              <div class="ml">
                {{ pick({ zh: '总览', en: 'Overview' }) }}
              </div>
              <div
                id="vs-mi-desc"
                class="mv"
              />
            </div>
            <div class="mrow">
              <div class="ml">
                {{ pick({ zh: '工作原理', en: 'How it works' }) }}
              </div>
              <div
                id="vs-mi-principle"
                class="mv"
              />
            </div>
            <div class="mrow">
              <div class="ml">
                {{ pick({ zh: '关键参数', en: 'Key facts' }) }}
              </div>
              <div
                id="vs-mi-tags"
                class="mtags"
              />
            </div>
          </div>
        </div>
      </div>

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
/* 原样式是整页全局写法，这里收进 .vs-root，并把 position:fixed 改成 absolute */
.vs-root {
  --vs-bg:#070b12; --vs-panel:rgba(15,21,33,0.84); --vs-border:rgba(120,160,220,0.18);
  --vs-text:#e6edf6; --vs-muted:#8aa0bd; --vs-accent:#36d3ff;
  --vs-good:#39e6a0; --vs-warn:#ffcc4d; --vs-alarm:#ff5470;

  position:relative; width:100%; height:min(88vh,880px); min-height:560px;
  overflow:hidden; border-radius:16px; background:var(--vs-bg); color:var(--vs-text);
  font-size:13px; -webkit-font-smoothing:antialiased;
}
.vs-root :deep(*), .vs-root { box-sizing:border-box; }
.vs-root :deep(button){ font:inherit; cursor:pointer; color:var(--vs-text); background:rgba(54,211,255,0.10);
  border:1px solid var(--vs-border); padding:7px 12px; border-radius:8px; font-size:12px; transition:.15s; }
.vs-root :deep(button:hover){ background:rgba(54,211,255,0.22); border-color:var(--vs-accent); }
.vs-root :deep(button.active){ background:var(--vs-accent); color:#04121a; border-color:var(--vs-accent); font-weight:600; }
.vs-root :deep(input[type=range]){ accent-color:var(--vs-accent); width:110px; }
.panel { background:var(--vs-panel); backdrop-filter:blur(10px); border:1px solid var(--vs-border);
  border-radius:12px; box-shadow:0 8px 30px rgba(0,0,0,0.45); }

.stage { position:absolute; inset:0; z-index:0; }
.stage :deep(canvas){ display:block; width:100%; height:100%; }
.hint { position:absolute; left:50%; top:96px; transform:translateX(-50%); z-index:8; margin:0;
  color:var(--vs-muted); font-size:11px; background:rgba(8,12,20,0.6); padding:4px 12px;
  border-radius:20px; border:1px solid var(--vs-border); white-space:nowrap; }

/* HUD */
.hud { position:absolute; top:12px; left:12px; right:12px; z-index:10; display:flex; gap:12px;
  align-items:stretch; padding:10px 14px; flex-wrap:wrap; }
.hud .brand { display:flex; flex-direction:column; justify-content:center; min-width:200px; }
.hud .brand b { font-size:16px; letter-spacing:.5px; color:#fff; }
.hud .brand b span { color:var(--vs-accent); }
.hud .brand small { color:var(--vs-muted); font-size:11px; }
.hud-block { display:flex; flex-direction:column; justify-content:center; padding:0 14px;
  border-left:1px solid var(--vs-border); min-width:104px; }
.hud-block .k { color:var(--vs-muted); font-size:10px; text-transform:uppercase; letter-spacing:.6px; }
.hud-block .v { font-size:18px; font-weight:600; color:#fff; font-variant-numeric:tabular-nums; }
.hud-actions { margin-left:auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.batt-wrap { width:100%; height:7px; background:rgba(255,255,255,0.1); border-radius:4px; margin-top:5px; overflow:hidden; }
.batt-bar { height:100%; width:100%; background:linear-gradient(90deg,#39e6a0,#9be86a); transition:width .2s, background .2s; }

/* 左侧 */
.side-left { position:absolute; left:12px; top:118px; bottom:68px; width:288px; z-index:10;
  display:flex; flex-direction:column; padding:10px; gap:9px; overflow:hidden; }
.side-title { font-size:11px; text-transform:uppercase; letter-spacing:.8px; color:var(--vs-muted); padding:2px 4px; }
.mode-btns { display:flex; gap:6px; }
.mode-btns :deep(button){ flex:1; }
.sensors { display:flex; flex-direction:column; gap:7px; }
.sensor { display:flex; align-items:center; gap:9px; background:rgba(255,255,255,0.03);
  border:1px solid var(--vs-border); border-radius:9px; padding:7px 9px; }
.sensor .ic { font-size:16px; width:20px; text-align:center; }
.sensor .meta { flex:1; min-width:0; }
.sensor .nm { font-size:11px; color:var(--vs-muted); }
.sensor .vv { font-size:14px; font-weight:700; font-variant-numeric:tabular-nums; }
.sensor .st { width:9px; height:9px; border-radius:50%; background:var(--vs-good); box-shadow:0 0 8px currentColor; }
.map-wrap { margin-top:auto; }
.map-wrap canvas { width:100%; height:170px; display:block; border-radius:8px; background:rgba(0,0,0,0.3); border:1px solid var(--vs-border); }
.map-legend { display:flex; gap:10px; flex-wrap:wrap; font-size:10px; color:var(--vs-muted); margin-top:5px; padding:0 4px; }
.map-legend i { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:3px; vertical-align:middle; }

/* 右侧 */
.side-right { position:absolute; right:12px; top:118px; width:330px; z-index:10; display:flex; flex-direction:column; gap:12px; }
.detail { padding:12px; }
.detail #vs-big-chart { width:100%; height:140px; display:block; border-radius:8px; background:rgba(0,0,0,0.25); }
.stats { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:10px; }
.stat-box { background:rgba(255,255,255,0.03); border:1px solid var(--vs-border); border-radius:8px; padding:8px 6px; text-align:center; }
.stat-box .l { font-size:9px; color:var(--vs-muted); text-transform:uppercase; letter-spacing:.4px; }
.stat-box .n { font-size:15px; font-weight:700; font-variant-numeric:tabular-nums; margin-top:2px; }
.alerts { padding:10px 12px; max-height:190px; display:flex; flex-direction:column; }
#vs-alert-log { overflow-y:auto; display:flex; flex-direction:column; gap:5px; margin-top:4px; }
#vs-alert-log::-webkit-scrollbar { width:6px; }
#vs-alert-log::-webkit-scrollbar-thumb { background:rgba(120,160,220,0.25); border-radius:3px; }
.vs-root :deep(.alert){ font-size:11px; padding:5px 8px; border-radius:6px; border-left:3px solid var(--vs-muted);
  background:rgba(255,255,255,0.03); display:flex; gap:8px; align-items:baseline; }
.vs-root :deep(.alert .t){ color:var(--vs-muted); font-variant-numeric:tabular-nums; flex:none; }
.vs-root :deep(.alert.warn){ border-left-color:var(--vs-warn); }
.vs-root :deep(.alert.alarm){ border-left-color:var(--vs-alarm); background:rgba(255,84,112,0.08); }
.vs-root :deep(.alert.good){ border-left-color:var(--vs-good); }

/* 进度 */
.progress { border-top:1px solid var(--vs-border); margin-top:10px; padding-top:8px; }
.pg-head { display:flex; align-items:baseline; justify-content:space-between;
  color:var(--vs-muted); font-size:10px; letter-spacing:.8px; text-transform:uppercase; }
.pg-head b { color:var(--vs-accent); font-size:14px; font-variant-numeric:tabular-nums; }
.pg-track { height:6px; margin-top:6px; border-radius:99px; background:rgba(120,160,220,0.16); overflow:hidden; }
.pg-fill { display:block; height:100%; border-radius:99px;
  background:linear-gradient(90deg,var(--vs-accent),var(--vs-good)); transition:width .3s ease; }
.pg-list { list-style:none; margin:7px 0 0; padding:0; display:flex; flex-direction:column; gap:3px; }
.pg-list li { display:flex; justify-content:space-between; gap:8px; color:var(--vs-muted); font-size:10.5px; line-height:1.5; }
.pg-list li b { color:#fff; font-variant-numeric:tabular-nums; flex:none; }
.pg-list li.done { color:var(--vs-good); }
.pg-list li.done b { color:var(--vs-good); }

/* 底部 */
.bottom { position:absolute; left:312px; right:354px; bottom:12px; z-index:10; padding:8px 12px;
  display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
.bottom .grp { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.bottom .lab { font-size:10px; color:var(--vs-muted); text-transform:uppercase; letter-spacing:.6px; }
#vs-speed-val { color:var(--vs-accent); font-weight:600; min-width:42px; display:inline-block; text-align:right; }
.ksep { width:1px; height:26px; background:var(--vs-border); margin:0 2px; }
.kbtn { display:inline-flex; align-items:center; justify-content:center; padding:6px 9px; font-size:12px; }

/* 弹窗 */
#vs-info-modal { position:absolute; inset:0; z-index:40; display:none; align-items:center; justify-content:center;
  background:rgba(3,6,12,0.62); backdrop-filter:blur(3px); }
.vs-root :deep(.modal){ width:460px; max-width:92%; max-height:86%; overflow-y:auto; border-radius:16px;
  background:linear-gradient(180deg,#121a28,#0c121d); border:1px solid var(--vs-border); box-shadow:0 20px 60px rgba(0,0,0,0.6); }
.vs-root :deep(.modal .mh){ padding:16px 18px; display:flex; gap:14px; align-items:center;
  border-bottom:1px solid var(--vs-border); background:rgba(54,211,255,0.06); }
.vs-root :deep(.modal .mh .mic){ font-size:30px; }
.vs-root :deep(.modal .mh h2){ font-size:18px; margin:0; }
.vs-root :deep(.modal .mh .ms){ color:var(--vs-muted); font-size:11px; margin-top:2px; }
.vs-root :deep(.modal .mclose){ margin-left:auto; cursor:pointer; font-size:20px; color:var(--vs-muted); line-height:1; padding:4px 8px; border-radius:8px; }
.vs-root :deep(.modal .mclose:hover){ background:rgba(255,255,255,0.08); color:#fff; }
.vs-root :deep(.modal .mb){ padding:16px 18px; }
.vs-root :deep(.modal .mrow){ margin-bottom:14px; }
.vs-root :deep(.modal .ml){ font-size:10px; text-transform:uppercase; letter-spacing:.7px; color:var(--vs-accent); margin-bottom:4px; }
.vs-root :deep(.modal .mv){ font-size:13px; line-height:1.6; color:#dbe6f2; }
.vs-root :deep(.modal .mtags){ display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
.vs-root :deep(.modal .tag){ background:rgba(255,255,255,0.05); border:1px solid var(--vs-border); border-radius:20px;
  padding:4px 11px; font-size:11px; color:var(--vs-muted); }
.vs-root :deep(.modal .tag b){ color:#fff; }
.err { position:absolute; z-index:50; left:50%; bottom:16px; transform:translateX(-50%);
  background:rgba(61,11,22,.94); color:#ffdce1; border:1px solid rgba(255,90,111,.7);
  padding:8px 12px; border-radius:10px; font-size:12px; margin:0; }

@media (max-width:1280px) {
  .side-right { display:none; }
  .bottom { right:12px; }
}
@media (max-width:900px) {
  .side-left { width:240px; top:150px; }
  .bottom { left:12px; }
}
</style>
