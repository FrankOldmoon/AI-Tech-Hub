/**
 * embodied 机器人家族的 3D 引擎。
 *
 * 从原独立应用 apps/embodied/index.html 移植：URDF 解析、场景图、关节、演示轨迹、
 * 拾取与相机这套命令式逻辑保持原样（three.js 场景图本来就该命令式写），
 * 只把「自己造 DOM + 全局 id 查询」换成「由调用方传入容器与按钮」，
 * 于是它能在 Nuxt 里按 tab 挂载/卸载。three 已改为 npm 依赖。
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { ARM_URDF, HUMANOID_URDF, QUADRUPED_URDF } from './urdf'

export interface EmbodiedCameraView { key: string, pos: number[], target?: number[], label: string }
export interface EmbodiedCamera {
  fov?: number
  min?: number
  max?: number
  maxPolar?: number
  target?: number[]
  floor?: number
  grid?: number
  views?: EmbodiedCameraView[]
}
export interface DemoApi { setJoint: (name: string, value: number) => void, root: THREE.Object3D }
export interface EmbodiedDemo {
  title: string
  runLabel: string
  pauseLabel: string
  toggleId?: string
  cycle?: number
  phaseLabel: string
  legend?: string[]
  presets: { p: number, label: string }[]
  move: (p: number, api: DemoApi) => void
  home: (api: DemoApi) => void
}
export interface EmbodiedRobot {
  key: string
  tab: string
  seed: string
  hasKnob?: boolean
  fog?: number
  ring?: boolean
  eyebrow: string
  title: string
  camSectionTitle?: string
  debugModes?: { value: string, label: string }[]
  debugDefault?: string
  debugBaseLight?: boolean
  instructionObserve: string
  instructionJoint?: string
  jointMicrocopy?: string
  defaultJoint: string
  defaultLabel?: string
  labels: Record<string, string>
  camera: EmbodiedCamera
  root: { link: string, y?: number, rotX?: number, debugLink?: string, mount: (links: Map<string, THREE.Object3D>) => THREE.Object3D }
  demo: EmbodiedDemo
  urdf?: () => string
  urdfEl?: string
  anatomy?: string[]
}
export interface JointDef {
  name: string
  parentName: string
  childName: string
  axis: THREE.Vector3
  lower: number
  upper: number
  value: number
  pivot: THREE.Object3D
  marker: THREE.Mesh
  axisName: string
  label?: string
}
export interface EngineOptions {
  /** Reset All / Save View 两个按钮由页面提供，引擎只挂事件 */
  reset: HTMLElement
  capture: HTMLElement
  /** 完成一次交互任务时的回调（进度统计归宿主） */
  onTask?: (task: string) => void
}

