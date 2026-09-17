/**
 * 模型供给的两份「事实来源」：
 *
 * 1. app 侧 server/utils/model-sources.ts —— /model/* 在本地文件缺失时该 302 到哪；
 * 2. server/utils/model-fetch.mjs 的语音仓库清单 —— 预下载要拉什么、按什么顺序回退。
 *
 * 这两处一旦漂移，表现是「自托管部署后某些能力直接 404 / 白屏」，而本地开发完全正常。
 * 所以这里断言的是「回退表覆盖了哪些目录、以及**哪些目录故意没有回退**」。
 */
import { describe, expect, it } from 'vitest'
import {
  DOODLE_BASE,
  FACEAPI_BASES,
  MEDIAPIPE_BASE,
  MEDIAPIPE_MODELS,
  MEDIAPIPE_WASM,
  remoteUrlFor,
  TFJS_MOBILENET_BASE,
  TFJS_SPEECH_BASE
} from '../server/utils/model-sources'
import { SPEECH_REPOS, candidateUrls, sourceLabel } from '../server/utils/model-fetch.mjs'

describe('MediaPipe 回退表', () => {
  it('目标路径都在 mediapipe/models/ 下且互不重复', () => {
    const locals = Object.values(MEDIAPIPE_MODELS)
    for (const local of locals) {
      expect(local.startsWith('mediapipe/models/'), local).toBe(true)
    }
    expect(new Set(locals).size).toBe(locals.length)
  })

  it('三套 WASM 包的版本一致（与 npm 依赖同源）', () => {
    const versions = Object.values(MEDIAPIPE_WASM).map(v => v.version)
    expect(new Set(versions).size).toBe(1)
    expect(Object.keys(MEDIAPIPE_WASM).sort()).toEqual(['audio', 'text', 'vision'])
  })
})

describe('remoteUrlFor：本地路径 → 远程来源', () => {
  it('MediaPipe 模型回退到 Google 官方模型库', () => {
    const local = MEDIAPIPE_MODELS['face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite']
    expect(local).toBeTruthy()
    expect(remoteUrlFor(local!)).toBe(
      `${MEDIAPIPE_BASE}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`
    )
  })

  it('前导斜杠不影响命中（路由传进来可能带）', () => {
    expect(remoteUrlFor('/mediapipe/models/yamnet.tflite')).toBe(
      `${MEDIAPIPE_BASE}/audio_classifier/yamnet/float32/1/yamnet.tflite`
    )
  })

  it('MediaPipe WASM 回退到 jsdelivr 对应版本', () => {
    expect(remoteUrlFor('mediapipe/wasm/vision/vision_wasm_internal.js')).toBe(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/vision_wasm_internal.js'
    )
    expect(remoteUrlFor('mediapipe/wasm/text/x.wasm')).toContain('@mediapipe/tasks-text@1.0.1')
  })

  it('TF.js 两个模型各自回退（MobileNet 需带 tfjs-format 参数）', () => {
    expect(remoteUrlFor('tfjs/mobilenet/model.json')).toBe(
      `${TFJS_MOBILENET_BASE}/model.json?tfjs-format=file`
    )
    expect(remoteUrlFor('tfjs/speech-commands/metadata.json')).toBe(
      `${TFJS_SPEECH_BASE}/metadata.json`
    )
  })

  it('face-api 与 DoodleNet 回退到 jsdelivr', () => {
    expect(remoteUrlFor('faceapi/tiny_face_detector_model.bin')).toBe(
      `${FACEAPI_BASES[0]}/tiny_face_detector_model.bin`
    )
    expect(remoteUrlFor('doodle/model.json')).toBe(`${DOODLE_BASE}/model.json`)
  })

  it('未登记远程来源的目录返回 null —— 意味着这些目录缺失就是硬 404', () => {
    // 这四条是「故意没有回退」的约定：yolo 随仓库分发、transformers 由 transformers.js
    // 自己走 /api/hf、webllm 由 web-llm 自己按 CDN、vendor 来自 npm 同步。
    for (const rel of [
      'yolo/yolo26n.onnx',
      'transformers/Xenova/whisper-tiny/config.json',
      'webllm/libs/x.wasm',
      'vendor/pyodide/pyodide.asm.wasm',
      'something/unknown.bin',
      ''
    ]) {
      expect(remoteUrlFor(rel), rel).toBeNull()
    }
  })
})

