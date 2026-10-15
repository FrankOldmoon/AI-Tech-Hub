<script setup lang="ts">
/**
 * Quest Range —— WebXR 射击训练场（原生页面版）
 *
 * 由独立单文件页（Downloads/index.html）移植：
 *   - 场地/目标/手柄/射击这套 3D 逻辑住在 utils/vr-range/engine.ts
 *     （three 与 VRButton 走 npm 依赖，无 CDN）；
 *   - 这里只负责「静态外壳 markup + 按需挂载引擎 + 教学进度上报」。
 *
 * 移植要点：原版 HUD/帮助条是 position:fixed 铺满视口的，这里收进 .vr-root 改 absolute；
 * 会被引擎持续写入的节点（分数/时间/命中/命中率/消息条）不绑 Vue，交给引擎写；
 * 右侧进度面板由 onStat 每秒采样驱动，同时决定给宿主的 rate。
 */
import { createVRRange, type Lang, type VRRangeStats } from '~/utils/vr-range/engine'
import { reportCorrectRate } from '~/utils/embed-report'
import { pickText, type LocalizedText } from '~/utils/localized'

const APP_ID = 'vision/vr'

const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'vr')!)
const { locale } = useI18n()
const lang = computed<Lang>(() => (locale.value === 'zh' ? 'zh' : 'en'))
const pick = (o: LocalizedText) => pickText(o, lang.value)

const rootEl = ref<HTMLElement | null>(null)
const errorMsg = ref('')
let handle: ReturnType<typeof createVRRange> | null = null

/* ---------- 教学进度（上报用） ---------- */
const stats = ref<VRRangeStats>({
  score: 0,
  hits: 0,
  shots: 0,
  accuracy: null,
  remaining: 60,
  running: false,
  rounds: 0,
  bestScore: 0,
  bestAccuracy: null,
  totalHits: 0
})
const goldHit = ref(false)
const streakDone = ref(false)

const ACCURACY_GOAL = 60
const SCORE_GOAL = 200
const HITS_GOAL = 15

const tasks = computed(() => [
  {
    key: 'round',
    label: { zh: '完整打完一局（60 秒）', en: 'Play a full 60-second round' } as LocalizedText,
    done: Math.min(1, stats.value.rounds),
    total: 1,
    weight: 0.15
  },
  {
    key: 'score',
    label: { zh: `单局得分达到 ${SCORE_GOAL}`, en: `Score ${SCORE_GOAL} in a single round` } as LocalizedText,
    done: Math.min(SCORE_GOAL, stats.value.bestScore),
    total: SCORE_GOAL,
    weight: 0.25
  },
  {
    key: 'hits',
    label: { zh: `累计命中 ${HITS_GOAL} 个目标`, en: `Land ${HITS_GOAL} hits in total` } as LocalizedText,
    done: Math.min(HITS_GOAL, stats.value.totalHits),
    total: HITS_GOAL,
    weight: 0.15
  },
  {
    key: 'accuracy',
    label: { zh: `单局命中率 ≥ ${ACCURACY_GOAL}%（≥10 发）`, en: `Reach ${ACCURACY_GOAL}% accuracy in a round (10+ shots)` } as LocalizedText,
    done: Math.round(ACCURACY_GOAL * (stats.value.bestAccuracy ?? 0)),
    total: ACCURACY_GOAL,
    weight: 0.15
  },
  {
    key: 'gold',
    label: { zh: '打中一个金色高分靶（+20）', en: 'Hit a gold bonus target (+20)' } as LocalizedText,
    done: goldHit.value ? 1 : 0,
    total: 1,
    weight: 0.15
  },
  {
    key: 'streak',
    label: { zh: '2.5 秒内连中 3 个目标', en: 'Hit 3 targets within 2.5 s' } as LocalizedText,
    done: streakDone.value ? 1 : 0,
    total: 1,
    weight: 0.15
  }
])

const rate = computed(() => tasks.value.reduce((acc, t) => acc + t.weight * Math.min(1, t.done / t.total), 0))
const finished = computed(() => rate.value >= 0.999)

function onTask(task: string) {
  if (task === 'gold') goldHit.value = true
  else if (task === 'streak') streakDone.value = true
}

