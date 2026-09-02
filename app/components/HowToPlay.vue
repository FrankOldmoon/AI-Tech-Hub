<script setup lang="ts">
/**
 * 首页「怎么玩」三步引导 + FAQ + 反馈入口（UX 审计批次5：FAQ/反馈入口 + 怎么玩三步引导）
 */
const { t } = useI18n()
const faqOpen = ref(false)

const steps = computed(() => [
  {
    icon: 'i-lucide-mouse-pointer-click',
    title: t('home.howToPlay.step1.title'),
    desc: t('home.howToPlay.step1.desc')
  },
  {
    icon: 'i-lucide-image-plus',
    title: t('home.howToPlay.step2.title'),
    desc: t('home.howToPlay.step2.desc')
  },
  {
    icon: 'i-lucide-play',
    title: t('home.howToPlay.step3.title'),
    desc: t('home.howToPlay.step3.desc')
  }
])

const faqItems = computed(() => [
  { icon: 'i-lucide-shield-check', text: t('home.howToPlay.faq.data') },
  { icon: 'i-lucide-monitor', text: t('home.howToPlay.faq.device') },
  { icon: 'i-lucide-cloud-off', text: t('home.howToPlay.faq.cloud') }
])
</script>

<template>
  <div class="py-8 space-y-4">
    <div class="flex items-center gap-2">
      <UIcon
        name="i-lucide-graduation-cap"
        class="size-5 text-primary"
      />
      <h2 class="text-lg font-bold text-highlighted">
        {{ t('home.howToPlay.title') }}
      </h2>
    </div>

    <!-- 三步引导 -->
    <div class="grid md:grid-cols-3 gap-4">
      <UCard
        v-for="(s, i) in steps"
        :key="i"
        variant="subtle"
      >
        <div class="flex items-start gap-3">
          <div class="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <UIcon
              :name="s.icon"
              class="size-5"
            />
          </div>
          <div>
            <p class="font-medium text-highlighted">
              {{ i + 1 }}. {{ s.title }}
            </p>
            <p class="mt-1 text-sm text-muted leading-relaxed">
              {{ s.desc }}
            </p>
          </div>
        </div>
      </UCard>
    </div>

    <!-- FAQ + 反馈入口 -->
    <div class="flex flex-wrap items-center gap-3">
      <UButton
        to="https://github.com/FrankOldmoon/AI-Tech-Hub/issues"
        target="_blank"
        icon="i-lucide-message-square"
        color="neutral"
        variant="soft"
        :label="t('home.howToPlay.feedback')"
      />
      <UButton
        icon="i-lucide-help-circle"
        color="neutral"
        variant="ghost"
        :label="t('home.howToPlay.faq.title')"
        @click="faqOpen = !faqOpen"
      />
    </div>

    <UCollapsible v-model:open="faqOpen">
      <template #content>
        <div class="space-y-2 pt-1">
          <UAlert
            v-for="item in faqItems"
            :key="item.text"
            color="neutral"
            variant="subtle"
            :icon="item.icon"
            :title="item.text"
          />
        </div>
      </template>
    </UCollapsible>
  </div>
</template>
