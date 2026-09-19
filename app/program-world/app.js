/* @deps: analysis.js, clipboard.js, config.js, dom.js, editor.js, files.js, gamerun.js, io.js, layout.js, panels.js, project.js, prompt.js, python.js, render.js, sound.js, state.js, url-code.js, views.js */
import { buildTimeline } from './analysis.js'
import { copyToClipboard } from './clipboard.js'
import { EXAMPLES, PY_TRACE, exampleById } from './config.js'
import { $, arenaEl, bindDom, btnFirst, btnGame, btnGameExit, btnGameFull, btnGameStop, btnLast, btnNext, btnPlay, btnPrev, btnReset, btnRun, btnShare, btnSound, btnTerm, errBox, esc, examplePick, gameCanvas, gameMsg, gameOut, nowCode, on, scrub, setStatus, speedSel, stageEl, staleEl, timelineEl, draftStateEl, unbindAll } from './dom.js'
import { destroyEditor, dropModel, fileText, hasModel, highlight, loadMonaco, renameModel, setFileContent, setFiles, showFile } from './editor.js'
import { initFiles, renderFiles } from './files.js'
import { startGame, stopGame } from './gamerun.js'
import { initLayout } from './layout.js'
import { awaitLine, beginAttempt, beginSession, clearIo, closeTerminal, finishSession, initIo, openTerminal, stdinText } from './io.js'
import { initPanels, showPanel } from './panels.js'
import { initPrompt } from './prompt.js'
import { initViews, openViews } from './views.js'
import { loadPython, releasePython, runTrace, setOutputHandler, setViewHandler } from './python.js'
import { cancelCombat, renderDetails, renderStage, renderTimeline, showHoverLine } from './render.js'
import { beep, toggleSound } from './sound.js'
import { cur, deco, error, limit, resetTrace, running, setCur, setRunning, setStale, stale, steps } from './state.js'
import { flagFromSearch, projectFromSearch, shareUrlForProject } from './url-code.js'
import { ENTRY, activeFile as projActive, fileByName, isBinaryName, isImageName, isPristine, makeBinFile, makeFile, mimeOf, project, projectFromExample, readProject, setActiveFile, setProject, writeProject } from './project.js'

/* ------------------------------- controls --------------------------- */
let playing = false
let playTimer = null

/* The game view is the one place where Python runs on the main thread, so the
   tracer's worker is parked for the duration and the page only answers between
   frames.  `gameBusy` is what keeps the rest of the UI out of the way. */
let gameBusy = false
let leaveAfterGame = false

/* Writing to the editor programmatically also fires its change event; the
   autosave and the "code changed" marker have to ignore those. */
let applyingCode = false
let draftTimer = null

/* Elements read only here are bound on boot, like the shared ones in dom.js. */
let nowFileEl = null
let editorBodyEl = null
let gameViewEl = null
let fnameEl = null
let viewerEl = null
let viewerImg = null
let viewerMsg = null
let viewerMeta = null
let viewerUrl = null

function syncButtons() {
  const ready = steps.length > 0 && !stale
  const canMove = ready && cur >= 0
  /* While a game owns the main thread the page only gets a turn between its
     frames, so every control that would start another job is parked. */
  btnRun.disabled = gameBusy
  btnPlay.disabled = !ready || gameBusy
  btnReset.disabled = steps.length === 0 || gameBusy
  scrub.disabled = steps.length === 0 || gameBusy
  btnFirst.disabled = !canMove || gameBusy
  btnPrev.disabled = !canMove || gameBusy
  btnNext.disabled = !canMove || gameBusy
  btnLast.disabled = !canMove || gameBusy
  if (btnGame) btnGame.disabled = gameBusy || running
  if (btnGameStop) btnGameStop.disabled = !gameBusy
}

function goto(i, prevIdx, motion) {
  if (!steps.length) return
  const clamped = Math.max(0, Math.min(steps.length - 1, i))
  const prev = prevIdx === undefined ? cur : prevIdx
  setCur(clamped)
  const s = steps[clamped]
  if (s && s.F) showFile(s.F)
  highlight(s ? s.l : 0)
  if (nowFileEl) nowFileEl.textContent = s && s.F ? s.F + ' : ' + s.l : ''
  renderStage(clamped, prev, motion)
  renderDetails(clamped)
  syncButtons()
}

