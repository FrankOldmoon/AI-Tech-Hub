<script setup lang="ts">
import { compressImageUnder, mediaExt, type ConvertHooks, type ConvertOptions, type ConvertTarget } from '~/utils/ffmpeg'
import { formatBytes } from '~/utils/format'

/**
 * 图片压缩：给定目标体积，自动压到线下（画质阶梯逐档试，见 ~/utils/ffmpeg 的 compressImageUnder）。
 * 与「图片格式转换」的分工：那边是挑格式+手动画质，这边是**按目标体积**自动找画质。
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'image-compress')!)

const targetKb = ref(200)
const maxDimension = ref(0)
const steps = ref<Array<{ quality: number, size: number, reached: boolean }>>([])
const qualityUsed = ref(0)
const attempts = ref(0)
const reached = ref(true)

const { file, sourceUrl, sourceSize, sourceMeta, target, converting, log, error, outUrl, outName, outSize, delta, select, reset, convert, download } = useMediaConvert({
  defaultTarget: 'webp',
  buildOptions: () => ({ maxDimension: maxDimension.value || undefined }),
  run: async (input: File, format: ConvertTarget, hooks: ConvertHooks, options: ConvertOptions) => {
    steps.value = []
    const out = await compressImageUnder(input, targetKb.value * 1024, {
      format: format === 'jpg' ? 'jpg' : 'webp',
      maxDimension: options.maxDimension,
      hooks,
      onStep: (s) => { steps.value = [...steps.value, s] }
    })
    qualityUsed.value = out.quality
    attempts.value = out.attempts
    reached.value = out.reached
    return { blob: out.blob, name: out.name }
  }
})

const targetOptions = computed(() => [
  { label: t('convert.targetWebp'), value: 'webp' },
  { label: t('convert.targetJpg'), value: 'jpg' }
])
const sizeOptions = computed(() => [
  { label: '100 KB', value: 100 },
  { label: '200 KB', value: 200 },
  { label: '500 KB', value: 500 },
  { label: '1 MB', value: 1024 }
])
const dimensionOptions = computed(() => [
  { label: t('convert.dimOriginal'), value: 0 },
  { label: '2560 px', value: 2560 },
  { label: '1920 px', value: 1920 },
  { label: '1280 px', value: 1280 }
])

/** 读完像素尺寸填进标题行；读不出来（罕见格式）就只显示容器名 */
async function readMeta(f: File) {
  try {
    const bmp = await createImageBitmap(f)
    sourceMeta.value = `${mediaExt(f).toUpperCase()} · ${bmp.width} × ${bmp.height}`
    bmp.close()
  } catch {
    sourceMeta.value = mediaExt(f).toUpperCase()
  }
}

function onSelect(f: File) {
  steps.value = []
  qualityUsed.value = 0
  attempts.value = 0
  reached.value = true
  select(f)
  void readMeta(f)
}
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-6">
      <MediaInput
        v-if="!file"
        accept="image/*"
        :hint="t('imageCompress.hint')"
        @select="onSelect"
      />

      <div
        v-else
        class="grid gap-6 md:grid-cols-2"
      >
        <div class="space-y-3">
          <p class="text-sm font-medium text-highlighted">
            {{ t('convert.input') }}
          </p>
          <img
            :src="sourceUrl"
            :alt="file.name"
            class="w-full max-h-80 rounded-lg bg-elevated object-contain"
          >
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span class="font-mono">{{ file.name }}</span>
            <span>{{ formatBytes(sourceSize) }}</span>
            <span v-if="sourceMeta">{{ sourceMeta }}</span>
          </div>
          <UButton
            icon="i-lucide-refresh-cw"
            :label="t('convert.again')"
            color="neutral"
            variant="subtle"
            :disabled="converting"
            @click="reset"
          />
        </div>

        <div class="space-y-4">
          <div class="space-y-2">
            <p class="text-xs text-muted">
              {{ t('compress.targetSize') }}
            </p>
            <USelect
              v-model="targetKb"
              :items="sizeOptions"
              class="w-full"
              :disabled="converting"
            />
          </div>
          <div class="space-y-2">
            <p class="text-xs text-muted">
              {{ t('convert.target') }}
            </p>
            <USelect
              v-model="target"
              :items="targetOptions"
              class="w-full"
              :disabled="converting"
            />
          </div>
          <div class="space-y-2">
            <p class="text-xs text-muted">
              {{ t('compress.maxDimension') }}
            </p>
            <USelect
              v-model="maxDimension"
              :items="dimensionOptions"
              class="w-full"
              :disabled="converting"
            />
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <UButton
              icon="i-lucide-repeat"
              :label="converting ? t('convert.converting') : t('compress.start')"
              color="primary"
              :loading="converting"
              @click="convert"
            />
            <UButton
              v-if="outUrl"
              icon="i-lucide-download"
              :label="t('convert.download')"
              color="neutral"
              variant="subtle"
              @click="download"
            />
          </div>
          <p class="text-xs text-muted">
            {{ t('imageCompress.note') }}
          </p>
          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-alert-triangle"
            :title="error"
          />

          <div
            v-if="steps.length"
            class="space-y-1 rounded-lg bg-elevated/60 p-2 text-xs text-muted"
          >
            <p
              v-for="s in steps"
              :key="s.quality"
              class="tabular-nums"
            >
              {{ t('compress.qualityStep', { q: s.quality, size: formatBytes(s.size) }) }}
              <span v-if="s.reached">✅</span>
            </p>
          </div>

          <div
            v-if="outUrl"
            class="space-y-3 rounded-xl border border-default p-3"
          >
            <p class="text-sm font-medium text-highlighted">
              {{ t('convert.result') }}
            </p>
            <img
              :src="outUrl"
              :alt="outName"
              class="w-full max-h-56 rounded-lg bg-elevated object-contain"
            >
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              <span class="font-mono">{{ outName }}</span>
              <span>{{ formatBytes(outSize) }}</span>
              <span
                v-if="delta !== null"
                :class="delta <= 0 ? 'text-primary' : ''"
              >
                {{ delta <= 0 ? t('convert.smaller', { n: Math.abs(delta) }) : t('convert.larger', { n: delta }) }}
              </span>
            </div>
            <p class="text-xs text-muted">
              {{ t('compress.used', { q: qualityUsed, n: attempts }) }}
            </p>
            <p
              v-if="!reached"
              class="text-xs text-amber-600"
            >
              {{ t('compress.notReached') }}
            </p>
          </div>

          <pre
            v-if="log"
            class="max-h-24 overflow-auto rounded-lg bg-elevated/60 p-2 text-xs text-muted"
          >{{ log }}</pre>
        </div>
      </div>
    </div>
  </MediaDemoShell>
</template>
