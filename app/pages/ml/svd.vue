<script setup lang="ts">
import { runPython } from '~/utils/python-runner'
import { humanError } from '~/utils/errors'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'svd')!)

const userId = ref(1)
const loading = ref(false)
const error = ref<string | null>(null)
const result = ref<any>(null)

async function recommend() {
  error.value = null
  result.value = null
  loading.value = true
  try {
    const res = await runPython<any>({
      feature: 'ml/svd',
      params: { user: String(userId.value) }
    })
    if (!res.ok || !res.data) {
      error.value = res.error || t('ml.svd.error')
      return
    }
    result.value = res.data
  } catch (e: any) {
    error.value = humanError(e, t)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UCard>
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted">{{ t('ml.svd.userId') }}</span>
          <UInput v-model.number="userId" type="number" :min="1" :max="943" class="w-32" />
        </div>
        <UButton
          icon="i-lucide-star"
          :label="t('ml.svd.recommend')"
          color="primary"
          :loading="loading"
          @click="recommend"
        />
      </div>
    </UCard>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />

    <template v-if="result">
      <UCard>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p class="text-xs text-muted">{{ t('ml.svd.user') }}</p>
            <p class="text-lg font-bold text-highlighted tabular-nums">{{ result.user }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.svd.ratings') }}</p>
            <p class="text-lg font-bold text-highlighted tabular-nums">{{ result.stats.ratings }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">{{ t('ml.svd.users') }}</p>
            <p class="text-lg font-bold text-highlighted tabular-nums">{{ result.stats.users }}</p>
          </div>
          <div>
            <p class="text-xs text-muted">RMSE</p>
            <p class="text-lg font-bold text-highlighted tabular-nums">{{ result.stats.rmse }}</p>
          </div>
        </div>
      </UCard>

      <div class="grid lg:grid-cols-2 gap-6">
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon name="i-lucide-sparkles" class="size-4" />
              {{ t('ml.svd.recommendations') }}
            </div>
          </template>
          <div class="space-y-2">
            <div
              v-for="(r, i) in result.recommendations"
              :key="i"
              class="flex items-center gap-3 rounded-lg border border-default p-2"
            >
              <span class="text-sm font-bold text-muted w-6 text-right tabular-nums">{{ i + 1 }}</span>
              <span class="flex-1 text-sm font-medium text-highlighted truncate">{{ r.title }}</span>
              <span class="text-sm text-muted tabular-nums">{{ r.score.toFixed(2) }}</span>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon name="i-lucide-clock" class="size-4" />
              {{ t('ml.svd.rated') }}
            </div>
          </template>
          <div class="space-y-2">
            <div
              v-for="(r, i) in result.rated"
              :key="i"
              class="flex items-center gap-3 rounded-lg border border-default p-2"
            >
              <span class="flex-1 text-sm font-medium text-highlighted truncate">{{ r.title }}</span>
              <div class="flex items-center gap-1">
                <UIcon name="i-lucide-star" class="size-3.5 text-yellow-500" />
                <span class="text-sm text-muted tabular-nums">{{ r.rating.toFixed(1) }}</span>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </MediaDemoShell>
</template>
