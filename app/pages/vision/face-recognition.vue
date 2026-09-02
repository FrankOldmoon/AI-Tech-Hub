<script setup lang="ts">
/**
 * 人脸注册与识别（纯浏览器端，face-api）。面向普通用户的分步引导体验：
 * 添加照片 → 点选人脸 → 命名注册；上传即自动识别。数据不出浏览器。
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
const { fetchSampleFile } = useVisionSamples()

const modelReady = ref(false)
const loadError = ref('')
const analyzing = ref(false)
const demoBusy = ref(false)
const demoInfo = ref('')

// ---- 注册 ----
interface RegItem { id: string, url: string, img: HTMLImageElement, faces: FaceResult[] }
const regItems = ref<RegItem[]>([])
const regInput = ref<HTMLInputElement>()
const regDragging = ref(false)
const regCamOpen = ref(false)
/** 每张照片一个人名（可输入新名字，或复用已有人名） */
const regNames = ref<Record<string, string>>({})
/** 每张照片选中的人脸序号（默认第 1 张） */
const regFaceIdx = ref<Record<string, number>>({})

// ---- 识别 ----
interface RecHit { box: FaceResult['box'], score: number, name: string, similarity: number, known: boolean }
interface RecItem { id: string, url: string, img: HTMLImageElement, hits: RecHit[] }
const recItems = ref<RecItem[]>([])
const recInput = ref<HTMLInputElement>()
const recDragging = ref(false)
const recCamOpen = ref(false)

// ---- 注册库 ----
const registry = ref<RegisteredFace[]>([])
const flash = ref<{ text: string, color: 'success' | 'error' | undefined } | null>(null)

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
  return { left: pct(f.box.x, item.img.width), top: pct(f.box.y, item.img.height), width: pct(f.box.width, item.img.width), height: pct(f.box.height, item.img.height) }
}
function recBoxStyle(item: RecItem, h: RecHit): Record<string, string> {
  return { left: pct(h.box.x, item.img.width), top: pct(h.box.y, item.img.height), width: pct(h.box.width, item.img.width), height: pct(h.box.height, item.img.height) }
}
function faceIndex(itemId: string): number { return regFaceIdx.value[itemId] ?? 0 }
function setFace(itemId: string, faceIdx: number) { regFaceIdx.value[itemId] = faceIdx }
function isFaceSelected(itemId: string, faceIdx: number): boolean { return faceIndex(itemId) === faceIdx }
function refresh() { registry.value = getRegistry() }

/** 人名候选：已注册人名 + 本次输入的人名（去重），用于下拉建议 */
const nameSuggestions = computed<string[]>(() => {
  const set = new Set<string>(registry.value.map(f => f.name))
  Object.values(regNames.value).forEach(n => { const s = n.trim(); if (s) set.add(s) })
  return Array.from(set)
})

async function analyzeFiles(files: File[]): Promise<RegItem[]> {
  await ensureFaceApiLoaded()
  const items: RegItem[] = []
  for (const file of files) {
    try {
      const img = await fileToImage(file)
      const faces = await extractFaces(img)
      items.push({ id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, url: img.src, img, faces })
    } catch {
      // 跳过不可读的图片
    }
  }
  return items
}

async function onRegisterFiles(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files || !files.length) return
  await addRegisterFiles(Array.from(files))
  ;(e.target as HTMLInputElement).value = ''
}

async function addRegisterFiles(files: File[]) {
  analyzing.value = true
  flash.value = null
  try {
    const items = await analyzeFiles(files)
    if (!items.length) { flash.value = { text: t('image.faceStudio.noFace'), color: 'error' }; return }
    regItems.value.push(...items)
    if (regItems.value.every(i => !i.faces.length)) flash.value = { text: t('image.faceStudio.noFace'), color: 'error' }
  } catch (e: any) {
    flash.value = { text: humanError(e, t), color: 'error' }
  } finally {
    analyzing.value = false
  }
}

function onRegDrop(e: DragEvent) {
  regDragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'))
  if (files.length) addRegisterFiles(files)
}

function removeRegItem(id: string) {
  regItems.value = regItems.value.filter(i => i.id !== id)
  delete regNames.value[id]
  delete regFaceIdx.value[id]
}

function clearRegPhotos() {
  regItems.value = []
  regNames.value = {}
  regFaceIdx.value = {}
}

