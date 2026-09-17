import { defineConfig, devices } from '@playwright/test'

/**
 * 端到端测试（浏览器级）：逐页打开、逐操作点击。
 *
 * 与 vitest（tests/ 下的单测/组件测试）分工：
 * - vitest  → 纯逻辑与组件行为，秒级，进 CI
 * - 本配置  → 真实浏览器里的整页行为，慢，适合在「模型齐全」的机器上跑
 *
 * 目标站点通过 E2E_BASE_URL 指定，默认打本机 dev：
 *   E2E_BASE_URL=https://10.28.1.152 npx playwright test          # 服务器（模型齐全）
 *   npx playwright test                                           # 本机（自动拉起 dev server）
 *
 * 关于服务器：10.28.1.152 是 https + 自签证书，故固定 ignoreHTTPSErrors。
 * 关于摄像头/麦克风：用 Chromium 的假设备参数，让 getUserMedia 真的能成功，
 * 这样拍照 / 录音 / 实时帧这些操作才点得下去。
 */
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3030'
const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE_URL)

export default defineConfig({
  testDir: './tests/e2e',
  // 整页加载 + 逐控件点击，给足时间（模型页首次初始化可能十几秒）
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // 逐页顺序执行：并发会把本机 dev server / 演示服务器压垮，也让失败更难定位
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS || 2),
  retries: Number(process.env.E2E_RETRIES || 0),
  // 失败时留下可追溯的现场
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'tests/e2e/.report' }]
  ],
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [
        // 免权限弹窗 + 提供假摄像头/麦克风流（headless 下也能真的出画面/声音）
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream'
      ]
    }
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  // 只有打本机时才自动拉起 dev server；打服务器/校园网机器时用已有的
  webServer: IS_LOCAL
    ? {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 180_000
      }
    : undefined
})
