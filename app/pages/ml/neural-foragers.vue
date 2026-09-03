<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-foragers')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="foragers"
  />
</template>