/** 上报契约：parent.postMessage({ type:'correct_rate', rate, ... })，详见 utils/embed-report.ts */
watch([rate, finished], () => {
  reportCorrectRate({
    app: APP_ID,
    rate: rate.value,
    finished: finished.value,
    locale: locale.value,
    extra: {
      rounds: stats.value.rounds,
      bestScore: stats.value.bestScore,
      bestAccuracy: stats.value.bestAccuracy === null ? null : Math.round(stats.value.bestAccuracy * 100) / 100,
      totalHits: stats.value.totalHits,
      goldHit: goldHit.value,
      streak: streakDone.value
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
    handle = createVRRange(root, {
      getLocale: () => lang.value,
      onTask,
      onStat: (s) => {
        stats.value = s
      }
    })
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  }
}

function restart() {
  handle?.restart()
}

onMounted(mount)
onBeforeUnmount(unmount)

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
    console.warn('[vision/vr] requestFullscreen failed', err)
  }
}

function syncFullscreenState() {
  isFullscreen.value = !!document.fullscreenElement
}
onMounted(() => document.addEventListener('fullscreenchange', syncFullscreenState))
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreenState)
  // 离开页面别把浏览器留在全屏里
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
})

/* ---------- 进度面板的静态元数据 ---------- */
const accuracyText = computed(() =>
  stats.value.accuracy === null ? '—' : `${Math.round(stats.value.accuracy * 100)}%`)
const bestAccuracyText = computed(() =>
  stats.value.bestAccuracy === null ? '—' : `${Math.round(stats.value.bestAccuracy * 100)}%`)

const sessionStats = computed(() => [
  { l: { zh: '本局得分', en: 'Round Score' } as LocalizedText, n: String(stats.value.score) },
  { l: { zh: '本局命中', en: 'Round Hits' } as LocalizedText, n: `${stats.value.hits}/${stats.value.shots}` },
  { l: { zh: '本局命中率', en: 'Round Acc.' } as LocalizedText, n: accuracyText.value },
  { l: { zh: '完整局数', en: 'Rounds' } as LocalizedText, n: String(stats.value.rounds) },
  { l: { zh: '最佳得分', en: 'Best Score' } as LocalizedText, n: String(stats.value.bestScore) },
  { l: { zh: '最佳命中率', en: 'Best Acc.' } as LocalizedText, n: bestAccuracyText.value }
])
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div
      ref="rootEl"
      class="vr-root"
    >
      <div
        id="vr-stage"
        class="stage"
      >
        <canvas id="vr-canvas" />
        <!-- VRButton 由引擎插入这里 -->
        <div
          id="vr-xr-slot"
          class="xr-slot"
        />
      </div>

      <!-- 顶部 HUD -->
      <div
        id="vr-hud"
        class="panel hud"
      >
        <div class="brand">
          <b>QUEST RANGE</b>
          <small>{{ pick({ zh: 'WEBXR 射击训练场', en: 'WEBXR TRAINING' }) }}</small>
        </div>
        <div class="stats">
          <div>
            <small>{{ pick({ zh: '得分', en: 'SCORE' }) }}</small>
            <strong id="vr-score">0000</strong>
          </div>
          <div>
            <small>{{ pick({ zh: '时间', en: 'TIME' }) }}</small>
            <strong id="vr-time">60</strong>
          </div>
          <div>
            <small>{{ pick({ zh: '命中', en: 'HITS' }) }}</small>
            <strong id="vr-hits">0</strong>
          </div>
          <div>
            <small>{{ pick({ zh: '命中率', en: 'ACCURACY' }) }}</small>
            <strong id="vr-accuracy">—</strong>
          </div>
        </div>
        <div class="hud-actions">
          <button
            id="vr-btn-fs"
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
        </div>
      </div>

      <!-- 消息条（引擎写） -->
      <div
        id="vr-message"
        class="message"
      >
        —
      </div>

      <!-- 桌面帮助 -->
      <div
        id="vr-help"
        class="panel help"
      >
        <strong>{{ pick({ zh: '桌面预览', en: 'DESKTOP PREVIEW' }) }}</strong>
        <span>{{ pick({ zh: '鼠标转视角 · 点击开火 · WASD 移动 · R 重开', en: 'Mouse: look around · Click: fire · WASD: move · R: restart' }) }}</span>
        <span>{{ pick({ zh: 'Quest 一体机：进入 VR 后用任一手柄瞄准，扣扳机开火。', en: 'On Quest: enter VR, aim either controller, squeeze trigger to fire.' }) }}</span>
      </div>

      <!-- 右侧：战况 + 教学进度（同时决定给宿主的 rate） -->
      <div
        id="vr-side"
        class="panel side"
      >
        <div class="side-title">
          {{ pick({ zh: '战况', en: 'Session' }) }}
        </div>
        <div class="stats-grid">
          <div
            v-for="s in sessionStats"
            :key="s.l.en"
            class="stat-box"
          >
            <div class="l">
              {{ pick(s.l) }}
            </div>
            <div class="n">
              {{ s.n }}
            </div>
          </div>
        </div>
        <button
          id="vr-btn-restart"
          type="button"
          @click="restart"
        >
          ↺ {{ pick({ zh: '重开一局', en: 'Restart Round' }) }}
        </button>

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
/* 原样式是整页全局写法，这里收进 .vr-root，并把 position:fixed 改成 absolute */
.vr-root {
  --vr-bg:#101827; --vr-panel:#0a1224cc; --vr-border:#ffffff20; --vr-border-strong:#8be9ff55;
  --vr-text:#eff6ff; --vr-muted:#a5b4c8; --vr-accent:#6ee7f9;

  position:relative; width:100%; height:min(88vh,880px); min-height:560px;
  overflow:hidden; border-radius:16px; background:var(--vr-bg); color:var(--vr-text);
  font-size:13px; -webkit-font-smoothing:antialiased;
}
.vr-root :deep(*), .vr-root { box-sizing:border-box; }
.panel { background:var(--vr-panel); backdrop-filter:blur(10px); border:1px solid var(--vr-border);
  border-radius:12px; box-shadow:0 8px 30px rgba(0,0,0,0.35); }

