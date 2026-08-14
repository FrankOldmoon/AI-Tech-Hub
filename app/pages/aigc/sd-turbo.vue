<script setup lang="ts">
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('aigc', 'sd-turbo')!)

const tab = ref<'text2img' | 'img2img'>('text2img')
const prompt = ref('a cute cat sitting on a windowsill, digital art, highly detailed')
const negative = ref('blurry, low quality')
const inputFile = ref<File | null>(null)
const previewUrl = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const taskId = ref<string | null>(null)
const progress = ref(0)
const progressText = ref('')
const resultUrls = ref<string[]>([])
const fileInput = ref<HTMLInputElement>()

const steps = ref(2)
const guidance = ref(0)
const seed = ref(-1)
const batch = ref(1)
const size = ref(512)
const strength = ref(0.75)

const batchItems = [1, 2, 3, 4].map((n) => ({ label: String(n), value: n }))
const sizeItems = [256, 512, 768].map((n) => ({ label: `${n} × ${n}`, value: n }))

/** 提示词示例（SD-Turbo 对英文提示词效果最佳） */
const promptExamples = [
  'a cute cat sitting on a windowsill, digital art, highly detailed',
  'cyberpunk city street at night, neon lights, rainy',
  'a bowl of ramen with egg, food photography, studio light'
]

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  inputFile.value = file
  error.value = null
  resultUrls.value = []
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = URL.createObjectURL(file)
  input.value = ''
}

const { poll, stop: stopPolling } = useTaskPoller({
  progress,
  progressText,
  error,
  timeoutMessage: t('demo.taskTimeout'),
  onDone: (task) => {
    if (task.resultUrls?.length) resultUrls.value = task.resultUrls
    else if (task.resultUrl) resultUrls.value = [task.resultUrl]
  }
})

