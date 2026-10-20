<script setup lang="ts">
/**
 * DroneSim 无人机飞行仿真（原生页面版）
 *
 * 由独立单文件页（DroneSim · UAV Operations & FPV Simulation）移植，
 * 参考 robot/vacusim / robot/avsim 的页面模式：
 *   - 机场环境 / 可拆解四旋翼 / 飞行控制 / FPV 机载相机住在 utils/dronesim/engine.ts
 *     （three 走 npm 依赖，无 CDN）；
 *   - 这里只负责「静态外壳 markup + 按需挂载引擎 + 教学进度上报」。
 *
 * 移植要点：原版 HUD/侧栏/底栏是 position:fixed 铺满视口的，这里收进 .ds-root 改 absolute；
 * 引擎持续写入的节点（HUD 读数/日志/部件列表/FPV 叠加）不绑 Vue，交给引擎写。
 *
 * 教学完成条件（5 项，权重合计 1）：
 *   1. 完成一次起飞
 *   2. 飞抵 3 个航点环
 *   3. 探查全部 8 类部件（信息卡）
 *   4. 拆下部件并全部装回
 *   5. 完成 RTL 一键返航降落
 */
import { createDroneSim, type Lang } from '~/utils/dronesim/engine'
import { reportCorrectRate } from '~/utils/embed-report'
import { pickText, type LocalizedText } from '~/utils/localized'

const APP_ID = 'robot/drone'

const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'drone')!)
const { locale } = useI18n()
const lang = computed<Lang>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: LocalizedText) => pickText(o, lang.value)

const rootEl = ref<HTMLElement | null>(null)
const errorMsg = ref('')
let handle: ReturnType<typeof createDroneSim> | null = null

/* ---------- 教学进度（上报用） ---------- */
const takenOff = ref(false)
const visitedWp = ref<Set<number>>(new Set())
const inspected = ref<Set<string>>(new Set())
const detached = ref(false)
const reattached = ref(false)
const rtlDone = ref(false)

const WP_GOAL = 3

const tasks = computed(() => [
  {
    key: 'takeoff',
    label: { zh: '完成一次起飞', en: 'Take off once' } as LocalizedText,
    done: takenOff.value ? 1 : 0,
    total: 1,
    weight: 0.2
  },
  {
    key: 'waypoints',
    label: { zh: `飞抵 ${WP_GOAL} 个航点环`, en: `Reach ${WP_GOAL} waypoint rings` } as LocalizedText,
    done: Math.min(WP_GOAL, visitedWp.value.size),
    total: WP_GOAL,
    weight: 0.3
  },
  {
    key: 'inspect',
    label: { zh: '探查全部 8 类部件', en: 'Inspect all eight component types' } as LocalizedText,
    done: inspected.value.size,
    total: 8,
    weight: 0.25
  },
  {
    key: 'workshop',
    label: { zh: '拆下部件并全部装回', en: 'Detach parts and reattach them' } as LocalizedText,
    done: (detached.value ? 1 : 0) + (reattached.value ? 1 : 0),
    total: 2,
    weight: 0.15
  },
  {
    key: 'rtl',
    label: { zh: '完成 RTL 一键返航', en: 'Complete an RTL return-to-launch' } as LocalizedText,
    done: rtlDone.value ? 1 : 0,
    total: 1,
    weight: 0.1
  }
])

const rate = computed(() => tasks.value.reduce((acc, t) => acc + t.weight * Math.min(1, t.done / t.total), 0))
const finished = computed(() => rate.value >= 0.999)

function onTask(task: string) {
  if (task === 'takeoff') takenOff.value = true
  else if (task.startsWith('wp:')) visitedWp.value = new Set(visitedWp.value).add(Number(task.slice(3)))
  else if (task.startsWith('inspect:')) inspected.value = new Set(inspected.value).add(task.slice(8))
  else if (task === 'detach') detached.value = true
  else if (task === 'reattach') reattached.value = true
  else if (task === 'rtl') rtlDone.value = true
}

