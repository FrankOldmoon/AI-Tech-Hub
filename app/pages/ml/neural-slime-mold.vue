<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-slime-mold')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="slime-mold"
  />
</template>