async function run() {
  if (loading.value) return
  if (!prompt.value.trim()) { error.value = t('demo.inputRequired'); return }
  if (tab.value === 'img2img' && !inputFile.value) { error.value = t('demo.inputRequired'); return }
  error.value = null
  resultUrls.value = []
  loading.value = true
  progress.value = 0
  try {
    const formData = new FormData()
    if (inputFile.value) formData.append('file', inputFile.value)
    formData.append('text', prompt.value)
    formData.append('mode', tab.value)
    formData.append('steps', String(steps.value))
    formData.append('guidance', String(guidance.value))
    formData.append('seed', String(seed.value))
    formData.append('batch', String(batch.value))
    formData.append('size', String(size.value))
    formData.append('strength', String(strength.value))
    if (tab.value === 'text2img') formData.append('negative', negative.value)
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/aigc/sd-turbo', { method: 'POST', body: formData })
    if (!res.ok || !res.taskId) { error.value = res.error || '提交失败'; return }
    taskId.value = res.taskId
    await poll(`/api/aigc/sd-turbo/${res.taskId}`)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

async function cancel() {
  if (!taskId.value) return
  stopPolling()
  loading.value = false
  try { await $fetch(`/api/aigc/sd-turbo/${taskId.value}`, { method: 'DELETE' }) } catch { /* ignore */ }
  taskId.value = null
  error.value = '已取消'
}

onBeforeUnmount(() => {
  try { if (previewUrl.value) URL.revokeObjectURL(previewUrl.value) } catch { /* ignore */ }
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="flex flex-wrap items-center gap-3">
      <UTabs
        v-model="tab"
        :items="[
          { label: t('sdTurbo.tabText2Img'), value: 'text2img' },
          { label: t('sdTurbo.tabImg2Img'), value: 'img2img' }
        ]"
      />
      <span class="text-sm text-muted">{{ t('sdTurbo.modelHelp') }}</span>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-triangle" :title="error" />
    <UAlert color="info" variant="subtle" icon="i-lucide-info" :title="t('sdTurbo.firstRunNote')" />

    <UCard>
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-keyboard" class="size-4" />
          {{ t('demo.input') }}
        </div>
      </template>
      <div class="space-y-4">
        <label class="block">
          <span class="block text-sm font-medium text-muted mb-1">{{ t('sdTurbo.prompt') }}</span>
          <div class="flex flex-wrap items-center gap-1.5 mb-2">
            <span class="text-xs text-muted">{{ t('sdTurbo.examples') }}</span>
            <UButton
              v-for="(ex, i) in promptExamples"
              :key="i"
              size="xs"
              variant="soft"
              color="neutral"
              class="max-w-56"
              :disabled="loading"
              @click="prompt = ex"
            >
              <span class="truncate">{{ ex }}</span>
            </UButton>
          </div>
          <UTextarea
            v-model="prompt"
            :rows="3"
            autoresize
            :maxrows="8"
            :ui="{ base: 'resize-none' }"
            :placeholder="t('sdTurbo.promptPlaceholder')"
            :disabled="loading"
          />
        </label>
        <label v-if="tab === 'text2img'" class="block">
          <span class="block text-sm font-medium text-muted mb-1">{{ t('sdTurbo.negative') }}</span>
          <UInput v-model="negative" :disabled="loading" />
        </label>

        <div v-if="tab === 'img2img'" class="flex flex-wrap items-center gap-3">
          <UButton icon="i-lucide-upload" :label="t('mp.upload')" color="primary" variant="subtle" :disabled="loading" @click="fileInput?.click()" />
          <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange">
          <span v-if="inputFile" class="text-sm text-muted truncate">{{ inputFile.name }}</span>
        </div>

        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <label class="block">
            <span class="block text-sm font-medium text-muted mb-1">{{ t('sdTurbo.steps') }}: {{ steps }}</span>
            <input v-model.number="steps" type="range" min="1" max="8" class="w-full" :disabled="loading">
          </label>
          <label class="block">
            <span class="block text-sm font-medium text-muted mb-1">{{ t('sdTurbo.guidance') }}: {{ guidance }}</span>
            <input v-model.number="guidance" type="range" min="0" max="2" step="0.1" class="w-full" :disabled="loading">
          </label>
          <label v-if="tab === 'img2img'" class="block">
            <span class="block text-sm font-medium text-muted mb-1">{{ t('sdTurbo.strength') }}: {{ strength }}</span>
            <input v-model.number="strength" type="range" min="0.05" max="1" step="0.05" class="w-full" :disabled="loading">
          </label>
          <label v-else class="block">
            <span class="block text-sm font-medium text-muted mb-1">{{ t('sdTurbo.seed') }}</span>
            <UInput v-model.number="seed" type="number" :disabled="loading" />
          </label>
          <label class="block">
            <span class="block text-sm font-medium text-muted mb-1">{{ t('sdTurbo.batch') }}</span>
            <USelect v-model="batch" :items="batchItems" :disabled="loading" class="w-full" />
          </label>
          <label class="block">
            <span class="block text-sm font-medium text-muted mb-1">{{ t('sdTurbo.size') }}</span>
            <USelect v-model="size" :items="sizeItems" :disabled="loading" class="w-full" />
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <UButton
            icon="i-lucide-play"
            :label="t('sdTurbo.run')"
            color="primary"
            :loading="loading"
            :disabled="loading || !prompt.trim() || (tab === 'img2img' && !inputFile)"
            @click="run"
          />
          <UButton v-if="loading && taskId" icon="i-lucide-x" :label="t('voiceClone.cancel')" color="error" variant="subtle" @click="cancel" />
        </div>
      </div>
    </UCard>

    <div v-if="loading" class="space-y-2">
      <UProgress :model-value="progress" />
      <p class="text-xs text-muted">{{ progressText }}</p>
    </div>

    <div v-if="tab === 'img2img' && previewUrl" class="grid sm:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('sdTurbo.inputImage') }}</label>
        <div class="aspect-square rounded-xl overflow-hidden bg-elevated/60 border border-dashed border-default">
          <img :src="previewUrl" class="w-full h-full object-contain">
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-muted mb-2">{{ t('sdTurbo.result') }}</label>
        <div class="aspect-square rounded-xl overflow-hidden bg-elevated/60 border border-dashed border-default flex items-center justify-center">
          <img v-if="resultUrls[0]" :src="resultUrls[0]" class="w-full h-full object-contain">
          <UIcon v-else name="i-lucide-image" class="size-8 text-muted" />
        </div>
      </div>
    </div>

    <UCard v-else-if="resultUrls.length">
      <template #header>
        <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
          <UIcon name="i-lucide-image" class="size-4" />
          {{ t('sdTurbo.result') }} ({{ resultUrls.length }})
        </div>
      </template>
      <div class="grid sm:grid-cols-2 gap-4">
        <div v-for="url in resultUrls" :key="url">
          <div class="aspect-square rounded-xl overflow-hidden bg-elevated/60 border border-dashed border-default">
            <img :src="url" class="w-full h-full object-contain">
          </div>
          <a :href="url" target="_blank" download class="inline-block mt-2 text-sm text-primary underline">
            {{ t('sdTurbo.download') }}
          </a>
        </div>
      </div>
    </UCard>
  </MediaDemoShell>
</template>
