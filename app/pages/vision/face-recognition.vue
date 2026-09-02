<script setup lang="ts">
/**
 * 人脸注册与识别（纯浏览器端，face-api）。
 * 人脸检测/关键点/128 维嵌入全部在浏览器本地运行（/model/faceapi，约 7MB），
 * 注册库保存在 localStorage，数据不出浏览器，无后端依赖。
 */
import type { RegisteredFace, FaceResult } from '~/utils/face-studio'
import {
  ensureFaceApiLoaded, extractFaces, fileToImage, imageThumbDataUrl,
  registerFace, removeFace, clearRegistry, getRegistry, recognizeDescriptor
} from '~/utils/face-studio'
import { humanError } from '~/utils/errors'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'face-recognition')!)

const modelReady = ref(false)
const loadError = ref('')
const analyzing = ref(false)

interface RegItem { id: string, url: string, img: HTMLImageElement, faces: FaceResult[] }
const regItems = ref<RegItem[]>([])
const selected = ref<{ itemId: string, faceIdx: number } | null>(null)
const name = ref('')
const registry = ref<RegisteredFace[]>([])
const info = ref('')
const infoColor = ref<'success' | 'error' | undefined>(undefined)
const regInput = ref<HTMLInputElement>()

interface RecHit { box: FaceResult['box'], score: number, name: string, similarity: number, known: boolean }
interface RecItem { url: string, img: HTMLImageElement, hits: RecHit[] }
const recItems = ref<RecItem[]>([])
const recInput = ref<HTMLInputElement>()

async function ensureModel() {
  if (loadError.value) return
  try {
    await ensureFaceApiLoaded()
    modelReady.value = true
  } catch (e: any) {
    loadError.value = humanError(e, t)
  }
}

function pct(v: number, total: number): string {
  return `${Math.max(0, Math.min(100, (v / total) * 100))}%`
}

function faceBoxStyle(item: RegItem, f: FaceResult): Record<string, string> {
  return {
    left: pct(f.box.x, item.img.width),
    top: pct(f.box.y, item.img.height),
    width: pct(f.box.width, item.img.width),
    height: pct(f.box.height, item.img.height)
  }
}
function recBoxStyle(item: RecItem, h: RecHit): Record<string, string> {
  return {
    left: pct(h.box.x, item.img.width),
    top: pct(h.box.y, item.img.height),
    width: pct(h.box.width, item.img.width),
    height: pct(h.box.height, item.img.height)
  }
}

function isFaceSelected(itemId: string, faceIdx: number): boolean {
  return selected.value?.itemId === itemId && selected.value?.faceIdx === faceIdx
}

function refresh() {
  registry.value = getRegistry()
}

async function onRegisterFiles(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files || !files.length) return
  analyzing.value = true
  info.value = ''
  try {
    await ensureFaceApiLoaded()
    for (const file of Array.from(files)) {
      const img = await fileToImage(file)
      const faces = await extractFaces(img)
      regItems.value.push({ id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, url: img.src, img, faces })
    }
    if (regItems.value.length) {
      const last = regItems.value[regItems.value.length - 1]
      selected.value = last.faces.length ? { itemId: last.id, faceIdx: 0 } : null
    }
  } catch (e: any) {
    info.value = humanError(e, t)
    infoColor.value = 'error'
  } finally {
    analyzing.value = false
  }
  const input = e.target as HTMLInputElement
  input.value = ''
}

function clearRegPhotos() {
  regItems.value = []
  selected.value = null
}

function doRegister() {
  info.value = ''
  infoColor.value = undefined
  if (!selected.value) { info.value = t('image.faceStudio.registerEmpty'); infoColor.value = 'error'; return }
  const item = regItems.value.find(i => i.id === selected.value!.itemId)
  const face = item?.faces[selected.value!.faceIdx]
  if (!item || !face) { info.value = t('image.faceStudio.registerEmpty'); infoColor.value = 'error'; return }
  const nm = name.value.trim()
  if (!nm) { info.value = t('image.faceStudio.nameRequired'); infoColor.value = 'error'; return }
  const thumb = imageThumbDataUrl(item.img)
  const before = getRegistry().find(f => f.name === nm)
  registerFace(nm, face.descriptor, thumb)
  refresh()
  const after = getRegistry().find(f => f.name === nm)
  const n = after?.samples.length ?? 1
  info.value = before ? t('image.faceStudio.appendSuccess', { name: nm, n: 1, total: n }) : t('image.faceStudio.registerSuccess', { name: nm, n })
  infoColor.value = 'success'
  name.value = ''
}

