<script setup lang="ts">
import '~/program-world/css/base.css'
import '~/program-world/css/layout.css'
import '~/program-world/css/execution.css'
import '~/program-world/css/stage.css'
import '~/program-world/css/combat.css'

definePageMeta({ layout: 'bare' })

const { t } = useI18n()

useSeoMeta({
  title: () => `${t('nav.ide')} · ${t('site.title')}`,
  description: () => t('nav.ide')
})

/* Monaco ships its own stylesheet; the rest of the app's CSS is imported above
   and namespaced under .program-world by construction. */
useHead({
  link: [{ rel: 'stylesheet', href: '/model/vendor/monaco/min/vs/editor/editor.main.css' }]
})

/* The app is a small imperative island: dom.js caches element references and
   editor.js/python.js touch `window` and `document.baseURI` while loading, so
   each module is imported after mount — never during SSR — and the boot /
   teardown pair brackets the page's lifetime. */
const root = ref<HTMLElement | null>(null)
let stop: (() => void) | null = null

onMounted(async () => {
  const app = await import('~/program-world/app.js')
  stop = app.teardown
  app.boot(root.value)
})

onBeforeUnmount(() => {
  if (stop) stop()
  stop = null
})
</script>

<template>
  <div ref="root" class="program-world">
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <h1>Program World</h1>
          <span class="tag">PYTHON EXECUTION · CHARACTER EDITION</span>
        </div>
        <span id="status" class="status"><span class="dot" /><span id="statusText">Runtime not loaded</span></span>
        <div class="spacer" />
        <button id="btnRun" class="btn primary">Run</button>
        <button id="btnGame" class="btn" title="Run the entry file as a real pygame game on the main thread, in the panel on the right">Run game</button>
        <button id="btnStep" class="btn" disabled>Step</button>
        <button id="btnPlay" class="btn" disabled>Play</button>
        <button id="btnSound" class="btn ghost" title="Toggle sound">Sound off</button>
        <button id="btnReset" class="btn ghost" disabled>Clear</button>
        <NuxtLink class="btn ghost" to="/ide/play" title="Open the game page: same project, one full window, nothing else">Game page</NuxtLink>
      </header>

      <main id="main">
        <section class="pane left">
          <div class="pane-head">
            <span id="fname" class="file">main.py</span>
            <span class="title">Python project</span>
            <div class="spacer" />
            <span id="draftState" class="draft-state" />
            <select id="examplePick" class="pick" title="Load a ready-made example project (replaces the files you have now)">
              <option value="">Examples&hellip;</option>
            </select>
            <button id="btnShare" class="btn ghost" style="padding:4px 10px;font-size:12px" title="Copy a link containing every file">Share link</button>
          </div>
          <div class="files-bar">
            <button id="btnTree" class="btn ghost sm" aria-expanded="true" title="Show or hide the file list">Files</button>
            <button id="btnNewFile" class="btn ghost sm" title="New file">+ New</button>
            <button id="btnRenameFile" class="btn ghost sm" title="Rename the open file">Rename</button>
            <button id="btnDeleteFile" class="btn ghost sm" title="Delete the open file">Delete</button>
            <button id="btnUpload" class="btn ghost sm" title="Import files from your computer (for example a .txt to read)">Import</button>
            <button id="btnDownload" class="btn ghost sm" title="Save the open file to your computer">Download</button>
            <button id="btnDownloadAll" class="btn ghost sm" title="Save every file as one .zip">Download all</button>
            <input id="fileInput" type="file" multiple hidden>
            <span id="fileCount" class="count" />
          </div>
          <div id="editorBody" class="editor-body">
            <aside id="fileTree" class="file-tree" />
            <div id="editor" />
            <div id="viewer" class="viewer">
              <img id="viewerImg" alt="">
              <div id="viewerMsg" class="viewer-msg" />
              <div id="viewerMeta" class="viewer-meta" />
            </div>
          </div>

          <div id="hsplit" class="hsplit" title="Drag to resize · double-click to expand/collapse" />

          <div id="drawer" class="drawer">
            <button id="drawerHead" class="drawer-head" aria-expanded="false">
              <span class="chev">&#9654;</span>
              <span class="dtitle">Execution</span>
              <span id="drawerMeta" class="dmeta">step 0 / 0</span>
              <span class="dhint">click to expand &mdash; variables, call stack, output</span>
            </button>
            <div id="drawerBody" class="drawer-body">
              <div class="card now wide">
                <div class="card-head">Now executing <span id="nowFile" class="now-file" /></div>
                <div class="card-body">
                  <div class="line"><span id="nowLn" class="ln">&ndash;</span><code id="nowCode">Press Run to trace this program.</code></div>
                  <div id="nowMeta" class="meta" />
                </div>
              </div>
              <div class="card">
                <div class="card-head">Variables <span id="varCount" class="count" /></div>
                <div class="card-body"><div id="vars" class="vars" /></div>
              </div>
              <div class="card">
                <div class="card-head">Call stack</div>
                <div class="card-body"><div id="frames" class="frames" /></div>
              </div>
              <div class="card wide">
                <div class="card-head">Standard output</div>
                <pre id="stdout" class="out" />
                <div id="errBox" />
              </div>
              <div id="stale" class="stale">Code changed since the last run &mdash; press <b>Run</b> to re-trace.</div>
            </div>
          </div>
        </section>

        <div id="splitter" class="splitter" title="Drag to resize · double-click to reset" />

        <section class="pane">
          <div class="stage-bar">
            <div class="transport">
              <button id="btnFirst" class="btn ghost" style="padding:5px 10px" title="First step">&#8676;</button>
              <button id="btnPrev" class="btn ghost" style="padding:5px 10px" title="Previous step">&#9664;</button>
              <input id="scrub" type="range" min="0" max="0" value="0" disabled title="Scrub through steps">
              <button id="btnNext" class="btn ghost" style="padding:5px 10px" title="Next step">&#9654;</button>
              <button id="btnLast" class="btn ghost" style="padding:5px 10px" title="Last step">&#8677;</button>
              <select id="speed" title="Playback speed">
                <option value="900">0.5&times;</option>
                <option value="450" selected>1&times;</option>
                <option value="220">2&times;</option>
                <option value="90">5&times;</option>
              </select>
            </div>
          </div>
          <div class="stage-head">
            <span class="title">Program World</span>
            <span id="stepPill" class="pill muted">step 0 / 0</span>
            <span id="framePill" class="pill blue">no frame</span>
          </div>
          <div id="timeline" class="timeline" />
          <div class="stage-wrap">
            <div id="stage" class="stage">
              <div id="world" class="world">
                <div id="wtop" class="wtop" />
                <div id="arena" class="arena" />
                <div id="outSlot" />
                <div id="worldIdle" class="world-idle">
                  <div class="big">🤖 ⚔️ 👹</div>
                  <div>Press <code>Run</code> and watch your variables come alive.</div>
                </div>
              </div>
              <div id="vsLayer" class="vs-layer" />
              <div id="eventBanner" class="event-banner">
                <span id="ebKind" class="eb-kind">Ready</span>
                <span id="ebText" class="eb-text">Press Run to trace this program.</span>
              </div>
              <div id="gameView" class="game-view">
                <div class="game-bar">
                  <button id="btnGameStop" class="btn sm" disabled title="Stops at the end of the current frame">Stop</button>
                  <button id="btnGameExit" class="btn ghost sm">Back to stage</button>
                  <span id="gameMsg" class="game-msg" />
                </div>
                <div class="game-screen">
                  <canvas id="gameCanvas" width="480" height="360" tabindex="0" />
                </div>
                <pre id="gameOut" class="game-out" />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>

    <div id="viewModal" class="modal">
      <div class="modal-box">
        <div class="modal-head">
          <span id="viewTitle" class="mtitle">Output</span>
          <span id="viewTabs" class="mtabs" />
          <span class="spacer" />
          <span id="viewCount" class="mcount" />
          <input id="viewScrub" type="range" min="0" max="0" value="0" title="Scrub through the drawing">
          <button id="viewPlay" class="btn ghost sm">Play</button>
          <button id="viewClose" class="btn ghost sm" title="Close (Esc)">Close</button>
        </div>
        <div id="viewBody" class="modal-body" />
      </div>
    </div>
  </div>
</template>