function stopPlay() {
  playing = false
  if (playTimer) { clearInterval(playTimer); playTimer = null }
  btnPlay.textContent = 'Play'
}

/* Leaving the game view (or the page) must not leave the tab fullscreen. */
function leaveFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
}

function startPlay() {
  if (!steps.length || stale) return
  if (cur >= steps.length - 1) setCur(-1)
  playing = true
  btnPlay.textContent = 'Pause'
  const tick = () => {
    if (!playing) return
    if (cur >= steps.length - 1) { stopPlay(); return }
    goto(cur + 1)
  }
  playTimer = setInterval(tick, Number(speedSel.value) || 450)
  tick()
}

/* A pygame game belongs in the game view, and the tracer's failure says nothing
   about why: it runs a file with a plain exec, so there is no event loop (a
   top-level `await asyncio.sleep(...)` reads as "SyntaxError: 'await' outside
   function") and no browser canvas (pygame's SDL dies the moment it is
   imported, as "screen is not defined").  Both look like bugs in the code. */
function isPygameSource() {
  const f = fileByName(entryName())
  return !!f && /(^|\n)\s*(import|from)\s+pygame\b/.test(String(f.content || ''))
}

function gameHint() {
  if (!isPygameSource()) return
  errBox.innerHTML += '<div class="err"><div class="etitle">This one belongs in Run game</div>'
    + '<pre>Tracing runs your file with a plain exec, so there is no event loop for a top-level '
    + 'await, and no browser canvas for pygame\'s SDL to grab.\n\n'
    + 'Press Run game: the same file, on the main thread, with an event loop and a real canvas, '
    + 'in the panel on the right.</pre></div>'
}

/* A program that asks for input in an endless loop must not run forever: the
   interactive terminal stops after this many answered lines. */
const TERMINAL_INPUT_LIMIT = 200

export async function runCode(opts) {
  const interactive = !!(opts && opts.interactive)
  if (running || gameBusy) return
  /* Run belongs to the boxes under the editor; only Run terminal uses the
     terminal, so a plain run always comes back to the inline surface. */
  if (!interactive) closeTerminal()
  setRunning(true)
  stopPlay()
  btnRun.disabled = true
  btnRun.textContent = 'Running...'
  setStale(false)
  staleEl.classList.remove('show')
  beginSession()

  try {
    const py = await loadPython()
    setStatus('busy', 'Tracing program...')
    await new Promise(r => requestAnimationFrame(() => r()))

    syncProjectFromEditor()
    const target = { files: project.files, entry: entryName() }
    /* A plain run feeds the input box's lines and stops at EOF.  The interactive
       terminal starts empty and grows: the worker stops at the missing line, the
       reader types it, and the program re-runs with the longer buffer — the
       output already on screen is skipped by character count (see io.js). */
    let stdin = interactive ? '' : stdinText()
    let answers = 0
    let data
    for (;;) {
      data = await runTrace(target, PY_TRACE, undefined, stdin, interactive)
      if (!interactive || !data || !data.needsInput) break
      if (answers >= TERMINAL_INPUT_LIMIT) {
        setStatus('error', 'Too many input() calls')
        finishSession('stopped: more than ' + TERMINAL_INPUT_LIMIT + ' input() lines')
        return
      }
      setStatus('busy', 'Waiting for input\u2026')
      const line = await awaitLine(data.needsInput.prompt)
      if (line === null) {
        /* the reader shut the terminal: stop here, keep what was printed */
        setStatus('ready', 'Stopped')
        return
      }
      answers++
      stdin += line + '\n'
      beginAttempt()
      setStatus('busy', 'Tracing program...')
    }

    buildTimeline(data)
    renderTimeline()
    if (!steps.length) {
      renderStage(-1, -1)
      renderDetails(-1)
      nowCode.textContent = 'Program contains nothing to trace.'
      if (error) errBox.innerHTML = '<div class="err"><div class="etitle">' + esc(error.type) + ': ' + esc(error.msg)
        + '</div><pre>' + esc(error.tb) + '</pre></div>'
    } else {
      goto(0, -1)
    }
    /* pygame cannot come up in a worker (SDL wants a real canvas) and the
       error it leaves behind says nothing about that.  Say it here, and point
       at the one place where it does work. */
    if (error) gameHint()
    setStatus(error ? 'error' : 'ready',
      error
        ? 'Finished with ' + error.type
        : limit
          ? (limit.kind === 'steps'
              ? 'Stopped at the ' + limit.steps + '-step demo limit'
              : 'Stopped after ' + limit.seconds + 's')
          : 'Python ' + (py.python || py.api) + ' ready')
    finishSession(error ? error.type + ': ' + error.msg : null)
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    let told = msg
    if (msg.indexOf('packages:') === 0) {
      setStatus('error', 'Package load timed out')
      errBox.innerHTML = '<div class="err"><div class="etitle">Package load timed out</div>'
        + '<pre>A package this program imports took too long to load.\n'
        + 'Only the packages installed on this server load without the internet.</pre></div>'
      told = 'A package this program imports took too long to load, so the run was stopped.'
    } else if (msg.indexOf('timeout:') === 0) {
      const secs = msg.split(':')[1]
      setStatus('error', 'Stopped after ' + secs + 's')
      errBox.innerHTML = '<div class="err"><div class="etitle">Stopped after ' + esc(secs) + 's</div>'
        + '<pre>The program was still running when the time budget ran out, so the runtime was '
        + 'restarted to keep the page usable.</pre></div>'
      told = 'Stopped after ' + secs + 's \u2014 the program was still running when the time budget ran out.'
    } else {
      setStatus('error', 'Trace failed')
      errBox.innerHTML = '<div class="err"><div class="etitle">Trace failed</div><pre>' + esc(msg) + '</pre></div>'
      /* an import that dies inside SDL arrives out here, not as a traced error */
      gameHint()
    }
    /* nothing was traced, so there is no output to show — only the failure */
    finishSession(told)
    showPanel('exec')
  } finally {
    setRunning(false)
    btnRun.disabled = false
    btnRun.textContent = 'Run'
    syncButtons()
  }
}

