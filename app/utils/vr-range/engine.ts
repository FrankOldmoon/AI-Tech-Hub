/**
 * Quest Range —— WebXR 射击训练场 3D 引擎。
 *
 * 从独立单文件页（Downloads/index.html）移植：
 *   - 场地建模 / 浮动目标 / 粒子特效 / 双手柄射线与扳机（selectstart + gamepad 兜底）/ 桌面
 *     预览（指针锁定 + WASD）这套命令式逻辑保持原样；
 *   - 把「整页 DOM + position:fixed 铺满视口 + document.getElementById」换成
 *     「调用方传入页面根节点，引擎在根节点内按 id 取节点」，于是能在 Nuxt 页里挂载/卸载；
 *   - three 走 npm 依赖，VRButton 来自 three/examples/jsm/webxr/VRButton.js，
 *     由引擎插入到根节点内的 #vr-xr-slot（原版直接插 body）；
 *   - HUD（分数/时间/命中/命中率/消息条）仍由引擎直接写 DOM，不绑 Vue；
 *   - 新增教学进度回调：onTask（打金目标 / 连击 / 完整打完一局）、onStat（每秒 + 关键事件
 *     采样，供页面的进度面板与 embed-report 上报使用）。
 */

import * as THREE from 'three'
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js'

export type Lang = 'zh' | 'en'

/** 页面进度面板 / embed-report 用的采样数据 */
export interface VRRangeStats {
  /** 本局得分 */
  score: number
  /** 本局命中数 */
  hits: number
  /** 本局发射数 */
  shots: number
  /** 本局命中率 0~1；一枪未开为 null */
  accuracy: number | null
  /** 本局剩余秒数 */
  remaining: number
  /** 是否正在进行 */
  running: boolean
  /** 已完整打完的局数 */
  rounds: number
  /** 历史单局最佳得分 */
  bestScore: number
  /** 历史最佳命中率（该局 ≥10 发才计入）0~1，没有则 null */
  bestAccuracy: number | null
  /** 累计命中（跨局） */
  totalHits: number
}

export interface VRRangeOptions {
  getLocale: () => Lang
  /** 完成一次教学交互时回调：'gold'（打中金色高分目标）/ 'streak'（2.5 秒连中 3 个）/ 'round'（完整打完一局） */
  onTask?: (task: string) => void
  /** 每秒 + 关键事件（开枪/命中/开局/终局）采样一次，用于页面上的进度显示 */
  onStat?: (stats: VRRangeStats) => void
}

export interface VRRangeHandle {
  dispose: () => void
  /** 重开一局（等同于桌面按 R / VR 里终局后扣扳机） */
  restart: () => void
}

