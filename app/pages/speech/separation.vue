<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'
import { paramDefaults } from '~/utils/params'
import { isRemoteDeploy } from '~/utils/remote-models'

const { t } = useI18n()
const { getDemo } = useDemos()

const demo = computed(() => getDemo('speech', 'separation')!)

const loading = ref(false)
const error = ref<string | null>(null)
// 云端（Vercel）无 Python 环境：分离不可用，直接提示
const cloudUnavailable = isRemoteDeploy()
const fileName = ref('')
const fileData = ref<File | null>(null)
const taskId = ref<string | null>(null)
const progress = ref(0)
const progressText = ref('')

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
  { label: t('separation.twoStemsVocals'), value: 'vocals' },
  { label: t('separation.twoStemsNone'), value: 'none' }
])

const specs = computed<ParamSpec[]>(() => [
  { key: 'model', label: t('separation.model'), type: 'select', default: 'htdemucs', options: modelItems, help: t('separation.modelHelp') },
  { key: 'twoStems', label: t('separation.twoStems'), type: 'select', default: 'vocals', options: twoStemsItems.value, help: t('separation.twoStemsHelp') }
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

const { poll, stop: stopPolling } = useTaskPoller({
  progress,
  progressText,
  error,
  errorMessage: '分离失败',
  cancelledMessage: '已取消',
  timeoutMessage: t('demo.taskTimeout'),
  onDone: (task) => { if (task.stems) stems.value = task.stems },
  onError: task => task.message || task.error
})

async function separate() {
  if (loading.value) return
  if (!fileData.value) {
    error.value = t('separation.upload')
    return
  }
  error.value = null
  stems.value = []
  loading.value = true
  progress.value = 0
  progressText.value = t('separation.processing')
  try {
    const formData = new FormData()
    formData.append('file', fileData.value)
    formData.append('model', String(params.value.model))
    const twoStems = String(params.value.twoStems)
    formData.append('twoStems', twoStems === 'none' ? '' : twoStems)

    // 提交任务：立即返回 taskId，后台异步执行
    const res = await $fetch<{ ok: boolean, taskId?: string, error?: string }>('/api/speech/separate', {
      method: 'POST',
      body: formData
    })
    if (!res.ok || !res.taskId) {
      error.value = res.error || t('demo.backendUnavailable')
      return
    }
    taskId.value = res.taskId
    await poll(`/api/speech/separate/${res.taskId}`)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

/** 取消任务 */
async function cancelSeparation() {
  if (!taskId.value) return
  stopPolling()
  loading.value = false
  try {
    await $fetch(`/api/speech/separate/${taskId.value}`, { method: 'DELETE' })
  } catch { /* ignore */ }
  taskId.value = null
  progress.value = 0
  progressText.value = ''
  error.value = t('separation.cancelled')
}

onBeforeUnmount(() => {
  taskId.value = null
})

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
      <UAlert
        v-if="cloudUnavailable"
        color="warning"
        variant="subtle"
        icon="i-lucide-info"
        class="mb-6"
        :title="t('separation.cloudUnavailable')"
      />
      <DemoRunner
        :demo="demo"
        :loading="loading"
        :error="error"
        :notice="null"
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
          <UButton
            v-if="loading && taskId"
            icon="i-lucide-x"
            :label="t('separation.cancel')"
            color="error"
            variant="subtle"
            @click="cancelSeparation"
          />
        </template>

        <!-- 结果 -->
        <template #result>
          <!-- 异步任务进度 -->
          <div v-if="loading" class="space-y-2 py-2">
            <UProgress :model-value="progress" />
            <p class="text-xs text-muted">{{ progressText }}</p>
          </div>
          <div v-else-if="stems.length" class="space-y-4">
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
