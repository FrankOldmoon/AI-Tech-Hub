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

async function separate() {
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
    await pollTask(res.taskId)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

/** 轮询任务状态直到完成/失败/取消 */
async function pollTask(id: string) {
  while (true) {
    const res = await $fetch<{ ok: boolean, task?: any, error?: string }>(`/api/speech/separate/${id}`, {
      method: 'GET'
    }).catch(() => null)
    if (!res?.ok || !res.task) {
      error.value = res?.error || '任务查询失败'
      return
    }
    const t = res.task
    progress.value = t.progress || 0
    progressText.value = t.message || ''
    if (t.status === 'done' && t.stems) {
      stems.value = t.stems
      return
    }
    if (t.status === 'error') {
      error.value = t.error || t.message || '分离失败'
      return
    }
    if (t.status === 'cancelled') {
      error.value = t.message || '已取消'
      return
    }
    // 1.5s 轮询
    await new Promise((r) => setTimeout(r, 1500))
  }
}

/** 取消任务 */
async function cancelSeparation() {
  if (!taskId.value) return
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
