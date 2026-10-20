/**
 * DroneSim 无人机飞行仿真 —— 3D 引擎。
 *
 * 从独立单文件页（DroneSim · UAV Operations & FPV Simulation）移植，
 * 参考 robot/vacusim / robot/avsim 的移植模式：
 *   - 机场环境（停机坪/建筑/树木/航点环）、可拆解四旋翼（8 类部件 · 爆炸视图 ·
 *     单件抽出 · 分离/装回）、飞行控制（起飞/悬停/降落/RTL 返航/建筑碰撞坠落/
 *     电量与信号）、FPV 机载相机（第二渲染器 + HUD 叠加），这套命令式逻辑保持原样；
 *   - 原版「整页 DOM + document.getElementById + innerWidth/innerHeight」换成
 *     「调用方传入页面根节点，引擎在根节点内按 id 取节点 + ResizeObserver 跟随尺寸」，
 *     于是能在 Nuxt 页里挂载/卸载；
 *   - three 走 npm 依赖（无 CDN importmap）；
 *   - 新增教学事件回调 onTask：takeoff / wp:<i> / inspect:<type> / detach /
 *     reattach / rtl。
 *
 * 顺手修掉原版一处材质共享 bug：机身/机臂/电机等部件复用同一份
 * MeshStandardMaterial，高亮某一部件会把所有共享材质的部件一起点亮；
 * 这里在注册时按部件克隆材质，高亮只作用于选中的那一类。
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type Lang = 'zh' | 'en'
export type CompType = 'body' | 'arm' | 'motor' | 'prop' | 'battery' | 'gimbal' | 'gps' | 'leg'

export interface LocalizedText {
  zh: string
  en: string
}

export interface DroneSimOptions {
  getLocale: () => Lang
  /** 教学事件：takeoff / wp:<i> / inspect:<type> / detach / reattach / rtl */
  onTask?: (task: string) => void
}

export interface DroneSimHandle {
  dispose: () => void
  isFlying: () => boolean
  takeOff: () => void
  land: () => void
  rtl: () => void
  reset: () => void
  setThrottle: (v: number) => void
  isFollow: () => boolean
  setFollow: (follow: boolean) => void
}

/* =========================================================
   部件资料（双语）
   ========================================================= */

interface CompInfo {
  name: LocalizedText
  icon: string
  sub: LocalizedText
  desc: LocalizedText
  principle: LocalizedText
  tags: { k: LocalizedText, v: string }[]
}