/* The editor reports an edit; what that means is the app's business. */
/* ------------------------------ draft saving ------------------------ */
let linkUntouched = false

function draftStamp(at) { return new Date(at || Date.now()).toTimeString().slice(0, 5) }

function showDraftState(from, at) {
  if (!draftStateEl) return
  draftStateEl.classList.remove('dirty')
  if (from === 'link') draftStateEl.textContent = 'shared link'
  else if (from === 'draft') draftStateEl.textContent = 'draft \u00b7 ' + draftStamp(at)
  else draftStateEl.textContent = 'sample'
}

function markStale() {
  setStale(true)
  staleEl.classList.add('show')
  stopPlay()
  syncButtons()
}

function queueSave() {
  if (draftStateEl) { draftStateEl.textContent = 'saving'; draftStateEl.classList.add('dirty') }
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(saveNow, 400)
}

async function saveNow() {
  if (draftTimer) { clearTimeout(draftTimer); draftTimer = null }
  /* opening someone else's link must not overwrite your own project */
  if (linkUntouched) { showDraftState('link'); return }
  if (!await writeProject(project)) {
    if (draftStateEl) { draftStateEl.textContent = 'too big to save'; draftStateEl.classList.add('dirty') }
    return
  }
  showDraftState(isPristine(project) ? 'sample' : 'draft', Date.now())
}

/* The editor holds models, and a model belongs to a named file — which is not
   necessarily the *active* file: opening an image shows the preview while the
   editor still holds whatever text file it had.  So text is copied back by
   model name, never by "active". */
function syncProjectFromEditor() {
  if (!project) return
  project.files.forEach(function (f) {
    if (f.kind === 'text' && hasModel(f.name)) f.content = fileText(f.name)
  })
}

/* the editor reports an edit; the app decides what that means */
function onEditorChange() {
  if (applyingCode) return
  linkUntouched = false
  syncProjectFromEditor()
  queueSave()
  if (steps.length) markStale()
}

/* ------------------------------ project files ----------------------- */
function applyProject(p) {
  setProject(p)
  setFiles(p.files, p.active)
  const f = projActive()
  if (f && f.kind === 'bin') showViewer(f)
  renderFiles()
}

