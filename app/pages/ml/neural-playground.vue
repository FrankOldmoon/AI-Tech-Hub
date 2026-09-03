<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-playground')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="playground"
  />
</template>
