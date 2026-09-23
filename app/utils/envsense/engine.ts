/**
 * EnvSense 多传感器环境监测仿真 —— 3D 引擎。
 *
 * 从独立单文件页（Downloads/1.html）移植：
 *   - three.js 场景图、7 个传感器建模、环境因子模拟、告警判定、图表绘制
 *     这套命令式逻辑保持原样（three 场景图本来就该命令式写）；
 *   - 只把「自己造整页 DOM + 全局 fixed 定位 + document.getElementById」换成
 *     「由调用方传入页面根节点，引擎在根节点内按 id / data-* 取节点」，
 *     于是它能在 Nuxt 页里按需挂载、卸载，也不再把 HUD 铺满整个浏览器视口。
 *
 * 依赖全部走 npm（`import * as THREE from 'three'`），页面里没有任何 CDN 引用。
 *
 * 两处与原版不同的实现细节：
 *   1. 浮动标签由引擎 append 到调用方给的标签层（原先挂 document.body 用 fixed
 *      定位，现在挂舞台内用 absolute 定位，标签被裁在舞台里才合理）；
 *   2. 相机/渲染尺寸跟随舞台容器（ResizeObserver），而不是 window。
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/* =========================================================
   类型
   ========================================================= */

export type Weather = 'Clear' | 'Cloudy' | 'Rain'
export type SensorStatus = 'good' | 'warn' | 'alarm'
export type ScenarioKey = 'heat' | 'occupancy' | 'fault'
export type Lang = 'zh' | 'en'

export interface LocalizedText {
  zh: string
  en: string
}

/** 页面模板渲染传感器卡片/按钮用的静态元数据（不含模拟状态） */
export interface SensorMeta {
  id: string
  name: LocalizedText
  type: LocalizedText
  unit: string
  icon: string
  /** 3D 模型上指示灯的基色（十六进制色号） */
  color: string
}

export interface EnvSenseOptions {
  /** 语言取值器：告警文案与弹窗内容跟着站点语言走 */
  getLocale: () => Lang
  /** 完成一次教学交互（打开某个传感器详情 / 触发某个场景）时回调，进度统计归宿主 */
  onTask?: (task: string) => void
}

export interface EnvSenseHandle {
  /** 卸载：离开页面时必须调用，否则 RAF 与 WebGL 上下文会泄漏 */
  dispose: () => void
  setPlaying: (playing: boolean) => void
  isPlaying: () => boolean
  setSpeed: (speed: number) => void
  setWeather: (weather: Weather) => void
  toggleScenario: (key: ScenarioKey) => boolean
  isScenarioOn: (key: ScenarioKey) => boolean
  triggerIrrigate: () => void
  selectSensor: (id: string) => void
  focusSensor: (id: string, openModal?: boolean) => void
  getSelectedId: () => string
  exportCsv: () => void
}

/* =========================================================
   传感器定义（双语教学文案）
   ========================================================= */

interface SensorDef {
  id: string
  name: LocalizedText
  type: LocalizedText
  unit: string
  icon: string
  /** [x, y, z] —— 世界坐标，y 是「灯头」高度 */
  pos: [number, number, number]
  color: number
  warnLo: number | null
  warnHi: number | null
  alarmLo: number | null
  alarmHi: number | null
  base: number
  amp: number
  desc: LocalizedText
  principle: LocalizedText
  range: string
  use: LocalizedText
  warnTxt: string
  alarmTxt: string
}

const SENSOR_DEFS: SensorDef[] = [
  {
    id: 'T1',
    name: { zh: '空气温度', en: 'Air Temperature' },
    type: { zh: '温度', en: 'Temperature' },
    unit: '°C',
    icon: '🌡️',
    pos: [-5, 3.4, -5],
    color: 0xff7a59,
    warnLo: 16, warnHi: 28, alarmLo: 10, alarmHi: 33,
    base: 22, amp: 5,
    desc: {
      zh: '测量监测区内的空气温度——这是舒适度、作物生长和设备负载最核心的气候变量。',
      en: 'Measures the ambient air temperature of the monitored zone — the single most important climate variable for comfort, crop growth and equipment load.'
    },
    principle: {
      zh: 'NTC 热敏电阻的阻值随温度变化，控制器据此换算出 °C 读数，精度约 ±0.3 °C。',
      en: 'An NTC thermistor changes resistance with temperature; the controller converts this to a °C reading with ±0.3 °C accuracy.'
    },
    range: '−40 … +80 °C',
    use: { zh: '暖通空调控制、温室气候、冷链', en: 'HVAC control, greenhouse climate, cold chain' },
    warnTxt: '16–28 °C',
    alarmTxt: '<10 或 >33 °C'
  },
  {
    id: 'H1',
    name: { zh: '相对湿度', en: 'Relative Humidity' },
    type: { zh: '湿度', en: 'Humidity' },
    unit: '%',
    icon: '💧',
    pos: [5, 3.2, 5],
    color: 0x59b0ff,
    warnLo: 30, warnHi: 70, alarmLo: 20, alarmHi: 85,
    base: 50, amp: 15,
    desc: {
      zh: '跟踪空气在当前位置能容纳多少水汽的相对比例。',
      en: 'Tracks how much water vapour the air holds relative to the saturation point at the current temperature.'
    },
    principle: {
      zh: '电容式高分子薄膜吸收水分后电容改变，传感器据此输出 %RH。',
      en: 'A capacitive polymer film changes capacitance with absorbed moisture; the sensor outputs %RH.'
    },
    range: '0 … 100 %RH',
    use: { zh: '防霉、植物蒸腾、仓储', en: 'Mould prevention, plant transpiration, storage' },
    warnTxt: '30–70 %',
    alarmTxt: '<20 或 >85 %'
  },
  {
    id: 'C1',
    name: { zh: '二氧化碳浓度', en: 'CO₂ Concentration' },
    type: { zh: '二氧化碳', en: 'CO₂' },
    unit: 'ppm',
    icon: '🟢',
    pos: [0, 4.2, 0],
    color: 0xa98bff,
    warnLo: null, warnHi: 800, alarmLo: null, alarmHi: 1200,
    base: 420, amp: 0,
    desc: {
      zh: '监测二氧化碳浓度——通风质量的关键指标；在温室里它同时反映植物的光合速率。',
      en: 'Monitors carbon-dioxide level, a key indicator of ventilation quality and — in a greenhouse — of plant photosynthesis rate.'
    },
    principle: {
      zh: 'NDIR（非色散红外）气室测量 CO₂ 在 4.26 µm 处吸收的光强，换算成 ppm。',
      en: 'An NDIR (non-dispersive infrared) cell measures light absorbed by CO₂ at 4.26 µm and returns ppm.'
    },
    range: '400 … 5000 ppm',
    use: { zh: '室内空气质量、光合增施、在室人数估计', en: 'IAQ, photosynthesis enrichment, occupancy' },
    warnTxt: '>800 ppm',
    alarmTxt: '>1200 ppm'
  },
  {
    id: 'L1',
    name: { zh: '光照强度', en: 'Light Intensity' },
    type: { zh: '照度', en: 'Illuminance' },
    unit: 'lux',
    icon: '☀️',
    pos: [-6, 5.5, 4],
    color: 0xffd24d,
    warnLo: null, warnHi: null, alarmLo: null, alarmHi: null,
    base: 0, amp: 0,
    desc: {
      zh: '记录日照与人工照明带来的环境照度——也就是植物光合能拿到的能量（DLI）。',
      en: 'Records ambient illuminance from sunlight and artificial lighting — the energy available for photosynthesis (DLI).'
    },
    principle: {
      zh: '硅光电二极管产生与入射光通量成正比的电流，以 lux 表示。',
      en: 'A silicon photodiode produces a current proportional to incident luminous flux, reported in lux.'
    },
    range: '0 … 120 000 lux',
    use: { zh: '日光采集、光周期控制', en: 'Daylight harvesting, photo-period control' },
    warnTxt: '—',
    alarmTxt: '—'
  },
  {
    id: 'P1',
    name: { zh: 'PM2.5 空气质量', en: 'PM2.5 Air Quality' },
    type: { zh: '颗粒物', en: 'Particulate' },
    unit: 'µg/m³',
    icon: '🌫️',
    pos: [6, 3.6, -4],
    color: 0x4dd0b0,
    warnLo: null, warnHi: 75, alarmLo: null, alarmHi: 150,
    base: 20, amp: 0,
    desc: {
      zh: '估算细颗粒物（≤2.5 µm）浓度——对健康危害最大的那一档，也是粉尘与污染的标志。',
      en: 'Estimates concentration of fine particulate matter (≤2.5 µm) — the most harmful fraction for health and a sign of dust/pollution.'
    },
    principle: {
      zh: '激光照射空气中的颗粒产生散射，散射光强换算为质量浓度。',
      en: 'A laser scatters light off airborne particles; the scattered intensity is converted to mass concentration.'
    },
    range: '0 … 500 µg/m³',
    use: { zh: '空气质量指数、过滤控制', en: 'Air-quality Index, filtration control' },
    warnTxt: '>75 µg/m³',
    alarmTxt: '>150 µg/m³'
  },
  {
    id: 'N1',
    name: { zh: '环境噪声', en: 'Ambient Noise' },
    type: { zh: '声音', en: 'Sound' },
    unit: 'dB',
    icon: '🔊',
    pos: [-4, 2.8, 6],
    color: 0xff8fc8,
    warnLo: null, warnHi: 60, alarmLo: null, alarmHi: 80,
    base: 35, amp: 0,
    desc: {
      zh: '测量背景声压级，用来发现异常活动、机械故障或舒适性问题。',
      en: 'Measures background sound pressure level to detect abnormal activity, machinery faults or comfort issues.'
    },
    principle: {
      zh: '标定过的 MEMS 麦克风采集声压级，输出 A 计权分贝 dB(A)。',
      en: 'A calibrated MEMS microphone captures SPL and reports A-weighted decibels (dB(A)).'
    },
    range: '30 … 120 dB(A)',
    use: { zh: '在室率、故障检测、舒适度', en: 'Occupancy, fault detection, comfort' },
    warnTxt: '>60 dB',
    alarmTxt: '>80 dB'
  },
  {
    id: 'S1',
    name: { zh: '土壤水分', en: 'Soil Moisture' },
    type: { zh: '土壤', en: 'Soil' },
    unit: '%',
    icon: '🌱',
    pos: [4, 1.2, 5],
    color: 0x8bd45a,
    warnLo: 30, warnHi: 80, alarmLo: 15, alarmHi: 92,
    base: 45, amp: 0,
    desc: {
      zh: '读取根区的体积含水率，只在植物真的需要时才触发灌溉。',
      en: 'Reads volumetric water content in the root zone so irrigation is triggered only when the plants actually need it.'
    },
    principle: {
      zh: '电容式（或 FDR）探头测量土壤介电常数，含水量越高介电常数越大。',
      en: 'A capacitive (or FDR) probe measures the dielectric constant of the soil, which rises with water content.'
    },
    range: '0 … 100 %VWC',
    use: { zh: '智能灌溉、节水', en: 'Smart irrigation, water saving' },
    warnTxt: '30–80 %',
    alarmTxt: '<15 或 >92 %'
  }
]

