<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'separation')!)

const loading = ref(false)
const error = ref<string | null>(null)
const fileName = ref('')
const fileData = ref<File | null>(null)

interface Stem {
  name: string
  url: string
}
const stems = ref<Stem[]>([])

const modelItems = [
  { label: 'htdemucs · 通用', value: 'htdemucs' },
  { label: 'htdemucs_ft · 微调', value: 'htdemucs_ft' },
  { label: 'mdx · 鼓分离优化', value: 'mdx' },
  { label: 'mdx_extra · 高质量', value: 'mdx_extra' }
]

const twoStemsItems = computed(() => [
  { label: t('separation.twoStemsNone'), value: 'none' },
  { label: t('separation.vocals'), value: 'vocals' },
  { label: t('separation.drums'), value: 'drums' },
  { label: t('separation.bass'), value: 'bass' },
  { label: t('separation.other'), value: 'other' }
])

const specs = computed<ParamSpec[]>(() => [
  { key: 'model', label: t('separation.model'), type: 'select', default: 'htdemucs', options: modelItems, help: t('separation.modelHelp') },
  { key: 'twoStems', label: t('separation.twoStems'), type: 'select', default: 'none', options: twoStemsItems.value, help: t('separation.twoStemsHelp') }
])
const params = ref<Record<string, number | string | boolean>>(paramDefaults(specs.value))

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files && input.files[0]) {
    fileData.value = input.files[0]
    fileName.value = input.files[0].name
    error.value = null
    stems.value = []
  }
}

function stemLabel(name: string): string {
  const key = `separation.${name}`
  const translated = t(key)
  return translated === key ? name : translated
}

async function separate() {
  if (!fileData.value) {
    error.value = t('separation.upload')
    return
  }
  error.value = null
  stems.value = []
  loading.value = true
  try {
    const formData = new FormData()
    formData.append('file', fileData.value)
    formData.append('model', String(params.value.model))
    const twoStems = String(params.value.twoStems)
    formData.append('twoStems', twoStems === 'none' ? '' : twoStems)

    const res = await $fetch<{ ok: boolean, available?: boolean, stems?: Stem[], error?: string }>('/api/speech/separate', {
      method: 'POST',
      body: formData
    })
    if (!res.ok) {
      if (res.available === false) {
        error.value = t('demo.backendUnavailable')
      } else {
        error.value = res.error || 'error'
      }
    } else if (res.stems) {
      stems.value = res.stems
    }
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

function downloadStem(stem: Stem) {
  const a = document.createElement('a')
  a.href = stem.url
  a.download = `${stem.name}.wav`
  a.click()
}
</script>

<template>
  <UContainer>
    <div class="py-8 sm:py-12">
      <DemoRunner
        :demo="demo"
        :loading="loading"
        :error="error"
        :notice="loading ? t('separation.processing') : null"
      >
        <!-- 输入 -->
        <template #input>
          <div class="space-y-4">
            <div>
              <label class="flex items-center gap-2 cursor-pointer">
                <UButton
                  icon="i-lucide-upload"
                  :label="t('separation.upload')"
                  color="primary"
                  variant="subtle"
                  as="span"
                />
                <span v-if="fileName" class="text-sm text-muted truncate">{{ fileName }}</span>
                <span v-else class="text-sm text-muted">{{ t('separation.uploadHint') }}</span>
                <input
                  type="file"
                  accept="audio/*"
                  class="hidden"
                  @change="onFileChange"
                >
              </label>
            </div>
            <DemoParams v-model="params" :specs="specs" :running="loading" :title="t('params.title')" />
          </div>
        </template>

        <!-- 控件 -->
        <template #controls>
          <UButton
            icon="i-lucide-split"
            :label="t('separation.separate')"
            :loading="loading"
            :disabled="!fileData"
            color="primary"
            @click="separate"
          />
        </template>

        <!-- 结果 -->
        <template #result>
          <div v-if="stems.length" class="space-y-4">
            <p class="text-sm font-medium text-highlighted">{{ t('separation.stems') }}</p>
            <div
              v-for="stem in stems"
              :key="stem.name"
              class="flex items-center gap-3"
            >
              <span class="text-sm font-medium w-24 shrink-0">{{ stemLabel(stem.name) }}</span>
              <audio :src="stem.url" controls class="flex-1" />
              <UButton
                icon="i-lucide-download"
                :label="t('separation.download')"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="downloadStem(stem)"
              />
            </div>
          </div>
          <div v-else class="text-sm text-muted">—</div>
        </template>
      </DemoRunner>
    </div>
  </UContainer>
</template>
