<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-optimizers')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="optimizers"
  />
</template>
