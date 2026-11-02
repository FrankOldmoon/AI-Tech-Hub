<template>
  <!-- 无侧边栏布局：首页 / 分类页 / IDE 使用 -->
  <div class="min-w-0">
    <slot />

    <!-- 全屏类 demo（robot 原生页）用这个布局，底部同样要有延伸学习区 -->
    <DemoLearningDock />
  </div>
</template>
