/**
 * MultimodalDrone 多模态无人机指令台 —— 3D 引擎。
 *
 * 与 dronesim（完整飞行操作台）刻意区分：这里只有一个「最简易」的飞行场景 ——
 * 一块停机坪 + 一架四旋翼 + 起飞/悬停/降落三态，把舞台留给页面的三种控制通道
 * （屏幕按钮 / 麦克风语音 / 摄像头手势）。
 *
 * 约定（与 robot 系列引擎一致）：
 *   - three 走 npm 依赖，无 CDN；动画循环用 THREE.Timer（0.186 起 Clock 弃用）；
 *   - 引擎接收页面传入的根节点，ResizeObserver 跟随尺寸，可在 Nuxt 页里挂载/卸载；
 *   - 引擎只管渲染与相位机，UI 文案与教学进度都留在页面层。
 *
 * 相位机：idle --takeoff--> takeoff --到顶--> hover --land--> land --落地--> idle
 */
import * as THREE from 'three'

export type DronePhase = 'idle' | 'takeoff' | 'hover' | 'land'
export type CmdSource = 'button' | 'voice' | 'gesture'

export interface MultimodalState {
  phase: DronePhase
  /** 当前离地高度（米） */
  altitude: number
  /** 最近一次被接受指令的来源（null = 尚无指令） */
  source: CmdSource | null
}

export interface MultimodalSimOptions {
  /** 相位变化立即回调；高度读数约 10Hz 节流 */
  onState?: (state: MultimodalState) => void
}

export interface MultimodalSimHandle {
  dispose: () => void
  /**
   * 发送起飞/降落指令。返回是否被接受：
   *   - takeoff 仅 idle 时接受；
   *   - land 仅飞行中（takeoff/hover/land 之外的爬升中断）接受；
   *   - 重复指令（hover 时再 takeoff、idle 时再 land）拒绝。
   */
  command: (cmd: 'takeoff' | 'land', source: CmdSource) => boolean
}

const GROUND_Y = 0.26
const HOVER_Y = 5
/** 起飞/降落用时（秒） */
const CLIMB_T = 2.6