.stage { position:absolute; inset:0; z-index:0; }
.stage :deep(canvas) { display:block; width:100%; height:100%; touch-action:none; }
.xr-slot { position:absolute; inset:0; z-index:20; pointer-events:none; }
.xr-slot :deep(button), .xr-slot :deep(a) { pointer-events:auto; text-decoration:none; }

/* VRButton 官方内联样式 → 品牌化覆盖 */
.xr-slot :deep(button), .xr-slot :deep(a) {
  width:auto !important; left:50% !important; transform:translateX(-50%);
  bottom:18px; padding:11px 22px; border:1px solid var(--vr-border-strong) !important;
  border-radius:99px !important; background:#08111bcc !important; color:#d8f8ff !important;
  font:600 13px/1 Inter, ui-sans-serif, system-ui, sans-serif !important;
  letter-spacing:.08em; opacity:1 !important; cursor:pointer;
  transition:.15s; box-shadow:0 0 0 rgba(110,231,249,0);
}
.xr-slot :deep(button:hover), .xr-slot :deep(a:hover) {
  border-color:var(--vr-accent) !important;
  box-shadow:0 0 18px rgba(110,231,249,.35);
}

/* HUD */
.hud { position:absolute; top:12px; left:12px; right:12px; z-index:10; display:flex; gap:14px;
  align-items:stretch; padding:10px 14px; flex-wrap:wrap; pointer-events:auto; }
