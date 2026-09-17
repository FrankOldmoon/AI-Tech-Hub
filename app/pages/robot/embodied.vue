<script setup lang="ts">
/**
 * Orion 五机器人 3D 交互实验室（原生页面版）
 *
 * 由独立应用 apps/embodied/index.html 移植：3D 逻辑住在 utils/embodied/engine.ts，
 * 这里只负责「外壳 UI + 按 tab 挂载/卸载引擎」。three 走 npm 依赖，不再用 apps/vendor。
 *
 * 两个移植要点：
 * 1. 只渲染当前机器人的面板（原版 5 个面板同时存在）—— 于是面板内的 id 天然唯一，
 *    引擎可以继续用「容器内按 id 查」的写法；代价是切 tab 要重建场景，所以必须 dispose。
 * 2. 面板里那些会被引擎持续写入的节点（关节角度、FPS、相位百分比…）不用 Vue 绑定，
 *    由引擎自己写 —— 否则 Vue 重渲染会盖掉引擎的值。
 */
import { ROBOTS, initRobot } from '~/utils/embodied/engine'
import { pickText, type LocalizedText } from '~/utils/localized'

const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'embodied')!)

/** 页面外壳文案走站点双语；机器人自身的说明与解剖学文案沿用原应用的英文原文 */
const { locale } = useI18n()
const lang = computed<'zh' | 'en'>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: LocalizedText) => pickText(o, lang.value)

const activeKey = ref(ROBOTS[0]!.key)
const active = computed(() => ROBOTS.find(r => r.key === activeKey.value)!)

const paneEl = ref<HTMLElement | null>(null)
const resetBtn = ref<HTMLElement | null>(null)
const captureBtn = ref<HTMLElement | null>(null)
const errorMsg = ref('')

/** 每个机器人 4 个探索任务，与原版的 Lab Progress 一致 */
const TASKS = [
  { key: 'orbit', label: 'Orbit the view' },
  { key: 'joint', label: 'Adjust a joint angle' },
  { key: 'demo', label: 'Run the motion demo' },
  { key: 'view', label: 'Switch view / display mode' }
]
const done = ref(new Set<string>())
const total = ROBOTS.length * TASKS.length
const pct = computed(() => done.value.size / total)

function onTask(task: string) {
  done.value = new Set(done.value).add(`${activeKey.value}:${task}`)
}

const nextTask = computed(() => {
  const missing = TASKS.filter(t => !done.value.has(`${activeKey.value}:${t.key}`))
  return missing[0]?.label ?? null
})
const progressHint = computed(() => {
  if (pct.value >= 1) return 'All robots explored'
  const ok = TASKS.length - (nextTask.value ? TASKS.filter(t => !done.value.has(`${activeKey.value}:${t.key}`)).length : 0)
  return nextTask.value
    ? `This robot ${ok}/${TASKS.length} · Next: ${nextTask.value}`
    : 'This robot complete · Try other robots'
})

const debugOptions = computed(() => active.value.debugModes ?? [
  { value: 'final', label: 'Final Materials' },
  { value: 'topology', label: 'Topology Wireframe' },
  { value: 'joints', label: 'Joint Axes & Pivots' }
])
const cameraViews = computed(() => active.value.camera.views ?? [{ key: 'hero', label: 'Three-Quarter' }])

const cameraLabels = ['Three-Quarter', 'Front', 'Side', 'Top']

let dispose: (() => void) | null = null

function unmount() {
  dispose?.()
  dispose = null
}

function mount() {
  unmount()
  const host = paneEl.value
  const reset = resetBtn.value
  const capture = captureBtn.value
  if (!host || !reset || !capture) return
  try {
    dispose = initRobot(host, active.value, { reset, capture, onTask })
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  }
}

// 切机器人会重建面板节点（v-for 里的 :key），必须等 DOM 落地后再初始化场景
watch(activeKey, async () => {
  errorMsg.value = ''
  unmount()
  await nextTick()
  mount()
})

onMounted(mount)
onBeforeUnmount(unmount)
</script>

