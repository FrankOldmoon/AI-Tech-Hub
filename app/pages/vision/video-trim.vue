<script setup lang="ts">
import { formatBytes, formatTime, formatTimeMs } from '~/utils/format'

/**
 * 视频裁剪：按起止时间截取一段（起止可拖、可预览选区）。
 * 输出固定 MP4（H.264 + AAC）：截取必须重编码才能帧级精确，顺带统一容器格式。
 */
const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('vision', 'video-trim')!)

const previewRef = ref<HTMLVideoElement>()
/** 源视频总长（秒），loadedmetadata 后填 */
const duration = ref(0)
const start = ref(0)
const end = ref(0)
const previewing = ref(false)

const { file, sourceUrl, sourceSize, sourceMeta, converting, ratio, log, error, outUrl, outName, outSize, delta, select, reset, convert, download } = useMediaConvert({
  defaultTarget: 'mp4',
  buildOptions: () => ({ startTime: start.value, endTime: end.value })
})

const selected = computed(() => Math.max(0, end.value - start.value))
const tooShort = computed(() => selected.value < 0.2)

const startMax = computed(() => Math.max(0, end.value - 0.2))
const endMin = computed(() => Math.min(duration.value, start.value + 0.2))

function onMeta(e: Event) {
  const el = e.target as HTMLVideoElement
  duration.value = Number.isFinite(el.duration) ? el.duration : 0
  start.value = 0
  end.value = duration.value
  const dims = el.videoWidth ? `${el.videoWidth} × ${el.videoHeight} · ` : ''
  sourceMeta.value = `${dims}${formatTime(duration.value)}`
}

/** 预览选区：跳到起点播放，到终点自动暂停（不循环，免得看不出边界） */
function previewSelection() {
  const v = previewRef.value
  if (!v) return
  v.currentTime = start.value
  previewing.value = true
  void v.play()
}

function onTimeUpdate(e: Event) {
  const v = e.target as HTMLVideoElement
  if (previewing.value && v.currentTime >= end.value) {
    v.pause()
    previewing.value = false
  }
}

function onSelect(f: File) {
  duration.value = 0
  start.value = 0
  end.value = 0
  previewing.value = false
  select(f)
}
</script>

<template>
  <MediaDemoShell :demo="demo">
    <div class="space-y-6">
      <MediaInput
        v-if="!file"
        accept="video/*"
        :hint="t('videoTrim.hint')"
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
          <video
            ref="previewRef"
            :src="sourceUrl"
            controls
            class="w-full max-h-80 rounded-lg bg-black"
            @loadedmetadata="onMeta"
            @timeupdate="onTimeUpdate"
          />
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
          <p class="text-xs text-muted">
            {{ t('videoTrim.note') }}
          </p>

          <div class="space-y-3">
            <div class="space-y-2">
              <div class="flex items-center justify-between text-xs text-muted">
                <span>{{ t('trim.startLabel') }}</span>
                <span class="tabular-nums">{{ formatTimeMs(start) }}</span>
              </div>
              <USlider
                v-model="start"
                :min="0"
                :max="startMax"
                :step="0.1"
                :disabled="converting || !duration"
              />
            </div>
            <div class="space-y-2">
              <div class="flex items-center justify-between text-xs text-muted">
                <span>{{ t('trim.endLabel') }}</span>
                <span class="tabular-nums">{{ formatTimeMs(end) }}</span>
              </div>
              <USlider
                v-model="end"
                :min="endMin"
                :max="duration || 0"
                :step="0.1"
                :disabled="converting || !duration"
              />
            </div>
          </div>

          <p class="text-xs text-muted">
            {{ t('trim.selection', { len: formatTimeMs(selected), total: formatTimeMs(duration) }) }}
          </p>

          <div class="flex flex-wrap items-center gap-2">
            <UButton
              icon="i-lucide-play"
              :label="t('trim.preview')"
              color="neutral"
              variant="subtle"
              :disabled="converting || !duration || tooShort"
              @click="previewSelection"
            />
            <UButton
              icon="i-lucide-scissors"
              :label="converting ? t('convert.converting') : t('trim.trim')"
              color="primary"
              :loading="converting"
              :disabled="!duration || tooShort"
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
            <video
              :src="outUrl"
              controls
              class="w-full max-h-72 rounded-lg bg-black"
            />
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
