<script setup lang="ts">
// YOLO26 全任务实时演示：7 个任务（检测/分割/语义/深度/分类/姿态/有向）纯浏览器本地推理
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'yolo-detection')!)
</script>

<template>
  <MediaDemoShell :demo="demo">
    <ClientOnly>
      <YoloRealtime />
      <template #fallback>
        <div class="py-20 flex items-center justify-center">
          <UIcon
            name="i-lucide-loader-circle"
            class="size-8 animate-spin text-muted"
          />
        </div>
      </template>
    </ClientOnly>
  </MediaDemoShell>
</template>
