<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-genetic-tsp')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="genetic-tsp"
  />
</template>
