<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-pathfinding')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="pathfinding"
  />
</template>
