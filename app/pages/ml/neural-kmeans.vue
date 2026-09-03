<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-kmeans')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="kmeans"
  />
</template>