/** 上报契约：parent.postMessage({ type:'correct_rate', rate, ... })，详见 utils/embed-report.ts */
watch([rate, finished], () => {
  reportCorrectRate({
    app: APP_ID,
    rate: rate.value,
    finished: finished.value,
    locale: locale.value,
    extra: {
      takenOff: takenOff.value,
      waypoints: [...visitedWp.value],
      inspected: [...inspected.value],
      detached: detached.value,
      reattached: reattached.value,
      rtl: rtlDone.value
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
    handle = createDroneSim(root, {
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
    console.warn('[robot/drone] requestFullscreen failed', err)
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
      class="ds-root"
    >
      <div
        id="ds-scene"
        class="stage"
      />

      <p class="hint">
        {{ pick({ zh: 'WASD / 方向键 = 飞行（S/↓ 前进）· Q/E = 偏航 · 空格/Shift = 升降 · 点机身部件可抽出查看', en: 'WASD / Arrows = fly (S/↓ forward) · Q/E = yaw · Space/Shift = up/down · Click a drone part to pull it out & inspect' }) }}
      </p>

      <!-- 右上角全屏按钮：悬浮独立于 HUD/FPV 之上，避免被面板遮挡 -->
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
          stroke-width="2.2"
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
          stroke-width="2.2"
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

      <!-- 顶部 HUD -->
      <div
        id="ds-hud"
        class="panel hud"
      >
        <div class="brand">
          <b>Drone<span>Sim</span></b>
          <small>{{ pick({ zh: '无人机飞行与 FPV 仿真', en: 'UAV Operations & FPV Simulation' }) }}</small>
        </div>
        <div class="hud-block">
          <div class="k">
            {{ pick({ zh: '模式', en: 'Mode' }) }}
          </div>
          <div
            id="ds-mode"
            class="v"
          >
            —
          </div>
        </div>
        <div class="hud-block">
          <div class="k">
            {{ pick({ zh: '高度', en: 'Altitude' }) }}
          </div>
          <div
            id="ds-alt"
            class="v"
          >
            0.0<small>m</small>
          </div>
        </div>
        <div class="hud-block">
          <div class="k">
            {{ pick({ zh: '水平速度', en: 'H-Speed' }) }}
          </div>
          <div
            id="ds-hs"
            class="v"
          >
            0.0<small>m/s</small>
          </div>
        </div>
        <div class="hud-block">
          <div class="k">
            {{ pick({ zh: '垂直速度', en: 'V-Speed' }) }}
          </div>
          <div
            id="ds-vs"
            class="v"
          >
            0.0<small>m/s</small>
          </div>
        </div>
        <div class="hud-block">
          <div class="k">
            {{ pick({ zh: '信号', en: 'Signal' }) }}
          </div>
          <div
            id="ds-sig"
            class="v"
          >
            100<small>%</small>
          </div>
        </div>
        <div class="hud-block batt-block">
          <div class="k">
            {{ pick({ zh: '电量', en: 'Battery' }) }}
          </div>
          <div
            id="ds-batt"
            class="v"
          >
            100<small>%</small>
          </div>
          <div class="batt-wrap">
            <div
              id="ds-batt-bar"
              class="batt-bar"
            />
          </div>
        </div>
        <div class="hud-actions">
          <button
            id="ds-follow"
            type="button"
          >
            🎥 {{ pick({ zh: '第一人称', en: 'FPV View' }) }}
          </button>
          <button
            id="ds-takeoff"
            class="go"
            type="button"
          >
            🛫 {{ pick({ zh: '起飞', en: 'Take Off' }) }}
          </button>
          <button
            id="ds-land"
            class="go"
            type="button"
          >
            🛬 {{ pick({ zh: '降落', en: 'Land' }) }}
          </button>
          <button
            id="ds-rtl"
            class="go"
            type="button"
          >
            🏠 RTL
          </button>
        </div>
      </div>

      <!-- 左栏：部件 + 教学进度 + 日志 -->
      <div
        id="ds-side-left"
        class="panel side-left"
      >
        <div class="side-title">
          {{ pick({ zh: '可拆部件', en: 'Detachable Components' }) }}
          <span
            id="ds-explode"
            class="explode-btn"
          >⤢ {{ pick({ zh: '爆炸视图', en: 'Exploded' }) }}</span>
        </div>
        <div id="ds-comp-btns" />
        <div id="ds-comp-actions">
          <button
            id="ds-detach"
            type="button"
            class="danger"
          >
            {{ pick({ zh: '拆下', en: 'Detach' }) }}
          </button>
          <button
            id="ds-reattach"
            type="button"
          >
            {{ pick({ zh: '全部装回', en: 'Reattach All' }) }}
          </button>
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

        <div class="log-wrap">
          <div class="side-title">
            {{ pick({ zh: '任务日志', en: 'Mission Log' }) }}
          </div>
          <div id="ds-log" />
        </div>
      </div>

      <!-- 右栏：FPV -->
      <div
        id="ds-side-right"
        class="side-right"
      >
        <div
          id="ds-fpv-panel"
          class="panel"
        >
          <div class="cap">
            <span>📡 {{ pick({ zh: 'CAM-1 · 机载云台实时画面', en: 'CAM-1 · LIVE FPV (Onboard Gimbal)' }) }}</span>
            <span id="ds-fpv-res">—</span>
          </div>
          <div id="ds-fpv-wrap">
            <canvas id="ds-fpv" />
            <div id="ds-fpv-hud">
              <div class="rec">
                <span class="dot" />REC
              </div>
              <div class="tag">
                UAV-01
              </div>
              <div class="cross" />
              <div class="tlt">
                <span id="ds-fpv-alt">ALT 0m</span>
                <span id="ds-fpv-spd">0 m/s</span>
                <span id="ds-fpv-bat">100%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部控制 -->
      <div
        id="ds-bottom"
        class="panel bottom"
      >
        <div class="grp">
          <span class="lab">{{ pick({ zh: '油门', en: 'Throttle' }) }}</span>
          <input
            id="ds-speed"
            type="range"
            min="3"
            max="14"
            value="8"
          >
          <span id="ds-speed-val">8</span>
        </div>
        <div class="ksep" />
        <div class="grp">
          <span class="lab">{{ pick({ zh: '飞行', en: 'Fly' }) }}</span>
          <div class="pad">
            <span />
            <button
              type="button"
              data-ds-k="f"
            >
              ▲
            </button>
            <span />
            <button
              type="button"
              data-ds-k="l"
            >
              ◀
            </button>
            <button
              type="button"
              data-ds-k="d"
            >
              ▼
            </button>
            <button
              type="button"
              data-ds-k="r"
            >
              ▶
            </button>
            <span />
            <button
              type="button"
              data-ds-k="u"
            >
              ⤒
            </button>
            <span />
          </div>
        </div>
        <div class="ksep" />
        <div class="grp">
          <span class="lab">{{ pick({ zh: '偏航', en: 'Yaw' }) }}</span>
          <button
            type="button"
            data-ds-k="yl"
          >
            ⟲
          </button>
          <button
            type="button"
            data-ds-k="yr"
          >
            ⟳
          </button>
        </div>
        <div class="ksep" />
        <div class="grp">
          <button
            id="ds-reset"
            type="button"
          >
            ↺ {{ pick({ zh: '重置', en: 'Reset' }) }}
          </button>
        </div>
      </div>

      <!-- 部件信息卡 -->
      <div
        id="ds-info-card"
        class="panel info-card"
      >
        <div class="ch">
          <div
            id="ds-ci-icon"
            class="cic"
          >
            🔧
          </div>
          <div>
            <h3 id="ds-ci-name">
              —
            </h3>
            <div
              id="ds-ci-sub"
              class="cs"
            >
              —
            </div>
          </div>
          <div
            id="ds-ci-close"
            class="cclose"
          >
            ✕
          </div>
        </div>
        <div class="cb">
          <div class="cl">
            {{ pick({ zh: '功能', en: 'Function' }) }}
          </div>
          <div
            id="ds-ci-desc"
            class="cv"
          />
          <div class="cl">
            {{ pick({ zh: '工作原理', en: 'Operating notes' }) }}
          </div>
          <div
            id="ds-ci-principle"
            class="cv"
          />
          <div class="cl">
            {{ pick({ zh: '规格参数', en: 'Specifications' }) }}
          </div>
          <div
            id="ds-ci-tags"
            class="ctags"
          />
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
/* 原样式是整页全局写法，这里收进 .ds-root，并把 position:fixed 改成 absolute */
.ds-root {
  --bg:#070b12; --panel:rgba(15,21,33,0.86); --border:rgba(120,160,220,0.18);
  --text:#e6edf6; --muted:#8aa0bd; --accent:#36d3ff; --good:#39e6a0; --warn:#ffcc4d; --alarm:#ff5470;

  position:relative; width:100%; height:min(88vh,880px); min-height:560px;
  overflow:hidden; border-radius:16px; background:var(--bg); color:var(--text);
  font-size:13px; -webkit-font-smoothing:antialiased;
}
.ds-root :deep(*), .ds-root { box-sizing:border-box; }
.ds-root :deep(button) { font-family:inherit; cursor:pointer; color:var(--text);
  background:rgba(54,211,255,.10); border:1px solid var(--border); padding:7px 11px;
  border-radius:8px; font-size:12px; transition:.15s; }
.ds-root :deep(button:hover) { background:rgba(54,211,255,.22); border-color:var(--accent); }
.ds-root :deep(button.active) { background:var(--accent); color:#04121a; border-color:var(--accent); font-weight:600; }
.ds-root :deep(button.go) { background:rgba(57,230,160,.16); border-color:rgba(57,230,160,.4); }
.ds-root :deep(button.go:hover) { background:rgba(57,230,160,.3); }
.ds-root :deep(button.danger) { background:rgba(255,84,112,.16); border-color:rgba(255,84,112,.4); }
.panel { background:var(--panel); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
  border:1px solid var(--border); border-radius:12px; box-shadow:0 8px 30px rgba(0,0,0,.45); }

.stage { position:absolute; inset:0; z-index:0; }
.stage :deep(canvas) { display:block; }

.hint { position:absolute; left:50%; top:70px; transform:translateX(-50%); z-index:8; color:var(--muted);
  font-size:11px; background:rgba(8,12,20,.6); padding:4px 12px; border-radius:20px;
  border:1px solid var(--border); white-space:nowrap; margin:0; }

/* HUD */
.hud { position:absolute; top:12px; left:12px; right:12px; z-index:10; display:flex; gap:12px;
  align-items:stretch; padding:10px 14px; flex-wrap:wrap; }
.hud .brand { display:flex; flex-direction:column; justify-content:center; min-width:180px; }
.hud .brand b { font-size:16px; color:#fff; letter-spacing:.5px; }
.hud .brand b span { color:var(--accent); }
.hud .brand small { color:var(--muted); font-size:11px; }
.hud-block { display:flex; flex-direction:column; justify-content:center; padding:0 12px;
  border-left:1px solid var(--border); min-width:92px; }
.hud-block .k { color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.6px; }
.hud-block .v { font-size:17px; font-weight:600; color:#fff; font-variant-numeric:tabular-nums; }
.hud-block .v small { font-size:10px; color:var(--muted); font-weight:400; }
.hud-block.batt-block { min-width:130px; }
.batt-wrap { width:100%; height:6px; background:rgba(255,255,255,.1); border-radius:4px; margin-top:4px; overflow:hidden; }
.batt-bar { height:100%; background:linear-gradient(90deg,#39e6a0,#9be86a); transition:width .2s, background .2s; }
.hud-actions { margin-left:auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding-right:46px; }
/* 右上角全屏按钮：悬浮独立，高于 HUD/侧栏/FPV 的 z-index，品牌青发光更醒目 */
.ds-root .fsbtn { position:absolute; top:14px; right:14px; z-index:30; display:inline-flex;
  align-items:center; justify-content:center; width:38px; height:38px; padding:0; flex:none;
  background:rgba(54,211,255,.16); border:1px solid rgba(54,211,255,.5); border-radius:10px;
  color:var(--accent); box-shadow:0 0 14px rgba(54,211,255,.28); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); }
.ds-root .fsbtn:hover { background:rgba(54,211,255,.32); border-color:var(--accent); box-shadow:0 0 18px rgba(54,211,255,.5); }
.fsbtn svg { width:17px; height:17px; }
.ds-root:fullscreen { height:100vh; min-height:0; border-radius:0; }
.ds-root:-webkit-full-screen { height:100vh; min-height:0; border-radius:0; }

/* 左栏 */
.side-left { position:absolute; left:12px; top:96px; bottom:12px; width:286px; z-index:10;
  display:flex; flex-direction:column; padding:10px; gap:10px; overflow:hidden; }
.side-title { font-size:11px; text-transform:uppercase; letter-spacing:.8px; color:var(--muted);
  padding:2px 4px; display:flex; justify-content:space-between; align-items:center; }
.explode-btn { cursor:pointer; color:var(--accent); text-transform:none; letter-spacing:0; }
#ds-comp-btns { display:flex; flex-direction:column; gap:6px; overflow-y:auto; padding-right:3px; min-height:60px; }
#ds-comp-btns::-webkit-scrollbar { width:5px; }
#ds-comp-btns::-webkit-scrollbar-thumb { background:rgba(120,160,220,.25); border-radius:3px; }
.ds-root :deep(.compbtn) { display:flex; align-items:center; gap:9px; background:rgba(255,255,255,.03);
  border:1px solid var(--border); border-radius:9px; padding:7px 9px; text-align:left; }
.ds-root :deep(.compbtn .ci) { font-size:16px; }
.ds-root :deep(.compbtn .cn) { font-weight:600; font-size:12px; }
.ds-root :deep(.compbtn .cc) { margin-left:auto; font-size:10px; color:var(--muted); }
.ds-root :deep(.compbtn.detached) { opacity:.45; }
#ds-comp-actions { display:flex; gap:6px; }
#ds-comp-actions button { flex:1; font-size:11px; padding:6px; }

/* 教学进度 */
.progress { border:1px solid var(--border); border-radius:10px; padding:9px 10px; background:rgba(255,255,255,.02); }
.pg-head { display:flex; align-items:baseline; justify-content:space-between;
  color:var(--muted); font-size:10px; letter-spacing:.8px; text-transform:uppercase; }
.pg-head b { color:var(--accent); font-size:14px; font-variant-numeric:tabular-nums; }
.pg-track { height:6px; margin-top:6px; border-radius:99px; background:rgba(120,160,220,.16); overflow:hidden; }
.pg-fill { display:block; height:100%; border-radius:99px;
  background:linear-gradient(90deg,var(--accent),var(--good)); transition:width .3s ease; }
.pg-list { list-style:none; margin:6px 0 0; padding:0; display:flex; flex-direction:column; gap:2px; }
.pg-list li { display:flex; justify-content:space-between; gap:8px; color:var(--muted); font-size:10px; line-height:1.5; }
.pg-list li b { color:#fff; font-variant-numeric:tabular-nums; flex:none; }
.pg-list li.done { color:var(--good); }
.pg-list li.done b { color:var(--good); }

.log-wrap { margin-top:auto; display:flex; flex-direction:column; gap:4px; min-height:80px; }
#ds-log { overflow-y:auto; display:flex; flex-direction:column; gap:5px; max-height:130px; }
#ds-log::-webkit-scrollbar { width:6px; }
#ds-log::-webkit-scrollbar-thumb { background:rgba(120,160,220,.25); border-radius:3px; }
.ds-root :deep(.alert) { font-size:11px; padding:5px 8px; border-radius:6px; border-left:3px solid var(--muted);
  background:rgba(255,255,255,.03); display:flex; gap:8px; }
.ds-root :deep(.alert .t) { color:var(--muted); font-variant-numeric:tabular-nums; flex:none; }
.ds-root :deep(.alert.warn) { border-left-color:var(--warn); }
.ds-root :deep(.alert.alarm) { border-left-color:var(--alarm); background:rgba(255,84,112,.08); }
.ds-root :deep(.alert.good) { border-left-color:var(--good); }

/* 右栏 FPV */
.side-right { position:absolute; right:12px; top:96px; width:340px; z-index:10; display:flex; flex-direction:column; gap:12px; }
#ds-fpv-panel { padding:10px; }
#ds-fpv-panel .cap { display:flex; justify-content:space-between; font-size:11px; color:var(--muted); margin-bottom:6px; }
#ds-fpv-wrap { position:relative; border-radius:8px; overflow:hidden; border:1px solid var(--border); background:#000; }
#ds-fpv { display:block; width:100%; height:230px; }
#ds-fpv-hud { position:absolute; inset:0; pointer-events:none; font-family:'Courier New',monospace; }
#ds-fpv-hud .rec { position:absolute; top:8px; left:10px; color:#ff5470; font-size:12px; font-weight:700; display:flex; align-items:center; gap:5px; }
#ds-fpv-hud .rec .dot { width:9px; height:9px; border-radius:50%; background:#ff5470; animation:ds-blink 1s infinite; }
@keyframes ds-blink { 50% { opacity:.25; } }
#ds-fpv-hud .cross { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:42px; height:42px; }
#ds-fpv-hud .cross:before, #ds-fpv-hud .cross:after { content:''; position:absolute; background:rgba(54,211,255,.8); }
#ds-fpv-hud .cross:before { left:50%; top:0; width:2px; height:100%; transform:translateX(-50%); }
#ds-fpv-hud .cross:after { top:50%; left:0; height:2px; width:100%; transform:translateY(-50%); }
#ds-fpv-hud .tlt { position:absolute; bottom:8px; left:10px; right:10px; display:flex; justify-content:space-between; color:#9fe9ff; font-size:11px; text-shadow:0 0 4px #000; }
#ds-fpv-hud .tag { position:absolute; top:8px; right:10px; color:#9fe9ff; font-size:11px; border:1px solid rgba(54,211,255,.5); padding:1px 6px; border-radius:5px; }

/* 底部控制 */
.bottom { position:absolute; left:310px; right:366px; bottom:12px; z-index:10; padding:8px 12px;
  display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
.bottom .grp { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.bottom .lab { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.6px; }
.ksep { width:1px; height:26px; background:var(--border); }
.pad { display:grid; grid-template-columns:repeat(3,34px); grid-template-rows:repeat(3,34px); gap:4px; }
.pad button { padding:0; font-size:15px; }
.ds-root :deep(input[type=range]) { accent-color:var(--accent); width:110px; }
#ds-speed-val { font-variant-numeric:tabular-nums; color:var(--accent); font-weight:600; min-width:20px; text-align:right; }

/* 部件信息卡 */
.info-card { position:absolute; right:12px; bottom:12px; width:340px; z-index:20; display:none;
  max-height:46vh; overflow-y:auto; padding:0; }
.info-card .ch { padding:12px 14px; display:flex; gap:12px; align-items:center; border-bottom:1px solid var(--border);
  background:rgba(54,211,255,.06); }
.info-card .cic { font-size:26px; }
.info-card h3 { font-size:15px; color:#fff; margin:0; }
.info-card .cs { color:var(--muted); font-size:11px; margin-top:2px; }
.info-card .cclose { margin-left:auto; cursor:pointer; font-size:18px; color:var(--muted); padding:2px 8px; border-radius:8px; }
.info-card .cclose:hover { background:rgba(255,255,255,.08); color:#fff; }
.info-card .cb { padding:12px 14px; }
.info-card .cl { font-size:10px; text-transform:uppercase; letter-spacing:.7px; color:var(--accent); margin-bottom:4px; }
.info-card .cv { font-size:12.5px; line-height:1.55; color:#dbe6f2; margin-bottom:10px; }
.info-card .ctags { display:flex; flex-wrap:wrap; gap:8px; }
.info-card .ctags .tag { background:rgba(255,255,255,.05); border:1px solid var(--border); border-radius:20px;
  padding:4px 11px; font-size:11px; color:var(--muted); }
.info-card .ctags .tag b { color:#fff; }

.err { position:absolute; z-index:50; left:50%; bottom:16px; transform:translateX(-50%);
  background:rgba(61,11,22,.94); color:#ffdce1; border:1px solid rgba(255,90,111,.7);
  padding:8px 12px; border-radius:10px; font-size:12px; margin:0; }

@media (max-width:1100px) {
  .side-right { display:none; }
  .bottom { right:12px; }
  .side-left { width:248px; }
}
@media (max-width:860px) {
  .hint { display:none; }
  .bottom { left:12px; }
  .side-left { width:230px; top:104px; }
}
</style>
