/**
 * 应用启动时把 runtimeConfig.public 注入 remote-models 的部署配置。
 * - NUXT_PUBLIC_SELF_HOSTED=true  → selfHosted=true（本地完整部署模式）
 */
import { initDeployConfig } from '~/utils/remote-models'

export default defineNuxtPlugin(() => {
  const { selfHosted } = useRuntimeConfig().public
  initDeployConfig({
    selfHosted: selfHosted === true
  })
})
