/**
 * Swarm Studio —— 3D 无人机灯光秀仿真引擎。
 *
 * 由独立单文件页（Swarm Studio · 3D Drone Light Show）移植，参考 utils/dronesim /
 * utils/avsim 的移植模式：
 *   - 场景（浅色天空 + 地面网格 + 圆形表演区）、InstancedMesh 机队（机身/机臂/桨/电机/
 *     LED 灯组）、编队库（13 种几何编队 + 文字编队）、LED 主题、自动编排/拖尾/航迹、
 *     实时遥测——这套命令式逻辑保持原样；
 *   - 原版「整页 DOM + document.getElementById + window.innerWidth/innerHeight」换成
 *     「调用方传入页面根节点，引擎在根节点内按 id 取节点 + ResizeObserver 跟随尺寸」，
 *     于是能在 Nuxt 页里挂载/卸载；
 *   - three 走 npm 依赖（无 CDN importmap）；OrbitControls 用 examples/jsm 版本；
 *   - 新增教学事件回调 onTask：formation / text / theme / auto / fleet。
 *
 * 节点 id 统一加 `dd-` 前缀，避免与 Nuxt 布局里其它元素撞 id（原版是独占整页的）。
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type Lang = 'zh' | 'en'

export type DroneDanceTask = 'formation' | 'text' | 'theme' | 'auto' | 'fleet'

export interface DroneDanceOptions {
  getLocale: () => Lang
  /** 教学事件：formation / text / theme / auto / fleet */
  onTask?: (task: DroneDanceTask) => void
}

export interface DroneDanceHandle {
  dispose: () => void
  /** 当前机队规模 */
  getCount: () => number
  /** 当前编队键 */
  getShape: () => string
}

interface Drone {
  p: THREE.Vector3
  from: THREE.Vector3
  target: THREE.Vector3
  phase: number
  yaw: number
  seed: number
}

/* =========================================================
   文案（双语）
   ========================================================= */

const THEME_NAMES: Record<string, { zh: string, en: string }> = {
  ice: { zh: '冰蓝', en: 'Ice' },
  rainbow: { zh: '彩虹', en: 'Rainbow' },
  sunset: { zh: '日落', en: 'Sunset' },
  emerald: { zh: '翡翠', en: 'Emerald' }
}

const FORMATION_LABELS: Record<string, string> = {
  sphere: 'GLOBE',
  heart: 'HEART',
  star: 'STAR',
  ring: 'ORBIT',
  helix: 'HELIX',
  spiral: 'SPIRAL',
  wave: 'WAVE',
  cube: 'CUBE',
  infinity: 'INFINITY',
  arrow: 'ARROW',
  butterfly: 'BUTTERFLY',
  scatter: 'SCATTER'
}

const FORMATION_SUBTITLES: Record<string, { zh: string, en: string }> = {
  sphere: { zh: '球面星座编队', en: 'Spherical constellation' },
  heart: { zh: '心形轮廓编队', en: 'Filled heart silhouette' },
  star: { zh: '五角星编队', en: 'Five-point star pattern' },
  ring: { zh: '同心轨道环', en: 'Concentric orbital rings' },
  helix: { zh: '双螺旋航迹', en: 'Double-helix flight path' },
  spiral: { zh: '扩张螺旋星系', en: 'Expanding spiral galaxy' },
  wave: { zh: '三维起伏波面', en: '3D rolling wave surface' },
  cube: { zh: '六面立方结构', en: 'Six-face cube structure' },
  infinity: { zh: '连续无穷环路', en: 'Continuous infinity loop' },
  arrow: { zh: '方向箭头编队', en: 'Directional arrow formation' },
  butterfly: { zh: '对称蝶翼图案', en: 'Symmetric wing pattern' },
  scatter: { zh: '自由散飞', en: 'Free-flight dispersion' },
  text: { zh: '自定义文字星座', en: 'Custom text constellation' }
}

function makeStr(lang: Lang) {
  const zh = lang === 'zh'
  return {
    formationChanged: (label: string) => zh ? `编队已切换：${label}` : `Formation changed: ${label}`,
    buildingText: (value: string) => zh ? `正在生成文字编队：${value}` : `Building text formation: ${value}`,
    enterText: zh ? '请先输入一个词或短语' : 'Enter a word or short phrase first',
    fleetResized: (n: number) => zh ? `机队规模已调整为 ${n} 架` : `Fleet resized to ${n} drones`,
    themeEnabled: (name: string) => zh ? `已启用「${name}」LED 主题` : `${name} LED theme enabled`,
    autoOn: zh ? '已开启自动编排' : 'Auto choreography enabled',
    autoOff: zh ? '已关闭自动编排' : 'Auto choreography disabled',
    paused: zh ? '仿真已暂停' : 'Simulation paused',
    resumed: zh ? '仿真已继续' : 'Simulation resumed',
    cameraReset: zh ? '相机视角已复位' : 'Camera view reset',
    locked: zh ? '编队已锁定' : 'Formation locked',
    inProgress: zh ? '编队变换中' : 'Formation in progress',
    transitioning: (remaining: number) => zh ? `变换中 · 剩余 ${remaining}%` : `Transitioning · ${remaining}% remaining`
  }
}

