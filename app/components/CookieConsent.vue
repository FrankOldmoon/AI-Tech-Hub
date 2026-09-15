<script setup lang="ts">
/**
 * Cookie / 统计合规告知横幅（P2-3）
 * - 首次访问展示；选择一次后不再打扰
 * - 「同意」：加载百度统计 + GA4（loadStatsScripts）
 * - 「拒绝」：不加载任何统计脚本，仅记录选择（本机）
 * - 组件仅负责横幅交互；已同意时的首屏注入由 plugins/stats-consent.client.ts 处理
 */
import {
  readStatsConsent,
  setStatsConsent,
  loadStatsScripts
} from '~/utils/stats'

const { t } = useI18n()
const visible = ref(false)

onMounted(() => {
  visible.value = readStatsConsent() === null
})

function accept() {
  setStatsConsent('accepted')
  loadStatsScripts()
  visible.value = false
}

function decline() {
  setStatsConsent('declined')
  visible.value = false
}
</script>

<template>
  <ClientOnly>
    <div
      v-if="visible"
      class="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl"
      role="dialog"
      aria-label="privacy notice"
    >
      <UCard class="shadow-lg">
        <div class="flex flex-col sm:flex-row sm:items-center gap-3">
          <p class="flex-1 text-sm text-muted leading-relaxed">
            {{ t('cookie.text') }}
          </p>
          <div class="flex gap-2 shrink-0">
            <UButton
              :label="t('cookie.accept')"
              color="primary"
              size="sm"
              @click="accept"
            />
            <UButton
              :label="t('cookie.decline')"
              color="neutral"
              variant="subtle"
              size="sm"
              @click="decline"
            />
          </div>
        </div>
      </UCard>
    </div>
  </ClientOnly>
</template>