<template>
  <MediaDemoShell :demo="demo">
    <p class="mb-3 text-sm text-muted">
      {{ pick({ zh: '三个轴承、六足、机械臂、四足、人形五个模型共用同一套 URDF 引擎：拖拽旋转观察、拉滑块或拖关节调角度、跑演示轨迹看运动学。', en: 'Five models (drone, hexapod, arm, quadruped, humanoid) share one URDF engine: orbit to inspect, drag joints or move sliders, and run the motion demo to watch the kinematics.' }) }}
    </p>

    <div class="embodied-wrap">
      <div class="embodied">
        <header>
          <div class="brand">
            <div class="eyebrow">
              {{ active.eyebrow }}
            </div>
            <!-- 标题与说明来自原始模型配置，含 &amp; 等实体 -->
            <h1 v-html="active.title" />
          </div>
          <div class="header-actions">
            <button
              id="captureBtn"
              ref="captureBtn"
              type="button"
            >
              {{ pick({ zh: '保存当前视角', en: 'Save View' }) }}
            </button>
            <button
              id="resetBtn"
              ref="resetBtn"
              type="button"
            >
              {{ pick({ zh: '重置', en: 'Reset All' }) }}
            </button>
          </div>
        </header>

        <nav
          id="tabs"
          aria-label="Robot selection"
        >
          <button
            v-for="r in ROBOTS"
            :key="r.key"
            type="button"
            :class="{ active: r.key === activeKey }"
            :aria-pressed="r.key === activeKey"
            @click="activeKey = r.key"
          >
            {{ r.tab }}
          </button>
        </nav>

        <main id="panes">
          <div
            :key="active.key"
            ref="paneEl"
            class="pane active"
            :data-pane="active.key"
          >
            <section
              id="stage"
              :aria-label="`3D ${active.tab} viewport`"
            >
              <canvas id="robotCanvas" />
              <div
                id="instruction"
                class="stage-card"
              >
                <strong id="instructionTitle">Observe Mode</strong><br>
                <span id="instructionText">{{ active.instructionObserve }}</span>
              </div>
              <div
                id="selectionReadout"
                class="stage-card"
              >
                <div
                  id="selectedName"
                  class="name"
                >
                  {{ active.defaultLabel || 'Joint' }}
                </div>
                <div
                  id="selectedValue"
                  class="value"
                >
                  0.0&deg;
                </div>
              </div>
              <div
                id="modeDock"
                class="stage-card"
                aria-label="Interaction mode"
              >
                <button
                  id="observeModeBtn"
                  class="active"
                  type="button"
                >
                  Observe Model
                </button>
                <button
                  id="jointModeBtn"
                  type="button"
                >
                  Drag Joints
                </button>
              </div>
              <div
                id="errorBanner"
                role="alert"
              />
            </section>

            <aside>
              <section class="panel-section">
                <div class="section-title">
                  <span>{{ pick({ zh: '关节控制', en: 'Joint Control' }) }}</span><i class="status-dot" />
                </div>
                <label for="jointSelect">{{ pick({ zh: '选择关节', en: 'Select Joint' }) }}</label>
                <select id="jointSelect" />
                <div class="range-head">
                  <span>{{ pick({ zh: '角度', en: 'Angle' }) }}</span><strong id="jointValue">0.0&deg;</strong>
                </div>
                <input
                  id="jointSlider"
                  type="range"
                  min="-90"
                  max="90"
                  step="1"
                  value="0"
                >
                <div class="limit-row">
                  <span id="jointMin">-90&deg;</span><span id="jointMax">90&deg;</span>
                </div>
                <p
                  v-if="active.jointMicrocopy"
                  class="microcopy"
                  v-html="active.jointMicrocopy"
                />
                <div id="jointAxisInfo" />
              </section>

              <section class="panel-section">
                <div class="section-title">
                  <span v-html="active.demo.title" /><span id="phaseText">0%</span>
                </div>
                <div class="button-grid">
                  <button
                    :id="active.demo.toggleId"
                    type="button"
                  >
                    {{ active.demo.runLabel }}
                  </button>
                  <select
                    id="speedSelect"
                    aria-label="Playback speed"
                  >
                    <option value="0.5">
                      0.5&times; Speed
                    </option>
                    <option
                      value="1"
                      selected
                    >
                      1&times; Speed
                    </option>
                    <option value="1.5">
                      1.5&times; Speed
                    </option>
                    <option value="2">
                      2&times; Speed
                    </option>
                  </select>
                </div>
                <label for="phaseSlider">{{ active.demo.phaseLabel }}</label>
                <input
                  id="phaseSlider"
                  type="range"
                  min="0"
                  max="1000"
                  step="1"
                  value="0"
                >
                <div class="phase-track" />
                <div
                  v-if="active.demo.legend"
                  class="phase-legend"
                >
                  <span
                    class="stance"
                    v-html="active.demo.legend[0]"
                  />
                  <span
                    class="swing"
                    v-html="active.demo.legend[1] || ''"
                  />
                </div>
                <div
                  class="button-grid"
                  style="margin-top:10px"
                >
                  <button
                    v-for="p in active.demo.presets"
                    :key="p.label"
                    class="phase-preset"
                    :data-phase="p.p"
                    type="button"
                  >
                    {{ p.label }}
                  </button>
                </div>
              </section>

              <section class="panel-section">
                <div class="section-title">
                  <span v-html="active.camSectionTitle || 'Camera &amp; Diagnostics'" />
                </div>
                <div class="button-grid cam">
                  <button
                    v-for="(v, i) in cameraViews"
                    :key="v.key"
                    class="camera-btn"
                    :class="{ active: i === 0 }"
                    :data-view="v.key"
                    type="button"
                  >
                    {{ v.label || cameraLabels[i] }}
                  </button>
                </div>
                <label for="debugSelect">{{ pick({ zh: '显示模式', en: 'Display Mode' }) }}</label>
                <select id="debugSelect">
                  <option
                    v-for="m in debugOptions"
                    :key="m.value"
                    :value="m.value"
                    :selected="m.value === (active.debugDefault || 'final')"
                  >
                    {{ m.label }}
                  </option>
                </select>
                <label for="qualitySelect">{{ pick({ zh: '渲染质量', en: 'Render Quality' }) }}</label>
                <select id="qualitySelect">
                  <option value="1">
                    Smooth &middot; DPR 1.0
                  </option>
                  <option
                    value="1.5"
                    selected
                  >
                    Balanced &middot; DPR 1.5
                  </option>
                  <option value="2">
                    Detailed &middot; DPR 2.0
                  </option>
                </select>
              </section>

              <section
                v-if="active.anatomy"
                class="panel-section"
              >
                <div class="section-title">
                  <span>{{ pick({ zh: '结构与原理', en: 'Anatomy & Explanation' }) }}</span>
                </div>
                <p
                  v-for="(a, i) in active.anatomy"
                  :key="i"
                  class="microcopy"
                  v-html="a"
                />
              </section>

              <section class="panel-section">
                <div class="section-title">
                  <span>{{ pick({ zh: '运行时指标', en: 'Runtime Metrics' }) }}</span><span>{{ active.seed }}</span>
                </div>
                <div class="metrics">
                  <div class="metric">
                    <span>FPS</span><strong id="fpsMetric">--</strong>
                  </div>
                  <div class="metric">
                    <span>Frame Time</span><strong id="frameMetric">-- ms</strong>
                  </div>
                  <div class="metric">
                    <span>Draw calls</span><strong id="callsMetric">--</strong>
                  </div>
                  <div class="metric">
                    <span>Triangles</span><strong id="triMetric">--</strong>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </main>
      </div>

      <div
        id="progressWidget"
        role="status"
        aria-live="polite"
        :class="{ done: pct >= 1 }"
      >
        <div class="pg-title">
          <span>{{ pick({ zh: '探索进度', en: 'Lab Progress' }) }}</span><strong id="progressPct">{{ Math.round(pct * 100) }}%</strong>
        </div>
        <div id="progressTrack">
          <i
            id="progressFill"
            :style="{ width: `${(pct * 100).toFixed(1)}%` }"
          />
        </div>
        <div
          id="progressHint"
          v-html="progressHint"
        />
      </div>

      <p
        v-if="errorMsg"
        class="mt-2 text-sm text-error"
      >
        3D scene error: {{ errorMsg }}
      </p>
    </div>
  </MediaDemoShell>