const URDF_BY_KEY: Record<string, string> = {
  'arm-urdf': ARM_URDF,
  'quadruped-urdf': QUADRUPED_URDF,
  'humanoid-urdf': HUMANOID_URDF
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const mod = (v: number) => ((v % 1) + 1) % 1
const rad = Math.PI / 180
const deg = (v: number) => v / rad
const fmt = (v: number) => (Math.abs(v) < 1e-8 ? '0' : v.toFixed(1)) + '\u00B0'
const parseNums = (s: string | null | undefined, def: number[]): number[] => (s || def.join(' ')).trim().split(/\s+/).map(Number)
const smooth = (f: number) => {
  const t = Math.min(Math.max(f, 0), 1)
  return t * t * (3 - 2 * t)
}

function parseXml(s: string) {
  const x = new DOMParser().parseFromString(s, 'application/xml')
  if (x.querySelector('parsererror')) throw new Error('URDF XML failed to parse')
  return x
}

/* =========================================================
   Robot instantiator
   ========================================================= */
export function initRobot(container: HTMLElement, cfg: EmbodiedRobot, opts: EngineOptions): () => void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => container.querySelector('#' + id) as T
  const ui = { canvas: $<HTMLCanvasElement>('robotCanvas'), stage: $('stage'), error: $('errorBanner'),
    observeMode: $<HTMLButtonElement>('observeModeBtn'), jointMode: $<HTMLButtonElement>('jointModeBtn'), instructionTitle: $('instructionTitle'), instructionText: $('instructionText'),
    jointSelect: $<HTMLSelectElement>('jointSelect'), jointSlider: $<HTMLInputElement>('jointSlider'), jointValue: $('jointValue'), jointMin: $('jointMin'), jointMax: $('jointMax'),
    selectedName: $('selectedName'), selectedValue: $('selectedValue'), jointAxisInfo: $('jointAxisInfo'),
    runToggle: $<HTMLButtonElement>('runToggle'), walkToggle: $<HTMLButtonElement>('walkToggle'),
    speed: $<HTMLSelectElement>('speedSelect'), phase: $<HTMLInputElement>('phaseSlider'), phaseText: $('phaseText'),
    debugSelect: $<HTMLSelectElement>('debugSelect'), qualitySelect: $<HTMLSelectElement>('qualitySelect'),
    reset: opts.reset, capture: opts.capture,
    fps: $('fpsMetric'), frame: $('frameMetric'), calls: $('callsMetric'), triangles: $('triMetric') }
  const runBtn = ui.walkToggle || ui.runToggle
  const fail = (msg: string) => {
    ui.error.style.display = 'block'
    ui.error.textContent = '3D scene error: ' + msg
  }
  window.addEventListener('error', e => fail(e.error || e.message))
  window.addEventListener('unhandledrejection', e => fail(e.reason))

  const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(1.5)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.06

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x071019)
  scene.fog = new THREE.FogExp2(0x071019, cfg.fog || 0.05)

  const camCfg = cfg.camera
  const camera = new THREE.PerspectiveCamera(camCfg.fov || 44, 1, 0.02, 40)
  const controls = new OrbitControls(camera, ui.canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.075
  controls.minDistance = camCfg.min || 0.8
  controls.maxDistance = camCfg.max || 7
  controls.maxPolarAngle = Math.PI * (camCfg.maxPolar || 0.72)
  controls.target.fromArray(camCfg.target || [0, 0.5, 0])
  const VIEWS: Record<string, { pos: THREE.Vector3, target: THREE.Vector3 }> = {}
  for (const v of (camCfg.views || []))VIEWS[v.key] = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...(v.target || camCfg.target || [0, 0.5, 0])) }
  camera.position.copy(VIEWS.hero!.pos)

  /* ---- Task: orbit the model ---- */
  let orbitAccum = 0, lastAz: number | null = null, orbiting = false
  controls.addEventListener('change', () => {
    const off = camera.position.clone().sub(controls.target)
    const az = Math.atan2(off.x, off.z)
    if (orbiting && lastAz !== null) {
      let d = az - lastAz
      d = Math.atan2(Math.sin(d), Math.cos(d))
      orbitAccum += Math.abs(d)
      if (orbitAccum > 0.6)opts.onTask?.('orbit')
    }
    lastAz = az
  })
  ui.canvas.addEventListener('pointerdown', () => {
    orbiting = true
  })
  ui.canvas.addEventListener('pointerup', () => {
    orbiting = false
  })
  ui.canvas.addEventListener('pointercancel', () => {
    orbiting = false
  })

  const hemi = new THREE.HemisphereLight(0xcfffff, 0x18181c, 1.55)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff2dd, 3.4)
  sun.position.set(-2.2, 4.4, -3.0)
  sun.castShadow = true
  sun.shadow.mapSize.set(1536, 1536)
  sun.shadow.camera.left = -2.4
  sun.shadow.camera.right = 2.4
  sun.shadow.camera.top = 2.4
  sun.shadow.camera.bottom = -1.2
  sun.shadow.bias = -3e-4
  scene.add(sun)
  const keyLight = new THREE.PointLight(0x20d4cf, 7, 5, 1.3)
  keyLight.position.set(1.8, 1.8, 2.0)
  scene.add(keyLight)
  const warm = new THREE.PointLight(0xff9d2e, 4, 5, 1.5)
  warm.position.set(-1.8, 1.0, -1.4)
  scene.add(warm)
  const floorSize = camCfg.floor || 1.9
  const floor = new THREE.Mesh(new THREE.CircleGeometry(floorSize, 96), new THREE.MeshStandardMaterial({ color: 0x12222b, metalness: 0.45, roughness: 0.5 }))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)
  const grid = new THREE.GridHelper(camCfg.grid || 3.4, 28, 0x20d4cf, 0x1c3850)
  grid.material.opacity = 0.25
  grid.material.transparent = true
  grid.position.y = 0.004
  scene.add(grid)
  if (cfg.ring !== false) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(floorSize, 0.006, 8, 128), new THREE.MeshBasicMaterial({
      color: 0x20d4cf, transparent: true, opacity: 0.4
    }))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.006
    scene.add(ring)
  }

  const xml = parseXml(URDF_BY_KEY[cfg.urdfEl ?? ''] ?? cfg.urdf!())

  const materialRGB = new Map<string, number[]>()
  for (const m of xml.querySelectorAll('robot > material'))materialRGB.set(m.getAttribute('name')!, (m.querySelector('color')?.getAttribute('rgba') || '0.6 0.6 0.6 1').split(/\s+/).map(Number))
  const materialByName = new Map<string, THREE.MeshStandardMaterial>()
  function getMaterial(name: string | null | undefined, fallbackRGB?: number[] | null): THREE.MeshStandardMaterial {
    const key = name || ('inline-' + (fallbackRGB && fallbackRGB.join('-')))
    if (materialByName.has(key)) return materialByName.get(key)!
    const rgba = fallbackRGB || (name ? materialRGB.get(name) : undefined) || [0.55, 0.62, 0.66, 1]
    const accent = name === 'cyan' || name === 'amber'
    const rough = (name === 'carbon' || name === 'shell' || name === 'armor') ? 0.42 : 0.5
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(rgba[0]!, rgba[1]!, rgba[2]!), roughness: rough, metalness: accent ? 0.15 : 0.65, transparent: rgba[3]! < 1, opacity: rgba[3]!, emissive: accent ? new THREE.Color(rgba[0]!, rgba[1]!, rgba[2]!) : new THREE.Color(0), emissiveIntensity: accent ? 1.6 : 0 })
    mat.userData = {
      role: name, baseEmissiveIntensity: mat.emissiveIntensity
    }
    materialByName.set(key, mat)
    return mat
  }
  function buildGeometry(g: Element): THREE.BufferGeometry {
    const box = g.querySelector('box')
    if (box) {
      const s = parseNums(box.getAttribute('size'), [0.1, 0.1, 0.1])
      return new RoundedBoxGeometry(s[0]!, s[1]!, s[2]!, 3, Math.min(...s) * 0.13)
    }
    const cyl = g.querySelector('cylinder')
    if (cyl) {
      const gz = new THREE.CylinderGeometry(Number(cyl.getAttribute('radius')), Number(cyl.getAttribute('radius')), Number(cyl.getAttribute('length')), 28, 2)
      gz.rotateX(-Math.PI / 2)
      return gz
    }
    const sph = g.querySelector('sphere')
    if (sph) return new THREE.SphereGeometry(Number(sph.getAttribute('radius')), 28, 18)
    throw new Error('Unsupported URDF geometry type')
  }

  const linkNodes = new Map<string, THREE.Object3D>(), hitMeshes: THREE.Mesh[] = [], wireMeshes: THREE.LineSegments[] = []
  for (const linkEl of xml.querySelectorAll('link')) {
    const name = linkEl.getAttribute('name')!
    const node = new THREE.Object3D()
    node.name = name
    node.userData.linkName = name
    linkNodes.set(name, node)
    for (const visual of linkEl.querySelectorAll(':scope > visual')) {
      const o = visual.querySelector(':scope > origin')
      const xyz = parseNums(o?.getAttribute('xyz'), [0, 0, 0])
      const rpy = parseNums(o?.getAttribute('rpy'), [0, 0, 0])
      const geomEl = visual.querySelector(':scope > geometry')
      if (!geomEl) continue
      const geometry = buildGeometry(geomEl)
      const mEl = visual.querySelector(':scope > material')
      const inline = mEl?.querySelector('color') ? parseNums(mEl.querySelector('color')!.getAttribute('rgba'), [0.6, 0.6, 0.6, 1]) : null
      const mat = getMaterial(mEl?.getAttribute('name'), inline)
      const mesh = new THREE.Mesh(geometry, mat)
      mesh.name = visual.getAttribute('name') || (name + '_visual')
      mesh.position.fromArray(xyz)
      mesh.rotation.set(rpy[0]!, rpy[1]!, rpy[2]!, 'XYZ')
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.linkName = name
      mesh.userData.baseMaterial = mat
      node.add(mesh)
      hitMeshes.push(mesh)
      if (geomEl.querySelector('box') || geomEl.querySelector('cylinder')) {
        const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 24), new THREE.LineBasicMaterial({ color: 0x4b6d77, transparent: true, opacity: 0.3, depthWrite: false }))
        wire.position.copy(mesh.position)
        wire.rotation.copy(mesh.rotation)
        wire.userData.linkName = name
        node.add(wire)
        wireMeshes.push(wire)
      }
    }
  }

  const joints = new Map<string, JointDef>(), childToJoint = new Map<string, string>()
  const pivotMat = new THREE.MeshBasicMaterial({ color: 0x20d4cf, transparent: true, opacity: 0.75, depthTest: false })
  const selMat = new THREE.MeshBasicMaterial({ color: 0xff9d2e, transparent: true, opacity: 1, depthTest: false })
  for (const jEl of xml.querySelectorAll('joint')) {
    const name = jEl.getAttribute('name')!
    const parentName = jEl.querySelector('parent')!.getAttribute('link')!
    const childName = jEl.querySelector('child')!.getAttribute('link')!
    const origin = jEl.querySelector('origin')
    const xyz = parseNums(origin?.getAttribute('xyz'), [0, 0, 0])
    const axis = new THREE.Vector3(...parseNums(jEl.querySelector('axis')?.getAttribute('xyz'), [1, 0, 0])).normalize()
    const limit = jEl.querySelector('limit')
    const lower = Number(limit?.getAttribute('lower') || -Math.PI)
    const upper = Number(limit?.getAttribute('upper') || Math.PI)
    const pivot = new THREE.Object3D()
    pivot.name = name
    pivot.position.fromArray(xyz)
    const marker = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 8, 32), pivotMat)
    if (Math.abs(axis.x) > 0.5)marker.rotation.y = Math.PI / 2
    else if (Math.abs(axis.y) > 0.5)marker.rotation.x = Math.PI / 2
    marker.renderOrder = 20
    marker.visible = false
    pivot.add(marker)
    const parent = linkNodes.get(parentName)!, child = linkNodes.get(childName)!
    if (!parent || !child) throw new Error('Joint hierarchy missing link: ' + name)
    parent.add(pivot)
    pivot.add(child)
    const axisName = axis.x > 0.5 ? 'X' : axis.y > 0.5 ? 'Y' : 'Z'
    joints.set(name, { name, parentName, childName, axis, lower, upper, value: 0, pivot, marker, axisName })
    childToJoint.set(childName, name)
  }

  const root = cfg.root.mount(linkNodes)
  scene.add(root)
  const debugBox = new THREE.BoxHelper(linkNodes.get(cfg.root.debugLink || cfg.root.link)!, 0xff9d2e)
  debugBox.material.transparent = true
  debugBox.material.opacity = 0.5
  debugBox.material.depthTest = false
  debugBox.renderOrder = 30
  scene.add(debugBox)

  const knob = new THREE.Group()
  knob.renderOrder = 40
  scene.add(knob)
  const knobHits: THREE.Mesh[] = []
  if (cfg.hasKnob !== false) {
    const knobBase = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.007, 10, 40), new THREE.MeshBasicMaterial({ color: 0xff9d2e, transparent: true, opacity: 0.85, depthTest: false, fog: false }))
    knobBase.rotation.x = Math.PI / 2
    knob.add(knobBase)
    const knobBall = new THREE.Mesh(new THREE.SphereGeometry(0.055, 32, 24), new THREE.MeshStandardMaterial({ color: 0xff9d2e, emissive: 0xff9d2e, emissiveIntensity: 0.85, roughness: 0.32, metalness: 0.25 }))
    knobBall.position.set(0, 0.11, 0)
    knob.add(knobBall)
    const knobHit = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false }))
    knobHit.userData.knob = true
    knob.add(knobHit)
    knobHits.push(knobHit)
  }
  function updateKnob() {
    const j = joints.get(selected)
    if (cfg.hasKnob === false || !j) {
      knob.visible = false
      return
    }
    knob.visible = true
    j.pivot.getWorldPosition(knob.position)
    knob.quaternion.identity()
  }

  let disposed = false, rafId = 0
  let selected = cfg.defaultJoint, mode = 'observe', _rangeKey = '', _lastDisp = -1e9
  let transition: { pos: THREE.Vector3, target: THREE.Vector3 } | null = null
  const ctx: DemoApi = {
    setJoint: (n: string, v: number) => {
      const j = joints.get(n)
      if (!j) return
      j.value = clamp(Number(v) || 0, j.lower, j.upper)
      j.pivot.quaternion.setFromAxisAngle(j.axis, j.value).normalize()
    }, root
  }
  function setJoint(name: string, v: number, reflectUI = true) {
    ctx.setJoint(name, v)
    if (reflectUI && selected === name)refreshUI()
  }
  function setRange() {
    _lastDisp = -1e9
    const j = joints.get(selected)
    if (!j) return
    const lo = deg(j.lower), hi = deg(j.upper)
    ui.jointSelect.value = selected
    ui.jointSlider.min = lo.toFixed(0)
    ui.jointSlider.max = hi.toFixed(0)
    ui.jointMin.textContent = fmt(lo)
    ui.jointMax.textContent = fmt(hi)
    ui.jointAxisInfo.textContent = j.parentName + ' -> ' + j.childName + '  |  axis ' + j.axisName + '  |  ' + (j.lower / Math.PI).toFixed(2) + '..' + (j.upper / Math.PI).toFixed(2) + ' rad'
  }
  function refreshUI() {
    const j = joints.get(selected)
    if (!j) return
    if (_rangeKey !== selected) {
      _rangeKey = selected
      setRange()
    }
    const v = deg(j.value), hi = deg(j.upper)
    const disp = Math.round(v)
    if (String(ui.jointSlider.value) !== String(disp))ui.jointSlider.value = String(disp)
    if (Math.abs(v - _lastDisp) > 0.01) {
      _lastDisp = v
      ui.jointValue.textContent = fmt(v)
      ui.selectedName.textContent = j.label || j.name
      ui.selectedValue.textContent = fmt(v) + ' / ' + fmt(deg(j.lower)) + '\u2026' + fmt(hi)
      for (const def of joints.values())def.marker.material = def.name === selected ? selMat : pivotMat
    }
    debugBox.setFromObject(linkNodes.get(j.childName)!)
  }
  for (const j of joints.values())j.label = cfg.labels[j.name] || j.name
  for (const j of joints.values()) {
    const opt = document.createElement('option')
    opt.value = j.name
    opt.textContent = j.label ?? j.name
    ui.jointSelect.append(opt)
  }

  const anim = { elapsed: 0, playing: false, speed: 1 }
  const CYCLE = cfg.demo.cycle || 5
  function stopRun() {
    anim.playing = false
    runBtn.classList.remove('playing')
    runBtn.textContent = cfg.demo.runLabel
  }

  function setMode(m: string) {
    mode = m
    ui.observeMode.classList.toggle('active', mode === 'observe')
    ui.jointMode.classList.toggle('active', mode === 'joint')
    ui.instructionTitle.textContent = mode === 'observe' ? 'Observe Mode' : 'Drag Joints Mode'
    ui.instructionText.textContent = mode === 'observe' ? cfg.instructionObserve : (cfg.instructionJoint || cfg.instructionObserve)
    ui.canvas.style.cursor = mode === 'joint' ? 'grab' : 'default'
  }
  function setCamera(view: string, instant?: boolean) {
    const v = VIEWS[view] ?? VIEWS.hero!
    transition = { pos: v.pos.clone(), target: v.target.clone() }
    if (instant) {
      camera.position.copy(transition.pos)
      controls.target.copy(transition.target)
      controls.update()
      transition = null
    }
    container.querySelectorAll<HTMLElement>('.camera-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view))
  }
  function setDebug(m: string) {
    const wire = m === 'topology', base = m === 'base', jm = m === 'joints'
    for (const mat of materialByName.values()) {
      mat.wireframe = wire
      mat.emissiveIntensity = (base || wire) ? 0 : mat.userData.baseEmissiveIntensity
    }
    for (const w of wireMeshes)w.visible = !wire
    for (const j of joints.values())j.marker.visible = jm
    debugBox.visible = !wire
    if (cfg.debugBaseLight) {
      keyLight.intensity = base ? 0 : 7
      warm.intensity = base ? 0 : 4
    }
    ui.debugSelect.value = m
  }
  function resetAll() {
    stopRun()
    anim.elapsed = 0
    cfg.demo.home({ setJoint: ctx.setJoint, root })
    root.position.x = 0
    root.position.z = 0
    selected = cfg.defaultJoint
    ui.phase.value = '0'
    ui.phaseText.textContent = '0%'
    setCamera('hero', true)
    setMode('observe')
    setDebug('final')
    refreshUI()
    updateKnob()
  }

  ui.observeMode.addEventListener('click', () => setMode('observe'))
  ui.jointMode.addEventListener('click', () => setMode('joint'))
  ui.jointSelect.addEventListener('change', () => {
    selected = ui.jointSelect.value
    refreshUI()
    updateKnob()
  })
  ui.jointSlider.addEventListener('input', () => {
    stopRun()
    opts.onTask?.('joint')
    setJoint(selected, Number(ui.jointSlider.value) * rad)
  })
  runBtn.addEventListener('click', () => {
    anim.playing = !anim.playing
    runBtn.classList.toggle('playing', anim.playing)
    runBtn.textContent = anim.playing ? cfg.demo.pauseLabel : cfg.demo.runLabel
    if (anim.playing) {
      setMode('observe')
      opts.onTask?.('demo')
    }
  })
  ui.speed.addEventListener('change', () => {
    anim.speed = Number(ui.speed.value)
  })
  ui.phase.addEventListener('input', () => {
    stopRun()
    opts.onTask?.('demo')
    move(Number(ui.phase.value) / 1000)
  })
  container.querySelectorAll<HTMLElement>('.phase-preset').forEach(b => b.addEventListener('click', () => {
    stopRun()
    opts.onTask?.('demo')
    move(Number(b.dataset.phase))
  }))
  container.querySelectorAll<HTMLElement>('.camera-btn').forEach(b => b.addEventListener('click', () => {
    setCamera(b.dataset.view!)
    opts.onTask?.('view')
  }))
  ui.debugSelect.addEventListener('change', () => {
    setDebug(ui.debugSelect.value)
    opts.onTask?.('view')
  })
  ui.qualitySelect.addEventListener('change', () => {
    renderer.setPixelRatio(Number(ui.qualitySelect.value))
    resize()
  })
  ui.reset.addEventListener('click', resetAll)
  ui.capture.addEventListener('click', () => {
    renderer.render(scene, camera)
    const a = document.createElement('a')
    a.download = cfg.key + '-' + Date.now() + '.png'
    a.href = ui.canvas.toDataURL('image/png')
    a.click()
  })

  function move(p: number) {
    cfg.demo.move(p, ctx)
    ui.phase.value = String(Math.round(mod(p) * 1000))
    ui.phaseText.textContent = Math.round(mod(p) * 100) + '%'
    refreshUI()
  }

  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2()
  function pick(ev: PointerEvent) {
    const r = ui.canvas.getBoundingClientRect()
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1
    raycaster.setFromCamera(ndc, camera)
    return raycaster.intersectObjects(hitMeshes, false)[0] || null
  }
  function pickKnob(ev: PointerEvent) {
    const r = ui.canvas.getBoundingClientRect()
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1
    raycaster.setFromCamera(ndc, camera)
    return raycaster.intersectObjects(knobHits, false).length > 0
  }
  let dragStart: { x: number, y: number, moved: boolean, hit: THREE.Intersection | null } | null = null
  let dragging: { knob?: boolean, jointName: string, startX: number, startY: number, startAngle: number } | null = null
  ui.canvas.addEventListener('pointerdown', (ev) => {
    dragStart = { x: ev.clientX, y: ev.clientY, moved: false, hit: null }
    if (cfg.hasKnob !== false && pickKnob(ev)) {
      stopRun()
      const jl = joints.get(selected)!
      dragging = { knob: true, jointName: selected, startX: ev.clientX, startY: ev.clientY, startAngle: jl.value }
      controls.enabled = false
      ui.canvas.setPointerCapture(ev.pointerId)
      ui.canvas.style.cursor = 'grabbing'
      ev.preventDefault()
      return
    }
    const hit = pick(ev)
    dragStart.hit = hit
    if (!hit) return
    const jointOf = childToJoint.get(hit.object.userData.linkName)
    if (jointOf && mode === 'observe') {
      selected = jointOf
      refreshUI()
      updateKnob()
    }
    if (mode === 'joint' && jointOf) {
      stopRun()
      const j = joints.get(jointOf)!
      dragging = { jointName: jointOf, startX: ev.clientX, startY: ev.clientY, startAngle: j.value }
      controls.enabled = false
      ui.canvas.setPointerCapture(ev.pointerId)
      ui.canvas.style.cursor = 'grabbing'
      ev.preventDefault()
    }
  })
  ui.canvas.addEventListener('pointermove', (ev) => {
    if (dragStart && Math.hypot(ev.clientX - dragStart.x, ev.clientY - dragStart.y) > 4)dragStart.moved = true
    if (!dragging) return
    const j = joints.get(dragging.jointName)!
    const span = j.upper - j.lower
    const v = (dragging.startY - ev.clientY + (ev.clientX - dragging.startX) * 0.28) / Math.max(ui.canvas.clientHeight, 320)
    const step = dragging.knob ? 1.3 : 1.35
    setJoint(dragging.jointName, dragging.startAngle + v * span * step)
    opts.onTask?.('joint')
    ev.preventDefault()
  })
  const endDrag = (ev: PointerEvent) => {
    if (dragging) {
      controls.enabled = true
      dragging = null
      ui.canvas.style.cursor = mode === 'joint' ? 'grab' : 'default'
      if (ui.canvas.hasPointerCapture(ev.pointerId))ui.canvas.releasePointerCapture(ev.pointerId)
    }
    dragStart = null
  }
  ui.canvas.addEventListener('pointerup', endDrag)
  ui.canvas.addEventListener('pointercancel', endDrag)

  function resize() {
    const w = Math.max(ui.stage.clientWidth, 1), h = Math.max(ui.stage.clientHeight, 1)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(ui.stage)
  resize()

  const timer = new THREE.Timer()
  let frames = 0, acc = 0, lastInfo = 0, fps = 0
  function loop() {
    if (disposed) return
    rafId = requestAnimationFrame(loop)
    timer.update()
    const dt = clamp(timer.getDelta(), 0, 0.05)
    if (anim.playing) {
      anim.elapsed += dt * anim.speed
      move((anim.elapsed / CYCLE) % 1)
    }
    if (transition) {
      const k = 1 - Math.exp(-6.5 * dt)
      camera.position.lerp(transition.pos, k)
      controls.target.lerp(transition.target, k)
      if (camera.position.distanceTo(transition.pos) < 0.002 && controls.target.distanceTo(transition.target) < 0.002) {
        camera.position.copy(transition.pos)
        controls.target.copy(transition.target)
        transition = null
      }
    }
    controls.update()
    updateKnob()
    renderer.render(scene, camera)
    frames += 1
    acc += dt
    if (acc >= 0.5) {
      fps = frames / acc
      const now = performance.now()
      if (now - lastInfo > 350) {
        ui.fps.textContent = fps.toFixed(0)
        ui.frame.textContent = (1000 / Math.max(fps, 1)).toFixed(1) + ' ms'
        ui.calls.textContent = String(renderer.info.render.calls)
        ui.triangles.textContent = renderer.info.render.triangles.toLocaleString()
        lastInfo = now
      }
      frames = 0
      acc = 0
    }
  }

  cfg.demo.home({ setJoint: ctx.setJoint, root })
  setMode('observe')
  setDebug(cfg.debugDefault || 'final')
  setCamera('hero', true)
  refreshUI()
  updateKnob()
  loop()

  /** 卸载：切 tab / 离开页面时必须调用，否则 RAF 与 WebGL 上下文会泄漏 */
  return function dispose() {
    disposed = true
    if (rafId)cancelAnimationFrame(rafId)
    ro.disconnect()
    controls.dispose()
    scene.traverse(function (o) {
      const mesh = o as THREE.Mesh
      if (mesh.geometry)mesh.geometry.dispose()
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat))mat.forEach(m => m.dispose())
      else if (mat)mat.dispose()
    })
    renderer.dispose()
  }
}