const COMP_INFO: Record<CompType, CompInfo> = {
  body: {
    name: { zh: '主机身', en: 'Main Fuselage' },
    icon: '🛩️',
    sub: { zh: '机架 · 飞控', en: 'Frame · Flight Controller' },
    desc: {
      zh: '容纳飞控（FC）、IMU、电调与配电板的中央碳纤维外壳。',
      en: 'The central carbon-fibre shell that houses the flight controller (FC), IMU, ESCs and the power distribution board.'
    },
    principle: {
      zh: '飞控融合 IMU（陀螺仪 + 加速度计）、气压计与 GPS，以每秒数百次运行增稳 PID 环，保持机体水平并响应飞手指令。',
      en: 'The FC fuses IMU (gyro+accel), barometer and GPS to run a stabilization PID loop several hundred times per second, keeping the craft level and responding to pilot input.'
    },
    tags: [
      { k: { zh: '材质', en: 'Material' }, v: 'Carbon fibre' },
      { k: { zh: '内置', en: 'Holds' }, v: 'FC / IMU / ESC' },
      { k: { zh: '重量', en: 'Mass' }, v: '~180 g' }
    ]
  },
  arm: {
    name: { zh: '旋翼臂', en: 'Rotor Arm' },
    icon: '🦾',
    sub: { zh: '结构件', en: 'Structural boom' },
    desc: {
      zh: '安装电机与螺旋桨的对角悬臂，把推力传递给机身。',
      en: 'Diagonal arm that mounts a motor and propeller and transfers thrust to the frame.'
    },
    principle: {
      zh: '通常可折叠便于携带；四臂 X 形布局提供偏航与升力所需的扭矩平衡。',
      en: 'Typically foldable for transport; four arms in an X-configuration give the torque balance needed for yaw and lift.'
    },
    tags: [
      { k: { zh: '数量', en: 'Count' }, v: '4 (X-config)' },
      { k: { zh: '特性', en: 'Feature' }, v: 'foldable' },
      { k: { zh: '长度', en: 'Length' }, v: '~22 cm' }
    ]
  },
  motor: {
    name: { zh: '无刷电机', en: 'Brushless Motor' },
    icon: '⚙️',
    sub: { zh: '外转子', en: 'Outrunner' },
    desc: {
      zh: '外转子无刷电机，高转速带动螺旋桨产生推力。',
      en: 'Brushless outrunner motor that spins the propeller at high RPM to generate thrust.'
    },
    principle: {
      zh: '电调对三相绕组换向；KV 值决定每伏转速。正反桨对抵消反扭矩。',
      en: 'ESC commutates the three-phase windings; KV rating sets RPM per volt. Counter-rotating pairs cancel torque.'
    },
    tags: [
      { k: { zh: '类型', en: 'Type' }, v: 'BLDC outrunner' },
      { k: { zh: 'KV 值', en: 'KV' }, v: '~900' },
      { k: { zh: '极限', en: 'Max' }, v: '~15000 RPM' }
    ]
  },
  prop: {
    name: { zh: '螺旋桨', en: 'Propeller' },
    icon: '🌀',
    sub: { zh: '推力单元', en: 'Thrust unit' },
    desc: {
      zh: '两叶（或三叶）螺旋桨，把电机旋转转换为向下气流与升力。',
      en: 'Two-blade (or tri-blade) propeller that converts motor rotation into downward airflow and lift.'
    },
    principle: {
      zh: '桨距与直径决定推力/效率取舍；只有挂载且通电时才会旋转。',
      en: 'Pitch and diameter set the thrust/efficiency trade-off. Spins only while attached and powered.'
    },
    tags: [
      { k: { zh: '桨叶', en: 'Blades' }, v: '2–3' },
      { k: { zh: '直径', en: 'Dia' }, v: '~9 in' },
      { k: { zh: '拉力', en: 'Thrust' }, v: '~800 g each' }
    ]
  },
  battery: {
    name: { zh: '智能电池', en: 'Smart Battery' },
    icon: '🔋',
    sub: { zh: 'Li-Po 电池组', en: 'Li-Po pack' },
    desc: {
      zh: '高倍率锂聚合物电池，为电机与航电设备供电。',
      en: 'High-discharge Lithium-Polymer battery supplying the motors and avionics.'
    },
    principle: {
      zh: '3–4S 电芯（11.1–14.8 V）提供大电流；BMS 向飞控上报电压与电芯数，用于估算剩余飞行时间。',
      en: 'A 3–4S pack (11.1–14.8 V) delivers high current; the BMS reports voltage/cell count to the FC for remaining-time estimates.'
    },
    tags: [
      { k: { zh: '化学体系', en: 'Chemistry' }, v: 'Li-Po 4S' },
      { k: { zh: '容量', en: 'Capacity' }, v: '~5200 mAh' },
      { k: { zh: '续航', en: 'Flight' }, v: '18–25 min' }
    ]
  },
  gimbal: {
    name: { zh: '云台相机', en: 'Camera Gimbal' },
    icon: '📷',
    sub: { zh: '三轴增稳', en: '3-axis stabilized' },
    desc: {
      zh: '安装在三轴增稳云台上的机载相机——CAM-1 实时 FPV 画面的来源。',
      en: 'The onboard camera on a 3-axis stabilized gimbal — the source of the live FPV / survey feed.'
    },
    principle: {
      zh: '无刷云台电机把相机与振动、姿态变化隔离开，输出稳定水平线；CAM-1 传输的就是这路画面。',
      en: 'Brushless gimbal motors isolate the camera from vibration and attitude, delivering a steady horizon. This is what the CAM-1 view transmits.'
    },
    tags: [
      { k: { zh: '增稳', en: 'Stabilize' }, v: '3-axis' },
      { k: { zh: '传感器', en: 'Sensor' }, v: '4K / FPV' },
      { k: { zh: '视场角', en: 'FOV' }, v: '~85°' }
    ]
  },
  gps: {
    name: { zh: 'GPS / 罗盘', en: 'GPS / Compass' },
    icon: '📡',
    sub: { zh: '定位模块', en: 'Positioning' },
    desc: {
      zh: 'GNSS 接收机 + 磁力计，提供全局位置与航向（yaw）基准。',
      en: 'GNSS receiver + magnetometer providing global position and heading (yaw) reference.'
    },
    principle: {
      zh: '融合卫星定位、罗盘与视觉里程计；支持一键返航（RTL）与定点悬停。',
      en: 'Fuses satellite fixes with the compass and visual odometry; enables Return-To-Launch and position hold.'
    },
    tags: [
      { k: { zh: '定位', en: 'Fix' }, v: 'GPS+GLONASS' },
      { k: { zh: '用途', en: 'Use' }, v: 'RTL / hover' },
      { k: { zh: '航向', en: 'Hdg' }, v: 'magnetometer' }
    ]
  },
  leg: {
    name: { zh: '起落架', en: 'Landing Gear' },
    icon: '🦿',
    sub: { zh: '支脚', en: 'Skid / leg' },
    desc: {
      zh: '带缓冲的起落架支脚，起降时保护机身与云台。',
      en: 'Shock-absorbing legs that protect the body and gimbal during takeoff and landing.'
    },
    principle: {
      zh: '让螺旋桨与相机保持离地间隙；部分机型飞行中可收起。',
      en: 'Keeps the propellers and camera clear of the ground; folds up in flight on some models.'
    },
    tags: [
      { k: { zh: '减震', en: 'Damping' }, v: 'rubber foot' },
      { k: { zh: '离地', en: 'Clearance' }, v: '~6 cm' }
    ]
  }
}

/* 飞行状态 / 日志文案 */
function makeStr(lang: Lang) {
  const zh = lang === 'zh'
  return {
    landed: zh ? '已着陆' : 'Landed',
    flying: zh ? '飞行中' : 'Flying',
    landing: zh ? '降落中' : 'Landing',
    crashed: zh ? '已坠毁' : 'Crashed',
    fly: zh ? '空中' : 'FLY',
    grd: zh ? '地面' : 'GRD',
    logTakeoff: zh ? '起飞 — 爬升至悬停高度' : 'Take-off — climbing to hover',
    logLand: zh ? '开始降落' : 'Initiating landing',
    logRtl: zh ? '一键返航（RTL）' : 'Return to launch',
    logRtlDone: zh ? 'RTL 完成 — 已在停机坪降落' : 'RTL complete — landed at home',
    logLanded: zh ? '已降落' : 'Landed',
    logCrash: zh ? '⚠ 撞上建筑物 — 无人机正在坠落！' : '⚠ Collision with structure — drone falling!',
    logDown: zh ? '无人机坠毁 — 点「起飞」恢复，或重置' : 'Drone down — Take Off to recover, or Reset',
    logLowBatt: zh ? '电量临界 — 自动下降' : 'Battery critical — auto-descending',
    logReset: zh ? '仿真已复位到 home 点' : 'Sim reset to home',
    logExplodeOn: zh ? '爆炸视图：开' : 'Exploded view ON',
    logExplodeOff: zh ? '已恢复装配' : 'Assembled',
    logDetached: (n: string, name: string) => zh ? `已拆下 ${name}（×${n}）` : `Detached ${name} (×${n})`,
    logReattached: zh ? '全部部件已装回' : 'All components reattached',
    logSelectFirst: zh ? '请先选择一个部件' : 'Select a component first',
    logInspecting: (name: string) => zh ? `正在查看 ${name} — 已从装配体抽出` : `Inspecting ${name} — pulled out of assembly`
  }
}

