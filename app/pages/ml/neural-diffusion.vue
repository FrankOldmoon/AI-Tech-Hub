<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-diffusion')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="diffusion"
  />
</template>
