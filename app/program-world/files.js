/* @deps: project.js */
import {
  ENTRY, MAX_BIN_BYTES, MAX_BIN_FILES, fileByName, fileCount, isBinaryName, isImageName,
  makeBinFile, makeFile, project, uniqueName, validName
} from './project.js'
import { $ } from './dom.js'

/* =====================================================================
   File bar + collapsible file list.

   This module owns the widgets and nothing else: every mutation goes through
   the hooks the app hands in, so persistence, the editor models and the trace
   all stay in one place.
   ===================================================================== */
let hooks = {}

function text(id, s) {
  const el = $(id)
  if (el) el.textContent = s
}

function icon(name, kind) {
  if (isImageName(name)) return '\u{1F5BC}'
  if (kind === 'bin') return '\u{1F4E6}'
  if (/\.pyw?$/i.test(name)) return '\u{1F40D}'
  if (/\.txt$/i.test(name)) return '\u{1F4C4}'
  return '\u{1F4CB}'
}

function entryMark(name) {
  return name === ENTRY
    ? '<span class="entry" title="main.py is the entry point — Run starts here">\u25B6</span>'
    : ''
}

function sizeLabel(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

export function renderFiles() {
  const tree = $('fileTree')
  if (!tree || !project) return
  tree.innerHTML = project.files.map(function (f) {
    const active = f.name === project.active ? ' active' : ''
    const bin = f.kind === 'bin' ? ' bin' : ''
    const size = f.kind === 'bin' ? '<span class="fsz">' + sizeLabel(f.bytes ? f.bytes.length : 0) + '</span>' : ''
    /* The row is the click target that opens the file, so the download button
       has to be its own stopPropagation-free branch in the tree handler. */
    return '<div class="file-item' + active + bin + '" data-name="' + f.name + '" title="' + f.name + '">'
      + '<span class="ic">' + icon(f.name, f.kind) + '</span>'
      + '<span class="nm">' + f.name + '</span>'
      + '<span class="rt">' + size + entryMark(f.name)
      + '<button class="dl" type="button" data-dl="' + f.name + '" title="Download ' + f.name + '">\u2193</button>'
      + '</span>'
      + '</div>'
  }).join('')
  const n = fileCount()
  text('fileCount', n + (n === 1 ? ' file' : ' files'))
  const body = $('editorBody')
  if (body) body.classList.toggle('tree-hidden', !project.treeOpen)
  const btn = $('btnTree')
  if (btn) btn.setAttribute('aria-expanded', project.treeOpen ? 'true' : 'false')
}

function wire(id, fn) {
  const el = $(id)
  if (el) el.addEventListener('click', fn)
}

function say(msg, bad) {
  const el = $('draftState')
  if (!el) return
  el.textContent = msg
  el.classList.add('dirty')
  if (bad) el.classList.add('bad')
  setTimeout(() => {
    el.classList.remove('dirty')
    el.classList.remove('bad')
    if (hooks.onRefresh) hooks.onRefresh()
  }, 2800)
}

/* ------------------------------- actions ---------------------------- */
function toggleTree() {
  if (!project) return
  project.treeOpen = !project.treeOpen
  if (hooks.onPersist) hooks.onPersist()
  renderFiles()
}

function newFile() {
  if (!project) return
  const raw = window.prompt('New file name (e.g. helper.py, data.txt, photo.png)', 'helper.py')
  if (raw === null) return
  const name = String(raw).trim()
  if (!validName(name)) { say('bad file name', true); return }
  if (fileByName(name)) { say('already exists', true); return }
  if (hooks.onAdd) hooks.onAdd(makeFile(name, ''), { open: true })
  say('added ' + name)
}

function renameFile() {
  const f = fileByName(project && project.active)
  if (!f) return
  if (f.name === ENTRY) { say('main.py is the entry', true); return }
  const raw = window.prompt('Rename ' + f.name + ' to', f.name)
  if (raw === null) return
  const name = String(raw).trim()
  if (name === f.name) return
  if (!validName(name)) { say('bad file name', true); return }
  if (fileByName(name)) { say('already exists', true); return }
  if (hooks.onRename) hooks.onRename(f.name, name)
  say('renamed to ' + name)
}

function deleteFile() {
  const f = fileByName(project && project.active)
  if (!f) return
  if (f.name === ENTRY) { say('main.py is the entry', true); return }
  if (fileCount() <= 1) { say('keep at least one file', true); return }
  if (!window.confirm('Delete ' + f.name + '?')) return
  if (hooks.onDelete) hooks.onDelete(f.name)
  say('deleted ' + f.name)
}

/* Text is read as text, everything else as bytes: a PNG read as text comes
   back as mojibake with the original bytes gone for good. */
function readOne(file, name) {
  return new Promise(function (resolve) {
    const bin = isBinaryName(name)
    if (bin && file.size > MAX_BIN_BYTES) { resolve({ skip: 'too big' }); return }
    const reader = new FileReader()
    reader.onload = function () {
      try {
        resolve({ file: bin ? makeBinFile(name, new Uint8Array(reader.result)) : makeFile(name, String(reader.result || '')) })
      } catch { resolve({ skip: 'unreadable' }) }
    }
    reader.onerror = function () { resolve({ skip: 'unreadable' }) }
    if (bin) reader.readAsArrayBuffer(file); else reader.readAsText(file)
  })
}

async function upload() {
  const input = $('fileInput')
  if (!input || !input.files || !input.files.length) return
  const list = Array.prototype.slice.call(input.files)
  let added = 0
  let skipped = 0
  let binaries = (project.files || []).filter(f => f.kind === 'bin').length

  for (const file of list) {
    if (!validName(file.name)) { skipped++; continue }
    if (isBinaryName(file.name) && binaries >= MAX_BIN_FILES) { skipped++; continue }
    const got = await readOne(file, file.name)
    if (!got || got.skip || !got.file) { skipped++; continue }
    const name = uniqueName(got.file.name)
    got.file.name = name
    if (got.file.kind === 'bin') binaries++
    if (hooks.onAdd) hooks.onAdd(got.file, { open: added === 0 })
    added++
  }
  input.value = ''
  say(skipped ? 'imported ' + added + ', skipped ' + skipped : 'imported ' + added, skipped > 0)
}

/* ------------------------------- download --------------------------- */
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function bytesOf(f) {
  if (f.kind === 'bin') return f.bytes || new Uint8Array()
  return new TextEncoder().encode(String(f.content == null ? '' : f.content))
}

function downloadByName(name) {
  const f = fileByName(name)
  if (!f) return
  if (f.kind === 'bin') {
    saveBlob(new Blob([bytesOf(f)], { type: 'application/octet-stream' }), f.name)
  } else {
    saveBlob(new Blob([bytesOf(f)], { type: 'text/plain;charset=utf-8' }), f.name)
  }
  say('saved ' + f.name)
}

/* --------------------------- "download all" ------------------------- */
/* A store-only ZIP (no compression) so a whole project leaves in one file
   without pulling in a library.  Three little-endian record kinds: a local
   header plus the bytes per file, a central directory, and an end record. */
const CRC_TABLE = (function () {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/* MS-DOS packs the date and time into two 16-bit words; 1980 is its year 0. */
function dosStamp(d) {
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31),
    date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
  }
}

function zipStore(entries, stamp) {
  const enc = new TextEncoder()
  const s = stamp || dosStamp(new Date())
  const items = entries.map(function (e) {
    const data = e.data instanceof Uint8Array ? e.data : new TextEncoder().encode(String(e.data || ''))
    return { name: enc.encode(e.name), data: data, crc: crc32(data), offset: 0 }
  })

  let local = 0
  let dir = 0
  items.forEach(function (it) {
    local += 30 + it.name.length + it.data.length
    dir += 46 + it.name.length
  })
  const out = new Uint8Array(local + dir + 22)
  const view = new DataView(out.buffer)
  let at = 0

  items.forEach(function (it) {
    it.offset = at
    view.setUint32(at, 0x04034b50, true); at += 4
    view.setUint16(at, 20, true); at += 2 // version needed
    view.setUint16(at, 0x0800, true); at += 2 // names are UTF-8
    view.setUint16(at, 0, true); at += 2 // stored, not deflated
    view.setUint16(at, s.time, true); at += 2
    view.setUint16(at, s.date, true); at += 2
    view.setUint32(at, it.crc, true); at += 4
    view.setUint32(at, it.data.length, true); at += 4
    view.setUint32(at, it.data.length, true); at += 4
    view.setUint16(at, it.name.length, true); at += 2
    view.setUint16(at, 0, true); at += 2 // extra length
    out.set(it.name, at); at += it.name.length
    out.set(it.data, at); at += it.data.length
  })

  const dirStart = at
  items.forEach(function (it) {
    view.setUint32(at, 0x02014b50, true); at += 4
    view.setUint16(at, 20, true); at += 2 // version made by
    view.setUint16(at, 20, true); at += 2
    view.setUint16(at, 0x0800, true); at += 2
    view.setUint16(at, 0, true); at += 2
    view.setUint16(at, s.time, true); at += 2
    view.setUint16(at, s.date, true); at += 2
    view.setUint32(at, it.crc, true); at += 4
    view.setUint32(at, it.data.length, true); at += 4
    view.setUint32(at, it.data.length, true); at += 4
    view.setUint16(at, it.name.length, true); at += 2
    view.setUint16(at, 0, true); at += 2 // extra
    view.setUint16(at, 0, true); at += 2 // comment
    view.setUint16(at, 0, true); at += 2 // disk number
    view.setUint16(at, 0, true); at += 2 // internal attrs
    view.setUint32(at, 0, true); at += 4 // external attrs
    view.setUint32(at, it.offset, true); at += 4
    out.set(it.name, at); at += it.name.length
  })
  const dirBytes = at - dirStart

  view.setUint32(at, 0x06054b50, true); at += 4
  view.setUint16(at, 0, true); at += 2 // this disk
  view.setUint16(at, 0, true); at += 2 // disk with the directory
  view.setUint16(at, items.length, true); at += 2
  view.setUint16(at, items.length, true); at += 2
  view.setUint32(at, dirBytes, true); at += 4
  view.setUint32(at, dirStart, true); at += 4
  view.setUint16(at, 0, true); at += 2 // no comment
  return out
}

function downloadAll() {
  if (!project || !project.files.length) { say('nothing to save', true); return }
  const entries = project.files.map(f => ({ name: f.name, data: bytesOf(f) }))
  saveBlob(new Blob([zipStore(entries)], { type: 'application/zip' }), 'project.zip')
  say('saved ' + entries.length + (entries.length === 1 ? ' file' : ' files') + ' as project.zip')
}

export function initFiles(h) {
  hooks = h || {}
  const tree = $('fileTree')
  if (tree) {
    tree.addEventListener('click', function (e) {
      const hit = e.target
      const dl = hit && hit.closest ? hit.closest('.dl') : null
      if (dl) { downloadByName(dl.getAttribute('data-dl')); return }
      const row = hit && hit.closest ? hit.closest('.file-item') : null
      if (!row) return
      const name = row.getAttribute('data-name')
      if (name && hooks.onOpen) hooks.onOpen(name)
    })
  }
  wire('btnTree', toggleTree)
  wire('btnNewFile', newFile)
  wire('btnRenameFile', renameFile)
  wire('btnDeleteFile', deleteFile)
  wire('btnUpload', function () {
    const input = $('fileInput')
    if (input) { input.value = ''; input.click() }
  })
  wire('btnDownload', function () {
    if (project) downloadByName(project.active)
  })
  wire('btnDownloadAll', downloadAll)
  const input = $('fileInput')
  if (input) input.addEventListener('change', upload)
  renderFiles()
}
