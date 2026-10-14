/**
 * AutoDrive Lab 智能驾驶实验室 —— 3D 引擎。
 *
 * 从独立单文件页（AutoDrive Lab · Interactive Autonomous Driving Simulator）移植，
 * 参考 robot/vacusim / robot/avsim 的移植模式：
 *   - 白天城市路网（5 条纵向路 × 12 条横向路）、可点选的车载传感器硬件、
 *     LiDAR/相机/雷达可视化、第二渲染器虚拟行车记录仪（Canvas 2D 检测框叠加）、
 *     OBB 碰撞系统、路口让行的背景车流、4 个教学场景（巡航/红灯/行人/障碍）、
 *     学生障碍工坊（点击路面放置 · 拖拽移动 · 路面吸附）、手动驾驶
 *     （WASD/方向键 + 自行车模型），这套命令式逻辑保持原样；
 *   - 原版「整页 DOM + document.querySelector + innerWidth/innerHeight」换成
 *     「调用方传入页面根节点，引擎在根节点内按选择器取节点 + ResizeObserver 跟随尺寸」，
 *     于是能在 Nuxt 页里挂载/卸载；
 *   - three 走 npm 依赖（无 CDN importmap）；
 *   - 新增教学事件回调 onTask：scenario:xxx / layer:xxx / view:xxx / place /
 *     safe-stop（自主安全刹停）/ manual-drive（手动行驶 15 m）/ inspect:xxx。
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type Lang = 'zh' | 'en'
export type DriveMode = 'autonomous' | 'manual'
export type ScenarioKey = 'cruise' | 'signal' | 'pedestrian' | 'hazard'
export type ViewKey = 'orbit' | 'top' | 'driver'
export type LayerKey = 'camera' | 'lidar' | 'radar' | 'boxes'
export type SensorId = 'camera' | 'lidar' | 'radar' | 'compute' | 'signal' | 'pedestrian' | 'hazard' | 'customObstacle'
export type ObstacleType = 'cone' | 'crate' | 'barrier' | 'tire'

export interface LocalizedText {
  zh: string
  en: string
}

export interface AutoDriveOptions {
  getLocale: () => Lang
  /** 教学事件：scenario:/layer:/view:/place/safe-stop/manual-drive/inspect: */
  onTask?: (task: string) => void
}

export interface AutoDriveHandle {
  dispose: () => void
  isRunning: () => boolean
  setRunning: (running: boolean) => void
  getDriveMode: () => DriveMode
  setDriveMode: (mode: DriveMode) => void
  getScenario: () => ScenarioKey
  setScenario: (scenario: ScenarioKey) => void
  setTargetSpeed: (kmh: number) => void
  toggleSignal: () => boolean
  reset: () => void
}

/* =========================================================
   本地化文案（引擎直接写入 DOM 的部分）
   ========================================================= */

const OBSTACLE_LABEL: Record<Lang, Record<ObstacleType, string>> = {
  zh: { cone: '锥桶', crate: '货箱', barrier: '护栏', tire: '轮胎' },
  en: { cone: 'Traffic Cone', crate: 'Cargo Box', barrier: 'Road Barrier', tire: 'Tire' }
}

const DETAIL_INFO: Record<SensorId, Record<Lang, { title: string, type: string, desc: string, output: string, strength: string, limit: string }>> = {
  camera: {
    zh: {
      title: '前视摄像头', type: '视觉',
      desc: '拍摄路面图像，识别车道线、红绿灯、标志牌、车辆与行人。',
      output: '2D 图像帧', strength: '色彩与语义信息', limit: '深度是估算的'
    },
    en: {
      title: 'Front Camera', type: 'VISION',
      desc: 'Captures images of the road to recognize lane markings, traffic lights, signs, vehicles, and pedestrians.',
      output: '2D image frames', strength: 'Color & semantics', limit: 'Depth is estimated'
    }
  },
  lidar: {
    zh: {
      title: 'LiDAR 扫描仪', type: '测距',
      desc: '发射激光脉冲并测量回波时间，构建周围物体的 3D 点云。',
      output: '3D 点云', strength: '几何精度高', limit: '易受天气影响'
    },
    en: {
      title: 'LiDAR Scanner', type: 'RANGE SENSING',
      desc: 'Sends laser pulses and measures their return time to build a 3D point cloud of nearby objects.',
      output: '3D point cloud', strength: 'Accurate geometry', limit: 'Can be affected by weather'
    }
  },
  radar: {
    zh: {
      title: '前向毫米波雷达', type: '无线电波',
      desc: '用无线电波估计目标的距离与相对速度，特别适合跟踪运动车辆。',
      output: '距离 + 径向速度', strength: '恶劣视距下仍可测速', limit: '空间分辨率较低'
    },
    en: {
      title: 'Front Radar', type: 'RADIO WAVES',
      desc: 'Uses radio waves to estimate the range and relative speed of objects, especially useful for tracking moving traffic.',
      output: 'Range + radial velocity', strength: 'Speed in poor visibility', limit: 'Lower spatial detail'
    }
  },
  compute: {
    zh: {
      title: 'AI 计算单元', type: '计算',
      desc: '融合传感器输出，预测道路参与者的运动，选出安全路径并下发控制指令。',
      output: '目标 + 规划路径', strength: '多传感器融合与决策', limit: '依赖数据与模型'
    },
    en: {
      title: 'AI Computing Unit', type: 'COMPUTE',
      desc: 'Combines sensor outputs, predicts how road users may move, selects a safe path, and sends commands to the vehicle controller.',
      output: 'Objects + planned path', strength: 'Sensor fusion & decisions', limit: 'Depends on data and models'
    }
  },
  signal: {
    zh: {
      title: '交通信号灯', type: '道路基础设施',
      desc: '视觉系统识别信号灯状态，规划器结合状态与距离决定继续行驶还是制动。',
      output: '红 / 黄 / 绿', strength: '规则感知规划', limit: '遮挡会隐藏信号'
    },
    en: {
      title: 'Traffic Signal', type: 'ROAD INFRASTRUCTURE',
      desc: 'The vision system classifies the signal state. The planner uses that state and distance to decide whether to continue or brake.',
      output: 'Red / Yellow / Green', strength: 'Rule-aware planning', limit: 'Occlusion can hide signals'
    }
  },
  pedestrian: {
    zh: {
      title: '行人', type: '道路参与者',
      desc: '感知模型检测行人位置，并预测其轨迹是否会与车辆车道相交。',
      output: '类别 + 3D 位置', strength: '碰撞风险评估', limit: '运动难以预测'
    },
    en: {
      title: 'Pedestrian', type: 'DETECTED ROAD USER',
      desc: 'The perception model detects a person, estimates their position, and predicts whether their path may intersect the vehicle lane.',
      output: 'Class + 3D position', strength: 'Collision-risk estimation', limit: 'Motion can be unpredictable'
    }
  },
  hazard: {
    zh: {
      title: '道路障碍', type: '障碍物',
      desc: '车辆识别规划走廊内的障碍物，估计距离并减速以保持安全余量。',
      output: '障碍包围盒', strength: '紧急制动触发源', limit: '必须避免误检'
    },
    en: {
      title: 'Road Hazard', type: 'OBSTACLE',
      desc: 'The vehicle identifies an obstacle in its planned corridor, estimates distance, and reduces speed to maintain a safety margin.',
      output: 'Obstacle bounding box', strength: 'Emergency braking trigger', limit: 'Must avoid false detections'
    }
  },
  customObstacle: {
    zh: {
      title: '自放置障碍', type: '交互对象',
      desc: '学生放置在路面的物体。把它挪到不同车道，对比摄像头检测与自主制动响应。',
      output: '类别 + 估计距离', strength: '可重复的课堂实验', limit: '规则演示，非真实感知模型'
    },
    en: {
      title: 'User-Placed Obstacle', type: 'INTERACTIVE OBJECT',
      desc: 'A student-placed object in the road. Move it between lanes to compare camera detection and the autonomous braking response.',
      output: 'Class + estimated range', strength: 'Repeatable classroom experiment', limit: 'Illustrative rules, not a trained perception model'
    }
  }
}

