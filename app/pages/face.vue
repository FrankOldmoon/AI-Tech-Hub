<script setup lang="ts">
/* 学生人脸识别（原 public/face/index.html 的静态页）。
   访问控制不在这一层：/face 的 host 守卫是 server/plugins/face-host.ts，
   在 SSR 之前就把域名访问 302 回首页，只有 IP 直连能渲染这个页面。
   客户端主体（模型加载、摄像头、识别、变焦）仍是那套命令式代码，放在
   public/face/app.js 里，挂载后再动态载入 —— 与 /ide 加载程序岛同一套路子。
   样式全部挂在 .face-tool 名下，避免 body、通配符、[hidden] 这类全局规则漏到整站。 */
definePageMeta({ layout: 'bare', fullscreen: true })

useSeoMeta({ title: 'Face Recognition' })

/* 原静态页的 head：整屏、自管双指缩放（所以禁掉浏览器缩放），并允许“添加到主屏” */
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }
  ]
})

let teardown: (() => void) | null = null
let seq = 0

/* face-recognizer.js 是经典脚本（IIFE + window.createFaceRecognizer），
   只需注入一次；后续重进页面直接复用。 */
function loadClassic(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = document.querySelector<HTMLScriptElement>(`script[data-face-lib="${src}"]`)
    if (done) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.dataset.faceLib = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('failed to load ' + src))
    document.head.appendChild(s)
  })
}

onMounted(async () => {
  const w = window as Window & { createFaceRecognizer?: unknown }
  if (!w.createFaceRecognizer) await loadClassic('/face/face-recognizer.js')
  /* 带查询串动态导入：每次挂载都是新的模块实例，顶层那些 $('#id') 才会重新绑定到
     当前 DOM（模块本身按 URL 缓存，直接用 /face/app.js 会让第二次进入拿到旧节点）。 */
  const url = `/face/app.js?v=${++seq}`
  const mod = await import(/* @vite-ignore */ url) as { teardown?: () => void }
  teardown = mod.teardown || null
})

onBeforeUnmount(() => {
  if (teardown) teardown()
  teardown = null
})
</script>

<template>
  <div class="face-tool">
    <div id="stage">
      <canvas
        id="crop"
        class="crop"
        hidden
      />
      <canvas id="overlay" />
    </div>

    <div id="topbar">
      <button
        id="btnExit"
        class="iconbtn"
        title="Close"
        hidden
        aria-label="Close"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
        ><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
      <button
        id="btnFlip"
        class="iconbtn"
        title="Switch camera"
        hidden
        aria-label="Switch camera"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3 9V5a2 2 0 0 1 2-2h9l-2.5-2M21 15v4a2 2 0 0 1-2 2H10l2.5 2" />
          <path d="M21 9a9 9 0 0 0-15.5-6.4M3 15a9 9 0 0 0 15.5 6.4" />
        </svg>
      </button>
    </div>

    <div id="bottombar">
      <div
        id="card"
        hidden
      >
        <div
          id="cardWho"
          class="who"
        >
&nbsp;
        </div>
        <div
          id="cardMeta"
          class="meta"
        >
&nbsp;
        </div>
        <div
          id="cardRows"
          class="rows"
        />
      </div>
      <button
        id="shutter"
        title="Save photo"
        hidden
        aria-label="Save photo"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
      </button>
    </div>

    <div id="zoomBadge" />

    <div id="perf" />

    <div id="intro">
      <h1>Face Recognition</h1>
      <p class="sub">
        Take or pick a photo to identify a student.
      </p>
      <button
        id="choiceUpload"
        class="choice primary"
        aria-disabled="true"
      >
        <span class="ico"><svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
        ><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3" /></svg></span>
        Upload Image
      </button>
      <button
        id="choiceCamera"
        class="choice"
        aria-disabled="true"
      >
        <span class="ico"><svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
        ><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2a1 1 0 0 0 .83-.45l.94-1.4A1 1 0 0 1 9.3 3.7h5.4a1 1 0 0 1 .83.45l.94 1.4A1 1 0 0 0 17.3 6h1.2A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" /><circle
          cx="12"
          cy="12.3"
          r="3.6"
        /></svg></span>
        Open Camera
      </button>
      <input
        id="file"
        type="file"
        accept="image/*"
        hidden
      >
      <div id="status">
        <span class="spinner" />Loading recognition models…
      </div>
    </div>
  </div>