/* =========================================================
   ROBOT CONFIGS
   ========================================================= */
export const ROBOTS: EmbodiedRobot[] = []

/* ---------- 1. Drone (quadcopter) ---------- */
ROBOTS.push({
  key: 'drone', tab: 'Drone', seed: '9411', hasKnob: true, fog: 0.05, ring: true,
  eyebrow: 'ORION AIR \u00b7 QUADCOPTER \u00b7 3D INTERACTIVE',
  title: 'Quadcopter Drone \u2014 Flight &amp; Thrust Lab',
  instructionObserve: 'Orbit to inspect the 4 rotors and the gimbal camera. Click a rotor or link to select its joint, or grab the amber knob to adjust the selected joint.',
  instructionJoint: 'Press and drag a rotor hub or link to adjust its joint; use the amber knob or slider for precise control.',
  jointMicrocopy: 'Body <b>pitch / roll / yaw</b> tilt the whole aircraft. The 4 rotor joints spin the propellers (opposite directions on each diagonal to cancel torque). Grab the amber knob and drag, or use the slider.',
  defaultJoint: 'body_pitch_joint', defaultLabel: 'Body Pitch',
  labels: { body_pitch_joint: 'Body Pitch', body_roll_joint: 'Body Roll', body_yaw_joint: 'Body Yaw', gimbal_yaw_joint: 'Gimbal Yaw', gimbal_pitch_joint: 'Gimbal Pitch', R1_joint: 'Rotor 1 \u00b7 FR', R2_joint: 'Rotor 2 \u00b7 FL', R3_joint: 'Rotor 3 \u00b7 RR', R4_joint: 'Rotor 4 \u00b7 RL' },
  camera: { fov: 44, min: 0.8, max: 8, maxPolar: 0.72, target: [0, 1.2, 0], views: [{ key: 'hero', pos: [2.0, 1.9, -2.5], label: 'Three-Quarter' }, { key: 'front', pos: [0, 1.3, -3.0], label: 'Front' }, { key: 'side', pos: [3.1, 1.25, 0], label: 'Side' }, { key: 'top', pos: [0, 3.4, 0.2], label: 'Top' }] },
  root: {
    link: 'air_link', y: 1.18, debugLink: 'base_link', mount: (ln) => {
      const g = new THREE.Group()
      g.name = 'drone_root'
      g.add(ln.get('air_link')!)
      g.position.y = 1.18
      return g
    }
  },
  demo: { title: 'Flight Demo', toggleId: 'runToggle', runLabel: 'Run Flight', pauseLabel: 'Pause Flight', cycle: 5,
    phaseLabel: 'Drag to scrub one flight loop (throttle, tilt &amp; yaw)', legend: ['Hover Circle', 'Tilt &amp; Yaw'],
    presets: [{ p: 0, label: 'Hover' }, { p: 0.2, label: 'Forward' }, { p: 0.5, label: 'Turn' }, { p: 0.8, label: 'Side' }],
    move: (p, api) => {
      const a = Math.PI * 2 * p
      const ROT_DIR: Record<string, number> = { R1: 1, R2: -1, R3: -1, R4: 1 }
      api.root.position.x = 0.62 * Math.cos(a)
      api.root.position.z = 0.62 * Math.sin(a)
      api.root.position.y = 1.18 + 0.07 * Math.sin(a * 2 + 1.2)
      api.setJoint('body_pitch_joint', 0.30 * Math.cos(a))
      api.setJoint('body_roll_joint', 0.24 * Math.sin(a))
      api.setJoint('body_yaw_joint', a)
      for (const n of ['R1', 'R2', 'R3', 'R4']) api.setJoint(n + '_joint', 60 * mod(p) * ROT_DIR[n]!)
      api.setJoint('gimbal_pitch_joint', -0.12 * Math.sin(a))
    },
    home: (h) => {
      ['body_pitch_joint', 'body_roll_joint', 'body_yaw_joint', 'gimbal_pitch_joint', 'gimbal_yaw_joint', 'R1_joint', 'R2_joint', 'R3_joint', 'R4_joint'].forEach(n => h.setJoint(n, 0))
      h.root.position.set(0, 1.18, 0)
    }
  },
  anatomy: ['A <b>quadcopter</b> (four-rotor) is controlled by <b>differential thrust</b>. It has no servos for attitude \u2014 every maneuver is the net of the four propellers pushing against the air.',
    'Diagonally-opposite rotors spin in <b>opposite</b> directions to cancel reaction torque. To <b>yaw</b>, the two spinning one way speed up while the other two slow down. To <b>pitch</b> forward, the rear rotors spin faster than the front.',
    'Watch the amber rotor hubs and cyan blades: front-back speed difference pitches the nose down, left-right difference rolls it sideways.'],
  urdf() {
    const boom = (yaw: number, mx: number, mz: number) => `<visual><origin xyz="${mx.toFixed(2)} 0 ${mz.toFixed(2)}" rpy="0 ${yaw.toFixed(3)} 0"/><geometry><box size="0.80 0.05 0.07"/></geometry><material name="grid"/></visual>`
    const rotor = (name: string, sx: number, sz: number, _dir: number) => {
      const ex = (sx * 0.56).toFixed(2), ez = (sz * 0.56).toFixed(2), bx = (sz * 0.20).toFixed(2), bz = (sx * 0.20).toFixed(2)
      return `<link name="${name}_rotor">
        <visual><origin xyz="0 0.02 0"/><geometry><box size="0.11 0.05 0.11"/></geometry><material name="amber"/></visual>
        <visual><origin xyz="${bx} 0.10 ${bz}"/><geometry><box size="0.40 0.015 0.05"/></geometry><material name="cyan"/></visual>
        <visual><origin xyz="${(-bx).toFixed(2)} 0.10 ${(-bz).toFixed(2)}"/><geometry><box size="0.40 0.015 0.05"/></geometry><material name="cyan"/></visual>
      </link>
      <joint name="${name}_joint" type="revolute"><parent link="base_link"/><child link="${name}_rotor"/><origin xyz="${ex} 0.02 ${ez}"/><axis xyz="0 1 0"/><limit lower="-130" upper="130"/></joint>`
    }
    return `<robot name="orion_quad">
      <material name="carbon"><color rgba="0.15 0.17 0.19 1"/></material><material name="grid"><color rgba="0.52 0.58 0.60 1"/></material><material name="tread"><color rgba="0.06 0.08 0.09 1"/></material><material name="cyan"><color rgba="0.0 0.85 0.95 1"/></material><material name="amber"><color rgba="1.0 0.55 0.15 1"/></material>
      <link name="air_link"><visual><origin xyz="0 0 0"/><geometry><box size="0.02 0.02 0.02"/></geometry><material name="tread"/></visual></link>
      <joint name="body_pitch_joint" type="revolute"><parent link="air_link"/><child link="pitch_link"/><origin xyz="0 0 0"/><axis xyz="1 0 0"/><limit lower="-0.6" upper="0.6"/></joint>
      <link name="pitch_link"><visual><origin xyz="0 0 0"/><geometry><box size="0.02 0.02 0.02"/></geometry><material name="tread"/></visual></link>
      <joint name="body_roll_joint" type="revolute"><parent link="pitch_link"/><child link="roll_link"/><origin xyz="0 0 0"/><axis xyz="0 0 1"/><limit lower="-0.6" upper="0.6"/></joint>
      <link name="roll_link"><visual><origin xyz="0 0 0"/><geometry><box size="0.02 0.02 0.02"/></geometry><material name="tread"/></visual></link>
      <joint name="body_yaw_joint" type="revolute"><parent link="roll_link"/><child link="base_link"/><origin xyz="0 0 0"/><axis xyz="0 1 0"/><limit lower="-6.3" upper="6.3"/></joint>
      <link name="base_link">
        <visual><origin xyz="0 0.03 0"/><geometry><box size="0.30 0.10 0.30"/></geometry><material name="carbon"/></visual>
        <visual><origin xyz="0 0.02 0"/><geometry><box size="0.16 0.02 0.16"/></geometry><material name="tread"/></visual>
        ${boom(-Math.PI * 0.25, 0.28, 0.28)}${boom(Math.PI * 0.25, -0.28, 0.28)}${boom(Math.PI * 0.25, 0.28, -0.28)}${boom(-Math.PI * 0.25, -0.28, -0.28)}
        <visual><origin xyz="0 -0.09 0.10"/><geometry><box size="0.20 0.14 0.05"/></geometry><material name="grid"/></visual>
        <visual><origin xyz="0 -0.09 -0.10"/><geometry><box size="0.20 0.14 0.05"/></geometry><material name="grid"/></visual>
      </link>
      ${rotor('R1', 1, 1, 1)}${rotor('R2', -1, 1, -1)}${rotor('R3', 1, -1, -1)}${rotor('R4', -1, -1, 1)}
      <link name="gimbal_link"><visual><origin xyz="0 0 0"/><geometry><box size="0.05 0.04 0.05"/></geometry><material name="tread"/></visual></link>
      <joint name="gimbal_yaw_joint" type="revolute"><parent link="base_link"/><child link="gimbal_link"/><origin xyz="0 0.02 0.17"/><axis xyz="0 1 0"/><limit lower="-1.6" upper="1.6"/></joint>
      <link name="camera_link"><visual><origin xyz="0 0 -0.07"/><geometry><box size="0.05 0.05 0.13"/></geometry><material name="grid"/></visual><visual><origin xyz="0 0 -0.13"/><geometry><sphere radius="0.028"/></geometry><material name="cyan"/></visual></link>
      <joint name="gimbal_pitch_joint" type="revolute"><parent link="gimbal_link"/><child link="camera_link"/><origin xyz="0 0 0"/><axis xyz="1 0 0"/><limit lower="-0.9" upper="0.9"/></joint>
    </robot>`
  }
})