/* =========================================================
   引擎
   ========================================================= */

export function createDroneSim(root: HTMLElement, options: DroneSimOptions): DroneSimHandle {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T | null

  const stageEl = $<HTMLElement>('#ds-scene')
  if (!stageEl) throw new Error('DroneSim: 场景节点缺失（#ds-scene）')
  const stage: HTMLElement = stageEl

  const lang = () => options.getLocale()
  const t = () => makeStr(lang())
  let disposed = false
  let rafId = 0

  /* ---------- 渲染器 ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  stage.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x8fb3d9)
  scene.fog = new THREE.Fog(0x9fc0e0, 60, 160)
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500)
  camera.position.set(14, 12, 16)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI * 0.49
  controls.minDistance = 6
  controls.maxDistance = 90

  scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x4a5238, 0.85))
  const sun = new THREE.DirectionalLight(0xfff2e0, 1.4)
  sun.position.set(30, 50, 20)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -50
  sun.shadow.camera.right = 50
  sun.shadow.camera.top = 50
  sun.shadow.camera.bottom = -50
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 160
  sun.shadow.bias = -0.0004
  scene.add(sun)
  scene.add(new THREE.AmbientLight(0x405070, 0.3))

  /* ---------- 环境 ---------- */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x4f6b3f, roughness: 1 }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  const grid = new THREE.GridHelper(120, 60, 0x3a4a2e, 0x3a4a2e)
  grid.position.y = 0.02
  ;(grid.material as THREE.Material).opacity = 0.4
  ;(grid.material as THREE.Material).transparent = true
  scene.add(grid)

  // 停机坪
  const padTex = (() => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const x = c.getContext('2d')!
    x.fillStyle = '#1b2533'
    x.fillRect(0, 0, 256, 256)
    x.strokeStyle = '#cdd5df'
    x.lineWidth = 6
    x.beginPath()
    x.arc(128, 128, 110, 0, 7)
    x.stroke()
    x.fillStyle = '#cdd5df'
    x.font = 'bold 150px Arial'
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.fillText('H', 128, 138)
    return new THREE.CanvasTexture(c)
  })()
  const pad = new THREE.Mesh(new THREE.CircleGeometry(3, 40), new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.8 }))
  pad.rotation.x = -Math.PI / 2
  pad.position.y = 0.03
  scene.add(pad)

  // 建筑
  const buildings: { x: number, z: number, w: number, d: number, h: number }[] = []
  const bColors = [0x6b7280, 0x556070, 0x7a6f63, 0x4f5b6b]
  const rnd = (a: number, b: number) => a + Math.random() * (b - a)
  for (let i = 0; i < 16; i++) {
    const ang = Math.random() * 6.28
    const rad = rnd(16, 42)
    const x = Math.cos(ang) * rad
    const z = Math.sin(ang) * rad
    const w = rnd(3, 7)
    const d = rnd(3, 7)
    const h = rnd(4, 16)
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: bColors[i % bColors.length]!, roughness: 0.85 }))
    b.position.set(x, h / 2, z)
    b.castShadow = true
    b.receiveShadow = true
    scene.add(b)
    buildings.push({ x, z, w, d, h })
  }
  // 树
  function tree(x: number, z: number, s: number) {
    const g = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.24 * s, 1.4 * s, 8), new THREE.MeshStandardMaterial({ color: 0x5a3d23, roughness: 1 }))
    trunk.position.y = 0.7 * s
    trunk.castShadow = true
    g.add(trunk)
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 * s, 1), new THREE.MeshStandardMaterial({ color: 0x3f8f3f, roughness: 0.9 }))
    top.position.y = 2.0 * s
    top.castShadow = true
    g.add(top)
    g.position.set(x, 0, z)
    scene.add(g)
  }
  for (let i = 0; i < 14; i++) {
    const ang = Math.random() * 6.28
    const rad = rnd(14, 46)
    tree(Math.cos(ang) * rad, Math.sin(ang) * rad, rnd(0.8, 1.3))
  }
  // 航点环
  const WAYPOINTS: [number, number][] = [[-10, -8], [12, 6], [-14, 12], [8, -14], [0, 18]]
  const wpMat = new THREE.MeshBasicMaterial({ color: 0xffcc4d, transparent: true, opacity: 0.8 })
  WAYPOINTS.forEach(([x, z]) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 8, 24), wpMat)
    ring.rotation.x = Math.PI / 2
    ring.position.set(x, 0.1, z)
    scene.add(ring)
  })

  /* ---------- 无人机 + 可拆部件 ---------- */
  interface Comp {
    type: CompType
    name: LocalizedText
    root: THREE.Group
    meshes: THREE.Mesh[]
    base: THREE.Vector3
    explode: THREE.Vector3
    detached: boolean
    extracted: boolean
    spin?: boolean
  }
  const drone = new THREE.Group()
  drone.rotation.order = 'YXZ'
  scene.add(drone)
  const comps: Comp[] = []
  const pickables: THREE.Group[] = []
  function register(type: CompType, compRoot: THREE.Group, meshes: THREE.Mesh[], explode: THREE.Vector3) {
    const info = COMP_INFO[type]
    // 原版各部件共享材质，高亮会串；这里按部件克隆材质
    meshes.forEach((m) => {
      m.material = (m.material as THREE.Material).clone()
      const mat = m.material as THREE.MeshStandardMaterial
      if (mat.emissive) m.userData.baseEmissive = mat.emissive.getHex()
    })
    const c: Comp = {
      type,
      name: info.name,
      root: compRoot,
      meshes,
      base: compRoot.position.clone(),
      explode: explode.clone(),
      detached: false,
      extracted: false
    }
    compRoot.userData.comp = c
    comps.push(c)
    pickables.push(compRoot)
    return c
  }
  function buildDrone() {
    const matBody = new THREE.MeshStandardMaterial({ color: 0x222a33, metalness: 0.5, roughness: 0.5 })
    const matAccent = new THREE.MeshStandardMaterial({ color: 0x10151c, metalness: 0.4, roughness: 0.5 })
    const matMetal = new THREE.MeshStandardMaterial({ color: 0x3a4452, metalness: 0.7, roughness: 0.35 })
    // 机身
    const bodyG = new THREE.Group()
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.34, 1.5), matBody)
    shell.position.y = 0.5
    shell.castShadow = true
    bodyG.add(shell)
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 12, 0, 6.28, 0, Math.PI / 2), matAccent)
    top.position.y = 0.67
    top.scale.set(1, 0.5, 1.3)
    bodyG.add(top)
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.1), new THREE.MeshStandardMaterial({ color: 0x36d3ff, emissive: 0x36d3ff, emissiveIntensity: 0.9 }))
    led.position.set(0, 0.55, 0.76)
    bodyG.add(led)
    drone.add(bodyG)
    register('body', bodyG, [shell, top, led], new THREE.Vector3(0, 1.4, 0))

    // 机臂 + 电机 + 桨（×4）
    const armLen = 1.15
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4
      const dx = Math.sin(a)
      const dz = Math.cos(a)
      const armG = new THREE.Group()
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, armLen), matMetal)
      arm.position.set(dx * armLen / 2, 0.5, dz * armLen / 2)
      arm.rotation.y = -a
      arm.castShadow = true
      armG.add(arm)
      drone.add(armG)
      register('arm', armG, [arm], new THREE.Vector3(dx * 1.6, 0.6, dz * 1.6))
      const motG = new THREE.Group()
      const mot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 16), matAccent)
      mot.position.set(dx * armLen, 0.62, dz * armLen)
      mot.castShadow = true
      motG.add(mot)
      drone.add(motG)
      register('motor', motG, [mot], new THREE.Vector3(dx * 1.9, 1.2, dz * 1.9))
      // 桨组在桨毂处自转（不是绕机心）
      const propG = new THREE.Group()
      propG.position.set(dx * armLen, 0.8, dz * armLen)
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10), matMetal)
      propG.add(hub)
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0x9fb6c9, roughness: 0.5, transparent: true, opacity: 0.85 })
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.12), bladeMat)
      propG.add(blade)
      const blade2 = blade.clone()
      blade2.material = bladeMat
      blade2.rotation.y = Math.PI / 2
      propG.add(blade2)
      drone.add(propG)
      const pc = register('prop', propG, [hub, blade, blade2], new THREE.Vector3(dx * 2.1, 1.7, dz * 2.1))
      pc.spin = true
    }
    // 电池
    const batG = new THREE.Group()
    const bat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 1.0), new THREE.MeshStandardMaterial({ color: 0x2b6b3a, roughness: 0.6 }))
    bat.position.set(0, 0.32, 0)
    bat.castShadow = true
    batG.add(bat)
    const batL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0x39e6a0, emissive: 0x39e6a0, emissiveIntensity: 0.7 }))
    batL.position.set(0, 0.45, 0.4)
    batG.add(batL)
    drone.add(batG)
    register('battery', batG, [bat, batL], new THREE.Vector3(0, -1.0, 0))
    // 云台相机（前 +z）
    const gimG = new THREE.Group()
    const gim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.3), matMetal)
    gim.position.set(0, 0.42, 0.78)
    gimG.add(gim)
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.18, 16), new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.3 }))
    lens.rotation.x = Math.PI / 2
    lens.position.set(0, 0.42, 0.95)
    gimG.add(lens)
    const lensG = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 8, 16), new THREE.MeshStandardMaterial({ color: 0x36d3ff, emissive: 0x36d3ff, emissiveIntensity: 0.8 }))
    lensG.position.set(0, 0.42, 1.02)
    gimG.add(lensG)
    drone.add(gimG)
    register('gimbal', gimG, [gim, lens, lensG], new THREE.Vector3(0, -0.2, 1.4))
    // GPS 桅杆
    const gpsG = new THREE.Group()
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 8), matMetal)
    mast.position.set(0, 0.95, 0)
    gpsG.add(mast)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffcc4d, emissive: 0x553300, emissiveIntensity: 0.3 }))
    dome.position.set(0, 1.15, 0)
    gpsG.add(dome)
    drone.add(gpsG)
    register('gps', gpsG, [mast, dome], new THREE.Vector3(0, 1.9, 0))
    // 起落架（×4）
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4
      const dx = Math.sin(a)
      const dz = Math.cos(a)
      const legG = new THREE.Group()
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), matMetal)
      leg.position.set(dx * 0.5, 0.1, dz * 0.5)
      leg.castShadow = true
      legG.add(leg)
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), matAccent)
      foot.position.set(dx * 0.5, 0.15, dz * 0.5)
      legG.add(foot)
      drone.add(legG)
      register('leg', legG, [leg, foot], new THREE.Vector3(dx * 0.9, -0.8, dz * 0.9))
    }
  }
  buildDrone()

  /* ---------- FPV 机载相机（第二渲染器） ---------- */
  const fpvEl = $<HTMLCanvasElement>('#ds-fpv')
  if (!fpvEl) throw new Error('DroneSim: FPV 节点缺失（#ds-fpv）')
  const fpvCanvas: HTMLCanvasElement = fpvEl
  const fpvRenderer = new THREE.WebGLRenderer({ canvas: fpvCanvas, antialias: true })
  fpvRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  fpvRenderer.shadowMap.enabled = false
  const droneCamera = new THREE.PerspectiveCamera(62, 640 / 230, 0.1, 300)
  droneCamera.position.set(0, 0.45, 0.85)
  drone.add(droneCamera)
  const camTarget = new THREE.Object3D()
  camTarget.position.set(0, -3, 12)
  drone.add(camTarget)

  /* ---------- 状态 ---------- */
  const ROBOT_HOME = new THREE.Vector3(0, 0, 0)
  // follow=false：默认自由第三人称（OrbitControls 手动环视）；follow=true：第一人称（相机贴机头）
  const sim = { follow: false, rtl: false }
  const d = {
    pos: new THREE.Vector3(0, 0, 0),
    yaw: 0, pitch: 0, roll: 0,
    vel: new THREE.Vector3(),
    battery: 100,
    altTarget: 0,
    flying: false,
    mode: 'landed' as 'landed' | 'flying' | 'landing' | 'crashed',
    hspeed: 0, vspeed: 0,
    selected: null as CompType | null,
    exploded: false,
    rtl: false,
    crash: false,
    low: false
  }
  const MAXALT = 26
  const HOVER = 7
  const visitedWp = new Set<number>()

  /* ---------- 输入 ---------- */
  const keys: Record<string, boolean> = {}
  const cmd = { f: false, s: false, l: false, r: false, u: false }
  let yawStep = 0
  const onKeydown = (e: KeyboardEvent) => {
    const tag = ((e.target && (e.target as HTMLElement).tagName) || '').toLowerCase()
    if (tag === 'input' || tag === 'textarea') return
    keys[e.code] = true
    if (e.code === 'Space') e.preventDefault()
    if (e.key === 'Escape') infoCard?.style.setProperty('display', 'none')
  }
  const onKeyup = (e: KeyboardEvent) => {
    keys[e.code] = false
  }
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  const key = (k: string) => (keys[k] ? 1 : 0)
  function input() {
    // 原版映射：S/↓/▼ = 前进（推杆式），W/↑/▲ = 后退
    const f = (key('KeyS') || key('ArrowDown') || cmd.s) ? 1 : 0
    const b = (key('KeyW') || key('ArrowUp') || cmd.f) ? 1 : 0
    const sf = (key('KeyD') || key('ArrowRight') || cmd.r) ? 1 : 0
    const sl = (key('KeyA') || key('ArrowLeft') || cmd.l) ? 1 : 0
    const up = (key('Space') || cmd.u) ? 1 : 0
    const dn = (key('ShiftLeft') || key('ShiftRight')) ? 1 : 0
    return { f: f - b, s: sf - sl, y: key('KeyE') - key('KeyQ'), u: up - dn }
  }
  // 方向键盘区：移动为点按开关，偏航为固定步进
  root.querySelectorAll('.pad button').forEach((b) => {
    b.addEventListener('click', () => {
      const k = (b as HTMLElement).dataset.dsK
      if (k === 'f') {
        cmd.f = !cmd.f
        b.classList.toggle('active', cmd.f)
      } else if (k === 'd') {
        cmd.s = !cmd.s
        b.classList.toggle('active', cmd.s)
      } else if (k === 'l') {
        cmd.l = !cmd.l
        b.classList.toggle('active', cmd.l)
      } else if (k === 'r') {
        cmd.r = !cmd.r
        b.classList.toggle('active', cmd.r)
      } else if (k === 'u') {
        cmd.u = !cmd.u
        b.classList.toggle('active', cmd.u)
      } else if (k === 'yl') yawStep -= 0.45
      else if (k === 'yr') yawStep += 0.45
    })
  })

  const speedEl = $<HTMLInputElement>('#ds-speed')
  const speedVal = $('#ds-speed-val')
  let THROTTLE = 8
  speedEl?.addEventListener('input', () => {
    THROTTLE = +speedEl.value
    if (speedVal) speedVal.textContent = String(THROTTLE)
  })

  const btnFollow = $('#ds-follow')
  btnFollow?.addEventListener('click', () => {
    sim.follow = !sim.follow
    btnFollow.classList.toggle('active', sim.follow)
  })
  const hudMode = $('#ds-mode')
  const btnTakeoff = $('#ds-takeoff')
  const btnLand = $('#ds-land')
  const btnRTL = $('#ds-rtl')
  btnTakeoff?.addEventListener('click', () => takeOff())
  btnLand?.addEventListener('click', () => {
    sim.rtl = false
    d.altTarget = 0
    d.mode = 'landing'
    if (hudMode) hudMode.textContent = t().landing
    addLog('good', t().logLand)
  })
  btnRTL?.addEventListener('click', () => {
    sim.rtl = true
    d.rtl = true
    addLog('good', t().logRtl)
  })
  $('#ds-reset')?.addEventListener('click', () => resetSim())

  /* ---------- 部件 UI ---------- */
  const compBtns = $('#ds-comp-btns')
  const infoCard = $('#ds-info-card')
  function buildCompButtons() {
    if (!compBtns) return
    const lg = lang()
    for (const type of Object.keys(COMP_INFO) as CompType[]) {
      const info = COMP_INFO[type]
      const count = comps.filter(c => c.type === type).length
      const b = document.createElement('button')
      b.className = 'compbtn'
      b.dataset.type = type
      b.innerHTML = `<span class="ci">${info.icon}</span><span class="cn">${info.name[lg] ?? info.name.en}</span><span class="cc">×${count}</span>`
      b.addEventListener('click', () => selectComp(type))
      compBtns.appendChild(b)
    }
  }
  function selectComp(type: CompType, target?: Comp) {
    d.selected = type
    root.querySelectorAll('.compbtn').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.type === type))
    openInfo(type)
    options.onTask?.(`inspect:${type}`)
    // 先收起之前抽出的部件；侧栏选中抽出该类全部，点选 3D 只抽出被点的那个
    comps.forEach((c) => {
      c.extracted = false
    })
    if (target) target.extracted = true
    else comps.forEach((c) => {
      if (c.type === type) c.extracted = true
    })
    comps.forEach((c) => {
      const on = c.type === type && !c.detached
      c.meshes.forEach((m) => {
        const mat = m.material as THREE.MeshStandardMaterial
        if (mat && mat.emissive) {
          const base = m.userData.baseEmissive as number | undefined
          mat.emissive.setHex(on ? 0x36d3ff : (base ?? 0x000000))
          mat.emissiveIntensity = on ? 0.6 : 0
        }
      })
    })
  }
  function deselect() {
    d.selected = null
    comps.forEach((c) => {
      c.extracted = false
    })
    root.querySelectorAll('.compbtn').forEach(b => b.classList.remove('active'))
    comps.forEach((c) => {
      c.meshes.forEach((m) => {
        const mat = m.material as THREE.MeshStandardMaterial
        if (mat && mat.emissive) {
          const base = m.userData.baseEmissive as number | undefined
          mat.emissive.setHex(base ?? 0x000000)
          mat.emissiveIntensity = 0
        }
      })
    })
  }
  $('#ds-explode')?.addEventListener('click', () => {
    d.exploded = !d.exploded
    const el = $('#ds-explode')
    if (el) el.style.color = d.exploded ? 'var(--good)' : 'var(--accent)'
    addLog('good', d.exploded ? t().logExplodeOn : t().logExplodeOff)
  })
  $('#ds-detach')?.addEventListener('click', () => {
    if (!d.selected) {
      addLog('warn', t().logSelectFirst)
      return
    }
    let n = 0
    comps.forEach((c) => {
      if (c.type === d.selected && !c.detached) {
        c.detached = true
        c.root.visible = false
        n++
        const b = root.querySelector(`.compbtn[data-type="${c.type}"]`)
        if (b) b.classList.add('detached')
      }
    })
    if (n) {
      const lg = lang()
      addLog('alarm', t().logDetached(String(n), COMP_INFO[d.selected].name[lg] ?? COMP_INFO[d.selected].name.en))
      options.onTask?.('detach')
    }
  })
  $('#ds-reattach')?.addEventListener('click', reattachAll)
  function reattachAll() {
    comps.forEach((c) => {
      c.detached = false
      c.extracted = false
      c.root.visible = true
      const b = root.querySelector(`.compbtn[data-type="${c.type}"]`)
      if (b) b.classList.remove('detached')
    })
    comps.forEach((c) => {
      c.meshes.forEach((m) => {
        const mat = m.material as THREE.MeshStandardMaterial
        if (mat && mat.emissive) {
          const base = m.userData.baseEmissive as number | undefined
          mat.emissive.setHex(base ?? 0x000000)
          mat.emissiveIntensity = 0
        }
      })
    })
    addLog('good', t().logReattached)
    d.selected = null
    root.querySelectorAll('.compbtn').forEach(b => b.classList.remove('active'))
    options.onTask?.('reattach')
  }

  /* ---------- 主画布点选 ---------- */
  const ray = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  let pdown: { x: number, y: number } | null = null
  renderer.domElement.addEventListener('pointerdown', (e) => {
    pdown = { x: e.clientX, y: e.clientY }
  })
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!pdown) return
    const dx = e.clientX - pdown.x
    const dy = e.clientY - pdown.y
    pdown = null
    if (Math.hypot(dx, dy) > 6) return
    const r = renderer.domElement.getBoundingClientRect()
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1
    mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1
    ray.setFromCamera(mouse, camera)
    const hit = ray.intersectObjects(pickables, true)
    if (hit.length) {
      let o: THREE.Object3D | null = hit[0]!.object
      while (o && !o.userData.comp) o = o.parent
      const comp = o?.userData.comp as Comp | undefined
      if (comp) {
        selectComp(comp.type, comp)
        const lg = lang()
        addLog('good', t().logInspecting(comp.name[lg] ?? comp.name.en))
      }
    } else {
      deselect()
    }
  })

  /* ---------- 部件信息卡 ---------- */
  function openInfo(type: CompType) {
    const info = COMP_INFO[type]
    if (!info || !infoCard) return
    const lg = lang()
    const set = (id: string, value: string) => {
      const el = $(id)
      if (el) el.textContent = value
    }
    set('#ds-ci-icon', info.icon)
    set('#ds-ci-name', info.name[lg] ?? info.name.en)
    set('#ds-ci-sub', info.sub[lg] ?? info.sub.en)
    set('#ds-ci-desc', info.desc[lg] ?? info.desc.en)
    set('#ds-ci-principle', info.principle[lg] ?? info.principle.en)
    const tags = $('#ds-ci-tags')
    if (tags) {
      tags.innerHTML = info.tags.map((tg) => {
        const k = tg.k[lg] ?? tg.k.en
        return `<span class="tag">${k} <b>${tg.v}</b></span>`
      }).join('')
    }
    infoCard.style.display = 'block'
  }
  $('#ds-ci-close')?.addEventListener('click', () => infoCard?.style.setProperty('display', 'none'))

  /* ---------- 任务日志 ---------- */
  const logEl = $('#ds-log')
  function addLog(kind: 'good' | 'warn' | 'alarm', msg: string) {
    if (!logEl) return
    const el = document.createElement('div')
    el.className = 'alert ' + kind
    el.innerHTML = `<span class="t">${d.flying ? t().fly : t().grd}</span><span>${msg}</span>`
    logEl.prepend(el)
    while (logEl.children.length > 40) logEl.removeChild(logEl.lastChild!)
  }

  /* ---------- 飞行更新 ---------- */
  function buildingCollision(x: number, z: number, y: number) {
    const r = 0.8
    for (const b of buildings) {
      if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r && y < b.h) return b
    }
    return null
  }
  function setMode(mode: 'landed' | 'flying' | 'landing' | 'crashed') {
    d.mode = mode
    if (hudMode) hudMode.textContent = t()[mode]
  }
  function updateFlight(dt: number) {
    const inp = input()
    if (!d.flying) {
      d.vspeed = 0
      d.hspeed = 0
      d.vel.set(0, 0, 0)
      d.pitch += (0 - d.pitch) * 0.1
      d.roll += (0 - d.roll) * 0.1
      drone.position.set(d.pos.x, d.pos.y, d.pos.z)
      drone.rotation.set(d.pitch, d.yaw, d.roll)
      return
    }
    // ---- 水平移动（坠落中禁用） ----
    if (!d.crash) {
      if (d.rtl) {
        const dx = ROBOT_HOME.x - d.pos.x
        const dz = ROBOT_HOME.z - d.pos.z
        const dist = Math.hypot(dx, dz)
        if (dist > 1.5) {
          const desired = Math.atan2(dx, dz)
          let diff = desired - d.yaw
          while (diff > Math.PI) diff -= 6.283
          while (diff < -Math.PI) diff += 6.283
          d.yaw += Math.max(-2 * dt, Math.min(2 * dt, diff))
          const fwd = THROTTLE * dt
          d.pos.x += Math.sin(d.yaw) * fwd
          d.pos.z += Math.cos(d.yaw) * fwd
          d.altTarget = HOVER
        } else {
          d.altTarget = 0
          if (d.pos.y < 0.15) {
            d.rtl = false
            sim.rtl = false
            d.flying = false
            setMode('landed')
            addLog('good', t().logRtlDone)
            options.onTask?.('rtl')
          }
        }
      } else {
        const fwd = inp.f
        const str = inp.s
        const yaw = inp.y + yawStep
        yawStep = 0
        d.yaw += yaw * 1.6 * dt
        const F = new THREE.Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw))
        const R = new THREE.Vector3(Math.cos(d.yaw), 0, -Math.sin(d.yaw))
        const move = new THREE.Vector3().addScaledVector(F, fwd).addScaledVector(R, str)
        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(THROTTLE * dt)
          d.pos.x += move.x
          d.pos.z += move.z
        }
        d.pitch += ((-fwd * 0.32) - d.pitch) * 0.12
        d.roll += ((str * 0.32) - d.roll) * 0.12
      }
    }
    // ---- 与建筑碰撞：阻挡穿越并坠落 ----
    const bld = buildingCollision(d.pos.x, d.pos.z, d.pos.y)
    if (bld) {
      if (!d.crash) {
        d.crash = true
        addLog('alarm', t().logCrash)
      }
      const r = 0.8
      const off = 2.2
      const penX = (bld.w / 2 + r) - Math.abs(d.pos.x - bld.x)
      const penZ = (bld.d / 2 + r) - Math.abs(d.pos.z - bld.z)
      if (penX < penZ) d.pos.x = bld.x + (d.pos.x >= bld.x ? 1 : -1) * (bld.w / 2 + off)
      else d.pos.z = bld.z + (d.pos.z >= bld.z ? 1 : -1) * (bld.d / 2 + off)
    }
    // ---- 垂直 ----
    let vy: number
    if (d.crash) vy = -Math.max(2.5, d.pos.y * 2.0)
    else if (d.rtl) vy = (d.altTarget - d.pos.y) * 1.5
    else {
      vy = inp.u * THROTTLE * 0.8
      if (d.mode === 'landing') vy = (0 - d.pos.y) * 1.5
      else if (d.mode === 'flying' && inp.u === 0) vy = (d.altTarget - d.pos.y) * 1.2
    }
    if (d.battery <= 0 && !d.crash) vy = Math.min(vy, (0 - d.pos.y) * 1.5)
    d.pos.y += vy * dt
    if (d.pos.y < 0) {
      d.pos.y = 0
      if (d.crash) {
        d.flying = false
        d.crash = false
        setMode('crashed')
        addLog('alarm', t().logDown)
      } else if (d.flying && !d.rtl) {
        d.flying = false
        setMode('landed')
        addLog('good', t().logLanded)
      }
    }
    if (d.pos.y > MAXALT) d.pos.y = MAXALT
    d.pos.x = Math.max(-46, Math.min(46, d.pos.x))
    d.pos.z = Math.max(-46, Math.min(46, d.pos.z))
    d.vspeed = vy
    d.hspeed = d.crash ? 0 : THROTTLE * Math.min(1, Math.hypot(inp.f, inp.s))
    // 电量
    const drain = (0.05 + Math.max(0, vy) * 0.04 + 0.02) * dt
    d.battery -= drain * 6
    if (d.battery < 0) d.battery = 0
    if (d.battery === 0 && !d.low) {
      d.low = true
      addLog('alarm', t().logLowBatt)
    }
    drone.position.set(d.pos.x, d.pos.y, d.pos.z)
    drone.rotation.set(d.pitch, d.yaw, d.roll)
    // 航点判定（飞行中水平距离 < 3 m）
    if (d.flying) {
      WAYPOINTS.forEach(([wx, wz], i) => {
        if (visitedWp.has(i)) return
        if (Math.hypot(d.pos.x - wx, d.pos.z - wz) < 3) {
          visitedWp.add(i)
          options.onTask?.(`wp:${i}`)
        }
      })
    }
  }

  /* ---------- 视觉更新 ---------- */
  const tmpTarget = new THREE.Vector3()
  // 第一人称退出后的回位过渡目标：与初始机位一致（自由第三人称）
  const HOME_POS = new THREE.Vector3(14, 12, 16)
  const HOME_TGT = new THREE.Vector3(0, 1.5, 0)
  const tmpFwd = new THREE.Vector3()
  let returning = false
  function updateVisuals(dt: number) {
    comps.forEach((c) => {
      if (c.spin && !c.detached) c.root.rotation.y += dt * 30
    })
    comps.forEach((c) => {
      if (c.detached) return
      const tgt = c.base.clone().add((c.extracted || d.exploded) ? c.explode : tmpTarget.set(0, 0, 0))
      c.root.position.lerp(tgt, 0.12)
    })
    if (sim.follow) {
      // 第一人称（FPV 舱内视角）：相机贴机头前上方，视线随机头 yaw 朝前、微微下俯
      if (controls.enabled) {
        controls.enabled = false
        returning = false
      }
      tmpFwd.set(Math.sin(d.yaw), 0, Math.cos(d.yaw))
      camera.position.copy(d.pos).addScaledVector(tmpFwd, 0.95)
      camera.position.y += 0.3
      tmpTarget.copy(d.pos).addScaledVector(tmpFwd, 14)
      tmpTarget.y += 0.3 - 1.2
      controls.target.copy(tmpTarget)
      camera.lookAt(tmpTarget)
    } else {
      if (!controls.enabled) {
        // 刚从第一人称退回：解锁手动环视，并把相机平滑送回默认第三人称机位
        controls.enabled = true
        returning = true
      }
      if (returning) {
        camera.position.lerp(HOME_POS, Math.min(1, dt * 3.2))
        controls.target.lerp(HOME_TGT, Math.min(1, dt * 3.2))
        if (camera.position.distanceTo(HOME_POS) < 0.3) returning = false
      }
    }
    const wp = new THREE.Vector3()
    camTarget.getWorldPosition(wp)
    droneCamera.lookAt(wp)
  }

  /* ---------- FPV 尺寸 ---------- */
  const fpvRes = $('#ds-fpv-res')
  function sizeFPV() {
    const w = fpvCanvas.clientWidth || 320
    const h = fpvCanvas.clientHeight || 230
    fpvRenderer.setSize(w, h, false)
    droneCamera.aspect = w / h
    droneCamera.updateProjectionMatrix()
    if (fpvRes) fpvRes.textContent = `${Math.round(w)}×${Math.round(h)}`
  }

  /* ---------- 主循环 ---------- */
  const clock = new THREE.Clock()
  const hudAlt = $('#ds-alt')
  const hudHS = $('#ds-hs')
  const hudVS = $('#ds-vs')
  const hudSig = $('#ds-sig')
  const hudBatt = $('#ds-batt')
  const battBar = $('#ds-batt-bar')
  const fpvAlt = $('#ds-fpv-alt')
  const fpvSpd = $('#ds-fpv-spd')
  const fpvBat = $('#ds-fpv-bat')
  function animate() {
    if (disposed) return
    rafId = requestAnimationFrame(animate)
    const dt = Math.min(clock.getDelta(), 0.05)
    // OrbitControls.update() 不看 enabled 标志：第一人称相机直控时必须跳过，否则每帧被重置
    if (controls.enabled) controls.update()
    updateFlight(dt)
    updateVisuals(dt)

    if (hudAlt) hudAlt.innerHTML = d.pos.y.toFixed(1) + '<small>m</small>'
    if (hudHS) hudHS.innerHTML = d.hspeed.toFixed(1) + '<small>m/s</small>'
    if (hudVS) hudVS.innerHTML = d.vspeed.toFixed(1) + '<small>m/s</small>'
    const distHome = Math.hypot(d.pos.x, d.pos.z)
    const sig = Math.max(20, 100 - distHome * 0.9)
    if (hudSig) hudSig.innerHTML = Math.round(sig) + '<small>%</small>'
    if (hudBatt) hudBatt.innerHTML = Math.round(d.battery) + '<small>%</small>'
    if (battBar) {
      battBar.style.width = d.battery + '%'
      battBar.style.background = d.battery < 20
        ? 'linear-gradient(90deg,#ff5470,#ff9a6a)'
        : d.battery < 50
          ? 'linear-gradient(90deg,#ffcc4d,#9be86a)'
          : 'linear-gradient(90deg,#39e6a0,#9be86a)'
    }
    if (fpvAlt) fpvAlt.textContent = 'ALT ' + d.pos.y.toFixed(0) + 'm'
    if (fpvSpd) fpvSpd.textContent = d.hspeed.toFixed(0) + ' m/s'
    if (fpvBat) fpvBat.textContent = Math.round(d.battery) + '%'

    renderer.render(scene, camera)
    fpvRenderer.render(scene, droneCamera)
  }

  /* ---------- 尺寸 ---------- */
  function resize() {
    const w = Math.max(stage.clientWidth, 1)
    const h = Math.max(stage.clientHeight, 1)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
    sizeFPV()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(stage)

  /* ---------- 起飞/降落/复位 ---------- */
  function takeOff() {
    if (d.flying) return
    d.flying = true
    d.altTarget = HOVER
    setMode('flying')
    addLog('good', t().logTakeoff)
    options.onTask?.('takeoff')
  }
  function resetSim() {
    d.pos.set(0, 0, 0)
    d.yaw = 0
    d.pitch = 0
    d.roll = 0
    d.vel.set(0, 0, 0)
    d.battery = 100
    d.flying = false
    d.rtl = false
    d.crash = false
    d.low = false
    sim.rtl = false
    setMode('landed')
    reattachAll()
    addLog('good', t().logReset)
  }

  /* ---------- 初始化 ---------- */
  ro.observe(fpvCanvas)
  resize()
  buildCompButtons()
  setMode('landed')
  animate()

  return {
    dispose() {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
      ro.disconnect()
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('keyup', onKeyup)
      controls.dispose()
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach(m => m.dispose())
        else if (material) material.dispose()
      })
      renderer.dispose()
      fpvRenderer.dispose()
    },
    isFlying: () => d.flying,
    takeOff,
    land() {
      sim.rtl = false
      d.altTarget = 0
      setMode('landing')
      addLog('good', t().logLand)
    },
    rtl() {
      sim.rtl = true
      d.rtl = true
      addLog('good', t().logRtl)
    },
    reset: resetSim,
    setThrottle(v) {
      THROTTLE = v
      if (speedEl) speedEl.value = String(v)
      if (speedVal) speedVal.textContent = String(v)
    },
    isFollow: () => sim.follow,
    setFollow(follow) {
      sim.follow = follow
      btnFollow?.classList.toggle('active', follow)
    }
  }
}
