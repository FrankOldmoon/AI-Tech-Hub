/**
 * SOMA · 仿人机器人解剖图谱 —— 3D 引擎。
 *
 * 从独立单文件页（SOMA Humanoid Anatomy Atlas，importmap + CDN three@0.185）移植：
 *   - 25 个零件的建模（createPart 大 switch）、7 大总成装配树、5 大功能系统筛选、
 *     三级爆炸拆解（整机/当前总成/当前系统）、Solid/X-Ray/线框三种显示模式、
 *     悬停/选中描边（OutlinePass）、CSS2D 零件标签、眼睛跟随指针 + 眨眼、
 *     拟人步态行走演示（两圈往返）这套命令式逻辑保持原样；
 *   - 把「自己造整页 DOM + document.getElementById + window 事件」换成
 *     「调用方传入页面根节点，引擎在根节点内按 id 取节点」，于是能在 Nuxt 页里挂载/卸载；
 *   - 依赖全部走 npm（`import * as THREE from 'three'`），页面里没有任何 CDN 引用；
 *   - 全部 UI 文案改为 zh/en 双语，语言由 options.getLocale() 提供，
 *     切换语言后调用 handle.refresh() 重渲染静态文本；
 *   - 教学进度钩子：onTask 上报关键交互（筛系统/选零件/爆炸合并/切显示模式/走完两圈），
 *     onStat 每秒采样一次关键指标，进度统计归宿主页面。
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export type Lang = 'zh' | 'en'
export type SystemKey = 'all' | 'structure' | 'perception' | 'compute' | 'drive' | 'power'
export type AssemblyKey = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'pelvis' | 'leftLeg' | 'rightLeg'
export type DisplayMode = 'solid' | 'xray' | 'wire'
export type ExplodeScope = 'all' | 'assembly' | 'system'

export interface LocalizedText {
  zh: string
  en: string
}

/* =========================================================
   数据：功能系统 / 结构总成 / 零件
   ========================================================= */

const SYSTEMS: Record<SystemKey, { name: LocalizedText, color: string }> = {
  all: { name: { zh: '全部', en: 'All' }, color: '#d2dad6' },
  structure: { name: { zh: '结构外壳', en: 'Structural Shell' }, color: '#a99d86' },
  perception: { name: { zh: '感知', en: 'Perception' }, color: '#52a9c8' },
  compute: { name: { zh: '计算与控制', en: 'Compute & Control' }, color: '#6eb18f' },
  drive: { name: { zh: '驱动', en: 'Drive' }, color: '#d39a47' },
  power: { name: { zh: '电源与走线', en: 'Power & Wiring' }, color: '#bc7162' }
}

const ASSEMBLIES: Record<AssemblyKey, { name: LocalizedText, code: string, system: SystemKey }> = {
  head: { name: { zh: '头部总成', en: 'Head Assembly' }, code: 'ASM-HEAD', system: 'perception' },
  torso: { name: { zh: '躯干总成', en: 'Torso Assembly' }, code: 'ASM-TORSO', system: 'compute' },
  leftArm: { name: { zh: '左臂总成', en: 'Left Arm Assembly' }, code: 'ASM-ARM-L', system: 'drive' },
  rightArm: { name: { zh: '右臂总成', en: 'Right Arm Assembly' }, code: 'ASM-ARM-R', system: 'drive' },
  pelvis: { name: { zh: '骨盆总成', en: 'Pelvis Assembly' }, code: 'ASM-PELVIS', system: 'structure' },
  leftLeg: { name: { zh: '左腿总成', en: 'Left Leg Assembly' }, code: 'ASM-LEG-L', system: 'drive' },
  rightLeg: { name: { zh: '右腿总成', en: 'Right Leg Assembly' }, code: 'ASM-LEG-R', system: 'drive' }
}

interface PartDef {
  id: string
  no: string
  name: LocalizedText
  code: string
  system: Exclude<SystemKey, 'all'>
  assembly: AssemblyKey
  pos: [number, number, number]
  explode: [number, number, number]
  label: boolean
  summary: LocalizedText
  visible: LocalizedText[]
  relations: LocalizedText[]
}

const PARTS: PartDef[] = [
  { id: 'vision', no: '01', name: { zh: '双目视觉阵列', en: 'Stereo Vision Array' }, code: 'STEREO VISION ARRAY', system: 'perception', assembly: 'head', pos: [0, 5.35, 0.32], explode: [0, 0.25, 1.35], label: true, summary: { zh: '头部环境视觉输入组件。当前几何体用于验证模型节点选择、标注与爆炸交互，不代表真实相机参数。', en: 'Head environment vision input assembly. The current geometry validates node selection, labeling and explode actions, and does not represent real camera parameters.' }, visible: [{ zh: '双主镜头', en: 'Dual main lenses' }, { zh: '辅助传感器', en: 'Auxiliary sensors' }, { zh: '安装横梁', en: 'Mounting crossbeam' }], relations: [{ zh: '向计算核心输送视觉数据', en: 'Feeds visual data to the compute core' }, { zh: '随颈部旋转机构转向', en: 'Reorients with the neck rotation mechanism' }] },
  { id: 'headShell', no: '02', name: { zh: '头部防护壳', en: 'Head Protective Shield' }, code: 'CRANIAL SHELL', system: 'structure', assembly: 'head', pos: [0, 5.62, 0], explode: [0, 1.15, -0.15], label: true, summary: { zh: '覆盖头部感知与安装结构的分体式外壳。', en: 'A split shell covering the head sensing and mounting structure.' }, visible: [{ zh: '弧形顶盖', en: 'Curved top cover' }, { zh: '侧护板', en: 'Side guards' }, { zh: '内部安装接口', en: 'Internal mounting interface' }], relations: [{ zh: '保护视觉阵列', en: 'Protects the vision array' }, { zh: '与头部框架连接', en: 'Connects to the head frame' }] },
  { id: 'neck', no: '03', name: { zh: '颈部旋转机构', en: 'Neck Rotation Mechanism' }, code: 'NECK GIMBAL', system: 'drive', assembly: 'head', pos: [0, 4.72, 0], explode: [0, 0.55, -0.12], label: true, summary: { zh: '连接头部与躯干的旋转驱动组件，用于表达多方向观察。', en: 'Rotary drive assembly connecting head and torso, used to express multi-directional observation.' }, visible: [{ zh: '多级旋转环', en: 'Multi-stage rotation rings' }, { zh: '中心轴', en: 'Central axis' }, { zh: '安装法兰', en: 'Mounting flange' }], relations: [{ zh: '上联：视觉阵列', en: 'Upper link: vision assembly' }, { zh: '下联：胸廓框架', en: 'Lower link: chest frame' }] },
  { id: 'chestFrame', no: '04', name: { zh: '胸部承重框架', en: 'Chest Load-Bearing Frame' }, code: 'TORSO LOAD FRAME', system: 'structure', assembly: 'torso', pos: [0, 3.72, 0], explode: [0, 0, -0.9], label: false, summary: { zh: '躯干内部主承重结构，为计算、电源与外壳提供安装基座。', en: 'Main load-bearing structure inside the torso; mounting base for compute, power and shell.' }, visible: [{ zh: '中央承重盒', en: 'Central load box' }, { zh: '上下横梁', en: 'Top and bottom beams' }, { zh: '肩部接口', en: 'Shoulder interface' }], relations: [{ zh: '承载计算核心', en: 'Carries the compute core' }, { zh: '连接肩部与骨盆', en: 'Connects shoulders to pelvis' }] },
  { id: 'shellLeft', no: '05', name: { zh: '左胸外壳', en: 'Left Chest Shell' }, code: 'TORSO SHELL L', system: 'structure', assembly: 'torso', pos: [-0.66, 3.78, 0.2], explode: [-1.35, 0.12, 0.38], label: true, summary: { zh: '向左滑出的躯干防护壳，用于演示「先拆外壳」的维护顺序。', en: 'Torso shell sliding out to the left, demonstrating shell-first removal.' }, visible: [{ zh: '弧形面板', en: 'Curved panel' }, { zh: '安装边界', en: 'Mounting boundary' }, { zh: '检修开口', en: 'Maintenance opening' }], relations: [{ zh: '覆盖胸部承重框架', en: 'Covers the chest load-bearing frame' }, { zh: '拆除后露出计算核心', en: 'Exposes the compute core once removed' }] },
  { id: 'shellRight', no: '06', name: { zh: '右胸外壳', en: 'Right Chest Shell' }, code: 'TORSO SHELL R', system: 'structure', assembly: 'torso', pos: [0.66, 3.78, 0.2], explode: [1.35, 0.12, 0.38], label: true, summary: { zh: '向右滑出的躯干防护壳，与左壳共同构成分体式维护结构。', en: 'Torso shell sliding out to the right; together with the left shell it forms a split maintenance structure.' }, visible: [{ zh: '弧形面板', en: 'Curved panel' }, { zh: '安装边界', en: 'Mounting boundary' }, { zh: '检修开口', en: 'Maintenance opening' }], relations: [{ zh: '覆盖电源与走线区', en: 'Covers the power and wiring area' }, { zh: '安装在胸部框架上', en: 'Mounted on the chest frame' }] },
  { id: 'computeCore', no: '07', name: { zh: '躯干计算核心', en: 'Torso Compute Core' }, code: 'TORSO COMPUTE CORE', system: 'compute', assembly: 'torso', pos: [0, 3.72, 0.52], explode: [0, 0.08, 1.45], label: true, summary: { zh: '中央计算与控制节点，接收感知输入并调度驱动系统。', en: 'Central compute and control node; receives perception input and coordinates the drive system.' }, visible: [{ zh: '主控板', en: 'Main control board' }, { zh: '计算模组', en: 'Compute module' }, { zh: '边缘接口', en: 'Edge interface' }], relations: [{ zh: '连接视觉阵列', en: 'Connects to the vision array' }, { zh: '控制颈部与四肢驱动', en: 'Controls neck and limb drives' }, { zh: '接收电源分配模组输出', en: 'Receives output from the power module' }] },
  { id: 'powerCore', no: '08', name: { zh: '电源分配模组', en: 'Power Distribution Module' }, code: 'POWER DISTRIBUTION', system: 'power', assembly: 'torso', pos: [0, 3.08, -0.22], explode: [0, -0.15, -1.25], label: true, summary: { zh: '向计算、感知与驱动总成分配能量的概念模组。', en: 'Conceptual module distributing energy to compute, perception and drive assemblies.' }, visible: [{ zh: '电芯仓', en: 'Power cell bay' }, { zh: '接线端子', en: 'Connection terminals' }, { zh: '主干线束出口', en: 'Main harness outlet' }], relations: [{ zh: '为计算核心供电', en: 'Powers the compute core' }, { zh: '连接上下肢线束', en: 'Connects upper/lower limb harnesses' }] },
  { id: 'shoulderL', no: '09', name: { zh: '左肩执行器', en: 'Left Shoulder Actuator' }, code: 'SHOULDER ACTUATOR L', system: 'drive', assembly: 'leftArm', pos: [-1.27, 4.08, 0], explode: [-1.1, 0.35, 0], label: true, summary: { zh: '连接躯干与左臂的高负载旋转关节。', en: 'High-load rotary joint connecting torso and left arm.' }, visible: [{ zh: '驱动环', en: 'Drive ring' }, { zh: '轴承座', en: 'Bearing housing' }, { zh: '连接法兰', en: 'Connection flange' }], relations: [{ zh: '内侧连接胸部框架', en: 'Internally links to the chest frame' }, { zh: '外侧连接左上臂', en: 'Externally links to the upper-left arm' }] },
  { id: 'upperArmL', no: '10', name: { zh: '左上臂框架', en: 'Left Upper Arm Frame' }, code: 'UPPER ARM FRAME L', system: 'structure', assembly: 'leftArm', pos: [-1.48, 3.34, 0], explode: [-1.48, 0.15, 0.08], label: false, summary: { zh: '左肩与左肘之间的承重结构。', en: 'Load-bearing structure between left shoulder and elbow.' }, visible: [{ zh: '双侧承重梁', en: 'Dual-side load beams' }, { zh: '走线槽', en: 'Harness channel' }, { zh: '末端接口', en: 'End interface' }], relations: [{ zh: '上联：肩部执行器', en: 'Upper link: shoulder actuator' }, { zh: '下联：肘部执行器', en: 'Lower link: elbow actuator' }] },
  { id: 'elbowL', no: '11', name: { zh: '左肘执行器', en: 'Left Elbow Actuator' }, code: 'ELBOW ACTUATOR L', system: 'drive', assembly: 'leftArm', pos: [-1.55, 2.62, 0], explode: [-1.72, -0.1, 0.1], label: true, summary: { zh: '驱动左前臂屈伸的旋转关节。', en: 'Rotary joint driving left forearm flexion/extension.' }, visible: [{ zh: '圆柱执行器', en: 'Cylindrical actuator' }, { zh: '旋转轴', en: 'Rotation axis' }, { zh: '法兰', en: 'Flange' }], relations: [{ zh: '连接上臂框架', en: 'Connects to the upper arm frame' }, { zh: '驱动左前臂与手部', en: 'Drives the left forearm and hand' }] },
  { id: 'handL', no: '12', name: { zh: '左灵巧手', en: 'Left Dexterous Hand' }, code: 'DEXTEROUS HAND L', system: 'drive', assembly: 'leftArm', pos: [-1.62, 1.52, 0.04], explode: [-2.05, -0.35, 0.35], label: true, summary: { zh: '用于抓取与交互的多指末端执行器。', en: 'Multi-finger end-effector for grasping and interaction.' }, visible: [{ zh: '手掌', en: 'Palm' }, { zh: '多级指节', en: 'Multi-stage finger joints' }, { zh: '腕部接口', en: 'Wrist interface' }], relations: [{ zh: '连接左肘执行器', en: 'Connects to the left elbow actuator' }, { zh: '接收计算核心指令', en: 'Receives commands from the compute core' }] },
  { id: 'shoulderR', no: '13', name: { zh: '右肩执行器', en: 'Right Shoulder Actuator' }, code: 'SHOULDER ACTUATOR R', system: 'drive', assembly: 'rightArm', pos: [1.27, 4.08, 0], explode: [1.1, 0.35, 0], label: true, summary: { zh: '连接躯干与右臂的高负载旋转关节。', en: 'High-load rotary joint connecting torso and right arm.' }, visible: [{ zh: '驱动环', en: 'Drive ring' }, { zh: '轴承座', en: 'Bearing housing' }, { zh: '连接法兰', en: 'Connection flange' }], relations: [{ zh: '内侧连接胸部框架', en: 'Internally links to the chest frame' }, { zh: '外侧连接右上臂', en: 'Externally links to the upper-right arm' }] },
  { id: 'upperArmR', no: '14', name: { zh: '右上臂框架', en: 'Right Upper Arm Frame' }, code: 'UPPER ARM FRAME R', system: 'structure', assembly: 'rightArm', pos: [1.48, 3.34, 0], explode: [1.48, 0.15, 0.08], label: false, summary: { zh: '右肩与右肘之间的承重结构。', en: 'Load-bearing structure between right shoulder and elbow.' }, visible: [{ zh: '双侧承重梁', en: 'Dual-side load beams' }, { zh: '走线槽', en: 'Harness channel' }, { zh: '末端接口', en: 'End interface' }], relations: [{ zh: '上联：肩部执行器', en: 'Upper link: shoulder actuator' }, { zh: '下联：肘部执行器', en: 'Lower link: elbow actuator' }] },
  { id: 'elbowR', no: '15', name: { zh: '右肘执行器', en: 'Right Elbow Actuator' }, code: 'ELBOW ACTUATOR R', system: 'drive', assembly: 'rightArm', pos: [1.55, 2.62, 0], explode: [1.72, -0.1, 0.1], label: true, summary: { zh: '驱动右前臂屈伸的旋转关节。', en: 'Rotary joint driving right forearm flexion/extension.' }, visible: [{ zh: '圆柱执行器', en: 'Cylindrical actuator' }, { zh: '旋转轴', en: 'Rotation axis' }, { zh: '法兰', en: 'Flange' }], relations: [{ zh: '连接上臂框架', en: 'Connects to the upper arm frame' }, { zh: '驱动右前臂与手部', en: 'Drives the right forearm and hand' }] },
  { id: 'handR', no: '16', name: { zh: '右灵巧手', en: 'Right Dexterous Hand' }, code: 'DEXTEROUS HAND R', system: 'drive', assembly: 'rightArm', pos: [1.62, 1.52, 0.04], explode: [2.05, -0.35, 0.35], label: true, summary: { zh: '用于抓取与交互的多指末端执行器。', en: 'Multi-finger end-effector for grasping and interaction.' }, visible: [{ zh: '手掌', en: 'Palm' }, { zh: '多级指节', en: 'Multi-stage finger joints' }, { zh: '腕部接口', en: 'Wrist interface' }], relations: [{ zh: '连接右肘执行器', en: 'Connects to the right elbow actuator' }, { zh: '接收计算核心指令', en: 'Receives commands from the compute core' }] },
  { id: 'pelvis', no: '17', name: { zh: '骨盆承重框架', en: 'Pelvis Load-Bearing Frame' }, code: 'PELVIS LOAD FRAME', system: 'structure', assembly: 'pelvis', pos: [0, 2.12, 0], explode: [0, -0.3, -0.65], label: true, summary: { zh: '把躯干负载传递给左右髋关节的中央承重总成。', en: 'Central load assembly transferring torso load to the left/right hip joints.' }, visible: [{ zh: '中央框架', en: 'Central frame' }, { zh: '左右髋接口', en: 'Left/right hip interface' }, { zh: '腰部法兰', en: 'Waist flange' }], relations: [{ zh: '上联：胸部框架', en: 'Upper link: chest frame' }, { zh: '下联：左右髋部执行器', en: 'Lower link: left/right hip actuators' }] },
  { id: 'hipL', no: '18', name: { zh: '左髋执行器', en: 'Left Hip Actuator' }, code: 'HIP ACTUATOR L', system: 'drive', assembly: 'leftLeg', pos: [-0.58, 1.72, 0], explode: [-0.82, -0.55, 0], label: true, summary: { zh: '连接骨盆与左腿的高负载驱动总成。', en: 'High-load drive assembly connecting pelvis and left leg.' }, visible: [{ zh: '大直径驱动环', en: 'Large-diameter drive ring' }, { zh: '关节轴', en: 'Joint axis' }, { zh: '腿部接口', en: 'Leg interface' }], relations: [{ zh: '上联：骨盆框架', en: 'Upper link: pelvis frame' }, { zh: '下联：左大腿', en: 'Lower link: left thigh' }] },
  { id: 'thighL', no: '19', name: { zh: '左大腿框架', en: 'Left Thigh Frame' }, code: 'THIGH FRAME L', system: 'structure', assembly: 'leftLeg', pos: [-0.58, 0.72, 0], explode: [-0.94, -0.75, 0.05], label: false, summary: { zh: '连接髋与膝的下肢承重结构。', en: 'Lower-limb load-bearing structure connecting hip and knee.' }, visible: [{ zh: '纵向承重梁', en: 'Longitudinal load beam' }, { zh: '执行器安装座', en: 'Actuator mount' }, { zh: '线束导管', en: 'Harness conduit' }], relations: [{ zh: '上联：左髋', en: 'Upper link: left hip' }, { zh: '下联：左膝', en: 'Lower link: left knee' }] },
  { id: 'kneeL', no: '20', name: { zh: '左膝执行器', en: 'Left Knee Actuator' }, code: 'KNEE ACTUATOR L', system: 'drive', assembly: 'leftLeg', pos: [-0.58, -0.12, 0], explode: [-1.05, -0.92, 0.1], label: true, summary: { zh: '驱动左腿屈伸并传递步态负载的关节。', en: 'Joint driving left leg flexion/extension and transferring gait load.' }, visible: [{ zh: '旋转轴', en: 'Rotation axis' }, { zh: '驱动外壳', en: 'Drive housing' }, { zh: '安装法兰', en: 'Mounting flange' }], relations: [{ zh: '连接左大腿与小腿', en: 'Connects left thigh and shank' }, { zh: '参与步态控制', en: 'Participates in gait control' }] },
  { id: 'footL', no: '21', name: { zh: '左足触觉模组', en: 'Left Foot Tactile Module' }, code: 'PLANTAR SENSOR L', system: 'perception', assembly: 'leftLeg', pos: [-0.58, -2.02, 0.18], explode: [-1.1, -1.15, 0.65], label: true, summary: { zh: '表达足底接触与压力感知的分层足端结构。', en: 'Layered foot end-effector expressing footfall contact and plantar pressure sensing.' }, visible: [{ zh: '足底板', en: 'Sole plate' }, { zh: '触觉层', en: 'Tactile layer' }, { zh: '踝部接口', en: 'Ankle interface' }], relations: [{ zh: '向计算核心回传接触状态', en: 'Feeds contact status back to the compute core' }, { zh: '连接左腿结构', en: 'Connects to the left leg structure' }] },
  { id: 'hipR', no: '22', name: { zh: '右髋执行器', en: 'Right Hip Actuator' }, code: 'HIP ACTUATOR R', system: 'drive', assembly: 'rightLeg', pos: [0.58, 1.72, 0], explode: [0.82, -0.55, 0], label: true, summary: { zh: '连接骨盆与右腿的高负载驱动总成。', en: 'High-load drive assembly connecting pelvis and right leg.' }, visible: [{ zh: '大直径驱动环', en: 'Large-diameter drive ring' }, { zh: '关节轴', en: 'Joint axis' }, { zh: '腿部接口', en: 'Leg interface' }], relations: [{ zh: '上联：骨盆框架', en: 'Upper link: pelvis frame' }, { zh: '下联：右大腿', en: 'Lower link: right thigh' }] },
  { id: 'thighR', no: '23', name: { zh: '右大腿框架', en: 'Right Thigh Frame' }, code: 'THIGH FRAME R', system: 'structure', assembly: 'rightLeg', pos: [0.58, 0.72, 0], explode: [0.94, -0.75, 0.05], label: false, summary: { zh: '连接髋与膝的下肢承重结构。', en: 'Lower-limb load-bearing structure connecting hip and knee.' }, visible: [{ zh: '纵向承重梁', en: 'Longitudinal load beam' }, { zh: '执行器安装座', en: 'Actuator mount' }, { zh: '线束导管', en: 'Harness conduit' }], relations: [{ zh: '上联：右髋', en: 'Upper link: right hip' }, { zh: '下联：右膝', en: 'Lower link: right knee' }] },
  { id: 'kneeR', no: '24', name: { zh: '右膝执行器', en: 'Right Knee Actuator' }, code: 'KNEE ACTUATOR R', system: 'drive', assembly: 'rightLeg', pos: [0.58, -0.12, 0], explode: [1.05, -0.92, 0.1], label: true, summary: { zh: '驱动右腿屈伸并传递步态负载的关节。', en: 'Joint driving right leg flexion/extension and transferring gait load.' }, visible: [{ zh: '旋转轴', en: 'Rotation axis' }, { zh: '驱动外壳', en: 'Drive housing' }, { zh: '安装法兰', en: 'Mounting flange' }], relations: [{ zh: '连接右大腿与小腿', en: 'Connects right thigh and shank' }, { zh: '参与步态控制', en: 'Participates in gait control' }] },
  { id: 'footR', no: '25', name: { zh: '右足触觉模组', en: 'Right Foot Tactile Module' }, code: 'PLANTAR SENSOR R', system: 'perception', assembly: 'rightLeg', pos: [0.58, -2.02, 0.18], explode: [1.1, -1.15, 0.65], label: true, summary: { zh: '表达足底接触与压力感知的分层足端结构。', en: 'Layered foot end-effector expressing footfall contact and plantar pressure sensing.' }, visible: [{ zh: '足底板', en: 'Sole plate' }, { zh: '触觉层', en: 'Tactile layer' }, { zh: '踝部接口', en: 'Ankle interface' }], relations: [{ zh: '向计算核心回传接触状态', en: 'Feeds contact status back to the compute core' }, { zh: '连接右腿结构', en: 'Connects to the right leg structure' }] }
]