/* ---------- 2. Hexapod spider ---------- */
const LEGS: [string, number, number][] = [['LF', 1, 0.34], ['LM', 1, 0.00], ['LB', 1, -0.34], ['RF', -1, 0.34], ['RM', -1, 0.00], ['RB', -1, -0.34]]
ROBOTS.push({
  key: 'hexapod', tab: 'Hexapod', seed: '56', hasKnob: true, fog: 0.05, ring: false,
  eyebrow: 'ORION ARACHNID \u00b7 HEXAPOD \u00b7 3D INTERACTIVE',
  title: 'Hexapod Spider \u2014 Joint &amp; Gait Lab',
  instructionObserve: 'Orbit to inspect the six legs and the segmented body. Click a leg to select its joints, or grab the amber knob to rotate the selected joint.',
  instructionJoint: 'Press and drag any leg segment vertically to bend its joint; use the amber knob or slider for precise control.',
  jointMicrocopy: 'Each leg has a <b>hip</b>, a <b>femur</b> and a <b>tibia</b> joint that lift and curl it. Grab the amber knob on the model and drag up/down to rotate the selected joint, or use this slider.',
  defaultJoint: 'LF_hip_joint', defaultLabel: 'LF Hip',
  labels: (() => {
    const L: Record<string, string> = {
    }
    for (const p of LEGS.map(l => l[0])) {
      L[p + '_hip_joint'] = p + ' Hip'
      L[p + '_femur_joint'] = p + ' Femur'
      L[p + '_tibia_joint'] = p + ' Tibia'
    }
    return L
  })(),
  camera: { fov: 44, min: 0.9, max: 7, maxPolar: 0.7, target: [0, 0.5, 0], views: [{ key: 'hero', pos: [2.2, 1.4, -2.6], label: 'Three-Quarter' }, { key: 'front', pos: [0, 0.7, -2.9], label: 'Front' }, { key: 'side', pos: [3.0, 0.7, 0], label: 'Side' }, { key: 'top', pos: [0, 3.2, 0.2], label: 'Top' }] },
  root: {
    link: 'base_link', y: 0.55, debugLink: 'base_link', mount: (ln) => {
      const r = ln.get('base_link')!
      r.position.y = 0.55
      r.name = 'hexapod_root'
      return r
    }
  },
  demo: { title: 'Gait Demo', toggleId: 'runToggle', runLabel: 'Run Demo', pauseLabel: 'Pause Demo', cycle: 4.5,
    phaseLabel: 'Drag to scrub a tripod walking gait phase', legend: ['Stance &amp; Support', 'Leg Swing'],
    presets: [{ p: 0, label: 'Stand' }, { p: 0.16, label: 'Tripod A' }, { p: 0.44, label: 'Tripod B' }, { p: 0.5, label: 'Twist' }],
    move: (p, api) => {
      const LG: Record<string, number> = { LF: 0, RM: 2, LB: 4, RF: 1, LM: 3, RB: 5 }, N = ['LF', 'LM', 'LB', 'RF', 'RM', 'RB']
      const HA: Record<string, number> = { LF: 0.55, LM: 0.45, LB: 0.50, RF: 0.55, RM: 0.45, RB: 0.50 }, BF = 0.85, LIFT = 0.62, BT = 0.92
      const phi = Math.PI * 2 * p
      for (const pn of N) {
        const ph = phi + LG[pn]! * (Math.PI / 3)
        const hip = HA[pn]! * Math.cos(ph)
        const lift = 0.5 - 0.5 * Math.cos(ph)
        api.setJoint(pn + '_hip_joint', hip)
        api.setJoint(pn + '_femur_joint', BF + LIFT * lift)
        api.setJoint(pn + '_tibia_joint', BT - 0.25 * lift)
      }
    },
    home: (h) => {
      LEGS.forEach((l) => {
        h.setJoint(l[0] + '_hip_joint', 0)
        h.setJoint(l[0] + '_femur_joint', 0.85)
        h.setJoint(l[0] + '_tibia_joint', 0.92)
      })
    }
  },
  anatomy: ['A <b>hexapod</b> never tips over: at any moment at least two legs on each side are on the ground, forming a wide support triangle.',
    'The <b>tripod gait</b> splits the legs into two groups of three <span style="color:var(--cyan)">(LF \u00b7 RM \u00b7 LB)</span> and <span style="color:var(--amber)">(RF \u00b7 LM \u00b7 RB)</span>; one tripod lifts and swings while the other three support.',
    'Each leg is a 3-DOF chain: <b>hip</b> steps, <b>femur</b> and <b>tibia</b> lift and curl. Run the demo and scrub the phase slider to watch each tripod.'],
  urdf() {
    const leg = (pn: string, side: number, zPos: number) => {
      const s = side, A = `${(s * 0.50).toFixed(2)} -0.20 ${zPos}`
      return `<link name="${pn}_coxa"><visual><origin xyz="${(s * 0.06).toFixed(2)} -0.05 0"/><geometry><box size="0.05 0.10 0.16"/></geometry><material name="carbon"/></visual></link>
      <joint name="${pn}_hip_joint" type="revolute"><parent link="base_link"/><child link="${pn}_coxa"/><origin xyz="${A}"/><axis xyz="1 0 0"/><limit lower="-0.85" upper="0.85"/></joint>
      <link name="${pn}_femur"><visual><origin xyz="0 -0.065 0"/><geometry><box size="0.06 0.13 0.10"/></geometry><material name="grid"/></visual></link>
      <joint name="${pn}_femur_joint" type="revolute"><parent link="${pn}_coxa"/><child link="${pn}_femur"/><origin xyz="0 -0.10 0"/><axis xyz="1 0 0"/><limit lower="-0.15" upper="1.45"/></joint>
      <link name="${pn}_tibia"><visual><origin xyz="0 -0.07 0"/><geometry><box size="0.045 0.14 0.05"/></geometry><material name="cyan"/></visual><visual><origin xyz="0 -0.145 0"/><geometry><box size="0.05 0.02 0.06"/></geometry><material name="tread"/></visual></link>
      <joint name="${pn}_tibia_joint" type="revolute"><parent link="${pn}_femur"/><child link="${pn}_tibia"/><origin xyz="0 -0.13 0"/><axis xyz="1 0 0"/><limit lower="-0.2" upper="1.6"/></joint>`
    }
    return `<robot name="orion_hexapod">
      <material name="carbon"><color rgba="0.15 0.17 0.19 1"/></material><material name="grid"><color rgba="0.52 0.58 0.60 1"/></material><material name="tread"><color rgba="0.06 0.08 0.09 1"/></material><material name="cyan"><color rgba="0.0 0.85 0.95 1"/></material><material name="amber"><color rgba="1.0 0.55 0.15 1"/></material>
      <link name="base_link">
        <visual><origin xyz="0 0 0"/><geometry><box size="1.06 0.30 0.42"/></geometry><material name="carbon"/></visual>
        <visual><origin xyz="0 -0.02 -0.20"/><geometry><box size="0.80 0.22 0.18"/></geometry><material name="grid"/></visual>
        <visual><origin xyz="0 0.02 0.28"/><geometry><box size="0.62 0.24 0.22"/></geometry><material name="grid"/></visual>
        <visual><origin xyz="0 0.06 0.44"/><geometry><box size="0.44 0.18 0.12"/></geometry><material name="carbon"/></visual>
        <visual><origin xyz="0.10 0.08 0.52"/><geometry><sphere radius="0.045"/></geometry><material name="amber"/></visual>
        <visual><origin xyz="-0.10 0.08 0.52"/><geometry><sphere radius="0.045"/></geometry><material name="amber"/></visual>
        <visual><origin xyz="0 0.05 -0.50"/><geometry><box size="0.34 0.16 0.10"/></geometry><material name="carbon"/></visual>
        <visual><origin xyz="0.02 -0.12 0.18"/><geometry><box size="0.72 0.03 0.30"/></geometry><material name="tread"/></visual>
      </link>
      ${LEGS.map(l => leg(l[0], l[1], l[2])).join('')}
    </robot>`
  }
})

