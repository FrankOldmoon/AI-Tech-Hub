<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'singing')!)
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12">
      <DemoRunner :demo="demo">
        <!-- 结果 -->
        <template #result>
          <div class="space-y-3">
            <UAlert
              color="info"
              variant="subtle"
              icon="i-lucide-info"
              :title="t('demo.comingSoon')"
            >
              <template #description>
                <p class="text-sm text-muted">
                  {{ t('singing.plannedHint') }}
                </p>
              </template>
            </UAlert>
          </div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