/* =========================================================
   静态 UI 文案
   ========================================================= */

const T = {
  assembled: { zh: '已组装', en: 'Assembled' } as LocalizedText,
  fullExplode: { zh: '完全爆炸', en: 'Full Explode' } as LocalizedText,
  exploding: { zh: '爆炸中', en: 'Exploding' } as LocalizedText,
  statusIdle: { zh: '已组装 · 拖拽旋转', en: 'Assembled · drag to orbit' } as LocalizedText,
  noneSelected: { zh: '未选中', en: 'None Selected' } as LocalizedText,
  scopeAll: { zh: '范围：整机', en: 'Scope: Full Unit' } as LocalizedText,
  scopeAssembly: { zh: '范围：当前总成', en: 'Scope: Current Assembly' } as LocalizedText,
  scopeSystem: { zh: '范围：当前系统', en: 'Scope: Current System' } as LocalizedText,
  merge: { zh: '合并', en: 'Merge' } as LocalizedText,
  explodeShort: { zh: '爆炸', en: 'Explode' } as LocalizedText,
  explodeLong: { zh: '整体', en: 'Full' } as LocalizedText,
  labelsOn: { zh: '零件标签', en: 'Part Labels' } as LocalizedText,
  autoRotate: { zh: '自动旋转', en: 'Auto-Rotate' } as LocalizedText,
  walk: { zh: '行走演示', en: 'Walk' } as LocalizedText,
  stopWalking: { zh: '停止行走', en: 'Stop Walking' } as LocalizedText,
  showAll: { zh: '显示全部', en: 'Show All' } as LocalizedText,
  reset: { zh: '重置', en: 'Reset' } as LocalizedText,
  guide: { zh: '使用指南', en: 'User Guide' } as LocalizedText,
  treeTitle: { zh: '结构导航', en: 'Structure Navigation' } as LocalizedText,
  treeHeading: { zh: '机器人装配树', en: 'Robot Assembly Tree' } as LocalizedText,
  searchPlaceholder: { zh: '按名称 / 系统 / 编号搜索', en: 'Search by name / system / ID' } as LocalizedText,
  partHierarchy: { zh: '零件层级', en: 'Part Hierarchy' } as LocalizedText,
  emptyState: { zh: '没有匹配的节点。', en: 'No matching nodes.' } as LocalizedText,
  noMatching: { zh: '清除搜索或切换系统。', en: 'Clear the search or switch systems.' } as LocalizedText,
  heroIndex: { zh: '整机 / 00', en: 'Full Unit / 00' } as LocalizedText,
  heroName: { zh: '瓷壳仿生验证单元', en: 'Porcelain Bionic Validation Unit' } as LocalizedText,
  heroCode: { zh: 'SOMA H-01 / 交互骨架', en: 'SOMA H-01 / INTERACTION SKELETON' } as LocalizedText,
  tabOverview: { zh: '总览', en: 'Overview' } as LocalizedText,
  tabStructure: { zh: '可见结构', en: 'Visible Structure' } as LocalizedText,
  tabRelations: { zh: '功能关系', en: 'Relations' } as LocalizedText,
  focusPart: { zh: '定位零件', en: 'Locate Part' } as LocalizedText,
  explodeOut: { zh: '爆炸移出', en: 'Explode Out' } as LocalizedText,
  resetView: { zh: '复位视角', en: 'Reset View' } as LocalizedText,
  isolate: { zh: '单独显示', en: 'Isolate Part' } as LocalizedText,
  exitIsolation: { zh: '退出隔离', en: 'Exit Isolation' } as LocalizedText,
  hidePart: { zh: '隐藏零件', en: 'Hide Part' } as LocalizedText,
  showPart: { zh: '显示零件', en: 'Show Part' } as LocalizedText,
  assemblyStatus: { zh: '装配状态', en: 'Assembly Status' } as LocalizedText,
  conceptLabel: { zh: '概念功能', en: 'Conceptual Functions' } as LocalizedText,
  identityLabel: { zh: '节点身份', en: 'Node Identity' } as LocalizedText,
  visibleLabel: { zh: '可见结构', en: 'Visible Structure' } as LocalizedText,
  relationsLabel: { zh: '功能关系', en: 'Functional Relations' } as LocalizedText,
  partIdLabel: { zh: '零件 ID：', en: 'Part ID: ' } as LocalizedText,
  assemblyLabel: { zh: '总成：', en: 'Assembly: ' } as LocalizedText,
  systemLabel: { zh: '系统：', en: 'System: ' } as LocalizedText,
  currentExplode: { zh: '当前爆炸量：', en: 'Current explode amount: ' } as LocalizedText,
  hiddenSuffix: { zh: '隐藏', en: 'Hidden' } as LocalizedText,
  visibleSuffix: { zh: '可见', en: 'Visible' } as LocalizedText,
  evidence: { zh: '占位内容：不代表真实机器人的模型、尺寸、性能或工程 BOM。', en: 'Placeholder content: does not represent a real robot\'s model, dimensions, performance, or engineering BOM.' } as LocalizedText,
  overviewBody: { zh: '完整时保持沉静友好的拟人轮廓；爆炸时先露出白色外壳，再暴露精密核心。拖拽画布环绕视角，点击模型或装配树查看零件详情。', en: 'When intact, keep a calm, friendly anthropomorphic silhouette; when exploded, reveal the white shell first, then expose the precision core. Drag the canvas to orbit, click the model or assembly tree to read part details.' } as LocalizedText,
  howToOperate: { zh: '移动指针看眼睛跟随 · 左键拖拽旋转 · 滚轮缩放 · 右键拖拽平移 · 单击选中 · 底部滑杆爆炸 · 「行走演示」跑两圈往返。可在常规 / X-Ray / 线框三种模式间切换。', en: 'Move pointer to see the eyes follow · Left-drag to rotate · Scroll to zoom · Right-drag to pan · Click to select · Bottom slider to explode · "Walk" demos two round trips. Switch between Solid, X-Ray and Wireframe modes.' } as LocalizedText,
  overviewFocus: { zh: '验证重点', en: 'Validation Focus' } as LocalizedText,
  operateLabel: { zh: '如何操作', en: 'How to Operate' } as LocalizedText,
  interactiveParts: { zh: '可交互零件', en: 'Interactive Parts' } as LocalizedText,
  assembliesCount: { zh: '结构总成', en: 'Structural Assemblies' } as LocalizedText,
  systemsCount: { zh: '功能系统', en: 'Functional Systems' } as LocalizedText,
  continuousExplode: { zh: '连续爆炸', en: 'Continuous Explode' } as LocalizedText,
  sevenAssemblies: { zh: '七大结构总成', en: 'Seven Structural Assemblies' } as LocalizedText,
  assemblySummaryCopy: { zh: '默认只展示总成层级，选中零件后再展开，避免 25 个节点同时争抢注意力。', en: 'By default only the assembly hierarchy is shown; parts expand after selection, avoiding 25 nodes competing for attention at once.' } as LocalizedText,
  partsSuffix: { zh: ' 个零件', en: ' Parts' } as LocalizedText,
  systemRelationsTitle: { zh: '系统关系', en: 'System Relations' } as LocalizedText,
  systemRelationsCopy: { zh: '本机不是 25 个孤立模块，而是从感知到计算到驱动与反馈的闭环。', en: 'The unit is not 25 isolated modules, but a closed loop from perception to computation to drive and feedback.' } as LocalizedText,
  relInput: { zh: '感知输入', en: 'Perception Input' } as LocalizedText,
  relInputSub: { zh: '视觉阵列与足底触觉传感器捕获环境状态', en: 'Vision array and plantar tactile sensors capture environment state' } as LocalizedText,
  relCompute: { zh: '计算与控制', en: 'Compute & Control' } as LocalizedText,
  relComputeSub: { zh: '胸腔核心处理输入并生成运动指令', en: 'The thoracic core processes input and generates motion commands' } as LocalizedText,
  relDrive: { zh: '关节驱动', en: 'Joint Drive' } as LocalizedText,
  relDriveSub: { zh: '肩、肘、髋、膝执行器执行运动', en: 'Shoulder, elbow, hip and knee actuators execute the motion' } as LocalizedText,
  relPower: { zh: '电源与反馈', en: 'Power & Feedback' } as LocalizedText,
  relPowerSub: { zh: '电源系统支撑全身并持续上报状态', en: 'The power system supports the whole body and continuously reports status' } as LocalizedText,
  reshowToast: { zh: '零件原本处于隐藏状态，已重新显示', en: 'Part was already hidden, now shown again' } as LocalizedText,
  pickAssemblyFirst: { zh: '请先选中一个总成或零件', en: 'Please select an assembly or part first' } as LocalizedText,
  pickSystemFirst: { zh: '请先切换到一个系统或选中零件', en: 'Please select a system or part first' } as LocalizedText,
  scopeSetToast: { zh: '爆炸范围已设为：', en: 'Explode scope set to: ' } as LocalizedText,
  labelsToastOn: { zh: '零件标签已开启', en: 'Part labels on' } as LocalizedText,
  labelsToastOff: { zh: '零件标签已关闭', en: 'Part labels off' } as LocalizedText,
  rotateToastOn: { zh: '自动旋转已开启', en: 'Auto-rotate on' } as LocalizedText,
  rotateToastOff: { zh: '自动旋转已关闭', en: 'Auto-rotate off' } as LocalizedText,
  walkStart: { zh: '开始两圈往返行走 · 再次点击可停止', en: 'Start two round trips · click again to stop' } as LocalizedText,
  walkStopped: { zh: '已停止行走并回到起点', en: 'Stopped walking and returned to start' } as LocalizedText,
  walkDone: { zh: '已完成两圈往返行走', en: 'Completed two round trips' } as LocalizedText,
  walkReady: { zh: '准备行走', en: 'Ready to Walk' } as LocalizedText,
  walking: { zh: '行走中', en: 'Walking' } as LocalizedText,
  mergingToWalk: { zh: '合并中 · 准备行走', en: 'Merging · preparing to walk' } as LocalizedText,
  gaitLap: { zh: '拟人步态 · 第 {n} / 2 圈', en: 'Anthropomorphic gait · Lap {n}/2' } as LocalizedText,
  restoredToast: { zh: '所有零件已恢复显示', en: 'All parts restored' } as LocalizedText,
  resetToast: { zh: '已恢复初始状态', en: 'Initial state restored' } as LocalizedText,
  expandedAssembly: { zh: '已展开：', en: 'Expanded: ' } as LocalizedText,
  loadingTitle: { zh: '正在唤醒瓷壳仿生单元', en: 'Waking the porcelain bionic unit' } as LocalizedText,
  loadingCopy: { zh: '正在加载 3D 场景、可拆解节点与交互控件…', en: 'Loading 3D scene, detachable nodes, and interaction controls…' } as LocalizedText,
  webglFailTitle: { zh: '无法启动 3D 视图', en: 'Unable to start the 3D view' } as LocalizedText,
  webglFailCopy: { zh: '当前浏览器或设备无法初始化 WebGL，请开启硬件加速后重试。', en: 'The current browser or device cannot initialize WebGL. Please enable hardware acceleration and retry.' } as LocalizedText,
  ctxLost: { zh: '3D 上下文丢失，等待浏览器恢复…', en: '3D context lost, waiting for the browser to recover…' } as LocalizedText,
  ctxRestored: { zh: '3D 上下文已恢复', en: '3D context restored' } as LocalizedText,
  guideEyebrow: { zh: '初次使用', en: 'First Use' } as LocalizedText,
  guideTitle: { zh: '三步看懂这台机器人', en: 'Understand the Robot in Three Steps' } as LocalizedText,
  guideCopy: { zh: '默认先浏览 7 大总成，需要时再展开 25 个零件。移动指针可以看到眼睛自然跟随；右侧「行走演示」可以演示拟人步态两圈往返。', en: 'View the 7 assemblies first, expand the 25 parts when needed. Move the pointer to see the eyes naturally follow it; "Walk" demos two round trips of anthropomorphic gait.' } as LocalizedText,
  guideStep1No: { zh: '01 · 观察', en: '01 · Observe' } as LocalizedText,
  guideStep1H: { zh: '拖拽与缩放', en: 'Drag and Zoom' } as LocalizedText,
  guideStep1P: { zh: '左键拖拽环绕，滚轮缩放；视角漂移后点「等轴测」归位。', en: 'Left-drag to orbit, scroll to zoom; use "Isometric" to return when the view drifts.' } as LocalizedText,
  guideStep2No: { zh: '02 · 选择', en: '02 · Select' } as LocalizedText,
  guideStep2H: { zh: '点击查看详情', en: 'Click to view details' } as LocalizedText,
  guideStep2P: { zh: '点击模型或装配树选中零件；双击模型或树节点可快速定位。', en: 'Click the model or assembly tree to select a part; double-click to locate it quickly.' } as LocalizedText,
  guideStep3No: { zh: '03 · 爆炸', en: '03 · Explode' } as LocalizedText,
  guideStep3H: { zh: '滑杆连续爆炸', en: 'Slide to explode continuously' } as LocalizedText,
  guideStep3P: { zh: '拖动底部滑杆检视结构；也可以把范围限定到当前总成或功能系统。', en: 'Drag the bottom slider to inspect the structure; you can also limit the scope to the current assembly or functional system.' } as LocalizedText,
  guideStart: { zh: '开始探索', en: 'Start Exploring' } as LocalizedText
}

