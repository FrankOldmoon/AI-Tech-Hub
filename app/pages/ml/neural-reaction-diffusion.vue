<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-reaction-diffusion')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="reaction-diffusion"
  />
</template>
