<script setup lang="ts">
/**
 * 模型供给状态页（运维自检）。
 *
 * 面向自托管/内网部署：一眼看出本地模型是否齐备、缺什么、缺失项会不会回退远程。
 * 数据来自 /api/models/status（只读 .models/ 的统计，不暴露绝对路径）。
 */
interface StatusGroup { key: string, present: boolean, files: number, mb: number }
interface MissingItem { group: string, rel: string, label: string, fallback: 'remote' | 'none' }
interface StatusPayload {
  modelsDir: string
  totalMb: number
  groups: StatusGroup[]
  missing: MissingItem[]
  ready: boolean
}

const { t } = useI18n()
const { data, error, refresh } = await useFetch<StatusPayload>('/api/models/status')
</script>

<template>
  <div class="container mx-auto max-w-3xl px-4 py-10 space-y-6">
    <div class="flex items-center gap-3">
      <UIcon
        name="i-lucide-database"
        class="size-6 text-primary"
      />
      <h1 class="text-2xl font-bold text-highlighted">
        {{ t('status.title') }}
      </h1>
    </div>
    <p class="text-sm text-muted">
      {{ t('status.desc') }}
    </p>

    <div
      v-if="error"
      class="rounded-lg border border-default p-4 text-sm text-error"
    >
      {{ t('status.error') }}
    </div>

    <template v-else-if="data">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-default p-4 text-sm">
        <span class="flex items-center gap-1.5">
          <UIcon
            :name="data.ready ? 'i-lucide-check' : 'i-lucide-alert-triangle'"
            :class="data.ready ? 'text-success' : 'text-warning'"
            class="size-4"
          />
          {{ data.ready ? t('status.ready') : t('status.notReady', { count: data.missing.length }) }}
        </span>
        <span class="text-muted">
          {{ t('status.dir') }} <code class="text-xs">{{ data.modelsDir }}</code>
        </span>
        <span class="text-muted">
          {{ t('status.total') }} <b class="tabular-nums">{{ data.totalMb }}</b> MB
        </span>
        <UButton
          class="ms-auto"
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-lucide-refresh-cw"
          @click="refresh()"
        >
          {{ t('status.refresh') }}
        </UButton>
      </div>

      <div class="overflow-hidden rounded-xl border border-default">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 text-xs text-muted">
            <tr>
              <th class="px-4 py-2 text-start font-medium">
                {{ t('status.group') }}
              </th>
              <th class="px-4 py-2 text-end font-medium">
                {{ t('status.files') }}
              </th>
              <th class="px-4 py-2 text-end font-medium">
                {{ t('status.size') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="g in data.groups"
              :key="g.key"
              class="border-t border-default"
            >
              <td class="px-4 py-2">
                <span class="inline-flex items-center gap-1.5">
                  <UIcon
                    :name="g.present ? 'i-lucide-check' : 'i-lucide-x'"
                    :class="g.present ? 'text-success' : 'text-error'"
                    class="size-3.5"
                  />
                  <code class="text-xs">{{ g.key }}</code>
                </span>
              </td>
              <td class="px-4 py-2 text-end tabular-nums text-muted">
                {{ g.files }}
              </td>
              <td class="px-4 py-2 text-end tabular-nums text-muted">
                {{ g.mb }} MB
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="data.missing.length"
        class="space-y-2 rounded-xl border border-default p-4"
      >
        <p class="text-sm font-medium text-highlighted">
          {{ t('status.missingTitle') }}
        </p>
        <ul class="space-y-1 text-xs">
          <li
            v-for="m in data.missing"
            :key="m.rel"
            class="flex items-center gap-2"
          >
            <UIcon
              name="i-lucide-x"
              class="size-3.5 shrink-0 text-error"
            />
            <code class="truncate">{{ m.rel }}</code>
            <span
              class="ms-auto shrink-0"
              :class="m.fallback === 'remote' ? 'text-warning' : 'text-error'"
            >
              {{ m.fallback === 'remote' ? t('status.fallbackRemote') : t('status.fallbackNone') }}
            </span>
          </li>
        </ul>
        <p class="text-xs text-dimmed">
          {{ t('status.missingHint') }}
        </p>
      </div>
      <div
        v-else
        class="rounded-xl border border-default p-4 text-sm text-muted"
      >
        {{ t('status.allCritical') }}
      </div>
    </template>
  </div>
</template>
