# 独立应用集成规范（App Integration Guide）

> 目的：让 nuxt_AI 容易接纳"已开发好的独立 Web 应用"（如 ReBot Arm 机械臂仿真器），按统一约定归类进分类体系。
> 首个示例：`robot/rebot-arm`（ROS2 ReBot Arm B601-RS 机械臂仿真器）。

## 一、原则

- 每个应用是一个**独立单元**：自己的静态前端 + 可选服务端 API + 可选外部依赖（ROS2/motorbridge/LLM）
- nuxt_AI 只做四件事：**统一入口**（分类/导航/多语言）、**统一 URL**（`/apps/<slug>/`）、**应用壳**（iframe）、**服务端 API 前缀**（`/api/apps/<slug>/`）
- 尽量不改应用本身逻辑，只做"路径适配"（加前缀），便于应用升级时复用适配脚本

## 二、目录约定

```
public/apps/<slug>/                      应用静态前端（index.html / css / js / lib / 资源）
server/assets/apps/<slug>/               应用数据/模型（URDF / STL / 配置，由 API 读取）
server/api/apps/<slug>/                  应用服务端 API（Nitro 路由，统一前缀 /api/apps/<slug>/）
app/pages/<category>/<slug>.vue          应用包装页（iframe 嵌 /apps/<slug>/index.html）
app/utils/demos.ts                       注册 demo（分类/slug/标题/说明/图标/多语言）
public/apps/<slug>/app-manifest.json     外部依赖声明（可选）
scripts/adapt-app-paths.py               路径适配脚本（把应用内绝对路径加前缀）
```

## 三、接入步骤（5 步）

1. **放资源**：`public/apps/<slug>/` 拷入应用静态前端；`server/assets/apps/<slug>/` 拷入模型/数据
2. **写 API**：`server/api/apps/<slug>/...`（Nitro），提供应用所需端点（URDF/STL/配置等），MIME 用 `model/stl`、`application/xml`
3. **适配路径**：运行 `py -3 scripts/adapt-app-paths.py --slug <slug>`，自动把应用内 `/lib/ /js/ /css/ /api/` 等绝对路径加 `/apps/<slug>` 或 `/api/apps/<slug>` 前缀
4. **注册**：`demos.ts` 加 demo（分类/slug/标题/说明/图标/多语言）＋ 建包装页（`MediaDemoShell` + iframe 嵌 `/apps/<slug>/index.html`）
5. **验收**：lint → 构建 → 部署 → 浏览器验证（页面加载 / 模型加载 / 核心功能）

## 四、外部依赖声明（app-manifest.json，可选）

```json
{
  "slug": "rebot-arm",
  "name": "ROS2 ReBot Arm B601-RS 机械臂仿真器",
  "external": {
    "rosbridge":   { "required": false, "hint": "连实体机械臂需 rosbridge（ws://机械臂IP:9090）" },
    "motorbridge": { "required": false, "hint": "连实体舵机需 motorbridge（ws://IP:9002）" },
    "llm":         { "required": false, "hint": "LLM 对话需 text-agent 服务" }
  }
}
```

包装页据此展示"哪些功能需额外环境"，避免学生/老师误以为应用坏了。

## 五、iframe 壳约定

- 包装页 iframe 高度建议 `h-[85vh]`（机械臂/游戏等全屏类），或按内容设固定高度
- 应用内导航/链接保持相对路径或加 `/apps/<slug>/` 前缀
- WebSocket（rosbridge/motorbridge）不受同源限制，iframe 内可直接连外部地址
- 应用是**纯前端无 API** 时，第 2 步可省略，模型直接放 `public/apps/<slug>/` 由静态服务

## 六、注意事项（踩坑）

- 应用内**绝对路径必须加前缀**：`/lib/ /js/ /css/ /favicon /manifest` → `/apps/<slug>/...`；`/api/...` → `/api/apps/<slug>/...`，否则会撞 nuxt_AI 自身路由
- URDF 等用 `package://` 协议的应用，其 loader 的 `packages` 映射也要指向 `/api/apps/<slug>`
- 大资源（STL/模型）放 `server/assets/apps/<slug>/` 由 API 读取，或 `public/apps/<slug>/`；注意构建体积（当前 rebot-arm 模型约 69MB）
- 应用 API 用 `process.cwd()` 定位资源（node-server 部署 cwd=项目根）
- 保留应用原有的"可选外部连接"（如 ROS2），不要砍；用 app-manifest 声明即可

## 七、当前已集成

| 应用 | 分类 | slug | 接入方式 | 说明 |
|---|---|---|---|---|
| ROS2 ReBot Arm B601-RS 机械臂仿真器 | robot | rebot-arm | iframe 壳 | 浏览器本地 Three.js 仿真；可选连实体机械臂（rosbridge）/舵机（motorbridge） |
| MicroDuck 微鸭仿真器 | robot | microduck | iframe 壳 | Hugging Face/Pollen Robotics 双足机器鸭；MuJoCo(WASM)+ONNX RL 策略全本地，无后端 |
| G1 + HUSKY 滑板 + Cartpole（mjswan） | robot | g1-cartpole | iframe 壳 | MuJoCo(WASM) + ONNX RL 策略，纯静态 |
| G1 动作跟踪 | robot | g1-motion-tracking | iframe 壳 | 同上，追踪策略跟参考动作 |
| 机械臂运动学（UAIBot） | robot | uaibot-kinematics | iframe 壳 | 6-DoF KR5 正/逆运动学 |
| Orion 具身智能五机器人实验室 | robot | embodied | **原生页面** | 见第八节；three 走 npm |
| EnvSense 多传感器环境监测仿真 | robot | envsense | **原生页面** | 见第八节；7 路传感器 + 阈值告警，进度上报 |
| VacuSim 扫地机器人仿真 | robot | vacusim | **原生页面** | 见第八节；覆盖率栅格 + LiDAR + 6 张知识卡，进度上报 |