/** 页面模板渲染卡片/按钮用的静态元数据 */
export const ENVSENSE_SENSORS: SensorMeta[] = SENSOR_DEFS.map(s => ({
  id: s.id,
  name: s.name,
  type: s.type,
  unit: s.unit,
  icon: s.icon,
  color: `#${s.color.toString(16).padStart(6, '0')}`
}))

/** 底部场景按钮的静态元数据（domId 与页面模板一一对应，引擎按它挂事件） */
export interface ScenarioAction {
  id: string
  domId: string
  icon: string
  label: LocalizedText
  /** 开关型场景（热浪/在室/故障）可切换；灌溉是脉冲动作，不可切换 */
  toggle: boolean
}

export const ENVSENSE_ACTIONS: ScenarioAction[] = [
  { id: 'heat', domId: 'es-sc-heat', icon: '🔥', label: { zh: '热浪', en: 'Heatwave' }, toggle: true },
  { id: 'occupancy', domId: 'es-sc-occ', icon: '👥', label: { zh: '人员涌入', en: 'Occupancy' }, toggle: true },
  { id: 'fault', domId: 'es-sc-fault', icon: '⚠', label: { zh: 'CO₂ 通风故障', en: 'CO₂ Fault' }, toggle: true },
  { id: 'irrigate', domId: 'es-sc-irrig', icon: '💧', label: { zh: '灌溉脉冲', en: 'Irrigate' }, toggle: false }
]

/* =========================================================
   常量
   ========================================================= */

const STATUS_COLOR: Record<SensorStatus, number> = { good: 0x39e6a0, warn: 0xffcc4d, alarm: 0xff5470 }
const STATUS_CSS: Record<SensorStatus, string> = { good: '#39e6a0', warn: '#ffcc4d', alarm: '#ff5470' }
const MAX_HIST = 160
const W = 16, D = 16, H = 7

/** 一次模拟里的传感器运行时状态 */
interface SensorRuntime extends SensorDef {
  value: number
  status: SensorStatus
  lastStatus: SensorStatus
  history: { t: number, v: number }[]
  mesh?: THREE.Group
  head?: THREE.Mesh
  headMat?: THREE.MeshStandardMaterial
  ring?: THREE.Mesh
  ringMat?: THREE.MeshBasicMaterial
  halo?: THREE.Mesh
  beam?: THREE.Mesh
  labelY: number
  label?: HTMLElement
  labelNum?: HTMLElement
  btn?: HTMLElement
  card?: HTMLElement
  cardNum?: HTMLElement
  cardDot?: HTMLElement
  cardStat?: HTMLElement
  cardChart?: HTMLCanvasElement
  cardCtx?: CanvasRenderingContext2D
}

const pick = (t: LocalizedText, lang: Lang) => t[lang] ?? t.en

/* =========================================================
   引擎
   ========================================================= */