/* =========================================================
   对外接口
   ========================================================= */

export interface SomaStats {
  /** 全机平均爆炸量 0~100 */
  explode: number
  /** 当前选中零件 id（未选中为 null） */
  selected: string | null
  walking: boolean
}

export interface SomaOptions {
  getLocale: () => Lang
  /** 完成一次教学交互（筛系统 / 选零件 / 爆炸合并 / 切显示模式 / 走完两圈）时回调，进度统计归宿主 */
  onTask?: (task: string) => void
  /** 每秒采样一次的关键指标 */
  onStat?: (stats: SomaStats) => void
}

export interface SomaHandle {
  dispose: () => void
  /** 语言切换后重渲染静态文本（树 / 详情 / 标签） */
  refresh: () => void
  selectPart: (id: string) => void
  setExplode: (value: number) => void
  setMode: (mode: DisplayMode) => void
  openGuide: () => void
}

const pick = (t: LocalizedText, lang: Lang) => t[lang] ?? t.en

/* =========================================================
   引擎
   ========================================================= */

export function createSoma(root: HTMLElement, options: SomaOptions): SomaHandle {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector('#' + id) as T | null

  const webglHost = $<HTMLElement>('sa-webgl-host')
  const labelsHost = $<HTMLElement>('sa-labels-host')
  const loadingEl = $<HTMLElement>('sa-loading')
  const systemsEl = $<HTMLElement>('sa-systems')
  const treeEl = $<HTMLElement>('sa-assembly-tree')
  const resultCountEl = $<HTMLElement>('sa-result-count')
  const emptyEl = $<HTMLElement>('sa-empty')
  const searchInput = $<HTMLInputElement>('sa-search')
  const searchClear = $<HTMLElement>('sa-search-clear')
  const heroEl = $<HTMLElement>('sa-hero')
  const heroIndexEl = $<HTMLElement>('sa-hero-index')
  const heroNameEl = $<HTMLElement>('sa-hero-name')
  const heroCodeEl = $<HTMLElement>('sa-hero-code')
  const heroTagsEl = $<HTMLElement>('sa-hero-tags')
  const tabsEl = $<HTMLElement>('sa-tabs')
  const inspBodyEl = $<HTMLElement>('sa-insp-body')
  const explodeRange = $<HTMLInputElement>('sa-explode-range')
  const explodeValueEl = $<HTMLElement>('sa-explode-value')
  const scopeSelect = $<HTMLSelectElement>('sa-scope')
  const stageStatusEl = $<HTMLElement>('sa-status-stage')
  const topStatusEl = $<HTMLElement>('sa-status-top')
  const selectionTopEl = $<HTMLElement>('sa-selection-top')
  const sidebarEl = $<HTMLElement>('sa-sidebar')
  const inspectorEl = $<HTMLElement>('sa-inspector')
  const backdropEl = $<HTMLElement>('sa-backdrop')
  const toastEl = $<HTMLElement>('sa-toast')
  const guideOverlayEl = $<HTMLElement>('sa-guide-overlay')
  const walkLabelEl = $<HTMLElement>('sa-walk-label')

  if (!webglHost || !labelsHost) throw new Error('SOMA: 舞台节点缺失（#sa-webgl-host / #sa-labels-host）')

  const lang = () => options.getLocale()
  const txt = () => lang()

  /* ---------- 状态 ---------- */
  const state = {
    activeSystem: 'all' as SystemKey,
    activeAssembly: null as AssemblyKey | null,
    selectedId: null as string | null,
    hoveredId: null as string | null,
    query: '',
    tab: 'overview' as 'overview' | 'structure' | 'relations',
    mode: 'solid' as DisplayMode,
    scope: 'all' as ExplodeScope,
    labels: true,
    isolatedId: null as string | null,
    hidden: new Set<string>(),
    autoRotate: false,
    playing: false,
    playDirection: 1,
    walking: false,
    walkStartedAt: 0,
    walkDuration: 9200,
    walkLap: 0,
    collapsed: new Set<string>(Object.keys(ASSEMBLIES)),
    pointerDown: null as { x: number, y: number } | null,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    toastTimer: 0 as ReturnType<typeof setTimeout> | 0,
    /** 教学进度：爆炸里程碑（只认 scope=all） */
    everFull: false,
    everMerged: false
  }

  const partById = new Map(PARTS.map(p => [p.id, p]))
  const objects = new Map<string, THREE.Group>()
  const labels = new Map<string, CSS2DObject>()
  const selectableMeshes: THREE.Mesh[] = []
  const breathingMaterials: THREE.MeshPhysicalMaterial[] = []
  const eyeRigs: { eye: THREE.Group, side: number }[] = []
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const posePivot = new THREE.Vector3()
  const poseVector = new THREE.Vector3()
  const poseEuler = new THREE.Euler()
  const gaze = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, lastPointerAt: 0, nextSaccadeAt: 0, nextBlinkAt: 0, blinkStartedAt: -1 }

  let renderer: THREE.WebGLRenderer | null = null
  let labelRenderer: CSS2DRenderer | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let controls: OrbitControls | null = null
  let composer: EffectComposer | null = null
  let hoverOutline: OutlinePass | null = null
  let selectOutline: OutlinePass | null = null
  let modelRoot: THREE.Group | null = null
  let cameraTween: { start: number, duration: number, fromPos: THREE.Vector3, toPos: THREE.Vector3, fromTarget: THREE.Vector3, toTarget: THREE.Vector3 } | null = null
  let ro: ResizeObserver | null = null
  let lastFrameAt = 0
  let lastSampleAt = 0

  /* ---------- 小工具 ---------- */
  function escapeHtml(value: string): string {
    return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;' })[c] as string)
  }
  function colorOf(system: string): string {
    return SYSTEMS[system as SystemKey]?.color || SYSTEMS.all.color
  }
  function styleOf(system: string): string {
    return `--c:${colorOf(system)}`
  }
  function showToast(message: string, duration = 2600): void {
    if (!toastEl) return
    clearTimeout(state.toastTimer)
    toastEl.textContent = message
    toastEl.classList.add('visible')
    state.toastTimer = setTimeout(() => toastEl.classList.remove('visible'), duration)
  }
  function compact(): boolean {
    return matchMedia('(max-width: 759px)').matches
  }
  function openGuide(): void {
    guideOverlayEl?.classList.add('visible')
    guideOverlayEl?.setAttribute('aria-hidden', 'false')
    setTimeout(() => $('sa-guide-done')?.focus(), 50)
  }
  function closeGuide(): void {
    guideOverlayEl?.classList.remove('visible')
    guideOverlayEl?.setAttribute('aria-hidden', 'true')
  }

  /* ---------- Three 场景 ---------- */
  function material(color: number, metalness = 0.38, roughness = 0.28, opt: Record<string, number | undefined> = {}): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color,
      metalness,
      roughness,
      clearcoat: opt.clearcoat ?? 0.5,
      clearcoatRoughness: opt.clearcoatRoughness ?? 0.2,
      sheen: opt.sheen ?? 0,
      sheenColor: (opt.sheenColor as number | undefined) ?? 0xFFFFFF,
      transmission: opt.transmission ?? 0,
      thickness: opt.thickness ?? 0,
      ior: opt.ior ?? 1.5,
      transparent: true,
      opacity: opt.opacity ?? 1,
      emissive: (opt.emissive as number | undefined) ?? 0x000000,
      emissiveIntensity: opt.emissiveIntensity ?? 0
    })
  }
  function porcelain(color = 0xF1EEE5): THREE.MeshPhysicalMaterial {
    return material(color, 0.08, 0.22, { clearcoat: 0.86, clearcoatRoughness: 0.16, sheen: 0.16, sheenColor: 0xFDF7E8 })
  }
  function softMaterial(): THREE.MeshPhysicalMaterial {
    return material(0x171D1E, 0.03, 0.72, { clearcoat: 0.06, sheen: 0.22, sheenColor: 0x546062 })
  }
  function glowMaterial(color = 0x70E4F7, breathe = false): THREE.MeshPhysicalMaterial {
    const m = material(color, 0.04, 0.24, { clearcoat: 0.6, transmission: 0.12, thickness: 0.18, emissive: color, emissiveIntensity: 0.38 })
    if (breathe) breathingMaterials.push(m)
    return m
  }
  function rounded(w: number, h: number, d: number, r: number, color: number, mat: THREE.Material | null = null): THREE.Mesh {
    return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 6, r), mat || material(color))
  }
  function cyl(radius: number, length: number, color: number, axis = 'y', segments = 40, mat: THREE.Material | null = null): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), mat || material(color))
    if (axis === 'x') m.rotation.z = Math.PI / 2
    if (axis === 'z') m.rotation.x = Math.PI / 2
    return m
  }
  function torus(radius: number, tube: number, color: number, axis = 'z', mat: THREE.Material | null = null): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 16, 56), mat || material(color))
    if (axis === 'y') m.rotation.x = Math.PI / 2
    if (axis === 'x') m.rotation.y = Math.PI / 2
    return m
  }
  function capsule(radius: number, length: number, color: number, mat: THREE.Material | null = null): THREE.Mesh {
    return new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 10, 28), mat || material(color))
  }
  function ellipsoid(radius: number, scale: [number, number, number], color: number, mat: THREE.Material | null = null): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), mat || material(color))
    m.scale.set(...scale)
    return m
  }
  function cable(points: [number, number, number][], color = 0xB67A49, radius = 0.018): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)))
    return new THREE.Mesh(new THREE.TubeGeometry(curve, 28, radius, 8, false), material(color, 0.62, 0.3, { clearcoat: 0.25 }))
  }

  function addShape(group: THREE.Group, mesh: THREE.Mesh, position: [number, number, number] = [0, 0, 0], rotation: [number, number, number] = [0, 0, 0], scale: [number, number, number] | null = null): THREE.Mesh {
    mesh.position.fromArray(position)
    mesh.rotation.set(...rotation)
    if (scale) mesh.scale.fromArray(scale)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.partId = group.userData.partId
    const mat = mesh.material as THREE.MeshPhysicalMaterial
    mat.userData.base = { opacity: mat.opacity, transparent: mat.transparent, wireframe: mat.wireframe, color: mat.color.clone() }
    group.add(mesh)
    selectableMeshes.push(mesh)
    return mesh
  }

  function phaseFor(id: string): [number, number] {
    if (['headShell', 'shellLeft', 'shellRight'].includes(id)) return [0, 0.34]
    if (['vision', 'upperArmL', 'upperArmR', 'thighL', 'thighR', 'handL', 'handR', 'footL', 'footR', 'pelvis'].includes(id)) return [0.18, 0.68]
    if (id === 'computeCore') return [0.58, 1]
    if (['chestFrame', 'powerCore'].includes(id)) return [0.48, 0.94]
    return [0.34, 0.82]
  }

  function createPart(def: PartDef): THREE.Group {
    const phase = phaseFor(def.id)
    const group = new THREE.Group()
    group.name = def.id
    group.position.fromArray(def.pos)
    group.userData = { partId: def.id, base: new THREE.Vector3(...def.pos), offset: new THREE.Vector3(...def.explode), current: 0, target: 0, stageStart: phase[0], stageEnd: phase[1], lowerRig: null as THREE.Group | null }
    modelRoot!.add(group)
    objects.set(def.id, group)
    const ivory = 0xF1EEE5, ivoryHi = 0xF8F5EC, titanium = 0x7E8988, graphite = 0x202829, blackGlass = 0x05090B, cyan = 0x73E4F6, copper = 0xB77A49, amber = 0xD5A15D, sole = 0x13191A
    switch (def.id) {
      case 'vision': {
        addShape(group, ellipsoid(0.68, [0.88, 0.42, 0.18], blackGlass, material(blackGlass, 0.18, 0.08, { clearcoat: 1, clearcoatRoughness: 0.04 })), [0, 0.02, 0.48])
        ;[-1, 1].forEach((side) => {
          const eye = new THREE.Group()
          eye.userData.partId = def.id
          eye.position.set(side * 0.245, 0.02, 0.56)
          group.add(eye)
          eyeRigs.push({ eye, side })
          addShape(eye, ellipsoid(0.19, [1.08, 0.68, 0.66], 0xF5F2E9, material(0xF5F2E9, 0.02, 0.18, { clearcoat: 0.95, clearcoatRoughness: 0.06 })), [0, 0, 0])
          addShape(eye, torus(0.087, 0.008, 0x21494D, 'z', material(0x21494D, 0.02, 0.3, { clearcoat: 0.72, clearcoatRoughness: 0.1 })), [0, 0, 0.119])
          addShape(eye, cyl(0.079, 0.022, 0x398D98, 'z', 48, material(0x398D98, 0.02, 0.2, { clearcoat: 0.92, clearcoatRoughness: 0.05, emissive: 0x12383C, emissiveIntensity: 0.16 })), [0, 0, 0.126])
          addShape(eye, cyl(0.037, 0.026, blackGlass, 'z', 40, material(blackGlass, 0.04, 0.06, { clearcoat: 1, clearcoatRoughness: 0.02 })), [0, 0, 0.142])
          addShape(eye, ellipsoid(0.024, [1, 0.72, 0.38], ivoryHi, material(ivoryHi, 0.02, 0.12, { clearcoat: 1, clearcoatRoughness: 0.02, emissive: 0xD8FFFF, emissiveIntensity: 0.18 })), [-0.03, 0.036, 0.158])
        })
        break
      }
      case 'headShell': {
        addShape(group, ellipsoid(0.72, [1.04, 0.92, 0.94], ivory, porcelain()), [0, -0.12, -0.08])
        addShape(group, rounded(0.9, 0.16, 0.48, 0.08, ivoryHi, porcelain(ivoryHi)), [0, -0.52, -0.07])
        break
      }
      case 'neck':
        addShape(group, capsule(0.24, 0.2, graphite, softMaterial()))
        addShape(group, cyl(0.095, 0.62, titanium, 'y', 40, material(titanium, 0.8, 0.2)), [0, 0, 0])
        addShape(group, torus(0.26, 0.035, copper, 'y'), [0, 0.2, 0])
        addShape(group, torus(0.26, 0.035, copper, 'y'), [0, -0.2, 0])
        break
      case 'chestFrame':
        addShape(group, capsule(0.27, 0.9, graphite, softMaterial()), [0, 0, -0.08])
        addShape(group, rounded(1.5, 0.16, 0.42, 0.08, titanium, material(titanium, 0.76, 0.22)), [0, 0.65, 0])
        addShape(group, rounded(1.16, 0.13, 0.36, 0.06, titanium, material(titanium, 0.76, 0.22)), [0, -0.63, 0])
        ;[-1, 1].forEach((s) => {
          addShape(group, capsule(0.075, 1.15, titanium, material(titanium, 0.72, 0.25)), [s * 0.54, 0, 0], [0, 0, s * 0.15])
          addShape(group, cable([[s * 0.3, 0.56, 0.26], [s * 0.55, 0.12, 0.3], [s * 0.4, -0.55, 0.25]], s < 0 ? copper : cyan, 0.024))
        })
        ;[-1, 1].forEach(s => [-0.42, 0, 0.42].forEach(y => addShape(group, cyl(0.032, 0.035, titanium, 'z', 24, material(titanium, 0.82, 0.18)), [s * 0.53, y, 0.27])))
        addShape(group, torus(0.37, 0.018, cyan, 'z', glowMaterial(cyan)), [0, 0, 0.27])
        break
      case 'shellLeft':
      case 'shellRight': {
        const s = def.id === 'shellLeft' ? -1 : 1
        addShape(group, capsule(0.39, 0.88, ivory, porcelain()), [0, 0.06, 0], [0, 0, -s * 0.07], [1, 0.98, 0.72])
        addShape(group, rounded(0.48, 0.12, 0.3, 0.06, ivoryHi, porcelain(ivoryHi)), [-s * 0.05, -0.65, 0.02], [0, 0, s * 0.11])
        addShape(group, rounded(0.3, 0.025, 0.035, 0.012, cyan, glowMaterial(cyan)), [-s * 0.04, 0.4, 0.3])
        addShape(group, rounded(0.035, 0.5, 0.025, 0.012, titanium, material(titanium, 0.72, 0.25)), [-s * 0.28, 0.02, 0.31], [0, 0, -s * 0.07])
        ;[-0.27, 0.27].forEach(y => addShape(group, cyl(0.026, 0.025, copper, 'z', 24, material(copper, 0.72, 0.2)), [-s * 0.27, y, 0.33]))
        break
      }
      case 'computeCore':
        addShape(group, ellipsoid(0.39, [0.9, 1.15, 0.72], cyan, glowMaterial(cyan, true)), [0, 0, 0.02])
        addShape(group, torus(0.5, 0.035, titanium, 'z'), [0, 0, 0])
        addShape(group, torus(0.42, 0.022, copper, 'y'), [0, 0, 0], [0, 0, 0.25])
        addShape(group, rounded(0.82, 1.02, 0.08, 0.04, graphite, softMaterial()), [0, 0, -0.25])
        break
      case 'powerCore':
        addShape(group, capsule(0.31, 0.42, graphite, softMaterial()), [0, 0, -0.03], [0, 0, Math.PI / 2])
        addShape(group, capsule(0.22, 0.28, amber, glowMaterial(amber)), [0, 0, 0.04], [0, 0, Math.PI / 2])
        addShape(group, cable([[-0.5, 0.08, 0.22], [0, 0.32, 0.25], [0.5, 0.08, 0.22]], copper, 0.03))
        ;[-0.22, 0, 0.22].forEach(x => addShape(group, cyl(0.035, 0.08, titanium, 'z', 24, material(titanium, 0.78, 0.2)), [x, -0.2, 0.28]))
        break
      case 'shoulderL':
      case 'shoulderR':
      case 'hipL':
      case 'hipR':
      case 'elbowL':
      case 'elbowR':
      case 'kneeL':
      case 'kneeR': {
        const large = def.id.startsWith('hip') ? 0.34 : def.id.startsWith('shoulder') ? 0.35 : 0.29
        addShape(group, ellipsoid(large, [1, 0.98, 1], graphite, softMaterial()))
        addShape(group, torus(large * 0.68, 0.045, copper, 'x'))
        addShape(group, cyl(large * 0.31, 0.42, cyan, 'x', 40, glowMaterial(cyan)), [0, 0, 0])
        addShape(group, cyl(large * 0.7, 0.05, ivory, 'x', 40, porcelain()), [0, 0, 0])
        ;[-1, 1].forEach((s) => {
          addShape(group, cyl(large * 0.24, 0.065, titanium, 'x', 32, material(titanium, 0.82, 0.17)), [s * large * 0.78, 0, 0])
          addShape(group, torus(large * 0.42, 0.016, cyan, 'x', glowMaterial(cyan)), [s * large * 0.91, 0, 0])
        })
        break
      }
      case 'upperArmL':
      case 'upperArmR': {
        const s = def.id.endsWith('L') ? -1 : 1
        addShape(group, capsule(0.27, 0.62, ivory, porcelain()), [0, 0, 0], [0, 0, s * 0.025], [1, 0.98, 0.9])
        addShape(group, capsule(0.13, 0.68, graphite, softMaterial()), [0, 0, -0.05])
        addShape(group, cable([[s * 0.08, 0.38, 0.2], [s * 0.15, 0, 0.23], [s * 0.08, -0.38, 0.2]], cyan, 0.018))
        ;[0.32, -0.32].forEach(y => addShape(group, torus(0.235, 0.016, titanium, 'y', material(titanium, 0.76, 0.22)), [0, y, 0]))
        break
      }
      case 'handL':
      case 'handR': {
        const s = def.id.endsWith('L') ? -1 : 1
        addShape(group, capsule(0.22, 0.56, ivory, porcelain()), [0, 0.7, 0], [0, 0, s * 0.015], [1, 0.98, 0.86])
        addShape(group, cyl(0.14, 0.18, graphite, 'y', 40, softMaterial()), [0, 0.18, 0])
        addShape(group, rounded(0.43, 0.48, 0.2, 0.11, ivory, porcelain()), [0, -0.08, 0.02])
        for (let i = -2; i <= 2; i++) {
          const x = i * 0.092
          const len = 0.38 - Math.abs(i) * 0.028
          addShape(group, capsule(0.035, len * 0.62, ivory, porcelain()), [x, -0.43 - (len - 0.34) * 0.2, 0.02], [0, 0, i * 0.022])
        }
        addShape(group, capsule(0.045, 0.18, ivory, porcelain()), [-s * 0.26, -0.18, 0.02], [0, 0, -s * 0.7])
        break
      }
      case 'pelvis':
        addShape(group, ellipsoid(0.72, [1.05, 0.5, 0.62], ivory, porcelain()), [0, 0.02, 0])
        addShape(group, rounded(0.68, 0.22, 0.68, 0.1, graphite, softMaterial()), [0, 0.28, 0])
        addShape(group, rounded(0.42, 0.035, 0.3, 0.015, cyan, glowMaterial(cyan)), [0, 0.08, 0.42])
        ;[-1, 1].forEach((s) => {
          addShape(group, torus(0.17, 0.022, copper, 'x', material(copper, 0.7, 0.22)), [s * 0.67, 0, 0])
          addShape(group, cyl(0.09, 0.08, titanium, 'x', 28, material(titanium, 0.8, 0.18)), [s * 0.7, 0, 0])
        })
        break
      case 'thighL':
      case 'thighR': {
        const s = def.id.endsWith('L') ? -1 : 1
        const lowerRig = new THREE.Group()
        lowerRig.name = `${def.id}_KNEE_RIG`
        lowerRig.position.y = -0.84
        lowerRig.userData.partId = def.id
        group.add(lowerRig)
        group.userData.lowerRig = lowerRig
        addShape(group, capsule(0.3, 0.86, ivory, porcelain()), [0, 0.02, 0], [0, 0, s * 0.018], [1, 0.98, 0.88])
        addShape(group, capsule(0.14, 0.9, graphite, softMaterial()), [0, 0.02, -0.05])
        addShape(lowerRig, capsule(0.255, 1.02, ivoryHi, porcelain(ivoryHi)), [0, -0.44, 0], [0, 0, -s * 0.015], [0.96, 1, 0.86])
        addShape(lowerRig, capsule(0.11, 1.08, graphite, softMaterial()), [0, -0.44, -0.04])
        addShape(group, cable([[s * 0.1, 0.42, 0.2], [s * 0.16, -0.2, 0.22], [s * 0.1, -1.7, 0.18]], cyan, 0.017))
        ;[0.4, -0.38].forEach(y => addShape(group, torus(0.255, 0.015, titanium, 'y', material(titanium, 0.76, 0.22)), [0, y, 0]))
        ;[-0.02, -0.86].forEach(y => addShape(lowerRig, torus(0.218, 0.015, titanium, 'y', material(titanium, 0.76, 0.22)), [0, y, 0]))
        break
      }
      case 'footL':
      case 'footR':
        addShape(group, rounded(0.62, 0.2, 1.06, 0.12, sole, softMaterial()), [0, -0.04, 0.25])
        addShape(group, rounded(0.58, 0.22, 0.84, 0.13, ivory, porcelain()), [0, 0.14, 0.15])
        addShape(group, rounded(0.49, 0.035, 0.72, 0.016, cyan, glowMaterial(cyan)), [0, -0.16, 0.26])
        addShape(group, capsule(0.15, 0.16, graphite, softMaterial()), [0, 0.38, -0.21])
        addShape(group, rounded(0.56, 0.08, 0.16, 0.035, titanium, material(titanium, 0.72, 0.25)), [0, 0.02, 0.72])
        break
    }
    if (def.label) {
      const el = document.createElement('div')
      el.className = 'part-label'
      el.textContent = `${def.no} · ${def.name[txt()]}`
      const label = new CSS2DObject(el)
      label.position.set(0, 0.48, 0)
      group.add(label)
      labels.set(def.id, label)
    }
    return group
  }

  function buildRobot(): void {
    PARTS.forEach(createPart)
    applyVisualState()
  }

  /* ---------- 列表 / 树 / 详情渲染 ---------- */
  function filteredParts(): PartDef[] {
    const q = state.query.trim().toLowerCase()
    return PARTS.filter((p) => {
      const systemOk = state.activeSystem === 'all' || p.system === state.activeSystem
      const hay = [p.name.zh, p.name.en, p.code, p.no, p.system, SYSTEMS[p.system].name.zh, SYSTEMS[p.system].name.en, ASSEMBLIES[p.assembly].name.zh, ASSEMBLIES[p.assembly].name.en, p.summary.zh, p.summary.en, ...p.visible.map(v => `${v.zh} ${v.en}`)].join(' ').toLowerCase()
      return systemOk && (!q || hay.includes(q))
    })
  }

  function renderSystems(): void {
    if (!systemsEl) return
    systemsEl.innerHTML = (Object.entries(SYSTEMS) as [SystemKey, { name: LocalizedText, color: string }][]).map(([key, s]) =>
      `<button class="system-btn${state.activeSystem === key ? ' active' : ''}" type="button" data-system="${key}" style="--c:${s.color}" aria-pressed="${state.activeSystem === key}">${escapeHtml(pick(s.name, txt()))}</button>`).join('')
  }

  function renderTree(): void {
    if (!treeEl || !resultCountEl || !emptyEl) return
    const visible = filteredParts()
    const ids = new Set(visible.map(p => p.id))
    let html = ''
    let total = 0
    ;(Object.entries(ASSEMBLIES) as [AssemblyKey, { name: LocalizedText, code: string, system: SystemKey }][]).forEach(([key, a]) => {
      const children = PARTS.filter(p => p.assembly === key && ids.has(p.id))
      if (!children.length) return
      total += children.length
      const collapsed = state.collapsed.has(key) && !state.query
      html += `<section class="assembly${collapsed ? ' collapsed' : ''}">
        <button class="assembly-head${state.activeAssembly === key ? ' active' : ''}" type="button" data-assembly="${key}" style="${styleOf(a.system)}" title="${escapeHtml(pick({ zh: '点击展开/收起，双击设为爆炸对象', en: 'Click to expand/collapse, double-click to set as explode assembly' }, txt()))}"><span class="assembly-arrow">▼</span><span class="assembly-name">${escapeHtml(pick(a.name, txt()))}</span><span class="assembly-count">${children.length}</span></button>
        <div class="tree-children">${children.map(p => `<div class="tree-item${state.selectedId === p.id ? ' active' : ''}" role="button" tabindex="0" data-part="${p.id}" style="${styleOf(p.system)}" title="${escapeHtml(pick({ zh: '点击选中，双击定位', en: 'Click to select, double-click to locate' }, txt()))}"><span class="tree-no">${p.no}</span><span class="tree-name">${escapeHtml(pick(p.name, txt()))}</span><button class="visibility-dot${state.hidden.has(p.id) ? ' hidden-part' : ''}" type="button" data-visibility="${p.id}" aria-label="${state.hidden.has(p.id) ? escapeHtml(pick({ zh: '显示', en: 'Show' }, txt())) : escapeHtml(pick({ zh: '隐藏', en: 'Hide' }, txt()))}${escapeHtml(pick(p.name, txt()))}">${state.hidden.has(p.id) ? '⊘' : '◉'}</button></div>`).join('')}</div>
      </section>`
    })
    treeEl.innerHTML = html
    resultCountEl.textContent = `${String(total).padStart(2, '0')} / ${String(PARTS.length).padStart(2, '0')}`
    emptyEl.classList.toggle('visible', total === 0)
  }

  function renderInspector(): void {
    if (!heroEl || !heroIndexEl || !heroNameEl || !heroCodeEl || !heroTagsEl || !inspBodyEl) return
    tabsEl?.querySelectorAll('.tab').forEach((b) => {
      const active = (b as HTMLElement).dataset.tab === state.tab
      b.classList.toggle('active', active)
      b.setAttribute('aria-selected', String(active))
    })
    const p = state.selectedId ? partById.get(state.selectedId) : undefined
    if (!p) {
      heroEl.style.setProperty('--c', SYSTEMS.all.color)
      heroEl.dataset.no = '00'
      heroIndexEl.textContent = pick(T.heroIndex, txt())
      heroNameEl.textContent = pick(T.heroName, txt())
      heroCodeEl.textContent = pick(T.heroCode, txt())
      heroTagsEl.innerHTML = `<span class="tag system">${escapeHtml(pick({ zh: '整机', en: 'Full Unit' }, txt()))}</span><span class="tag">${escapeHtml(pick({ zh: '交互验证模型', en: 'Interaction Validation Model' }, txt()))}</span>`
      inspBodyEl.style.setProperty('--c', SYSTEMS.all.color)
      if (state.tab === 'overview') {
        inspBodyEl.innerHTML = `<section class="info-section"><div class="section-label">${escapeHtml(pick(T.overviewFocus, txt()))}</div><p class="section-copy">${escapeHtml(pick(T.overviewBody, txt()))}</p><div class="stat-grid"><div class="stat"><div class="stat-value">${PARTS.length}</div><div class="stat-label">${escapeHtml(pick(T.interactiveParts, txt()))}</div></div><div class="stat"><div class="stat-value">07</div><div class="stat-label">${escapeHtml(pick(T.assembliesCount, txt()))}</div></div><div class="stat"><div class="stat-value">05</div><div class="stat-label">${escapeHtml(pick(T.systemsCount, txt()))}</div></div><div class="stat"><div class="stat-value">100%</div><div class="stat-label">${escapeHtml(pick(T.continuousExplode, txt()))}</div></div></div></section><section class="info-section"><div class="section-label">${escapeHtml(pick(T.operateLabel, txt()))}</div><p class="section-copy">${escapeHtml(pick(T.howToOperate, txt()))}</p></section><div class="evidence">${escapeHtml(pick(T.evidence, txt()))}</div>`
      }
      if (state.tab === 'structure') {
        inspBodyEl.innerHTML = `<section class="info-section"><div class="section-label">${escapeHtml(pick(T.sevenAssemblies, txt()))}</div><p class="section-copy">${escapeHtml(pick(T.assemblySummaryCopy, txt()))}</p><div class="assembly-summary">${(Object.entries(ASSEMBLIES) as [AssemblyKey, { name: LocalizedText, code: string, system: SystemKey }][]).map(([key, a]) => `<button type="button" data-jump-assembly="${key}" style="${styleOf(a.system)}"><span class="assembly-summary-dot"></span><span>${escapeHtml(pick(a.name, txt()))}</span><span class="assembly-summary-count">${String(PARTS.filter(pp => pp.assembly === key).length).padStart(2, '0')}${escapeHtml(pick(T.partsSuffix, txt()))}</span></button>`).join('')}</div></section>`
      }
      if (state.tab === 'relations') {
        inspBodyEl.innerHTML = `<section class="info-section"><div class="section-label">${escapeHtml(pick(T.systemRelationsTitle, txt()))}</div><p class="section-copy">${escapeHtml(pick(T.systemRelationsCopy, txt()))}</p><div class="relation-flow">
          <div class="relation-node"><span class="relation-index">01</span><div><strong>${escapeHtml(pick(T.relInput, txt()))}</strong><small>${escapeHtml(pick(T.relInputSub, txt()))}</small></div></div>
          <div class="relation-node"><span class="relation-index">02</span><div><strong>${escapeHtml(pick(T.relCompute, txt()))}</strong><small>${escapeHtml(pick(T.relComputeSub, txt()))}</small></div></div>
          <div class="relation-node"><span class="relation-index">03</span><div><strong>${escapeHtml(pick(T.relDrive, txt()))}</strong><small>${escapeHtml(pick(T.relDriveSub, txt()))}</small></div></div>
          <div class="relation-node"><span class="relation-index">04</span><div><strong>${escapeHtml(pick(T.relPower, txt()))}</strong><small>${escapeHtml(pick(T.relPowerSub, txt()))}</small></div></div>
        </div></section>`
      }
      return
    }
    const c = colorOf(p.system)
    heroEl.style.setProperty('--c', c)
    heroEl.dataset.no = p.no
    heroIndexEl.textContent = `${pick(SYSTEMS[p.system].name, txt())} / ${p.no}`
    heroNameEl.textContent = pick(p.name, txt())
    heroCodeEl.textContent = p.code
    heroTagsEl.innerHTML = `<span class="tag system">${escapeHtml(pick(SYSTEMS[p.system].name, txt()))}</span><span class="tag">${escapeHtml(pick(ASSEMBLIES[p.assembly].name, txt()))}</span>`
    inspBodyEl.style.setProperty('--c', c)
    let body = ''
    if (state.tab === 'overview') {
      body = `<section class="info-section"><div class="section-label">${escapeHtml(pick(T.conceptLabel, txt()))}</div><p class="section-copy">${escapeHtml(pick(p.summary, txt()))}</p></section><section class="info-section"><div class="section-label">${escapeHtml(pick(T.identityLabel, txt()))}</div><p class="section-copy">${escapeHtml(pick(T.partIdLabel, txt()))}<code>${p.id}</code><br>${escapeHtml(pick(T.assemblyLabel, txt()))}${escapeHtml(pick(ASSEMBLIES[p.assembly].name, txt()))}<br>${escapeHtml(pick(T.systemLabel, txt()))}${escapeHtml(pick(SYSTEMS[p.system].name, txt()))}</p></section>`
    }
    if (state.tab === 'structure') {
      body = `<section class="info-section"><div class="section-label">${escapeHtml(pick(T.visibleLabel, txt()))}</div><ul class="detail-list">${p.visible.map(x => `<li>${escapeHtml(pick(x, txt()))}</li>`).join('')}</ul></section>`
    }
    if (state.tab === 'relations') {
      body = `<section class="info-section"><div class="section-label">${escapeHtml(pick(T.relationsLabel, txt()))}</div><ul class="detail-list">${p.relations.map(x => `<li>${escapeHtml(pick(x, txt()))}</li>`).join('')}</ul></section>`
    }
    const partState = objects.get(p.id)?.userData
    const actions = `<div class="actions-grid" aria-label="${escapeHtml(pick({ zh: '零件快捷操作', en: 'Part Quick Actions' }, txt()))}"><button class="action primary" type="button" data-action="focus">${escapeHtml(pick(T.focusPart, txt()))}</button><button class="action" type="button" data-action="move">${((partState?.target as number) || 0) > 0.5 ? escapeHtml(pick(T.resetView, txt())) : escapeHtml(pick(T.explodeOut, txt()))}</button><button class="action" type="button" data-action="isolate">${state.isolatedId === p.id ? escapeHtml(pick(T.exitIsolation, txt())) : escapeHtml(pick(T.isolate, txt()))}</button><button class="action" type="button" data-action="visibility">${state.hidden.has(p.id) ? escapeHtml(pick(T.showPart, txt())) : escapeHtml(pick(T.hidePart, txt()))}</button></div>`
    inspBodyEl.innerHTML = `${actions}${body}<section class="info-section"><div class="section-label">${escapeHtml(pick(T.assemblyStatus, txt()))}</div><p class="section-copy">${escapeHtml(pick(T.currentExplode, txt()))}${Math.round(((partState?.target as number) || 0) * 100)}% · ${state.hidden.has(p.id) ? escapeHtml(pick(T.hiddenSuffix, txt())) : escapeHtml(pick(T.visibleSuffix, txt()))}</p></section><div class="evidence">${escapeHtml(pick(T.evidence, txt()))}</div>`
  }

  /* ---------- 交互 ---------- */
  function selectPart(id: string, opts: { focus?: boolean } = {}): void {
    if (!partById.has(id)) return
    if (state.hidden.has(id)) {
      state.hidden.delete(id)
      showToast(pick(T.reshowToast, txt()))
    }
    state.selectedId = id
    state.activeAssembly = partById.get(id)!.assembly
    state.tab = 'overview'
    state.collapsed = new Set(Object.keys(ASSEMBLIES))
    state.collapsed.delete(state.activeAssembly)
    const obj = objects.get(id)
    if (selectOutline) selectOutline.selectedObjects = obj ? [obj] : []
    if (selectionTopEl) selectionTopEl.textContent = partById.get(id)!.code
    renderTree()
    renderInspector()
    updateLabels()
    applyVisualState()
    if (opts.focus) focusObject(obj ?? null)
    if (compact()) openInfo()
    options.onTask?.(`assembly:${partById.get(id)!.assembly}`)
  }

  function clearSelection(): void {
    state.selectedId = null
    if (selectOutline) selectOutline.selectedObjects = []
    if (selectionTopEl) selectionTopEl.textContent = pick(T.noneSelected, txt())
    renderTree()
    renderInspector()
    updateLabels()
    applyVisualState()
  }

  function setSystem(key: SystemKey): void {
    if (!SYSTEMS[key]) return
    state.activeSystem = key
    renderSystems()
    renderTree()
    applyVisualState()
    if (key !== 'all') options.onTask?.(`system:${key}`)
  }

  function setMode(mode: DisplayMode): void {
    if (!['solid', 'xray', 'wire'].includes(mode)) return
    const changed = state.mode !== mode
    state.mode = mode
    root.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.mode === mode))
    applyVisualState()
    if (changed && mode !== 'solid') options.onTask?.(`mode:${mode}`)
  }

  function affectedParts(): PartDef[] {
    if (state.scope === 'all') return PARTS
    if (state.scope === 'assembly') {
      const assembly = state.activeAssembly || (state.selectedId ? partById.get(state.selectedId)?.assembly : undefined)
      if (!assembly) {
        showToast(pick(T.pickAssemblyFirst, txt()))
        return []
      }
      return PARTS.filter(p => p.assembly === assembly)
    }
    const system: SystemKey | undefined = state.activeSystem !== 'all' ? state.activeSystem : (state.selectedId ? partById.get(state.selectedId)?.system : undefined)
    if (!system) {
      showToast(pick(T.pickSystemFirst, txt()))
      return []
    }
    return PARTS.filter(p => p.system === system)
  }

  function setExplode(value: number, opts: { instant?: boolean } = {}): boolean {
    if (state.walking) stopWalking({ manual: true, silent: true })
    const t = Math.max(0, Math.min(1, value))
    const affected = affectedParts()
    if (!affected.length) return false
    affected.forEach((p) => {
      const d = objects.get(p.id)!.userData
      d.target = t
      if (opts.instant || state.reducedMotion) d.current = t
    })
    if (explodeRange) explodeRange.value = String(Math.round(t * 100))
    if (explodeValueEl) explodeValueEl.textContent = `${String(Math.round(t * 100)).padStart(3, '0')}%`
    state.playing = false
    const playBtn = $('sa-play')
    if (playBtn) playBtn.textContent = '▶'
    // 教学里程碑：整机拉满 → 合并回 0（只认 scope=all）
    if (state.scope === 'all') {
      if (t >= 0.99 && !state.everFull) {
        state.everFull = true
        options.onTask?.('explode:full')
      }
      if (t <= 0.01 && state.everFull && !state.everMerged) {
        state.everMerged = true
        options.onTask?.('explode:merged')
      }
    }
    updateAssemblyStatus()
    renderInspector()
    return true
  }

  function updateAssemblyStatus(): void {
    if (!topStatusEl || !stageStatusEl) return
    const targets = PARTS.map(p => objects.get(p.id)!.userData.target as number)
    const avg = targets.reduce((a, b) => a + b, 0) / targets.length
    if (!state.walking) {
      const label = avg < 0.01 ? pick(T.assembled, txt()) : avg > 0.99 ? pick(T.fullExplode, txt()) : `${pick(T.exploding, txt())} · ${Math.round(avg * 100)}%`
      topStatusEl.textContent = label
      stageStatusEl.textContent = label
      stageStatusEl.classList.toggle('animating', avg > 0.01 && avg < 0.99)
    }
  }

  function applyVisualState(): void {
    PARTS.forEach((p) => {
      const obj = objects.get(p.id)
      if (!obj) return
      const visible = !state.hidden.has(p.id) && (!state.isolatedId || state.isolatedId === p.id)
      obj.visible = visible
      obj.traverse((node) => {
        if (!(node as THREE.Mesh).isMesh) return
        const mesh = node as THREE.Mesh
        const mat = mesh.material as THREE.MeshPhysicalMaterial
        const base = mat.userData.base as { color: THREE.Color }
        const dimmed = state.activeSystem !== 'all' && p.system !== state.activeSystem && state.selectedId !== p.id
        mat.wireframe = state.mode === 'wire'
        mat.transparent = state.mode !== 'solid' || dimmed
        mat.opacity = state.mode === 'xray' ? (state.selectedId === p.id ? 0.92 : 0.18) : state.mode === 'wire' ? 0.58 : dimmed ? 0.12 : 1
        mat.depthWrite = state.mode === 'solid' && !dimmed
        mat.color.copy(base.color)
        mat.needsUpdate = true
      })
    })
    const clearButton = $('sa-show-all')
    if (clearButton) {
      const hasFilteredVisibility = Boolean(state.isolatedId) || state.hidden.size > 0
      ;(clearButton as HTMLButtonElement).disabled = !hasFilteredVisibility
      clearButton.classList.toggle('active', hasFilteredVisibility)
    }
    updateLabels()
  }

  function updateLabels(): void {
    labels.forEach((label, id) => {
      const p = partById.get(id)!
      const show = state.labels && !state.hidden.has(id) && (!state.isolatedId || state.isolatedId === id) && (state.selectedId === id || (state.activeSystem !== 'all' && p.system === state.activeSystem))
      label.visible = show
      label.element.classList.toggle('selected', state.selectedId === id)
    })
  }

  function focusObject(obj: THREE.Object3D | null): void {
    if (!obj || !camera || !controls) return
    const b = new THREE.Box3().setFromObject(obj)
    const center = b.getCenter(new THREE.Vector3())
    const size = b.getSize(new THREE.Vector3()).length()
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize()
    const distance = Math.max(3.2, size * 3.2)
    const targetPos = center.clone().add(dir.multiplyScalar(distance))
    cameraTween = { start: performance.now(), duration: state.reducedMotion ? 1 : 650, fromPos: camera.position.clone(), toPos: targetPos, fromTarget: controls.target.clone(), toTarget: center }
  }

  function setView(view: string): void {
    if (!camera || !controls) return
    const target = new THREE.Vector3(0, 1.5, 0)
    const positions: Record<string, [number, number, number]> = { front: [0, 2.8, 13], right: [13, 2.8, 0], top: [0, 15, 0.01], iso: [8.2, 4.4, 12.4] }
    const to = positions[view]
    if (!to) return
    cameraTween = { start: performance.now(), duration: state.reducedMotion ? 1 : 700, fromPos: camera.position.clone(), toPos: new THREE.Vector3(...to), fromTarget: controls.target.clone(), toTarget: target }
  }

  function pick_(event: PointerEvent | MouseEvent, hover = false): void {
    if (!renderer || !camera) return
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(selectableMeshes.filter(m => m.visible), false)
    const id = (hits.find(h => h.object.userData.partId)?.object.userData.partId as string | undefined) || null
    if (hover) {
      if (id !== state.hoveredId) {
        state.hoveredId = id
        if (hoverOutline) hoverOutline.selectedObjects = id && id !== state.selectedId && objects.has(id) ? [objects.get(id)!] : []
        renderer.domElement.style.cursor = id ? 'pointer' : 'grab'
      }
      return
    }
    if (id) selectPart(id)
    else clearSelection()
  }

  /* ---------- 眼神跟随 + 眨眼 ---------- */
  function updateGazeFromPointer(event: PointerEvent): void {
    if (!renderer) return
    const rect = renderer.domElement.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width * 2 - 1
    const y = (event.clientY - rect.top) / rect.height * 2 - 1
    gaze.targetYaw = THREE.MathUtils.clamp(x * 0.34, -0.34, 0.34)
    gaze.targetPitch = THREE.MathUtils.clamp(y * 0.2, -0.2, 0.2)
    gaze.lastPointerAt = performance.now()
  }

  function animateEyes(timestamp: number, dt: number): void {
    const pointerActive = timestamp - gaze.lastPointerAt < 1500
    if (!pointerActive && !state.reducedMotion && timestamp >= gaze.nextSaccadeAt) {
      gaze.targetYaw = (Math.random() - 0.5) * 0.2
      gaze.targetPitch = (Math.random() - 0.5) * 0.09
      gaze.nextSaccadeAt = timestamp + 1800 + Math.random() * 1800
    }
    const easing = 1 - Math.exp(-dt * (pointerActive ? 9 : 4.2))
    gaze.yaw = THREE.MathUtils.lerp(gaze.yaw, gaze.targetYaw, easing)
    gaze.pitch = THREE.MathUtils.lerp(gaze.pitch, gaze.targetPitch, easing)
    eyeRigs.forEach(({ eye, side }) => {
      const convergence = -side * 0.012
      eye.rotation.set(gaze.pitch, gaze.yaw + convergence, 0, 'XYZ')
    })
    if (!state.reducedMotion && timestamp >= gaze.nextBlinkAt && gaze.blinkStartedAt < 0) {
      gaze.blinkStartedAt = timestamp
      gaze.nextBlinkAt = timestamp + 3200 + Math.random() * 2400
    }
    let blink = 0
    if (gaze.blinkStartedAt >= 0) {
      const elapsed = timestamp - gaze.blinkStartedAt
      blink = elapsed < 95 ? elapsed / 95 : elapsed < 215 ? 1 - (elapsed - 95) / 120 : 0
      if (elapsed >= 215) gaze.blinkStartedAt = -1
    }
    const blinkEase = blink * blink * (3 - 2 * blink)
    eyeRigs.forEach(({ eye }) => {
      eye.scale.y = 1 - blinkEase * 0.9
    })
  }

  /* ---------- 画布事件 ---------- */
  function bindCanvasEvents(): void {
    if (!renderer) return
    const dom = renderer.domElement
    dom.addEventListener('pointerdown', (e) => {
      state.pointerDown = { x: e.clientX, y: e.clientY }
    })
    dom.addEventListener('pointermove', (e) => {
      updateGazeFromPointer(e)
      pick_(e, true)
    })
    dom.addEventListener('pointerleave', () => {
      gaze.lastPointerAt = 0
    })
    dom.addEventListener('pointerup', (e) => {
      if (!state.pointerDown) return
      const d = Math.hypot(e.clientX - state.pointerDown.x, e.clientY - state.pointerDown.y)
      if (d < 5) pick_(e, false)
      state.pointerDown = null
    })
    dom.addEventListener('dblclick', (e) => {
      pick_(e, false)
      if (state.selectedId) focusObject(objects.get(state.selectedId)!)
    })
    dom.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      showToast(pick(T.ctxLost, txt()), 5000)
    })
    dom.addEventListener('webglcontextrestored', () => showToast(pick(T.ctxRestored, txt())))
  }

  /* ---------- 步态 ---------- */
  function posePart(id: string, pivot: [number, number, number], rx = 0, ry = 0, rz = 0, offset: [number, number, number] | null = null): void {
    const obj = objects.get(id)
    if (!obj) return
    posePivot.set(...pivot)
    poseEuler.set(rx, ry, rz, 'XYZ')
    obj.position.sub(posePivot).applyEuler(poseEuler).add(posePivot)
    if (offset) obj.position.add(new THREE.Vector3(...offset))
    obj.rotation.set(rx, ry, rz)
  }

  function footTrajectory(phase: number, offset: number, locomotion: number, motionScale: number): { stride: number, lift: number, roll: number, cycle: number } {
    const cycle = ((phase / (Math.PI * 2) + offset) % 1 + 1) % 1
    let stride: number, lift: number, roll: number
    if (cycle < 0.62) {
      const t = cycle / 0.62
      stride = 0.34 - 0.68 * t
      lift = 0
      roll = t < 0.18 ? (1 - t / 0.18) * 0.055 : t > 0.78 ? -(t - 0.78) / 0.22 * 0.095 : 0
    } else {
      const t = (cycle - 0.62) / 0.38
      const eased = t * t * (3 - 2 * t)
      stride = -0.34 + 0.68 * eased
      lift = Math.sin(Math.PI * t) * 0.3
      roll = -Math.sin(Math.PI * t) * 0.075
    }
    return { stride: stride * locomotion * motionScale, lift: lift * locomotion * motionScale, roll: roll * locomotion * motionScale, cycle }
  }

  function poseLeg(side: 'left' | 'right', footMotion: { stride: number, lift: number, roll: number }): void {
    const suffix = side === 'left' ? 'L' : 'R'
    const hipId = `hip${suffix}`, thighId = `thigh${suffix}`, kneeId = `knee${suffix}`, footId = `foot${suffix}`
    const hipBase = partById.get(hipId)!.pos
    const kneeBase = partById.get(kneeId)!.pos
    const footBase = partById.get(footId)!.pos
    const hip = objects.get(hipId)!, thigh = objects.get(thighId)!, knee = objects.get(kneeId)!, foot = objects.get(footId)!
    const upperLength = Math.hypot(kneeBase[1] - hipBase[1], kneeBase[2] - hipBase[2])
    const lowerLength = Math.hypot(footBase[1] - kneeBase[1], footBase[2] - kneeBase[2])
    const targetY = footBase[1] + footMotion.lift
    const targetZ = footBase[2] + footMotion.stride
    const down = hipBase[1] - targetY
    const forward = targetZ - hipBase[2]
    const distance = Math.max(Math.abs(upperLength - lowerLength) + 0.01, Math.min(upperLength + lowerLength - 0.01, Math.hypot(down, forward)))
    const kneeFlex = Math.acos(Math.max(-1, Math.min(1, (distance * distance - upperLength * upperLength - lowerLength * lowerLength) / (2 * upperLength * lowerLength))))
    const targetAngle = Math.atan2(-forward, down)
    const hipOffset = Math.atan2(lowerLength * Math.sin(kneeFlex), upperLength + lowerLength * Math.cos(kneeFlex))
    const hipAngle = targetAngle + hipOffset

    hip.rotation.x = hipAngle * 0.62
    posePart(thighId, hipBase, hipAngle)
    if (thigh.userData.lowerRig) (thigh.userData.lowerRig as THREE.Group).rotation.x = -kneeFlex
    posePart(kneeId, hipBase, hipAngle)
    knee.rotation.x = hipAngle - kneeFlex
    foot.position.set(footBase[0], targetY, targetZ)
    foot.rotation.x = footMotion.roll
  }

  function poseArm(side: 'left' | 'right', step: number, motionScale: number): void {
    const suffix = side === 'left' ? 'L' : 'R'
    const shoulderId = `shoulder${suffix}`, upperId = `upperArm${suffix}`, elbowId = `elbow${suffix}`, handId = `hand${suffix}`
    const shoulderBase = partById.get(shoulderId)!.pos
    const elbowBase = partById.get(elbowId)!.pos
    const handBase = partById.get(handId)!.pos
    const armAngle = -step * 0.34 * motionScale
    const elbowFlex = (0.08 + 0.12 * Math.max(0, -step)) * Math.min(1, Math.abs(step) * 3) * motionScale
    const shoulder = objects.get(shoulderId)!, elbow = objects.get(elbowId)!, hand = objects.get(handId)!

    shoulder.rotation.x = armAngle * 0.42
    posePart(upperId, shoulderBase, armAngle)
    posePart(elbowId, shoulderBase, armAngle)
    elbow.rotation.x = armAngle + elbowFlex

    poseEuler.set(armAngle + elbowFlex, 0, 0, 'XYZ')
    poseVector.set(handBase[0] - elbowBase[0], handBase[1] - elbowBase[1], handBase[2] - elbowBase[2]).applyEuler(poseEuler)
    hand.position.copy(elbow.position).add(poseVector)
    hand.rotation.x = armAngle + elbowFlex
  }

  function resetWalkPose(): void {
    if (!modelRoot) return
    modelRoot.position.set(0, 0, 0)
    modelRoot.rotation.set(0, 0, 0)
    PARTS.forEach((p) => {
      const obj = objects.get(p.id)
      if (!obj) return
      obj.rotation.set(0, 0, 0)
      if (obj.userData.lowerRig) (obj.userData.lowerRig as THREE.Group).rotation.set(0, 0, 0)
    })
  }

  function syncWalkButton(walking: boolean, label?: LocalizedText): void {
    const btn = $('sa-walk-toggle')
    if (!btn) return
    btn.classList.toggle('active', walking)
    btn.setAttribute('aria-pressed', String(walking))
    if (walkLabelEl) walkLabelEl.textContent = pick(label ?? (walking ? T.stopWalking : T.walk), txt())
  }

  function stopWalking(opts: { manual?: boolean, silent?: boolean } = {}): void {
    if (!state.walking) return
    state.walking = false
    state.walkLap = 0
    resetWalkPose()
    syncWalkButton(false)
    if (!opts.manual) {
      // 自然走完两圈 → 教学里程碑
      options.onTask?.('walk:done')
    }
    updateAssemblyStatus()
    if (!opts.silent) showToast(pick(opts.manual ? T.walkStopped : T.walkDone, txt()))
  }

  function startWalking(): void {
    if (!modelRoot || !explodeValueEl) return
    if (state.walking) {
      stopWalking({ manual: true })
      return
    }
    const needsMerge = PARTS.some((p) => {
      const d = objects.get(p.id)!.userData
      return (d.target as number) > 0.001 || (d.current as number) > 0.025
    })
    PARTS.forEach((p) => {
      const d = objects.get(p.id)!.userData
      d.target = 0
      if (state.reducedMotion) d.current = 0
    })
    state.hidden.clear()
    state.isolatedId = null
    state.playing = false
    state.walking = true
    state.walkLap = 0
    state.walkDuration = state.reducedMotion ? 7000 : 9200
    state.walkStartedAt = performance.now() + (needsMerge && !state.reducedMotion ? 720 : 120)
    if (explodeRange) explodeRange.value = '0'
    explodeValueEl.textContent = '000%'
    const playBtn = $('sa-play')
    if (playBtn) playBtn.textContent = '▶'
    syncWalkButton(true)
    applyVisualState()
    renderTree()
    renderInspector()
    updateAssemblyStatus()
    if (topStatusEl && stageStatusEl) {
      topStatusEl.textContent = pick(needsMerge ? T.walkReady : T.walking, txt())
      stageStatusEl.textContent = pick(needsMerge ? T.mergingToWalk : T.gaitLap, txt()).replace('{n}', '1')
      stageStatusEl.classList.add('animating')
    }
    showToast(pick(T.walkStart, txt()))
  }

  function applyWalkingPose(timestamp: number): void {
    if (!state.walking || !modelRoot) return
    if (timestamp < state.walkStartedAt) return
    const progress = Math.min(1, (timestamp - state.walkStartedAt) / state.walkDuration)
    if (progress >= 1) {
      stopWalking()
      return
    }

    const eased = progress * progress * (3 - 2 * progress)
    const travelPhase = eased * Math.PI * 4
    const gaitPhase = travelPhase * 3
    const fadeIn = Math.min(1, progress / 0.07)
    const fadeOut = Math.min(1, (1 - progress) / 0.07)
    const movementEnvelope = (fadeIn * fadeIn * (3 - 2 * fadeIn)) * (fadeOut * fadeOut * (3 - 2 * fadeOut))
    const motionScale = state.reducedMotion ? 0.48 : 1
    const travelVelocity = Math.cos(travelPhase)
    const facingBlend = Math.tanh(travelVelocity * 4)
    const locomotion = Math.abs(travelVelocity) * movementEnvelope
    const step = Math.sin(gaitPhase) * locomotion
    const weightShift = Math.sin(gaitPhase + Math.PI * 0.5) * locomotion
    const travel = Math.sin(travelPhase) * 1.8 * movementEnvelope
    const bodyBob = Math.abs(Math.sin(gaitPhase)) * 0.045 * motionScale * locomotion
    const torsoTwist = -step * 0.075 * motionScale
    const torsoLean = Math.abs(travelVelocity) * 0.024 * motionScale * movementEnvelope
    const facingYaw = (1 - facingBlend) * Math.PI * 0.5
    const lap = Math.min(2, Math.floor(progress * 2) + 1)

    modelRoot.position.set(weightShift * 0.045 * motionScale, bodyBob, travel)
    modelRoot.rotation.set(torsoLean, facingYaw, -step * 0.018 * motionScale)

    poseLeg('left', footTrajectory(gaitPhase, 0, locomotion, motionScale))
    poseLeg('right', footTrajectory(gaitPhase, 0.5, locomotion, motionScale))
    poseArm('left', step, motionScale)
    poseArm('right', -step, motionScale)

    posePart('pelvis', [0, 1.72, 0], 0, step * 0.045 * motionScale, step * 0.028 * motionScale)
    ;['chestFrame', 'shellLeft', 'shellRight', 'computeCore', 'powerCore'].forEach(id => posePart(id, [0, 2.12, 0], torsoLean, torsoTwist, -step * 0.022 * motionScale))
    ;['neck', 'vision', 'headShell'].forEach(id => posePart(id, [0, 4.72, 0], -torsoLean * 0.42, -torsoTwist * 0.45, step * 0.012 * motionScale))

    if (lap !== state.walkLap && stageStatusEl) {
      state.walkLap = lap
      stageStatusEl.textContent = pick(T.gaitLap, txt()).replace('{n}', String(lap))
    }
  }

  /* ---------- 主循环 ---------- */
  function animate(timestamp: number): void {
    if (!renderer || !camera || !controls || !composer || !labelRenderer || !scene) return
    const dt = lastFrameAt ? Math.min((timestamp - lastFrameAt) / 1000, 0.05) : 0.016
    lastFrameAt = timestamp
    let moving = false

    if (state.playing) {
      const current = Number(explodeRange?.value ?? 0) / 100
      const next = current + state.playDirection * dt * 0.24
      if (next >= 1 || next <= 0) {
        setExplode(next >= 1 ? 1 : 0)
        state.playing = false
        const playBtn = $('sa-play')
        if (playBtn) playBtn.textContent = '▶'
      } else setExplode(next)
    }

    PARTS.forEach((p) => {
      const obj = objects.get(p.id)!
      const d = obj.userData
      const diff = (d.target as number) - (d.current as number)
      if (Math.abs(diff) > 0.0005) {
        d.current = state.reducedMotion ? d.target : (d.current as number) + diff * (1 - Math.exp(-dt * 8))
        moving = true
      } else d.current = d.target
      const staged = Math.max(0, Math.min(1, ((d.current as number) - (d.stageStart as number)) / ((d.stageEnd as number) - (d.stageStart as number))))
      const easedStaged = staged < 0.5 ? 2 * staged * staged : 1 - Math.pow(-2 * staged + 2, 2) / 2
      obj.position.copy(d.base as THREE.Vector3).addScaledVector(d.offset as THREE.Vector3, easedStaged)
      obj.rotation.set(0, 0, 0)
      if (obj.userData.lowerRig) (obj.userData.lowerRig as THREE.Group).rotation.set(0, 0, 0)
    })
    resetWalkPose()
    applyWalkingPose(timestamp)
    animateEyes(timestamp, dt)
    breathingMaterials.forEach((m, i) => {
      m.emissiveIntensity = 0.32 + Math.sin(timestamp * 0.00145 + i * 0.7) * 0.08
    })
    if (cameraTween) {
      const t = Math.min(1, (performance.now() - cameraTween.start) / cameraTween.duration)
      const e = 1 - Math.pow(1 - t, 3)
      camera.position.lerpVectors(cameraTween.fromPos, cameraTween.toPos, e)
      controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, e)
      if (t >= 1) cameraTween = null
    }
    controls.autoRotate = state.autoRotate && !moving && !state.playing && !state.walking
    controls.update()
    composer.render()
    labelRenderer.render(scene, camera)

    // 每秒采样一次关键指标
    if (timestamp - lastSampleAt >= 1000) {
      lastSampleAt = timestamp
      const targets = PARTS.map(p => objects.get(p.id)!.userData.target as number)
      options.onStat?.({
        explode: Math.round((targets.reduce((a, b) => a + b, 0) / targets.length) * 1000) / 10,
        selected: state.selectedId,
        walking: state.walking
      })
    }
  }

  function resize(): void {
    if (!renderer || !labelRenderer || !composer || !camera || hoverOutline == null || selectOutline == null || !webglHost) return
    const rect = webglHost.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    renderer.setSize(rect.width, rect.height, false)
    labelRenderer.setSize(rect.width, rect.height)
    composer.setSize(rect.width, rect.height)
    hoverOutline.resolution.set(rect.width, rect.height)
    selectOutline.resolution.set(rect.width, rect.height)
    camera.aspect = rect.width / rect.height
    camera.updateProjectionMatrix()
  }

  /* ---------- 移动端抽屉 ---------- */
  function openNav(): void {
    sidebarEl?.classList.add('mobile-open')
    $('sa-nav-toggle')?.setAttribute('aria-expanded', 'true')
    backdropEl?.classList.add('visible')
  }
  function closeNav(): void {
    sidebarEl?.classList.remove('mobile-open')
    $('sa-nav-toggle')?.setAttribute('aria-expanded', 'false')
    if (!inspectorEl?.classList.contains('mobile-open')) backdropEl?.classList.remove('visible')
  }
  function openInfo(): void {
    if (!compact()) return
    closeNav()
    inspectorEl?.classList.add('mobile-open')
    $('sa-info-toggle')?.setAttribute('aria-expanded', 'true')
    backdropEl?.classList.add('visible')
  }
  function closeInfo(): void {
    inspectorEl?.classList.remove('mobile-open')
    $('sa-info-toggle')?.setAttribute('aria-expanded', 'false')
    if (!sidebarEl?.classList.contains('mobile-open')) backdropEl?.classList.remove('visible')
  }

  /* ---------- 全量重置 ---------- */
  function resetAll(): void {
    stopWalking({ manual: true, silent: true })
    PARTS.forEach((p) => {
      const d = objects.get(p.id)!.userData
      d.target = 0
    })
    state.isolatedId = null
    state.hidden.clear()
    state.activeSystem = 'all'
    state.activeAssembly = null
    state.selectedId = null
    state.mode = 'solid'
    state.scope = 'all'
    state.tab = 'overview'
    state.labels = true
    state.autoRotate = false
    state.playing = false
    state.walking = false
    state.walkLap = 0
    gaze.yaw = 0
    gaze.pitch = 0
    gaze.targetYaw = 0
    gaze.targetPitch = 0
    gaze.lastPointerAt = 0
    gaze.blinkStartedAt = -1
    gaze.nextSaccadeAt = performance.now() + 1800
    gaze.nextBlinkAt = performance.now() + 2400
    state.query = ''
    state.collapsed = new Set(Object.keys(ASSEMBLIES))
    if (searchInput) searchInput.value = ''
    searchClear?.classList.remove('visible')
    if (scopeSelect) scopeSelect.value = 'all'
    if (explodeRange) explodeRange.value = '0'
    if (explodeValueEl) explodeValueEl.textContent = '000%'
    $('sa-label-toggle')?.classList.add('active')
    $('sa-rotate-toggle')?.classList.remove('active')
    const playBtn = $('sa-play')
    if (playBtn) playBtn.textContent = '▶'
    syncWalkButton(false)
    if (selectOutline) selectOutline.selectedObjects = []
    if (selectionTopEl) selectionTopEl.textContent = pick(T.noneSelected, txt())
    root.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.mode === 'solid'))
    setView('iso')
    renderSystems()
    renderTree()
    renderInspector()
    applyVisualState()
    updateAssemblyStatus()
    closeNav()
    closeInfo()
    showToast(pick(T.resetToast, txt()))
  }

  /* ---------- 初始化 Three ---------- */
  function initThree(): void {
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch (error) {
      const t1 = loadingEl?.querySelector('.loader-title')
      const t2 = loadingEl?.querySelector('.loader-copy')
      if (t1) t1.textContent = pick(T.webglFailTitle, txt())
      if (t2) t2.textContent = pick(T.webglFailCopy, txt())
      loadingEl?.querySelector('.loader-track')?.remove()
      throw error
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.92
    renderer.domElement.tabIndex = 0
    renderer.domElement.setAttribute('aria-label', pick({ zh: '旋转、缩放并选中零件的 3D 机器人，眼睛会跟随指针', en: 'Rotate, zoom, and select parts; a 3D robot whose eyes follow the pointer' }, txt()))
    webglHost!.appendChild(renderer.domElement)

    labelRenderer = new CSS2DRenderer({ element: labelsHost! })
    labelRenderer.domElement.style.position = 'absolute'
    labelRenderer.domElement.style.inset = '0'
    labelRenderer.domElement.style.pointerEvents = 'none'

    scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x0B1011, 0.027)
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60)
    camera.position.set(0, 3.15, 16.8)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.075
    controls.target.set(0, 1.65, 0)
    controls.minDistance = 4.5
    controls.maxDistance = 24
    controls.maxPolarAngle = Math.PI * 0.88
    controls.autoRotateSpeed = 0.75

    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    scene.add(new THREE.HemisphereLight(0xD7EFED, 0x17120E, 1.18))
    const key = new THREE.DirectionalLight(0xFFEDCF, 2.75)
    key.position.set(4.5, 10, 7)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -7
    key.shadow.camera.right = 7
    key.shadow.camera.top = 9
    key.shadow.camera.bottom = -6
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xA9D6D7, 0.9)
    fill.position.set(-5, 3, 6)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(0x74DDF4, 1.25)
    rim.position.set(-7, 6, -6)
    scene.add(rim)
    const coreLight = new THREE.PointLight(0x72E2F6, 1.15, 4.5, 2)
    coreLight.position.set(0, 3.7, 1.2)
    scene.add(coreLight)

    const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 96), new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.36 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -2.54
    ground.receiveShadow = true
    scene.add(ground)
    const halo = new THREE.Mesh(new THREE.RingGeometry(2.7, 2.72, 128), new THREE.MeshBasicMaterial({ color: 0x8CCFD5, transparent: true, opacity: 0.13, side: THREE.DoubleSide }))
    halo.rotation.x = -Math.PI / 2
    halo.position.y = -2.51
    scene.add(halo)

    modelRoot = new THREE.Group()
    modelRoot.name = 'SOMA_ROOT'
    scene.add(modelRoot)
    buildRobot()
    gaze.nextSaccadeAt = performance.now() + 1800
    gaze.nextBlinkAt = performance.now() + 2400

    composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    hoverOutline = new OutlinePass(new THREE.Vector2(1, 1), scene, camera)
    hoverOutline.edgeStrength = 2.5
    hoverOutline.edgeGlow = 0.15
    hoverOutline.edgeThickness = 1
    hoverOutline.visibleEdgeColor.set(0x58A8C6)
    hoverOutline.hiddenEdgeColor.set(0x1B404D)
    composer.addPass(hoverOutline)
    selectOutline = new OutlinePass(new THREE.Vector2(1, 1), scene, camera)
    selectOutline.edgeStrength = 4.2
    selectOutline.edgeGlow = 0.35
    selectOutline.edgeThickness = 1.3
    selectOutline.visibleEdgeColor.set(0x9DEAFF)
    selectOutline.hiddenEdgeColor.set(0x1E5A66)
    composer.addPass(selectOutline)
    composer.addPass(new OutputPass())

    bindCanvasEvents()
    ro = new ResizeObserver(resize)
    ro.observe(webglHost!)
    resize()
    loadingEl?.classList.add('done')
    cameraTween = { start: performance.now(), duration: state.reducedMotion ? 1 : 1650, fromPos: camera.position.clone(), toPos: new THREE.Vector3(7.6, 4.25, 12.8), fromTarget: controls.target.clone(), toTarget: new THREE.Vector3(0, 1.55, 0) }
    renderer.setAnimationLoop(animate)
  }

  /* ---------- 静态 DOM 事件 ---------- */
  systemsEl?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-system]') as HTMLElement | null
    if (b) setSystem(b.dataset.system as SystemKey)
  })
  treeEl?.addEventListener('click', (e) => {
    const vis = (e.target as HTMLElement).closest('[data-visibility]') as HTMLElement | null
    if (vis) {
      const id = vis.dataset.visibility!
      if (state.hidden.has(id)) state.hidden.delete(id)
      else state.hidden.add(id)
      applyVisualState()
      renderTree()
      renderInspector()
      return
    }
    const part = (e.target as HTMLElement).closest('[data-part]') as HTMLElement | null
    if (part) {
      selectPart(part.dataset.part!)
      if (matchMedia('(max-width:1179px)').matches) closeNav()
      return
    }
    const head = (e.target as HTMLElement).closest('[data-assembly]') as HTMLElement | null
    if (head) {
      const key = head.dataset.assembly as AssemblyKey
      const opening = state.collapsed.has(key)
      state.activeAssembly = key
      state.collapsed = new Set(Object.keys(ASSEMBLIES))
      if (opening) state.collapsed.delete(key)
      renderTree()
    }
  })
  treeEl?.addEventListener('dblclick', (e) => {
    const part = (e.target as HTMLElement).closest('[data-part]') as HTMLElement | null
    if (part) {
      selectPart(part.dataset.part!, { focus: true })
      return
    }
    const h = (e.target as HTMLElement).closest('[data-assembly]') as HTMLElement | null
    if (h) {
      state.activeAssembly = h.dataset.assembly as AssemblyKey
      state.scope = 'assembly'
      if (scopeSelect) scopeSelect.value = 'assembly'
      showToast(`${pick(T.scopeSetToast, txt())}${pick(ASSEMBLIES[state.activeAssembly].name, txt())}`)
    }
  })
  treeEl?.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).dataset?.part) {
      e.preventDefault()
      selectPart((e.target as HTMLElement).dataset.part!, { focus: true })
    }
  })
  searchInput?.addEventListener('input', () => {
    state.query = searchInput.value
    searchClear?.classList.toggle('visible', !!state.query)
    renderTree()
  })
  searchClear?.addEventListener('click', () => {
    if (searchInput) searchInput.value = ''
    state.query = ''
    searchClear?.classList.remove('visible')
    renderTree()
    searchInput?.focus()
  })
  tabsEl?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-tab]') as HTMLElement | null
    if (b) {
      state.tab = b.dataset.tab as typeof state.tab
      renderInspector()
    }
  })
  inspBodyEl?.addEventListener('click', (e) => {
    const jump = (e.target as HTMLElement).closest('[data-jump-assembly]') as HTMLElement | null
    if (jump) {
      const key = jump.dataset.jumpAssembly as AssemblyKey
      state.activeAssembly = key
      state.collapsed = new Set(Object.keys(ASSEMBLIES))
      state.collapsed.delete(key)
      renderTree()
      if (matchMedia('(max-width:1179px)').matches) openNav()
      showToast(`${pick(T.expandedAssembly, txt())}${pick(ASSEMBLIES[key].name, txt())}`)
      return
    }
    const b = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null
    if (!b || !state.selectedId) return
    const id = state.selectedId
    const obj = objects.get(id)!
    if (b.dataset.action === 'focus') focusObject(obj)
    if (b.dataset.action === 'move') {
      obj.userData.target = (obj.userData.target as number) > 0.5 ? 0 : 1
      renderInspector()
      updateAssemblyStatus()
    }
    if (b.dataset.action === 'isolate') {
      state.isolatedId = state.isolatedId === id ? null : id
      applyVisualState()
      renderInspector()
    }
    if (b.dataset.action === 'visibility') {
      if (state.hidden.has(id)) state.hidden.delete(id)
      else state.hidden.add(id)
      applyVisualState()
      renderTree()
      renderInspector()
    }
  })
  scopeSelect?.addEventListener('change', () => {
    state.scope = scopeSelect.value as ExplodeScope
    const a = affectedParts()
    if (a.length && explodeRange && explodeValueEl) {
      const avg = a.reduce((sum, p) => sum + (objects.get(p.id)!.userData.target as number), 0) / a.length
      explodeRange.value = String(Math.round(avg * 100))
      explodeValueEl.textContent = `${String(Math.round(avg * 100)).padStart(3, '0')}%`
    }
  })
  explodeRange?.addEventListener('input', () => setExplode(Number(explodeRange.value) / 100))
  $('sa-merge')?.addEventListener('click', () => setExplode(0))
  $('sa-explode-btn')?.addEventListener('click', () => setExplode(1))
  $('sa-play')?.addEventListener('click', (e) => {
    const current = Number(explodeRange?.value ?? 0) / 100
    state.playDirection = current >= 0.99 ? -1 : 1
    state.playing = !state.playing
    ;(e.currentTarget as HTMLElement).textContent = state.playing ? 'Ⅱ' : '▶'
  })
  root.querySelectorAll('.js-mode-group').forEach(group => group.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-mode]') as HTMLElement | null
    if (b) setMode(b.dataset.mode as DisplayMode)
  }))
  $('sa-view-cube')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-view]') as HTMLElement | null
    if (b) setView(b.dataset.view!)
  })
  $('sa-label-toggle')?.addEventListener('click', (e) => {
    state.labels = !state.labels
    ;(e.currentTarget as HTMLElement).classList.toggle('active', state.labels)
    updateLabels()
    showToast(pick(state.labels ? T.labelsToastOn : T.labelsToastOff, txt()))
  })
  $('sa-rotate-toggle')?.addEventListener('click', (e) => {
    state.autoRotate = !state.autoRotate
    ;(e.currentTarget as HTMLElement).classList.toggle('active', state.autoRotate)
    showToast(pick(state.autoRotate ? T.rotateToastOn : T.rotateToastOff, txt()))
  })
  $('sa-walk-toggle')?.addEventListener('click', () => startWalking())
  $('sa-show-all')?.addEventListener('click', () => {
    state.isolatedId = null
    state.hidden.clear()
    applyVisualState()
    renderTree()
    renderInspector()
    showToast(pick(T.restoredToast, txt()))
  })
  $('sa-reset')?.addEventListener('click', () => resetAll())
  $('sa-nav-toggle')?.addEventListener('click', () => (sidebarEl?.classList.contains('mobile-open') ? closeNav() : openNav()))
  $('sa-info-toggle')?.addEventListener('click', () => (inspectorEl?.classList.contains('mobile-open') ? closeInfo() : openInfo()))
  $('sa-close-nav')?.addEventListener('click', () => closeNav())
  $('sa-close-info')?.addEventListener('click', () => closeInfo())
  backdropEl?.addEventListener('click', () => {
    closeNav()
    closeInfo()
  })
  $('sa-guide-toggle')?.addEventListener('click', () => openGuide())
  $('sa-guide-close')?.addEventListener('click', () => closeGuide())
  $('sa-guide-done')?.addEventListener('click', () => closeGuide())
  guideOverlayEl?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeGuide()
  })

  /* ---------- 键盘快捷键（与原版一致，输入框聚焦时跳过） ---------- */
  function onKeydown(e: KeyboardEvent): void {
    const tag = (document.activeElement as HTMLElement | null)?.tagName ?? ''
    if (/INPUT|SELECT|TEXTAREA/.test(tag) && e.key !== 'Escape') return
    const key = e.key.toLowerCase()
    if (e.key === 'Escape' && guideOverlayEl?.classList.contains('visible')) {
      closeGuide()
      return
    }
    if (e.key === 'Escape') {
      clearSelection()
      closeNav()
      closeInfo()
    }
    if (e.key === '0') setView('iso')
    if (key === 'e') setExplode(1)
    if (key === 'm') setExplode(0)
    if (key === 'p') $('sa-play')?.click()
    if (key === 'l') $('sa-label-toggle')?.click()
    if (key === 'r') $('sa-rotate-toggle')?.click()
    if (key === 'w') $('sa-walk-toggle')?.click()
  }
  window.addEventListener('keydown', onKeydown)

  /* ---------- 启动 ---------- */
  renderSystems()
  renderTree()
  renderInspector()
  if (selectionTopEl) selectionTopEl.textContent = pick(T.noneSelected, txt())
  if (stageStatusEl) stageStatusEl.textContent = pick(T.statusIdle, txt())
  try {
    initThree()
  } catch (error) {
    console.error('[robot/soma] init failed', error)
  }

  return {
    dispose() {
      ro?.disconnect()
      ro = null
      controls?.dispose()
      window.removeEventListener('keydown', onKeydown)
      renderer?.setAnimationLoop(null)
      scene?.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else if (mat) mat.dispose()
      })
      composer?.dispose()
      renderer?.dispose()
      renderer?.domElement.remove()
    },
    refresh() {
      renderSystems()
      renderTree()
      renderInspector()
      labels.forEach((label, id) => {
        const p = partById.get(id)!
        label.element.textContent = `${p.no} · ${pick(p.name, txt())}`
      })
      if (selectionTopEl) selectionTopEl.textContent = state.selectedId ? partById.get(state.selectedId)!.code : pick(T.noneSelected, txt())
      if (stageStatusEl && !state.walking) updateAssemblyStatus()
      syncWalkButton(state.walking)
    },
    selectPart(id) {
      selectPart(id)
    },
    setExplode(value) {
      setExplode(value)
    },
    setMode(mode) {
      setMode(mode)
    },
    openGuide() {
      openGuide()
    }
  }
}
