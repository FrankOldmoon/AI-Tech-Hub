<script setup lang="ts">
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'neural-automata')!)
</script>

<template>
  <NeuralDemoShell
    :demo="demo"
    name="automata"
  />
</template>
