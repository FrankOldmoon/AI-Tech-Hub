<script setup lang="ts">
/** 默认布局：功能页使用，含左侧功能导航栏 + 小屏抽屉 */
const { t } = useI18n()
const mobileOpen = ref(false)
</script>

<template>
  <div class="flex">
    <!-- 大屏：固定侧边栏 -->
    <AppSidebar class="hidden lg:block" />

    <div class="flex-1 min-w-0">
      <!-- 小屏：菜单按钮（<768px；中屏 ≥768 用 header 水平导航，避免两个入口重复） -->
      <div class="md:hidden p-3 border-b border-default">
        <UButton
          icon="i-lucide-menu"
          color="neutral"
          variant="ghost"
          :label="t('nav.menu')"
          @click="mobileOpen = true"
        />
      </div>
      <slot />

      <!-- 每页底部的延伸学习（Python / JavaScript / 原理）；未登记内容的页面整段不渲染 -->
      <DemoLearningDock />
    </div>

    <!-- 小屏：Slideover 弹出侧边栏 -->
    <USlideover
      v-model:open="mobileOpen"
      side="left"
      :title="t('nav.menu')"
    >
      <template #body>
        <AppSidebar embedded />
      </template>
    </USlideover>
  </div>
</template>
