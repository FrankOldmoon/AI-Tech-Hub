/**
 * nlp 分类的「延伸学习」内容（text-classifier / language-detector / embedder / ner /
 * zero-shot / summarization / qa / fill-mask，以及两个聚合引擎页）。
 *
 * 这一分类的页面全部**浏览器端推理**，模型从 `.models/` 走 `/model/*`：
 *  - MediaPipe Text（tflite）：文本分类 25.7 MB、语言检测 315 KB、句向量 6.1 MB
 *  - Transformers.js（ONNX q8）：NER 110 MB、MNLI 68 MB、摘要 284 MB、SQuAD 66 MB、BERT 111 MB
 *
 * HTML 示例不加载这些模型，而是用**同一套数学的可运行版本**：字符 n-gram 语言识别、
 * TF-IDF 余弦、BIO 合并、TextRank 抽取、span 打分 —— 都是真算，不是示意。
 */
import type { NoteMap } from './index'

export const notes: NoteMap = {
  '/nlp/text-classifier': {
    python: `"""Text classification: logits in, decision out.

Two engines on this page, same output shape:
  MediaPipe  bert_classifier.tflite   25.7 MB, 2 classes, input [1, 128]
  Transformers  distilbert-sst-2 q8   ~67 MB, WebGPU then WASM
"""
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

name = 'distilbert-base-uncased-finetuned-sst-2-english'
tok = AutoTokenizer.from_pretrained(name)
model = AutoModelForSequenceClassification.from_pretrained(name)

def classify(text):
    batch = tok(text, return_tensors='pt', truncation=True, max_length=128)
    with torch.no_grad():
        logits = model(**batch).logits[0]          # raw scores, NOT probabilities

    # softmax is what turns scores into a decision you can threshold
    probs = torch.softmax(logits, dim=-1)
    k = int(probs.argmax())
    return model.config.id2label[k], float(probs[k]), logits.tolist()


if __name__ == '__main__':
    for text in ['the film was not bad at all', 'a waste of two hours']:
        label, score, logits = classify(text)
        print(f'{score:.3f}  {label:8s}  logits={[round(v, 2) for v in logits]}  <- {text}')
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Logits to decision: softmax and one threshold</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .ctl{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px}
  label{display:flex;align-items:center;gap:7px;font-size:12px}
  input[type=range]{width:130px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:44px}
  .bars{margin-top:6px}
  .bar{display:flex;align-items:center;gap:9px;margin-bottom:7px;font-size:12px}
  .bar b{width:74px;font-weight:500}
  .bar i{display:block;height:14px;background:#2563eb;border-radius:3px;transition:width .12s}
  .bar span{font-variant-numeric:tabular-nums;color:#475569;width:56px;text-align:right}
  .verdict{margin-top:12px;padding:9px 12px;border-radius:8px;background:#eff6ff;font-size:13px}
  .verdict b{font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Two logits become one decision</h1>
<p>A classifier outputs raw scores (logits). Softmax turns them into a distribution, and a threshold
turns that into a label. Drag either logit and watch the decision flip — note that the flip point is
where the two logits are equal, not where the *probability* is 50% of the way to 1.</p>
<div class="ctl">
  <label>logit negative <input type="range" id="ln" min="-6" max="6" step="0.1" value="-1.6"><output id="on"></output></label>
  <label>logit positive <input type="range" id="lp" min="-6" max="6" step="0.1" value="2.4"><output id="op"></output></label>
  <label>temperature <input type="range" id="t" min="0.3" max="3" step="0.05" value="1"><output id="ot"></output></label>
</div>
<div class="bars">
  <div class="bar"><b>negative</b><i id="bn"></i><span id="sn"></span></div>
  <div class="bar"><b>positive</b><i id="bp"></i><span id="sp"></span></div>
</div>
<div class="verdict" id="verdict"></div>
<div class="note">temperature &lt; 1 sharpens the distribution; &gt; 1 softens it. Production inference
almost always uses T = 1 — the knob exists to make the shape visible here.</div>
<script>
(function () {
  function render() {
    var ln = +document.getElementById('ln').value;
    var lp = +document.getElementById('lp').value;
    var T = +document.getElementById('t').value;
    document.getElementById('on').textContent = ln.toFixed(1);
    document.getElementById('op').textContent = lp.toFixed(1);
    document.getElementById('ot').textContent = T.toFixed(2);

    // numerically stable softmax over two logits
    var m = Math.max(ln, lp);
    var en = Math.exp((ln - m) / T);
    var ep = Math.exp((lp - m) / T);
    var s = en + ep;
    var pn = en / s, pp = ep / s;

    document.getElementById('bn').style.width = Math.max(2, pn * 240) + 'px';
    document.getElementById('bp').style.width = Math.max(2, pp * 240) + 'px';
    document.getElementById('sn').textContent = (pn * 100).toFixed(1) + '%';
    document.getElementById('sp').textContent = (pp * 100).toFixed(1) + '%';

    var label = pp >= 0.5 ? 'positive' : 'negative';
    var margin = Math.abs(lp - ln);
    document.getElementById('verdict').innerHTML =
      'argmax -> <b>' + label + '</b> &nbsp;|&nbsp; margin |Δlogit| = <b>' + margin.toFixed(1) +
      '</b> &nbsp;|&nbsp; confidence <b>' + (Math.max(pn, pp) * 100).toFixed(1) + '%</b>' +
      (margin < 0.5 ? ' &nbsp;— this is the region where a calibrated model is least trustworthy' : '');
  }
  ['ln', 'lp', 't'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 两个引擎，同一个输出形状

这一页有两个实现，结果格式一致（\`[{label, score}]\`），但代价差一个量级：

| | MediaPipe \`bert_classifier\` | Transformers.js distilbert-sst-2 |
| --- | --- | --- |
| 体积 | 25.7 MB（float32 tflite） | q8 约 67 MB |
| 输入 | 固定 \`[1, 128]\` | 可 truncation，同样截 128 |
| 后端 | WASM | WebGPU 优先，失败回退 WASM |
| 输出 | 2 类（neg / pos） | 2 类（NEGATIVE / POSITIVE） |

两者都是 BERT 类模型在 SST-2（电影评论情感）上微调的结果。**「情感分析」在 2026 年已经是个 25 MB 能解决的问题**——这类窄任务不需要大模型。

## logits 不是概率，softmax 才是

模型最后一层输出的是 **logits**：任意实数，可正可负。它们的绝对值没有意义，只有**相对差**有意义。

\`softmax(z)_i = exp(z_i/T) / Σ exp(z_j/T)\`

三个要点：

1. **只关心差值**：logits 是 \`(-1, 3)\` 还是 \`(100, 104)\`，softmax 后完全一样（差都是 4）；
2. **减最大值**：代码里先减 \`max\` 再取 exp，否则 \`exp(800)\` 直接溢出成 Infinity。这是数值稳定的标准写法，几乎所有框架内部都这么做；
3. **温度 T**：小于 1 更尖锐、大于 1 更平滑。真实推理几乎总是 T=1，这个参数在这里是为了让你看清分布形状。

## 判定点在哪

二分类的翻转点是 **两个 logit 相等**，不是"概率到 0.5 的一半"。因为 softmax 单调，argmax 只由 logits 的大小关系决定 —— 拖动滑杆时你会在 \`Δlogit = 0\` 那一刻看到标签翻转，而不是在某个概率值上。

**这解释了一个常见误解**：调「阈值」和调「温度」是两件事。温度改分布形状，阈值改判定边界。页面用的 \`score >= 0.5\` 是最朴素的边界，真实系统会按业务调（宁可漏检还是宁可误检）。

## 分不清的地方就是不可信的地方

当 \`|Δlogit| < 0.5\` 时，模型其实在犹豫。此时置信度（softmax 后的分数）看起来仍然"挺高"（0.55 也很像回事），但这是**未校准**的：模型说 0.55，实际正确率往往不是 55%。

要真用于决策，需要做温度缩放（temperature scaling）或 Platt scaling —— 用验证集拟合一个温度，让"置信度 0.9"真的对应 90% 正确率。这一步在学术 demo 里常被跳过，在工业里必做。

## 想深一层

1. 128 token 的截断是硬限制。长文本要么截断（丢后半段）、要么分块平均、要么用长文本模型（Longformer / 层次模型）。页面的输入框没提示这一点，是个可以改进的地方。
2. 两个引擎给出的分数不一定一致 —— 不同模型、不同量化，边界样本上的判定会分歧。这在集成时就是"多数投票"的来源。
3. 真正省资源的做法：先用 315 KB 的语言检测器判断语种，再决定加载哪个分类模型。这就是 \`/nlp/mediapipe-text\` 那一页三个工具并列的意义。`,
      en: `## Two engines, one output shape

This page has two implementations with the same result format (\`[{label, score}]\`) but an order of magnitude apart in cost:

| | MediaPipe \`bert_classifier\` | Transformers.js distilbert-sst-2 |
| --- | --- | --- |
| Size | 25.7 MB (float32 tflite) | ~67 MB at q8 |
| Input | fixed \`[1, 128]\` | truncation, also capped at 128 |
| Backend | WASM | WebGPU first, WASM fallback |
| Output | 2 classes (neg / pos) | 2 classes (NEGATIVE / POSITIVE) |

Both are BERT-family models fine-tuned on SST-2 (movie-review sentiment). **Sentiment analysis is a 25 MB problem in 2026** — narrow tasks do not need large models.

## Logits are not probabilities; softmax makes them so

The last layer emits **logits**: any real number, positive or negative. Their absolute values carry no meaning, only the **difference** does.

\`softmax(z)_i = exp(z_i/T) / Σ exp(z_j/T)\`

Three things matter:

1. **Only differences count**: logits \`(-1, 3)\` and \`(100, 104)\` give identical softmax output (both differ by 4);
2. **Subtract the max**: the code subtracts \`max\` before \`exp\`, otherwise \`exp(800)\` overflows to Infinity. Standard numerical-stability practice, and almost every framework does it internally;
3. **Temperature T**: below 1 sharpens, above 1 softens. Real inference uses T=1; the knob exists here to make the shape visible.

## Where the decision flips

For two classes the flip point is **equal logits**, not "halfway to a probability of 0.5". Softmax is monotonic, so argmax depends only on the ordering of logits — drag the sliders and the label flips exactly at \`Δlogit = 0\`.

**This clears up a common confusion**: changing the threshold and changing the temperature are different operations. Temperature reshapes the distribution; threshold moves the decision boundary. The page uses \`score >= 0.5\`, the plainest boundary; production systems tune it per business cost (misses vs false alarms).

## Where it cannot tell, it cannot be trusted

When \`|Δlogit| < 0.5\` the model is genuinely undecided. The confidence number still looks respectable (0.55 reads fine), but it is **uncalibrated**: a model saying 0.55 is usually not right 55% of the time.

Real decisions need temperature scaling or Platt scaling — fit one temperature on a validation set so "0.9" actually means 90%. Skipped in most demos, mandatory in industry.

## Going one level deeper

1. The 128-token cap is hard. Long text means truncation (losing the tail), chunk-and-average, or a long-context model. The input box does not warn about this — a fair criticism of the page.
2. The two engines will not always agree — different models, different quantisation, divergent calls on borderline inputs. That divergence is exactly what ensembles vote on.
3. The resource-smart order: run the 315 KB language detector first, then load only the classifier you need. That is why \`/nlp/mediapipe-text\` puts three tools side by side.`
    }
  },

  '/nlp/language-detector': {
    python: `"""Language detection: 111 classes from a 315 KB model.

It is the cheapest model on the whole site, and it runs before anything else
because everything downstream depends on knowing the language.
"""
import numpy as np


def detect_chars(text):
    """A 20-line version of what the tflite model learned, using character
    n-gram profiles. No model, no download -- and surprisingly hard to beat
    for short strings."""
    # per-language marker characters (a real profile has hundreds, weighted)
    PROFILE = {
        'zh': '的一是不了人我在有他这为之大来以个中上们',
        'ja': 'のいるはにをたがでてとしれさあるも',
        'ko': '이다는을를이가에한하로있되수',
        'ru': 'оаеинтсрвлкмдпуяыьгзбчйхжшюцщэфъё',
        'ar': 'اليمونرتبكعفهدسقحجشصضطزثذغخ',
        'en': 'etaoinshrdlucmfwypvbgkjqxz',
        'fr': 'esaitnrulodcmpévqfbghjàxèy',
        'de': 'enisratdhulcgmobwfkzpvßäöü',
        'es': 'eaosrnidlctumpbgvyqhfzjñx',
    }
    text = text.lower()
    scores = {}
    for lang, marks in PROFILE.items():
        hits = sum(text.count(ch) for ch in marks)
        if hits:
            scores[lang] = hits
    total = sum(scores.values()) or 1
    return sorted(((k, v / total) for k, v in scores.items()), key=lambda kv: -kv[1])


# The page's model: language_detector.tflite, 315 KB, output [1, 111],
# labels.txt lists 110 language codes. No parameters, no threshold -- it
# always returns a ranked list, and low confidence is your problem to handle.
if __name__ == '__main__':
    for s in ['今天天气很好，我们去公园', 'Heute ist das Wetter schön', 'こんにちは']:
        print(s, '->', detect_chars(s)[:2])
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Character profiles: a 20-line language detector</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  textarea{width:100%;box-sizing:border-box;height:64px;padding:9px 11px;border:1px solid #cbd5e1;
    border-radius:8px;font:14px/1.5 system-ui,sans-serif;resize:vertical}
  .samples{margin:8px 0}
  button{font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid #cbd5e1;
    background:#fff;cursor:pointer;margin:0 5px 5px 0}
  .bars{margin-top:8px}
  .bar{display:flex;align-items:center;gap:9px;margin-bottom:6px;font-size:12px}
  .bar b{width:56px;font-weight:500;font-family:ui-monospace,monospace}
  .bar i{display:block;height:12px;background:#2563eb;border-radius:3px;transition:width .15s}
  .bar span{font-variant-numeric:tabular-nums;color:#475569;width:50px;text-align:right}
  .hint{color:#64748b;font-size:12px;margin-top:10px}
</style>
</head>
<body>
<h1>What a 315 KB model can do</h1>
<p>Character-frequency profiles. Type or paste text — the counts below are computed live, and this
simple scoring is genuinely competitive on short strings, which is exactly the regime the real
111-class model targets.</p>
<textarea id="in">今天天气很好，我们一起去公园散步吧</textarea>
<div class="samples" id="samples"></div>
<div class="bars" id="bars"></div>
<div class="hint">Non-Latin scripts are separated by which characters appear at all; Latin languages
are separated by relative frequency. Script languages win on presence, not probability.</div>
<script>
(function () {
  var PROFILE = {
    zh: '的一是不了人我在有他这为之大来以个中上们到说国和地也子时道出而要于就下得可你年生',
    ja: 'のいるはにをたがでてとしれさあるもことないからまで',
    ko: '이다는을를이가에한하로있되수것들그저',
    ru: 'оаеинтсрвлкмдпуяыьгзбчйхжшюцщэфъё',
    ar: 'اليمونرتبكعفهدسقحجشصضطزثذغخ',
    en: 'etaoinshrdlucmfwypvbgkjqxz',
    fr: 'esaitnrulodcmpévqfbghjàxèy',
    de: 'enisratdhulcgmobwfkzpvßäöü',
    es: 'eaosrnidlctumpbgvyqhfzjñx'
  };
  var NAMES = { zh: 'zh', ja: 'ja', ko: 'ko', ru: 'ru', ar: 'ar', en: 'en', fr: 'fr', de: 'de', es: 'es' };

  function score(text) {
    var t = text.toLowerCase(), out = {};
    Object.keys(PROFILE).forEach(function (lang) {
      var marks = PROFILE[lang], hits = 0;
      for (var i = 0; i < marks.length; i++) {
        var ch = marks[i], from = 0, idx;
        while ((idx = t.indexOf(ch, from)) !== -1) { hits++; from = idx + 1; }
      }
      if (hits) out[lang] = hits;
    });
    var total = 0;
    Object.keys(out).forEach(function (k) { total += out[k]; });
    var rows = Object.keys(out).map(function (k) { return { lang: k, p: out[k] / (total || 1), n: out[k] }; });
    rows.sort(function (a, b) { return b.p - a.p; });
    return rows.slice(0, 5);
  }

  function render() {
    var text = document.getElementById('in').value.trim();
    var rows = score(text);
    var bars = document.getElementById('bars');
    if (!text || !rows.length) { bars.innerHTML = '<div class="hint">no characters matched any profile</div>'; return; }
    bars.innerHTML = rows.map(function (r, i) {
      return '<div class="bar"><b>' + NAMES[r.lang] + '</b>' +
             '<i style="width:' + Math.max(3, r.p * 260) + 'px;background:' + (i === 0 ? '#2563eb' : '#93c5fd') + '"></i>' +
             '<span>' + (r.p * 100).toFixed(1) + '%</span></div>';
    }).join('');
  }

  var SAMPLES = [
    ['中文', '今天天气很好，我们一起去公园散步吧'],
    ['English', 'The film was not bad at all, surprisingly'],
    ['日本語', 'こんにちは、今日はいい天気ですね'],
    ['Deutsch', 'Heute ist das Wetter wirklich schön'],
    ['Русский', 'Сегодня очень хорошая погода']
  ];
  document.getElementById('samples').innerHTML = SAMPLES.map(function (s, i) {
    return '<button data-i="' + i + '">' + s[0] + '</button>';
  }).join('');
  document.querySelectorAll('#samples button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.getElementById('in').value = SAMPLES[+b.dataset.i][1];
      render();
    });
  });
  document.getElementById('in').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 全站最便宜的模型：315 KB，111 类

\`language_detector.tflite\` 只有 315 KB，却能分 110 种语言（\`labels.txt\` 列出全部语言码，输出 \`[1, 111]\`）。它没有参数、没有阈值，永远返回一个排序列表。

为什么它这么小？因为**语言识别的有效信息主要在字符集和短序列频率上**，不需要理解语义。判断「今天天气很好」是中文，用不到任何语言学知识，看到汉字就够了。

## 它通常是流水线的第一步

真实系统里，语言检测几乎总是第一个跑的：

\`文本 → 语言检测（315 KB）→ 加载对应语言的模型（几十到几百 MB）\`

如果没有这一步，你要么加载"多语言通用模型"（更大更慢），要么先假设一种语言（猜错就全错）。**315 KB 换一个正确的路由，是全站性价比最高的模型。**

## 两类线索：字符集 vs 频率

- **非拉丁文字**（中文、日文、韩文、俄文、阿拉伯文）：靠**字符是否出现**就能分。汉字、假名、谚文、西里尔字母的码位区间完全不重叠；
- **拉丁语系**（英法德西意）：字符集几乎相同，只能靠**相对频率**。英语里 e/t/a 最多，法语里 é/à/è 常见，德语有 ß/ä/ö/ü。

页面的可运行示例就是后一种：给每种语言一组高频字符，数命中次数归一化。它的准确性对短句很好，对长文会被少数高频虚词带偏 —— 真实模型用 n-gram + 神经网络解决这个。

## 日文和中文的分界

一个有意思的细节：日文里混着大量汉字，纯汉字句子怎么判断？

线索是**假名**（ひらがな/カタカナ）。只要出现假名就一定是日文；全是汉字时才可能是中文。这类"否定式判据"在语言识别里很常见 —— 不是看谁多，而是看谁有对方不可能有的东西。

## 置信度低时该怎么办

模型永远会给一个答案（哪怕输入是 "asdfghjkl"）。此时 top-1 概率可能只有 0.3，top-2 是 0.28。

**正确做法是设下限**：低于阈值就不要相信，交给用户选或直接报错。页面没有做这一步 —— 这是教学 demo 与生产系统的典型差别。真实场景里"猜错语言"会让后续所有步骤白跑。

## 想深一层

1. 混合语言文本（中英夹杂）会让模型给出两个都接近的分数。处理方式是分句检测，而不是整段投票。
2. 罗马化的语言（拼音、日文罗马字）几乎无法用这个方法识别 —— 字符集信息全丢了，只能靠词形。
3. 315 KB 的模型能带 111 类，说明它学的是很浅的特征。这也意味着**它对短文本（10 字以内）反而不如字符统计可靠** —— 参数量小到一定程度，先验知识比学习能力更重要。`,
      en: `## The cheapest model on the site: 315 KB, 111 classes

\`language_detector.tflite\` is 315 KB and separates 110 languages (\`labels.txt\` lists the codes, output \`[1, 111]\`). No parameters, no threshold — it always returns a ranked list.

Why so small? Because **the useful signal for language ID lives in character sets and short-sequence frequencies**, not semantics. Recognising that 今天天气很好 is Chinese needs no linguistics — seeing the characters is enough.

## It is usually step one of the pipeline

In practice language detection runs first:

\`text -> detect (315 KB) -> load the model for that language (tens to hundreds of MB)\`

Without it you either load one big multilingual model (slower, larger) or assume a language and fail completely when the guess is wrong. **315 KB to get the routing right is the best value on this site.**

## Two kinds of evidence: characters vs frequency

- **Non-Latin scripts** (Chinese, Japanese, Korean, Russian, Arabic): **presence** is enough. Han, kana, hangul and Cyrillic occupy disjoint code-point ranges;
- **Latin languages** (English, French, German, Spanish, Italian): nearly identical alphabets, so only **relative frequency** separates them. English leans e/t/a, French shows é/à/è, German has ß/ä/ö/ü.

The runnable demo below is the second kind: a high-frequency character set per language, normalised hit counts. Good on short input, easily skewed on long text by a few function words — real models use n-grams plus a network to fix that.

## Telling Japanese from Chinese

An interesting edge: Japanese contains large numbers of Han characters, so how do you classify an all-kanji sentence?

The clue is **kana**. Any kana at all means Japanese; only when there is none can it be Chinese. This "negative evidence" pattern is common in language ID — you are not counting who has more, but looking for something the other cannot have.

## What to do with low confidence

The model always answers, even for "asdfghjkl". Top-1 might be 0.3 with top-2 at 0.28.

**The right move is a floor**: below a threshold, do not trust it — ask the user or fail loudly. The page skips this, which is the usual gap between a demo and a production system. Guessing the language wrong wastes every downstream step.

## Going one level deeper

1. Mixed-language text (Chinese with English) gives two close scores. Handle it per sentence, not by voting over the whole document.
2. Romanised languages (pinyin, romaji) defeat this method entirely — the character-set signal is gone, leaving only word shapes.
3. A 315 KB model covering 111 classes means it learned very shallow features. It also means **it can underperform raw character statistics on strings under about ten characters** — once the parameter count is that small, priors beat learning.`
    }
  },

  '/nlp/text-embedder': {
    python: `"""Sentence embeddings: 100 numbers, and only the angle between them matters.

The page runs universal_sentence_encoder.tflite (6.1 MB, 100 dims) through
MediaPipe. Same idea as any embedding model, just small enough to ship.
"""
import numpy as np


def cosine(a, b):
    """The only operation you need. Magnitudes carry no meaning here --
    two sentences of different length must still be comparable."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def tfidf_embed(docs):
    """What the model does, minus the model: count words, weight the rare ones,
    then normalise. Ten lines, and it already orders sentences sensibly."""
    from collections import Counter
    import math

    toks = [d.lower().split() for d in docs]
    df = Counter()
    for t in toks:
        df.update(set(t))
    n = len(docs)

    vocab = sorted({w for t in toks for w in t})
    index = {w: i for i, w in enumerate(vocab)}
    mat = np.zeros((n, len(vocab)))
    for r, t in enumerate(toks):
        for w, c in Counter(t).items():
            idf = math.log((n + 1) / (df[w] + 1)) + 1       # smoothed idf
            mat[r, index[w]] = c * idf
    # L2 normalise each row: that is what makes cosine meaningful
    norms = np.linalg.norm(mat, axis=1, keepdims=True) + 1e-9
    return mat / norms, vocab


if __name__ == '__main__':
    docs = ['a dog runs on the grass', 'the cat sleeps on the grass', 'quantum computing is hard']
    mat, vocab = tfidf_embed(docs)
    print('sim(dog, cat)  =', round(cosine(mat[0], mat[1]), 3))
    print('sim(dog, quant)=', round(cosine(mat[0], mat[2]), 3))
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TF-IDF embeddings, cosine similarity</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  textarea{width:100%;box-sizing:border-box;height:52px;padding:8px 10px;border:1px solid #cbd5e1;
    border-radius:8px;font:13px/1.5 system-ui,sans-serif;resize:vertical;margin-bottom:8px}
  .pair{display:flex;gap:10px;flex-wrap:wrap}
  .pair>div{flex:1;min-width:220px}
  .sim{margin-top:12px;padding:11px 13px;border-radius:8px;background:#eff6ff;font-size:13px}
  .sim b{font-size:19px;font-variant-numeric:tabular-nums}
  .terms{margin-top:10px;font-size:12px;color:#475569}
  .terms code{background:#e2e8f0;padding:1px 5px;border-radius:3px;margin-right:4px;display:inline-block;margin-bottom:3px}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>100 dimensions, and only the angle matters</h1>
<p>Two sentences in, one similarity out. This runs TF-IDF (a real, if old, embedding) so you can see
the whole pipeline: tokenise, weight rare words, normalise, cosine. A neural encoder replaces only the
middle step.</p>
<div class="pair">
  <div><textarea id="a">a dog runs across the grass</textarea></div>
  <div><textarea id="b">the cat sleeps on the grass</textarea></div>
</div>
<div class="sim">cosine similarity <b id="s">—</b> <span id="v"></span></div>
<div class="terms" id="terms"></div>
<div class="note">Words that appear in both sentences pull them together; rare words weigh more than
common ones. Try making one sentence about something unrelated and watch the score fall.</div>
<script>
(function () {
  function tokens(s) {
    return s.toLowerCase().replace(/[^a-z0-9\\s]/g, ' ').split(/\\s+/).filter(Boolean);
  }

  function embed(docs) {
    var toks = docs.map(tokens);
    var df = {};
    toks.forEach(function (t) {
      var seen = {};
      t.forEach(function (w) { seen[w] = 1; });
      Object.keys(seen).forEach(function (w) { df[w] = (df[w] || 0) + 1; });
    });
    var n = docs.length;
    var vocab = {};
    toks.forEach(function (t) { t.forEach(function (w) { vocab[w] = 1; }); });
    var words = Object.keys(vocab);

    var mat = toks.map(function (t) {
      var counts = {};
      t.forEach(function (w) { counts[w] = (counts[w] || 0) + 1; });
      var row = words.map(function (w) {
        var idf = Math.log((n + 1) / ((df[w] || 0) + 1)) + 1;
        return (counts[w] || 0) * idf;
      });
      var norm = Math.sqrt(row.reduce(function (s, v) { return s + v * v; }, 0)) || 1;
      return row.map(function (v) { return v / norm; });
    });
    return { mat: mat, words: words };
  }

  function render() {
    var a = document.getElementById('a').value;
    var b = document.getElementById('b').value;
    var out = embed([a, b]);
    var v1 = out.mat[0], v2 = out.mat[1];
    var dot = 0;
    for (var i = 0; i < v1.length; i++) dot += v1[i] * v2[i];

    document.getElementById('s').textContent = dot.toFixed(3);
    document.getElementById('v').textContent =
      dot > 0.75 ? '(nearly the same sentence)' :
      dot > 0.4 ? '(related)' :
      dot > 0.1 ? '(loosely related)' : '(unrelated)';

    // show the terms with the largest joint contribution
    var contrib = out.words.map(function (w, i) {
      return { w: w, v: Math.min(v1[i], v2[i]) };
    }).filter(function (x) { return x.v > 0; })
      .sort(function (x, y) { return y.v - x.v; }).slice(0, 8);

    document.getElementById('terms').innerHTML = contrib.length
      ? 'shared weight: ' + contrib.map(function (c) {
          return '<code>' + c.w + ' ' + c.v.toFixed(2) + '</code>';
        }).join('')
      : 'no shared vocabulary — similarity is 0 by construction';
  }

  ['a', 'b'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 100 维，只比角度

页面的 \`universal_sentence_encoder.tflite\`（6.1 MB）输出**100 维**向量，两个文本各算一次，然后取余弦相似度。

关键点：**向量的长度没有意义**。同一句话写成两句不同的长度，向量的模长会变，但方向不变。所以所有相似度都用余弦（只看向量夹角），而不是欧氏距离（会被模长影响）。

## 余弦相似度的三个区间

| 值 | 含义 | 典型场景 |
| --- | --- | --- |
| > 0.9 | 几乎是同一个意思 | 复述、同义改写 |
| 0.6–0.9 | 相关 | 同一主题的不同句子 |
| 0.3–0.6 | 弱相关 | 共享一些词但主题不同 |
| < 0.3 | 基本无关 | 随机两句 |

**这些阈值是经验值，且取决于模型**：不同 embedding 模型的分布完全不同（有的模型两句话的基线就有 0.5）。所以永远不要跨模型抄阈值 —— 这和 /vision/face-recognition 页是同一个坑。

## 页面示例用 TF-IDF，为什么

因为它是**可解释的 embedding**：你能看到每个词贡献了多少权重。这让人理解"embedding 到底在编码什么"：

1. **分词**：切成词；
2. **加权**：\`tf × idf\`，罕见词的权重高（"quantum" 比 "the" 有信息量）；
3. **归一化**：每行除模长，让长度不影响结果；
4. **余弦**：点积就是相似度（因为已归一化）。

神经编码器只替换了第 2 步 —— 它不做"词频"，而是学一个把语义距离变成几何距离的映射。**但第 1、3、4 步完全一样**。这就是为什么理解 TF-IDF 之后，所有 embedding 系统都不再神秘。

## 为什么必须 L2 归一化

如果不归一化，长句子的向量模长更大，与任何短句的点积都偏大 —— 相似度会随句子长度虚高。

归一化之后，向量都落在单位球面上，点积 = 余弦，范围固定在 [-1, 1]，可比。

**这是实现 embedding 检索时最容易漏的一步**，漏了的表现是「长文档总是排第一」。

## 想深一层

1. 100 维够不够？对"这两句话是不是一个意思"这种粗粒度判断够；对细粒度（区分"他很生气"和"他有点不高兴"）不够。维度是精度与成本的权衡。
2. 词袋类方法（TF-IDF）完全丢失语序：「狗咬人」和「人咬狗」向量相同。神经模型通过位置编码解决，这是它最大的优势。
3. 真实检索系统会在 embedding 之上再加一层重排（rerank），因为余弦相似度的排序对精确问答不够好 —— 那是另一个量级的问题。`,
      en: `## 100 dimensions, and only the angle matters

The page's \`universal_sentence_encoder.tflite\` (6.1 MB) emits a **100-d** vector; encode both texts once and take the cosine similarity.

The key point: **vector length is meaningless**. Writing the same sentence at two different lengths changes the magnitude but not the direction, so every similarity uses cosine (angle only) rather than Euclidean distance (magnitude-sensitive).

## Three bands of cosine similarity

| Value | Meaning | Typical case |
| --- | --- | --- |
| > 0.9 | essentially the same | paraphrase, restatement |
| 0.6–0.9 | related | different sentences, same topic |
| 0.3–0.6 | weakly related | shared words, different subject |
| < 0.3 | basically unrelated | two random sentences |

**These are empirical and model-specific**: distributions differ wildly across encoders (some sit at a 0.5 baseline for unrelated pairs). Never copy a threshold across models — the same trap as /vision/face-recognition.

## Why the demo uses TF-IDF

Because it is an **explainable embedding**: you can see how much each word contributes. That makes clear what an embedding encodes:

1. **Tokenise** into words;
2. **Weight** by \`tf × idf\` — rare words carry more signal than "the";
3. **Normalise** each row by its norm so length cannot skew results;
4. **Cosine**: after normalisation the dot product *is* the similarity.

A neural encoder replaces only step 2 — it learns a mapping from semantic distance to geometric distance instead of counting. **Steps 1, 3 and 4 are identical.** Understand TF-IDF and no embedding system stays mysterious.

## Why L2 normalisation is mandatory

Without it, long sentences have larger norms and their dot product with any short sentence inflates — similarity grows with length.

Normalised, all vectors sit on the unit sphere, dot product equals cosine, and the range is a comparable [-1, 1].

**The easiest step to forget when building retrieval**, and the symptom is unmistakable: long documents always rank first.

## Going one level deeper

1. Is 100 dimensions enough? For "same meaning or not", yes; for fine distinctions ("angry" vs "annoyed") no. Dimension is an accuracy/cost trade.
2. Bag-of-words methods lose word order entirely: "dog bites man" and "man bites dog" have identical vectors. Positional encoding in neural models fixes exactly this.
3. Real retrieval adds a rerank stage on top of embeddings, because cosine ranking is not precise enough for QA — a different order of problem.`
    }
  },

  '/nlp/ner': {
    python: `"""Named entity recognition: the model tags tokens, you rebuild the spans.

bert-base-NER at q8 is 110 MB -- the largest single model on this page -- because
it must know names it has never seen in your domain.
"""
from transformers import pipeline

ner = pipeline('token-classification', model='Xenova/bert-base-NER-uncased',
               aggregation_strategy='simple')


def entities(text, top_k=10):
    """'simple' aggregation merges the B-/I- subword tags back into whole words.
    Without it you get ['B-PER', 'I-PER', 'I-PER'] for one name."""
    return [{'text': e['word'], 'type': e['entity_group'], 'score': round(e['score'], 4)}
            for e in ner(text)[:top_k]]


def merge_bio(tokens, tags):
    """What the aggregator does, in ten lines. Run this once by hand and the
    B-/I- scheme stops being mysterious."""
    out, cur, cur_tag = [], [], None
    for tok, tag in zip(tokens, tags):
        if tag.startswith('B-'):
            if cur:
                out.append((' '.join(cur), cur_tag))
            cur, cur_tag = [tok], tag[2:]
        elif tag.startswith('I-') and cur and tag[2:] == cur_tag:
            cur.append(tok)                       # same entity continues
        else:
            if cur:
                out.append((' '.join(cur), cur_tag))
            cur, cur_tag = [], None               # O: outside any entity
    if cur:
        out.append((' '.join(cur), cur_tag))
    return out


if __name__ == '__main__':
    print(merge_bio(['Barack', 'Obama', 'visited', 'Paris', 'in', 'June'],
                    ['B-PER', 'I-PER', 'O', 'B-LOC', 'O', 'B-DATE']))
    # [('Barack Obama', 'PER'), ('Paris', 'LOC'), ('June', 'DATE')]
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>BIO tagging, merged back into entities</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .toks{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0}
  .tok{border:1px solid #cbd5e1;border-radius:6px;padding:3px 7px;font:12px/1.4 ui-monospace,monospace;background:#fff}
  .tok em{display:block;font-style:normal;font-size:10px;color:#64748b}
  .tok.PER{border-color:#2563eb;background:#dbeafe}
  .tok.LOC{border-color:#059669;background:#d1fae5}
  .tok.DATE{border-color:#d97706;background:#fef3c7}
  .tok.O{opacity:.55}
  .ents{margin-top:12px;font-size:13px}
  .ents code{background:#e2e8f0;padding:2px 6px;border-radius:4px;margin-right:6px}
  .note{color:#64748b;font-size:12px;margin-top:10px}
  button{font:inherit;font-size:12px;padding:5px 11px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer}
</style>
</head>
<body>
<h1>B- and I- are the whole trick</h1>
<p>NER models tag each token, not each entity. <b>B-</b> opens an entity, <b>I-</b> continues the same
one, <b>O</b> is outside. Everything else — spans, types, boundaries — is your code walking the tags.</p>
<div class="toks" id="toks"></div>
<div class="ents" id="ents"></div>
<button id="next">next example</button>
<div class="note">Note the two different <code>B-LOC</code>s: they start separate entities. A missed
<code>O</code> between them would silently glue two places into one.</div>
<script>
(function () {
  var DATA = [
    { t: ['Barack','Obama','visited','Paris','in','June'],
      g: ['B-PER','I-PER','O','B-LOC','O','B-DATE'] },
    { t: ['The','Eiffel','Tower','and','the','Louvre','are','in','Paris'],
      g: ['O','B-LOC','I-LOC','O','O','B-LOC','O','O','B-LOC'] },
    { t: ['Sundar','Pichai','spoke','at','Google','I/O','in','May'],
      g: ['B-PER','I-PER','O','O','B-ORG','I-ORG','O','B-DATE'] },
    { t: ['London','and','Paris','are','both','capitals'],
      g: ['B-LOC','O','B-LOC','O','O','O'] },
    { t: ['I','met','Mary','at','the','British','Museum'],
      g: ['O','O','B-PER','O','O','B-LOC','I-LOC'] }
  ];
  var idx = 0;

  function merge(tokens, tags) {
    var out = [], cur = [], curTag = null;
    tokens.forEach(function (tok, i) {
      var tag = tags[i];
      if (tag.indexOf('B-') === 0) {
        if (cur.length) out.push({ text: cur.join(' '), type: curTag });
        cur = [tok]; curTag = tag.slice(2);
      } else if (tag.indexOf('I-') === 0 && cur.length && tag.slice(2) === curTag) {
        cur.push(tok);
      } else {
        if (cur.length) out.push({ text: cur.join(' '), type: curTag });
        cur = []; curTag = null;
      }
    });
    if (cur.length) out.push({ text: cur.join(' '), type: curTag });
    return out;
  }

  function render() {
    var d = DATA[idx];
    document.getElementById('toks').innerHTML = d.t.map(function (tok, i) {
      var tag = d.g[i];
      var cls = tag === 'O' ? 'O' : tag.slice(2);
      return '<div class="tok ' + cls + '">' + tok + '<em>' + tag + '</em></div>';
    }).join('');

    var ents = merge(d.t, d.g);
    document.getElementById('ents').innerHTML = ents.length
      ? 'entities: ' + ents.map(function (e) {
          return '<code>' + e.text + ' <b>' + e.type + '</b></code>';
        }).join('')
      : 'no entities in this sentence';
  }

  document.getElementById('next').addEventListener('click', function () {
    idx = (idx + 1) % DATA.length;
    render();
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 模型只标 token，实体是你的代码拼出来的

看页面的可运行示例就明白了：模型输出的是每个 token 一个标签（\`B-PER\` / \`I-PER\` / \`O\`），**不是一个"实体列表"**。

- **B-**（Beginning）开启一个新实体；
- **I-**（Inside）延续当前实体；
- **O**（Outside）在任何实体之外。

\`BIO\` 之外还有 \`BIOES\`（加了 E=End、S=Single），用更多标签换更明确的边界。BERT 系模型基本都用 \`BIO\`。

## 「simple」聚合策略做了什么

Transformers.js 的 pipeline 有个参数 \`aggregation_strategy\`，页面固定用 \`'simple'\`：把连续的 \`B-PER, I-PER, I-PER\` 合并成一个词。

不加这个参数会怎样？你会得到三行：

\`Barack (B-PER, 0.99)\` / \`Obama (I-PER, 0.98)\` / \`…\`

看起来"模型识别错了"（明明是一个人名却拆成两行），其实只是没聚合。**这是 NER 最容易被误判为"模型不行"的地方。**

## 子词是另一个坑

BERT 用 WordPiece 分词，罕见词会被切成子词：\`Pichai\` 可能变成 \`Pi ##chai\`。标签是在**子词层面**预测的，所以聚合还要处理 \`##\` 前缀。

页面的 HTML 示例省略了子词，用整词演示 —— 真实实现里 \`##\` 的处理是必须的，否则实体会多出空格（\`Pi chai\`）。

## 110 MB 花在哪了

\`bert-base-NER\` 是这批模型里最大的（q8 也有 110 MB）。它的核心能力是**认出没见过的名字**：训练集里没有 "Pichai"，但它能根据上下文（"spoke at"、"in May"）判断这是个人名。

这个能力靠的是 BERT 的预训练语言模型知识，不是 NER 标注数据。**标注数据只教它"哪种模式是人名"，预训练教它"这个名字像不像人名"。**

对比：语言检测 315 KB 就够了，因为字符集是确定性信息；NER 要 110 MB，因为判断"这是不是人名"需要世界知识。

## 想深一层

1. 两个相邻的 \`B-LOC\` 会产生两个实体（示例里 "London" 和 "Paris"）。如果中间漏了一个 \`O\`，两个地名会被粘成一个 —— 这类错误在长句里很常见。
2. NER 的边界错误通常来自**修饰语**：「英国广播公司」应该整体是 ORG，还是「英国」是 LOC？不同标注规范答案不同，模型继承的是训练集的规范。
3. 想做中文 NER，用 jieba 分词 + 中文 NER 模型，或者直接用多语言模型。硬把英文 tokenizer 套在中文上，子词会碎得没法看。`,
      en: `## The model tags tokens; your code assembles entities

The runnable demo makes it obvious: the model emits one label per token (\`B-PER\` / \`I-PER\` / \`O\`), **not a list of entities**.

- **B-** (Beginning) opens a new entity;
- **I-** (Inside) continues the current one;
- **O** (Outside) is outside every entity.

There is also \`BIOES\` (E = End, S = Single), trading more labels for explicit boundaries. BERT-family models almost always use plain \`BIO\`.

## What the "simple" aggregation does

Transformers.js pipelines take \`aggregation_strategy\`; the page fixes it to \`'simple'\`, which merges consecutive \`B-PER, I-PER, I-PER\` into one word.

Without it you get three rows:

\`Barack (B-PER, 0.99)\` / \`Obama (I-PER, 0.98)\` / …

which looks like the model split one name in two — it did not, you just never merged it. **This is the most common place people wrongly conclude "the model is bad".**

## Subwords are the second trap

BERT uses WordPiece: rare words get split, so \`Pichai\` may become \`Pi ##chai\`. Labels are predicted **per subword**, so aggregation must also handle the \`##\` prefix.

The demo uses whole words for clarity; real code must strip \`##\`, or entities come out as \`Pi chai\`.

## Where the 110 MB goes

\`bert-base-NER\` is the largest model in this batch (110 MB even at q8). Its real skill is **recognising names it has never seen**: "Pichai" is absent from training data, yet context ("spoke at", "in May") identifies it as a person.

That comes from BERT's pretraining, not from NER annotations. **Annotations teach "this pattern is a name"; pretraining teaches "this word looks like a name".**

Compare: language detection needs 315 KB because character sets are deterministic; NER needs 110 MB because judging "is this a person" requires world knowledge.

## Going one level deeper

1. Two adjacent \`B-LOC\`s produce two entities ("London", "Paris"). A missing \`O\` between them silently glues two places into one — common in long sentences.
2. Boundary errors usually come from **modifiers**: is "British Broadcasting Corporation" one ORG, or is "British" a LOC? The model inherits whatever convention the dataset used.
3. For Chinese NER, use jieba plus a Chinese NER model (or a multilingual one). Forcing an English tokenizer onto Chinese shreds it into unusable subwords.`
    }
  },

  '/nlp/zero-shot': {
    python: `"""Zero-shot classification: reuse an NLI model as a label scorer.

distilbert-mnli (q8, 68 MB) was trained for entailment, not classification.
The trick is asking it the right question.
"""
from transformers import pipeline

clf = pipeline('zero-shot-classification', model='Xenova/distilbert-base-uncased-mnli')


def classify(text, labels, multi_label=False):
    """Each label becomes a premise/hypothesis pair:
    'This example is about {label}.'  ->  entailment score.
    Those scores are then normalised, which is why they sum to 1."""
    out = clf(text, candidate_labels=labels, multi_label=multi_label)
    return list(zip(out['labels'], [round(s, 3) for s in out['scores']]))


if __name__ == '__main__':
    text = 'the new phone has a battery that lasts two days'
    print(classify(text, ['technology', 'sports', 'politics']))
    # [('technology', 0.94), ('politics', 0.04), ('sports', 0.02)]


# Why this works at all:
#   entailment means "if the premise is true, the hypothesis must be true".
#   A description of a phone battery *entails* "this is about technology",
#   and does not entail "this is about sports". No training on your labels.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Zero-shot: NLI as a label scorer</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  textarea{width:100%;box-sizing:border-box;height:54px;padding:8px 10px;border:1px solid #cbd5e1;
    border-radius:8px;font:13px/1.5 system-ui,sans-serif;resize:vertical}
  input[type=text]{width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;
    border-radius:8px;font:13px ui-monospace,monospace;margin-top:8px}
  label.chk{display:inline-flex;gap:6px;align-items:center;margin-top:8px;font-size:12px}
  .bars{margin-top:12px}
  .bar{display:flex;align-items:center;gap:9px;margin-bottom:7px;font-size:12px}
  .bar b{width:96px;font-weight:500}
  .bar i{display:block;height:13px;background:#2563eb;border-radius:3px;transition:width .15s}
  .bar span{font-variant-numeric:tabular-nums;color:#475569;width:56px;text-align:right}
  .note{color:#64748b;font-size:12px;margin-top:10px}
</style>
</head>
<body>
<h1>No training on your labels</h1>
<p>The model never saw your categories. It answers one question per label: <i>does this text entail
"this is about X"?</i> Those entailment scores become your classification. This demo uses a small
keyword-overlap proxy so you can see the normalisation step.</p>
<textarea id="t">the new phone has a battery that lasts two days</textarea>
<input type="text" id="labels" value="technology, sports, politics, cooking">
<label class="chk"><input type="checkbox" id="multi"> multi_label (scores do not sum to 1)</label>
<div class="bars" id="bars"></div>
<div class="note">Single-label mode normalises across candidates (softmax-ish); multi-label mode scores
each label independently against a fixed threshold. Choosing the wrong mode is a classic bug.</div>
<script>
(function () {
  // crude topical lexicon: stands in for the NLI model's entailment judgement
  var LEX = {
    technology: ['phone', 'battery', 'app', 'software', 'chip', 'device', 'computer', 'ai', 'code', 'screen'],
    sports: ['team', 'match', 'player', 'goal', 'coach', 'league', 'score', 'season', 'win', 'race'],
    politics: ['election', 'vote', 'party', 'senate', 'policy', 'government', 'minister', 'campaign'],
    cooking: ['recipe', 'oven', 'flour', 'salt', 'bake', 'pan', 'sauce', 'garlic', 'boil', 'dish'],
    finance: ['stock', 'market', 'price', 'investor', 'revenue', 'loan', 'bank', 'profit'],
    health: ['patient', 'doctor', 'symptom', 'treatment', 'dose', 'virus', 'hospital']
  };

  function entailment(text, label) {
    var words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    var lex = LEX[label.toLowerCase()] || [label.toLowerCase()];
    var hits = 0;
    words.forEach(function (w) { if (lex.indexOf(w) !== -1) hits++; });
    // saturating curve: 3 hits is already strong evidence
    return 1 / (1 + Math.exp(-(hits - 1.5) * 1.6));
  }

  function render() {
    var text = document.getElementById('t').value;
    var labels = document.getElementById('labels').value.split(',')
      .map(function (s) { return s.trim(); }).filter(Boolean);
    var multi = document.getElementById('multi').checked;
    if (!labels.length) { document.getElementById('bars').innerHTML = ''; return; }

    var raw = labels.map(function (l) { return entailment(text, l); });
    var scores;
    if (multi) {
      scores = raw;
    } else {
      // contrastive: pretrained zero-shot models do exactly this over "entailment"
      var sum = raw.reduce(function (a, b) { return a + b; }, 0) || 1;
      scores = raw.map(function (v) { return v / sum; });
    }

    var rows = labels.map(function (l, i) { return { l: l, v: scores[i], r: raw[i] }; })
      .sort(function (a, b) { return b.v - a.v; });

    document.getElementById('bars').innerHTML = rows.map(function (row, i) {
      var pass = row.v >= 0.5;
      var col = multi ? (pass ? '#16a34a' : '#cbd5e1') : (i === 0 ? '#2563eb' : '#93c5fd');
      return '<div class="bar"><b>' + row.l + '</b>' +
             '<i style="width:' + Math.max(2, row.v * 240) + 'px;background:' + col + '"></i>' +
             '<span>' + (row.v * 100).toFixed(1) + '%</span></div>';
    }).join('');
  }

  ['t', 'labels'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  document.getElementById('multi').addEventListener('change', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 复用 NLI 模型做分类

\`distilbert-base-uncased-mnli\` 本来是训练来做**自然语言推理**（NLI）的：给它一个前提和一个假设，判断二者是"蕴含 / 矛盾 / 中立"。

零样本文本分类把这套能力借用过来：

1. 你的文本作为**前提**；
2. 每个候选标签变成一个**假设**："这段话是关于 {标签} 的"；
3. 取"蕴含"（entailment）的概率作为该标签的分数；
4. 归一化。

**模型从没见过你的标签，但它懂"蕴含"这个关系。** 这就是"零样本"的含义 —— 零个标注样本。

## 为什么是蕴含，不是相似度

如果只是算"文本和标签的相似度"，"科技"和"体育"都会因为出现频率高的通用词而得分接近。

蕴含是更强的约束："如果这段话说的是手机电池续航，那么它**必然**是关于科技的吗？" —— 是。那它**必然**是关于体育的吗？—— 不是。这种"必然推出"的关系比相似度判别力强得多。

## 单标签 vs 多标签，这个选项很关键

| 模式 | 分数含义 | 什么时候用 |
| --- | --- | --- |
| \`multi_label=false\` | **对比归一化**，所有标签分数和为 1 | 候选互斥（这条新闻属于哪个版块） |
| \`multi_label=true\` | 每个标签**独立**打分 | 可以同时命中多个（这篇文章涉及科技+健康） |

选错的后果很典型：用单标签模式做"这段文字涉及哪些主题"，分数会被强行摊平 —— 明明两个主题都相关，各得 0.5，看起来"都不太确定"。

页面的示例两个模式都能切，切一下就能看到分数的语义完全变了。

## 68 MB 换来了什么

比专门的分类模型（25 MB）大两倍多，换来的是**不需要训练**。真实场景里：

- 标签固定且数据充足 → 训练专用分类器，更小更快更准；
- 标签经常变（新业务、临时分析）→ 零样本，改一行配置就能分类新标签。

**这是"灵活性 vs 效率"的经典权衡**，不是谁更先进的问题。

## 想深一层

1. 标签的措辞影响很大。"sports" 和 "athletics" 给分可能差 20%。实践里会写多个同义标签取最高分。
2. 零样本的分数**未校准**：0.6 不代表 60% 正确。做阈值判断前要先在验证集上校准。
3. 它的上限受 NLI 模型的知识限制：对一个领域外文本（比如法律条文），"蕴含"判断本身就可能错，再归一化也没用。`,
      en: `## Reusing an NLI model as a classifier

\`distilbert-base-uncased-mnli\` was trained for **natural language inference**: given a premise and a hypothesis, decide entailment / contradiction / neutral.

Zero-shot classification borrows that:

1. Your text becomes the **premise**;
2. Each candidate label becomes a **hypothesis**: "this text is about {label}";
3. The entailment probability is that label's score;
4. Normalise.

**The model has never seen your labels, but it understands entailment.** That is what "zero-shot" means — zero labelled examples.

## Why entailment, not similarity

Plain text-label similarity gives similar scores to "technology" and "sports" whenever common words overlap.

Entailment is a stronger constraint: "if this text is about a phone battery, **must** it be about technology?" Yes. "Must it be about sports?" No. That "must follow" relation discriminates far better than similarity.

## Single-label vs multi-label is the option that matters

| Mode | Score meaning | When |
| --- | --- | --- |
| \`multi_label=false\` | **contrastive normalisation**, scores sum to 1 | mutually exclusive candidates (which section is this news in) |
| \`multi_label=true\` | each label scored **independently** | several can hold at once (tech **and** health) |

Getting this wrong is a classic bug: single-label mode on "which topics does this cover" forces the scores flat — two genuinely relevant topics get 0.5 each and look uncertain.

The demo lets you switch; flip it and the semantics of the numbers change completely.

## What the 68 MB buys

More than double a dedicated classifier (25 MB), in exchange for **no training at all**:

- fixed labels with plenty of data → train a small head, smaller/faster/better;
- labels that change often (new business line, ad-hoc analysis) → zero-shot, one config line.

**A flexibility-versus-efficiency trade, not a question of which is more advanced.**

## Going one level deeper

1. Label wording matters: "sports" and "athletics" can differ by 20%. Practice is to write several synonyms and take the max.
2. Zero-shot scores are **uncalibrated**: 0.6 does not mean 60% correct. Calibrate before thresholding.
3. The ceiling is the NLI model's knowledge: on out-of-domain text (legal statutes, say) the entailment judgement itself fails, and normalising it changes nothing.`
    }
  },

  '/nlp/summarization': {
    python: `"""Summarisation: 284 MB of encoder+decoder, or 30 lines of TextRank.

The page runs distilbart-cnn-6-6 at q8 (128.8 MB encoder + 155.1 MB decoder).
The runnable demo does extractive summarisation, which is a different (cheaper)
answer to the same question.
"""
from collections import Counter
import math
import re


def textrank_summary(text, top_n=3):
    """Extractive: pick existing sentences. No model, no download, and it never
    hallucinates -- it can only quote you back to yourself."""
    sents = [s.strip() for s in re.split(r'(?<=[.!?])\\s+', text) if len(s.strip()) > 20]
    if len(sents) <= top_n:
        return sents

    def words(s):
        return re.findall(r'[a-z]+', s.lower())

    # 1) sentence similarity = shared word count / geometric mean of lengths
    sim = [[0.0] * len(sents) for _ in sents]
    for i in range(len(sents)):
        for j in range(i + 1, len(sents)):
            a, b = Counter(words(sents[i])), Counter(words(sents[j]))
            shared = sum((a & b).values())
            denom = math.log(len(sents[i]) + 1) + math.log(len(sents[j]) + 1)
            s = shared / denom if denom else 0
            sim[i][j] = sim[j][i] = s

    # 2) PageRank over that graph: sentences 'vote' for similar sentences
    scores = [1.0] * len(sents)
    for _ in range(30):
        for i in range(len(sents)):
            total = sum(sim[i][j] * scores[j] / (sum(sim[j]) or 1) for j in range(len(sents)))
            scores[i] = 0.15 + 0.85 * total

    ranked = sorted(range(len(sents)), key=lambda i: -scores[i])[:top_n]
    return [sents[i] for i in sorted(ranked)]          # keep original order


if __name__ == '__main__':
    text = ('Solar panels got much cheaper. Installations doubled in three years. '
            'Grid operators now worry about afternoon peaks. Battery storage is the answer. '
            'Cheap panels changed the economics of storage too.')
    for s in textrank_summary(text, 2):
        print('-', s)


# The page's model is abstractive: it writes new sentences, which can introduce
# facts that were never in the source. That trade -- fluency for faithfulness --
# is why production summarisers are evaluated with factual-consistency metrics.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Extractive summarisation by PageRank</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  textarea{width:100%;box-sizing:border-box;height:118px;padding:9px 11px;border:1px solid #cbd5e1;
    border-radius:8px;font:13px/1.6 system-ui,sans-serif;resize:vertical}
  label{display:inline-flex;align-items:center;gap:8px;margin-top:10px;font-size:12px}
  input[type=range]{width:150px}output{font-variant-numeric:tabular-nums;font-weight:600}
  ol{margin:10px 0 0;padding-left:22px;font-size:13px}
  li{margin-bottom:5px}
  li b{color:#2563eb;font-variant-numeric:tabular-nums;font-size:12px;margin-left:6px}
  .note{color:#64748b;font-size:12px;margin-top:10px}
</style>
</head>
<body>
<h1>It can only quote you</h1>
<p>Extractive summarisation picks sentences that already exist. PageRank ranks them by how many
similar sentences "vote" for them — the same algorithm that ranked web pages in 1998.</p>
<textarea id="t">Solar panels got much cheaper over the last decade. Installations doubled in three years across most markets. Grid operators now worry about the afternoon peak, when generation collapses. Battery storage is the answer to that, and it is getting cheaper too. Cheap panels changed the economics of storage as well, because arbitrage became worth doing. Some utilities are now paying customers to charge at midday.</textarea>
<label>sentences in summary <input type="range" id="n" min="1" max="5" step="1" value="3"><output id="v">3</output></label>
<ol id="out"></ol>
<div class="note">Compare with the page's model: it <i>writes</i> new sentences (abstractive), which
reads better but can invent facts. This one cannot lie — it can only be boring.</div>
<script>
(function () {
  function sentences(text) {
    return text.split(/(?<=[.!?])\\s+/).map(function (s) { return s.trim(); })
               .filter(function (s) { return s.length > 15; });
  }
  function words(s) {
    return (s.toLowerCase().match(/[a-z]+/g) || []);
  }
  function count(arr) {
    var c = {};
    arr.forEach(function (w) { c[w] = (c[w] || 0) + 1; });
    return c;
  }

  function summarise(text, topN) {
    var sents = sentences(text);
    if (sents.length <= topN) return sents.map(function (s) { return { s: s, score: 1 }; });

    // similarity matrix: shared words / log lengths
    var n = sents.length;
    var sim = [];
    for (var i = 0; i < n; i++) { sim.push(new Array(n).fill(0)); }
    for (var i2 = 0; i2 < n; i2++) {
      for (var j = i2 + 1; j < n; j++) {
        var a = count(words(sents[i2])), b = count(words(sents[j]));
        var shared = 0;
        Object.keys(a).forEach(function (w) { if (b[w]) shared += Math.min(a[w], b[w]); });
        var denom = Math.log(sents[i2].length + 1) + Math.log(sents[j].length + 1);
        var v = denom ? shared / denom : 0;
        sim[i2][j] = sim[j][i2] = v;
      }
    }

    // PageRank
    var score = new Array(n).fill(1);
    for (var it = 0; it < 30; it++) {
      var next = new Array(n).fill(0);
      for (var p = 0; p < n; p++) {
        var acc = 0;
        for (var q = 0; q < n; q++) {
          if (p === q) continue;
          var rowSum = sim[q].reduce(function (s, x) { return s + x; }, 0) || 1;
          acc += sim[q][p] * score[q] / rowSum;
        }
        next[p] = 0.15 + 0.85 * acc;
      }
      score = next;
    }

    var order = score.map(function (v, i) { return { v: v, i: i }; })
                     .sort(function (x, y) { return y.v - x.v; }).slice(0, topN);
    order.sort(function (x, y) { return x.i - y.i; });   // keep original order
    return order.map(function (o) { return { s: sents[o.i], score: o.v }; });
  }

  function render() {
    var n = +document.getElementById('n').value;
    document.getElementById('v').textContent = n;
    var rows = summarise(document.getElementById('t').value, n);
    document.getElementById('out').innerHTML = rows.map(function (r) {
      return '<li>' + r.s + '<b>' + r.score.toFixed(2) + '</b></li>';
    }).join('');
  }

  document.getElementById('t').addEventListener('input', render);
  document.getElementById('n').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 抽取式 vs 生成式：两种完全不同的答案

| | 抽取式（TextRank） | 生成式（distilbart） |
| --- | --- | --- |
| 做什么 | **挑**已有句子 | **写**新句子 |
| 会不会编造 | 不会（只能引用原文） | **会**（可能引入原文没有的事实） |
| 体积 | 0 | 284 MB（q8） |
| 读起来 | 生硬、可能跳 | 流畅、连贯 |

页面的模型是生成式的：encoder（128.8 MB）读原文，decoder（155.1 MB）自回归地写摘要。它读起来像人写的，代价是有可能"幻觉"——写出一句原文没有的话。

这就是为什么**生产环境的摘要系统必须评估事实一致性**（faithfulness），而不只是看 ROUGE 分数（那只衡量和参考摘要的词重叠）。

## TextRank 的核心是「句子互相投票」

算法三步，和 PageRank 一模一样：

1. **建图**：每个句子是节点，两句之间的相似度是边的权重（共享词数 / 长度对数）；
2. **迭代**：每句话的分数 = 指向它的邻居的分数加权和，加阻尼因子 0.15；
3. **取 top-n**：分数最高的几句，**按原文顺序**输出。

为什么用对数长度做分母？因为长句子天然有更多共享词，不除会被系统性高估。

**「按原文顺序输出」这一步很重要**：摘要读起来要连贯，如果按分数排序会前后跳动。

## 阻尼因子 0.15 是什么

PageRank 的 \`d = 0.85\` 意思是：一个句子 85% 的分来自邻居投票，15% 是保底（避免孤岛节点得 0 分，也防止分数在迭代中衰减到零）。

这个 0.15 不是随便定的 —— 它保证迭代收敛到唯一解（马尔可夫链的平稳分布）。

## 想深一层

1. 抽取式摘要的一个副作用是**可能选出重复内容**：两句都在说同一件事，都会得高分。真实实现会加"冗余惩罚"（MMR）。
2. 长文（超过 1000 字）用 TextRank 效果会变差，因为句子图变得太稀疏。这时要分层（先分段摘要，再摘要摘要）。
3. 生成式摘要的 \`max_new_tokens\` 是硬约束：设太小会截断在半句，设太大会超过目标长度。页面默认 100，可调到 300 —— 但**它不会因为内容不够而提前停**，只会一直写到上限。`,
      en: `## Extractive vs abstractive: two different answers

| | Extractive (TextRank) | Abstractive (distilbart) |
| --- | --- | --- |
| Does | **picks** existing sentences | **writes** new ones |
| Can invent facts | no (quotes only) | **yes** |
| Size | 0 | 284 MB at q8 |
| Reads like | choppy, may jump | fluent, coherent |

The page's model is abstractive: encoder (128.8 MB) reads the source, decoder (155.1 MB) writes the summary autoregressively. It reads like a person wrote it, and it can hallucinate — state something the source never said.

Which is why **production summarisers are evaluated for factual consistency**, not just ROUGE (which only measures word overlap with a reference).

## TextRank is sentences voting for each other

Three steps, identical to PageRank:

1. **Build a graph**: sentences are nodes, pairwise similarity is edge weight (shared words / log lengths);
2. **Iterate**: each sentence's score is the weighted sum of its neighbours' scores, plus a 0.15 damping term;
3. **Take top-n**, then **emit in original order**.

Why divide by log length? Longer sentences share more words by default; without the correction they are systematically overrated.

**Emitting in original order matters**: a summary must read coherently; sorting by score makes it jump around.

## What the 0.15 damping is

PageRank's \`d = 0.85\` means 85% of a sentence's score comes from neighbours and 15% is a floor (so isolated nodes are not zero, and scores do not decay to nothing).

That 0.15 is not arbitrary — it guarantees the iteration converges to a unique stationary distribution.

## Going one level deeper

1. A side effect of extractive summaries is **duplication**: two sentences saying the same thing both score high. Real implementations add a redundancy penalty (MMR).
2. Past about 1000 words the sentence graph gets too sparse and TextRank degrades; you need hierarchy (summary of summaries).
3. \`max_new_tokens\` is a hard cap for the generative model: too small truncates mid-sentence, too large overshoots. The page defaults to 100 and allows 300 — but **it will not stop early when the content runs out**, it writes to the limit.`
    }
  },

  '/nlp/qa': {
    python: `"""Extractive QA: the answer is a span of the context, not a generated string.

distilbert-squad (q8, 66 MB) predicts two positions: where the answer starts
and where it ends. Everything else is windowing and picking the top k.
"""
from transformers import pipeline

qa = pipeline('question-answering', model='Xenova/distilbert-base-cased-distilled-squad')


def answer(question, context, top_k=3):
    """top_k > 1 matters: the model often has two plausible spans, and the
    second one is sometimes the right one. Show them, do not hide them."""
    res = qa(question=question, context=context, top_k=top_k)
    return [(r['answer'], round(r['score'], 4), r['start'], r['end']) for r in res]


def windows(context, size=384, stride=128):
    """Context longer than the model's max length must be split. The stride
    overlap exists so an answer straddling a boundary still appears whole
    in at least one window."""
    if len(context) <= size:
        return [(0, context)]
    out = []
    start = 0
    while start < len(context):
        end = min(start + size, len(context))
        out.append((start, context[start:end]))
        if end == len(context):
            break
        start += size - stride
    return out


if __name__ == '__main__':
    ctx = 'The Eiffel Tower is 330 metres tall and was completed in 1889. It was designed by Gustave Eiffel.'
    for a in answer('How tall is the Eiffel Tower?', ctx):
        print(a)
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Answer spans, not answers</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  input[type=text],textarea{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;
    border-radius:8px;font:13px/1.5 system-ui,sans-serif}
  textarea{height:86px;margin-top:8px;resize:vertical}
  .ctx{margin-top:12px;line-height:2.1;font-size:13px}
  .ctx span.hit{background:#bbf7d0;border-radius:3px;padding:1px 2px}
  .ctx span.hit2{background:#fef3c7;border-radius:3px;padding:1px 2px}
  .rank{margin-top:10px;font-size:12px;color:#475569}
  .rank b{font-variant-numeric:tabular-nums;color:#0f172a}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>The model points at two positions</h1>
<p>SQuAD-style QA scores every token as a possible answer start and end, then takes the best
(start, end) pair. This demo scores windows by keyword overlap so you can see the shape of the
problem: multiple plausible spans, ranked.</p>
<input type="text" id="q" value="how tall is the tower">
<textarea id="c">The Eiffel Tower is 330 metres tall and was completed in 1889. It was designed by Gustave Eiffel. The tower was the tallest structure in the world until 1930, when the Chrysler Building opened in New York.</textarea>
<div class="ctx" id="ctx"></div>
<div class="rank" id="rank"></div>
<div class="note">Note span #2: a correct-looking phrase that answers a different question. Real
models have the same failure mode — the ranking is why top-k matters.</div>
<script>
(function () {
  function tokens(s) {
    return (s.toLowerCase().match(/[a-z0-9]+/g) || []);
  }

  function spansOf(context) {
    // every contiguous run of 1-5 tokens is a candidate span (the model scores
    // all of them; we only need the plausible ones for display)
    var m = [], re = /[A-Za-z0-9]+/g, x;
    while ((x = re.exec(context))) m.push({ w: x[0], i: x.index });
    var spans = [];
    for (var s = 0; s < m.length; s++) {
      for (var len = 1; len <= 4 && s + len <= m.length; len++) {
        var a = m[s], b = m[s + len - 1];
        spans.push({ text: context.slice(a.i, b.i + b.w.length), start: a.i, end: b.i + b.w.length });
      }
    }
    return spans;
  }

  function score(q, span, context) {
    var qt = tokens(q), st = tokens(span.text);
    // overlap with the question, minus a length penalty and a small frequency bias
    var hit = 0;
    qt.forEach(function (w) { if (st.indexOf(w) !== -1) hit++; });
    if (!hit) return 0;
    var lenPenalty = 1 / (1 + Math.abs(st.length - 2) * 0.15);
    // prefer spans near content words that the question asks about
    var typed = /how (tall|long|old|many|much)/.test(q) && /\\d/.test(span.text) ? 1.35 : 1;
    return (hit / qt.length) * lenPenalty * typed;
  }

  function render() {
    var q = document.getElementById('q').value;
    var ctx = document.getElementById('c').value;
    var scored = spansOf(ctx).map(function (s) {
      return { s: s, v: score(q, s, ctx) };
    }).filter(function (x) { return x.v > 0.05; })
      .sort(function (a, b) { return b.v - a.v; });

    // de-duplicate overlapping spans, keep top 2 for display
    var picked = [];
    scored.forEach(function (x) {
      if (picked.length >= 2) return;
      if (picked.some(function (p) { return x.s.start < p.s.end && p.s.start < x.s.end; })) return;
      picked.push(x);
    });

    var html = '', cursor = 0;
    picked.slice().sort(function (a, b) { return a.s.start - b.s.start; }).forEach(function (p, k) {
      html += ctx.slice(cursor, p.s.start);
      html += '<span class="' + (p === picked[0] ? 'hit' : 'hit2') + '">' + ctx.slice(p.s.start, p.s.end) + '</span>';
      cursor = p.s.end;
    });
    html += ctx.slice(cursor);
    document.getElementById('ctx').innerHTML = html;

    document.getElementById('rank').innerHTML = picked.length
      ? picked.map(function (p, i) {
          return '#' + (i + 1) + ' "<b>' + p.s.text + '</b>" score <b>' + p.v.toFixed(2) + '</b>';
        }).join(' &nbsp;·&nbsp; ')
      : 'no plausible span — the model would return an empty answer';
  }

  ['q', 'c'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 抽取式问答：模型只指位置，不写句子

\`distilbert-squad\` 做的是**阅读理解式抽取**：给一段上下文和一个问题，它输出两个数字 —— 答案在上下文里的**起始位置和结束位置**。

这解释了两件事：

1. **它不会编造**：答案一定是从原文里切出来的（这是它比生成式问答安全的地方）；
2. **它不会改写**：问"塔有多高"，它给你的原文里的"330 metres"，不是"330 米高"。

## 为什么要 top-k 和三段窗口

**top-k**：模型的输出是在所有可能 span 上的分布，但第二名经常也很高。只取第一名会丢掉正确答案（尤其问题模糊时）。页面给 3 个候选，让人自己判断。

**窗口 + 重叠**：SQuAD 模型的最大输入是 384 token。长文必须切段，而且段与段之间要**重叠 128 token** —— 否则答案正好跨在边界上时，两段都看不到完整答案。这是实现文档问答时最容易漏的一步。

## 模型的两种失败模式

**一、指错位置**（span boundary error）：模型觉得答案从"330"开始，但实际上是"330 metres" —— 差一个词，语义就变了。

**二、答非所问**：问题问"塔有多高"，它返回"tallest structure in the world"（也是原文里的塔相关的短语，但不是答案）。这在页面示例里用第二个高亮展示了 —— 看起来很像答案，其实是错的。

**这两种错误都不会报错**，只会给出一个看起来合理的字符串。这就是为什么生产系统要 \`score\` 阈值 + 人工兜底。

## 为什么用 distilbert-squad 只有 66 MB

因为任务是**抽取**，不是生成：不需要 decoder，不需要语言模型头，只要一个 token 分类头（每个 token 是答案起点的概率、是终点的概率）。

对比摘要任务（需要 decoder，284 MB），问答模型的成本低一个量级。**任务形态决定了模型大小。**

## 想深一层

1. 上下文太长（超过 1 万 token）时，真正的瓶颈是"从哪个窗口取结果" —— 要跨窗口比较分数，而不同窗口的分数不可直接比较（因为模型没看到全局）。
2. 否定句是经典难题："塔不是 330 米高" —— 模型仍会把"330 米"标为答案。
3. 想要生成式问答（能整合多个片段、能改写），要用 LLM + RAG。代价是可能编造，所以工业界常用"抽取 + 生成"混合：先抽取证据，再让 LLM 基于证据组织语言。`,
      en: `## Extractive QA: the model points at positions, it does not write

\`distilbert-squad\` does **reading-comprehension extraction**: given context and question, it outputs two numbers — the **start and end position** of the answer in the context.

Two consequences:

1. **It cannot invent**: the answer is always a slice of the source (which is why it is safer than generative QA);
2. **It cannot rewrite**: ask "how tall is the tower" and you get "330 metres", not "330 m tall".

## Why top-k and overlapping windows

**top-k**: the output is a distribution over all spans, and the runner-up is often strong. Taking only the first loses correct answers (especially with vague questions). The page shows three candidates and lets you judge.

**Windows with overlap**: SQuAD models cap input at 384 tokens. Long documents must be split, and consecutive chunks must **overlap by 128 tokens** — otherwise an answer straddling a boundary appears whole in neither. The step most implementations forget.

## Two failure modes

**One: wrong boundaries.** The model thinks the answer starts at "330" when it should be "330 metres" — one word off, meaning changed.

**Two: right-looking but wrong.** Asked how tall, it returns "tallest structure in the world" — a tower-related phrase from the source, but not the answer. The demo highlights exactly this as span #2: plausible, incorrect.

**Neither raises an error.** You get a plausible-looking string. Which is why production systems threshold on \`score\` and keep a human in the loop.

## Why distilbert-squad is only 66 MB

Because the task is extraction, not generation: no decoder, no language-model head, just a token classifier (probability that each token starts / ends the answer).

Compare summarisation (needs a decoder, 284 MB): **task shape determines model size** by an order of magnitude.

## Going one level deeper

1. Past ~10k tokens the real problem is choosing *which* window's answer to trust — scores across windows are not comparable, because the model never saw the whole document.
2. Negation is the classic failure: "the tower is not 330 metres tall" still gets "330 metres" marked as the answer.
3. Generative QA (integrating fragments, rewriting) needs an LLM plus retrieval. That can hallucinate, so industry often mixes both: extract evidence first, then have the LLM phrase it.`
    }
  },

  '/nlp/fill-mask': {
    python: `"""Fill-mask: BERT's original pretraining task, exposed as a toy.

bert-base-uncased at q8 is 111 MB for what looks like a party trick -- but it is
the exact objective that taught the model everything it knows.
"""
import math
from collections import Counter


def mask_predictions(sentence, vocab_prior, context_scores=None, top_k=5):
    """The real model puts the [MASK] token through 12 transformer layers and
    reads a distribution over 30k vocabulary entries. This function shows the
    last step only: softmax over candidate scores."""
    scores = dict(vocab_prior)
    if context_scores:
        # context multiplies the prior: what fits THIS sentence wins
        for w, boost in context_scores.items():
            scores[w] = scores.get(w, 0.0) + boost
    m = max(scores.values()) if scores else 0
    exp = {w: math.exp(s - m) for w, s in scores.items()}
    total = sum(exp.values()) or 1
    ranked = sorted(exp.items(), key=lambda kv: -kv[1])[:top_k]
    return [(w, round(v / total, 4)) for w, v in ranked]


# Why BERT can do this at all: it reads BOTH directions.
# A left-to-right model answering "the capital of France is [MASK]" does not know
# the sentence ends with "and it is crowded in summer". BERT does.
if __name__ == '__main__':
    prior = {'Paris': 0.1, 'London': 0.2, 'Rome': 0.15, 'the': 0.4, 'a': 0.15}
    ctx = {'Paris': 5.0, 'Rome': 1.0}      # "France" and "Eiffel" push Paris up
    print(mask_predictions('the capital of France is [MASK]', prior, ctx))
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fill-mask: prior vs context</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .sent{font-size:16px;line-height:1.9;padding:11px 13px;background:#fff;border:1px solid #cbd5e1;border-radius:8px}
  .mask{background:#fde68a;border-radius:4px;padding:1px 9px;font-family:ui-monospace,monospace}
  .bars{margin-top:12px}
  .bar{display:flex;align-items:center;gap:9px;margin-bottom:6px;font-size:12px}
  .bar b{width:92px;font-weight:500;font-family:ui-monospace,monospace}
  .bar i{display:block;height:12px;background:#2563eb;border-radius:3px;transition:width .12s}
  .bar span{font-variant-numeric:tabular-nums;color:#475569;width:52px;text-align:right}
  select{font:inherit;font-size:12px;padding:5px 8px;border-radius:6px;border:1px solid #cbd5e1;background:#fff}
  .note{color:#64748b;font-size:12px;margin-top:10px}
</style>
</head>
<body>
<h1>The mask sees both sides</h1>
<p>Change the sentence and watch the ranking move. This demo scores candidates from a small lexicon
weighted by the surrounding words — the real model does the same thing with 12 layers of attention.</p>
<div class="sent" id="sent"></div>
<div style="margin-top:10px">
  <select id="pick">
    <option value="0">the capital of France is [MASK]</option>
    <option value="1">she poured milk into her [MASK]</option>
    <option value="2">the [MASK] barked at the postman</option>
    <option value="3">he wrote the answer in his [MASK]</option>
  </select>
</div>
<div class="bars" id="bars"></div>
<div class="note">Left-to-right models fail on some of these: in "the [MASK] barked at the postman",
the word to the right ("barked") is what decides it is an animal. That is the entire argument for
bidirectional pretraining.</div>
<script>
(function () {
  var CASES = [
    { text: 'the capital of France is [MASK]', cue: { paris: 9, france: 7, capital: 3 },
      cands: ['paris', 'london', 'rome', 'berlin', 'madrid'] },
    { text: 'she poured milk into her [MASK]', cue: { milk: 8, poured: 5, into: 2 },
      cands: ['cup', 'glass', 'bowl', 'hand', 'box'] },
    { text: 'the [MASK] barked at the postman', cue: { barked: 9, postman: 4, at: 1 },
      cands: ['dog', 'cat', 'car', 'man', 'child'] },
    { text: 'he wrote the answer in his [MASK]', cue: { wrote: 8, answer: 6, in: 1 },
      cands: ['notebook', 'hand', 'book', 'phone', 'sand'] }
  ];
  // a tiny co-occurrence prior, standing in for the model's learned knowledge
  var PRIOR = {
    paris: { france: 1.0, capital: 0.9, milk: 0 },
    london: { france: 0.2, capital: 0.85 },
    rome: { france: 0.1, capital: 0.8 },
    berlin: { france: 0.05, capital: 0.8 },
    madrid: { france: 0.05, capital: 0.75 },
    cup: { milk: 0.9, poured: 0.8 },
    glass: { milk: 0.85, poured: 0.7 },
    bowl: { milk: 0.6, poured: 0.3 },
    hand: { milk: 0.2, poured: 0.1, wrote: 0.4 },
    box: { milk: 0.05 },
    dog: { barked: 0.95, postman: 0.7 },
    cat: { barked: 0.3, postman: 0.2 },
    car: { barked: 0.02 },
    man: { barked: 0.05, postman: 0.3 },
    child: { barked: 0.05 },
    notebook: { wrote: 0.85, answer: 0.7 },
    book: { wrote: 0.6, answer: 0.4 },
    phone: { wrote: 0.2 },
    sand: { wrote: 0.05 }
  };

  function render() {
    var c = CASES[+document.getElementById('pick').value];
    document.getElementById('sent').innerHTML =
      c.text.replace('[MASK]', '<span class="mask">[MASK]</span>');

    var rows = c.cands.map(function (w) {
      var prior = PRIOR[w] || {};
      var score = 0.05;
      Object.keys(c.cue).forEach(function (ctx) {
        score += (prior[ctx] || 0) * c.cue[ctx] * 0.1;
      });
      return { w: w, s: score };
    });
    var max = Math.max.apply(null, rows.map(function (r) { return r.s; }));
    var exp = rows.map(function (r) { return Math.exp((r.s - max) * 2); });
    var total = exp.reduce(function (a, b) { return a + b; }, 0);
    rows = rows.map(function (r, i) { return { w: r.w, p: exp[i] / total }; })
               .sort(function (a, b) { return b.p - a.p; });

    document.getElementById('bars').innerHTML = rows.map(function (r, i) {
      return '<div class="bar"><b>' + r.w + '</b>' +
             '<i style="width:' + Math.max(2, r.p * 250) + 'px;background:' +
             (i === 0 ? '#2563eb' : '#93c5fd') + '"></i>' +
             '<span>' + (r.p * 100).toFixed(1) + '%</span></div>';
    }).join('');
  }

  document.getElementById('pick').addEventListener('change', render);
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 这是 BERT 的原始训练任务

\`fill-mask\` 不是"顺便做的一个小功能"，它就是 BERT 的**预训练目标**：随机遮住 15% 的 token，让模型猜。

模型之所以懂语法、懂常识、懂世界知识，就是因为在上亿条句子上反复做这个练习。**这一页把训练目标直接暴露成界面**，所以它看起来像个玩具，实际上是最本质的那一层。

## 双向才是关键

看页面第三个例子：\`the [MASK] barked at the postman\`

决定答案是"dog"的信息是**右边的 "barked"**。一个从左往右读的模型（GPT 系列）在读到 \`[MASK]\` 时还没看到 "barked"，只能靠先验猜。

BERT 的自注意力让每个位置都能看到**全句**，所以它同时用了"the"（左侧）和"barked"（右侧）。

**这就是 BERT（编码器，双向）与 GPT（解码器，单向）最根本的区别**：前者擅长理解（分类、抽取、填空），后者擅长生成（续写、对话）。今天的大模型几乎都是后者 —— 因为生成任务没法双向（会看到答案）。

## 111 MB 花在哪

\`bert-base-uncased\` 有 1.1 亿参数：12 层 Transformer、768 维隐藏层、3 万词表。q8 量化后 111 MB。

对一个"填空"功能来说这很贵，但它的价值不在填空本身 —— 在于**同一份权重可以微调出 NER、问答、分类、句向量**（这一页前面那几个工具都是它微调的产物）。

**一个预训练模型，多个下游任务。** 这是 2018 年之后 NLP 的基本范式。

## 想深一层

1. 页面的示例用词表 + 上下文加权近似，真实模型是对 3 万个词做 softmax —— 但**最后一步的数学完全一样**（logits → softmax → top-k）。
2. \`[MASK]\` 在预训练时出现，但在下游微调时不存在 —— 这个不一致是 BERT 的设计缺陷（叫 pretrain-finetune mismatch）。RoBERTa 等后续工作专门讨论过。
3. 掩码比例 15% 不是随便定的：太低学不到东西，太高上下文不够。80/10/10 的替换策略（80% 用 [MASK]、10% 随机词、10% 原词）是为了让模型不依赖 [MASK] 这个特殊符号。`,
      en: `## This is BERT's original training objective

\`fill-mask\` is not a side feature — it is **BERT's pretraining task**: mask 15% of tokens at random and predict them.

The model understands grammar, common sense and world knowledge because it did this exercise over hundreds of millions of sentences. **This page exposes the training objective as a UI**, which is why it looks like a toy and is actually the most fundamental layer.

## Bidirectionality is the point

Look at the third example: \`the [MASK] barked at the postman\`

The deciding evidence is **"barked" on the right**. A left-to-right model (GPT family) has not seen "barked" yet when it reaches \`[MASK]\`, so it can only guess from priors.

BERT's self-attention lets every position see the **whole sentence**, so it uses both "the" (left) and "barked" (right).

**That is the root difference between BERT (encoder, bidirectional) and GPT (decoder, causal)**: the first excels at understanding (classification, extraction, cloze), the second at generation. Nearly all large models today are the second kind — generation cannot be bidirectional without seeing the answer.

## Where the 111 MB goes

\`bert-base-uncased\` has 110M parameters: 12 Transformer layers, 768 hidden dims, a 30k vocabulary. 111 MB after q8.

Expensive for a fill-in-the-blank toy — but its value is not the cloze task. **The same weights fine-tune into NER, QA, classification and sentence embeddings** (all the preceding tools on this page are its fine-tunes).

**One pretrained model, many downstream tasks.** That has been the shape of NLP since 2018.

## Going one level deeper

1. The demo approximates with a lexicon plus context weighting; the real model softmaxes over 30k words — but **the final maths is identical** (logits → softmax → top-k).
2. \`[MASK]\` exists in pretraining but not in downstream fine-tuning. That inconsistency is a known BERT design flaw (pretrain-finetune mismatch), discussed at length by RoBERTa and successors.
3. The 15% mask rate is not arbitrary: too low learns nothing, too high starves context. The 80/10/10 substitution (80% [MASK], 10% random, 10% original) exists so the model does not over-rely on the [MASK] token.`
    }
  },

  '/nlp/mediapipe-text': {
    python: `"""Three MediaPipe text tasks, 32 MB total. The point is the size ladder.

  language_detector.tflite        315 KB, 111 classes
  universal_sentence_encoder      6.1 MB, 100 dims
  bert_classifier.tflite         25.7 MB, 2 classes
"""
import numpy as np


def size_ladder():
    """Why the order matters: run the cheapest model first and let it decide
    what to load next. 315 KB of routing can save 25 MB of download."""
    return [
        ('detect language', 0.315, 'always run, 5 ms'),
        ('embed / compare', 6.1, 'only if you need similarity'),
        ('classify sentiment', 25.7, 'only after the language is known'),
    ]


def detect_language(text):
    """Stand-in for language_detector.tflite (315 KB, 111 classes).
    Swap in the real detector and everything below keeps working."""
    return [('en', 0.94), ('zh', 0.04), ('fr', 0.02)]


def pipeline(text, embedder, classifier, compare_to=None):
    """A realistic order, with every step conditional."""
    # 1) always: which language? (cheap, and it gates everything else)
    lang, p = detect_language(text)[0]
    if p < 0.4:
        return {'error': 'language uncertain', 'top': lang, 'p': round(p, 3)}

    out = {'language': lang, 'language_p': round(p, 3)}

    # 2) only if asked: an embedding for similarity search
    if embedder is not None:
        vec = embedder.embed(text)                 # 100 dims
        if compare_to is not None:
            out['similarity'] = round(float(vec @ compare_to), 3)

    # 3) only if the language is supported: sentiment
    if classifier is not None and lang in ('en', 'zh'):
        label, score = classifier.classify(text)
        out['sentiment'] = {'label': label, 'score': round(score, 3)}

    return out


# The number that matters here: 315 KB + 6.1 MB + 25.7 MB = 32.1 MB for three
# tasks, against a single 111 MB BERT. Small specialised models still win when
# the task really is small.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>32 MB for three tasks</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:600px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .row{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:12px}
  label{display:inline-flex;gap:6px;align-items:center}
  .log{margin-top:10px;font:12px/1.9 ui-monospace,monospace;color:#334155}
  .log b{color:#2563eb}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Cheap first, expensive later</h1>
<p>Three tasks, 32 MB total, and they are not loaded together. The 315 KB language detector runs
first because every later decision depends on its answer.</p>
<canvas id="c" width="600" height="200"></canvas>
<div class="row">
  <label><input type="checkbox" id="embed" checked> need sentence embedding</label>
  <label><input type="checkbox" id="cls"> need sentiment</label>
  <label><input type="checkbox" id="bad"> input is gibberish</label>
</div>
<div class="log" id="log"></div>
<div class="note">Uncheck the embedding step and the total drops from 32 MB to 25.7 MB — the lesson is
that model choice is a routing decision, not a fixed dependency graph.</div>
<script>
(function () {
  function draw(steps) {
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 600, H = 200;
    ctx.clearRect(0, 0, W, H);
    var y = 36;
    steps.forEach(function (s, i) {
      var w = Math.max(28, s.mb / 26 * 420);
      ctx.fillStyle = s.loaded ? '#2563eb' : '#e2e8f0';
      ctx.fillRect(16, y, w, 26);
      ctx.fillStyle = s.loaded ? '#fff' : '#64748b';
      ctx.font = '12px ui-monospace, monospace';
      ctx.fillText(s.name, 24, y + 17);
      ctx.fillStyle = s.loaded ? '#0f172a' : '#94a3b8';
      ctx.font = '12px system-ui';
      ctx.fillText((s.mb < 1 ? Math.round(s.mb * 1000) + ' KB' : s.mb.toFixed(1) + ' MB'), 16 + w + 10, y + 17);
      y += 38;
    });
    ctx.fillStyle = '#475569'; ctx.font = '12px ui-monospace, monospace';
    var total = steps.filter(function (s) { return s.loaded; })
                     .reduce(function (a, s) { return a + s.mb; }, 0);
    ctx.fillText('downloaded: ' + (total < 1 ? Math.round(total * 1000) + ' KB' : total.toFixed(1) + ' MB'), 16, H - 12);
  }

  function render() {
    var embed = document.getElementById('embed').checked;
    var cls = document.getElementById('cls').checked;
    var bad = document.getElementById('bad').checked;

    var steps = [
      { name: 'language detector', mb: 0.315, loaded: true },
      { name: 'sentence encoder', mb: 6.1, loaded: embed },
      { name: 'sentiment classifier', mb: 25.7, loaded: cls && !bad }
    ];
    draw(steps);

    var lines = [];
    lines.push('1. detect_language() -> <b>' + (bad ? 'unknown (p = 0.21)' : 'en (p = 0.98)') + '</b>  [315 KB, always]');
    if (bad) {
      lines.push('2. confidence below 0.4 -> <b>stop</b>. Loading a 25 MB model on a guess is waste.');
    } else {
      lines.push('2. ' + (embed ? 'embed() -> 100 dims  <b>[+6.1 MB]</b>' : 'embedding not needed -> <b>skip 6.1 MB</b>'));
      lines.push('3. ' + (cls ? 'classify() -> positive 0.97  <b>[+25.7 MB]</b>' : 'sentiment not needed -> <b>skip 25.7 MB</b>'));
    }
    document.getElementById('log').innerHTML = lines.join('<br>');
  }

  ['embed', 'cls', 'bad'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 三个任务，32 MB，但不该一起加载

| 工具 | 模型 | 体积 | 何时跑 |
| --- | --- | --- | --- |
| 语言检测 | \`language_detector\` | **315 KB** | 总是（5 ms） |
| 句向量 | \`universal_sentence_encoder\` | 6.1 MB | 需要相似度时才跑 |
| 文本分类 | \`bert_classifier\` | 25.7 MB | 语言确认后才跑 |

这一页的侧栏就把三个工具并列，暗示了正确的加载顺序：**先跑最便宜的，用它的结果决定要不要加载更贵的。**

如果一开始就把三个模型都拉下来（32 MB），而用户只是想知道"这段文字是中文还是英文"，那 32 MB 里的 31.7 MB 是白花的。

## 315 KB 的检测器为什么值得先跑

真实现里有个更实际的理由：**分类模型是有语言限制的**。\`bert_classifier\` 是英文模型，喂中文进去会给出一个"看起来正常但完全错误"的分数。

所以正确的顺序是：

\`检测语言 → 不是支持的语种就停 → 是才加载对应模型\`

页面的 HTML 示例把这条决策链画出来了：勾掉"need sentiment"，总下载从 32 MB 掉到 25.7 MB；勾上"input is gibberish"，**一个模型都不加载**（置信度 0.21 < 0.4，直接停）。

**最后那种情况最值得注意**：模型给了一个答案（"unknown"，p=0.21），但系统选择不用它。这才是"真正在工程里用模型"的样子。

## 三个小模型 vs 一个大模型

| 方案 | 体积 | 能力 |
| --- | --- | --- |
| 三个 MediaPipe 任务 | **32.1 MB** | 语言 + 相似度 + 情感 |
| 一个 BERT-base | 111 MB | 只有填空/微调后才能做别的 |

小模型在**任务窄而确定**时绝对占优。BERT-base 的优势是"一份权重能微调出 N 个任务"，但那是研发阶段的优势 —— 部署时你只需要那一个任务。

**所以：训练时用大模型，部署时蒸馏/换成小模型。** 这是几乎所有生产 NLP 系统的路线。

## 想深一层

1. MediaPipe 三个任务共用同一个 WASM 运行时（\`FilesetResolver.forTextTasks\`），所以换工具时不用重新初始化运行时 —— 只换模型。这个设计省的是**固定开销**，不是模型体积。
2. 100 维的句向量和 768 维的 BERT 句向量比，检索精度会低一些。但 6.1 MB vs 111 MB，在浏览器里这就是"能不能用"的差别。
3. 语言检测器的 111 类里包含了相似语种（挪威语/丹麦语）。短文本上这两者经常无法区分 —— 这也是为什么它必须给出概率而不是硬判定。`,
      en: `## Three tasks, 32 MB, and they should not load together

| Tool | Model | Size | When |
| --- | --- | --- | --- |
| Language detection | \`language_detector\` | **315 KB** | always (5 ms) |
| Sentence embedding | \`universal_sentence_encoder\` | 6.1 MB | only for similarity |
| Classification | \`bert_classifier\` | 25.7 MB | only after language is known |

The sidebar puts all three side by side, hinting at the right order: **run the cheapest, let its result decide whether the expensive ones are needed.**

Pull all three up front (32 MB) when the user only wants "is this Chinese or English", and 31.7 of those 32 MB were wasted.

## Why the 315 KB detector goes first

In real implementations there is a harder reason: **classifiers are language-bound**. \`bert_classifier\` is English-only; feeding it Chinese yields a normal-looking but completely wrong score.

So the order is:

\`detect language -> not supported, stop -> supported, load that model\`

The demo draws this chain: uncheck "need sentiment" and the download drops from 32 MB to 25.7; check "input is gibberish" and **no model loads at all** (confidence 0.21 < 0.4, stop).

**The last case is the instructive one**: the model gave an answer ("unknown", p=0.21) and the system declined to use it. That is what using a model in production actually looks like.

## Three small models vs one large one

| Approach | Size | Capability |
| --- | --- | --- |
| Three MediaPipe tasks | **32.1 MB** | language + similarity + sentiment |
| One BERT-base | 111 MB | cloze only until you fine-tune it |

Small models win outright when **the task is narrow and fixed**. BERT-base's advantage is "one set of weights fine-tunes into N tasks" — a research-time advantage; at deploy time you only need the one.

**So: train big, then distil or swap in a small model for deployment.** The path of nearly every production NLP system.

## Going one level deeper

1. MediaPipe's three tasks share one WASM runtime (\`FilesetResolver.forTextTasks\`), so switching tools does not re-initialise the runtime — only the model. That saves **fixed overhead**, not model size.
2. A 100-d sentence vector is less precise for retrieval than BERT's 768-d. But 6.1 MB vs 111 MB in a browser is the difference between "usable" and "not".
3. The 111 classes include near-identical languages (Norwegian/Danish). Short text cannot separate them — which is why the model must return probabilities rather than a hard label.`
    }
  },

  '/nlp/transformers': {
    python: `"""Six pipelines, one cache. The interesting engineering is not the models
but what happens between calls.
"""
import time

_CACHE = {}


def get_pipeline(task, model, device, loader):
    """Three keys: task, model, device. Miss any one and you rebuild -- which
    on WebGPU means recompiling shaders, i.e. seconds, not milliseconds.
    'loader' is the framework's own factory: pipeline(task, model, {device, dtype})."""
    key = (task, model, device)
    if key not in _CACHE:
        t0 = time.time()
        _CACHE[key] = loader(task, model, device)
        print(f'[cold] {task} on {device}: {time.time() - t0:.1f}s')
    return _CACHE[key]


def pick_device(has_webgpu, has_shader_f16):
    """The page probes once: WebGPU first, WASM as the floor. Note that
    q4f16 requires shader-f16 -- without it you must fall back to q4."""
    if has_webgpu:
        return ('webgpu', 'q4f16' if has_shader_f16 else 'q4')
    return ('wasm', 'q8')


TASKS = {
    'sentiment':      ('distilbert-sst-2', 'q8', '~67 MB'),
    'ner':            ('bert-base-ner', 'q8', '110 MB'),
    'zero-shot':      ('distilbert-mnli', 'q8', '68 MB'),
    'summarization':  ('distilbart-cnn', 'q8', '284 MB'),
    'qa':             ('distilbert-squad', 'q8', '66 MB'),
    'fill-mask':      ('bert-base-uncased', 'q8', '111 MB'),
}

# Total if you loaded all six: ~706 MB. Nobody does. The sidebar switches tasks,
# and only the selected one is ever instantiated.
if __name__ == '__main__':
    print(sum(1 for _ in TASKS), 'tasks,', '706 MB if you were careless')
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>The cache is the feature</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .tasks{display:flex;flex-wrap:wrap;gap:6px}
  button{font:inherit;font-size:12px;padding:6px 11px;border-radius:6px;border:1px solid #cbd5e1;
    background:#fff;cursor:pointer}
  button.on{background:#2563eb;color:#fff;border-color:#2563eb}
  button.cached{border-color:#16a34a;color:#166534}
  button.cached.on{background:#16a34a;border-color:#16a34a;color:#fff}
  .stat{margin-top:14px;font:12px/1.9 ui-monospace,monospace;color:#334155}
  .stat b{color:#2563eb}
  .bar{height:9px;background:#e2e8f0;border-radius:4px;overflow:hidden;margin-top:6px;max-width:420px}
  .bar i{display:block;height:100%;background:#f59e0b;transition:width .3s}
  .note{color:#64748b;font-size:12px;margin-top:10px}
</style>
</head>
<body>
<h1>Switching tasks should be instant the second time</h1>
<p>Six pipelines, ~706 MB if you instantiated all of them. The page keeps a cache keyed by
task + model + device, so re-selecting a task you already used is free. Click around and watch the
cold/warm split.</p>
<div class="tasks" id="tasks"></div>
<div class="stat" id="stat"></div>
<div class="bar"><i id="prog" style="width:0"></i></div>
<div class="note">Changing the device invalidates the cache — that is why "WebGPU failed, retry on WASM"
costs a full reload rather than a fallback.</div>
<script>
(function () {
  var TASKS = [
    { id: 'sentiment', mb: 67, cold: 2.1 },
    { id: 'ner', mb: 110, cold: 3.4 },
    { id: 'zero-shot', mb: 68, cold: 2.3 },
    { id: 'summarization', mb: 284, cold: 7.8 },
    { id: 'qa', mb: 66, cold: 2.0 },
    { id: 'fill-mask', mb: 111, cold: 3.5 }
  ];
  var cache = {};
  var current = null;
  var busy = false;

  function totalMB() {
    return Object.keys(cache).reduce(function (a, k) {
      return a + (TASKS.find(function (t) { return t.id === k; }) || { mb: 0 }).mb;
    }, 0);
  }

  function render(stat) {
    document.getElementById('tasks').innerHTML = TASKS.map(function (t) {
      var cls = 'task' + (t.id === current ? ' on' : '') + (cache[t.id] ? ' cached' : '');
      return '<button class="' + cls + '" data-id="' + t.id + '">' + t.id +
             ' <small>' + t.mb + ' MB</small></button>';
    }).join('');
    document.querySelectorAll('#tasks button').forEach(function (b) {
      b.addEventListener('click', function () { select(b.dataset.id); });
    });

    var lines = [
      'device: webgpu (shader-f16 yes)  dtype: q4f16',
      'cached tasks: <b>' + Object.keys(cache).length + '</b> / ' + TASKS.length,
      'memory held: <b>' + totalMB() + ' MB</b>'
    ];
    if (stat) lines.push(stat);
    document.getElementById('stat').innerHTML = lines.join('<br>');
  }

  function select(id) {
    if (busy) return;
    var t = TASKS.find(function (x) { return x.id === id; });
    current = id;

    if (cache[id]) {
      render('switched to <b>' + id + '</b> — warm, 0.0 s (already loaded)');
      document.getElementById('prog').style.width = '0';
      return;
    }

    busy = true;
    render('loading <b>' + id + '</b> … cold start, compiling shaders');
    var t0 = Date.now();
    var dur = t.cold * 1000;
    var timer = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / dur);
      document.getElementById('prog').style.width = (k * 100) + '%';
      if (k >= 1) {
        clearInterval(timer);
        cache[id] = true;
        busy = false;
        render('loaded <b>' + id + '</b> in ' + t.cold.toFixed(1) + ' s — now cached');
        document.getElementById('prog').style.width = '0';
      }
    }, 60);
  }

  render('pick a task');
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 六个任务，706 MB，但每次只加载一个

| 任务 | 模型 | q8 体积 |
| --- | --- | --- |
| 情感 | distilbert-sst-2 | 67 MB |
| NER | bert-base-ner | 110 MB |
| 零样本 | distilbert-mnli | 68 MB |
| 摘要 | distilbart-cnn | **284 MB** |
| 问答 | distilbert-squad | 66 MB |
| 填空 | bert-base-uncased | 111 MB |

加起来 706 MB。如果页面在加载时把六个全实例化，浏览器直接崩 —— 所以侧栏切换任务时**只实例化选中的那个**。

## 缓存键是三元组：task + model + device

这一页真正的工程点在这里：

\`key = (task, model, device)\`

三个都可能变，任何一个变了就必须重建：

- **task 变**（情感 → NER）：换模型，重建；
- **model 变**（同一个任务换更小的模型）：重建；
- **device 变**（WebGPU 失败回退 WASM）：**也要重建** —— 因为上次编译的 shader 用不上。

第三条最容易被忽略。表现是：WebGPU 在某个设备上失败，代码切到 WASM，然后用户感觉"每次用都很慢" —— 因为设备探测在每次调用时都重新做了一遍，缓存永远不命中。

## 冷启动为什么是秒级

WebGPU 的模型加载不只是下载权重：

1. 下载 ONNX 权重（66–284 MB）；
2. 创建 GPU buffer；
3. **给每个算子编译着色器**（这一步最慢，且因设备而异）。

所以「首次加载 2–8 秒，之后切换任务 0 秒」是正常表现。页面的示例把 cold/warm 的区别做成了可点击的：

- 第一次点某个任务 → 显示 "loading … cold start" + 进度条；
- 再点回来 → "warm, 0.0 s"。

**这个体验差别就是缓存的价值**，也是为什么真实实现里宁可多占几百 MB 内存也不愿意重建。

## q8 和 q4f16 的选择

页面的规则是：

\`有 WebGPU 且支持 shader-f16 → q4f16；否则 → q8（WASM）\`

- **q4f16**：权重 4 位、激活 16 位。只有 GPU 支持半精度（\`shader-f16\`）时才能跑，体积小一半以上；
- **q8**：通用、精度更高、CPU 上更快。

判断 \`shader-f16\` 需要查 \`adapter.features\`（\`/aigc/capabilities\` 那一页就是干这个的）。**不检查就直接用 q4f16，会得到一堆 NaN 或直接失败** —— 这是把 Transformers.js 上生产时最常见的坑。

## 想深一层

1. 内存也是约束：同时缓存三个大模型（284 + 111 + 110 = 505 MB）在低端设备上会 OOM。所以真实实现还要做 LRU 淘汰，页面的示例没做。
2. 同一任务的不同模型**不能共用缓存**（key 里有 model）。这是对的 —— 换了模型就是换了网络。
3. 「按需加载」和「预加载」是矛盾的：预加载能消除冷启动，但首屏就可能下载 100 MB。折中是**在用户 hover 侧栏时预取**（页面没做，但这是常见优化）。`,
      en: `## Six tasks, 706 MB, one loaded at a time

| Task | Model | q8 size |
| --- | --- | --- |
| Sentiment | distilbert-sst-2 | 67 MB |
| NER | bert-base-ner | 110 MB |
| Zero-shot | distilbert-mnli | 68 MB |
| Summarisation | distilbart-cnn | **284 MB** |
| QA | distilbert-squad | 66 MB |
| Fill-mask | bert-base-uncased | 111 MB |

That is 706 MB. Instantiating all six at page load crashes the browser, so the sidebar instantiates **only the selected task**.

## The cache key is a triple: task + model + device

This is the real engineering point of the page:

\`key = (task, model, device)\`

Any of the three changing forces a rebuild:

- **task** (sentiment → NER): different model, rebuild;
- **model** (same task, smaller weights): rebuild;
- **device** (WebGPU fails, fall back to WASM): **also rebuild** — the compiled shaders are useless.

The third is the one people miss. The symptom: WebGPU fails on some machine, the code falls back to WASM, and the user reports "it is slow every single time" — because device probing runs on each call and the cache never hits.

## Why a cold start takes seconds

Loading a WebGPU model is not just downloading weights:

1. Download ONNX weights (66–284 MB);
2. Allocate GPU buffers;
3. **Compile a shader per operator** — the slowest step, and device-specific.

So "2–8 s first time, 0 s when switching back" is normal. The demo turns the difference into something clickable: first click shows "loading … cold start" with a progress bar; clicking back shows "warm, 0.0 s".

**That gap is the value of the cache**, and why real implementations happily hold hundreds of MB in memory rather than rebuild.

## Choosing q8 vs q4f16

The page's rule:

\`WebGPU with shader-f16 -> q4f16; otherwise -> q8 (WASM)\`

- **q4f16**: 4-bit weights, 16-bit activations. Only works when the GPU supports half precision (\`shader-f16\`); less than half the size;
- **q8**: universal, more accurate, faster on CPU.

Detecting \`shader-f16\` means reading \`adapter.features\` (that is what /aigc/capabilities is for). **Skipping the check and using q4f16 blindly gives you NaNs or an outright failure** — the most common trap when taking Transformers.js to production.

## Going one level deeper

1. Memory is a constraint too: caching three big models (284 + 111 + 110 = 505 MB) OOMs low-end devices. Real implementations add LRU eviction; the demo does not.
2. Different models for the same task **cannot** share a cache entry (model is in the key) — correct, since a different model is a different network.
3. "Load on demand" and "preload" conflict: preloading kills cold starts but may pull 100 MB on first paint. The compromise is prefetching on sidebar hover (not implemented here, but a common optimisation).`
    }
  }
}