async function onRecognizeFiles(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files || !files.length) return
  analyzing.value = true
  try {
    await ensureFaceApiLoaded()
    const list = getRegistry()
    for (const file of Array.from(files)) {
      const img = await fileToImage(file)
      const faces = await extractFaces(img)
      const hits: RecHit[] = faces.map((f) => {
        const hit = recognizeDescriptor(f.descriptor, list)
        return hit
          ? { box: f.box, score: f.score, name: hit.name, similarity: hit.similarity, known: true }
          : { box: f.box, score: f.score, name: '', similarity: 0, known: false }
      })
      recItems.value.push({ url: img.src, img, hits })
    }
  } catch (e: any) {
    info.value = humanError(e, t)
    infoColor.value = 'error'
  } finally {
    analyzing.value = false
  }
  const input = e.target as HTMLInputElement
  input.value = ''
}

function clearRec() {
  recItems.value = []
}

function removeFaceItem(id: string) {
  removeFace(id)
  refresh()
}

onMounted(() => {
  refresh()
  ensureModel()
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <!-- 模型状态 -->
    <div class="flex flex-wrap items-center gap-2">
      <UBadge :color="modelReady ? 'success' : 'neutral'" variant="subtle">
        {{ modelReady ? t('image.faceStudio.modelReady') : t('image.faceStudio.analyzing') }}
      </UBadge>
      <span class="text-sm text-muted">{{ t('image.faceStudio.firstRunNote') }}</span>
    </div>
    <UAlert v-if="loadError" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="loadError" />

    <div class="grid lg:grid-cols-2 gap-4">
      <!-- 注册 -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2 font-medium text-highlighted">
            <UIcon name="i-lucide-user-plus" class="size-4 text-primary" />
            {{ t('image.faceStudio.registerTitle') }}
          </div>
        </template>
        <p class="text-sm text-muted -mt-2">{{ t('image.faceStudio.registerHint') }}</p>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-images"
            :label="t('image.faceStudio.addPhotos')"
            color="primary"
            variant="subtle"
            :loading="analyzing"
            :disabled="analyzing"
            @click="regInput?.click()"
          />
          <UButton icon="i-lucide-eraser" color="neutral" variant="ghost" size="sm" :label="t('image.faceStudio.clearPhotos')" @click="clearRegPhotos" />
          <input ref="regInput" type="file" accept="image/*" multiple class="hidden" @change="onRegisterFiles">
        </div>
        <p class="mt-1 text-xs text-muted">{{ t('image.faceStudio.photosHint') }}</p>

        <!-- 已上传照片 + 人脸框 -->
        <div v-if="regItems.length" class="mt-3 space-y-3">
          <div
            v-for="item in regItems"
            :key="item.id"
            class="relative w-full rounded-lg overflow-hidden border border-default/60 bg-elevated/50"
          >
            <img :src="item.url" class="w-full h-auto block" alt="">
            <button
              v-for="(f, fi) in item.faces"
              :key="fi"
              class="absolute z-10 rounded-sm border-2 transition-colors"
              :class="isFaceSelected(item.id, fi) ? 'border-primary bg-primary/15' : 'border-white/80 hover:border-primary'"
              :style="faceBoxStyle(item, f)"
              :title="`face ${fi + 1}`"
              @click="selected = { itemId: item.id, faceIdx: fi }"
            >
              <span class="absolute -top-4 left-0 text-[10px] leading-none px-1 rounded bg-black/70 text-white">{{ fi + 1 }}</span>
            </button>
            <UAlert v-if="!item.faces.length" color="neutral" variant="subtle" :title="t('image.faceStudio.noFace')" />
          </div>
        </div>

        <!-- 姓名 + 注册 -->
        <div class="mt-4 space-y-3">
          <UInput v-model="name" icon="i-lucide-user" :placeholder="t('image.faceStudio.namePlaceholder')" size="lg" />
          <UButton
            block
            icon="i-lucide-user-plus"
            :label="t('image.faceStudio.registerBtn')"
            color="primary"
            size="lg"
            :disabled="analyzing || !regItems.length || !modelReady"
            @click="doRegister"
          />
          <UAlert
            v-if="info && infoColor === 'success'"
            color="success"
            variant="subtle"
            icon="i-lucide-circle-check"
            :title="info"
          />
          <UAlert
            v-else-if="info"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-x"
            :title="info"
          />
        </div>
      </UCard>

      <!-- 识别 -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2 font-medium text-highlighted">
            <UIcon name="i-lucide-scan-face" class="size-4 text-primary" />
            {{ t('image.faceStudio.recognizeTitle') }}
          </div>
        </template>
        <p class="text-sm text-muted -mt-2">{{ t('image.faceStudio.recognizeHint') }}</p>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-scan-face"
            :label="t('image.faceStudio.recognizeBtn')"
            color="primary"
            variant="subtle"
            :loading="analyzing"
            :disabled="analyzing || !modelReady"
            @click="recInput?.click()"
          />
          <UButton icon="i-lucide-eraser" color="neutral" variant="ghost" size="sm" :label="t('image.faceStudio.clearPhotos')" @click="clearRec" />
          <input ref="recInput" type="file" accept="image/*" multiple class="hidden" @change="onRecognizeFiles">
        </div>

        <div v-if="recItems.length" class="mt-3 space-y-3">
          <div v-for="(item, idx) in recItems" :key="idx" class="relative w-full rounded-lg overflow-hidden border border-default/60 bg-elevated/50">
            <img :src="item.url" class="w-full h-auto block" alt="">
            <div
              v-for="(h, hi) in item.hits"
              :key="hi"
              class="absolute z-10 rounded-sm border-2"
              :class="h.known ? 'border-success' : 'border-neutral'"
              :style="recBoxStyle(item, h)"
            >
              <span class="absolute left-0 rounded-sm px-1 text-[10px] leading-4 whitespace-nowrap" :class="h.known ? 'bg-success text-white' : 'bg-muted text-white'">
                {{ h.known ? `${h.name} ${Math.round(h.similarity * 100)}%` : '?' }}
              </span>
            </div>
          </div>
        </div>
        <UAlert
          v-else
          class="mt-3"
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          :title="t('image.faceStudio.recognizeEmpty')"
        />
      </UCard>
    </div>

    <!-- 注册库 -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 font-medium text-highlighted">
            <UIcon name="i-lucide-database" class="size-4 text-primary" />
            {{ t('image.faceStudio.registeredList') }}
          </div>
          <UButton
            v-if="registry.length"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="sm"
            :label="t('image.faceStudio.clearPhotos')"
            @click="clearRegistry(); refresh()"
          />
        </div>
      </template>
      <p class="text-xs text-muted -mt-2">{{ t('image.faceStudio.storageNote') }}</p>

      <ul v-if="registry.length" class="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <li v-for="f in registry" :key="f.id" class="flex items-center gap-3 rounded-xl border border-default/70 p-3">
          <img v-if="f.samples[0]?.thumb" :src="f.samples[0].thumb" class="size-12 rounded-lg object-cover border border-default/60" alt="">
          <div class="min-w-0 flex-1">
            <div class="font-medium text-highlighted truncate">{{ f.name }}</div>
            <div class="text-xs text-muted">{{ f.samples.length }} {{ t('image.faceStudio.sampleCount') }}</div>
          </div>
          <UButton icon="i-lucide-trash" color="neutral" variant="ghost" size="sm" :aria-label="t('image.faceStudio.delete')" @click="removeFaceItem(f.id)" />
        </li>
      </ul>
      <UAlert v-else class="mt-3" color="neutral" variant="subtle" icon="i-lucide-database" :title="t('image.faceStudio.empty')" />
    </UCard>
  </MediaDemoShell>
</template>