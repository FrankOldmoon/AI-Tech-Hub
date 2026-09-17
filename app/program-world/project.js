/* @deps: config.js, draft.js, store.js */
import { EXAMPLES, SAMPLE } from './config.js'
import { readDraft, clearDraft } from './draft.js'
import { putBinary, getBinary, deleteBinary, listBinaries, clearBinaries } from './store.js'

/* =====================================================================
   The editable project: a flat set of files, one of which is the entry.

   A file is either text (`content`) or binary (`bytes`).  Text is kept in the
   localStorage manifest; binary bytes live in IndexedDB and the manifest only
   remembers the name and size.  Reading and writing are async because of that
   store, and both degrade to "text only" when IndexedDB is unavailable.

   Like state.js, the live project is module state with explicit mutators.
   ===================================================================== */
export const ENTRY = 'main.py'
const KEY = 'pw.project'
const MAX_TEXT_BYTES = 400000
const MAX_BIN_BYTES = 5 * 1024 * 1024
const MAX_BIN_FILES = 24
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const TEXT_EXT = /\.(py|pyw|txt|md|json|csv|tsv|log|ini|cfg|toml|yaml|yml|html|htm|css|js|mjs|xml|sql|sh|text)$/i
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  pdf: 'application/pdf', wav: 'audio/wav', mp3: 'audio/mpeg'
}

export let project = null

export function validName(name) {
  return typeof name === 'string' && NAME_RE.test(name)
}

export function makeFile(name, content) {
  return { name: name, kind: 'text', content: content == null ? '' : String(content) }
}

export function makeBinFile(name, bytes) {
  const copy = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  return { name: name, kind: 'bin', bytes: copy }
}

export function isBinaryName(name) {
  return !TEXT_EXT.test(String(name || ''))
}

export function textExt(name) {
  return (String(name || '').match(/\.([A-Za-z0-9]+)$/) || [])[1] || ''
}

export function mimeOf(name) {
  return MIME[textExt(name).toLowerCase()] || 'application/octet-stream'
}

export function isImageName(name) {
  return /^image\//.test(mimeOf(name))
}

export function defaultProject() {
  return projectFromExample(EXAMPLES[0])
}

/* An example is a whole project, not just a file: it may also carry the sibling
   module and the data file that its main.py imports. */
export function projectFromExample(ex) {
  const files = ((ex && ex.files) || []).map(f => makeFile(f.name, f.content))
  if (!files.length) files.push(makeFile(ENTRY, SAMPLE))
  const entry = files.filter(f => f.name === ENTRY)[0] || files[0]
  return { files: files, active: entry.name, treeOpen: true, from: 'sample' }
}

/* A project can arrive from a link, a draft, the editor or a test, and older
   shapes have no `kind` at all.  Normalise once, here, so nothing downstream
   has to wonder whether a file is text. */
export function normaliseFile(f) {
  if (!f || typeof f.name !== 'string') return f
  if (f.kind === 'bin') return f.bytes ? f : makeBinFile(f.name, f.bytes || new Uint8Array())
  if (f.kind === 'text') return f
  return makeFile(f.name, f.content)
}

export function setProject(p) {
  if (p && Array.isArray(p.files)) p.files = p.files.map(normaliseFile)
  project = p
  return project
}

export function fileByName(name) {
  if (!project) return null
  for (let i = 0; i < project.files.length; i++) {
    if (project.files[i].name === name) return project.files[i]
  }
  return null
}

export function setActiveFile(name) {
  if (project && fileByName(name)) project.active = name
  return project ? project.active : null
}

export function fileCount() {
  return project ? project.files.length : 0
}

export function activeFile() {
  return project ? fileByName(project.active) : null
}

export function isPristine(p) {
  const q = p || project
  return !!q && q.files.length === 1 && q.files[0].name === ENTRY
    && q.files[0].kind === 'text' && q.files[0].content.trim() === SAMPLE.trim()
}

export function uniqueName(base) {
  const dot = String(base).lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  let name = base
  let n = 1
  while (fileByName(name)) name = stem + '_' + (++n) + ext
  return name
}

/* --------------------------- persistence ---------------------------- */
export function textBytes(list) {
  return (list || []).reduce(function (n, f) {
    return n + f.name.length + (f.kind === 'bin' ? 0 : String(f.content || '').length)
  }, 0)
}

export function binStats(list) {
  const bins = (list || []).filter(f => f.kind === 'bin')
  return { count: bins.length, bytes: bins.reduce((n, f) => n + (f.bytes ? f.bytes.length : 0), 0) }
}

/* An older single-file draft is just a project with one file. */
export async function readProject() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw)
      const files = []
      const texts = []
      for (const m of (p.files || [])) {
        if (!m || !validName(m.name)) continue
        if (m.kind === 'bin') files.push(m) // bytes filled in below
        else if (typeof m.content === 'string') texts.push(makeFile(m.name, m.content))
      }
      const kept = []
      for (const t of texts) kept.push(t)
      for (const m of files) {
        const bytes = await getBinary(m.name)
        if (bytes) kept.push(makeBinFile(m.name, bytes))
      }
      if (kept.length) {
        const active = kept.some(f => f.name === p.active) ? p.active : kept[0].name
        return { files: kept, active, treeOpen: p.treeOpen !== false, at: p.at, from: 'project' }
      }
    }
  } catch { /* unreadable → keep going */ }
  try {
    const d = readDraft()
    if (d && d.code && d.code.trim() && d.code.trim() !== SAMPLE.trim()) {
      return { files: [makeFile(ENTRY, d.code)], active: ENTRY, treeOpen: true, from: 'draft' }
    }
  } catch { /* ignore */ }
  return defaultProject()
}

/* Returns false when the project is too big to keep, so the caller can say so. */
export async function writeProject(p, opts) {
  const q = p || project
  const o = opts || {}
  if (!q || !q.files || !q.files.length) return false
  try {
    if (o.drop || isPristine(q)) {
      localStorage.removeItem(KEY)
      clearDraft()
      await clearBinaries()
      return true
    }
    const manifest = q.files.map(function (f) {
      return f.kind === 'bin'
        ? { name: f.name, kind: 'bin', size: f.bytes ? f.bytes.length : 0 }
        : { name: f.name, kind: 'text', content: f.content }
    })
    if (textBytes(manifest) > MAX_TEXT_BYTES) return false
    localStorage.setItem(KEY, JSON.stringify({
      v: 3, files: manifest, active: q.active, treeOpen: q.treeOpen !== false, at: Date.now()
    }))
    const keep = new Set()
    for (const f of q.files) {
      if (f.kind !== 'bin' || !f.bytes) continue
      keep.add(f.name)
      await putBinary(f.name, f.bytes)
    }
    for (const s of await listBinaries()) {
      if (!keep.has(s.name)) await deleteBinary(s.name)
    }
    return true
  } catch {
    return false
  }
}

export { MAX_TEXT_BYTES, MAX_BIN_BYTES, MAX_BIN_FILES }