function makeStr(lang: Lang) {
  const zh = lang === 'zh'
  return {
    statusReady: zh ? '系统就绪' : 'System Ready',
    statusAuto: zh ? '自动驾驶中' : 'Autonomous Driving',
    statusManual: zh ? '手动驾驶中' : 'Manual Driving',
    statusPaused: zh ? '已暂停' : 'System Paused',
    statusBraking: zh ? '制动中' : 'Braking',
    startDrive: zh ? '▶ 开始行驶' : '▶ Start Drive',
    pauseDrive: zh ? 'Ⅱ 暂停行驶' : 'Ⅱ Pause Drive',
    enableDriving: zh ? '▶ 启用手动驾驶' : '▶ Enable Driving',
    sceneAuto: zh ? '城市路网 / 自动驾驶模式' : 'CITY GRID / AUTONOMOUS MODE',
    sceneManual: zh ? '城市路网 / 手动驾驶' : 'CITY GRID / MANUAL DRIVING',
    sceneSignal: zh ? '信号灯感知' : 'TRAFFIC GRID / SIGNAL AWARENESS',
    scenePed: zh ? '行人过街' : 'CITY GRID / PEDESTRIAN CROSSING',
    sceneHazard: zh ? '道路障碍' : 'CITY GRID / ROAD HAZARD',
    dCruise: zh ? '巡航 — 保持车道' : 'Cruise — Follow Lane',
    dCruiseSub: zh ? '路径畅通 · 保持目标车速' : 'Clear path · Maintaining target speed',
    dPaused: zh ? '仿真已暂停' : 'Simulation Paused',
    dPausedSub: zh ? '按下「开始行驶」恢复自动驾驶循环' : 'Press Start Drive to resume the autonomous loop',
    dPausedSubManual: zh ? '选择手动模式并按住驾驶按键' : 'Choose Manual and hold a drive control',
    dSafeStop: zh ? '安全停车 — 让行' : 'Safe Stop — Yield',
    rObstacle: (t: string) => zh ? `检测到${t} · 安全制动` : `${t} detected · Safe braking`,
    rVehicle: zh ? '前方车辆 · 保持安全距离' : 'Vehicle ahead · Maintaining safe distance',
    rRedLight: zh ? '识别红灯 · 制动至停止线' : 'Red signal detected · Braking to stop line',
    rPed: zh ? '行人正在过街 · 停车让行' : 'Pedestrian in crossing · Yielding',
    rHazard: zh ? '路径存在障碍 · 执行安全制动' : 'Obstacle in path · Applying safe braking',
    rBoundary: zh ? '到达路线边界 · 安全停车' : 'Route boundary reached · Stop safely',
    rCollision: (c: string) => zh ? `${c} · 已安全刹停` : `${c} · Safe stop engaged`,
    dObstacle: zh ? '发现障碍' : 'Obstacle Detected',
    dObstacleSub: (t: string, d: string) => zh ? `${t} · 前方 ${d} m` : `${t} · ${d} m ahead`,
    dTraffic: zh ? '交通感知' : 'Traffic Awareness',
    dTrafficSub: (d: string) => zh ? `前方车辆 · ${d} m` : `Vehicle ahead · ${d} m`,
    dSignal: zh ? '信号识别' : 'Signal Recognition',
    dSignalSub: (d: string) => zh ? `前方红灯 · 距停止线 ${d} m` : `Red light ahead · ${d} m to stop line`,
    dResume: zh ? '路径恢复 — 继续行驶' : 'Path Clear — Resume',
    dResumeSub: zh ? '行人已通过 · 确认车道后继续' : 'Pedestrian crossed · Checking lane before moving',
    dPed: zh ? '行人检测' : 'Pedestrian Detection',
    dPedSub: (d: string) => zh ? `监测人行横道 · 前方 ${d} m` : `Tracking crosswalk · ${d} m ahead`,
    dAvoid: zh ? '障碍规避' : 'Obstacle Avoidance',
    dAvoidSub: (d: string) => zh ? `已识别障碍 · 前方 ${d} m` : `Hazard classified · ${d} m ahead`,
    dGreen: zh ? '绿灯 — 继续通行' : 'Green Signal — Proceed',
    dGreenSub: zh ? '信号状态确认 · 安全通行' : 'Signal state confirmed · Continuing safely',
    mReversing: zh ? '手动 — 倒车' : 'Manual — Reversing',
    mStopped: zh ? '手动控制 — 已停止' : 'Manual Control — Stopped',
    mDriving: zh ? '手动驾驶' : 'Manual Driving',
    mReady: zh ? '手动控制就绪' : 'Manual Control Ready',
    mReadySub: zh ? '使用 WASD / 方向键或屏幕按键' : 'Use WASD / arrow keys or the on-screen controls',
    mLeft: zh ? '左转 · 沿车道线行驶' : 'Steering Left · Follow the road markings',
    mRight: zh ? '右转 · 注意路口' : 'Steering Right · Watch the junction',
    mSpeed: zh ? '使用油门与刹车控制车速' : 'Use accelerator and brake to control speed',
    mAhead: (t: string, d: string) => zh ? `前方${t} · ${d} m` : `${t} ahead · ${d} m`,
    inspecting: (t: string) => zh ? `正在查看：${t}` : `INSPECTING: ${t.toUpperCase()}`,
    placeMode: (t: string) => zh ? `放置模式：点击路面放置${t}` : `PLACEMENT MODE: ${t.toUpperCase()} — CLICK THE ROAD`,
    placeOff: zh ? '放置模式已关闭' : 'PLACEMENT MODE OFF',
    added: (t: string) => zh ? `已放置${t} · 拖拽可移动` : `${t.toUpperCase()} ADDED — DRAG TO MOVE`,
    removed: zh ? '已移除选中障碍' : 'SELECTED OBSTACLE REMOVED',
    selectFirst: zh ? '请先选中一个障碍' : 'SELECT AN OBSTACLE FIRST',
    cleared: zh ? '已清空全部障碍' : 'ALL STUDENT OBSTACLES CLEARED',
    posUpdated: zh ? '障碍位置已更新' : 'OBSTACLE POSITION UPDATED',
    onRoadOnly: zh ? '请放置在路面上' : 'PLACE OBJECT ON A ROAD SURFACE',
    clickRoad: zh ? '请点击路面放置物体' : 'CLICK A ROAD TO PLACE AN OBJECT',
    safetyStop: zh ? '安全停车 — 目标过近' : 'SAFETY STOP — OBJECT TOO CLOSE',
    collisionPrevented: (c: string) => zh ? `已阻止碰撞 — ${c}` : `COLLISION PREVENTED — ${c}`,
    lightRed: zh ? '信号灯：红灯 — 必须停车' : 'TRAFFIC LIGHT: RED — STOP REQUIRED',
    lightGreen: zh ? '信号灯：绿灯 — 允许通行' : 'TRAFFIC LIGHT: GREEN — PATH CLEAR',
    resetToast: zh ? '车辆已复位' : 'VEHICLE RESET TO START',
    red: zh ? '红灯' : 'RED',
    green: zh ? '绿灯' : 'GREEN',
    objects: (n: string) => zh ? `目标: ${n}` : `OBJECTS: ${n}`,
    laneClear: zh ? '车道畅通' : 'LANE: CLEAR',
    hazardAt: (d: string) => zh ? `障碍: ${d} m` : `HAZARD: ${d} M`,
    autoActive: zh ? '自动驾驶 · 运行中' : 'AUTONOMY: ACTIVE',
    autoStandby: zh ? '自动驾驶 · 待命' : 'AUTONOMY: STANDBY',
    manualActive: zh ? '手动驾驶 · 运行中' : 'MANUAL: ACTIVE',
    manualStandby: zh ? '手动驾驶 · 待命' : 'MANUAL: STANDBY',
    obsKind: (k: string) => ({
      cone: zh ? '锥桶' : 'CONE',
      crate: zh ? '货箱' : 'CARGO BOX',
      barrier: zh ? '护栏' : 'BARRIER',
      tire: zh ? '轮胎' : 'TIRE'
    })[k as ObstacleType] ?? k,
    colCity: zh ? '城市边界' : 'CITY EDGE',
    colBuilding: zh ? '建筑碰撞' : 'BUILDING / WALL',
    colRoad: zh ? '驶出路缘' : 'ROAD EDGE',
    colPed: zh ? '行人' : 'PEDESTRIAN',
    colHazard: zh ? '道路障碍' : 'ROAD HAZARD',
    colVehicle: zh ? '车辆' : 'TRAFFIC VEHICLE',
    hintBuild: zh
      ? '<b>搭建场景：</b>先选一种障碍，再点击路面放置；拖动已放置的障碍可移动位置。AI 会检测本车道内的物体并制动。车辆不会驶出路面，也不会穿过建筑或其他车辆。'
      : '<b>Build a scenario:</b> Choose an obstacle, then click on the road to place it. Click and drag a placed obstacle to move it. The AI detects objects in its lane and brakes. Vehicles cannot leave the road or pass through walls and other cars.',
    hintPlacing: (t: string) => zh
      ? `<b>放置模式：</b>点击路面放置一个${t}。选择其他工具可切换，再点当前工具取消。`
      : `<b>Placement mode:</b> Click the road to place a ${t}. Choose another tool to switch, or click the active tool to cancel.`,
    hintSelected: (t: string) => zh
      ? `<b>已选中：${t}</b> 在 3D 视图中拖拽即可重新定位，或用「移除选中」删除。`
      : `<b>Selected: ${t}</b> Drag it in the 3D view to reposition. Use Remove Selected to delete it.`
  }
}

/* =========================================================
   数据模型
   ========================================================= */

interface TrafficData {
  isTraffic: boolean
  axis: 'z' | 'x'
  dir: number
  speed: number
  serial: number
  halfW: number
  halfL: number
  stopped: boolean
}

interface ObstacleData {
  isUserObstacle: boolean
  obstacleType: ObstacleType
  baseZ: number
  size: THREE.Vector3
  selectionOutline?: THREE.LineSegments
}

/* =========================================================
   引擎
   ========================================================= */

