/* =====================================================================
   Local draft.

   Keeps the editor's content across reloads in localStorage, and decides what
   the editor should show on a cold start.  Storage is best-effort: a quota
   error, a corrupt entry or a disabled store must never break the app.
   ===================================================================== */
import { SAMPLE } from './config.js'
import { codeFromSearch } from './url-code.js'

const KEY = 'pw.draft'

/* a runaway paste should not fill the origin's quota */
const MAX_CHARS = 200000

export function readDraft() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const rec = JSON.parse(raw)
    if (!rec || typeof rec.code !== 'string' || !rec.code) return null
    if (rec.code.length > MAX_CHARS) return null
    return { code: rec.code, at: Number(rec.at) || 0 }
  } catch {
    return null // corrupt or unreadable: behave as "no draft"
  }
}

/* Returns true when a draft is on record afterwards.  Content that is empty,
   equal to the sample, or oversized clears the entry instead, so a deliberate
   reset does not come back from the dead on the next reload. */
export function writeDraft(code, at) {
  if (typeof code !== 'string' || !code || code === SAMPLE || code.length > MAX_CHARS) {
    clearDraft()
    return false
  }
  try {
    localStorage.setItem(KEY, JSON.stringify({ code: code, at: at || 0 }))
    return true
  } catch {
    return false
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY)
  } catch { /* ignore */ }
}

/* A shared link always wins: it is an explicit instruction, whereas the draft
   is just where the user left off. */
export function pickInitialCode(search, draft) {
  const shared = codeFromSearch(search)
  if (shared) return { code: shared, from: 'link', at: 0 }
  if (draft && draft.code) return { code: draft.code, from: 'draft', at: draft.at }
  return { code: SAMPLE, from: 'sample', at: 0 }
}