/* =========================================================
   纯函数工具
   ========================================================= */

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const rand = (a = 0, b = 1) => a + Math.random() * (b - a)
const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

const colorPalettes: Record<string, number[]> = {
  ice: [0x26dcff, 0x4a82ff, 0xffffff, 0x33baff],
  rainbow: [0xff477e, 0xffc145, 0x45e08a, 0x2ccfff, 0x9067ff, 0xff6ac0],
  sunset: [0xff4667, 0xff8a3d, 0xffc24f, 0xff6fa8],
  emerald: [0x00dfa7, 0x69f05c, 0x13b8a5, 0xd0ff91]
}

function pointInPolygon(x: number, y: number, poly: number[][]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]![0]!, yi = poly[i]![1]!, xj = poly[j]![0]!, yj = poly[j]![1]!
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/** 把文字栅格化成点云样本，用于「文字编队」 */
function makeTextSamples(text: string, n: number) {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  c.width = 640
  c.height = 220
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let fontSize = 150
  do {
    ctx.font = `900 ${fontSize}px Arial, sans-serif`
    if (ctx.measureText(text).width < 590) break
    fontSize -= 6
  } while (fontSize > 36)
  ctx.font = `900 ${fontSize}px Arial, sans-serif`
  ctx.fillText(text, 320, 111)
  const data = ctx.getImageData(0, 0, c.width, c.height).data
  const points: { x: number, y: number }[] = []
  const stride = 3
  for (let y = 8; y < c.height - 8; y += stride) {
    for (let x = 8; x < c.width - 8; x += stride) {
      if (data[(y * c.width + x) * 4]! > 128) points.push({ x: (x - 320) / 13.5, y: -(y - 111) / 13.5 })
    }
  }
  if (!points.length) return Array.from({ length: n }, () => ({ x: rand(-10, 10), y: rand(-5, 5) }))
  // 打乱样本再循环取用，保持轮廓可读的同时避免机械重复
  for (let i = points.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = points[i]!
    points[i] = points[j]!
    points[j] = tmp
  }
  return Array.from({ length: n }, (_, i) => points[i % points.length]!)
}

