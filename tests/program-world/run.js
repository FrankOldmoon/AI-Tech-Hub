/* Harness entry: install the adapters, then run the ported assertions in order.
   Dynamic imports give the sequence explicitly; a static import would hoist.

   The binding comes first because dom.js resolves nothing at import time any
   more — it binds whatever page it is given — and the adapter reads elements
   the moment it is imported. */
import { bindDom } from '../../app/program-world/dom.js'

bindDom(document.querySelector('.program-world'))

const { summary } = await import('./adapter.js')

/* p12 is the reduced-motion part and needs real media emulation, so it runs in
   harness-rm.html instead; everything else runs here. */
try {
  for (let i = 1; i <= 11; i++) {
    await import('./p' + String(i).padStart(2, '0') + '.js')
  }
  await import('./p13.js')
  await import('./p14.js')
} catch (e) {
  summary.fail++
  summary.fails.push('harness aborted: ' + (e && e.message ? e.message : e))
  console.log('FAIL harness aborted: ' + (e && e.stack ? e.stack : e))
}

window.__summary = { ok: summary.ok, fail: summary.fail, fails: summary.fails }
console.log('SUMMARY ok=' + summary.ok + ' fail=' + summary.fail)
document.documentElement.setAttribute('data-tests', 'done')
