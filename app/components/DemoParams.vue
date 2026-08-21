<script setup lang="ts">
import type { ParamSpec } from '~/utils/params'

/**
 * 可调参数面板：根据 specs 渲染 slider / number / select / switch / text 控件
 * 通过 v-model 双向绑定 values 对象
 */
const props = withDefaults(defineProps<{
  specs: ParamSpec[]
  modelValue: Record<string, number | string | boolean>
  /** 是否处于运行态（运行时禁用标记了 disableWhileRunning 的参数） */
  running?: boolean
  /** 附加禁用参数键（如 resize 保持宽高比时禁用 height） */
  disabledKeys?: string[]
  /** 折叠面板标题 */
  title?: string
}>(), {
  running: false,
  disabledKeys: () => [],
  title: undefined
})

const emit = defineEmits<{ 'update:modelValue': [Record<string, number | string | boolean>] }>()

const { t } = useI18n()
// 默认展开参数面板，方便课堂直接调参
const isOpen = ref(true)

function update(key: string, val: number | string | boolean) {
  emit('update:modelValue', { ...props.modelValue, [key]: val })
}

function isDisabled(spec: ParamSpec): boolean {
  if (props.disabledKeys?.includes(spec.key)) return true
  if (spec.disableWhileRunning === false) return false
  return props.running
}
</script>

<template>
  <div class="border border-default rounded-lg overflow-hidden">
    <UCollapsible v-model:open="isOpen">
      <template #default="{ open }">
        <button
          type="button"
          class="flex items-center gap-2 px-4 py-3 text-sm font-medium text-highlighted w-full cursor-pointer hover:bg-elevated/40 transition-colors"
        >
          <UIcon name="i-lucide-sliders-horizontal" class="size-4 text-primary" />
          <span>{{ title || t('params.title') }}</span>
          <UIcon
            name="i-lucide-chevron-down"
            class="size-4 ms-auto text-muted transition-transform"
            :class="open ? 'rotate-180' : ''"
          />
        </button>
      </template>
      <template #content>
        <div class="px-4 pb-4 grid sm:grid-cols-2 gap-x-6 gap-y-4 border-t border-default pt-4">
          <template v-for="spec in specs" :key="spec.key">
            <!-- slider -->
            <div v-if="spec.type === 'slider'">
              <label class="block text-sm font-medium text-muted mb-1">{{ spec.label }}</label>
              <SpringSlider
                :model-value="Number(modelValue[spec.key])"
                :min="spec.min"
                :max="spec.max"
                :step="spec.step"
                :disabled="isDisabled(spec)"
                :precision="spec.step && spec.step < 1 ? 2 : 0"
                :label="spec.label"
                @update:model-value="update(spec.key, $event ?? spec.default)"
              />
              <p v-if="spec.help" class="mt-1 text-xs text-dimmed">{{ spec.help }}</p>
            </div>

            <!-- number -->
            <div v-else-if="spec.type === 'number'">
              <label class="block text-sm font-medium text-muted mb-1">{{ spec.label }}</label>
              <UInput
                type="number"
                :model-value="Number(modelValue[spec.key])"
                :min="spec.min"
                :max="spec.max"
                :step="spec.step"
                :disabled="isDisabled(spec)"
                class="w-full"
                @update:model-value="update(spec.key, Number($event))"
              />
              <p v-if="spec.help" class="mt-1 text-xs text-dimmed">{{ spec.help }}</p>
            </div>

            <!-- select -->
            <div v-else-if="spec.type === 'select'">
              <label class="block text-sm font-medium text-muted mb-1">{{ spec.label }}</label>
              <USelect
                :model-value="modelValue[spec.key]"
                :items="spec.options || []"
                :disabled="isDisabled(spec)"
                class="w-full"
                @update:model-value="update(spec.key, $event)"
              />
              <p v-if="spec.help" class="mt-1 text-xs text-dimmed">{{ spec.help }}</p>
            </div>

            <!-- switch -->
            <div v-else-if="spec.type === 'switch'">
              <label class="flex items-center justify-between text-sm font-medium text-muted">
                <span>{{ spec.label }}</span>
                <USwitch
                  :model-value="Boolean(modelValue[spec.key])"
                  :disabled="isDisabled(spec)"
                  @update:model-value="update(spec.key, $event)"
                />
              </label>
              <p v-if="spec.help" class="mt-1 text-xs text-dimmed">{{ spec.help }}</p>
            </div>

            <!-- text -->
            <div v-else-if="spec.type === 'text'" class="sm:col-span-2">
              <label class="block text-sm font-medium text-muted mb-1">{{ spec.label }}</label>
              <UTextarea
                :model-value="String(modelValue[spec.key])"
                :rows="2"
                :disabled="isDisabled(spec)"
                class="w-full"
                @update:model-value="update(spec.key, String($event))"
              />
              <p v-if="spec.help" class="mt-1 text-xs text-dimmed">{{ spec.help }}</p>
            </div>
          </template>
        </div>
      </template>
    </UCollapsible>
  </div>
</template>
