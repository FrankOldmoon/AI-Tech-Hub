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

| 应用 | 分类 | slug | 说明 |
|---|---|---|---|
| ROS2 ReBot Arm B601-RS 机械臂仿真器 | robot | rebot-arm | 浏览器本地 Three.js 仿真；可选连实体机械臂（rosbridge）/舵机（motorbridge） |
