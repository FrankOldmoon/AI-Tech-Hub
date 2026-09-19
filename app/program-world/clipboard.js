/* @deps: none */

/* =====================================================================
   Copying to the clipboard, in every context the page can be served in.

   `navigator.clipboard` only exists in a secure context — over plain http on a
   LAN address it is simply undefined, which is exactly how this app gets
   deployed next to a classroom machine.  So the async API is tried first and
   the old `document.execCommand('copy')` path is the fallback; when even that
   is refused the caller's `manual` handler takes over (show the text and let
   the reader copy it by hand).

   `done` runs on success, `manual` when nothing else worked.
   ===================================================================== */
export function copyToClipboard(text, done, manual) {
  const viaExec = () => {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      if (ok) done(); else manual()
    } catch {
      manual()
    }
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, viaExec)
    } else {
      viaExec()
    }
  } catch {
    viaExec()
  }
}