/* The project directory mirrors the tree: whatever the program wrote shows up. */
/* The run drew something: show it, the way a program pops up its own window. */
setViewHandler(function (list) {
  openViews(list)
})

setOutputHandler(function (produced) {
  let added = 0
  let changed = 0
  produced.forEach(function (p) {
    const bytes = p.bytes instanceof Uint8Array ? p.bytes : new Uint8Array(p.bytes || [])
    const bin = isBinaryName(p.name)
    const existing = fileByName(p.name)
    if (!existing) {
      project.files.push(bin ? makeBinFile(p.name, bytes) : makeFile(p.name, new TextDecoder().decode(bytes)))
      added++
      return
    }
    if (existing.kind === 'bin') { existing.bytes = bytes } else {
      existing.content = new TextDecoder().decode(bytes)
      setFileContent(p.name, existing.content)
    }
    changed++
  })
  if (!added && !changed) return
  setFiles(project.files, project.active)
  const open = projActive()
  if (open && open.kind === 'bin') showViewer(open)
  renderFiles()
  queueSave()
  if (draftStateEl) {
    draftStateEl.textContent = added ? 'wrote ' + added + ' file' + (added > 1 ? 's' : '') : 'updated ' + changed
    draftStateEl.classList.add('dirty')
    setTimeout(() => { draftStateEl.classList.remove('dirty') }, 2600)
  }
})

/* An image has no editor model: it gets a preview instead. */
function showViewer(f) {
  const image = isImageName(f.name)
  if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null }
  if (image && f.bytes) {
    viewerUrl = URL.createObjectURL(new Blob([f.bytes], { type: mimeOf(f.name) }))
    viewerImg.src = viewerUrl
    viewerImg.onload = function () {
      const kb = Math.max(1, Math.round(f.bytes.length / 1024))
      viewerMeta.textContent = f.name + ' \u00b7 ' + viewerImg.naturalWidth + '\u00d7' + viewerImg.naturalHeight + ' \u00b7 ' + kb + ' KB'
    }
  } else {
    viewerImg.removeAttribute('src')
    viewerMsg.textContent = 'No preview for ' + (f.name.split('.').pop() || 'this') + ' files \u2014 a program can still read it.'
    viewerMeta.textContent = f.name + ' \u00b7 ' + (f.bytes ? f.bytes.length : 0) + ' bytes'
  }
  viewerEl.classList.toggle('noimg', !image)
  editorBodyEl.classList.add('viewing')
  if (fnameEl) fnameEl.textContent = f.name
}

function hideViewer() {
  if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null }
  viewerImg.removeAttribute('src')
  editorBodyEl.classList.remove('viewing')
}

function openFile(name) {
  const f = fileByName(name)
  if (!f) return
  setActiveFile(name)
  if (f.kind === 'bin') showViewer(f)
  else { hideViewer(); showFile(name) }
  renderFiles()
  queueSave()
}

function addFile(file, opts) {
  project.files.push(file)
  setFiles(project.files, project.active)
  if (opts && opts.open) openFile(file.name); else renderFiles()
  if (steps.length) markStale()
  queueSave()
}

function renameOpenFile(from, to) {
  const f = fileByName(from)
  if (!f) return
  if (f.kind === 'text') renameModel(from, to)
  f.name = to
  if (project.active === from) project.active = to
  setFiles(project.files, project.active)
  renderFiles()
  if (steps.length) markStale()
  queueSave()
}

function deleteOpenFile(name) {
  const i = project.files.map(f => f.name).indexOf(name)
  if (i < 0) return
  project.files.splice(i, 1)
  const next = project.files[Math.min(i, project.files.length - 1)]
  dropModel(name) // a no-op for files with no model
  if (project.active === name) project.active = next ? next.name : null
  setFiles(project.files, project.active)
  renderFiles()
  if (steps.length) markStale()
  queueSave()
}

/* main.py is the entry; a link may name another entry instead */
function entryName() {
  if (!project) return ENTRY
  if (fileByName(ENTRY)) return ENTRY
  const py = project.files.filter(f => /\.pyw?$/i.test(f.name))
  return (py[0] || project.files[0] || { name: ENTRY }).name
}

