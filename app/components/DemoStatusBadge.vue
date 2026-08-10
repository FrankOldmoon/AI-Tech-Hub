<script setup lang="ts">
import type { DemoStatus } from '~/utils/demos'
import { statusColor, statusI18nKey } from '~/utils/demos'

const props = defineProps<{ status: DemoStatus }>()
const { t } = useI18n()
const color = computed(() => statusColor(props.status))
const label = computed(() => t(statusI18nKey(props.status)))
</script>

<template>
  <UBadge :color="color" variant="subtle" size="sm">
    {{ label }}
  </UBadge>
</template>
