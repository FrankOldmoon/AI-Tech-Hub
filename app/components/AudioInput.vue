<script setup lang="ts">
/**
 * 通用音频输入组件：按需提供「上传文件 / 麦克风实时 / 录音」三种输入形态。
 *
 * 只做展示与意图上报，不自己持有状态 —— 状态来自配套的 useAudioInput()，
 * 页面据此仍然完全掌控采集与解码，被消掉的只是各页逐行重复的这段 UI：
 * 「来源切换 + 隐藏 input + 上传按钮 + 示例按钮 + 开始/停止按钮 + 播放器」。
 *
 * 事件约定：
 * - select(File)：选了本地文件（上传或录音产物），页面交给 input.setFile 即可；
 * - sample(url) ：点了某个示例，页面调 input.useSample(url)；
 * - start / stop：要开始或结束采集（麦克风实时 / 录音由调用方决定语义）。
 */
import type { AudioInputMode } from '~/composables/useAudioInput'
import { AUDIO_ACCEPT } from '~/utils/audio'

const props = withDefaults(defineProps<{
  /** 当前输入形态（v-model:mode） */
  mode: AudioInputMode
  /** 展示哪几种形态，顺序即按钮顺序；默认「上传文件 + 麦克风」 */
  modes?: AudioInputMode[]
  /** 示例音频（label + url） */
  samples?: Array<{ label: string, url: string }>
  /** 已选文件名，显示在上传按钮上 */
  fileName?: string
  /** 上传按钮文案；不传则用「上传音频」 */
  uploadLabel?: string
  /** 当前音频的可播放 URL；为空则不渲染播放器 */
  fileUrl?: string
  /** 文件选择器的 accept；默认音频全集 */
  accept?: string
  /** 整个输入区禁用（例如正在跑大模型） */
  disabled?: boolean
  /** 采集进行中（麦克风 / 录音） */
  active?: boolean
  /** 采集已进行的秒数，>0 时附在停止按钮上 */
  seconds?: number
  /** 开始 / 停止按钮文案；不传则用「开始录音 / 停止录音」 */
  startLabel?: string
  stopLabel?: string
}>(), {
  modes: () => ['file', 'mic'] as AudioInputMode[],
  samples: () => [] as Array<{ label: string, url: string }>,
  accept: AUDIO_ACCEPT
})

const emit = defineEmits<{
  'update:mode': [value: AudioInputMode]
  'select': [file: File]
  'sample': [url: string]
  'start': []
  'stop': []
}>()

const { t } = useI18n()

/** 形态 → 按钮文案与图标（文案 key 固定，便于 i18n 检查器静态追踪） */
const MODE_META: Record<AudioInputMode, { label: () => string, icon: string }> = {
  file: { label: () => t('speech.sourceFile'), icon: 'i-lucide-file-audio' },
  mic: { label: () => t('speech.sourceMic'), icon: 'i-lucide-mic' },
  record: { label: () => t('speech.sourceRecord'), icon: 'i-lucide-circle-dot' }
}

const toggleItems = computed(() => props.modes.map(key => ({
  key,
  label: MODE_META[key].label(),
  icon: MODE_META[key].icon
})))

const startText = computed(() => props.startLabel ?? t('speech.recordStart'))
const stopText = computed(() => {
  const base = props.stopLabel ?? t('speech.recordStop')
  return props.seconds && props.seconds > 0 ? `${base} (${props.seconds}s)` : base
})

const fileInput = ref<HTMLInputElement>()

function pickFile() {
  fileInput.value?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const picked = input.files?.[0]
  if (picked) emit('select', picked)
  // 允许连续选同一个文件（否则第二次不触发 change）
  input.value = ''
}
</script>

<template>
  <div class="space-y-3">
    <!-- 来源切换（只有一种形态时不显示） -->
    <AudioSourceToggle
      v-if="modes.length > 1"
      :model-value="mode"
      :items="toggleItems"
      :disabled="disabled"
      @update:model-value="emit('update:mode', $event)"
    />

    <slot
      name="hint"
      :mode="mode"
    />

    <!-- 上传文件 / 示例 -->
    <template v-if="mode === 'file'">
      <input
        ref="fileInput"
        type="file"
        :accept="accept"
        class="hidden"
        @change="onFileChange"
      >
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          icon="i-lucide-upload"
          :label="fileName || uploadLabel || t('speech.uploadAudio')"
          variant="outline"
          :disabled="disabled"
          @click="pickFile"
        />
        <UButton
          v-for="s in samples"
          :key="s.url"
          icon="i-lucide-flask-conical"
          :label="s.label"
          variant="soft"
          :disabled="disabled"
          @click="emit('sample', s.url)"
        />
      </div>
    </template>

    <!-- 麦克风实时 / 录音 -->
    <div
      v-else
      class="flex flex-wrap items-center gap-2"
    >
      <UButton
        v-if="!active"
        icon="i-lucide-mic"
        :label="startText"
        color="primary"
        variant="soft"
        :disabled="disabled"
        @click="emit('start')"
      />
      <UButton
        v-else
        icon="i-lucide-square"
        :label="stopText"
        color="error"
        variant="subtle"
        @click="emit('stop')"
      />
      <slot
        name="status"
        :mode="mode"
      />
    </div>

    <slot
      name="actions"
      :mode="mode"
    />

    <!-- 播放器：麦克风实时（逐帧分析）模式下没有可播的产物，其余模式有就显示 -->
    <audio
      v-if="fileUrl && mode !== 'mic'"
      :src="fileUrl"
      controls
      class="w-full max-w-md"
    />

    <slot
      name="extra"
      :mode="mode"
    />
  </div>
</template>