</template>

<style scoped>
/* 原应用的样式是整页全局写法的，这里全部收进 .embodied 作用域，
   避免它的 body/main/label/select/button 裸选择器影响站点 */
.embodied {
  --bg:#071019; --panel:rgba(10,24,35,.92); --panel-2:rgba(15,35,48,.84);
  --line:rgba(117,181,201,.2); --text:#e8f5f7; --muted:#83a3ad;
  --cyan:#20d4cf; --amber:#ff9d2e; --danger:#ff5a6f;

  display:grid; grid-template-rows:auto auto minmax(0,1fr);
  height:min(78vh, 860px); min-height:520px; min-width:320px;
  color:var(--text); overflow:hidden; border-radius:16px;
  background:radial-gradient(circle at 28% 12%, rgba(32,212,207,.11), transparent 30%), linear-gradient(145deg,#050b12 0%,#071019 55%,#091923 100%);
  font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
}
.embodied :deep(*), .embodied { box-sizing:border-box; }
.embodied :deep(button),
.embodied :deep(select),
.embodied :deep(input){ font:inherit; }
.embodied :deep(button),
.embodied :deep(select){ color:var(--text); border:1px solid var(--line); background:rgba(20,43,57,.78); border-radius:10px; }
.embodied :deep(button){ cursor:pointer; }
.embodied :deep(button:hover),
.embodied :deep(select:hover){ border-color:rgba(32,212,207,.7); }
.embodied :deep(button:focus-visible),
.embodied :deep(select:focus-visible),
.embodied :deep(input:focus-visible){ outline:2px solid var(--cyan); outline-offset:2px; }

.embodied header{ z-index:4; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 18px; border-bottom:1px solid var(--line); background:rgba(5,13,20,.82); backdrop-filter:blur(16px); }
.embodied .brand{ min-width:0; }
.embodied .eyebrow{ margin-bottom:3px; color:var(--cyan); font:700 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.18em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.embodied h1{ margin:0; overflow:hidden; font-size:clamp(15px,1.8vw,22px); line-height:1.18; text-overflow:ellipsis; white-space:nowrap; color:var(--text); font-weight:700; }
.embodied .header-actions{ display:flex; gap:8px; }
.embodied .header-actions :deep(button){ min-height:38px; padding:0 13px; }
.embodied nav#tabs{ z-index:4; display:flex; gap:6px; padding:8px 14px; border-bottom:1px solid var(--line); background:rgba(8,20,30,.9); overflow-x:auto; scrollbar-width:thin; }
.embodied #tabs :deep(button){ flex:0 0 auto; min-height:34px; padding:0 14px; font-size:12px; font-weight:700; border-color:transparent; background:transparent; color:var(--muted); white-space:nowrap; }
.embodied #tabs :deep(button:hover){ color:var(--text); }
.embodied #tabs :deep(button.active){ color:#041316; background:linear-gradient(135deg,var(--cyan),#63f1d2); box-shadow:0 6px 24px rgba(32,212,207,.22); }
.embodied main{ position:relative; min-width:0; min-height:0; overflow:hidden; }
.embodied .pane{ position:absolute; inset:0; display:grid; grid-template-columns:minmax(0,1fr) 330px; min-height:0; }
.embodied #stage{ position:relative; min-width:0; min-height:0; overflow:hidden; }
.embodied :deep(canvas){ display:block; width:100%; height:100%; touch-action:none; }
.embodied .stage-card{ position:absolute; z-index:3; border:1px solid var(--line); background:rgba(6,16,24,.76); box-shadow:0 12px 40px rgba(0,0,0,.22); backdrop-filter:blur(12px); }
.embodied #instruction{ top:14px; left:14px; max-width:min(440px,calc(100% - 28px)); padding:10px 12px; border-radius:12px; color:var(--muted); font-size:12px; line-height:1.55; pointer-events:none; }
.embodied #instruction strong{ color:var(--text); font-weight:650; }
.embodied #selectionReadout{ top:14px; right:14px; min-width:190px; padding:9px 11px; border-radius:12px; text-align:right; pointer-events:none; }
.embodied #selectionReadout .name{ color:var(--amber); font-size:13px; font-weight:700; }
.embodied #selectionReadout .value{ margin-top:3px; color:var(--muted); font:11px ui-monospace,monospace; }
.embodied #modeDock{ bottom:14px; left:50%; display:flex; gap:5px; padding:5px; border-radius:14px; transform:translateX(-50%); }
.embodied #modeDock :deep(button){ min-width:118px; min-height:40px; padding:0 12px; border-color:transparent; background:transparent; font-size:12px; font-weight:700; }
.embodied #modeDock :deep(button.active){ color:#041316; background:linear-gradient(135deg,var(--cyan),#63f1d2); box-shadow:0 6px 24px rgba(32,212,207,.24); }
.embodied aside{ min-height:0; overflow:auto; padding:14px; border-left:1px solid var(--line); background:linear-gradient(180deg,rgba(8,20,30,.96),rgba(6,15,23,.98)); scrollbar-width:thin; }
.embodied .panel-section{ margin-bottom:12px; padding:13px; border:1px solid var(--line); border-radius:14px; background:linear-gradient(145deg,var(--panel-2),rgba(7,18,27,.72)); }
.embodied .section-title{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:11px; color:var(--muted); font-size:10px; font-weight:800; letter-spacing:.13em; text-transform:uppercase; }
.embodied .status-dot{ width:7px; height:7px; border-radius:50%; background:var(--cyan); box-shadow:0 0 14px rgba(32,212,207,.8); }
.embodied :deep(label){ display:block; margin:9px 0 5px; color:var(--muted); font-size:11px; }
.embodied :deep(select){ width:100%; min-height:39px; padding:0 10px; }
.embodied :deep(input[type="range"]){ width:100%; accent-color:var(--cyan); cursor:ew-resize; }
.embodied .range-head,
.embodied .metric-row,
.embodied .phase-legend{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
.embodied .range-head{ margin-top:10px; font-size:11px; }
.embodied #jointValue{ color:var(--amber); font:700 13px ui-monospace,monospace; }
.embodied .limit-row,
.embodied .phase-legend{ color:var(--muted); font:10px ui-monospace,monospace; }
.embodied .button-grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:7px; }
.embodied .button-grid.cam{ grid-template-columns:repeat(4,1fr); }
.embodied .button-grid :deep(button){ min-height:38px; padding:6px 6px; font-size:11px; }
.embodied .button-grid :deep(button.active),
.embodied :deep(#runToggle.playing),
.embodied :deep(#walkToggle.playing){ color:#061415; border-color:transparent; background:var(--cyan); }
.embodied .phase-track{ height:6px; margin:9px 0 7px; overflow:hidden; border-radius:99px; background:linear-gradient(90deg,var(--cyan) 0 62%,var(--amber) 62% 100%); }
.embodied .phase-legend .stance{ color:var(--cyan); }
.embodied .phase-legend .swing{ color:var(--amber); }
.embodied .metrics{ display:grid; grid-template-columns:1fr 1fr; gap:7px; }
.embodied .metric{ padding:8px; border:1px solid rgba(117,181,201,.13); border-radius:10px; background:rgba(3,11,17,.45); }
.embodied .metric span{ display:block; color:var(--muted); font-size:9px; }
.embodied .metric strong{ display:block; margin-top:3px; font:700 12px ui-monospace,monospace; }
.embodied .microcopy{ margin:8px 0 0; color:var(--muted); font-size:10px; line-height:1.55; }
.embodied #jointAxisInfo{ margin-top:8px; color:var(--muted); font:10px/1.5 ui-monospace,monospace; }
.embodied #errorBanner{ position:absolute; z-index:10; right:18px; bottom:112px; display:none; max-width:420px; padding:12px 14px; border:1px solid rgba(255,90,111,.7); border-radius:12px; color:#ffdce1; background:rgba(61,11,22,.94); font-size:12px; }

.embodied-wrap{ position:relative; }
.embodied-wrap #progressWidget{ position:absolute; z-index:30; right:18px; bottom:18px; width:238px; padding:10px 12px; border:1px solid rgba(117,181,201,.2); border-radius:14px; background:rgba(6,16,24,.88); box-shadow:0 14px 44px rgba(0,0,0,.42); backdrop-filter:blur(14px); pointer-events:none; }
.embodied-wrap .pg-title{ display:flex; align-items:baseline; justify-content:space-between; gap:8px; color:#83a3ad; font-size:10px; font-weight:800; letter-spacing:.13em; text-transform:uppercase; }
.embodied-wrap #progressPct{ color:#20d4cf; font:700 15px/1 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:0; }
.embodied-wrap #progressTrack{ position:relative; height:6px; margin-top:8px; overflow:hidden; border-radius:99px; background:rgba(117,181,201,.16); }
.embodied-wrap #progressFill{ display:block; width:0; height:100%; border-radius:99px; background:linear-gradient(90deg,#20d4cf,#63f1d2); box-shadow:0 0 14px rgba(32,212,207,.55); transition:width .3s cubic-bezier(.22,.61,.36,1); }
.embodied-wrap #progressHint{ margin-top:7px; color:#83a3ad; font-size:10px; line-height:1.5; }
.embodied-wrap #progressHint :deep(b){ color:#ff9d2e; font-weight:700; }
.embodied-wrap #progressWidget.done{ border-color:rgba(32,212,207,.6); box-shadow:0 0 0 1px rgba(32,212,207,.25),0 14px 44px rgba(32,212,207,.18); }

@media (max-width:820px) {
  .embodied{ height:min(88vh, 900px); }
  .embodied header{ padding:10px 12px; }
  .embodied .header-actions :deep(button){ padding:0 9px; font-size:11px; }
  .embodied .pane{ grid-template-columns:1fr; grid-template-rows:minmax(0,62vh) minmax(0,1fr); }
  .embodied aside{ border-top:1px solid var(--line); border-left:0; }
  .embodied #selectionReadout{ display:none; }
  .embodied #modeDock{ bottom:10px; }
  .embodied #modeDock :deep(button){ min-width:104px; }
  .embodied-wrap #progressWidget{ right:10px; bottom:10px; width:172px; padding:8px 10px; }
  .embodied-wrap #progressHint{ font-size:9px; }
  .embodied-wrap #progressPct{ font-size:13px; }
}
</style>
