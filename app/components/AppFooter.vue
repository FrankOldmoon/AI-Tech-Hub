<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <UFooter>
    <template #left>
      <p class="text-sm text-muted">
        {{ t('footer.builtWith') }} • © {{ new Date().getFullYear() }}
      </p>
    </template>
    <template #right>
      <UButton
        to="/status"
        icon="i-lucide-database"
        :label="t('footer.modelStatus')"
        color="neutral"
        variant="ghost"
        size="sm"
      />
      <UButton
        to="https://github.com/FrankOldmoon/AI-Tech-Hub"
        target="_blank"
        icon="i-simple-icons-github"
        aria-label="GitHub"
        color="neutral"
        variant="ghost"
      />
    </template>
  </UFooter>
</template>
