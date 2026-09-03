<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-boids')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="boids"
  />
</template>
