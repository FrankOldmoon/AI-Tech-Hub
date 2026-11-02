<script setup lang="ts">
/**
 * 「工作原理」折叠段（教学向，UX 审计批次5 howItWorks）
 * 供 MediaDemoShell / DemoRunner / ImagePlayground / MediaVisionRunner / MediaTextRunner 复用；
 * 传入空字符串则不渲染。
 *
 * 这里的文案来自 demos.ts 的 howItWorks 字段，两三句话。已登记 demo-note 的页面
 * 在底部还有更详细的「原理说明 + 可运行代码」，此时这里会多一个跳转入口 ——
 * 否则用户展开这个、看完就以为结束了（实测反馈就是这样）。
 */
defineProps<{ text?: string }>()

const { t } = useI18n()
const route = useRoute()
const isOpen = ref(false)

/** 由 DemoLearningDock 登记（见该组件注释），空串表示本页没有详细内容 */
const noteOwner = useState<string>('demo-note-owner', () => '')
const hasDetail = computed(() => noteOwner.value === route.path)

function jumpToDetail() {
  document.getElementById('demo-learning')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
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
        <div class="px-4 py-3 text-sm text-muted border-t border-default leading-relaxed">
          <p>{{ text }}</p>
          <button
            v-if="hasDetail"
            type="button"
            class="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer"
            @click="jumpToDetail"
          >
            {{ t('learning.jumpToDetail') }}
            <UIcon
              name="i-lucide-arrow-down"
              class="size-3.5"
            />
          </button>
        </div>
      </template>
    </UCollapsible>
  </div>
</template>