.brand { display:flex; flex-direction:column; justify-content:center; min-width:150px; }
.brand b { font-size:15px; font-weight:900; letter-spacing:.16em; color:#fff; white-space:nowrap; }
.brand small { margin-top:5px; color:var(--vr-accent); font-size:9px; letter-spacing:.22em; }
.stats { display:flex; gap:clamp(12px, 3vw, 32px); margin-left:auto; }
.stats > div { min-width:48px; text-align:right; }
.stats small { display:block; font-size:9px; color:var(--vr-muted); letter-spacing:.15em; }
.stats strong { display:block; margin-top:3px; font-size:clamp(18px, 2.4vw, 26px); font-variant-numeric:tabular-nums; color:#fff; }
.hud-actions { display:flex; align-items:center; }
.fsbtn { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; padding:0; flex:none;
  cursor:pointer; color:var(--vr-text); background:rgba(110,231,249,0.10); border:1px solid var(--vr-border); border-radius:8px; transition:.15s; }
.fsbtn:hover { background:rgba(110,231,249,0.22); border-color:var(--vr-accent); }
.fsbtn svg { width:15px; height:15px; }
.vs-fullscreen, .vr-root:fullscreen { height:100vh; min-height:0; border-radius:0; }
.vr-root:-webkit-full-screen { height:100vh; min-height:0; border-radius:0; }

/* 消息条 */
.message { position:absolute; top:86px; left:50%; transform:translateX(-50%); z-index:9; padding:10px 15px;
  border:1px solid var(--vr-border-strong); border-radius:99px; background:#08111bcc; color:#d8f8ff;
  font-size:12px; letter-spacing:.04em; white-space:nowrap; max-width:calc(100% - 32px);
  overflow:hidden; text-overflow:ellipsis; }

/* 桌面帮助 */
.help { position:absolute; left:16px; bottom:16px; z-index:8; display:grid; gap:4px;
  max-width:min(320px, calc(100% - 32px)); padding:12px 14px; color:#cbd5e1; font-size:11px; pointer-events:none; }
.help strong { color:var(--vr-accent); font-size:10px; letter-spacing:.15em; }

/* 右侧 */
.side { position:absolute; right:12px; top:84px; bottom:16px; width:272px; z-index:10;
  display:flex; flex-direction:column; gap:10px; padding:12px; overflow-y:auto; }
.side-title { font-size:11px; text-transform:uppercase; letter-spacing:.8px; color:var(--vr-muted); padding:0 2px; }
.stats-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
.stat-box { background:rgba(255,255,255,0.04); border:1px solid var(--vr-border); border-radius:8px; padding:8px 4px; text-align:center; }
.stat-box .l { font-size:8.5px; color:var(--vr-muted); letter-spacing:.3px; }
.stat-box .n { font-size:14px; font-weight:700; font-variant-numeric:tabular-nums; color:#fff; margin-top:2px; }
#vr-btn-restart { cursor:pointer; color:var(--vr-text); background:rgba(110,231,249,0.10); border:1px solid var(--vr-border);
  padding:7px 12px; border-radius:8px; font-size:12px; transition:.15s; }
#vr-btn-restart:hover { background:rgba(110,231,249,0.22); border-color:var(--vr-accent); }

/* 进度 */
.progress { border-top:1px solid var(--vr-border); padding-top:8px; }
.pg-head { display:flex; align-items:baseline; justify-content:space-between;
  color:var(--vr-muted); font-size:10px; letter-spacing:.8px; text-transform:uppercase; }
.pg-head b { color:var(--vr-accent); font-size:14px; font-variant-numeric:tabular-nums; }
.pg-track { height:6px; margin-top:6px; border-radius:99px; background:rgba(120,160,220,0.16); overflow:hidden; }
.pg-fill { display:block; height:100%; border-radius:99px;
  background:linear-gradient(90deg,var(--vr-accent),#62f2c2); transition:width .3s ease; }
.pg-list { list-style:none; margin:7px 0 0; padding:0; display:flex; flex-direction:column; gap:3px; }
.pg-list li { display:flex; justify-content:space-between; gap:8px; color:var(--vr-muted); font-size:10.5px; line-height:1.5; }
.pg-list li b { color:#fff; font-variant-numeric:tabular-nums; flex:none; }
.pg-list li.done { color:#62f2c2; }
.pg-list li.done b { color:#62f2c2; }

.err { position:absolute; z-index:50; left:50%; bottom:16px; transform:translateX(-50%);
  background:rgba(61,11,22,.94); color:#ffdce1; border:1px solid rgba(255,90,111,.7);
  padding:8px 12px; border-radius:10px; font-size:12px; margin:0; }

/* 进入 VR 后 DOM 不可见，但保持与原版一致：隐藏 HUD/帮助/消息条/侧栏 */
.vr-root.in-vr .hud, .vr-root.in-vr .message, .vr-root.in-vr .help, .vr-root.in-vr .side { display:none; }

@media (max-width:1100px) {
  .side { display:none; }
}
@media (max-width:620px) {
  .hud { padding:8px 10px; gap:8px; }
  .brand { min-width:0; }
  .brand b { font-size:12px; }
  .brand small { font-size:8px; }
  .stats { gap:12px; }
  .stats > div { min-width:36px; }
  .stats strong { font-size:17px; }
  .message { top:110px; font-size:10px; }
  .help { font-size:10px; }
}
</style>
