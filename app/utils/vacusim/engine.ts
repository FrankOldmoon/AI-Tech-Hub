/**
 * VacuSim 扫地机器人仿真 —— 3D 引擎。
 *
 * 从独立单文件页（Downloads/2.html）移植：
 *   - 房间与障碍建模、覆盖率栅格、灰尘粒子、路径规划状态机（auto/spot/edge/dock）、
 *     LiDAR 射线、迷你地图这套命令式逻辑保持原样；
 *   - 把「自己造整页 DOM + position:fixed 铺满视口 + document.getElementById」换成
 *     「调用方传入页面根节点，引擎在根节点内按 id 取节点」，于是能在 Nuxt 页里挂载/卸载。
 *
 * 依赖全部走 npm（`import * as THREE from 'three'`），页面里没有任何 CDN 引用。
 *
 * 顺手修掉原版一处坐标转置 bug：灰尘按格心摆放时把 (行, 列) 当成了 (列, 行)，
 * 于是会有灰尘落在沙发/桌子内部；这里按 cellIndex 的定义正确还原。
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type Lang = 'zh' | 'en'
export type CleanMode = 'auto' | 'spot' | 'edge' | 'dock'

export interface LocalizedText {
  zh: string
  en: string
}

export interface KnowledgeCard {
  id: string
  icon: string
  label: LocalizedText
  name: LocalizedText
  sub: LocalizedText
  desc: LocalizedText
  principle: LocalizedText
  tags: { k: LocalizedText, v: string }[]
}

/** 知识卡片按钮（模板渲染按钮用）+ 弹窗内容 */
export const VACUSIM_KNOWLEDGE: KnowledgeCard[] = [
  {
    id: 'lidar',
    icon: '📡',
    label: { zh: 'LiDAR 与 SLAM', en: 'LiDAR & SLAM' },
    name: { zh: 'LiDAR 与 SLAM', en: 'LiDAR & SLAM' },
    sub: { zh: '定位 · 建图', en: 'Localization · Mapping' },
    desc: {
      zh: '现代扫地机器人用旋转 360° 激光雷达（LiDAR）测距，每秒对墙面与家具扫描几十次。',
      en: 'Modern robot vacuums use a spinning 360° LiDAR (light detection and ranging) to measure distances to walls and furniture dozens of times per second.'
    },
    principle: {
      zh: '每束红外/激光打到物体后反射回来，用飞行时间（ToF，或相位差）算出精确距离。把成千上万个测距样本与轮式里程计融合，机器人就能跑 SLAM（同步定位与建图），一面建出户型图、一面跟踪自己的位姿。',
      en: 'Each pulse of infrared/laser light is reflected by surfaces; the time-of-flight (or phase difference) gives a precise range. By fusing thousands of range samples with wheel odometry, the robot runs SLAM (Simultaneous Localization And Mapping) to build a floor-plan while tracking its own pose.'
    },
    tags: [
      { k: { zh: '类型', en: 'Type' }, v: 'ToF / dToF' },
      { k: { zh: '量程', en: 'Range' }, v: '8–12 m' },
      { k: { zh: '转速', en: 'Spin' }, v: '5–20 Hz' },
      { k: { zh: '融合', en: 'Fuse' }, v: 'odometry + IMU' }
    ]
  },
  {
    id: 'planning',
    icon: '🧭',
    label: { zh: '覆盖路径规划', en: 'Coverage Planning' },
    name: { zh: '覆盖路径规划', en: 'Coverage Path Planning' },
    sub: { zh: '怎么才能扫干净', en: 'How it cleans everything' },
    desc: {
      zh: '规划器决定路线，让机器人（几乎）走到每一处，又不至于反复扫同一块地。',
      en: 'Coverage planning decides the route so the robot reaches (almost) every spot without endless repetition.'
    },
    principle: {
      zh: '常见策略：① 弹跳式/随机——碰到就转向，便宜简单；② 弓字形（boustrophedon，像割草机）——走平行道，系统性覆盖；③ 沿边——先贴墙描一圈再填内部。真实产品会结合 SLAM 地图组合使用，把漏扫面积压到最小。',
      en: 'Common strategies: (1) Bounce / random — turn on contact, cheap and simple; (2) Boustrophedon ("lawn-mower") — parallel lanes for systematic coverage; (3) Edge-follow — trace walls first, then fill the interior. Real products combine these with the SLAM map to minimize missed areas.'
    },
    tags: [
      { k: { zh: '弹跳式', en: 'Bounce' }, v: 'random + avoid' },
      { k: { zh: '弓字形', en: 'Lawn-mower' }, v: 'parallel lanes' },
      { k: { zh: '沿边', en: 'Edge' }, v: 'wall tracing' },
      { k: { zh: '指标', en: 'Metric' }, v: 'coverage %' }
    ]
  },
  {
    id: 'sensors',
    icon: '🛡️',
    label: { zh: '碰撞与悬崖传感器', en: 'Bumper & Cliff' },
    name: { zh: '碰撞与悬崖传感器', en: 'Bumper & Cliff Sensors' },
    sub: { zh: '安全 · 防跌落', en: 'Safety · Anti-fall' },
    desc: {
      zh: '物理碰撞条与红外传感器负责不让机器人撞坏东西或者掉下楼梯。',
      en: 'Physical and infrared sensors stop the robot from crashing or falling down stairs.'
    },
    principle: {
      zh: '前部碰撞条里的微动开关检测碰撞，触发后转向避开。悬崖传感器是朝下的红外发射/接收对；反射光突然消失就说明下面是空的（楼梯/边缘），机器人立刻后退。本仿真里橙色「悬崖」区块就会触发这个行为。',
      en: 'A front bumper with micro-switches detects collisions and triggers a turn-away. Cliff sensors are downward-facing IR emitters/receivers; a sudden lack of reflected light means a drop (stair/edge), so the robot reverses. In this sim the orange "cliff" tile triggers that behavior.'
    },
    tags: [
      { k: { zh: '碰撞条', en: 'Bumper' }, v: 'contact switch' },
      { k: { zh: '悬崖', en: 'Cliff' }, v: 'downward IR' },
      { k: { zh: '动作', en: 'Action' }, v: 'reverse + turn' },
      { k: { zh: '场景', en: 'Use' }, v: 'anti-fall' }
    ]
  },
  {
    id: 'brush',
    icon: '🌀',
    label: { zh: '刷组与吸力系统', en: 'Brush & Suction' },
    name: { zh: '刷组与吸力系统', en: 'Brush & Suction System' },
    sub: { zh: '搅动 · 拾取', en: 'Agitation · Pickup' },
    desc: {
      zh: '机械搅动把垃圾松起来，气流才能把它吸进尘盒。',
      en: 'Mechanical agitation loosens debris so the vacuum airflow can lift it into the bin.'
    },
    principle: {
      zh: '边刷把角落与墙边的垃圾扫向中间；主滚刷（刷毛 + 橡胶鳍片）搅动地面；离心风机产生约 1.5–2.5 kPa 的负压，把灰尘经风道送进尘盒。本仿真里进入机器人半径内的灰尘会播放「被吸进去」的动画。',
      en: 'A side brush sweeps corners and edges toward the center; a main roller (bristles + rubber fins) agitates the floor; a centrifugal fan creates ~1.5–2.5 kPa suction that carries dust through a duct into the dust bin. Here, dirt within the robot radius is "sucked in" with an animation.'
    },
    tags: [
      { k: { zh: '边刷', en: 'Side brush' }, v: 'edge sweep' },
      { k: { zh: '主滚刷', en: 'Main roller' }, v: 'agitate' },
      { k: { zh: '风机', en: 'Fan' }, v: '1.5–2.5 kPa' },
      { k: { zh: '尘盒', en: 'Bin' }, v: 'collects dust' }
    ]
  },
  {
    id: 'battery',
    icon: '🔋',
    label: { zh: '电池与续航', en: 'Battery & Runtime' },
    name: { zh: '电池与续航', en: 'Battery & Runtime' },
    sub: { zh: '能量 · 持久', en: 'Energy · Endurance' },
    desc: {
      zh: '扫地机器人靠可充锂电供电，续航取决于吸力档位、行驶速度与地面材质。',
      en: 'Robot vacuums run on rechargeable Li-ion cells; runtime depends on suction power, speed and floor type.'
    },
    principle: {
      zh: '典型容量 2000–5200 mAh、14.4–21.6 V，单次充电约跑 60–150 分钟；耗电随吸力上升。电量低时机器人靠红外回充座归位补电——对应这里「返回充电」按钮的行为。',
      en: 'Typical capacities are 2,000–5,200 mAh at 14.4–21.6 V, giving ~60–150 min per charge. Energy use scales with suction level. When low, the robot returns to its dock (infrared homing) to recharge — reproduced by the "Return to Dock" button.'
    },
    tags: [
      { k: { zh: '电芯', en: 'Cell' }, v: 'Li-ion' },
      { k: { zh: '容量', en: 'Capacity' }, v: '2–5.2 Ah' },
      { k: { zh: '续航', en: 'Runtime' }, v: '60–150 min' },
      { k: { zh: '回充', en: 'Dock' }, v: 'auto recharge' }
    ]
  },
  {
    id: 'filter',
    icon: '🌬️',
    label: { zh: '过滤（HEPA）', en: 'Filtration (HEPA)' },
    name: { zh: '过滤（HEPA）', en: 'Filtration (HEPA)' },
    sub: { zh: '空气质量 · 过敏原', en: 'Air quality · Allergens' },
    desc: {
      zh: '排出的空气要先经过滤芯，把细颗粒拦下来，回到房间的才是干净风。',
      en: 'The exhaust passes through a filter that traps fine particles before clean air returns to the room.'
    },
    principle: {
      zh: 'HEPA 级（常见 E11/H13）滤芯能拦下约 0.3 µm 颗粒的 ≥99.5%，包括花粉、螨虫与 PM2.5。定期清洗/更换滤芯才能保住吸力，并避免把过敏原又吹回屋里。',
      en: 'A HEPA-grade (often E11/H13) filter captures ≥ 99.5% of particles down to ~0.3 µm, including pollen, mites and fine dust (PM2.5). Regular filter washing/replacement keeps suction strong and prevents recirculation of allergens.'
    },
    tags: [
      { k: { zh: '等级', en: 'Grade' }, v: 'HEPA E11/H13' },
      { k: { zh: '效率', en: 'Efficiency' }, v: '≥99.5% @0.3µm' },
      { k: { zh: '拦截', en: 'Captures' }, v: 'PM2.5, pollen' },
      { k: { zh: '维护', en: 'Care' }, v: 'wash / replace' }
    ]
  }
]