</template>

<style>
/* 原静态页的样式，逐条挂到 .face-tool 下：这个工具是整屏独占的，
   但站点里其它页面也共用同一份 CSS 打包，所以不能把 body / * / [hidden]
   直接写成全局规则。 */
.face-tool{
  --ink:#0f172a; --sub:#64748b; --line:#e2e8f0;
  --ok:#10b981; --bad:#ef4444; --accent:#2563eb;
  --safe-t: env(safe-area-inset-top, 0px);
  --safe-b: env(safe-area-inset-bottom, 0px);
  --safe-l: env(safe-area-inset-left, 0px);
  --safe-r: env(safe-area-inset-right, 0px);
  position:fixed; inset:0; overflow:hidden; overscroll-behavior:none;
  font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  color:var(--ink); background:#000;
  -webkit-user-select:none; user-select:none;
}
.face-tool *, .face-tool *::before, .face-tool *::after{ box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
.face-tool [hidden]{ display:none !important; }

/* ---------- full-bleed stage ---------- */
.face-tool #stage{ position:fixed; inset:0; background:#000; overflow:hidden; touch-action:none; }
/* contain：完整画面都留在屏内、不裁切（原来的 cover 会把画面裁切放大，横屏设备尤其明显）。
   双指缩放由 JS 写 transform，用的是和识别框同一套 viewTransform，保证放大后框仍贴着脸。 */
.face-tool #stage img, .face-tool #stage video{
  position:absolute; inset:0; width:100%; height:100%;
  object-fit:contain; object-position:center; display:block;
}
.face-tool #stage video.mirror, .face-tool #stage canvas.crop.mirror{ transform:scaleX(-1); }
/* 数字变焦时的裁剪画布：既是显示（contain 铺满，与 viewTransform 的映射一致），也是模型输入 */
.face-tool #stage canvas.crop{
  position:absolute; inset:0; width:100%; height:100%;
  object-fit:contain; object-position:center; display:block;
}
.face-tool #overlay{ position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }

/* ---------- top controls ---------- */
.face-tool #topbar{
  position:fixed; z-index:20; display:flex; justify-content:space-between; align-items:center;
  top:calc(var(--safe-t) + 10px); left:calc(var(--safe-l) + 12px); right:calc(var(--safe-r) + 12px);
  pointer-events:none;
}
.face-tool .iconbtn{
  pointer-events:auto; width:40px; height:40px; border-radius:50%; border:0; padding:0;
  display:grid; place-items:center; cursor:pointer;
  background:rgba(15,23,42,.45); color:#fff; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
  transition:opacity .15s, transform .1s;
}
.face-tool .iconbtn:active{ transform:scale(.92); }
.face-tool .iconbtn svg{ width:19px; height:19px; display:block; }
.face-tool .iconbtn[hidden]{ display:none; }

/* ---------- bottom bar: result card + shutter ---------- */
.face-tool #bottombar{
  position:fixed; z-index:20; display:flex; align-items:flex-end; gap:10px;
  left:calc(var(--safe-l) + 12px); right:calc(var(--safe-r) + 12px); bottom:calc(var(--safe-b) + 14px);
  pointer-events:none;
}
.face-tool #card{
  flex:1; min-width:0; max-width:560px; pointer-events:auto;
  background:rgba(255,255,255,.94); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
  border-radius:14px; padding:12px 14px; box-shadow:0 6px 24px rgba(0,0,0,.22);
  border-left:4px solid var(--sub); transition:border-color .15s;
}
.face-tool #card.hit{ border-left-color:var(--ok); }
.face-tool #card.miss{ border-left-color:var(--bad); }
.face-tool #card .who{ font-size:19px; font-weight:650; letter-spacing:-.01em; word-break:break-word; }
.face-tool #card .who .pref{ font-weight:400; color:var(--sub); }
.face-tool #card .meta{ font-size:12.5px; color:var(--sub); margin-top:3px; font-variant-numeric:tabular-nums; }
.face-tool #card .rows{ display:grid; grid-template-columns:auto 1fr; gap:1px 10px; font-size:12.5px; margin-top:8px; }
.face-tool #card .rows b{ color:var(--sub); font-weight:400; white-space:nowrap; }
.face-tool #card .rows span{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.face-tool #shutter{
  pointer-events:auto; flex:0 0 auto; width:56px; height:56px; border-radius:50%; border:0; cursor:pointer;
  background:var(--accent); color:#fff; display:grid; place-items:center;
  box-shadow:0 6px 20px rgba(37,99,235,.45); transition:transform .1s, opacity .15s;
}
.face-tool #shutter:active{ transform:scale(.9); }
.face-tool #shutter svg{ width:24px; height:24px; }
.face-tool #shutter[hidden]{ display:none; }

