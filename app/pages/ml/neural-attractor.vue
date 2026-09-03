<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-attractor')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="attractor"
  />
</template>