/** 按编队类型算出每架无人机的目标位姿 */
function shapeTargets(shape: string, n: number, baseY: number, textValue = 'AI'): THREE.Vector3[] {
  const out = new Array<THREE.Vector3>(n)
  const golden = Math.PI * (3 - Math.sqrt(5))
  if (shape === 'sphere') {
    const radius = Math.min(25, 10 + Math.sqrt(n) * 0.35)
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / Math.max(1, n - 1)) * 2
      const r = Math.sqrt(Math.max(0, 1 - y * y))
      const theta = golden * i
      out[i] = new THREE.Vector3(Math.cos(theta) * r * radius, baseY + y * radius * 0.56, Math.sin(theta) * r * radius)
    }
  } else if (shape === 'heart' || shape === 'butterfly' || shape === 'star' || shape === 'arrow') {
    for (let i = 0; i < n; i++) {
      let x: number, y: number, z: number
      if (shape === 'heart') {
        const t = rand(0, Math.PI * 2), r = Math.sqrt(Math.random())
        x = 16 * Math.pow(Math.sin(t), 3) * r
        y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * r
        z = rand(-1, 1) * 1.4
        x *= 0.98
        y *= 0.82
      } else if (shape === 'star') {
        const t = rand(0, Math.PI * 2), r = Math.sqrt(Math.random())
        const outer = 20, inner = 8.5
        const angleSector = (t + Math.PI / 2) / (Math.PI / 5)
        const fraction = angleSector - Math.floor(angleSector)
        const radius = (Math.floor(angleSector) % 2 === 0 ? outer * (1 - fraction) + inner * fraction : inner * (1 - fraction) + outer * fraction)
        x = Math.cos(t) * radius * r
        y = Math.sin(t) * radius * r
        z = rand(-1.3, 1.3)
      } else if (shape === 'arrow') {
        // 对箭头多边形做拒绝采样，得到均匀分布
        const poly = [[-22, -5], [-5, -5], [-5, -12], [21, 0], [-5, 12], [-5, 5], [-22, 5]]
        let tries = 0
        do {
          x = rand(-22, 21)
          y = rand(-12, 12)
          tries++
        } while (!pointInPolygon(x, y, poly) && tries < 120)
        z = rand(-1.5, 1.5)
      } else {
        // 蝶翼：两个圆润翼瓣 + 收窄的身体
        const wing = Math.random() < 0.5 ? -1 : 1
        const u = Math.sqrt(Math.random()), t = rand(0, Math.PI * 2)
        x = wing * (3.0 + 12 * u * Math.cos(t))
        y = 7 * u * Math.sin(t) + wing * 2.0
        z = rand(-2, 2)
      }
      out[i] = new THREE.Vector3(x, baseY + y * 0.82, z)
    }
  } else if (shape === 'ring') {
    const rings = [8.5, 16, 23]
    for (let i = 0; i < n; i++) {
      const band = i % 3, slot = Math.floor(i / 3), bn = Math.ceil(n / 3)
      const t = slot / Math.max(1, bn) * Math.PI * 2 + band * 0.045
      const r = rings[band]!
      out[i] = new THREE.Vector3(Math.cos(t) * r, baseY + Math.sin(t * 2 + band) * 2.1 + (band - 1) * 0.4, Math.sin(t) * r)
    }
  } else if (shape === 'helix') {
    for (let i = 0; i < n; i++) {
      const strand = i % 2, k = Math.floor(i / 2), total = Math.ceil(n / 2)
      const t = k / Math.max(1, total - 1) * Math.PI * 7
      const r = 12
      out[i] = new THREE.Vector3(Math.cos(t + strand * Math.PI) * r, baseY + (k / Math.max(1, total - 1) - 0.5) * 28, Math.sin(t + strand * Math.PI) * r)
    }
  } else if (shape === 'spiral') {
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1) * Math.PI * 7
      const r = 2.5 + 0.65 * t
      out[i] = new THREE.Vector3(Math.cos(t) * r, baseY + Math.sin(t * 0.7) * 5, Math.sin(t) * r)
    }
  } else if (shape === 'wave') {
    const cols = Math.ceil(Math.sqrt(n * 1.5)), rows = Math.ceil(n / cols)
    for (let i = 0; i < n; i++) {
      const x = (i % cols) / (cols - 1 || 1) * 48 - 24
      const z = Math.floor(i / cols) / (rows - 1 || 1) * 38 - 19
      const y = Math.sin(x * 0.27 + z * 0.16) * 4.1 + Math.cos(z * 0.31 - x * 0.08) * 2.3
      out[i] = new THREE.Vector3(x, baseY + y, z)
    }
  } else if (shape === 'cube') {
    const half = 16
    for (let i = 0; i < n; i++) {
      // 六个面均匀铺点
      const face = i % 6, k = Math.floor(i / 6)
      const u = ((k * 0.61803398875) % 1) * 2 - 1
      const v = ((k * 0.754877666) % 1) * 2 - 1
      let x: number, y: number, z: number
      if (face === 0) {
        x = half
        y = u * half
        z = v * half
      } else if (face === 1) {
        x = -half
        y = u * half
        z = v * half
      } else if (face === 2) {
        x = u * half
        y = half
        z = v * half
      } else if (face === 3) {
        x = u * half
        y = -half
        z = v * half
      } else if (face === 4) {
        x = u * half
        y = v * half
        z = half
      } else {
        x = u * half
        y = v * half
        z = -half
      }
      out[i] = new THREE.Vector3(x, baseY + y, z)
    }
  } else if (shape === 'infinity') {
    for (let i = 0; i < n; i++) {
      const t = i / n * Math.PI * 2
      const thickness = rand(-1.4, 1.4)
      const den = 1 + Math.cos(t) * Math.cos(t)
      const x = 25 * Math.sin(t) / den
      const z = 19 * Math.sin(t) * Math.cos(t) / den
      out[i] = new THREE.Vector3(x + thickness * 0.35, baseY + rand(-2, 2), z + thickness)
    }
  } else if (shape === 'scatter') {
    for (let i = 0; i < n; i++) out[i] = new THREE.Vector3(rand(-30, 30), baseY + rand(-12, 12), rand(-25, 25))
  } else if (shape === 'text') {
    const samples = makeTextSamples(textValue, n)
    for (let i = 0; i < n; i++) {
      const p = samples[i % samples.length]!
      out[i] = new THREE.Vector3(p.x, baseY + p.y, rand(-1.7, 1.7))
    }
  }
  // 无论高度设多少，编队都保持在地面之上
  for (const point of out) point.y = Math.max(2.5, point.y)
  return out
}

/* =========================================================
   引擎
   ========================================================= */