/* ---------- 3. 6-axis arm ---------- */
ROBOTS.push({
  key: 'arm', tab: '6-Axis Arm', seed: '1729', hasKnob: true, fog: 0.035, ring: false,
  eyebrow: 'ORION FOUNDRY \u00b7 6-AXIS ARM \u00b7 3D INTERACTIVE',
  title: '6-Axis Robotic Arm \u2014 Joint &amp; Kinematics Lab',
  instructionObserve: 'Orbit to inspect the base, shoulder, elbow and wrist. Click a link to see which joint drives it, or grab the amber knob to rotate the selected joint.',
  instructionJoint: 'Press and drag any link vertically to bend its joint; use the amber knob or slider for precise control.',
  jointMicrocopy: 'Grab the glowing amber knob at the selected joint (on the arm) and drag up/down to rotate it; or use this slider for precise control. Angles are limited by URDF mechanical stops.',
  defaultJoint: 'shoulder_pitch_joint', defaultLabel: 'Shoulder Pitch',
  labels: { base_yaw_joint: 'Base Yaw  J1', shoulder_pitch_joint: 'Shoulder Pitch  J2', elbow_pitch_joint: 'Elbow Pitch  J3', wrist_pitch_joint: 'Wrist Pitch  J4', wrist_roll_joint: 'Wrist Roll  J5', tool_roll_joint: 'Tool Roll  J6' },
  camera: { fov: 44, min: 0.8, max: 6, maxPolar: 0.72, target: [0, 0.5, 0], floor: 1.7, grid: 3.0, views: [{ key: 'hero', pos: [1.9, 1.1, -2.4], label: 'Three-Quarter' }, { key: 'front', pos: [0, 0.8, -2.9], label: 'Front' }, { key: 'side', pos: [2.9, 0.85, 0], label: 'Side' }, { key: 'top', pos: [0, 3.0, 0.3], label: 'Top' }] },
  root: {
    link: 'base_link', y: 0, debugLink: 'base_link', mount: (ln) => {
      const r = new THREE.Object3D()
      r.name = 'arm_root'
      r.add(ln.get('base_link')!)
      return r
    }
  },
  demo: { title: 'Teaching Motion', toggleId: 'runToggle', runLabel: 'Run Demo', pauseLabel: 'Pause Demo', cycle: 4.5,
    phaseLabel: 'Drag to scrub through a joint-space trajectory', legend: ['Demo Cycle 100%', ''],
    presets: [{ p: 0, label: 'Home' }, { p: 0.25, label: 'Reach' }, { p: 0.5, label: 'Lower' }, { p: 0.75, label: 'Sweep' }],
    move: (p, api) => {
      const DEMO = [[0.0, 0.50, -0.70, 0.10, 0.0, 0.0], [1.1, 0.20, -1.30, 0.40, 0.9, 1.2], [0.6, 0.05, -1.60, 0.50, -0.8, -1.3], [0.0, 0.35, -1.00, -0.30, 0.4, 0.6], [0.0, 0.50, -0.70, 0.10, 0.0, 0.0]]
      const AX = ['base_yaw_joint', 'shoulder_pitch_joint', 'elbow_pitch_joint', 'wrist_pitch_joint', 'wrist_roll_joint', 'tool_roll_joint']
      const t = mod(p) * 4
      const i = Math.floor(t), f = smooth(t - i)
      const a = DEMO[i]!, b = DEMO[i + 1]!
      for (let k = 0; k < 6; k++)api.setJoint(AX[k]!, a[k]! + (b[k]! - a[k]!) * f)
    },
    home: (h) => {
      const v = [0.0, 0.50, -0.70, 0.10, 0.0, 0.0]
      const AX = ['base_yaw_joint', 'shoulder_pitch_joint', 'elbow_pitch_joint', 'wrist_pitch_joint', 'wrist_roll_joint', 'tool_roll_joint']
      AX.forEach((n, k) => h.setJoint(n, v[k]!))
    }
  },
  urdfEl: 'arm-urdf',
  anatomy: ['This is a classic <b>6-axis articulated arm</b> with a <b>spherical wrist</b> common on industrial robots. A 6-DOF chain can place the tool at any position <i>and</i> orientation \u2014 3 joints position, the last 3 orient.',
    '<b>J1 base yaw</b> spins the arm, <b>J2 shoulder</b> and <b>J3 elbow</b> position the wrist in a vertical plane, <b>J4 wrist pitch</b>, <b>J5 wrist roll</b> and <b>J6 tool roll</b> orient the end-effector (cyan ball = TCP).',
    'Grab the amber knob to rotate a joint; pick \u201cRun Demo\u201d to watch a pick-and-place trajectory; scrub the phase slider to inspect each pose in slow motion.']
})