export interface VacuSimStats {
  coverage: number
  battery: number
  dustLeft: number
  distance: number
  turns: number
  mode: CleanMode
}

export interface VacuSimOptions {
  getLocale: () => Lang
  /** 完成一次教学交互（切模式 / 开关可视化 / 回充）时回调，进度统计归宿主 */
  onTask?: (task: string) => void
  /** 每秒采样一次的关键指标，用于页面上的进度显示 */
  onStat?: (stats: VacuSimStats) => void
}

export interface VacuSimHandle {
  dispose: () => void
  setPlaying: (playing: boolean) => void
  isPlaying: () => boolean
  setSpeed: (speed: number) => void
  setMode: (mode: CleanMode) => void
  toggleRays: () => boolean
  toggleFollow: () => boolean
  openKnowledge: (id: string) => void
  reset: () => void
  addDirt: () => void
  recharge: () => void
}

const pick = (t: LocalizedText, lang: Lang) => t[lang] ?? t.en

/* =========================================================
   引擎
   ========================================================= */

export function createVacuSim(root: HTMLElement, options: VacuSimOptions): VacuSimHandle {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector('#' + id) as T | null

  const stage = $('vs-stage')
  const canvas = $<HTMLCanvasElement>('vs-canvas')
  if (!stage || !canvas) throw new Error('VacuSim: 舞台节点缺失（#vs-stage / #vs-canvas）')

  const lang = () => options.getLocale()
  let disposed = false
  let rafId = 0

  /* ---------- 渲染器 ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0a0e17)
  scene.fog = new THREE.Fog(0x0a0e17, 40, 120)

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500)
  camera.position.set(0, 22, 26)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.target.set(0, 0, 0)
  controls.maxPolarAngle = Math.PI * 0.49
  controls.minDistance = 10
  controls.maxDistance = 70

  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x202a1c, 0.7))
  const sun = new THREE.DirectionalLight(0xfff2e0, 1.3)
  sun.position.set(14, 26, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -20
  sun.shadow.camera.right = 20
  sun.shadow.camera.top = 20
  sun.shadow.camera.bottom = -20
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 80
  sun.shadow.bias = -0.0004
  scene.add(sun)
  scene.add(new THREE.AmbientLight(0x405070, 0.35))

  /* ---------- 房间 ---------- */
  const RX = 12, RZ = 9
  const floorTex = (() => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const x = c.getContext('2d')!
    x.fillStyle = '#1b1f27'
    x.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 3000; i++) {
      x.fillStyle = `rgba(${40 + Math.random() * 30 | 0},${44 + Math.random() * 30 | 0},${54 + Math.random() * 30 | 0},0.4)`
      x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
    }
    x.strokeStyle = 'rgba(80,95,120,0.25)'
    x.lineWidth = 2
    for (let i = 0; i <= 256; i += 64) {
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
    t.repeat.set(6, 5)
    return t
  })()
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RZ * 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  const wallMat = new THREE.MeshPhysicalMaterial({ color: 0x9fb6d8, transparent: true, opacity: 0.10, roughness: 0.1, transmission: 0.6, side: THREE.DoubleSide })
  function wall(w: number, h: number, x: number, y: number, z: number, ry: number) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat)
    m.position.set(x, y, z)
    m.rotation.y = ry
    scene.add(m)
  }
  wall(RX * 2, 4, 0, 2, -RZ, 0)
  wall(RX * 2, 4, 0, 2, RZ, 0)
  wall(RZ * 2, 4, -RX, 2, 0, Math.PI / 2)
  wall(RZ * 2, 4, RX, 2, 0, Math.PI / 2)
  const wallEdgeMat = new THREE.MeshStandardMaterial({ color: 0x5f7494, metalness: 0.5, roughness: 0.5 })
  ;[[-RX, -RZ], [RX, -RZ], [-RX, RZ], [RX, RZ]].forEach(([x, z]) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 4, 10), wallEdgeMat)
    p.position.set(x!, 2, z!)
    p.castShadow = true
    scene.add(p)
  })

  const obstacles = [
    { x: -6, z: 4.5, hx: 3, hz: 1.3, name: 'Sofa' },
    { x: 5.5, z: -3, hx: 1.7, hz: 1.1, name: 'Table' },
    { x: -3.5, z: -5, hx: 0.9, hz: 0.9, name: 'Chair' },
    { x: 7.5, z: 5.5, hx: 0.9, hz: 0.9, name: 'Plant' },
    { x: -8.5, z: -4, hx: 1.3, hz: 0.9, name: 'Cabinet' },
    { x: 2.5, z: 5.5, hx: 1.1, hz: 0.8, name: 'Stool' }
  ]
  function buildFurniture() {
    for (const o of obstacles) {
      const g = new THREE.Group()
      const h = o.name === 'Plant' ? 1.6 : o.name === 'Table' ? 1.0 : 1.2
      if (o.name === 'Plant') {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.5, 0.9, 14), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 1 }))
        pot.position.y = 0.45
        pot.castShadow = true
        g.add(pot)
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 1), new THREE.MeshStandardMaterial({ color: 0x3f9d4a, roughness: 0.85 }))
        leaf.position.y = 1.7
        leaf.castShadow = true
        g.add(leaf)
      } else {
        const body = new THREE.Mesh(new THREE.BoxGeometry(o.hx * 2, o.hz * 2, h), new THREE.MeshStandardMaterial({ color: o.name === 'Table' ? 0x6b4a2f : 0x46566e, roughness: 0.8 }))
        body.position.y = h / 2
        body.castShadow = true
        body.receiveShadow = true
        g.add(body)
        if (o.name === 'Table') {
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
              const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 8), new THREE.MeshStandardMaterial({ color: 0x3a2a1a }))
              lg.position.set(sx * (o.hx - 0.2), 0.5, sz * (o.hz - 0.2))
              lg.castShadow = true
              g.add(lg)
            }
          }
        }
        const top = new THREE.Mesh(new THREE.BoxGeometry(o.hx * 2 + 0.1, 0.12, o.hz * 2 + 0.1), new THREE.MeshStandardMaterial({ color: 0x9fb0c6, roughness: 0.5 }))
        top.position.y = h
        top.castShadow = true
        g.add(top)
      }
      g.position.set(o.x, 0, o.z)
      scene.add(g)
    }
  }
  buildFurniture()

  const cliff = { x: 9, z: -6.5, hx: 2.2, hz: 1.6 }
  const cliffMesh = new THREE.Mesh(new THREE.BoxGeometry(cliff.hx * 2, 0.25, cliff.hz * 2), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 }))
  cliffMesh.position.set(cliff.x, 0.12, cliff.z)
  cliffMesh.receiveShadow = true
  scene.add(cliffMesh)

  const DOCK = new THREE.Vector3(0, -RZ + 0.6, 0)
  const dock = new THREE.Group()
  const dockBase = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.6), new THREE.MeshStandardMaterial({ color: 0x222a33, roughness: 0.6 }))
  dockBase.position.y = 0.2
  dock.add(dockBase)
  const dockLed = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0x39e6a0, emissive: 0x39e6a0, emissiveIntensity: 0.8 }))
  dockLed.position.set(0, 0.36, 0.3)
  dock.add(dockLed)
  dock.position.copy(DOCK)
  scene.add(dock)

  /* ---------- 机器人 ---------- */
  const R = 0.85
  const robot = new THREE.Group()
  const bodyMesh = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.32, 40), new THREE.MeshStandardMaterial({ color: 0x2b3340, metalness: 0.4, roughness: 0.5 }))
  bodyMesh.position.y = 0.22
  bodyMesh.castShadow = true
  robot.add(bodyMesh)
  const topCap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.86, R * 0.86, 0.08, 40), new THREE.MeshStandardMaterial({ color: 0x3a4554, roughness: 0.4 }))
  topCap.position.y = 0.4
  robot.add(topCap)
  const bumperMat = new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.6 })
  const bumper = new THREE.Mesh(new THREE.TorusGeometry(R * 0.98, 0.06, 10, 32, Math.PI), bumperMat)
  bumper.rotation.x = Math.PI / 2
  bumper.rotation.z = Math.PI
  bumper.position.y = 0.22
  robot.add(bumper)
  const ledRing = new THREE.Mesh(new THREE.TorusGeometry(R * 0.6, 0.04, 10, 40), new THREE.MeshBasicMaterial({ color: 0x7be0ff }))
  ledRing.rotation.x = Math.PI / 2
  ledRing.position.y = 0.45
  robot.add(ledRing)
  const turret = new THREE.Group()
  turret.position.y = 0.47
  robot.add(turret)
  turret.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.18, 20), new THREE.MeshStandardMaterial({ color: 0x10151c, roughness: 0.4 })))
  const scanLine = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.26), new THREE.MeshStandardMaterial({ color: 0xff4d4d, emissive: 0xff4d4d, emissiveIntensity: 1 }))
  scanLine.position.set(0, 0, 0.12)
  turret.add(scanLine)
  const brush = new THREE.Group()
  brush.position.set(R * 0.7, 0.08, R * 0.6)
  robot.add(brush)
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.42), new THREE.MeshStandardMaterial({ color: 0xffd24d }))
    b.position.set(Math.cos(i / 6 * 6.28) * 0.18, 0, Math.sin(i / 6 * 6.28) * 0.18)
    b.rotation.y = i / 6 * 6.28
    brush.add(b)
  }
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111417, roughness: 0.8 })
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.16, 16), wheelMat)
    w.rotation.z = Math.PI / 2
    w.position.set(s * (R * 0.7), 0.16, 0)
    robot.add(w)
  }
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.04), new THREE.MeshStandardMaterial({ color: 0x0c0f12 }))
  slot.position.set(0, 0.06, R * 0.5)
  robot.add(slot)
  scene.add(robot)

  /* ---------- LiDAR 射线 ---------- */
  const rayGeo = new THREE.BufferGeometry()
  const rayAttr = new THREE.BufferAttribute(new Float32Array(6 * 3), 3)
  rayGeo.setAttribute('position', rayAttr)
  const rayLines = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.85 }))
  rayLines.visible = false
  scene.add(rayLines)

  /* ---------- 覆盖率栅格 + 灰尘 ---------- */
  const CS = 0.5
  const COLS = Math.ceil(RX * 2 / CS)
  const ROWS = Math.ceil(RZ * 2 / CS)
  const cleanMask = new Uint8Array(COLS * ROWS)
  const cleaned = new Uint8Array(COLS * ROWS)
  const cellIndex = (c: number, r: number) => r * COLS + c
  const cellCenter = (c: number, r: number) => ({ x: -RX + (c + 0.5) * CS, z: -RZ + (r + 0.5) * CS })

  function inObstacle(x: number, z: number, pad: number) {
    if (Math.abs(x) > RX - pad || Math.abs(z) > RZ - pad) return true
    for (const o of obstacles) {
      const dx = Math.max(Math.abs(x - o.x) - o.hx, 0)
      const dz = Math.max(Math.abs(z - o.z) - o.hz, 0)
      if (dx * dx + dz * dz < pad * pad) return true
    }
    if (Math.abs(x - cliff.x) < cliff.hx + pad && Math.abs(z - cliff.z) < cliff.hz + pad) return true
    return false
  }

  let cleanableCount = 0
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const { x, z } = cellCenter(c, r)
      if (!inObstacle(x, z, 0.25)) {
        cleanMask[cellIndex(c, r)] = 1
        cleanableCount++
      }
    }
  }

  let dirtMesh: THREE.InstancedMesh | null = null
  let dirtState: Int8Array | null = null
  let dirtCur: { x: number, y: number, z: number, s: number }[] = []
  let dirtOrig: { x: number, z: number }[] = []
  let dirtCount = 0
  const dummy = new THREE.Matrix4()

  function buildDirt(fraction: number) {
    if (dirtMesh) {
      scene.remove(dirtMesh)
      dirtMesh.geometry.dispose()
      ;(dirtMesh.material as THREE.Material).dispose()
    }
    const cells: number[] = []
    for (let i = 0; i < COLS * ROWS; i++) if (cleanMask[i]) cells.push(i)
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[cells[i], cells[j]] = [cells[j]!, cells[i]!]
    }
    dirtCount = Math.floor(cells.length * fraction)
    dirtState = new Int8Array(dirtCount)
    dirtCur = []
    dirtOrig = []
    const geo = new THREE.SphereGeometry(0.085, 6, 6)
    geo.scale(1, 0.4, 1)
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a6a44, roughness: 1 })
    dirtMesh = new THREE.InstancedMesh(geo, mat, dirtCount)
    dirtMesh.castShadow = false
    for (let i = 0; i < dirtCount; i++) {
      const ci = cells[i]!
      // 原版把行/列写反了 → 灰尘会落到家具里；这里按 cellIndex 的定义还原
      const c = ci % COLS
      const r = Math.floor(ci / COLS)
      const { x, z } = cellCenter(c, r)
      const px = x + (Math.random() - 0.5) * CS * 0.6
      const pz = z + (Math.random() - 0.5) * CS * 0.6
      dirtOrig.push({ x: px, z: pz })
      dirtCur.push({ x: px, y: 0.06, z: pz, s: 1 })
      dummy.makeTranslation(px, 0.06, pz)
      dirtMesh.setMatrixAt(i, dummy)
    }
    dirtMesh.instanceMatrix.needsUpdate = true
    scene.add(dirtMesh)
  }

  function countDirt() {
    if (!dirtState) return 0
    let n = 0
    for (let i = 0; i < dirtCount; i++) if (dirtState[i]! < 2) n++
    return n
  }

  /* ---------- 仿真状态 ---------- */
  const sim = {
    playing: true,
    speed: 5,
    mode: 'auto' as CleanMode,
    time: 0,
    turns: 0,
    dead: false,
    camFollow: false,
    showRays: false
  }
  const rob = {
    pos: new THREE.Vector3(0, 0, 0),
    angle: 0,
    escape: 0,
    escapeDir: 1,
    bumperFlash: 0,
    battery: 100,
    distance: 0,
    coverage: 0,
    dustLeft: 0,
    spotT: 0,
    done: false,
    sensors: { lidar: 6, cliffL: false, cliffR: false, bump: false }
  }
  buildDirt(0.16)
  rob.dustLeft = dirtCount
  const history: { t: number, cov: number, batt: number }[] = []
  const trail: { x: number, z: number }[] = []
  let lastSample = 0

  const ROBOT_SPEED = 2.4

  function rayDist(ang: number, maxD: number) {
    for (let d = 0.2; d < maxD; d += 0.25) {
      const x = rob.pos.x + Math.sin(ang) * d
      const z = rob.pos.z + Math.cos(ang) * d
      if (inObstacle(x, z, 0.15)) return d
    }
    return maxD
  }

  function cleanAround(x: number, z: number, rad: number) {
    const c0 = Math.floor((x - rad + RX) / CS)
    const c1 = Math.floor((x + rad + RX) / CS)
    const r0 = Math.floor((z - rad + RZ) / CS)
    const r1 = Math.floor((z + rad + RZ) / CS)
    for (let r = Math.max(0, r0); r <= Math.min(ROWS - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(COLS - 1, c1); c++) {
        const idx = cellIndex(c, r)
        if (!cleanMask[idx] || cleaned[idx]) continue
        const cc = cellCenter(c, r)
        const dx = cc.x - x, dz = cc.z - z
        if (dx * dx + dz * dz <= rad * rad) cleaned[idx] = 1
      }
    }
  }

  function computeCoverage() {
    let cl = 0
    for (let i = 0; i < cleanMask.length; i++) if (cleanMask[i] && cleaned[i]) cl++
    return cleanableCount ? cl / cleanableCount * 100 : 0
  }

  /* ---------- UI 节点 ---------- */
  const alertLog = $('vs-alert-log')
  const sensorIds = ['lidar', 'bump', 'cliffL', 'cliffR'] as const
  const sensorVal = Object.fromEntries(sensorIds.map(id => [id, $('vs-sv-' + id)])) as Record<typeof sensorIds[number], HTMLElement | null>
  const sensorDot = Object.fromEntries(sensorIds.map(id => [id, $('vs-ss-' + id)])) as Record<typeof sensorIds[number], HTMLElement | null>

  const hudMode = $('vs-hud-mode'), hudCov = $('vs-hud-cov'), hudDust = $('vs-hud-dust')
  const hudTime = $('vs-hud-time'), hudBatt = $('vs-hud-batt'), battBar = $('vs-batt-bar')
  const sDist = $('vs-s-dist'), sSpd = $('vs-s-spd'), sTurn = $('vs-s-turn')
  const btnPlay = $<HTMLButtonElement>('vs-btn-play')

  const bigCanvas = $<HTMLCanvasElement>('vs-big-chart')
  const bigCtx = bigCanvas ? bigCanvas.getContext('2d') : null
  const mini = $<HTMLCanvasElement>('vs-mini-map')
  const mctx = mini ? mini.getContext('2d') : null

  function addLog(kind: 'good' | 'warn' | 'alarm', text: string) {
    if (!alertLog) return
    const el = document.createElement('div')
    el.className = 'alert ' + kind
    const t = document.createElement('span')
    t.className = 't'
    t.textContent = `${Math.floor(sim.time / 60)}:${String(Math.floor(sim.time % 60)).padStart(2, '0')}`
    const msg = document.createElement('span')
    msg.textContent = text
    el.append(t, msg)
    alertLog.prepend(el)
    while (alertLog.children.length > 50) alertLog.removeChild(alertLog.lastChild!)
  }

  const L = {
    zh: {
      mode: { auto: '自动', spot: '定点', edge: '沿边', dock: '回充中' } as Record<CleanMode, string>,
      bump: '碰撞接触 — 已避障',
      cliff: '检测到悬崖 — 正在后退',
      docked: '已回充 — 电量 100%',
      returning: '正在返回充电座',
      depleted: '电量耗尽 — 请点「充电」',
      reset: '地图与灰尘已重置',
      dirt: '已重新撒布灰尘',
      charge: '电量已充至 100%',
      complete: '清扫完成 — 覆盖率'
    },
    en: {
      mode: { auto: 'Auto', spot: 'Spot', edge: 'Edge', dock: 'Returning' } as Record<CleanMode, string>,
      bump: 'Bumper contact — obstacle avoided',
      cliff: 'Cliff detected — reversing',
      docked: 'Docked — battery charged to 100%',
      returning: 'Returning to charging dock',
      depleted: 'Battery depleted — press Recharge',
      reset: 'Map & dirt reset',
      dirt: 'Fresh dirt scattered',
      charge: 'Battery recharged to 100%',
      complete: 'Cleaning complete — coverage'
    }
  }
  const txt = () => L[lang()]

  function setMode(mode: CleanMode) {
    sim.mode = mode
    for (const m of ['auto', 'spot', 'edge'] as const) {
      $('vs-m-' + m)?.classList.toggle('active', m === mode)
    }
    if (hudMode) hudMode.textContent = txt().mode[mode]
  }

  /* ---------- 机器人步进 ---------- */
  function stepRobot(dt: number) {
    if (sim.dead && sim.mode !== 'dock') return
    const speed = ROBOT_SPEED * sim.speed
    const fC = rayDist(rob.angle, 6)
    const fL = rayDist(rob.angle - 0.6, 6)
    const fR = rayDist(rob.angle + 0.6, 6)
    rob.sensors.lidar = fC
    rob.sensors.bump = false
    let turnRate = 0
    let blocked = false

    if (rob.escape > 0) {
      rob.escape -= dt
      turnRate = rob.escapeDir * 3.2
    } else {
      if (sim.mode === 'auto') {
        if (fC < 1.3) blocked = true
        else if (fC < 2.6) turnRate = (fL < fR ? 1 : -1) * 0.7
        else if (Math.random() < 0.02) {
          turnRate = (Math.random() - 0.5) * 1.4
          sim.turns++
        }
      } else if (sim.mode === 'spot') {
        turnRate = 1.4
        rob.spotT += dt
        if (rob.spotT > 9) {
          setMode('auto')
          rob.spotT = 0
        }
      } else if (sim.mode === 'edge') {
        const err = fR - 1.3
        turnRate = -err * 0.9 + (fR > 4.5 ? 0.6 : 0)
        if (fC < 1.1) {
          turnRate = -1.6
          sim.turns++
        }
      } else if (sim.mode === 'dock') {
        const desired = Math.atan2(DOCK.x - rob.pos.x, DOCK.z - rob.pos.z)
        let diff = desired - rob.angle
        while (diff > Math.PI) diff -= 2 * Math.PI
        while (diff < -Math.PI) diff += 2 * Math.PI
        turnRate = diff * 2.2
        const distToDock = Math.hypot(DOCK.x - rob.pos.x, DOCK.z - rob.pos.z)
        if (distToDock < 1.4) {
          rob.battery = 100
          sim.dead = false
          sim.playing = true
          syncPlayBtn()
          setMode('auto')
          addLog('good', txt().docked)
          options.onTask?.('docked')
        }
        if (fC < 1.3) blocked = true
      }
      const mv = speed * dt
      const nx = rob.pos.x + Math.sin(rob.angle) * mv
      const nz = rob.pos.z + Math.cos(rob.angle) * mv
      if (inObstacle(nx, nz, R)) blocked = true
    }

    if (blocked && rob.escape <= 0) {
      rob.escape = 0.5
      rob.escapeDir = (fL < fR ? 1 : -1) || (Math.random() < 0.5 ? 1 : -1)
      rob.sensors.bump = true
      rob.bumperFlash = 0.4
      sim.turns++
      addLog('warn', txt().bump)
    }

    rob.angle += turnRate * dt

    if (rob.escape > 0) {
      const bk = Math.min(speed * dt, 0.4)
      const bx = rob.pos.x - Math.sin(rob.angle) * bk
      const bz = rob.pos.z - Math.cos(rob.angle) * bk
      if (!inObstacle(bx, bz, R)) {
        rob.pos.x = bx
        rob.pos.z = bz
      }
    } else {
      const mv = speed * dt
      const nx = rob.pos.x + Math.sin(rob.angle) * mv
      const nz = rob.pos.z + Math.cos(rob.angle) * mv
      if (!inObstacle(nx, nz, R)) {
        rob.pos.x = nx
        rob.pos.z = nz
        rob.distance += mv
      }
    }

    rob.sensors.cliffL = Math.abs(rob.pos.x - 0.5 - cliff.x) < cliff.hx && Math.abs(rob.pos.z - cliff.z) < cliff.hz
    rob.sensors.cliffR = Math.abs(rob.pos.x + 0.5 - cliff.x) < cliff.hx && Math.abs(rob.pos.z - cliff.z) < cliff.hz
    if (rob.sensors.cliffL || rob.sensors.cliffR) {
      if (rob.escape <= 0) {
        rob.escape = 0.4
        rob.escapeDir = -1
        addLog('alarm', txt().cliff)
      }
    }

    cleanAround(rob.pos.x, rob.pos.z, R)

    if (sim.mode !== 'dock') {
      rob.battery -= 0.09 * sim.speed * dt
      if (rob.battery <= 0) {
        rob.battery = 0
        sim.dead = true
        addLog('alarm', txt().depleted)
      }
    }
    if (rob.bumperFlash > 0) rob.bumperFlash -= dt
  }

  function updateDirt() {
    if (!dirtMesh || !dirtState) return
    let changed = false
    for (let i = 0; i < dirtCount; i++) {
      if (dirtState[i] === 0) {
        const d = dirtCur[i]!
        const dx = rob.pos.x - d.x
        const dz = rob.pos.z - d.z
        if (dx * dx + dz * dz < (R * 1.05) * (R * 1.05)) dirtState[i] = 1
      } else if (dirtState[i] === 1) {
        const d = dirtCur[i]!
        d.x += (rob.pos.x - d.x) * 0.25
        d.z += (rob.pos.z - d.z) * 0.25
        d.y += (0.42 - d.y) * 0.25
        d.s *= 0.82
        if (d.s < 0.07) {
          dirtState[i] = 2
          dummy.makeScale(0, 0, 0)
          dirtMesh.setMatrixAt(i, dummy)
          changed = true
          continue
        }
        dummy.makeScale(d.s, d.s, d.s)
        dummy.setPosition(d.x, d.y, d.z)
        dirtMesh.setMatrixAt(i, dummy)
        changed = true
      }
    }
    if (changed) dirtMesh.instanceMatrix.needsUpdate = true
  }

  function updateRobotVisual(dt: number) {
    robot.position.set(rob.pos.x, 0, rob.pos.z)
    robot.rotation.y = rob.angle
    turret.rotation.y += dt * (4 + sim.speed)
    brush.rotation.y -= dt * 10
    let col = 0x7be0ff
    if (sim.dead) col = 0xff5470
    else if (rob.bumperFlash > 0) col = 0xff5470
    else if (sim.mode === 'spot') col = 0xffcc4d
    else if (sim.mode === 'edge') col = 0x9b8bff
    else if (sim.mode === 'dock') col = 0x39e6a0
    ledRing.material.color.setHex(col)
    bumperMat.color.setHex(rob.bumperFlash > 0 ? 0xff5470 : 0x1a2028)

    rayLines.visible = sim.showRays
    if (sim.showRays) {
      const p = rayAttr.array as Float32Array
      const angs = [rob.angle, rob.angle - 0.6, rob.angle + 0.6]
      for (let i = 0; i < 3; i++) {
        const d = rayDist(angs[i]!, 6)
        p[i * 6] = rob.pos.x
        p[i * 6 + 1] = 0.3
        p[i * 6 + 2] = rob.pos.z
        p[i * 6 + 3] = rob.pos.x + Math.sin(angs[i]!) * d
        p[i * 6 + 4] = 0.3
        p[i * 6 + 5] = rob.pos.z + Math.cos(angs[i]!) * d
      }
      rayAttr.needsUpdate = true
    }
  }

  function updateCamera() {
    if (!sim.camFollow) return
    const tp = new THREE.Vector3(rob.pos.x, 1, rob.pos.z)
    controls.target.lerp(tp, 0.08)
    camera.position.lerp(tp.clone().add(new THREE.Vector3(0, 13, 15)), 0.05)
  }

  /* ---------- 图表 ---------- */
  function drawBig() {
    if (!bigCtx || !bigCanvas) return
    const ctx = bigCtx, w = bigCanvas.width, h = bigCanvas.height
    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(120,160,220,0.12)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = h * i / 4
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
    if (history.length < 2) return
    const pad = 10
    const line = (key: 'cov' | 'batt', color: string) => {
      ctx.beginPath()
      history.forEach((d, i) => {
        const x = pad + (w - 2 * pad) * (i / (history.length - 1))
        const y = h - pad - (h - 2 * pad) * (d[key] / 100)
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      })
      ctx.strokeStyle = color
      ctx.lineWidth = 3
      ctx.stroke()
    }
    line('cov', '#36d3ff')
    line('batt', '#39e6a0')
    ctx.font = 'bold 18px "Segoe UI", system-ui, sans-serif'
    ctx.fillStyle = '#36d3ff'
    ctx.textAlign = 'left'
    ctx.fillText(`Coverage ${rob.coverage.toFixed(0)}%`, 14, 26)
    ctx.fillStyle = '#39e6a0'
    ctx.textAlign = 'right'
    ctx.fillText(`Battery ${rob.battery.toFixed(0)}%`, w - 14, 26)
  }

  function sizeMini() {
    if (!mini) return
    mini.width = Math.max(mini.clientWidth, 1) * 2
    mini.height = Math.max(mini.clientHeight, 1) * 2
  }

  function drawMini() {
    if (!mctx || !mini) return
    const MW = mini.width, MH = mini.height
    mctx.clearRect(0, 0, MW, MH)
    mctx.fillStyle = '#0c1018'
    mctx.fillRect(0, 0, MW, MH)
    const sx = MW / (RX * 2), sz = MH / (RZ * 2)
    const w2m = (x: number, z: number) => [(x + RX) * sx, (z + RZ) * sz] as [number, number]
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = cellIndex(c, r)
        if (!cleanMask[idx]) continue
        const cc = cellCenter(c, r)
        const [mx, mz] = w2m(cc.x, cc.z)
        mctx.fillStyle = cleaned[idx] ? '#1f6b46' : '#2a3340'
        mctx.fillRect(mx - sx * CS / 2, mz - sz * CS / 2, sx * CS + 0.5, sz * CS + 0.5)
      }
    }
    for (const o of obstacles) {
      const [mx, mz] = w2m(o.x, o.z)
      mctx.fillStyle = '#55606e'
      mctx.fillRect(mx - o.hx * sx, mz - o.hz * sz, o.hx * 2 * sx, o.hz * 2 * sz)
    }
    {
      const [mx, mz] = w2m(cliff.x, cliff.z)
      mctx.fillStyle = '#ff8c42'
      mctx.fillRect(mx - cliff.hx * sx, mz - cliff.hz * sz, cliff.hx * 2 * sx, cliff.hz * 2 * sz)
    }
    if (trail.length > 1) {
      mctx.strokeStyle = 'rgba(123,224,255,0.5)'
      mctx.lineWidth = 2
      mctx.beginPath()
      trail.forEach((p, i) => {
        const [mx, mz] = w2m(p.x, p.z)
        if (i) mctx.lineTo(mx, mz)
        else mctx.moveTo(mx, mz)
      })
      mctx.stroke()
    }
    const [rx, rz] = w2m(rob.pos.x, rob.pos.z)
    mctx.fillStyle = '#ff5470'
    mctx.beginPath()
    mctx.arc(rx, rz, 6, 0, 7)
    mctx.fill()
    mctx.strokeStyle = '#ffd24d'
    mctx.lineWidth = 2
    mctx.beginPath()
    mctx.moveTo(rx, rz)
    mctx.lineTo(rx + Math.sin(rob.angle) * 12, rz + Math.cos(rob.angle) * 12)
    mctx.stroke()
    const [dx, dz] = w2m(DOCK.x, DOCK.z)
    mctx.fillStyle = '#39e6a0'
    mctx.fillRect(dx - 4, dz - 3, 8, 6)
  }

  /* ---------- 控件 ---------- */
  function syncPlayBtn() {
    if (!btnPlay) return
    btnPlay.textContent = sim.playing ? `⏸ ${lang() === 'zh' ? '暂停' : 'Pause'}` : `▶ ${lang() === 'zh' ? '继续' : 'Play'}`
    btnPlay.classList.toggle('active', sim.playing)
  }
  btnPlay?.addEventListener('click', () => {
    if (sim.dead) return
    sim.playing = !sim.playing
    syncPlayBtn()
  })
  ;(['auto', 'spot', 'edge'] as const).forEach((m) => {
    $('vs-m-' + m)?.addEventListener('click', () => {
      setMode(m)
      if (m === 'spot') rob.spotT = 0
      options.onTask?.(`mode:${m}`)
    })
  })
  const speedEl = $<HTMLInputElement>('vs-speed')
  const speedVal = $('vs-speed-val')
  speedEl?.addEventListener('input', () => {
    sim.speed = Number(speedEl.value)
    if (speedVal) speedVal.textContent = `${sim.speed}×`
  })
  const followBtn = $('vs-btn-follow')
  followBtn?.addEventListener('click', () => {
    sim.camFollow = !sim.camFollow
    followBtn.classList.toggle('active', sim.camFollow)
    if (sim.camFollow) options.onTask?.('follow')
  })
  const raysBtn = $('vs-btn-rays')
  raysBtn?.addEventListener('click', () => {
    sim.showRays = !sim.showRays
    raysBtn.classList.toggle('active', sim.showRays)
    if (sim.showRays) options.onTask?.('rays')
  })
  $('vs-btn-dock')?.addEventListener('click', () => {
    setMode('dock')
    addLog('good', txt().returning)
  })
  $('vs-btn-reset')?.addEventListener('click', () => reset())
  $('vs-btn-dirt')?.addEventListener('click', () => addDirt())
  $('vs-btn-charge')?.addEventListener('click', () => recharge())

  /* ---------- 知识卡片 ---------- */
  const modal = $('vs-info-modal')
  for (const card of VACUSIM_KNOWLEDGE) {
    root.querySelector(`[data-k="${card.id}"]`)?.addEventListener('click', () => openKnowledge(card.id))
  }
  function openKnowledge(id: string) {
    const card = VACUSIM_KNOWLEDGE.find(k => k.id === id)
    if (!card || !modal) return
    const lg = lang()
    const icon = $('vs-mi-icon'), name = $('vs-mi-name'), sub = $('vs-mi-sub')
    const desc = $('vs-mi-desc'), principle = $('vs-mi-principle'), tags = $('vs-mi-tags')
    if (icon) icon.textContent = card.icon
    if (name) name.textContent = pick(card.name, lg)
    if (sub) sub.textContent = pick(card.sub, lg)
    if (desc) desc.textContent = pick(card.desc, lg)
    if (principle) principle.textContent = pick(card.principle, lg)
    if (tags) {
      tags.innerHTML = ''
      for (const t of card.tags) {
        const el = document.createElement('span')
        el.className = 'tag'
        el.textContent = `${pick(t.k, lg)} `
        const b = document.createElement('b')
        b.textContent = t.v
        el.appendChild(b)
        tags.appendChild(el)
      }
    }
    modal.style.display = 'flex'
  }
  function closeKnowledge() {
    if (modal) modal.style.display = 'none'
  }
  $('vs-mi-close')?.addEventListener('click', closeKnowledge)
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeKnowledge()
  })
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeKnowledge()
  }
  window.addEventListener('keydown', onKeydown)

  /* ---------- 尺寸 ---------- */
  function resize() {
    const w = Math.max(stage!.clientWidth, 1)
    const h = Math.max(stage!.clientHeight, 1)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    if (bigCanvas) {
      bigCanvas.width = Math.max(bigCanvas.clientWidth, 1) * 2
      bigCanvas.height = Math.max(bigCanvas.clientHeight, 1) * 2
    }
    sizeMini()
  }
  const ro = new ResizeObserver(resize)

  /* ---------- 主循环 ---------- */
  const timer = new THREE.Timer()
  let frame = 0

  function updateHud() {
    if (hudCov) hudCov.textContent = `${rob.coverage.toFixed(0)}%`
    if (hudDust) hudDust.textContent = String(rob.dustLeft)
    if (hudTime) hudTime.textContent = `${Math.floor(sim.time / 60)}:${String(Math.floor(sim.time % 60)).padStart(2, '0')}`
    if (hudBatt) hudBatt.textContent = `${Math.round(rob.battery)}%`
    if (battBar) {
      battBar.style.width = rob.battery + '%'
      battBar.style.background = rob.battery < 20
        ? 'linear-gradient(90deg,#ff5470,#ff9a6a)'
        : rob.battery < 50
          ? 'linear-gradient(90deg,#ffcc4d,#9be86a)'
          : 'linear-gradient(90deg,#39e6a0,#9be86a)'
    }
    if (sDist) sDist.textContent = `${rob.distance.toFixed(1)} m`
    if (sSpd) sSpd.textContent = `${(sim.playing ? ROBOT_SPEED * sim.speed : 0).toFixed(1)} m/s`
    if (sTurn) sTurn.textContent = String(sim.turns)

    const set = (id: typeof sensorIds[number], value: string, ok: boolean) => {
      if (sensorVal[id]) sensorVal[id]!.textContent = value
      if (sensorDot[id]) sensorDot[id]!.style.background = ok ? '#39e6a0' : '#ff5470'
    }
    set('lidar', `${rob.sensors.lidar.toFixed(1)} m`, true)
    set('bump', rob.sensors.bump ? (lang() === 'zh' ? '接触' : 'CONTACT') : (lang() === 'zh' ? '正常' : 'clear'), !rob.sensors.bump)
    set('cliffL', rob.sensors.cliffL ? (lang() === 'zh' ? '悬崖' : 'CLIFF') : (lang() === 'zh' ? '安全' : 'safe'), !rob.sensors.cliffL)
    set('cliffR', rob.sensors.cliffR ? (lang() === 'zh' ? '悬崖' : 'CLIFF') : (lang() === 'zh' ? '安全' : 'safe'), !rob.sensors.cliffR)
  }

  function loop() {
    if (disposed) return
    rafId = requestAnimationFrame(loop)
    timer.update()
    const dt = Math.min(timer.getDelta(), 0.05)
    controls.update()
    if (sim.playing) stepRobot(dt)
    updateRobotVisual(dt)
    updateDirt()
    updateCamera()

    if (sim.playing) {
      sim.time += dt * sim.speed
      if (sim.time - lastSample >= 1) {
        lastSample = sim.time
        rob.coverage = computeCoverage()
        history.push({ t: sim.time, cov: rob.coverage, batt: rob.battery })
        if (history.length > 200) history.shift()
        rob.dustLeft = countDirt()
        options.onStat?.({
          coverage: rob.coverage,
          battery: rob.battery,
          dustLeft: rob.dustLeft,
          distance: rob.distance,
          turns: sim.turns,
          mode: sim.mode
        })
        if (rob.coverage >= 98 && !rob.done) {
          rob.done = true
          addLog('good', `${txt().complete} ${rob.coverage.toFixed(1)}%`)
        }
      }
      trail.push({ x: rob.pos.x, z: rob.pos.z })
      if (trail.length > 240) trail.shift()
    }

    if (rob.coverage === 0 && frame === 2) rob.coverage = computeCoverage()

    updateHud()
    if (frame % 3 === 0) drawMini()
    if (frame % 4 === 0) drawBig()

    renderer.render(scene, camera)
    frame++
  }

  /* ---------- 重置 / 加灰 / 充电 ---------- */
  function reset() {
    cleaned.fill(0)
    if (dirtMesh && dirtState) {
      for (let i = 0; i < dirtCount; i++) {
        dirtState[i] = 0
        dirtCur[i] = { x: dirtOrig[i]!.x, y: 0.06, z: dirtOrig[i]!.z, s: 1 }
        dummy.makeTranslation(dirtOrig[i]!.x, 0.06, dirtOrig[i]!.z)
        dirtMesh.setMatrixAt(i, dummy)
      }
      dirtMesh.instanceMatrix.needsUpdate = true
    }
    history.length = 0
    trail.length = 0
    rob.distance = 0
    sim.time = 0
    sim.turns = 0
    rob.pos.set(0, 0, 0)
    rob.angle = Math.random() * 6.28
    rob.coverage = 0
    rob.done = false
    rob.dustLeft = countDirt()
    addLog('good', txt().reset)
  }
  function addDirt() {
    buildDirt(0.16)
    rob.dustLeft = countDirt()
    addLog('good', txt().dirt)
  }
  function recharge() {
    rob.battery = 100
    sim.dead = false
    sim.playing = true
    syncPlayBtn()
    addLog('good', txt().charge)
  }

  /* ---------- 初始化 ---------- */
  ro.observe(stage!)
  resize()
  setMode('auto')
  syncPlayBtn()
  addLog('good', lang() === 'zh' ? '仿真引擎已启动' : 'Simulation engine started')
  // 首帧先算一次覆盖率，HUD 不至于从 0 卡到第一次采样
  rob.coverage = computeCoverage()
  loop()

  return {
    dispose() {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
      ro.disconnect()
      controls.dispose()
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
    setMode,
    toggleRays() {
      raysBtn?.click()
      return sim.showRays
    },
    toggleFollow() {
      followBtn?.click()
      return sim.camFollow
    },
    openKnowledge,
    reset,
    addDirt,
    recharge
  }
}