export function createAutoDrive(root: HTMLElement, options: AutoDriveOptions): AutoDriveHandle {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T | null
  const $$ = (sel: string) => Array.from(root.querySelectorAll(sel)) as HTMLElement[]
  const stageEl = $<HTMLElement>('#ad-scene')
  if (!stageEl) throw new Error('AutoDrive: 场景节点缺失（#ad-scene）')
  const stage: HTMLElement = stageEl

  const lang = () => options.getLocale()
  const t = () => makeStr(lang())
  let disposed = false
  let rafId = 0

  /* ---------- 渲染器 ---------- */
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x9fd2f2)
  scene.fog = new THREE.Fog(0x9fd2f2, 115, 310)
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 700)
  camera.position.set(12, 9, 15)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  stage.appendChild(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 0.6, -10)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controls.maxPolarAngle = Math.PI * 0.49
  controls.minDistance = 5
  controls.maxDistance = 70

  scene.add(new THREE.HemisphereLight(0xd9f1ff, 0x77966a, 2.05))
  const sun = new THREE.DirectionalLight(0xfff6dd, 3.15)
  sun.position.set(-18, 32, 12)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -40
  sun.shadow.camera.right = 40
  sun.shadow.camera.top = 50
  sun.shadow.camera.bottom = -50
  scene.add(sun)
  const fillLight = new THREE.PointLight(0xffffff, 8, 70)
  fillLight.position.set(4, 8, -15)
  scene.add(fillLight)

  const mat = (color: number, roughness = 0.72, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
  const roadMat = mat(0x4c555d, 0.94)
  const curbMat = mat(0xc3ccd1, 0.85)
  const grassMat = mat(0xa9cf8e, 1)
  const buildingMats = [0xd8e2e8, 0xe4e8e8, 0xd9d3c7, 0xc6d9e6, 0xcddfd2].map(c => mat(c, 0.9))
  const darkMat = mat(0x10212c, 0.3, 0.3)
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x132e43, metalness: 0.35, roughness: 0.12, transparent: true, opacity: 0.92, clearcoat: 1 })

  /* ---------- 城市路网 ---------- */
  const roadXs = [-120, -60, 0, 60, 120]
  const roadZs: number[] = []
  for (let z = 120; z >= -540; z -= 60) roadZs.push(z)
  const trees: THREE.Group[] = []
  const buildingColliders: { x: number, z: number, halfW: number, halfD: number }[] = []
  const roadsGroup = new THREE.Group()
  scene.add(roadsGroup)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(360, 760), grassMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.set(0, -0.14, -200)
  ground.receiveShadow = true
  scene.add(ground)
  const roadLength = 760
  const roadWidth = 14
  for (const x of roadXs) {
    const pavement = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, roadLength), roadMat)
    pavement.rotation.x = -Math.PI / 2
    pavement.position.set(x, -0.08, -200)
    pavement.receiveShadow = true
    roadsGroup.add(pavement)
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, roadLength), curbMat)
      curb.position.set(x + side * (roadWidth / 2 + 0.12), -0.015, -200)
      curb.receiveShadow = true
      roadsGroup.add(curb)
    }
  }
  for (const z of roadZs) {
    const pavement = new THREE.Mesh(new THREE.PlaneGeometry(360, roadWidth), roadMat)
    pavement.rotation.x = -Math.PI / 2
    pavement.position.set(0, -0.079, z)
    pavement.receiveShadow = true
    roadsGroup.add(pavement)
  }
  const whiteMark = mat(0xfafcfb, 0.8)
  const yellowMark = mat(0xf7cd56, 0.8)
  const markTransforms: Record<'white' | 'yellow', THREE.Matrix4[]> = { white: [], yellow: [] }
  const markMatrix = new THREE.Matrix4()
  function addRoadMark(w: number, d: number, x: number, z: number, material: THREE.Material) {
    const key = material === whiteMark ? 'white' as const : 'yellow' as const
    markMatrix.compose(new THREE.Vector3(x, -0.035, z), new THREE.Quaternion(), new THREE.Vector3(w, 0.025, d))
    markTransforms[key].push(markMatrix.clone())
  }
  function addMarkInstances(key: 'white' | 'yellow', material: THREE.Material) {
    const transforms = markTransforms[key]
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, transforms.length)
    transforms.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceMatrix.needsUpdate = true
    roadsGroup.add(mesh)
  }
  for (const x of roadXs) {
    for (const side of [-1, 1]) {
      for (let z = 155; z >= -575; z -= 12) {
        if (roadZs.some(c => Math.abs(c - z) < 8)) continue
        addRoadMark(0.09, 4.4, x + side * 3.25, z, whiteMark)
      }
    }
    for (let z = 155; z >= -575; z -= 8) {
      if (roadZs.some(c => Math.abs(c - z) < 8)) continue
      addRoadMark(0.12, 3.5, x - 0.18, z, yellowMark)
      addRoadMark(0.12, 3.5, x + 0.18, z, yellowMark)
    }
  }
  for (const z of roadZs) {
    for (const side of [-1, 1]) {
      for (let x = -174; x <= 174; x += 12) {
        if (roadXs.some(c => Math.abs(c - x) < 8)) continue
        addRoadMark(4.4, 0.09, x, z + side * 3.25, whiteMark)
      }
    }
    for (let x = -174; x <= 174; x += 8) {
      if (roadXs.some(c => Math.abs(c - x) < 8)) continue
      addRoadMark(3.5, 0.12, x, z - 0.18, yellowMark)
      addRoadMark(3.5, 0.12, x, z + 0.18, yellowMark)
    }
  }
  addMarkInstances('white', whiteMark)
  addMarkInstances('yellow', yellowMark)
  // 人行横道（信号灯场景）
  const crosswalk = new THREE.Group()
  scene.add(crosswalk)
  crosswalk.visible = false
  for (let i = 0; i < 10; i++) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.03, 3.6), new THREE.MeshStandardMaterial({ color: 0xf9fbfa, roughness: 0.86 }))
    stripe.position.set(-3.6 + i * 0.8, 0.012, 0)
    crosswalk.add(stripe)
  }
  function createBuilding(x: number, z: number, index: number) {
    const g = new THREE.Group()
    const w = 6 + (index % 4) * 1.35
    const h = 5 + (index % 6) * 1.8
    const d = 6 + (index % 3) * 1.4
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), buildingMats[index % buildingMats.length]!)
    body.position.y = h / 2 - 0.1
    body.castShadow = true
    body.receiveShadow = true
    g.add(body)
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x81b8d2, emissive: 0x4c91ad, emissiveIntensity: 0.08, roughness: 0.5 })
    const floors = Math.min(4, Math.max(1, Math.floor(h / 2.4)))
    const cols = Math.max(2, Math.min(4, Math.floor(w / 2.3)))
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.48, 0.035), windowMat)
        win.position.set(-w / 2 + 0.7 + c * (w - 1.4) / Math.max(1, cols - 1), 0.9 + f * 1.5, d / 2 + 0.025)
        g.add(win)
        const sideWin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.42, 0.46), windowMat)
        sideWin.position.set(w / 2 + 0.025, 0.9 + f * 1.5, -d / 2 + 0.65 + c * (d - 1.3) / Math.max(1, cols - 1))
        g.add(sideWin)
      }
    }
    g.position.set(x, 0, z)
    g.userData.kind = 'building'
    buildingColliders.push({ x, z, halfW: w / 2, halfD: d / 2 })
    scene.add(g)
  }
  function createTree(x: number, z: number, i: number) {
    const g = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.19, 1.5, 7), mat(0x806349))
    trunk.position.y = 0.72
    g.add(trunk)
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85 + (i % 3) * 0.18, 1), mat(i % 2 ? 0x69a95b : 0x87bd64))
    leaf.position.y = 1.8
    leaf.castShadow = true
    g.add(leaf)
    g.position.set(x, 0, z)
    scene.add(g)
    trees.push(g)
  }
  let buildingIndex = 0
  for (let zi = 0; zi < roadZs.length - 1; zi++) {
    const zc = (roadZs[zi]! + roadZs[zi + 1]!) / 2
    for (let xi = 0; xi < roadXs.length - 1; xi++) {
      const xc = (roadXs[xi]! + roadXs[xi + 1]!) / 2
      createBuilding(xc, zc, buildingIndex++)
      createTree(xc - 16, zc - 16, buildingIndex++)
      createTree(xc + 16, zc + 16, buildingIndex++)
    }
  }
  for (let z = 145, i = 0; z >= -555; z -= 36, i++) {
    for (const x of [-134, 134]) createTree(x, z, i)
  }

  /* ---------- EGO 车与可点选传感器硬件 ---------- */
  const car = new THREE.Group()
  car.position.set(4.8, 0, 24)
  scene.add(car)
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x2dd6cf, metalness: 0.48, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.2 })
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.58, 4.05), bodyMat)
  body.position.y = 0.73
  body.castShadow = true
  body.receiveShadow = true
  car.add(body)
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.17, 1.35), bodyMat)
  hood.position.set(0, 1.05, -1.18)
  hood.castShadow = true
  car.add(hood)
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.66, 1.72), glassMat)
  cabin.position.set(0, 1.27, 0.25)
  cabin.castShadow = true
  car.add(cabin)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.08, 1.46), darkMat)
  roof.position.set(0, 1.63, 0.24)
  car.add(roof)
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.18, 0.14), darkMat)
  bumper.position.set(0, 0.51, -2.04)
  car.add(bumper)
  const headMat = new THREE.MeshStandardMaterial({ color: 0xd6ffff, emissive: 0x7deaff, emissiveIntensity: 2.2 })
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff627a, emissive: 0xb20d36, emissiveIntensity: 1.3 })
  for (const x of [-0.72, 0.72]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.08), headMat)
    head.position.set(x, 0.78, -2.06)
    car.add(head)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.07), tailMat)
    tail.position.set(x, 0.78, 2.06)
    car.add(tail)
  }
  const wheels: THREE.Mesh[] = []
  for (const x of [-1.02, 1.02]) {
    for (const z of [-1.35, 1.35]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.22, 20), mat(0x081019, 0.65, 0.1))
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, 0.4, z)
      wheel.castShadow = true
      car.add(wheel)
      wheels.push(wheel)
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.235, 12), mat(0x4b697a, 0.3, 0.65))
      hub.rotation.z = Math.PI / 2
      hub.position.set(x * 1.01, 0.4, z)
      car.add(hub)
    }
  }
  const pickables: THREE.Mesh[] = []
  function makeSensorMesh(id: SensorId, geometry: THREE.BufferGeometry, material: THREE.Material, pos: [number, number, number]) {
    const m = new THREE.Mesh(geometry, material)
    m.position.set(...pos)
    m.userData.sensorId = id
    m.castShadow = true
    car.add(m)
    pickables.push(m)
    return m
  }
  makeSensorMesh('camera', new THREE.BoxGeometry(0.3, 0.18, 0.2), mat(0x132b39, 0.25, 0.4), [0, 1.75, -0.75])
  const cameraLens = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), new THREE.MeshStandardMaterial({ color: 0x43e1e8, emissive: 0x0b8294, emissiveIntensity: 1.5, metalness: 0.4, roughness: 0.18 }))
  cameraLens.position.set(0, 1.73, -0.87)
  cameraLens.userData.sensorId = 'camera'
  car.add(cameraLens)
  pickables.push(cameraLens)
  makeSensorMesh('lidar', new THREE.CylinderGeometry(0.22, 0.25, 0.14, 24), mat(0x9cb8c7, 0.3, 0.65), [0, 1.78, 0.25])
  const lidarGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.09, 24), new THREE.MeshStandardMaterial({ color: 0x5be4e9, emissive: 0x167e99, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 }))
  lidarGlass.position.set(0, 1.87, 0.25)
  lidarGlass.userData.sensorId = 'lidar'
  car.add(lidarGlass)
  pickables.push(lidarGlass)
  makeSensorMesh('radar', new THREE.SphereGeometry(0.18, 16, 12), mat(0xffc76b, 0.28, 0.45), [0, 0.71, -2.05])
  makeSensorMesh('compute', new THREE.BoxGeometry(0.52, 0.16, 0.58), mat(0x9d75ff, 0.3, 0.35), [0, 1.07, 0.85])
  const gpuLED = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.025, 0.025), new THREE.MeshBasicMaterial({ color: 0xb9a1ff }))
  gpuLED.position.set(0, 1.16, 0.85)
  car.add(gpuLED)

  /* ---------- 传感器可视化 ---------- */
  function makeLine(points: THREE.Vector3[], color: number, opacity = 1) {
    const g = new THREE.BufferGeometry().setFromPoints(points)
    const m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false })
    return new THREE.Line(g, m)
  }
  function createFov() {
    const group = new THREE.Group()
    const verts = new Float32Array([
      0, 1.72, -0.82, -6, 0.04, -17, 6, 0.04, -17,
      0, 1.72, -0.82, -6, 3, -17, 6, 3, -17,
      0, 1.72, -0.82, -6, 0.04, -17, -6, 3, -17,
      0, 1.72, -0.82, 6, 0.04, -17, 6, 3, -17
    ])
    const inds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    geo.setIndex(inds)
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x43e1e8, transparent: true, opacity: 0.085, side: THREE.DoubleSide, depthWrite: false }))
    group.add(mesh)
    const lines: [number, number, number][][] = [
      [[0, 1.72, -0.82], [-6, 0.04, -17]],
      [[0, 1.72, -0.82], [6, 0.04, -17]],
      [[-6, 0.04, -17], [6, 0.04, -17]],
      [[-6, 3, -17], [6, 3, -17]]
    ]
    lines.forEach((p) => {
      group.add(makeLine(p.map(v => new THREE.Vector3(...v)), 0x4ceaf0, 0.55))
    })
    car.add(group)
    return group
  }
  const fovGroup = createFov()
  const lidarGroup = new THREE.Group()
  car.add(lidarGroup)
  const pointCount = 160
  const pointPos = new Float32Array(pointCount * 3)
  for (let i = 0; i < pointCount; i++) {
    const a = (i / pointCount) * Math.PI * 2
    const r = 5.3 + (i % 5) * 0.44
    pointPos[i * 3] = Math.cos(a) * r
    pointPos[i * 3 + 1] = 0.15 + ((i % 7) / 7) * 2.7
    pointPos[i * 3 + 2] = Math.sin(a) * r - 2
  }
  const pointGeo = new THREE.BufferGeometry()
  pointGeo.setAttribute('position', new THREE.BufferAttribute(pointPos, 3))
  lidarGroup.add(new THREE.Points(pointGeo, new THREE.PointsMaterial({ color: 0x56b7ff, size: 0.075, transparent: true, opacity: 0.85 })))
  const lidarRing = new THREE.Mesh(new THREE.TorusGeometry(5.7, 0.018, 5, 100), new THREE.MeshBasicMaterial({ color: 0x4daaff, transparent: true, opacity: 0.38 }))
  lidarRing.rotation.x = Math.PI / 2
  lidarRing.position.set(0, 0.06, -2)
  lidarGroup.add(lidarRing)
  const beam = makeLine([new THREE.Vector3(0, 0.18, -2), new THREE.Vector3(0, 2.5, -8)], 0x72d9ff, 0.85)
  lidarGroup.add(beam)
  const radarGroup = new THREE.Group()
  car.add(radarGroup)
  for (let r = 1.6; r <= 5.2; r += 1.2) {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 32; i++) {
      const a = Math.PI * 0.12 + (Math.PI * 0.76) * (i / 32)
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0.045, -1.9 - Math.sin(a) * r))
    }
    radarGroup.add(makeLine(pts, 0xffc76b, 0.55))
  }
  const radarDot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd37a }))
  radarDot.position.set(0, 0.1, -1.95)
  radarGroup.add(radarDot)

  /* ---------- 虚拟行车记录仪（第二渲染器 + 2D 叠加） ---------- */
  const dashcamEl = $<HTMLElement>('#ad-dashcam')
  const overlayEl = $<HTMLCanvasElement>('#ad-dash-overlay')
  if (!dashcamEl || !overlayEl) throw new Error('AutoDrive: 行车记录仪节点缺失')
  const dashcamContainer: HTMLElement = dashcamEl
  const dashOverlay: HTMLCanvasElement = overlayEl
  const dashcamRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
  dashcamRenderer.setPixelRatio(1)
  dashcamRenderer.outputColorSpace = THREE.SRGBColorSpace
  dashcamRenderer.toneMapping = THREE.ACESFilmicToneMapping
  dashcamRenderer.toneMappingExposure = 1.0
  dashcamContainer.appendChild(dashcamRenderer.domElement)
  const dashcamCamera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 180)
  dashcamCamera.position.set(0, 1.73, -0.98)
  dashcamCamera.rotation.x = -0.035
  car.add(dashcamCamera)
  const dashCtx = dashOverlay.getContext('2d')!

  /* ---------- 检测框 ---------- */
  function makeBoxOutline(w: number, h: number, d: number, color: number) {
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false })
    )
    edge.renderOrder = 10
    return edge
  }
  const carBox = makeBoxOutline(2.5, 2.2, 4.7, 0xff6d8f)
  carBox.position.y = 1.05
  car.add(carBox)
  const dynamicBox = makeBoxOutline(1.3, 2.1, 1.1, 0xff6d8f)
  scene.add(dynamicBox)
  dynamicBox.visible = false

  /* ---------- 信号灯 / 行人 / 障碍场景 ---------- */
  const signalGroup = new THREE.Group()
  scene.add(signalGroup)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.7, 10), mat(0x627b8a, 0.45, 0.55))
  pole.position.set(4.9, 2.83, 0)
  signalGroup.add(pole)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.12), mat(0x627b8a, 0.45, 0.55))
  arm.position.set(4.0, 5.2, 0)
  signalGroup.add(arm)
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.66, 1.75, 0.48), mat(0x101922, 0.42, 0.22))
  housing.position.set(3.15, 4.35, 0)
  housing.userData.kind = 'signal'
  housing.userData.sensorId = 'signal'
  signalGroup.add(housing)
  pickables.push(housing)
  const bulbs: Record<string, THREE.Mesh> = {}
  ;([['red', 0xff465d, 4.88], ['yellow', 0xffcd64, 4.35], ['green', 0x40e59f, 3.82]] as const).forEach(([key, color, y]) => {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.08, roughness: 0.2 }))
    bulb.position.set(3.15, y, -0.255)
    signalGroup.add(bulb)
    bulbs[key] = bulb
    bulb.userData.kind = 'signal'
    bulb.userData.signalColor = key
    bulb.userData.sensorId = 'signal'
    pickables.push(bulb)
  })
  signalGroup.visible = false
  const stopLine = new THREE.Mesh(new THREE.BoxGeometry(10, 0.03, 0.26), new THREE.MeshBasicMaterial({ color: 0xf4f9ff, transparent: true, opacity: 0.8 }))
  stopLine.position.set(0, 0.01, 0)
  scene.add(stopLine)
  stopLine.visible = false

  const pedestrian = new THREE.Group()
  scene.add(pedestrian)
  const skin = mat(0xeabf9f)
  const jacket = mat(0xf4ad4d)
  const pants = mat(0x324b83)
  const shoe = mat(0x111925)
  const pedHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), skin)
  pedHead.position.y = 1.67
  pedestrian.add(pedHead)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.62, 4, 8), jacket)
  torso.position.y = 1.13
  torso.castShadow = true
  pedestrian.add(torso)
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.46, 3, 7), jacket)
  const armR = armL.clone()
  armL.position.set(-0.31, 1.15, 0)
  armR.position.set(0.31, 1.15, 0)
  armL.rotation.z = -0.28
  armR.rotation.z = 0.28
  pedestrian.add(armL, armR)
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.52, 3, 7), pants)
  const legR = legL.clone()
  legL.position.set(-0.13, 0.48, 0)
  legR.position.set(0.13, 0.48, 0)
  pedestrian.add(legL, legR)
  const footL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.33), shoe)
  const footR = footL.clone()
  footL.position.set(-0.13, 0.14, -0.06)
  footR.position.set(0.13, 0.14, -0.06)
  pedestrian.add(footL, footR)
  pedestrian.visible = false
  const pedestrianBox = makeBoxOutline(1.05, 2.2, 0.8, 0xff6d8f)
  scene.add(pedestrianBox)
  pedestrianBox.visible = false
  const hazardGroup = new THREE.Group()
  scene.add(hazardGroup)
  function makeCone(x: number) {
    const g = new THREE.Group()
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.37, 0.1, 12), mat(0x252f39))
    base.position.y = 0.05
    g.add(base)
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.25, 0.65, 12), mat(0xff7d43, 0.55))
    cone.position.y = 0.4
    cone.castShadow = true
    g.add(cone)
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.16, 0.13, 12), mat(0xffebcf))
    stripe.position.y = 0.42
    g.add(stripe)
    g.position.x = x
    return g
  }
  hazardGroup.add(makeCone(-0.8), makeCone(0.25), makeCone(1.25))
  hazardGroup.visible = false
  const hazardBox = makeBoxOutline(3.2, 1.2, 1.3, 0xff6d8f)
  scene.add(hazardBox)
  hazardBox.visible = false

  /* ---------- 背景车流 ---------- */
  const traffic: THREE.Group[] = []
  const trafficBodyGeo = new THREE.BoxGeometry(1.8, 0.62, 3.8)
  const trafficCabinGeo = new THREE.BoxGeometry(1.3, 0.46, 1.5)
  const trafficWheelGeo = new THREE.CylinderGeometry(0.29, 0.29, 0.19, 12)
  const trafficPaint = [0x477da5, 0xc77d63, 0x7a94a6, 0x5e9b79, 0xd0a34a, 0x6f78ad, 0xb6c1c7, 0x3d4b59, 0x9d6b90, 0x438f93]
  let trafficSerial = 0
  function makeTrafficCar(x: number, z: number, color: number, axis: 'z' | 'x' = 'z', dir = -1, speed = 6) {
    const g = new THREE.Group()
    const bodyMesh = new THREE.Mesh(trafficBodyGeo, mat(color, 0.43, 0.22))
    bodyMesh.position.y = 0.62
    bodyMesh.castShadow = true
    bodyMesh.receiveShadow = true
    g.add(bodyMesh)
    const cabinMesh = new THREE.Mesh(trafficCabinGeo, glassMat)
    cabinMesh.position.set(0, 1, 0.12)
    g.add(cabinMesh)
    for (const xx of [-0.88, 0.88]) {
      for (const zz of [-1.15, 1.15]) {
        const wheel = new THREE.Mesh(trafficWheelGeo, darkMat)
        wheel.rotation.z = Math.PI / 2
        wheel.position.set(xx, 0.35, zz)
        g.add(wheel)
      }
    }
    const yaw = axis === 'z' ? (dir < 0 ? 0 : Math.PI) : (dir > 0 ? -Math.PI / 2 : Math.PI / 2)
    g.position.set(x, 0, z)
    g.rotation.y = yaw
    const data: TrafficData = { isTraffic: true, axis, dir, speed, serial: trafficSerial++, halfW: 0.9, halfL: 1.9, stopped: false }
    g.userData = data
    scene.add(g)
    traffic.push(g)
    return g
  }
  for (const roadX of roadXs) {
    for (let i = 0; i < 4; i++) makeTrafficCar(roadX + 4.8, 130 - i * 185, trafficPaint[(trafficSerial * 3) % trafficPaint.length]!, 'z', -1, 5.3 + (i % 3) * 0.8)
    for (let i = 0; i < 4; i++) makeTrafficCar(roadX - 4.8, -530 + i * 185, trafficPaint[(trafficSerial * 7 + 2) % trafficPaint.length]!, 'z', 1, 5.0 + (i % 4) * 0.75)
  }
  for (const roadZ of roadZs) {
    for (let i = 0; i < 2; i++) makeTrafficCar(-155 + i * 180, roadZ + 4.8, trafficPaint[(trafficSerial * 5 + 1) % trafficPaint.length]!, 'x', 1, 5.5 + (i % 2) * 1.0)
    for (let i = 0; i < 2; i++) makeTrafficCar(155 - i * 180, roadZ - 4.8, trafficPaint[(trafficSerial * 9 + 3) % trafficPaint.length]!, 'x', -1, 5.2 + (i % 2) * 0.9)
  }

  /* ---------- 学生障碍工坊 ---------- */
  const userObstacles: THREE.Group[] = []
  let placementType: ObstacleType | null = null
  let selectedObstacle: THREE.Group | null = null
  let dragObstacle: THREE.Group | null = null
  let isDraggingObstacle = false
  function makeUserObstacle(type: ObstacleType) {
    const g = new THREE.Group()
    const outlineColor = 0x128fba
    if (type === 'cone') {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.12, 16), mat(0x343b40))
      base.position.y = 0.06
      base.castShadow = true
      g.add(base)
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.29, 0.76, 16), mat(0xff7b35, 0.5))
      cone.position.y = 0.48
      cone.castShadow = true
      g.add(cone)
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.13, 16), mat(0xffffff, 0.45))
      band.position.y = 0.45
      g.add(band)
      g.userData.size = new THREE.Vector3(0.8, 0.9, 0.8)
    } else if (type === 'crate') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.92, 0.95), mat(0xd19a58, 0.9))
      box.position.y = 0.46
      box.castShadow = true
      box.receiveShadow = true
      g.add(box)
      for (const y of [0.25, 0.66]) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.055, 0.98), mat(0x9a6b39))
        slat.position.y = y
        g.add(slat)
      }
      g.userData.size = new THREE.Vector3(1, 0.96, 1)
    } else if (type === 'barrier') {
      const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.72, 0.48), mat(0xf4f4ee, 0.7))
      bodyMesh.position.y = 0.58
      bodyMesh.castShadow = true
      g.add(bodyMesh)
      for (let i = 0; i < 5; i++) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.76, 0.505), mat(0xf07836, 0.6))
        stripe.position.set(-1.0 + i * 0.5, 0.58, 0)
        stripe.rotation.z = -0.35
        g.add(stripe)
      }
      for (const x of [-0.92, 0.92]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.5, 0.6), mat(0xe7e8e3))
        leg.position.set(x, 0.25, 0)
        g.add(leg)
      }
      g.userData.size = new THREE.Vector3(2.6, 1.05, 0.65)
    } else if (type === 'tire') {
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.17, 12, 24), mat(0x252b30, 0.97))
      tire.rotation.x = Math.PI / 2
      tire.position.y = 0.18
      tire.castShadow = true
      g.add(tire)
      const hub = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 20), mat(0x9aa6ac, 0.5, 0.2))
      hub.rotation.x = Math.PI / 2
      hub.position.y = 0.18
      g.add(hub)
      g.userData.size = new THREE.Vector3(1.15, 0.62, 1.15)
    }
    const data: ObstacleData = {
      isUserObstacle: true,
      obstacleType: type,
      baseZ: 0,
      size: g.userData.size as THREE.Vector3
    }
    g.userData = data
    const dims = data.size
    const outline = makeBoxOutline(dims.x + 0.14, dims.y + 0.12, dims.z + 0.14, outlineColor)
    outline.position.y = dims.y / 2
    outline.visible = false
    g.add(outline)
    data.selectionOutline = outline
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.userData.userObstacleRoot = g
      }
    })
    return g
  }
  const toastEl = $<HTMLElement>('#ad-toast')
  let toastTimer = 0
  function toastMessage(message: string) {
    if (!toastEl) return
    toastEl.textContent = message
    toastEl.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 1600)
  }
  const hintEl = $<HTMLElement>('#ad-obstacle-hint')
  const removeBtn = $<HTMLButtonElement>('#ad-remove-obstacle')
  function syncRemoveBtn() {
    if (!removeBtn) return
    removeBtn.disabled = !selectedObstacle
    removeBtn.style.opacity = selectedObstacle ? '1' : '0.55'
  }
  function selectObstacle(g: THREE.Group | null) {
    selectedObstacle = g
    userObstacles.forEach((o) => {
      const outline = (o.userData as ObstacleData).selectionOutline
      if (outline) outline.visible = o === g
    })
    syncRemoveBtn()
    if (g && hintEl) hintEl.innerHTML = t().hintSelected(OBSTACLE_LABEL[lang()][(g.userData as ObstacleData).obstacleType])
    else if (!placementType && hintEl) hintEl.innerHTML = t().hintBuild
  }
  function addObstacle(type: ObstacleType, x: number, z: number) {
    const g = makeUserObstacle(type)
    g.position.set(x, 0, z)
    ;(g.userData as ObstacleData).baseZ = z
    scene.add(g)
    userObstacles.push(g)
    selectObstacle(g)
    updateUI()
    toastMessage(t().added(OBSTACLE_LABEL[lang()][type]))
    options.onTask?.('place')
    return g
  }
  function deleteObstacle(g: THREE.Group) {
    const i = userObstacles.indexOf(g)
    if (i < 0) return
    scene.remove(g)
    g.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
        else mesh.material.dispose()
      }
    })
    userObstacles.splice(i, 1)
    if (selectedObstacle === g) selectObstacle(null)
    updateUI()
  }
  function setPlacement(type: ObstacleType) {
    placementType = placementType === type ? null : type
    $$('[data-ad-place]').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.adPlace === placementType))
    renderer.domElement.style.cursor = placementType ? 'crosshair' : 'grab'
    if (hintEl) hintEl.innerHTML = placementType ? t().hintPlacing(OBSTACLE_LABEL[lang()][placementType]) : t().hintBuild
    toastMessage(placementType ? t().placeMode(OBSTACLE_LABEL[lang()][placementType]) : t().placeOff)
  }
  $$('[data-ad-place]').forEach(b => b.addEventListener('click', () => setPlacement((b as HTMLElement).dataset.adPlace as ObstacleType)))
  if (removeBtn) {
    removeBtn.disabled = true
    removeBtn.style.opacity = '0.55'
    removeBtn.addEventListener('click', () => {
      if (selectedObstacle) {
        deleteObstacle(selectedObstacle)
        toastMessage(t().removed)
      } else toastMessage(t().selectFirst)
    })
  }
  $('#ad-clear-obstacles')?.addEventListener('click', () => {
    ;[...userObstacles].forEach(deleteObstacle)
    selectObstacle(null)
    toastMessage(t().cleared)
  })

  /* ---------- 碰撞系统 ---------- */
  function boxesOverlap2D(
    posA: THREE.Vector3, yawA: number, halfWA: number, halfLA: number,
    posB: THREE.Vector3, yawB: number, halfWB: number, halfLB: number, padding = 0
  ): boolean {
    const axes = [
      { x: Math.cos(yawA), z: -Math.sin(yawA) },
      { x: Math.sin(yawA), z: Math.cos(yawA) },
      { x: Math.cos(yawB), z: -Math.sin(yawB) },
      { x: Math.sin(yawB), z: Math.cos(yawB) }
    ]
    const dx = posB.x - posA.x
    const dz = posB.z - posA.z
    const radius = (yaw: number, hw: number, hl: number, axis: { x: number, z: number }) => {
      const wx = { x: Math.cos(yaw), z: -Math.sin(yaw) }
      const lz = { x: Math.sin(yaw), z: Math.cos(yaw) }
      return (hw + padding) * Math.abs(wx.x * axis.x + wx.z * axis.z) + (hl + padding) * Math.abs(lz.x * axis.x + lz.z * axis.z)
    }
    for (const a of axes) {
      const distance = Math.abs(dx * a.x + dz * a.z)
      if (distance > radius(yawA, halfWA, halfLA, a) + radius(yawB, halfWB, halfLB, a)) return false
    }
    return true
  }
  function pointOnRoad(x: number, z: number) {
    if (x < -180 || x > 180 || z < -580 || z > 180) return false
    const half = 7.22
    return roadXs.some(rx => Math.abs(x - rx) <= half) || roadZs.some(rz => Math.abs(z - rz) <= half)
  }
  function footprintOnRoad(pos: THREE.Vector3, yaw: number) {
    const c = Math.cos(yaw)
    const sn = Math.sin(yaw)
    const hw = 1.02
    const hl = 1.98
    for (const lx of [-hw, 0, hw]) {
      for (const lz of [-hl, 0, hl]) {
        const x = pos.x + lx * c + lz * sn
        const z = pos.z - lx * sn + lz * c
        if (!pointOnRoad(x, z)) return false
      }
    }
    return true
  }
  const vehicleBounds = { minX: -175, maxX: 175, minZ: -575, maxZ: 165 }
  function vehicleCollisionAt(pos: THREE.Vector3, yaw: number, opts: { checkRoad?: boolean, checkObstacles?: boolean, checkTraffic?: boolean } = {}): string | null {
    const s = t()
    if (pos.x < vehicleBounds.minX || pos.x > vehicleBounds.maxX || pos.z < vehicleBounds.minZ || pos.z > vehicleBounds.maxZ) return s.colCity
    for (const b of buildingColliders) {
      if (boxesOverlap2D(pos, yaw, 1.04, 2.03, new THREE.Vector3(b.x, 0, b.z), 0, b.halfW, b.halfD, 0.12)) return s.colBuilding
    }
    if (opts.checkRoad !== false && !footprintOnRoad(pos, yaw)) return s.colRoad
    if (opts.checkObstacles !== false) {
      for (const g of userObstacles) {
        const size = (g.userData as ObstacleData).size
        if (boxesOverlap2D(pos, yaw, 1.04, 2.03, g.position, g.rotation.y || 0, size.x / 2, size.z / 2, 0.1)) return s.obsKind((g.userData as ObstacleData).obstacleType)
      }
      if (pedestrian.visible && boxesOverlap2D(pos, yaw, 1.04, 2.03, pedestrian.position, pedestrian.rotation.y, 0.42, 0.42, 0.12)) return s.colPed
      if (hazardGroup.visible && boxesOverlap2D(pos, yaw, 1.04, 2.03, hazardGroup.position, hazardGroup.rotation.y, 1.8, 0.48, 0.12)) return s.colHazard
    }
    if (opts.checkTraffic !== false) {
      for (const g of traffic) {
        const d = g.userData as TrafficData
        if (boxesOverlap2D(pos, yaw, 1.04, 2.03, g.position, g.rotation.y, d.halfW, d.halfL, 0.12)) return s.colVehicle
      }
    }
    return null
  }
  function nearestValue(v: number, values: number[]) {
    return values.reduce((best, n) => Math.abs(n - v) < Math.abs(best - v) ? n : best, values[0]!)
  }
  function trafficMustYieldAtIntersection(g: THREE.Group) {
    // 纵向车优先；横向车在纵向车接近同一冲突点时等待
    const d = g.userData as TrafficData
    if (d.axis !== 'x') return false
    const roadZ = nearestValue(g.position.z, roadZs)
    for (const roadX of roadXs) {
      for (const laneOffset of [-4.8, 4.8]) {
        const conflictX = roadX + laneOffset
        const distanceToConflict = (conflictX - g.position.x) * d.dir
        if (distanceToConflict <= 1.6 || distanceToConflict >= 14) continue
        for (const other of traffic) {
          const od = other.userData as TrafficData
          if (other === g || od.axis !== 'z') continue
          if (Math.abs(other.position.x - conflictX) < 1.05 && Math.abs(other.position.z - roadZ) < 15) return true
        }
      }
    }
    return false
  }
  function trafficPositionBlocked(g: THREE.Group, x: number, z: number) {
    const p = new THREE.Vector3(x, 0, z)
    const d = g.userData as TrafficData
    const yaw = g.rotation.y
    if (boxesOverlap2D(p, yaw, d.halfW, d.halfL, car.position, car.rotation.y, 1.04, 2.03, 0.12)) return true
    for (const other of traffic) {
      const od = other.userData as TrafficData
      if (other === g || od.axis !== d.axis || od.dir !== d.dir) continue
      const sameLane = d.axis === 'z' ? Math.abs(other.position.x - g.position.x) < 0.8 : Math.abs(other.position.z - g.position.z) < 0.8
      if (sameLane && boxesOverlap2D(p, yaw, d.halfW, d.halfL, other.position, other.rotation.y, od.halfW, od.halfL, 0.08)) return true
    }
    for (const o of userObstacles) {
      const size = (o.userData as ObstacleData).size
      if (boxesOverlap2D(p, yaw, d.halfW, d.halfL, o.position, o.rotation.y || 0, size.x / 2, size.z / 2, 0.1)) return true
    }
    return false
  }
  function updateTraffic(dt: number) {
    for (const g of traffic) {
      const d = g.userData as TrafficData
      if (trafficMustYieldAtIntersection(g)) {
        d.stopped = true
        continue
      }
      let x = g.position.x
      let z = g.position.z
      const step = d.dir * d.speed * dt
      if (d.axis === 'z') {
        z += step
        if (z < -565) z = 155
        if (z > 155) z = -565
      } else {
        x += step
        if (x > 175) x = -175
        if (x < -175) x = 175
      }
      if (trafficPositionBlocked(g, x, z)) {
        d.stopped = true
        continue
      }
      d.stopped = false
      g.position.x = x
      g.position.z = z
    }
  }

  /* ---------- 场景拾取：放置 / 拖拽 / 查看 ---------- */
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let pointerDown: { x: number, y: number } | null = null
  const roadPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const planeHit = new THREE.Vector3()
  function setRayFromEvent(e: PointerEvent) {
    const r = renderer.domElement.getBoundingClientRect()
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
  }
  function obstacleAtPointer() {
    const meshes: THREE.Mesh[] = []
    userObstacles.forEach((g) => {
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o)
      })
    })
    const hits = raycaster.intersectObjects(meshes, false)
    if (!hits.length) return null
    let o: THREE.Object3D | null = hits[0]!.object
    while (o && !(o.userData as ObstacleData).isUserObstacle) o = o.parent
    return (o as THREE.Group) || null
  }
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
  function snapToRoad(x: number, z: number) {
    const rx = nearestValue(x, roadXs)
    const rz = nearestValue(z, roadZs)
    const dx = Math.abs(x - rx)
    const dz = Math.abs(z - rz)
    if (dx > 7 && dz > 7) return null
    if (dx <= dz) return { x: rx + clamp(x - rx, -5, 5), z: clamp(z, -575, 155) }
    return { x: clamp(x, -175, 175), z: rz + clamp(z - rz, -5, 5) }
  }
  function setObstacleFromPointer(e: PointerEvent, g: THREE.Group) {
    setRayFromEvent(e)
    if (raycaster.ray.intersectPlane(roadPlane, planeHit)) {
      const p = snapToRoad(planeHit.x, planeHit.z)
      if (p) {
        g.position.x = p.x
        ;(g.userData as ObstacleData).baseZ = p.z
        g.position.z = p.z
      }
    }
  }
  renderer.domElement.addEventListener('pointerdown', (e) => {
    pointerDown = { x: e.clientX, y: e.clientY }
    setRayFromEvent(e)
    const found = obstacleAtPointer()
    if (found) {
      selectObstacle(found)
      dragObstacle = found
      isDraggingObstacle = true
      controls.enabled = false
      renderer.domElement.style.cursor = 'grabbing'
      e.preventDefault()
      return
    }
    if (placementType) {
      controls.enabled = false
      e.preventDefault()
    }
  })
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (isDraggingObstacle && dragObstacle) setObstacleFromPointer(e, dragObstacle)
  })
  renderer.domElement.addEventListener('pointerup', (e) => {
    const wasDown = pointerDown
    const moved = wasDown ? Math.hypot(e.clientX - wasDown.x, e.clientY - wasDown.y) > 5 : false
    pointerDown = null
    if (isDraggingObstacle) {
      isDraggingObstacle = false
      dragObstacle = null
      controls.enabled = true
      renderer.domElement.style.cursor = placementType ? 'crosshair' : 'grab'
      toastMessage(t().posUpdated)
      return
    }
    if (placementType) {
      setRayFromEvent(e)
      if (raycaster.ray.intersectPlane(roadPlane, planeHit)) {
        const p = snapToRoad(planeHit.x, planeHit.z)
        if (p) {
          addObstacle(placementType, p.x, p.z)
          controls.enabled = true
          renderer.domElement.style.cursor = 'crosshair'
        } else toastMessage(t().onRoadOnly)
      } else toastMessage(t().clickRoad)
      controls.enabled = true
      return
    }
    controls.enabled = true
    if (!wasDown || moved) return
    setRayFromEvent(e)
    const obstacle = obstacleAtPointer()
    if (obstacle) {
      selectObstacle(obstacle)
      return
    }
    const hits = raycaster.intersectObjects(pickables, true)
    if (hits.length) {
      let id = hits[0]!.object.userData.sensorId as SensorId | undefined
      if (!id && hits[0]!.object.parent) id = hits[0]!.object.parent.userData.sensorId as SensorId | undefined
      if (id) inspect(id)
    } else selectObstacle(null)
  })
  renderer.domElement.addEventListener('pointercancel', () => {
    pointerDown = null
    isDraggingObstacle = false
    dragObstacle = null
    controls.enabled = true
  })

  /* ---------- 组件详情卡 ---------- */
  function inspect(id: SensorId, showToast = true) {
    const d = DETAIL_INFO[id][lang()]
    const set = (sel: string, value: string) => {
      const el = $(sel)
      if (el) el.textContent = value
    }
    set('#ad-detail-title', d.title)
    set('#ad-detail-type', d.type)
    set('#ad-detail-desc', d.desc)
    set('#ad-detail-output', d.output)
    set('#ad-detail-strength', d.strength)
    set('#ad-detail-limit', d.limit)
    $$('.sensor-card').forEach(b => b.classList.toggle('selected', (b as HTMLElement).dataset.adSensor === id))
    if (showToast) {
      toastMessage(t().inspecting(d.title))
      options.onTask?.(`inspect:${id}`)
    }
  }
  $$('.sensor-card').forEach(b => b.addEventListener('click', () => inspect((b as HTMLElement).dataset.adSensor as SensorId)))

  /* ---------- 状态 ---------- */
  let running = false
  let scenario: ScenarioKey = 'cruise'
  let targetKph = 40
  let currentKph = 0
  let travel = 0
  let simTime = 0
  let driveMode: DriveMode = 'autonomous'
  const driveKeys = new Set<string>()
  let manualCollisionLatch = false
  let manualDistance = 0
  let manualDrivenReported = false
  let stopLatch = false
  const lastFollowPosition = car.position.clone()
  let lastFollowYaw = car.rotation.y
  let signalIsRed = true
  let pedTriggered = false
  let pedCrossTime = 0
  let lastDecision = ''
  let decisionDetail = ''
  let showCamera = true
  let showLidar = true
  let showRadar = true
  let showBoxes = true
  const views: Record<ViewKey, { pos: THREE.Vector3 }> = {
    orbit: { pos: new THREE.Vector3(12, 9, 15) },
    top: { pos: new THREE.Vector3(0, 33, 0) },
    driver: { pos: new THREE.Vector3(0, 2.6, 3.4) }
  }
  let currentView: ViewKey = 'orbit'

  function carLocalToWorld(v: THREE.Vector3) {
    return car.localToWorld(v.clone())
  }
  function updateCameraView() {
    if (currentView === 'orbit') {
      const delta = car.position.clone().sub(lastFollowPosition)
      camera.position.add(delta)
      controls.target.add(delta)
      const yawDelta = car.rotation.y - lastFollowYaw
      if (Math.abs(yawDelta) > 1e-7) {
        const axis = new THREE.Vector3(0, 1, 0)
        camera.position.sub(car.position).applyAxisAngle(axis, yawDelta).add(car.position)
        controls.target.sub(car.position).applyAxisAngle(axis, yawDelta).add(car.position)
      }
      lastFollowPosition.copy(car.position)
      lastFollowYaw = car.rotation.y
    } else if (currentView === 'top') {
      camera.position.set(car.position.x, car.position.y + 33, car.position.z + 0.01)
      camera.up.set(0, 0, -1)
      controls.target.copy(car.position)
    } else {
      camera.position.copy(carLocalToWorld(new THREE.Vector3(0, 2.6, 3.4)))
      camera.up.set(0, 1, 0)
      controls.target.copy(carLocalToWorld(new THREE.Vector3(0, 1, -22)))
    }
  }
  function setView(v: ViewKey) {
    currentView = v
    const item = views[v]
    if (v === 'orbit') {
      camera.position.copy(carLocalToWorld(item.pos))
      camera.up.set(0, 1, 0)
      controls.target.copy(car.position).add(new THREE.Vector3(0, 0.6, 0))
      lastFollowPosition.copy(car.position)
      lastFollowYaw = car.rotation.y
    } else if (v === 'top') {
      camera.position.set(car.position.x, car.position.y + 33, car.position.z + 0.01)
      camera.up.set(0, 0, -1)
      controls.target.copy(car.position)
    } else {
      camera.position.copy(carLocalToWorld(item.pos))
      camera.up.set(0, 1, 0)
      controls.target.copy(carLocalToWorld(new THREE.Vector3(0, 1, -22)))
    }
    controls.update()
    $$('[data-ad-view]').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.adView === v))
  }
  $$('[data-ad-view]').forEach(b => b.addEventListener('click', () => {
    const v = (b as HTMLElement).dataset.adView as ViewKey
    setView(v)
    options.onTask?.(`view:${v}`)
  }))

  function setSignal() {
    const red = bulbs.red!
    const green = bulbs.green!
    const yellow = bulbs.yellow!
    ;(red.material as THREE.MeshStandardMaterial).emissiveIntensity = signalIsRed ? 2.5 : 0.06
    ;(red.material as THREE.MeshStandardMaterial).color.set(signalIsRed ? 0xff465d : 0x662b38)
    ;(green.material as THREE.MeshStandardMaterial).emissiveIntensity = signalIsRed ? 0.06 : 2.5
    ;(green.material as THREE.MeshStandardMaterial).color.set(signalIsRed ? 0x245c47 : 0x40e59f)
    ;(yellow.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.06
    const label = $('#ad-signal-label')
    if (label) label.textContent = signalIsRed ? t().red : t().green
    $('#ad-signal-btn')?.classList.toggle('active', !signalIsRed)
  }
  const startBtn = $<HTMLButtonElement>('#ad-start')
  const sceneModeEl = $('#ad-scene-mode')
  const decisionMain = $('#ad-decision-main')
  const decisionSub = $('#ad-decision-sub')
  const systemStatus = $('#ad-system-status')
  const systemDot = $('#ad-system-dot')
  const manualControls = $('#ad-manual-controls')
  function syncStartBtn() {
    if (!startBtn) return
    startBtn.textContent = running ? t().pauseDrive : (driveMode === 'manual' ? t().enableDriving : t().startDrive)
    startBtn.classList.toggle('danger', running)
    startBtn.classList.toggle('primary', !running)
  }
  function setDriveMode(mode: DriveMode) {
    driveMode = mode
    driveKeys.clear()
    $$('.manual-key').forEach(b => b.classList.remove('pressed'))
    $('#ad-auto-mode')?.classList.toggle('active', mode === 'autonomous')
    $('#ad-manual-mode')?.classList.toggle('active', mode === 'manual')
    if (manualControls) manualControls.style.display = mode === 'manual' ? 'block' : 'none'
    if (sceneModeEl) sceneModeEl.textContent = mode === 'manual' ? t().sceneManual : t().sceneAuto
    syncStartBtn()
    if (decisionMain) decisionMain.textContent = mode === 'manual' ? t().mReady : t().dCruise
    if (decisionSub) decisionSub.textContent = mode === 'manual' ? t().mReadySub : t().dCruiseSub
    updateUI()
  }
  $('#ad-auto-mode')?.addEventListener('click', () => setDriveMode('autonomous'))
  $('#ad-manual-mode')?.addEventListener('click', () => setDriveMode('manual'))

  function updateScenarioVisuals() {
    signalGroup.visible = scenario === 'signal'
    crosswalk.visible = scenario === 'signal'
    stopLine.visible = scenario === 'signal'
    pedestrian.visible = scenario === 'pedestrian'
    pedestrianBox.visible = scenario === 'pedestrian' && showBoxes
    hazardGroup.visible = scenario === 'hazard'
    hazardBox.visible = scenario === 'hazard' && showBoxes
    dynamicBox.visible = showBoxes && (scenario === 'pedestrian' || scenario === 'hazard')
    fovGroup.visible = showCamera
    lidarGroup.visible = showLidar
    radarGroup.visible = showRadar
    carBox.visible = showBoxes
  }
  function setScenario(s: ScenarioKey) {
    scenario = s
    currentKph = 0
    simTime = 0
    pedTriggered = false
    pedCrossTime = 0
    if (s === 'signal') signalIsRed = true
    setSignal()
    $$('[data-ad-scenario]').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.adScenario === s))
    const s2 = t()
    if (sceneModeEl) sceneModeEl.textContent = s === 'signal' ? s2.sceneSignal : s === 'pedestrian' ? s2.scenePed : s === 'hazard' ? s2.sceneHazard : (driveMode === 'manual' ? s2.sceneManual : s2.sceneAuto)
    updateScenarioVisuals()
    const summaries: Record<ScenarioKey, [string, string]> = {
      cruise: [s2.dCruise, s2.dCruiseSub],
      signal: [s2.dSignal, s2.rRedLight],
      pedestrian: [s2.dPed, s2.dPedSub('0')],
      hazard: [s2.dAvoid, s2.dAvoidSub('0')]
    }
    lastDecision = summaries[s][0]!
    decisionDetail = summaries[s][1]!
    if (decisionMain) decisionMain.textContent = lastDecision
    if (decisionSub) decisionSub.textContent = decisionDetail
  }
  $$('[data-ad-scenario]').forEach(b => b.addEventListener('click', () => {
    const s = (b as HTMLElement).dataset.adScenario as ScenarioKey
    setScenario(s)
    options.onTask?.(`scenario:${s}`)
  }))
  startBtn?.addEventListener('click', () => {
    running = !running
    syncStartBtn()
    const s = t()
    if (systemStatus) systemStatus.textContent = running ? (driveMode === 'manual' ? s.statusManual : s.statusAuto) : s.statusPaused
    if (systemDot) systemDot.style.background = running ? '#50e3a4' : '#ffca68'
    updateUI()
  })
  $('#ad-reset')?.addEventListener('click', () => {
    resetSim()
    setScenario(scenario)
    setView(currentView)
    toastMessage(t().resetToast)
  })
  const speedSlider = $<HTMLInputElement>('#ad-speed-slider')
  const speedTargetEl = $('#ad-speed-target')
  speedSlider?.addEventListener('input', () => {
    targetKph = Number(speedSlider.value)
    if (speedTargetEl) speedTargetEl.textContent = String(targetKph)
  })
  $('#ad-signal-btn')?.addEventListener('click', () => {
    signalIsRed = !signalIsRed
    setSignal()
    toastMessage(signalIsRed ? t().lightRed : t().lightGreen)
  })
  function layerToggle(layer: LayerKey, button: HTMLElement) {
    const on = button.classList.toggle('on')
    if (layer === 'camera') {
      showCamera = on
      fovGroup.visible = on
    }
    if (layer === 'lidar') {
      showLidar = on
      lidarGroup.visible = on
    }
    if (layer === 'radar') {
      showRadar = on
      radarGroup.visible = on
    }
    if (layer === 'boxes') {
      showBoxes = on
      carBox.visible = on
      pedestrianBox.visible = on && scenario === 'pedestrian' && pedestrian.visible
      hazardBox.visible = on && scenario === 'hazard' && hazardGroup.visible
    }
    options.onTask?.(`layer:${layer}`)
  }
  $$('[data-ad-layer]').forEach(b => b.addEventListener('click', () => layerToggle((b as HTMLElement).dataset.adLayer as LayerKey, b)))

  /* ---------- 世界更新 ---------- */
  function getForward() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(car.quaternion).normalize()
  }
  function getRight() {
    return new THREE.Vector3(1, 0, 0).applyQuaternion(car.quaternion).normalize()
  }
  function projectedDistance(point: THREE.Vector3, maxLateral = 10) {
    const delta = point.clone().sub(car.position)
    const d = delta.dot(getForward())
    const lateral = Math.abs(delta.dot(getRight()))
    return d > 0 && lateral <= maxLateral ? d : Infinity
  }
  function getHazardDistance() {
    if (scenario === 'signal') return projectedDistance(new THREE.Vector3(0, 0, -66), 11)
    if (scenario === 'pedestrian') return projectedDistance(pedestrian.position.clone(), 9)
    if (scenario === 'hazard') return projectedDistance(hazardGroup.position.clone(), 5)
    return Infinity
  }
  function setDecision(main: string, sub: string) {
    lastDecision = main
    decisionDetail = sub
    if (decisionMain) decisionMain.textContent = main
    if (decisionSub) decisionSub.textContent = sub
  }
  function updateWorld(dt: number) {
    updateTraffic(dt)
    signalGroup.position.set(0, 0, -66)
    crosswalk.position.set(0, 0, -60)
    stopLine.position.set(0, 0.01, -66)
    if (scenario === 'pedestrian') {
      pedestrian.position.z = -54
      const d = projectedDistance(pedestrian.position.clone(), 10)
      if (!pedTriggered && d < 44) {
        pedTriggered = true
        pedCrossTime = 0
      }
      if (pedTriggered && pedCrossTime < 5) {
        pedCrossTime += dt
        const p = clamp(pedCrossTime / 5, 0, 1)
        pedestrian.position.x = 3.8 - 7.6 * p
        legL.rotation.x = Math.sin(pedCrossTime * 7) * 0.55
        legR.rotation.x = -Math.sin(pedCrossTime * 7) * 0.55
        armL.rotation.x = -Math.sin(pedCrossTime * 7) * 0.28
        armR.rotation.x = Math.sin(pedCrossTime * 7) * 0.28
      } else if (!pedTriggered) pedestrian.position.x = 3.8
      else pedestrian.position.x = -3.8
      pedestrianBox.position.copy(pedestrian.position)
      pedestrianBox.position.y = 1.1
      dynamicBox.position.copy(pedestrian.position)
      dynamicBox.position.y = 1.1
      dynamicBox.visible = showBoxes && pedestrian.visible
    }
    if (scenario === 'hazard') {
      hazardGroup.position.set(0, 0, -48)
      hazardBox.position.set(0.1, 0.58, -48)
      dynamicBox.position.set(0.1, 0.58, -48)
      dynamicBox.visible = showBoxes && hazardGroup.visible
    }
    if (scenario === 'signal' || scenario === 'cruise') dynamicBox.visible = false
    if (running) {
      wheels.forEach((w) => {
        w.rotation.x -= currentKph * 0.002
      })
      lidarGlass.rotation.y += dt * 2.6
    }
    beam.rotation.y = simTime * 1.7
    if (car.position.x < vehicleBounds.minX || car.position.x > vehicleBounds.maxX || car.position.z < vehicleBounds.minZ || car.position.z > vehicleBounds.maxZ) {
      car.position.x = clamp(car.position.x, vehicleBounds.minX, vehicleBounds.maxX)
      car.position.z = clamp(car.position.z, vehicleBounds.minZ, vehicleBounds.maxZ)
      currentKph = 0
    }
  }
  function closestUserObstacle() {
    let closest: { group: THREE.Group, distance: number, type: ObstacleType } | null = null
    const f = getForward()
    const r = getRight()
    for (const g of userObstacles) {
      const delta = g.position.clone().sub(car.position)
      const d = delta.dot(f)
      const lateral = Math.abs(delta.dot(r))
      const size = (g.userData as ObstacleData).size
      if (d > 0 && d < 100 && lateral < Math.max(2.6, size.x * 0.65) && (!closest || d < closest.distance)) closest = { group: g, distance: d, type: (g.userData as ObstacleData).obstacleType }
    }
    return closest
  }
  function trafficAhead() {
    let closest: { group: THREE.Group, distance: number } | null = null
    const f = getForward()
    const r = getRight()
    for (const g of traffic) {
      const delta = g.position.clone().sub(car.position)
      const d = delta.dot(f)
      const lateral = Math.abs(delta.dot(r))
      if (d > 0 && d < 80 && lateral < 2.6 && (!closest || d < closest.distance)) closest = { group: g, distance: d }
    }
    return closest
  }
  function updateManualDriving(dt: number) {
    const forwardPressed = driveKeys.has('forward')
    const brakePressed = driveKeys.has('brake')
    const handbrake = driveKeys.has('handbrake')
    const left = driveKeys.has('left')
    const right = driveKeys.has('right')
    if (handbrake) currentKph = 0
    else if (forwardPressed && !brakePressed) currentKph = Math.min(targetKph, currentKph + 22 * dt)
    else if (brakePressed) {
      if (currentKph > 0) currentKph = Math.max(0, currentKph - 58 * dt)
      else currentKph = Math.max(-12, currentKph - 20 * dt)
    } else {
      if (currentKph > 0) currentKph = Math.max(0, currentKph - 2.4 * dt)
      else if (currentKph < 0) currentKph = Math.min(0, currentKph + 2.4 * dt)
    }

    const ahead = closestUserObstacle()
    const trafficObj = trafficAhead()
    const stoppingDistance = Math.max(3.2, Math.abs(currentKph) / 3.6 * 0.55)
    const blocked = (ahead && ahead.distance < stoppingDistance) || (trafficObj && trafficObj.distance < stoppingDistance)
    if (blocked && currentKph > 0) {
      currentKph = 0
      if (!manualCollisionLatch) {
        toastMessage(t().safetyStop)
        manualCollisionLatch = true
      }
    } else if (!blocked) manualCollisionLatch = false

    const steer = (right ? 1 : 0) - (left ? 1 : 0)
    const speedMs = currentKph / 3.6
    // 自行车模型近似：转向权限随速度增长，倒车时自然反向
    const nextYaw = car.rotation.y - (steer * speedMs * 0.18 * dt)
    const direction = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), nextYaw)
    const distance = speedMs * dt
    const nextPosition = car.position.clone().addScaledVector(direction, distance)
    if (Math.abs(speedMs) > 0.02) {
      const collision = vehicleCollisionAt(nextPosition, nextYaw)
      if (collision) {
        currentKph = 0
        if (!manualCollisionLatch) {
          toastMessage(t().collisionPrevented(collision))
          manualCollisionLatch = true
        }
      } else {
        car.rotation.y = nextYaw
        car.position.copy(nextPosition)
        travel += Math.abs(distance)
        manualDistance += Math.abs(distance)
        if (!manualDrivenReported && manualDistance >= 15) {
          manualDrivenReported = true
          options.onTask?.('manual-drive')
        }
        manualCollisionLatch = false
      }
    } else if (steer === 0) manualCollisionLatch = false
    return { steer, ahead, trafficObj }
  }
  function updateSimulation(dt: number) {
    simTime += dt
    const s = t()
    if (driveMode === 'manual') {
      const manual = updateManualDriving(dt)
      const speed = Math.abs(currentKph)
      const main = currentKph < -0.1 ? s.mReversing : speed < 0.1 ? s.mStopped : s.mDriving
      let sub = manual.steer < 0 ? s.mLeft : manual.steer > 0 ? s.mRight : s.mSpeed
      if (manual.ahead && manual.ahead.distance < 14) sub = s.mAhead(s.obsKind(manual.ahead.type), manual.ahead.distance.toFixed(1))
      else if (manual.trafficObj && manual.trafficObj.distance < 18) sub = s.mAhead(s.colVehicle, manual.trafficObj.distance.toFixed(1))
      setDecision(main, sub)
    } else {
      const d = getHazardDistance()
      let shouldStop = false
      let reason = ''
      const customAhead = closestUserObstacle()
      const trafficObj = trafficAhead()
      if (customAhead && customAhead.distance < 14) {
        shouldStop = true
        reason = s.rObstacle(s.obsKind(customAhead.type))
      }
      if (trafficObj && trafficObj.distance < 14) {
        shouldStop = true
        reason = s.rVehicle
      }
      if (scenario === 'signal' && signalIsRed && d < 18) {
        shouldStop = true
        reason = s.rRedLight
      }
      if (scenario === 'pedestrian' && pedTriggered && pedCrossTime < 5 && d < 26) {
        shouldStop = true
        reason = s.rPed
      }
      if (scenario === 'hazard' && d < 15) {
        shouldStop = true
        reason = s.rHazard
      }
      if (car.position.z < vehicleBounds.minZ + 8) {
        shouldStop = true
        reason = s.rBoundary
      }
      const desired = running ? (shouldStop ? 0 : targetKph) : 0
      const accel = shouldStop ? 30 : (running ? 13 : 24)
      const delta = accel * dt
      if (currentKph < desired) currentKph = Math.min(desired, currentKph + delta)
      else currentKph = Math.max(desired, currentKph - delta)
      if (running && currentKph > 0) {
        const distance = currentKph / 3.6 * dt
        const nextPosition = car.position.clone().addScaledVector(getForward(), distance)
        const collision = vehicleCollisionAt(nextPosition, car.rotation.y)
        if (collision) {
          currentKph = 0
          shouldStop = true
          reason = s.rCollision(collision)
        } else {
          car.position.copy(nextPosition)
          travel += distance
        }
      }
      // 教学事件：进入「安全刹停」状态时记一次
      if (running && shouldStop && !stopLatch) {
        stopLatch = true
        options.onTask?.('safe-stop')
      }
      if (!shouldStop) stopLatch = false

      let main = s.dCruise
      let sub = s.dCruiseSub
      if (!running) {
        main = s.dPaused
        sub = s.dPausedSub
      } else if (shouldStop) {
        main = s.dSafeStop
        sub = reason
      } else if (customAhead && customAhead.distance < 50) {
        main = s.dObstacle
        sub = s.dObstacleSub(s.obsKind(customAhead.type), customAhead.distance.toFixed(0))
      } else if (trafficObj && trafficObj.distance < 45) {
        main = s.dTraffic
        sub = s.dTrafficSub(trafficObj.distance.toFixed(0))
      } else if (scenario === 'signal' && signalIsRed) {
        main = s.dSignal
        sub = s.dSignalSub(Math.max(0, d).toFixed(0))
      } else if (scenario === 'pedestrian' && pedTriggered && pedCrossTime >= 5) {
        main = s.dResume
        sub = s.dResumeSub
      } else if (scenario === 'pedestrian') {
        main = s.dPed
        sub = s.dPedSub(Math.max(0, d).toFixed(0))
      } else if (scenario === 'hazard') {
        main = s.dAvoid
        sub = s.dAvoidSub(Math.max(0, d).toFixed(0))
      } else if (scenario === 'signal' && !signalIsRed) {
        main = s.dGreen
        sub = s.dGreenSub
      }
      setDecision(main, sub)
    }
    const sense = $('#ad-pipe-sense')
    const plan = $('#ad-pipe-plan')
    const act = $('#ad-pipe-act')
    sense?.classList.add('active')
    plan?.classList.toggle('active', running)
    act?.classList.toggle('active', running && Math.abs(currentKph) > 0.1)
    if (lastDecision === t().dSafeStop) {
      plan?.classList.add('active')
      act?.classList.add('active')
    }
  }

  /* ---------- 遥测 ---------- */
  const speedNow = $('#ad-speed-now')
  const speedBar = $('#ad-speed-bar')
  const distanceNow = $('#ad-distance-now')
  const distanceBar = $('#ad-distance-bar')
  const objectCount = $('#ad-object-count')
  const objectBar = $('#ad-object-bar')
  const confidenceNow = $('#ad-confidence-now')
  const confidenceBar = $('#ad-confidence-bar')
  const cameraObjects = $('#ad-camera-objects')
  const cameraRange = $('#ad-camera-range')
  function updateUI() {
    const s = t()
    if (speedNow) speedNow.textContent = String(Math.round(currentKph))
    if (speedBar) speedBar.style.width = `${clamp(currentKph / 60 * 100, 0, 100)}%`
    if (distanceNow) distanceNow.textContent = travel.toFixed(1)
    if (distanceBar) distanceBar.style.width = `${clamp(travel / 120 * 100, 8, 100)}%`
    const visibleCustom = userObstacles.filter(g => g.position.distanceTo(car.position) < 70).length
    const visibleTraffic = traffic.filter(g => g.position.distanceTo(car.position) < 85).length
    const scenarioObjects = (signalGroup.visible ? 1 : 0) + (pedestrian.visible ? 1 : 0) + (hazardGroup.visible ? 3 : 0)
    const count = visibleTraffic + visibleCustom + scenarioObjects
    if (objectCount) objectCount.textContent = String(count).padStart(2, '0')
    if (objectBar) objectBar.style.width = `${clamp(count / 18 * 100, 0, 100)}%`
    const closest = closestUserObstacle()
    const confidence = closest && closest.distance < 35 ? 94.8 : scenario === 'pedestrian' && pedTriggered && pedCrossTime < 5 ? 96.4 : scenario === 'hazard' ? 97.1 : 98.2
    if (confidenceNow) confidenceNow.textContent = confidence.toFixed(1) + '%'
    if (confidenceBar) confidenceBar.style.width = confidence + '%'
    if (cameraObjects) cameraObjects.textContent = s.objects(String(count).padStart(2, '0'))
    if (cameraRange) cameraRange.textContent = closest && closest.distance < 70 ? s.hazardAt(closest.distance.toFixed(0)) : s.laneClear
    if (systemStatus) systemStatus.textContent = running ? (driveMode === 'manual' ? s.statusManual : s.statusAuto) : Math.abs(currentKph) > 0.1 ? s.statusBraking : s.statusReady
    if (systemDot) systemDot.style.background = running ? '#50e3a4' : Math.abs(currentKph) > 0.1 ? '#ffca68' : '#50e3a4'
  }

  /* ---------- 行车记录仪叠加 ---------- */
  function resizeDashcam() {
    const w = Math.max(1, dashcamContainer.clientWidth)
    const h = Math.max(1, dashcamContainer.clientHeight)
    dashcamCamera.aspect = w / h
    dashcamCamera.updateProjectionMatrix()
    dashcamRenderer.setSize(w, h, false)
    dashOverlay.width = w
    dashOverlay.height = h
  }
  function drawDashcamOverlay() {
    const s = t()
    const w = dashOverlay.width
    const h = dashOverlay.height
    dashCtx.clearRect(0, 0, w, h)
    dashcamCamera.updateMatrixWorld(true)
    scene.updateMatrixWorld(true)
    // 车道引导线
    dashCtx.strokeStyle = 'rgba(71,239,164,.45)'
    dashCtx.lineWidth = 1.25
    dashCtx.beginPath()
    dashCtx.moveTo(w * 0.39, h)
    dashCtx.lineTo(w * 0.47, h * 0.58)
    dashCtx.lineTo(w * 0.49, h * 0.48)
    dashCtx.moveTo(w * 0.61, h)
    dashCtx.lineTo(w * 0.53, h * 0.58)
    dashCtx.lineTo(w * 0.51, h * 0.48)
    dashCtx.stroke()
    const objects: { group: THREE.Object3D, label: string, color: string }[] = []
    userObstacles.forEach((g) => {
      if (g.position.distanceTo(car.position) < 90) objects.push({ group: g, label: s.obsKind((g.userData as ObstacleData).obstacleType), color: '#37e99a' })
    })
    if (pedestrian.visible) objects.push({ group: pedestrian, label: s.colPed, color: '#ffc45a' })
    if (signalGroup.visible) objects.push({ group: signalGroup, label: s.dSignal, color: signalIsRed ? '#ff6475' : '#42e5a0' })
    const fwd = getForward()
    const side = getRight()
    traffic.forEach((g) => {
      const delta = g.position.clone().sub(car.position)
      const ahead = delta.dot(fwd)
      const lateral = Math.abs(delta.dot(side))
      if (ahead > 1 && ahead < 95 && lateral < 28) objects.push({ group: g, label: s.colVehicle, color: '#64c7ff' })
    })
    objects.forEach(({ group, label, color }) => {
      const box = new THREE.Box3().setFromObject(group)
      if (box.isEmpty()) return
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const p = center.clone().project(dashcamCamera)
      if (p.z < -1 || p.z > 1 || p.x < -1.18 || p.x > 1.18 || p.y < -1.18 || p.y > 1.18) return
      const px = (p.x * 0.5 + 0.5) * w
      const py = (-p.y * 0.5 + 0.5) * h
      const camSpace = dashcamCamera.worldToLocal(center.clone())
      const depth = Math.max(0.5, -camSpace.z)
      const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(dashcamCamera.fov * 0.5)) * depth
      const bw = THREE.MathUtils.clamp(size.x / viewH * h * 1.6, 16, w * 0.65)
      const bh = THREE.MathUtils.clamp(size.y / viewH * h * 1.65, 18, h * 0.7)
      const x = THREE.MathUtils.clamp(px - bw / 2, 2, w - bw - 2)
      const y = THREE.MathUtils.clamp(py - bh / 2, 13, h - bh - 2)
      dashCtx.strokeStyle = color
      dashCtx.lineWidth = 1.5
      dashCtx.strokeRect(x, y, bw, bh)
      dashCtx.fillStyle = color
      dashCtx.font = '700 8px ui-monospace,monospace'
      const text = `${label} ${depth.toFixed(0)}M`
      const tw = dashCtx.measureText(text).width + 8
      dashCtx.fillRect(x, y - 12, Math.min(tw, w - x), 12)
      dashCtx.fillStyle = '#143344'
      dashCtx.fillText(text, x + 4, y - 3, Math.max(0, w - x - 4))
    })
    dashCtx.fillStyle = 'rgba(10,36,51,.66)'
    dashCtx.fillRect(6, h - 20, Math.min(170, w - 12), 14)
    dashCtx.fillStyle = '#e9fff8'
    dashCtx.font = '700 8px ui-monospace,monospace'
    const modeText = driveMode === 'manual' ? (running ? s.manualActive : s.manualStandby) : (running ? s.autoActive : s.autoStandby)
    dashCtx.fillText(modeText, 11, h - 10)
  }

  /* ---------- 键盘 / 屏幕按键（手动驾驶） ---------- */
  const keyBindings: Record<string, string> = {
    ArrowUp: 'forward', KeyW: 'forward',
    ArrowDown: 'brake', KeyS: 'brake',
    Space: 'handbrake',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right'
  }
  function setDriveKey(key: string, pressed: boolean) {
    if (driveMode !== 'manual') return
    if (pressed) driveKeys.add(key)
    else driveKeys.delete(key)
    $$('.manual-key').forEach(b => b.classList.toggle('pressed', driveKeys.has((b as HTMLElement).dataset.adKey || '')))
  }
  const onKeydown = (e: KeyboardEvent) => {
    const key = keyBindings[e.code]
    if (!key) return
    const tag = ((e.target && (e.target as HTMLElement).tagName) || '').toLowerCase()
    if (tag === 'input' || tag === 'textarea') return
    e.preventDefault()
    if (!e.repeat) setDriveKey(key, true)
  }
  const onKeyup = (e: KeyboardEvent) => {
    const key = keyBindings[e.code]
    if (key) {
      e.preventDefault()
      setDriveKey(key, false)
    }
  }
  const onBlur = () => {
    driveKeys.clear()
    $$('.manual-key').forEach(b => b.classList.remove('pressed'))
  }
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  window.addEventListener('blur', onBlur)
  $$('.manual-key').forEach((btn) => {
    const k = (btn as HTMLElement).dataset.adKey || ''
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      btn.setPointerCapture?.((e as PointerEvent).pointerId)
      setDriveKey(k, true)
    })
    const release = (e: Event) => {
      e?.preventDefault()
      setDriveKey(k, false)
    }
    btn.addEventListener('pointerup', release)
    btn.addEventListener('pointercancel', release)
    btn.addEventListener('lostpointercapture', release)
    btn.addEventListener('contextmenu', e => e.preventDefault())
  })

  /* ---------- 时钟 ---------- */
  const clockEl = $('#ad-clock')
  const clockStart = performance.now()
  let clockTimer = 0
  function tickClock() {
    if (!clockEl) return
    const sec = Math.floor((performance.now() - clockStart) / 1000)
    clockEl.textContent = [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map(n => String(n).padStart(2, '0')).join(':')
  }

  /* ---------- 重置 ---------- */
  function resetSim() {
    running = false
    travel = 0
    simTime = 0
    currentKph = 0
    manualDistance = 0
    car.position.set(4.8, 0, 24)
    car.rotation.set(0, 0, 0)
    pedTriggered = false
    pedCrossTime = 0
    signalIsRed = true
    manualCollisionLatch = false
    stopLatch = false
    driveKeys.clear()
    setSignal()
    syncStartBtn()
    lastFollowPosition.copy(car.position)
    lastFollowYaw = car.rotation.y
    updateScenarioVisuals()
    setView(currentView)
    updateUI()
  }

  /* ---------- 主循环 ---------- */
  const clock = new THREE.Clock()
  function render() {
    if (disposed) return
    rafId = requestAnimationFrame(render)
    const dt = Math.min(clock.getDelta(), 0.05)
    if (running) updateSimulation(dt)
    updateWorld(dt)
    updateCameraView()
    controls.update()
    renderer.render(scene, camera)
    // 记录仪画面里隐藏纯可视化网格，但保留真实 3D 世界
    const overlayVisibility = [fovGroup.visible, lidarGroup.visible, radarGroup.visible, carBox.visible, dynamicBox.visible, pedestrianBox.visible, hazardBox.visible]
    fovGroup.visible = false
    lidarGroup.visible = false
    radarGroup.visible = false
    carBox.visible = false
    dynamicBox.visible = false
    pedestrianBox.visible = false
    hazardBox.visible = false
    dashcamRenderer.render(scene, dashcamCamera)
    const vis = overlayVisibility
    fovGroup.visible = vis[0]!
    lidarGroup.visible = vis[1]!
    radarGroup.visible = vis[2]!
    carBox.visible = vis[3]!
    dynamicBox.visible = vis[4]!
    pedestrianBox.visible = vis[5]!
    hazardBox.visible = vis[6]!
    drawDashcamOverlay()
    updateUI()
  }

  /* ---------- 尺寸 ---------- */
  function resize() {
    const w = Math.max(1, stage.clientWidth)
    const h = Math.max(1, stage.clientHeight)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
    resizeDashcam()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(stage)
  ro.observe(dashcamContainer)

  /* ---------- 初始化 ---------- */
  resize()
  setSignal()
  setDriveMode('autonomous')
  setScenario('cruise')
  inspect('camera', false)
  setView('orbit')
  updateUI()
  render()
  clockTimer = window.setInterval(tickClock, 1000)
  tickClock()

  return {
    dispose() {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
      ro.disconnect()
      window.clearInterval(clockTimer)
      window.clearTimeout(toastTimer)
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('keyup', onKeyup)
      window.removeEventListener('blur', onBlur)
      controls.dispose()
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach(m => m.dispose())
        else if (material) material.dispose()
      })
      renderer.dispose()
      dashcamRenderer.dispose()
    },
    isRunning: () => running,
    setRunning(r) {
      running = r
      syncStartBtn()
    },
    getDriveMode: () => driveMode,
    setDriveMode,
    getScenario: () => scenario,
    setScenario,
    setTargetSpeed(kmh) {
      targetKph = kmh
      if (speedSlider) speedSlider.value = String(kmh)
      if (speedTargetEl) speedTargetEl.textContent = String(kmh)
    },
    toggleSignal() {
      signalIsRed = !signalIsRed
      setSignal()
      return signalIsRed
    },
    reset: resetSim
  }
}
