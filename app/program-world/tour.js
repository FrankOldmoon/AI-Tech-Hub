/* @deps: dom.js, panels.js */
import { on } from './dom.js'
import { showPanel } from './panels.js'

/* =====================================================================
   The one-time guided tour.

   It appears once, right after the first Run has something to show, and points
   at what just appeared: the views, the chart, the step controls, Run.  Every
   way out of it — Next, Skip, Esc — writes a flag to localStorage, so it never
   comes back: a hint that returns after every Run is a nag, not a hint.

   The step list is data at the top (exported, so a test can hold it to its
   contract); everything below it is the overlay itself.
   ===================================================================== */

const SEEN_KEY = 'pw.tour.v1'

export const TOUR_STEPS = [
  {
    target: '#tabFlow',
    title: 'Your program, charted',
    text: 'After every Run you get this tab: the control flow of the file Run traced, redrawn from your code.'
  },
  {
    target: '#panelFlow',
    title: 'Reading the chart',
    text: 'Diamond = a decision, parallelogram = print or input, dashed box = a function. The dashed purple edge is a loop going back.'
  },
  {
    target: '.transport',
    title: 'Walk the run',
    text: 'Step through the trace with these: the node you are on lights up and the edges already walked turn blue. Click any node to jump to its line.'
  },
  {
    target: '#btnRun',
    title: 'That is the tour',
    text: 'Press Run again and the chart follows your edits. Pick another program from the Examples menu for a different shape.'
  }
]

/* Storage goes through these two so a browser that refuses localStorage (private
   mode, quota) cannot throw where it is not expected — the tour just comes back
   next time, which is a far smaller problem than a broken Run. */
export function tourSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === 'seen'
  } catch {
    return false
  }
}

export function markTourSeen() {
  try {
    localStorage.setItem(SEEN_KEY, 'seen')
  } catch { /* no store: the tour may come back */ }
}

let root = null
let layer = null
let holeEl = null
let cardEl = null
let stepEl = null
let titleEl = null
let textEl = null
let nextEl = null
let skipEl = null
let step = 0
let open = false

/* Called from boot(): the page can be left and re-entered, so whatever belonged
   to the previous DOM is forgotten here (the listeners are cleared by unbindAll). */
export function initTour(el) {
  root = el || null
  layer = null
  holeEl = null
  cardEl = null
  stepEl = null
  titleEl = null
  textEl = null
  nextEl = null
  skipEl = null
  step = 0
  open = false
  on(document, 'keydown', (e) => {
    if (open && e.key === 'Escape') closeTour()
  })
  on(window, 'resize', () => {
    if (open) layout()
  })
}

/** Show it if this is the user's first traced program and every target is there. */
export function maybeShowTour() {
  if (open || !root || tourSeen()) return
  /* all targets or nothing: a step pointing at a missing element would leave the
     spotlight in the top-left corner of the screen */
  if (!TOUR_STEPS.every(s => document.querySelector(s.target))) return
  /* the tour is about the chart, so put the chart on screen before pointing at it */
  showPanel('flow')
  startTour()
}

function build() {
  layer = document.createElement('div')
  layer.className = 'pw-tour'
  layer.hidden = true
  layer.innerHTML = [
    '<div class="tour-hole" data-tour="hole"></div>',
    '<div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourTitle">',
    '<div class="tour-step" data-tour="step"></div>',
    '<div class="tour-title" id="tourTitle" data-tour="title"></div>',
    '<div class="tour-text" data-tour="text"></div>',
    '<div class="tour-row">',
    '<button class="btn ghost sm" data-tour="skip">Skip</button>',
    '<button class="btn primary sm" data-tour="next">Next</button>',
    '</div>',
    '</div>'
  ].join('')
  root.appendChild(layer)
  holeEl = layer.querySelector('[data-tour="hole"]')
  cardEl = layer.querySelector('.tour-card')
  stepEl = layer.querySelector('[data-tour="step"]')
  titleEl = layer.querySelector('[data-tour="title"]')
  textEl = layer.querySelector('[data-tour="text"]')
  nextEl = layer.querySelector('[data-tour="next"]')
  skipEl = layer.querySelector('[data-tour="skip"]')
  nextEl.addEventListener('click', advance)
  skipEl.addEventListener('click', closeTour)
}

function startTour() {
  if (!layer) build()
  open = true
  step = 0
  layer.hidden = false
  render()
}

function render() {
  const s = TOUR_STEPS[step]
  stepEl.textContent = (step + 1) + ' / ' + TOUR_STEPS.length
  titleEl.textContent = s.title
  textEl.textContent = s.text
  nextEl.textContent = step === TOUR_STEPS.length - 1 ? 'Done' : 'Next'
  skipEl.hidden = step === TOUR_STEPS.length - 1
  layout()
}

/* Keep the hole over the target and the card beside it, both on screen.  The
   hole is a real box whose huge box-shadow does the dimming, so the spotlight
   needs no measuring of its own. */
function layout() {
  if (!open || !holeEl) return
  const target = document.querySelector(TOUR_STEPS[step].target)
  if (!target) return
  const r = target.getBoundingClientRect()
  const gap = 10
  holeEl.style.left = Math.round(r.left - 8) + 'px'
  holeEl.style.top = Math.round(r.top - 8) + 'px'
  holeEl.style.width = Math.round(r.width + 16) + 'px'
  holeEl.style.height = Math.round(r.height + 16) + 'px'
  const cw = cardEl.offsetWidth
  const ch = cardEl.offsetHeight
  /* below the target when there is room, above it otherwise */
  let top = r.bottom + gap
  if (top + ch > window.innerHeight - 8) top = r.top - gap - ch
  let left = r.left + r.width / 2 - cw / 2
  left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - cw - 8))
  cardEl.style.top = Math.round(Math.max(8, top)) + 'px'
  cardEl.style.left = Math.round(left) + 'px'
}

function advance() {
  markTourSeen()
  if (step >= TOUR_STEPS.length - 1) {
    closeTour()
    return
  }
  step++
  render()
}

/** However the user got out, they have seen it: never again. */
function closeTour() {
  if (!open) return
  open = false
  markTourSeen()
  if (layer) layer.hidden = true
}
