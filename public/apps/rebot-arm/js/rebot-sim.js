(function () {
  const DEG = Math.PI / 180;
  const t = window.rebotI18n ? window.rebotI18n.t : (k) => k;
  const RAD = 180 / Math.PI;
  const NOMINAL_REACH = 0.56;
  const GRIPPER_COMMAND_MAX = 0.0715;
  const GRIPPER_VISUAL_MAX = 0.05;
  const GRIPPER_FINGER_TRAVEL_M = 0.05;
  const GRIPPER_ANIMATION_MS = 520;
 const URDF_HAS_BUILTIN_GRIPPER = true;
 const GRIPPER_MESH_VERSION = 'rs-v1';
  // 指令值 → 两指内侧面间距：实测 URDF 指关节网格，间隙 = 2×行程，
  // 行程 = 指令/GRIPPER_COMMAND_MAX × GRIPPER_FINGER_TRAVEL_M
  const GRIPPER_GAP_PER_COMMAND = (2 * GRIPPER_FINGER_TRAVEL_M) / GRIPPER_COMMAND_MAX;
  // 空夹爪闭合（夹爪附近没有方块时）用的指令值
  const GRIPPER_GRASP_WIDTH = 0.0325;
  // —— 视觉分拣场景（传送带 + 分拣盒）——
  const BELT_CENTER_X = 0.33;          // three X（保证工具朝下时可达）
  const BELT_WIDTH = 0.16;
  const BELT_HALF_LENGTH = 0.42;       // three Z ∈ [-0.42, 0.42]
  const BELT_TOP_Y = 0.118;
  const BELT_SPEED = 0.055;            // m/s，向 +Z 输送
  const ROLLER_RADIUS = 0.032;
  const PICK_ZONE_Z = [-0.20, 0.10];   // 抓取区（three Z）
  // 从选中目标到夹爪闭合期间，方块仍随带面前进的距离；选目标时必须预留，
  // 否则整个抓取流程会跑出抓取区（也会撞到工位边界）
  const PICK_LEAD_Z = 0.13;
  const BLOCK_SIZE = 0.045;
  // 闭合后指面与方块之间的单侧余量。原来固定闭合到 45.4mm（正好等于方块边长），
  // 只留 0.45mm 间隙 —— 方块稍微没对正，指面就切进方块里（穿模）。
  // 现在按方块的实测位姿现算闭合宽度，见 gripWidthForBlock()。
  const GRASP_CLEARANCE = 0.0015;
  // 「夹爪附近」的接受半径：超出就不算夹得住，免得把旁边的方块吸进来
  const GRASP_ACCEPT_PLANAR = 0.030;
  const GRASP_ACCEPT_DY = 0.055;
  const BLOCK_COLORS = Object.freeze({ red: 0xeb140f, yellow: 0xffb80a, blue: 0x086bf0 });
  const BLOCK_HALF = BLOCK_SIZE / 2;
  const MAX_BLOCKS_ON_BELT = 4;
  const SPAWN_INTERVAL_MS = 3400;
  // 相邻方块中心的最小间距：比时间间隔更可靠（低帧率下 dt 被截断也不会堆叠穿模）
  const MIN_BLOCK_SPACING = 0.18;
  const BLOCK_SPAWN_Z = -BELT_HALF_LENGTH + BLOCK_HALF + 0.008;
  // 分拣盒整体挪到传送带左侧，与带面 / 导轨 / 支腿 / 端辊留出净空
  const BIN_CENTER = { x: 0.12, z: 0.26 };
  const BIN_SIZE = { x: 0.22, z: 0.20 };   // 外径
  const BIN_WALL = 0.009;
  // 盒壁高度受机械臂限制：工具竖直朝下时，TCP 在盒子上方只能到 ~0.18，
  // 再高 IK 就会为了保住姿态而放弃位置精度。所以盒子做得浅一些，
  // 让「在盒壁上方松手」的高度落在可靠可达的区间里。
  const BIN_HEIGHT = 0.12;
  const BIN_FLOOR_TOP = 0.018;
  const BIN_PLATE_H = 0.004;
  // 方块落在色板上面，而不是穿进色板里
  const BIN_STACK_BASE = BIN_FLOOR_TOP + BIN_PLATE_H;
  const SLOT_ORDER = ['red', 'yellow', 'blue'];
  // 三格的实际几何中心（内净空 0.182 去掉两条隔板后均分），居中放置才不会蹭到隔板
  const SLOT_Z = { red: 0.197, yellow: 0.26, blue: 0.323 };
  const SLOT_PITCH = SLOT_Z.yellow - SLOT_Z.red;
  const MAX_STACK_PER_SLOT = 2;
  const APPROACH_HOVER = 0.025;
  // 在盒壁上方这么高处松手，让方块自己落进分格：夹爪不必伸进 56mm 窄格，
  // 也就不会和隔板互相穿模
  const DROP_CLEARANCE = 0.03;
  const GRASP_STICKOUT = 0.015;        // TCP（指尖）到被抓方块中心的距离（自校正）
  // The URDF supplies the colour. These Web-specific PBR values compensate for
  // Three.js running without an environment map; copying MuJoCo's high metal
  // value directly makes anodized silver render nearly black in the browser.
  const URDF_FINISH_PARAMS = Object.freeze({
    rs_base_black: { roughness: 0.20, metalness: 0.82 },
    rs_motor_black: { roughness: 0.48, metalness: 0.48 },
   rs_pla_black: { roughness: 0.58, metalness: 0.08 },
    rs_wordmark_black: { roughness: 0.76, metalness: 0.00 },
   rs_anodized_silver: { roughness: 0.24, metalness: 0.58 },
    rs_seeed_green: { roughness: 0.34, metalness: 0.18 }
  });

  const jointDefs = [
    { name: 'joint1', label: 'joint.j1', min: -2.8, max: 2.8, home: 0 },
    { name: 'joint2', label: 'joint.j2', min: 0, max: 3.14, home: 0 },
    { name: 'joint3', label: 'joint.j3', min: 0, max: 3.14, home: 0 },
    { name: 'joint4', label: 'joint.j4', min: -1.57, max: 1.57, home: 0 },
    { name: 'joint5', label: 'joint.j5', min: -1.57, max: 1.57, home: 0 },
    { name: 'joint6', label: 'joint.j6', min: -3.14, max: 3.14, home: 0 },
    { name: 'gripper', label: 'joint.gripper', min: 0, max: GRIPPER_COMMAND_MAX, home: 0, unit: 'm' }
  ];

  const presets = {
    ready: { label: 'preset.ready', angles: [0, 0, 0, 0, 0, 0, 0] },
    forward: { label: 'preset.forward', angles: [0, 25, 35, 28, 0, 0, 90] },
    left: { label: 'preset.left', angles: [42, 25, 45, 32, 18, 0, 90] },
    right: { label: 'preset.right', angles: [-42, 25, 45, 32, -18, 0, 20] },
    inspect: { label: 'preset.inspect', angles: [18, 36, 26, -16, 45, 90, 45] },
    fold: { label: 'preset.fold', angles: [0, 88, 118, 78, 0, 0, 0] }
  };

  let scene;  let camera;
  let sceneResizeObserver;
  let renderer;
  let controls;
  let robot;
  let robotFrame;
  let ghostRobot;
  let ghostDisplayActive = false;
  let hardwareFeedbackDriven = false;
  let gripperGroup;
  let ghostGripperGroup;
  let taskSceneGroup;
  let beltSurfaceTexture = null;
  let envelopeGroup;
  let workspacePlanarReach = NOMINAL_REACH;
  let workspaceVerticalReach = NOMINAL_REACH;
  let targetGhost;
  let tcpMarker;
  let dragErrorLine;
  let animation = null;
  let currentAngles = {};
  let targetAngles = {};
  let moveStartAngles = {};
  let moveStart = 0;
  let moveDuration = 900;
  let gripperMotion = null;
  let dragMode = false;
  let draggingTcp = false;
  let dragPlane = null;
  let dragTarget = new THREE.Vector3();
  let dragLastTime = 0;
  let dragPointerId = null;
  let dragTargetClamped = false;
  let dragSettling = false;
  let dragSettleStart = 0;
  let dragSettleLastTime = 0;
  // In hardware mode currentAngles is continuously replaced by measured ROS
  // feedback.  Keep the last IK output separately so pointer-up cannot resend
  // a slightly older measured pose as the final command.
  let dragCommandAngles = null;
  const DRAG_SETTLE_TIMEOUT_MS = 1400;
  const DRAG_SETTLE_TARGET_ERROR = 0.002;
  let teachingRecording = false;
  let teachingStart = 0;
  let teachingLastSample = 0;
  let teachingWaypoints = [];
  let teachingPlayback = null;
  const TEACH_SAMPLE_INTERVAL_MS = 90;
  const TEACH_MIN_TCP_STEP = 0.004;
  const TEACH_REPLAY_SAMPLE_HZ = 30;
  const TEACH_REPLAY_MAX_POINTS = 1500;
  const TEACH_REPLAY_RETURN_SPEED_RAD_S = 1.2;
 const commandListeners = new Set();
 const axisLabelSprites = [];
  let carriedObject = null;
  // —— 分拣任务运行时状态 ——
  const blocks = new Set();            // { id, color, mesh, state, vy, restY, lockHint }
  const binCounts = { red: 0, yellow: 0, blue: 0 };   // 累计分拣数（HUD 用）
  const binStacks = { red: [], yellow: [], blue: [] }; // 当前格内堆叠的方块（自下往上）
  let conveyorRunning = true;
  let spawnTimerMs = 0;
  // 机械臂加载完成、初始方块就位之前不自动落料，否则会和初始方块撞在一起
  let spawnEnabled = false;
  let blockIdSeq = 0;
  let motionEpoch = 0;
  const moveWaiters = new Set();       // { resolve, epoch }
  const gripperWaiters = new Set();
  // 抓取自校正：方块中心相对 TCP 的世界偏移。实测夹爪竖直朝下时方块中心略高于
  // TCP 原点，先给个经验值，第一次抓取后会用真实值覆盖。
  let graspOffsetHint = new THREE.Vector3(0, 0.005, 0);
  // —— 实时相机视图 ——
  let camViewRenderer = null;
  let camViewCamera = null;
  let camViewOverlay = null;
  let camViewOverlayCtx = null;
  let lastFrameTime = 0;

  const els = {
    host: document.getElementById('scene-host'),
    loading: document.getElementById('loading-mask'),
    loadingText: document.getElementById('loading-text'),
    status: document.getElementById('load-status'),
    tcp: document.getElementById('tcp-position'),
    reach: document.getElementById('reach-state'),
    dragMarker: document.getElementById('drag-marker'),
    dragHud: document.getElementById('drag-hud'),
    dragStatus: document.getElementById('drag-status'),
    teachRecord: document.getElementById('teach-record'),
    teachReplay: document.getElementById('teach-replay'),
    teachExport: document.getElementById('teach-export'),
    teachClear: document.getElementById('teach-clear'),
    teachStatus: document.getElementById('teach-status'),
    teachExportText: document.getElementById('teach-export-text'),
    joints: document.getElementById('joint-controls'),
    presets: document.getElementById('preset-buttons'),
    planTrajectory: document.getElementById('plan-trajectory'),
    toggleDrag: document.getElementById('toggle-drag')
  };

  jointDefs.forEach((joint) => {
    currentAngles[joint.name] = joint.home;
    targetAngles[joint.name] = joint.home;
  });

  init();

  function init() {
    buildControls();
    setupScene();
    setupEvents();
    updateTeachingStatus();
    loadRobot();
    animate();
  }

  function buildControls() {
    Object.entries(presets).forEach(([key, preset]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = t(preset.label);
      button.addEventListener('click', () => applyPreset(key, false, { source: 'preset' }));
      els.presets.appendChild(button);
    });

    jointDefs.forEach((joint) => {
      const wrap = document.createElement('div');
      wrap.className = 'joint-control';

      const head = document.createElement('div');
      head.className = 'joint-head';
      head.innerHTML = `<strong>${t(joint.label)}</strong><span class="joint-value" id="${joint.name}-value">0.0 °</span>`;

      const range = document.createElement('input');
      range.type = 'range';
      range.id = joint.name;
      if (joint.unit === 'm') {
        range.min = (joint.min * 1000).toFixed(0);
        range.max = (joint.max * 1000).toFixed(0);
        range.step = 'any';
        range.value = (joint.home * 1000).toFixed(0);
      } else {
        range.min = (joint.min * RAD).toFixed(1);
        range.max = (joint.max * RAD).toFixed(1);
        range.step = '1';
        range.value = (joint.home * RAD).toFixed(1);
      }
      range.addEventListener('input', () => {
        stopPath();
        setGhostDisplay(false);
        const value = joint.unit === 'm' ? Number(range.value) / 1000 : Number(range.value) * DEG;
        if (hardwareFeedbackDriven) {
          emitCommand({
            type: 'joint',
            name: joint.name,
            value,
            source: 'slider',
            phase: 'input',
            stamp: performance.now()
          });
          return;
        }
        setJoint(joint.name, value, true, { source: 'slider', phase: 'input' });
        syncGhostToRobot();
      });
      range.addEventListener('change', () => {
        setGhostDisplay(false);
        const value = joint.unit === 'm' ? Number(range.value) / 1000 : Number(range.value) * DEG;
        if (hardwareFeedbackDriven) {
          emitCommand({
            type: 'joint',
            name: joint.name,
            value,
            source: 'slider',
            phase: 'commit',
            stamp: performance.now()
          });
          return;
        }
        setJoint(joint.name, value, true, { source: 'slider', phase: 'commit' });
        syncGhostToRobot();
      });

      wrap.appendChild(head);
      wrap.appendChild(range);
      els.joints.appendChild(wrap);
      updateJointLabel(joint.name);
    });
  }

  function setupScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111211);

    camera = new THREE.PerspectiveCamera(48, getAspect(), 0.01, 20);
    resetCamera();

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(els.host.clientWidth, els.host.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // This project ships Three.js r128, which uses outputEncoding. Keep the
    // newer property as a forward-compatible path when the library is updated.
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if (THREE.sRGBEncoding !== undefined) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    els.host.appendChild(renderer.domElement);

    controls = createOrbit(camera, renderer.domElement, new THREE.Vector3(0.18, 0.2, 0));

    robotFrame = new THREE.Group();
    robotFrame.rotation.x = -Math.PI / 2;
    scene.add(robotFrame);

    setupLights();
    createWorkbench();
    createDirectionAxes();
    envelopeGroup = createEnvelope();
    scene.add(envelopeGroup);

    tcpMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0x33d6b0, emissive: 0x0a4d3d, emissiveIntensity: 0.9 })
    );
    tcpMarker.visible = false;
    scene.add(tcpMarker);

    targetGhost = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 28, 18),
      new THREE.MeshBasicMaterial({ color: 0xf2a541, transparent: true, opacity: 0.85 })
    );
    targetGhost.visible = false;
    scene.add(targetGhost);

    dragErrorLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xff6b5f, transparent: true, opacity: 0.82 })
    );
    dragErrorLine.visible = false;
    scene.add(dragErrorLine);
  }

  function setupLights() {
    scene.add(new THREE.HemisphereLight(0xfff8e8, 0x141613, 0.72));

    const key = new THREE.DirectionalLight(0xfff3dc, 1.35);
    key.position.set(1.4, 2.2, 1.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 6;
    key.shadow.camera.left = -1.4;
    key.shadow.camera.right = 1.4;
    key.shadow.camera.top = 1.4;
    key.shadow.camera.bottom = -1.4;
    scene.add(key);

    const side = new THREE.DirectionalLight(0xdde8e2, 0.25);
    side.position.set(-1, 0.6, -1.2);
    scene.add(side);

    const rim = new THREE.DirectionalLight(0xd8fff0, 0.38);
    rim.position.set(-0.8, 1.5, 1.8);
    scene.add(rim);
  }

  function createWorkbench() {
    const grid = new THREE.GridHelper(2.4, 48, 0x4d716a, 0x2c3a35);
    grid.position.y = 0;
    scene.add(grid);

    taskSceneGroup = new THREE.Group();
    taskSceneGroup.name = 'sorting-task-scene';
    buildConveyor();
    buildBin();
    buildPickZoneMarker();
    scene.add(taskSceneGroup);
  }

  function buildConveyor() {
    const group = new THREE.Group();
    group.name = 'conveyor';

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x39413e, roughness: 0.55, metalness: 0.35 });
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.06, BELT_HALF_LENGTH * 2),
      frameMat
    );
    body.position.set(BELT_CENTER_X, BELT_TOP_Y - 0.031, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // 传送面：条纹纹理随时间滚动，制造输送效果
    beltSurfaceTexture = createBeltTexture();
    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(BELT_WIDTH, BELT_HALF_LENGTH * 2),
      new THREE.MeshStandardMaterial({ map: beltSurfaceTexture, roughness: 0.82, metalness: 0.05 })
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.set(BELT_CENTER_X, BELT_TOP_Y, 0);
    surface.receiveShadow = true;
    group.add(surface);

    // 两侧导轨
    const railMat = new THREE.MeshStandardMaterial({ color: 0x566059, roughness: 0.4, metalness: 0.5 });
    [-1, 1].forEach((side) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.028, BELT_HALF_LENGTH * 2),
        railMat
      );
      rail.position.set(BELT_CENTER_X + side * (BELT_WIDTH / 2 + 0.008), BELT_TOP_Y + 0.013, 0);
      rail.castShadow = true;
      group.add(rail);
    });

    // 两端滚筒：顶面与带面齐平，否则会高出一截把方块「埋」进辊子里
    [-1, 1].forEach((side) => {
      const roller = new THREE.Mesh(
        new THREE.CylinderGeometry(ROLLER_RADIUS, ROLLER_RADIUS, BELT_WIDTH + 0.02, 24),
        new THREE.MeshStandardMaterial({ color: 0x8b958f, roughness: 0.3, metalness: 0.7 })
      );
      roller.rotation.x = Math.PI / 2;
      roller.position.set(BELT_CENTER_X, BELT_TOP_Y - ROLLER_RADIUS - 0.001, side * BELT_HALF_LENGTH);
      roller.castShadow = true;
      group.add(roller);
    });

    // 支腿
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2c332f, roughness: 0.6, metalness: 0.3 });
    [-1, 1].forEach((sideZ) => {
      [-1, 1].forEach((sideX) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, BELT_TOP_Y - 0.06, 0.03), legMat);
        leg.position.set(
          BELT_CENTER_X + sideX * 0.045,
          (BELT_TOP_Y - 0.06) / 2,
          sideZ * (BELT_HALF_LENGTH - 0.08)
        );
        leg.castShadow = true;
        group.add(leg);
      });
    });

    taskSceneGroup.add(group);
  }

  function createBeltTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#23282a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#3a4245';
    for (let i = 0; i < canvas.height; i += 32) {
      ctx.fillRect(0, i, canvas.width, 12);
    }
    ctx.fillStyle = '#4d585c';
    for (let i = 0; i < canvas.width; i += 64) {
      ctx.fillRect(i, 0, 3, canvas.height);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 10);
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function buildBin() {
    const group = new THREE.Group();
    group.name = 'sorting-bin';
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a5350, roughness: 0.5, metalness: 0.25 });

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(BIN_SIZE.x, 0.014, BIN_SIZE.z),
      new THREE.MeshStandardMaterial({ color: 0x333a37, roughness: 0.7, metalness: 0.1 })
    );
    floor.position.set(BIN_CENTER.x, BIN_FLOOR_TOP - 0.007, BIN_CENTER.z);
    floor.receiveShadow = true;
    group.add(floor);

    // 三色格底板：沿 Z 分成三格，所以底板只在 Z 方向占一格宽度，
    // 否则会互相重叠、并捅出盒壁
    SLOT_ORDER.forEach((color) => {
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(BIN_SIZE.x - BIN_WALL * 2 - 0.004, BIN_PLATE_H, SLOT_PITCH - 0.009),
        new THREE.MeshStandardMaterial({ color: BLOCK_COLORS[color], roughness: 0.5, metalness: 0.05 })
      );
      plate.position.set(BIN_CENTER.x, BIN_FLOOR_TOP + BIN_PLATE_H / 2, SLOT_Z[color]);
      plate.receiveShadow = true;
      group.add(plate);
    });

    const wallH = BIN_HEIGHT - BIN_FLOOR_TOP;
    // 沿 z 的两块外侧墙 + 两块隔板 + 沿 x 的两块外侧墙
    const outerZ = [
      BIN_CENTER.z - BIN_SIZE.z / 2 + BIN_WALL / 2,
      BIN_CENTER.z + BIN_SIZE.z / 2 - BIN_WALL / 2
    ];
    outerZ.forEach((z) => {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(BIN_SIZE.x, wallH, BIN_WALL),
        wallMat
      );
      wall.position.set(BIN_CENTER.x, BIN_FLOOR_TOP + wallH / 2, z);
      wall.castShadow = true;
      group.add(wall);
    });
    const outerX = [
      BIN_CENTER.x - BIN_SIZE.x / 2 + BIN_WALL / 2,
      BIN_CENTER.x + BIN_SIZE.x / 2 - BIN_WALL / 2
    ];
    outerX.forEach((x) => {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(BIN_WALL, wallH, BIN_SIZE.z),
        wallMat
      );
      wall.position.set(x, BIN_FLOOR_TOP + wallH / 2, BIN_CENTER.z);
      wall.castShadow = true;
      group.add(wall);
    });
    // 两条内隔板（把盒子分成 3 格），与盒壁等高，保证 3 层方块都在格内
    [(SLOT_Z.red + SLOT_Z.yellow) / 2, (SLOT_Z.yellow + SLOT_Z.blue) / 2].forEach((z) => {
      const divider = new THREE.Mesh(
        new THREE.BoxGeometry(BIN_SIZE.x - BIN_WALL * 2, wallH, BIN_WALL * 0.8),
        new THREE.MeshStandardMaterial({ color: 0x3d4542, roughness: 0.55, metalness: 0.2 })
      );
      divider.position.set(BIN_CENTER.x, BIN_FLOOR_TOP + wallH / 2, z);
      divider.castShadow = true;
      group.add(divider);
    });

    taskSceneGroup.add(group);
  }

  function buildPickZoneMarker() {
    const zCenter = (PICK_ZONE_Z[0] + PICK_ZONE_Z[1]) / 2;
    const zLen = PICK_ZONE_Z[1] - PICK_ZONE_Z[0];
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(BELT_WIDTH, zLen),
      new THREE.MeshBasicMaterial({ color: 0x33d6b0, transparent: true, opacity: 0.12, depthWrite: false })
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(BELT_CENTER_X, BELT_TOP_Y + 0.002, zCenter);
    taskSceneGroup.add(marker);

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(BELT_WIDTH, zLen)),
      new THREE.LineBasicMaterial({ color: 0x33d6b0, transparent: true, opacity: 0.5 })
    );
    outline.rotation.x = -Math.PI / 2;
    outline.position.set(BELT_CENTER_X, BELT_TOP_Y + 0.003, zCenter);
    taskSceneGroup.add(outline);
  }

  // 落料位置要保证与带上已有方块至少隔开 MIN_BLOCK_SPACING；
  // 让不开就干脆不生成，避免出现两块叠在一起（穿模）
  function resolveSpawnZ(desiredZ) {
    let z = desiredZ;
    blocks.forEach((block) => {
      if (block.state !== 'belt' && block.state !== 'locked') return;
      // 取「所有已有方块后退一个间距」的最靠后位置，与遍历顺序无关
      z = Math.min(z, block.mesh.position.z - MIN_BLOCK_SPACING);
    });
    return z < -BELT_HALF_LENGTH - 0.005 ? null : z;
  }

  function spawnBlock(colorKey, zPos) {
    const z = resolveSpawnZ(zPos != null ? zPos : BLOCK_SPAWN_Z);
    if (z == null) return null;
    const color = colorKey || Object.keys(BLOCK_COLORS)[Math.floor(Math.random() * 3)];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE),
      new THREE.MeshStandardMaterial({ color: BLOCK_COLORS[color], roughness: 0.34, metalness: 0.06 })
    );
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 32),
      new THREE.LineBasicMaterial({ color: 0x18201e, transparent: true, opacity: 0.4 })
    );
    mesh.add(outline);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(
      BELT_CENTER_X + (Math.random() - 0.5) * 0.02,
      BELT_TOP_Y + BLOCK_HALF,
      z
    );
    const block = {
      id: ++blockIdSeq,
      color,
      mesh,
      state: 'belt',   // belt | locked | carried | falling | binned | idle
      vy: 0,
      restY: BELT_TOP_Y + BLOCK_HALF
    };
    mesh.userData.block = block;
    taskSceneGroup.add(mesh);
    blocks.add(block);
    return block;
  }

  function removeBlock(block) {
    if (carriedObject && carriedObject.block === block) carriedObject = null;
    if (block.mesh.parent) block.mesh.parent.remove(block.mesh);
    blocks.delete(block);
    const stack = binStacks[block.color];
    if (stack) {
      const index = stack.indexOf(block);
      if (index >= 0) stack.splice(index, 1);
    }
  }

  function updateBlocks(dtMs) {
    // 下落积分用较小的步长；带面则按真实时间走 —— 抓取时的预判行程要能和它对上，
    // 帧率一低就把带面拖慢会让机械臂每次都「抢跑」
    const dt = Math.min(dtMs, 100) / 1000;
    const beltDt = Math.min(dtMs, 500) / 1000;
    const beltBlocks = [];
    blocks.forEach((block) => {
      // 自愈：没有任何 carriedObject 持有的方块不得停留在 carried 状态
      if (block.state === 'carried' && (!carriedObject || carriedObject.block !== block)) {
        settleBlockFrom(block, block.mesh.position);
      }
      if (block.state === 'belt' || block.state === 'locked') {
        // 锁定只是「预留给机械臂」，方块本身照旧随带面前进：
        // 抓取时由机械臂去追，而不是把方块钉在原地
        if (conveyorRunning) {
          block.mesh.position.z += BELT_SPEED * beltDt;
        }
        if (block.mesh.position.z > BELT_HALF_LENGTH + 0.02) {
          beltBlocks.push(block);
        }
      } else if (block.state === 'falling') {
        block.vy -= 4.2 * dt;
        block.mesh.position.y += block.vy * dt;
        if (block.vy < 0 && block.mesh.position.y <= block.restY) {
          block.mesh.position.y = block.restY;
          block.vy = 0;
          block.state = block.nextState || 'idle';
        }
      }
    });
    beltBlocks.forEach(removeBlock);

    spawnTimerMs += dtMs;
    if (spawnEnabled && spawnTimerMs >= SPAWN_INTERVAL_MS) {
      // 时间到了还要再看间距：帧率低时方块实际前进得慢，只按时间补料会叠在一起
      let onBelt = 0;
      let tooClose = false;
      blocks.forEach((block) => {
        if (block.state !== 'belt' && block.state !== 'locked') return;
        onBelt += 1;
        if (block.mesh.position.z < BLOCK_SPAWN_Z + MIN_BLOCK_SPACING) tooClose = true;
      });
      if (!tooClose && onBelt < MAX_BLOCKS_ON_BELT) {
        spawnTimerMs = 0;
        spawnBlock();
      }
    }
  }

  function createDirectionAxes() {
    const origin = new THREE.Vector3(0, 0.006, 0);
    addArrow(origin, new THREE.Vector3(1, 0, 0), 0xef5a4d, t('app.axisX'));
    addArrow(origin, new THREE.Vector3(0, 0, -1), 0x77c96b, t('app.axisY'));
    addArrow(origin, new THREE.Vector3(0, 1, 0), 0x5fa8ff, t('app.axisZ'));
  }

  function addArrow(origin, dir, color, label) {
    const arrow = new THREE.ArrowHelper(dir, origin, 0.18, color, 0.035, 0.012);
    scene.add(arrow);

    const sprite = makeTextSprite(label, color);
    sprite.position.copy(origin).add(dir.clone().multiplyScalar(0.23));
    sprite.position.y += dir.y === 0 ? 0.018 : 0;
    sprite.userData.autoHideAt = performance.now() + 3000;
    sprite.userData.fadeDuration = 900;
    axisLabelSprites.push(sprite);
    scene.add(sprite);
  }

  function createEnvelope() {
    const group = new THREE.Group();
    const mainMat = new THREE.LineBasicMaterial({ color: 0x33d6b0, transparent: true, opacity: 0.32 });
    const guideMat = new THREE.LineBasicMaterial({ color: 0x33d6b0, transparent: true, opacity: 0.18 });
    const radius = workspacePlanarReach;
    const heightLimit = workspaceVerticalReach;

    [0, 0.25, 0.5, 0.75, 0.95].forEach((ratio) => {
      const height = heightLimit * ratio;
      const ringRadius = radius * Math.sqrt(Math.max(0, 1 - ratio * ratio));
      group.add(makeCircleLine(ringRadius, height, height === 0 ? mainMat : guideMat));
    });

    for (let i = 0; i < 12; i += 1) {
      group.add(makeVerticalArc(radius, heightLimit, (i / 12) * Math.PI * 2, i % 3 === 0 ? mainMat : guideMat));
    }
    return group;
  }

  function makeCircleLine(radius, y, mat) {
    const points = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
    }
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), mat);
  }

  function makeVerticalArc(radius, heightLimit, yaw, mat) {
    const points = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI / 2;
      const r = Math.cos(a) * radius;
      const y = Math.sin(a) * heightLimit;
      points.push(new THREE.Vector3(Math.cos(yaw) * r, y, Math.sin(yaw) * r));
    }
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), mat);
  }

  function loadRobot() {
    if (typeof URDFLoader === 'undefined') {
      failLoad('URDFLoader is not loaded.');
      return;
    }

    const manager = new THREE.LoadingManager();
    manager.onProgress = (url, loaded, total) => {
      els.loadingText.textContent = `Loading model ${Math.round((loaded / Math.max(total, 1)) * 100)}%`;
    };
    manager.onLoad = () => {
      if (!robot) return;
      finishRobotLoad();
    };

    const loader = new URDFLoader(manager);
    loader.packages = {
      rebotarm_bringup: `${window.location.origin}/api/apps/rebot-arm`
    };

    // URDF 命中缓存时回调可能同步触发；延后一拍确保 IKSolver 等模块级定义已完成初始化
    setTimeout(() => {
      loader.load('/api/apps/rebot-arm/urdf', (loadedRobot) => {
        robot = loadedRobot;
        robotFrame.add(robot);
      }, undefined, (error) => {
        failLoad(`URDF load failed: ${error && error.message ? error.message : error}`);
      });
    }, 0);
  }

  async function finishRobotLoad() {
    try {
      styleRobot(robot, false);
      if (URDF_HAS_BUILTIN_GRIPPER) {
        gripperGroup = robot.getObjectByName('gripper_end');
      } else {
        try {
          gripperGroup = await attachGripperVisual(robot, false);
        } catch (error) {
          console.warn('Gripper STL load failed, continuing with arm model only:', error);
        }
      }
      createGhostRobot();
      applyPreset('forward', true);
      // 初始在传送带上放两块方块，场景即刻可见分拣素材
      spawnBlock('red', -0.16);
      spawnBlock('yellow', -0.34);
      spawnTimerMs = 0;
      spawnEnabled = true;
      estimateWorkspaceEnvelope();
      rebuildEnvelope();
      syncGhostToRobot();
    } catch (error) {
      console.warn('finishRobotLoad partial error:', error);
    }
    updateReadyState();
  }

  function estimateWorkspaceEnvelope() {
    if (!robot) return;

    const savedAngles = { ...currentAngles };
    let maxPlanar = NOMINAL_REACH;
    let maxVertical = NOMINAL_REACH;
    const movableJoints = jointDefs.filter((joint) => joint.name !== 'gripper');

    for (let i = 0; i < 960; i += 1) {
      const sample = { ...savedAngles };
      movableJoints.forEach((joint, index) => {
        const t = seededUnit(i + 1, index + 3);
        sample[joint.name] = joint.min + (joint.max - joint.min) * t;
      });
      applyRobotAngles(robot, sample);
      robot.updateMatrixWorld(true);

      const pos = getTcpPosition(robot);
      if (!pos) continue;
      maxPlanar = Math.max(maxPlanar, Math.sqrt(pos.x * pos.x + pos.z * pos.z));
      maxVertical = Math.max(maxVertical, Math.max(0, pos.y));
    }

    applyRobotAngles(robot, savedAngles);
    robot.updateMatrixWorld(true);
    workspacePlanarReach = clamp(Math.ceil(maxPlanar * 100) / 100, NOMINAL_REACH, 1.2);
    workspaceVerticalReach = clamp(Math.ceil(maxVertical * 100) / 100, NOMINAL_REACH, 1.2);
  }

  function seededUnit(a, b) {
    const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function rebuildEnvelope() {
    if (!scene) return;
    const wasVisible = envelopeGroup ? envelopeGroup.visible : true;
    if (envelopeGroup) scene.remove(envelopeGroup);
    envelopeGroup = createEnvelope();
    const toggle = document.getElementById('toggle-envelope');
    envelopeGroup.visible = toggle ? toggle.checked && wasVisible : wasVisible;
    scene.add(envelopeGroup);
  }

 function styleRobot(root, ghost) {
   root.traverse((child) => {
     if (!child.isMesh) return;
     child.castShadow = !ghost;
     child.receiveShadow = !ghost;

     if (ghost) {
       child.material = new THREE.MeshStandardMaterial({
         color: 0x33d6b0,
         roughness: 0.28,
         metalness: 0.05,
         transparent: true,
         opacity: 0.22,
         side: THREE.DoubleSide
       });
       return;
     }

     const sourceMaterial = Array.isArray(child.material) ? child.material[0] : child.material;
     const materialName = sourceMaterial && sourceMaterial.name
       ? sourceMaterial.name
       : linkFinishName(child);
     const finish = URDF_FINISH_PARAMS[materialName];
     if (!finish) return;

     child.material = new THREE.MeshStandardMaterial({
       color: sourceMaterial.color || 0xcccccc,
       roughness: finish.roughness,
       metalness: finish.metalness,
       side: THREE.DoubleSide
     });
   });
 }

 function linkFinishName(object) {
   let node = object;
   while (node) {
     if (node.material && !Array.isArray(node.material) && node.material.name) {
       return node.material.name;
     }
     node = node.parent;
   }
   return '';
 }

  function createGhostRobot() {
    if (!robot) return;
    ghostRobot = robot.clone(true);
    styleRobot(ghostRobot, true);
    ghostGripperGroup = ghostRobot.getObjectByName('sim_gripper') || ghostRobot.getObjectByName('gripper_end');
    ghostRobot.visible = false;
    robotFrame.add(ghostRobot);
  }

  function setGhostDisplay(active) {
    ghostDisplayActive = Boolean(active);
    if (!ghostRobot) return;
    const toggle = document.getElementById('toggle-ghost');
    ghostRobot.visible = ghostDisplayActive && (!toggle || toggle.checked);
  }

  async function attachGripperVisual(root, ghost) {
    const endLink = root.getObjectByName('gripper_end') || root.getObjectByName('end_link') || root.getObjectByName('link6');
    if (!endLink || !THREE.STLLoader) return null;

    hideOriginalEndLinkMeshes(endLink);

    const group = new THREE.Group();
    group.name = 'sim_gripper';
    endLink.add(group);

    const loader = new THREE.STLLoader();
    const parts = [
     { name: 'gripper_base', file: 'gripper_base.stl', color: ghost ? 0x33d6b0 : 0x3d4745, moving: false },
     { name: 'left_finger', file: 'left_finger.stl', color: ghost ? 0x33d6b0 : 0x3d4745, moving: true },
     { name: 'right_finger', file: 'right_finger.stl', color: ghost ? 0x33d6b0 : 0x3d4745, moving: true }
    ];

    const meshes = await Promise.all(parts.map((part) => loadGripperMesh(loader, part, ghost)));
    meshes.forEach((mesh) => group.add(mesh));
    updateGripperVisual(group, currentAngles.gripper ?? 0);
    return group;
  }

  function hideOriginalEndLinkMeshes(endLink) {
    endLink.traverse((child) => {
      if (child !== endLink && child.isMesh) {
        child.visible = false;
      }
    });
  }

  function loadGripperMesh(loader, part, ghost) {
    return new Promise((resolve, reject) => {
      loader.load(`/api/apps/rebot-arm/gripper_meshes/${part.file}?v=${GRIPPER_MESH_VERSION}`, (geometry) => {
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
          color: part.color,
          roughness: part.moving ? 0.42 : 0.62,
          metalness: part.moving ? 0.18 : 0.25,
          transparent: ghost,
          opacity: ghost ? 0.22 : 1,
          side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = part.name;
        mesh.castShadow = !ghost;
        mesh.receiveShadow = !ghost;
        mesh.userData.isMovingFinger = part.moving;
        resolve(mesh);
      }, undefined, reject);
    });
  }

  function updateGripperVisual(group, widthM) {
    if (!group) return;
    const commandWidth = clamp(widthM, 0, GRIPPER_COMMAND_MAX);
    const visualWidth = (commandWidth / GRIPPER_COMMAND_MAX) * GRIPPER_VISUAL_MAX;
    const half = visualWidth / 2;
    const left = group.getObjectByName('left_finger');
    const right = group.getObjectByName('right_finger');
    if (left) left.position.y = half;
    if (right) right.position.y = -half;
  }

  function updateReadyState() {
    els.status.classList.add('ready');
    els.status.lastChild.textContent = ' Ready';
    els.loading.classList.add('hidden');
  }

  function failLoad(message) {
    els.status.lastChild.textContent = ' Load failed';
    els.loadingText.textContent = message;
  }

  function setupEvents() {
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) {
      sceneResizeObserver = new ResizeObserver(() => resize());
      sceneResizeObserver.observe(els.host);
    }
    document.getElementById('reset-camera')?.addEventListener('click', resetCamera);
    document.getElementById('play-path')?.addEventListener('click', playPath);
    document.getElementById('stop-path')?.addEventListener('click', () => {
      stopActiveMotion();
    });
    if (els.planTrajectory) els.planTrajectory.addEventListener('click', generateTrajectory);
    if (els.toggleDrag) els.toggleDrag.addEventListener('click', toggleDragMode);
    if (els.teachRecord) els.teachRecord.addEventListener('click', toggleTeachingRecord);
    if (els.teachReplay) els.teachReplay.addEventListener('click', replayTeaching);
    if (els.teachExport) els.teachExport.addEventListener('click', exportTeachingWaypoints);
    if (els.teachClear) els.teachClear.addEventListener('click', clearTeaching);
    if (els.dragMarker) {
      els.dragMarker.addEventListener('pointerdown', startTcpDrag);
    }
    window.addEventListener('pointermove', moveTcpDrag);
    window.addEventListener('pointerup', endTcpDrag);
    window.addEventListener('pointercancel', endTcpDrag);
    document.getElementById('open-gripper')?.addEventListener('click', () => setGripperWidth(GRIPPER_COMMAND_MAX));
    document.getElementById('close-gripper')?.addEventListener('click', () => setGripperWidth(GRIPPER_COMMAND_MAX - GRIPPER_GRASP_WIDTH));

    document.getElementById('toggle-envelope')?.addEventListener('change', (event) => {
      envelopeGroup.visible = event.target.checked;
    });
    document.getElementById('toggle-ghost')?.addEventListener('change', (event) => {
      if (ghostRobot) ghostRobot.visible = ghostDisplayActive && event.target.checked;
      if (targetGhost) targetGhost.visible = false;
    });
  }

  function applyPreset(key, immediate) {
    const preset = presets[key];
    if (!preset) return;
    const next = {};
    jointDefs.forEach((joint, index) => {
      const raw = preset.angles[index] || 0;
      next[joint.name] = clamp(joint.unit === 'm' ? raw / 1000 : raw * DEG, joint.min, joint.max);
    });
    // A hardware preset is a target, not a browser-side animation.  Keep the
    // solid robot at measured feedback and show only the translucent target;
    // ros/rebot-ros-ui.js will advance the solid robot as joint_states arrive.
    if (!immediate && hardwareFeedbackDriven) {
      teachingPlayback = null;
      moveStart = 0;
      targetAngles = { ...next };
      updateGhostTarget(next);
      setGhostDisplay(true);
      emitJointBatch(next, 'preset', t(preset.label));
      return;
    }
    moveToAngles(next, immediate ? 1 : 850, {
      source: immediate ? 'init' : 'preset',
      label: t(preset.label),
      emitBatch: !immediate
    });
  }

  function setJoint(name, rad, fromUser, options) {
    const def = jointDefs.find((item) => item.name === name);
    if (!def) return;
    const value = clamp(rad, def.min, def.max);
    currentAngles[name] = value;

    if (name === 'gripper') {
      if (URDF_HAS_BUILTIN_GRIPPER) {
        const gj1 = getJoint(robot, 'gripper_joint1');
        const gj2 = getJoint(robot, 'gripper_joint2');
        const ratio = value / GRIPPER_COMMAND_MAX;
        if (gj1) {
          if (typeof gj1.setJointValue === 'function') gj1.setJointValue(ratio * GRIPPER_FINGER_TRAVEL_M);
          else if (typeof gj1.setAngle === 'function') gj1.setAngle(ratio * GRIPPER_FINGER_TRAVEL_M);
        }
        if (gj2) {
          if (typeof gj2.setJointValue === 'function') gj2.setJointValue(ratio * GRIPPER_FINGER_TRAVEL_M);
          else if (typeof gj2.setAngle === 'function') gj2.setAngle(ratio * GRIPPER_FINGER_TRAVEL_M);
        }
      } else {
        updateGripperVisual(gripperGroup, value);
        updateGripperVisual(ghostGripperGroup, value);
      }
    }

    const joint = getJoint(robot, name);
    if (joint) {
      if (typeof joint.setJointValue === 'function') {
        joint.setJointValue(value);
      } else if (typeof joint.setAngle === 'function') {
        joint.setAngle(value);
      }
    }
    if (name === 'gripper' && !URDF_HAS_BUILTIN_GRIPPER) {
      const leftFinger = getJoint(robot, 'finger_left');
      const rightFinger = getJoint(robot, 'finger_right');
      const fingerTravel = (value / GRIPPER_COMMAND_MAX) * GRIPPER_VISUAL_MAX * 0.5;
      if (leftFinger) {
        if (typeof leftFinger.setJointValue === 'function') {
          leftFinger.setJointValue(fingerTravel);
        } else if (typeof leftFinger.setAngle === 'function') {
          leftFinger.setAngle(fingerTravel);
        }
      }
      if (rightFinger) {
        if (typeof rightFinger.setJointValue === 'function') {
          rightFinger.setJointValue(-fingerTravel);
        } else if (typeof rightFinger.setAngle === 'function') {
          rightFinger.setAngle(-fingerTravel);
        }
      }
    }

    if (!fromUser) {
      const slider = document.getElementById(name);
      if (slider) slider.value = def.unit === 'm' ? (value * 1000).toFixed(0) : (value * RAD).toFixed(1);
    }
    updateJointLabel(name);

    const source = options && options.source ? options.source : (fromUser ? 'user' : 'sim');
    if (source !== 'ros' && !(options && options.emit === false)) {
      emitCommand({
        type: 'joint',
        name,
        value,
        source,
        phase: options && options.phase ? options.phase : 'commit',
        stamp: performance.now()
      });
    }
  }

  function setGhostJoint(name, rad) {
    if (name === 'gripper') {
      if (URDF_HAS_BUILTIN_GRIPPER) {
        const gj1 = getJoint(ghostRobot, 'gripper_joint1');
        const gj2 = getJoint(ghostRobot, 'gripper_joint2');
        const ratio = rad / GRIPPER_COMMAND_MAX;
        if (gj1) {
          if (typeof gj1.setJointValue === 'function') gj1.setJointValue(ratio * GRIPPER_FINGER_TRAVEL_M);
          else if (typeof gj1.setAngle === 'function') gj1.setAngle(ratio * GRIPPER_FINGER_TRAVEL_M);
        }
        if (gj2) {
          if (typeof gj2.setJointValue === 'function') gj2.setJointValue(ratio * GRIPPER_FINGER_TRAVEL_M);
          else if (typeof gj2.setAngle === 'function') gj2.setAngle(ratio * GRIPPER_FINGER_TRAVEL_M);
        }
      } else {
        const leftFinger = getJoint(ghostRobot, 'finger_left');
        const rightFinger = getJoint(ghostRobot, 'finger_right');
        const fingerTravel = (rad / GRIPPER_COMMAND_MAX) * GRIPPER_VISUAL_MAX * 0.5;
        if (leftFinger) {
          if (typeof leftFinger.setJointValue === 'function') {
            leftFinger.setJointValue(fingerTravel);
          } else if (typeof leftFinger.setAngle === 'function') {
            leftFinger.setAngle(fingerTravel);
          }
        }
        if (rightFinger) {
          if (typeof rightFinger.setJointValue === 'function') {
            rightFinger.setJointValue(-fingerTravel);
          } else if (typeof rightFinger.setAngle === 'function') {
            rightFinger.setAngle(-fingerTravel);
          }
        }
        updateGripperVisual(ghostGripperGroup, rad);
      }
      return;
    }
    const joint = getJoint(ghostRobot, name);
    if (!joint) return;
    if (typeof joint.setJointValue === 'function') {
      joint.setJointValue(rad);
    } else if (typeof joint.setAngle === 'function') {
      joint.setAngle(rad);
    }
  }

  function getJoint(root, name) {
    if (!root) return null;
    if (root.joints && root.joints[name]) return root.joints[name];
    return root.getObjectByName(name);
  }

  function moveToAngles(nextAngles, duration, options) {
    teachingPlayback = null;
    // 新轨迹会取代未完成的等待（任务编排据此感知被打断）
    flushMoveWaiters(false);
    moveStartAngles = { ...currentAngles };
    targetAngles = { ...nextAngles };
    moveStart = performance.now();
    moveDuration = Math.max(duration || 850, 1);
    updateGhostTarget(nextAngles);
    setGhostDisplay(true);
    if (options && options.emitBatch) {
      emitJointBatch(nextAngles, options.source || 'trajectory-target', options.label || '');
    }
  }

  function updateMotion(now) {
    if (!moveStart) return;
    const t = clamp((now - moveStart) / moveDuration, 0, 1);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    jointDefs.forEach((joint) => {
      const start = moveStartAngles[joint.name] ?? currentAngles[joint.name];
      const end = targetAngles[joint.name] ?? start;
      setJoint(joint.name, start + (end - start) * eased, false, { source: 'trajectory', emit: false });
    });
    if (t >= 1) {
      moveStart = 0;
      setGhostDisplay(false);
      flushMoveWaiters(true);
    }
  }

  function flushMoveWaiters(completed) {
    const waiters = Array.from(moveWaiters);
    moveWaiters.clear();
    waiters.forEach((waiter) => {
      try {
        waiter.resolve({ ok: Boolean(completed), epoch: motionEpoch });
      } catch (_) {}
    });
  }

  function updateGhostTarget(angles) {
    if (!ghostRobot) return;
    jointDefs.forEach((joint) => setGhostJoint(joint.name, angles[joint.name] ?? 0));
    ghostRobot.updateMatrixWorld(true);

    const pos = getTcpPosition(ghostRobot);
    if (pos) {
      targetGhost.position.copy(pos);
      targetGhost.userData.active = true;
      targetGhost.visible = false;
    }
  }

  function syncGhostToRobot() {
    if (!ghostRobot) return;
    jointDefs.forEach((joint) => setGhostJoint(joint.name, currentAngles[joint.name] ?? 0));
    ghostRobot.updateMatrixWorld(true);
  }

  function generateTrajectory() {
    if (!robot) return;
    stopPath();
    draggingTcp = false;
    dragSettling = false;
    setGhostDisplay(false);
    const joints = {};
    jointDefs.forEach((joint) => {
      if (joint.name !== 'gripper') joints[joint.name] = currentAngles[joint.name] ?? 0;
    });
    emitCommand({
      type: 'execute-current-pose',
      joints,
      source: 'current-pose-command',
      label: t('adv.plan'),
      stamp: performance.now()
    });
    setDragStatus(t('sim.currentPoseRequested'));
  }

  function toggleDragMode() {
    dragMode = !dragMode;
    draggingTcp = false;
    dragSettling = false;
    dragLastTime = 0;
    dragCommandAngles = null;
    setGhostDisplay(false);

    if (els.toggleDrag) {
      els.toggleDrag.textContent = dragMode ? t('sim.exitDrag') : t('adv.drag');
      els.toggleDrag.classList.toggle('active', dragMode);
    }
    if (els.dragMarker) {
      els.dragMarker.classList.toggle('active', dragMode);
      els.dragMarker.classList.remove('dragging');
      if (!dragMode) els.dragMarker.style.display = 'none';
    }
    if (els.dragHud) {
      els.dragHud.classList.toggle('active', dragMode);
    }

    const pos = getTcpPosition(robot);
    if (pos) {
      dragTarget.copy(pos);
      showTargetGhost(pos);
    }
    updateDragErrorLine();
    setDragStatus(dragMode ? t('sim.dragGreen') : t('app.dragDisabled'));
    updateDragMarker();
  }

  function startTcpDrag(event) {
    if (!dragMode || !robot) return;
    event.preventDefault();
    event.stopPropagation();
    // Preset/replay feedback animation may still own the solid robot even
    // after its ghost appears to have settled.  Give the ROS UI a synchronous
    // handoff point before the IK solver starts changing currentAngles.
    emitCommand({
      type: 'tcp-drag-start',
      source: 'tcp-drag',
      stamp: performance.now()
    });
    draggingTcp = true;
    setGhostDisplay(true);
    dragSettling = false;
    dragTargetClamped = false;
    stopPath();
    moveStart = 0;
    dragPointerId = event.pointerId;
    dragLastTime = performance.now();
    dragCommandAngles = { ...currentAngles };
    const handoffTcp = getTcpPosition(robot);
    if (handoffTcp) {
      // Re-anchor an already-enabled TCP teaching session at the current
      // post-preset feedback pose.  The old dragTarget belongs to the previous
      // drag and must not become an implicit command on pointer-down.
      dragTarget.copy(handoffTcp);
      showTargetGhost(handoffTcp, false);
    }
    dragPlane = createDragPlane();
    recordTeachingWaypoint(true);
    if (els.dragMarker) {
      els.dragMarker.classList.add('dragging');
      els.dragMarker.setPointerCapture(event.pointerId);
    }
    // Wait for a real pointermove before solving IK.  Calling moveTcpDrag on
    // pointer-down uses screen coordinates captured before the preset-feedback
    // handoff and can create one false jump.
  }

  function moveTcpDrag(event) {
    if (!draggingTcp || !dragPlane || !robot) return;
    dragSettling = false;
    const hit = screenToDragPlane(event.clientX, event.clientY, dragPlane);
    if (!hit) return;

    const boundedTarget = clampToWorkspaceEnvelope(hit);
    dragTarget.copy(boundedTarget.point);
    dragTargetClamped = boundedTarget.clamped;
    showTargetGhost(dragTarget, dragTargetClamped);

    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.012, (now - dragLastTime) / 1000 || 0.016));
    dragLastTime = now;

    let result = null;
    const substeps = Math.max(1, Math.ceil(dt / 0.016));
    for (let i = 0; i < substeps; i += 1) {
      result = IKSolver.servoStep(dragTarget, dt / substeps, {
        source: 'drag',
        emit: true,
        phase: 'input'
      });
    }
    if (result) dragCommandAngles = { ...currentAngles };

    syncGhostToRobot();
    recordTeachingWaypoint(false);
    updateDragMarker();
    updateDragErrorLine();
    if (result) {
      setDragStatus(`${dragTargetClamped ? t('sim.edgeSnap') : ''}误差 ${(result.error * 1000).toFixed(1)}mm`);
    }
  }

  function endTcpDrag(event) {
    if (!draggingTcp) return;
    draggingTcp = false;
    dragPlane = null;
    dragPointerId = null;
    const releasedTcp = getTcpPosition(robot);
    if (releasedTcp && releasedTcp.distanceTo(dragTarget) > DRAG_SETTLE_TARGET_ERROR) {
      dragSettling = true;
      dragSettleStart = performance.now();
      dragSettleLastTime = dragSettleStart;
      setDragStatus(t('sim.converging', { mm: (releasedTcp.distanceTo(dragTarget) * 1000).toFixed(1) }));
    }
    if (els.dragMarker) {
      els.dragMarker.classList.remove('dragging');
      if (event && els.dragMarker.hasPointerCapture(event.pointerId)) {
        els.dragMarker.releasePointerCapture(event.pointerId);
      }
    }
    recordTeachingWaypoint(true);
    if (dragSettling) return;
    dragTargetClamped = false;
    const tcp = getTcpPosition(robot);
    if (tcp) {
      setDragStatus(t('sim.doneMm', { mm: (tcp.distanceTo(dragTarget) * 1000).toFixed(1) }));
    }
    commitTcpDragTarget();
    setGhostDisplay(false);
  }

  function updateDragMarker() {
    if (!dragMode || !els.dragMarker || !camera || !robot) return;
    const pos = (draggingTcp || dragSettling) ? dragTarget : getTcpPosition(robot);
    if (!pos) return;

    const hostRect = els.host.getBoundingClientRect();
    const viewportRect = document.getElementById('viewport').getBoundingClientRect();
    const projected = pos.clone().project(camera);
    const x = hostRect.left - viewportRect.left + ((projected.x + 1) / 2) * hostRect.width;
    const y = hostRect.top - viewportRect.top + ((1 - projected.y) / 2) * hostRect.height;

    els.dragMarker.style.left = `${x}px`;
    els.dragMarker.style.top = `${y}px`;
    els.dragMarker.style.display = projected.z < 1 ? 'block' : 'none';
  }

  function updateDragSettling(now) {
    if (!dragMode || !dragSettling || draggingTcp || !robot) return;

    const dt = Math.min(0.05, Math.max(0.012, (now - dragSettleLastTime) / 1000 || 0.016));
    dragSettleLastTime = now;

    let result = null;
    const substeps = Math.max(1, Math.ceil(dt / 0.016));
    for (let i = 0; i < substeps; i += 1) {
      result = IKSolver.servoStep(dragTarget, dt / substeps, {
        source: 'drag-settle',
        emit: true,
        phase: 'input'
      });
    }
    if (result) dragCommandAngles = { ...currentAngles };

    syncGhostToRobot();
    recordTeachingWaypoint(false);
    showTargetGhost(dragTarget, dragTargetClamped);
    updateDragErrorLine();

    const elapsed = now - dragSettleStart;
    const fallbackTcp = result ? null : getTcpPosition(robot);
    const error = result ? result.error : (fallbackTcp ? fallbackTcp.distanceTo(dragTarget) : 0);
    if ((result && result.reached) || error <= DRAG_SETTLE_TARGET_ERROR) {
      dragSettling = false;
      dragTargetClamped = false;
      updateDragErrorLine();
      setDragStatus(t('sim.doneMm', { mm: (error * 1000).toFixed(1) }));
      commitTcpDragTarget();
      setGhostDisplay(false);
    } else if (elapsed >= DRAG_SETTLE_TIMEOUT_MS) {
      dragSettling = false;
      dragTargetClamped = false;
      updateDragErrorLine();
      setDragStatus(t('sim.bestEffortMm', { mm: (error * 1000).toFixed(1) }));
      commitTcpDragTarget();
      setGhostDisplay(false);
    } else {
      setDragStatus(t('sim.converging', { mm: (error * 1000).toFixed(1) }));
    }
  }

  function createDragPlane() {
    const tcp = getTcpPosition(robot) || new THREE.Vector3();
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, tcp);
  }

  function commitTcpDragTarget() {
    const finalAngles = dragCommandAngles
      ? { ...dragCommandAngles }
      : { ...currentAngles };
    // TCP IK only controls the arm.  Re-sending the measured gripper value on
    // pointer-up can wake the J7 stream even though the user never touched it.
    delete finalAngles.gripper;
    emitJointBatch(finalAngles, 'tcp-drag-commit', 'TCP 拖拽', {
      // All intermediate commands have already been streamed.  This batch is
      // only the exact final endpoint; after publishing it, the solid model
      // must stay on measured feedback and the target ghost must not re-open.
      handoffToFeedback: hardwareFeedbackDriven
    });
    dragCommandAngles = null;
  }

  function screenToDragPlane(clientX, clientY, plane) {
    const rect = els.host.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
  }

  function clampToWorkspaceEnvelope(pos) {
    const point = pos.clone();
    let clamped = false;
    const radius = Math.max(workspacePlanarReach, 0.05);
    const heightLimit = Math.max(workspaceVerticalReach, 0.05);

    if (point.y < 0) {
      point.y = 0;
      clamped = true;
    } else if (point.y > heightLimit) {
      point.y = heightLimit;
      clamped = true;
    }

    const verticalRatio = clamp(point.y / heightLimit, 0, 1);
    const planarLimit = Math.max(0.03, radius * Math.sqrt(Math.max(0, 1 - verticalRatio * verticalRatio)));
    const planar = Math.sqrt(point.x * point.x + point.z * point.z);
    if (planar > planarLimit) {
      const scale = planarLimit / planar;
      point.x *= scale;
      point.z *= scale;
      clamped = true;
    }

    return { point, clamped };
  }

  function updateDragErrorLine() {
    if (!dragErrorLine || !robot) return;
    const active = dragMode && (draggingTcp || dragSettling || dragTargetClamped);
    const tcp = active ? getTcpPosition(robot) : null;
    if (!active || !tcp) {
      dragErrorLine.visible = false;
      return;
    }

    const error = tcp.distanceTo(dragTarget);
    if (error < 0.001) {
      dragErrorLine.visible = false;
      return;
    }

    dragErrorLine.geometry.setFromPoints([tcp, dragTarget]);
    dragErrorLine.material.opacity = clamp(error / 0.08, 0.28, 0.9);
    dragErrorLine.visible = true;
  }

  function showTargetGhost(pos, clamped) {
    if (!targetGhost || !pos) return;
    targetGhost.position.copy(pos);
    targetGhost.userData.active = true;
    targetGhost.userData.clamped = !!clamped;
    if (targetGhost.material && targetGhost.material.color) {
      targetGhost.material.color.set(clamped ? 0xff6b5f : 0xf2a541);
      targetGhost.material.opacity = clamped ? 0.95 : 0.85;
    }
    targetGhost.visible = false;
  }

  function setDragStatus(text) {
    if (els.dragStatus) els.dragStatus.textContent = text;
  }

  function toggleTeachingRecord() {
    if (teachingRecording) {
      // Capture the release/final pose while recording is still active.
      recordTeachingWaypoint(true);
      teachingRecording = false;
    } else {
      teachingWaypoints = [];
      teachingStart = performance.now();
      teachingLastSample = 0;
      teachingPlayback = null;
      teachingRecording = true;
      if (!dragMode) toggleDragMode();
      recordTeachingWaypoint(true);
      if (els.teachExportText) els.teachExportText.value = '';
    }
    updateTeachingStatus();
  }

  function recordTeachingWaypoint(force) {
    if (!teachingRecording || !robot) return;
    const now = performance.now();
    if (!force && now - teachingLastSample < TEACH_SAMPLE_INTERVAL_MS) return;

    const tcp = getTcpPosition(robot);
    if (!tcp) return;
    const last = teachingWaypoints[teachingWaypoints.length - 1];
    if (!force && last && last.tcp && new THREE.Vector3(last.tcp.x, last.tcp.y, last.tcp.z).distanceTo(tcp) < TEACH_MIN_TCP_STEP) {
      return;
    }

    teachingLastSample = now;
    const ros = threeToRos(tcp);
    teachingWaypoints.push({
      t: Math.max(0, now - teachingStart),
      joints: { ...currentAngles },
      tcp: { x: tcp.x, y: tcp.y, z: tcp.z },
      tcp_ros: { x: ros.x, y: ros.y, z: ros.z }
    });
    updateTeachingStatus();
  }

  function replayTeaching() {
    if (!teachingWaypoints.length || !robot) {
      updateTeachingStatus('没有可回放的 waypoint');
      return;
    }
    teachingRecording = false;
    stopPath();
    moveStart = 0;
    const replayPoints = prepareTeachingReplay(teachingWaypoints);
    const playback = {
      points: replayPoints,
      index: 0,
      startedAt: performance.now(),
      startAngles: { ...currentAngles },
      rosControlled: false,
      feedbackDriven: false,
      smoothed: true
    };
    // DM starts its local playback state before doing any controller work.
    // Keep that ordering here so sending the ROS action cannot get a head
    // start over the browser animation.
    teachingPlayback = playback;
    let claimedByController = false;
    emitCommand({
      type: 'teaching-replay',
      waypoints: replayPoints,
      claim(options) {
        claimedByController = true;
        playback.rosControlled = true;
        playback.feedbackDriven = Boolean(options && options.feedbackDriven);
        updateTeachingStatus('示教轨迹已交给 ROS 执行');
      },
      complete(success, message) {
        if (teachingPlayback === playback && (playback.feedbackDriven || !success)) {
          teachingPlayback = null;
        }
        updateTeachingStatus(
          message || (success ? '真机示教回放完成' : '真机示教回放失败')
        );
      },
      stamp: performance.now()
    });
    updateTeachingStatus(
      claimedByController ? '正在同步回放网页动画和真机轨迹' : '正在回放示教轨迹'
    );
  }

  function prepareTeachingReplay(sourcePoints) {
    const source = sourcePoints
      .filter((point) => point && point.joints)
      .map((point) => ({
        t: Number(point.t) || 0,
        joints: { ...point.joints },
        tcp: point.tcp ? { ...point.tcp } : null,
        tcp_ros: point.tcp_ros ? { ...point.tcp_ros } : null
      }));
    if (source.length < 2) return source;

    const names = jointDefs.map((joint) => joint.name);
    const firstTime = source[0].t;
    source.forEach((point, index) => {
      point.t = Math.max(index ? source[index - 1].t + 1 : 0, point.t - firstTime);
    });

    // Zero-phase-like centered smoothing removes small IK reversals without
    // moving the recorded start/end poses.
    const smoothed = source.map((point, index) => {
      if (index === 0 || index === source.length - 1) return point;
      const joints = {};
      names.forEach((name) => {
        let weighted = 0;
        let totalWeight = 0;
        for (let offset = -2; offset <= 2; offset += 1) {
          const sampleIndex = clamp(index + offset, 0, source.length - 1);
          const value = Number(source[sampleIndex].joints[name]);
          if (!Number.isFinite(value)) continue;
          const weight = 3 - Math.abs(offset);
          weighted += value * weight;
          totalWeight += weight;
        }
        joints[name] = totalWeight ? weighted / totalWeight : Number(point.joints[name]) || 0;
      });
      return { ...point, joints };
    });

    const rawDurationMs = Math.max(1, smoothed[smoothed.length - 1].t);
    const sampleIntervalMs = Math.max(
      1000 / TEACH_REPLAY_SAMPLE_HZ,
      rawDurationMs / Math.max(TEACH_REPLAY_MAX_POINTS - 1, 1)
    );
    const resampled = [];
    let segment = 0;
    for (let sampleTime = 0; sampleTime < rawDurationMs; sampleTime += sampleIntervalMs) {
      while (segment < smoothed.length - 2 && smoothed[segment + 1].t < sampleTime) {
        segment += 1;
      }
      resampled.push(sampleTeachingSegment(smoothed, segment, sampleTime, names));
    }
    resampled.push({
      ...smoothed[smoothed.length - 1],
      joints: { ...smoothed[smoothed.length - 1].joints },
      rawT: rawDurationMs
    });

    // Return to the first recorded pose at the same limit as live TCP control,
    // then preserve the recorded clock.  The ROS controller is the single
    // authority that locally extends an actually unsafe Hermite segment.
    const returnSeconds = Math.max(
      0.15,
      maxArmJointDelta(currentAngles, resampled[0].joints) / TEACH_REPLAY_RETURN_SPEED_RAD_S
    );
    resampled.forEach((point) => {
      point.t = returnSeconds * 1000 + point.rawT;
    });
    return resampled.map(({ rawT, ...point }) => point);
  }

  function sampleTeachingSegment(points, index, sampleTime, names) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[Math.min(points.length - 1, index + 1)];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const span = Math.max(1, p2.t - p1.t);
    const u = clamp((sampleTime - p1.t) / span, 0, 1);
    const joints = {};
    names.forEach((name) => {
      const v0 = Number(p0.joints[name]) || 0;
      const v1 = Number(p1.joints[name]) || 0;
      const v2 = Number(p2.joints[name]) || 0;
      const v3 = Number(p3.joints[name]) || 0;
      const u2 = u * u;
      const u3 = u2 * u;
      const value = 0.5 * (
        2 * v1 +
        (-v0 + v2) * u +
        (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 +
        (-v0 + 3 * v1 - 3 * v2 + v3) * u3
      );
      joints[name] = clamp(value, Math.min(v1, v2), Math.max(v1, v2));
    });
    return { t: sampleTime, rawT: sampleTime, joints };
  }

  function maxArmJointDelta(left, right) {
    let maximum = 0;
    jointDefs.forEach((joint) => {
      if (joint.name === 'gripper') return;
      const a = Number(left && left[joint.name]);
      const b = Number(right && right[joint.name]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        maximum = Math.max(maximum, Math.abs(b - a));
      }
    });
    return maximum;
  }

  function updateTeachingPlayback(now) {
    if (!teachingPlayback) return;
    const playback = teachingPlayback;
    // In hardware mode the solid robot follows interpolated /joint_states.
    // Keep this object only as replay lifecycle state; never overwrite actual
    // feedback with the ideal local trajectory.
    if (playback.feedbackDriven) return;
    const points = playback.points;
    if (!points.length) {
      teachingPlayback = null;
      updateTeachingStatus('回放完成');
      return;
    }

    // Use the absolute replay clock, matching FollowJointTrajectory's
    // time_from_start. A delayed frame therefore catches up immediately
    // instead of adding its delay to every following segment.
    const elapsed = Math.max(0, now - playback.startedAt);
    while (playback.index < points.length && elapsed >= Number(points[playback.index].t || 0)) {
      playback.index += 1;
    }

    if (playback.index >= points.length) {
      const finalPoint = points[points.length - 1];
      jointDefs.forEach((joint) => {
        const value = finalPoint.joints[joint.name];
        if (Number.isFinite(Number(value))) {
          setJoint(joint.name, Number(value), false, { source: 'teach-replay', emit: false });
        }
      });
      teachingPlayback = null;
      syncGhostToRobot();
      updateTeachingStatus('回放完成');
      return;
    }

    const right = points[playback.index];
    const left = playback.index > 0
      ? points[playback.index - 1]
      : { t: 0, joints: playback.startAngles };
    const leftTime = Math.max(0, Number(left.t) || 0);
    const rightTime = Math.max(leftTime + 1, Number(right.t) || leftTime + 1);
    const t = clamp((elapsed - leftTime) / (rightTime - leftTime), 0, 1);
    const eased = playback.smoothed
      ? t
      : t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2;
    jointDefs.forEach((joint) => {
      const start = left.joints[joint.name] ?? currentAngles[joint.name] ?? 0;
      const end = right.joints[joint.name] ?? start;
      setJoint(joint.name, start + (end - start) * eased, false, {
        source: 'teach-replay',
        emit: false
      });
    });
  }

  function exportTeachingWaypoints() {
    if (!teachingWaypoints.length) {
      updateTeachingStatus('没有可导出的 waypoint');
      return;
    }
    const jointNames = jointDefs.map((joint) => joint.name);
    const payload = {
      format: 'rebotarm_ros_waypoints_v1',
      frame_id: 'base_link',
      joint_names: jointNames,
      count: teachingWaypoints.length,
      waypoints: teachingWaypoints.map((point) => ({
        time_from_start: {
          sec: Math.floor(point.t / 1000),
          nanosec: Math.round((point.t % 1000) * 1e6)
        },
        positions: jointNames.map((name) => point.joints[name] ?? 0),
        tcp_ros: point.tcp_ros
      }))
    };
    const text = JSON.stringify(payload, null, 2);
    if (els.teachExportText) {
      els.teachExportText.value = text;
      els.teachExportText.focus();
      els.teachExportText.select();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    updateTeachingStatus(t('sim.exported', { n: teachingWaypoints.length }));
  }

  function clearTeaching() {
    teachingRecording = false;
    teachingPlayback = null;
    teachingWaypoints = [];
    if (els.teachExportText) els.teachExportText.value = '';
    updateTeachingStatus();
  }

  function updateTeachingStatus(message) {
    if (els.teachRecord) {
      els.teachRecord.textContent = teachingRecording ? t('sim.stopRecord') : t('teach.record');
      els.teachRecord.classList.toggle('active', teachingRecording);
    }
    if (!els.teachStatus) return;
    if (message) {
      els.teachStatus.textContent = message;
    } else if (teachingRecording) {
      els.teachStatus.textContent = t('sim.recording', { n: teachingWaypoints.length });
    } else if (teachingPlayback) {
      els.teachStatus.textContent = t('sim.replaying');
    } else if (teachingWaypoints.length) {
      const duration = teachingWaypoints[teachingWaypoints.length - 1].t / 1000;
      els.teachStatus.textContent = t('sim.recorded', { n: teachingWaypoints.length, sec: duration.toFixed(1) });
    } else {
      els.teachStatus.textContent = t('teach.status');
    }
  }

  function planTcpMoveTo(target, label) {
    stopPath();
    moveStart = 0;
    showTargetGhost(target);

    const start = { ...currentAngles };
    const solved = solveIKTarget(target, 240, 900);
    applyRobotAngles(robot, start);
    Object.entries(start).forEach(([name, value]) => {
      setJoint(name, value, false, { source: 'ros' });
    });

    if (!solved || !solved.angles) {
      setDragStatus(t('sim.unreachable', { label: label || '点击位置' }));
      return;
    }

    moveToAngles({ ...currentAngles, ...solved.angles }, 900);
    setDragStatus(t('sim.planTarget', { label: label || '点击位置', mm: (solved.error * 1000).toFixed(1) }));
  }

  function solveIKTarget(target, maxIter, timeoutMs, orientation) {
    const started = performance.now();
    let result = null;
    let bestScore = Infinity;
    let bestAngles = null;

    for (let i = 0; i < maxIter; i += 1) {
      result = IKSolver.servoStep(target, 0.016, { source: 'solver', orientation });
      // 记录历史最优（位置 + 朝向加权），迭代发散时回滚，保证单调不退化
      const pos = getTcpPosition(robot);
      const posErr = pos ? pos.distanceTo(target) : Infinity;
      const rotErr = orientation
        ? 1 - clamp(getToolAxis(robot).dot(orientation), -1, 1)
        : 0;
      const score = posErr + rotErr * 0.08;
      if (score < bestScore) {
        bestScore = score;
        bestAngles = { ...currentAngles };
      }
      if (result && result.reached) break;
      if (performance.now() - started > timeoutMs) break;
    }

    if (bestAngles) {
      Object.entries(bestAngles).forEach(([name, value]) => {
        if (Number.isFinite(Number(value))) setJoint(name, Number(value), false, { source: 'solver', emit: false });
      });
      robot.updateMatrixWorld(true);
    }
    const finalPos = getTcpPosition(robot);
    const finalError = finalPos ? finalPos.distanceTo(target) : Infinity;
    const finalRot = orientation ? 1 - clamp(getToolAxis(robot).dot(orientation), -1, 1) : 0;
    return {
      angles: { ...currentAngles },
      error: finalError,
      reached: finalError < 0.0015 && finalRot < 0.03
    };
  }

  const ORIENTATION_DOWN = new THREE.Vector3(0, -1, 0);

  // 网格全局播种：在 (j1±yaw, j2, j3, j4) 粗网格上做 FK，
  // 找“工具轴竖直朝下且 TCP 离目标最近”的关节种子，供姿态抛光收敛
  function findTopDownSeed(target) {
    if (!robot) return null;
    const j2def = jointDefs.find((joint) => joint.name === 'joint2');
    const j3def = jointDefs.find((joint) => joint.name === 'joint3');
    const j4def = jointDefs.find((joint) => joint.name === 'joint4');
    if (!j2def || !j3def || !j4def) return null;

    const yaw = Math.atan2(-target.z, target.x);
    const startAngles = { ...currentAngles };
    let best = null;

    const trySeed = (j1, j2, j3, j4, j5) => {
      setJoint('joint1', j1, false, { source: 'seed', emit: false });
      setJoint('joint2', j2, false, { source: 'seed', emit: false });
      setJoint('joint3', j3, false, { source: 'seed', emit: false });
      setJoint('joint4', j4, false, { source: 'seed', emit: false });
      setJoint('joint5', j5, false, { source: 'seed', emit: false });
      robot.updateMatrixWorld(true);
      const pos = getTcpPosition(robot);
      if (!pos) return;
      if (getToolAxis(robot).y > -0.88) return;
      const d = pos.distanceTo(target);
      if (!best || d < best.d) {
        best = {
          d,
          angles: {
            ...startAngles,
            joint1: j1, joint2: j2, joint3: j3, joint4: j4, joint5: j5
          }
        };
      }
    };

    for (const j1 of [yaw, -yaw]) {
      for (let a = 0.35; a <= 2.75; a += 0.48) {
        for (let b = 0.2; b <= 2.8; b += 0.52) {
          for (const c of [-1.5, -0.75, 0, 0.75, 1.5]) {
            for (const e of [-1.5, -0.75, 0, 0.75, 1.5]) {
              trySeed(j1, a, b, c, e);
            }
          }
        }
      }
    }

    // 恢复当前姿态（种子只是求解起点）
    applyRobotAngles(robot, startAngles);
    Object.entries(startAngles).forEach(([name, value]) => {
      setJoint(name, value, false, { source: 'seed', emit: false });
    });
    robot.updateMatrixWorld(true);
    return best;
  }

  // 任务编排专用：TCP 目标运动（ROS 坐标，米），返回 Promise<{ok, error, epoch}>
  function moveTcpTo(targetRos, durationMs, options) {
    return new Promise((resolve) => {
      if (!robot) {
        resolve({ ok: false, error: Infinity, epoch: motionEpoch });
        return;
      }
      const opts = options || {};
      if (dragMode) {
        resolve({ ok: false, error: Infinity, epoch: motionEpoch, reason: 'drag' });
        return;
      }
      const target = new THREE.Vector3(
        Number(targetRos.x) || 0,
        Number(targetRos.z) || 0,
        -(Number(targetRos.y) || 0)
      );
      const bounded = clampToWorkspaceEnvelope(target);
      stopPath();
      teachingPlayback = null;
      moveStart = 0;

      const start = { ...currentAngles };
      // 抓取类移动：先网格全局播种（工具朝下 + TCP 靠近目标），
      // 再从种子做位置 + 姿态的 DLS 抛光，保证稳定收敛
      if (opts.orientation) {
        const seed = findTopDownSeed(bounded.point);
        if (seed) {
          Object.entries(seed.angles).forEach(([name, value]) => {
            if (Number.isFinite(Number(value))) setJoint(name, Number(value), false, { source: 'seed', emit: false });
          });
          robot.updateMatrixWorld(true);
        }
      } else {
        solveIKTarget(bounded.point, opts.maxIterA || 300, opts.timeoutMsA || 1200, null);
      }
      const solved = solveIKTarget(
        bounded.point,
        opts.maxIter || 560,
        opts.timeoutMs || 2400,
        opts.orientation ? ORIENTATION_DOWN : null
      );
      // 抓取类移动要求工具轴充分朝下（允许 ~35° 内倾斜换可达性）
      if (opts.orientation) {
        const axis = getToolAxis(robot);
        if (axis.y > -0.82) {
          applyRobotAngles(robot, start);
          Object.entries(start).forEach(([name, value]) => {
            setJoint(name, value, false, { source: 'ros' });
          });
          syncGhostToRobot();
          resolve({ ok: false, error: solved.error, epoch: motionEpoch, reason: 'orient' });
          return;
        }
      }
      // 恢复起始姿态后按求解结果插值播放
      applyRobotAngles(robot, start);
      Object.entries(start).forEach(([name, value]) => {
        setJoint(name, value, false, { source: 'ros' });
      });
      syncGhostToRobot();

      if (!solved.reached && solved.error > 0.035) {
        let seedD = null;
        let seedAxisY = null;
        if (opts.orientation) {
          const probe = findTopDownSeed(bounded.point);
          if (probe) {
            seedD = probe.d;
            Object.entries(probe.angles).forEach(([name, value]) => {
              if (Number.isFinite(Number(value))) setJoint(name, Number(value), false, { source: 'seed', emit: false });
            });
            robot.updateMatrixWorld(true);
            seedAxisY = getToolAxis(robot).y;
          }
        }
        resolve({ ok: false, error: solved.error, epoch: motionEpoch, reason: 'ik', seedD, seedAxisY });
        return;
      }

      // 先启动轨迹再登记等待：moveToAngles 会 flush 掉旧的 waiter
      const waiter = { resolve, epoch: motionEpoch };
      moveToAngles({ ...start, ...solved.angles }, Math.max(durationMs || 1200, 200), {
        source: 'task'
      });
      moveWaiters.add(waiter);
    });
  }

  // 传送带跟随：每帧把 TCP 伺服到「方块实时位置 + offset」。
  // 抓取时方块不会被钉住，而是机械臂追着它走 —— 夹爪始终罩在方块上，
  // 不会出现方块从夹爪侧面「穿」过去的情况。
  function trackBlockTo(snapshot, offset, options) {
    return new Promise((resolve) => {
      const opts = options || {};
      const epoch = motionEpoch;
      const offsetVec = new THREE.Vector3(offset.x || 0, offset.y || 0, offset.z || 0);
      const timeoutMs = Math.max(200, opts.timeoutMs || 1500);
      const tolerance = opts.tolerance || 0.004;
      const settleFrames = opts.settleFrames == null ? 3 : opts.settleFrames;
      const started = performance.now();
      let lastStep = started;
      let settledAt = 0;
      let done = false;

      stopPath();
      teachingPlayback = null;
      moveStart = 0;
      flushMoveWaiters(false);
      syncGhostToRobot();

      const finish = (ok, error) => {
        if (done) return;
        done = true;
        resolve({ ok, error, epoch });
      };

      const step = () => {
        if (done) return;
        if (epoch !== motionEpoch || !robot) {
          finish(false, Infinity);
          return;
        }
        const block = findBlockBySnapshot(snapshot);
        if (!block) {
          finish(false, Infinity);
          return;
        }
        const goal = block.mesh.position.clone().add(offsetVec);
        // 比例伺服跟匀速目标必然留下 v/gain 的稳态滞后（这里约 4.6mm）。
        // 不补这份滞后：方块永远偏在夹爪后面几毫米 —— 判定阈值够不着（每次都靠超时
        // 兜底），夹爪闭合时也得为这份偏心让出空间，看着就像「夹了个空气」。
        if (conveyorRunning) goal.z += BELT_SPEED / IKSolver.gain;
        // 按真实经过时间拆成多个子步，帧率高低都不会改变跟随速度
        const frameNow = performance.now();
        const stepDt = Math.min(0.08, Math.max(0.012, (frameNow - lastStep) / 1000 || 0.016));
        lastStep = frameNow;
        const substeps = Math.max(1, Math.ceil(stepDt / 0.016));
        let result = null;
        for (let i = 0; i < substeps; i += 1) {
          result = IKSolver.servoStep(goal, stepDt / substeps, {
            orientation: opts.orientation === false ? null : ORIENTATION_DOWN,
            source: 'task-track'
          });
        }
        const error = result ? result.error : Infinity;
        const elapsed = performance.now() - started;
        // 伺服天然会落后运动中的目标约一帧行程，判定阈值要把这一帧补回来，
        // 否则帧率一低就永远「到不了位」
        const frameLag = (conveyorRunning ? BELT_SPEED : 0) * stepDt;
        if (error <= tolerance + frameLag) {
          if (!settledAt) settledAt = elapsed;
        } else {
          settledAt = 0;
        }
        if (settledAt && elapsed - settledAt > settleFrames * 17) {
          finish(true, error);
          return;
        }
        if (elapsed > timeoutMs) {
          finish(error <= tolerance * 3 + frameLag, error);
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function openGripper(durationMs) {
    return new Promise((resolve) => {
      gripperWaiters.add(resolve);
      setGripperWidth(GRIPPER_COMMAND_MAX, { source: 'task', duration: durationMs || 420 });
      if (!gripperMotion) {
        gripperWaiters.delete(resolve);
        resolve();
      }
    });
  }

  function closeGripper(durationMs) {
    return new Promise((resolve) => {
      gripperWaiters.add(resolve);
      setGripperWidth(gripWidthForBlock(nearestGraspableBlock()), {
        source: 'task',
        duration: durationMs || 480
      });
      if (!gripperMotion) {
        gripperWaiters.delete(resolve);
        resolve();
      }
    });
  }

  function applyRobotAngles(root, angles) {
    if (!root) return;
    IKSolver.jointNames.forEach((name) => {
      const joint = getJoint(root, name);
      if (!joint) return;
      const value = angles[name] ?? 0;
      if (typeof joint.setJointValue === 'function') {
        joint.setJointValue(value);
      } else if (typeof joint.setAngle === 'function') {
        joint.setAngle(value);
      }
    });
    root.updateMatrixWorld(true);
  }

  const IKSolver = {
    jointNames: jointDefs.filter((joint) => joint.name !== 'gripper').map((joint) => joint.name),
    gain: 12,
    minDamping: 0.018,
    // 奇异度拉满时的阻尼上限。基线阻尼已经按 gram 量级取到 ~0.15，
    // 所以这个上限必须比它高，否则「靠近奇异时加阻尼」这一档等于没开
    maxDamping: 0.35,
    singularityThreshold: 0.08,
    maxJointSpeed: 2.8,
    orientationGain: 1.0,

    servoStep(target, dt, options) {
      if (!target || !robot || dt <= 0) return null;
      const current = getTcpPosition(robot);
      if (!current) return null;
      const desiredDir = options && options.orientation ? options.orientation : null;
      const toolDir = getToolAxis(robot);
      const error = new THREE.Vector3().subVectors(target, current);
      const errorNorm = error.length();
      // 姿态误差：向量差（Gauss-Newton 意义下的速度方向），而非旋转轴
      const rotError = desiredDir
        ? new THREE.Vector3().subVectors(desiredDir, toolDir)
        : null;
      const rotNorm = rotError ? rotError.length() : 0;
      if (errorNorm < 0.0015 && rotNorm < 0.04) {
        return { error: errorNorm, reached: true };
      }

      const stepError = error.multiplyScalar(Math.min(0.65, Math.max(0.08, this.gain * dt)));
      const jacobian = this.computeJacobian(currentAngles);
      const delta = this.solveDampedLeastSquares(jacobian, stepError, desiredDir, toolDir);
      if (!delta) return { error: errorNorm, reached: false };

      // 关节步长整体等比缩放，而不是逐关节裁剪：逐关节裁剪会改变解的方向，
      // 饱和的关节不动、其它关节照走，TCP 反而越走越偏（抓取下探时手臂乱甩的根源之一）。
      const maxStep = this.maxJointSpeed * dt;
      let peak = 0;
      for (let i = 0; i < delta.length; i += 1) {
        peak = Math.max(peak, Math.abs(delta[i] || 0));
      }
      const stepScale = peak > maxStep ? maxStep / peak : 1;
      this.jointNames.forEach((name, index) => {
        const def = jointDefs.find((joint) => joint.name === name);
        const scaledDelta = (delta[index] || 0) * stepScale;
        setJoint(
          name,
          clamp((currentAngles[name] || 0) + scaledDelta, def.min, def.max),
          false,
          {
            source: options && options.source ? options.source : 'drag',
            emit: Boolean(options && options.emit),
            phase: options && options.phase ? options.phase : 'commit'
          }
        );
      });

      robot.updateMatrixWorld(true);
      const after = getTcpPosition(robot);
      const afterError = after ? after.distanceTo(target) : errorNorm;
      return { error: afterError, reached: afterError < 0.0015 };
    },

    computeJacobian(baseAngles) {
      const eps = 0.004;
      const saved = { ...baseAngles };
      const rows = [[], [], []];
      const axes = [];

      this.jointNames.forEach((name, index) => {
        const joint = getJoint(robot, name);
        if (joint) {
          const axis = new THREE.Vector3(
            joint.axis ? joint.axis.x : 0,
            joint.axis ? joint.axis.y : 0,
            joint.axis ? joint.axis.z : 1
          );
          axis.applyQuaternion(joint.getWorldQuaternion(new THREE.Quaternion()));
          if (axis.lengthSq() > 1e-9) axis.normalize();
          axes.push(axis);
        } else {
          axes.push(new THREE.Vector3(0, 1, 0));
        }

        const plus = { ...saved, [name]: (saved[name] || 0) + eps };
        const minus = { ...saved, [name]: (saved[name] || 0) - eps };

        applyRobotAngles(robot, plus);
        const plusPos = getTcpPosition(robot);
        applyRobotAngles(robot, minus);
        const minusPos = getTcpPosition(robot);

        rows[0][index] = plusPos && minusPos ? (plusPos.x - minusPos.x) / (2 * eps) : 0;
        rows[1][index] = plusPos && minusPos ? (plusPos.y - minusPos.y) / (2 * eps) : 0;
        rows[2][index] = plusPos && minusPos ? (plusPos.z - minusPos.z) / (2 * eps) : 0;
      });

      applyRobotAngles(robot, saved);
      return { pos: rows, axes, toolDir: getToolAxis(robot) };
    },

    solveDampedLeastSquares(jac, error, desiredDir, toolDir) {
      const pos = jac.pos;
      const n = this.jointNames.length;
      const hasOri = Boolean(desiredDir && toolDir);
      const oriWeight = 0.45;
      const jRows = hasOri
        ? [
          pos[0],
          pos[1],
          pos[2],
          jac.axes.map((axis) => axis.clone().cross(toolDir).x * oriWeight),
          jac.axes.map((axis) => axis.clone().cross(toolDir).y * oriWeight),
          jac.axes.map((axis) => axis.clone().cross(toolDir).z * oriWeight)
        ]
        : [pos[0], pos[1], pos[2]];
      const m = jRows.length;

      const gram = [];
      for (let r = 0; r < m; r += 1) {
        gram.push([]);
        for (let c = 0; c < m; c += 1) {
          gram[r].push(dotRows(jRows[r], jRows[c]));
        }
      }

      // det(JJ^T) normalized by its mean eigenvalue is scale-independent:
      // close to zero means the TCP Jacobian is approaching a singular pose.
      const posGram = [
        [dotRows(pos[0], pos[0]), dotRows(pos[0], pos[1]), dotRows(pos[0], pos[2])],
        [dotRows(pos[1], pos[0]), dotRows(pos[1], pos[1]), dotRows(pos[1], pos[2])],
        [dotRows(pos[2], pos[0]), dotRows(pos[2], pos[1]), dotRows(pos[2], pos[2])]
      ];
      const scale = Math.max((posGram[0][0] + posGram[1][1] + posGram[2][2]) / 3, 1e-9);
      const normalizedDeterminant = Math.max(0, determinant3x3(posGram)) /
        Math.max(scale * scale * scale, 1e-12);
      const singularity = clamp(
        1 - normalizedDeterminant / this.singularityThreshold,
        0,
        1
      );
      // 阻尼要跟着 gram 的量级走，这是 DLS 的常规做法。这个臂的 j2/j3/j4 轴互相平行，
      // 姿态误差又用了 3 行「工具轴向量差」（其中沿工具轴那一维根本不可控），
      // 所以 J·Jᵀ 天生秩亏，最小特征值只有 ~1e-3：固定 lambda=0.018 等于把这条
      // 不可控方向放大几百倍，解出来的关节速度全是噪声 —— 抓取下探时手臂被甩到关节
      // 限位、夹爪斜着插进方块，根因就在这里。
      const gramScale = Math.max(
        gram.reduce((sum, row, index) => sum + row[index], 0) / m,
        1e-9
      );
      const damping = Math.max(
        this.minDamping,
        Math.sqrt(gramScale) * 0.35,
        this.maxDamping * singularity * singularity
      );
      const lambda2 = damping * damping;
      const a = gram.map((row, r) => row.map((value, c) => (r === c ? value + lambda2 : value)));
      const oriError = hasOri
        ? new THREE.Vector3().subVectors(desiredDir, toolDir).multiplyScalar(this.orientationGain)
        : null;
      const b = hasOri
        ? [error.x, error.y, error.z, oriError.x * oriWeight, oriError.y * oriWeight, oriError.z * oriWeight]
        : [error.x, error.y, error.z];
      const y = solveLinear(a, b);
      if (!y) return null;
      const delta = new Array(n).fill(0);
      for (let r = 0; r < m; r += 1) {
        for (let i = 0; i < n; i += 1) {
          delta[i] += jRows[r][i] * y[r];
        }
      }
      return delta;
    }
  };

  function dotRows(a, b) {
    return a.reduce((sum, value, index) => sum + value * (b[index] || 0), 0);
  }

  function determinant3x3(a) {
    return (
      a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
      a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
      a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
    );
  }

  // 通用高斯消元（带部分主元），用于 DLS 正规方程
  function solveLinear(a, b) {
    const n = b.length;
    const m = a.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col += 1) {
      let pivot = col;
      for (let row = col + 1; row < n; row += 1) {
        if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
      }
      if (Math.abs(m[pivot][col]) < 1e-9) return null;
      if (pivot !== col) {
        const tmp = m[pivot];
        m[pivot] = m[col];
        m[col] = tmp;
      }
      for (let row = 0; row < n; row += 1) {
        if (row === col) continue;
        const factor = m[row][col] / m[col][col];
        if (!factor) continue;
        for (let c = col; c <= n; c += 1) {
          m[row][c] -= factor * m[col][c];
        }
      }
    }
    return m.map((row, i) => row[n] / row[i]);
  }

  function updateJointLabel(name) {
    const def = jointDefs.find((item) => item.name === name);
    const label = document.getElementById(`${name}-value`);
    if (!label || !def) return;
    if (def.unit === 'm') {
      const widthMm = currentAngles[name] * 1000;
      label.textContent = t('joint.gripSuffix', { val: widthMm.toFixed(0) });
      const readout = document.getElementById('gripper-width');
      if (readout) readout.textContent = t('joint.gripSuffix', { val: widthMm.toFixed(0) });
      return;
    }
    label.textContent = t('joint.degSuffix', { val: (currentAngles[name] * RAD).toFixed(1) });
  }

  function setGripperWidth(widthM) {
    stopPath();
    moveToAngles({ ...currentAngles, gripper: clamp(widthM, 0, GRIPPER_COMMAND_MAX) }, 450);
  }

 function emitCommand(command) {
   commandListeners.forEach((listener) => {
     try {
       listener({ ...command });
     } catch (error) {
       console.warn('Command listener failed:', error);
     }
   });
 }

  function emitJointBatch(angles, source, label, options) {
    const joints = {};
    jointDefs.forEach((joint) => {
      if (typeof angles[joint.name] === 'number') {
        joints[joint.name] = angles[joint.name];
      }
    });
    if (!Object.keys(joints).length) return;
    emitCommand({
      type: 'joint-batch',
      joints,
      source,
      label,
      handoffToFeedback: Boolean(options && options.handoffToFeedback),
      stamp: performance.now()
    });
  }

  function playPath() {
    const sequence = ['ready', 'left', 'inspect', 'forward', 'right', 'ready'];
    animation = { sequence, index: 0, nextAt: 0 };
  }

  function stopPath() {
    animation = null;
  }

  function stopActiveMotion() {
    stopPath();
    teachingPlayback = null;
    moveStart = 0;
    gripperMotion = null;
    draggingTcp = false;
    dragSettling = false;
    motionEpoch += 1;
    flushMoveWaiters(false);
    flushGripperWaiters();
    setGhostDisplay(false);
    if (dragMode) toggleDragMode();
    updateTeachingStatus();
  }

  function updatePath(now) {
    if (!animation || moveStart) return;
    if (now < animation.nextAt) return;
    applyPreset(animation.sequence[animation.index]);
    animation.index = (animation.index + 1) % animation.sequence.length;
    animation.nextAt = now + 1350;
  }

  function updateTcpHud() {
    const pos = getTcpPosition(robot);
    if (!pos) return;
    tcpMarker.position.copy(pos);

    const ros = threeToRos(pos);
    const planar = Math.sqrt(ros.x * ros.x + ros.y * ros.y);
    const spatial = Math.sqrt(ros.x * ros.x + ros.y * ros.y + ros.z * ros.z);
    els.tcp.textContent = `X ${mm(ros.x)} / Y ${mm(ros.y)} / Z ${mm(ros.z)}`;
    els.reach.textContent = t('sim.reachText', { planar: Math.round(planar * 1000), workspace: Math.round(workspacePlanarReach * 1000), spatial: Math.round(spatial * 1000) });
    els.reach.style.color = planar <= workspacePlanarReach ? '#d7fff4' : '#ffd1c9';
  }

  function getTcpLink(root) {
    if (!root) return null;
    return root.getObjectByName('gripper_end') || root.getObjectByName('end_link') || root.getObjectByName('link6') || root;
  }

  function getTcpPosition(root) {
    if (!root) return null;
    const link = getTcpLink(root);
    link.updateMatrixWorld(true);
    const pos = new THREE.Vector3();
    link.getWorldPosition(pos);
    return pos;
  }

  function threeToRos(v) {
    return { x: v.x, y: -v.z, z: v.y };
  }

  function mm(value) {
    return t('sim.mmShort', { val: Math.round(value * 1000) });
  }

  function getToolAxis(root) {
    if (!root) return new THREE.Vector3(0, -1, 0);
    const j1 = getJoint(root, 'gripper_joint1');
    const j2 = getJoint(root, 'gripper_joint2');
    if (!j1 || !j2) return new THREE.Vector3(0, -1, 0);
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    j1.getWorldPosition(p1);
    j2.getWorldPosition(p2);
    const tcp = getTcpPosition(root);
    if (!tcp) return new THREE.Vector3(0, -1, 0);
    // TCP（gripper_end 原点）位于指尖侧，指关节在其后方：工具指向 = 指关节 → TCP
    const dir = tcp.clone().sub(p1.add(p2).multiplyScalar(0.5));
    if (dir.lengthSq() < 1e-8) return new THREE.Vector3(0, -1, 0);
    return dir.normalize();
  }

  // 夹爪指尖抓取点（世界坐标）：TCP 沿工具轴外推
  function getGraspPoint(root) {
    const tcp = getTcpPosition(root);
    if (!tcp) return null;
    return tcp.clone().add(getToolAxis(root).clone().multiplyScalar(GRASP_STICKOUT));
  }

  // 握持时按「抓取瞬间记录下来的相对位姿」跟随 TCP。
  // 早期实现固定把方块沿工具轴外推 GRASP_STICKOUT，会把方块压进带面里。
  function updateCarriedObject() {
    if (!carriedObject || !carriedObject.block || !robot) return;
    const link = getTcpLink(robot);
    if (!link) return;
    link.updateMatrixWorld(true);
    const tcp = new THREE.Vector3();
    link.getWorldPosition(tcp);
    const target = carriedObject.offset.clone()
      .applyQuaternion(link.getWorldQuaternion(new THREE.Quaternion()))
      .add(tcp);
    carriedObject.block.mesh.position.lerp(target, 0.55);
  }

  // 夹爪附近、真正夹得住的那一块（闭合与吸附共用同一套判定）
  function nearestGraspableBlock() {
    if (!robot) return null;
    const grasp = getGraspPoint(robot);
    if (!grasp) return null;
    let best = null;
    let bestScore = Infinity;
    blocks.forEach((block) => {
      if (block.state === 'carried' || block.state === 'binned' || block.state === 'falling') return;
      const p = block.mesh.position;
      const planar = Math.hypot(p.x - grasp.x, p.z - grasp.z);
      const dy = Math.abs(p.y - grasp.y);
      if (planar > GRASP_ACCEPT_PLANAR || dy > GRASP_ACCEPT_DY) return;
      const score = planar + dy * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = block;
      }
    });
    return best;
  }

  // 闭合指令：指面内侧面在 gripper_end 局部系里恒为 y = ±行程，
  // 要不切进方块就得 间隙 = 2×方块沿闭合方向的半宽 + 2×余量。
  // 方块偏心时半宽自动变大 —— 指面跟着停在方块外面，而不是按固定 45mm 硬夹。
  function gripWidthForBlock(block) {
    if (!block || !robot) return GRIPPER_GRASP_WIDTH;
    const link = getTcpLink(robot);
    if (!link) return GRIPPER_GRASP_WIDTH;
    link.updateMatrixWorld(true);
    const toLocal = new THREE.Matrix4().copy(link.matrixWorld).invert();
    const p = block.mesh.position;
    const corner = new THREE.Vector3();
    let half = 0;
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          corner
            .set(p.x + sx * BLOCK_HALF, p.y + sy * BLOCK_HALF, p.z + sz * BLOCK_HALF)
            .applyMatrix4(toLocal);
          half = Math.max(half, Math.abs(corner.y));
        }
      }
    }
    return clamp((2 * half + 2 * GRASP_CLEARANCE) / GRIPPER_GAP_PER_COMMAND, 0, GRIPPER_COMMAND_MAX);
  }

  // 闭合夹爪后调用：抓取 TCP 附近的方块
  function tryGraspNearTcp() {
    const best = nearestGraspableBlock();
    if (!best) return null;
    attachBlock(best);
    return best.color;
  }

  function attachBlock(block) {
    if (carriedObject && carriedObject.block === block) return true;
    if (carriedObject) releaseObject();
    const link = getTcpLink(robot);
    const offset = new THREE.Vector3();
    if (link) {
      link.updateMatrixWorld(true);
      const tcp = new THREE.Vector3();
      link.getWorldPosition(tcp);
      const delta = block.mesh.position.clone().sub(tcp);
      // 局部坐标系里保存偏移，机械臂姿态变化时方块才会跟着转，而不是漂在原地
      offset.copy(delta).applyQuaternion(link.getWorldQuaternion(new THREE.Quaternion()).invert());
      // 自校正：记录方块相对 TCP 的实际偏移，供 moveTcpTo 估算下探目标
      graspOffsetHint.copy(delta);
    }
    carriedObject = { color: block.color, block, offset };
    block.state = 'carried';
    updateCarriedObject();
    return true;
  }

  // 按 id 找回方块；id 缺失时退化为「同色 + 最近位置」。
  // 传送带一直在跑，抓取流程里方块可能已经挪开十几厘米，所以阈值放宽到 0.35。
  function findBlockBySnapshot(snapshot) {
    if (!snapshot) return null;
    if (snapshot.id != null) {
      let hit = null;
      blocks.forEach((block) => {
        if (block.id === snapshot.id) hit = block;
      });
      if (hit) return hit;
    }
    if (!snapshot.pos) return null;
    let best = null;
    let bestDist = Infinity;
    blocks.forEach((block) => {
      if (block.color !== snapshot.color) return;
      const p = block.mesh.position;
      const d = Math.hypot(
        p.x - snapshot.pos.x,
        p.y - snapshot.pos.y,
        p.z - snapshot.pos.z
      );
      if (d < bestDist) {
        bestDist = d;
        best = block;
      }
    });
    return bestDist < 0.35 ? best : null;
  }

  // 落入分格时维护该格的堆叠高度；格子已满就把最下面一块移走，
  // 否则方块会越堆越高、穿出盒壁
  function binSlotRestY(block) {
    const stack = binStacks[block.color];
    if (stack.length >= MAX_STACK_PER_SLOT) {
      const oldest = stack.shift();
      removeBlock(oldest);
      stack.forEach((item, index) => {
        const y = BIN_STACK_BASE + BLOCK_HALF + index * BLOCK_SIZE * 1.02;
        item.restY = y;
        item.mesh.position.y = y;
      });
    }
    const level = stack.length;
    stack.push(block);
    return BIN_STACK_BASE + BLOCK_HALF + level * BLOCK_SIZE * 1.02;
  }

  // 按方块当前位置决定落点（盒内分格 / 传送带 / 地面），进入下落状态
  function settleBlockFrom(block, pos) {
    // 判定用「盒口外沿」而不是「盒内净空」：只要落在盒口范围内就归到该颜色的分格，
    // 否则刚好压在隔板/盒壁上的方块会掉到地面、再从盒子中间穿过去
    const inBinX = Math.abs(pos.x - BIN_CENTER.x) < BIN_SIZE.x / 2;
    const inBinZ = Math.abs(pos.z - BIN_CENTER.z) < BIN_SIZE.z / 2;
    const overBelt = Math.abs(pos.x - BELT_CENTER_X) < BELT_WIDTH / 2 + 0.02 &&
      pos.z > -BELT_HALF_LENGTH && pos.z < BELT_HALF_LENGTH;

    block.vy = 0;
    if (inBinX && inBinZ) {
      binCounts[block.color] = (binCounts[block.color] || 0) + 1;
      block.state = 'falling';
      block.nextState = 'binned';
      block.restY = binSlotRestY(block);
      // 格宽只有 56mm、方块 45mm，横向抖动必须留出余量，否则会插进隔板
      block.mesh.position.x = BIN_CENTER.x + (Math.random() - 0.5) * 0.016;
      block.mesh.position.z = SLOT_Z[block.color] + (Math.random() - 0.5) * 0.004;
    } else if (overBelt) {
      block.state = 'falling';
      block.nextState = 'belt';
      block.restY = BELT_TOP_Y + BLOCK_HALF;
    } else {
      block.state = 'falling';
      block.nextState = 'idle';
      block.restY = BLOCK_HALF;
    }
  }

  // 释放当前物体：按位置路由到 盒内分格 / 传送带 / 地面
  function releaseObject() {
    if (!carriedObject || !carriedObject.block) {
      carriedObject = null;
      return false;
    }
    const block = carriedObject.block;
    const pos = block.mesh.position.clone();
    carriedObject = null;
    settleBlockFrom(block, pos);
    return true;
  }

  function animate(now) {
    requestAnimationFrame(animate);
    const frameNow = now || performance.now();
    const dt = lastFrameTime ? frameNow - lastFrameTime : 16;
    lastFrameTime = frameNow;
    updateMotion(frameNow);
    updateGripperMotion(frameNow);
    updatePath(frameNow);
    updateTeachingPlayback(frameNow);
    updateDragSettling(frameNow);
    updateAxisLabelVisibility(frameNow);
    updateBlocks(dt);
    if (beltSurfaceTexture) {
      // 带面沿 +Z 输送：纹理 offset 反向滚动形成运动感
      beltSurfaceTexture.offset.y -= (BELT_SPEED * dt / 1000) * beltSurfaceTexture.repeat.y / (BELT_HALF_LENGTH * 2);
    }
    if (robot) {
      robot.updateMatrixWorld(true);
      if (teachingRecording) recordTeachingWaypoint(false);
      updateTcpHud();
      updateCarriedObject();
      updateDragMarker();
      updateDragErrorLine();
    }
    if (controls) controls.update();
    renderer.render(scene, camera);
    renderCameraView();
  }

  function renderCameraView() {
    if (!camViewRenderer || !camViewCamera) return;
    camViewRenderer.render(scene, camViewCamera);
    drawCameraOverlay();
  }

  function drawCameraOverlay() {
    if (!camViewOverlayCtx || !camViewCamera) return;
    const ctx = camViewOverlayCtx;
    const w = camViewOverlay.width;
    const h = camViewOverlay.height;
    ctx.clearRect(0, 0, w, h);

    const camRight = new THREE.Vector3();
    const camUp = new THREE.Vector3(0, 1, 0);
    camViewCamera.getWorldDirection(camRight);
    camRight.cross(camUp).normalize();

    const center = new THREE.Vector3();
    const edgeX = new THREE.Vector3();
    const projected = new THREE.Vector3();

    blocks.forEach((block) => {
      center.copy(block.mesh.position);
      projected.copy(center).project(camViewCamera);
      if (projected.z > 1 || projected.z < -1) return;
      const sx = (projected.x + 1) / 2 * w;
      const sy = (1 - projected.y) / 2 * h;

      edgeX.copy(center).add(camRight.clone().multiplyScalar(BLOCK_HALF));
      const edgeProjected = edgeX.project(camViewCamera);
      const halfW = Math.abs((edgeProjected.x - projected.x) / 2 * w) + 3;

      const carried = block.state === 'carried';
      ctx.lineWidth = carried ? 3 : 2;
      ctx.strokeStyle = `#${BLOCK_COLORS[block.color].toString(16).padStart(6, '0')}`;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 6;
      ctx.strokeRect(sx - halfW, sy - halfW, halfW * 2, halfW * 2);
      ctx.shadowBlur = 0;

      const label = `${t(`vision.color${block.color.charAt(0).toUpperCase()}${block.color.slice(1)}`)} ${96 + (block.id % 4)}%`;
      ctx.font = '600 15px Inter, "Microsoft YaHei", Arial, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const ly = sy - halfW - 8 < 12 ? sy + halfW + 18 : sy - halfW - 8;
      ctx.fillStyle = 'rgba(10, 14, 12, 0.78)';
      ctx.fillRect(sx - halfW - 1, ly - 15, textWidth + 10, 20);
      ctx.fillStyle = '#eafff7';
      ctx.fillText(label, sx - halfW + 4, ly);
    });
  }

  function attachCameraView(container) {
    if (!container || camViewRenderer) return;
    const webgl = document.createElement('canvas');
    webgl.className = 'cam-webgl';
    webgl.width = 640;
    webgl.height = 480;
    const overlay = document.createElement('canvas');
    overlay.className = 'cam-overlay';
    overlay.width = 640;
    overlay.height = 480;
    container.appendChild(webgl);
    container.appendChild(overlay);

    try {
      camViewRenderer = new THREE.WebGLRenderer({ canvas: webgl, antialias: true });
      camViewRenderer.setSize(640, 480, false);
      if ('outputColorSpace' in camViewRenderer && THREE.SRGBColorSpace) {
        camViewRenderer.outputColorSpace = THREE.SRGBColorSpace;
      } else if (THREE.sRGBEncoding !== undefined) {
        camViewRenderer.outputEncoding = THREE.sRGBEncoding;
      }
      camViewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    } catch (error) {
      console.warn('Camera view renderer unavailable:', error);
      return;
    }

    camViewCamera = new THREE.PerspectiveCamera(46, 640 / 480, 0.05, 4);
    camViewCamera.position.set(0.86, 0.66, 0.34);
    camViewCamera.lookAt(0.33, 0.08, 0.12);
    camViewOverlay = overlay;
    camViewOverlayCtx = overlay.getContext('2d');
  }

  function updateAxisLabelVisibility(now) {
    axisLabelSprites.forEach((sprite) => {
      const hideAt = sprite.userData.autoHideAt || 0;
      const fadeDuration = sprite.userData.fadeDuration || 900;
      if (now <= hideAt) return;

      const progress = clamp((now - hideAt) / fadeDuration, 0, 1);
      const opacity = 1 - progress;
      sprite.material.opacity = opacity;
      sprite.scale.set(0.16 * (1 + progress * 0.12), 0.05 * (1 + progress * 0.12), 1);
      sprite.visible = opacity > 0.02;
    });
  }

  function resize() {
    camera.aspect = getAspect();
    camera.updateProjectionMatrix();
    renderer.setSize(els.host.clientWidth, els.host.clientHeight);
  }

  function resetCamera() {
    if (!camera) return;
    camera.position.set(-0.72, 0.48, 0.74);
    camera.lookAt(0.18, 0.18, 0);
    if (controls) {
      controls.target.set(0.18, 0.18, 0);
      controls.sync();
    }
  }

  function getAspect() {
    return Math.max(1, els.host.clientWidth) / Math.max(1, els.host.clientHeight);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function makeTextSprite(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(17, 18, 17, 0.72)';
    roundRect(ctx, 10, 24, 492, 92, 14);
    ctx.fill();
    ctx.font = '700 38px "Microsoft YaHei", Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillText(text, 256, 70);

    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(0.16, 0.05, 1);
    return sprite;
  }

  function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function setGripperWidth(widthM, options) {
    const target = clamp(widthM, 0, GRIPPER_COMMAND_MAX);
    const source = options && options.source ? options.source : 'gripper';
    const immediate = options && options.immediate;
    const emit = !(options && options.emit === false);

    gripperMotion = null;
    if (immediate) {
      setJoint('gripper', target, false, { source, emit });
      syncGhostToRobot();
      return;
    }

    gripperMotion = {
      start: currentAngles.gripper || 0,
      target,
      startedAt: performance.now(),
      duration: options && options.duration ? Math.max(Number(options.duration), 1) : GRIPPER_ANIMATION_MS,
      source,
      emit
    };
  }

  function updateGripperMotion(now) {
    if (!gripperMotion) return;

    const t = clamp((now - gripperMotion.startedAt) / gripperMotion.duration, 0, 1);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const value = gripperMotion.start + (gripperMotion.target - gripperMotion.start) * eased;
    setJoint('gripper', value, false, {
      source: gripperMotion.source,
      emit: gripperMotion.emit && t >= 1
    });
    syncGhostToRobot();

    if (t >= 1) {
      gripperMotion = null;
      flushGripperWaiters();
    }
  }

  function flushGripperWaiters() {
    const waiters = Array.from(gripperWaiters);
    gripperWaiters.clear();
    waiters.forEach((resolve) => {
      try { resolve(); } catch (_) {}
    });
  }

  window.reBotSim = {
    getAngles() {
      return { ...currentAngles };
    },
    getJointDefs() {
      return jointDefs.map((joint) => ({ ...joint }));
    },
    getTeachingWaypoints() {
      return teachingWaypoints.map((point) => ({
        ...point,
        joints: { ...point.joints },
        tcp_ros: { ...point.tcp_ros }
      }));
    },
    setAngles(angles, options) {
      if (!angles || typeof angles !== 'object') return;
      const source = options && options.source ? options.source : 'api';
      const forceFeedback = Boolean(options && options.forceFeedback);
      if (
        source === 'ros' &&
        !forceFeedback &&
        (teachingPlayback || moveStart || animation || draggingTcp || dragSettling || gripperMotion)
      ) return;
      if (options && options.animate) {
        if (source !== 'ros') {
          stopPath();
          teachingPlayback = null;
        }
        // Keep targets already in flight so feedback arriving joint-by-joint
        // converges as one transition instead of cancelling earlier joints.
        const nextAngles = { ...(moveStart ? targetAngles : currentAngles) };
        Object.entries(angles).forEach(([name, value]) => {
          if (Number.isFinite(Number(value))) nextAngles[name] = Number(value);
        });
        moveToAngles(nextAngles, Number(options.duration) || 420, {
          source,
          emitBatch: false
        });
        return;
      }
      if (source !== 'ros') {
        stopPath();
        teachingPlayback = null;
        moveStart = 0;
      }
      Object.entries(angles).forEach(([name, value]) => {
        setJoint(name, value, Boolean(options && options.preserveControls), options || {});
      });
      if (!(options && options.preserveGhost)) syncGhostToRobot();
    },
    setGripperWidth(widthM, options) {
      const source = options && options.source ? options.source : 'api';
      const forceFeedback = Boolean(options && options.forceFeedback);
      if (
        source === 'ros' &&
        !forceFeedback &&
        (teachingPlayback || moveStart || animation || draggingTcp || dragSettling || gripperMotion)
      ) return;
      if (source !== 'ros') {
        stopPath();
        teachingPlayback = null;
        moveStart = 0;
      }
      if (options && options.animate) {
        setGripperWidth(widthM, options);
      } else {
        setJoint(
          'gripper',
          clamp(widthM, 0, GRIPPER_COMMAND_MAX),
          Boolean(options && options.preserveControls),
          options || {}
        );
        if (!(options && options.preserveGhost)) syncGhostToRobot();
      }
    },
    setFeedbackTarget(angles) {
      if (!angles || typeof angles !== 'object') return;
      const target = { ...currentAngles };
      Object.entries(angles).forEach(([name, value]) => {
        if (Number.isFinite(Number(value))) target[name] = Number(value);
      });
      updateGhostTarget(target);
      setGhostDisplay(true);
    },
    setGhostVisible(visible) {
      setGhostDisplay(visible);
    },
    setHardwareFeedbackDriven(enabled) {
      hardwareFeedbackDriven = Boolean(enabled);
      if (hardwareFeedbackDriven) setGhostDisplay(false);
    },
    isGhostVisible() {
      return Boolean(ghostRobot && ghostRobot.visible);
    },
    getVisualDiagnostics() {
      const left = getJoint(robot, 'gripper_joint1');
      const right = getJoint(robot, 'gripper_joint2');
      const readJoint = (joint) => {
        const value = joint?.jointValue?.[0];
        return Number.isFinite(Number(value)) ? Number(value) : NaN;
      };
      return {
        taskSceneVisible: Boolean(taskSceneGroup && taskSceneGroup.visible),
        bin: { centerX: BIN_CENTER.x, centerZ: BIN_CENTER.z, sizeX: BIN_SIZE.x, sizeZ: BIN_SIZE.z },
        belt: { centerX: BELT_CENTER_X, topY: BELT_TOP_Y, halfLength: BELT_HALF_LENGTH, running: conveyorRunning },
        blocks: Array.from(blocks).map((block) => ({
          color: block.color,
          state: block.state,
          x: block.mesh.position.x,
          y: block.mesh.position.y,
          z: block.mesh.position.z
        })),
        gripper: {
          commandWidth: currentAngles.gripper,
          leftTravel: readJoint(left),
          rightTravel: readJoint(right)
        }
      };
    },
    generateTrajectory,
    setDragMode(enabled) {
      if (Boolean(enabled) !== dragMode) toggleDragMode();
    },
    // —— 视觉分拣任务 API ——
    moveTcpTo,
    trackBlockTo,
    openGripper,
    closeGripper,
    tryGraspNearTcp() {
      return tryGraspNearTcp();
    },
    releaseCurrent() {
      return releaseObject();
    },
    getCarriedObject() {
      return carriedObject ? carriedObject.color : null;
    },
    getTcpRos() {
      const pos = getTcpPosition(robot);
      return pos ? threeToRos(pos) : null;
    },
    getGraspOffsetHint() {
      return { x: graspOffsetHint.x, y: graspOffsetHint.y, z: graspOffsetHint.z };
    },
    getToolAxis() {
      const axis = getToolAxis(robot);
      return { x: axis.x, y: axis.y, z: axis.z };
    },
    getGraspPointRos() {
      const grasp = getGraspPoint(robot);
      return grasp ? threeToRos(grasp) : null;
    },
    // 选择抓取目标：只抓抓取区内传送带上的方块（保证工具朝下可达），其次近处地面方块。
    // 目标在抓取流程中仍随带面前进，所以只挑「还留得下 PICK_LEAD_Z 行程」的方块。
    selectTargetBlock(colorPref) {
      const pref = colorPref && colorPref !== 'auto' ? String(colorPref).toLowerCase() : null;
      let best = null;
      let bestScore = Infinity;
      blocks.forEach((block) => {
        if (block.state !== 'belt' && block.state !== 'idle') return;
        if (pref && block.color !== pref) return;
        const p = block.mesh.position;
        const zoneExit = PICK_ZONE_Z[1] - PICK_LEAD_Z;
        const inZone = block.state === 'belt' && p.z >= PICK_ZONE_Z[0] && p.z <= zoneExit;
        if (!inZone && block.state !== 'idle') return;
        const planar = Math.hypot(p.x, p.z);
        if (planar > 0.42) return;
        // 区内越靠近可用窗口末端越优先（马上要走完了）；地面方块次之
        const score = inZone ? (zoneExit - p.z) : 10 + planar;
        if (score < bestScore) {
          bestScore = score;
          best = block;
        }
      });
      if (!best) return null;
      const p = best.mesh.position;
      return {
        id: best.id,
        color: best.color,
        state: best.state,
        pos: { x: p.x, y: p.y, z: p.z }
      };
    },
    // 抓取流程中随时取回目标方块的实时位置（方块一直在随带面移动）
    getBlockPos(snapshot) {
      const block = findBlockBySnapshot(snapshot);
      if (!block) return null;
      const p = block.mesh.position;
      return { x: p.x, y: p.y, z: p.z };
    },
    getConveyorSpeed() {
      return conveyorRunning ? BELT_SPEED : 0;
    },
    lockTargetBlock(snapshot) {
      const target = findBlockBySnapshot(snapshot);
      if (target) target.state = 'locked';
      return Boolean(target);
    },
    unlockTargetBlock(snapshot) {
      const target = findBlockBySnapshot(snapshot);
      if (target && target.state === 'locked') target.state = 'belt';
    },
    // 落点：松手位置抬到盒壁上方（DROP_CLEARANCE），方块自己落进 55mm 的分格。
    // 夹爪不伸进格子里，就不会和隔板互相穿模。
    getSlotPose(color) {
      const count = Math.min(binCounts[color] || 0, MAX_STACK_PER_SLOT);
      const restY = BIN_STACK_BASE + BLOCK_HALF + count * BLOCK_SIZE * 1.02;
      const drop = {
        x: BIN_CENTER.x,
        y: BIN_HEIGHT + DROP_CLEARANCE,
        z: SLOT_Z[color]
      };
      return {
        drop,
        above: { x: drop.x, y: drop.y + APPROACH_HOVER, z: drop.z },
        restY,
        count
      };
    },
    getBinCounts() {
      return { ...binCounts };
    },
    setConveyorRunning(running) {
      conveyorRunning = Boolean(running);
    },
    isConveyorRunning() {
      return conveyorRunning;
    },
    getMotionEpoch() {
      return motionEpoch;
    },
    getCameraStatus() {
      let visible = 0;
      const targets = [];
      blocks.forEach((block) => {
        if (block.state === 'binned' && (binCounts[block.color] || 0) > 4) return;
        visible += 1;
        if (block.state === 'belt' || block.state === 'locked' || block.state === 'idle') {
          const ros = threeToRos(block.mesh.position);
          targets.push({ color: block.color, state: block.state, ...ros });
        }
      });
      return {
        total: visible,
        targets,
        counts: { ...binCounts },
        holding: carriedObject ? carriedObject.color : null,
        conveyor: conveyorRunning
      };
    },
    attachCameraView(container) {
      attachCameraView(container);
    },
    home() {
      applyPreset('forward', false);
    },
    stopMotion() {
      stopActiveMotion();
    },
    onCommand(listener) {
      if (typeof listener !== 'function') return () => {};
      commandListeners.add(listener);
      return () => commandListeners.delete(listener);
    }
  };
  if (window.rebotI18n) {
    window.rebotI18n.onLangChange(() => {
      Object.entries(presets).forEach(([key, preset], index) => {
        const btn = els.presets && els.presets.children[index];
        if (btn) btn.textContent = t(preset.label);
      });
      jointDefs.forEach((joint, index) => {
        const wrap = els.joints && els.joints.children[index];
        if (wrap) {
          const strong = wrap.querySelector('strong');
          if (strong) strong.textContent = t(joint.label);
        }
        updateJointLabel(joint.name);
      });
      if (typeof updateTeachingStatus === 'function') updateTeachingStatus();
      if (els.toggleDrag) {
        els.toggleDrag.textContent = dragMode ? t('sim.exitDrag') : t('adv.drag');
        els.toggleDrag.classList.toggle('active', dragMode);
      }
      if (!draggingTcp && !dragSettling) {
        setDragStatus(dragMode ? t('sim.dragGreen') : t('app.dragDisabled'));
      }
      if (robot && typeof updateTcpHud === 'function') updateTcpHud();
    });
  }



  function createOrbit(cam, dom, initialTarget) {
    let rotating = false;
    let panning = false;
    let lastX = 0;
    let lastY = 0;
    const target = initialTarget.clone();
    const spherical = new THREE.Spherical();
    const offset = new THREE.Vector3();

    function sync() {
      offset.copy(cam.position).sub(target);
      spherical.setFromVector3(offset);
    }
    sync();

    dom.addEventListener('pointerdown', (event) => {
      dom.setPointerCapture(event.pointerId);
      rotating = event.button === 0;
      panning = event.button === 2;
      lastX = event.clientX;
      lastY = event.clientY;
    });

    dom.addEventListener('pointermove', (event) => {
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;

      if (rotating) {
        spherical.theta -= dx * 0.006;
        spherical.phi = clamp(spherical.phi - dy * 0.006, 0.12, Math.PI - 0.08);
      }

      if (panning) {
        const distance = cam.position.distanceTo(target);
        const right = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        cam.getWorldDirection(right).cross(up).normalize();
        target.add(right.multiplyScalar(-dx * distance * 0.0015));
        target.y += dy * distance * 0.0015;
      }
    });

    dom.addEventListener('pointerup', (event) => {
      rotating = false;
      panning = false;
      if (dom.hasPointerCapture(event.pointerId)) dom.releasePointerCapture(event.pointerId);
    });

    dom.addEventListener('wheel', (event) => {
      event.preventDefault();
      spherical.radius = clamp(spherical.radius * (event.deltaY > 0 ? 1.08 : 0.92), 0.24, 4);
    }, { passive: false });

    dom.addEventListener('contextmenu', (event) => event.preventDefault());

    return {
      target,
      sync,
      update() {
        offset.setFromSpherical(spherical);
        cam.position.copy(target).add(offset);
        cam.lookAt(target);
      }
    };
  }
})();