export function createDroneDance(root: HTMLElement, options: DroneDanceOptions): DroneDanceHandle {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T | null

  const stageEl = $<HTMLElement>('#dd-scene')
  if (!stageEl) throw new Error('DroneDance: 场景节点缺失（#dd-scene）')
  const stage: HTMLElement = stageEl

  const lang = () => options.getLocale()
  // 文案对象按语言缓存：主循环每帧都要取进度文案，避免逐帧重建闭包
  let strLang: Lang | null = null
  let strObj = makeStr('zh')
  const t = () => {
    const l = lang()
    if (l !== strLang) {
      strLang = l
      strObj = makeStr(l)
    }
    return strObj
  }
  const pickTheme = (key: string) => THEME_NAMES[key] ?? { zh: key, en: key }
  const pickSub = (shape: string) => FORMATION_SUBTITLES[shape] ?? { zh: '自定义编队', en: 'Custom formation' }

  let disposed = false
  let rafId = 0
  const listeners: { el: EventTarget, type: string, fn: EventListener }[] = []
  const on = (el: EventTarget | null, type: string, fn: EventListener) => {
    if (!el) return
    el.addEventListener(type, fn)
    listeners.push({ el, type, fn })
  }

  /* ---------- 渲染器 / 场景 ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.13
  // 画布尺寸交给容器：backing store 由 setSize 按 DPR 设，CSS 尺寸铺满 stage
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  stage.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xeaf4ff)
  scene.fog = new THREE.Fog(0xeaf4ff, 95, 230)

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500)
  camera.position.set(0, 43, 81)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 17, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.055
  controls.minDistance = 28
  controls.maxDistance = 145
  controls.maxPolarAngle = Math.PI * 0.48
  controls.update()

  scene.add(new THREE.HemisphereLight(0xffffff, 0xa7bad3, 2.0))
  const sun = new THREE.DirectionalLight(0xffffff, 2.3)
  sun.position.set(-35, 65, 28)
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0x8fcaff, 0.8)
  fill.position.set(40, 25, -38)
  scene.add(fill)

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: 0xf7fbff, roughness: 1, metalness: 0 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.45
  scene.add(floor)

  const grid = new THREE.GridHelper(240, 80, 0xadc8e6, 0xd6e5f5)
  grid.position.y = -0.42
  const gridMat = grid.material as THREE.Material
  gridMat.transparent = true
  gridMat.opacity = 0.48
  scene.add(grid)

  // 圆形表演区轮廓：让灯光秀有一个「场地」参照
  const zone = new THREE.Mesh(new THREE.RingGeometry(33.7, 34, 128), new THREE.MeshBasicMaterial({ color: 0x8bb6e9, transparent: true, opacity: 0.72, side: THREE.DoubleSide }))
  zone.rotation.x = -Math.PI / 2
  zone.position.y = -0.39
  scene.add(zone)
  const centerDisc = new THREE.Mesh(new THREE.CircleGeometry(1.25, 48), new THREE.MeshBasicMaterial({ color: 0xd1e8ff, transparent: true, opacity: 0.8 }))
  centerDisc.rotation.x = -Math.PI / 2
  centerDisc.position.y = -0.38
  scene.add(centerDisc)

  /* ---------- 机队几何 / 材质 ---------- */
  const droneGroup = new THREE.Group()
  scene.add(droneGroup)

  const bodyGeo = new THREE.SphereGeometry(0.19, 10, 8)
  const armGeo = new THREE.BoxGeometry(1.48, 0.075, 0.105)
  // 细横条读作双叶螺旋桨，绕竖直轴旋转
  const propGeo = new THREE.BoxGeometry(0.44, 0.028, 0.075)
  const hubGeo = new THREE.SphereGeometry(0.075, 8, 6)
  const ledGeo = new THREE.SphereGeometry(0.065, 7, 5)

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x223c59, metalness: 0.6, roughness: 0.34 })
  const armMat = new THREE.MeshStandardMaterial({ color: 0x4b6785, metalness: 0.55, roughness: 0.4 })
  const propMat = new THREE.MeshStandardMaterial({ color: 0x607991, metalness: 0.35, roughness: 0.38, transparent: true, opacity: 0.85 })
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x91aeca, metalness: 0.55, roughness: 0.26 })
  const ledMatA = new THREE.MeshStandardMaterial({ color: 0x25dafa, emissive: 0x0ba9e8, emissiveIntensity: 2.0, toneMapped: false })
  const ledMatB = new THREE.MeshStandardMaterial({ color: 0xffb04a, emissive: 0xf56a13, emissiveIntensity: 1.4, toneMapped: false })

  const geometries: THREE.BufferGeometry[] = [bodyGeo, armGeo, propGeo, hubGeo, ledGeo]
  const materials: THREE.Material[] = [bodyMat, armMat, propMat, hubMat, ledMatA, ledMatB]

  /* ---------- 状态 ---------- */
  let count = 420
  let drones: Drone[] = []
  let bodyMesh: THREE.InstancedMesh | null = null
  let armMesh: THREE.InstancedMesh | null = null
  let propMesh: THREE.InstancedMesh | null = null
  let hubMesh: THREE.InstancedMesh | null = null
  let ledMeshA: THREE.InstancedMesh | null = null
  let ledMeshB: THREE.InstancedMesh | null = null

  let currentShape = 'sphere'
  let currentShapeLabel = 'GLOBE'
  let currentTargetY = 18
  let transitionStart = performance.now()
  let transitionDuration = 2600
  let speed = 1
  let paused = false
  let pauseStarted = 0
  let autoChoreo = false
  let showTrails = false
  let showPaths = false
  let activeTheme = 'ice'
  let formationPaths: THREE.LineSegments | null = null
  let trailLines: THREE.LineSegments | null = null
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let lastAutoChange = performance.now()
  let lastTimestamp = performance.now()
  let fpsFrames = 0, fpsLast = performance.now()
  const simStart = performance.now()

  const paletteColors: THREE.Color[] = []

  const tempObject = new THREE.Object3D()
  const tempColor = new THREE.Color()
  const v3 = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const yAxis = new THREE.Vector3(0, 1, 0)

  /* ---------- 遥测 / 提示 ---------- */
  const text = (id: string, value: string) => {
    const node = $<HTMLElement>(id)
    if (node) node.textContent = value
  }
  const html = (id: string, value: string) => {
    const node = $<HTMLElement>(id)
    if (node) node.innerHTML = value
  }

  function showToast(message: string) {
    const el = $<HTMLElement>('#dd-toast')
    if (!el) return
    el.textContent = message
    el.classList.add('show')
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800)
  }

  function syncStats() {
    html('#dd-stat-fleet', `${count} <small>UAVs</small>`)
    text('#dd-drone-count-value', String(count))
    html('#dd-stat-altitude', `${currentTargetY.toFixed(1)} <small>m</small>`)
    text('#dd-altitude-value', `${currentTargetY} m`)
    text('#dd-stat-formation', currentShapeLabel)
  }

  function applyPalette() {
    const palette = colorPalettes[activeTheme] || colorPalettes.ice!
    paletteColors.length = 0
    for (const c of palette) paletteColors.push(new THREE.Color(c))
    for (let i = 0; i < count; i++) {
      const c = palette[i % palette.length]!
      ledMeshA?.setColorAt(i * 2, tempColor.setHex(c))
      ledMeshB?.setColorAt(i * 2 + 1, tempColor.setHex(palette[(i + 1) % palette.length]!))
    }
    if (ledMeshA?.instanceColor) ledMeshA.instanceColor.needsUpdate = true
    if (ledMeshB?.instanceColor) ledMeshB.instanceColor.needsUpdate = true
    if (activeTheme === 'ice') {
      ledMatA.color.setHex(0x26dcff)
      ledMatA.emissive.setHex(0x0ba9e8)
      ledMatB.color.setHex(0x83b9ff)
      ledMatB.emissive.setHex(0x2678ff)
    } else {
      ledMatA.color.setHex(0xffffff)
      ledMatA.emissive.setHex(0x6c8dff)
      ledMatB.color.setHex(0xffffff)
      ledMatB.emissive.setHex(0xff6a19)
    }
  }

  /* ---------- 机队构建 ---------- */
  function disposeFleet() {
    for (const m of [bodyMesh, armMesh, propMesh, hubMesh, ledMeshA, ledMeshB]) {
      if (m) {
        droneGroup.remove(m)
        m.dispose()
      }
    }
    bodyMesh = armMesh = propMesh = hubMesh = ledMeshA = ledMeshB = null
    drones = []
    if (formationPaths) {
      scene.remove(formationPaths)
      formationPaths.geometry.dispose()
      ;(formationPaths.material as THREE.Material).dispose()
      formationPaths = null
    }
    if (trailLines) {
      scene.remove(trailLines)
      trailLines.geometry.dispose()
      ;(trailLines.material as THREE.Material).dispose()
      trailLines = null
    }
  }

  function rebuildFleet(newCount: number) {
    count = newCount
    disposeFleet()
    bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, count)
    armMesh = new THREE.InstancedMesh(armGeo, armMat, count * 2)
    propMesh = new THREE.InstancedMesh(propGeo, propMat, count * 4)
    hubMesh = new THREE.InstancedMesh(hubGeo, hubMat, count * 4)
    ledMeshA = new THREE.InstancedMesh(ledGeo, ledMatA, count * 2)
    ledMeshB = new THREE.InstancedMesh(ledGeo, ledMatB, count * 2)
    bodyMesh.frustumCulled = armMesh.frustumCulled = propMesh.frustumCulled = hubMesh.frustumCulled = ledMeshA.frustumCulled = ledMeshB.frustumCulled = false
    droneGroup.add(bodyMesh, armMesh, propMesh, hubMesh, ledMeshA, ledMeshB)

    const textInput = $<HTMLInputElement>('#dd-custom-text')
    const targets = shapeTargets(currentShape, count, currentTargetY, textInput?.value || 'AI')
    for (let i = 0; i < count; i++) {
      const p = new THREE.Vector3(rand(-32, 32), rand(5, 36), rand(-27, 27))
      drones.push({ p, from: p.clone(), target: targets[i]!, phase: rand(0, Math.PI * 2), yaw: rand(0, Math.PI * 2), seed: Math.random() })
    }
    applyPalette()
    for (let i = 0; i < count; i++) {
      bodyMesh.setColorAt(i, tempColor.setHex(i % 7 === 0 ? 0x365879 : 0x213d5d))
      armMesh.setColorAt(i * 2, tempColor.setHex(0x456583))
      armMesh.setColorAt(i * 2 + 1, tempColor.setHex(0x456583))
    }
    bodyMesh.instanceMatrix.needsUpdate = true
    armMesh.instanceMatrix.needsUpdate = true
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true
    if (armMesh.instanceColor) armMesh.instanceColor.needsUpdate = true
    transitionStart = performance.now()
    transitionDuration = 2300
    syncStats()
  }

  /* ---------- 编队 ---------- */
  function setFormation(shape: string, opts: { fast?: boolean, silent?: boolean } = {}) {
    currentShape = shape
    const textInput = $<HTMLInputElement>('#dd-custom-text')
    const textValue = (textInput?.value || 'AI').trim().toUpperCase().slice(0, 12) || 'AI'
    if (shape === 'text') currentShapeLabel = textValue
    else currentShapeLabel = FORMATION_LABELS[shape] || shape.toUpperCase()

    const targets = shapeTargets(shape, count, currentTargetY, textValue)
    for (let i = 0; i < count; i++) {
      drones[i]!.from = drones[i]!.p.clone()
      drones[i]!.target = targets[i]!
    }
    transitionStart = performance.now()
    transitionDuration = (opts.fast ? 1200 : 2500) / speed
    lastAutoChange = performance.now()

    root.querySelectorAll('.dd-formation').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.shape === shape))
    text('#dd-stat-formation', currentShapeLabel)
    const sub = pickSub(shape)
    text('#dd-stat-formation-sub', lang() === 'zh' ? sub.zh : sub.en)
    if (showPaths) buildFlightPaths()

    if (!opts.silent) {
      showToast(shape === 'text' ? t().buildingText(textValue) : t().formationChanged(currentShapeLabel))
      if (shape === 'text') options.onTask?.('text')
      else if (shape !== 'scatter') options.onTask?.('formation')
    }
    syncStats()
  }

  function buildFlightPaths() {
    if (formationPaths) {
      scene.remove(formationPaths)
      formationPaths.geometry.dispose()
      ;(formationPaths.material as THREE.Material).dispose()
      formationPaths = null
    }
    if (!showPaths) return
    const vertices: number[] = []
    for (const d of drones) vertices.push(d.p.x, d.p.y, d.p.z, d.target.x, d.target.y, d.target.z)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    formationPaths = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x55aaff, transparent: true, opacity: 0.17 }))
    scene.add(formationPaths)
  }

  function createTrails() {
    if (trailLines) {
      scene.remove(trailLines)
      trailLines.geometry.dispose()
      ;(trailLines.material as THREE.Material).dispose()
      trailLines = null
    }
    if (!showTrails) return
    const positions = new Float32Array(count * 2 * 3)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    trailLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x41bfff, transparent: true, opacity: 0.22 }))
    scene.add(trailLines)
  }

  /* ---------- 逐机解算 ---------- */
  function composeDrone(i: number, now: number, dt: number) {
    const d = drones[i]!
    const elapsed = (now - transitionStart) / transitionDuration
    const k = easeInOutCubic(clamp(elapsed, 0, 1))
    const settle = 1 - k
    d.p.lerpVectors(d.from, d.target, k)
    const hover = (Math.sin(now * 0.0019 + d.phase) * 0.11 + Math.sin(now * 0.0012 + d.seed * 13) * 0.05) * settle
    let px = d.p.x, py = d.p.y + hover, pz = d.p.z
    if (!paused && elapsed >= 1) {
      if (currentShape === 'wave') py += Math.sin(now * 0.0008 + px * 0.16 + pz * 0.1) * 0.85
      if (currentShape === 'ring') {
        const a = now * 0.00012 + d.phase * 0.02
        px += Math.cos(a) * 0.12
        pz += Math.sin(a) * 0.12
      }
      if (currentShape === 'spiral') {
        const a = now * 0.00015 + d.phase * 0.03
        px += Math.cos(a) * 0.18
        pz += Math.sin(a) * 0.18
      }
      if (currentShape === 'scatter') {
        px += Math.sin(now * 0.0003 + d.phase) * 0.28
        py += Math.cos(now * 0.0004 + d.seed * 8) * 0.25
        pz += Math.cos(now * 0.00025 + d.phase) * 0.28
      }
    }
    const dx = d.target.x - d.from.x, dz = d.target.z - d.from.z
    const yaw = Math.atan2(dx, dz)
    d.yaw += (yaw - d.yaw) * Math.min(1, dt * 2.2) * Math.max(0.15, settle)
    const q = quat.setFromAxisAngle(yAxis, d.yaw)

    if (!bodyMesh || !armMesh || !propMesh || !hubMesh || !ledMeshA || !ledMeshB) return py

    tempObject.position.set(px, py, pz)
    tempObject.quaternion.copy(q)
    tempObject.scale.setScalar(1)
    tempObject.updateMatrix()
    bodyMesh.setMatrixAt(i, tempObject.matrix)

    tempObject.position.set(px, py, pz)
    tempObject.quaternion.copy(q)
    tempObject.updateMatrix()
    armMesh.setMatrixAt(i * 2, tempObject.matrix)
    tempObject.rotation.set(0, d.yaw + Math.PI / 2, 0)
    tempObject.updateMatrix()
    armMesh.setMatrixAt(i * 2 + 1, tempObject.matrix)

    // 电机轴心落在十字机臂的四个端点
    const offsets = [[0.72, 0, 0], [-0.72, 0, 0], [0, 0, 0.72], [0, 0, -0.72]]
    for (let kk = 0; kk < 4; kk++) {
      const o = offsets[kk]!
      v3.set(o[0]!, 0.07, o[2]!).applyQuaternion(q)
      tempObject.position.set(px + v3.x, py + v3.y, pz + v3.z)
      const spinDirection = (kk % 2 === 0) ? 1 : -1
      const spinAngle = spinDirection * (now * (0.0048 + speed * 0.001) + d.phase)
      tempObject.quaternion.setFromAxisAngle(yAxis, spinAngle)
      tempObject.scale.set(1, 1, 1)
      tempObject.updateMatrix()
      propMesh.setMatrixAt(i * 4 + kk, tempObject.matrix)

      tempObject.position.set(px + v3.x, py + 0.12, pz + v3.z)
      tempObject.quaternion.copy(q)
      tempObject.scale.setScalar(1)
      tempObject.updateMatrix()
      hubMesh.setMatrixAt(i * 4 + kk, tempObject.matrix)

      tempObject.position.set(px + v3.x, py + 0.17, pz + v3.z)
      tempObject.quaternion.identity()
      tempObject.scale.setScalar(1)
      tempObject.updateMatrix()
      if (kk < 2) ledMeshA.setMatrixAt(i * 2 + kk, tempObject.matrix)
      else ledMeshB.setMatrixAt(i * 2 + (kk - 2), tempObject.matrix)
    }

    if (showTrails && trailLines) {
      const arr = trailLines.geometry.attributes.position!.array as Float32Array
      const kk = i * 6
      arr[kk] = d.from.x
      arr[kk + 1] = d.from.y
      arr[kk + 2] = d.from.z
      arr[kk + 3] = px
      arr[kk + 4] = py
      arr[kk + 5] = pz
    }
    return py
  }

  /* ---------- 尺寸 ---------- */
  function setSize() {
    const w = Math.max(1, stage.clientWidth)
    const h = Math.max(1, stage.clientHeight)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8))
  }
  setSize()

  let resizeObserver: ResizeObserver | null = null
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => setSize())
    resizeObserver.observe(stage)
  } else {
    on(window, 'resize', () => setSize())
  }

  /* ---------- 主循环 ---------- */
  const autoShapes = ['sphere', 'heart', 'star', 'ring', 'helix', 'spiral', 'wave', 'cube', 'infinity', 'arrow', 'butterfly']

  function animate(now: number) {
    if (disposed) return
    rafId = requestAnimationFrame(animate)
    const dt = Math.min(0.05, (now - lastTimestamp) / 1000 || 0.016)
    lastTimestamp = now

    if (!paused && autoChoreo && now - lastAutoChange > 7800) {
      const idx = autoShapes.indexOf(currentShape)
      setFormation(autoShapes[(idx + 1 + autoShapes.length) % autoShapes.length]!, { silent: true })
    }

    if (!paused) {
      for (let i = 0; i < count; i++) composeDrone(i, now, dt)
    }
    // 暂停时保留最后一帧场景：不重算矩阵，也不做任何模拟位移

    if (!paused && bodyMesh && armMesh && propMesh && hubMesh && ledMeshA && ledMeshB) {
      bodyMesh.instanceMatrix.needsUpdate = true
      armMesh.instanceMatrix.needsUpdate = true
      propMesh.instanceMatrix.needsUpdate = true
      hubMesh.instanceMatrix.needsUpdate = true
      ledMeshA.instanceMatrix.needsUpdate = true
      ledMeshB.instanceMatrix.needsUpdate = true
    }
    if (showTrails && trailLines) trailLines.geometry.attributes.position!.needsUpdate = true
    if (showPaths && formationPaths) {
      const a = formationPaths.geometry.attributes.position!.array as Float32Array
      for (let i = 0; i < count; i++) {
        const d = drones[i]!, k = i * 6
        a[k] = d.p.x
        a[k + 1] = d.p.y
        a[k + 2] = d.p.z
        a[k + 3] = d.target.x
        a[k + 4] = d.target.y
        a[k + 5] = d.target.z
      }
      formationPaths.geometry.attributes.position!.needsUpdate = true
    }

    controls.update()
    renderer.render(scene, camera)

    const progress = Math.floor(clamp((now - transitionStart) / transitionDuration, 0, 1) * 100)
    html('#dd-stat-progress', `${progress}<small>%</small>`)
    const bar = $<HTMLElement>('#dd-progress-bar')
    if (bar) bar.style.width = progress + '%'
    text('#dd-progress-text', paused ? t().paused : (progress >= 100 ? t().locked : t().transitioning(100 - progress)))

    fpsFrames++
    if (now - fpsLast > 700) {
      text('#dd-stat-fps', `${Math.round(fpsFrames * 1000 / (now - fpsLast))} FPS`)
      fpsFrames = 0
      fpsLast = now
    }
    const seconds = Math.floor((now - simStart) / 1000)
    text('#dd-stat-time', String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0'))
  }

  /* ---------- 控件接线 ---------- */
  root.querySelectorAll<HTMLElement>('.dd-formation').forEach(btn =>
    on(btn, 'click', () => setFormation(btn.dataset.shape || 'sphere'))
  )

  on($('#dd-text-btn'), 'click', () => {
    const value = ($<HTMLInputElement>('#dd-custom-text')?.value || '').trim().toUpperCase()
    if (!value) {
      showToast(t().enterText)
      return
    }
    setFormation('text')
  })
  on($('#dd-custom-text'), 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') $<HTMLElement>('#dd-text-btn')?.click()
  })

  const countRange = $<HTMLInputElement>('#dd-drone-count')
  on(countRange, 'input', () => {
    if (countRange) text('#dd-drone-count-value', countRange.value)
  })
  on(countRange, 'change', () => {
    if (!countRange) return
    rebuildFleet(Number(countRange.value))
    setFormation(currentShape, { fast: true, silent: true })
    createTrails()
    showToast(t().fleetResized(count))
    options.onTask?.('fleet')
  })

  const speedRange = $<HTMLInputElement>('#dd-speed')
  on(speedRange, 'input', () => {
    if (!speedRange) return
    speed = Number(speedRange.value)
    text('#dd-speed-value', speed.toFixed(1) + '×')
  })

  const altitudeRange = $<HTMLInputElement>('#dd-altitude')
  on(altitudeRange, 'input', () => {
    if (!altitudeRange) return
    currentTargetY = Number(altitudeRange.value)
    text('#dd-altitude-value', `${currentTargetY} m`)
    html('#dd-stat-altitude', `${currentTargetY.toFixed(1)} <small>m</small>`)
    if (drones.length) {
      const targets = shapeTargets(currentShape, count, currentTargetY, $<HTMLInputElement>('#dd-custom-text')?.value || 'AI')
      for (let i = 0; i < count; i++) {
        drones[i]!.from = drones[i]!.p.clone()
        drones[i]!.target = targets[i]!
      }
      transitionStart = performance.now()
      transitionDuration = 1500 / speed
    }
  })

  root.querySelectorAll<HTMLElement>('#dd-color-themes .dd-swatch').forEach(btn =>
    on(btn, 'click', () => {
      activeTheme = btn.dataset.theme || 'ice'
      root.querySelectorAll('.dd-swatch').forEach(b => b.classList.toggle('active', b === btn))
      applyPalette()
      const name = pickTheme(activeTheme)
      showToast(t().themeEnabled(lang() === 'zh' ? name.zh : name.en))
      options.onTask?.('theme')
    })
  )

  const autoMode = $<HTMLInputElement>('#dd-auto')
  on(autoMode, 'change', () => {
    if (!autoMode) return
    autoChoreo = autoMode.checked
    lastAutoChange = performance.now()
    showToast(autoChoreo ? t().autoOn : t().autoOff)
    if (autoChoreo) options.onTask?.('auto')
  })

  const trailsMode = $<HTMLInputElement>('#dd-trails')
  on(trailsMode, 'change', () => {
    if (!trailsMode) return
    showTrails = trailsMode.checked
    createTrails()
  })

  const pathsMode = $<HTMLInputElement>('#dd-paths')
  on(pathsMode, 'change', () => {
    if (!pathsMode) return
    showPaths = pathsMode.checked
    buildFlightPaths()
  })

  on($('#dd-scatter'), 'click', () => setFormation('scatter', { fast: true, silent: true }))
  on($('#dd-reform'), 'click', () => setFormation(currentShape, { fast: true }))

  const playBtn = $<HTMLElement>('#dd-play')
  on(playBtn, 'click', () => {
    const now = performance.now()
    if (!paused) {
      paused = true
      pauseStarted = now
    } else {
      const pauseDuration = now - pauseStarted
      transitionStart += pauseDuration
      lastAutoChange += pauseDuration
      paused = false
    }
    if (playBtn) playBtn.innerHTML = paused ? '▶ &nbsp; Play' : 'Ⅱ &nbsp; Pause'
    text('#dd-progress-text', paused ? t().paused : t().inProgress)
    showToast(paused ? t().paused : t().resumed)
  })

  on($('#dd-reset-view'), 'click', () => {
    camera.position.set(0, 43, 81)
    controls.target.set(0, currentTargetY, 0)
    controls.update()
    showToast(t().cameraReset)
  })

  /* ---------- 启动 ---------- */
  rebuildFleet(count)
  setFormation('sphere', { fast: true, silent: true })
  rafId = requestAnimationFrame(animate)

  return {
    getCount: () => count,
    getShape: () => currentShape,
    dispose() {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
      if (toastTimer) clearTimeout(toastTimer)
      resizeObserver?.disconnect()
      for (const l of listeners) l.el.removeEventListener(l.type, l.fn)
      listeners.length = 0
      disposeFleet()
      controls.dispose()
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === stage) stage.removeChild(renderer.domElement)
    }
  }
}
