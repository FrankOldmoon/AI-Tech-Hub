/**
 * E2E 的路由来源：直接读 app 的 demo 注册表，不手工维护清单。
 *
 * demos.ts 是零依赖的纯数据模块（只有类型声明），所以在 Playwright 的 Node 侧
 * 直接 import 即可拿到与前端完全一致的路由（`demoPath` 就是页面里生成链接的那个函数）。
 * 注册表加了新页，E2E 自动多一条用例。
 */
import { demoPath, demos, type Demo } from '../../../app/utils/demos'

export type { Demo }

/** planned 是占位条目（页面上只显示「规划中」），没有可跑的功能，不纳入 E2E */
export const readyDemos: Demo[] = demos.filter(d => d.status === 'ready')

export function routeOf(demo: Demo): string {
  return demoPath(demo)
}

/** 页面标题（中英各一），用来确认「渲染的确实是这个 demo，而不是回退到了未找到」 */
export function titlesOf(demo: Demo): string[] {
  return [demo.title.zh, demo.title.en]
}
