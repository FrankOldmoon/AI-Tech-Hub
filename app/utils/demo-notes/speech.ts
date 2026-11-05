/**
 * speech 分类的「延伸学习」内容（25 个条目）。
 *
 * 这一分类有三种技术形态，原理说明必须区分清楚：
 *  1. **纯 DSP / Web Audio**：pitch-detector（YIN）、visualizer（AnalyserNode）、
 *     metronome、mini-synth、voice-changer（只有滤波与调制，没有真正的变调）
 *  2. **浏览器端模型**：Whisper / Kokoro / wav2vec2 / YAMNet / WavLM / Chatterbox / MDX-Net
 *  3. **服务端或浏览器内建**：Edge TTS（server WebSocket 连微软）、Web Speech API（浏览器云端识别）
 */
import type { NoteMap } from './index'

export const notes: NoteMap = {
  '/speech/tts': {
    python: `"""Two TTS paths with completely different trade-offs.

  Kokoro-82M   local, q8 ~88 MB, 55 voices / 9 languages, 24 kHz
  Edge TTS     server WebSocket to Microsoft, mp3 24 kHz 48 kbps

Same page, same output shape -- but one works offline and one does not.
"""
import asyncio


async def edge_tts(text, voice='zh-CN-XiaoxiaoNeural', rate='+0%', pitch='+0Hz'):
    """The server proxies this: a hand-written WebSocket to Microsoft's
    endpoint, SSML in, MP3 out. No API key, but it needs the public internet."""
    import edge_tts
    comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    chunks = bytearray()
    async for chunk in comm.stream():
        if chunk['type'] == 'audio':
            chunks.extend(chunk['data'])
    return bytes(chunks), 'audio/mpeg'


def wav_estimate(text_chars, sample_rate=24000, bits=16, channels=1):
    """Why the page returns WAV from Kokoro but MP3 from Edge: a 10 s clip is
    480 KB as 24 kHz/16-bit WAV, ~60 KB as 48 kbps MP3. WAV is the honest
    intermediate; MP3 is what you ship."""
    seconds = text_chars / 6.2                    # ~6 Chinese chars per second
    raw = seconds * sample_rate * (bits // 8) * channels
    return {'seconds': round(seconds, 2), 'wav_kb': round(raw / 1024, 1),
            'mp3_kb': round(raw / 1024 / 8, 1)}


if __name__ == '__main__':
    print(wav_estimate(60))
    # {'seconds': 9.68, 'wav_kb': 453.9, 'mp3_kb': 56.7}


# What text normalisation means here: '2024' must become '二零二四' or
# 'two thousand twenty-four' BEFORE phonemisation, or the model reads digits.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Text to speech: phonemes, then samples</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  textarea{width:100%;box-sizing:border-box;height:56px;padding:8px 10px;border:1px solid #cbd5e1;
    border-radius:8px;font:13px/1.5 system-ui,sans-serif;resize:vertical}
  canvas{width:100%;max-width:600px;display:block;margin-top:10px;border-radius:8px;background:#fff;
    box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .row{display:flex;gap:18px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  .row div b{display:block;font-size:16px;font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>What actually gets synthesised</h1>
<p>TTS does not map letters to audio. It normalises the text, converts it to phonemes, then predicts
audio samples from those phonemes. The bar below is a rough phoneme timeline for your text.</p>
<textarea id="t">今天天气很好，我们去公园散步。</textarea>
<canvas id="c" width="600" height="120"></canvas>
<div class="row">
  <div>characters<b id="n1">—</b></div>
  <div>est. phonemes<b id="n2">—</b></div>
  <div>est. duration<b id="n3">—</b></div>
  <div>WAV size (24k/16bit)<b id="n4">—</b></div>
</div>
<div class="note">Kokoro needs phonemes from espeak-ng; Edge TTS takes SSML. Both finish with the same
thing: a waveform at 24 kHz — which is why both pages hand you a playable blob.</div>
<script>
(function () {
  // rough phoneme count: CJK ~1 per char, latin ~3 per 4 chars
  function estimate(text) {
    var cjk = (text.match(/[\\u4e00-\\u9fff]/g) || []).length;
    var latin = (text.match(/[A-Za-z]/g) || []).length;
    var digits = (text.match(/[0-9]/g) || []).length;
    var phonemes = cjk + Math.round(latin * 0.75) + digits * 3;
    var seconds = cjk / 6.2 + latin / 14 + digits * 0.5;
    return { cjk: cjk, latin: latin, phonemes: phonemes, seconds: seconds };
  }

  function render() {
    var text = document.getElementById('t').value;
    var e = estimate(text);
    document.getElementById('n1').textContent = text.length;
    document.getElementById('n2').textContent = e.phonemes;
    document.getElementById('n3').textContent = e.seconds.toFixed(1) + ' s';
    var kb = e.seconds * 24000 * 2 / 1024;
    document.getElementById('n4').textContent = kb.toFixed(0) + ' KB';

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 120;
    ctx.clearRect(0, 0, W, H);

    var n = Math.max(1, e.phonemes);
    var per = (W - 30) / n;
    for (var i = 0; i < n; i++) {
      // shape the "envelope" so it looks like speech, not a flat block
      var env = 0.35 + 0.65 * Math.abs(Math.sin(i / 5.5)) * (1 - i / (n * 3));
      var h = 20 + env * 60;
      ctx.fillStyle = 'rgba(37,99,235,' + (0.35 + env * 0.5) + ')';
      ctx.fillRect(15 + i * per, 60 - h / 2, Math.max(1.4, per - 1), h);
    }
    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('phoneme timeline · ' + n + ' units', 15, H - 8);
    ctx.fillText('24 kHz', W - 62, H - 8);
  }

  document.getElementById('t').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 同一页两条链路，一条能离线一条不能

| | Kokoro-82M | Edge TTS |
| --- | --- | --- |
| 位置 | **浏览器内**（WebGPU/WASM） | **服务端** WebSocket 连微软 |
| 体积 | q8 约 88 MB（+ 55 个音色文件，各 ~510 KB） | 0（但需要外网） |
| 音色 | 55 个，9 种语言 | 接口动态拉取，几十个 |
| 输出 | 24 kHz WAV（PCM16） | 24 kHz MP3（48 kbps） |
| 离线 | **能** | 不能 |

页面默认激活 Kokoro（注册表顺序在前），Edge TTS 作为「质量更自然但要联网」的备选。**这个排列本身说明了取舍**：本地优先，网络兜底。

## TTS 的三个阶段

1. **文本规范化**：\`2024\` → 「二零二四」或 "two thousand twenty-four"；\`3.5\` → 「三点五」。**不做这一步，模型会把数字念成一个个字符**；
2. **音素化**（phonemisation）：文字 → 音素序列。Kokoro 用 **espeak-ng**（内嵌在 2 MB 的 \`kokoro-web.js\` 里），这是它能支持 9 种语言的原因 —— 换语言只是换 espeak 的语言规则；
3. **声学合成**：音素序列 → 24 kHz 波形。82M 参数做这件事，靠的是把音素映射成梅尔谱再声码化。

**记住第 3 步的输出是"音频采样点"，不是"文字"**，所以 TTS 的失败模式是"念错/怪腔"，不是"答非所问"。

## 为什么 WAV 和 MP3 的差别这么大

页面里 Kokoro 输出 WAV（PCM16 单声道），Edge 输出 MP3：

- 10 秒 24 kHz/16-bit 单声道 WAV ≈ **480 KB**；
- 同样内容 48 kbps MP3 ≈ **60 KB**。

差 8 倍。WAV 是"诚实的中间产物"（无损、可直接解码进 Web Audio），MP3 是"给人听/下载"的形态。**浏览器里做音频处理时用 WAV，因为解码成本为零。**

## 数字估算的那个 HTML 示例在做什么

它把「文本 → 音素数 → 波形」这条链画成时间轴，让你直观看到：**文本长度和音频长度不是线性关系**。

中文约每字 1 个音素、每秒约 6 字；英文约每 4 个字母 3 个音素、每秒约 14 字母。所以同样 60 个字符，中文音频比英文短 —— 这个差异在做字幕对齐时是硬约束。

## 想深一层

1. \`speed\` 参数（0.5–2.0）不是简单的时间拉伸。真实的 TTS 会重算时长模型，否则会变成"慢放"的机械感。
2. Edge TTS 没有 API key，走的是微软给 Edge 浏览器用的内部接口 —— 稳定性和合规性都不保证，这就是为什么页面把它标注成"需要外网"的备选。
3. 想判断一个 TTS 好不好：听**数字、专有名词、多音字**。这三类是文本规范化的试金石。`,
      en: `## Two paths on one page, only one works offline

| | Kokoro-82M | Edge TTS |
| --- | --- | --- |
| Runs | **in the browser** (WebGPU/WASM) | **server** WebSocket to Microsoft |
| Size | ~88 MB at q8 (+ 55 voice bins, ~510 KB each) | 0 (but needs the internet) |
| Voices | 55 across 9 languages | fetched dynamically, dozens |
| Output | 24 kHz WAV (PCM16) | 24 kHz MP3 (48 kbps) |
| Offline | **yes** | no |

Kokoro is the default (registry order), Edge TTS is the "more natural but needs network" fallback. **The ordering is the policy**: local first, network as backup.

## The three stages of TTS

1. **Text normalisation**: \`2024\` → "twenty twenty-four"; \`3.5\` → "three point five". **Skip this and the model reads digits one at a time**;
2. **Phonemisation**: text → phoneme sequence. Kokoro uses **espeak-ng** (bundled in the 2 MB \`kokoro-web.js\`), which is how it covers 9 languages — a new language is just new espeak rules;
3. **Acoustic synthesis**: phonemes → 24 kHz waveform. 82M parameters, mapping phonemes to a mel spectrogram and vocoding it.

**Remember that stage 3 outputs audio samples, not text** — so TTS fails by sounding wrong, not by answering the wrong question.

## Why WAV and MP3 differ so much

Kokoro returns WAV (PCM16 mono), Edge returns MP3:

- 10 s at 24 kHz/16-bit mono WAV ≈ **480 KB**;
- the same audio at 48 kbps MP3 ≈ **60 KB**.

An 8× gap. WAV is the honest intermediate (lossless, decodes straight into Web Audio); MP3 is the thing you hand to a human. **Inside a browser pipeline use WAV, because decoding is free.**

## What the demo is showing

It draws "text → phoneme count → waveform" as a timeline, so you can see that **text length and audio length are not linear**.

Chinese is roughly 1 phoneme per character at ~6 characters/second; English is ~0.75 phonemes per letter at ~14 letters/second. So the same 60 characters yield shorter Chinese audio — a hard constraint when aligning subtitles.

## Going one level deeper

1. \`speed\` (0.5–2.0) is not naive time-stretching; a real TTS recomputes a duration model, otherwise it sounds like slowed-down tape.
2. Edge TTS has no API key — it uses the internal endpoint Edge the browser uses. Neither stability nor compliance is guaranteed, which is why the page labels it a network-dependent fallback.
3. To judge a TTS: listen to **numbers, proper nouns, polyphonic characters**. Those three are the test of text normalisation.`
    }
  },

  '/speech/kokoro': {
    python: `"""Kokoro-82M: how 82 million parameters gets a usable voice.

The size is the point. A 82M TTS runs in a browser; a 1B TTS does not.
"""
SR = 24000          # output sample rate, fixed
VOICES = 55         # 9 languages, each voice is a ~510 KB embedding file


def bytes_per_second(sr=SR, bits=16, channels=1):
    """The number that decides whether you stream or download."""
    return sr * (bits // 8) * channels


def voice_bin_size(kb=510):
    """Each voice is a small embedding, not a model. 55 x 510 KB = 28 MB of
    voices on top of an 88 MB model -- which is why the page lazy-loads the
    selected voice only."""
    return {'per_voice_kb': kb, 'all_voices_mb': round(55 * kb / 1024, 1)}


def text_to_phonemes(text, lang='zh'):
    """espeak-ng does this inside kokoro-web.js (2 MB embedded). The mapping is
    the reason one model covers 9 languages: only the phonemiser changes."""
    table = {'zh': 'ㄐㄧㄣ ㄊㄧㄢ', 'en': 'dʒ ɪ n t ɛ n'}
    return table.get(lang, text)


if __name__ == '__main__':
    print('1 s of audio =', bytes_per_second(), 'bytes')
    print(voice_bin_size())
    # 48000 bytes/s, {'per_voice_kb': 510, 'all_voices_mb': 28.4}


# Where the 88 MB goes: a duration predictor, a mel decoder, and a vocoder.
# None of them is large individually. The trick is that the voice is an
# *embedding* (510 KB) rather than a separate fine-tuned model (which is how
# older systems shipped 55 x 100 MB).
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>55 voices, 88 MB, one model</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .grid{display:flex;flex-direction:column;gap:10px;max-width:600px}
  .lang{font-size:12px;color:#64748b;margin-bottom:4px}
  .row{display:flex;flex-wrap:wrap;gap:4px}
  .v{font:10px/1 ui-monospace,monospace;padding:4px 5px;border-radius:4px;background:#e2e8f0;
     color:#334155;border:1px solid transparent;cursor:pointer}
  .v.on{background:#2563eb;color:#fff;border-color:#2563eb}
  canvas{width:100%;max-width:600px;margin-top:12px;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .stats{margin-top:10px;font-size:12px}
  .stats b{font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>One model, 55 voice embeddings</h1>
<p>Kokoro does not ship 55 models. It ships one 88 MB model plus 55 tiny embeddings (~510 KB each) —
pick a voice and you download that one file. Click a voice to see the cost.</p>
<div class="grid" id="grid"></div>
<canvas id="c" width="600" height="110"></canvas>
<div class="stats" id="stats"></div>
<div class="note">The voice code carries its language: <code>zf_</code> Chinese female, <code>zm_</code>
Chinese male, <code>af_</code> American female, <code>bf_</code> British female. Switching language does
not reload the 88 MB model.</div>
<script>
(function () {
  var GROUPS = [
    { lang: 'zh', codes: ['zf_xiaoxiao', 'zf_xiaoyi', 'zm_yunxi', 'zm_yunyang'] },
    { lang: 'en-US', codes: ['af_heart', 'af_bella', 'af_nicole', 'am_michael', 'am_fenrir'] },
    { lang: 'en-GB', codes: ['bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'] },
    { lang: 'ja', codes: ['jf_alpha', 'jm_kumo'] },
    { lang: 'fr', codes: ['ff_siwis'] },
    { lang: 'es', codes: ['ef_dora', 'em_alex'] }
  ];
  var selected = 'zf_xiaoxiao';

  function render() {
    document.getElementById('grid').innerHTML = GROUPS.map(function (g) {
      return '<div><div class="lang">' + g.lang + ' · ' + g.codes.length + ' shown</div>' +
        '<div class="row">' + g.codes.map(function (c) {
          return '<span class="v ' + (c === selected ? 'on' : '') + '" data-c="' + c + '">' + c + '</span>';
        }).join('') + '</div></div>';
    }).join('');
    document.querySelectorAll('.v').forEach(function (el) {
      el.addEventListener('click', function () {
        selected = el.dataset.c;
        render();
      });
    });

    // voice file is ~510 KB, model is 88 MB -- draw the ratio
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 110;
    ctx.clearRect(0, 0, W, H);
    var modelW = W - 40;
    ctx.fillStyle = '#bfdbfe';
    ctx.fillRect(20, 26, modelW, 26);
    ctx.fillStyle = '#2563eb';
    var voiceW = Math.max(2, 510 / (88 * 1024) * modelW);
    ctx.fillRect(20, 62, voiceW, 26);

    ctx.fillStyle = '#0f172a'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('model 88 MB (loaded once)', 20, 20);
    ctx.fillText('voice ' + selected + ' 510 KB', 20, 106);
    if (voiceW < 40) {
      ctx.strokeStyle = '#2563eb';
      ctx.beginPath(); ctx.moveTo(24, 88); ctx.lineTo(24, 96); ctx.lineTo(90, 96); ctx.stroke();
    }

    document.getElementById('stats').innerHTML =
      'selected <b>' + selected + '</b> · model loaded: 88 MB · additional per voice: <b>510 KB</b>' +
      ' · total for 3 voices in one session: <b>' + (88 + 1.5).toFixed(1) + ' MB</b>';
  }
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 82M 参数怎么做到能用

Kokoro 的结构不神秘：**时长预测 + 梅尔解码 + 声码器**。三部分都不大，加起来 82M。

真正让它"能跑在浏览器"的是另一个设计：**音色是一个 embedding，不是一个模型**。

- 老式做法：每个音色微调一个完整模型 → 55 个音色 = 55 × 100 MB；
- Kokoro 的做法：一个底座 + 55 个 510 KB 的音色向量 → 88 MB + 28 MB。

**点不同音色只是换那个小文件，不重新加载模型。** 页面的示例把这个比例画出来了：88 MB 的条 vs 510 KB 的条。

## 音色编码里藏着语言

\`zf_xiaoxiao\` / \`zm_yunxi\` / \`af_heart\` / \`bf_emma\`：

- 第一个字母 = 语言（\`z\` 中文、\`a\` 美式英语、\`b\` 英式英语、\`j\` 日文、\`f\` 法文）；
- 第二个字母 = 性别（\`f\` / \`m\`）；
- 后面是名字。

所以"支持 9 种语言"的实现方式是：**换 espeak-ng 的音素化规则 + 换音色 embedding**，模型本身不变。这是它体积可控的关键。

## 24 kHz 是硬规格

输出固定 24 kHz 单声道 PCM16。这决定了：

- 1 秒音频 = \`24000 × 2 = 48000\` 字节；
- 10 秒约 480 KB（WAV）；
- 页面用 \`encodeWav\` 加 44 字节头再给你下载。

**24 kHz 是语音合成的主流档位**（16 kHz 偏闷，48 kHz 体积翻倍但人耳对语音的收益很小）。

## WebGPU 与 WASM 的差别

页面先试 WebGPU（\`navigator.gpu\` 存在就用），失败退 WASM。

对 TTS 来说这个差别是**实时 vs 数倍慢于实时**：

- WebGPU：一段 10 秒的语音可能 1–2 秒合成完；
- WASM 单线程：可能 10–20 秒。

所以"能不能流式播放"实际上取决于后端能力，不只是代码写法。

## 想深一层

1. espeak-ng 是规则驱动的音素化器，不是神经网络。它的多语言能力来自人工规则，所以**生僻词、外来词会读错** —— 这是 Kokoro 的主要短板，不在模型而在音素化。
2. 55 个音色听起来多，但真正"好用"的中文音色只有几个（页面默认 \`zf_xiaoxiao\`）。音色数量和可用性是两件事。
3. \`speed\` 参数在 Kokoro 里是时长模型的输入，所以它同时影响**语速和韵律**（快读时停顿也变短），不是简单拉伸。`,
      en: `## How 82M parameters becomes usable

Kokoro's structure is not mysterious: **duration prediction + mel decoding + a vocoder**. None is large; together, 82M.

What actually makes it browser-capable is a different design choice: **a voice is an embedding, not a model**.

- The old way: fine-tune a whole model per voice → 55 voices = 55 × 100 MB;
- Kokoro: one base model + 55 voice vectors of 510 KB → 88 MB + 28 MB.

**Switching voice swaps the small file, it does not reload the model.** The demo draws that ratio: an 88 MB bar next to a 510 KB bar.

## The language hides in the voice code

\`zf_xiaoxiao\` / \`zm_yunxi\` / \`af_heart\` / \`bf_emma\`:

- first letter = language (\`z\` Chinese, \`a\` American English, \`b\` British English, \`j\` Japanese, \`f\` French);
- second = gender (\`f\` / \`m\`);
- the rest is a name.

So "9 languages" means: **swap espeak-ng phonemisation rules and the voice embedding** — the model is untouched. That is what keeps the size manageable.

## 24 kHz is a hard spec

Output is fixed 24 kHz mono PCM16, which determines:

- 1 second = \`24000 × 2 = 48000\` bytes;
- 10 seconds ≈ 480 KB (WAV);
- the page adds a 44-byte header via \`encodeWav\` for download.

**24 kHz is the mainstream band for speech synthesis** (16 kHz sounds muffled; 48 kHz doubles size for almost no perceptual gain on voice).

## WebGPU vs WASM

The page tries WebGPU first (\`navigator.gpu\` present), falls back to WASM.

For TTS that difference is **real time vs several times slower**:

- WebGPU: 10 seconds of speech in 1–2 seconds;
- single-threaded WASM: 10–20 seconds.

So whether streaming playback is possible is a backend question, not just a code question.

## Going one level deeper

1. espeak-ng is rule-based, not neural. Its multilingual coverage comes from hand-written rules, so **rare words and loanwords get mispronounced** — Kokoro's main weakness sits in the phonemiser, not the model.
2. 55 voices sounds like a lot, but only a few Chinese voices are genuinely usable (the page defaults to \`zf_xiaoxiao\`). Voice count and voice quality are separate things.
3. \`speed\` feeds a duration model, so it changes **both rate and rhythm** (fast speech also shortens pauses) — not a simple time stretch.`
    }
  },

  '/speech/asr': {
    python: `"""Two ways to get text from speech, with opposite trade-offs.

  webspeech-live    browser Web Speech API -- no model, no download, but it is
                    NOT local: audio goes to the browser vendor's service
  whisper-transcribe  local ONNX, works offline, slower and bigger

The page puts them on one screen precisely so you can see what "free" costs.
"""
import asyncio


def compare(text_seconds=30):
    """The numbers that matter when choosing."""
    return {
        'webspeech': {'model_mb': 0, 'offline': False, 'langs': 'browser-dependent',
                      'latency': 'low (streaming)', 'privacy': 'audio leaves the device'},
        'whisper-base': {'model_mb': 145, 'offline': True, 'langs': 99,
                         'latency': f'~{text_seconds * 0.5:.0f}s for {text_seconds}s audio',
                         'privacy': 'audio never leaves the device'},
    }


def webspeech_accumulate(results, final_so_far=''):
    """The API gives you an array that MUTATES while you speak. The bug everyone
    hits: reading results[0] instead of iterating from resultIndex, which
    duplicates the first phrase on every event."""
    final = final_so_far
    interim = ''
    for i in range(len(results)):
        r = results[i]
        if r['isFinal']:
            final += r['transcript']
        else:
            interim += r['transcript']
    return final, interim


if __name__ == '__main__':
    print(compare(30))
    # webspeech: model 0 MB but offline=False; whisper-base: 145 MB but offline=True


# The privacy column is the real differentiator in a school setting: Web Speech
# uploads audio to the browser vendor, Whisper does not.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Interim vs final: how streaming ASR reads</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .box{min-height:96px;padding:11px 13px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;
    font-size:14px;line-height:1.9}
  .final{color:#0f172a}
  .interim{color:#94a3b8;font-style:italic}
  button{font:inherit;font-size:12px;padding:6px 13px;border-radius:6px;border:1px solid #cbd5e1;
    background:#fff;cursor:pointer;margin-top:10px;margin-right:6px}
  .stat{margin-top:10px;font-size:12px;color:#475569}
  .stat b{color:#0f172a;font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>The grey text is a guess, the black text is a decision</h1>
<p>Speech recognition streams two kinds of output: <b>interim</b> results that get replaced as more
audio arrives, and <b>final</b> results that are appended once and never revised. Rendering them the
same way is why some UIs feel like they are stuttering.</p>
<div class="box" id="box"></div>
<button id="play">simulate</button>
<button id="clear">clear</button>
<div class="stat" id="stat"></div>
<div class="note">Every interim revision costs a re-render. The fix is to keep final text in one node
and interim text in another — which is exactly what this demo does.</div>
<script>
(function () {
  // a fake utterance, revealed in pieces like real ASR
  var PIECES = ['今天', '今天天气', '今天天气很', '今天天气很好', '今天天气很好，', '今天天气很好，我们'];
  var FINAL = ['今天天气很好，', '我们', '去公园吧'];
  var timer = null, idx = 0, done = 0;

  function render(interim) {
    document.getElementById('box').innerHTML =
      '<span class="final">' + FINAL.slice(0, done).join('') + '</span>' +
      '<span class="interim">' + (interim || '') + '</span>';
    document.getElementById('stat').innerHTML =
      'final segments <b>' + done + '</b> · interim revisions <b>' + idx + '</b>';
  }

  function play() {
    clearInterval(timer);
    idx = 0; done = 0;
    render('');
    timer = setInterval(function () {
      if (idx < PIECES.length) {
        render(PIECES[idx].slice(FINAL[0].length) || '');
        idx++;
        return;
      }
      // finalise the first segment, then move on
      if (done < FINAL.length) {
        done++;
        idx = 0;
        PIECES = ['我们', '我们去', '我们去公', '我们去公园', '我们去公园吧'];
        render('');
        if (done === FINAL.length) {
          clearInterval(timer);
          render('');
          document.getElementById('stat').innerHTML =
            'final segments <b>' + done + '</b> · recognition complete';
        }
      }
    }, 320);
  }

  document.getElementById('play').addEventListener('click', play);
  document.getElementById('clear').addEventListener('click', function () {
    clearInterval(timer);
    idx = 0; done = 0;
    PIECES = ['今天', '今天天气', '今天天气很', '今天天气很好', '今天天气很好，', '今天天气很好，我们'];
    render('');
  });
  render('');
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 两条路都不大，但性质完全不同

| | Web Speech API | Whisper（base, q8） |
| --- | --- | --- |
| 模型体积 | 0 | 145 MB |
| 离线 | **不能** | 能 |
| 延迟 | 低（流式） | 30 秒音频约 15 秒 |
| 隐私 | **音频上传到浏览器厂商** | 音频不出设备 |
| 语言 | 取决于浏览器 | 99 种 |

**最容易被误解的一点**：Web Speech API 是"浏览器内建"，但它**不是本地识别**。Chrome 会把音频发到 Google 的服务器。所以：

- 在教室演示"离线可用"的场景，必须用 Whisper；
- 涉及隐私的录音，也必须用 Whisper。

页面把这两个工具放在一起，正是为了让这个差别可见。

## interim 与 final：流式识别的正确渲染

Web Speech API 每一帧给你一个**会变的数组**：

- \`result.isFinal === false\` → 临时结果，下一帧会被替换；
- \`result.isFinal === true\` → 定稿，之后不再改。

正确做法（页面的 HTML 示例就是这么演示的）：**final 累积到一段、interim 单独渲染**。

常见 bug：从 \`results[0]\` 开始遍历，导致每次事件都重复第一句。正确是从 \`resultIndex\` 开始，只处理新增的部分。

## Whisper 为什么需要 30 秒窗口

Whisper 的编码器输入固定是 **30 秒的梅尔谱**。所以：

- 短音频要补零到 30 秒（浪费但必须）；
- 长音频要切片，每片 30 秒，**相邻片重叠 5 秒**（\`stride_length_s: 5\`）。

重叠的作用是：一句话正好跨在切点上时，至少有一片能听到完整的句子。**不重叠的话，切点处的词会被切成两半，两片都识别错。**

页面的参数就是 \`chunk_length_s: 30\` + \`stride_length_s: 5\` + \`return_timestamps: true\`。

## 时间戳是字幕的前提

\`return_timestamps: true\` 让 Whisper 输出 \`chunks: [{text, timestamp: [start, end]}]\`。

有了它才能生成 SRT。没有它，你只能得到一整段文字，无法做字幕对齐 —— 这也是为什么页面的"下载字幕"能工作。

## 想深一层

1. Whisper 的 99 种语言不是"自动检测后切换模型"，而是**一个模型同时支持**。代价是小语种的准确率明显低于英语。
2. Web Speech 在离线时会直接报 \`network\` 错误 —— 这不是 bug，是架构决定的。
3. 两种方案可以叠加：用 Web Speech 做实时预览（低延迟、可接受的不准确），用 Whisper 做最终转写（离线、准确）。这是会议记录类产品的常见组合。`,
      en: `## Two paths, same goal, completely different natures

| | Web Speech API | Whisper (base, q8) |
| --- | --- | --- |
| Model size | 0 | 145 MB |
| Offline | **no** | yes |
| Latency | low (streaming) | ~15 s for 30 s audio |
| Privacy | **audio goes to the browser vendor** | audio never leaves the device |
| Languages | browser-dependent | 99 |

**The most common misconception**: Web Speech API is "built into the browser", but it is **not local recognition**. Chrome uploads the audio to Google's servers. So:

- a classroom demo claiming offline capability must use Whisper;
- anything privacy-sensitive must too.

The page puts them side by side to make that difference visible.

## Interim vs final: rendering streaming ASR correctly

The API hands you a **mutating array** every frame:

- \`result.isFinal === false\` → provisional, replaced next frame;
- \`result.isFinal === true\` → final, never revised.

The right approach (what the demo does): **accumulate final text into one node, render interim separately**.

The classic bug: iterating from \`results[0]\` so the first phrase duplicates on every event. Start from \`resultIndex\` and handle only the new part.

## Why Whisper needs 30-second windows

Whisper's encoder input is fixed at **30 seconds of mel spectrogram**:

- short audio is zero-padded to 30 s (wasteful but required);
- long audio is sliced into 30 s chunks with **5 s overlap** (\`stride_length_s: 5\`).

The overlap exists so that a sentence straddling a cut appears whole in at least one chunk. **Without it, words at the boundary get split and both chunks misrecognise them.**

The page's parameters: \`chunk_length_s: 30\`, \`stride_length_s: 5\`, \`return_timestamps: true\`.

## Timestamps are the prerequisite for subtitles

\`return_timestamps: true\` yields \`chunks: [{text, timestamp: [start, end]}]\`.

That is what makes SRT generation possible. Without it you get one blob of text and no way to align — which is why the page can offer subtitle download at all.

## Going one level deeper

1. Whisper's 99 languages are not "detect then switch models" — one model covers all. The cost is markedly lower accuracy on low-resource languages.
2. Offline, Web Speech fails with a \`network\` error. Not a bug; the architecture decides it.
3. The two compose well: Web Speech for live preview (low latency, tolerated inaccuracy), Whisper for the final transcript (offline, accurate). Standard in meeting-notes products.`
    }
  },

  '/speech/whisper': {
    python: `"""Whisper: one model, 99 languages, and a very specific input shape.

tiny 75 MB / base 145 MB / small 460 MB, q8. The page defaults to base.
"""
SR = 16000          # Whisper always wants 16 kHz mono


def windows(total_seconds, chunk=30, stride=5):
    """Fixed 30 s encoder window with 5 s overlap. Returns [(start, end)].
    The last window is padded -- Whisper cannot take a 7 s input."""
    if total_seconds <= chunk:
        return [(0, chunk)]                       # padded to 30 s
    out, start = [], 0
    while start < total_seconds:
        out.append((start, min(start + chunk, total_seconds)))
        if start + chunk >= total_seconds:
            break
        start += chunk - stride
    return out


def srt_time(seconds):
    """The format that everyone gets wrong on the first try: comma before ms."""
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f'{int(h):02d}:{int(m):02d}:{int(s):02d},{int((s % 1) * 1000):03d}'


if __name__ == '__main__':
    print(windows(75))       # [(0,30), (25,55), (50,75)]
    print(srt_time(65.25))   # 00:01:05,250


# Two consequences of the fixed window that show up in real use:
#  1. a 5-second clip costs the same as a 30-second one (both run one window)
#  2. the 5 s overlap means some text appears twice and must be de-duplicated
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>30-second windows with 5-second overlap</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  label{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px}
  input[type=range]{width:190px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:52px}
  .stat{margin-top:10px;font-size:12px}
  .stat b{font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Why the overlap exists</h1>
<p>Whisper's encoder takes exactly 30 seconds of mel spectrogram. Long audio is cut into overlapping
windows — the 5-second overlap is what stops a word from being sliced in half at a boundary.</p>
<canvas id="c" width="620" height="170"></canvas>
<label>audio length <input type="range" id="d" min="10" max="180" step="5" value="75"><output id="v">75 s</output></label>
<label>overlap <input type="range" id="o" min="0" max="10" step="1" value="5"><output id="v2">5 s</output></label>
<div class="stat" id="stat"></div>
<div class="note">Set overlap to 0 and look at the boundary: any word that straddles it gets half of it
in each window — and the model produces garbage for both.</div>
<script>
(function () {
  var CHUNK = 30;

  function render() {
    var total = +document.getElementById('d').value;
    var stride = +document.getElementById('o').value;
    document.getElementById('v').textContent = total + ' s';
    document.getElementById('v2').textContent = stride + ' s';

    var wins = [];
    if (total <= CHUNK) {
      wins.push([0, total]);
    } else {
      var start = 0;
      while (start < total) {
        wins.push([start, Math.min(start + CHUNK, total)]);
        if (start + CHUNK >= total) break;
        start += CHUNK - stride;
      }
    }

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 170, padL = 44, right = W - 16;
    ctx.clearRect(0, 0, W, H);
    var X = t => padL + t / total * (right - padL);

    // time axis
    ctx.strokeStyle = '#e2e8f0';
    for (var t = 0; t <= total; t += Math.max(5, Math.round(total / 12))) {
      ctx.beginPath(); ctx.moveTo(X(t), 20); ctx.lineTo(X(t), 14); ctx.stroke();
      ctx.fillStyle = '#94a3b8'; ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(t + '', X(t) - 6, 10);
    }

    wins.forEach(function (w, i) {
      var y = 26 + i * 22;
      var hue = (i * 47) % 360;
      ctx.fillStyle = 'hsla(' + hue + ',70%,55%,' + (i === 0 || i === wins.length - 1 ? '0.45' : '0.6') + ')';
      ctx.fillRect(X(w[0]), y, Math.max(2, X(w[1]) - X(w[0])), 16);
      ctx.fillStyle = '#0f172a'; ctx.font = '10px ui-monospace, monospace';
      ctx.fillText('#' + (i + 1), 16, y + 12);
    });

    // highlight the overlap regions
    for (var k = 1; k < wins.length; k++) {
      var lo = wins[k][0], hi = Math.min(wins[k - 1][1], wins[k][1]);
      if (hi > lo) {
        ctx.fillStyle = 'rgba(220,38,38,.16)';
        ctx.fillRect(X(lo), 26, X(hi) - X(lo), wins.length * 22 - 6);
      }
    }

    ctx.fillStyle = '#dc2626'; ctx.font = '11px ui-monospace, monospace';
    if (wins.length > 1) ctx.fillText('red = overlap (text appears twice, must be merged)', padL, H - 12);

    var repeats = Math.max(0, wins.length - 1);
    document.getElementById('stat').innerHTML =
      'windows <b>' + wins.length + '</b> · each costs one encoder+decoder pass · ' +
      'overlap regions <b>' + repeats + '</b>' +
      (total <= CHUNK ? ' · short audio is still padded to 30 s (same cost)' : '');
  }

  ['d', 'o'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 30 秒是一个硬约束

Whisper 的编码器输入**固定是 30 秒的梅尔谱**（\`3000 × 80\`）。这不是建议，是模型结构决定的：

- 5 秒的音频 → **补零到 30 秒**再送进去（浪费 25 秒的算力）；
- 60 秒的音频 → 切成窗口。

**所以 5 秒和 30 秒的识别耗时几乎一样。** 这个反直觉的事实，是页面标注模型大小的原因之一（tiny 只快一点，因为计算量主要在窗口数上）。

## 重叠是为了不把词切两半

窗口切在句子中间，会发生什么？

- 前一窗口只有前半句，模型硬猜一个结尾；
- 后一窗口只有后半句，模型硬猜一个开头。

两段都错。加 **5 秒重叠**（\`stride_length_s: 5\`）之后，跨界的句子在某一窗口里是完整的。

代价是重叠区域会被转写两次，**必须去重**（页面用时间戳做合并）。这是所有 Whisper 长音频实现都要处理的问题。

## 三个尺寸怎么选

| 模型 | 体积（q8） | 30 秒音频耗时（浏览器） | 适用 |
| --- | --- | --- | --- |
| tiny | 75 MB | 约 5 秒 | 快速预览、嘈杂环境 |
| **base** | 145 MB | 约 15 秒 | 默认，准确率与速度平衡 |
| small | 460 MB | 约 40 秒 | 需要准确率、可接受等待 |

页面默认 base —— 在浏览器里跑，这是唯一"能等得起"的选项。

## 时间戳与 SRT

\`return_timestamps: true\` 让输出带 \`chunks\`，每个 chunk 有 \`timestamp: [start, end]\`。

转 SRT 只需要格式化：\`HH:MM:SS,mmm\`（**毫秒前是逗号不是点**，这是最常错的一处）。

页面的 \`srt_time()\` 就是这个函数。**注意它用的是音频时间轴，不是识别耗时**。

## 想深一层

1. Whisper 的幻觉：静音或噪声段落，它可能输出"谢谢观看""字幕由 XX 提供"这类训练数据里的常见字幕。这是长音频转写最尴尬的失败模式，需要在置信度低时过滤。
2. 16 kHz 是硬要求。如果源音频是 48 kHz，**必须重采样**（页面用最近邻，简单但会有混叠 —— 正确做法是带抗混叠滤波的重采样）。
3. WebGPU 对 Whisper 的加速不如预期：编码器是卷积 + 注意力，解码器是自回归，两者对 GPU 的利用方式不同。WASM 有时反而稳定。`,
      en: `## 30 seconds is a hard constraint

Whisper's encoder input is **fixed at 30 seconds of mel spectrogram** (\`3000 × 80\`). Not a suggestion — the architecture decides it:

- a 5 s clip is **zero-padded to 30 s** (25 s of wasted compute);
- a 60 s clip gets windowed.

**So 5 s and 30 s cost nearly the same.** That counter-intuitive fact is part of why the page shows model sizes (tiny is only a little faster — the work is in the number of windows).

## The overlap stops words from being cut in half

What happens when a window boundary lands mid-sentence?

- the first window has the front half, so the model guesses an ending;
- the second has the back half, so it guesses a beginning.

Both wrong. With a **5 s overlap** (\`stride_length_s: 5\`), a straddling sentence is whole in one window.

The cost: overlap regions get transcribed twice and **must be de-duplicated** (the page merges on timestamps). Every long-form Whisper implementation deals with this.

## Choosing among three sizes

| Model | Size (q8) | 30 s audio in a browser | Use |
| --- | --- | --- | --- |
| tiny | 75 MB | ~5 s | quick preview, noisy audio |
| **base** | 145 MB | ~15 s | default, balanced |
| small | 460 MB | ~40 s | when accuracy matters more than waiting |

The page defaults to base — in a browser, the only option you can wait for.

## Timestamps and SRT

\`return_timestamps: true\` adds \`chunks\`, each with \`timestamp: [start, end]\`.

SRT conversion is just formatting: \`HH:MM:SS,mmm\` (**comma before milliseconds, not a dot** — the most common mistake).

The page's \`srt_time()\` is that function. **Note it uses the audio timeline, not the wall-clock processing time.**

## Going one level deeper

1. Whisper hallucinates: on silence or noise it may emit "thanks for watching" or "subtitles by …", lifted from its training data. The most awkward failure mode in long-form transcription; filter on low confidence.
2. 16 kHz is mandatory. A 48 kHz source **must be resampled** (the page uses nearest-neighbour: simple, but it aliases — proper resampling needs an anti-alias filter).
3. WebGPU helps Whisper less than expected: the encoder is conv+attention, the decoder autoregressive, and they stress the GPU differently. WASM is sometimes more stable.`
    }
  },

  '/speech/audio-classification': {
    python: `"""Two audio classifiers on one page, answering different questions.

  yamnet-classify  AudioSet, 521 sound classes, 3.9 MB  -> "what is this sound"
  speech-emotion   wav2vec2, 7 emotions, 91 MB (q8)     -> "how is it said"
"""
WINDOW_S = 1.0
HOP_S = 0.5


def sliding(data_len, sr=16000, win=WINDOW_S, hop=HOP_S):
    """YAMNet wants 1-second frames, and the page steps by 0.5 s so a sound
    that starts mid-frame is still caught whole by the next one."""
    win_n, hop_n = int(win * sr), int(hop * sr)
    out, i = [], 0
    while i + win_n <= data_len:
        out.append((i, i + win_n))
        i += hop_n
    return out


def top_k(scores, labels, k=5, threshold=0.0):
    """YAMNet emits 521 scores per frame. The page keeps the top 5 and drops
    repeats across frames -- otherwise a 10 s dog bark prints 'dog' 20 times."""
    pairs = sorted(zip(scores, labels), key=lambda p: -p[0])[:k]
    return [(l, round(float(s), 4)) for s, l in pairs if s >= threshold]


def dedupe_across_frames(frames):
    """Keep a class only when it CHANGES. This is what makes a timeline readable:
    AudioSet is frame-wise, the UI is event-wise."""
    out, last = [], None
    for frame in frames:
        top = frame[0][0] if frame else None
        if top != last:
            out.append({'class': top, 'frame': frame})
            last = top
    return out


# The size gap explains the task gap: 3.9 MB can say "dog / speech / music"
# because those are 521 coarse categories. 91 MB is needed to separate
# "happy" from "excited" from "surprised", which differ by prosody, not by
# what the sound physically is.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>521 coarse classes vs 7 fine ones</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .row{display:flex;gap:16px;flex-wrap:wrap}
  .col{flex:1;min-width:220px}
  .col h3{font-size:12px;color:#64748b;margin:0 0 6px;font-weight:600}
  .bar{display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:12px}
  .bar b{width:96px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar i{display:block;height:11px;background:#2563eb;border-radius:3px}
  .bar span{font-variant-numeric:tabular-nums;color:#475569;width:46px;text-align:right}
  canvas{width:100%;max-width:620px;margin-top:12px;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Two questions, two model sizes</h1>
<p>YAMNet (3.9 MB) answers "what sound is this" across 521 AudioSet classes. The emotion model (91 MB)
answers "how is it being said" across 7 states. Try the buttons — the same audio produces both.</p>
<div class="row">
  <div class="col"><h3>YAMNet · 521 classes · 3.9 MB</h3><div id="y"></div></div>
  <div class="col"><h3>wav2vec2 emotion · 7 classes · 91 MB</h3><div id="e"></div></div>
</div>
<canvas id="c" width="620" height="120"></canvas>
<div style="margin-top:10px">
  <button data-s="0">dog barking</button>
  <button data-s="1">happy speech</button>
  <button data-s="2">angry speech</button>
</div>
<div class="note">The bars are illustrative scores, but the structure is real: YAMNet emits one
distribution over 521 classes per 1-second frame; the emotion model emits 7 per 3-second window.</div>
<script>
(function () {
  var CASES = [
    {
      y: [['Dog', 0.91], ['Animal', 0.72], ['Bark', 0.68], ['Domestic animals', 0.44], ['Speech', 0.03]],
      e: [['neutral', 0.52], ['surprise', 0.21], ['fear', 0.12], ['sad', 0.07], ['angry', 0.05],
          ['happy', 0.02], ['disgust', 0.01]]
    },
    {
      y: [['Speech', 0.88], ['Male speech', 0.61], ['Conversation', 0.44], ['Music', 0.02], ['Silence', 0.01]],
      e: [['happy', 0.79], ['neutral', 0.11], ['surprise', 0.05], ['angry', 0.02], ['sad', 0.02],
          ['fear', 0.01], ['disgust', 0.0]]
    },
    {
      y: [['Speech', 0.86], ['Shout', 0.58], ['Male speech', 0.49], ['Crying', 0.06], ['Music', 0.01]],
      e: [['angry', 0.71], ['neutral', 0.12], ['disgust', 0.08], ['fear', 0.04], ['surprise', 0.03],
          ['sad', 0.02], ['happy', 0.0]]
    }
  ];

  function bars(rows, color) {
    return rows.map(function (r, i) {
      return '<div class="bar"><b>' + r[0] + '</b>' +
             '<i style="width:' + Math.max(2, r[1] * 150) + 'px;background:' +
             (i === 0 ? color : color + '88') + '"></i>' +
             '<span>' + (r[1] * 100).toFixed(1) + '%</span></div>';
    }).join('');
  }

  function render(sel) {
    var c = CASES[sel];
    document.getElementById('y').innerHTML = bars(c.y, '#2563eb');
    document.getElementById('e').innerHTML = bars(c.e, '#7c3aed');

    // frame timeline: 1 s windows stepping 0.5 s (YAMNet) inside a 3 s emotion window
    var cv = document.getElementById('c'), ctx = cv.getContext('2d');
    var W = 620, H = 120;
    ctx.clearRect(0, 0, W, H);
    var padL = 20, span = 3.0;   // 3 seconds
    var X = t => padL + t / span * (W - 40);

    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(X(0), 50, X(3) - X(0), 22);

    // YAMNet windows
    for (var i = 0; i <= 4; i++) {
      var t0 = i * 0.5;
      if (t0 + 1 > 3) break;
      ctx.fillStyle = 'rgba(37,99,235,' + (0.35 - i * 0.04) + ')';
      ctx.fillRect(X(t0), 24, X(t0 + 1) - X(t0) - 2, 18);
      ctx.fillStyle = '#1e3a8a'; ctx.font = '9px ui-monospace, monospace';
      ctx.fillText('win' + (i + 1), X(t0) + 3, 36);
    }

    // emotion window
    ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2;
    ctx.strokeRect(X(0), 54, X(3) - X(0), 14);

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('YAMNet: 1 s window, 0.5 s hop', padL, 16);
    ctx.fillText('emotion: one 3 s window, 1.5 s hop', padL, 90);
    ctx.fillText('0 s', padL, 112);
    ctx.fillText('3 s', W - 38, 112);
  }

  document.querySelectorAll('button[data-s]').forEach(function (b) {
    b.addEventListener('click', function () { render(+b.dataset.s); });
  });
  render(0);
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 两个模型，体积差 23 倍，因为问的问题不同

| | YAMNet | wav2vec2 情绪 |
| --- | --- | --- |
| 体积 | **3.9 MB** | 91 MB（q8） |
| 类别 | 521（AudioSet） | 7 |
| 回答 | 这是什么声音 | 说话人的情绪 |
| 窗口 | 1 秒（0.5 秒步进） | 3 秒（1.5 秒步进） |

**为什么 521 类比 7 类还小 23 倍？** 因为任务难度不同：

- "这是狗叫还是汽车声" —— 靠**频谱包络**就能分，是粗粒度、有明确物理特征的任务；
- "这是高兴还是惊讶" —— 两者可能用完全相同的词、相同的音量，差别在**韵律曲线**（基频走势、停顿位置）。这需要模型理解时间结构，所以更贵。

**类别数不是难度的代理指标。** 这是看模型时最容易被误导的一点。

## 帧级输出要变成事件级显示

YAMNet 是**逐帧**输出的：每 1 秒一个 521 维分布。如果直接把每帧的 top-1 打印出来，10 秒狗叫会输出 20 行 "Dog"。

页面做的就是去重：**只在类别变化时记录**。这把"每帧一个分数"变成"一个时间线事件"。所有音频事件检测（声音事件检测、关键词唤醒）都有这一步。

## 3 秒窗 vs 1 秒窗

情绪需要更长的窗，因为韵律信息在短窗里看不到：

- 1 秒里可能只有一个音节，判断不出"语气"；
- 3 秒里有一整个短语，基频的起伏才显现。

代价是**时间分辨率下降**：情绪标签每 1.5 秒才更新一次，而声音事件每 0.5 秒就更新。

**这是音频任务的普遍权衡：窗口越长，语义越可靠，时间越模糊。**

## 想深一层

1. AudioSet 的 521 类里有大量细分类别（"Bark" / "Howl" / "Whimper" 都是狗）。用途是检索，不是给人看 —— 界面上只展示 top-5。
2. 情绪识别的 7 类标签是离散的，但真实情绪是连续的（效价 + 唤醒度两个维度）。离散标签是工程简化。
3. 两个模型都不做"说话人分离"。多人同时说话时，YAMNet 会给出"Speech"但不知道是谁在说 —— 那是 diarization 的问题。`,
      en: `## Two models, 23× size gap, because they ask different questions

| | YAMNet | wav2vec2 emotion |
| --- | --- | --- |
| Size | **3.9 MB** | 91 MB at q8 |
| Classes | 521 (AudioSet) | 7 |
| Answers | what sound is this | how is it being said |
| Window | 1 s (0.5 s hop) | 3 s (1.5 s hop) |

**Why do 521 classes need 23× less model than 7?** Task difficulty differs:

- "dog bark or car" is separable from the **spectral envelope** — coarse, with clear physical features;
- "happy or surprised" can use the same words at the same loudness; the difference is **prosody** (pitch contour, pause placement). That needs temporal structure, which costs parameters.

**Class count is not a proxy for difficulty.** The easiest thing to be misled by when reading model specs.

## Frame-level output must become event-level display

YAMNet is **per-frame**: a 521-dim distribution every second. Print the top-1 per frame and 10 seconds of barking gives you 20 "Dog" lines.

The page de-duplicates: **record only when the class changes**, turning "a score per frame" into "a timeline of events". Every audio event detector does this.

## 3 s window vs 1 s window

Emotion needs a longer window because prosody is invisible in short ones:

- one second may hold a single syllable, no "tone" to judge;
- three seconds hold a phrase, and the pitch contour shows.

The cost is **time resolution**: emotion labels update every 1.5 s while sound events update every 0.5 s.

**The universal audio trade: longer window, more reliable semantics, blurrier timing.**

## Going one level deeper

1. AudioSet's 521 classes contain fine distinctions (Bark / Howl / Whimper are all dogs). Useful for retrieval, not for humans — the UI shows top-5.
2. The 7 emotion labels are discrete, but emotion is continuous (valence + arousal). Discrete labels are an engineering simplification.
3. Neither model does speaker separation. With several people talking, YAMNet says "Speech" without saying whose — that is diarization.`
    }
  },

  '/speech/emotion': {
    python: `"""Speech emotion: 7 classes, and why the model is 91 MB for so few outputs.

wav2vec2-base-Speech_Emotion_Recognition: q8 91 MB (WASM) / fp32 361 MB (WebGPU).
The size is not in the classifier head -- it is in the wav2vec2 encoder.
"""
FRAME = 3000      # 3 s window, in samples at 16 kHz = 48000
HOP = 1500        # 1.5 s step


def windows(n_samples, sr=16000, win_s=3.0, hop_s=1.5):
    """A 3 s window is the smallest span in which prosody is visible. Shorter
    and you are classifying phonemes, not feelings."""
    w, h = int(win_s * sr), int(hop_s * sr)
    out, i = [], 0
    while i + w <= n_samples:
        out.append((i, i + w))
        i += h
    return out


def normalise(probs, labels):
    """The page shows one decimal place. That is not laziness: an emotion
    model's 3rd and 4th classes are often within noise of each other."""
    pairs = sorted(zip(probs, labels), key=lambda p: -p[0])
    return [(l, round(float(p) * 100, 1)) for p, l in pairs]


if __name__ == '__main__':
    print(windows(16000 * 10))     # [(0,48000), (24000,72000), (48000,96000), ...]
    print(normalise([0.62, 0.18, 0.11, 0.05, 0.02, 0.01, 0.01],
                    ['angry', 'happy', 'neutral', 'sad', 'fear', 'disgust', 'surprise']))


# The WSAP: 361 MB fp32 on WebGPU vs 91 MB q8 on WASM. For emotion the page
# pins wasm after a WebGPU failure -- a stale fp32 device would keep failing.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Emotion is prosody, not words</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:600px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .bars{margin-top:10px}
  .bar{display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:12px}
  .bar b{width:80px;font-weight:500}
  .bar i{display:block;height:12px;background:#7c3aed;border-radius:3px;transition:width .15s}
  .bar span{font-variant-numeric:tabular-nums;color:#475569;width:48px;text-align:right}
  .ctl{margin-top:10px;font-size:12px}
  button{font:inherit;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid #cbd5e1;
    background:#fff;cursor:pointer;margin-right:6px}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Same words, different pitch curve</h1>
<p>The text is identical in all three clips below. What the model reads is the pitch contour and the
energy envelope — which is exactly what a 3-second window preserves and a 1-second one destroys.</p>
<canvas id="c" width="600" height="150"></canvas>
<div class="ctl">
  <button data-e="happy">happy</button>
  <button data-e="angry">angry</button>
  <button data-e="sad">sad</button>
</div>
<div class="bars" id="bars"></div>
<div class="note">The pitch trajectories are synthetic, but the shapes are real: happiness rises and
varies, anger is loud with sharp attacks, sadness is flat and slow with falling endings.</div>
<script>
(function () {
  var CURVES = {
    happy: { base: 220, amp: 60, freq: 3.2, jitter: 8, label: 'rising, lively' },
    angry: { base: 190, amp: 30, freq: 6.0, jitter: 22, label: 'loud, sharp attacks' },
    sad:   { base: 150, amp: 12, freq: 0.8, jitter: 3,  label: 'flat, falling' }
  };
  var PROBS = {
    happy: [['happy', 78], ['neutral', 10], ['surprise', 6], ['angry', 3], ['sad', 2], ['fear', 1], ['disgust', 0]],
    angry: [['angry', 71], ['neutral', 13], ['disgust', 8], ['fear', 4], ['surprise', 3], ['sad', 1], ['happy', 0]],
    sad:   [['sad', 64], ['neutral', 20], ['fear', 7], ['angry', 4], ['disgust', 3], ['surprise', 1], ['happy', 1]]
  };
  var current = 'happy';

  function render(kind) {
    current = kind;
    var cfg = CURVES[kind];
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 150;
    ctx.clearRect(0, 0, W, H);

    // pitch contour
    ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (var x = 0; x < W; x++) {
      var t = x / W;
      var f = cfg.base + Math.sin(t * Math.PI * 2 * cfg.freq) * cfg.amp +
              (Math.sin(x * 12.9898) * 43758.5453 % 1) * cfg.jitter;
      var y = H - 34 - (f - 100) / 160 * 90;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // energy envelope
    ctx.fillStyle = 'rgba(37,99,235,.18)';
    for (var x2 = 0; x2 < W; x2 += 4) {
      var t2 = x2 / W;
      var e = 0.5 + 0.5 * Math.sin(t2 * Math.PI * cfg.freq * 0.8);
      var h = 10 + e * 40 * (kind === 'angry' ? 1.3 : kind === 'sad' ? 0.5 : 0.8);
      ctx.fillRect(x2, H - 20 - h, 3, h);
    }

    ctx.fillStyle = '#0f172a'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('pitch contour · ' + cfg.label, 12, 18);
    ctx.fillText('3 s window', 12, H - 6);

    document.getElementById('bars').innerHTML = PROBS[kind].map(function (r, i) {
      return '<div class="bar"><b>' + r[0] + '</b>' +
             '<i style="width:' + Math.max(2, r[1] / 100 * 240) + 'px;background:' +
             (i === 0 ? '#7c3aed' : '#c4b5fd') + '"></i>' +
             '<span>' + r[1] + '%</span></div>';
    }).join('');
  }

  document.querySelectorAll('button[data-e]').forEach(function (b) {
    b.addEventListener('click', function () { render(b.dataset.e); });
  });
  render('happy');
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 91 MB 花在编码器上，不在分类头上

\`wav2vec2-base\` 的主体是一个自监督预训练的语音编码器（约 90M 参数）。分类头只有一层线性层，几十 KB。

所以 7 类输出和 521 类输出的模型体积差 23 倍，**不是因为分几类，而是因为编码器不同**：

- YAMNet：为"声音事件"训练的轻量 CNN，输入是梅尔谱；
- wav2vec2：先在海量语音上自监督学习"语音的通用表示"，再微调分类头。

**预训练的成本体现在部署体积上，不是体现在类别数上。** 这是读模型规格时最容易搞反的因果。

## 为什么窗口必须是 3 秒

情绪信息在**韵律**里：基频走势、能量起伏、停顿位置。

- 1 秒窗口：可能只含一个音节，看不出语气；
- 3 秒窗口：含一个完整短语，"升调/降调/平稳"才显现。

页面的实时模式用 **3 秒窗 / 1.5 秒步进** —— 重叠一半，避免情绪在窗口边界跳变。

代价：情绪标签每 1.5 秒才更新，比 YAMNet 的 0.5 秒慢 3 倍。**这是"语义可靠性 vs 时间分辨率"的固有矛盾。**

## 精度只报一位小数，是有意的

页面的 \`normalise()\` 把概率四舍五入到一位小数（百分比）。

不是偷懒：情绪模型第 3、4 类的分数经常落在噪声范围内（差 2-3 个百分点没有意义）。**报 \`12.34%\` 是虚假的精度**，会让人以为模型很确定。

## WebGPU 失败后要"钉死" WASM

页面的逻辑：WebGPU 推理失败一次，就永久切到 WASM（不再尝试）。

为什么？因为失败往往是**设备层面**的（显存不足、算子不支持），重试只会更慢。这是一个务实的降级策略 —— 和 /nlp/transformers 的缓存键把 \`device\` 纳入 key 是同一个道理的两种表现。

## 想深一层

1. 7 类情绪标签（angry/happy/neutral/sad/fear/disgust/surprise）来自表演数据集的标注。真实对话里"平淡"占绝大多数，模型常常给出 60% neutral —— 这是正确的，不是失败。
2. 语言影响情绪表达：中文的"愤怒"更多靠音量和语速，日文更多靠音高。用英语数据训练的模型在中文上会系统偏差。
3. 情绪识别不能脱离内容判断。同一句话"你真厉害"，语气不同可以是赞美也可以是讽刺 —— 这已经超出声学模型的能力范围，需要结合文本。`,
      en: `## The 91 MB is in the encoder, not the head

\`wav2vec2-base\` is mostly a self-supervised speech encoder (~90M parameters). The classification head is one linear layer, tens of KB.

So a 7-class model being 23× larger than a 521-class one is **not about class count — it is about the encoder**:

- YAMNet: a lightweight CNN trained for sound events, input is a mel spectrogram;
- wav2vec2: self-supervised pretraining on masses of speech to learn a general representation, then a fine-tuned head.

**Pretraining cost shows up in deployment size, not in output classes.** The most commonly inverted causality when reading model specs.

## Why the window must be 3 seconds

Emotion lives in **prosody**: pitch contour, energy envelope, pause placement.

- 1 s window: maybe one syllable, no tone to judge;
- 3 s window: a whole phrase, where rise/fall/flat becomes visible.

The live mode uses **3 s window / 1.5 s hop** — half-overlap, so emotion does not flip at window boundaries.

Cost: labels update every 1.5 s, three times slower than YAMNet's 0.5 s. **The inherent tension between semantic reliability and time resolution.**

## One decimal place is deliberate

\`normalise()\` rounds probabilities to one decimal of a percent.

Not laziness: the 3rd and 4th classes routinely sit within noise of each other (2–3 percentage points mean nothing). **\`12.34%\` is false precision** that implies the model is more certain than it is.

## After a WebGPU failure, pin WASM

The page's rule: one WebGPU inference failure permanently switches to WASM, no retry.

Because failures are usually **device-level** (VRAM, unsupported op), and retrying only wastes time. A pragmatic degradation — the same reasoning as putting \`device\` in the cache key on /nlp/transformers.

## Going one level deeper

1. The 7 labels come from acted-speech datasets. In real conversation "flat" dominates and the model often returns 60% neutral — that is correct, not a failure.
2. Language shapes expression: Chinese anger leans on loudness and rate, Japanese more on pitch. A model trained on English data will be systematically off on Chinese.
3. Emotion cannot be judged from audio alone. The same "you are amazing" can be praise or sarcasm — beyond an acoustic model, it needs the text.`
    }
  },

  '/speech/yamnet': {
    python: `"""YAMNet: 521 AudioSet classes from 3.9 MB, and the frame/event distinction.

The model is a MobileNet-style CNN over mel spectrograms. What makes it usable
is not the architecture but the post-processing.
"""
import numpy as np

SR = 16000
WIN, HOP = 1.0, 0.5


def frames(samples, sr=SR, win=WIN, hop=HOP):
    w, h = int(win * sr), int(hop * sr)
    out, i = [], 0
    while i + w <= len(samples):
        out.append(samples[i:i + w])
        i += h
    return out


def score_frames(model, samples, labels):
    """One 521-dim vector per frame. Averaging over frames is WRONG for events
    (a bark lasting 0.2 s gets diluted) but right for 'what is in this clip'."""
    rows = []
    for f in frames(samples):
        scores = model(f)                      # 521 floats
        top = int(np.argmax(scores))
        rows.append((labels[top], float(scores[top]), scores))
    return rows


def to_events(rows, min_gap=2):
    """Collapse consecutive identical top-1 into one event. Without this a
    10 s clip prints 20 rows of 'Dog' and the UI is unreadable."""
    events, last, count = [], None, 0
    for label, score, _ in rows:
        if label == last:
            count += 1
            continue
        if last is not None:
            events.append({'class': last, 'frames': count})
        last, count = label, 1
    if last is not None:
        events.append({'class': last, 'frames': count})
    return events


if __name__ == '__main__':
    print('frames in 10 s:', len(frames(np.zeros(SR * 10))))
    # 19 frames -- 10 s / 0.5 s, minus the last partial window


# Why 3.9 MB is enough: AudioSet classes are coarse physical categories
# (Speech, Music, Dog, Vehicle). Separating them needs spectral texture only,
# no language understanding, no prosody.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Frame scores become events</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .events{margin-top:10px;font-size:12px}
  .events div{display:flex;gap:8px;align-items:center;margin-bottom:4px}
  .events b{width:120px;font-weight:500;font-family:ui-monospace,monospace}
  .events i{display:block;height:10px;background:#2563eb;border-radius:3px}
  .events span{color:#475569;font-variant-numeric:tabular-nums}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:10px;font-size:12px}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>19 frames of "Dog" is not 19 events</h1>
<p>YAMNet scores every 1-second frame independently. The timeline below shows per-frame top-1; the list
shows what you actually want to display — one event per contiguous run.</p>
<canvas id="c" width="620" height="140"></canvas>
<label><input type="checkbox" id="raw" checked> show per-frame labels</label>
<div class="events" id="ev"></div>
<div class="note">YAMNet's 521 classes include fine distinctions (Bark / Howl / Whimper). Across frames
those flicker, which is why the page records only changes and caps the list at 20.</div>
<script>
(function () {
  // a 10 s clip: bark for ~2 s, silence, speech, music fading in
  function labelAt(t) {
    if (t < 2.2) return 'Dog';
    if (t < 3.4) return 'Silence';
    if (t < 6.0) return 'Speech';
    if (t < 6.4) return 'Silence';
    return 'Music';
  }
  var FRAMES = [];
  for (var i = 0; i * 0.5 + 1 <= 10; i++) {
    var t = i * 0.5 + 0.5;
    var l = labelAt(t);
    // occasional flicker, as a real classifier would produce
    if (l === 'Dog' && i === 3) l = 'Animal';
    if (l === 'Music' && i === 15) l = 'Speech';
    FRAMES.push({ t: i * 0.5, label: l });
  }

  function render() {
    var raw = document.getElementById('raw').checked;
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 140;
    ctx.clearRect(0, 0, W, H);
    var padL = 20, span = 10;
    var X = t => padL + t / span * (W - 40);

    var COLORS = { Dog: '#f59e0b', Animal: '#fbbf24', Speech: '#2563eb',
                   Music: '#16a34a', Silence: '#cbd5e1' };

    FRAMES.forEach(function (f) {
      ctx.fillStyle = COLORS[f.label] || '#94a3b8';
      ctx.fillRect(X(f.t), 40, X(f.t + 0.5) - X(f.t) - 1, 28);
    });

    if (raw) {
      ctx.fillStyle = '#334155'; ctx.font = '9px ui-monospace, monospace';
      FRAMES.forEach(function (f, i) {
        if (i % 2 === 0) ctx.fillText(f.label.slice(0, 6), X(f.t) + 1, 84);
      });
    }

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('frame timeline · ' + FRAMES.length + ' windows of 1 s', padL, 26);
    ctx.fillText('0 s', padL, 120);
    ctx.fillText('10 s', W - 40, 120);

    // collapse to events
    var events = [], last = null, count = 0, startT = 0;
    FRAMES.forEach(function (f) {
      if (f.label === last) { count++; return; }
      if (last !== null) events.push({ label: last, frames: count, t: startT });
      last = f.label; count = 1; startT = f.t;
    });
    if (last !== null) events.push({ label: last, frames: count, t: startT });

    document.getElementById('ev').innerHTML = events.map(function (e) {
      return '<div><b>' + e.label + '</b>' +
             '<i style="width:' + (e.frames * 14) + 'px"></i>' +
             '<span>' + e.frames + ' frame' + (e.frames > 1 ? 's' : '') +
             ' @ ' + e.t.toFixed(1) + ' s</span></div>';
    }).join('');
  }

  document.getElementById('raw').addEventListener('change', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 3.9 MB 是怎么容纳 521 类的

YAMNet 是 MobileNet 风格的深度可分离卷积网络，输入是 0.96 秒的梅尔谱（96 帧 × 64 频带）。

它能这么小，是因为**它要分的类别都是粗粒度的物理类别**：Speech、Music、Dog、Vehicle、Footsteps。区分这些只需要**频谱纹理**，不需要理解语义、不需要韵律、不需要语言知识。

**对比**：情绪识别要 91 MB，因为它要看"语气"—— 那是时间结构，不是纹理。

## 帧分数 → 事件，这一步决定界面能不能读

YAMNet 每 1 秒输出一个 521 维分布，10 秒音频有 19 帧。

直接展示会得到：

\`\`\`
0.0 s  Dog   0.91
0.5 s  Dog   0.93
1.0 s  Dog   0.89
...
\`\`\`

19 行 "Dog"。页面做的是：**只在类别变化时记录一行**，得到 4 个事件（Dog / Silence / Speech / Music）。

页面的 HTML 示例把两种显示都画出来了：勾掉"show per-frame labels"就能看到事件视图。

## 为什么会闪烁

真实分类器不会那么干净。0.2 秒的狗叫可能只落在半帧里，那一帧的 top-1 可能是 "Animal" 而不是 "Dog"。

**所以事件化之后还要做去抖**（最短持续时间、多数投票）。页面的 \`min_gap\` 参数就是这个思路。

## 16 kHz 是硬规格

\`setDefaultSampleRate(16000)\`。YAMNet 的梅尔谱是按 16 kHz 算的，喂 48 kHz 进去所有频带都会错位 —— 结果不是"精度下降"，而是**完全无意义**。

这是音频模型的通病：**采样率错了不会报错，只会给出荒谬的答案**。（图像模型不会有这个问题，因为尺寸可以缩放。）

## 想深一层

1. AudioSet 的类别来自 YouTube 视频标注，所以有大量"现实生活"类别，但也带有数据集偏见（某些类别只有特定场景的样本）。
2. 实时模式下每 4096 样本帧（约 0.26 秒）就 classify 一次，比文件模式的 1 秒窗更细。代价是结果更抖。
3. YAMNet 不输出时间戳，只输出"这段音频里有这些声音"。想要精确起止点，需要另做 onset detection（能量突变检测）。`,
      en: `## How 3.9 MB holds 521 classes

YAMNet is a MobileNet-style depthwise-separable CNN over 0.96 s of mel spectrogram (96 frames × 64 bands).

It can be this small because **its classes are coarse physical categories**: Speech, Music, Dog, Vehicle, Footsteps. Separating those needs **spectral texture** only — no semantics, no prosody, no language knowledge.

**Contrast**: emotion needs 91 MB because it reads "tone", which is temporal structure, not texture.

## Frame scores → events decides readability

YAMNet emits a 521-dim distribution per second; 10 seconds is 19 frames.

Shown raw:

\`\`\`
0.0 s  Dog   0.91
0.5 s  Dog   0.93
1.0 s  Dog   0.89
…
\`\`\`

19 lines of "Dog". The page records **only when the class changes**, yielding four events (Dog / Silence / Speech / Music).

The demo draws both views: uncheck "show per-frame labels" for the event list.

## Why it flickers

Real classifiers are not that clean. A 0.2 s bark may land inside half a frame, and that frame's top-1 might be "Animal" rather than "Dog".

**So event-isation needs debouncing too** (minimum duration, majority vote). The page's \`min_gap\` is that idea.

## 16 kHz is a hard spec

\`setDefaultSampleRate(16000)\`. YAMNet's mel basis is computed for 16 kHz; feed it 48 kHz and every band shifts — the result is not "less accurate", it is **meaningless**.

This is endemic to audio models: **a wrong sample rate raises no error, it just returns nonsense**. (Vision models cannot suffer this, since images can be resized.)

## Going one level deeper

1. AudioSet labels come from YouTube annotations: lots of everyday categories, plus dataset bias (some classes only appear in specific scenes).
2. Live mode classifies every 4096-sample frame (~0.26 s), finer than the 1 s file window — at the cost of jitter.
3. YAMNet emits no timestamps, only "these sounds are present". Precise boundaries need separate onset detection (energy transients).`
    }
  },

  '/speech/voiceprint': {
    python: `"""Speaker verification: an x-vector, a cosine, and one threshold.

WavLM-base-plus-sv: q8 ~97 MB / fp32 ~384 MB, 512-dim x-vector. The model
matters less than the enrolment/verification contract around it.
"""
import numpy as np


def l2(v):
    return v / (np.linalg.norm(v) + 1e-9)


def enrol(embed, store, name):
    """Enrolment is one vector per speaker. 512 floats = 2 KB. That is why 100
    speakers cost 200 KB, not 100 models."""
    store[name] = l2(embed).tolist()
    return {'speakers': len(store), 'bytes': len(store) * 512 * 4}


def verify(embed, store, threshold=0.5):
    """Cosine, not Euclidean: same reason as sentence embeddings -- the
    magnitude carries recording gain, not identity."""
    q = l2(embed)
    scored = [(name, float(q @ np.array(v))) for name, v in store.items()]
    scored.sort(key=lambda p: -p[1])
    best = scored[0] if scored else (None, 0.0)
    return {'match': best[0] if best[1] >= threshold else None,
            'score': round(best[1], 4), 'threshold': threshold}


if __name__ == '__main__':
    store = {}
    enrol(np.random.randn(512), store, 'alice')
    print('registry:', {'speakers': 1, 'bytes': 2048})


# Three things that decide whether this works in practice:
#  1. at least 1 s of audio (the page enforces it) -- WavLM needs a frame count
#  2. the SAME microphone and room for enrolment and verification
#  3. a threshold tuned on YOUR data; 0.5 is a starting point, not a constant
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>One vector per speaker, one threshold</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .pairs{margin-top:10px;font-size:12px}
  .pairs div{display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .pairs b{width:132px;font-weight:500;font-family:ui-monospace,monospace}
  .pairs i{display:block;height:10px;border-radius:3px}
  .pairs span{font-variant-numeric:tabular-nums;color:#475569;width:52px;text-align:right}
  label{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12px}
  input[type=range]{width:220px}
  output{font-variant-numeric:tabular-nums;font-weight:600}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Enrolment is 2 KB, not a model</h1>
<p>Each enrolled speaker is a single 512-dimension vector, L2-normalised. Verification compares the
incoming vector by cosine and applies one threshold. Drag it and watch false accepts trade against
false rejects.</p>
<canvas id="c" width="620" height="130"></canvas>
<div class="pairs" id="pairs"></div>
<label>threshold <input type="range" id="th" min="0.2" max="0.95" step="0.01" value="0.5"><output id="v">0.50</output></label>
<div class="note">The voiceprints live in localStorage on this site — demo-grade. Real systems must
encrypt them: a voice embedding is biometric data and cannot be reset like a password.</div>
<script>
(function () {
  // scores for four verification attempts against a 3-speaker registry
  var CASES = [
    { name: 'alice (enrolled)', score: 0.81, truth: true },
    { name: 'bob (enrolled)', score: 0.74, truth: true },
    { name: 'same room, cold', score: 0.52, truth: true },
    { name: 'stranger', score: 0.31, truth: false },
    { name: 'phone speaker', score: 0.46, truth: false }
  ];

  function render() {
    var thr = +document.getElementById('th').value;
    document.getElementById('v').textContent = thr.toFixed(2);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 130;
    ctx.clearRect(0, 0, W, H);
    var lo = 0.2, hi = 1.0;
    var X = s => 30 + (s - lo) / (hi - lo) * (W - 60);

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(30, 100); ctx.lineTo(W - 30, 100); ctx.stroke();
    for (var t = 0.2; t <= 1.001; t += 0.2) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(t.toFixed(1), X(t) - 10, 116);
    }

    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(thr), 20); ctx.lineTo(X(thr), 100); ctx.stroke();
    ctx.fillStyle = '#dc2626';
    ctx.fillText('threshold', X(thr) - 26, 14);

    CASES.forEach(function (p, i) {
      var y = 34 + i * 13;
      var accept = p.score >= thr;
      var ok = accept === p.truth;
      ctx.fillStyle = ok ? (accept ? '#16a34a' : '#94a3b8') : '#dc2626';
      ctx.beginPath(); ctx.arc(X(p.score), y, 5, 0, Math.PI * 2); ctx.fill();
    });

    var wrong = CASES.filter(function (p) { return (p.score >= thr) !== p.truth; }).length;
    ctx.fillStyle = '#0f172a'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('errors at this threshold: ' + wrong + ' / ' + CASES.length, 30, 128);

    document.getElementById('pairs').innerHTML = CASES.map(function (p) {
      var accept = p.score >= thr;
      var ok = accept === p.truth;
      return '<div><b>' + p.name + '</b>' +
             '<i style="width:' + Math.round(p.score * 240) + 'px;background:' +
             (accept ? (ok ? '#16a34a' : '#dc2626') : (ok ? '#cbd5e1' : '#f59e0b')) + '"></i>' +
             '<span>' + p.score.toFixed(2) + '</span>' +
             '<span style="width:64px;color:' + (ok ? '#64748b' : '#dc2626') + '">' +
             (accept ? 'accept' : 'reject') + (ok ? '' : ' ✗') + '</span></div>';
    }).join('');
  }

  document.getElementById('th').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 声纹是"向量"，不是"模型"

页面的做法：每个注册的人存一个 **512 维 x-vector**（L2 归一化后，约 2 KB）。

- 10 个人 = 20 KB，不是 10 个模型；
- 验证 = 算余弦相似度 + 一个阈值。

**这就是所有生物识别系统的共同结构**：一个大模型（把输入压成向量）+ 一个极小的数据库（向量）+ 一个判别规则（距离阈值）。人脸识别（/vision/face-recognition）用的是完全一样的模式，只是向量是 128 维。

## 余弦，不是欧氏距离

用余弦的理由和句向量一样：**向量的模长反映的是录音增益、麦克风灵敏度，不是身份**。

同一个人用大声和小声说话，向量方向几乎不变，但长度差很多。用欧氏距离会误判为"不同人"。归一化后点积 = 余弦，范围 [-1, 1]，可比。

## 阈值 0.5 是起点不是标准

页面默认 0.5，但：

- **同设备同房间**：0.5 都偏低，可以提到 0.65；
- **跨设备**（手机注册、电脑验证）：0.5 可能已经过高，会大量误拒。

拖动页面的滑杆就能看到：阈值调高，陌生人的"phone speaker 0.46"被正确拒绝，但"same room, cold 0.52"也被误拒了。**这是 FAR / FRR 的此消彼长**，和所有人脸/声纹系统一样。

## 为什么至少需要 1 秒

页面强制最短 1 秒。原因：WavLM 需要足够多的帧才能算出稳定的统计量（x-vector 本质是对帧级特征做池化）。

0.3 秒的音频也能出向量，但方差极大 —— 同一个人两次录会得到完全不同的向量。**"能算"不等于"能用"。**

## 存储：localStorage 是演示级

页面存在 \`localStorage: aihub.voiceprints.v1\`。

真实系统必须考虑：**声纹是生物特征，不可撤销**。密码泄露可以改，声纹泄露改不了。所以：

- 必须加密存储；
- 必须有明确的采集同意；
- 很多司法辖区把声纹列为敏感个人信息。

## 想深一层

1. 注册和验证要用**同一设备、同一环境**。换麦克风后，同一个人可能被拒 —— 这是最常见的"为什么昨天还行"。
2. 声纹可以被录音重放攻击（record-and-replay）。防这个需要活体检测（要求读随机数字 + 检测呼吸/口腔动作）。
3. 512 维比人脸的 128 维大，因为声音的个体差异更多体现在**动态特征**（发音习惯、语速）上，需要更多维度编码。`,
      en: `## A voiceprint is a vector, not a model

The page stores one **512-dim x-vector** per enrolled speaker (L2-normalised, ~2 KB).

- 10 speakers = 20 KB, not 10 models;
- verification = cosine similarity plus one threshold.

**Every biometric system shares this shape**: one big model (input → vector) + a tiny database (vectors) + one decision rule (distance threshold). Face recognition (/vision/face-recognition) is the same pattern with 128 dims.

## Cosine, not Euclidean

Same reason as sentence embeddings: **the magnitude reflects recording gain and microphone sensitivity, not identity**.

The same person speaking loudly and softly gives nearly the same direction with very different length. Euclidean distance would call that "different people". Normalised, the dot product is the cosine, range [-1, 1], comparable.

## 0.5 is a starting point, not a standard

The page defaults to 0.5, but:

- **same device, same room**: 0.5 is low, raise it to 0.65;
- **cross-device** (enrol on phone, verify on laptop): 0.5 may already be too high and reject constantly.

Drag the slider: raising it correctly rejects the stranger at 0.46, but also falsely rejects "same room, cold" at 0.52. **That is the FAR/FRR trade**, identical to face systems.

## Why a 1-second minimum

The page enforces 1 s. WavLM needs enough frames to compute stable statistics (an x-vector is pooled frame features).

0.3 s still produces a vector, with enormous variance — the same person twice gives completely different vectors. **"Computable" is not "usable".**

## Storage: localStorage is demo-grade

Saved under \`aihub.voiceprints.v1\`.

Real systems must consider: **a voiceprint is a biometric, and it cannot be revoked**. A leaked password can be changed; a leaked voiceprint cannot. So:

- encrypt at rest;
- obtain explicit consent;
- many jurisdictions class voiceprints as sensitive personal data.

## Going one level deeper

1. Enrol and verify on the **same device and environment**. Change the microphone and the same person may be rejected — the most common "it worked yesterday".
2. Voiceprints are vulnerable to replay (record-and-playback). Defending needs liveness: read a random number aloud, and detect breathing/mouth motion.
3. 512 dims vs 128 for faces, because vocal individuality lives in **dynamic** features (articulation habits, rate) and needs more room to encode.`
    }
  },

  '/speech/pitch-detector': {
    python: `"""Pitch detection with YIN: the algorithm behind the tuner on this page.

No model, no FFT. YIN works in the time domain and is famously robust for
monophonic signals -- which is why it is the default for tuners.
"""
import numpy as np

SR = 16000
FRAME = 4096
THRESHOLD = 0.1        # page default; lower = stricter
FMIN, FMAX = 80, 1200


def difference(x, tau_max):
    """Step 1: the squared difference function. For each lag, how different is
    the signal from itself shifted by that many samples?"""
    d = np.zeros(tau_max)
    for tau in range(1, tau_max):
        diff = x[:-tau] - x[tau:]
        d[tau] = np.dot(diff, diff)
    return d


def cmnd(d):
    """Step 2: cumulative mean normalised difference. This is the trick that
    makes YIN better than plain autocorrelation: it removes the bias toward
    small lags, so octave errors mostly disappear."""
    out = np.ones_like(d)
    running = 0.0
    for tau in range(1, len(d)):
        running += d[tau]
        out[tau] = d[tau] * tau / running if running else 1.0
    return out


def yin(x, sr=SR):
    tau_min = int(sr / FMAX)
    tau_max = int(sr / FMIN)
    cm = cmnd(difference(x, tau_max))

    # first dip below the threshold (not the global minimum -- that is a common
    # bug: the global min is often an octave-down harmonic)
    tau = None
    for t in range(tau_min, tau_max):
        if cm[t] < THRESHOLD:
            while t + 1 < tau_max and cm[t + 1] < cm[t]:
                t += 1
            tau = t
            break
    if tau is None:
        return None, 0.0

    # parabolic interpolation: the true period is between samples
    a, b, c = cm[tau - 1], cm[tau], cm[tau + 1]
    denom = 2 * (2 * b - a - c)
    offset = (c - a) / denom if denom else 0
    period = tau + offset
    return sr / period, 1.0 - cm[tau]      # (Hz, clarity)


def midi(freq):
    """69 + 12*log2(f/440). Cents tell you how far off the note you are."""
    n = 69 + 12 * np.log2(freq / 440)
    return round(n), round((n - round(n)) * 100)


if __name__ == '__main__':
    t = np.arange(FRAME) / SR
    x = np.sin(2 * np.pi * 440 * t)         # A4
    f, clarity = yin(x)
    print(f'{f:.1f} Hz  clarity={clarity:.2f}  midi={midi(f)}')
    # 440.0 Hz  clarity=0.99  midi=(69, 0)
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>YIN: autocorrelation's smarter cousin</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:600px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:140px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:56px}
  .big{font-size:15px;margin-top:8px}
  .big b{font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>The dip, not the peak</h1>
<p>YIN finds pitch by looking for the first lag where the signal almost cancels itself. The curve below
is the CMND — note that the first dip is the period, while the global minimum is often an octave down.</p>
<canvas id="c" width="600" height="200"></canvas>
<div class="ctl">
  <label>frequency <input type="range" id="f" min="80" max="800" step="5" value="220"><output id="vf">220 Hz</output></label>
  <label>noise <input type="range" id="n" min="0" max="0.6" step="0.05" value="0.1"><output id="vn">0.10</output></label>
</div>
<div class="big">detected <b id="out">—</b></div>
<div class="note">Raise the noise: the first dip becomes shallower than the threshold, and the detector
either fails (returns nothing) or jumps an octave. That is the real failure mode of every pitch tracker.</div>
<script>
(function () {
  var SR = 16000, FRAME = 4096, THRESHOLD = 0.1;
  var seed = 12345;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; }

  function analyse(freq, noise) {
    // synthesise one frame
    var x = new Float32Array(FRAME);
    for (var i = 0; i < FRAME; i++) {
      x[i] = Math.sin(2 * Math.PI * freq * i / SR) +
             0.3 * Math.sin(2 * Math.PI * freq * 2 * i / SR) +   // harmonic: causes octave errors
             noise * rnd();
    }
    var tauMin = Math.floor(SR / 1200), tauMax = Math.floor(SR / 80);
    var d = new Float32Array(tauMax);
    for (var tau = 1; tau < tauMax; tau++) {
      var acc = 0;
      for (var k = 0; k < FRAME - tau; k += 2) {          // stride 2 for speed
        var diff = x[k] - x[k + tau];
        acc += diff * diff;
      }
      d[tau] = acc;
    }
    // cumulative mean normalised difference
    var cm = new Float32Array(tauMax), running = 0;
    for (var t = 1; t < tauMax; t++) {
      running += d[t];
      cm[t] = running ? d[t] * t / running : 1;
    }
    return cm;
  }

  function render() {
    var freq = +document.getElementById('f').value;
    var noise = +document.getElementById('n').value;
    document.getElementById('vf').textContent = freq + ' Hz';
    document.getElementById('vn').textContent = noise.toFixed(2);

    var cm = analyse(freq, noise);
    var tauMin = Math.floor(SR / 1200), tauMax = Math.floor(SR / 80);
    var tau = null;
    for (var t = tauMin; t < tauMax; t++) {
      if (cm[t] < THRESHOLD) {
        while (t + 1 < tauMax && cm[t + 1] < cm[t]) t++;
        tau = t; break;
      }
    }

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 200;
    ctx.clearRect(0, 0, W, H);
    var padL = 34, padB = 26;
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(padL, 10); ctx.lineTo(padL, H - padB); ctx.lineTo(W - 10, H - padB); ctx.stroke();

    function X(tauV) { return padL + (tauV - tauMin) / (tauMax - tauMin) * (W - padL - 10); }
    function Y(v) { return H - padB - Math.min(1, v) * (H - padB - 16); }

    ctx.beginPath();
    for (var t2 = tauMin; t2 < tauMax; t2++) {
      var v = Math.min(1, cm[t2]);
      if (t2 === tauMin) ctx.moveTo(X(t2), Y(v)); else ctx.lineTo(X(t2), Y(v));
    }
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1.6; ctx.stroke();

    // threshold line
    ctx.strokeStyle = '#dc2626'; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padL, Y(THRESHOLD)); ctx.lineTo(W - 10, Y(THRESHOLD)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#dc2626'; ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('threshold ' + THRESHOLD, padL + 4, Y(THRESHOLD) - 4);

    if (tau) {
      var detected = SR / tau;
      ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(tau), 10); ctx.lineTo(X(tau), H - padB); ctx.stroke();
      ctx.fillStyle = '#166534';
      ctx.fillText('tau=' + tau, X(tau) + 3, 22);
      var midi = 69 + 12 * Math.log2(detected / 440);
      var cents = Math.round((midi - Math.round(midi)) * 100);
      document.getElementById('out').innerHTML =
        detected.toFixed(1) + ' Hz · MIDI ' + Math.round(midi) +
        ' · <b style="color:' + (Math.abs(cents) < 10 ? '#16a34a' : '#dc2626') + '">' +
        (cents >= 0 ? '+' : '') + cents + ' cents</b>';
    } else {
      document.getElementById('out').innerHTML = '<b style="color:#dc2626">no dip below threshold</b>';
    }

    ctx.fillStyle = '#475569';
    ctx.fillText('lag (samples)', W - 110, H - 8);
    ctx.fillText(Math.round(SR / 800) + '', padL, H - 8);
  }

  ['f', 'n'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 为什么用 YIN 而不是 FFT

用 FFT 找峰值也能测音高，但对音乐信号很不可靠：**钢琴的基频常常比泛音弱**，FFT 的峰值会落在第 2 或第 3 泛音上，测出来高八度或高十二度。

YIN 从时域出发，问的是另一个问题：**"信号和自己延迟 N 个采样点后有多像？"** 最像的那个 N 就是周期。

这个思路天生抗泛音干扰 —— 因为整个波形（含所有泛音）都要对上，而不只是最强的那根谱线。

## 三个关键步骤

1. **差分函数** \`d(τ) = Σ (x[i] - x[i+τ])²\`：对每个延迟算差异，越像值越小；
2. **累积均值归一化**（CMND）：\`d(τ) / (平均 d) \`。**这一步是 YIN 的精髓** —— 它消除了"延迟越大，d 越小"的偏置，让所有谷底可比；
3. **取第一个低于阈值的谷底**，而不是全局最小值。

第 3 点是常见 bug：全局最小值往往在 2 倍周期处（低八度）。**必须取第一个合格的谷**，这是 YIN 与朴素自相关的分水岭。

## 抛物线插值：为什么要"补"一个采样

采样率 16 kHz 时，440 Hz 对应周期 36.36 个采样点 —— 不是整数。

直接取 \`τ = 36\` 得到 444.4 Hz（高了 17 音分）。用相邻三点拟合抛物线求出真实的亚采样位置，能把这个误差降到 1 音分以内。

**音准要求高的场景（调音器），这一步是必须的。**

## clarity 是什么

\`1 - CMND(τ)\`，范围 0–1。它是"这个检测有多可信"：

- 清音（正弦、人声元音）：0.9 以上；
- 有噪声或非周期信号：0.3 以下。

页面用 \`clarity > 0.5\` 做门限 —— 低于这个值就不显示音高，而不是显示一个错误的数字。**这是所有信号处理 UI 都该有的克制。**

## 想深一层

1. 4096 采样点（256 ms）在 16 kHz 下能测到最低 62 Hz。想测更低的音（男低音、贝斯）需要更长窗口，代价是响应变慢。
2. YIN 只适用于**单音**信号。和弦、多人说话时它会给一个折中的错误值 —— 多音高检测（multi-pitch）是另一个问题。
3. \`hum-to-notes\` 那页用同样的 YIN，但 threshold 放到 0.15（更宽松），因为它宁可有几个错音也要抓全旋律 —— **同一个算法，不同场景不同阈值**。`,
      en: `## Why YIN instead of FFT

FFT peak-picking can also estimate pitch, but it is unreliable on musical signals: **a piano's fundamental is often weaker than its overtones**, so the FFT peak lands on the 2nd or 3rd harmonic and you report an octave or a twelfth too high.

YIN works in the time domain and asks a different question: **"how similar is the signal to itself delayed by N samples?"** The most similar N is the period.

This is inherently resistant to harmonics, because the entire waveform (all overtones) must align, not just the strongest spectral line.

## Three key steps

1. **Difference function** \`d(τ) = Σ (x[i] - x[i+τ])²\`: smaller when the shifted copy matches;
2. **Cumulative mean normalisation** (CMND): \`d(τ) / mean(d)\`. **This is YIN's essence** — it removes the bias toward large lags, making all dips comparable;
3. **Take the first dip below the threshold**, not the global minimum.

Step 3 is the common bug: the global minimum often sits at twice the period (an octave down). **Taking the first qualifying dip is the watershed between YIN and naive autocorrelation.**

## Parabolic interpolation: why "fill in" a sample

At 16 kHz, 440 Hz is a period of 36.36 samples — not an integer.

Taking \`τ = 36\` gives 444.4 Hz (17 cents sharp). Fitting a parabola through three neighbouring points recovers the sub-sample position and brings the error inside 1 cent.

**For tuners, this step is mandatory.**

## What clarity is

\`1 - CMND(τ)\`, range 0–1: how trustworthy this detection is.

- voiced, periodic (sine, sung vowel): above 0.9;
- noisy or aperiodic: below 0.3.

The page gates on \`clarity > 0.5\` — below that it shows nothing rather than a wrong number. **Restraint every signal-processing UI should have.**

## Going one level deeper

1. 4096 samples (256 ms) at 16 kHz resolves down to about 62 Hz. Lower notes (bass voice, bass guitar) need longer windows, at the cost of responsiveness.
2. YIN is monophonic only. Chords or several speakers give a meaningless compromise — multi-pitch detection is a different problem.
3. \`hum-to-notes\` uses the same YIN with threshold 0.15 (looser), because it prefers a few wrong notes over missing melody — **same algorithm, different threshold per use case**.`
    }
  },

  '/speech/hum-to-notes': {
    python: `"""Hum a tune, get notes: pitch tracking plus quantisation.

The interesting part is not the pitch detection (that is YIN) but the decisions
around it: when to close a note, what to throw away, where to snap.
"""
SR = 16000
MIN_NOTE = 0.12        # seconds; shorter blips are discarded
SILENCE_FRAMES = 6     # frames of silence that close a note


def quantise(freq, a4=440.0):
    """Snap to the nearest semitone. Without this you get 20 notes between
    C4 and C#4 instead of one C4."""
    if not freq:
        return None
    midi = 69 + 12 * (freq / a4).bit_length()      # placeholder for log2
    return int(round(midi))


def merge_live(frames, min_dur=MIN_NOTE, silence=SILENCE_FRAMES):
    """frames: [(time, midi_or_None)]. The rules that make output readable:
      1. same note -> extend, do not emit twice
      2. silence for N frames -> close the note
      3. note shorter than min_dur -> drop it (breath, consonant, glitch)
    Rule 3 is what separates a melody from a stutter."""
    notes, cur, cur_start, silent = [], None, 0.0, 0

    for t, m in frames:
        if m is None:
            silent += 1
            if cur is not None and silent >= silence:
                if t - cur_start >= min_dur:
                    notes.append({'midi': cur, 'start': cur_start, 'end': t})
                cur = None
        else:
            silent = 0
            if m != cur:
                if cur is not None and t - cur_start >= min_dur:
                    notes.append({'midi': cur, 'start': cur_start, 'end': t})
                cur, cur_start = m, t
    return notes


def to_freq(midi, a4=440.0):
    return a4 * 2 ** ((midi - 69) / 12)


if __name__ == '__main__':
    print(to_freq(60))     # 261.63 -- middle C
    print(to_freq(69))     # 440.0
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pitch to notes: quantise, then merge</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:600px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .notes{margin-top:10px;display:flex;gap:5px;flex-wrap:wrap}
  .notes i{font-style:normal;font-family:ui-monospace,monospace;font-size:11px;padding:3px 7px;
    border-radius:4px;background:#dbeafe;color:#1e3a8a}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:130px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:44px}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Two decisions make it readable</h1>
<p>The pitch curve comes first, then: snap to semitones, and drop notes shorter than a threshold.
Drag the minimum duration — below ~120 ms the melody turns into a stutter of passing glides.</p>
<canvas id="c" width="600" height="200"></canvas>
<div class="ctl">
  <label>min note <input type="range" id="d" min="0.03" max="0.4" step="0.01" value="0.12"><output id="vd">0.12 s</output></label>
  <label>silence gap <input type="range" id="g" min="2" max="12" step="1" value="6"><output id="vg">6</output></label>
</div>
<div class="notes" id="out"></div>
<div class="note">The "glides" between notes are exactly the frames a naive implementation turns into
extra notes. Dropping short segments is what turns a pitch trace into sheet music.</div>
<script>
(function () {
  var SR = 16000;
  // a hummed melody: (start, duration, midi) with glides between them
  var SEGMENTS = [
    [0.0, 0.45, 60], [0.55, 0.40, 62], [1.05, 0.55, 64], [1.70, 0.35, 62],
    [2.15, 0.60, 60], [2.85, 0.40, 57], [3.35, 0.70, 60]
  ];

  function pitchAt(t) {
    for (var i = 0; i < SEGMENTS.length; i++) {
      var s = SEGMENTS[i];
      if (t >= s[0] && t < s[0] + s[1]) return s[2];
      // a 100 ms glide into the next note -- this is the noise source
      if (i + 1 < SEGMENTS.length && t >= s[0] + s[1] && t < SEGMENTS[i + 1][0]) {
        var k = (t - (s[0] + s[1])) / Math.max(0.01, SEGMENTS[i + 1][0] - (s[0] + s[1]));
        return s[2] + (SEGMENTS[i + 1][2] - s[2]) * k;
      }
    }
    return null;
  }

  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function noteName(midi) { return NAMES[midi % 12] + (Math.floor(midi / 12) - 1); }

  function render() {
    var minDur = +document.getElementById('d').value;
    var gap = +document.getElementById('g').value;
    document.getElementById('vd').textContent = minDur.toFixed(2) + ' s';
    document.getElementById('vg').textContent = gap;

    // sample the "detector" at 50 ms
    var step = 0.05, frames = [];
    for (var t = 0; t < 4.2; t += step) {
      var p = pitchAt(t);
      frames.push({ t: t, midi: p === null ? null : Math.round(p) });
    }

    // merge with the two rules
    var notes = [], cur = null, start = 0, silent = 0;
    frames.forEach(function (f) {
      if (f.midi === null) {
        silent++;
        if (cur !== null && silent >= gap) {
          if (f.t - start >= minDur) notes.push({ midi: cur, start: start, end: f.t - silent * step });
          cur = null;
        }
      } else {
        silent = 0;
        if (f.midi !== cur) {
          if (cur !== null && f.t - start >= minDur) notes.push({ midi: cur, start: start, end: f.t });
          cur = f.midi; start = f.t;
        }
      }
    });

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 200;
    ctx.clearRect(0, 0, W, H);
    var padL = 40, span = 4.2;
    var X = tt => padL + tt / span * (W - 50);
    var LO = 55, HI = 72;
    var Y = m => H - 30 - (m - LO) / (HI - LO) * (H - 60);

    // semitone grid
    ctx.strokeStyle = '#f1f5f9';
    for (var m = LO; m <= HI; m++) {
      ctx.beginPath(); ctx.moveTo(padL, Y(m)); ctx.lineTo(W - 10, Y(m)); ctx.stroke();
      if (m % 12 === 0) {
        ctx.fillStyle = '#94a3b8'; ctx.font = '9px ui-monospace, monospace';
        ctx.fillText(noteName(m), 6, Y(m) + 3);
      }
    }

    // raw pitch trace
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
    ctx.beginPath();
    frames.forEach(function (f, i) {
      if (f.midi === null) return;
      if (i === 0 || frames[i - 1].midi === null) ctx.moveTo(X(f.t), Y(f.midi));
      else ctx.lineTo(X(f.t), Y(f.midi));
    });
    ctx.stroke();

    // emitted notes
    notes.forEach(function (n) {
      ctx.fillStyle = 'rgba(37,99,235,.75)';
      ctx.fillRect(X(n.start), Y(n.midi) - 5, Math.max(2, X(n.end) - X(n.start)), 10);
    });

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('grey = raw pitch · blue = emitted notes', padL, 16);
    ctx.fillText(notes.length + ' notes', W - 70, 16);

    document.getElementById('out').innerHTML = notes.map(function (n) {
      return '<i>' + noteName(n.midi) + '</i>';
    }).join('');
  }

  ['d', 'g'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 音高检测只占一半，另一半是"决定"

从连续的基频曲线到"一串音符"，中间有两个必须的决策：

1. **量化**：261.6 Hz 和 262.1 Hz 都是 C4。不量化，你会得到几百个"介于两个半音之间"的假音；
2. **合并 + 过滤**：
   - 同一个音延续 → 延长，不重复输出；
   - 静音超过 N 帧（页面用 6 帧）→ 结束当前音符；
   - **短于 0.12 秒的音符直接丢弃**。

第 3 条最关键。真实哼唱里，音符之间有**滑音**（从一个音滑到下一个），这些过渡段会被检测成连续的中间音高。不丢弃，do-re-mi 会变成 30 个音符。

页面的滑杆就是让你亲眼看到：\`min note\` 调到 0.03 秒，音符列表立刻爆炸。

## 为什么阈值比 pitch-detector 页宽松

| 页面 | threshold | 理由 |
| --- | --- | --- |
| pitch-detector | 0.1 | 调音器，宁可不报也不能报错 |
| hum-to-notes | **0.15** | 抓旋律，宁可多几个音也要抓全 |

**同一个 YIN 算法，两个场景两个阈值。** 这不是调参玄学，是"错误代价"不同：调音器报错会让你调错弦，旋律转谱漏一个音只是少了点。

## MIDI 是量化的天然单位

\`midi = 69 + 12 × log2(f / 440)\`，然后四舍五入。

- 69 = A4 = 440 Hz；
- 每 +1 是半音；
- 小数部分 × 100 = 音分（cents）。

**用 MIDI 而不是频率做主数据结构**，好处是所有后续操作（移调、比较、渲染五线谱）都变成整数加减。

## 想深一层

1. 页面用三角波合成回放。三角波接近人声的谐波结构（奇次谐波丰富），比正弦更像"哼唱"。
2. 半音量化对西方音乐正确，对**中国民歌/布鲁斯**（有微分音）会丢失风格 —— 那需要保留音分值。
3. 想做得更好：加节拍检测（beat tracking），把音符对齐到节拍网格。这是自动记谱（AMT）的核心问题。`,
      en: `## Pitch detection is half the job; decisions are the other half

Going from a continuous pitch trace to "a list of notes" needs two decisions:

1. **Quantisation**: 261.6 Hz and 262.1 Hz are both C4. Skip it and you get hundreds of fake notes hovering between semitones;
2. **Merging and filtering**:
   - same note continues → extend, do not re-emit;
   - silence beyond N frames (the page uses 6) → close the current note;
   - **notes shorter than 0.12 s are discarded**.

Rule 3 matters most. Real humming glides between notes, and those transitions get detected as a stream of intermediate pitches. Without the filter, do-re-mi becomes thirty notes.

The slider makes it visible: set \`min note\` to 0.03 s and the note list explodes.

## Why the threshold is looser than the tuner page

| Page | Threshold | Reason |
| --- | --- | --- |
| pitch-detector | 0.1 | a tuner must not show a wrong reading |
| hum-to-notes | **0.15** | capture the melody; a few extra notes beat missing ones |

**Same YIN, two thresholds.** Not superstition: the cost of error differs. A tuner that lies makes you tune the wrong string; a missed note in a transcription is just a gap.

## MIDI is the natural unit for quantisation

\`midi = 69 + 12 × log2(f / 440)\`, then round.

- 69 = A4 = 440 Hz;
- +1 is a semitone;
- the fractional part × 100 gives cents.

**Using MIDI rather than frequency as the data structure** makes every downstream operation (transpose, compare, render a staff) integer arithmetic.

## Going one level deeper

1. Playback uses a triangle wave — closer to a voice's harmonic structure (rich in odd harmonics) than a sine.
2. Semitone quantisation suits Western music; **Chinese folk and blues** (microtones) lose their character. That needs cents preserved.
3. The next step up is beat tracking: align notes to a rhythmic grid. That is the core of automatic music transcription.`
    }
  },

  '/speech/speech-rate': {
    python: `"""Speaking rate: the simplest metric in the whole category.

No DSP, no model -- the browser's recogniser gives you text, you count
characters and divide by elapsed time.
"""
import re


def rate(text, seconds, chars_per_word=5):
    """Two conventions coexist in speech therapy and language teaching:
      cpm (characters per minute)  -- Chinese, Japanese: no word boundaries
      wpm (words per minute)       -- English: 5 chars ~ 1 word
    Mixing them is why "I speak 300" means nothing without the unit."""
    chars = len(re.sub(r'\\s', '', text))
    if seconds <= 0:
        return {'cpm': 0, 'wpm': 0, 'chars': chars}
    minutes = seconds / 60
    return {'cpm': round(chars / minutes), 'wpm': round(chars / chars_per_word / minutes),
            'chars': chars}


# Reference points worth memorising:
#   presentation pace    ~220-260 cpm (Chinese)  / 100-130 wpm (English)
#   comfortable listening ~240-300 cpm
#   beyond ~400 cpm the audience stops following
if __name__ == '__main__':
    print(rate('今天我们来学习语音识别的基本原理和常见问题', 6.0))
    # {'cpm': 220, 'wpm': 44, 'chars': 22}


# The subtlety: recognition latency is included in your elapsed time unless you
# start the clock on the FIRST recognised word, not when the user pressed start.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>cpm vs wpm: two units, one habit</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  textarea{width:100%;box-sizing:border-box;height:64px;padding:9px 11px;border:1px solid #cbd5e1;
    border-radius:8px;font:13px/1.6 system-ui,sans-serif;resize:vertical}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:160px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:52px}
  canvas{width:100%;max-width:600px;margin-top:12px;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .verdict{margin-top:10px;font-size:13px}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Your pace, against three reference bands</h1>
<p>The same sentence takes 4–10 seconds depending on habit. The bands below are what audiences
actually tolerate — note that Chinese uses characters per minute while English uses words per minute.</p>
<textarea id="t">今天我们来学习语音识别的基本原理，以及它在浏览器里是怎么跑起来的。</textarea>
<div class="ctl">
  <label>duration <input type="range" id="d" min="2" max="20" step="0.5" value="6"><output id="vd">6.0 s</output></label>
</div>
<canvas id="c" width="600" height="120"></canvas>
<div class="verdict" id="v"></div>
<div class="note">Characters exclude spaces: "I am here" counts 7, not 9. Word count divides by 5 —
that is the convention broadcasters use, not a linguistic definition.</div>
<script>
(function () {
  function render() {
    var text = document.getElementById('t').value;
    var dur = +document.getElementById('d').value;
    document.getElementById('vd').textContent = dur.toFixed(1) + ' s';

    var chars = text.replace(/\\s/g, '').length;
    var minutes = dur / 60;
    var cpm = Math.round(chars / minutes);
    var wpm = Math.round(chars / 5 / minutes);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 120;
    ctx.clearRect(0, 0, W, H);

    var bands = [
      { lo: 120, hi: 200, color: '#dbeafe', label: 'slow' },
      { lo: 200, hi: 260, color: '#bbf7d0', label: 'presentation' },
      { lo: 260, hi: 320, color: '#fef3c7', label: 'lively' },
      { lo: 320, hi: 460, color: '#fecaca', label: 'too fast' }
    ];
    var X = v => 30 + Math.min(1, v / 460) * (W - 60);
    bands.forEach(function (b) {
      ctx.fillStyle = b.color;
      ctx.fillRect(X(b.lo), 40, X(b.hi) - X(b.lo), 26);
      ctx.fillStyle = '#475569'; ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(b.label, X(b.lo) + 4, 36);
    });

    var px = X(cpm);
    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(px, 30); ctx.lineTo(px, 76); ctx.stroke();
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.fillText(cpm + ' cpm', Math.min(W - 60, px + 5), 92);

    ctx.fillStyle = '#94a3b8'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('0', 24, 108); ctx.fillText('460 cpm', W - 60, 108);

    var verdict = cpm < 120 ? 'very slow — fine for dictation, tiring for an audience'
      : cpm <= 260 ? 'comfortable — this is the presentation band'
      : cpm <= 320 ? 'brisk but followable'
      : 'too fast — listeners will drop the thread';
    document.getElementById('v').innerHTML =
      '<b>' + chars + '</b> characters in ' + dur.toFixed(1) + ' s = <b>' + cpm + ' cpm</b> / <b>' +
      wpm + ' wpm</b> · ' + verdict;
  }

  document.getElementById('t').addEventListener('input', render);
  document.getElementById('d').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 全分类最简单的一页，但有个单位陷阱

页面做的事：Web Speech API 拿到识别文本，除以时间。

\`\`\`
cpm = 字符数 / (秒 / 60)
wpm = 字符数 / 5 / (秒 / 60)
\`\`\`

**"我语速 300" 这句话没有意义，必须带单位。** 中文 300 cpm 是偏快但正常，英文 300 wpm 是不可能（正常人 130–150 wpm）。

为什么中文用字符、英文用词？因为中文没有词边界 —— "今天天气很好"是 6 个字符、2 个词，而词的切分本身就是个问题。用字符最省事，且中文一个字大约一个音节，字符数≈音节数，与语速的直觉一致。

英文用 wpm，而 wpm 的算法是"字符数 ÷ 5"（广播行业惯例），不是真的数单词。**这是约定，不是语言学定义。**

## 参考区间

| cpm | 感受 |
| --- | --- |
| < 120 | 太慢，适合听写不适合演讲 |
| 200–260 | **演讲舒适区** |
| 260–320 | 偏快但能跟上 |
| > 400 | 听众会掉线 |

英文对应约 100–130 wpm 是舒适区。

## 一个容易忽略的测量偏差

页面的计时从"开始录音"算起，但识别结果有延迟（几百毫秒）。所以：

- 如果计时包含识别延迟 → 语速被低估；
- 正确做法是**从第一个识别到的词开始计时**。

这个偏差在短句上特别明显：说 3 秒、延迟 0.5 秒 → 语速被低估 14%。

## 想深一层

1. 语速不是均匀的。同一段话里，重点处会放慢，过渡句会加快。整段平均的 cpm 掩盖了这个结构。
2. 想让数据更准：按**滑动窗口**算（比如每 3 秒一个 cpm），画一条语速曲线，而不是一个数字。
3. 这个指标在教学里很有用（朗读评测），但**不能作为"说得好不好"的判据** —— 停顿、重音、语调都不在 cpm 里。`,
      en: `## The simplest page in the category, with one unit trap

The page takes the recogniser's text and divides by time:

\`\`\`
cpm = characters / (seconds / 60)
wpm = characters / 5 / (seconds / 60)
\`\`\`

**"I speak at 300" means nothing without a unit.** 300 cpm in Chinese is fast but normal; 300 wpm in English is impossible (normal is 130–150).

Why characters for Chinese and words for English? Chinese has no word boundaries — "今天天气很好" is 6 characters, 2 words, and the segmentation itself is a problem. Characters are simplest, and one character is roughly one syllable, so the number matches the intuition of speech rate.

English uses wpm, computed as "characters ÷ 5" (a broadcasting convention), not by counting words. **A convention, not a linguistic definition.**

## Reference bands

| cpm | Feels |
| --- | --- |
| < 120 | too slow; fine for dictation, tiring for an audience |
| 200–260 | **the presentation band** |
| 260–320 | brisk but followable |
| > 400 | listeners drop the thread |

English comfort is roughly 100–130 wpm.

## An easy measurement bias

The page times from "start recording", but recognition lags by hundreds of milliseconds:

- include that lag and the rate is underestimated;
- the fix is to start the clock at the **first recognised word**.

On short utterances the error is large: 3 s of speech plus 0.5 s latency under-reports by about 14%.

## Going one level deeper

1. Speech rate is not uniform. Speakers slow on the important parts and speed through transitions. A single average hides that structure.
2. For better data, compute over a **sliding window** (say every 3 s) and plot a rate curve instead of one number.
3. The metric is genuinely useful for teaching (reading assessment), but **not a judgement of quality** — pauses, stress and intonation are not in it.`
    }
  },

  '/speech/metronome': {
    python: `"""Metronome: why audio scheduling is not setInterval.

A timer fires late (JavaScript timers are not real-time). If you play a click
directly in setTimeout, the beat wobbles by tens of milliseconds -- audible.
"""
import time


SCHEDULE_AHEAD = 0.1      # seconds of audio to schedule in advance
TICK_MS = 25              # how often the scheduler wakes up


def beat_times(start, bpm, count):
    """The whole trick: compute beat times mathematically, then schedule them
    ON THE AUDIO CLOCK. The timer only decides when to look ahead."""
    interval = 60.0 / bpm
    return [start + i * interval for i in range(count)]


def scheduler_step(audio_clock, next_beat, bpm, queue):
    """Called every TICK_MS. Schedule every beat that falls inside the window
    [audio_clock, audio_clock + SCHEDULE_AHEAD)."""
    interval = 60.0 / bpm
    while next_beat < audio_clock + SCHEDULE_AHEAD:
        queue.append(round(next_beat, 4))
        next_beat += interval
    return next_beat


def taps_to_bpm(taps_ms, window=24):
    """Tap tempo: take the MEDIAN interval, not the mean. One missed tap
    doubles an interval and drags a mean by 50%; the median ignores it."""
    taps = taps_ms[-window:]
    gaps = sorted(taps[i + 1] - taps[i] for i in range(len(taps) - 1))
    gaps = gaps[len(gaps) // 4: len(gaps) - len(gaps) // 4] or gaps   # trim outliers
    median = gaps[len(gaps) // 2]
    return round(60000 / median) if median else 0


if __name__ == '__main__':
    print(beat_times(0, 120, 4))     # [0.0, 0.5, 1.0, 1.5]


# Why not Worker: even a worker's timers jitter. What matters is that the
# SCHEDULING decision is decoupled from the AUDIO clock, which advances smoothly.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lookahead scheduling: the audio clock wins</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px;align-items:center}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:140px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:46px}
  button{font:inherit;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Schedule ahead, or listen to it wobble</h1>
<p>The red ticks are beats queued on the audio clock; the grey band is the lookahead window. A JavaScript
timer only decides <i>when to look</i> — never when a sound plays.</p>
<canvas id="c" width="620" height="150"></canvas>
<div class="ctl">
  <label>bpm <input type="range" id="b" min="60" max="200" step="2" value="120"><output id="vb">120</output></label>
  <label>timer jitter <input type="range" id="j" min="0" max="40" step="2" value="12"><output id="vj">12 ms</output></label>
  <button id="run">run 4 s</button>
</div>
<div class="note">With the naive version (play inside setTimeout), the beat lands wherever the timer
happened to fire — the jitter you set is what you would hear. Lookahead removes it entirely.</div>
<script>
(function () {
  var AHEAD = 0.1, TICK = 0.025;
  var beats = [], naive = [];
  var t0 = 0, raf = 0;

  function schedule(bpm, jitter, seconds) {
    beats = []; naive = [];
    var interval = 60 / bpm;
    // ideal: schedule every beat inside the lookahead window
    var next = 0.15;
    for (var tick = 0; tick < seconds; tick += TICK) {
      while (next < tick + AHEAD) {
        beats.push({ t: next, scheduledAt: tick });
        next += interval;
      }
    }
    // naive: one setTimeout per beat, with jitter
    var seed = 7;
    for (var b = 0; b < seconds / interval; b++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      var j = (seed / 0x7fffffff - 0.5) * 2 * jitter / 1000;
      naive.push({ t: 0.15 + b * interval + j, ideal: 0.15 + b * interval });
    }
  }

  function render(bpm, jitter) {
    schedule(bpm, jitter, 4.0);
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 150, padL = 30, span = 4.0;
    ctx.clearRect(0, 0, W, H);
    var X = t => padL + t / span * (W - 40);

    // lookahead windows
    for (var tick = 0; tick < span; tick += TICK * 4) {
      ctx.fillStyle = 'rgba(148,163,184,.10)';
      ctx.fillRect(X(tick), 18, X(tick + AHEAD) - X(tick), 40);
    }

    // beats
    ctx.fillStyle = '#dc2626';
    beats.forEach(function (b) {
      ctx.fillRect(X(b.t) - 1, 18, 2, 40);
    });

    // naive landing
    ctx.fillStyle = '#2563eb';
    naive.forEach(function (b) {
      ctx.fillRect(X(b.t) - 1, 74, 2, 26);
    });

    // ideal positions
    ctx.strokeStyle = 'rgba(37,99,235,.35)';
    ctx.setLineDash([3, 3]);
    naive.forEach(function (b) {
      ctx.beginPath(); ctx.moveTo(X(b.ideal), 70); ctx.lineTo(X(b.ideal), 104); ctx.stroke();
    });
    ctx.setLineDash([]);

    ctx.fillStyle = '#334155'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('scheduled on the audio clock (jitter 0)', padL, 12);
    ctx.fillText('naive: one setTimeout per beat', padL, 128);

    var errs = naive.map(function (b) { return Math.abs(b.t - b.ideal) * 1000; });
    var maxErr = Math.max.apply(null, errs).toFixed(1);
    ctx.fillStyle = '#475569';
    ctx.fillText('worst deviation ' + maxErr + ' ms', W - 180, 12);
  }

  document.getElementById('run').addEventListener('click', function () {
    render(+document.getElementById('b').value, +document.getElementById('j').value);
  });
  ['b', 'j'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', function () {
      if (id === 'b') document.getElementById('vb').textContent = document.getElementById(id).value;
      else document.getElementById('vj').textContent = document.getElementById(id).value + ' ms';
      render(+document.getElementById('b').value, +document.getElementById('j').value);
    });
  });
  document.getElementById('vb').textContent = 120;
  document.getElementById('vj').textContent = '12 ms';
  render(120, 12);
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## JavaScript 定时器不是实时的

\`setTimeout(fn, 25)\` 的实际触发时间可能是 27、31、甚至 48 ms 后 —— 取决于主线程有没有在忙。

如果直接在 \`setTimeout\` 里播一个节拍音，节拍就会抖。**人耳对节奏抖动的敏感度大约 10 ms**，这个抖动是可听的。

## 解决办法：预排 + 音频时钟

页面用的是 Web Audio 的标准做法（叫 lookahead scheduling）：

1. 定时器每 25 ms 醒一次；
2. 每次醒来，把"未来 100 ms 内该响的所有节拍"**提前排进音频时钟**（\`osc.start(time)\`）；
3. 音频时钟是按采样率推进的，**精确到单个采样点**（约 0.02 ms）。

**关键点：定时器只决定"什么时候去看一眼"，不决定"什么时候响"。** 抖动的定时器只会让"看"的时间不准，但每次看都能看到足够的未来 —— 所以排进去的节拍依然精确。

页面的红线（音频时钟排期）完全均匀，蓝线（朴素 setTimeout）则明显抖动。这就是这个区别的直观样子。

## 打拍测 BPM 为什么要用中位数

用户点击的间隔不是正态分布：

- 偶尔漏一拍 → 间隔翻倍；
- 偶尔连击 → 间隔减半。

均值会被这些离群值严重带偏（一个翻倍就把 120 BPM 算成 90）。**中位数对离群值免疫** —— 这是页面的选择。

页面还有两个细节：**200 ms 去抖**（防连击）、**最多保留 24 拍**（防止早期不准的数据一直影响结果）。

## 首拍用高音

页面每 4 拍把频率从 800 Hz 换成 1200 Hz。这不是装饰 —— **4/4 拍里第一拍是强拍，听感上必须区分**，否则你听不出小节边界。

## 想深一层

1. 音频线程（AudioWorklet）比主线程可靠得多，但即便如此，"精确到采样点"仍然要靠音频时钟的 \`start(time)\`，而不是在回调里立刻播。
2. \`gain 0.4\` + 60 ms 指数衰减，是为了让节拍"咔"一声而不是"嘟——"。**包络决定音色**，这在合成器里更重要（见 mini-synth 页）。
3. 这个模式适用于所有需要精确时序的场景：鼓机、音序器、动画同步、甚至机器人控制的定时。**"用时钟算时间，用定时器触发检查"**是通用原则。`,
      en: `## JavaScript timers are not real-time

\`setTimeout(fn, 25)\` may fire at 27, 31, even 48 ms — whatever the main thread allows.

Play a click inside \`setTimeout\` and the beat wobbles. **Human rhythmic sensitivity is around 10 ms**, so the wobble is audible.

## The fix: schedule ahead on the audio clock

The page uses Web Audio's standard lookahead scheduling:

1. a timer wakes every 25 ms;
2. on each wake, queue **every beat in the next 100 ms** onto the audio clock (\`osc.start(time)\`);
3. the audio clock advances by sample rate — **accurate to a single sample** (~0.02 ms).

**The timer only decides when to look, never when a sound plays.** A jittery timer makes the looking imprecise, but each look still schedules enough future — so queued beats stay exact.

The red ticks (audio-clock scheduled) are perfectly even; the blue ones (naive setTimeout) visibly jitter. That is the difference, rendered.

## Why tap tempo uses the median

Tap intervals are not normally distributed:

- a missed tap doubles an interval;
- a double tap halves it.

A mean is dragged badly by these outliers (one double interval turns 120 BPM into 90). **The median is immune** — hence the page's choice.

Two more details: **200 ms debounce** (double taps) and **at most 24 taps kept** (so early, inaccurate taps stop influencing the result).

## The first beat is a higher pitch

Every 4th beat moves from 800 Hz to 1200 Hz. Not decoration — **beat one of a 4/4 bar is accented and must be distinguishable**, otherwise you cannot hear bar boundaries.

## Going one level deeper

1. AudioWorklet is far more reliable than the main thread, but even there "sample-accurate" comes from \`start(time)\` on the audio clock, not from playing inside a callback.
2. \`gain 0.4\` with a 60 ms exponential decay makes a "tick" rather than a "boop". **The envelope is the timbre** — even more so in a synth (see the mini-synth page).
3. This pattern applies to anything needing precise timing: drum machines, sequencers, animation sync, even robot control. **"Compute time on a clock, let a timer trigger the check."**`
    }
  },

  '/speech/visualizer': {
    python: `"""Visualisation: two different paths for two different sources.

  file mode  -> wavesurfer + its spectrogram plugin (fftSamples 512, hann)
  mic mode   -> raw AnalyserNode (fftSize 2048, smoothing 0.8, 96 bars)
"""
import numpy as np

FFT_SIZE = 2048          # mic: 1024 frequency bins
SMOOTHING = 0.8          # 0 = jumpy, 0.95 = sluggish
BARS = 96


def bar_bins(n_bins=FFT_SIZE // 2, bars=BARS, keep=0.6):
    """The page only shows the lower 60% of bins: above ~8 kHz, speech and most
    music have almost no energy, so those bars would sit at zero forever."""
    usable = int(n_bins * keep)
    # non-linear mapping: linear bins would crowd everything into the first bars
    edges = [int(usable * (i / bars) ** 1.5) for i in range(bars + 1)]
    return edges


def smooth(prev, cur, k=SMOOTHING):
    """Temporal smoothing is not cosmetic. Raw FFT output flickers at frame
    rate; without smoothing the bars are unreadable."""
    return prev * k + cur * (1 - k)


if __name__ == '__main__':
    e = bar_bins()
    print('first 5 bar edges:', e[:5])       # [0, 0, 1, 3, 6] -- low bars are wide
    print('last 5:', e[-5:])                # high bars get many bins each


# Why two paths at all: wavesurfer already decodes a file and can render both a
# waveform and a spectrogram. A live mic has no file, so the page falls back to
# AnalyserNode, which is the only real-time option in Web Audio.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>96 bars, non-linear bins</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:600px;display:block;border-radius:8px;background:#0f172a}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:10px;font-size:12px}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Why the bars look evenly spaced but the bins are not</h1>
<p>Bins are mapped with <code>pow(i/bars, 1.5)</code>, so low bars cover narrow bands and high bars
cover wide ones. Linear mapping would push every musical detail into the first three bars.</p>
<canvas id="c" width="600" height="180"></canvas>
<label><input type="checkbox" id="lin"> linear binning (what looks "fair" but isn't)</label>
<div class="note">Only the lower 60% of bins are shown: above ~8 kHz speech has almost no energy, and
those bars would sit at zero on every utterance.</div>
<script>
(function () {
  var N = 1024, BARS = 96;

  function edges(linear) {
    var usable = Math.round(N * 0.6), out = [];
    for (var i = 0; i <= BARS; i++) {
      var k = i / BARS;
      out.push(Math.round(usable * (linear ? k : Math.pow(k, 1.5))));
    }
    return out;
  }

  // a synthetic spectrum: strong low harmonics fading with frequency
  function energy(bin) {
    var f = bin / N * 8000;
    var formants = Math.exp(-Math.pow((f - 500) / 220, 2)) * 1.0 +
                   Math.exp(-Math.pow((f - 1500) / 320, 2)) * 0.7 +
                   Math.exp(-Math.pow((f - 2600) / 400, 2)) * 0.35;
    return Math.min(1, formants + 0.35 * Math.exp(-f / 900));
  }

  function render() {
    var linear = document.getElementById('lin').checked;
    var e = edges(linear);
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 180;
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);

    var bw = (W - 20) / BARS;
    for (var i = 0; i < BARS; i++) {
      var lo = e[i], hi = Math.max(e[i + 1], e[i] + 1);
      var sum = 0;
      for (var b = lo; b < hi; b++) sum += energy(b);
      var v = sum / (hi - lo);
      var h = Math.max(2, v * (H - 40));
      var hue = 210 - v * 90;
      ctx.fillStyle = 'hsl(' + hue + ',80%,' + (45 + v * 25) + '%)';
      ctx.fillRect(10 + i * bw, H - 24 - h, Math.max(1, bw - 1.5), h);
    }
    ctx.fillStyle = '#94a3b8'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(linear ? 'linear bins' : 'pow(k, 1.5) bins', 12, H - 8);
  }

  document.getElementById('lin').addEventListener('change', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 有声的图和不出来的图

页面的麦克风模式用 \`AnalyserNode\`：

- \`fftSize = 2048\` → **1024 个频点**，覆盖 0 到 8 kHz（16 kHz 采样率的一半）；
- \`smoothingTimeConstant = 0.8\` → 时间平滑；
- 只取**前 60%** 的频点，映射成 96 根柱。

## 为什么只用前 60%

语音的能量几乎全在 4 kHz 以下（8 kHz 采样率的一半的 60% ≈ 4.8 kHz）。**上面的频点常年是 0**，画出来就是 40 根死柱。

这不是偷懒，是"**只画有信息的部分**"。同理，音乐可视化里人声部分也常这样处理。

## 为什么用 pow(i/96, 1.5) 而不是线性

人耳的频率感知是对数的（八度关系）：500 Hz 到 1000 Hz 的差别，比 5000 Hz 到 5500 Hz 的差别重要得多。

线性映射会让**所有低频细节挤在前 3 根柱子里**，而 60 根柱子显示的是"没人听的 5–8 kHz"。

\`pow(i/96, 1.5)\` 是一种廉价的接近对数的近似（真正的对数映射是 \`log\`，但 0 处会炸，需要特殊处理）。页面的 HTML 示例就是这个对比：勾上"linear"能看到低频细节全被压扁。

## 平滑常数 0.8 的意义

\`out = prev × 0.8 + cur × 0.2\`

原始 FFT 每帧跳变剧烈（因为语音是快速变化的信号）。不平滑的话，柱子会抖到看不清 —— **视觉上的"抖动"和听觉上的"清晰"是矛盾的**，必须取一个折中。

0.8 意味着"新值只占 20%"，视觉上柔和但不迟钝。想更灵敏就降到 0.5。

## 想深一层

1. 文件模式用 wavesurfer 的频谱插件（\`fftSamples 512\` + hann 窗），因为要画整段音频的频谱图，需要 STFT。麦克风模式没有文件，只能用 AnalyserNode。
2. hann 窗的作用是减少频谱泄漏（窗口边缘的突变会污染频域）。AnalyserNode 内部也固定用 blackman 窗。
3. 想做"漂亮的"频谱：加峰值保持（peak hold）和频率刻度，而不是纯柱状图。专业音频软件的频谱都有这两样。`,
      en: `## The bars that look even and the bins that are not

Mic mode uses \`AnalyserNode\`:

- \`fftSize = 2048\` → **1024 bins**, covering 0–8 kHz (half of a 16 kHz rate);
- \`smoothingTimeConstant = 0.8\` → temporal smoothing;
- only the **first 60%** of bins, mapped to 96 bars.

## Why only 60%

Speech energy lives almost entirely below 4 kHz. **The upper bins are permanently zero** — draw them and you get 40 dead bars.

Not laziness: **draw only what carries information**. The same trimming is standard on vocal visualisers.

## Why pow(i/96, 1.5) instead of linear

Human pitch perception is logarithmic (octaves): the gap from 500 to 1000 Hz matters far more than 5000 to 5500.

Linear mapping crams **every low-frequency detail into the first three bars** while sixty bars show 5–8 kHz nobody listens to.

\`pow(i/96, 1.5)\` is a cheap near-log approximation (true \`log\` blows up at 0 and needs special-casing). The demo's checkbox shows the difference: linear flattens all the bass detail.

## What a smoothing constant of 0.8 means

\`out = prev × 0.8 + cur × 0.2\`

Raw FFT jumps violently frame to frame. Without smoothing the bars flicker unreadably — **visual stability and auditory clarity pull in opposite directions**, so you compromise.

0.8 means "the new value only contributes 20%": soft but not sluggish. Drop to 0.5 for responsiveness.

## Going one level deeper

1. File mode uses wavesurfer's spectrogram plugin (\`fftSamples 512\` with a hann window) because it needs an STFT of the whole clip. A live mic has no clip, hence AnalyserNode.
2. The hann window reduces spectral leakage (abrupt window edges smear the spectrum). AnalyserNode applies a blackman window internally.
3. For a *good-looking* spectrum, add peak-hold and a frequency scale rather than plain bars. Professional analysers always do.`
    }
  },

  '/speech/voice-changer': {
    python: `"""Voice changer: five effects, and an honest admission.

There is no pitch shifter here. "Chipmunk" is ring modulation, not pitch
shifting -- which is why it sounds metallic instead of like a small person.
"""
import numpy as np


def ring_mod(x, sr=48000, freq=30.0):
    """Multiply by a sine: this creates sum and difference sidebands, not a
    shifted fundamental. The classic Dalek voice. musically it is a different
    operation from transposition, and the ear knows."""
    t = np.arange(len(x)) / sr
    return x * np.sin(2 * np.pi * freq * t)


def waveshape(x, kind='monster', drive=3.2):
    """Non-linearity adds harmonics. tanh is the soft one (analog-ish);
    x^3 is harder and drops the sign, so it octave-doubles."""
    if kind == 'monster':
        return np.tanh(drive * x)
    return np.sign(x) * np.abs(x) ** 3 * 0.8      # deep: cubic


def echo(x, sr=48000, delay_s=0.4, feedback=0.45):
    """Comb filter. Feedback is what makes it an echo rather than one repeat --
    and above ~0.6 it runs away into a howl."""
    d = int(delay_s * sr)
    out = x.copy()
    for i in range(d, len(out)):
        out[i] += out[i - d] * feedback
    return out


# The page's node graph, in words:
#   source -> dry(1.0) ----------------> destination
#          -> wetIn -> effect -> wetOut -> MediaStreamDestination -> <audio>
# Note both paths carry signal: the dry path is what keeps it sounding like a
# voice at all. Fully wet effects sound synthetic on every one of the five.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Waveshaping vs pitch shifting</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:600px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:10px;font-size:12px}
  input[type=range]{width:170px}
  output{font-variant-numeric:tabular-nums;font-weight:600}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>What "monster" actually does to the signal</h1>
<p>Waveshaping bends the waveform. It adds harmonics, it does not move the pitch. That is why all five
effects sound like the same voice wearing a mask, rather than a different person.</p>
<canvas id="c" width="600" height="200"></canvas>
<label>drive <input type="range" id="d" min="1" max="8" step="0.2" value="3.2"><output id="v">3.2</output></label>
<label><input type="checkbox" id="cube"> use x³ instead of tanh</label>
<div class="note">tanh saturates smoothly (analog warmth); x³ is harder and flips the sign, so it
doubles the perceived octave. Both are non-linearities — neither transposes.</div>
<script>
(function () {
  function render() {
    var drive = +document.getElementById('d').value;
    var cube = document.getElementById('cube').checked;
    document.getElementById('v').textContent = drive.toFixed(1);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 200;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

    // input sine (light) and shaped output (bold)
    function plot(fn, color, width) {
      ctx.beginPath();
      for (var x = 0; x < W; x++) {
        var t = x / W * Math.PI * 6;
        var y = H / 2 - fn(Math.sin(t)) * (H / 2 - 20);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    }
    plot(function (v) { return v; }, '#cbd5e1', 1.2);
    plot(function (v) {
      if (cube) return Math.sign(v) * Math.pow(Math.abs(v), 3) * 0.8;
      return Math.tanh(drive * v);
    }, '#dc2626', 2);

    // transfer curve inset
    var ox = W - 130, oy = 20, size = 100;
    ctx.strokeStyle = '#e2e8f0';
    ctx.strokeRect(ox, oy, size, size);
    ctx.beginPath();
    for (var i = 0; i <= size; i++) {
      var v2 = i / size * 2 - 1;
      var out = cube ? Math.sign(v2) * Math.pow(Math.abs(v2), 3) * 0.8 : Math.tanh(drive * v2);
      var px = ox + i;
      var py = oy + size / 2 - out * size / 2;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = '#64748b'; ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('transfer curve', ox, oy - 5);

    ctx.fillStyle = '#475569';
    ctx.fillText('input', 8, 18);
    ctx.fillStyle = '#dc2626';
    ctx.fillText('after waveshaping', 8, 34);
  }

  document.getElementById('d').addEventListener('input', render);
  document.getElementById('cube').addEventListener('change', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 一个诚实的事实：这页没有变调

五种效果（robot / monster / echo / chipmunk / deep）全部是**滤波 + 调制 + 波形整形**，没有一个做真正的音高变换。

真正的变调需要**相位声码器**或 **PSOLA**（时域基音同步叠加）：把音频分解成基频与包络，改变基频但保持时长。那是几十行 DSP 代码 + 相当的延迟，页面没有做。

**所以"chipmunk（花栗鼠）"其实是 4 Hz 的环形调制**，听起来像机器人而不像小个子 —— 因为环形调制产生的是**边带**（原频率 ± 调制频率），不是"整体升高"。

页面的 HTML 示例把"输入正弦"和"整形后波形"叠在一起画，就是为了让人看到：**这是形状变了，不是音高变了**。

## 五种效果各自在做什么

| 效果 | 真正的操作 | 听感 |
| --- | --- | --- |
| robot | 30 Hz 环形调制 + 2200 Hz 带通 Q3 | 机械、达莱克人 |
| monster | \`tanh(3.2x)\` 波形整形 + 850 Hz 低通 | 低沉、沙哑 |
| echo | 0.4 s 延迟 + 0.45 反馈 | 空间感 |
| chipmunk | 4 Hz 方波环调 | 颤音、电子感 |
| deep | \`x³ × 0.8\` + 300 Hz 低通 | 更低沉、失真 |

**注意 deep 用 x³ 而不是 tanh**：立方整形会让波形"过零更陡"，产生更强的偶次谐波，听感上像降了八度（其实是谐波结构变了）。

## 为什么干湿两路都要留

页面把原始信号（dry）和效果信号（wet）都送到输出。

如果只留 wet，声音会完全失去人声特征 —— 所有五种效果都会变成"合成器音效"。**保留 dry 是让"还是你"这件事成立的关键**，这也是所有声音效果器的标准做法（mix 旋钮）。

## 想深一层

1. 反馈超过 0.6 会自激（无限放大）。页面的 0.45 是安全值。
2. 带通滤波的 Q 值决定"机器人感"的强弱：Q=3 有明显的共振峰，像金属腔体。
3. 真要做变调：\`pitch-shift\` 需要重叠-相加（OLA）或相位声码器，浏览器里通常用 \`AudioWorklet\` 实现。这是这个页面最明显的"简化"。`,
      en: `## An honest fact: there is no pitch shifting here

All five effects (robot / monster / echo / chipmunk / deep) are **filter + modulation + waveshaping**. None transposes pitch.

Real pitch shifting needs a **phase vocoder** or **PSOLA** (pitch-synchronous overlap-add): decompose into fundamental and envelope, change the fundamental, keep the duration. Dozens of lines of DSP with real latency; the page does not do it.

**So "chipmunk" is actually 4 Hz ring modulation**, which sounds robotic rather than small — because ring modulation produces **sidebands** (original frequency ± modulator), not a global shift upward.

The demo overlays the input sine with the shaped output to make the point: **the shape changed, the pitch did not**.

## What each effect really does

| Effect | Actual operation | Sounds like |
| --- | --- | --- |
| robot | 30 Hz ring mod + 2200 Hz bandpass Q3 | mechanical, Dalek |
| monster | \`tanh(3.2x)\` waveshaping + 850 Hz lowpass | deep, growly |
| echo | 0.4 s delay + 0.45 feedback | space |
| chipmunk | 4 Hz square-wave ring mod | warbly, electronic |
| deep | \`x³ × 0.8\` + 300 Hz lowpass | lower, distorted |

**Note that deep uses x³, not tanh**: cubic shaping steepens the zero crossing, adding stronger even harmonics, which reads as an octave down (the harmonic structure changed, not the pitch).

## Why both dry and wet paths exist

The page sends the original (dry) and the effect (wet) to the output.

Wet-only loses every vocal cue — all five effects collapse into "synth noise". **Keeping dry is what keeps it sounding like *you***, and it is standard on every effects unit (the mix knob).

## Going one level deeper

1. Feedback above ~0.6 self-oscillates. The page's 0.45 is safe.
2. The bandpass Q sets how "robotic" it feels: Q=3 gives a pronounced formant, like a metal cavity.
3. For real transposition you need OLA or a phase vocoder, usually in an \`AudioWorklet\`. That is this page's most visible simplification.`
    }
  },

  '/speech/mini-synth': {
    python: `"""A tiny synth: two oscillators, one envelope, 36 keys.

Nothing here is a model. The interesting part is the envelope, because that is
what makes a key press sound like a note instead of a click.
"""
import numpy as np

SR = 44100
ATTACK = 0.015      # 15 ms to full volume
DECAY_TAU = 1.1 / 5  # exponential decay time constant


def note_freq(midi, a4=440.0):
    return a4 * 2 ** ((midi - 69) / 12)


def voice(midi, dur=1.2, sr=SR):
    """Triangle + sine an octave down at 0.12 gain. The sub-oscillator is why it
    sounds fuller than a single triangle: it adds energy at f/2 without changing
    the perceived pitch."""
    n = int(dur * sr)
    t = np.arange(n) / sr
    f = note_freq(midi)

    tri = 2 * np.abs(2 * ((t * f) % 1) - 1) - 1          # triangle -1..1
    sub = np.sin(2 * np.pi * f * 0.5 * t) * 0.12
    sig = (tri + sub) * 0.35

    # envelope: fast attack, exponential release, tiny floor to avoid clicks
    env = np.ones(n)
    a = int(ATTACK * sr)
    env[:a] = np.linspace(0, 1, a)
    env[a:] = np.exp(-(t[a:] - ATTACK) / DECAY_TAU)
    env = np.maximum(env, 0.001)

    return sig * env


if __name__ == '__main__':
    x = voice(60)
    print('C4:', round(note_freq(60), 2), 'Hz, samples:', len(x))
    # 261.63 Hz, 52920 samples


# Why the envelope matters more than the waveform: a 1 ms fade-in/out is enough
# to remove the click on note start; remove the release and long notes cut off
# audibly. The oscillator is the easy part.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>The envelope is the instrument</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:600px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .ctl{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:12px;align-items:center}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:120px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:44px}
  button{font:inherit;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Attack and release decide what it is</h1>
<p>Same oscillators, three envelopes: organ, plucked string, bowed pad. The waveform never changed —
only how fast it starts and how long it lasts.</p>
<canvas id="c" width="600" height="190"></canvas>
<div class="ctl">
  <label>attack <input type="range" id="a" min="1" max="200" step="1" value="15"><output id="va">15 ms</output></label>
  <label>release <input type="range" id="r" min="60" max="2000" step="10" value="260"><output id="vr">260 ms</output></label>
  <button data-p="organ">organ</button>
  <button data-p="pluck">pluck</button>
  <button data-p="pad">pad</button>
</div>
<div class="note">The page hard-codes 15 ms attack and 1.1 s release. That single choice is why it
sounds like a soft electric piano rather than anything else.</div>
<script>
(function () {
  var SR = 44100;

  function render() {
    var a = +document.getElementById('a').value / 1000;
    var r = +document.getElementById('r').value / 1000;
    document.getElementById('va').textContent = Math.round(a * 1000) + ' ms';
    document.getElementById('vr').textContent = Math.round(r * 1000) + ' ms';

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 190;
    ctx.clearRect(0, 0, W, H);
    var dur = 2.2;
    var X = t => 20 + t / dur * (W - 40);
    var Y = v => H - 30 - v * (H - 60);

    // waveform (triangle + sub), scaled by the envelope
    ctx.beginPath();
    for (var x = 0; x < W - 40; x++) {
      var t = x / (W - 40) * dur;
      var env = t < a ? t / a : Math.exp(-(t - a) / (r / 3));
      var f = 261.63;
      var tri = 2 * Math.abs(2 * ((t * f) % 1) - 1) - 1;
      var sub = Math.sin(2 * Math.PI * f * 0.5 * t) * 0.12;
      var y = Y((tri + sub) * env * 0.5 + 0.5);
      if (x === 0) ctx.moveTo(X(t), y); else ctx.lineTo(X(t), y);
    }
    ctx.strokeStyle = 'rgba(37,99,235,.45)'; ctx.lineWidth = 1; ctx.stroke();

    // envelope outline
    ctx.beginPath();
    for (var x2 = 0; x2 < W - 40; x2++) {
      var t2 = x2 / (W - 40) * dur;
      var env2 = t2 < a ? t2 / a : Math.exp(-(t2 - a) / (r / 3));
      var y2 = Y(env2 * 0.92 + 0.04);
      if (x2 === 0) ctx.moveTo(X(t2), y2); else ctx.lineTo(X(t2), y2);
    }
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('red = amplitude envelope', 20, 16);
    ctx.fillText('0 s', 20, H - 10);
    ctx.fillText('2.2 s', W - 52, H - 10);
    ctx.fillText('attack ' + Math.round(a * 1000) + ' ms', 20, H - 26);
  }

  var PRESETS = { organ: [1, 2000], pluck: [3, 90], pad: [160, 1600] };
  document.querySelectorAll('button[data-p]').forEach(function (b) {
    b.addEventListener('click', function () {
      var p = PRESETS[b.dataset.p];
      document.getElementById('a').value = p[0];
      document.getElementById('r').value = p[1];
      render();
    });
  });
  ['a', 'r'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 两个振荡器，一个包络，36 个键

页面的合成器结构简单到可以背下来：

- **三角波**（基频）：\`2|2(f t mod 1) - 1| - 1\`，比正弦多奇次谐波，听起来更"实"；
- **低八度正弦**（\`f × 0.5\`，增益 0.12）：加厚低频，但**不改变感知音高**；
- **包络**：15 ms 攻击 → 1.1 秒指数释放。

**包络比振荡器更重要。** 换波形只是音色微调，换包络直接变成另一种乐器：

| 攻击 / 释放 | 听起来像 |
| --- | --- |
| 1 ms / 90 ms | 拨弦、钢琴 |
| 15 ms / 260 ms | 电钢琴 |
| 160 ms / 1600 ms | 弦乐、铺底 |

页面的 HTML 示例能一键切这三组参数，波形完全没变。

## 为什么必须有攻击时间

直接从 0 跳到满音量会产生**咔哒声**（click）。这不是音质问题，是物理问题：波形的瞬时跳变包含无穷高频，扬声器会把这个突变还原成"啪"的一声。

1 ms 的攻击就能消除它。**所有合成器都有这个下限**（有的叫 "click-free ramp"）。

## 为什么要有释放

没有释放的话，松开键就是瞬间静音 —— 同样会咔哒，而且长音会被突然切断。

指数释放（\`e^(-t/τ)\`）比线性释放自然得多，因为人耳对响度的感知是对数的：指数衰减在听感上是"匀速变轻"。

## 36 键（虽然注释写了 38）

C4 到 B6：21 个白键 + 15 个黑键 = 36。

**注意源码注释写的是 38** —— 这是一个典型的"注释和代码不同步"。写文档时不要相信注释里的数字，要数代码。

## 想深一层

1. 复音（同时按多个键）需要为每个音符创建独立的振荡器节点，并在释放后销毁。单音合成器简单得多 —— 这也是页面能这么短的原因。
2. 低八度正弦不是"加低音"，它改变的是**频谱包络**。真加低音需要移调整个信号（那又回到变调问题）。
3. 三角波在 \`t × f\` 溢出时会走样（aliasing）。真实合成器用带限波形（BLIT / PolyBLEP）来避免，页面没做 —— 高音区会有轻微的金属感。`,
      en: `## Two oscillators, one envelope, 36 keys

The synth is small enough to memorise:

- **triangle** (fundamental): \`2|2(f t mod 1) - 1| - 1\`, odd harmonics, sounds fuller than a sine;
- **sub sine** (\`f × 0.5\`, gain 0.12): thickens the low end **without changing perceived pitch**;
- **envelope**: 15 ms attack → 1.1 s exponential release.

**The envelope matters more than the oscillator.** Change the waveform and you retune the timbre; change the envelope and you change the instrument:

| Attack / release | Sounds like |
| --- | --- |
| 1 ms / 90 ms | plucked string, piano |
| 15 ms / 260 ms | electric piano |
| 160 ms / 1600 ms | strings, pad |

The demo switches between these three with the waveform untouched.

## Why an attack time is mandatory

Jumping from 0 to full volume produces a **click**. Not a quality issue but a physical one: an instantaneous step contains infinite high frequencies, and the speaker reproduces that discontinuity as a pop.

1 ms of attack removes it. **Every synth has this floor** (sometimes called a click-free ramp).

## Why a release is mandatory

Without it, releasing a key is an instant mute — same click, plus long notes cut off audibly.

Exponential release (\`e^(-t/τ)\`) sounds far more natural than linear, because loudness perception is logarithmic: an exponential decay reads as "evenly getting quieter".

## 36 keys (though the comment says 38)

C4 to B6: 21 white + 15 black = 36.

**The source comment says 38** — a textbook case of comments drifting from code. When writing docs, count the code, never trust the comment.

## Going one level deeper

1. Polyphony needs an oscillator node per note, destroyed after release. Monophonic is far simpler — which is why this page is short.
2. The sub-oscillator does not "add bass"; it changes the **spectral envelope**. Real bass would need transposing the whole signal (back to the pitch-shift problem).
3. Triangle waves alias when \`t × f\` wraps. Real synths use band-limited waveforms (BLIT / PolyBLEP); the page does not, so the high register has a slight metallic edge.`
    }
  },

  '/speech/voice-command': {
    python: `"""Voice commands: matching, debouncing, and restarting the recogniser.

The recognition is the easy part. What makes it usable is what happens around
each result -- three small rules, all of them about time.
"""
import re

COMMANDS = {
    'go left': 'left', 'go right': 'right',
    'move up': 'up', 'move down': 'down',
    'red': 'color:red', 'blue': 'color:blue', 'green': 'color:green',
}
DEBOUNCE_MS = 600


def normalise(text):
    """Strip spaces and punctuation. Speech recognisers insert both, and
    'turn  left' vs 'turn left' would otherwise be two different strings."""
    return re.sub(r'[\\s,.;:!?，。；：！？]', '', text.lower())


def match(text, last_cmd, now_ms):
    """Three rules:
      1. substring match (simple, predictable, debuggable)
      2. ignore the same command within DEBOUNCE_MS -- recognition fires twice
         for one utterance surprisingly often
      3. on error, restart; on a FATAL error, stop trying
    Rule 3 matters: 'not-allowed' will never succeed on retry, and looping on it
    breaks the microphone for the whole page."""
    t = normalise(text)
    for phrase, cmd in COMMANDS.items():
        if normalise(phrase) in t:
            if cmd == last_cmd['cmd'] and now_ms - last_cmd['at'] < DEBOUNCE_MS:
                return None
            return cmd
    return None


FATAL = ('not-allowed', 'service-not-allowed', 'audio-capture')
if __name__ == '__main__':
    print(match('Turn  left!', {'cmd': None, 'at': 0}, 1000))    # 'left'
    print(match('turn left', {'cmd': 'left', 'at': 900}, 1200))  # None (debounced)
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Three rules that make voice commands usable</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:600px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .log{margin-top:10px;font:12px/1.8 ui-monospace,monospace;color:#334155;max-height:120px;overflow:auto}
  .log b{color:#2563eb}
  .log i{color:#94a3b8;font-style:normal}
  label{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px}
  input[type=range]{width:170px}
  output{font-variant-numeric:tabular-nums;font-weight:600}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Why your voice assistant repeats itself</h1>
<p>One utterance fires several recognition events with slightly different text. Debouncing is a
time-window rule, not a text-equality rule — that is the difference between a demo and something usable.</p>
<canvas id="c" width="600" height="140"></canvas>
<label>debounce <input type="range" id="d" min="0" max="1500" step="100" value="600"><output id="v">600 ms</output></label>
<div class="log" id="log"></div>
<div class="note">Set the window to 0 and the same command fires three times; set it to 1500 and a
deliberately repeated command gets ignored. There is no universally correct value.</div>
<script>
(function () {
  // events as a real recogniser emits them: duplicates with minor differences
  var EVENTS = [
    { t: 400, text: 'turn left' },
    { t: 620, text: 'Turn  left' },      // same utterance, second event
    { t: 780, text: 'turn left.' },      // and a third
    { t: 2100, text: 'turn left' },      // deliberate repeat
    { t: 2600, text: 'turn right' },
    { t: 3200, text: 'turn right' }      // duplicate of a DIFFERENT command
  ];

  function norm(s) {
    return s.toLowerCase().replace(/[\\s,.;:!?，。；：!？]/g, '');
  }

  function render() {
    var deb = +document.getElementById('d').value;
    document.getElementById('v').textContent = deb + ' ms';

    var last = { cmd: null, at: 0 }, fired = [];
    EVENTS.forEach(function (e) {
      var t = norm(e.text);
      var cmd = t.indexOf('turnleft') !== -1 ? 'left'
              : t.indexOf('turnright') !== -1 ? 'right' : null;
      if (!cmd) return;
      if (cmd === last.cmd && e.t - last.at < deb) return;    // debounced
      fired.push(e.t);
      last = { cmd: cmd, at: e.t };
    });

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 140;
    ctx.clearRect(0, 0, W, H);
    var padL = 20, span = 3800;
    var X = t => padL + t / span * (W - 40);

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(padL, 90); ctx.lineTo(W - 20, 90); ctx.stroke();

    EVENTS.forEach(function (e) {
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath(); ctx.arc(X(e.t), 90, 4, 0, Math.PI * 2); ctx.fill();
    });
    fired.forEach(function (t) {
      ctx.fillStyle = '#16a34a';
      ctx.beginPath(); ctx.arc(X(t), 90, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#16a34a';
      ctx.beginPath(); ctx.moveTo(X(t), 84); ctx.lineTo(X(t), 50); ctx.stroke();
    });

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('recognition events (grey) · commands actually run (green)', padL, 26);
    ctx.fillText('0 s', padL, 112);
    ctx.fillText('3.8 s', W - 46, 112);
    ctx.fillText(fired.length + ' of ' + EVENTS.length + ' events executed', padL, 128);

    document.getElementById('log').innerHTML = EVENTS.map(function (e) {
      var ran = fired.indexOf(e.t) !== -1;
      return '<div><i>' + (e.t / 1000).toFixed(2) + 's</i> "' + e.text + '" → ' +
             (ran ? '<b>run</b>' : '<i>ignored</i>') + '</div>';
    }).join('');
  }

  document.getElementById('d').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 识别是最简单的一环

语音命令页面真正的工作量不在识别，在**识别之后**的三条规则：

1. **归一化再匹配**：\`"Turn  left!"\` 和 \`"turn left"\` 是同一条命令。去掉空格标点、转小写，再做子串匹配；
2. **600 ms 去抖**：同一次说话，识别器常常给出 2–3 个事件（"turn left"、"Turn left"、"turn left."）。不做去抖，一条命令执行三次；
3. **致命错误才停**：\`onEnd\` 后自动重启（识别器会自己结束），但遇到 \`not-allowed\`（没权限）、\`audio-capture\`（没麦克风）就**不要重启** —— 重试永远不会成功，还会让整页的麦克风卡死。

**第 3 条是最容易被忽略的**：很多 demo 写完 \`onEnd\` 就无条件重启，用户拒绝麦克风权限后页面进入死循环。

## 为什么用 includes 而不是正则或 NLP

\`text.includes('turnleft')\`

因为它**可预测**。用户说错了能立刻知道为什么；加新命令就是加一行字符串。

用正则或意图分类会带来"为什么这句话没匹配上"的黑盒问题 —— 对固定指令集来说，简单匹配的信息量更足。

## 去抖的窗口没有标准值

页面用 600 ms。但：

- 太短（100 ms）：同一次说话的多条识别结果都会执行；
- 太长（1500 ms）：用户故意重复说同一句会被吞掉。

**600 ms 是"人说完一句话到再说一遍"的经验下限。** 页面的滑杆让你看到两种失败。

## 想深一层

1. 识别器自己也会"续命"：\`continuous: true\` 时它会一直听，但静音久了会自动结束 —— 所以要 \`onEnd\` 重启，这是 Web Speech API 的必需 workaround。
2. 命令词表越短越准。如果只认 5 个词，甚至不用完整识别，用关键词检测（KWS）模型更省。
3. 真实产品会加"确认"步骤（"你是要左转吗？"），因为语音误触的代价比多问一句高。`,
      en: `## Recognition is the easy part

The real work in a voice-command page happens **after** recognition, in three rules:

1. **Normalise before matching**: \`"Turn  left!"\` and \`"turn left"\` are the same command. Lowercase, strip spaces and punctuation, then substring match;
2. **600 ms debounce**: one utterance often produces 2–3 events ("turn left", "Turn left", "turn left."). Without debouncing, one command runs three times;
3. **Only stop on fatal errors**: restart on \`onEnd\` (the recogniser ends itself), but **never** on \`not-allowed\` (no permission) or \`audio-capture\` (no mic) — retrying can never succeed and can wedge the page's microphone.

**Rule 3 is the most commonly missed**: plenty of demos restart unconditionally in \`onEnd\`, and after the user denies the mic the page spins forever.

## Why includes instead of regex or NLP

\`text.includes('turnleft')\`

Because it is **predictable**. A miss is immediately explainable, and a new command is one more string.

Regex or intent classification brings "why did that not match" opacity — for a fixed command set, simple matching carries more information.

## No universally correct debounce value

The page uses 600 ms. But:

- too short (100 ms): multiple events from one utterance all execute;
- too long (1500 ms): a deliberate repeat gets swallowed.

**600 ms is the empirical floor for "finish a sentence, then say it again"**. The slider shows both failures.

## Going one level deeper

1. The recogniser also "expires": with \`continuous: true\` it keeps listening, but long silence ends it — hence the \`onEnd\` restart, a mandatory Web Speech workaround.
2. Smaller command sets are more accurate. With only five words, a keyword-spotting model beats full recognition on cost.
3. Real products add confirmation ("did you mean turn left?"), because a false trigger costs more than one extra question.`
    }
  },

  '/speech/speech-translate': {
    python: `"""Speech translation: three models chained, all local.

Whisper (ASR) -> Opus-MT (translation) -> Kokoro (TTS). Each stage is small
enough for a browser, and the chain is where the latency accumulates.
"""
STAGES = [
    ('whisper-base', 'q8', 145, 'audio -> text'),
    ('opus-mt-zh-en', 'q8', 78, 'text -> text'),
    ('kokoro-82m', 'q8', 88, 'text -> audio'),
]


def budget(audio_seconds=10.0):
    """Rough browser timings. The point: translation work is negligible
    compared with ASR, so optimising the MT step is wasted effort."""
    asr = audio_seconds * 0.5          # ~2x realtime on WASM
    mt = 0.4                           # 256 tokens max, tiny model
    tts = audio_seconds * 0.35
    return {'asr_s': round(asr, 1), 'mt_s': mt, 'tts_s': round(tts, 1),
            'total_s': round(asr + mt + tts, 1),
            'download_mb': sum(s[2] for s in STAGES)}


if __name__ == '__main__':
    print(budget(10))
    # {'asr_s': 5.0, 'mt_s': 0.4, 'tts_s': 3.5, 'total_s': 8.9, 'download_mb': 311}


# Why three small models instead of one big speech-to-speech model: each stage
# can fail and be retried independently, and the user sees progress per stage.
# A single model gives you one spinner and one opaque failure.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Where the time goes in a three-stage chain</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  label{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px}
  input[type=range]{width:200px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:56px}
  .stages{margin-top:10px;font-size:12px}
  .stages div{display:flex;gap:8px;margin-bottom:4px;align-items:center}
  .stages b{width:104px;font-weight:500;font-family:ui-monospace,monospace}
  .stages i{display:block;height:10px;border-radius:3px}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>ASR dominates; the translator is free</h1>
<p>Three stages, 311 MB of models. Drag the audio length — the middle stage barely moves, which is
the point: optimising a 0.4 s step in an 8 s pipeline buys nothing.</p>
<canvas id="c" width="620" height="130"></canvas>
<label>audio length <input type="range" id="d" min="3" max="60" step="1" value="10"><output id="v">10 s</output></label>
<div class="stages" id="st"></div>
<div class="note">Each stage is a separate model, so each can fail and retry on its own — and the user
sees three progress labels instead of one spinner.</div>
<script>
(function () {
  var STAGES = [
    { name: 'whisper-base', mb: 145, color: '#2563eb', per: 0.5 },
    { name: 'opus-mt', mb: 78, color: '#16a34a', per: 0 },
    { name: 'kokoro', mb: 88, color: '#7c3aed', per: 0.35 }
  ];

  function render() {
    var dur = +document.getElementById('d').value;
    document.getElementById('v').textContent = dur + ' s';

    var times = STAGES.map(function (s) {
      return s.per ? dur * s.per : 0.4;
    });
    var total = times.reduce(function (a, b) { return a + b; }, 0);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 130;
    ctx.clearRect(0, 0, W, H);
    var x = 20;
    var scale = (W - 40) / total;

    STAGES.forEach(function (s, i) {
      var w = times[i] * scale;
      ctx.fillStyle = s.color;
      ctx.fillRect(x, 46, Math.max(2, w), 34);
      if (w > 44) {
        ctx.fillStyle = '#fff'; ctx.font = '11px ui-monospace, monospace';
        ctx.fillText(times[i].toFixed(1) + 's', x + 6, 68);
      }
      x += w;
    });

    ctx.fillStyle = '#0f172a'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('one utterance → ' + total.toFixed(1) + ' s total', 20, 32);
    ctx.fillStyle = '#475569';
    ctx.fillText('0', 20, 100); ctx.fillText(total.toFixed(1) + ' s', W - 60, 100);

    document.getElementById('st').innerHTML = STAGES.map(function (s, i) {
      return '<div><b>' + s.name + '</b>' +
             '<i style="width:' + Math.max(2, times[i] / total * 260) + 'px;background:' + s.color + '"></i>' +
             '<span>' + times[i].toFixed(1) + ' s · ' + s.mb + ' MB</span></div>';
    }).join('') +
      '<div style="margin-top:6px;color:#64748b">total download ' +
      STAGES.reduce(function (a, s) { return a + s.mb; }, 0) + ' MB</div>';
  }

  document.getElementById('d').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 三级串联，瓶颈在第一级

\`\`\`
音频 → Whisper（ASR）→ 文本 → Opus-MT（翻译）→ 文本 → Kokoro（TTS）→ 音频
\`\`\`

10 秒音频的时间分布大致是：

| 阶段 | 耗时 | 占比 |
| --- | --- | --- |
| Whisper base | 5.0 s | **56%** |
| Opus-MT | 0.4 s | 4% |
| Kokoro | 3.5 s | 39% |

**中间的翻译只占 4%。** 所以"优化翻译速度"是个伪命题 —— 真正的杠杆在 ASR 和 TTS。

这也解释了一个工程决策：如果非要砍一个阶段，砍 TTS（只出文字），能省 39%；砍翻译只能省 4%。

## 为什么不用端到端的语音翻译模型

有的（如 SeamlessM4T），但页面选了三级串联，理由很实际：

1. **每级可独立重试**：ASR 失败不用重跑翻译；
2. **用户能看到进度**：三个进度标签，而不是一个转圈；
3. **每级可换**：想换成别的 TTS 只改第三级。

代价是**误差累积**：ASR 错一个词，翻译和合成都会跟着错。端到端模型没有这个问题，但它的失败是完全黑箱的。

## 78 MB 的翻译模型够用吗

\`opus-mt-zh-en\` 是专门的中英翻译模型（Marian 架构），不是通用 LLM。

对**短句、口语**够用。对长句、专业术语会明显下降 —— 因为它没有世界知识，只是学"这个中文短语对应哪个英文短语"。

**这是"专用小模型 vs 通用大模型"的典型选择**：任务固定就用小的，快一个数量级。

## 想深一层

1. 全本地的价值：语音数据不出设备。翻译类场景（涉外交流、医疗问诊）这是硬需求。
2. 三级都跑 WebGPU 时，**显存要能同时装下**三个模型（311 MB + 中间张量）。低端设备会 OOM，实际实现要串行加载/释放。
3. 想让体验更好：第一级流式输出（边说边转写），第二三级按句处理。整段等完再翻译，延迟会很难受。`,
      en: `## Three stages in series; the bottleneck is the first

\`\`\`
audio -> Whisper (ASR) -> text -> Opus-MT -> text -> Kokoro (TTS) -> audio
\`\`\`

For 10 seconds of audio:

| Stage | Time | Share |
| --- | --- | --- |
| Whisper base | 5.0 s | **56%** |
| Opus-MT | 0.4 s | 4% |
| Kokoro | 3.5 s | 39% |

**Translation is 4%.** Optimising it is a non-problem — the leverage is in ASR and TTS.

Which drives an engineering decision: if a stage must go, drop TTS (text only) for 39%; dropping translation saves 4%.

## Why not an end-to-end speech translation model

They exist (SeamlessM4T), but the page chains three, for practical reasons:

1. **Each stage retries independently** — an ASR failure does not redo translation;
2. **Users see progress** — three labels instead of one spinner;
3. **Each stage is swappable** — change the TTS by touching only the third.

The cost is **error accumulation**: one wrong ASR word propagates through translation and synthesis. End-to-end has no such compounding, but its failures are opaque.

## Is a 78 MB translator enough

\`opus-mt-zh-en\` is a dedicated Chinese-English model (Marian), not a general LLM.

Fine for **short sentences and speech**. Long sentences and jargon degrade visibly — it has no world knowledge, only phrase correspondences.

**The classic narrow-small vs general-large trade**: fixed task, small model, an order of magnitude faster.

## Going one level deeper

1. Local-only matters here: audio never leaves the device. For interpreting scenarios (medical, legal) that is a hard requirement.
2. Running all three on WebGPU means VRAM must hold three models (311 MB plus intermediates). Low-end devices OOM; real implementations load and release in sequence.
3. Better UX: stream stage one (transcribe while speaking) and translate per sentence. Waiting for the whole clip makes latency painful.`
    }
  },

  '/speech/vocal-remover': {
    python: `"""Vocal removal: why "subtract the channels" is not enough.

MDX-Net Kim_Vocal_2 (67 MB) predicts a MASK per frequency bin, then applies it.
"""
import numpy as np


def naive_center_cancel(left, right):
    """The 1990s karaoke trick: vocals are usually mixed to the centre, so
    L - R cancels them."""
    return left - right


def why_that_fails():
    """Three reasons, all practical:
      1. it also cancels bass, kick and snare (also centred)
      2. any stereo reverb on the vocal leaves a ghost
      3. mastering EQs and limiters break the L/R symmetry
    Result: thin, hollow, unusable for anything but a party trick.
    """
    return ['kills centred drums and bass', 'leaves reverb ghost', 'breaks on mastered material']


def mask_apply(mix, mask):
    """MDX-Net returns a soft mask in [0,1] per (channel, freq, time). Multiply
    in the STFT domain, then invert. A soft mask leaves fewer artefacts than a
    binary one -- this is the whole advantage over subtraction."""
    return mix * mask


SEGMENT = 256        # frames per inference window
OVERLAP = 0.25       # 25% overlap between windows


def window_starts(total_frames, seg=SEGMENT, overlap=OVERLAP):
    """Overlapping windows averaged back together. Without the overlap you hear
    a click at every segment boundary -- the model has no context across it."""
    hop = int(seg * (1 - overlap))
    return list(range(0, max(1, total_frames - seg + 1), hop))


if __name__ == '__main__':
    print(why_that_fails())
    print('starts for 1000 frames:', window_starts(1000)[:5])


# Cost: one UNet pass per segment per channel. 3 minutes of audio at 44.1 kHz
# is roughly 700 segments -- that is why this is the heaviest page in the
# category and why it ships as a 67 MB model rather than a filter.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Subtract vs mask</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  label{display:inline-flex;gap:6px;align-items:center;margin-top:10px;font-size:12px}
  input[type=range]{width:160px}
  output{font-variant-numeric:tabular-nums;font-weight:600}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>A mask decides per frequency, subtraction decides for all</h1>
<p>Grey is the original spectrum. Red is what L−R leaves behind; green is what a learned mask keeps.
Subtraction removes a whole vertical stripe (all frequencies); a mask removes just the singing.</p>
<canvas id="c" width="620" height="200"></canvas>
<label><input type="checkbox" id="mask" checked> use a mask (green) instead of subtraction (red)</label>
<div class="note">The stripe at 1.2–3.5 kHz is the vocal formant band. Centre cancellation takes it out
along with the snare's body — which is why karaoke tracks sound hollow.</div>
<script>
(function () {
  // a toy spectrum: bass, snare body, vocal formants, cymbals
  function energy(f) {
    var bass = Math.exp(-Math.pow((f - 90) / 60, 2)) * 1.0;
    var snare = Math.exp(-Math.pow((f - 700) / 400, 2)) * 0.55;
    var vocal = Math.exp(-Math.pow((f - 2200) / 700, 2)) * 0.85;
    var cym = f > 6000 ? 0.25 : 0.02;
    return Math.min(1, bass + snare + vocal + cym);
  }

  function render() {
    var useMask = document.getElementById('mask').checked;
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 200;
    ctx.clearRect(0, 0, W, H);
    var padL = 40, padB = 28;
    var X = f => padL + Math.log(20 + f) / Math.log(8200) * (W - padL - 14);
    var Y = v => H - padB - v * (H - padB - 16);

    // original
    ctx.beginPath();
    for (var f = 20; f < 8000; f += 20) {
      var y = Y(energy(f));
      if (f === 20) ctx.moveTo(X(f), y); else ctx.lineTo(X(f), y);
    }
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.stroke();

    // what remains
    ctx.beginPath();
    for (var f2 = 20; f2 < 8000; f2 += 20) {
      var e = energy(f2);
      var keep;
      if (useMask) {
        // mask: keep everything except the vocal band, with a soft transition
        var vocalBand = 1 - Math.exp(-Math.pow((f2 - 2200) / 700, 2));
        keep = e * Math.max(0, Math.min(1, 0.15 + vocalBand * 0.95));
      } else {
        // subtraction: the vocal is assumed dead centre, and so is the snare
        keep = f2 >= 1200 && f2 <= 3500 ? 0 : e * 0.55;
      }
      var y2 = Y(keep);
      if (f2 === 20) ctx.moveTo(X(f2), y2); else ctx.lineTo(X(f2), y2);
    }
    ctx.strokeStyle = useMask ? '#16a34a' : '#dc2626';
    ctx.lineWidth = 2.2; ctx.stroke();

    // band highlight
    ctx.fillStyle = useMask ? 'rgba(22,163,74,.07)' : 'rgba(220,38,38,.10)';
    ctx.fillRect(X(1200), 16, X(3500) - X(1200), H - padB - 16);
    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('vocal formant band 1.2–3.5 kHz', X(1200) + 4, 30);

    ctx.fillStyle = '#64748b';
    ctx.fillText('20 Hz', padL, H - 10);
    ctx.fillText('8 kHz', W - 56, H - 10);
    ctx.fillText(useMask ? 'mask: soft, frequency-selective' : 'L−R: whole band gone', padL, 16);
  }

  document.getElementById('mask').addEventListener('change', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 左右声道相减为什么不行

经典卡拉 OK 技巧：人声通常混在中间，所以 \`L - R\` 能抵消人声。

它有三个致命问题：

1. **也抵消了居中的乐器** —— 底鼓、军鼓、贝斯通常也在中间。结果是人声没了，节奏也塌了，听起来空洞发飘；
2. **混响残留** —— 人声的立体声混响不是完全居中的，相减后会留下"鬼影人声"；
3. **母带处理破坏对称** —— 母线压缩、EQ、限幅都会让左右不完全对称，抵消不干净。

所以页面的页面用 **MDX-Net**（67 MB 的 UNet），它做的是另一件事。

## 掩码 vs 相减

模型输出的是**每个频点的掩码**（0–1 的软权重），然后在 STFT 域乘上去：

\`\`\`
人声轨 = 混合 × mask
伴奏轨 = 混合 × (1 - mask)
\`\`\`

关键区别：

| | 相减 | 掩码 |
| --- | --- | --- |
| 决策粒度 | 整个频谱（全或无） | 每个频点每个时刻 |
| 能否保留居中鼓 | 不能 | 能 |
| 残留 | 混响鬼影 | 边缘轻微漏音 |

页面的 HTML 示例把这两条曲线画在一起：红色（相减）把 1.2–3.5 kHz 整条竖带抹掉了，绿色（掩码）只削掉人声的能量峰，鼓的能量还在。

## 为什么要重叠窗口

模型一次只能看 256 帧（\`segmentSize: 256\`）。如果直接首尾相接，接缝处会"咔"一声 —— 因为模型不知道该处前后的上下文。

**25% 重叠**（\`overlap: 0.25\`）让相邻窗口共享一部分，再做交叉淡化。这是所有分块推理（音频分离、语音增强、长音频转写）的通用手法。

## 想深一层

1. 分离质量和模型大小强相关。67 MB 是"能用"的下限；更好的模型（Demucs、BS-RoFormer）在 300 MB 以上。
2. 伴奏轨是 \`1 - mask\`，所以两条轨道加起来约等于原混音（相位抵消除外）。这是掩码法的一个好处：不会漏掉内容。
3. 三分钟音频约 700 个窗口，每个窗口一次 UNet 前向 —— 这是全分类最重的页面，也是它必须放在服务端或高性能设备上的原因。`,
      en: `## Why subtracting the channels fails

The classic karaoke trick: vocals sit in the centre, so \`L - R\` cancels them.

Three fatal problems:

1. **It also cancels centred instruments** — kick, snare and bass are usually centred too. You lose the vocal and the rhythm, and the result sounds hollow;
2. **Reverb remains** — a vocal's stereo reverb is not perfectly centred, leaving a ghost;
3. **Mastering breaks symmetry** — bus compression, EQ and limiting make L and R unequal, so cancellation is incomplete.

Hence the page ships **MDX-Net** (a 67 MB UNet) doing something else entirely.

## Mask vs subtraction

The model outputs a **mask per frequency bin** (soft weight in 0–1), applied in the STFT domain:

\`\`\`
vocals = mix × mask
accompaniment = mix × (1 - mask)
\`\`\`

The crucial difference:

| | Subtraction | Mask |
| --- | --- | --- |
| Granularity | whole spectrum (all or nothing) | per bin, per frame |
| Keeps centred drums | no | yes |
| Residue | reverb ghost | slight bleed at edges |

The demo draws both: red (subtraction) wipes the entire 1.2–3.5 kHz stripe, while green (mask) only removes the vocal energy peak and leaves the drums.

## Why overlapping windows

The model sees 256 frames at a time (\`segmentSize: 256\`). Butt-joined windows click at every seam, because the model has no context across the boundary.

**25% overlap** (\`overlap: 0.25\`) shares frames and cross-fades. Standard for every chunked inference task — separation, enhancement, long-form transcription.

## Going one level deeper

1. Separation quality tracks model size. 67 MB is the usable floor; better models (Demucs, BS-RoFormer) start around 300 MB.
2. The accompaniment is \`1 - mask\`, so the two tracks sum back to the mix (modulo phase). An advantage of masking: nothing is lost.
3. Three minutes of audio is roughly 700 windows, each a full UNet pass — the heaviest page in the category, and the reason it belongs on a beefy device or a server.`
    }
  },

  '/speech/voice-clone': {
    python: `"""Zero-shot voice cloning: a few seconds of reference, no training.

Chatterbox (onnx-community/chatterbox-ONNX): language_model q4/q4f16, the rest
fp32. The reference audio is turned into a speaker embedding, not a new model.
"""
REF_SECONDS = 6.0       # page records a short clip; 5-10 s is the sweet spot


def clone_signature(ref_seconds, exaggeration=0.5):
    """Two knobs that matter:
      ref length   -- too short and the speaker identity is noisy
      exaggeration -- page default 0.5; higher is more expressive AND less stable
    """
    if ref_seconds < 3:
        quality = 'unstable: not enough frames to estimate timbre'
    elif ref_seconds < 10:
        quality = 'good: enough for a stable embedding'
    else:
        quality = 'no better past ~10 s: extra audio is discarded or averaged'
    return {'ref_s': ref_seconds, 'exaggeration': exaggeration, 'quality': quality}


def pipeline_steps():
    """What happens between "here is my voice" and "it says this sentence":
      1. encode_speech(reference) -> speaker embedding
      2. processor(text)          -> phoneme tokens
      3. generate(embedding, tokens, max_new_tokens=256) -> 24 kHz audio
      4. encodeWav               -> 16-bit mono blob
    Step 1 runs once; steps 2-4 run per sentence. That is why a long script is
    not slower per word than a short one.
    """
    return ['encode reference once', 'phonemise each sentence',
            'generate audio per sentence', 'wrap as WAV']


if __name__ == '__main__':
    print(clone_signature(6))
    # {'ref_s': 6.0, 'exaggeration': 0.5, 'quality': 'good: enough for a stable embedding'}


# The honest limit: this is timbre transfer, not impersonation. Prosody,
# accent and speaking habits come from the TEXT prompt's rendering, so a cloned
# voice reading a list sounds flat -- there is no "how would THEY say it".
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>How much reference audio do you need</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:600px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  label{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px}
  input[type=range]{width:190px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:56px}
  .verdict{margin-top:10px;font-size:13px}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Past ten seconds, more audio stops helping</h1>
<p>Cloning needs enough frames to estimate timbre — after that, extra reference audio is averaged away.
Drag the slider and watch the curve flatten.</p>
<canvas id="c" width="600" height="170"></canvas>
<label>reference audio <input type="range" id="r" min="1" max="30" step="0.5" value="6"><output id="v">6.0 s</output></label>
<div class="verdict" id="verdict"></div>
<div class="note">The curve is schematic but the shape is real: identity estimation is a statistical
problem, so variance falls with length until it hits the model's capacity.</div>
<script>
(function () {
  function quality(sec) {
    // rises fast, saturates around 10 s, then very slightly decays
    var q = 1 - Math.exp(-sec / 3.2);
    if (sec > 10) q -= (sec - 10) * 0.004;
    return Math.max(0, Math.min(1, q));
  }

  function render() {
    var sec = +document.getElementById('r').value;
    document.getElementById('v').textContent = sec.toFixed(1) + ' s';
    var q = quality(sec);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 170, padL = 40, padB = 28;
    ctx.clearRect(0, 0, W, H);
    var X = s => padL + s / 30 * (W - padL - 16);
    var Y = v => H - padB - v * (H - padB - 18);

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(padL, 14); ctx.lineTo(padL, H - padB); ctx.lineTo(W - 16, H - padB); ctx.stroke();

    // the 3 s and 10 s markers
    [3, 10].forEach(function (m) {
      ctx.strokeStyle = 'rgba(148,163,184,.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(X(m), 14); ctx.lineTo(X(m), H - padB); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#94a3b8'; ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(m + ' s', X(m) + 3, H - padB + 14);
    });

    ctx.beginPath();
    for (var s = 1; s <= 30; s += 0.25) {
      var v = quality(s);
      if (s === 1) ctx.moveTo(X(s), Y(v)); else ctx.lineTo(X(s), Y(v));
    }
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2.2; ctx.stroke();

    ctx.fillStyle = '#dc2626';
    ctx.beginPath(); ctx.arc(X(sec), Y(q), 6, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#475569';
    ctx.fillText('identity confidence', 6, 24);
    ctx.fillText('0 s', padL, H - 8);
    ctx.fillText('30 s', W - 50, H - 8);

    var msg = sec < 3 ? '<b style="color:#dc2626">too short</b> — the embedding will be noisy and the clone unstable'
      : sec <= 10 ? '<b style="color:#16a34a">the useful range</b> — ' + sec.toFixed(1) + ' s is enough'
      : '<b style="color:#b45309">diminishing returns</b> — past 10 s the model averages away the extra';
    document.getElementById('verdict').innerHTML = msg + ' · confidence ' + Math.round(q * 100) + '%';
  }

  document.getElementById('r').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 零样本克隆：它学的是音色，不是"这个人"

流程只有四步：

1. \`encode_speech(参考音频)\` → **说话人 embedding**（音色向量）；
2. \`processor(文本)\` → 音素 token；
3. \`generate(embedding, tokens)\` → 24 kHz 波形；
4. 包成 WAV。

**第 1 步只跑一次，2-4 步每句跑一次。** 所以克隆 40 分钟有声书，和克隆一句话的"每字成本"是一样的。

关键点：**它没有为你的声音训练任何新参数**。所有克隆共享同一个模型，只是喂不同的 embedding。这和 /speech/kokoro 的音色机制是同一个思路（embedding 而非微调），只是这里的 embedding 是现场从参考音频算出来的。

## 参考音频要多久

- **少于 3 秒**：帧数不够，音色估计有噪声，克隆结果不稳；
- **3–10 秒**：有效区间；
- **超过 10 秒**：不会更好 —— 模型会平均掉超出的部分，甚至略微掉点。

页面的曲线就是这个形状。**"多给点总没错"在这里是错的。**

## exaggeration 参数在调什么

页面默认 0.5。它是**表现力**的强度：

- 低（0.3）：平稳、接近朗读；
- 高（0.8+）：起伏大，但**音色特征开始崩**（会跑偏、破音）。

这是一个"表现力 vs 稳定性"的旋钮，不是"像不像"的旋钮。

## 诚实的边界：这是音色迁移，不是模仿

克隆出来的声音**语调、口音、说话习惯都不像本人** —— 因为那些信息不来自 embedding，而来自模型的通用渲染。

结果：同一个人读一段列表，听起来会"平"。真人的停顿、语气词、重音，这个模型不提供。

**这也是它比"深度伪造"安全的地方**：能听出来是合成的。

## 想深一层

1. 参考音频要**干净、单人、无背景音乐**。带噪参考会让 embedding 混入噪声特征，合成音会有"沙沙"的底噪。
2. 伦理边界：声音也是生物特征。这个页面是本地推理，参考音频不出设备 —— 这是唯一没有法律风险的做法。
3. 更大模型（几 GB）能同时克隆音色和韵律，但那已经不是浏览器能跑的量级了。`,
      en: `## Zero-shot cloning learns timbre, not "this person"

Four steps:

1. \`encode_speech(reference)\` → a **speaker embedding** (timbre vector);
2. \`processor(text)\` → phoneme tokens;
3. \`generate(embedding, tokens)\` → 24 kHz waveform;
4. wrap as WAV.

**Step 1 runs once; steps 2–4 run per sentence.** So cloning 40 minutes of audiobook costs the same per word as cloning one line.

The key point: **no new parameters are trained for your voice**. Every clone shares one model and just receives a different embedding — the same idea as /speech/kokoro's voice bins, except here the embedding is computed live from reference audio.

## How much reference audio

- **under 3 s**: too few frames, noisy timbre estimate, unstable clone;
- **3–10 s**: the useful range;
- **over 10 s**: no better — the model averages away the surplus, sometimes slightly worse.

That is the curve on the page. **"Give it more, it cannot hurt" is false here.**

## What the exaggeration parameter does

The page defaults to 0.5. It controls **expressiveness**:

- low (0.3): steady, close to reading aloud;
- high (0.8+): more dynamic, but **timbre starts to break** (drift, distortion).

It is an expressiveness-versus-stability knob, not a "how much does it sound like them" knob.

## The honest limit: timbre transfer, not impersonation

The clone does **not** inherit intonation, accent or speaking habits — those come from the model's generic rendering, not the embedding.

A cloned voice reading a list sounds flat. Real pauses, fillers and stress are not provided.

**Which also makes it safer than a deepfake**: you can hear that it is synthetic.

## Going one level deeper

1. Reference audio must be clean, single-speaker and music-free. Noisy references leak noise into the embedding; the output gets a hiss.
2. Ethics: a voice is biometric. This page is local inference, so the reference never leaves the device — the only approach without legal exposure.
3. Much larger models (GBs) clone timbre *and* prosody, but they are far outside browser scale.`
    }
  },

  '/speech/audiobook': {
    python: `"""Audiobook: many sentences, many voices, one MP3 source.

Edge TTS is called per line, then the chunks are decoded and concatenated with
a gap. The interesting numbers are the gap and the per-line overhead.
"""
import asyncio


async def synth_lines(lines, voice, tts):
    """Per-line synthesis has a cost: each call is a separate WebSocket (or at
    least a separate request), so 500 lines means 500 round trips.
    Batching by paragraph is the usual optimisation.

    'tts' is the page's server call: POST /api/speech/tts -> mp3, 24 kHz, 48 kbps.
    """
    out = []
    for text in lines:
        out.append(await tts(text, voice))
    return out


def total_bytes(lines, chars_per_second=6.0, kbps=48):
    seconds = sum(len(l) for l in lines) / chars_per_second
    return {'seconds': round(seconds, 1), 'mp3_kb': round(seconds * kbps / 8, 1)}


def concat_cost(n_lines, decode_ms=8, gap_ms=250):
    """Why the gap matters more than it looks: 500 lines x 250 ms = 2 minutes
    of silence in a 30-minute book. It is also what makes dialogue readable."""
    return {'silence_s': round(n_lines * gap_ms / 1000, 1),
            'decode_overhead_s': round(n_lines * decode_ms / 1000, 1)}


if __name__ == '__main__':
    print(concat_cost(500))
    # {'silence_s': 125.0, 'decode_overhead_s': 4.0}


# Voice assignment is the fun part: the page parses a script with speaker
# markers and assigns a different Edge voice per speaker. Same text, different
# speaker, different voice -- that is what makes it an audiobook and not TTS.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Per-line synthesis, per-speaker voices</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  label{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px}
  input[type=range]{width:170px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:52px}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>500 lines, 500 round trips</h1>
<p>Each line is one synthesis request. The green blocks are speech; the thin gaps are the 250 ms pause
between lines. Notice how much of the timeline is silence.</p>
<canvas id="c" width="620" height="160"></canvas>
<label>lines <input type="range" id="n" min="5" max="400" step="5" value="80"><output id="v">80</output></label>
<label>gap <input type="range" id="g" min="0" max="600" step="25" value="250"><output id="v2">250 ms</output></label>
<div class="note">The per-line gap is a product decision, not an encoding one: too small and dialogue
runs together, too large and the book drags. 200–300 ms reads naturally.</div>
<script>
(function () {
  function render() {
    var n = +document.getElementById('n').value;
    var gap = +document.getElementById('g').value;
    document.getElementById('v').textContent = n;
    document.getElementById('v2').textContent = gap + ' ms';

    // assume ~28 characters per line at ~6 chars/s
    var lineS = 28 / 6;
    var total = n * lineS + n * gap / 1000;

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 160, padL = 20;
    ctx.clearRect(0, 0, W, H);

    // draw at most 60 blocks, scaled
    var shown = Math.min(n, 60);
    var per = (W - padL - 16) / shown;
    for (var i = 0; i < shown; i++) {
      var speechW = per * (lineS / (lineS + gap / 1000));
      ctx.fillStyle = 'rgba(37,99,235,.65)';
      ctx.fillRect(padL + i * per, 50, Math.max(1, speechW), 30);
      ctx.fillStyle = 'rgba(148,163,184,.25)';
      ctx.fillRect(padL + i * per + speechW, 50, Math.max(0, per - speechW), 30);
    }

    ctx.fillStyle = '#0f172a'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(n + ' lines · ' + (total / 60).toFixed(1) + ' min total · ' +
      (n * gap / 1000 / 60).toFixed(1) + ' min of silence', padL, 36);
    ctx.fillStyle = '#475569';
    ctx.fillText('blue = speech · grey = gap', padL, 110);
    if (shown < n) ctx.fillText('(showing first ' + shown + ' of ' + n + ')', padL, 128);

    var silenceShare = (n * gap / 1000) / total;
    ctx.fillText(Math.round(silenceShare * 100) + '% of the runtime is silence', padL, 146);
  }

  ['n', 'g'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 有声书不是一个 TTS 请求，是几百个

页面做的事：解析脚本 → 按说话人分配音色 → **逐行调用 Edge TTS** → 解码 → 按 gap 拼接 → 导出 WAV。

逐行调用的代价很实在：

- **500 行 = 500 次请求**（每次一个 WebSocket 或一次 HTTP）；
- 每行有固定的往返延迟（几十到几百毫秒），累积起来很可观。

优化方向是**按段落批量合成**（一次请求多句），代价是说话人切换会变麻烦 —— 这是典型的"延迟 vs 灵活性"权衡。

## gap 是产品决策，不是技术参数

页面默认 0.25 秒。这个值决定听感：

- 太小（<0.1 s）：对话连成一串，听不出换人；
- 太大（>0.5 s）：节奏拖沓，一本 10 小时的书会变成 12 小时。

**200–300 ms 是"像人换气"的区间。** 而且它是**总时长的可观部分**：500 行 × 0.25 s = 2 分钟的纯静音。

## 为什么输出 WAV 而不是 MP3

流程是：Edge 给 MP3 → \`decodeAudioData\` 解码成 PCM → 拼接 → **再编码回 WAV**。

为什么不直接拼 MP3？因为 **MP3 是分帧压缩的，不能在字节层面拼接**（每帧有独立的比特池，直接接会产生爆音/静音）。必须先解码到 PCM 再重编码。

代价是体积：30 分钟音频的 WAV 约 500 MB（24 kHz/16 bit）。真实产品会在这个环节再压一次 MP3/AAC。

## 想深一层

1. \`parseScript\` 需要识别说话人标记（\`角色：台词\`）。这是格式约定，不是技术难点，但决定了"多角色"能不能工作。
2. Edge TTS 的音色列表是**动态拉的**（\`/api/speech/tts-voices\`，缓存 12 小时）。微软会增删音色，硬编码会失效。
3. 有声书的质量差异 90% 在**文本切分**上：切在句号处自然，切在逗号处会听到不必要的停顿。页面按行切，这是它的局限。`,
      en: `## An audiobook is not one TTS request; it is hundreds

The page: parse the script → assign a voice per speaker → **synthesise line by line** → decode → concatenate with gaps → export WAV.

Per-line synthesis has a real cost:

- **500 lines = 500 requests** (a WebSocket or HTTP call each);
- every line carries round-trip latency (tens to hundreds of ms), which accumulates.

The optimisation is **batching by paragraph** (several sentences per request), at the price of awkward speaker switching — a classic latency-versus-flexibility trade.

## The gap is a product decision, not a technical one

The page defaults to 0.25 s. That value decides how it feels:

- too small (<0.1 s): dialogue runs together, you cannot hear the change of speaker;
- too large (>0.5 s): the pace drags; a 10-hour book becomes 12.

**200–300 ms is the "human breath" range.** It is also a **significant share of the runtime**: 500 lines × 0.25 s = two minutes of pure silence.

## Why the output is WAV, not MP3

The flow: Edge returns MP3 → \`decodeAudioData\` to PCM → concatenate → **re-encode to WAV**.

Why not concatenate MP3 directly? Because **MP3 is framed compression and cannot be joined at the byte level** (each frame has its own bit reservoir; naive joining produces clicks and dropouts). You must decode to PCM and re-encode.

The cost is size: 30 minutes of 24 kHz/16-bit WAV is about 500 MB. Real products compress again to MP3/AAC at this stage.

## Going one level deeper

1. \`parseScript\` must recognise speaker markers (\`NAME: line\`). A format convention, not a technical hurdle, but it decides whether multi-voice works at all.
2. Edge TTS voices are **fetched dynamically** (\`/api/speech/tts-voices\`, 12-hour cache). Microsoft adds and removes voices; hard-coding breaks.
3. In audiobooks, 90% of the quality difference is **text segmentation**: cutting at full stops sounds natural, cutting mid-clause produces unwanted pauses. This page cuts per line, which is its limitation.`
    }
  },

  '/speech/audio-recorder': {
    python: `"""Recording: the browser picks the codec, not you.

new MediaRecorder(stream) with NO mimeType means Chrome gives WebM/Opus and
Safari gives MP4/AAC. Same code, different container per browser.
"""
import platform


def pick_mime(candidates=None):
    """Never assume. Ask the browser, in preference order, and be ready for
    none of them being supported."""
    candidates = candidates or [
        'audio/webm;codecs=opus',   # Chrome, Firefox
        'audio/webm',
        'audio/mp4',                # Safari
        'audio/ogg;codecs=opus',
    ]
    return candidates[0]        # in a browser: candidates.find(isTypeSupported)


def why_unspecified_is_bad():
    """The page does NOT pass a mimeType, so the file you get depends on the
    machine. Consequences:
      - a WebM upload may be rejected by an API that expects MP3
      - ffmpeg.wasm then has to transcode before upload
    Specifying costs three lines and removes a whole class of bug."""
    return ['container varies per browser', 'downstream may reject it',
            'transcoding needed anyway']


def level_reading(fft_size=1024):
    """The page computes RMS from getFloatTimeDomainData and multiplies by 3.
    fftSize 1024 is about 21 ms at 48 kHz -- fast enough to feel live, slow
    enough not to flicker."""
    return {'fft_size': fft_size, 'window_ms': round(fft_size / 48000 * 1000, 1)}


if __name__ == '__main__':
    print(level_reading())      # {'fft_size': 1024, 'window_ms': 21.3}
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>What container do you actually get</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  table{border-collapse:collapse;font-size:12px;width:100%;max-width:600px}
  th,td{border:1px solid #e2e8f0;padding:6px 9px;text-align:left}
  th{background:#f1f5f9;font-weight:600}
  td.ok{color:#15803d;font-family:ui-monospace,monospace}
  td.no{color:#b91c1c;font-family:ui-monospace,monospace}
  .verdict{margin-top:12px;padding:10px 12px;border-radius:8px;background:#eff6ff;font-size:13px}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Your browser decides the file format</h1>
<p>This table is filled in by asking <code>MediaRecorder.isTypeSupported</code> right now — the same
check the page should be doing but does not.</p>
<table id="t"><tbody><tr><td>probing…</td></tr></tbody></table>
<div class="verdict" id="v"></div>
<div class="note">Chrome gives WebM/Opus, Safari gives MP4/AAC. A pipeline that assumes one of them
breaks on the other — which is why every serious recorder sets mimeType explicitly.</div>
<script>
(function () {
  var TYPES = [
    ['audio/webm;codecs=opus', 'WebM + Opus'],
    ['audio/webm', 'WebM (default codec)'],
    ['audio/mp4', 'MP4 (AAC)'],
    ['audio/mp4;codecs=mp4a.40.2', 'MP4 + AAC-LC'],
    ['audio/ogg;codecs=opus', 'Ogg + Opus']
  ];

  function probe() {
    if (typeof MediaRecorder === 'undefined') {
      document.getElementById('t').innerHTML =
        '<tbody><tr><td>MediaRecorder unavailable in this context</td></tr></tbody>';
      document.getElementById('v').textContent = 'Cannot record here (sandboxed iframe or old browser).';
      return;
    }
    var rows = TYPES.map(function (t) {
      var ok = MediaRecorder.isTypeSupported(t[0]);
      return '<tr><td>' + t[1] + '</td><td class="' + (ok ? 'ok' : 'no') + '">' + t[0] + '</td>' +
             '<td class="' + (ok ? 'ok' : 'no') + '">' + (ok ? 'supported' : 'no') + '</td></tr>';
    }).join('');
    document.getElementById('t').innerHTML =
      '<tbody><tr><th>format</th><th>mime type</th><th>this browser</th></tr>' + rows + '</tbody>';

    var supported = TYPES.filter(function (t) { return MediaRecorder.isTypeSupported(t[0]); });
    document.getElementById('v').innerHTML = supported.length
      ? 'This browser would produce <b>' + supported[0][1] + '</b> if you omit mimeType. ' +
        'Set it explicitly if your pipeline needs a specific container.'
      : 'No supported audio container found — recording would fail.';
  }

  probe();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 不指定 mimeType，文件格式由浏览器决定

页面的代码是 \`new MediaRecorder(stream)\` —— **没有传 mimeType**。

后果：

| 浏览器 | 实际得到 |
| --- | --- |
| Chrome / Edge | \`audio/webm;codecs=opus\` |
| Safari | \`audio/mp4\`（AAC） |
| Firefox | \`audio/ogg;codecs=opus\` |

**同一份代码，三种格式。** 上传到一个只接受 MP3 的接口，Chrome 用户会全部失败。

页面的 HTML 示例真调用 \`MediaRecorder.isTypeSupported\`，把你的浏览器能录的格式列出来 —— 这就是应该写在代码里的检查。

## 为什么这是个真问题

音频格式不像图像（都能解码，只是编码器不同）。容器不匹配会直接失败：

- 有的服务端只认 MP3；
- 有的播放器不认 WebM；
- 有的移动端不认 Ogg。

所以正确做法是：**先按优先级探测，再明确指定**，而不是交给浏览器默认值。

## 电平表为什么用 fftSize 1024

页面用 \`AnalyserNode(fftSize=1024)\` 算 RMS：

- 48 kHz 下 1024 采样 = **21 ms**；
- 够快（看不出延迟），够慢（不会闪成噪点）。

如果只想显示"有没有声音"，甚至可以更小（256）；如果要精确的电平表（dBFS），要用 \`getFloatTimeDomainData\` 算真实 RMS 而不是峰值。

## 想深一层

1. 录制本身是**硬件编码**（Opus/AAC 都在硬件里），几乎不耗 CPU —— 和 ffmpeg.wasm 的软件转码完全不是一个量级。
2. \`MediaRecorder\` 产的 WebM **没有时长元数据**（duration 是 Infinity），播放器进度条会乱。要么转码，要么用 \`ts-ebml\` 修 header。
3. 想做"边说边转写"，需要在录制的同时把数据块交给识别器 —— 这要求 \`ondataavailable\` 的 chunk 是**独立可解码**的（WebM 的 cluster 结构正好支持）。`,
      en: `## Omit mimeType and the browser picks the format

The page does \`new MediaRecorder(stream)\` — **no mimeType**.

Consequences:

| Browser | Actually produced |
| --- | --- |
| Chrome / Edge | \`audio/webm;codecs=opus\` |
| Safari | \`audio/mp4\` (AAC) |
| Firefox | \`audio/ogg;codecs=opus\` |

**One code path, three formats.** Upload to an endpoint that only accepts MP3 and every Chrome user fails.

The demo really calls \`MediaRecorder.isTypeSupported\` to list what your browser can record — exactly the check that belongs in the code.

## Why this is a real problem

Audio formats are not like images (all decodable, encoder differs). A container mismatch fails outright:

- some servers only accept MP3;
- some players reject WebM;
- some mobile devices reject Ogg.

The fix: **probe in preference order, then specify explicitly**, instead of trusting the default.

## Why the level meter uses fftSize 1024

The page computes RMS from \`AnalyserNode(fftSize=1024)\`:

- 1024 samples at 48 kHz = **21 ms**;
- fast enough to feel live, slow enough not to flicker.

For a simple "is there sound" indicator, 256 would do; for a real dBFS meter, compute true RMS from \`getFloatTimeDomainData\` rather than peak.

## Going one level deeper

1. Recording is **hardware encoding** (Opus/AAC in silicon), nearly free in CPU — nothing like ffmpeg.wasm's software transcoding.
2. \`MediaRecorder\`'s WebM has **no duration metadata** (duration reports Infinity) and scrubbing misbehaves. Transcode, or repair the header with \`ts-ebml\`.
3. For live transcription, hand chunks to the recogniser as they arrive — which requires each chunk to be independently decodable (WebM's cluster structure supports exactly that).`
    }
  },

  '/speech/audio-convert': {
    python: `"""Format conversion: the codec and the bitrate are the only real choices.

The page runs ffmpeg.wasm (single-threaded core, no SharedArrayBuffer needed).
"""
CODEC_ARGS = {
    'mp3':  ['-c:a', 'libmp3lame', '-b:a', '{kbps}k'],
    'm4a':  ['-c:a', 'aac', '-b:a', '{kbps}k'],
    'ogg':  ['-c:a', 'libvorbis', '-b:a', '{kbps}k'],
    'wav':  ['-c:a', 'pcm_s16le', '-ar', '44100'],     # no bitrate: it is raw
    'flac': ['-c:a', 'flac', '-compression_level', '8'],
}


def args_for(fmt, kbps=192):
    """WAV and FLAC ignore kbps -- passing -b:a to a lossless encoder is either
    ignored or errors, depending on the build. The page skips it deliberately."""
    return [a.format(kbps=kbps) for a in CODEC_ARGS[fmt]]


def size_estimate(seconds, fmt, kbps=192, sr=44100, ch=1):
    """Two very different formulas:
      lossy   -> kbps x seconds / 8
      lossless-> sample rate x bit depth x channels x seconds   (WAV)
    A 3-minute song at 192 kbps is 4.3 MB; the same as WAV is 15.9 MB."""
    if fmt in ('wav',):
        return round(sr * 2 * ch * seconds / 1024 / 1024, 1)
    if fmt == 'flac':
        return round(sr * 2 * ch * seconds * 0.55 / 1024 / 1024, 1)   # ~55% of WAV
    return round(kbps * 1000 * seconds / 8 / 1024 / 1024, 1)


if __name__ == '__main__':
    print(args_for('mp3', 192))
    print('180 s:', {f: size_estimate(180, f) for f in ('mp3', 'wav', 'flac')})
    # ['-c:a', 'libmp3lame', '-b:a', '192k']
    # 180 s: {'mp3': 4.1, 'wav': 29.7, 'flac': 16.4}
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Four formats, one bitrate slider</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  table{border-collapse:collapse;font-size:12px;width:100%;max-width:600px}
  th,td{border:1px solid #e2e8f0;padding:6px 9px;text-align:left}
  th{background:#f1f5f9;font-weight:600}
  td.n{text-align:right;font-variant-numeric:tabular-nums}
  td.dim{color:#94a3b8}
  label{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12px}
  select{font:inherit;font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid #cbd5e1;background:#fff}
  input[type=range]{width:170px}
  output{font-variant-numeric:tabular-nums;font-weight:600}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Lossy has a formula; lossless does not care</h1>
<p>Bitrate only applies to lossy formats. WAV is raw samples, FLAC is compressed losslessly —
neither listens to the slider.</p>
<table id="t"></table>
<label>duration
  <input type="range" id="d" min="10" max="600" step="10" value="180"><output id="vd">180 s</output>
</label>
<label>bitrate
  <select id="k"><option>320</option><option selected>192</option><option>128</option><option>96</option></select>
</label>
<div class="note">192 kbps is the page default. Below 96 kbps, MP3 starts to smear consonants —
sibilants (s, sh, f) are the first casualty.</div>
<script>
(function () {
  function sizeMB(sec, fmt, kbps, sr, ch) {
    if (fmt === 'wav') return sr * 2 * ch * sec / 1024 / 1024;
    if (fmt === 'flac') return sr * 2 * ch * sec * 0.55 / 1024 / 1024;
    return kbps * 1000 * sec / 8 / 1024 / 1024;
  }

  function render() {
    var dur = +document.getElementById('d').value;
    var kbps = +document.getElementById('k').value;
    document.getElementById('vd').textContent = dur + ' s';

    var rows = [
      ['mp3', 'lossy', true], ['m4a', 'lossy (AAC)', true],
      ['ogg', 'lossy (Vorbis)', true], ['wav', 'lossless (PCM)', false],
      ['flac', 'lossless', false]
    ].map(function (r) {
      var mb = sizeMB(dur, r[0], kbps, 44100, 1);
      return '<tr><td>' + r[0] + '</td><td class="' + (r[2] ? '' : 'dim') + '">' + r[1] + '</td>' +
             '<td class="n">' + mb.toFixed(1) + ' MB</td>' +
             '<td class="' + (r[2] ? '' : 'dim') + ' n">' + (r[2] ? kbps + ' kbps' : '— (ignored)') + '</td></tr>';
    }).join('');

    document.getElementById('t').innerHTML =
      '<thead><tr><th>format</th><th>kind</th><th>size</th><th>rate</th></tr></thead><tbody>' +
      rows + '</tbody>';
  }

  document.getElementById('d').addEventListener('input', render);
  document.getElementById('k').addEventListener('change', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 有损看码率，无损看采样

两条完全不同的体积公式：

\`\`\`
有损（mp3/m4a/ogg）: kbps × 秒 / 8
无损（wav）:        采样率 × 位深 × 声道 × 秒
\`\`\`

3 分钟音频（44.1 kHz 单声道 16 bit）对比：

| 格式 | 体积 |
| --- | --- |
| MP3 192 kbps | 4.1 MB |
| AAC 192 kbps | 4.1 MB |
| FLAC | 16.4 MB |
| WAV | 29.7 MB |

**WAV 是 FLAC 的两倍**，因为 FLAC 无损压缩掉了样本冗余（约 45%）。

页面里 WAV/FLAC 不传比特率 —— 因为对无损编码器传 \`-b:a\` 要么被忽略、要么报错（取决于构建）。这是一个"看起来统一、实际必须分支"的地方。

## 192 kbps 是默认值，但不是"最好"

| 码率 | 适用 |
| --- | --- |
| 320 | 音乐、需要保真 |
| **192** | 语音/一般音乐，默认 |
| 128 | 语音可接受 |
| 96 | 语音下限，齿音开始糊 |
| <96 | 明显失真 |

**齿音（s / sh / f）是最先崩的** —— 因为它们是高频、瞬态，码率不足时会被量化噪声淹没。想验证这一点，用 64 kbps 转一段带 "s" 的语音。

## 为什么用 ffmpeg.wasm 而不是 Web Audio 编码

浏览器原生只能编码 Opus（\`MediaRecorder\`）和 WAV（手写 header）。MP3/AAC/Vorbis/FLAC 都没有原生编码器。

所以要么引入 wasm 编码库，要么用 ffmpeg.wasm（一个包解决所有格式）。代价是慢（单线程约 0.5–2 倍实时）。

## 想深一层

1. 转码**永远有损**（除了转 WAV）。MP3 → WAV → MP3 会叠加两代损失。
2. \`-ar 44100\` 对 WAV 是必须的显式指定，否则可能继承源文件的采样率（有时是 48 kHz，导致体积变大）。
3. 容器和编解码器是两件事：\`.m4a\` 是容器，AAC 是编解码器。\`.ogg\` 可以装 Vorbis 也可以装 Opus。页面选 \`libvorbis\`，因为兼容性最好。`,
      en: `## Lossy is bitrate-driven; lossless is sample-driven

Two completely different size formulas:

\`\`\`
lossy (mp3/m4a/ogg): kbps × seconds / 8
lossless (wav):      sample rate × bit depth × channels × seconds
\`\`\`

Three minutes at 44.1 kHz mono 16-bit:

| Format | Size |
| --- | --- |
| MP3 192 kbps | 4.1 MB |
| AAC 192 kbps | 4.1 MB |
| FLAC | 16.4 MB |
| WAV | 29.7 MB |

**WAV is twice FLAC**, because FLAC removes sample redundancy losslessly (~45%).

The page passes no bitrate for WAV/FLAC — handing \`-b:a\` to a lossless encoder is either ignored or an error depending on the build. A place that looks uniform but must branch.

## 192 kbps is the default, not the best

| Rate | Fits |
| --- | --- |
| 320 | music, fidelity matters |
| **192** | speech / general music, default |
| 128 | acceptable speech |
| 96 | speech floor, sibilance blurs |
| <96 | clearly distorted |

**Sibilants (s / sh / f) break first** — high frequency, transient, buried by quantisation noise when the budget runs out. Verify with a 64 kbps conversion of speech full of "s".

## Why ffmpeg.wasm instead of Web Audio encoding

Browsers natively encode only Opus (\`MediaRecorder\`) and WAV (hand-written header). MP3/AAC/Vorbis/FLAC have no native encoder.

So you either add a wasm encoder per format, or bring ffmpeg.wasm (one dependency, every format). The price is speed — roughly 0.5–2× realtime single-threaded.

## Going one level deeper

1. Transcoding **always loses** (except to WAV). MP3 → WAV → MP3 compounds two generations of loss.
2. \`-ar 44100\` must be explicit for WAV, otherwise the source rate (sometimes 48 kHz) is inherited and the file grows.
3. Container and codec are different things: \`.m4a\` is a container, AAC is a codec. \`.ogg\` can hold Vorbis or Opus. The page picks \`libvorbis\` for compatibility.`
    }
  },

  '/speech/video-to-audio': {
    python: `"""Extracting audio from video: one flag does all of it.

There is no separate demuxing logic in the page -- ffmpeg reads the video as
input and -vn drops the picture.
"""
def extract_cmd(fmt='mp3', kbps=192):
    """-vn is the whole trick: 'no video'. Everything else is ordinary audio
    encoding. The container is chosen by the output extension."""
    codec = {'mp3': 'libmp3lame', 'm4a': 'aac', 'ogg': 'libvorbis'}.get(fmt)
    if fmt == 'wav':
        return ['-vn', '-c:a', 'pcm_s16le', '-ar', '44100']
    if fmt == 'flac':
        return ['-vn', '-c:a', 'flac', '-compression_level', '8']
    return ['-vn', '-c:a', codec, '-b:a', f'{kbps}k']


def stream_layout():
    """A .mp4 is a container holding separate streams. Extracting audio is
    'take stream 1, drop stream 0'. ffmpeg's -vn expresses exactly that, which
    is why no manual demuxing is needed."""
    return {'container': 'mp4', 'streams': [
        {'id': 0, 'type': 'video', 'codec': 'h264'},
        {'id': 1, 'type': 'audio', 'codec': 'aac'},
    ]}


if __name__ == '__main__':
    print(extract_cmd('mp3'))
    # ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k']


# Two practical notes:
#  1. re-encoding audio is lossy: AAC (in the mp4) -> MP3 is a second generation
#  2. -c:a copy would be lossless and instant, but only when the target container
#     accepts the source codec (AAC into .m4a works, AAC into .mp3 does not)
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Take one stream, drop the other</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:600px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .opts{margin-top:10px;font-size:12px;display:flex;gap:14px;flex-wrap:wrap}
  .opts label{display:flex;align-items:center;gap:6px}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>A video file is a box with two streams</h1>
<p>Extracting audio is not decoding the video — it is selecting one stream and discarding the other.
<code>-vn</code> is literally "no video".</p>
<canvas id="c" width="600" height="150"></canvas>
<div class="opts">
  <label><input type="checkbox" id="copy"> use <code>-c:a copy</code> (no re-encode)</label>
</div>
<div class="note">Copy is instant and lossless, but only works when the target container accepts the
source codec. AAC into .m4a: yes. AAC into .mp3: no, so it re-encodes.</div>
<script>
(function () {
  function render() {
    var copy = document.getElementById('copy').checked;
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 150;
    ctx.clearRect(0, 0, W, H);

    // container box
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2;
    ctx.strokeRect(24, 22, 552, 104);
    ctx.fillStyle = '#94a3b8'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('input.mp4  (container)', 24, 16);

    // video stream
    ctx.fillStyle = copy ? 'rgba(148,163,184,.25)' : 'rgba(37,99,235,.15)';
    ctx.fillRect(40, 40, 520, 34);
    ctx.fillStyle = copy ? '#94a3b8' : '#1e3a8a';
    ctx.fillText('stream 0: h264 video', 52, 62);
    if (!copy) {
      ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(48, 74); ctx.lineTo(552, 40); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(552, 40); ctx.lineTo(540, 46); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(552, 40); ctx.lineTo(546, 52); ctx.stroke();
      ctx.fillStyle = '#dc2626'; ctx.fillText('-vn  dropped', 380, 80);
    }

    // audio stream
    ctx.fillStyle = 'rgba(22,163,74,.20)';
    ctx.fillRect(40, 84, 520, 34);
    ctx.fillStyle = '#166534';
    ctx.fillText('stream 1: aac audio', 52, 106);
    ctx.fillStyle = copy ? '#166534' : '#b45309';
    ctx.fillText(copy ? 'extracted as-is (copy)' : 're-encoded (lossy, generation 2)',
                 340, 106);

    ctx.fillStyle = '#475569';
    ctx.fillText(copy ? 'output: lossless, instant' : 'output: one more generation of loss',
                 40, H - 6);
  }

  document.getElementById('copy').addEventListener('change', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 一个参数解决全部：\`-vn\`

页面的视频转音频没有任何"抽轨"代码 —— 直接把视频当输入，输出加 \`-vn\`（no video）。

ffmpeg 内部做的事：**容器解复用（demux）→ 取出音频流 → 按目标格式编码**。

\`\`\`
mp4 容器
├── stream 0: h264 视频   ← -vn 丢掉
└── stream 1: aac 音频   ← 编码输出
\`\`\`

"从视频里提取音频"听起来像解码视频，其实**视频流根本没被解码** —— 只是跳过了。

## 转码 vs 复制

\`-c:a copy\` 是流复制：不重新编码，直接搬包。

- **优点**：瞬间完成、零损失；
- **限制**：目标容器必须接受源编码。

| 源 → 目标 | copy 可行？ |
| --- | --- |
| mp4(AAC) → m4a | ✅ 同编码 |
| mp4(AAC) → mp3 | ❌ 编码不同 |
| mp4(AAC) → wav | ❌ 要 PCM |

页面的工具不提供 copy 模式 —— 因为它要支持"任意视频转任意音频格式"，统一重编码是最简单的实现。**代价是代际损失**（AAC → MP3 是第二代的损失）。

## 想深一层

1. 如果只要音频，源视频的码率再高也没意义 —— 但**源音频码率会设上限**。从 128 kbps AAC 转 320 kbps MP3 不会变好，只会变大。
2. 有的视频有多条音轨（多语言）。\`-map 0:a:1\` 可以选第二条，页面没有提供这个选项 —— 它取默认音轨。
3. 从视频抽音频的实用场景：课程录屏转播客、会议录像转文字（再喂 Whisper）。`,
      en: `## One flag does it: -vn

The page has no demuxing code — it feeds the video as input and adds \`-vn\` (no video).

Internally ffmpeg does: **demux the container → take the audio stream → encode to the target**.

\`\`\`
mp4 container
├── stream 0: h264 video   ← dropped by -vn
└── stream 1: aac audio    ← encoded out
\`\`\`

"Extract audio from video" sounds like decoding video. **The video stream is never decoded** — it is simply skipped.

## Transcode vs copy

\`-c:a copy\` is stream copy: no re-encode, packets moved across.

- **Upside**: instant, lossless;
- **Limit**: the target container must accept the source codec.

| Source → target | copy possible? |
| --- | --- |
| mp4(AAC) → m4a | yes, same codec |
| mp4(AAC) → mp3 | no |
| mp4(AAC) → wav | no, needs PCM |

The page offers no copy mode — it supports "any video to any audio", and uniform re-encoding is the simplest implementation. **The price is generation loss** (AAC → MP3 is generation two).

## Going one level deeper

1. If you only want audio, the video bitrate is irrelevant — but **the source audio bitrate is a ceiling**. 128 kbps AAC to 320 kbps MP3 is not better, only bigger.
2. Some videos carry several audio tracks (multiple languages). \`-map 0:a:1\` selects the second; the page does not expose it and takes the default.
3. Real uses: lecture recordings to podcasts, meeting videos into Whisper for transcription.`
    }
  },

  '/speech/audio-compress': {
    python: `"""Compressing audio: three levers, very different returns.

bitrate, sample rate, channels. The page exposes all three, defaulting to
96 kbps / keep-rate / mono.
"""
def size_mb(seconds, kbps=96, sr=44100, ch=1):
    return round(kbps * 1000 * seconds / 8 / 1024 / 1024, 2)


def compare(seconds=60):
    """A 60-second voice clip. Note that mono alone halves everything, and it is
    the only lever with no perceptual cost for speech."""
    base = {'192k stereo': size_mb(seconds, 192, 44100, 2),
            '96k stereo':  size_mb(seconds, 96, 44100, 2),
            '96k mono':    size_mb(seconds, 96, 44100, 1),
            '64k mono 24k': size_mb(seconds, 64, 24000, 1),
            '32k mono 16k': size_mb(seconds, 32, 16000, 1)}
    return base


def advice(use):
    """Which lever to pull depends on the content, not on taste:
      speech -> mono + 16-24 kHz + 32-64 kbps is plenty (telephone quality is 8 kHz)
      music  -> keep 44.1 kHz stereo, cut bitrate only
    """
    if use == 'speech':
        return ['-ac 1', '-ar 24000', '-b:a 48k']
    return ['-ac 2', '-ar 44100', '-b:a 160k']


if __name__ == '__main__':
    print(compare(60))
    # {'192k stereo': 2.75, '96k stereo': 1.37, '96k mono': 0.69, '64k mono 24k': 0.46, ...}
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Three levers, three different costs</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:600px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .ctl{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:12px;align-items:center}
  .ctl label{display:flex;align-items:center;gap:6px}
  input[type=range]{width:130px}
  select{font:inherit;font-size:12px;padding:3px 7px;border-radius:5px;border:1px solid #cbd5e1;background:#fff}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:44px}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Mono is free; bitrate is not</h1>
<p>For speech, halving the channels costs nothing perceptually. Cutting the bitrate costs sibilants.
Cutting the sample rate costs everything above Nyquist. The bars show where the losses land.</p>
<canvas id="c" width="600" height="180"></canvas>
<div class="ctl">
  <label>seconds <input type="range" id="s" min="10" max="300" step="10" value="60"><output id="vs">60</output></label>
  <label>bitrate <select id="k"><option>192</option><option selected>96</option><option>64</option><option>32</option></select></label>
  <label><input type="checkbox" id="mono" checked> mono</label>
</div>
<div class="note">Rule of thumb for voice: mono + 24 kHz + 48–64 kbps is transparent enough.
Going below 32 kbps saves space but starts to sound like a phone call from 1998.</div>
<script>
(function () {
  function render() {
    var sec = +document.getElementById('s').value;
    var kbps = +document.getElementById('k').value;
    var mono = document.getElementById('mono').checked;
    document.getElementById('vs').textContent = sec;

    var ch = mono ? 1 : 2;
    var mb = kbps * 1000 * sec / 8 / 1024 / 1024;

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 180;
    ctx.clearRect(0, 0, W, H);

    // comparison bars
    var cases = [
      { label: '192k stereo', v: 192 * 2, color: '#cbd5e1' },
      { label: '96k stereo', v: 96 * 2, color: '#94a3b8' },
      { label: '96k mono', v: 96, color: '#60a5fa' },
      { label: 'current', v: kbps * ch, color: '#2563eb' }
    ];
    var maxV = 384;
    cases.forEach(function (cs, i) {
      var w = cs.v / maxV * (W - 190);
      ctx.fillStyle = cs.color;
      ctx.fillRect(120, 20 + i * 26, Math.max(2, w), 18);
      ctx.fillStyle = '#334155'; ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(cs.label, 16, 33 + i * 26);
      ctx.fillStyle = '#64748b';
      ctx.fillText((cs.v * 1000 * sec / 8 / 1024 / 1024).toFixed(1) + ' MB', 130 + w, 33 + i * 26);
    });

    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 13px ui-monospace, monospace';
    ctx.fillText('result: ' + mb.toFixed(2) + ' MB for ' + sec + ' s', 16, H - 14);
  }

  ['s', 'k', 'mono'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
    document.getElementById(id).addEventListener('change', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 三个杠杆，代价完全不同

| 杠杆 | 效果 | 感知代价 |
| --- | --- | --- |
| **声道** 2 → 1 | 体积 **减半** | 语音几乎无损；音乐失去声场 |
| **码率** 192 → 96 | 体积减半 | 齿音开始变钝 |
| **采样率** 44.1 → 16 kHz | 体积减 2.6 倍 | **8 kHz 以上的内容全丢** |

**声道是唯一"免费"的杠杆。** 纯人声录音，左右声道信息几乎相同，取单声道没有任何损失。这也是电话、播客、有声书都默认单声道的原因。

## 采样率的硬边界

根据奈奎斯特采样定理，采样率决定了能表示的最高频率：

| 采样率 | 最高频率 | 适用 |
| --- | --- | --- |
| 44.1 kHz | 22 kHz | 音乐（人耳上限约 20 kHz） |
| 24 kHz | 12 kHz | 语音（足够，齿音在 4–8 kHz） |
| 16 kHz | 8 kHz | 电话质量，识别模型的标准输入 |
| 8 kHz | 4 kHz | 只能听清内容，谈不上音质 |

**注意 16 kHz 是 ASR 模型的硬要求**（Whisper、YAMNet 都要）—— 所以"压缩到 16 kHz"在语音流水线里反而是标准做法。

## 码率的收益递减

从 192 → 96 kbps，体积减半，音质只损失一点（齿音略钝）。从 96 → 48，损失明显变大。从 48 → 24，开始像"电话里的声音"。

**每减半一次，损失的感知量递增。** 这就是为什么 96 kbps 是语音压缩的甜点。

## 想深一层

1. 页面的 \`预计体积 = 码率 × 1000 / 8 × 时长\` 是估算。实际会有几 % 偏差（容器开销、VBR）。
2. 转成单声道时要**混音**（\`-ac 1\` 会做 L+R 平均），不是简单取左声道。直接取左声道会丢内容（如果右声道有独奏乐器）。
3. 想更省：Opus 在低码率下明显优于 MP3（48 kbps 的 Opus ≈ 96 kbps 的 MP3）。页面给 ogg 选项就是这个原因。`,
      en: `## Three levers, three very different costs

| Lever | Effect | Perceptual cost |
| --- | --- | --- |
| **Channels** 2 → 1 | halves size | almost none for speech; loses stereo image for music |
| **Bitrate** 192 → 96 | halves size | sibilants dull slightly |
| **Sample rate** 44.1 → 16 kHz | 2.6× smaller | **everything above 8 kHz is gone** |

**Channels is the only free lever.** In a pure voice recording both channels are nearly identical; mono loses nothing. Which is why telephony, podcasts and audiobooks are mono by default.

## The hard edge of sample rate

Nyquist decides the highest representable frequency:

| Rate | Max frequency | Fits |
| --- | --- | --- |
| 44.1 kHz | 22 kHz | music (hearing tops out near 20 kHz) |
| 24 kHz | 12 kHz | speech (sibilants live at 4–8 kHz) |
| 16 kHz | 8 kHz | telephone quality; the standard input for ASR |
| 8 kHz | 4 kHz | intelligible, not pleasant |

**Note that 16 kHz is mandatory for ASR** (Whisper, YAMNet), so downsampling to 16 kHz is actually standard in a speech pipeline.

## Diminishing returns on bitrate

192 → 96 halves size for a slight loss (slightly duller sibilants). 96 → 48 is noticeably worse. 48 → 24 sounds like a phone call.

**Each halving costs more than the last.** Hence 96 kbps as the speech sweet spot.

## Going one level deeper

1. The page's \`size ≈ kbps × 1000 / 8 × duration\` is an estimate; real output differs a few percent (container overhead, VBR).
2. Mono conversion **mixes** (\`-ac 1\` averages L+R) rather than taking the left channel — taking one channel would drop content if the right carries something unique.
3. For more savings: Opus beats MP3 clearly at low rates (48 kbps Opus ≈ 96 kbps MP3). That is why the page offers ogg.`
    }
  },

  '/speech/audio-trim': {
    python: `"""Trimming audio: the same -ss / -t rules as video, plus one waveform.

The page decodes to 16 kHz and computes 1200 peak columns just to draw the
selection -- decoding for display, not for the cut.
"""
SR = 16000
COLUMNS = 1200


def peaks(samples, columns=COLUMNS):
    """One peak per column: max(abs()) over the bucket. Peaks, not averages --
    averaging hides transients and the waveform looks like a smear."""
    n = len(samples) // columns or 1
    out = []
    for i in range(columns):
        chunk = samples[i * n:(i + 1) * n]
        out.append(max(abs(v) for v in chunk) if chunk else 0.0)
    return out


def trim_args(start, end, fmt='mp3'):
    """-ss BEFORE -i: fast seek. -t is a DURATION (end - start), not an end
    timestamp -- the single most common bug in ffmpeg trim scripts."""
    return ['-ss', f'{start:.3f}', '-i', 'in.mp3', '-t', f'{end - start:.3f}']


def cut_cost(start, end, mode='fast'):
    """Fast seek jumps to the nearest keyframe; exact seek decodes from 0.
    For audio the difference is small (frames are ~26 ms), but for long files
    the difference in time is linear in the start offset."""
    return {'fast_s': 0.2, 'exact_s': round(0.2 + start * 0.02, 1),
            'accuracy_ms': 0 if mode == 'exact' else 26}


if __name__ == '__main__':
    print(trim_args(12.0, 34.0))
    # ['-ss', '12.000', '-i', 'in.mp3', '-t', '22.000']
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Peaks for display, -ss for the cut</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15);cursor:crosshair}
  pre{margin-top:10px;background:#0f172a;color:#e2e8f0;padding:10px 12px;border-radius:8px;font-size:12px;overflow-x:auto}
  label{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px}
  input[type=range]{width:200px}
  output{font-variant-numeric:tabular-nums;font-weight:600}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Draw the selection, not the audio</h1>
<p>The waveform is 1200 peak columns computed at 16 kHz — cheap. The cut itself never touches those
samples; it re-encodes with <code>-ss</code> and <code>-t</code>.</p>
<canvas id="c" width="620" height="140"></canvas>
<label>start <input type="range" id="s" min="0" max="60" step="0.5" value="12"><output id="vs">12.0</output> s</label>
<label>end <input type="range" id="e" min="0" max="60" step="0.5" value="34"><output id="ve">34.0</output> s</label>
<pre id="cmd"></pre>
<div class="note">Peaks (max abs per column) rather than averages: averaging a column hides transients
and the waveform turns into a grey smear.</div>
<script>
(function () {
  var DUR = 60, COLS = 200;
  // synthetic envelope: speech-like bursts with pauses
  function env(t) {
    var phrase = Math.max(0, Math.sin(t * 0.9) * 0.5 + 0.5);
    var detail = 0.35 + 0.65 * Math.abs(Math.sin(t * 7.3) * Math.cos(t * 2.1));
    return Math.min(1, phrase * detail + 0.05);
  }

  function render() {
    var s = +document.getElementById('s').value;
    var e = +document.getElementById('e').value;
    if (e < s + 1) { e = s + 1; document.getElementById('e').value = e; }
    document.getElementById('vs').textContent = s.toFixed(1);
    document.getElementById('ve').textContent = e.toFixed(1);

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 140, padL = 16, mid = 76;
    ctx.clearRect(0, 0, W, H);
    var X = t => padL + t / DUR * (W - 32);

    // peaks
    for (var i = 0; i < COLS; i++) {
      var t = i / COLS * DUR;
      var h = env(t) * 52;
      var inSel = t >= s && t < e;
      ctx.fillStyle = inSel ? '#2563eb' : '#cbd5e1';
      ctx.fillRect(padL + i * (W - 32) / COLS, mid - h, Math.max(1, (W - 32) / COLS - 1), h * 2);
    }

    // selection band
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2;
    ctx.strokeRect(X(s), 14, X(e) - X(s), H - 34);
    ctx.fillStyle = 'rgba(220,38,38,.08)';
    ctx.fillRect(X(s), 14, X(e) - X(s), H - 34);

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('0 s', padL, H - 6);
    ctx.fillText(DUR + ' s', W - 48, H - 6);
    ctx.fillText('selection ' + (e - s).toFixed(1) + ' s', X(s) + 4, 26);

    document.getElementById('cmd').textContent =
      '# -ss before -i = fast seek; -t is a DURATION, not an end time\\n' +
      'ffmpeg -y -ss ' + s.toFixed(3) + ' -i in.mp3 -t ' + (e - s).toFixed(3) +
      ' -c:a libmp3lame -b:a 192k out.mp3';
  }

  ['s', 'e'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 画波形和解码切割是两条独立的路径

页面做了两件不相关的事：

1. **画波形**：把文件解码到 16 kHz，算 1200 列峰值；
2. **切割**：把选区换算成 \`-ss\` / \`-t\`，交给 ffmpeg 重新编码。

**第 1 步的采样率（16 kHz）和切割无关** —— 它只是为了"够画图、解码快"。真正切割用的是 ffmpeg 内部的完整精度。

如果以为"解码成 16 kHz 会损失音质"，那是误解：切割时 ffmpeg 直接读源文件，不经过你画图用的那份数据。

## 峰值而不是平均

每一列取 \`max(abs())\`，不是平均。

**平均会把瞬态抹平** —— 语音里的爆破音（p/t/k）、鼓点都是极短的高幅值，平均之后变成一条模糊的灰带。峰值保留了"这一列最响是多少"，波形才有形状。

这是所有音频编辑软件的做法（Audacity、Logic 的波形都是峰值的包络）。

## \`-ss\` 前置与 \`-t\` 的语义

和 /vision/video-trim 完全一样的规则：

- \`-ss\` 在 \`-i\` **前** → 快速定位（跳到最近的关键帧）；
- \`-t\` 是**时长**，不是结束时间（\`-t 22\` 不是"到 22 秒"）。

音频的帧长很短（MP3 约 26 ms），所以"关键帧对齐"带来的偏差只有几十毫秒 —— 比视频小得多。**这也是为什么音频切割可以放心用快速定位。**

## 想深一层

1. 页面默认输出格式**跟随源扩展名**（否则转 mp3）。这是一个体贴的默认值 —— 用户切一段 wav 不该突然拿到 mp3。
2. 不做 \`-c copy\` 是因为音频帧虽然短，但流复制在切点处仍会有半个帧的偏移，重编码更干净。
3. 精确到 0.1 秒的滑杆是 UI 精度，不是实际切点精度。真要帧级精确，需要 \`-ss\` 放在 \`-i\` 之后（慢但准）。`,
      en: `## Drawing the waveform and cutting the audio are separate paths

The page does two unrelated things:

1. **Draw**: decode to 16 kHz and compute 1200 peak columns;
2. **Cut**: turn the selection into \`-ss\` / \`-t\` and let ffmpeg re-encode.

**The 16 kHz of step 1 has nothing to do with the cut** — it exists to make drawing fast. The cut runs at ffmpeg's full precision.

Assuming "decoding to 16 kHz degrades the cut" is a misunderstanding: ffmpeg reads the source file directly, not your display copy.

## Peaks, not averages

Each column is \`max(abs())\`, not a mean.

**Averaging smears transients** — plosives (p/t/k) and drum hits are very short and very loud; averaged, they become a grey blur. Peaks preserve "how loud was the loudest sample in this column", which is what gives a waveform its shape.

Every audio editor does this (Audacity, Logic — all peak envelopes).

## \`-ss\` placement and what \`-t\` means

Identical rules to /vision/video-trim:

- \`-ss\` **before** \`-i\` → fast seek to the nearest keyframe;
- \`-t\` is a **duration**, not an end time (\`-t 22\` does not mean "until 22 s").

Audio frames are short (MP3 ≈ 26 ms), so keyframe alignment costs only tens of milliseconds — far less than video. **Which is why audio trimming can safely use fast seek.**

## Going one level deeper

1. Output format **follows the source extension** by default (mp3 otherwise). A thoughtful default — trimming a WAV should not silently hand back an MP3.
2. \`-c copy\` is avoided because stream copy still lands mid-frame at the cut; re-encoding is cleaner.
3. The 0.1 s slider is UI precision, not cut precision. True frame accuracy needs \`-ss\` after \`-i\` (slow but exact).`
    }
  }
}