describe('语音仓库清单（预下载清单）', () => {
  it('alias 与 repo id 都唯一（否则 models:fetch 会重复下载或覆盖）', () => {
    expect(new Set(SPEECH_REPOS.map(r => r.alias)).size).toBe(SPEECH_REPOS.length)
    expect(new Set(SPEECH_REPOS.map(r => r.id)).size).toBe(SPEECH_REPOS.length)
  })

  it('每一项都有 keep 过滤器与可读标签', () => {
    for (const repo of SPEECH_REPOS) {
      expect(typeof repo.keep, repo.alias).toBe('function')
      expect(repo.label.trim(), repo.alias).not.toBe('')
      expect(repo.id, repo.alias).toMatch(/^[\w.-]+\/[\w.-]+$/)
    }
  })

  it('语音侧的六类能力都在清单里（ASR 三档 / 情感 / 克隆 / 声纹 / 双向翻译）', () => {
    const aliases = SPEECH_REPOS.map(r => r.alias)
    for (const needed of [
      'whisper-tiny',
      'whisper-base',
      'whisper-small',
      'ser',
      'chatterbox',
      'voiceprint',
      'mt-zh-en',
      'mt-en-zh'
    ]) {
      expect(aliases, `清单缺 ${needed}`).toContain(needed)
    }
  })

  it('whisper 的 keep：onnx/ 下只留 4 个变体，其余文件（配置/分词器）全留', () => {
    const tiny = SPEECH_REPOS.find(r => r.alias === 'whisper-tiny')!

    // 采进这 4 个，其余 ONNX 变体不采（fp16 / with_past 之类体积可观且用不到）
    for (const kept of [
      'onnx/encoder_model.onnx',
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged.onnx',
      'onnx/decoder_model_merged_quantized.onnx'
    ]) {
      expect(tiny.keep(kept), kept).toBe(true)
    }
    for (const skipped of [
      'onnx/encoder_model_fp16.onnx',
      'onnx/decoder_with_past_model.onnx',
      'onnx/decoder_model_merged_fp16.onnx'
    ]) {
      expect(tiny.keep(skipped), skipped).toBe(false)
    }

    // onnx/ 之外一律保留：config / tokenizer / generation_config 缺一个都跑不起来
    expect(tiny.keep('config.json')).toBe(true)
    expect(tiny.keep('tokenizer.json')).toBe(true)
    expect(tiny.keep('generation_config.json')).toBe(true)
  })

  it('翻译模型（opus-mt）只留 q8 两件套，比 whisper 更省', () => {
    const mt = SPEECH_REPOS.find(r => r.alias === 'mt-zh-en')!
    expect(mt.keep('onnx/encoder_model_quantized.onnx')).toBe(true)
    expect(mt.keep('onnx/decoder_model_merged_quantized.onnx')).toBe(true)
    // fp32 版本与 whisper 同规则对比：Marian 连 fp32 也不要
    expect(mt.keep('onnx/encoder_model.onnx')).toBe(false)
    expect(mt.keep('onnx/decoder_model_merged.onnx')).toBe(false)
  })

  it('声纹 / 情感模型留 fp32 + q8 两个变体', () => {
    const sv = SPEECH_REPOS.find(r => r.alias === 'voiceprint')!
    expect(sv.keep('onnx/model.onnx')).toBe(true)
    expect(sv.keep('onnx/model_quantized.onnx')).toBe(true)
    expect(sv.keep('onnx/model_fp16.onnx')).toBe(false)
  })
})

describe('下载回退顺序', () => {
  it('candidateUrls 依次给 ModelScope → hf-mirror → huggingface', () => {
    const urls = candidateUrls('Xenova/whisper-tiny', 'config.json')
    expect(urls).toHaveLength(3)
    expect(urls[0]).toContain('modelscope.cn')
    expect(urls[1]).toContain('hf-mirror.com')
    expect(urls[2]).toContain('huggingface.co')
  })

  it('路径里的特殊字符按段编码，斜杠保留（否则 HF 取不到子目录文件）', () => {
    const [, mirror] = candidateUrls('Xenova/whisper-tiny', 'onnx/encoder model.onnx')
    expect(mirror).toContain('onnx/encoder%20model.onnx')
    expect(mirror).not.toContain('onnx%2F')
  })

  it('sourceLabel 能把三个来源认出来', () => {
    expect(sourceLabel('https://www.modelscope.cn/api/x')).toBe('ModelScope')
    expect(sourceLabel('https://hf-mirror.com/a/b')).toBe('hf-mirror')
    expect(sourceLabel('https://huggingface.co/a/b')).toBe('huggingface')
  })
})
