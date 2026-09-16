<script setup lang="ts">
import { mediaExt } from '~/utils/ffmpeg'
import { formatBytes } from '~/utils/format'

/**
 * 图片格式转换：导入（或拖入）一张图 → 转成 PNG / JPEG / WebP / BMP → 对比体积并下载。
 * 转换在浏览器内由 ffmpeg.wasm 完成（见 ~/utils/ffmpeg），文件不上传。
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'image-convert')!)

const quality = ref(85)
const { file, sourceUrl, sourceSize, sourceMeta, target, converting, ratio, log, error, outUrl, outName, outSize, delta, select, reset, convert, download } = useMediaConvert({
  defaultTarget: 'webp',
  // 有损格式才需要「画质」参数；PNG/BMP 传了也没用
  buildOptions: format => (format === 'jpg' || format === 'webp' ? { imageQuality: quality.value } : {})
})

/** 只有有损格式才给「画质」滑块 */
const lossy = computed(() => target.value === 'jpg' || target.value === 'webp')

const targetOptions = computed(() => [
  { label: t('convert.targetPng'), value: 'png' },
  { label: t('convert.targetJpg'), value: 'jpg' },
  { label: t('convert.targetWebp'), value: 'webp' },
  { label: t('convert.targetBmp'), value: 'bmp' }
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
        :hint="t('imageConvert.hint')"
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
          <p class="text-sm font-medium text-highlighted">
            {{ t('convert.target') }}
          </p>
          <USelect
            v-model="target"
            :items="targetOptions"
            class="w-full"
            :disabled="converting"
          />
          <div
            v-if="lossy"
            class="space-y-2"
          >
            <div class="flex items-center justify-between text-xs text-muted">
              <span>{{ t('convert.quality') }}</span>
              <span class="tabular-nums">{{ quality }}</span>
            </div>
            <USlider
              v-model="quality"
              :min="20"
              :max="100"
              :step="5"
              :disabled="converting"
            />
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              icon="i-lucide-repeat"
              :label="converting ? t('convert.converting') : t('convert.start')"
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
          <UProgress
            v-if="converting"
            :model-value="Math.round(ratio * 100)"
            size="sm"
          />
          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-alert-triangle"
            :title="error"
          />

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
          </div>

          <p class="text-xs text-muted">
            {{ t('convert.hint') }}
          </p>
          <pre
            v-if="log"
            class="max-h-24 overflow-auto rounded-lg bg-elevated/60 p-2 text-xs text-muted"
          >{{ log }}</pre>
        </div>
      </div>
    </div>
  </MediaDemoShell>
</template>