export function createVRRange(root: HTMLElement, options: VRRangeOptions): VRRangeHandle {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector('#' + id) as T | null

  const stage = $('vr-stage')
  const canvas = $<HTMLCanvasElement>('vr-canvas')
  const xrSlot = $('vr-xr-slot')
  if (!stage || !canvas || !xrSlot) throw new Error('QuestRange: 舞台节点缺失（#vr-stage / #vr-canvas / #vr-xr-slot）')

  const ui = {
    score: $('vr-score'),
    time: $('vr-time'),
    hits: $('vr-hits'),
    accuracy: $('vr-accuracy'),
    message: $('vr-message')
  }

  const lang = () => options.getLocale()
  const say = (t: { zh: string, en: string }) => t[lang()] ?? t.en

  let disposed = false

  /* ---------- 渲染器 ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.xr.enabled = true
  renderer.xr.setReferenceSpaceType('local-floor')
  renderer.shadowMap.enabled = false
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x91c9e8)
  scene.fog = new THREE.Fog(0x91c9e8, 18, 65)

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 120)
  camera.position.set(0, 1.65, 4.8)

  // VRButton 原版插 body；这里收进 #vr-xr-slot，样式由页面 CSS 覆盖成品牌配色
  const vrButton = VRButton.createButton(renderer, {
    optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
  })
  xrSlot.appendChild(vrButton)

  /* ---------- 灯光与场地 ---------- */
  scene.add(new THREE.HemisphereLight(0xeaf8ff, 0x4d6174, 2.1))
  const sun = new THREE.DirectionalLight(0xfff1d2, 2.3)
  sun.position.set(-5, 10, 6)
  scene.add(sun)

  function material(color: number, roughness = 0.7, metalness = 0) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness })
  }

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), material(0x455b6d))
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  const wallMat = material(0x203549)
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(32, 8, 0.5), wallMat)
  backWall.position.set(0, 4, -24)
  scene.add(backWall)

  // 靶道发光标线
  for (let x = -14; x <= 14; x += 2) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.015, 34), material(x % 4 === 0 ? 0x4fd9e8 : 0x7895a8))
    stripe.position.set(x, 0.012, -7)
    scene.add(stripe)
  }
  for (let z = 2; z >= -22; z -= 4) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(30, 0.012, 0.025), material(0x8ca5b5))
    line.position.set(0, 0.014, z)
    scene.add(line)
  }

  // 靶墙后的城市剪影
  for (let i = 0; i < 16; i++) {
    const h = 2 + (i * 7 % 9)
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, h, 1.2), material(i % 2 ? 0x68859a : 0x7897a9))
    b.position.set(-19 + i * 2.5, h / 2 - 0.05, -30 - (i % 3) * 2)
    scene.add(b)
  }

  /* ---------- 桌面预览控制（仅非 VR 时） ---------- */
  let yaw = 0
  let pitch = 0
  const keys = new Set<string>()
  let pointerLocked = false

  const onCanvasClick = () => {
    if (renderer.xr.isPresenting) return
    if (document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock?.()
    } else {
      fireFromCamera()
    }
  }
  const onPointerLockChange = () => {
    pointerLocked = document.pointerLockElement === renderer.domElement
  }
  const onMouseMove = (e: MouseEvent) => {
    if (!pointerLocked || renderer.xr.isPresenting) return
    yaw -= e.movementX * 0.0022
    pitch -= e.movementY * 0.0022
    pitch = THREE.MathUtils.clamp(pitch, -1.15, 1.15)
  }
  const onKeydown = (e: KeyboardEvent) => {
    keys.add(e.code)
    if (e.code === 'KeyR') resetGame()
  }
  const onKeyup = (e: KeyboardEvent) => keys.delete(e.code)

  renderer.domElement.addEventListener('click', onCanvasClick)
  document.addEventListener('pointerlockchange', onPointerLockChange)
  document.addEventListener('mousemove', onMouseMove)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)

  /* ---------- 目标 ---------- */
  const targetGroup = new THREE.Group()
  scene.add(targetGroup)
  const targets: THREE.Group[] = []
  const targetGeo = new THREE.SphereGeometry(0.28, 18, 14)
  const ringGeo = new THREE.TorusGeometry(0.38, 0.035, 8, 32)
  const targetColors = [0xff4f70, 0xffc857, 0x62f2c2, 0x6cb8ff]

  function spawnTarget(initial = false) {
    const color = targetColors[Math.floor(Math.random() * targetColors.length)]!
    const group = new THREE.Group()
    const core = new THREE.Mesh(targetGeo, new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.18,
      roughness: 0.32,
      metalness: 0.12
    }))
    group.add(core)
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({
      color: 0xe8f8ff,
      emissive: 0x3d9cbd,
      emissiveIntensity: 0.5,
      metalness: 0.5,
      roughness: 0.3
    }))
    ring.position.z = 0.015
    group.add(ring)
    const x = THREE.MathUtils.randFloat(-6.8, 6.8)
    const y = THREE.MathUtils.randFloat(1.15, 4.4)
    const z = THREE.MathUtils.randFloat(-17, -8)
    group.position.set(x, y, z)
    // 金色目标是高分靶（+20），其余 +10
    group.userData = { ring, phase: Math.random() * Math.PI * 2, baseY: y, value: color === 0xffc857 ? 20 : 10, alive: true }
    targetGroup.add(group)
    targets.push(group)
    if (!initial) emitStat()
    return group
  }
  for (let i = 0; i < 8; i++) spawnTarget(true)

  /* ---------- 命中粒子特效 ---------- */
  const effects: { group: THREE.Group, life: number }[] = []
  function burst(position: THREE.Vector3, color: number) {
    const group = new THREE.Group()
    const geo = new THREE.SphereGeometry(0.035, 6, 5)
    const mat = new THREE.MeshBasicMaterial({ color })
    for (let i = 0; i < 10; i++) {
      const p = new THREE.Mesh(geo, mat)
      p.position.set(THREE.MathUtils.randFloatSpread(0.24), THREE.MathUtils.randFloatSpread(0.24), THREE.MathUtils.randFloatSpread(0.24))
      p.userData.velocity = new THREE.Vector3(THREE.MathUtils.randFloatSpread(2.5), Math.random() * 2.2, THREE.MathUtils.randFloatSpread(2.5))
      group.add(p)
    }
    group.position.copy(position)
    scene.add(group)
    effects.push({ group, life: 0.42 })
  }

  /* ---------- 游戏状态 ---------- */
  const raycaster = new THREE.Raycaster()
  const tempMatrix = new THREE.Matrix4()
  const controllers: THREE.Group[] = []
  const triggerDown = [false, false]
  let shotCount = 0
  let hitCount = 0
  let score = 0
  const ROUND_SECONDS = 60
  let remaining = ROUND_SECONDS
  let running = false
  let gameOver = false
  const hitTimes: number[] = []
  let streakFired = false

  // 跨局累计的教学指标（进度面板 / 上报用），resetGame 不清零
  let rounds = 0
  let bestScore = 0
  let bestAccuracy: number | null = null
  let totalHits = 0

  function makeControllerRay(controller: THREE.Group) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x6ee7f9, transparent: true, opacity: 0.85 })
    )
    line.scale.z = 8
    controller.add(line)
    return line
  }

  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i)
    controller.addEventListener('connected', (event) => {
      controller.userData.inputSource = (event as unknown as { data: XRInputSource }).data
    })
    controller.addEventListener('disconnected', () => {
      controller.userData.inputSource = null
    })
    controller.addEventListener('selectstart', () => {
      if (!running && !gameOver) startGame()
      if (running) shootFromController(controller)
    })
    scene.add(controller)
    controllers.push(controller)
    makeControllerRay(controller)

    // 手柄不需要加载官方模型：一个发光小枪就足以看清朝向
    const grip = renderer.xr.getControllerGrip(i)
    const blaster = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.23), material(0x172b3c, 0.35, 0.55))
    body.position.z = -0.07
    blaster.add(body)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.18, 10), material(0x64e7f5, 0.3, 0.45))
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.01, -0.23)
    blaster.add(barrel)
    const glow = new THREE.PointLight(0x47e7ff, 0.6, 1.2)
    glow.position.set(0, 0.02, -0.22)
    blaster.add(glow)
    grip.add(blaster)
    scene.add(grip)
  }

  // 部分手柄 profile 通过 gamepad 按钮上报扳机，selectstart 只是标准事件；两者兜底且不会双发
  function pollControllerButtons() {
    const session = renderer.xr.getSession()
    if (!session) return
    let index = 0
    for (const source of session.inputSources) {
      if (!source.gamepad) continue
      const trigger = source.gamepad.buttons[0]?.pressed ?? false
      if (trigger && !triggerDown[index] && running) {
        const controller = controllers[index]
        if (controller) shootFromController(controller)
      }
      triggerDown[index] = trigger
      index++
      if (index >= 2) break
    }
  }

  /* ---------- 射击 ---------- */
  function shootRay(origin: THREE.Vector3, direction: THREE.Vector3) {
    if (!running) return
    shotCount++
    raycaster.set(origin, direction)
    raycaster.far = 45
    const hitMeshes: THREE.Mesh[] = []
    for (const t of targets) {
      if (!t.userData.alive) continue
      t.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) hitMeshes.push(obj as THREE.Mesh)
      })
    }
    const hits = raycaster.intersectObjects(hitMeshes, false)
    if (hits.length) {
      const hit = hits[0]!
      const target = targets.find(t => t === hit.object.parent || t.children.includes(hit.object))
      if (target && target.userData.alive) {
        target.userData.alive = false
        score += target.userData.value
        hitCount++
        totalHits++
        ui.message!.textContent = say({ zh: `命中 +${target.userData.value}`, en: `HIT +${target.userData.value}` })
        burst(hit.point, (hit.object as THREE.Mesh).material instanceof THREE.MeshStandardMaterial
          ? ((hit.object as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex()
          : 0x7af4ff)
        targetGroup.remove(target)
        const idx = targets.indexOf(target)
        if (idx >= 0) targets.splice(idx, 1)
        if (target.userData.value === 20) options.onTask?.('gold')

        // 2.5 秒内连中 3 个目标 → 连击任务
        const now = performance.now()
        hitTimes.push(now)
        while (hitTimes.length && now - hitTimes[0]! > 2500) hitTimes.shift()
        if (hitTimes.length >= 3 && !streakFired) {
          streakFired = true
          options.onTask?.('streak')
        }

        const timer = setTimeout(() => {
          pendingSpawns.delete(timer)
          if (!disposed && running) spawnTarget()
        }, 350)
        pendingSpawns.add(timer)
      }
    } else {
      ui.message!.textContent = say({ zh: '没中 —— 继续瞄准', en: 'MISS — keep aiming' })
    }
    // ≥10 发后开始统计最佳命中率（避免一两枪 100% 的假完美）
    if (shotCount >= 10) {
      const acc = hitCount / shotCount
      if (bestAccuracy === null || acc > bestAccuracy) bestAccuracy = acc
    }
    emitStat()
    updateHud()
  }

  function shootFromController(controller: THREE.Group) {
    controller.updateMatrixWorld(true)
    tempMatrix.identity().extractRotation(controller.matrixWorld)
    const direction = new THREE.Vector3(0, 0, -1).applyMatrix4(tempMatrix).normalize()
    const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld)
    shootRay(origin, direction)
  }

  function fireFromCamera() {
    if (!running) startGame()
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize()
    shootRay(camera.position.clone(), direction)
  }

  /* ---------- 局面控制 ---------- */
  function startGame() {
    if (gameOver) resetGame()
    running = true
    ui.message!.textContent = say({ zh: '开始！任一手柄瞄准 · 扣扳机射击', en: 'GO! Aim with either controller · Squeeze trigger' })
    emitStat()
  }

  function resetGame() {
    score = 0
    hitCount = 0
    shotCount = 0
    remaining = ROUND_SECONDS
    running = false
    gameOver = false
    hitTimes.length = 0
    streakFired = false
    for (const t of [...targets]) targetGroup.remove(t)
    targets.length = 0
    for (let i = 0; i < 8; i++) spawnTarget(true)
    ui.message!.textContent = say({ zh: '就绪 · 按任一扳机开始', en: 'Ready · Press either trigger to start' })
    emitStat()
    updateHud()
  }

  function finishGame() {
    running = false
    gameOver = true
    rounds++
    if (score > bestScore) bestScore = score
    options.onTask?.('round')
    ui.message!.textContent = say({
      zh: `时间到 · 得分 ${score} · 桌面按 R 或扣扳机重开`,
      en: `TIME UP · SCORE ${score} · Press R on desktop or trigger to restart`
    })
    emitStat()
  }

  function updateHud() {
    if (ui.score) ui.score.textContent = String(score).padStart(4, '0')
    if (ui.hits) ui.hits.textContent = String(hitCount)
    if (ui.time) ui.time.textContent = String(Math.ceil(remaining))
    if (ui.accuracy) ui.accuracy.textContent = shotCount ? `${Math.round(hitCount / shotCount * 100)}%` : '—'
  }

  function emitStat() {
    options.onStat?.({
      score,
      hits: hitCount,
      shots: shotCount,
      accuracy: shotCount ? hitCount / shotCount : null,
      remaining,
      running,
      rounds,
      bestScore,
      bestAccuracy,
      totalHits
    })
  }

  updateHud()
  ui.message!.textContent = say({ zh: '进入 VR 开始 · 扳机开火', en: 'Enter VR to begin · Trigger to fire' })

  /* ---------- 尺寸 ---------- */
  function resize() {
    const w = Math.max(stage!.clientWidth, 1)
    const h = Math.max(stage!.clientHeight, 1)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(stage)

  /* ---------- 主循环（WebXR 必须用 setAnimationLoop） ---------- */
  const pendingSpawns = new Set<ReturnType<typeof setTimeout>>()
  const timer = new THREE.Timer()
  let lastSecond = -1

  function animate() {
    if (disposed) return
    timer.update()
    const dt = Math.min(timer.getDelta(), 0.05)

    if (renderer.xr.isPresenting) {
      root.classList.add('in-vr')
      pollControllerButtons()
    } else {
      root.classList.remove('in-vr')
      // 桌面预览：指针锁定下的第一人称移动/转视角
      camera.rotation.order = 'YXZ'
      camera.rotation.y = yaw
      camera.rotation.x = pitch
      const speed = 3.2 * dt
      const forward = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw))
      const right = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw))
      if (keys.has('KeyW')) camera.position.addScaledVector(forward, speed)
      if (keys.has('KeyS')) camera.position.addScaledVector(forward, -speed)
      if (keys.has('KeyA')) camera.position.addScaledVector(right, -speed)
      if (keys.has('KeyD')) camera.position.addScaledVector(right, speed)
      camera.position.y = 1.65
    }

    for (const t of targets) {
      t.userData.phase += dt * 1.4
      t.position.y = t.userData.baseY + Math.sin(t.userData.phase) * 0.18
      t.rotation.y += dt * 0.7
      t.userData.ring.rotation.z += dt * 0.6
    }

    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i]!
      e.life -= dt
      for (const p of e.group.children) {
        p.position.addScaledVector(p.userData.velocity as THREE.Vector3, dt)
        ;(p.userData.velocity as THREE.Vector3).y -= 4 * dt
      }
      if (e.life <= 0) {
        scene.remove(e.group)
        e.group.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.geometry) mesh.geometry.dispose()
          if (mesh.material) (mesh.material as THREE.Material).dispose()
        })
        effects.splice(i, 1)
      }
    }

    if (running) {
      remaining -= dt
      if (remaining <= 0) {
        remaining = 0
        finishGame()
      }
      updateHud()
      const sec = Math.ceil(remaining)
      if (sec !== lastSecond) {
        lastSecond = sec
        emitStat()
      }
    }

    renderer.render(scene, camera)
  }
  renderer.setAnimationLoop(animate)

  /* ---------- 卸载 ---------- */
  return {
    dispose() {
      disposed = true
      renderer.setAnimationLoop(null)
      ro.disconnect()
      for (const timer of pendingSpawns) clearTimeout(timer)
      pendingSpawns.clear()
      renderer.domElement.removeEventListener('click', onCanvasClick)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('keyup', onKeyup)
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock()
      try {
        renderer.xr.getSession()?.end()
      } catch {
        /* 会话已在结束时忽略 */
      }
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else if (mat) mat.dispose()
      })
      vrButton.remove()
      renderer.dispose()
    },
    restart() {
      resetGame()
    }
  }
}
