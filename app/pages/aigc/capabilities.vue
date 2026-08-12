<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('aigc', 'capabilities')!)

const checking = ref(true)
const supported = ref(false)
const adapterInfo = ref<Record<string, string>>({})
const features = ref<string[]>([])
const limits = ref<Array<{ key: string, value: string }>>([])
const fp16 = ref(false)
const crossOriginIsolated = ref(false)

async function check() {
  checking.value = true
  adapterInfo.value = {}
  features.value = []
  limits.value = []
  supported.value = false
  fp16.value = false
  crossOriginIsolated.value = false
  try {
    crossOriginIsolated.value = Boolean((self as any).crossOriginIsolated)
    const gpu = (navigator as any).gpu
    if (!gpu) {
      supported.value = false
      return
    }
    supported.value = true
    const adapter = await gpu.requestAdapter()
    if (!adapter) {
      supported.value = false
      return
    }
    const info = adapter.info || {}
    const map: Record<string, string> = {}
    if (info.vendor) map[t('capabilities.vendor')] = String(info.vendor)
    if (info.architecture) map[t('capabilities.architecture')] = String(info.architecture)
    if (info.device) map[t('capabilities.device')] = String(info.device)
    if (info.description) map[t('capabilities.description')] = String(info.description)
    adapterInfo.value = map

    fp16.value = adapter.features?.has('shader-f16') || false
    if (adapter.features) {
      features.value = [...adapter.features].sort() as string[]
    }
    if (adapter.limits) {
      const lims = adapter.limits
      const rows: Array<{ key: string, value: string }> = []
      if (lims.maxTextureDimension2D) rows.push({ key: t('capabilities.maxTextureSize'), value: String(lims.maxTextureDimension2D) })
      if (lims.maxBufferSize) rows.push({ key: t('capabilities.maxBufferSize'), value: String(lims.maxBufferSize) })
      if (lims.maxComputeInvocationsPerWorkgroup) rows.push({ key: t('capabilities.maxComputeInvocations'), value: String(lims.maxComputeInvocationsPerWorkgroup) })
      limits.value = rows
    }
  } catch {
    supported.value = false
  } finally {
    checking.value = false
  }
}

onMounted(check)
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="flex flex-wrap items-center gap-3">
      <UButton
        icon="i-lucide-refresh-cw"
        :label="t('capabilities.refresh')"
        color="primary"
        variant="subtle"
        :loading="checking"
        @click="check"
      />
      <UBadge v-if="!checking && supported" color="success" variant="subtle">
        {{ t('capabilities.supported') }}
      </UBadge>
      <UBadge v-else-if="!checking" color="error" variant="subtle">
        {{ t('capabilities.unsupported') }}
      </UBadge>
    </div>

    <UAlert v-if="checking" color="info" variant="subtle" icon="i-lucide-loader-circle" :title="t('capabilities.checking')" />
    <UAlert v-else-if="!supported" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('capabilities.unsupportedHelp')" />

    <template v-if="!checking && supported">
      <div class="grid sm:grid-cols-2 gap-4">
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon name="i-lucide-gpu" class="size-4" />
              {{ t('capabilities.adapter') }}
            </div>
          </template>
          <dl class="space-y-2 text-sm">
            <div v-for="(v, k) in adapterInfo" :key="k" class="flex justify-between gap-4">
              <dt class="text-muted shrink-0">{{ k }}</dt>
              <dd class="text-highlighted text-right break-all">{{ v }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted shrink-0">{{ t('capabilities.float16') }}</dt>
              <dd class="text-highlighted">{{ fp16 ? t('capabilities.float16On') : t('capabilities.float16Off') }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted shrink-0">{{ t('capabilities.coopCoep') }}</dt>
              <dd class="text-highlighted">{{ crossOriginIsolated ? t('capabilities.coopCoepOn') : t('capabilities.coopCoepOff') }}</dd>
            </div>
          </dl>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon name="i-lucide-gauge" class="size-4" />
              {{ t('capabilities.limits') }}
            </div>
          </template>
          <dl class="space-y-2 text-sm">
            <div v-for="row in limits" :key="row.key" class="flex justify-between gap-4">
              <dt class="text-muted shrink-0">{{ row.key }}</dt>
              <dd class="text-highlighted text-right break-all">{{ row.value }}</dd>
            </div>
            <p v-if="!limits.length" class="text-muted">{{ t('capabilities.limits') }}: —</p>
          </dl>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-list-checks" class="size-4" />
            {{ t('capabilities.features') }}
          </div>
        </template>
        <div class="flex flex-wrap gap-2">
          <UBadge v-for="f in features" :key="f" color="neutral" variant="subtle">{{ f }}</UBadge>
          <p v-if="!features.length" class="text-sm text-muted">—</p>
        </div>
      </UCard>

      <UAlert color="info" variant="subtle" icon="i-lucide-info" :title="t('capabilities.recommendation')">
        <template #description>
          <p class="text-sm">{{ supported ? t('capabilities.recWebgpu') : t('capabilities.recWasm') }}</p>
          <p class="text-sm">{{ t('capabilities.recMemory') }}</p>
        </template>
      </UAlert>
    </template>
  </MediaDemoShell>
</template>