/* ---------- 4. Quadruped ---------- */
ROBOTS.push({
  key: 'quad', tab: 'Quadruped', seed: '1729', hasKnob: true, fog: 0.045, ring: true,
  eyebrow: 'ORION FOUNDRY \u00b7 QUADRUPED \u00b7 3D INTERACTIVE',
  title: 'Quadruped Robot \u2014 Structure &amp; Gait Lab',
  instructionObserve: 'Orbit to inspect the body, legs, hip and knee joints. Click a limb to see which joint drives it, or grab the amber knob to rotate the selected joint.',
  instructionJoint: 'Press and drag any limb vertically to bend its joint; use the amber knob or slider for precise control.',
  jointMicrocopy: 'Grab the glowing amber knob at the selected joint (on the limb) and drag up/down to rotate it, or use this slider. Every angle is limited by the URDF mechanical stops.',
  defaultJoint: 'fl_hip_flex_joint', defaultLabel: 'FL Hip Flexion',
  labels: { neck_pitch_joint: 'Neck Pitch', fr_hip_abd_joint: 'FR Hip Abduction', fr_hip_flex_joint: 'FR Hip Flexion', fr_knee_joint: 'FR Knee', fl_hip_abd_joint: 'FL Hip Abduction', fl_hip_flex_joint: 'FL Hip Flexion', fl_knee_joint: 'FL Knee', rr_hip_abd_joint: 'RR Hip Abduction', rr_hip_flex_joint: 'RR Hip Flexion', rr_knee_joint: 'RR Knee', rl_hip_abd_joint: 'RL Hip Abduction', rl_hip_flex_joint: 'RL Hip Flexion', rl_knee_joint: 'RL Knee' },
  camera: { fov: 40, min: 0.8, max: 5, maxPolar: 0.88, target: [0, 0.42, 0], floor: 1.9, grid: 3.2, views: [{ key: 'hero', pos: [2.0, 1.15, -2.6], label: 'Three-Quarter' }, { key: 'front', pos: [0, 0.8, -3.0], label: 'Front' }, { key: 'side', pos: [2.8, 0.85, 0], label: 'Side' }, { key: 'top', pos: [0, 2.6, 0.4], label: 'Top' }] },
  root: {
    link: 'body_link', rotX: -Math.PI / 2, y: 0.47, debugLink: 'body_link', mount: (ln) => {
      const r = new THREE.Object3D()
      r.name = 'quad_root'
      r.rotation.x = -Math.PI / 2
      r.position.y = 0.47
      r.add(ln.get('body_link')!)
      return r
    }
  },
  demo: { title: 'Trot / Walk Gait', toggleId: 'walkToggle', runLabel: 'Start Walking', pauseLabel: 'Pause Walking', cycle: 1.9,
    phaseLabel: 'Drag to inspect one complete gait cycle', legend: ['Stance 50%', 'Swing 50%'],
    presets: [{ p: 0, label: 'Fore Swing' }, { p: 0.25, label: 'Mid Swing' }, { p: 0.5, label: 'Foot Down' }, { p: 0.78, label: 'Drive Stance' }],
    move: (p, api) => {
      const A_ABD = 0.10, A_FLEX = 0.55, KB = -0.55, KS = 0.5, OFF: Record<string, number> = { fr: 0.5, fl: 0, rr: 0, rl: 0.5 }
      const lc = (pp: number, off: number) => {
        const t = mod(pp + off)
        const swing = t >= 0.5
        const lift = swing ? 0.5 * (1 - Math.cos((2 * Math.PI * (t - 0.5)) / 0.5)) : 0
        return {
          abd: A_ABD * Math.sin(2 * Math.PI * (t + 0.25)), thigh: A_FLEX * Math.sin(2 * Math.PI * t), knee: KB - KS * lift, lift
        }
      }
      let sum = 0
      for (const l of ['fl', 'fr', 'rl', 'rr']) {
        const c = lc(p, OFF[l]!)
        sum += c.lift
        api.setJoint(l + '_hip_abd_joint', c.abd)
        api.setJoint(l + '_hip_flex_joint', c.thigh)
        api.setJoint(l + '_knee_joint', c.knee)
      }
      api.root.position.y = 0.47 + 0.02 - (sum / 4) * 0.06
      api.root.rotation.z = 0.012 * Math.sin(2 * Math.PI * p)
      api.setJoint('neck_pitch_joint', 0.05 * Math.sin(2 * Math.PI * (p + 0.25)))
    },
    home: (h) => {
      for (const l of ['fl', 'fr', 'rl', 'rr']) {
        h.setJoint(l + '_hip_abd_joint', 0)
        h.setJoint(l + '_hip_flex_joint', 0)
        h.setJoint(l + '_knee_joint', 0)
      }
      h.setJoint('neck_pitch_joint', 0)

      h.root.position.y = 0.47
      h.root.rotation.z = 0
    }
  },
  urdfEl: 'quadruped-urdf',
  anatomy: ['A simplified <b>mini-cheetah-style</b> quadruped with <b>13 articulating joints</b> (4 legs \u00d7 hip-abduction / hip-flexion / knee, plus a neck-pitch head). In the trot, diagonal pairs swing 180\u00b0 out of phase for stable support.',
    'Select a joint and drag the slider to feel its axis; enable \u201cDrag Joints\u201d to bend a limb; press \u201cStart Walking\u201d to watch the diagonal trot; scrub the phase slider through a full cycle.']
})

