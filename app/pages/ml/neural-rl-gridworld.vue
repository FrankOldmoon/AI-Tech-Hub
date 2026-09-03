<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-rl-gridworld')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="rl-gridworld"
  />
</template>