/* ---------- pinch zoom badge ---------- */
.face-tool #zoomBadge{
  position:fixed; z-index:25; left:50%; transform:translateX(-50%);
  bottom:calc(var(--safe-b) + 84px);
  padding:5px 11px; border-radius:999px;
  background:rgba(15,23,42,.62); color:#fff;
  font-size:12.5px; font-weight:600; font-variant-numeric:tabular-nums;
  backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
  opacity:0; transition:opacity .18s; pointer-events:none;
}
.face-tool #zoomBadge.show{ opacity:1; }

/* ---------- per-frame inference time ---------- */
.face-tool #perf{
  position:fixed; z-index:24; left:calc(var(--safe-l) + 12px);
  bottom:calc(var(--safe-b) + 84px);
  padding:4px 10px; border-radius:999px;
  background:rgba(15,23,42,.55); color:#fff;
  font-size:11.5px; font-weight:600; font-variant-numeric:tabular-nums;
  backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
  white-space:nowrap; pointer-events:none;
  opacity:0; transition:opacity .2s;
}
.face-tool #perf.show{ opacity:1; }

/* ---------- 桌面端（鼠标）适配 ---------- */
/* 非移动端也能用：没有双指，滚轮就是缩放；hover 态让按钮看得出可点 */
@media (hover: hover){
  .face-tool #stage{ cursor:zoom-in; }
  .face-tool .iconbtn:hover{ background:rgba(15,23,42,.62); }
  .face-tool .choice:hover{ border-color:var(--accent); background:#f8fafc; }
  .face-tool .choice.primary:hover{ background:#1d4ed8; border-color:#1d4ed8; }
  .face-tool #shutter:hover{ background:#1d4ed8; }
}

/* ---------- intro ---------- */
.face-tool #intro{
  position:fixed; inset:0; z-index:40; background:#fff;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px;
  padding:calc(var(--safe-t) + 28px) 26px calc(var(--safe-b) + 28px);
  transition:opacity .22s ease, visibility .22s;
}
.face-tool #intro.hide{ opacity:0; visibility:hidden; }
.face-tool #intro h1{ margin:0 0 6px; font-size:23px; font-weight:680; letter-spacing:-.02em; text-align:center; }
.face-tool #intro p.sub{ margin:0 0 18px; color:var(--sub); font-size:13.5px; text-align:center; max-width:30ch; }
.face-tool .choice{
  width:min(340px,100%); display:flex; align-items:center; gap:14px; padding:17px 20px;
  border-radius:16px; border:1px solid var(--line); background:#fff; cursor:pointer;
  font-size:16.5px; font-weight:560; color:var(--ink); text-align:left;
  transition:transform .1s, border-color .15s, background .15s;
}
.face-tool .choice:active{ transform:scale(.975); background:#f8fafc; }
.face-tool .choice .ico{ width:26px; height:26px; flex:0 0 auto; color:var(--accent); }
.face-tool .choice .ico svg{ width:100%; height:100%; }
.face-tool .choice.primary{ background:var(--accent); border-color:var(--accent); color:#fff; }
.face-tool .choice.primary .ico{ color:#fff; }
.face-tool .choice[aria-disabled=true]{ opacity:.45; pointer-events:none; }
.face-tool #status{ margin-top:20px; font-size:12.5px; color:var(--sub); text-align:center; }
.face-tool #status:empty{ display:none; }
.face-tool #status.err{ color:var(--bad); }
.face-tool .spinner{
  width:13px; height:13px; margin-right:7px; display:inline-block; vertical-align:-2px;
  border:2px solid var(--line); border-top-color:var(--accent); border-radius:50%;
  animation:face-tool-spin .7s linear infinite;
}
@keyframes face-tool-spin{ to{ transform:rotate(360deg); } }
</style>