/* Clear means "forget the last trace": the stage, the decorations, the error
   banner and the transport all go back to their idle state. */
function clearTrace() {
  stopPlay()
  resetTrace()
  setCur(-1)
  setStale(false)
  staleEl.classList.remove('show')
  if (deco) deco.set([])
  if (errBox) errBox.innerHTML = ''
  clearIo()
  cancelCombat()
  renderStage(-1, -1)
  renderDetails(-1)
  syncButtons()
}

/* Leaving the page is the mirror of boot(): the DOM goes away with the page,
   so only what outlives the DOM has to be undone — the document/window
   listeners, the Python worker and the Monaco instance. */
export function teardown() {
  stopPlay()
  leaveFullscreen()
  if (draftTimer) { clearTimeout(draftTimer); draftTimer = null }
  if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null }
  closeTerminal()
  clearTrace()
  unbindAll()
  releasePython()
  destroyEditor()
  gameBusy = false
  leaveAfterGame = false
}

/* Everything the app wires up at start-up lives here.  Importing this module
   only defines things; nothing runs until boot(el) is called by the page. */
export function boot(el) {
  bindDom(el || document.querySelector('.program-world'))
  nowFileEl = $('nowFile')
  editorBodyEl = $('editorBody')
  gameViewEl = $('gameView')
  fnameEl = $('fname')
  viewerEl = $('viewer')
  viewerImg = $('viewerImg')
  viewerMsg = $('viewerMsg')
  viewerMeta = $('viewerMeta')
  initLayout()
  initPanels()
  initIo()
  initPrompt()
  btnPlay.addEventListener('click', () => { if (playing) stopPlay(); else startPlay() })
  btnFirst.addEventListener('click', () => { stopPlay(); goto(0) })
  btnPrev.addEventListener('click', () => { stopPlay(); goto(cur - 1) })
  btnNext.addEventListener('click', () => { stopPlay(); goto(cur + 1) })
  btnLast.addEventListener('click', () => { stopPlay(); goto(steps.length - 1) })
  scrub.addEventListener('input', () => { stopPlay(); goto(Number(scrub.value), undefined, 'instant') })
  timelineEl.addEventListener('click', (e) => {
    if (!steps.length) return
    const r = timelineEl.getBoundingClientRect()
    if (!r.width) return
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    stopPlay()
    goto(Math.round(ratio * (steps.length - 1)), undefined, 'instant')
  })
  arenaEl.addEventListener('mouseover', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('.actor') : null
    if (!el) return
    showHoverLine(Number(el.getAttribute('data-line')) || 0)
  })
  arenaEl.addEventListener('mouseout', (e) => {
    const to = e.relatedTarget
    if (to && arenaEl.contains(to)) return
    showHoverLine(0)
  })
  speedSel.addEventListener('change', () => { if (playing) { stopPlay(); startPlay() } })

  btnSound.addEventListener('click', () => {
    const on = toggleSound()
    btnSound.textContent = on ? 'Sound on' : 'Sound off'
    if (on) beep('change')
  })

  btnShare.addEventListener('click', () => {
    const url = shareUrlForProject(location.origin + location.pathname, project, true)
    if (url.length > 16000) {
      window.prompt('This project makes a ' + url.length + '-character link, which some servers reject. Copy it carefully:', url)
      return
    }
    const done = () => {
      btnShare.textContent = 'Copied \u2713'
      setTimeout(() => { btnShare.textContent = 'Share link' }, 1600)
    }
    copyToClipboard(url, done, () => window.prompt('Copy this link:', url))
  })

  /* ------------------------------ examples ---------------------------- */
  function loadExample(id) {
    const ex = exampleById(id)
    if (!ex) return
    linkUntouched = false
    applyProject(projectFromExample(ex))
    /* the previous program's characters must not sit there looking like this
     project's output */
    clearTrace()
    /* Unlike the old "Sample" button this does not drop the store: the example is
     now what you are working on, and a reload should not silently revert it.
     The first example *is* the sample, so isPristine still clears that one, and
     the readout then says "sample" or "draft" on its own. */
    writeProject(project)
  }

  /* The picker is a menu, not a state: it goes back to its label once a project
   has been loaded, so the same example can be chosen twice in a row. */
  if (examplePick) {
    EXAMPLES.forEach(function (ex) {
      const o = document.createElement('option')
      o.value = ex.id
      o.textContent = ex.name
      examplePick.appendChild(o)
    })
    examplePick.addEventListener('change', function () {
      const id = examplePick.value
      examplePick.selectedIndex = 0
      loadExample(id)
    })
  }

  /* Clear means "forget the last trace": the stage, the decorations, the error
   banner and the transport all go back to their idle state. */

  btnReset.addEventListener('click', clearTrace)

  /* --------------------------------- run ------------------------------ */

  btnRun.addEventListener('click', runCode)

  /* The same project, run inside a terminal window: input() is answered on the
     terminal's own line, the way a real session works, and the whole output
     stays in one scrollback. */
  if (btnTerm) {
    btnTerm.addEventListener('click', () => {
      if (running || gameBusy) return
      openTerminal(entryName())
      runCode({ interactive: true })
    })
  }

  /* ------------------------------ game view --------------------------- */
  /* Write on the left, play on the right.  Same entry file as Run, so "what Run
   traces is what Run game plays" is a rule you can hold on to. */
  function gameOn() { return !!stageEl && stageEl.classList.contains('game-on') }

  function setGameMsg(text, bad) {
    if (!gameMsg) return
    gameMsg.textContent = text || ''
    gameMsg.classList.toggle('bad', !!bad)
  }

  function appendGameOut(line) {
    if (!gameOut) return
    gameOut.textContent += (gameOut.textContent ? '\n' : '') + line
    gameOut.scrollTop = gameOut.scrollHeight
  }

  /* The canvas is 480x360 and a projector is a lot bigger, so the whole game
     panel can go fullscreen — the bar (Stop, Back to stage) comes along, and
     Esc is the browser's own way out. */
  function setFullLabel() {
    if (!btnGameFull) return
    btnGameFull.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'
  }

  /* The canvas is a fixed-size bitmap (whatever set_mode picked), so in
     fullscreen the free area is measured and the picture is scaled to fit it:
     it grows to the screen without stretching, and the inline size is dropped
     again on the way out. */
  function fitGameScreen() {
    if (!gameCanvas || !gameViewEl) return
    if (!document.fullscreenElement) {
      gameCanvas.style.width = ''
      gameCanvas.style.height = ''
      return
    }
    const screenEl = gameViewEl.querySelector('.game-screen')
    if (!screenEl) return
    const r = screenEl.getBoundingClientRect()
    const k = Math.min(r.width / (gameCanvas.width || 1), r.height / (gameCanvas.height || 1))
    if (!(k > 0)) return
    gameCanvas.style.width = Math.floor(gameCanvas.width * k) + 'px'
    gameCanvas.style.height = Math.floor(gameCanvas.height * k) + 'px'
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) { leaveFullscreen(); return }
    if (!gameViewEl || !gameViewEl.requestFullscreen) {
      setGameMsg('Fullscreen is not available in this browser', true)
      return
    }
    gameViewEl.requestFullscreen().catch((e) => {
      setGameMsg('Fullscreen was refused: ' + (e && e.message ? e.message : e), true)
    })
  }
  on(document, 'fullscreenchange', () => {
    setFullLabel()
    requestAnimationFrame(fitGameScreen)
  })
  on(window, 'resize', () => { if (document.fullscreenElement) fitGameScreen() })

  function hideGame() {
    leaveFullscreen()
    if (stageEl) stageEl.classList.remove('game-on')
    setGameMsg('')
  }

  async function runAsGame() {
    if (gameBusy || running) return
    const entry = entryName()
    const file = fileByName(entry)
    if (!file || file.kind === 'bin') { setStatus('error', 'Nothing to play'); return }
    if (!String(file.content || '').trim()) { setStatus('error', 'That file is empty'); return }

    syncProjectFromEditor() /* the editor is the truth, exactly as for Run */
    stopPlay()
    /* the game owns the right pane, so a terminal window would only cover it */
    closeTerminal()
    showPanel('world')
    leaveAfterGame = false
    if (stageEl) stageEl.classList.add('game-on')
    if (gameOut) gameOut.textContent = ''
    if (gameCanvas && gameCanvas.focus) gameCanvas.focus()
    gameBusy = true
    syncButtons()

    /* one interpreter at a time: the worker gives way to the main thread */
    releasePython()

    const res = await startGame({
      files: project.files,
      entry: entry,
      canvas: gameCanvas,
      onOut: appendGameOut,
      onStatus: (t) => { setGameMsg(t); setStatus('busy', t) }
    })

    gameBusy = false
    if (leaveAfterGame) {
    /* asked to go back while the game was up: the stop was only a means to
       that end, so the readout goes with it */
      leaveAfterGame = false
      hideGame()
    } else if (res.stopped) { setGameMsg('Stopped at the end of the frame.'); setStatus('ready', 'Game stopped') } else if (res.error) {
      appendGameOut(res.error)
      setGameMsg('The game stopped with an error.', true)
      setStatus('error', 'Game failed')
    } else { setGameMsg('The game returned.'); setStatus('ready', 'Game returned') }
    /* hand the keyboard back to the game, so stop-then-run-again works */
    if (gameCanvas && gameCanvas.focus && gameOn()) gameCanvas.focus()
    syncButtons()
  }

  function stopGameNow() {
    if (!gameBusy) return
    /* noticed at the next frame boundary — which is also the only moment this
     click could have been delivered */
    stopGame()
    setGameMsg('Stopping at the end of this frame…')
  }

  function leaveGame() {
    if (gameBusy) { leaveAfterGame = true; stopGame(); setGameMsg('Stopping…'); return }
    hideGame()
    syncButtons()
  }

  if (btnGame) btnGame.addEventListener('click', runAsGame)
  if (btnGameStop) btnGameStop.addEventListener('click', stopGameNow)
  if (btnGameExit) btnGameExit.addEventListener('click', leaveGame)
  if (btnGameFull) btnGameFull.addEventListener('click', toggleFullscreen)
  /* ------------------------------- keys ------------------------------- */
  /* A bare key is never stolen from the editor, a form field or the scrubber,
   and a focused button must still activate exactly once. */
  function keyContext(target) {
    const tag = target && target.tagName
    return {
      inEditor: !!(target && target.closest && target.closest('.monaco-editor')),
      typing: !!(target && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable)),
      button: tag === 'BUTTON',
      scrubber: !!(target && target.id === 'scrub')
    }
  }

  on(document, 'keydown', (e) => {
  /* While the game view is up the keyboard belongs to pygame: arrows are game
     input, and the step shortcuts would fire on keys the game needs. */
    if (gameOn()) return
    const mod = e.metaKey || e.ctrlKey
    const k = keyContext(e.target)

    if (mod && e.key === 'Enter') { e.preventDefault(); runCode(); return }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); btnReset.click(); return }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); btnShare.click(); return }
    if (k.inEditor || k.typing || k.scrubber) return

    if (e.key === ' ' || e.key === 'Spacebar') {
      if (k.button || !steps.length || stale) return
      e.preventDefault()
      if (playing) stopPlay(); else startPlay()
      return
    }
    if (!steps.length) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      stopPlay()
      goto(cur + (e.key === 'ArrowRight' ? 1 : -1))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      stopPlay()
      goto(e.key === 'Home' ? 0 : steps.length - 1)
    }
  })

  /* --------------------------------- boot ----------------------------- */
  renderStage(-1, -1)
  renderDetails(-1)
  syncButtons()
  loadMonaco({ onRun: runCode, onEdit: onEditorChange }).then(async () => {
    setStatus('', 'Runtime not loaded')
    loadPython().catch(() => {})
    const fromLink = projectFromSearch(location.search)
    applyProject(fromLink || await readProject())
    linkUntouched = !!fromLink
    showDraftState(fromLink ? 'link' : (isPristine(project) ? 'sample' : 'draft'), project.at)
    initViews()
    initFiles({
      onOpen: openFile,
      onAdd: addFile,
      onRename: renameOpenFile,
      onDelete: deleteOpenFile
    })
    if (fromLink && flagFromSearch(location.search, 'run')) runCode()
  })
}