export function createEnvSense(root: HTMLElement, options: EnvSenseOptions): EnvSenseHandle {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector('#' + id) as T | null

  const stage = $('es-stage')
  const canvas = $<HTMLCanvasElement>('es-canvas')
  const labelsEl = $('es-labels')
  if (!stage || !canvas || !labelsEl) throw new Error('EnvSense: 舞台节点缺失（#es-stage / #es-canvas / #es-labels）')

  const lang = () => options.getLocale()
  const sensors: SensorRuntime[] = SENSOR_DEFS.map(def => ({
    ...def,
    value: def.base,
    status: 'good' as SensorStatus,
    lastStatus: 'good' as SensorStatus,
    history: [] as { t: number, v: number }[],
    labelY: 0
  }))
  const byId = (id: string) => sensors.find(s => s.id === id)

  let selected = sensors[0]!
  let focused: SensorRuntime | null = null
  let disposed = false
  let rafId = 0

  /* ---------- 渲染器 / 场景 / 相机 ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new THREE.Scene()
  const bgColor = new THREE.Color(0x0a0e17)
  scene.background = bgColor
  scene.fog = new THREE.Fog(0x0a0e17, 34, 110)

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600)
  camera.position.set(20, 15, 24)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.target.set(0, 2.5, 0)
  controls.maxPolarAngle = Math.PI * 0.49
  controls.minDistance = 8
  controls.maxDistance = 80

  /* ---------- 灯光 ---------- */
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x2a3320, 0.6)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff2cc, 1.4)
  sun.position.set(20, 30, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -34
  sun.shadow.camera.right = 34
  sun.shadow.camera.top = 34
  sun.shadow.camera.bottom = -34
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 140
  sun.shadow.bias = -0.0004
  scene.add(sun)
  scene.add(sun.target)
  const ambient = new THREE.AmbientLight(0x405070, 0.35)
  scene.add(ambient)
  const fill = new THREE.PointLight(0x88aaff, 0, 120, 1.5)
  scene.add(fill)

  function glowTexture(inner: string, outer: string) {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const x = c.getContext('2d')!
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, inner)
    g.addColorStop(0.28, outer)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = g
    x.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(c)
  }
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,244,210,1)', 'rgba(255,210,140,0.7)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  sunGlow.scale.set(12, 12, 1)
  scene.add(sunGlow)
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(220,230,255,1)', 'rgba(150,175,255,0.6)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  moonGlow.scale.set(7, 7, 1)
  scene.add(moonGlow)
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 24), new THREE.MeshBasicMaterial({ color: 0xffe39a }))
  scene.add(sunMesh)
  const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 24), new THREE.MeshBasicMaterial({ color: 0xcdd6ff }))
  scene.add(moonMesh)

  /* ---------- 星空 ---------- */
  const starGeo = new THREE.BufferGeometry()
  const starN = 900
  const sp = new Float32Array(starN * 3)
  for (let i = 0; i < starN; i++) {
    const r = 90, u = Math.random(), v = Math.random()
    const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1)
    sp[i * 3] = r * Math.sin(ph) * Math.cos(th)
    sp[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.9 + 8
    sp[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th)
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3))
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true, opacity: 0, depthWrite: false })
  const stars = new THREE.Points(starGeo, starMat)
  scene.add(stars)

  /* ---------- 地面 / 围栏 / 道具 ---------- */
  function groundTexture() {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const x = c.getContext('2d')!
    x.fillStyle = '#16241c'
    x.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 2200; i++) {
      const a = Math.random() * 0.12
      x.fillStyle = `rgba(${30 + Math.random() * 40 | 0},${90 + Math.random() * 60 | 0},${50 + Math.random() * 40 | 0},${a})`
      x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
    }
    x.strokeStyle = 'rgba(80,120,90,0.18)'
    x.lineWidth = 1
    for (let i = 0; i <= 256; i += 32) {
      x.beginPath()
      x.moveTo(i, 0)
      x.lineTo(i, 256)
      x.stroke()
      x.beginPath()
      x.moveTo(0, i)
      x.lineTo(256, i)
      x.stroke()
    }
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(10, 10)
    return t
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(42, 72), new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  const grid = new THREE.GridHelper(64, 64, 0x2a3a55, 0x16223a)
  grid.position.y = 0.02
  ;(grid.material as THREE.Material).opacity = 0.35
  ;(grid.material as THREE.Material).transparent = true
  scene.add(grid)

  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0, transmission: 0.6, side: THREE.DoubleSide })
  function glass(w: number, h: number, x: number, y: number, z: number, ry: number) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat)
    m.position.set(x, y, z)
    m.rotation.y = ry
    scene.add(m)
  }
  glass(W, H, 0, H / 2, -D / 2, 0)
  glass(W, H, 0, H / 2, D / 2, 0)
  glass(D, H, -W / 2, H / 2, 0, Math.PI / 2)
  glass(D, H, W / 2, H / 2, 0, Math.PI / 2)
  const postMat = new THREE.MeshStandardMaterial({ color: 0x536480, metalness: 0.6, roughness: 0.4 })
  ;[[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]].forEach(([px, pz]) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, H, 12), postMat)
    p.position.set(px!, H / 2, pz!)
    p.castShadow = true
    scene.add(p)
  })
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x6f86a8, metalness: 0.6, roughness: 0.4 })
  function topBeam(w: number, x: number, y: number, z: number, ry: number) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, 0.18), beamMat)
    m.position.set(x, y, z)
    m.rotation.y = ry
    m.castShadow = true
    scene.add(m)
  }
  topBeam(W, 0, H, -D / 2, 0)
  topBeam(W, 0, H, D / 2, 0)
  topBeam(D, -W / 2, H, 0, Math.PI / 2)
  topBeam(D, W / 2, H, 0, Math.PI / 2)

  function plant(x: number, z: number, s: number) {
    const g = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.10 * s, 0.16 * s, 1.2 * s, 10), new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 1 }))
    trunk.position.y = 0.6 * s
    trunk.castShadow = true
    g.add(trunk)
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f9d4a, roughness: 0.85 })
    const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.85 })
    const blobs: [number, number, number, number][] = [[0, 1.5, 0, 0.8], [0.4, 1.9, 0.2, 0.55], [-0.35, 1.8, -0.2, 0.5], [0.1, 2.2, -0.25, 0.45], [-0.15, 2.0, 0.35, 0.5]]
    blobs.forEach(([bx, by, bz, br], i) => {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(br * s, 1), i % 2 ? leafMat2 : leafMat)
      b.position.set(bx * s, by * s, bz * s)
      b.castShadow = true
      g.add(b)
    })
    g.position.set(x, 0, z)
    scene.add(g)
  }
  plant(-5, -5, 1.1)
  plant(-2.5, -5, 0.85)
  plant(4, 5, 1.2)
  plant(6, 2, 0.95)
  plant(-6, 4, 0.9)
  plant(-4, 6, 0.8)

  const acG = new THREE.Group()
  const acBody = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.5, 1.3), new THREE.MeshStandardMaterial({ color: 0xd7dee8, metalness: 0.5, roughness: 0.4 }))
  acBody.position.y = 4.6
  acBody.castShadow = true
  acG.add(acBody)
  const acGrilleMat = new THREE.MeshStandardMaterial({ color: 0x2a3340, metalness: 0.4, roughness: 0.6 })
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.06), acGrilleMat)
    b.position.set(0, 4.25 + i * 0.18, 0.66)
    acG.add(b)
  }
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshStandardMaterial({ color: 0x1c2530, metalness: 0.6, roughness: 0.4 }))
  fan.position.set(0, 4.6, 0.661)
  acG.add(fan)
  acG.position.set(-W / 2 + 1.4, 0, -D / 2 + 1)
  scene.add(acG)

  const tankG = new THREE.Group()
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 2.4, 24), new THREE.MeshStandardMaterial({ color: 0x3f78b5, metalness: 0.35, roughness: 0.45 }))
  tank.position.y = 1.2
  tank.castShadow = true
  tankG.add(tank)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.2, 24), new THREE.MeshStandardMaterial({ color: 0x9fb4c9, metalness: 0.6, roughness: 0.3 }))
  cap.position.y = 2.45
  tankG.add(cap)
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 12), postMat)
  pipe.rotation.z = Math.PI / 2
  pipe.position.set(-1.0, 0.4, 0)
  tankG.add(pipe)
  tankG.position.set(6, 0, 6)
  scene.add(tankG)

  const solarG = new THREE.Group()
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 1.4), new THREE.MeshStandardMaterial({ color: 0x0b2a4a, metalness: 0.7, roughness: 0.25, emissive: 0x081f38, emissiveIntensity: 0.4 }))
  panel.rotation.x = -0.5
  panel.position.y = 1.4
  panel.castShadow = true
  solarG.add(panel)
  const cellMat = new THREE.MeshStandardMaterial({ color: 0x12406e, metalness: 0.6, roughness: 0.3 })
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const cell = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.4), cellMat)
      cell.position.set(i * 0.78, 1.45, -j * 0.46)
      cell.rotation.x = -0.5
      solarG.add(cell)
    }
  }
  ;[[-1.0, 0.6], [1.0, 0.6], [-1.0, -0.6], [1.0, -0.6]].forEach(([px, pz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 8), postMat)
    leg.position.set(px!, 0.65, pz!)
    solarG.add(leg)
  })
  solarG.position.set(-6, 0, 6)
  scene.add(solarG)

  const mastG = new THREE.Group()
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 4.5, 10), postMat)
  mast.position.y = 2.25
  mast.castShadow = true
  mastG.add(mast)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), postMat)
  arm.position.set(0.3, 4.4, 0)
  mastG.add(arm)
  const anemo = new THREE.Group()
  anemo.position.set(0.6, 4.4, 0)
  mastG.add(anemo)
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), new THREE.MeshStandardMaterial({ color: 0xffd24d }))
  anemo.add(hub)
  for (let i = 0; i < 3; i++) {
    const cup = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffe08a }))
    const a = i * 2 * Math.PI / 3
    cup.position.set(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22)
    anemo.add(cup)
  }
  mastG.position.set(6.5, -0.5, -6.5)
  scene.add(mastG)

  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 })
  ;[[-7, 7], [-7.8, 7], [-7.4, 7.8], [7, -7]].forEach(([cx, cz], i) => {
    const cr = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), crateMat)
    cr.position.set(cx!, i % 2 ? 0.45 : 0.9, cz!)
    cr.castShadow = true
    cr.receiveShadow = true
    scene.add(cr)
  })

  /* ---------- 雨 ---------- */
  const rainCount = 1500
  const rainGeo = new THREE.BufferGeometry()
  const rainPos = new Float32Array(rainCount * 3)
  for (let i = 0; i < rainCount; i++) {
    rainPos[i * 3] = (Math.random() - 0.5) * W
    rainPos[i * 3 + 1] = Math.random() * H * 2
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * D
  }
  const rainAttr = new THREE.BufferAttribute(rainPos, 3)
  rainGeo.setAttribute('position', rainAttr)
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0x9fd0ff, size: 0.12, transparent: true, opacity: 0.7 }))
  rain.visible = false
  scene.add(rain)

  /* ---------- 传感器 3D 模型 ---------- */
  const sensorGroups: THREE.Group[] = []

  function buildDevice(s: SensorRuntime) {
    const g = new THREE.Group()
    const steel = new THREE.MeshStandardMaterial({ color: 0x39424f, metalness: 0.7, roughness: 0.35 })
    const white = new THREE.MeshStandardMaterial({ color: 0xeef2f6, metalness: 0.1, roughness: 0.55 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x222a33, metalness: 0.4, roughness: 0.6 })
    const screen = new THREE.MeshStandardMaterial({ color: 0x0a1a12, emissive: 0x39e6a0, emissiveIntensity: 0.7, roughness: 0.3 })
    const isSoil = s.type.en === 'Soil'
    const poleH = isSoil ? 0 : Math.max(1.6, s.pos[1] - 0.7)
    if (!isSoil) {
      const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.12, 16), steel)
      flange.position.y = 0.06
      flange.castShadow = true
      g.add(flange)
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, poleH, 12), steel)
      pole.position.y = poleH / 2
      pole.castShadow = true
      g.add(pole)
    }
    const body = new THREE.Group()
    body.position.y = poleH
    g.add(body)
    const headPos = new THREE.Vector3(0, 0.55, 0)
    switch (s.type.en) {
      case 'Temperature':
      case 'Humidity': {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.36), white)
        box.position.y = 0.31
        box.castShadow = true
        body.add(box)
        for (let i = 0; i < 5; i++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.02), dark)
          b.position.set(0, 0.16 + i * 0.075, 0.181)
          body.add(b)
        }
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), white)
        dome.position.y = 0.62
        body.add(dome)
        headPos.set(0, 0.92, 0)
        break
      }
      case 'CO₂': {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.34), white)
        box.position.y = 0.31
        box.castShadow = true
        body.add(box)
        const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.2), screen)
        disp.position.set(0, 0.4, 0.171)
        body.add(disp)
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 8), dark)
        ant.position.set(0.2, 0.78, 0)
        body.add(ant)
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), new THREE.MeshStandardMaterial({ color: 0xff5470, emissive: 0xff5470, emissiveIntensity: 0.9 }))
        tip.position.set(0.2, 0.99, 0)
        body.add(tip)
        headPos.set(0, 0.74, 0)
        break
      }
      case 'Illuminance': {
        const armM = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.42, 8), steel)
        armM.rotation.z = Math.PI / 2
        armM.position.set(0.21, 0.42, 0)
        body.add(armM)
        const panelM = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.34), new THREE.MeshStandardMaterial({ color: 0x12324a, metalness: 0.6, roughness: 0.3, emissive: 0x0a2a44, emissiveIntensity: 0.4 }))
        panelM.position.set(0.5, 0.58, 0)
        panelM.rotation.x = -0.55
        panelM.castShadow = true
        body.add(panelM)
        headPos.set(0.5, 0.8, 0)
        break
      }
      case 'Particulate': {
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.74, 22), white)
        cyl.position.y = 0.37
        cyl.castShadow = true
        body.add(cyl)
        for (let i = 0; i < 3; i++) {
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.022, 8, 22), dark)
          r.rotation.x = Math.PI / 2
          r.position.y = 0.18 + i * 0.23
          body.add(r)
        }
        headPos.set(0, 0.86, 0)
        break
      }
      case 'Sound': {
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.52, 16), white)
        cyl.position.y = 0.26
        cyl.castShadow = true
        body.add(cyl)
        const capM = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), dark)
        capM.position.y = 0.52
        body.add(capM)
        headPos.set(0, 0.74, 0)
        break
      }
      case 'Soil': {
        const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 1.7, 10), steel)
        probe.position.y = -0.85
        body.add(probe)
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 10), steel)
        tip.position.y = -1.7
        tip.rotation.x = Math.PI
        body.add(tip)
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.3), white)
        box.position.y = 0.16
        box.castShadow = true
        body.add(box)
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), new THREE.MeshStandardMaterial({ color: 0x8bd45a, emissive: 0x8bd45a, emissiveIntensity: 0.9 }))
        led.position.set(0.14, 0.22, 0.16)
        body.add(led)
        headPos.set(0, 0.55, 0)
        break
      }
    }

    const headMat = new THREE.MeshStandardMaterial({ color: s.color, emissive: s.color, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.2 })
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 18), headMat)
    head.position.copy(headPos)
    head.castShadow = true
    body.add(head)

    const ringMat = new THREE.MeshBasicMaterial({ color: STATUS_COLOR.good, transparent: true, opacity: 0.9 })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 30), ringMat)
    ring.position.copy(headPos)
    ring.rotation.x = Math.PI / 2
    body.add(ring)

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.04, 10, 36),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    )
    halo.position.copy(headPos)
    halo.rotation.x = Math.PI / 2
    body.add(halo)

    g.position.set(s.pos[0], 0, s.pos[2])
    g.userData.sensorId = s.id
    scene.add(g)
    sensorGroups.push(g)

    const labelY = poleH + headPos.y
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 12, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    )
    beam.position.set(s.pos[0], labelY + 6, s.pos[2])
    scene.add(beam)

    s.mesh = g
    s.head = head
    s.headMat = headMat
    s.ring = ring
    s.ringMat = ringMat
    s.halo = halo
    s.beam = beam
    s.labelY = labelY

    // 浮动标签（样式在页面 <style scoped> 里用 :deep(.flabel) 定义）
    const lab = document.createElement('div')
    lab.className = 'flabel'
    lab.dataset.label = s.id
    const num = document.createElement('b')
    num.dataset.role = 'num'
    num.textContent = '--'
    const unit = document.createElement('span')
    unit.className = 'u'
    unit.textContent = s.unit
    lab.append(num, unit)
    labelsEl!.appendChild(lab)
    s.label = lab
    s.labelNum = num
  }
  sensors.forEach(buildDevice)

  /* ---------- 模拟状态 ---------- */
  const sim = {
    time: 6.0,
    day: 1,
    speed: 30,
    playing: true,
    weather: 'Clear' as Weather,
    scenarios: { heat: false, occupancy: false, fault: false, irrigate: 0 },
    points: 0,
    lastCollect: 6.0
  }
  let occLevel = 0.15
  let ventLevel = 0.5
  let soilDrain = 0
  let noiseBurst = 0

  const solarValue = (h: number) => Math.cos((h - 12) / 12 * Math.PI)
  function weatherFactors() {
    if (sim.weather === 'Rain') return { light: 0.15, temp: -3, hum: 30, pm: -15 }
    if (sim.weather === 'Cloudy') return { light: 0.40, temp: -1, hum: 12, pm: 5 }
    return { light: 1.0, temp: 0, hum: 0, pm: 10 }
  }

  function stepSensor(s: SensorRuntime, dtMin: number) {
    const hr = sim.time, sol = solarValue(hr), wf = weatherFactors()
    let tgt = s.base
    switch (s.type.en) {
      case 'Temperature':
        tgt = 21 + s.amp * sol + wf.temp + (sim.scenarios.heat ? 9 : 0) + (occLevel - 0.15) * 3
        break
      case 'Humidity':
        tgt = 52 - 16 * sol + wf.hum + (sim.scenarios.heat ? -6 : 0) + (ventLevel - 0.5) * 8
        break
      case 'CO₂':
        tgt = 410 + occLevel * 900 - ventLevel * 260 + (sim.scenarios.fault ? 700 : 0) + (Math.random() - 0.5) * 30
        break
      case 'Illuminance':
        tgt = Math.max(0, 95000 * sol) * wf.light
        if (sol < 0.05) tgt = 250
        tgt += (Math.random() - 0.5) * 400
        break
      case 'Particulate':
        tgt = s.base + wf.pm + (sim.scenarios.occupancy ? 18 : 0) + (Math.random() - 0.5) * 12
        tgt = Math.max(2, tgt)
        break
      case 'Sound':
        tgt = 33 + occLevel * 22 + noiseBurst + (sim.scenarios.occupancy ? 12 : 0) + (Math.random() - 0.5) * 6
        break
      case 'Soil':
        tgt = s.value - soilDrain * dtMin + (sim.scenarios.irrigate > 0 ? 0.6 : 0)
        tgt = Math.max(8, Math.min(95, tgt))
        break
    }
    if (s.type.en !== 'Soil') tgt += (Math.random() - 0.5) * (s.amp ? s.amp * 0.15 : 1.2)
    const k = s.type.en === 'Illuminance' ? 0.25 : 0.08
    s.value += (tgt - s.value) * k
    s.value = Math.max(-20, s.value)
  }

  function classify(s: SensorRuntime): SensorStatus {
    const v = s.value
    if ((s.alarmLo !== null && v < s.alarmLo) || (s.alarmHi !== null && v > s.alarmHi)) return 'alarm'
    if ((s.warnLo !== null && v < s.warnLo) || (s.warnHi !== null && v > s.warnHi)) return 'warn'
    return 'good'
  }

  /* ---------- 告警 ---------- */
  const alertLog = $('es-alert-log')
  let alertCount = 0
  const alertState: Record<string, SensorStatus> = {}

  function clockStr(t: number) {
    const day = Math.floor(t / 24) + 1
    let h = t % 24
    const m = Math.floor((h % 1) * 60)
    h = Math.floor(h)
    return `D${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  function addAlert(kind: SensorStatus | 'good', text: string) {
    if (!alertLog) return
    const el = document.createElement('div')
    el.className = 'alert ' + kind
    const t = document.createElement('span')
    t.className = 't'
    t.textContent = clockStr(sim.time + (sim.day - 1) * 24)
    const msg = document.createElement('span')
    msg.textContent = text
    el.append(t, msg)
    alertLog.prepend(el)
    while (alertLog.children.length > 60) alertLog.removeChild(alertLog.lastChild!)
  }

  const WORD = {
    zh: { alarm: '报警', warn: '预警', recovered: '已恢复正常' },
    en: { alarm: 'ALARM', warn: 'warning', recovered: 'recovered' }
  }
  const word = (k: 'alarm' | 'warn' | 'recovered') => WORD[lang()][k]

  function pushAlertTick() {
    alertCount = 0
    for (const s of sensors) {
      const st = classify(s)
      if (st !== 'good') alertCount++
      if (st !== alertState[s.id]) {
        const name = pick(s.name, lang())
        if (st === 'alarm') addAlert('alarm', `${name} ${word('alarm')} — ${s.value.toFixed(1)} ${s.unit}`)
        else if (st === 'warn') addAlert('warn', `${name} ${word('warn')} — ${s.value.toFixed(1)} ${s.unit}`)
        else if (alertState[s.id] && alertState[s.id] !== 'good') addAlert('good', `${name} ${word('recovered')} — ${s.value.toFixed(1)} ${s.unit}`)
        alertState[s.id] = st
      }
    }
  }

  function collect() {
    for (const s of sensors) {
      s.history.push({ t: sim.time + (sim.day - 1) * 24, v: s.value })
      if (s.history.length > MAX_HIST) s.history.shift()
    }
    sim.points++
    pushAlertTick()
  }

  /* =========================================================
     UI 绑定（在根节点内按 id / data-* 取节点）
     ========================================================= */

  // 传感器按钮 + 卡片
  for (const s of sensors) {
    const btn = root.querySelector<HTMLElement>(`[data-btn="${s.id}"]`)
    if (btn) {
      s.btn = btn
      btn.addEventListener('click', () => focusSensor(s, true))
    }
    const card = root.querySelector<HTMLElement>(`[data-card="${s.id}"]`)
    if (card) {
      s.card = card
      s.cardNum = card.querySelector<HTMLElement>('[data-role="num"]') ?? undefined
      s.cardDot = card.querySelector<HTMLElement>('[data-role="dot"]') ?? undefined
      s.cardStat = card.querySelector<HTMLElement>('[data-role="stat"]') ?? undefined
      const cv = card.querySelector<HTMLCanvasElement>('[data-role="chart"]')
      if (cv) {
        s.cardChart = cv
        s.cardCtx = cv.getContext('2d') ?? undefined
      }
      card.addEventListener('click', () => selectSensor(s))
    }
  }

  // 右栏详情
  const dName = $('es-d-name'), dType = $('es-d-type'), dDot = $('es-d-dot')
  const dWarn = $('es-d-warn'), dAlarm = $('es-d-alarm')
  const sCur = $('es-s-cur'), sMin = $('es-s-min'), sMax = $('es-s-max'), sAvg = $('es-s-avg')
  const bigCanvas = $<HTMLCanvasElement>('es-big-chart')
  const bigCtx = bigCanvas ? bigCanvas.getContext('2d') : null

  // HUD
  const hudClock = $('es-hud-clock'), hudWeather = $('es-hud-weather')
  const hudPoints = $('es-hud-points'), hudAlerts = $('es-hud-alerts')

  // 播放 / 天气 / 场景 / 速度
  const btnPlay = $<HTMLButtonElement>('es-btn-play')
  const playLabel = { zh: { pause: '⏸ 暂停', play: '▶ 继续' }, en: { pause: '⏸ Pause', play: '▶ Play' } }
  function syncPlayBtn() {
    if (!btnPlay) return
    btnPlay.textContent = sim.playing ? playLabel[lang()].pause : playLabel[lang()].play
    btnPlay.classList.toggle('active', sim.playing)
  }
  btnPlay?.addEventListener('click', () => {
    sim.playing = !sim.playing
    syncPlayBtn()
  })

  const weatherBtns: Record<Weather, HTMLElement | null> = {
    Clear: $('es-w-clear'), Cloudy: $('es-w-cloudy'), Rain: $('es-w-rain')
  }
  for (const key of Object.keys(weatherBtns) as Weather[]) {
    weatherBtns[key]?.addEventListener('click', () => setWeather(key))
  }

  const scenarioIds = Object.fromEntries(
    ENVSENSE_ACTIONS.filter(a => a.toggle).map(a => [a.id, a.domId])
  ) as Record<ScenarioKey, string>
  for (const action of ENVSENSE_ACTIONS) {
    const el = $(action.domId)
    if (action.toggle) {
      el?.addEventListener('click', () => {
        const on = toggleScenario(action.id as ScenarioKey)
        options.onTask?.(`scenario:${action.id}`)
        addAlert(on ? 'warn' : 'good', scenarioText(action.id as ScenarioKey, on))
      })
    } else {
      el?.addEventListener('click', () => {
        sim.scenarios.irrigate = 1
        el.classList.add('active')
        options.onTask?.('scenario:irrigate')
        addAlert('good', lang() === 'zh' ? '灌溉脉冲已触发' : 'Irrigation pulse triggered')
        setTimeout(() => el.classList.remove('active'), 1500)
      })
    }
  }
  const irrigBtn = $(ENVSENSE_ACTIONS[ENVSENSE_ACTIONS.length - 1]!.domId)
  function scenarioText(key: ScenarioKey, on: boolean) {
    const zh = lang() === 'zh'
    const names = {
      heat: zh ? '热浪' : 'Heatwave',
      occupancy: zh ? '人员涌入' : 'Occupancy surge',
      fault: zh ? 'CO₂ 通风故障' : 'CO₂ vent fault'
    }
    return `${zh ? '场景' : 'Scenario'} ${names[key]} ${on ? 'ON' : 'OFF'}`
  }

  const speedEl = $<HTMLInputElement>('es-speed')
  const speedVal = $('es-speed-val')
  speedEl?.addEventListener('input', () => {
    sim.speed = Number(speedEl.value)
    if (speedVal) speedVal.textContent = `${sim.speed}×`
  })

  $('es-btn-export')?.addEventListener('click', () => exportCsv())

  // 详情弹窗
  const modal = $('es-info-modal')
  const miIcon = $('es-mi-icon'), miName = $('es-mi-name'), miSub = $('es-mi-sub')
  const miDesc = $('es-mi-desc'), miPrinciple = $('es-mi-principle'), miTags = $('es-mi-tags'), miLive = $('es-mi-live')

  function openInfo(s: SensorRuntime) {
    if (!modal) return
    const lg = lang()
    if (miIcon) miIcon.textContent = s.icon
    if (miName) miName.textContent = pick(s.name, lg)
    if (miSub) miSub.textContent = `${s.id} · ${pick(s.type, lg)} · ${s.unit}`
    if (miDesc) miDesc.textContent = pick(s.desc, lg)
    if (miPrinciple) miPrinciple.textContent = pick(s.principle, lg)
    if (miTags) {
      const zh = lg === 'zh'
      miTags.innerHTML = ''
      const tags: [string, string][] = [
        [zh ? '量程' : 'Range', s.range],
        [zh ? '常见值' : 'Typical', s.warnTxt],
        [zh ? '报警阈值' : 'Alarm', s.alarmTxt],
        [zh ? '典型应用' : 'Use', pick(s.use, lg)]
      ]
      for (const [k, v] of tags) {
        const tag = document.createElement('span')
        tag.className = 'tag'
        tag.textContent = `${k} `
        const b = document.createElement('b')
        b.textContent = v
        tag.appendChild(b)
        miTags.appendChild(tag)
      }
    }
    syncLive(s)
    modal.style.display = 'flex'
    options.onTask?.(`sensor:${s.id}`)
  }
  function closeInfo() {
    if (modal) modal.style.display = 'none'
  }
  function syncLive(s: SensorRuntime) {
    if (!miLive) return
    const lg = lang()
    miLive.textContent = `${s.value.toFixed(1)} ${s.unit}`
    miLive.style.color = STATUS_CSS[s.status]
    if (miSub) miSub.textContent = `${s.id} · ${pick(s.type, lg)} · ${s.unit}`
  }
  $('es-mi-close')?.addEventListener('click', closeInfo)
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeInfo()
  })
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeInfo()
  }
  window.addEventListener('keydown', onKeydown)

  // 3D 拾取
  const ray = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  const onCanvasClick = (e: MouseEvent) => {
    const r = renderer.domElement.getBoundingClientRect()
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1
    mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1
    ray.setFromCamera(mouse, camera)
    const hit = ray.intersectObjects(sensorGroups, true)
    if (hit.length) {
      let o: THREE.Object3D | null = hit[0]!.object
      while (o && !o.userData.sensorId) o = o.parent
      const found = o?.userData.sensorId ? byId(String(o.userData.sensorId)) : undefined
      if (found) focusSensor(found, true)
    }
  }
  renderer.domElement.addEventListener('click', onCanvasClick)

  /* ---------- 选中 / 聚焦 ---------- */
  function selectSensor(s: SensorRuntime) {
    selected = s
    for (const x of sensors) x.card?.classList.toggle('sel', x === s)
    const lg = lang()
    if (dName) dName.textContent = pick(s.name, lg)
    if (dType) dType.textContent = `${s.id} · ${pick(s.type, lg)} · ${s.unit}`
    if (dWarn) dWarn.textContent = `${s.warnLo ?? '—'} / ${s.warnHi ?? '—'}`
    if (dAlarm) dAlarm.textContent = `${s.alarmLo ?? '—'} / ${s.alarmHi ?? '—'}`
    if (dDot) dDot.style.color = STATUS_CSS[s.status]
  }

  const fFromCam = new THREE.Vector3(), fToCam = new THREE.Vector3()
  const fFromTgt = new THREE.Vector3(), fToTgt = new THREE.Vector3()
  let focusAnim = 0

  function focusSensor(s: SensorRuntime, openModal = false) {
    selectSensor(s)
    focused = s
    for (const x of sensors) x.btn?.classList.toggle('active', x === s)
    const wp = new THREE.Vector3(s.pos[0], s.labelY, s.pos[2])
    fFromCam.copy(camera.position)
    fFromTgt.copy(controls.target)
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize()
    fToTgt.copy(wp)
    fToCam.copy(wp).add(dir.multiplyScalar(13)).add(new THREE.Vector3(0, 3.5, 0))
    focusAnim = 55
    if (openModal) openInfo(s)
  }

  /* ---------- 图表 ---------- */
  function drawMini(s: SensorRuntime) {
    const ctx = s.cardCtx, cv = s.cardChart, num = s.cardNum
    if (!ctx || !cv) return
    const w = cv.width, h = cv.height
    ctx.clearRect(0, 0, w, h)
    const data = s.history
    if (num) num.textContent = data.length < 2 ? '--' : s.value.toFixed(1)
    if (data.length < 2) return
    let lo = Infinity
    let hi = -Infinity
    for (const d of data) {
      lo = Math.min(lo, d.v)
      hi = Math.max(hi, d.v)
    }
    if (hi - lo < 1e-6) hi = lo + 1
    ctx.beginPath()
    data.forEach((d, i) => {
      const x = 4 + (w - 8) * (i / (data.length - 1))
      const y = h - 4 - (h - 8) * ((d.v - lo) / (hi - lo))
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    })
    ctx.strokeStyle = STATUS_CSS[s.status]
    ctx.lineWidth = 1.6
    ctx.stroke()
    ctx.lineTo(w - 4, h - 4)
    ctx.lineTo(4, h - 4)
    ctx.closePath()
    ctx.fillStyle = STATUS_CSS[s.status] + '22'
    ctx.fill()
  }

  function sizeBig() {
    if (!bigCanvas) return
    bigCanvas.width = Math.max(bigCanvas.clientWidth, 1) * 2
    bigCanvas.height = Math.max(bigCanvas.clientHeight, 1) * 2
  }

  function drawBig(s: SensorRuntime) {
    if (!bigCtx || !bigCanvas) return
    const ctx = bigCtx, w = bigCanvas.width, h = bigCanvas.height
    ctx.clearRect(0, 0, w, h)
    const data = s.history
    ctx.strokeStyle = 'rgba(120,160,220,0.12)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = h * i / 4
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
    if (data.length < 2) return
    let lo = Infinity
    let hi = -Infinity
    for (const d of data) {
      lo = Math.min(lo, d.v)
      hi = Math.max(hi, d.v)
    }
    const pad = 20
    if (hi - lo < 1e-6) hi = lo + 1
    const yOf = (v: number) => h - pad - (h - 2 * pad) * ((v - lo) / (hi - lo))
    ctx.setLineDash([6, 6])
    const line = (v: number, style: string) => {
      ctx.strokeStyle = style
      ctx.beginPath()
      ctx.moveTo(0, yOf(v))
      ctx.lineTo(w, yOf(v))
      ctx.stroke()
    }
    if (s.warnHi !== null) line(s.warnHi, 'rgba(255,204,77,0.5)')
    if (s.warnLo !== null) line(s.warnLo, 'rgba(255,204,77,0.5)')
    if (s.alarmHi !== null) line(s.alarmHi, 'rgba(255,84,112,0.6)')
    if (s.alarmLo !== null) line(s.alarmLo, 'rgba(255,84,112,0.6)')
    ctx.setLineDash([])
    ctx.beginPath()
    data.forEach((d, i) => {
      const x = pad + (w - 2 * pad) * (i / (data.length - 1))
      const y = yOf(d.v)
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    })
    ctx.strokeStyle = STATUS_CSS[s.status]
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.lineTo(w - pad, h - pad)
    ctx.lineTo(pad, h - pad)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, STATUS_CSS[s.status] + '55')
    grad.addColorStop(1, STATUS_CSS[s.status] + '05')
    ctx.fillStyle = grad
    ctx.fill()
    const last = data[data.length - 1]!
    ctx.fillStyle = STATUS_CSS[s.status]
    ctx.beginPath()
    ctx.arc(w - pad, yOf(last.v), 5, 0, 7)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 22px "Segoe UI", system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(last.v.toFixed(1) + ' ' + s.unit, w - 14, 30)
  }

  /* ---------- CSV 导出 ---------- */
  function exportCsv() {
    let csv = 'timestamp,sensor_id,type,unit,value,status\n'
    const now = clockStr(sim.time + (sim.day - 1) * 24)
    for (const s of sensors) {
      csv += `${now},${s.id},${s.type.en},${s.unit},${s.value.toFixed(2)},${s.status}\n`
      for (const d of s.history) csv += `${clockStr(d.t)},${s.id},${s.type.en},${s.unit},${d.v.toFixed(2)},\n`
    }
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `envsense_data_D${sim.day}_${Math.floor(sim.time)}h.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    addAlert('good', lang() === 'zh' ? '数据集已导出为 CSV' : 'Collected dataset exported to CSV')
    options.onTask?.('export')
  }

  /* ---------- 尺寸 ---------- */
  function resize() {
    const w = Math.max(stage!.clientWidth, 1)
    const h = Math.max(stage!.clientHeight, 1)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    sizeBig()
  }
  const ro = new ResizeObserver(resize)

  /* ---------- 主循环 ---------- */
  const tmpV = new THREE.Vector3()
  const sky = new THREE.Color()
  const nightTop = new THREE.Color(0x05070f)
  const dayTop = new THREE.Color(0x3b82d6)
  const sunsetCol = new THREE.Color(0xff7a3c)
  const timer = new THREE.Timer()
  let frame = 0

  function updateLabels() {
    const rect = stage!.getBoundingClientRect()
    for (const s of sensors) {
      if (!s.label) continue
      tmpV.set(s.pos[0], s.labelY + 0.4, s.pos[2])
      tmpV.project(camera)
      const vis = tmpV.z < 1
      s.label.style.display = vis ? 'block' : 'none'
      if (!vis) continue
      s.label.style.left = ((tmpV.x * 0.5 + 0.5) * rect.width) + 'px'
      s.label.style.top = ((-tmpV.y * 0.5 + 0.5) * rect.height) + 'px'
      if (s.labelNum) s.labelNum.textContent = s.value.toFixed(1)
      s.label.style.borderColor = STATUS_CSS[s.status]
      s.label.classList.toggle('focus', s === focused)
    }
  }

  /** 状态回写：卡片、右栏、HUD —— 每帧一次，节点少、开销可忽略 */
  function updateReadouts() {
    for (const s of sensors) {
      s.status = classify(s)
      const c = STATUS_COLOR[s.status]
      s.headMat?.emissive.setHex(c)
      s.ringMat?.color.setHex(c)
      if (s.cardDot) s.cardDot.style.color = STATUS_CSS[s.status]
      if (s.cardStat) {
        s.cardStat.textContent = s.status === 'good' ? '' : s.status.toUpperCase()
        s.cardStat.style.color = STATUS_CSS[s.status]
      }
      if (s.btn) s.btn.style.borderColor = s === focused ? STATUS_CSS[s.status] : ''
    }
    if (dDot) dDot.style.color = STATUS_CSS[selected.status]
    if (hudClock) hudClock.textContent = `Day ${sim.day} · ${String(Math.floor(sim.time)).padStart(2, '0')}:${String(Math.floor((sim.time % 1) * 60)).padStart(2, '0')}`
    if (hudWeather) hudWeather.textContent = sim.weather
    if (hudPoints) hudPoints.textContent = String(sim.points)
    if (hudAlerts) hudAlerts.textContent = String(alertCount)
    if (modal && modal.style.display === 'flex') syncLive(selected)
  }

  function updateStats() {
    const h = selected.history
    if (!h.length) return
    let lo = Infinity
    let hi = -Infinity
    let sum = 0
    for (const d of h) {
      lo = Math.min(lo, d.v)
      hi = Math.max(hi, d.v)
      sum += d.v
    }
    if (sCur) sCur.textContent = selected.value.toFixed(1)
    if (sMin) sMin.textContent = lo.toFixed(1)
    if (sMax) sMax.textContent = hi.toFixed(1)
    if (sAvg) sAvg.textContent = (sum / h.length).toFixed(1)
  }

  function loop() {
    if (disposed) return
    rafId = requestAnimationFrame(loop)
    timer.update()
    const dt = Math.min(timer.getDelta(), 0.05)
    controls.update()

    if (sim.playing) {
      const dtMin = dt * sim.speed
      const steps = Math.max(1, Math.ceil(dtMin / 2))
      const sub = dtMin / steps
      const targetOcc = sim.scenarios.occupancy ? 0.85 : 0.15
      occLevel += (targetOcc - occLevel) * 0.02
      ventLevel += ((sim.scenarios.fault ? 0.1 : 0.5) - ventLevel) * 0.02
      noiseBurst += ((Math.random() < 0.04 ? Math.random() * 25 : 0) - noiseBurst) * 0.1
      soilDrain = 0.02 + (sim.scenarios.heat ? 0.03 : 0)
      const soil = byId('S1')
      for (let i = 0; i < steps; i++) {
        sim.time += sub / 60
        if (sim.scenarios.irrigate > 0 && soil) {
          soil.value = Math.min(95, soil.value + 0.4)
          sim.scenarios.irrigate -= sub / 60
        }
        if (sim.time >= 24) {
          sim.time -= 24
          sim.day++
        }
        for (const s of sensors) stepSensor(s, sub)
        if (sim.time - sim.lastCollect >= 5 / 60) {
          sim.lastCollect = sim.time
          collect()
        }
      }

      // 太阳 / 月亮
      const ang = (sim.time / 24) * Math.PI * 2 - Math.PI / 2
      const R = 40
      sun.position.set(Math.cos(ang) * R, Math.sin(ang) * 30 + 3, 14)
      sun.target.position.set(0, 2, 0)
      sunMesh.position.copy(sun.position)
      sunGlow.position.copy(sun.position)
      moonMesh.position.set(-Math.cos(ang) * R, -Math.sin(ang) * 30 + 3, -14)
      moonGlow.position.copy(moonMesh.position)
      const sol = solarValue(sim.time)
      const sunset = Math.max(0, 1 - Math.abs(sol) * 3.2)
      sun.color.setRGB(1, 0.92 - sunset * 0.45, 0.75 - sunset * 0.55)
      sun.intensity = Math.max(0.05, sol * 1.7 + 0.05)
      sunGlow.material.opacity = Math.max(0.05, sol * 0.9 + 0.1)
      hemi.intensity = 0.15 + Math.max(0, sol) * 0.75 + sunset * 0.25
      hemi.color.setRGB(0.55 + Math.max(0, sol) * 0.3, 0.7 + Math.max(0, sol) * 0.2, 1.0)
      ambient.intensity = 0.12 + Math.max(0, sol) * 0.32 + (sol < 0 ? 0.12 : 0)
      fill.position.copy(sun.position)
      fill.intensity = Math.max(0, sol) * 0.5
      fill.color.copy(sun.color)
      starMat.opacity = Math.max(0, -sol) * 0.9
      if (sol >= 0) sky.copy(nightTop).lerp(dayTop, sol)
      else sky.copy(nightTop)
      sky.lerp(sunsetCol, sunset * 0.5)
      bgColor.copy(sky)
      scene.background = bgColor
      ;(scene.fog as THREE.Fog).color.copy(sky)
      if (sim.weather === 'Rain') bgColor.lerp(new THREE.Color(0x1a2230), 0.55)
    }

    frame++
    const pulse = 0.5 + 0.5 * Math.sin(frame * 0.12)
    for (const s of sensors) {
      const isF = s === focused
      if (s.headMat) s.headMat.emissiveIntensity = isF ? (1.4 + 0.6 * pulse) : 0.45
      if (s.ring) s.ring.rotation.z += 0.01
      if (s.halo) {
        s.halo.rotation.z -= 0.02
        const haloMat = s.halo.material as THREE.MeshBasicMaterial
        haloMat.opacity = isF ? (0.4 + 0.4 * pulse) : 0
        haloMat.color.setHex(isF ? STATUS_COLOR[s.status] : 0xffffff)
      }
      if (s.beam) (s.beam.material as THREE.MeshBasicMaterial).opacity = isF ? (0.10 + 0.10 * pulse) : 0
    }
    anemo.rotation.y += 0.05

    if (rain.visible) {
      const p = rainAttr
      for (let i = 0; i < rainCount; i++) {
        let y = p.array[i * 3 + 1]! - 0.5
        if (y < 0) y = H * 2
        p.array[i * 3 + 1] = y
      }
      p.needsUpdate = true
    }

    if (focusAnim > 0) {
      const t = 1 - focusAnim / 55
      const e = t * t * (3 - 2 * t)
      camera.position.lerpVectors(fFromCam, fToCam, e)
      controls.target.lerpVectors(fFromTgt, fToTgt, e)
      focusAnim--
    }

    updateReadouts()
    updateLabels()
    if (frame % 2 === 0) {
      for (const s of sensors) drawMini(s)
      drawBig(selected)
      updateStats()
    }
    renderer.render(scene, camera)
  }

  /* ---------- 初始化 ---------- */
  ro.observe(stage!)
  resize()
  selectSensor(sensors[0]!)
  syncPlayBtn()

  // 预热历史，图表一开始就有曲线
  for (let i = 0; i < 12; i++) {
    for (const s of sensors) {
      stepSensor(s, 5)
      s.history.push({ t: sim.time + (sim.day - 1) * 24, v: s.value })
      if (s.history.length > MAX_HIST) s.history.shift()
    }
  }
  addAlert('good', lang() === 'zh' ? '仿真引擎已启动' : 'Simulation engine started')
  loop()

  /* =========================================================
     对外接口
     ========================================================= */

  function setWeather(w: Weather) {
    sim.weather = w
    for (const key of Object.keys(weatherBtns) as Weather[]) {
      weatherBtns[key]?.classList.toggle('active', key === w)
    }
    rain.visible = w === 'Rain'
    addAlert('good', (lang() === 'zh' ? '天气切换为 ' : 'Weather set to ') + w)
    options.onTask?.(`weather:${w}`)
  }

  function toggleScenario(key: ScenarioKey) {
    const on = !sim.scenarios[key]
    sim.scenarios[key] = on
    $(scenarioIds[key])?.classList.toggle('active', on)
    return on
  }

  return {
    dispose() {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
      ro.disconnect()
      controls.dispose()
      renderer.domElement.removeEventListener('click', onCanvasClick)
      window.removeEventListener('keydown', onKeydown)
      scene.traverse(function (o) {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else if (mat) mat.dispose()
      })
      renderer.dispose()
    },
    setPlaying(playing) {
      sim.playing = playing
      syncPlayBtn()
    },
    isPlaying: () => sim.playing,
    setSpeed(speed) {
      sim.speed = speed
      if (speedEl) speedEl.value = String(speed)
      if (speedVal) speedVal.textContent = `${speed}×`
    },
    setWeather,
    toggleScenario,
    isScenarioOn: (key: ScenarioKey) => sim.scenarios[key],
    triggerIrrigate() {
      irrigBtn?.click()
    },
    selectSensor(id) {
      const s = byId(id)
      if (s) selectSensor(s)
    },
    focusSensor(id, openModal = true) {
      const s = byId(id)
      if (s) focusSensor(s, openModal)
    },
    getSelectedId: () => selected.id,
    exportCsv
  }
}
