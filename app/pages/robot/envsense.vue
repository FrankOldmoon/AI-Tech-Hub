<script setup lang="ts">
/**
 * EnvSense 多传感器环境监测仿真（原生页面版）
 *
 * 由独立单文件页 1.html 移植：
 *   - 3D 场景与模拟逻辑住在 utils/envsense/engine.ts（three 走 npm 依赖，无 CDN）；
 *   - 这里只负责「静态外壳 markup + 按需挂载/卸载引擎 + 教学进度上报」。
 *
 * 两个移植要点：
 * 1. 原版的 HUD / 侧栏 / 底栏用 position:fixed 铺满浏览器视口，这里收进 .es-root
 *    改成 absolute —— 页面嵌在站点里，不该抢整页。
 * 2. 卡片数值、曲线、告警行这些会被引擎持续写入的节点不绑 Vue（引擎自己写），
 *    否则每次重渲染都会盖掉引擎的值；模板只负责骨架与本地化标题。
 */
import { ENVSENSE_ACTIONS, ENVSENSE_SENSORS, createEnvSense, type Lang } from '~/utils/envsense/engine'
import { reportCorrectRate } from '~/utils/embed-report'
import { pickText, type LocalizedText } from '~/utils/localized'

const APP_ID = 'robot/envsense'

const { getDemo } = useDemos()
const demo = computed(() => getDemo('robot', 'envsense')!)
const { locale } = useI18n()
const lang = computed<Lang>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: LocalizedText) => pickText(o, lang.value)

const rootEl = ref<HTMLElement | null>(null)
const errorMsg = ref('')
let handle: ReturnType<typeof createEnvSense> | null = null

/* ---------- 教学进度（上报用） ---------- */
const visited = ref<Set<string>>(new Set())
const scenarios = ref<Set<string>>(new Set())
const weathers = ref<Set<string>>(new Set())
const exported = ref(false)

const TASK_WEIGHTS = { sensors: 0.35, scenarios: 0.25, weather: 0.2, export: 0.2 }

const tasks = computed(() => [
  {
    key: 'sensors',
    label: { zh: '点开查看全部传感器详情', en: 'Open every sensor detail card' } as LocalizedText,
    done: visited.value.size,
    total: ENVSENSE_SENSORS.length,
    weight: TASK_WEIGHTS.sensors
  },
  {
    key: 'scenarios',
    label: { zh: '触发全部环境场景', en: 'Trigger every environmental scenario' } as LocalizedText,
    done: scenarios.value.size,
    total: 4,
    weight: TASK_WEIGHTS.scenarios
  },
  {
    key: 'weather',
    label: { zh: '切换三种天气', en: 'Try all three weather modes' } as LocalizedText,
    done: weathers.value.size,
    total: 3,
    weight: TASK_WEIGHTS.weather
  },
  {
    key: 'export',
    label: { zh: '导出一次数据集', en: 'Export the dataset once' } as LocalizedText,
    done: exported.value ? 1 : 0,
    total: 1,
    weight: TASK_WEIGHTS.export
  }
])

/** 完成度 0~1：各项按权重部分给分，仪表盘能连续涨，不是 0/1 跳变 */
const rate = computed(() => tasks.value.reduce((acc, t) => acc + t.weight * Math.min(1, t.done / t.total), 0))
const finished = computed(() => rate.value >= 0.999)

function onTask(task: string) {
  if (task.startsWith('sensor:')) visited.value = new Set(visited.value).add(task.slice(7))
  else if (task.startsWith('scenario:')) scenarios.value = new Set(scenarios.value).add(task.slice(9))
  else if (task.startsWith('weather:')) weathers.value = new Set(weathers.value).add(task.slice(8))
  else if (task === 'export') exported.value = true
}

/** 上报契约：parent.postMessage({ type:'correct_rate', rate, ... })，详见 utils/embed-report.ts */
watch([rate, finished], () => {
  reportCorrectRate({
    app: APP_ID,
    rate: rate.value,
    finished: finished.value,
    locale: locale.value,
    extra: {
      sensorsVisited: visited.value.size,
      sensorsTotal: ENVSENSE_SENSORS.length,
      scenariosUsed: scenarios.value.size,
      weathersUsed: weathers.value.size,
      exported: exported.value
    }
  })
})

/* ---------- 引擎挂载 ---------- */
function unmount() {
  handle?.dispose()
  handle = null
}

