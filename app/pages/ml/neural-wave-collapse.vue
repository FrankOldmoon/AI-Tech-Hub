<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-wave-collapse')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="wave-collapse"
  />
</template>
