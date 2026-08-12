<script setup lang="ts">
/**
 * 人脸注册与识别面板：
 * - 注册：姓名 + 当前上传的人脸照片 -> 提取嵌入 -> 存入浏览器本地注册库
 * - 识别：当前上传照片 -> 与注册库比对 -> 返回最佳匹配
 * 嵌入提取走 /api/image/face-recognition（insightface，venv 未就绪时优雅报错）。
 */
import { getRegisteredFaces, registerFace, recognizeFace, deleteFace } from '~/utils/face-registry'

const props = defineProps<{
  imageData: ImageData | null
}>()

const { t } = useI18n()
const name = ref('')
const faces = ref(getRegisteredFaces())
const busy = ref<'register' | 'recognize' | null>(null)
const error = ref<string | null>(null)
const success = ref<string | null>(null)
const result = ref<{ label: string; value: string } | null>(null)

async function onRegister() {
  if (!props.imageData || !name.value.trim()) return
  busy.value = 'register'
  error.value = null
  success.value = null
  result.value = null
  try {
    await registerFace(name.value, props.imageData)
    faces.value = getRegisteredFaces()
    success.value = `${t('image.faceRegister.registered')}：${name.value.trim()}`
    name.value = ''
  } catch (e) {
    error.value = (e as Error)?.message || String(e)
  } finally {
    busy.value = null
  }
}

async function onRecognize() {
  if (!props.imageData) return
  busy.value = 'recognize'
  error.value = null
  success.value = null
  result.value = null
  try {
    const hit = await recognizeFace(props.imageData)
    result.value = hit
      ? {
          label: `${t('image.faceRegister.matched')}：${hit.face.name}`,
          value: `${t('image.faceRegister.similarity')}：${hit.similarity.toFixed(4)}`
        }
      : { label: t('image.faceRegister.notRecognized'), value: '' }
  } catch (e) {
    error.value = (e as Error)?.message || String(e)
  } finally {
    busy.value = null
  }
}

function onDelete(id: string) {
  deleteFace(id)
  faces.value = getRegisteredFaces()
}
</script>

<template>
  <div class="rounded-lg border border-default p-4 space-y-4">
    <p class="text-xs font-medium text-muted uppercase tracking-wide">
      {{ t('image.faceRegister.title') }}
    </p>

    <UAlert
      v-if="!imageData"
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      :title="t('image.faceRegister.hint')"
    />

    <div v-else class="space-y-3">
      <div class="flex flex-wrap items-end gap-3">
        <div class="min-w-52 flex-1">
          <label class="block text-sm font-medium text-muted mb-1">
            {{ t('image.faceRegister.name') }}
          </label>
          <UInput
            v-model="name"
            :placeholder="t('image.faceRegister.namePlaceholder')"
            :disabled="!!busy"
          />
        </div>
        <UButton
          icon="i-lucide-user-plus"
          :label="t('image.faceRegister.register')"
          color="primary"
          :loading="busy === 'register'"
          :disabled="!name.trim() || !!busy"
          @click="onRegister"
        />
        <UButton
          icon="i-lucide-scan-face"
          :label="t('image.faceRegister.recognize')"
          color="secondary"
          variant="soft"
          :loading="busy === 'recognize'"
          :disabled="!!busy"
          @click="onRecognize"
        />
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        :title="error"
      />
      <UAlert
        v-if="success"
        color="success"
        variant="subtle"
        icon="i-lucide-check"
        :title="success"
      />

      <div v-if="result" class="rounded-lg bg-elevated/60 p-3">
        <p class="text-sm font-medium text-highlighted">{{ result.label }}</p>
        <p v-if="result.value" class="text-sm text-muted">{{ result.value }}</p>
      </div>

      <div>
        <p class="text-sm font-medium text-muted mb-2">
          {{ t('image.faceRegister.registeredList') }}（{{ faces.length }}）
        </p>
        <p v-if="!faces.length" class="text-xs text-dimmed">
          {{ t('image.faceRegister.empty') }}
        </p>
        <ul v-else class="grid sm:grid-cols-2 gap-2">
          <li
            v-for="f in faces"
            :key="f.id"
            class="flex items-center gap-2 rounded-lg border border-default p-2"
          >
            <img v-if="f.thumb" :src="f.thumb" class="size-10 rounded object-cover" alt="">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-highlighted truncate">{{ f.name }}</p>
              <p class="text-xs text-muted">
                {{ new Date(f.createdAt).toLocaleDateString() }}
              </p>
            </div>
            <UButton
              icon="i-lucide-trash-2"
              size="xs"
              color="error"
              variant="ghost"
              :aria-label="t('image.faceRegister.delete')"
              @click="onDelete(f.id)"
            />
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