/** 把每张照片按其填写的人名注册：同一人名多张 → 追加为多样张；不同人名各自成条。 */
function registerAll() {
  flash.value = null
  let created = 0
  let appended = 0
  let noName = 0
  let noFace = 0
  for (const item of regItems.value) {
    if (!item.faces.length) { noFace++; continue }
    const nm = (regNames.value[item.id] || '').trim()
    if (!nm) { noName++; continue }
    const fi = faceIndex(item.id)
    if (fi >= item.faces.length) continue
    const face = item.faces[fi]
    const had = getRegistry().some(f => f.name === nm)
    registerFace(nm, face.descriptor, imageThumbDataUrl(item.img))
    if (had) appended++; else created++
  }
  refresh()
  if (created + appended === 0) {
    flash.value = { text: noName > 0 ? t('image.faceStudio.nameRequired') : t('image.faceStudio.registerEmpty'), color: 'error' }
    return
  }
  flash.value = { text: t('image.faceStudio.regAllSuccess', { created, appended, n: created + appended }), color: 'success' }
  regNames.value = {}
  regFaceIdx.value = {}
}

async function onRecognizeFiles(e: Event, filesArr?: File[]) {
  const files = filesArr ?? Array.from((e.target as HTMLInputElement).files ?? [])
  if (!files.length) return
  analyzing.value = true
  flash.value = null
  try {
    const list = getRegistry()
    for (const file of files) {
      const img = await fileToImage(file)
      const faces = await extractFaces(img)
      const hits: RecHit[] = faces.map((f) => {
        const hit = recognizeDescriptor(f.descriptor, list)
        return hit
          ? { box: f.box, score: f.score, name: hit.name, similarity: hit.similarity, known: true }
          : { box: f.box, score: f.score, name: '', similarity: 0, known: false }
      })
      recItems.value.push({ id: `rc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, url: img.src, img, hits })
    }
  } catch (e: any) {
    flash.value = { text: humanError(e, t), color: 'error' }
  } finally {
    analyzing.value = false
  }
  const input = e.target as HTMLInputElement
  if (input.value) input.value = ''
}

function onRecDrop(e: DragEvent) {
  recDragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'))
  if (files.length) onRecognizeFiles({ target: { value: '' } } as unknown as Event, files)
}

function clearRec() { recItems.value = [] }
function removeFaceItem(id: string) { removeFace(id); refresh() }

/** 摄像头拍照 → 加入注册分析 */
function onCamRegCapture(file: File) {
  addRegisterFiles([file])
  regCamOpen.value = false
}

/** 摄像头拍照 → 走识别 */
function onCamRecCapture(file: File) {
  onRecognizeFiles({ target: { value: '' } } as unknown as Event, [file])
  recCamOpen.value = false
}

async function runDemo() {
  demoBusy.value = true
  demoInfo.value = ''
  try {
    await ensureFaceApiLoaded()
    const regFile = await fetchSampleFile('/samples/images/portrait.jpg')
    const img = await fileToImage(regFile)
    const faces = await extractFaces(img)
    if (!faces.length) { demoInfo.value = t('image.faceStudio.demoNoFace'); return }
    registerFace('示例·小明', faces[0].descriptor, imageThumbDataUrl(img))
    refresh()
    const simFile = await fetchSampleFile('/samples/images/similar-portrait.jpg')
    const simImg = await fileToImage(simFile)
    const simFaces = await extractFaces(simImg)
    const sim = simFaces.length ? recognizeDescriptor(simFaces[0].descriptor, getRegistry()) : null
    demoInfo.value = t('image.faceStudio.demoSuccess', { sim: sim ? Math.round(sim.similarity * 100) : 0 })
  } catch (e: any) {
    demoInfo.value = humanError(e, t)
  } finally {
    demoBusy.value = false
  }
}

onMounted(() => {
  refresh()
  ensureModel()
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <!-- 顶部工具条：设备状态 + 一键体验 -->
    <div class="flex flex-wrap items-center gap-3">
      <UBadge :color="modelReady ? 'success' : 'neutral'">
        {{ modelReady ? t('image.faceStudio.modelReady') : t('image.faceStudio.analyzing') }}
      </UBadge>
      <UButton
        icon="i-lucide-sparkles"
        :label="t('image.faceStudio.demoRun')"
        color="secondary"
        variant="subtle"
        :loading="demoBusy"
        :disabled="demoBusy"
        @click="runDemo"
      />
      <span class="text-sm text-muted">{{ t('image.faceStudio.demoRunHint') }}</span>
    </div>
    <UAlert v-if="loadError" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="loadError" />
    <UAlert v-if="demoInfo" color="success" variant="subtle" icon="i-lucide-circle-check" :title="demoInfo" />
    <UAlert v-if="!modelReady && !loadError" color="info" variant="subtle" icon="i-lucide-info" :title="t('image.faceStudio.firstRunNote')" />

    <div class="grid lg:grid-cols-5 gap-4 items-start">
      <!-- ============ 注册 ============ -->
      <UCard class="lg:col-span-3">
        <template #header>
          <div class="flex items-center gap-2 font-semibold text-highlighted">
            <span class="flex size-6 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-bold">1</span>
            {{ t('image.faceStudio.registerTitle') }}
          </div>
        </template>
        <p class="text-sm text-muted -mt-2">{{ t('image.faceStudio.registerHint') }}</p>

        <!-- 图片来源：上传 / 摄像头 -->
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <UButton icon="i-lucide-images" :label="t('image.faceStudio.addPhotos')" color="secondary" variant="soft" @click="regInput?.click()" />
          <UButton
            :icon="regCamOpen ? 'i-lucide-camera-off' : 'i-lucide-video'"
            :label="regCamOpen ? t('image.faceStudio.closeCamera') : t('image.faceStudio.useCamera')"
            :color="regCamOpen ? 'error' : 'primary'"
            variant="soft"
            @click="regCamOpen = !regCamOpen"
          />
        </div>
        <input ref="regInput" type="file" accept="image/*" multiple class="hidden" @change="onRegisterFiles">

        <!-- 摄像头拍照 -->
        <div v-if="regCamOpen" class="mt-3">
          <FaceCameraCapture @capture="onCamRegCapture" @close="regCamOpen = false" />
        </div>

        <!-- 拖拽/点选上传区 -->
        <div
          v-else
          class="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors"
          :class="regDragging ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated/60'"
          @click="regInput?.click()"
          @dragover.prevent="regDragging = true"
          @dragleave="regDragging = false"
          @drop.prevent="onRegDrop"
        >
          <UIcon :name="analyzing ? 'i-lucide-loader-circle' : 'i-lucide-images'" class="size-7" :class="analyzing ? 'animate-spin text-muted' : 'text-primary'" />
          <span class="text-sm font-medium">{{ analyzing ? t('image.faceStudio.analyzing') : t('image.faceStudio.addPhotos') }}</span>
          <span class="text-xs text-muted">{{ t('image.faceStudio.photosHint') }} · {{ t('image.faceStudio.dragHint') }}</span>
        </div>

        <!-- 已上传照片 -->
        <div v-if="regItems.length" class="mt-4 space-y-3">
          <div
            v-for="item in regItems"
            :key="item.id"
            class="overflow-hidden rounded-xl border bg-elevated/30"
            :class="item.faces.length ? 'border-default/70' : 'border-dashed border-default/60'"
          >
            <div class="relative">
              <img :src="item.url" class="block w-full h-auto" alt="">
              <!-- 人脸框（点击选择） -->
              <button
                v-for="(f, fi) in item.faces"
                :key="fi"
                class="absolute z-10 rounded-sm border-2 transition-all"
                :class="isFaceSelected(item.id, fi) ? 'border-primary bg-primary/15' : 'border-white/70 hover:border-primary'"
                :style="faceBoxStyle(item, f)"
                :title="`${t('image.faceStudio.selectFace')} ${fi + 1}`"
                @click="setFace(item.id, fi)"
              >
                <span class="absolute -top-5 left-0 rounded px-1 text-[10px] leading-4 text-white" :class="isFaceSelected(item.id, fi) ? 'bg-primary' : 'bg-black/60'">{{ fi + 1 }}</span>
              </button>
              <!-- 移除 -->
              <button
                v-if="!item.faces.length || true"
                class="absolute right-2 top-2 z-10 rounded-full bg-black/50 p-1 text-white transition hover:bg-error"
                :aria-label="t('image.faceStudio.removePhoto')"
                @click.stop="removeRegItem(item.id)"
              >
                <UIcon name="i-lucide-x" class="size-3.5" />
              </button>
            </div>

            <!-- 人脸候选 chips -->
            <div v-if="item.faces.length" class="flex flex-wrap items-center gap-1.5 px-3 py-2">
              <button
                v-for="(f, fi) in item.faces"
                :key="fi"
                class="rounded-full px-2.5 py-1 text-xs transition"
                :class="isFaceSelected(item.id, fi) ? 'bg-primary text-white' : 'bg-default/80 text-foreground hover:bg-default'"
                @click="setFace(item.id, fi)"
              >
                {{ t('image.faceStudio.faceSummary', { photo: regItems.indexOf(item) + 1, face: fi + 1, score: Math.round(f.score * 100) }) }}
              </button>
            </div>
            <div v-else class="px-3 py-2 text-sm text-warning">
              <UIcon name="i-lucide-alert-circle" class="size-4 align-[-2px]" /> {{ t('image.faceStudio.noFace') }}
            </div>

            <!-- 每张照片一个人名（可输入新名字 / 下拉复用已有人名） -->
            <div class="border-t border-default/60 px-3 py-2">
              <label class="mb-1 flex items-center gap-1 text-xs text-muted">
                <UIcon name="i-lucide-user-round" class="size-3.5" />
                {{ t('image.faceStudio.photo') }} {{ regItems.indexOf(item) + 1 }}
              </label>
              <UInput
                v-model="regNames[item.id]"
                icon="i-lucide-user"
                :list="`faceNames-${item.id}`"
                :placeholder="item.faces.length ? t('image.faceStudio.namePlaceholder') : '-'"
                :disabled="!item.faces.length"
                size="sm"
                @keyup.enter="registerAll"
              />
            </div>
          </div>

          <!-- 注册汇总 -->
          <div class="rounded-xl border border-default/70 bg-elevated/40 p-3">
            <p class="mb-2 text-xs text-muted">
              <UIcon name="i-lucide-info" class="size-3.5 align-[-2px]" /> {{ t('image.faceStudio.photosHint') }}
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <UButton
                block
                icon="i-lucide-user-plus"
                :label="t('image.faceStudio.regAll', { n: regItems.filter(i => i.faces.length).length })"
                color="primary"
                size="lg"
                :loading="analyzing"
                :disabled="analyzing || !regItems.some(i => i.faces.length) || !modelReady"
                @click="registerAll"
              />
            </div>
            <div class="mt-2 flex items-center justify-between">
              <UButton icon="i-lucide-eraser" color="neutral" variant="ghost" size="sm" :label="t('image.faceStudio.clearPhotos')" @click="clearRegPhotos" />
            </div>
          </div>
        </div>
        <!-- datalist：已有人名建议（可输入新名字后回车新增） -->
        <datalist v-for="item in regItems" :key="`dl-${item.id}`" :id="`faceNames-${item.id}`">
          <option v-for="n in nameSuggestions" :key="n" :value="n" />
        </datalist>
      </UCard>

      <!-- ============ 识别 ============ -->
      <UCard class="lg:col-span-2">
        <template #header>
          <div class="flex items-center gap-2 font-semibold text-highlighted">
            <span class="flex size-6 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-bold">2</span>
            {{ t('image.faceStudio.recognizeTitle') }}
          </div>
        </template>
        <p class="text-sm text-muted -mt-2">{{ t('image.faceStudio.recognizeHint') }}</p>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <UButton icon="i-lucide-images" :label="t('image.faceStudio.addPhotos')" color="secondary" variant="soft" @click="recInput?.click()" />
          <UButton
            :icon="recCamOpen ? 'i-lucide-camera-off' : 'i-lucide-video'"
            :label="recCamOpen ? t('image.faceStudio.closeCamera') : t('image.faceStudio.useCamera')"
            :color="recCamOpen ? 'error' : 'primary'"
            variant="soft"
            @click="recCamOpen = !recCamOpen"
          />
        </div>
        <input ref="recInput" type="file" accept="image/*" multiple class="hidden" @change="onRecognizeFiles">

        <!-- 摄像头拍照 -->
        <div v-if="recCamOpen" class="mt-3">
          <FaceCameraCapture live @capture="onCamRecCapture" @close="recCamOpen = false" />
        </div>

        <div
          v-if="!recCamOpen && !recItems.length && !analyzing"
          class="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors"
          :class="recDragging ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated/60'"
          @click="recInput?.click()"
          @dragover.prevent="recDragging = true"
          @dragleave="recDragging = false"
          @drop.prevent="onRecDrop"
        >
          <UIcon name="i-lucide-scan-face" class="size-7 text-primary" />
          <span class="text-sm font-medium">{{ t('image.faceStudio.recognizeBtn') }}</span>
        </div>

        <div v-if="recItems.length" class="mt-4 space-y-4">
          <div v-for="item in recItems" :key="item.id" class="space-y-2">
            <div class="relative overflow-hidden rounded-xl border border-default/70 bg-elevated/30">
              <img :src="item.url" class="block w-full h-auto" alt="">
              <div
                v-for="(h, hi) in item.hits"
                :key="hi"
                class="absolute z-10 rounded-sm border-2"
                :class="h.known ? 'border-success' : 'border-error'"
                :style="recBoxStyle(item, h)"
              >
                <span class="absolute -top-5 left-0 whitespace-nowrap rounded px-1 text-[10px] leading-4" :class="h.known ? 'bg-success text-white' : 'bg-error text-white'">
                  {{ h.known ? `${h.name} · ${Math.round(h.similarity * 100)}%` : t('image.faceStudio.notRecognized', { t: (0.5 * 100).toFixed(0) + '%' }) }}
                </span>
              </div>
              <button v-if="!item.hits.length" class="absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full bg-error text-white" :aria-label="t('image.faceStudio.noFace')">
                <UIcon name="i-lucide-user-x" class="size-5" />
              </button>
            </div>
            <!-- 命中明细 -->
            <div v-if="item.hits.length" class="space-y-1.5 rounded-lg border border-default/70 bg-elevated/30 p-2">
              <div v-for="(h, hi) in item.hits" :key="hi" class="flex items-center gap-2 text-sm">
                <span class="size-2 rounded-full" :class="h.known ? 'bg-success' : 'bg-error'" />
                <span class="w-24 truncate font-medium" :class="h.known ? 'text-success' : 'text-error'">
                  {{ h.known ? h.name : t('image.faceStudio.notRecognized', { t: '50%' }) }}
                </span>
                <UProgress :model-value="Math.round(h.similarity * 100)" :color="h.known ? 'success' : 'error'" class="flex-1" :max="100" />
                <span class="w-10 text-right tabular-nums text-muted">{{ Math.round(h.similarity * 100) }}%</span>
              </div>
            </div>
          </div>
          <UButton icon="i-lucide-eraser" color="neutral" variant="ghost" size="sm" :label="t('image.faceStudio.clearPhotos')" @click="clearRec" />
        </div>
        <div v-else class="mt-4 rounded-xl border border-dashed border-default/70 py-6 text-center text-sm text-muted">
          <UIcon name="i-lucide-scan-face" class="mb-1 block size-6 mx-auto" />
          {{ t('image.faceStudio.recognizeEmpty') }}
        </div>
      </UCard>
    </div>

    <!-- ============ 注册库 ============ -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 font-semibold text-highlighted">
            <UIcon name="i-lucide-database" class="size-4 text-primary" />
            {{ t('image.faceStudio.registeredList') }}
          </div>
          <UButton v-if="registry.length" icon="i-lucide-trash-2" color="error" variant="ghost" size="sm" :label="t('image.faceStudio.clearPhotos')" @click="clearRegistry(); refresh()" />
        </div>
      </template>
      <p class="text-xs text-muted -mt-2">{{ t('image.faceStudio.storageNote') }}</p>
      <div class="mt-3">
        <div v-if="registry.length" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div
            v-for="f in registry"
            :key="f.id"
            class="group relative flex items-center gap-3 rounded-xl border border-default/70 p-3 transition hover:border-primary/40 hover:shadow-sm"
          >
            <div class="relative">
              <img v-if="f.samples[0]?.thumb" :src="f.samples[0].thumb" class="size-12 rounded-lg object-cover border border-default/60" alt="">
              <span v-else class="flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary"><UIcon name="i-lucide-user" class="size-6" /></span>
              <span v-if="f.samples.length > 1" class="absolute -bottom-1 -right-1 rounded-full bg-primary px-1 text-[10px] leading-4 text-white">{{ f.samples.length }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium text-highlighted">{{ f.name }}</div>
              <div class="text-xs text-muted">{{ f.samples.length }} {{ t('image.faceStudio.sampleCount') }}</div>
            </div>
            <button
              class="rounded-md p-1.5 text-muted opacity-0 transition group-hover:opacity-100 hover:bg-error/10 hover:text-error"
              :aria-label="t('image.faceStudio.delete')"
              @click="removeFaceItem(f.id)"
            >
              <UIcon name="i-lucide-trash" class="size-4" />
            </button>
          </div>
        </div>
        <UAlert v-else color="neutral" variant="subtle" icon="i-lucide-database" :title="t('image.faceStudio.empty')" />
      </div>
    </UCard>

    <!-- 操作反馈浮层 -->
    <div v-if="flash" class="pointer-events-none fixed bottom-6 right-6 z-50" role="status">
      <div
        class="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg backdrop-blur"
        :class="flash.color === 'success' ? 'border-success/30 bg-success/10 text-success' : 'border-error/30 bg-error/10 text-error'"
      >
        <UIcon :name="flash.color === 'success' ? 'i-lucide-check-circle-2' : 'i-lucide-alert-circle'" class="size-5" />
        {{ flash.text }}
      </div>
    </div>
  </MediaDemoShell>
</template>