/* ---------- 5. Humanoid ---------- */
ROBOTS.push({
  key: 'humanoid', tab: 'Humanoid', seed: '1729', hasKnob: false, fog: 0.052, ring: true, debugDefault: 'final', debugBaseLight: true,
  eyebrow: 'ORION FOUNDRY \u00b7 HUMAN &amp; GAIT \u00b7 3D INTERACTIVE',
  title: 'Humanoid Robot \u2014 Structure &amp; Gait Lab',
  camSectionTitle: 'Inspection &amp; Diagnostics',
  debugModes: [{ value: 'final', label: 'Final Materials' }, { value: 'base', label: 'Base Lighting (No Emission)' }, { value: 'topology', label: 'Topology Wireframe' }, { value: 'joints', label: 'Joint Axes &amp; Pivots' }],
  instructionObserve: 'Orbit to inspect the full body. Click a limb or torso part to see which joint drives it, then flex it.',
  instructionJoint: 'Press and drag any limb up or down to flex the corresponding joint; you can also use the precise angle slider on the right.',
  defaultJoint: 'left_shoulder_joint', defaultLabel: 'Left Shoulder',
  labels: { torso_yaw_joint: 'Torso Yaw', neck_yaw_joint: 'Neck Yaw', head_pitch_joint: 'Head Pitch', left_shoulder_joint: 'Left Shoulder', left_elbow_joint: 'Left Elbow', left_wrist_joint: 'Left Wrist', left_hip_joint: 'Left Hip', left_knee_joint: 'Left Knee', left_ankle_joint: 'Left Ankle', right_shoulder_joint: 'Right Shoulder', right_elbow_joint: 'Right Elbow', right_wrist_joint: 'Right Wrist', right_hip_joint: 'Right Hip', right_knee_joint: 'Right Knee', right_ankle_joint: 'Right Ankle' },
  camera: { fov: 38, min: 1.1, max: 6, maxPolar: 0.9, target: [0, 0.72, 0], floor: 1.45, grid: 3.0, views: [{ key: 'hero', pos: [1.75, 1.45, -2.45], label: 'Three-Quarter View' }, { key: 'front', pos: [0, 1.12, -3.15], label: 'Front View' }, { key: 'side', pos: [3.15, 1.12, 0], label: 'Side View' }, { key: 'near', pos: [1.05, 1.55, -1.35], label: 'Upper-Body Close-Up' }] },
  root: {
    link: 'pelvis_link', rotX: -Math.PI / 2, y: 0.67, debugLink: 'pelvis_link', mount: (ln) => {
      const r = new THREE.Object3D()
      r.name = 'humanoid_root'
      r.rotation.x = -Math.PI / 2
      r.position.y = 0.67
      r.add(ln.get('pelvis_link')!)
      return r
    }
  },
  demo: { title: 'Human Gait', toggleId: 'walkToggle', runLabel: 'Start Walking', pauseLabel: 'Pause Walking', cycle: 2.4,
    phaseLabel: 'Drag to inspect one complete gait cycle', legend: ['Stance Phase 62%', 'Swing Phase 38%'],
    presets: [{ p: 0, label: 'Heel Strike' }, { p: 0.31, label: 'Mid-Stance' }, { p: 0.62, label: 'Toe-Off' }, { p: 0.81, label: 'Mid-Swing' }],
    move: (p, api) => {
      const Ne = (v: number) => v * rad, Ja = clamp
      function foot(C: number, L: number) {
        const B = mod(C), j = 0.62
        if (B < j) {
          const u = B / j, nt = smooth((B - 0.48) / (j - 0.48)), dt = smooth(B / 0.08)
          return { y: L * (0.095 + (-0.185 - 0.095) * u), z: -(0.61) + L * 0.04 * nt, pitch: Ne(L * (B < 0.08 ? (7 + (0 - 7) * dt) : (0 + (-18 - 0) * nt))) }
        }
        const q = (B - j) / (1 - j), e = smooth(q)
        return {

          y: L * (-0.185 + (0.095 + 0.185) * e), z: -(0.61) + L * (0.04 * (1 - e) + 0.068 * Math.sin(Math.PI * q)), pitch: Ne(L * (-18 + (7 + 18) * e))
        }
      }
      function legD(C: number, L: number, B: number) {
        const j = foot(C, L), u = -0.05 + B, ey = j.y, uz = j.z - u, nt = 0.285, dtk = 0.275, tt = ey * ey + uz * uz, g = Ja((tt - nt * nt - dtk * dtk) / (2 * nt * dtk), -1, 1), ct = -Math.acos(g), at = Math.atan2(ey, -uz), bt = Math.atan2(dtk * Math.sin(ct), nt + dtk * Math.cos(ct)), Gt = at - bt, Ct = clamp(j.pitch - Gt - ct + 0, Ne(-35), Ne(35))
        return {
          hip: Gt, knee: -ct, ankle: Ct
        }
      }
      const C = p * Math.PI * 2, bob = -0.015 + 0.0075 * (1 - Math.cos(C * 2))
      api.root.position.y = 0.67 + bob
      api.setJoint('torso_yaw_joint', Ne(2.3 * Math.sin(C)))
      api.setJoint('neck_yaw_joint', Ne(-3 * Math.sin(C)))
      api.setJoint('head_pitch_joint', Ne(1.5 * Math.sin(C * 2)))
      const sh = Ne(18 * Math.cos(C))
      api.setJoint('left_shoulder_joint', -sh)
      api.setJoint('right_shoulder_joint', sh)
      api.setJoint('left_elbow_joint', Ne(14.5 + 2.5 * Math.cos(C)))
      api.setJoint('right_elbow_joint', Ne(14.5 - 2.5 * Math.cos(C)))
      api.setJoint('left_wrist_joint', 0)
      api.setJoint('right_wrist_joint', 0)
      const L = legD(p, 1, 0), R = legD(p + 0.5, 1, 0);
      ['left_hip_joint', 'left_knee_joint', 'left_ankle_joint'].forEach((n, k) => api.setJoint(n, [L.hip, L.knee, L.ankle][k]!));
      ['right_hip_joint', 'right_knee_joint', 'right_ankle_joint'].forEach((n, k) => api.setJoint(n, [R.hip, R.knee, R.ankle][k]!))
    },
    home: (h) => {
      ['torso_yaw_joint', 'neck_yaw_joint', 'head_pitch_joint', 'left_shoulder_joint', 'left_elbow_joint', 'left_wrist_joint', 'left_hip_joint', 'left_knee_joint', 'left_ankle_joint', 'right_shoulder_joint', 'right_elbow_joint', 'right_wrist_joint', 'right_hip_joint', 'right_knee_joint', 'right_ankle_joint'].forEach(n => h.setJoint(n, 0))
      h.root.position.y = 0.67
    }
  },
  urdfEl: 'humanoid-urdf'
})
