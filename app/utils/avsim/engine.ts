/**
 * AutoDrive 智能驾驶仿真 —— 3D 引擎。
 *
 * 从独立单文件页（SmartTown AV · 3D Autonomous Driving Sim）移植，
 * 参考 robot/vacusim 的移植模式：
 *   - 小镇路网 / 房屋 / 红绿灯相位机 / NPC 车流与行人 / EGO 规划
 *     （红灯停车 · 障碍绕行急刹 · 让行过街行人）/ LiDAR 点云 / 检测框与标签 /
 *     轨迹与行人意图线 / 迷你地图，这套命令式逻辑保持原样；
 *   - 原版「自己造整页 DOM + position:fixed 铺满视口 + document.getElementById +
 *     innerWidth/innerHeight」换成「调用方传入页面根节点，引擎在根节点内按 id 取节点 +
 *     ResizeObserver 跟随尺寸」，于是能在 Nuxt 页里挂载/卸载；
 *   - three 走 npm 依赖（无 CDN），OrbitControls 用 examples/jsm 版本；
 *   - 新增教学事件回调 onTask：view:xxx / weather:xxx / sensor:xxx /
 *     red-stop（红灯刹停）/ brake（障碍急刹）/ inspect（点选目标）。
 *
 * 顺手修掉原版迷你地图一处坐标 bug：路网线从 w2m(p,0) 画到 w2m(p,440)，
 * 把世界 z∈[0,440] 直接当画布坐标，导致道路只出现在地图右下象限；
 * 这里按「世界 ±220 → 画布 0..边长」的正确映射重画。
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type Lang = 'zh' | 'en'
export type AvView = 'chase' | 'orbit' | 'top' | 'cockpit'
export type AvWeather = 'day' | 'night' | 'rain'
export type SensorKey = 'lidar' | 'camera' | 'radar' | 'boxes' | 'labels' | 'traj'

export interface LocalizedText {
  zh: string
  en: string
}

export interface AvSimOptions {
  getLocale: () => Lang
  /** 完成一次教学交互（切视角 / 切天气 / 开感知层 / 红灯停车 / 急刹 / 点选目标）时回调，进度统计归宿主 */
  onTask?: (task: string) => void
}

export interface AvSimHandle {
  dispose: () => void
  isPaused: () => boolean
  setPaused: (paused: boolean) => void
  setSpeed: (kmh: number) => void
  setView: (view: AvView) => void
  setWeather: (weather: AvWeather) => void
  reset: () => void
}

type Kind = 'car' | 'ped' | 'building' | 'light' | 'tree'
type LightPhase = 'Red' | 'Yellow' | 'Green'

const KIND_COLOR: Record<Kind, string> = {
  car: '#ffd23f', ped: '#3dffa6', building: '#39e7ff', light: '#ff8a3d', tree: '#7CFFB2'
}
const KIND_HEX: Record<Kind, number> = {
  car: 0xffd23f, ped: 0x3dffa6, building: 0x39e7ff, light: 0xff8a3d, tree: 0x7CFFB2
}
const KIND_LABEL: Record<Lang, Record<Kind, string>> = {
  zh: { car: '车辆', ped: '行人', building: '建筑', light: '设施', tree: '植被' },
  en: { car: 'Car', ped: 'Ped', building: 'Bldg', light: 'Obj', tree: 'Veg' }
}
const KIND_TYPE: Record<Lang, Record<Kind, string>> = {
  zh: { car: '车辆', ped: '行人', building: '建筑', light: '交通设施', tree: '植被' },
  en: { car: 'Vehicle', ped: 'Pedestrian', building: 'Building', light: 'Traffic', tree: 'Vegetation' }
}

/** 引擎直接写入 DOM 的文案（HUD 读数 / 警示横幅 / 信息卡 / 日志） */
const STR = {
  zh: {
    pause: '⏸ 暂停',
    resume: '▶ 继续',
    collision: '⚠ 碰撞风险',
    caution: '◈ 注意',
    safe: '安全',
    danger: '危险',
    none: '无',
    static: '静止',
    oncoming: '对向 · 接近',
    receding: '同向 · 远离',
    crossing: '正在过马路',
    walking: '沿路边行走',
    empty: '探测范围内没有目标…',
    light: { Red: '红灯', Yellow: '黄灯', Green: '绿灯' } as Record<LightPhase, string>,
    tall: (h: number) => `高 ${h} m`
  },
  en: {
    pause: '⏸ Pause',
    resume: '▶ Resume',
    collision: '⚠ COLLISION RISK',
    caution: '◈ CAUTION',
    safe: 'SAFE',
    danger: 'DANGER',
    none: 'NONE',
    static: 'Static',
    oncoming: 'Oncoming / approaching',
    receding: 'Same / receding',
    crossing: 'Crossing road',
    walking: 'Walking along curb',
    empty: 'No objects in range…',
    light: { Red: 'Red', Yellow: 'Yellow', Green: 'Green' } as Record<LightPhase, string>,
    tall: (h: number) => `${h} m tall`
  }
}

interface SimData {
  kind: Kind
  name: string
  conf: number
  height?: number
  getState?: () => LightPhase
}

interface CarData extends SimData {
  horizontal: boolean
  lane: number
  dir: number
  speed: number
  actSpeed: number
  pos: number
}

interface PedData extends SimData {
  lane: number
  dir: number
  speed: number
  px: number
  pz: number
  vx: number
  vz: number
  crossing: boolean
  crossCooldown: number
}

interface SimCar { group: THREE.Group, d: CarData }
interface SimPed { group: THREE.Group, d: PedData }
interface LightObj { group: THREE.Group, lamps: THREE.Mesh[], phase: number }

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const rint = (a: number, b: number) => Math.floor(rnd(a, b + 1))
const pickOne = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!

/* =========================================================
   引擎
   ========================================================= */

