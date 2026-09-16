/**
 * Kokoro 引擎（本地 ONNX 合成，q8 约 92MB）——同时挂在能力页 tts（侧栏按引擎分组）
 * 与引擎页 kokoro（侧栏按任务族分组）。
 *
 * 源：app/pages/speech/tts.vue 的 kokoro 分支 + app/utils/kokoro.ts。
 * 模型加载、voice 表、合成封装（含 fetch 重定向到本地 /model/transformers/）全部复用
 * utils/kokoro.ts —— 这里只做「注册表适配」：把 tts.vue 里的 `engine.value === 'kokoro'`
 * 分支变成一条数据，让能力页与引擎页共享同一实现，而不是把页面代码复制第二遍。
 */
import type { AudioTool } from '~/utils/audio-tools'
import type { LocalizedParamOption, LocalizedText } from '~/utils/localized'
import { parseDownloadProgress } from '~/utils/audio-progress'
import { kokoroSynthesize, kokoroVoiceGroups, kokoroVoices, loadKokoroModel, type KokoroProgress } from '~/utils/kokoro'

/**
 * 分组选项类型。LocalizedParamOption 目前只建模了「平铺」，而 Nuxt UI Select 的分组是
 * 数组的数组 + 组标题 `{ type: 'label' }`（见 utils/params.ts 的 ParamOptions）。
 * 运行时形状与 tts.vue 的 voiceItems 完全一致，只是公共层的本地化类型还没跟上；
 * 故只在赋值处窄化一次，等 localized.ts 补上分组类型后即可删除该断言。
 */
type GroupedLocalizedOptions = ({ type: 'label', label: LocalizedText } | LocalizedParamOption)[][]

/**
 * voice 下拉：与 tts.vue 的 voiceItems 等价 —— 先按 kokoroVoiceGroups 的语言分组，
 * 组内列出该语言的 voice；空组丢弃（当前 9 个语言组都有 voice，保留过滤是为了与源页面同构，
 * 将来新增分组但 voice 表未同步时不会出现空标题）。
 * 选项文案不含语言（组标题已写明），与源页面一致。
 */
function buildVoiceOptions(): GroupedLocalizedOptions {
  const groups = kokoroVoiceGroups
    .map((g) => {
      const voices = kokoroVoices
        .filter(v => v.lang === g.lang)
        .map(v => ({
          label: {
            zh: `${v.name} · ${v.gender === 'female' ? '女' : '男'}`,
            en: `${v.name} · ${v.gender}`
          },
          value: v.id
        }))
      if (voices.length === 0) return null
      return [{ type: 'label' as const, label: { zh: g.label, en: g.label } }, ...voices]
    })
    .filter((g): g is NonNullable<typeof g> => g !== null)
  return groups
}

export const kokoroAudioTools: AudioTool[] = [
  {
    id: 'kokoro-synthesize',
    pages: ['kokoro', 'tts'],
    name: { zh: 'Kokoro 本地合成', en: 'Kokoro Local Synthesis' },
    description: {
      zh: 'onnx-community/Kokoro-82M-v1.0-ONNX（q8，约 92MB）浏览器内推理，不依赖服务端；首次需下载模型。',
      en: 'Runs onnx-community/Kokoro-82M-v1.0-ONNX (q8, ~92MB) fully in the browser, no server needed; first run downloads the model.'
    },
    kind: 'kokoro',
    // 能力页 tts 里 Kokoro 是「一种引擎」，引擎页 kokoro 里「合成」是「一个任务族」
    section: {
      'kokoro': 'speech.sections.synthesize',
      'tts': 'speech.sections.kokoro',
      '*': 'speech.sections.synthesize'
    },
    inputs: ['text'],
    params: [
      {
        key: 'voice',
        label: { zh: '发音人', en: 'Voice' },
        type: 'select',
        // 沿用 tts.vue kokoro 分支的默认值（中文女声）
        default: 'zf_xiaoxiao',
        options: buildVoiceOptions() as unknown as LocalizedParamOption[]
      },
      {
        key: 'speed',
        label: { zh: '语速', en: 'Speed' },
        type: 'slider',
        default: 1,
        min: 0.5,
        max: 2,
        step: 0.1,
        help: { zh: '合成语速，1.0 为正常。', en: 'Synthesis speed, 1.0 = normal.' }
      }
    ],
    run: async (ctx) => {
      const lang = ctx.lang
      const text = (ctx.text ?? '').trim()
      // 空文本直接短路：源页面把这种情况写成 error，注册表把「给用户的提示」统一放结果行
      if (!text) {
        return {
          info: [{
            label: lang === 'zh' ? '提示' : 'Notice',
            value: lang === 'zh' ? '请先输入要朗读的文本。' : 'Please type some text first.'
          }]
        }
      }

      // KokoroProgress（status/file/progress）→ playground 统一的 DownloadProgress，
      // 展示层因此不需要认识 Kokoro 的进度形状
      const onProgress = (p: KokoroProgress) => {
        const parsed = parseDownloadProgress(p)
        if (parsed) ctx.onProgress?.(parsed)
      }

      // 先显式加载模型：对应 tts.vue 的 ensureModel()，让下载进度在合成开始前就能上报
      // （kokoroSynthesize 内部会命中同一缓存实例，不会重复下载）
      await loadKokoroModel(onProgress)

      const voice = String(ctx.params.voice ?? 'zf_xiaoxiao')
      const speed = Number(ctx.params.speed) || 1
      const { blob, device, ms } = await kokoroSynthesize(text, voice, speed, onProgress)

      return {
        audio: { blob, filename: 'kokoro-tts.wav' },
        device,
        info: [
          { label: lang === 'zh' ? '后端' : 'Backend', value: device },
          { label: lang === 'zh' ? '耗时' : 'Elapsed', value: `${ms} ms` }
        ]
      }
    }
  }
]
