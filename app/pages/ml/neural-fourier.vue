<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-fourier')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="fourier"
  />
</template>