export function createAvSim(root: HTMLElement, options: AvSimOptions): AvSimHandle {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector('#' + id) as T | null

  const stageEl = $('av-stage')
  const canvas = $<HTMLCanvasElement>('av-canvas')
  if (!stageEl || !canvas) throw new Error('AvSim: 舞台节点缺失（#av-stage / #av-canvas）')
  const stage: HTMLElement = stageEl

  const lang = () => options.getLocale()
  let disposed = false
  let rafId = 0

  /* ---------- 渲染器 ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x070b14)
  const fog = new THREE.Fog(0x070b14, 140, 520)
  scene.fog = fog

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 3000)
  camera.position.set(-160, 90, 160)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI * 0.49
  controls.minDistance = 20
  controls.maxDistance = 600
  controls.enabled = false // 默认追逐视角

  /* ---------- 灯光 ---------- */
  const hemi = new THREE.HemisphereLight(0x8fb6ff, 0x0a0e16, 0.55)
  const ambLight = new THREE.AmbientLight(0x33405e, 0.4)
  const sun = new THREE.DirectionalLight(0xbfd4ff, 0.9)
  sun.position.set(120, 200, 80)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const sc = sun.shadow.camera
  sc.left = -260
  sc.right = 260
  sc.top = 260
  sc.bottom = -260
  sc.near = 10
  sc.far = 600
  const moon = new THREE.DirectionalLight(0x7090ff, 0.35)
  moon.position.set(-150, 120, -120)
  scene.add(hemi, ambLight, sun, moon)

  /* ---------- 地面 ---------- */
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x0c1018, roughness: 1, metalness: 0 })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  /* ---------- 路网 ---------- */
  const GRID = [-180, -120, -60, 0, 60, 120, 180]
  const RW = 14
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x161b26, roughness: 0.95 })
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2e9c8, emissive: 0x2a2718, roughness: 0.6 })
  const roadGroup = new THREE.Group()
  scene.add(roadGroup)
  function addRoad(horizontal: boolean) {
    for (const p of GRID) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(horizontal ? 900 : RW, horizontal ? RW : 900), roadMat)
      r.rotation.x = -Math.PI / 2
      r.position.y = 0.02
      if (horizontal) r.position.z = p
      else r.position.x = p
      r.receiveShadow = true
      roadGroup.add(r)
      const seg = 18
      for (let i = 0; i < 900 / seg; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.5), lineMat)
        m.rotation.x = -Math.PI / 2
        m.position.y = 0.04
        if (horizontal) {
          m.position.z = p
          m.position.x = -450 + i * seg + seg / 2
        } else {
          m.position.x = p
          m.position.z = -450 + i * seg + seg / 2
        }
        roadGroup.add(m)
      }
    }
  }
  addRoad(true)
  addRoad(false)

  /* ---------- 小镇房屋 ---------- */
  function houseTexture() {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const x = c.getContext('2d')!
    x.fillStyle = '#1a2233'
    x.fillRect(0, 0, 64, 64)
    const cols = 3
    const rows = 4
    const cw = 64 / cols
    const ch = 64 / rows
    for (let r = 1; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        x.fillStyle = Math.random() < 0.5 ? '#ffd98a' : '#16223a'
        x.fillRect(col * cw + 3, r * ch + 3, cw - 6, ch - 6)
      }
    }
    const t = new THREE.CanvasTexture(c)
    t.magFilter = THREE.NearestFilter
    return t
  }

  const clickable: THREE.Mesh[] = []
  const detectables: THREE.Mesh[] = []
  const buildingMats: THREE.MeshStandardMaterial[] = []
  const HOUSE_COLORS = [0xd9c4a3, 0xc98b6b, 0x9fb4c9, 0xe0d6c0, 0xb7c9a8, 0xcdb89a]

  function makeHouse(x: number, z: number) {
    const w = rnd(8, 15)
    const d = rnd(8, 15)
    const h = rnd(4, 9)
    const g = new THREE.Group()
    const tex = houseTexture()
    const mat = new THREE.MeshStandardMaterial({
      map: tex, emissive: 0xffffff, emissiveMap: tex,
      emissiveIntensity: 0.9, color: pickOne(HOUSE_COLORS), roughness: 0.85, metalness: 0.05
    })
    buildingMats.push(mat)
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    body.position.y = h / 2
    body.castShadow = true
    body.receiveShadow = true
    g.add(body)
    const roofH = Math.max(2.5, w * 0.5)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.8, roofH, 4), new THREE.MeshStandardMaterial({ color: 0x6b3b2e, roughness: 0.9 }))
    roof.position.y = h + roofH / 2
    roof.rotation.y = Math.PI / 4
    roof.castShadow = true
    g.add(roof)
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.2), new THREE.MeshStandardMaterial({ color: 0x3a2a1c }))
    door.position.set(0, -h / 2 + 1.3, d / 2 + 0.05)
    g.add(door)
    g.position.set(x, 0, z)
    scene.add(g)
    const data: SimData = {
      kind: 'building',
      name: 'House #' + rint(100, 999),
      conf: 0.88 + Math.random() * 0.1,
      height: Math.round(h + roofH)
    }
    body.userData = data
    clickable.push(body)
    detectables.push(body)
  }

  // 中心广场
  ;(() => {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 0.4, 40), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 1 }))
    base.position.set(0, 0.2, 0)
    base.receiveShadow = true
    scene.add(base)
    const fount = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1.2, 20), new THREE.MeshStandardMaterial({ color: 0x4a6076, emissive: 0x16384a, emissiveIntensity: 0.4 }))
    fount.position.set(0, 0.8, 0)
    fount.castShadow = true
    scene.add(fount)
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.2, 20), new THREE.MeshStandardMaterial({ color: 0x39c6ff, emissive: 0x1a90c0, emissiveIntensity: 0.5, transparent: true, opacity: 0.8 }))
    water.position.set(0, 1.4, 0)
    scene.add(water)
  })()

  // 地标：市政厅（带钟楼尖顶，不是摩天楼）
  ;(() => {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 10), new THREE.MeshStandardMaterial({ color: 0xe7e2d6, roughness: 0.9 }))
    body.position.y = 4
    body.castShadow = true
    g.add(body)
    const tower = new THREE.Mesh(new THREE.BoxGeometry(5, 10, 5), new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.9 }))
    tower.position.set(0, 13, 0)
    tower.castShadow = true
    g.add(tower)
    const spire = new THREE.Mesh(new THREE.ConeGeometry(3.6, 4.5, 4), new THREE.MeshStandardMaterial({ color: 0x6b3b2e }))
    spire.position.set(0, 19.5, 0)
    spire.rotation.y = Math.PI / 4
    g.add(spire)
    const clock = new THREE.Mesh(new THREE.CircleGeometry(1.6, 20), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe08a, emissiveIntensity: 1.5 }))
    clock.position.set(0, 15, 2.6)
    g.add(clock)
    g.position.set(-90, 0, -90)
    scene.add(g)
    const m = new THREE.MeshStandardMaterial({ color: 0xe7e2d6, roughness: 0.9 })
    buildingMats.push(m)
    const data: SimData = { kind: 'building', name: 'Town Hall', conf: 0.97, height: 22 }
    body.userData = data
    clickable.push(body)
    detectables.push(body)
  })()

  const blocks: [number, number][] = []
  for (let i = 0; i < GRID.length - 1; i++) {
    for (let j = 0; j < GRID.length - 1; j++) {
      blocks.push([(GRID[i]! + GRID[i + 1]!) / 2, (GRID[j]! + GRID[j + 1]!) / 2])
    }
  }
  const SKIP: [number, number][] = [[0, 0], [-90, -90]]
  for (const [cx, cz] of blocks) {
    if (SKIP.some(s => Math.abs(s[0] - cx) < 1 && Math.abs(s[1] - cz) < 1)) continue
    const n = Math.random() < 0.62 ? 1 : 2
    for (let k = 0; k < n; k++) makeHouse(cx + rnd(-22, 22), cz + rnd(-22, 22))
  }

  /* ---------- 行道树 + 路灯 ---------- */
  function makeTree(x: number, z: number) {
    const g = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 4, 6), new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 1 }))
    trunk.position.y = 2
    trunk.castShadow = true
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(rnd(2.4, 3.6), 8, 8), new THREE.MeshStandardMaterial({ color: 0x1f6b46, emissive: 0x0c2a1c, roughness: 1 }))
    leaf.position.y = 5.4
    leaf.castShadow = true
    g.add(trunk, leaf)
    g.position.set(x, 0, z)
    scene.add(g)
    const data: SimData = { kind: 'tree', name: 'Roadside Tree', conf: 0.97 }
    leaf.userData = data
    clickable.push(leaf)
    detectables.push(leaf)
  }
  function makeStreetLight(x: number, z: number) {
    const g = new THREE.Group()
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 9, 6), new THREE.MeshStandardMaterial({ color: 0x2a3242, metalness: 0.6, roughness: 0.5 }))
    pole.position.y = 4.5
    pole.castShadow = true
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe08a, emissiveIntensity: 2 }))
    lamp.position.y = 9
    g.add(pole, lamp)
    g.position.set(x, 0, z)
    scene.add(g)
  }
  for (const x of GRID) {
    for (const z of GRID) {
      if (Math.random() < 0.6) makeTree(x + (x < 0 ? -10 : 10), z + (z < 0 ? -10 : 10))
      if (Math.random() < 0.35) makeStreetLight(x - 9, z - 9)
    }
  }

  /* ---------- 红绿灯 ---------- */
  const lights: LightObj[] = []
  function makeTrafficLight(x: number, z: number, rot: number) {
    const g = new THREE.Group()
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 11, 6), new THREE.MeshStandardMaterial({ color: 0x394256, metalness: 0.5 }))
    pole.position.y = 5.5
    pole.castShadow = true
    g.add(pole)
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.4, 1.4), new THREE.MeshStandardMaterial({ color: 0x10141f }))
    box.position.y = 11
    g.add(box)
    const cols = [0xff4d6d, 0xffd23f, 0x3dffa6]
    const lamps = cols.map((c, i) => {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 10), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.15 }))
      l.position.set(0, 12.4 - i * 1.1, 0.75)
      g.add(l)
      return l
    })
    g.position.set(x, 0, z)
    g.rotation.y = rot
    scene.add(g)
    const obj: LightObj = { group: g, lamps, phase: Math.random() }
    lights.push(obj)
    const hit = new THREE.Mesh(new THREE.BoxGeometry(2, 14, 2), new THREE.MeshBasicMaterial({ visible: false }))
    hit.position.set(x, 7, z)
    const data: SimData = {
      kind: 'light',
      name: 'Smart Traffic Light',
      conf: 0.99,
      getState: () => lightState(obj).state
    }
    hit.userData = data
    scene.add(hit)
    clickable.push(hit)
    detectables.push(hit)
  }

  /** 红绿灯相位 → { 状态, 剩余秒 }（周期 = LIGHT_T） */
  const LIGHT_T = 9
  function lightState(L: LightObj): { state: LightPhase, remain: number } {
    const p = ((L.phase % 1) + 1) % 1
    if (p < 0.5) return { state: 'Red', remain: (0.5 - p) * LIGHT_T }
    if (p < 0.7) return { state: 'Yellow', remain: (0.7 - p) * LIGHT_T }
    return { state: 'Green', remain: (1.0 - p) * LIGHT_T }
  }
  ;[[-60, -60], [60, -60], [-60, 60], [60, 60], [0, 0], [120, 120], [-120, -120]].forEach(([x, z], i) => makeTrafficLight(x!, z!, i * 0.7))

  /* ---------- EGO 车 ---------- */
  const ego = new THREE.Group()
  scene.add(ego)
  let egoLidar!: THREE.Group
  let egoTailMat!: THREE.MeshStandardMaterial
  ;(() => {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x10243f, metalness: 0.7, roughness: 0.35 })
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a1626, metalness: 0.9, roughness: 0.1, emissive: 0x14304f, emissiveIntensity: 0.5 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.4, 9), bodyMat)
    body.position.y = 1.2
    body.castShadow = true
    ego.add(body)
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.3, 4.6), glassMat)
    cabin.position.set(0, 2.2, -0.3)
    cabin.castShadow = true
    ego.add(cabin)
    const wm = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 })
    for (const [x, z] of [[-2.3, 3], [2.3, 3], [-2.3, -3], [2.3, -3]] as const) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.8, 16), wm)
      w.rotation.z = Math.PI / 2
      w.position.set(x, 1, z)
      w.castShadow = true
      ego.add(w)
    }
    const hl = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcfe6ff, emissiveIntensity: 2 })
    for (const x of [-1.4, 1.4]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.2), hl)
      l.position.set(x, 1.2, 4.5)
      ego.add(l)
    }
    const tl = new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xff2233, emissiveIntensity: 2 })
    for (const x of [-1.6, 1.6]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.2), tl)
      l.position.set(x, 1.2, -4.5)
      ego.add(l)
    }
    const lidar = new THREE.Group()
    lidar.position.set(0, 3, -0.3)
    lidar.add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 16), new THREE.MeshStandardMaterial({ color: 0x222a38, metalness: 0.6 })))
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.45, 16), new THREE.MeshStandardMaterial({ color: 0x39e7ff, emissive: 0x39e7ff, emissiveIntensity: 1.2 }))
    dome.position.y = 0.45
    lidar.add(dome)
    ego.add(lidar)
    egoLidar = lidar
    egoTailMat = tl
  })()

  /* ---------- NPC 车辆 ---------- */
  const cars: SimCar[] = []
  const carColors = [0xff5a5a, 0x5ad1ff, 0xffd23f, 0x9b7bff, 0x4dffa6, 0xffffff, 0xff8a3d]
  function makeOtherCar() {
    const g = new THREE.Group()
    const c = pickOne(carColors)
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.3, 7.6), new THREE.MeshStandardMaterial({ color: c, metalness: 0.5, roughness: 0.4 }))
    body.position.y = 1.1
    body.castShadow = true
    g.add(body)
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 3.8), new THREE.MeshStandardMaterial({ color: 0x0a1626, metalness: 0.8, roughness: 0.15 }))
    cab.position.set(0, 2, -0.2)
    cab.castShadow = true
    g.add(cab)
    const wm = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.9 })
    for (const [x, z] of [[-1.9, 2.6], [1.9, 2.6], [-1.9, -2.6], [1.9, -2.6]] as const) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.7, 14), wm)
      w.rotation.z = Math.PI / 2
      w.position.set(x, 0.85, z)
      g.add(w)
    }
    scene.add(g)
    const d: CarData = {
      kind: 'car',
      name: 'Vehicle ' + String.fromCharCode(65 + rint(0, 25)) + rint(10, 99),
      conf: 0.88 + Math.random() * 0.11,
      horizontal: Math.random() < 0.5,
      lane: pickOne(GRID),
      dir: Math.random() < 0.5 ? 1 : -1,
      speed: rnd(8, 20),
      actSpeed: rnd(8, 20),
      pos: rnd(-200, 200)
    }
    body.userData = d
    g.userData = d
    cars.push({ group: g, d })
    clickable.push(body)
    detectables.push(body)
  }
  for (let i = 0; i < 12; i++) makeOtherCar()

  /* ---------- 行人 ---------- */
  const peds: SimPed[] = []
  function makePed() {
    const g = new THREE.Group()
    const c = pickOne([0x3dffa6, 0x5ad1ff, 0xffd23f, 0xff5a5a, 0xffffff])
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.6, 10), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.25, roughness: 0.8 }))
    body.position.y = 1.1
    body.castShadow = true
    g.add(body)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 10), new THREE.MeshStandardMaterial({ color: 0xf2c9a0 }))
    head.position.y = 1.9
    g.add(head)
    scene.add(g)
    const lane = pickOne(GRID)
    const dir = Math.random() < 0.5 ? 1 : -1
    const speed = rnd(1.5, 3.5)
    const d: PedData = {
      kind: 'ped',
      name: 'Pedestrian P' + rint(100, 999),
      conf: 0.82 + Math.random() * 0.16,
      lane,
      dir,
      speed,
      px: lane + (dir > 0 ? 4 : -4),
      pz: rnd(-180, 180),
      vx: 0,
      vz: dir * speed,
      crossing: false,
      crossCooldown: rnd(2, 7)
    }
    body.userData = d
    g.userData = d
    peds.push({ group: g, d })
    clickable.push(body)
    detectables.push(body)
  }
  for (let i = 0; i < 16; i++) makePed()

  /** 规划器的联合扫描列表（车 + 行人），初始化后固定 */
  const agents: { group: THREE.Group, d: SimData }[] = [...cars, ...peds]

  /* ---------- 传感器可视化：LiDAR 点云 + 扫描扇面 ---------- */
  const lidarGroup = new THREE.Group()
  ego.add(lidarGroup)
  const scan = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 46, 48, 1, 0, Math.PI * 0.5),
    new THREE.MeshBasicMaterial({ color: 0x39e7ff, transparent: true, opacity: 0.14, side: THREE.DoubleSide })
  )
  scan.rotation.x = -Math.PI / 2
  lidarGroup.add(scan)
  const NPTS = 200
  const pPos = new Float32Array(NPTS * 3)
  const pGeo = new THREE.BufferGeometry()
  const pAttr = new THREE.BufferAttribute(pPos, 3)
  pGeo.setAttribute('position', pAttr)
  const lidarPts = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0x39e7ff, size: 0.6, transparent: true, opacity: 0.7 }))
  lidarGroup.add(lidarPts)
  const _lo = new THREE.Vector3()
  const _ld = new THREE.Vector3()
  const _lw = new THREE.Vector3()
  const lidarRay = new THREE.Raycaster()
  function updateLidarCloud() {
    lidarGroup.getWorldPosition(_lo)
    let k = 0
    for (let i = 0; i < NPTS; i++) {
      const a = (i / NPTS) * Math.PI * 2
      const el = (i % 3 - 1) * 0.16
      _ld.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el))
      lidarRay.set(_lo, _ld)
      const hits = lidarRay.intersectObject(scene, true)
      let best: THREE.Intersection | null = null
      for (const h of hits) {
        let p: THREE.Object3D | null = h.object
        let skip = false
        while (p) {
          if (p === ego) {
            skip = true
            break
          }
          p = p.parent
        }
        if (!skip) {
          best = h
          break
        }
      }
      if (best) {
        const d = best.point.distanceTo(_lo)
        if (d < 46) {
          _lw.copy(best.point)
          lidarGroup.worldToLocal(_lw)
          pPos[k * 3] = _lw.x
          pPos[k * 3 + 1] = _lw.y
          pPos[k * 3 + 2] = _lw.z
          k++
        }
      }
    }
    pGeo.setDrawRange(0, k)
    pAttr.needsUpdate = true
  }
  const camFov = new THREE.Mesh(
    new THREE.ConeGeometry(16, 70, 4, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x3dffa6, transparent: true, opacity: 0.12, side: THREE.DoubleSide })
  )
  camFov.rotation.x = Math.PI / 2
  camFov.position.set(0, 1.5, 38)
  ego.add(camFov)
  const radar = new THREE.Mesh(
    new THREE.RingGeometry(2, 80, 40, 1, Math.PI * 0.78, Math.PI * 0.44),
    new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.12, side: THREE.DoubleSide })
  )
  radar.rotation.x = -Math.PI / 2
  ego.add(radar)

  /* ---------- 轨迹预测线 ---------- */
  const TN = 60
  const trajPos = new Float32Array(TN * 3)
  const trajGeo = new THREE.BufferGeometry()
  const trajAttr = new THREE.BufferAttribute(trajPos, 3)
  trajGeo.setAttribute('position', trajAttr)
  const trajLine = new THREE.Line(trajGeo, new THREE.LineBasicMaterial({ color: 0x39e7ff, transparent: true, opacity: 0.85 }))
  scene.add(trajLine)
  const trajEnd = new THREE.Mesh(
    new THREE.RingGeometry(2.4, 3.2, 20),
    new THREE.MeshBasicMaterial({ color: 0x39e7ff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
  )
  trajEnd.rotation.x = -Math.PI / 2
  scene.add(trajEnd)

  /* ---------- 检测框池 + 标签池 ---------- */
  const boxPool: THREE.Mesh[] = []
  const boxGeo = new THREE.BoxGeometry(1, 1, 1)
  for (let i = 0; i < 48; i++) {
    const m = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }))
    m.visible = false
    scene.add(m)
    boxPool.push(m)
  }
  const labelsEl = $('av-labels')
  const labPool: HTMLDivElement[] = []
  for (let i = 0; i < 48; i++) {
    const d = document.createElement('div')
    d.className = 'lab'
    d.style.display = 'none'
    labelsEl?.appendChild(d)
    labPool.push(d)
  }

  /* ---------- 行人过街意图预测线 ---------- */
  const pedLines: THREE.Line[] = []
  for (let i = 0; i < 16; i++) {
    const pg = new THREE.BufferGeometry()
    const attr = new THREE.BufferAttribute(new Float32Array(6), 3)
    pg.setAttribute('position', attr)
    const ln = new THREE.Line(pg, new THREE.LineBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85 }))
    ln.visible = false
    ln.userData.attr = attr
    scene.add(ln)
    pedLines.push(ln)
  }

  /* ---------- 雨粒子 ---------- */
  const RN = 1800
  const rainPos = new Float32Array(RN * 3)
  for (let i = 0; i < RN; i++) {
    rainPos[i * 3] = rnd(-240, 240)
    rainPos[i * 3 + 1] = rnd(0, 260)
    rainPos[i * 3 + 2] = rnd(-240, 240)
  }
  const rainGeo = new THREE.BufferGeometry()
  const rainAttr = new THREE.BufferAttribute(rainPos, 3)
  rainGeo.setAttribute('position', rainAttr)
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0x9fd0ff, size: 0.7, transparent: true, opacity: 0.5 }))
  rain.visible = false
  scene.add(rain)

  /* ---------- 行驶路径：沿镇内道路的矩形环路（无斜线、不过冲） ---------- */
  const WAY: [number, number][] = [[120, 120], [120, -120], [-120, -120], [-120, 120]]
  const SEG: { ax: number, az: number, dx: number, dz: number, len: number, dir: THREE.Vector3, start: number }[] = []
  let TOT = 0
  for (let i = 0; i < WAY.length; i++) {
    const [ax, az] = WAY[i]!
    const [bx, bz] = WAY[(i + 1) % WAY.length]!
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz)
    SEG.push({ ax, az, dx, dz, len, dir: new THREE.Vector3(dx / len, 0, dz / len), start: TOT })
    TOT += len
  }
  function samplePath(dist: number, outPos: THREE.Vector3, outFwd: THREE.Vector3) {
    const d = ((dist % TOT) + TOT) % TOT
    let seg = SEG[SEG.length - 1]!
    for (const s of SEG) {
      if (d < s.start + s.len) {
        seg = s
        break
      }
    }
    const local = (d - seg.start) / seg.len
    outPos.set(seg.ax + seg.dx * local, 0, seg.az + seg.dz * local)
    outFwd.copy(seg.dir)
  }

  /* ---------- 状态 ---------- */
  const state = {
    speed: 34,
    paused: false,
    mode: 'AUTO',
    view: 'chase' as AvView,
    weather: 'night' as AvWeather,
    sensors: { lidar: false, camera: false, radar: false, boxes: false, labels: false, traj: false } as Record<SensorKey, boolean>,
    dist: 0,
    battery: 92,
    laneOffset: 0,
    laneTarget: 0,
    effSpeed: 34,
    risk: 0,
    focus: null as THREE.Mesh | null,
    signal: { state: '—', remain: 0 }
  }
  const egoPos = new THREE.Vector3()
  const fwd = new THREE.Vector3()
  const routePt = new THREE.Vector3()
  const tmpTan = new THREE.Vector3()
  const leftVec = new THREE.Vector3()
  const tmpV = new THREE.Vector3()
  const tmpV2 = new THREE.Vector3()
  const tmpV3 = new THREE.Vector3()
  const tmpV4 = new THREE.Vector3()

  /* ---------- 天气预设 ---------- */
  const WEATHER: Record<AvWeather, { bg: number, fog: number, hemi: number, amb: number, ambI: number, sun: number, sunI: number, emi: number, ground: number, fogN: number, fogF: number, rain: boolean }> = {
    day: { bg: 0x9fc4e8, fog: 0xbcd6f0, hemi: 1.1, amb: 0x6a7a90, ambI: 0.7, sun: 0xfff4e0, sunI: 1.4, emi: 0.5, ground: 0x3a4250, fogN: 220, fogF: 950, rain: false },
    night: { bg: 0x070b14, fog: 0x070b14, hemi: 0.55, amb: 0x33405e, ambI: 0.4, sun: 0xbfd4ff, sunI: 0.9, emi: 0.9, ground: 0x0c1018, fogN: 140, fogF: 520, rain: false },
    rain: { bg: 0x10141c, fog: 0x141a24, hemi: 0.5, amb: 0x3a4456, ambI: 0.5, sun: 0x9fb0c8, sunI: 0.5, emi: 0.8, ground: 0x0a0d12, fogN: 60, fogF: 300, rain: true }
  }
  function setWeather(name: AvWeather) {
    const w = WEATHER[name]
    state.weather = name
    scene.background = new THREE.Color(w.bg)
    fog.color = new THREE.Color(w.fog)
    fog.near = w.fogN
    fog.far = w.fogF
    hemi.intensity = w.hemi
    ambLight.color = new THREE.Color(w.amb)
    ambLight.intensity = w.ambI
    sun.color = new THREE.Color(w.sun)
    sun.intensity = w.sunI
    buildingMats.forEach((m) => {
      m.emissiveIntensity = w.emi
    })
    groundMat.color = new THREE.Color(w.ground)
    rain.visible = w.rain
    root.querySelectorAll('[data-av-w]').forEach((b) => {
      b.classList.toggle('on', (b as HTMLElement).dataset.avW === name)
    })
  }

  /* ---------- 音频（碰撞警示音） ---------- */
  let audioCtx: AudioContext | null = null
  let lastBeep = 0
  function ensureAudio() {
    if (!audioCtx) {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (Ctor) audioCtx = new Ctor()
      } catch { /* 无音频环境时静默降级 */ }
    } else if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }
  }
  function beep(freq: number) {
    if (!audioCtx) return
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.type = 'square'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.16, audioCtx.currentTime + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18)
    o.connect(g).connect(audioCtx.destination)
    o.start()
    o.stop(audioCtx.currentTime + 0.2)
  }

  /* ---------- 点选 ---------- */
  const ray = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  let downXY: [number, number] | null = null
  function ndcFromEvent(e: PointerEvent) {
    const r = renderer.domElement.getBoundingClientRect()
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1
    mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1
  }
  renderer.domElement.addEventListener('pointerdown', (e) => {
    downXY = [e.clientX, e.clientY]
    ensureAudio()
  })
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downXY) return
    const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1])
    downXY = null
    if (moved > 6) return
    ndcFromEvent(e)
    ray.setFromCamera(mouse, camera)
    const hits = ray.intersectObjects(clickable, false)
    if (hits.length) {
      showInfo(hits[0]!.object as THREE.Mesh)
      state.focus = hits[0]!.object as THREE.Mesh
      options.onTask?.('inspect')
    } else {
      state.focus = null
    }
  })

  /* ---------- 信息卡 ---------- */
  const ic = $('av-infocard')
  let currentObj: THREE.Mesh | null = null
  function showInfo(obj: THREE.Mesh) {
    const u = obj.userData as SimData | undefined
    if (!u || !u.kind) return
    currentObj = obj
    const t = STR[lang()]
    const dist = egoPos.distanceTo(obj.getWorldPosition(tmpV))
    $('av-ic-sw')?.style.setProperty('background', KIND_COLOR[u.kind])
    const name = $('av-ic-name')
    if (name) name.textContent = u.name
    const type = $('av-ic-type')
    if (type) type.textContent = KIND_TYPE[lang()][u.kind]
    const distEl = $('av-ic-dist')
    if (distEl) distEl.textContent = dist.toFixed(1) + ' m'
    let spd = '0.0'
    let dir = t.static
    if (u.kind === 'car') {
      const cd = obj.userData as CarData
      const cs = cd.actSpeed != null ? cd.actSpeed : cd.speed
      spd = (cs * 3.6).toFixed(1) + ' km/h'
      dir = cd.dir > 0 ? t.receding : t.oncoming
    }
    if (u.kind === 'ped') {
      const pd = obj.userData as PedData
      spd = (pd.speed * 3.6).toFixed(1) + ' km/h'
      dir = pd.crossing ? t.crossing : t.walking
    }
    if (u.kind === 'light' && u.getState) {
      dir = t.light[u.getState()]
      spd = '—'
    }
    if (u.kind === 'building' && u.height) dir = t.tall(u.height)
    const spdEl = $('av-ic-spd')
    if (spdEl) spdEl.textContent = spd
    const dirEl = $('av-ic-dir')
    if (dirEl) dirEl.textContent = dir
    const confEl = $('av-ic-conf')
    if (confEl) confEl.textContent = Math.round(u.conf * 100) + '%'
    ic?.classList.add('show')
  }
  $('av-ic-close')?.addEventListener('click', () => {
    ic?.classList.remove('show')
    state.focus = null
  })
  $('av-ic-focus')?.addEventListener('click', () => {
    if (currentObj) state.focus = currentObj
  })

  /* ---------- 控件 ---------- */
  root.querySelectorAll('[data-av-s]').forEach((b) => {
    b.addEventListener('click', () => {
      const el = b as HTMLElement
      const k = el.dataset.avS as SensorKey
      state.sensors[k] = !state.sensors[k]
      el.classList.toggle('on', state.sensors[k])
      // 教学事件：只在「打开」时计一次
      if (state.sensors[k]) options.onTask?.(`sensor:${k}`)
    })
  })
  function applyView(v: AvView) {
    state.view = v
    state.focus = null
    root.querySelectorAll('[data-av-v]').forEach((x) => {
      x.classList.toggle('on', (x as HTMLElement).dataset.avV === v)
    })
    controls.enabled = state.view === 'orbit'
  }
  root.querySelectorAll('[data-av-v]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = (b as HTMLElement).dataset.avV as AvView
      applyView(v)
      options.onTask?.(`view:${v}`)
    })
  })
  root.querySelectorAll('[data-av-w]').forEach((b) => {
    b.addEventListener('click', () => {
      const w = (b as HTMLElement).dataset.avW as AvWeather
      setWeather(w)
      options.onTask?.(`weather:${w}`)
    })
  })
  const sr = $<HTMLInputElement>('av-speed-range')
  const speedShow = $('av-speed-show')
  sr?.addEventListener('input', () => {
    state.speed = +sr.value
    if (speedShow) speedShow.textContent = sr.value
  })
  const pauseBtn = $('av-btn-pause')
  function syncPauseBtn() {
    if (!pauseBtn) return
    pauseBtn.textContent = state.paused ? STR[lang()].resume : STR[lang()].pause
  }
  pauseBtn?.addEventListener('click', () => {
    state.paused = !state.paused
    state.mode = state.paused ? 'STANDBY' : 'AUTO'
    syncPauseBtn()
  })
  $('av-btn-reset')?.addEventListener('click', () => reset())

  /* ---------- 规划：避让 + 绕行 + 红灯停车 ---------- */
  function planMotion(dt: number) {
    samplePath(state.dist, routePt, fwd)
    fwd.y = 0
    fwd.normalize()
    leftVec.set(fwd.z, 0, -fwd.x).normalize()
    if (state.paused) {
      state.mode = 'STANDBY'
      state.effSpeed = 0
      state.risk = 0
      state.laneOffset += (0 - state.laneOffset) * Math.min(1, dt * 2)
      ego.position.copy(routePt).add(leftVec.clone().multiplyScalar(state.laneOffset))
      ego.position.y = 0
      ego.rotation.y = Math.atan2(fwd.x, fwd.z)
      egoPos.copy(ego.position)
      return
    }

    // 扫描本车道前方障碍
    let threat: { lat: number, d: number } | null = null
    let minD = 1e9
    for (const a of agents) {
      a.group.getWorldPosition(tmpV2)
      const to = tmpV3.copy(tmpV2).sub(egoPos)
      to.y = 0
      const d = to.length()
      if (d > 60) continue
      if (tmpV4.copy(to).normalize().dot(fwd) < 0.85) continue
      const lateral = to.dot(leftVec)
      if (Math.abs(lateral) > 6) continue
      if (d < minD) {
        minD = d
        threat = { lat: lateral, d }
      }
    }

    // 扫描前方红绿灯：最近（HUD 倒计时）+ 红灯停车
    let redLight: { d: number, ls: LightPhase } | null = null
    let redDist = 1e9
    let nearestLight: { state: string, remain: number } | null = null
    let nearDist = 1e9
    for (const L of lights) {
      const lp = L.group.position
      const to = tmpV3.set(lp.x - egoPos.x, 0, lp.z - egoPos.z)
      const d = to.length()
      if (d > 55) continue
      if (tmpV4.copy(to).normalize().dot(fwd) < 0.6) continue
      const lateral = to.dot(leftVec)
      if (Math.abs(lateral) > 10) continue
      const st = lightState(L)
      if (d < nearDist) {
        nearDist = d
        nearestLight = { state: st.state, remain: st.remain }
      }
      if ((st.state === 'Red' || (st.state === 'Yellow' && d < 22)) && d > 2 && d < redDist) {
        redDist = d
        redLight = { d, ls: st.state }
      }
    }
    state.signal = nearestLight || { state: '—', remain: 0 }

    // 扫描有过街意图的行人（意图预测）
    let pedThreat: { d: number, crossing: boolean } | null = null
    let pedMin = 1e9
    for (const p of peds) {
      const u = p.d
      if (!u.crossing && u.crossCooldown > 1.5) continue // 还没打算过街
      p.group.getWorldPosition(tmpV2)
      const to = tmpV3.copy(tmpV2).sub(egoPos)
      to.y = 0
      const d = to.length()
      if (d > 34) continue
      if (tmpV4.copy(to).normalize().dot(fwd) < 0.5) continue
      if (d < pedMin) {
        pedMin = d
        pedThreat = { d, crossing: u.crossing }
      }
    }

    // 速度规划
    let allowSpeed = state.speed
    let mode = 'AUTO'
    let stopAtRed = false
    if (redLight) {
      stopAtRed = true
      const distToStop = redDist - 10 // 停在停止线前 ~10m
      allowSpeed = distToStop <= 0.5 ? 0 : Math.min(allowSpeed, Math.sqrt(2 * 6 * Math.max(0, distToStop)))
    }
    if (threat) {
      const side = threat.lat >= 0 ? -1 : 1
      state.laneTarget = side * 5.5
      if (threat.d < 14) {
        allowSpeed = Math.min(allowSpeed, Math.min(state.speed, 6))
        mode = 'BRAKE'
      } else {
        allowSpeed = Math.min(allowSpeed, state.speed * 0.7)
        mode = 'PLANNING'
      }
    } else {
      state.laneTarget = 0
    }
    if (pedThreat) {
      if (pedThreat.d < 11) {
        allowSpeed = Math.min(allowSpeed, Math.min(state.speed, 5))
        mode = 'BRAKE'
      } else if (pedThreat.d < 18) {
        allowSpeed = Math.min(allowSpeed, state.speed * 0.55)
        mode = mode === 'AUTO' ? 'PLANNING' : mode
      }
    }
    if (stopAtRed) {
      if (allowSpeed < 0.6) mode = 'STOP'
      else if (mode === 'AUTO') mode = 'STOPPING'
    }

    // 模式切换沿（教学事件：红灯刹停 / 障碍急刹各记一次）
    const prevMode = state.mode
    state.effSpeed = allowSpeed
    state.mode = mode
    if (mode !== prevMode) {
      if (mode === 'STOP') options.onTask?.('red-stop')
      else if (mode === 'BRAKE') options.onTask?.('brake')
    }

    // 碰撞风险等级（车辆威胁 + 行人过街威胁）
    let risk = 0
    if (threat) risk = threat.d < 12 ? 2 : threat.d < 22 ? 1 : 0
    if (pedThreat) risk = Math.max(risk, pedThreat.d < 10 ? 2 : pedThreat.d < 18 ? 1 : 0)
    state.risk = risk

    // 应用横向偏移并摆放 EGO
    state.laneOffset += (state.laneTarget - state.laneOffset) * Math.min(1, dt * 2.2)
    state.laneOffset = Math.max(-6, Math.min(6, state.laneOffset))
    ego.position.copy(routePt).add(leftVec.clone().multiplyScalar(state.laneOffset))
    ego.position.y = 0
    ego.rotation.y = Math.atan2(fwd.x, fwd.z)
    egoPos.copy(ego.position)

    // 刹车灯亮度
    if (egoTailMat) egoTailMat.emissiveIntensity = (mode === 'BRAKE' || mode === 'STOP') ? 3.2 : 2
  }

  /* ---------- 迷你地图 ---------- */
  const mini = $<HTMLCanvasElement>('av-mm')
  const mctx = mini ? mini.getContext('2d') : null
  function sizeMini() {
    if (!mini) return
    mini.width = Math.max(mini.clientWidth, 1) * 2
    mini.height = Math.max(mini.clientHeight, 1) * 2
  }
  function drawMini() {
    if (!mini || !mctx) return
    const MM = mini.width
    const MH = mini.height
    const S = Math.min(MM, MH) / 440 // 世界 ±220 → 画布 0..边长（修正原版偏移 bug）
    const w2m = (x: number, z: number): [number, number] => [MM / 2 + x * S, MH / 2 + z * S]
    mctx.clearRect(0, 0, MM, MH)
    mctx.fillStyle = '#0a0f1a'
    mctx.fillRect(0, 0, MM, MH)
    mctx.strokeStyle = 'rgba(120,180,255,.25)'
    mctx.lineWidth = 1
    for (const p of GRID) {
      const a = w2m(p, -220)
      const b = w2m(p, 220)
      mctx.beginPath()
      mctx.moveTo(a[0], a[1])
      mctx.lineTo(b[0], b[1])
      mctx.stroke()
      const c = w2m(-220, p)
      const d = w2m(220, p)
      mctx.beginPath()
      mctx.moveTo(c[0], c[1])
      mctx.lineTo(d[0], d[1])
      mctx.stroke()
    }
    const e = w2m(egoPos.x, egoPos.z)
    mctx.strokeStyle = state.risk >= 2 ? 'rgba(255,77,109,.7)' : 'rgba(57,231,255,.4)'
    mctx.beginPath()
    mctx.arc(e[0], e[1], 46 * S, 0, 7)
    mctx.stroke()
    const dot = (o: THREE.Object3D, col: string) => {
      const p = w2m(o.position.x, o.position.z)
      mctx.fillStyle = col
      mctx.beginPath()
      mctx.arc(p[0], p[1], 2.2, 0, 7)
      mctx.fill()
    }
    cars.forEach(c => dot(c.group, '#ffd23f'))
    peds.forEach(p => dot(p.group, '#3dffa6'))
    const ex = w2m(egoPos.x, egoPos.z)
    mctx.save()
    mctx.translate(ex[0], ex[1])
    mctx.rotate(Math.atan2(fwd.z, fwd.x))
    mctx.fillStyle = state.risk >= 2 ? '#ff4d6d' : '#39e7ff'
    mctx.beginPath()
    mctx.moveTo(5, 0)
    mctx.lineTo(-3, 3)
    mctx.lineTo(-3, -3)
    mctx.closePath()
    mctx.fill()
    mctx.restore()
  }

  /* ---------- 主循环 ---------- */
  const clock = new THREE.Clock()
  let detCount = 0
  let latTimer = 0
  let _lf = 0
  const warnBanner = $('av-warn')
  const alertFrame = $('av-alert-frame')

  function animate() {
    if (disposed) return
    rafId = requestAnimationFrame(animate)
    const dt = Math.min(clock.getDelta(), 0.05)
    latTimer += dt
    if (!state.paused) {
      state.dist = (state.dist + (state.effSpeed / 3.6) * dt) % TOT
      state.battery = Math.max(0, state.battery - dt * 0.02)
    }
    planMotion(dt)

    egoLidar.rotation.y += dt * 4
    lidarGroup.rotation.y += dt * 0.6
    scan.rotation.z -= dt * 2.2
    // LiDAR 点云成本较高：只在感知层打开时隔帧更新
    if (state.sensors.lidar && (_lf++ & 1) === 0) updateLidarCloud()

    // NPC 车流：红灯前停车，其余按各自速度巡航
    cars.forEach((c) => {
      const u = c.d
      const fx = u.horizontal ? u.dir : 0
      const fz = u.horizontal ? 0 : u.dir
      let stop = false
      for (const L of lights) {
        const lp = L.group.position
        const tx = lp.x - c.group.position.x
        const tz = lp.z - c.group.position.z
        const d = Math.hypot(tx, tz)
        if (d > 40) continue
        const inv = 1 / (d || 1)
        if ((tx * inv * fx + tz * inv * fz) < 0.85) continue
        if (lightState(L).state === 'Red' && d < 26) stop = true
      }
      const tgt = stop ? 0 : u.speed
      u.actSpeed += (tgt - u.actSpeed) * Math.min(1, dt * 2.5)
      if (u.actSpeed < 0.15) u.actSpeed = 0
      u.pos += u.dir * u.actSpeed * dt * 1.6
      if (u.pos > 215) u.pos = -215
      if (u.pos < -215) u.pos = 215
      if (u.horizontal) {
        c.group.position.set(u.pos, 0, u.lane)
        c.group.rotation.y = u.dir > 0 ? Math.PI / 2 : -Math.PI / 2
      } else {
        c.group.position.set(u.lane, 0, u.pos)
        c.group.rotation.y = u.dir > 0 ? 0 : Math.PI
      }
    })

    // 行人：随机起意过街，过完回路边
    peds.forEach((p) => {
      const u = p.d
      if (!u.crossing) {
        u.crossCooldown -= dt
        if (u.crossCooldown <= 0 && Math.abs(u.px - u.lane) < 7) {
          u.crossing = true
          const sign = (u.px >= u.lane) ? -1 : 1
          u.vx = sign * u.speed
          u.vz = 0
        }
      } else if ((u.px - u.lane) * Math.sign(u.vx) > 4) {
        u.crossing = false
        u.crossCooldown = rnd(3, 9)
        u.vx = 0
        u.vz = u.dir * u.speed
      }
      u.px += u.vx * dt
      u.pz += u.vz * dt
      if (u.pz > 200) u.pz = -200
      if (u.pz < -200) u.pz = 200
      p.group.position.set(u.px, 0, u.pz)
      p.group.rotation.y = Math.atan2(u.vx, u.vz || 0.0001)
      p.group.position.y = Math.abs(Math.sin(performance.now() * 0.006 + u.lane)) * 0.15
    })

    // 红绿灯相位推进 + 灯泡点亮
    lights.forEach((L) => {
      L.phase = (L.phase + dt / LIGHT_T) % 1
      const st = lightState(L)
      L.lamps.forEach((l, i) => {
        const mat = l.material as THREE.MeshStandardMaterial
        mat.emissiveIntensity = (i === (st.state === 'Red' ? 0 : st.state === 'Yellow' ? 1 : 2)) ? 2 : 0.12
      })
    })

    // 行人过街意图预测线
    let pi = 0
    peds.forEach((p) => {
      const u = p.d
      if (u.crossing && pi < pedLines.length) {
        const ln = pedLines[pi++]!
        const vx = u.vx || 0
        const vz = u.vz || 0
        const m = Math.hypot(vx, vz) || 1
        const len = 12
        const a = (ln.userData.attr as THREE.BufferAttribute).array as Float32Array
        a[0] = u.px
        a[1] = 0.6
        a[2] = u.pz
        a[3] = u.px + vx / m * len
        a[4] = 0.6
        a[5] = u.pz + vz / m * len
        ;(ln.userData.attr as THREE.BufferAttribute).needsUpdate = true
        ln.visible = true
      }
    })
    for (; pi < pedLines.length; pi++) pedLines[pi]!.visible = false

    lidarGroup.visible = state.sensors.lidar
    camFov.visible = state.sensors.camera
    radar.visible = state.sensors.radar
    trajLine.visible = state.sensors.traj
    trajEnd.visible = state.sensors.traj

    if (state.sensors.traj) {
      for (let i = 0; i < TN; i++) {
        samplePath(state.dist + (i / (TN - 1)) * 90, routePt, tmpTan)
        tmpTan.y = 0
        tmpTan.normalize()
        const lv = tmpV4.set(tmpTan.z, 0, -tmpTan.x).normalize()
        trajPos[i * 3] = routePt.x + lv.x * state.laneOffset
        trajPos[i * 3 + 1] = 0.6
        trajPos[i * 3 + 2] = routePt.z + lv.z * state.laneOffset
      }
      trajAttr.needsUpdate = true
      trajEnd.position.set(trajPos[(TN - 1) * 3]!, 0.6, trajPos[(TN - 1) * 3 + 2]!)
    }

    // 感知：距离 + 视锥门限 → 检测框 / 标签 / 面板列表
    const RANGE = state.sensors.camera ? 70 : 46
    const fwdNorm = tmpV.set(fwd.x, 0, fwd.z).normalize()
    let bi = 0
    let li = 0
    const detList: { o: THREE.Mesh, d: number }[] = []
    boxPool.forEach((b) => {
      b.visible = false
    })
    labPool.forEach((l) => {
      l.style.display = 'none'
    })
    detectables.forEach((o) => {
      o.getWorldPosition(tmpV)
      const d = egoPos.distanceTo(tmpV)
      if (d > RANGE) return
      const toObj = tmpV2.copy(tmpV).sub(egoPos)
      toObj.y = 0
      if (toObj.normalize().dot(fwdNorm) < (state.sensors.camera ? 0.3 : -0.2)) return
      const u = o.userData as SimData
      if (state.sensors.boxes && bi < boxPool.length) {
        const b = boxPool[bi++]!
        const k = u.kind
        const s = k === 'building' ? { x: 16, y: u.height || 8, z: 16 } : k === 'car' ? { x: 4.4, y: 2.6, z: 8.4 } : k === 'ped' ? { x: 1.4, y: 2.2, z: 1.4 } : k === 'light' ? { x: 2, y: 14, z: 2 } : { x: 5, y: 5, z: 5 }
        b.position.copy(tmpV)
        if (k === 'building') b.position.y = (u.height || 8) / 2
        else if (k === 'light') b.position.y = 7
        else b.position.y = s.y / 2
        b.scale.set(s.x, s.y, s.z)
        ;(b.material as THREE.MeshBasicMaterial).color.setHex(KIND_HEX[k])
        b.visible = true
      }
      detList.push({ o, d })
    })
    detCount = detList.length

    if (state.sensors.labels) {
      const SW = stage.clientWidth
      const SH = stage.clientHeight
      for (const { o, d } of detList.slice(0, labPool.length)) {
        const u = o.userData as SimData
        const p = o.getWorldPosition(new THREE.Vector3())
        p.y += (u.kind === 'building' ? (u.height || 8) : 6)
        p.project(camera)
        if (p.z > 1) continue
        const sx = (p.x * 0.5 + 0.5) * SW
        const sy = (-p.y * 0.5 + 0.5) * SH
        const el = labPool[li++]!
        el.style.display = 'block'
        el.style.left = sx + 'px'
        el.style.top = sy + 'px'
        const conf = Math.round(u.conf * 100)
        el.innerHTML = '<b style="color:' + KIND_COLOR[u.kind] + '">' + KIND_LABEL[lang()][u.kind] + '</b> ' + conf + '% · ' + d.toFixed(0) + 'm'
      }
    }

    updateDetectPanel(detList)

    // 相机：聚焦目标 / 环绕 / 追逐 / 俯视 / 舱内
    if (state.focus) {
      const fp = state.focus.getWorldPosition(tmpV3)
      const fu = state.focus.userData as SimData
      const sz = fu.kind === 'building' ? (fu.height || 8) : 8
      const dir = tmpV4.copy(fp).sub(egoPos)
      dir.y = 0
      dir.normalize()
      const goal = fp.clone().add(dir.multiplyScalar(-sz * 1.5)).add(new THREE.Vector3(0, sz * 0.8 + 6, 0))
      camera.position.lerp(goal, 0.07)
      camera.lookAt(fp.x, fp.y + sz * 0.4, fp.z)
    } else if (state.view === 'orbit') {
      controls.target.lerp(egoPos, 0.1)
      controls.update()
    } else {
      if (state.view === 'chase') {
        const back = new THREE.Vector3(-fwd.x, 0, -fwd.z).normalize()
        camera.position.lerp(tmpV.copy(egoPos).add(back.multiplyScalar(34)).add(new THREE.Vector3(0, 16, 0)), 0.08)
        camera.lookAt(egoPos.x, egoPos.y + 4, egoPos.z)
      } else if (state.view === 'top') {
        camera.position.lerp(tmpV.copy(egoPos).add(new THREE.Vector3(0, 150, 0)), 0.08)
        camera.lookAt(egoPos)
      } else if (state.view === 'cockpit') {
        camera.position.lerp(tmpV.copy(egoPos).add(new THREE.Vector3(fwd.x * 2, 3.2, fwd.z * 2)), 0.2)
        camera.lookAt(egoPos.x + fwd.x * 30, egoPos.y + 2.5, egoPos.z + fwd.z * 30)
      }
    }

    if (rain.visible) {
      for (let i = 0; i < RN; i++) {
        const y = (rainPos[i * 3 + 1] ?? 0) - dt * 130
        rainPos[i * 3 + 1] = y < 0 ? y + 260 : y
      }
      rainAttr.needsUpdate = true
    }

    // 碰撞警示：视觉 + 声音
    const t = STR[lang()]
    if (state.risk >= 2) {
      if (warnBanner) {
        warnBanner.textContent = t.collision
        warnBanner.className = 'on danger'
      }
      if (alertFrame) alertFrame.style.opacity = (0.35 + 0.25 * Math.sin(performance.now() * 0.012)).toFixed(2)
    } else if (state.risk === 1) {
      if (warnBanner) {
        warnBanner.textContent = t.caution
        warnBanner.className = 'on caution'
      }
      if (alertFrame) alertFrame.style.opacity = '0'
    } else {
      if (warnBanner) warnBanner.className = ''
      if (alertFrame) alertFrame.style.opacity = '0'
    }
    if (audioCtx && state.risk >= 1) {
      const now = performance.now()
      const iv = state.risk >= 2 ? 380 : 780
      if (now - lastBeep > iv) {
        lastBeep = now
        beep(state.risk >= 2 ? 880 : 600)
      }
    }

    updateHud(t)
    drawMini()
    renderer.render(scene, camera)
  }

  /* ---------- HUD ---------- */
  const speedVal = $('av-speed-val')
  const modeVal = $('av-mode-val')
  const detVal = $('av-det-val')
  const latVal = $('av-lat-val')
  const sigVal = $('av-sig-val')
  const riskVal = $('av-risk-val')
  const batVal = $('av-bat-val')
  const batBar = $('av-bat-bar')
  const gpsVal = $('av-gps-val')

  function updateHud(t: typeof STR.zh) {
    if (speedVal) speedVal.textContent = String(state.paused ? 0 : Math.round(state.effSpeed))
    if (modeVal) modeVal.textContent = state.mode
    if (detVal) detVal.textContent = String(detCount)
    if (riskVal) {
      if (state.risk >= 2) {
        riskVal.textContent = t.danger
        riskVal.style.color = 'var(--red)'
      } else if (state.risk === 1) {
        riskVal.textContent = STR[lang()].caution.replace('◈ ', '')
        riskVal.style.color = 'var(--yellow)'
      } else {
        riskVal.textContent = t.safe
        riskVal.style.color = 'var(--green)'
      }
    }
    const sig = state.signal
    if (sigVal) {
      if (sig.state === '—') {
        sigVal.textContent = t.none
        sigVal.style.color = 'var(--dim)'
      } else {
        const name = sig.state === 'Red' ? t.light.Red : sig.state === 'Yellow' ? t.light.Yellow : t.light.Green
        sigVal.textContent = name + ' ' + sig.remain.toFixed(0) + 's'
        sigVal.style.color = sig.state === 'Red' ? 'var(--red)' : sig.state === 'Yellow' ? 'var(--yellow)' : 'var(--green)'
      }
    }
    if (batVal) batVal.textContent = Math.round(state.battery) + '%'
    if (batBar) batBar.style.width = state.battery + '%'
    if (latTimer > 0.4) {
      latTimer = 0
      if (latVal) latVal.textContent = (14 + Math.round(Math.random() * 10)) + ' ms'
    }
    if (gpsVal) {
      const lat = (22.7 + egoPos.z * 0.00006).toFixed(5)
      const lon = (114.1 + egoPos.x * 0.00006).toFixed(5)
      gpsVal.textContent = lat + 'N ' + lon + 'E'
    }
  }

  /* ---------- 感知面板（节流） ---------- */
  const detListEl = $('av-det-list')
  const detCountEl = $('av-det-count')
  let lastDetKey = ''
  function updateDetectPanel(list: { o: THREE.Mesh, d: number }[]) {
    if (!detListEl || !detCountEl) return
    detCountEl.textContent = String(list.length)
    if (list.length === 0) {
      detListEl.innerHTML = '<div class="empty">' + STR[lang()].empty + '</div>'
      lastDetKey = ''
      return
    }
    const sorted = list.slice().sort((a, b) => a.d - b.d).slice(0, 12)
    const key = sorted.map(x => (x.o.userData as SimData).name + x.d.toFixed(0)).join('|')
    if (key === lastDetKey) return
    lastDetKey = key
    detListEl.innerHTML = ''
    for (const { o, d } of sorted) {
      const u = o.userData as SimData
      const div = document.createElement('div')
      div.className = 'ditem'
      div.innerHTML = '<span class="sw" style="background:' + KIND_COLOR[u.kind] + '"></span><span class="nm">' + u.name + '</span><span class="ds">' + d.toFixed(0) + 'm</span>'
      div.onclick = () => {
        showInfo(o)
        state.focus = o
        options.onTask?.('inspect')
      }
      detListEl.appendChild(div)
    }
  }

  /* ---------- 重置 ---------- */
  function reset() {
    state.dist = 0
    state.battery = 92
    state.laneOffset = 0
    state.laneTarget = 0
    state.focus = null
    state.risk = 0
    ic?.classList.remove('show')
  }

  /* ---------- 尺寸 ---------- */
  function resize() {
    const w = Math.max(stage.clientWidth, 1)
    const h = Math.max(stage.clientHeight, 1)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    sizeMini()
  }
  const ro = new ResizeObserver(resize)

  /* ---------- 初始化 ---------- */
  ro.observe(stage)
  resize()
  setWeather('night')
  samplePath(0, egoPos, fwd)
  ego.position.copy(egoPos)
  animate()

  return {
    dispose() {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
      ro.disconnect()
      controls.dispose()
      if (audioCtx) {
        audioCtx.close().catch(() => {})
        audioCtx = null
      }
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else if (mat) mat.dispose()
      })
      renderer.dispose()
    },
    isPaused: () => state.paused,
    setPaused(paused) {
      state.paused = paused
      state.mode = paused ? 'STANDBY' : 'AUTO'
      syncPauseBtn()
    },
    setSpeed(kmh) {
      state.speed = kmh
      if (sr) sr.value = String(kmh)
      if (speedShow) speedShow.textContent = String(kmh)
    },
    setView(v) {
      applyView(v)
    },
    setWeather(w) {
      setWeather(w)
    },
    reset
  }
}