function mount() {
  unmount()
  const root = rootEl.value
  if (!root) return
  try {
    handle = createEnvSense(root, { getLocale: () => lang.value, onTask })
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(mount)
onBeforeUnmount(unmount)

// 切语言：卡片标题由模板自动更新，右栏详情与弹窗由引擎写，重新选一次当前传感器即可刷新
watch(locale, () => {
  if (handle) handle.selectSensor(handle.getSelectedId())
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div
      ref="rootEl"
      class="es-root"
    >
      <div
        id="es-stage"
        class="stage"
      >
        <canvas id="es-canvas" />
        <div
          id="es-labels"
          class="labels"
        />
        <p class="hint">
          {{ pick({ zh: '拖拽旋转 · 滚轮缩放 · 点传感器按钮或 3D 模型查看说明', en: 'Drag to orbit · Scroll to zoom · Click a sensor button or the 3D model to learn' }) }}
        </p>
      </div>

      <!-- 顶部 HUD -->
      <div
        id="es-hud"
        class="panel hud"
      >
        <div class="brand">
          <b>Env<span>Sense</span></b>
          <small>{{ pick({ zh: '多传感器环境监测仿真', en: 'Multi-Sensor Environmental Simulation' }) }}</small>
        </div>
        <div class="hud-block">
          <div class="k">
            {{ pick({ zh: '仿真时钟', en: 'Sim Clock' }) }}
          </div>
          <div
            id="es-hud-clock"
            class="v"
          >
            Day 1 · 06:00
          </div>
        </div>
        <div class="hud-block">
          <div class="k">
            {{ pick({ zh: '天气', en: 'Weather' }) }}
          </div>
          <div
            id="es-hud-weather"
            class="v"
          >
            Clear
          </div>
        </div>
        <div class="hud-block">
          <div class="k">
            {{ pick({ zh: '采样点', en: 'Data Points' }) }}
          </div>
          <div
            id="es-hud-points"
            class="v"
          >
            0
          </div>
        </div>
        <div class="hud-block">
          <div class="k">
            {{ pick({ zh: '活跃告警', en: 'Active Alerts' }) }}
          </div>
          <div
            id="es-hud-alerts"
            class="v"
          >
            0
          </div>
        </div>
        <div class="hud-actions">
          <button
            id="es-btn-play"
            class="active"
            type="button"
          >
            ⏸ {{ pick({ zh: '暂停', en: 'Pause' }) }}
          </button>
          <div class="seg">
            <button
              id="es-w-clear"
              class="active"
              type="button"
            >
              {{ pick({ zh: '晴', en: 'Clear' }) }}
            </button>
            <button
              id="es-w-cloudy"
              type="button"
            >
              {{ pick({ zh: '多云', en: 'Cloudy' }) }}
            </button>
            <button
              id="es-w-rain"
              type="button"
            >
              {{ pick({ zh: '降雨', en: 'Rain' }) }}
            </button>
          </div>
        </div>
      </div>

      <!-- 左侧：传感器控制 -->
      <div
        id="es-side-left"
        class="panel side-left"
      >
        <div class="side-title">
          <span>{{ pick({ zh: '传感器控制', en: 'Sensor Controls' }) }}</span>
          <a
            id="es-btn-export"
            href="#"
            @click.prevent
          >⬇ {{ pick({ zh: '导出 CSV', en: 'Export CSV' }) }}</a>
        </div>
        <div class="sensor-btns">
          <button
            v-for="s in ENVSENSE_SENSORS"
            :key="s.id"
            type="button"
            class="sbtn"
            :data-btn="s.id"
            :title="pick(s.name)"
          >
            <span class="ic">{{ s.icon }}</span><span class="lb">{{ s.id }}</span>
          </button>
        </div>
        <div class="sensor-list">
          <div
            v-for="s in ENVSENSE_SENSORS"
            :key="s.id"
            class="card"
            :data-card="s.id"
          >
            <div
              class="stat"
              data-role="stat"
            />
            <div class="row1">
              <span
                class="dot"
                data-role="dot"
                style="color:#39e6a0"
              />
              <span class="name">{{ pick(s.name) }}</span>
              <span class="type">{{ s.id }}</span>
            </div>
            <div class="row2">
              <div class="val">
                <span data-role="num">--</span><u>{{ s.unit }}</u>
              </div>
              <canvas
                width="148"
                height="60"
                data-role="chart"
              />
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

      <!-- 右侧：详情 + 告警 -->
      <div
        id="es-side-right"
        class="side-right"
      >
        <div class="panel detail">
          <div class="hd">
            <span
              id="es-d-dot"
              class="dot"
              style="color:var(--es-good)"
            />
            <div>
              <h3 id="es-d-name">
                —
              </h3>
              <div
                id="es-d-type"
                class="sub"
              >
                —
              </div>
            </div>
          </div>
          <canvas id="es-big-chart" />
          <div class="stats">
            <div class="stat-box">
              <div class="l">
                {{ pick({ zh: '当前', en: 'Current' }) }}
              </div><div
                id="es-s-cur"
                class="n"
              >
                —
              </div>
            </div>
            <div class="stat-box">
              <div class="l">
                {{ pick({ zh: '最小', en: 'Min' }) }}
              </div><div
                id="es-s-min"
                class="n"
              >
                —
              </div>
            </div>
            <div class="stat-box">
              <div class="l">
                {{ pick({ zh: '最大', en: 'Max' }) }}
              </div><div
                id="es-s-max"
                class="n"
              >
                —
              </div>
            </div>
            <div class="stat-box">
              <div class="l">
                {{ pick({ zh: '平均', en: 'Avg' }) }}
              </div><div
                id="es-s-avg"
                class="n"
              >
                —
              </div>
            </div>
          </div>
          <div class="thr">
            <span>{{ pick({ zh: '预警', en: 'Warn' }) }}: <b id="es-d-warn">—</b></span>
            <span>{{ pick({ zh: '报警', en: 'Alarm' }) }}: <b id="es-d-alarm">—</b></span>
          </div>
        </div>
        <div
          id="es-alerts"
          class="panel alerts"
        >
          <div class="side-title">
            {{ pick({ zh: '事件与告警日志', en: 'Event & Alert Log' }) }}
          </div>
          <div id="es-alert-log" />
        </div>
      </div>

      <!-- 底部条 -->
      <div
        id="es-bottom"
        class="panel bottom"
      >
        <div class="grp">
          <span class="lab">{{ pick({ zh: '速度', en: 'Speed' }) }}</span>
          <input
            id="es-speed"
            type="range"
            min="1"
            max="120"
            value="30"
          >
          <span id="es-speed-val">30×</span>
        </div>
        <div class="grp">
          <span class="lab">{{ pick({ zh: '场景', en: 'Scenario' }) }}</span>
          <button
            v-for="sc in ENVSENSE_ACTIONS"
            :id="sc.domId"
            :key="sc.id"
            type="button"
            class="danger"
          >
            {{ sc.icon }} {{ pick(sc.label) }}
          </button>
        </div>
        <div class="legend">
          <span><i style="background:var(--es-good)" />{{ pick({ zh: '正常', en: 'Normal' }) }}</span>
          <span><i style="background:var(--es-warn)" />{{ pick({ zh: '预警', en: 'Warning' }) }}</span>
          <span><i style="background:var(--es-alarm)" />{{ pick({ zh: '报警', en: 'Alarm' }) }}</span>
        </div>
      </div>

      <!-- 传感器详情弹窗 -->
      <div id="es-info-modal">
        <div class="modal">
          <div class="mh">
            <div
              id="es-mi-icon"
              class="mic"
            >
              🌡️
            </div>
            <div>
              <h2 id="es-mi-name">
                —
              </h2>
              <div
                id="es-mi-sub"
                class="ms"
              >
                —
              </div>
            </div>
            <div
              id="es-mi-close"
              class="mclose"
            >
              ✕
            </div>
          </div>
          <div class="mb">
            <div class="mrow">
              <div class="ml">
                {{ pick({ zh: '测的是什么', en: 'What it measures' }) }}
              </div>
              <div
                id="es-mi-desc"
                class="mv"
              />
            </div>
            <div class="mrow">
              <div class="ml">
                {{ pick({ zh: '工作原理', en: 'Working principle' }) }}
              </div>
              <div
                id="es-mi-principle"
                class="mv"
              />
            </div>
            <div class="mrow">
              <div class="ml">
                {{ pick({ zh: '量程与应用', en: 'Typical range & application' }) }}
              </div>
              <div
                id="es-mi-tags"
                class="mtags"
              />
            </div>
            <div class="mrow">
              <div class="ml">
                {{ pick({ zh: '当前读数', en: 'Live reading' }) }}
              </div>
              <div
                id="es-mi-live"
                class="mv live"
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
/* 原样式是整页全局写法（html/body/*），这里全部收进 .es-root，
   并把 position:fixed 改成 absolute —— 页面只是站点里的一块，不抢整页。 */
.es-root {
  --es-bg:#070b12; --es-panel:rgba(15,21,33,0.84); --es-border:rgba(120,160,220,0.18);
  --es-text:#e6edf6; --es-muted:#8aa0bd; --es-accent:#36d3ff;
  --es-good:#39e6a0; --es-warn:#ffcc4d; --es-alarm:#ff5470;

  position:relative; width:100%; height:min(88vh,880px); min-height:560px;
  overflow:hidden; border-radius:16px; background:var(--es-bg); color:var(--es-text);
  font-size:13px; -webkit-font-smoothing:antialiased;
}
.es-root :deep(*), .es-root { box-sizing:border-box; }
.es-root :deep(button){ font:inherit; cursor:pointer; color:var(--es-text); background:rgba(54,211,255,0.10);
  border:1px solid var(--es-border); padding:7px 12px; border-radius:8px; font-size:12px; transition:.15s; }
.es-root :deep(button:hover){ background:rgba(54,211,255,0.22); border-color:var(--es-accent); }
.es-root :deep(button.active){ background:var(--es-accent); color:#04121a; border-color:var(--es-accent); font-weight:600; }
.es-root :deep(button.danger.active){ background:var(--es-alarm); color:#fff; border-color:var(--es-alarm); }
.es-root :deep(input[type=range]){ accent-color:var(--es-accent); width:120px; }

.panel { background:var(--es-panel); backdrop-filter:blur(10px); border:1px solid var(--es-border);
  border-radius:12px; box-shadow:0 8px 30px rgba(0,0,0,0.45); }

/* 舞台 */
.stage { position:absolute; inset:0; z-index:0; }
.stage :deep(canvas){ display:block; width:100%; height:100%; }
.labels { position:absolute; inset:0; pointer-events:none; z-index:5; }
.hint { position:absolute; left:50%; top:96px; transform:translateX(-50%); z-index:8; margin:0;
  color:var(--es-muted); font-size:11px; background:rgba(8,12,20,0.6); padding:4px 12px;
  border-radius:20px; border:1px solid var(--es-border); white-space:nowrap; }

/* 浮动标签（引擎创建，靠 :deep 命中） */
.es-root :deep(.flabel){ position:absolute; z-index:5; pointer-events:none; transform:translate(-50%,-120%);
  background:rgba(8,12,20,0.82); border:1px solid var(--es-border); border-radius:7px; padding:3px 8px;
  font-size:11px; white-space:nowrap; box-shadow:0 4px 14px rgba(0,0,0,.5); transition:border-color .2s; }
.es-root :deep(.flabel b){ font-variant-numeric:tabular-nums; font-size:12.5px; }
.es-root :deep(.flabel .u){ color:var(--es-muted); font-size:10px; }
.es-root :deep(.flabel.focus){ box-shadow:0 0 14px var(--es-accent); border-color:var(--es-accent); }

/* 顶部 HUD */
.hud { position:absolute; top:12px; left:12px; right:12px; z-index:10; display:flex; gap:12px;
  align-items:stretch; padding:10px 14px; flex-wrap:wrap; }
.hud .brand { display:flex; flex-direction:column; justify-content:center; min-width:190px; }
.hud .brand b { font-size:16px; letter-spacing:.5px; color:#fff; }
.hud .brand b span { color:var(--es-accent); }
.hud .brand small { color:var(--es-muted); font-size:11px; }
.hud-block { display:flex; flex-direction:column; justify-content:center; padding:0 14px;
  border-left:1px solid var(--es-border); min-width:120px; }
.hud-block .k { color:var(--es-muted); font-size:10px; text-transform:uppercase; letter-spacing:.6px; }
.hud-block .v { font-size:18px; font-weight:600; color:#fff; font-variant-numeric:tabular-nums; }
.hud-actions { margin-left:auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.seg { display:flex; gap:4px; background:rgba(0,0,0,0.25); padding:4px; border-radius:9px; border:1px solid var(--es-border); }

/* 左侧 */
.side-left { position:absolute; left:12px; top:118px; bottom:68px; width:284px; z-index:10;
  display:flex; flex-direction:column; padding:10px; gap:8px; overflow:hidden; }
.side-title { font-size:11px; text-transform:uppercase; letter-spacing:.8px; color:var(--es-muted);
  padding:2px 4px; display:flex; justify-content:space-between; align-items:center; gap:8px; }
.side-title a { color:var(--es-accent); cursor:pointer; font-size:11px; text-transform:none; letter-spacing:0; }
.sensor-btns { display:flex; flex-wrap:wrap; gap:6px; padding:2px; }
.es-root :deep(.sbtn){ display:flex; align-items:center; gap:6px; padding:6px 9px; border-radius:9px; font-size:11px;
  background:rgba(255,255,255,0.04); border:1px solid var(--es-border); }
.es-root :deep(.sbtn .ic){ font-size:14px; line-height:1; }
.es-root :deep(.sbtn .lb){ font-weight:600; white-space:nowrap; }
.sensor-list { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:4px; }
.sensor-list::-webkit-scrollbar { width:6px; }
.sensor-list::-webkit-scrollbar-thumb { background:rgba(120,160,220,0.25); border-radius:3px; }
.es-root :deep(.card){ background:rgba(255,255,255,0.03); border:1px solid var(--es-border); border-radius:10px;
  padding:9px 10px; cursor:pointer; transition:.15s; position:relative; overflow:hidden; }
.es-root :deep(.card:hover){ background:rgba(54,211,255,0.07); }
.es-root :deep(.card.sel){ background:rgba(54,211,255,0.12); border-color:var(--es-accent); }
.es-root :deep(.card .row1){ display:flex; align-items:center; gap:8px; }
.es-root :deep(.dot){ width:9px; height:9px; border-radius:50%; flex:none; box-shadow:0 0 8px currentColor; }
.es-root :deep(.card .name){ font-weight:600; font-size:12.5px; }
.es-root :deep(.card .type){ font-size:10px; color:var(--es-muted); margin-left:auto; }
.es-root :deep(.card .row2){ display:flex; align-items:flex-end; justify-content:space-between; margin-top:4px; }
.es-root :deep(.card .val){ font-size:19px; font-weight:700; font-variant-numeric:tabular-nums; }
.es-root :deep(.card .val u){ font-size:11px; color:var(--es-muted); font-weight:400; text-decoration:none; margin-left:3px; }
.es-root :deep(.card canvas){ width:74px; height:30px; flex:none; }
.es-root :deep(.card .stat){ position:absolute; top:8px; right:10px; font-size:9px; letter-spacing:.5px;
  text-transform:uppercase; font-weight:700; opacity:.85; }

/* 进度 */
.progress { border-top:1px solid var(--es-border); padding-top:8px; flex:none; }
.pg-head { display:flex; align-items:baseline; justify-content:space-between;
  color:var(--es-muted); font-size:10px; letter-spacing:.8px; text-transform:uppercase; }
.pg-head b { color:var(--es-accent); font-size:14px; font-variant-numeric:tabular-nums; }
.pg-track { height:6px; margin-top:6px; border-radius:99px; background:rgba(120,160,220,0.16); overflow:hidden; }
.pg-fill { display:block; height:100%; border-radius:99px;
  background:linear-gradient(90deg,var(--es-accent),var(--es-good)); transition:width .3s ease; }
.pg-list { list-style:none; margin:7px 0 0; padding:0; display:flex; flex-direction:column; gap:3px; }
.pg-list li { display:flex; justify-content:space-between; gap:8px; color:var(--es-muted); font-size:10.5px; line-height:1.5; }
.pg-list li b { color:#fff; font-variant-numeric:tabular-nums; flex:none; }
.pg-list li.done { color:var(--es-good); }
.pg-list li.done b { color:var(--es-good); }

/* 右侧 */
.side-right { position:absolute; right:12px; top:118px; width:330px; z-index:10; display:flex; flex-direction:column; gap:12px; }
.detail { padding:12px; }
.detail .hd { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
.detail .hd h3 { font-size:15px; margin:0; }
.detail .hd .sub { color:var(--es-muted); font-size:11px; }
.detail #es-big-chart { width:100%; height:150px; display:block; border-radius:8px; background:rgba(0,0,0,0.25); }
.stats { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-top:10px; }
.stat-box { background:rgba(255,255,255,0.03); border:1px solid var(--es-border); border-radius:8px; padding:7px 6px; text-align:center; }
.stat-box .l { font-size:9px; color:var(--es-muted); text-transform:uppercase; letter-spacing:.4px; }
.stat-box .n { font-size:14px; font-weight:700; font-variant-numeric:tabular-nums; margin-top:2px; }
.thr { display:flex; justify-content:space-between; font-size:11px; color:var(--es-muted); margin-top:10px; }
.alerts { padding:10px 12px; max-height:200px; display:flex; flex-direction:column; }
#es-alert-log { overflow-y:auto; display:flex; flex-direction:column; gap:5px; margin-top:4px; }
#es-alert-log::-webkit-scrollbar { width:6px; }
#es-alert-log::-webkit-scrollbar-thumb { background:rgba(120,160,220,0.25); border-radius:3px; }
.es-root :deep(.alert){ font-size:11px; padding:5px 8px; border-radius:6px; border-left:3px solid var(--es-muted);
  background:rgba(255,255,255,0.03); display:flex; gap:8px; align-items:baseline; }
.es-root :deep(.alert .t){ color:var(--es-muted); font-variant-numeric:tabular-nums; flex:none; }
.es-root :deep(.alert.warn){ border-left-color:var(--es-warn); }
.es-root :deep(.alert.alarm){ border-left-color:var(--es-alarm); background:rgba(255,84,112,0.08); }
.es-root :deep(.alert.good){ border-left-color:var(--es-good); }

/* 底部 */
.bottom { position:absolute; left:308px; right:354px; bottom:12px; z-index:10; padding:8px 12px;
  display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
.bottom .grp { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.bottom .lab { font-size:10px; color:var(--es-muted); text-transform:uppercase; letter-spacing:.6px; margin-right:2px; }
#es-speed-val { color:var(--es-accent); font-weight:600; min-width:38px; display:inline-block; text-align:right; }
.legend { display:flex; gap:12px; margin-left:auto; font-size:11px; color:var(--es-muted); }
.legend i { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:4px; vertical-align:middle; }

/* 弹窗 */
#es-info-modal { position:absolute; inset:0; z-index:40; display:none; align-items:center; justify-content:center;
  background:rgba(3,6,12,0.62); backdrop-filter:blur(3px); }
.es-root :deep(.modal){ width:440px; max-width:92%; max-height:86%; overflow-y:auto; border-radius:16px;
  background:linear-gradient(180deg,#121a28,#0c121d); border:1px solid var(--es-border); box-shadow:0 20px 60px rgba(0,0,0,0.6); }
.es-root :deep(.modal .mh){ padding:16px 18px; display:flex; gap:14px; align-items:center;
  border-bottom:1px solid var(--es-border); background:rgba(54,211,255,0.06); }
.es-root :deep(.modal .mh .mic){ font-size:30px; }
.es-root :deep(.modal .mh h2){ font-size:18px; margin:0; }
.es-root :deep(.modal .mh .ms){ color:var(--es-muted); font-size:11px; margin-top:2px; }
.es-root :deep(.modal .mclose){ margin-left:auto; cursor:pointer; font-size:20px; color:var(--es-muted); line-height:1; padding:4px 8px; border-radius:8px; }
.es-root :deep(.modal .mclose:hover){ background:rgba(255,255,255,0.08); color:#fff; }
.es-root :deep(.modal .mb){ padding:16px 18px; }
.es-root :deep(.modal .mrow){ margin-bottom:14px; }
.es-root :deep(.modal .ml){ font-size:10px; text-transform:uppercase; letter-spacing:.7px; color:var(--es-accent); margin-bottom:4px; }
.es-root :deep(.modal .mv){ font-size:13px; line-height:1.55; color:#dbe6f2; }
.es-root :deep(.modal .live){ font-size:20px; font-weight:700; }
.es-root :deep(.modal .mtags){ display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
.es-root :deep(.modal .tag){ background:rgba(255,255,255,0.05); border:1px solid var(--es-border); border-radius:20px;
  padding:4px 11px; font-size:11px; color:var(--es-muted); }
.es-root :deep(.modal .tag b){ color:#fff; }
.err { position:absolute; z-index:50; left:50%; bottom:16px; transform:translateX(-50%);
  background:rgba(61,11,22,.94); color:#ffdce1; border:1px solid rgba(255,90,111,.7);
  padding:8px 12px; border-radius:10px; font-size:12px; margin:0; }

@media (max-width:1280px) {
  .side-right { display:none; }
  .bottom { right:12px; }
}
@media (max-width:900px) {
  .side-left { width:230px; top:150px; }
  .bottom { left:12px; }
}
</style>
