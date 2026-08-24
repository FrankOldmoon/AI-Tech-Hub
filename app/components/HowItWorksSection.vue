<script setup lang="ts">
/**
 * 「工作原理」折叠段（教学向，UX 审计批次5 howItWorks）
 * 供 MediaDemoShell / DemoRunner / ImagePlayground / MediaVisionRunner / MediaTextRunner 复用；
 * 传入空字符串则不渲染。
 */
defineProps<{ text?: string }>()

const { t } = useI18n()
const isOpen = ref(false)
</script>

<template>
  <div
    v-if="text"
    class="border border-default rounded-lg overflow-hidden"
  >
    <UCollapsible v-model:open="isOpen">
      <template #default="{ open }">
        <button
          type="button"
          class="flex items-center gap-2 px-4 py-3 text-sm font-medium text-highlighted w-full cursor-pointer hover:bg-elevated/40 transition-colors"
        >
          <UIcon
            name="i-lucide-book-open"
            class="size-4 text-primary"
          />
          <span>{{ t('demo.howItWorks') }}</span>
          <UIcon
            name="i-lucide-chevron-down"
            class="size-4 ms-auto text-muted transition-transform"
            :class="open ? 'rotate-180' : ''"
          />
        </button>
      </template>
      <template #content>
        <p class="px-4 py-3 text-sm text-muted border-t border-default leading-relaxed">
          {{ text }}
        </p>
      </template>
    </UCollapsible>
  </div>
</template>