> microduck 是"纯静态无 API"示例：构建产物整体放 `public/apps/<slug>/`（含本地化的 MuJoCo/onnxruntime wasm 于 `vendor/`），
> 无需 server API；原应用的多玩家 ghosts（Trystero/Nostr）依赖公网，内网自动静默禁用，见 `app-manifest.json`。

## 八、原生页面版（把独立单文件应用改写成 Nuxt 页）

适用场景：应用是**单个 HTML 文件**（自带 `<style>` 与 `<script>`），且希望依赖统一走 npm、
不再有 CDN 引用、也不再需要 iframe。已完成的三例：`embodied`、`envsense`、`vacusim`。

改写的固定套路：

1. **依赖去 CDN**：删掉 `importmap` 里指向 unpkg 的映射，引擎顶部改成
   `import * as THREE from 'three'`（three 已是项目依赖）；addons 用
   `three/examples/jsm/...`。项目里**不允许**再出现外链 CDN。
2. **逻辑进 `app/utils/<slug>/engine.ts`**：命令式的那部分（three 场景图、物理/仿真步进、
   Canvas 2D 绘图）原样留着，只改三件事：
   - 入口签名 `export function createXxx(root: HTMLElement, options): { dispose(): void, ... }`；
   - 不再 `document.getElementById`，改为在 `root` 内按 id / `data-*` 查；
   - 不再自己 append 到 `document.body`，浮动元素挂到调用方给的层里。
3. **页面 `app/pages/<category>/<slug>.vue`**：`MediaDemoShell` + 静态外壳 markup +
   `<style scoped>`。注意：
   - 原样式是整页全局写法，**全部收进一个根 class**（`.es-root`/`.vs-root`）并在里面定义 CSS 变量，
     裸选择器（`body`/`button`）用 `:deep()` 限定，否则会污染站点；
   - 原版的 `position: fixed` 一律改 `position: absolute`（页面只是站点里的一块，不抢整页）；
   - **会被引擎持续写入的节点不绑 Vue**（卡片数值、曲线、日志行），由引擎自己写，
     否则每次重渲染都盖掉引擎的值；模板只负责骨架与本地化标题；
   - 根节点一定要有 `ref="rootEl"`，`onMounted(mount)` / `onBeforeUnmount(unmount)` 成对，
     `dispose()` 里 `cancelAnimationFrame` + `ResizeObserver.disconnect()` + `controls.dispose()` +
     遍历 dispose 几何/材质 + `renderer.dispose()`，否则切页会漏 WebGL 上下文。
4. **three 的版本坑（0.186）**：`THREE.Clock` 已弃用，用 `THREE.Timer`
   （`timer.update()` 后再 `timer.getDelta()`）；`PCFSoftShadowMap` 已移除，用 `PCFShadowMap`。
5. **注册**：`demos.ts` 加条目；`demo-cover-scenes.ts` 必须补专属封面场景，否则
   `tests/demo-cover.test.ts` 直接红。

## 九、完成度上报契约（页面 → 宿主，postMessage）

页面被课程平台/工作台用 iframe 嵌进来时，通过 postMessage 回传完成度。实现见
`app/utils/embed-report.ts`，已经在 `robot/envsense`、`robot/vacusim` 两页接入。

```js
// 页面侧（引擎/页面调一次即可，内部按 rate 去重）
reportCorrectRate({
  app: 'robot/vacusim',   // <分类>/<slug>
  rate,                   // 0~1 完成度
  finished,               // 是否全部完成（不传则 rate>=0.999 判定）
  locale,
  extra: { coverage: 12.6 }  // 页面自有指标，随便加
})
```

宿主侧只认这两个字段，其余（`progress`/`finished`/`locale`/`at`/自定义指标）都是附加信息：

```js
window.addEventListener('message', (e) => {
  const d = e.data
  if (!d || d.type !== 'correct_rate') return
  console.log(d.app, (d.rate * 100).toFixed(0) + '%', d.finished)
  // fetch('/api/lms/progress', { method: 'POST', body: JSON.stringify(d) })
})
```

约定与要点：

- 字段形状沿用既有交互页/老游戏的 `correct_rate` 契约（`{ type, rate: 0~1, ... }`），
  不新造 `type`，宿主已有解析习惯
- 只在 `window.parent !== window`（确实被嵌）时才 postMessage；未嵌时只派发同名 DOM 事件
  `<app>:report`，方便直开调试
- **必须去重**：模拟类页面的完成度随时在涨，rate/finished 没变就不重复发，否则会把宿主淹了
- 完成度由页面自己定义成「教学任务」加权和（见各页 `.pg-list`），不是「对错率」；
  两页的判据分别是：EnvSense = 看全 7 路传感器详情 / 触发 4 个场景 / 3 种天气 / 导出数据集；
  VacuSim = 三种清洁模式 / 覆盖率 90% / 回充完成 / LiDAR 射线 + 跟随相机