const PHASE_COLOR: Record<DronePhase, number> = {
  idle: 0xff5470,
  takeoff: 0xffcc4d,
  hover: 0x39e6a0,
  land: 0xff9f43
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

export function createMultimodalDroneSim(
  root: HTMLElement,
  opts: MultimodalSimOptions = {}
): MultimodalSimHandle {
  /* ---------- 渲染器 / 场景 / 相机 ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  root.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x070b12)
  scene.fog = new THREE.Fog(0x070b12, 20, 46)

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120)
  camera.position.set(6.6, 4.2, 8.2)
  camera.lookAt(0, 2.2, 0)

  scene.add(new THREE.HemisphereLight(0x9db7d6, 0x1a2230, 1.0))
  const sun = new THREE.DirectionalLight(0xffffff, 1.8)
  sun.position.set(6, 10, 4)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = -10
  sun.shadow.camera.right = 10
  sun.shadow.camera.top = 10
  sun.shadow.camera.bottom = -10
  scene.add(sun)

  /* ---------- 地面 + 停机坪 ---------- */
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(11, 48),
    new THREE.MeshStandardMaterial({ color: 0x0d141f, roughness: 1 })
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const grid = new THREE.GridHelper(34, 34, 0x24344d, 0x17202f)
  grid.position.y = 0.002
  scene.add(grid)

  const padGroup = new THREE.Group()
  const padDisk = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 48),
    new THREE.MeshStandardMaterial({ color: 0x101a29, roughness: 0.9 })
  )
  padDisk.rotation.x = -Math.PI / 2
  padDisk.position.y = 0.006
  padDisk.receiveShadow = true
  padGroup.add(padDisk)
  const padRing = new THREE.Mesh(
    new THREE.RingGeometry(1.48, 1.62, 48),
    new THREE.MeshBasicMaterial({ color: 0x36d3ff, transparent: true, opacity: 0.5 })
  )
  padRing.rotation.x = -Math.PI / 2
  padRing.position.y = 0.01
  padGroup.add(padRing)
  // H 标识：两竖一横
  const hMat = new THREE.MeshBasicMaterial({ color: 0x36d3ff, transparent: true, opacity: 0.75 })
  for (const [w, h, x, z] of [[0.1, 0.7, -0.24, 0], [0.1, 0.7, 0.24, 0], [0.58, 0.1, 0, 0]] as const) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, h), hMat)
    bar.rotation.x = -Math.PI / 2
    bar.position.set(x, 0.012, z)
    padGroup.add(bar)
  }
  scene.add(padGroup)

  /* ---------- 四旋翼 ---------- */
  const drone = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b3648, roughness: 0.55, metalness: 0.25 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x141b28, roughness: 0.7, metalness: 0.15 })
  const propMat = new THREE.MeshStandardMaterial({ color: 0x36d3ff, roughness: 0.4, transparent: true, opacity: 0.85 })

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.16, 0.74), bodyMat)
  body.castShadow = true
  drone.add(body)
  const battery = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.4), darkMat)
  battery.position.y = 0.13
  battery.castShadow = true
  drone.add(battery)
  const gimbal = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 16), darkMat)
  gimbal.rotation.x = Math.PI / 2
  gimbal.position.set(0, -0.1, 0.4)
  drone.add(gimbal)

  // 四条臂 + 电机 + 桨 + 臂端状态灯
  const props: THREE.Group[] = []
  const leds: THREE.Mesh[] = []
  const ledMat = new THREE.MeshStandardMaterial({
    color: PHASE_COLOR.idle, emissive: PHASE_COLOR.idle, emissiveIntensity: 1.4
  })
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.6), bodyMat)
    arm.position.set(sx * 0.24, 0, sz * 0.24)
    arm.rotation.y = Math.atan2(sx, sz)
    arm.castShadow = true
    drone.add(arm)
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.09, 14), darkMat)
    motor.position.set(sx * 0.44, 0.07, sz * 0.44)
    motor.castShadow = true
    drone.add(motor)
    const prop = new THREE.Group()
    const bladeA = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.012, 0.05), propMat)
    const bladeB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.46), propMat)
    prop.add(bladeA, bladeB)
    prop.position.set(sx * 0.44, 0.14, sz * 0.44)
    drone.add(prop)
    props.push(prop)
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 10), ledMat)
    led.position.set(sx * 0.44, -0.02, sz * 0.44)
    drone.add(led)
    leds.push(led)
  }
  // 起落架
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.05), darkMat)
    leg.position.set(sx * 0.18, -0.17, 0.2)
    drone.add(leg)
    const legB = leg.clone()
    legB.position.z = -0.2
    drone.add(legB)
  }
  drone.position.y = GROUND_Y
  drone.rotation.y = Math.PI * 0.08
  scene.add(drone)

  /* ---------- 相位机 ---------- */
  let phase: DronePhase = 'idle'
  let source: CmdSource | null = null
  let phaseT = 0 // 当前相位已进行时间（秒）
  let phaseFrom = GROUND_Y
  let propSpeed = 0 // 当前桨速（rad/s），向目标平滑

  let emitAcc = 0
  function emitState(force = false, dt = 0) {
    // 高度读数节流到 ~10Hz；相位变化立即回
    emitAcc += dt
    if (!force && emitAcc < 0.1) return
    emitAcc = 0
    opts.onState?.({ phase, altitude: Math.max(0, drone.position.y - GROUND_Y), source })
  }

  function setPhase(next: DronePhase) {
    phase = next
    phaseT = 0
    phaseFrom = drone.position.y
    const c = PHASE_COLOR[next]
    ledMat.color.setHex(c)
    ledMat.emissive.setHex(c)
    emitState(true)
  }

  function command(cmd: 'takeoff' | 'land', src: CmdSource): boolean {
    if (cmd === 'takeoff') {
      if (phase !== 'idle') return false
      source = src
      setPhase('takeoff')
      return true
    }
    // land：飞行中任意相位（takeoff 爬升中 / hover）都接受
    if (phase === 'idle' || phase === 'land') return false
    source = src
    setPhase('land')
    return true
  }

  /* ---------- 尺寸跟随 ---------- */
  function resize() {
    const w = Math.max(root.clientWidth, 1)
    const h = Math.max(root.clientHeight, 1)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(root)
  resize()

  /* ---------- 主循环 ---------- */
  const timer = new THREE.Timer()
  let rafId = 0
  let disposed = false

  function loop() {
    if (disposed) return
    rafId = requestAnimationFrame(loop)
    timer.update()
    const dt = Math.min(timer.getDelta(), 0.05)
    phaseT += dt

    // 桨速平滑趋近目标：地面停转 / 空中全速
    const targetSpeed = phase === 'idle' ? 0 : 30
    propSpeed += (targetSpeed - propSpeed) * Math.min(1, dt * 3)
    for (let i = 0; i < props.length; i++) {
      props[i]!.rotation.y += propSpeed * dt * (i % 2 === 0 ? 1 : -1)
    }

    if (phase === 'takeoff') {
      const t = Math.min(1, phaseT / CLIMB_T)
      drone.position.y = THREE.MathUtils.lerp(phaseFrom, HOVER_Y, easeInOutCubic(t))
      if (t >= 1) setPhase('hover')
    } else if (phase === 'hover') {
      drone.position.y = HOVER_Y + Math.sin(timer.getElapsed() * 2.1) * 0.06
      drone.rotation.y += dt * 0.12
    } else if (phase === 'land') {
      const t = Math.min(1, phaseT / CLIMB_T)
      drone.position.y = THREE.MathUtils.lerp(phaseFrom, GROUND_Y, easeInOutCubic(t))
      if (t >= 1) setPhase('idle')
    }

    // 悬停灯呼吸
    ledMat.emissiveIntensity = phase === 'hover' ? 1.1 + Math.sin(timer.getElapsed() * 4) * 0.7 : 1.4
    emitState(false, dt)
    renderer.render(scene, camera)
  }
  loop()

  function dispose() {
    disposed = true
    cancelAnimationFrame(rafId)
    ro.disconnect()
    renderer.dispose()
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach(m => m.dispose())
      else mat?.dispose()
    })
    renderer.domElement.remove()
  }

  return { dispose, command }
}
