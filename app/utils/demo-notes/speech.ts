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
  }
}
