/**
 * aigc 分类的「延伸学习」内容。
 *
 * 这一分类有两条完全不同的链路，原理说明要讲清「为什么这条走本地、那条走服务端」：
 *  - 本地（WebLLM / Transformers.js / ONNX）：权重在浏览器里，隐私好、无网络依赖，但受显存限制
 *  - 服务端代理（/api/aigc/llm-chat → Kimi / DeepSeek）：key 在服务器，能力强，但需要网络与配额
 */
import type { NoteMap } from './index'

export const notes: NoteMap = {
  '/aigc/webllm': {
    python: `"""Local LLM inference: the two phases that decide perceived speed.

WebLLM runs MLC-compiled weights (q4f16_1) through WebGPU. The Python equivalent
is MLC LLM, but the phase structure is identical on any backend.
"""
import time


def explain_phases(prompt_tokens, output_tokens, t_prefill_per_1k=0.35, t_decode_per_token=0.028):
    """Prefill processes the whole prompt in ONE forward pass (parallel over
    tokens). Decode produces ONE token per pass, each re-reading the KV cache.

    That asymmetry is why 'time to first token' and 'tokens per second' are
    different numbers, and why a long prompt feels slow even before any output.
    """
    t_prefill = prompt_tokens / 1000 * t_prefill_per_1k
    t_decode = output_tokens * t_decode_per_token
    return {
        'prefill_s': round(t_prefill, 2),
        'decode_s': round(t_decode, 2),
        'ttft_s': round(t_prefill, 2),                 # time to first token
        'tok_per_s': round(1 / t_decode_per_token, 1),
        'total_s': round(t_prefill + t_decode, 2),
    }


def kv_cache_bytes(layers, heads, head_dim, seq_len, bytes_per=2, batch=1):
    """The reason context length is expensive: KV cache grows linearly with
    tokens and is re-read on every decode step."""
    per_token = 2 * layers * heads * head_dim * bytes_per      # K and V
    return per_token * seq_len * batch


if __name__ == '__main__':
    print(explain_phases(prompt_tokens=800, output_tokens=200))
    # {'prefill_s': 0.28, 'decode_s': 5.6, 'ttft_s': 0.28, 'tok_per_s': 35.7, 'total_s': 5.88}

    # Llama-3.2-1B-ish: 16 layers, 32 heads, 64 head_dim, 4096 tokens, fp16
    print(kv_cache_bytes(16, 32, 64, 4096) / 1024 ** 2, 'MB of KV cache at 4k context')
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Prefill vs decode: two very different costs</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .ctl{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:12px}
  .ctl label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:130px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:48px}
  .stats{display:flex;gap:22px;flex-wrap:wrap;margin-top:12px;font-size:12px}
  .stats b{display:block;font-size:17px;font-variant-numeric:tabular-nums;color:#0f172a}
  .note{color:#64748b;font-size:12px;margin-top:10px}
</style>
</head>
<body>
<h1>One pass for the prompt, one pass per word</h1>
<p>Prefill reads the entire prompt in a single forward pass — that is your time-to-first-token. Decode
then emits one token per pass. Drag the sliders: the output length dominates, and the prompt only
shows up as delay before anything appears.</p>
<canvas id="c" width="620" height="180"></canvas>
<div class="ctl">
  <label>prompt tokens <input type="range" id="p" min="20" max="2000" step="20" value="800"><output id="op"></output></label>
  <label>output tokens <input type="range" id="o" min="10" max="400" step="10" value="200"><output id="oo"></output></label>
</div>
<div class="stats">
  <div>time to first token<b id="ttft">—</b></div>
  <div>decode speed<b id="tps">—</b></div>
  <div>total<b id="tot">—</b></div>
  <div>KV cache @4k<b id="kv">—</b></div>
</div>
<div class="note">35 tokens/s on a 1B q4f16 model in WebGPU is a realistic laptop figure. The same
model on CPU would be 3–6 tokens/s — which is the whole argument for WebGPU.</div>
<script>
(function () {
  var PREFILL_PER_1K = 0.35;   // seconds per 1000 prompt tokens
  var DECODE_PER_TOKEN = 0.028;

  function render() {
    var p = +document.getElementById('p').value;
    var o = +document.getElementById('o').value;
    document.getElementById('op').textContent = p;
    document.getElementById('oo').textContent = o;

    var prefill = p / 1000 * PREFILL_PER_1K;
    var decode = o * DECODE_PER_TOKEN;

    document.getElementById('ttft').textContent = prefill.toFixed(2) + ' s';
    document.getElementById('tps').textContent = (1 / DECODE_PER_TOKEN).toFixed(1) + '/s';
    document.getElementById('tot').textContent = (prefill + decode).toFixed(2) + ' s';
    // 16 layers * 32 heads * 64 head_dim * 2 (K and V) * 2 bytes * 4096 tokens
    var kv = 16 * 32 * 64 * 2 * 2 * 4096 / 1024 / 1024;
    document.getElementById('kv').textContent = kv.toFixed(0) + ' MB';

    // timeline: prefill block then one tick per token
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 180;
    ctx.clearRect(0, 0, W, H);
    var total = prefill + decode;
    var scale = (W - 40) / Math.max(1.2, total);
    var y = 60;

    // prefill bar
    var pw = Math.max(2, prefill * scale);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(20, y, pw, 30);
    ctx.fillStyle = '#0f172a'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('prefill ' + p + ' tokens', 20, y - 8);

    // decode ticks (capped for drawing)
    var dw = decode * scale;
    var ticks = Math.min(o, 120);
    var step = dw / ticks;
    for (var i = 0; i < ticks; i++) {
      ctx.fillStyle = i === 0 ? '#dc2626' : '#bfdbfe';
      ctx.fillRect(20 + pw + i * step, y + 4, Math.max(1, step - 1), 22);
    }
    ctx.fillStyle = '#0f172a';
    ctx.fillText('decode ' + o + ' tokens (1 per pass)', 20 + pw, y + 56);
    if (ticks < o) ctx.fillText('… showing first ' + ticks + ' of ' + o, 20 + pw, y + 72);

    // axis
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(20, y + 96); ctx.lineTo(W - 20, y + 96); ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('0 s', 20, y + 112);
    ctx.fillText(total.toFixed(1) + ' s', W - 60, y + 112);

    ctx.fillStyle = '#dc2626';
    ctx.fillText('red tick = first token appears here', 20, y + 134);
  }

  ['p', 'o'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 两个阶段，两种成本

LLM 推理不是"一次性算出答案"，而是两个结构完全不同的阶段：

| 阶段 | 做什么 | 特点 | 决定什么 |
| --- | --- | --- | --- |
| **Prefill** | 把整个 prompt **一次**前向传播 | 所有 token 并行计算 | **首 token 延迟**（TTFT） |
| **Decode** | 每步生成**一个** token | 串行，每步重读 KV cache | **吞吐**（tokens/s） |

拖页面的滑杆能看到：prompt 越长，开始输出越晚；输出越长，总时间越长。**这两件事的斜率完全不同。**

## 为什么 decode 是一步一个 token

因为自回归：第 N 个 token 的生成依赖第 N-1 个。这个依赖是串行的，GPU 并行度再高也用不上 —— 这是一个 1B 模型在 WebGPU 上只有 30–40 tokens/s 的根本原因。

**GPU 在 decode 阶段是"大马拉小车"**：每次前向只算一个 token，但要把整个模型的权重重读一遍。所以 decode 的瓶颈是**显存带宽**，不是算力。

这也解释了一个反直觉的现象：更大的 batch 反而更划算 —— 一次前向给 8 个请求各出一个 token，权重只读一遍。这就是服务端批处理（continuous batching）的动机，浏览器里没有这个空间。

## KV cache 是上下文长度的真实成本

每条注意力层要保存 K 和 V 两份向量，长度等于序列长度：

\`KV bytes = 2 × layers × heads × head_dim × seq_len × bytes_per\`

Llama-3.2-1B 在 4k 上下文下约 256 MB（fp16）。**上下文翻倍，KV cache 翻倍** —— 这就是长上下文贵的真正原因（不是注意力计算，是显存）。

页面的 \`kv_cache_bytes\` 函数就是这个式子。浏览器里显存紧张，所以 WebLLM 的默认上下文只有 4k。

## q4f16_1 是什么意思

WebLLM 的模型都是 \`q4f16_1\`：

- **权重 4 位**（int4 分组量化），体积压到 fp16 的 1/4；
- **激活 16 位**（fp16），计算仍用半精度；
- \`_1\` 是分组大小（group size 32 的一种命名）。

1B 模型 fp16 约 2 GB，q4f16 约 600 MB —— **这才塞得进浏览器的显存**。代价是精度损失，长对话里表现为"偶尔忘记前面的指令"。

## 想深一层

1. 首 token 延迟里还包含**模型加载**（600 MB 权重 + 着色器编译），那是秒级，和这里的计算时间不是一个量级。页面把两者分开展示，就是为了不混淆。
2. temperature 0.7 / top_p 0.95 是聊天场景的经验值。代码生成要用低温（0.1–0.3），否则同一请求每次结果不一样。
3. 流式输出的价值不在"更快"，而在**感知更快**：首 token 0.3 秒出来，用户就觉得响应了；等 6 秒一次性给完整回答，体验差一个数量级。`,
      en: `## Two phases, two kinds of cost

LLM inference is not "compute the answer at once" — it is two structurally different phases:

| Phase | Does | Character | Determines |
| --- | --- | --- | --- |
| **Prefill** | one forward pass over the whole prompt | all tokens in parallel | **time to first token** (TTFT) |
| **Decode** | one token per step | serial, re-reads KV cache each step | **throughput** (tokens/s) |

Drag the sliders: a longer prompt delays the start, a longer output stretches the total. **The two slopes are completely different.**

## Why decode is one token per step

Because it is autoregressive: token N depends on token N-1. That dependency is serial, so GPU parallelism does not help — the root reason a 1B model manages only 30–40 tokens/s in WebGPU.

**The GPU is underused during decode**: each pass computes one token but re-reads all the weights. So decode is bound by **memory bandwidth**, not compute.

Which explains a counter-intuitive fact: larger batches are more efficient — one forward pass serves 8 requests, reading the weights once. That is the motivation for server-side continuous batching, and browsers have no room for it.

## KV cache is the real cost of context

Every attention layer keeps K and V vectors for the whole sequence:

\`KV bytes = 2 × layers × heads × head_dim × seq_len × bytes_per\`

Llama-3.2-1B at 4k context is about 256 MB (fp16). **Double the context, double the cache** — that, not attention compute, is why long contexts are expensive. The page's \`kv_cache_bytes\` is this formula.

## What q4f16_1 means

All WebLLM builds are \`q4f16_1\`:

- **4-bit weights** (int4 group quantisation), a quarter of fp16 size;
- **16-bit activations** (fp16), compute still in half precision;
- \`_1\` names the group configuration.

A 1B model is ~2 GB at fp16, ~600 MB at q4f16 — **that is what makes it fit in browser VRAM**. The price is precision, which shows up as "it sometimes forgets earlier instructions".

## Going one level deeper

1. TTFT also includes **model load** (600 MB of weights plus shader compilation), which is seconds — a different order from the compute numbers here. Shown separately so the two are not confused.
2. temperature 0.7 / top_p 0.95 are chat defaults. Code generation wants low temperature (0.1–0.3), or the same request gives different output every time.
3. Streaming's value is not speed but **perceived speed**: first token at 0.3 s feels responsive; a full answer after 6 s feels an order of magnitude worse.`
    }
  },

  '/aigc/capabilities': {
    python: `"""Capability probing: ask the backend what it can actually do.

The page reads navigator.gpu (adapter info, features, limits). Server-side the
same idea is listing execution providers -- never assume a backend exists.
"""
import onnxruntime as ort


def probe():
    """What this prints decides which models you may load, exactly like the
    WebGPU page decides between q4f16 and q8."""
    providers = ort.get_available_providers()
    out = {'providers': providers}

    # The browser equivalent of 'shader-f16': can we do fp16 math at all?
    out['fp16_capable'] = any(p in providers for p in ('CUDAExecutionProvider', 'CoreMLExecutionProvider'))

    # Limits matter as much as features: max buffer size caps the model size.
    return out


if __name__ == '__main__':
    print(probe())
    # {'providers': ['CoreMLExecutionProvider', 'CPUExecutionProvider'], 'fp16_capable': True}


# Why this deserves its own page:
#   the single most common production failure is loading a model whose dtype the
#   device cannot execute. Probing first turns a crash into a fallback.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ask the GPU what it can do</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  table{border-collapse:collapse;font-size:12px;width:100%;max-width:600px}
  th,td{border:1px solid #e2e8f0;padding:5px 9px;text-align:left}
  th{background:#f1f5f9;font-weight:600;width:170px}
  td{font-family:ui-monospace,monospace}
  .ok{color:#15803d}.bad{color:#b91c1c}
  .verdict{margin-top:12px;padding:10px 12px;border-radius:8px;background:#eff6ff;font-size:13px}
  .verdict b{font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:10px}
</style>
</head>
<body>
<h1>This page really does it</h1>
<p>The values below come from <code>navigator.gpu.requestAdapter()</code> in your browser, right now.
Whether <code>shader-f16</code> appears decides if the site may load q4f16 models at all.</p>
<table id="t"><tbody><tr><td colspan="2">probing…</td></tr></tbody></table>
<div class="verdict" id="v"></div>
<div class="note">If the table says "WebGPU unavailable", your browser or this context has no adapter —
the site falls back to WASM and everything runs 5-10x slower.</div>
<script>
(function () {
  var rows = [];
  function row(k, v, flag) {
    var cls = flag === true ? 'ok' : flag === false ? 'bad' : '';
    rows.push('<tr><th>' + k + '</th><td class="' + cls + '">' + v + '</td></tr>');
  }
  function paint() {
    document.getElementById('t').innerHTML = '<tbody>' + rows.join('') + '</tbody>';
  }

  async function probe() {
    if (!navigator.gpu) {
      row('WebGPU', 'unavailable (navigator.gpu is undefined)', false);
      paint();
      document.getElementById('v').textContent = 'No WebGPU: the site falls back to WASM.';
      return;
    }
    var adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      row('WebGPU', 'no adapter (blocked, or no compatible GPU)', false);
      paint();
      document.getElementById('v').textContent = 'WebGPU exists but no adapter was granted.';
      return;
    }
    row('WebGPU', 'adapter acquired', true);

    var info = adapter.info || {};
    row('vendor / architecture', (info.vendor || '?') + ' / ' + (info.architecture || '?'));
    row('description', info.description || '(not exposed)');

    var feats = Array.from(adapter.features || []);
    var f16 = feats.indexOf('shader-f16') !== -1;
    row('features', feats.length + ' total', null);
    row('shader-f16', f16 ? 'yes — q4f16 models allowed' : 'no — must use q8/fp32', f16);

    var L = adapter.limits || {};
    row('maxTextureDimension2D', L.maxTextureDimension2D || '?');
    row('maxBufferSize',
        L.maxBufferSize ? (L.maxBufferSize / 1024 / 1024).toFixed(0) + ' MB' : '?');
    row('maxComputeInvocationsPerWorkgroup', L.maxComputeInvocationsPerWorkgroup || '?');
    row('crossOriginIsolated', String(self.crossOriginIsolated), self.crossOriginIsolated);
    paint();

    document.getElementById('v').innerHTML =
      f16
        ? 'Verdict: <b>q4f16 is legal here</b> — the site will pick the smallest dtype.'
        : 'Verdict: <b>no shader-f16</b> — fp16 maths would produce NaN/inf, so the site must use q8 or fp32.';
  }

  probe().catch(function (e) {
    row('error', String(e && e.message || e), false);
    paint();
  });
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 这一页不做 AI，它做一件更基础的事：问设备能干什么

页面读 \`navigator.gpu.requestAdapter()\`，然后打印三样东西：

| 读什么 | 得到什么 | 影响什么 |
| --- | --- | --- |
| \`adapter.info\` | 厂商、架构、设备描述 | 排查"为什么这台机器特别慢" |
| \`adapter.features\` | 支持的特性列表（含 \`shader-f16\`） | **能不能用 q4f16 模型** |
| \`adapter.limits\` | \`maxBufferSize\`、\`maxTextureDimension2D\` 等 | 能不能装下大模型 |

这是全站最短的一页，但它挡住了一类最常见的线上故障。

## \`shader-f16\` 为什么关键

WebGPU 的半精度浮点（fp16）是**可选特性**。支持它的设备能用 q4f16 量化模型（体积小一半以上）；不支持的设备如果硬上，结果会是：

- 数值溢出成 \`Infinity\`；
- 或者 NaN，模型输出变成一串乱码；
- 最糟的情况：不报错，只是答案莫名其妙。

**所以加载模型前必须先查这个特性**，这就是 \`/nlp/transformers\` 页面那条 \`q4f16 或 q8\` 规则的来源。不查就用的代码能跑，但跑在别人的机器上就炸。

## \`maxBufferSize\` 也不只是数字

一个 1B 模型 q4 量化后约 600 MB，权重被切成很多 buffer。如果设备单 buffer 上限是 256 MB，就得切分加载 —— 有些运行时支持，有些不支持（直接失败）。

**"模型能下载"不等于"模型能加载"。** 这是浏览器端部署和服务器部署最大的差别之一。

## \`crossOriginIsolated\` 是什么

这是浏览器的跨源隔离状态。为 \`true\` 时才有 \`SharedArrayBuffer\`，多线程 WASM 才能用。

- \`true\`：WASM 可以多线程，推理快 2–4 倍；
- \`false\`：单线程，慢，但能跑。

开启它需要服务器发三个 HTTP 头（COOP/COEP/CORP），且**一旦开启，所有跨源资源都必须带 CORP 头**，否则会被拦。这个项目为此专门在 nginx 层配置（见部署文档），因为搞错会让 iframe 里的所有子应用都挂掉。

## 想深一层

1. 这个页面在 \`sandbox\` iframe 里跑时，WebGPU 可能被策略拦住 —— 这不是 bug，正是"能力探测"该发现的情况。
2. 真实产品应该把探测结果**缓存**（在 localStorage 存一个 feature 标记），否则每次进站都要异步探测一次，首屏多几百毫秒。
3. 服务端也有等价物：\`onnxruntime.get_available_providers()\` 告诉你有没有 CUDA / CoreML。同一套思路，不同后端。`,
      en: `## This page does no AI; it asks what the device can do

It reads \`navigator.gpu.requestAdapter()\` and prints three things:

| Reads | Gets | Affects |
| --- | --- | --- |
| \`adapter.info\` | vendor, architecture, description | diagnosing "why is this machine so slow" |
| \`adapter.features\` | supported features (incl. \`shader-f16\`) | **whether q4f16 models are legal** |
| \`adapter.limits\` | \`maxBufferSize\`, \`maxTextureDimension2D\`… | whether a large model even fits |

The shortest page on the site, and it blocks one of the most common production failures.

## Why \`shader-f16\` matters

WebGPU's half precision (fp16) is an **optional feature**. Devices that support it can run q4f16 quantised models (less than half the size); devices that do not, if forced, produce:

- values overflowing to \`Infinity\`;
- or NaN, turning output into garbage;
- worst case: no error at all, just nonsensical answers.

**So the feature must be checked before loading**, which is exactly where the \`q4f16 or q8\` rule on /nlp/transformers comes from. Code that skips the check runs fine on your machine and fails on someone else's.

## \`maxBufferSize\` is not just a number

A 1B model at q4 is ~600 MB, split across many buffers. If the per-buffer limit is 256 MB, the weights must be sharded — some runtimes handle it, some fail outright.

**"The model downloads" does not mean "the model loads."** One of the biggest differences between browser and server deployment.

## What \`crossOriginIsolated\` means

It reports the browser's cross-origin isolation state. When \`true\`, \`SharedArrayBuffer\` exists and multi-threaded WASM is available:

- \`true\`: multi-threaded WASM, 2–4× faster inference;
- \`false\`: single-threaded, slower but working.

Enabling it requires three HTTP headers (COOP/COEP/CORP), and **once enabled every cross-origin resource must carry CORP** or it is blocked. This project configures that at the nginx layer precisely because getting it wrong takes down every embedded sub-app.

## Going one level deeper

1. Running inside a \`sandbox\` iframe, WebGPU may be refused by policy — not a bug, but exactly what capability probing is for.
2. Real products **cache** the probe result (a feature flag in localStorage); otherwise every visit pays an async probe on first paint.
3. Servers have the equivalent: \`onnxruntime.get_available_providers()\` tells you whether CUDA or CoreML exists. Same idea, different backend.`
    }
  },

  '/aigc/llm-chat': {
    python: `"""Server-proxied chat: the key never reaches the browser.

The page POSTs to /api/aigc/llm-chat, which forwards to Kimi or DeepSeek and
streams SSE back. Here is the same call with the OpenAI SDK.
"""
from openai import OpenAI
import os


def chat(messages, model='kimi-k2.6', temperature=0.7, max_tokens=4096, stream=True):
    """Note what is NOT here: any attempt to hide the instruction. Policy on this
    site is enforced server-side (server/utils/ai-policy.ts), not in the prompt
    the client sends."""
    client = OpenAI(api_key=os.environ['MOONSHOT_API_KEY'],
                    base_url='https://api.moonshot.cn/v1')

    resp = client.chat.completions.create(
        model=model, messages=messages, temperature=temperature,
        max_tokens=max_tokens, stream=stream,
    )
    if not stream:
        return resp.choices[0].message.content

    for chunk in resp:
        delta = chunk.choices[0].delta
        # reasoning models put chain-of-thought in a separate field
        if getattr(delta, 'reasoning_content', None):
            yield ('think', delta.reasoning_content)
        if delta.content:
            yield ('answer', delta.content)


if __name__ == '__main__':
    for kind, piece in chat([{'role': 'user', 'content': '用一句话解释 KV cache'}]):
        print(f'[{kind}] {piece}', end='', flush=True)


# Why proxy at all: the browser must never hold a provider key. Everything the
# client sends is untrusted, so policy has to be applied on the way in.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SSE, and why the first token is the only one that matters</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .btns{margin-top:10px}
  button{font:inherit;font-size:12px;padding:6px 13px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;margin-right:8px}
  button.on{background:#2563eb;color:#fff;border-color:#2563eb}
  .log{margin-top:10px;font:12px/1.7 ui-monospace,monospace;color:#334155;max-width:620px;
       max-height:130px;overflow:auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:9px 11px}
  .log b{color:#2563eb}
  .note{color:#64748b;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<h1>Streaming changes perception, not speed</h1>
<p>Two identical answers, delivered differently. The total time is the same; what changes is when you
first see something. Toggle and watch the timeline.</p>
<canvas id="c" width="620" height="150"></canvas>
<div class="btns">
  <button id="s" class="on">streaming</button>
  <button id="b">buffered</button>
</div>
<div class="log" id="log"></div>
<div class="note">This is why every chat UI streams: 0.4 s to first token feels instant, 6 s to the
full answer feels broken — even though the work is identical.</div>
<script>
(function () {
  var TEXT = 'KV cache 把注意力里已经算过的 K、V 向量存下来，' +
             '每一步解码就不用重算整个前缀，于是生成一个 token 的代价从 O(n) 降到 O(1)。';
  var PRE = 400;        // ms to first token
  var PER = 60;         // ms per token chunk
  var streamMode = true;
  var timer = null;

  function draw(progress, chunks) {
    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 150;
    ctx.clearRect(0, 0, W, H);
    var total = PRE + TEXT.length / 6 * PER;
    var x = v => 20 + v / total * (W - 40);

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(20, 100); ctx.lineTo(W - 20, 100); ctx.stroke();

    if (streamMode) {
      // first token marker
      ctx.fillStyle = '#dc2626';
      ctx.beginPath(); ctx.arc(x(PRE), 100, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillText('first token ' + PRE + ' ms', x(PRE) - 30, 84);
      // chunks arriving
      for (var i = 0; i < chunks; i++) {
        ctx.fillStyle = 'rgba(37,99,235,.55)';
        ctx.fillRect(x(PRE + i * PER), 96, 3, 8);
      }
    } else {
      // nothing visible until the end
      ctx.fillStyle = '#dc2626';
      ctx.beginPath(); ctx.arc(x(total), 100, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillText('everything appears at ' + Math.round(total) + ' ms', x(total) - 70, 84);
      ctx.fillStyle = 'rgba(148,163,184,.5)';
      ctx.fillRect(20, 96, x(total) - 20, 8);
    }

    ctx.fillStyle = '#475569'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('0 ms', 20, 122);
    ctx.fillText(Math.round(total) + ' ms — same work either way', W - 240, 122);
  }

  function run() {
    if (timer) clearInterval(timer);
    var t0 = Date.now(), chunks = 0;
    document.getElementById('log').innerHTML = '';
    draw(0, 0);
    timer = setInterval(function () {
      var elapsed = Date.now() - t0;
      if (streamMode) {
        var want = Math.max(0, Math.floor((elapsed - PRE) / PER));
        if (want > chunks) {
          chunks = want;
          var upto = Math.min(TEXT.length, chunks * 6);
          document.getElementById('log').innerHTML =
            '<b>data:</b> ' + TEXT.slice(Math.max(0, upto - 12), upto);
        }
      }
      var total = PRE + TEXT.length / 6 * PER;
      draw(elapsed, chunks);
      if (elapsed > total) {
        clearInterval(timer);
        timer = null;
        if (!streamMode) document.getElementById('log').innerHTML = '<b>data:</b> ' + TEXT;
      }
    }, 40);
  }

  document.getElementById('s').addEventListener('click', function () {
    streamMode = true;
    document.getElementById('s').classList.add('on');
    document.getElementById('b').classList.remove('on');
    run();
  });
  document.getElementById('b').addEventListener('click', function () {
    streamMode = false;
    document.getElementById('b').classList.add('on');
    document.getElementById('s').classList.remove('on');
    run();
  });

  run();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 为什么必须有服务端代理

浏览器直接调 Kimi / DeepSeek 的 API 有个致命问题：**API key 会出现在前端代码里**，任何人打开 DevTools 就能拿走。

所以链路是：

\`浏览器 → /api/aigc/llm-chat（服务端持有 key）→ 上游 API → SSE 流回浏览器\`

这一层代理顺便解决了两件事：

1. **统一换模型**：前端只传 \`model\` 名字，换供应商不用改前端；
2. **施加策略**：服务端可以在转发前改写 system 消息（见下）。

## SSE 与轮询的区别

| | SSE（Server-Sent Events） | 轮询 |
| --- | --- | --- |
| 连接 | 一条长连接，服务端持续推送 | 客户端每隔 N 秒问一次 |
| 首字延迟 | 立刻 | 最多等一个轮询周期 |
| 实现 | \`EventSource\` 或 fetch + ReadableStream | 简单，但浪费请求 |

页面用 SSE（\`stream: true\`）。**流式的价值不在总时间，在感知延迟**：首 token 400 ms 出来，用户觉得"在响应"；等 6 秒一次性给完整答案，体感差一个数量级。页面的可运行示例把这两种投递方式画在同一时间轴上，总工作量完全相同。

## reasoning 模型有两个输出通道

DeepSeek-R1 这类推理模型会先输出**思维链**（\`reasoning_content\`），再输出**正式答案**（\`content\`）。

前端必须分开渲染（页面就是这么做的）：思考过程折叠、答案展开。混在一起展示会让用户看到一大堆"让我想想…"然后才看到结论。

**注意这是两个独立的字段**，不是一个字段里的标记。有的模型用 \`<think>\` 标签（见 \`/aigc/reasoning-chat\`），有的用结构化字段 —— 对接不同模型时这是要适配的第一个地方。

## 这个页面的一个特殊之处

站内其他所有 AI 接口都经过 \`enforceLearningPolicy\`（把客户端的 system 消息摘掉、换成唯一一条策略）。**但 \`/api/aigc/llm-chat\` 故意不经过** —— 因为这一页就是给学生改 system prompt 的教学演示，加了策略就没东西可教了。

而对外暴露的 \`/v1/chat/completions\` 则强制走策略。**同一个站，对内教学放开、对外 API 收紧**，这个边界值得注意。

## 想深一层

1. \`temperature\` 在 kimi-k3 上被强制为 1（前端锁死滑杆）—— 因为该模型对温度敏感，低温度会让输出退化。
2. \`max_tokens 4096\` 是硬上限。超长回答会被截断，且**不会告诉你被截断**（finish_reason 才有）。
3. 流式解析要注意：SSE 的每条消息可能是**半个 JSON**。正确的做法是按 \`\\n\\n\` 分帧、每帧解析，而不是把整个 buffer 当 JSON 解。这个坑在慢网络下必现。`,
      en: `## Why a server proxy is mandatory

Calling Kimi or DeepSeek directly from the browser has a fatal problem: **the API key lives in frontend code**, and anyone with DevTools can lift it.

So the path is:

\`browser -> /api/aigc/llm-chat (server holds the key) -> upstream API -> SSE back\`

The proxy also buys two things:

1. **Swap models centrally**: the client sends only a \`model\` name;
2. **Apply policy**: the server can rewrite system messages before forwarding (below).

## SSE vs polling

| | SSE | Polling |
| --- | --- | --- |
| Connection | one long-lived stream | client asks every N seconds |
| First-byte latency | immediate | up to one poll interval |
| Implementation | \`EventSource\` or fetch + ReadableStream | simple, but wasteful |

The page streams (\`stream: true\`). **The value is perceived latency, not total time**: a first token at 400 ms feels responsive; a full answer at 6 s feels broken. The demo draws both deliveries on one timeline — identical work.

## Reasoning models have two output channels

DeepSeek-R1-style models emit a **chain of thought** (\`reasoning_content\`) before the **answer** (\`content\`).

The client must render them separately (as the page does): thinking collapsed, answer expanded. Mixed together, the user reads pages of "let me think…" before the conclusion.

**These are separate fields**, not markers inside one string. Some models use \`<think>\` tags (see /aigc/reasoning-chat), others structured fields — the first thing to adapt when switching providers.

## The special case on this site

Every other AI endpoint runs \`enforceLearningPolicy\` (strips client system messages, installs one policy message). **\`/api/aigc/llm-chat\` deliberately does not** — this page exists to let students rewrite the system prompt, and policy would leave nothing to teach.

The externally exposed \`/v1/chat/completions\`, by contrast, enforces it. **Open for teaching inside, tightened for the public API** — a boundary worth noticing.

## Going one level deeper

1. \`temperature\` is forced to 1 on kimi-k3 (the slider is locked) — that model degrades at low temperature.
2. \`max_tokens 4096\` is a hard cap. Longer answers are cut off, and **nothing tells you** except \`finish_reason\`.
3. SSE parsing care: a message may be **half a JSON object**. Frame by \`\\n\\n\` and parse per frame; parsing the whole buffer as JSON fails reliably on slow networks.`
    }
  },

  '/aigc/digital-human': {
    python: `"""Talking head: text -> audio -> visemes -> morph targets.

Three models in a chain, and the latency budget is decided by where the chain
is allowed to block. The page uses Edge TTS (server) or Kokoro (local, 92 MB).
"""
import asyncio


async def synth(text, voice='zh-CN-XiaoxiaoNeural'):
    """Edge TTS returns audio PLUS word-boundary events. Those timestamps are
    what let the mouth start moving at the right moment -- lip-sync without
    them means guessing from amplitude, which looks wrong on plosives."""
    import edge_tts
    comm = edge_tts.Communicate(text, voice)
    audio, marks = bytearray(), []
    async for chunk in comm.stream():
        if chunk['type'] == 'audio':
            audio.extend(chunk['data'])
        elif chunk['type'] == 'WordBoundary':
            marks.append((chunk['offset'] / 1e7, chunk['text']))   # 100ns units
    return bytes(audio), marks


def visemes_from_marks(marks, fps=30):
    """A viseme is a mouth shape, not a phoneme. The page's HeadAudio model maps
    PCM frames to 12-ish visemes; here we approximate from the word timing so
    the shape of the problem is visible: one shape every ~3 frames, interpolated
    in between."""
    frames = []
    for t, word in marks:
        # crude: pick a shape from the vowel in the word
        shape = 'AA' if any(v in word.lower() for v in 'aàá') else \\
                'EE' if any(v in word.lower() for v in 'ei') else 'OH'
        frames.append({'t': round(t, 3), 'viseme': shape, 'word': word})
    return frames


# Latency budget that decides whether this feels alive:
#   text -> TTS first byte   ~300-800 ms (network, if Edge TTS)
#   decode + PCM16           ~10 ms
#   first viseme frame       ~33 ms (one frame at 30 fps)
# Total ~0.4-0.9 s before the mouth moves. Anything above ~1 s reads as "broken".
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Visemes: mouth shapes, not phonemes</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .wrap{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start}
  canvas{border-radius:8px;background:#0f172a;box-shadow:0 1px 4px rgba(15,23,42,.18)}
  .side{flex:1;min-width:210px;font-size:12px}
  .seq{display:flex;gap:3px;flex-wrap:wrap;margin-top:8px}
  .seq i{font-style:normal;font-family:ui-monospace,monospace;font-size:10px;padding:3px 5px;
    border-radius:4px;background:#e2e8f0;color:#334155}
  .seq i.now{background:#2563eb;color:#fff}
  button{font:inherit;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid #cbd5e1;
    background:#fff;cursor:pointer;margin-top:10px;margin-right:6px}
  .note{color:#64748b;font-size:12px;margin-top:10px}
</style>
</head>
<body>
<h1>The mouth is driven by a timeline, not by loudness</h1>
<p>Text-to-speech produces audio plus word timestamps. Each word maps to a viseme — a mouth shape.
Interpolating between them at 30 fps is what makes it look like speech instead of a puppet.</p>
<div class="wrap">
  <canvas id="c" width="240" height="240"></canvas>
  <div class="side">
    <div id="status">press play</div>
    <div class="seq" id="seq"></div>
    <button id="play">play</button>
    <button id="stop">stop</button>
    <div class="note">Without timestamps you can only react to amplitude — which fires on every
    syllable but also on background noise, and lands late on plosives (p, t, k).</div>
  </div>
</div>
<script>
(function () {
  // a tiny "utterance": word, duration, viseme
  var WORDS = [
    { w: 'hello', d: 0.36, v: 'OH' },
    { w: 'there', d: 0.28, v: 'AA' },
    { w: 'i', d: 0.12, v: 'EE' },
    { w: 'am', d: 0.22, v: 'AA' },
    { w: 'talking', d: 0.42, v: 'OH' },
    { w: 'to', d: 0.18, v: 'OO' },
    { w: 'you', d: 0.30, v: 'OO' }
  ];
  var SHAPES = {
    // [mouthWidth, mouthHeight, jawDrop] in px
    AA: [46, 34, 0],
    EE: [58, 14, 0],
    OH: [30, 30, 6],
    OO: [22, 22, 2],
    '': [44, 8, 0]        // closed / rest
  };
  var timeline = [];
  (function build() {
    var t = 0;
    WORDS.forEach(function (w) { timeline.push({ t: t, w: w }); t += w.d; });
  })();
  var TOTAL = timeline.reduce(function (a, x) { return a + x.w.d; }, 0);

  var playing = false, t0 = 0, raf = 0, current = -1;
  var c = document.getElementById('c'), ctx = c.getContext('2d');

  function visemeAt(t) {
    for (var i = timeline.length - 1; i >= 0; i--) {
      if (t >= timeline[i].t) return { i: i, w: timeline[i].w, local: t - timeline[i].t };
    }
    return { i: 0, w: timeline[0].w, local: 0 };
  }

  function drawFace(v, blend) {
    var W = 240, H = 240, CX = 120, CY = 110;
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(CX, CY, 62, 74, 0, 0, Math.PI * 2); ctx.stroke();

    // eyes
    ctx.fillStyle = '#f8fafc';
    [-1, 1].forEach(function (s) {
      ctx.beginPath(); ctx.arc(CX + s * 24, CY - 20, 6, 0, Math.PI * 2); ctx.fill();
    });

    // mouth interpolated between the previous and current shape
    var a = SHAPES[v.prev || ''] || SHAPES[''];
    var b = SHAPES[v.cur || ''] || SHAPES[''];
    var k = blend;
    var mw = a[0] + (b[0] - a[0]) * k;
    var mh = a[1] + (b[1] - a[1]) * k;
    var jaw = (a[2] + (b[2] - a[2]) * k);

    ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 2.4;
    ctx.fillStyle = 'rgba(244,114,182,.22)';
    ctx.beginPath();
    ctx.ellipse(CX, CY + 34 + jaw * 0.4, mw / 2, mh / 2, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = 'rgba(248,250,252,.75)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('viseme ' + (v.cur || 'rest'), 12, H - 14);
  }

  function frame(now) {
    if (!playing) return;
    var t = (now - t0) / 1000 * 1.0;
    if (t > TOTAL) { playing = false; drawFace({ cur: '', prev: '' }, 0); return; }

    var at = visemeAt(t);
    var prevViseme = at.i > 0 ? timeline[at.i - 1].w.v : '';
    var blend = Math.min(1, at.local / 0.09);   // 90 ms transition

    drawFace({ cur: at.w.v, prev: prevViseme }, blend);

    var seq = document.getElementById('seq');
    if (at.i !== current) {
      current = at.i;
      seq.innerHTML = timeline.map(function (x, i) {
        return '<i class="' + (i === at.i ? 'now' : '') + '">' + x.w.w + '</i>';
      }).join('');
      document.getElementById('status').textContent =
        't = ' + t.toFixed(2) + ' s · word "' + at.w.w + '" · viseme ' + at.w.v;
    }
    raf = requestAnimationFrame(frame);
  }

  document.getElementById('play').addEventListener('click', function () {
    playing = true; t0 = performance.now(); current = -1;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  });
  document.getElementById('stop').addEventListener('click', function () {
    playing = false; cancelAnimationFrame(raf);
    drawFace({ cur: '', prev: '' }, 0);
    document.getElementById('status').textContent = 'stopped';
  });

  drawFace({ cur: '', prev: '' }, 0);
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 三个模型串成一条延迟链

数字人的链路比看上去长：

\`文本 → TTS（音频 + 词边界时间戳）→ PCM 解码 → HeadAudio 逐帧推 viseme → TalkingHead 驱动 morph\`

每个环节都有自己的延迟，**整条链的总和决定了"像不像活人"**：

| 环节 | 典型耗时 | 说明 |
| --- | --- | --- |
| TTS 首字节 | 300–800 ms | Edge TTS 走网络；Kokoro 本地约 200 ms |
| 解码 + PCM16 | ~10 ms | \`decodeAudioData\` + 重采样 |
| 首个 viseme | 33 ms | 30 fps 一帧 |
| **总计** | **0.4–0.9 s** | 超过 1 秒就"假" |

页面的两路 TTS 正好是这个权衡：**Edge TTS 质量好但依赖网络；Kokoro 本地（92 MB）但慢一点、音色选择少。**

## viseme 不是音素

这是最容易被误解的一点：

- **音素**（phoneme）是语言单位，比如 /p/、/a/、/t/；
- **viseme** 是**口型单位**，是"看起来的样子"。

多个音素对应同一个 viseme（/p/ /b/ /m/ 闭嘴的动作几乎一样）。所以唇形同步只需要十几个 viseme，不需要几十个音素 —— **这是它能在浏览器实时的原因**。

页面的可运行示例就是 5 个 viseme（AA / EE / OH / OO / rest）加插值。90 ms 的过渡时间来自经验：太快像抽搐，太慢像慢动作。

## 为什么必须有时间戳

没有词边界时间戳，你只能从音频**振幅**推测什么时候张嘴。

问题是：振幅大不代表在说话（背景音乐、爆破音、笑声都会触发），而且**爆破音（p/t/k）的嘴型应该出现在声音之前** —— 等听到声音再动嘴，永远慢半拍。

TTS 返回的 \`WordBoundary\` 事件（offset + 文本）就是解决这个的：**知道下一个词在 1.24 秒开始，就能提前 3 帧准备口型。**

## AudioWorklet 而不是 requestAnimationFrame

真实实现里，音频推送跑在 AudioWorklet（音频线程，128 帧一个块，约 2.9 ms 一次），渲染跑在 rAF（约 16.7 ms 一次）。

两者解耦：音频不能因为渲染卡顿而断（会爆音），渲染可以掉帧（人眼看不出来）。页面的示例简化成 rAF 驱动，是为了看清 viseme 序列本身。

## 想深一层

1. Morph target（混合形状）是 TalkingHead 这类库的做法：预生成"张嘴""眯眼"等形状，运行时按权重混合。比骨骼动画简单，效果对正脸够用。
2. \`ttsEndpoint: null\` 表示由页面自己合成音频再喂进去 —— 库自带的 TTS 路径被禁用。这种"关掉库的某个能力"的配置在集成第三方时很常见。
3. 延迟优化最有效的一刀是**流式 TTS**：不需要等整句合成完，第一个词出来就开始播。代价是口型模型要能处理"边收边播"。`,
      en: `## Three models in one latency chain

A talking head has more stages than it looks:

\`text -> TTS (audio + word timestamps) -> PCM decode -> per-frame visemes -> morph targets\`

Each has its own delay, and **the sum decides whether it reads as alive**:

| Stage | Typical | Note |
| --- | --- | --- |
| TTS first byte | 300–800 ms | Edge TTS over the network; Kokoro locally ~200 ms |
| decode + PCM16 | ~10 ms | \`decodeAudioData\` + resample |
| first viseme | 33 ms | one frame at 30 fps |
| **total** | **0.4–0.9 s** | above 1 s it reads as fake |

The two TTS paths are exactly this trade: **Edge TTS sounds better but needs the network; Kokoro (92 MB, local) is a touch slower with fewer voices.**

## Visemes are not phonemes

The most misread part:

- a **phoneme** is a linguistic unit: /p/, /a/, /t/;
- a **viseme** is a **mouth shape** — what it looks like.

Several phonemes map to one viseme (/p/ /b/ /m/ close the lips almost identically). So lip-sync needs a dozen visemes, not dozens of phonemes — **which is why it can run in real time in a browser**.

The demo uses five shapes plus interpolation. The 90 ms transition is empirical: faster twitches, slower looks like slow motion.

## Why timestamps are mandatory

Without word boundaries you can only guess from **amplitude**.

But loud is not talking (music, plosives, laughter all trigger it), and **plosives (p/t/k) need the shape before the sound** — reacting to audio always lands late.

TTS \`WordBoundary\` events (offset + word) fix this: knowing the next word starts at 1.24 s lets you prepare the shape three frames early.

## AudioWorklet, not requestAnimationFrame

In production the audio push runs on AudioWorklet (audio thread, 128-frame blocks, ~2.9 ms) while rendering runs on rAF (~16.7 ms).

They are decoupled: audio must not glitch because rendering stuttered (that is an audible crackle), while rendering may drop frames (the eye will not notice). The demo simplifies to rAF to make the viseme sequence visible.

## Going one level deeper

1. Morph targets (blend shapes) are how libraries like TalkingHead work: pre-built "mouth open", "eyes narrow", blended by weight at runtime. Simpler than skeletal animation, good enough for a frontal face.
2. \`ttsEndpoint: null\` means the page synthesises audio itself and feeds it in — the library's built-in TTS path is disabled. "Turning off a capability of the third-party library" is a common integration move.
3. The single biggest latency win is **streaming TTS**: start playing the first word instead of waiting for the whole sentence. The cost is that the lip-sync model must handle "receive and play simultaneously".`
    }
  },

  '/aigc/text-to-image': {
    python: `"""Image generation as token prediction: Janus-Pro-1B does not diffuse.

Two heads share one transformer:
  generation head -> image tokens (autoregressive, one at a time)
  understanding head -> text tokens (same model, same weights)
"""
# patches matter more than pixels: 384x384 with 16px patches = 576 tokens
SIDE = 384
PATCH = 16
TOKENS = (SIDE // PATCH) ** 2


def cost(num_tokens=TOKENS, layers=24, hidden=2048):
    """Each image token needs one full forward pass -- the same arithmetic as
    decoding text, just with a much longer output."""
    flops_per_token = 2 * layers * hidden ** 2 * 6      # rough: attn + mlp
    return {'tokens': num_tokens, 'gflops': round(num_tokens * flops_per_token / 1e9, 1)}


if __name__ == '__main__':
    print(cost())
    # {'tokens': 576, 'gflops': 725.0}  -- per image, before any sampling
    print('at 2 tokens/s in a browser that is ~5 minutes; hence 256px previews')


# The identity that explains all image-generation latency:
#   time ~= num_image_tokens * time_per_forward
# Halving the side length quarters the token count -- which is why every UI
# offers a "fast / small" mode first.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Why image generation is slow: token count</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .wrap{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start}
  canvas{border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .side{flex:1;min-width:220px;font-size:12px}
  label{display:flex;align-items:center;gap:8px;margin-bottom:9px}
  input[type=range]{width:170px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:58px}
  .big{font-size:15px;margin-top:10px}
  .big b{font-variant-numeric:tabular-nums}
  .note{color:#64748b;font-size:12px;margin-top:10px}
</style>
</head>
<body>
<h1>576 tokens for one picture</h1>
<p>Autoregressive image models emit image tokens one at a time, exactly like words. The grid below is
the token layout: a 384 px image at 16 px patches is 24×24 = 576 forward passes.</p>
<div class="wrap">
  <canvas id="c" width="300" height="300"></canvas>
  <div class="side">
    <label>side length <input type="range" id="s" min="128" max="512" step="32" value="384"><output id="v"></output> px</label>
    <label>patch size <input type="range" id="p" min="8" max="32" step="8" value="16"><output id="v2"></output> px</label>
    <div class="big">tokens <b id="tok">—</b></div>
    <div class="big">est. time <b id="t">—</b></div>
    <div class="note">Halve the side and the token count quarters — that is why "small / fast" modes
    exist, and why a 1024 px preview is not a rendering choice but a compute choice.</div>
  </div>
</div>
<script>
(function () {
  var TOK_PER_SEC = 2.2;   // optimistic browser figure for a 1B autoregressive model

  function render() {
    var side = +document.getElementById('s').value;
    var patch = +document.getElementById('p').value;
    document.getElementById('v').textContent = side;
    document.getElementById('v2').textContent = patch;

    var n = Math.round(side / patch);
    var tokens = n * n;
    var secs = tokens / TOK_PER_SEC;
    document.getElementById('tok').textContent = tokens + ' (' + n + '×' + n + ')';
    document.getElementById('t').textContent =
      secs > 60 ? Math.round(secs / 60) + ' min ' + Math.round(secs % 60) + ' s'
                : secs.toFixed(0) + ' s';

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var S = 300, pad = 14, grid = S - pad * 2;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, S, S);

    var cell = grid / n;
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        // a fake "image" so the grid reads as content, not just cells
        var v = Math.sin(x / n * 6) * Math.cos(y / n * 5);
        var hue = 200 + v * 40;
        ctx.fillStyle = 'hsl(' + hue + ',70%,' + (60 + v * 12) + '%)';
        ctx.fillRect(pad + x * cell, pad + y * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    if (n <= 32) {
      ctx.strokeStyle = 'rgba(15,23,42,.10)';
      for (var i = 0; i <= n; i++) {
        ctx.beginPath(); ctx.moveTo(pad + i * cell, pad); ctx.lineTo(pad + i * cell, pad + grid); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pad, pad + i * cell); ctx.lineTo(pad + grid, pad + i * cell); ctx.stroke();
      }
    }
    ctx.fillStyle = '#0f172a'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('each cell = 1 forward pass', pad, S - 2);
  }

  ['s', 'p'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 图像生成 = 生成图像 token，和写字一模一样

\`Janus-Pro-1B\` 不是扩散模型，它把图像切成**离散 token**（VQ-VAE 的码本），然后用和文本相同的方式自回归生成：一个 token 一次前向。

关键数字：

\`token 数 = (边长 / patch 大小)²\`

- 384 px、16 px patch → 24×24 = **576 个 token**；
- 每 token 一次完整前向（1B 模型，24 层）；
- 浏览器里约 2 tokens/s → **约 4-5 分钟一张**。

**这就解释了为什么所有本地图像生成都要先给"小图预览"。** 页面的滑杆把这个关系做成了可探索的：边长减半，token 数降到 1/4。

## 对比扩散模型：两条完全不同的路

| | 自回归（Janus） | 扩散（SD / Moebius） |
| --- | --- | --- |
| 生成方式 | 逐 token，串行 | 逐步骤，每步整张图 |
| 步数 | 576（384²） | 20–50 |
| 单步成本 | 一次前向（小） | 一次 UNet 前向（大） |
| 分辨率提高 | token 数平方增长 | 单步成本增长，步数不变 |
| 文本与图像 | **同一个 transformer**，天然多模态 | 需要 cross-attention 注入 |

自回归的优势是"文字和图像用同一套权重"（所以 Janus 同时能做图像理解），劣势是高分辨率时代价爆炸。扩散模型反过来：分辨率代价温和，但难以和语言模型统一。

**这是 2024–2025 两条技术路线的核心分歧**，页面上这一页（Janus）和 /aigc/inpainting（扩散）并排放在同一个分类里，正好能对照看。

## 那个 dtype 配置不是随便写的

页面的 dtype 是分模块设的：

\`\`\`
prepare_inputs_embeds: q4       # 固定 wasm
language_model:        q4f16    # 无 shader-f16 则 q4
lm_head / gen_head:    fp16
image_decode:          fp32     # 解码器必须高精度
\`\`\`

**图像解码器用 fp32** 是因为它对数值误差敏感：q4 的量化误差会在解码后变成可见的色块和噪点。语言部分可以 q4，视觉解码不行 —— 这和 /vision/matting 页 MODNet 必须 fp32 是同一个道理。

## 想深一层

1. \`num_image_tokens\` 被同时赋给 \`min_new_tokens\` 和 \`max_new_tokens\`，意思是"必须生成正好这么多 token"—— 少一个图就不完整，多一个就越界。
2. 1B 模型在浏览器里跑图像生成，本质是"能跑"而不是"好用"。真正的本地生成要么上 WebGPU + 更大显存，要么接受 256px。
3. 自回归生成的**顺序**是从左上到右下。这让它在生成过程中无法"全局调整"—— 而扩散每步都能看全图，所以扩散的空间一致性更好。`,
      en: `## Image generation is token prediction, same as writing

\`Janus-Pro-1B\` is not a diffusion model: it slices the image into **discrete tokens** (a VQ-VAE codebook) and generates them autoregressively, one token per forward pass.

The number that matters:

\`tokens = (side / patch)²\`

- 384 px at 16 px patches → 24×24 = **576 tokens**;
- one full forward pass per token (1B model, 24 layers);
- ~2 tokens/s in a browser → **roughly 4–5 minutes per image**.

**Which is why every local image generator offers a small preview first.** The sliders turn that relation into something you can feel: halve the side and the token count quarters.

## Versus diffusion: two different roads

| | Autoregressive (Janus) | Diffusion (SD / Moebius) |
| --- | --- | --- |
| Generation | token by token, serial | step by step, whole image |
| Steps | 576 (at 384²) | 20–50 |
| Cost per step | one forward (small) | one UNet forward (large) |
| Higher resolution | token count grows quadratically | per-step cost grows, steps unchanged |
| Text and image | **one transformer**, natively multimodal | needs cross-attention injection |

Autoregression's advantage is one set of weights for text and pixels (hence Janus also does image understanding); its cost explodes at high resolution. Diffusion is the reverse: resolution is cheap-ish, but unifying with a language model is hard.

**That is the central split between the two lines of 2024–2025**, and this page (Janus) sitting next to /aigc/inpainting (diffusion) in the same category makes the contrast visible.

## The dtype configuration is not arbitrary

Dtypes are set per module:

\`\`\`
prepare_inputs_embeds: q4       # pinned to wasm
language_model:        q4f16    # q4 if no shader-f16
lm_head / gen_head:    fp16
image_decode:          fp32     # the decoder must stay high precision
\`\`\`

**The image decoder is fp32** because it is sensitive to numerical error: q4 quantisation shows up as visible blocking and noise after decoding. Language can be q4; visual decoding cannot — the same reason MODNet stays fp32 on /vision/matting.

## Going one level deeper

1. \`num_image_tokens\` is assigned to both \`min_new_tokens\` and \`max_new_tokens\` — "generate exactly this many", since fewer leaves the image incomplete and more overruns it.
2. A 1B model generating images in a browser is "it runs", not "it is good". Serious local generation needs more VRAM, or accepts 256 px.
3. Autoregressive generation proceeds top-left to bottom-right, so it cannot revise globally mid-generation — whereas diffusion sees the whole canvas at every step, which is why diffusion has better spatial coherence.`
    }
  },

  '/aigc/inpainting': {
    python: `"""Inpainting: diffusion in a 64x64 latent space, not on 512x512 pixels.

The page runs Moebius-ONNX (vae_encoder / unet / vae_decoder) with DDIM, 20 steps.
"""
import numpy as np


def latent_shape(pixels=512, factor=8):
    """/8 because the VAE downsamples by 8. All the expensive work happens here:
    64x64x4 = 16k numbers instead of 512x512x3 = 786k. That is the whole reason
    latent diffusion is affordable."""
    return (1, 4, pixels // factor, pixels // factor)


def ddim_schedule(steps=20, total=1000):
    """DDIM takes big jumps. DDPM would need ~1000 steps for the same quality.
    The floor is what makes 20 steps usable in a browser."""
    return [int(total - i * total / steps) for i in range(steps)]


def inpaint_step(x_t, eps, mask_latent, x0_known, t, strength=0.99):
    """Keep the known region from the original latent, denoise the hole.
    Doing this in latent space is why the boundary can be soft instead of cut."""
    x0 = x_t - eps                       # placeholder for the actual sampler update
    return x0 * (1 - mask_latent) + x0_known * mask_latent


def cfg_scale(eps_uncond, eps_cond, scale=2.0):
    """Classifier-free guidance: push away from the unconditional prediction.
    scale 2 is the page's default; above ~7 images start to saturate."""
    return eps_uncond + scale * (eps_cond - eps_uncond)


if __name__ == '__main__':
    print('latent', latent_shape(), 'steps', len(ddim_schedule(20)))


# Two numbers explain most of the runtime on this page:
#   20 steps x (2 UNet passes for CFG) = 40 UNet forwards per image
#   each of them on a 64x64x4 latent -- small, but still seconds in WASM
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DDIM: 20 big steps instead of 1000 small ones</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  canvas{border-radius:8px;background:#0f172a;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .side{flex:1;min-width:220px;font-size:12px}
  label{display:flex;align-items:center;gap:8px;margin-bottom:8px}
  input[type=range]{width:150px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:44px}
  .big{font-size:15px;margin-top:8px}
  .big b{font-variant-numeric:tabular-nums}
  button{font:inherit;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid #cbd5e1;
    background:#fff;cursor:pointer;margin-top:8px}
  .note{color:#64748b;font-size:12px;margin-top:10px}
</style>
</head>
<body>
<h1>Denoising in 64×64, not 512×512</h1>
<p>The VAE compresses the image 8×, so the UNet works on a 64×64×4 latent — 16k numbers instead of
786k pixels. Drag the step count and watch the trade between speed and structure.</p>
<div class="wrap">
  <canvas id="c" width="260" height="260"></canvas>
  <div class="side">
    <label>DDIM steps <input type="range" id="s" min="2" max="50" step="1" value="20"><output id="v">20</output></label>
    <label>guidance <input type="range" id="g" min="1" max="7" step="0.5" value="2"><output id="v2">2.0</output></label>
    <div class="big">UNet forwards <b id="u">40</b></div>
    <div class="big">latent <b>1×4×64×64</b></div>
    <button id="run">animate</button>
    <div class="note">With CFG the UNet runs twice per step (conditional + unconditional) — hence
    20 steps is 40 forwards, which is exactly why the page caps guidance at a modest value.</div>
  </div>
</div>
<script>
(function () {
  var S = 260, N = 64;            // we draw at 64x64 then scale, like a latent
  var c = document.getElementById('c'), ctx = c.getContext('2d');
  var progress = 1;               // 1 = fully denoised
  var anim = 0;

  function target(x, y) {
    // a simple "image": a bright disc on a gradient, inside a masked hole
    var cx = 0.55, cy = 0.5, r = 0.22;
    var dx = x / N - cx, dy = y / N - cy;
    var inDisc = Math.hypot(dx, dy) < r;
    var bg = 0.25 + 0.5 * (x / N);
    return inDisc ? 1 : bg;
  }

  function render() {
    var steps = +document.getElementById('s').value;
    var guide = +document.getElementById('g').value;
    document.getElementById('v').textContent = steps;
    document.getElementById('v2').textContent = guide.toFixed(1);
    document.getElementById('u').textContent = steps * 2;

    var img = ctx.createImageData(N, N);
    // deterministic pseudo-noise so the frames are reproducible
    function noise(x, y, seed) {
      var v = Math.sin((x * 12.9898 + y * 78.233 + seed) * 0.5) * 43758.5453;
      return v - Math.floor(v);
    }

    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        // masked hole: keep the border region "known", denoise the middle
        var inHole = Math.abs(x / N - 0.55) < 0.18 && Math.abs(y / N - 0.5) < 0.18;
        var t = target(x, y);
        var v;
        if (!inHole) {
          v = t;                                   // untouched pixels
        } else {
          // noise -> signal, at a rate set by progress and guidance
          var nz = noise(x, y, 7);
          var mix = Math.min(1, progress * (0.6 + guide * 0.12));
          v = nz * (1 - mix) + t * mix;
        }
        var i = (y * N + x) * 4;
        var g = Math.round(v * 255);
        img.data[i] = g;
        img.data[i + 1] = Math.round(v * 200 + 20);
        img.data[i + 2] = Math.round(v * 255);
        img.data[i + 3] = 255;
      }
    }

    // draw scaled up, with the mask outline
    var tmp = document.createElement('canvas');
    tmp.width = tmp.height = N;
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(tmp, 0, 0, S, S);
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(S * (0.55 - 0.18), S * (0.5 - 0.18), S * 0.36, S * 0.36);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('mask', S * 0.55 - 14, S * 0.5 - S * 0.18 - 5);
  }

  document.getElementById('run').addEventListener('click', function () {
    cancelAnimationFrame(anim);
    progress = 0;
    var t0 = performance.now();
    (function tick() {
      progress = Math.min(1, (performance.now() - t0) / 1800);
      render();
      if (progress < 1) anim = requestAnimationFrame(tick);
    })();
  });

  ['s', 'g'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  progress = 1;
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 扩散不在 512×512 上做，在 64×64 上做

这是理解扩散模型成本的第一件事：

\`512×512×3 = 786,432 个数字\` → VAE 编码 → \`64×64×4 = 16,384 个数字\`

**46 倍的压缩**。UNet 在 latent 上跑，最后才用 VAE 解码回像素。这就是"潜空间扩散"（Latent Diffusion）的全部意义 —— 它让扩散模型从"实验室才能跑"变成"消费级显卡能跑"，也让浏览器能跑。

页面的固定参数：512×512 输入、64×64 latent、DDIM 20 步、guidance 2。

## DDIM 20 步 vs DDPM 1000 步

原始 DDPM 需要约 1000 步去噪，每步都要跑一次 UNet。DDIM 换了一个**确定性的采样器**，让模型可以"跳步"：

- DDPM：1000 次小步，每步很保守；
- DDIM：20 次大步，每步跨过更多噪声水平。

质量损失很小（因为噪声水平的轨迹仍然连续），速度提升 50 倍。**这是扩散模型能进入交互式应用的关键技术。**

页面的 \`ddim_schedule()\` 就是生成这 20 个时间点：\`[1000, 950, 900, ..., 50]\`。

## CFG 让 UNet 跑两遍

\`guidance_scale\`（分类器无关引导）的做法是：

\`eps = eps_uncond + scale × (eps_cond - eps_uncond)\`

意思是"从无条件的预测，往有条件的方向推"。所以每一步要跑**两次** UNet（一次带条件、一次不带）。

**20 步 × 2 = 40 次 UNet 前向**。页面的 "UNet forwards" 计数就是让你看到这个乘数关系。guidance 调高不会增加前向次数，但会让图像更"贴提示词"、也更饱和失真。

## mask 在哪一步生效

inpainting 的关键是：**每一步之后，把未遮罩区域替换回原图的 latent**。

\`\`\`
x_t = denoise(x_t)
x_t = x_t * (1 - mask) + x_orig_latent * mask    # 保住原图区域
\`\`\`

这会带来一个副作用：边界处会出现"接缝"。解法是**在 latent 空间做软 mask**（把 mask 模糊处理），让过渡自然 —— 页面的示例用虚线框标示了 mask 边界，真实实现里它是渐变的。

## 想深一层

1. \`strength 0.99\` 表示从接近纯噪声开始 —— 也就是"完全重绘"遮罩区。0.5 会保留一半原图结构（适合修脸）。
2. 这个页面的模型**没有文本提示**（\`input_ids\` 全是 null 标签）。它是按类别条件生成的修复模型，不是文本引导的 —— 所以你不能输入"把这里改成猫"。
3. 三个 ONNX 分开加载（encoder / unet / decoder）是为了显存：同时加载会让中端设备 OOM。这是所有浏览器端扩散实现的通用做法。`,
      en: `## Diffusion does not happen at 512×512, it happens at 64×64

The first thing to understand about diffusion cost:

\`512×512×3 = 786,432 numbers\` → VAE encode → \`64×64×4 = 16,384 numbers\`

**A 46× reduction.** The UNet runs on the latent, and the VAE decodes back to pixels at the end. That is the entire point of latent diffusion — it moved these models from "lab only" to "consumer GPU", and now to a browser.

The page's fixed parameters: 512×512 input, 64×64 latent, DDIM 20 steps, guidance 2.

## DDIM 20 steps vs DDPM 1000

Original DDPM needs ~1000 denoising steps, each requiring a UNet pass. DDIM swaps in a **deterministic sampler** that can take bigger jumps:

- DDPM: 1000 small conservative steps;
- DDIM: 20 large steps spanning many noise levels.

Quality loss is small (the noise trajectory stays continuous) while speed improves ~50×. **This is what let diffusion become interactive.**

\`ddim_schedule()\` generates those 20 timestamps: \`[1000, 950, 900, …, 50]\`.

## CFG makes the UNet run twice

\`guidance_scale\` (classifier-free guidance):

\`eps = eps_uncond + scale × (eps_cond - eps_uncond)\`

"From the unconditional prediction, push toward the conditional one." So every step runs the UNet **twice** (once with the condition, once without).

**20 steps × 2 = 40 UNet forwards.** The page's "UNet forwards" counter makes that multiplier visible. Raising guidance does not add forwards, but makes images hug the condition harder — and oversaturate.

## Where the mask applies

Inpainting works by **restoring the unmasked region from the original latent after every step**:

\`\`\`
x_t = denoise(x_t)
x_t = x_t * (1 - mask) + x_orig_latent * mask
\`\`\`

Side effect: seams at the boundary. The fix is a **soft mask in latent space** (blur the mask) so the transition is gradual — the demo marks the mask with a dashed outline; in production it is feathered.

## Going one level deeper

1. \`strength 0.99\` means starting from near-pure noise, i.e. fully repainting the masked area. 0.5 keeps half the original structure (good for retouching faces).
2. This page's model has **no text prompt** (\`input_ids\` are all null labels): it is a class-conditional inpainter, not text-guided — you cannot ask it to "turn this into a cat".
3. The three ONNX graphs load separately (encoder / unet / decoder) for VRAM: loading together OOMs mid-range devices. Universal practice in browser diffusion.`
    }
  },

  '/aigc/reasoning-chat': {
    python: `"""Reasoning models: two outputs from one generation.

DeepSeek-R1-Distill-Qwen-1.5B (q4/q4f16) writes a chain of thought first,
then the answer. The split is the whole UX problem.
"""
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

name = 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX'
tok = AutoTokenizer.from_pretrained(name)
model = AutoModelForCausalLM.from_pretrained(name)


def generate(prompt, max_new_tokens=1024, temperature=0.6, repetition_penalty=1.1):
    ids = tok.apply_chat_template([{'role': 'user', 'content': prompt}],
                                  add_generation_prompt=True, return_tensors='pt')
    with torch.no_grad():
        out = model.generate(ids, max_new_tokens=max_new_tokens,
                             temperature=temperature, do_sample=True,
                             repetition_penalty=repetition_penalty)
    return tok.decode(out[0][ids.shape[-1]:], skip_special_tokens=True)


def split_think(text):
    """The tag is the contract. Everything before </think> is scratch work --
    useful to show collapsed, never useful as the answer."""
    if '</think>' in text:
        think, answer = text.split('</think>', 1)
        return think.replace('<think>', '').strip(), answer.strip()
    return '', text.strip()


if __name__ == '__main__':
    raw = generate('一个笼子里有鸡和兔共 35 个头、94 只脚，各几只？')
    think, answer = split_think(raw)
    print('--- thinking (%d chars) ---' % len(think))
    print(think[:200])
    print('--- answer ---')
    print(answer)


# Why temperature 0.6 rather than 0: reasoning chains benefit from a little
# exploration, but at 1.0 the chain often derails into repetition. 0.6 is the
# value DeepSeek publishes for these distilled models.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Thinking tokens are not free</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  canvas{width:100%;max-width:620px;display:block;border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  label{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px}
  input[type=range]{width:200px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:56px}
  .panes{display:flex;gap:12px;margin-top:12px;flex-wrap:wrap}
  .pane{flex:1;min-width:220px;border:1px solid #e2e8f0;border-radius:8px;padding:9px 11px;font-size:12px;background:#fff}
  .pane h3{margin:0 0 5px;font-size:12px;color:#64748b;font-weight:600}
  .pane.think{background:#fffbeb;border-color:#fde68a}
  .pane.answer{background:#f0fdf4;border-color:#bbf7d0}
  .note{color:#64748b;font-size:12px;margin-top:10px}
</style>
</head>
<body>
<h1>The scratchpad costs the same per token as the answer</h1>
<p>A reasoning model spends most of its budget thinking. Watch what that does to total time, and why
512 tokens of "answer budget" often leaves nothing for the answer itself.</p>
<canvas id="c" width="620" height="150"></canvas>
<label>max_new_tokens <input type="range" id="m" min="128" max="2048" step="64" value="1024"><output id="v">1024</output></label>
<label>difficulty <input type="range" id="d" min="1" max="5" step="1" value="3"><output id="v2">3</output></label>
<div class="panes">
  <div class="pane think"><h3>thinking</h3><div id="t1"></div></div>
  <div class="pane answer"><h3>answer</h3><div id="t2"></div></div>
</div>
<div class="note">If the thought runs to the token limit, the answer is empty and the model just
stops. That is the failure mode with a small max_new_tokens — it does not degrade gracefully.</div>
<script>
(function () {
  function render() {
    var max = +document.getElementById('m').value;
    var diff = +document.getElementById('d').value;
    document.getElementById('v').textContent = max;
    document.getElementById('v2').textContent = diff;

    // thinking length scales with difficulty; answer length is roughly fixed
    var thinkWant = 90 * diff * diff;
    var answerWant = 120;
    var think = Math.min(thinkWant, max);
    var answer = Math.min(answerWant, Math.max(0, max - think));
    var truncated = think < thinkWant;
    var empty = max - think <= 0;

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var W = 620, H = 150;
    ctx.clearRect(0, 0, W, H);
    var total = max;
    var x = v => 20 + v / total * (W - 40);

    ctx.fillStyle = '#fde68a';
    ctx.fillRect(20, 50, x(think) - 20, 34);
    ctx.fillStyle = '#bbf7d0';
    ctx.fillRect(x(think), 50, Math.max(0, x(think + answer) - x(think)), 34);

    ctx.strokeStyle = '#94a3b8';
    ctx.strokeRect(20, 50, W - 40, 34);

    ctx.fillStyle = '#0f172a'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('thinking ' + think, 20, 42);
    if (answer) ctx.fillText('answer ' + answer, x(think) + 4, 42);
    ctx.fillStyle = '#475569';
    ctx.fillText('token budget ' + max, 20, 106);

    if (truncated) {
      ctx.fillStyle = '#dc2626';
      ctx.fillText('hit the limit mid-thought', 20, 126);
    }
    if (empty) {
      ctx.fillStyle = '#dc2626';
      ctx.fillText('no budget left for the answer', x(think) - 40, 126);
    }

    document.getElementById('t1').innerHTML =
      ['1. 设鸡有 x 只，兔有 y 只', '2. x + y = 35', '3. 2x + 4y = 94',
       '4. 代入得 y = 12, x = 23', '5. 验算：23 + 12 = 35，46 + 48 = 94 ✓']
        .slice(0, truncated ? 4 : 5).join('<br>') +
      (truncated ? '<br>… [truncated at the budget]' : '')
    document.getElementById('t2').textContent = empty
      ? '(nothing — the budget ran out)'
      : '鸡 23 只，兔 12 只。';
  }

  ['m', 'd'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 推理模型把一件事变成了两件事

普通模型：\`问题 → 答案\`。
推理模型：\`问题 → 思考（几百到几千 token）→ 答案\`。

页面的 DeepSeek-R1-Distill-Qwen-1.5B 就是在生成时先写一段思维链，遇到 \`</think>\` 才开始写正式答案。

**关键后果：思考 token 和答案 token 一样贵。** 每个 token 都要一次前向。所以一个"想 2000 token"的模型，响应时间是普通模型的 5–10 倍。

页面的滑杆就是让你感受这件事：\`max_new_tokens\` 设小了，思考会把预算吃光，答案一个字都没有。

## 切分是前端必须做的事

如果直接把原始输出贴到界面上，用户会看到一大段"让我想想…"然后才看到结论。

正确做法（页面就是这么做的）：按 \`</think>\` 切开，**思考折叠、答案展开**。有的模型用结构化字段（\`reasoning_content\`，见 /aigc/llm-chat），有的用标签 —— 对接不同模型时要适配。

## 为什么 temperature 是 0.6 而不是 0

直觉上推理应该用温度 0（最确定）。实际不是：

- **温度 0**：完全贪心，遇到一步走偏就无法回头（会固执地沿着错误推导到底）；
- **温度 1.0**：发散，长链条容易跑题、重复；
- **0.6**：DeepSeek 给的推荐值，允许一点探索但不失控。

\`repetition_penalty 1.1\` 也是同一个目的：抑制"我想想…我想想…"这种循环。

## 1.5B 能推理吗

能，但天花板很明显。蒸馏（distillation）的做法是：用大模型（R1 671B）生成大量"问题 + 思维链 + 答案"，让小模型去模仿。

结果是小模型学到了**推理的格式和常见套路**（列方程、验算），但没有大模型的深度。所以：

- 数学应用题、逻辑题：表现不错；
- 需要多步创造性推理：会崩。

**"能产出思维链"不等于"推理正确"** —— 这是用蒸馏模型时最容易产生的错觉。

## 想深一层

1. 页面同时提供 MiniThinky-v2-1B（用 \`<|thinking|>/<|answer|>\` 标记）—— 不同模型的标记不同，切分逻辑要按模型配。
2. \`max_new_tokens 1024\` 对 1.5B 是合理上限：再长，模型容易开始复读。
3. WebGPU + shader-f16 时用 q4f16，否则 q4 —— 这是全站统一的 dtype 策略（见 /nlp/transformers）。`,
      en: `## Reasoning models turn one job into two

A normal model: \`question -> answer\`.
A reasoning model: \`question -> thinking (hundreds to thousands of tokens) -> answer\`.

The page's DeepSeek-R1-Distill-Qwen-1.5B writes a chain of thought first and only starts the answer after \`</think>\`.

**The consequence that matters: thinking tokens cost exactly the same as answer tokens.** Every token is a forward pass, so a model that "thinks 2000 tokens" is 5–10× slower than a plain one.

The slider makes that tangible: set \`max_new_tokens\` too low and the thinking eats the whole budget, leaving nothing for the answer.

## Splitting is the client's job

Paste the raw output into the UI and the user reads a wall of "let me think…" before the conclusion.

The right move (what the page does): split on \`</think>\`, **collapse the thinking, expand the answer**. Some models use a structured field (\`reasoning_content\`, see /aigc/llm-chat), others a tag — adapting per model is necessary.

## Why temperature 0.6 and not 0

Intuition says reasoning wants temperature 0. It does not:

- **temperature 0**: fully greedy, so one wrong step commits it to the wrong derivation;
- **1.0**: divergent, long chains wander and repeat;
- **0.6**: DeepSeek's recommendation — some exploration, no derailment.

\`repetition_penalty 1.1\` serves the same goal: suppress "let me think… let me think…" loops.

## Can a 1.5B model reason

Yes, with an obvious ceiling. Distillation means: a large model (R1 671B) generates masses of "question + chain + answer" and the small one imitates.

The small model learns **the format and the common moves** (set up equations, verify), not the depth. So:

- arithmetic word problems, logic puzzles: decent;
- multi-step creative reasoning: collapses.

**"Produces a chain of thought" is not "reasons correctly"** — the easiest illusion to fall for with distilled models.

## Going one level deeper

1. The page also offers MiniThinky-v2-1B (\`<|thinking|>/<|answer|>\` markers) — different models, different markers, so splitting must be configured per model.
2. \`max_new_tokens 1024\` is a sensible cap for 1.5B: longer and it starts repeating itself.
3. q4f16 when WebGPU has shader-f16, otherwise q4 — the site-wide dtype policy (see /nlp/transformers).`
    }
  },

  '/aigc/codegen': {
    python: `"""Code completion: greedy by default, and that is a feature.

Qwen2.5-Coder-0.5B at q4f16/q8. do_sample=False means the same prefix always
gives the same completion -- the property every code assistant needs.
"""
from transformers import pipeline

gen = pipeline('text-generation', model='onnx-community/Qwen2.5-Coder-0.5B-ONNX')


def complete(prefix, max_new_tokens=128, do_sample=False, temperature=0.5, top_k=5):
    """Two very different modes:
       do_sample=False  greedy, deterministic, no temperature effect
       do_sample=True   temperature/top_k apply, output varies per run
    The page defaults to greedy: a completion that changes every keystroke is
    unusable."""
    out = gen(prefix, max_new_tokens=max_new_tokens, do_sample=do_sample,
              temperature=temperature if do_sample else None,
              top_k=top_k if do_sample else None,
              return_full_text=False)
    return out[0]['generated_text']


def looks_like_code(text):
    """A cheap gate before running anything: the page executes Python via
    Pyodide, so it must at least look like Python and must not import os/sys."""
    banned = ('import os', 'import sys', 'subprocess', 'open(', '__import__')
    return not any(b in text for b in banned)


if __name__ == '__main__':
    prefix = 'def fib(n):\\n    """Return the n-th Fibonacci number."""\\n'
    a = complete(prefix)
    b = complete(prefix)
    print('deterministic:', a == b)     # True with do_sample=False
    print(a)
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Greedy vs sampled: why code completion must be deterministic</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  textarea{width:100%;box-sizing:border-box;height:66px;padding:9px 11px;border:1px solid #cbd5e1;
    border-radius:8px;font:12px/1.55 ui-monospace,monospace;resize:vertical}
  .row{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:12px}
  label{display:flex;align-items:center;gap:7px}
  input[type=range]{width:120px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:42px}
  button{font:inherit;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer}
  .out{margin-top:10px;font:12px/1.6 ui-monospace,monospace;background:#0f172a;color:#e2e8f0;
    padding:10px 12px;border-radius:8px;white-space:pre-wrap;min-height:58px}
  .tag{font-size:11px;color:#64748b;margin-top:6px}
</style>
</head>
<body>
<h1>Same prefix, four times</h1>
<p>Greedy decoding picks the highest-probability token every step, so the same input always yields the
same output. Switch to sampling and watch it vary — which is exactly what you do not want while typing.</p>
<textarea id="pre">def fib(n):
    """Return the n-th Fibonacci number."""</textarea>
<div class="row">
  <label><input type="checkbox" id="sample"> do_sample</label>
  <label>temperature <input type="range" id="t" min="0.1" max="1.5" step="0.1" value="0.5"><output id="vt">0.5</output></label>
  <button id="run">complete x4</button>
</div>
<div class="out" id="out"></div>
<div class="tag" id="tag"></div>
<div class="note" style="color:#64748b;font-size:12px;margin-top:8px">The page executes the result in
Pyodide, so a bad completion is a live risk — which is why greedy + a small model is the safe default.</div>
<script>
(function () {
  // a tiny "language model": next-token candidates per context, with priors
  var CANDIDATES = [
    { tok: 'a, b = 0, 1', p: 0.42 },
    { tok: 'if n < 2:', p: 0.27 },
    { tok: 'memo = {}', p: 0.18 },
    { tok: 'return 0', p: 0.09 },
    { tok: 'raise ValueError', p: 0.04 }
  ];

  function pick(doSample, temp) {
    if (!doSample) {
      // greedy: argmax, always the same
      return CANDIDATES.reduce(function (best, c) { return c.p > best.p ? c : best; });
    }
    // sampling: p^(1/T) then renormalise, so lower T sharpens toward greedy
    var adj = CANDIDATES.map(function (c) {
      return { tok: c.tok, p: Math.pow(c.p, 1 / temp) };
    });
    var total = adj.reduce(function (a, c) { return a + c.p; }, 0);
    var r = Math.random() * total, acc = 0;
    for (var i = 0; i < adj.length; i++) {
      acc += adj[i].p;
      if (r <= acc) return adj[i];
    }
    return adj[adj.length - 1];
  }

  function run() {
    var sample = document.getElementById('sample').checked;
    var temp = +document.getElementById('t').value;
    document.getElementById('vt').textContent = temp.toFixed(1);

    var prefix = document.getElementById('pre').value;
    var picks = [];
    for (var i = 0; i < 4; i++) picks.push(pick(sample, temp));

    var uniq = picks.map(function (p) { return p.tok; })
                    .filter(function (v, i, a) { return a.indexOf(v) === i; });

    document.getElementById('out').textContent = picks.map(function (p, i) {
      return '#' + (i + 1) + '  ' + p.tok + '   (p=' + p.p.toFixed(2) + ')';
    }).join('\\n');

    document.getElementById('tag').textContent =
      (sample ? 'sampled' : 'greedy') + ' · ' + uniq.length + ' distinct result' +
      (uniq.length === 1 ? '' : 's') + ' out of 4' +
      (sample && uniq.length === 1 ? ' — low temperature still collapses to argmax most of the time' : '');
  }

  document.getElementById('run').addEventListener('click', run);
  document.getElementById('sample').addEventListener('change', run);
  document.getElementById('t').addEventListener('input', run);
  run();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 代码补全必须是确定性的

页面的模型默认 \`do_sample: false\` —— **贪心解码**：每一步选概率最高的 token。

这意味着：同一个前缀，永远得到同一个补全。

为什么这是必须的？因为你在打字。如果每敲一个字符，补全都变一次（采样带来的随机性），这个功能就无法使用。**IDE 里的 AI 补全无法忍受"同一位置两次不同结果"。**

对比：聊天要随机性（同一个问题答两次应该不一样），代码补全要确定性。**temperature 不是"调质量"的滑杆，是"调多样性"的滑杆。**

## 贪心的代价

贪心有一个众所周知的缺陷：**局部最优不等于全局最优**。

每一步都选当时最好的 token，可能走进一条死路 —— 语法上通顺但逻辑错误。而稍微低一点的 token 可能引导出更好的整体结果。

这就是为什么**聊天要采样、代码补全要贪心**：两者的失败代价不同。聊天里的"不够有趣"是小事，补全里的"语法对但逻辑错"会让你直接接受一个 bug。

## Pyodide：补全完直接执行

页面在补全之后，用 Pyodide（浏览器里的 Python 0.27.7）**真的执行这段代码**。

这是教学上最有价值的设计：学生能立刻看到"模型写的代码能不能跑"。

但这也带来风险：模型可能生成 \`import os; os.system(...)\` 之类的代码。Pyodide 是一个受限环境（没有真正的文件系统、没有网络），但它**不是安全边界** —— 真实产品必须在沙箱里跑，或者干脆不执行模型生成的代码。

页面的 Python 示例里有个 \`looks_like_code\` 就是这个思路的简化版：至少挡掉明显危险的导入。

## 0.5B 能写什么代码

\`Qwen2.5-Coder-0.5B\` 只有 5 亿参数，能力边界很清楚：

- **能写**：斐波那契、排序、字符串处理、简单的数据结构；
- **不能写**：涉及具体库 API 的（它没见过）、需要多文件结构的、有隐含约束的。

它擅长的是"**模式补全**"：你写了个 \`def fib(n):\` 加一句 docstring，它知道接下来该是什么。这也是代码模型最实用的场景 —— 不是"从零写一个系统"，是"补完我起头的这行"。

## 想深一层

1. \`top_k: 5\` 只在采样时生效。贪心时这个参数被忽略 —— 这是一个常见的"设了但没用"的配置项。
2. 代码模型的 tokenizer 对缩进敏感。空格数不一致会显著影响生成质量，这也是为什么 Python 代码补全比 JS 难一些（结构靠缩进）。
3. 想让补全"稳定但不呆板"，工业界的做法是**低温采样**（0.2–0.3）而不是纯贪心 —— 兼顾一致性和偶尔的多样性。`,
      en: `## Code completion must be deterministic

The page's model defaults to \`do_sample: false\` — **greedy decoding**: take the highest-probability token every step.

Same prefix, same completion, always.

Why is that mandatory? Because you are typing. If the completion changes on every keystroke (sampling randomness), the feature is unusable. **No AI completion in an IDE can tolerate "different result the second time at the same spot".**

Contrast with chat, which wants variety (the same question twice should differ). **Temperature is a diversity knob, not a quality knob.**

## The price of greedy

Greedy has a known flaw: **local optimum is not global optimum**.

Choosing the best token at each step can walk into a dead end — syntactically fine, logically wrong. A slightly lower-probability token might have led somewhere better.

Which is why **chat samples and code completion goes greedy**: the cost of failure differs. "Less interesting" is minor in chat; "syntactically valid but wrong" in code means you accept a bug.

## Pyodide: execute what was generated

After completing, the page **actually runs** the code with Pyodide (Python 0.27.7 in the browser).

That is the most valuable teaching design here: the student immediately sees whether the model's code works.

It also carries risk: generated code could contain \`import os\` and worse. Pyodide is a restricted environment (no real filesystem, no network), but it **is not a security boundary** — production must sandbox or simply not execute model output.

The Python example's \`looks_like_code\` is the simplified version of that idea: block the obviously dangerous imports.

## What 0.5B can write

\`Qwen2.5-Coder-0.5B\` has 500M parameters and clear edges:

- **can**: Fibonacci, sorting, string processing, simple data structures;
- **cannot**: anything relying on a specific library API it never saw, multi-file structure, implicit constraints.

Its strength is **pattern completion**: you write \`def fib(n):\` plus a docstring and it knows what comes next. That is also the most useful code-model scenario — not "build a system from scratch" but "finish the line I started".

## Going one level deeper

1. \`top_k: 5\` only applies when sampling. Under greedy it is ignored — a very common "configured but inert" setting.
2. Code tokenizers are indentation-sensitive. Inconsistent spaces measurably degrade output, which is why Python completion is harder than JS (structure lives in whitespace).
3. For "stable but not robotic", industry uses **low-temperature sampling** (0.2–0.3) rather than pure greedy — consistency with occasional variety.`
    }
  },

  '/aigc/multimodal-chat': {
    python: `"""Vision-language chat: the image becomes a handful of tokens.

SmolVLM-256M-Instruct, fp32 vision encoder + q8 decoder. The 256M budget is
the whole story: what you can fit decides what you can ask.
"""
from transformers import AutoProcessor, AutoModelForVision2Seq
from PIL import Image

name = 'HuggingFaceTB/SmolVLM-256M-Instruct'
proc = AutoProcessor.from_pretrained(name)
model = AutoModelForVision2Seq.from_pretrained(name)


def image_tokens(width, height, patch=512, pool=4):
    """SmolVLM tiles the image into 512px patches, then pools by 4.
    More tiles = more detail = more tokens = slower and more VRAM.
    The page caps at 4 images and disables splitting -- that is a budget call."""
    tiles = max(1, (width // patch) * (height // patch))
    per_tile = (patch // pool) ** 2 // 4        # pooled patches per tile
    return tiles, per_tile * tiles


def ask(image_path, question, max_new_tokens=512):
    img = Image.open(image_path).convert('RGB')
    messages = [{'role': 'user', 'content': [
        {'type': 'image'},
        {'type': 'text', 'text': question},
    ]}]
    prompt = proc.apply_chat_template(messages, add_generation_prompt=True)
    inputs = proc(text=prompt, images=[img], return_tensors='pt')
    out = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
    return proc.batch_decode(out[:, inputs['input_ids'].shape[1]:], skip_special_tokens=True)[0]


if __name__ == '__main__':
    print('tiles, tokens:', image_tokens(1024, 768))
    # do_sample=False is deliberate: a 256M model sampled at temperature 1
    # drifts into repetition fast. Determinism hides that weakness.
`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>The image is a token bill</title>
<style>
  body{margin:0;padding:14px;font:13px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}
  h1{font-size:15px;margin:0 0 6px}p{margin:0 0 10px;color:#475569}
  .wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  canvas{border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15)}
  .side{flex:1;min-width:220px;font-size:12px}
  label{display:flex;align-items:center;gap:8px;margin-bottom:8px}
  input[type=range]{width:150px}
  output{font-variant-numeric:tabular-nums;font-weight:600;min-width:52px}
  .big{font-size:14px;margin-top:8px}
  .big b{font-variant-numeric:tabular-nums}
  .warn{color:#b91c1c;font-size:12px;margin-top:6px}
  .note{color:#64748b;font-size:12px;margin-top:10px}
</style>
</head>
<body>
<h1>A 1024×768 photo is not one token</h1>
<p>The vision encoder tiles the image, pools the patches, and hands the language model a sequence of
image tokens. Those tokens share the context window with your question — the more detail you ask for,
the less room the answer gets.</p>
<div class="wrap">
  <canvas id="c" width="300" height="225"></canvas>
  <div class="side">
    <label>image width <input type="range" id="w" min="256" max="1600" step="64" value="1024"><output id="vw">1024</output></label>
    <label>pool factor <input type="range" id="p" min="2" max="8" step="1" value="4"><output id="vp">4</output></label>
    <div class="big">image tokens <b id="tok">—</b></div>
    <div class="big">context left for text <b id="left">—</b></div>
    <div class="warn" id="warn"></div>
    <div class="note">This is why the page caps at 4 images and disables image splitting: with a
    256M model, one 1024px photo can eat most of the budget before you ask anything.</div>
  </div>
</div>
<script>
(function () {
  var CTX = 2048;         // a realistic small-model context
  var PATCH = 512;

  function render() {
    var w = +document.getElementById('w').value;
    var pool = +document.getElementById('p').value;
    document.getElementById('vw').textContent = w;
    document.getElementById('vp').textContent = pool;

    var h = Math.round(w * 3 / 4);
    var tiles = Math.max(1, Math.floor(w / PATCH) * Math.floor(h / PATCH));
    var perTile = Math.round((PATCH / pool) ** 2 / 4);
    var tokens = tiles * perTile;
    var left = CTX - tokens;

    document.getElementById('tok').textContent = tokens + ' (' + tiles + ' tile' + (tiles > 1 ? 's' : '') + ')';
    document.getElementById('left').textContent = left + ' tokens';
    document.getElementById('warn').textContent = left < 256
      ? 'almost no room left — the model will truncate your question'
      : '';

    var c = document.getElementById('c'), ctx = c.getContext('2d');
    var S = 300, H = 225;
    ctx.clearRect(0, 0, S, H);
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, S, H);

    // draw the tile grid over a fake photo
    var g = ctx.createLinearGradient(0, 0, S, H);
    g.addColorStop(0, '#bae6fd'); g.addColorStop(1, '#fde68a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, H);
    ctx.fillStyle = 'rgba(15,23,42,.35)';
    ctx.beginPath(); ctx.ellipse(S * 0.36, H * 0.6, 34, 46, 0, 0, Math.PI * 2); ctx.fill();

    var cols = Math.max(1, Math.floor(w / PATCH));
    var rows = Math.max(1, Math.floor(h / PATCH));
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1.5;
    for (var i = 0; i <= cols; i++) {
      ctx.beginPath(); ctx.moveTo(i * S / cols, 0); ctx.lineTo(i * S / cols, H); ctx.stroke();
    }
    for (var j = 0; j <= rows; j++) {
      ctx.beginPath(); ctx.moveTo(0, j * H / rows); ctx.lineTo(S, j * H / rows); ctx.stroke();
    }
    ctx.fillStyle = '#1e3a8a'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('tiles: ' + cols + ' x ' + rows, 8, H - 8);
  }

  ['w', 'p'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  render();
})();
</script>
</body>
</html>`,
    principle: {
      zh: `## 图像进模型之前先变成 token

多模态模型不是"看着图说话"，而是**把图切成 patch，每个 patch 变成一个 token**，然后和文字 token 放进同一个序列。

所以一张 1024×768 的照片，可能占掉几百到上千个 token —— 和你的问题共享同一个上下文窗口。

页面的 \`SmolVLM-256M\` 的处理方式：

1. 按 512 px 切块（tile）；
2. 每块再做 4 倍池化（patch 特征降采样）；
3. 拼成图像 token 序列；
4. 和文本 token 拼接后送入语言模型。

**"更多细节" = "更多 token" = "更慢、更占显存、留给回答的空间更少"。** 页面的滑杆就是这个关系的可视化。

## 为什么页面限制 4 张图、关掉图像切分

因为 256M 的模型上下文很小。如果允许上传 10 张高分辨率图，光图像 token 就把窗口填满，问题都进不去。

"关掉 image splitting" 是一个具体的技术决策：高端模型会把大图切成子图分别编码再合并（提升细节），但那会让 token 数翻几倍。**在 256M 上，这个功能是负担不是优势。**

## 256M 能做什么

| 能做 | 不能做 |
| --- | --- |
| 描述图片里有什么 | 读小字（OCR） |
| 数简单物体 | 精确计数（超过 5 个） |
| 判断颜色/位置关系 | 复杂空间推理 |
| 简单的图文问答 | 图表理解 |

256M 参数的模型跑在浏览器里是它的核心价值 —— **能本地跑起来**比"能力更强但跑不动"更有用。

## do_sample: false 是必须的

页面的多模态对话固定 \`do_sample: false\`（\`temperature\` 参数因此不生效）。

原因：小模型采样时容易**陷入重复**（"这是一张图片。这是一张图片。这是一张…"）。贪心解码虽然呆板，至少不会崩。

**这是"能力不足时用确定性兜底"的典型手法**：不是最优，但可控。

## 想深一层

1. \`vision_encoder: fp32\` 而 \`decoder: q8\` —— 视觉编码器对精度敏感（和 /vision/matting、/aigc/text-to-image 一样的道理），语言部分可以量化。
2. 图像 token 和文本 token **在同一个注意力里**，所以模型可以"指着图里的某个区域说话"—— 这是多模态的基础机制，不是后处理。
3. 上下文不够时的行为是**静默截断**（从前面丢），不会报错。表现是"模型好像没看到图"，实际是图被截掉了。`,
      en: `## The image becomes tokens before the model sees it

Multimodal models do not "look at a picture" — they **slice it into patches, turn each patch into a token**, and put those in the same sequence as text.

So a 1024×768 photo can consume hundreds to over a thousand tokens, sharing the context window with your question.

\`SmolVLM-256M\` on this page:

1. Tile at 512 px;
2. Pool each tile 4× (downsample patch features);
3. Concatenate into an image-token sequence;
4. Prepend to the text tokens for the language model.

**"More detail" = "more tokens" = "slower, more VRAM, less room for the answer."** The sliders visualise exactly that.

## Why the page caps at 4 images and disables splitting

Because a 256M model has a small context. Allow ten high-resolution uploads and the image tokens alone fill the window — the question never fits.

"Image splitting off" is a concrete technical call: bigger models split large images into sub-images, encode each, and merge (better detail), but that multiplies the token count. **On 256M that feature is a liability, not a benefit.**

## What 256M can do

| Can | Cannot |
| --- | --- |
| describe what is in the picture | read small text (OCR) |
| count a few objects | count accurately past ~5 |
| judge colour and rough position | complex spatial reasoning |
| simple visual Q&A | charts and diagrams |

Running in a browser is its core value — **working locally beats "more capable but unloadable"**.

## do_sample: false is mandatory

The page fixes \`do_sample: false\` for multimodal chat (so \`temperature\` has no effect).

Reason: small models fall into **repetition** when sampling ("this is a picture. this is a picture. this is a…"). Greedy is dull but does not collapse.

**The pattern of "use determinism as a fallback when capacity is short"**: not optimal, but controllable.

## Going one level deeper

1. \`vision_encoder: fp32\` while the decoder is q8 — vision encoders are precision sensitive (same reasoning as /vision/matting and /aigc/text-to-image), language can be quantised.
2. Image and text tokens live in **one attention**, which is why the model can "point at a region" — a mechanism, not post-processing.
3. When context runs out the behaviour is **silent truncation** (from the front), with no error. The symptom is "the model seems not to see the image"; in fact the image was cut.`
    }
  }
}
