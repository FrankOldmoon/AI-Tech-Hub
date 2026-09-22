/* @deps: dom.js, python.js */
import { esc, on, panelFlow } from './dom.js'

/* =====================================================================
   Flowchart of the program's control flow.

   Three halves, deliberately separable:

   - `buildCallIndex(parsed)` reads the whole parsed project (every `.py`,
     not just the entry) and answers "is this statement calling a function
     that lives somewhere else?".  It stamps each tree node with its file.
   - `buildFlowLayout(tree, opts)` turns the structure the worker parsed out
     of the source (see pyworker.js's FLOW_PY) into placed nodes and edges.
     It is a pure function over plain objects — no DOM — so it can be unit
     tested.  `opts.resolve` adds cross-file links and `opts.expanded` asks
     for a callee's body to be inlined.
   - the rendering below paints that model as SVG, lights up the node the
     tracer is on and the edges already walked during playback, and exports the
     picture.  The chart shows the program's *code* only — the values of
     variables live in the Execution panel, not here.

   Layout is the textbook one rather than a generic graph layout: structured
   code is a tree, so a sequence stacks downwards, an `if` splits into two
   columns and merges, and a loop wraps its body with the back edge drawn in
   the left margin (that edge is the one that flows).
   ===================================================================== */

/* ------------------------------ metrics ------------------------------ */

const NODE_W = 200
const PAD_X = 12
const PAD_Y = 9
const LINE_H = 16
const CHAR_W = 6.6 // rough advance of the 12px label font, for wrapping
const MAX_CHARS = Math.floor((NODE_W - PAD_X * 2) / CHAR_W)
const GAP_Y = 26
const GAP_X = 26
const DIAMOND_H = 76
const SIDE = 38 // margin reserved for branch elbows and loop back edges
const SKEW = 12 // parallelogram slant
const LINK_H = 20 // the "calls a function in another file" row under a node
const MAX_EXPAND_DEPTH = 3

/* ------------------------------ helpers ------------------------------ */

let uid = 0

/* Layout is a synchronous tree walk, so the options it needs (which file are
   we in, how to resolve a call, what is expanded) ride on module state the
   same way `uid` does.  `buildFlowLayout` resets it on every call. */
let ctx = null

function wrapLabel(text, maxChars) {
  const out = []
  let line = ''
  const push = () => {
    if (!line) return
    out.push(line)
    line = ''
  }
  for (const word of String(text == null ? '' : text).split(/\s+/)) {
    if (!word) continue
    let w = word
    while (w.length > maxChars) {
      push()
      out.push(w.slice(0, maxChars - 1) + '-')
      w = w.slice(maxChars - 1)
    }
    if (!line) line = w
    else if (line.length + 1 + w.length <= maxChars) line += ' ' + w
    else {
      push()
      line = w
    }
  }
  push()
  if (!out.length) out.push('')
  return out.slice(0, 2).map((l, i, a) => (i === a.length - 1 && l.length > maxChars ? l.slice(0, maxChars - 1) + '…' : l))
}

function block(w, h, nodes, edges, entry, exit) {
  return { w: w, h: h, nodes: nodes || [], edges: edges || [], entry: entry || { x: w / 2, y: 0 }, exit: exit || { x: w / 2, y: h } }
}

function emptyBlock(label, line) {
  const lines = label ? wrapLabel(label, MAX_CHARS) : []
  const h = lines.length ? PAD_Y * 2 + lines.length * LINE_H : 18
  const n = {
    id: 'n' + (++uid),
    kind: 'empty',
    line: line || 0,
    file: (ctx && ctx.file) || '',
    x: 0,
    y: 0,
    w: NODE_W,
    h: h,
    cx: NODE_W / 2,
    cy: h / 2,
    lines: lines
  }
  return block(NODE_W, h, [n], [])
}

function nodeBlock(kind, lines, line, extra) {
  const w = NODE_W
  const text = lines || []
  const h = Math.max(text.length ? PAD_Y * 2 + text.length * LINE_H : 30, 30)
  const n = Object.assign({
    id: 'n' + (++uid),
    kind: kind,
    line: line || 0,
    file: (ctx && ctx.file) || '',
    x: 0,
    y: 0,
    w: w,
    h: h,
    cx: w / 2,
    cy: h / 2,
    lines: text
  }, extra || {})
  if (n.file === undefined) n.file = (ctx && ctx.file) || ''
  return block(w, h, [n], [])
}

function diamondBlock(label, line, kind) {
  const text = wrapLabel(label, Math.floor((NODE_W * 1.5 - PAD_X * 2) / CHAR_W))
  const w = Math.max(NODE_W, Math.round(label.length * CHAR_W) + PAD_X * 4)
  const h = Math.max(DIAMOND_H, text.length * LINE_H + PAD_Y * 4)
  const n = {
    id: 'n' + (++uid),
    kind: kind || 'if',
    line: line || 0,
    file: (ctx && ctx.file) || '',
    x: 0,
    y: 0,
    w: w,
    h: h,
    cx: w / 2,
    cy: h / 2,
    lines: text
  }
  return block(w, h, [n], [])
}

/* A statement node that may call a function defined in another project file.
   When it does, it grows one row: the "↳ helper.py:14" badge (click to jump to
   the definition) and a +/− toggle (click to inline the body right there). */
function callNodeBlock(kind, lines, n, extra) {
  const b = nodeBlock(kind, lines, n.line, Object.assign({ file: n.file }, extra))
  const node = b.nodes[0]
  const target = (n.calls && ctx && ctx.resolve) ? ctx.resolve(node.file, n.calls) : null
  if (!target) return b
  node.link = target
  node.expandKey = target.file + ':' + target.line
  node.shapeH = node.h
  node.h += LINK_H
  b.h += LINK_H
  b.exit = { x: b.w / 2, y: b.h }
  return b
}

/* Inline the callee's own chart under the call, inside the same flow.  A call
   cycle, or nesting past the depth cap, stops the expansion rather than
   recursing forever. */
function withExpansion(base) {
  if (!base || !base.nodes || !base.nodes.length) return base
  const node = base.nodes[0]
  const link = node.link
  if (!link || !link.node || !link.node.body) return base
  if (!ctx.expanded.has(node.expandKey)) return base
  if (ctx.expanding.has(node.expandKey)) return base
  if (ctx.depth >= MAX_EXPAND_DEPTH) return base
  ctx.expanding.add(node.expandKey)
  const prevFile = ctx.file
  const prevDepth = ctx.depth
  ctx.file = link.file
  ctx.depth = prevDepth + 1
  const inner = layoutFunc(link.node)
  ctx.depth = prevDepth
  ctx.file = prevFile
  ctx.expanding.delete(node.expandKey)
  if (!inner) return base
  return stackBlocks([base, inner])
}

/* Move a finished child block into its parent's coordinate space. */
function place(b, dx, dy, nodes, edges) {
  if (!b) return
  for (const n of b.nodes) {
    nodes.push(Object.assign({}, n, { x: n.x + dx, y: n.y + dy, cx: n.cx + dx, cy: n.cy + dy }))
  }
  for (const e of b.edges) {
    edges.push(Object.assign({}, e, { points: e.points.map(p => [p[0] + dx, p[1] + dy]) }))
  }
}

function edge(fromId, toId, points, kind, label) {
  return { from: fromId, to: toId, points: points, kind: kind || 'seq', label: label || '' }
}

/* Highest / lowest node of a block, so edges leave and arrive at the extremes
   rather than at whatever the traversal happened to visit last.  The edge's
   line pair is what ties the chart to the step-by-step trace, so it matters. */
function topOf(b) {
  let best = null
  for (const n of (b ? b.nodes : [])) {
    if (!best || n.y < best.y) best = n
  }
  return best
}

function bottomOf(b) {
  let best = null
  for (const n of (b ? b.nodes : [])) {
    if (!best || n.y + n.h > best.y + best.h) best = n
  }
  return best
}

/** Run `fn` on a child block and return its exit point in the parent space. */
function anchor(b, dx, dy, which) {
  const p = which === 'entry' ? b.entry : b.exit
  return [p.x + dx, p.y + dy]
}

/* Stack blocks vertically, centred, wiring each exit to the next entry. */
function stackBlocks(blocks) {
  const list = blocks.filter(Boolean)
  if (!list.length) return null
  const w = Math.max.apply(null, list.map(b => b.w))
  const nodes = []
  const edges = []
  let y = 0
  let prevExit = null
  let prevId = null
  for (const b of list) {
    const dx = (w - b.w) / 2
    place(b, dx, y, nodes, edges)
    const entry = anchor(b, dx, y, 'entry')
    if (prevExit) {
      const top = topOf(b)
      edges.push(edge(prevId, top ? top.id : '', [prevExit, entry], 'seq', ''))
    }
    prevExit = anchor(b, dx, y, 'exit')
    const deep = bottomOf(b)
    prevId = deep ? deep.id : null
    y += b.h + GAP_Y
  }
  y -= GAP_Y
  return block(w, y, nodes, edges)
}

/* ------------------------------ layout ------------------------------- */

function layoutSeq(items) {
  const list = (items || []).filter(Boolean)
  if (!list.length) return null
  return stackBlocks(list.map(layoutItem))
}

function layoutItem(n) {
  if (!n || !n.kind) return null
  switch (n.kind) {
    case 'if':
      return layoutIf(n)
    case 'while':
    case 'for':
      return layoutLoop(n)
    case 'func':
      return layoutFunc(n)
    case 'io':
      return withExpansion(callNodeBlock('io', wrapLabel(n.text || '', MAX_CHARS), n, { dir: n.dir }))
    case 'return':
    case 'break':
    case 'continue':
      return withExpansion(callNodeBlock(n.kind, wrapLabel(n.text || n.kind, MAX_CHARS), n))
    case 'more':
      return nodeBlock('more', wrapLabel(n.text || '…', MAX_CHARS), 0)
    default:
      return withExpansion(callNodeBlock('stmt', wrapLabel(n.text || '', MAX_CHARS), n))
  }
}

function layoutIf(n) {
  const branches = n.branches && n.branches.length ? n.branches : [{ test: '', line: n.line, body: [] }]
  const head = branches[0]
  const yes = layoutSeq(head.body) || emptyBlock('(no statements)', head.line)
  const rest = branches.slice(1)
  let no = null
  if (rest.length) {
    no = layoutIf({ kind: 'if', line: rest[0].line, branches: rest, orelse: n.orelse })
  } else if (n.orelse && n.orelse.length) {
    no = layoutSeq(n.orelse) || emptyBlock('(no statements)', n.line)
  }

  const dia = diamondBlock('if ' + (head.test || ''), head.line, 'if')
  const noW = no ? no.w : 24
  const noH = no ? no.h : 0
  const w = Math.max(dia.w, yes.w + GAP_X + noW)
  const cx = w / 2
  const nodes = []
  const edges = []

  const dx = cx - dia.w / 2
  place(dia, dx, 0, nodes, edges)
  /* the diamond's left/right/bottom vertices: `dia` is the whole block, so the
     vertex y is half its height (the node itself sits at y = 0 inside it) */
  const midY = dia.h / 2
  const diaRight = [cx + dia.w / 2, midY]
  const diaBottom = [cx, dia.h]

  const yesX = cx - GAP_X / 2 - yes.w
  const noX = cx + GAP_X / 2
  const rowY = dia.h + GAP_Y
  place(yes, yesX, rowY, nodes, edges)
  if (no) place(no, noX, rowY, nodes, edges)

  const yesTop = [yesX + yes.w / 2, rowY]
  const yesExit = [yesX + yes.w / 2, rowY + yes.h]
  edges.push(edge(dia.nodes[0].id, topOf(yes) ? topOf(yes).id : '', [diaBottom, [cx, rowY - GAP_Y / 2], yesTop], 'true', 'True'))

  if (no) {
    const noTop = [noX + noW / 2, rowY]
    edges.push(edge(dia.nodes[0].id, topOf(no) ? topOf(no).id : '',
      [diaRight, [noX + noW / 2, midY], noTop], 'false', 'False'))
  } else {
    // 没有 else：假分支直接绕过（画一小段折线，避免看起来漏了分支）
    edges.push(edge(dia.nodes[0].id, '', [diaRight, [cx + dia.w / 2 + 18, midY], [cx + dia.w / 2 + 18, rowY + 14]], 'false', 'False'))
  }

  const bottomY = rowY + Math.max(yes.h, noH)
  const mergeY = bottomY + GAP_Y
  edges.push(edge(bottomOf(yes) ? bottomOf(yes).id : '', '',
    [yesExit, [yesExit[0], mergeY], [cx, mergeY]], 'merge', ''))
  if (no) {
    edges.push(edge(bottomOf(no) ? bottomOf(no).id : '', '',
      [[noX + noW / 2, rowY + noH], [noX + noW / 2, mergeY], [cx, mergeY]], 'merge', ''))
  }

  return block(w, mergeY, nodes, edges, { x: cx, y: 0 }, { x: cx, y: mergeY })
}

function layoutLoop(n) {
  const isFor = n.kind === 'for'
  const label = isFor ? (n.target || 'i') + ' in ' + (n.iter || '…') : (n.test || '')
  const dia = diamondBlock(label, n.line, isFor ? 'for' : 'while')
  const body = layoutSeq(n.body) || emptyBlock('(no statements)', n.line)
  const core = Math.max(dia.w, body.w)
  const w = core + SIDE * 2
  const cx = w / 2
  const nodes = []
  const edges = []

  place(dia, cx - dia.w / 2, 0, nodes, edges)
  const bodyY = dia.h + GAP_Y
  place(body, cx - body.w / 2, bodyY, nodes, edges)

  const diaBottom = [cx, dia.h]
  const bodyTop = topOf(body)
  edges.push(edge(dia.nodes[0].id, bodyTop ? bodyTop.id : '',
    [diaBottom, [cx, bodyY - GAP_Y / 2], [cx, bodyY]], 'true', 'True'))

  const bodyExit = [cx, bodyY + body.h]
  const exitY = bodyExit[1] + GAP_Y
  /* The back edge — the one that flows — leaves the body, goes out to the left
     margin, up past the diamond and back into its left vertex. */
  const bodyDeep = bottomOf(body)
  edges.push(edge(bodyDeep ? bodyDeep.id : '', dia.nodes[0].id,
    [bodyExit, [SIDE / 2, bodyExit[1]], [SIDE / 2, midOf(dia)], diaLeftOf(dia, cx)], 'loop', 'loop'))
  edges.push(edge(dia.nodes[0].id, '',
    [diaRightOf(dia, cx), [w - SIDE / 2, midOf(dia)], [w - SIDE / 2, exitY], [cx, exitY]], 'false', 'False'))

  return block(w, exitY, nodes, edges, { x: cx, y: 0 }, { x: cx, y: exitY })
}

/* `dia` is a block, not a node: its vertices are at half its height. */
function midOf(dia) {
  return dia.h / 2
}
function diaLeftOf(dia, cx) {
  return [cx - dia.w / 2, midOf(dia)]
}
function diaRightOf(dia, cx) {
  return [cx + dia.w / 2, midOf(dia)]
}

function layoutFunc(n) {
  const isClass = n.sub === 'class'
  const head = nodeBlock('func', wrapLabel((isClass ? 'class ' : 'def ') + n.name + '(' + (n.args || '') + ')', MAX_CHARS), n.line, { sub: n.sub })
  const body = layoutSeq(n.body) || emptyBlock('(no statements)', n.line)
  const innerW = Math.max(head.w, body.w)
  const w = innerW + PAD_X * 2
  const nodes = []
  const edges = []
  const headX = (w - head.w) / 2
  place(head, headX, PAD_Y, nodes, edges)
  const bodyY = PAD_Y + head.h + GAP_Y
  place(body, (w - body.w) / 2, bodyY, nodes, edges)
  const h = bodyY + body.h + PAD_Y
  // 外框（虚线边框，画在最底层）
  nodes.unshift({
    id: 'n' + (++uid),
    kind: 'frame',
    line: n.line || 0,
    file: n.file || (ctx && ctx.file) || '',
    x: 0,
    y: 0,
    w: w,
    h: h,
    cx: w / 2,
    cy: h / 2,
    lines: [isClass ? 'class ' + n.name : 'function ' + n.name]
  })
  edges.push(edge(head.nodes[0].id, body.nodes[0].id,
    [[headX + head.w / 2, PAD_Y + head.h], [(w - body.w) / 2 + body.w / 2, bodyY]], 'seq', ''))
  return block(w, h, nodes, edges, { x: w / 2, y: PAD_Y }, { x: w / 2, y: h })
}

/* Pure: structure tree -> placed nodes and edges (world units, origin top-left).

   `options` is all optional:
     file     – the file this tree came from (stamped onto every node, so a
                click can open the right one)
     resolve  – (file, callNames) -> { file, name, line, node } | null
     expanded – Set of "file:line" keys whose callee body should be inlined */
export function buildFlowLayout(tree, options) {
  const o = options || {}
  uid = 0
  ctx = {
    file: o.file || '',
    resolve: o.resolve || null,
    expanded: o.expanded || new Set(),
    expanding: new Set(),
    depth: 0
  }
  const entry = o.file || ''
  const inner = layoutSeq(tree)
  const start = nodeBlock('start', ['Start'], 0, { pill: true, file: entry })
  const end = nodeBlock('end', ['End'], 0, { pill: true, file: entry })
  const root = stackBlocks([start, inner, end])
  const lines = new Map(root.nodes.map(n => [n.id, n]))
  root.edges.forEach((e) => {
    const a = lines.get(e.from)
    const b = lines.get(e.to)
    e.fromLine = a ? a.line : 0
    e.toLine = b ? b.line : 0
    e.fromKey = keyOf(a)
    e.toKey = keyOf(b)
  })
  /* which nodes come from a file other than the entry: they get their own frame */
  root.nodes.forEach((n) => {
    n.cross = !!entry && !!n.file && n.file !== entry
  })
  return { width: root.w, height: root.h, nodes: root.nodes, edges: root.edges }
}

function keyOf(n) {
  return n ? n.file + ':' + n.line : '0:0'
}

/* --------------------------- cross-file links ------------------------- */

function stemOf(name) {
  return String(name == null ? '' : name).replace(/\.pyw?$/i, '')
}

function stampFile(node, file) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach(n => stampFile(n, file))
    return
  }
  if (node.kind) node.file = file
  for (const k of ['body', 'orelse', 'finalbody', 'branches']) {
    if (Array.isArray(node[k])) stampFile(node[k], file)
  }
}

/* Index a parsed project: where each top-level function is defined, which
   module name maps to which file, and a resolver that answers with the
   definition a call points at.  Only cross-file answers count — a call to a
   function in the same file is just a call, not a link. */
export function buildCallIndex(parsed) {
  const files = (parsed && parsed.files) || {}
  const entry = (parsed && parsed.entry) || Object.keys(files)[0] || ''
  const pyFiles = {}
  for (const name of Object.keys(files)) pyFiles[stemOf(name)] = name

  const funcs = new Map()
  const byName = new Map()
  for (const name of Object.keys(files)) {
    const tree = (files[name] && files[name].tree) || []
    stampFile(tree, name)
    const per = new Map()
    for (const n of tree) {
      if (!n || n.kind !== 'func') continue
      const rec = { file: name, name: n.name, line: n.line, node: n }
      if (!per.has(n.name)) per.set(n.name, rec)
      if (!byName.has(n.name)) byName.set(n.name, rec)
    }
    funcs.set(name, per)
  }

  const aliases = new Map()
  const fromNames = new Map()
  for (const name of Object.keys(files)) {
    const a = new Map()
    const f = new Map()
    const list = (files[name] && files[name].imports) || []
    for (const imp of list) {
      const target = pyFiles[String(imp.module || '').split('.').pop()] || null
      if (!target) continue
      const names = imp.names || []
      if (!names.length) {
        if (imp.alias) a.set(imp.alias, target)
      } else {
        for (const n of names) {
          if (n !== '*') f.set(n, { file: target, name: n })
        }
      }
    }
    aliases.set(name, a)
    fromNames.set(name, f)
  }

  function localOf(file, name) {
    const per = funcs.get(file)
    return per ? per.get(name) || null : null
  }

  function resolve(fromFile, calls) {
    if (!Array.isArray(calls)) return null
    for (const call of calls) {
      const parts = String(call).split('.')
      let rec = null
      if (parts.length > 1) {
        const alias = aliases.get(fromFile)
        const target = alias ? alias.get(parts[0]) : null
        if (target) rec = localOf(target, parts[1])
      } else {
        const imported = fromNames.get(fromFile)
        const hit = imported ? imported.get(parts[0]) : null
        if (hit) rec = localOf(hit.file, hit.name)
        if (!rec) rec = localOf(fromFile, parts[0])
      }
      if (rec && rec.file !== fromFile) return rec
    }
    return null
  }

  return { entry: entry, files: files, funcs: funcs, byName: byName, resolve: resolve }
}

/* ------------------------------ drawing ------------------------------ */

const MARKERS = ['seq', 'true', 'false', 'loop', 'merge', 'done']

/* A node group is drawn at `translate(n.x, n.y)`, while `cx`/`cy` are world
   coordinates (`place()` shifts them together with x/y).  The label is drawn
   *inside* the group, so it needs the node-local centre; getting this wrong
   shifts every label by exactly the node's own offset, which is the whole
   chart looking scrambled. */
export function labelAnchor(n) {
  return { x: n.cx - n.x, y: n.cy - n.y }
}

function nodeSvg(n) {
  const cls = 'fc-node fc-' + n.kind
    + (n.dir ? ' fc-dir-' + n.dir : '')
    + (n.sub ? ' fc-sub-' + n.sub : '')
    + (n.cross ? ' fc-cross' : '')
  const anchor = labelAnchor(n)
  const attrs = 'data-node-line="' + n.line + '" data-node-id="' + n.id
    + '" data-node-file="' + esc(n.file || '') + '" class="' + cls + '"'
  /* a linked node keeps its shape and grows a row underneath for the badge */
  const sh = n.shapeH || n.h
  let shape
  if (n.kind === 'start' || n.kind === 'end') {
    shape = '<rect x="0" y="0" width="' + n.w + '" height="' + sh + '" rx="' + sh / 2 + '"/>'
  } else if (n.kind === 'if' || n.kind === 'while' || n.kind === 'for') {
    const cx = n.w / 2
    const cy = sh / 2
    shape = '<polygon points="' + cx + ',0 ' + n.w + ',' + cy + ' ' + cx + ',' + sh + ' 0,' + cy + '"/>'
  } else if (n.kind === 'io') {
    shape = '<polygon points="' + SKEW + ',0 ' + n.w + ',0 ' + (n.w - SKEW) + ',' + sh + ' 0,' + sh + '"/>'
  } else if (n.kind === 'frame') {
    shape = '<rect x="0" y="0" width="' + n.w + '" height="' + sh + '" rx="10"/>'
  } else if (n.kind === 'func') {
    shape = '<rect x="0" y="1" width="' + n.w + '" height="' + (sh - 2) + '" rx="3"/>'
      + '<line x1="10" y1="1" x2="10" y2="' + (sh - 1) + '"/>'
      + '<line x1="' + (n.w - 10) + '" y1="1" x2="' + (n.w - 10) + '" y2="' + (sh - 1) + '"/>'
  } else if (n.kind === 'return' || n.kind === 'break' || n.kind === 'continue' || n.kind === 'more') {
    shape = '<rect x="0" y="0" width="' + n.w + '" height="' + sh + '" rx="' + Math.max(0, sh / 2 - 2) + '"/>'
  } else {
    shape = '<rect x="0" y="0" width="' + n.w + '" height="' + sh + '" rx="6"/>'
  }
  /* A frame is the box drawn around a function's whole chart: its label goes in
     the top-left corner, not in the middle — the middle is where the body is. */
  const isFrame = n.kind === 'frame'
  const tx = isFrame ? 10 : anchor.x
  const ty = isFrame ? 9 : anchor.y - (n.lines.length - 1) * LINE_H / 2
  const text = n.lines.map((l, i) => '<tspan x="' + tx + '" y="' + (ty + i * LINE_H) + '">' + esc(l) + '</tspan>').join('')
  let parts = '<title>' + esc(n.lines.join(' ')) + (n.line ? '  (line ' + n.line + ')' : '') + '</title>' + shape
    + '<text text-anchor="' + (isFrame ? 'start' : 'middle') + '" dominant-baseline="' + (isFrame ? 'hanging' : 'central') + '">' + text + '</text>'
    + '<g class="fc-hit" data-line="' + n.line + '" data-file="' + esc(n.file || '') + '">'
    + '<rect x="0" y="0" width="' + n.w + '" height="' + sh + '"/></g>'
  if (n.link) {
    const ly = sh + 2
    const lh = Math.max(LINK_H - 4, 12)
    const barW = n.expandKey ? n.w - 18 : n.w
    parts += '<g class="fc-link" data-jump="' + esc(n.link.file) + '|' + n.link.line + '">'
      + '<rect x="0" y="' + ly + '" width="' + barW + '" height="' + lh + '" rx="3"/>'
      + '<text class="fc-jumptext" x="6" y="' + (ly + lh / 2) + '" dominant-baseline="central">'
      + '↳ ' + esc(n.link.file) + ':' + n.link.line + '</text>'
      + '<title>Jump to ' + esc(n.link.name || '') + ' in ' + esc(n.link.file) + '</title></g>'
  }
  if (n.expandKey) {
    const open = ctx.expanded.has(n.expandKey)
    parts += '<g class="fc-expander" data-expand="' + esc(n.expandKey) + '">'
      + '<rect x="' + (n.w - 16) + '" y="' + (sh + 2) + '" width="14" height="' + (LINK_H - 4) + '" rx="3"/>'
      + '<text x="' + (n.w - 9) + '" y="' + (sh + 2 + (LINK_H - 4) / 2) + '" text-anchor="middle" dominant-baseline="central">'
      + (open ? '−' : '+') + '</text>'
      + '<title>' + (open ? 'Hide' : 'Inline') + ' the body of ' + esc(n.link ? n.link.name : '') + '</title></g>'
  }
  return '<g ' + attrs + ' transform="translate(' + n.x + ',' + n.y + ')">' + parts + '</g>'
}

function pathOf(points) {
  return points.map((p, i) => (i ? 'L' : 'M') + Math.round(p[0]) + ' ' + Math.round(p[1])).join(' ')
}

function edgeSvg(e) {
  if (!e.points || e.points.length < 2) return ''
  const d = pathOf(e.points)
  const out = '<path class="fc-edge fc-e-' + e.kind + '" d="' + d
    + '" data-from="' + esc(e.fromKey) + '" data-to="' + esc(e.toKey) + '"/>'
  if (!e.label) return out
  const mid = e.points[Math.floor(e.points.length / 2)]
  return out + '<text class="fc-elabel fc-l-' + e.kind + '" x="' + (mid[0] + 6) + '" y="' + (mid[1] - 4) + '">' + esc(e.label) + '</text>'
}

function svgOf(model) {
  const pad = 16
  const w = model.width + pad * 2
  const h = model.height + pad * 2
  const markers = MARKERS.map(m => '<marker id="fc-arrow-' + m + '" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
    + '<path class="fc-arrow fc-a-' + m + '" d="M0 0 L8 4 L0 8 z"/></marker>').join('')
  const frames = model.nodes.filter(n => n.kind === 'frame').map(nodeSvg).join('')
  const nodes = model.nodes.filter(n => n.kind !== 'frame').map(nodeSvg).join('')
  const edges = model.edges.map(edgeSvg).join('')
  return '<svg class="fc-svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" width="100%">'
    + '<defs>' + markers + '</defs>'
    + '<g transform="translate(' + pad + ',' + pad + ')">' + frames + edges + nodes + '</g>'
    + '</svg>'
}

/* ------------------------------ panel -------------------------------- */

const LEGEND = [
  ['fc-l-start', 'Start / End'],
  ['fc-l-if', 'Condition'],
  ['fc-l-loop', 'Loop'],
  ['fc-l-io', 'Input / Output'],
  ['fc-l-stmt', 'Statement'],
  ['fc-l-func', 'Function'],
  ['fc-l-link', 'Other file']
]

const SVG_NS = 'http://www.w3.org/2000/svg'
/* Everything the exported picture needs, frozen at its computed value so the
   file stands on its own (no stylesheet travels with it). */
const INLINE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'opacity',
  'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
  'marker-end', 'marker-start', 'marker-mid'
]

let pick = null
let built = null
let index = null
let expanded = new Set()
let scale = 1
let lastSteps = []
let lastCur = -1

/** Who to tell when the user clicks a node (app.js opens the file and highlights the line). */
export function setFlowPickHandler(fn) {
  pick = fn
}

function ensurePanel() {
  if (!panelFlow) return null
  let holder = panelFlow.querySelector('.fc-holder')
  if (holder) return holder
  panelFlow.innerHTML = [
    '<div class="fc-toolbar">',
    '<span class="fc-count" data-fc="count"></span>',
    '<span class="fc-nowline" data-fc="nowline"></span>',
    '<span class="fc-legend">',
    LEGEND.map(l => '<span class="fc-chip"><i class="fc-dot ' + l[0] + '"></i>' + esc(l[1]) + '</span>').join(''),
    '</span>',
    '<span class="fc-actions">',
    '<button class="btn ghost sm" data-fc="out" title="Zoom out">-</button>',
    '<button class="btn ghost sm" data-fc="fit" title="Fit to width">Fit</button>',
    '<button class="btn ghost sm" data-fc="in" title="Zoom in">+</button>',
    '<button class="btn ghost sm" data-fc="svg" title="Save this chart as a standalone SVG">SVG</button>',
    '<button class="btn ghost sm" data-fc="png" title="Save this chart as a PNG image">PNG</button>',
    '</span>',
    '</div>',
    '<div class="fc-holder"></div>',
    '<div class="fc-hint" data-fc="hint"></div>'
  ].join('')
  holder = panelFlow.querySelector('.fc-holder')
  on(panelFlow.querySelector('[data-fc="in"]'), 'click', () => setScale(scale * 1.25))
  on(panelFlow.querySelector('[data-fc="out"]'), 'click', () => setScale(scale / 1.25))
  on(panelFlow.querySelector('[data-fc="fit"]'), 'click', () => setScale(1))
  on(panelFlow.querySelector('[data-fc="svg"]'), 'click', saveSvg)
  on(panelFlow.querySelector('[data-fc="png"]'), 'click', savePng)
  /* One delegated listener for every node, however many times we redraw. */
  on(holder, 'click', (ev) => {
    const t = ev.target
    if (!t || !t.closest) return
    const exp = t.closest('[data-expand]')
    if (exp) {
      toggleExpand(exp.getAttribute('data-expand'))
      return
    }
    const jump = t.closest('[data-jump]')
    if (jump) {
      const bits = String(jump.getAttribute('data-jump')).split('|')
      if (pick) pick({ file: bits[0] || '', line: Number(bits[1]) || 0 })
      return
    }
    const hit = t.closest('[data-line]')
    if (!hit || !pick) return
    const line = Number(hit.getAttribute('data-line'))
    if (line > 0) pick({ file: hit.getAttribute('data-file') || '', line: line })
  })
  return holder
}

function setScale(v) {
  scale = Math.min(Math.max(v, 0.25), 4)
  const holder = ensurePanel()
  const svg = holder && holder.querySelector('svg')
  if (svg) svg.setAttribute('width', Math.round(scale * 100) + '%')
}

function say(text) {
  const el = panelFlow && panelFlow.querySelector('[data-fc="hint"]')
  if (el) el.textContent = text
}

function setText(sel, text) {
  const el = panelFlow && panelFlow.querySelector(sel)
  if (el) el.textContent = text
}

export function clearFlowchart(message) {
  built = null
  index = null
  expanded = new Set()
  const holder = ensurePanel()
  if (!holder) return
  holder.innerHTML = ''
  say(message || 'Run the program to chart its control flow.')
  setText('[data-fc="count"]', '')
  setText('[data-fc="nowline"]', '')
}

function normaliseParsed(parsed) {
  if (!parsed) return null
  if (parsed.files) return parsed
  return { entry: 'main.py', files: { 'main.py': parsed } }
}

/** Paint a parsed project (`{ entry, files }`) or an error message. */
export function renderFlowchart(parsed) {
  const holder = ensurePanel()
  if (!holder) return
  const project = normaliseParsed(parsed)
  if (!project) {
    clearFlowchart()
    return
  }
  index = buildCallIndex(project)
  const entryData = index.files[index.entry] || {}
  if (entryData.error && entryData.error.message) {
    built = null
    holder.innerHTML = ''
    say('Syntax error' + (entryData.error.line ? ' on line ' + entryData.error.line : '') + ': ' + entryData.error.message)
    setText('[data-fc="count"]', '')
    return
  }
  if (!entryData.tree || !entryData.tree.length) {
    built = null
    holder.innerHTML = ''
    say('Nothing to chart — the entry file has no statements yet.')
    setText('[data-fc="count"]', '')
    return
  }
  expanded = new Set()
  paint()
}

/* Rebuild the picture from the model we already have (used after an inlining
   toggle, where only `expanded` changed). */
function paint() {
  const holder = ensurePanel()
  if (!holder || !index) return
  const entryData = index.files[index.entry]
  if (!entryData || !entryData.tree) return
  const model = buildFlowLayout(entryData.tree, {
    file: index.entry,
    resolve: index.resolve,
    expanded: expanded
  })
  built = model
  holder.innerHTML = svgOf(model)
  setScale(scale)
  const nodes = model.nodes.filter(n => n.kind !== 'frame').length
  const links = model.nodes.filter(n => n.link).length
  const linkText = links ? ' · ' + links + ' call link' + (links > 1 ? 's' : '') : ''
  setText('[data-fc="count"]', nodes + ' nodes · ' + model.edges.length + ' edges' + linkText)
  say('↳ jumps to another file · + inlines its body · click any node for its line.')
  applySync()
}

function toggleExpand(key) {
  if (!key) return
  if (expanded.has(key)) expanded.delete(key)
  else expanded.add(key)
  paint()
}

/* ------------------------------- sync -------------------------------- */

/** Light up the node the tracer is on and every edge already walked. */
export function syncFlowStep(steps, cur) {
  lastSteps = Array.isArray(steps) ? steps : []
  lastCur = typeof cur === 'number' ? cur : -1
  applySync()
}

function applySync() {
  const holder = ensurePanel()
  if (!holder) return
  const step = lastCur >= 0 ? lastSteps[lastCur] : null
  setText('[data-fc="nowline"]', step ? (step.F || '') + ' : ' + step.l : '')
  if (!built) return
  const upto = lastCur >= 0 ? lastSteps.slice(0, lastCur + 1) : []
  const pairs = new Set()
  for (let i = 1; i < upto.length; i++) pairs.add(keyOfStep(upto[i - 1]) + '>' + keyOfStep(upto[i]))
  const seen = new Set(upto.map(keyOfStep))
  const nowKey = keyOfStep(step)

  holder.querySelectorAll('[data-node-line]').forEach((el) => {
    const key = (el.getAttribute('data-node-file') || '') + ':' + el.getAttribute('data-node-line')
    const isNow = !!step && key === nowKey
    el.classList.toggle('fc-now', isNow)
    el.classList.toggle('fc-done', !isNow && seen.has(key))
  })
  holder.querySelectorAll('.fc-edge[data-from]').forEach((el) => {
    const key = el.getAttribute('data-from') + '>' + el.getAttribute('data-to')
    el.classList.toggle('fc-e-done', pairs.has(key))
  })
  const now = holder.querySelector('.fc-now')
  if (now && typeof now.scrollIntoView === 'function') now.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function keyOfStep(s) {
  return s ? ((s.F || '') + ':' + s.l) : '0:0'
}

/* ------------------------------- export ------------------------------ */

function opaqueBackground(el) {
  let n = el
  while (n && n.nodeType === 1) {
    const c = window.getComputedStyle(n).backgroundColor
    if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return c
    n = n.parentElement
  }
  return '#ffffff'
}

/* Clone the live SVG and freeze every computed presentation value into inline
   styles, so the result renders the same way without our stylesheet. */
function snapshotSvg() {
  const holder = ensurePanel()
  const src = holder && holder.querySelector('svg.fc-svg')
  if (!src) return null
  const dst = src.cloneNode(true)
  const a = src.querySelectorAll('*')
  const b = dst.querySelectorAll('*')
  for (let i = 0; i < a.length && i < b.length; i++) {
    const cs = window.getComputedStyle(a[i])
    for (const p of INLINE_PROPS) {
      const v = cs.getPropertyValue(p)
      if (v) b[i].style.setProperty(p, v)
    }
    b[i].removeAttribute('class')
  }
  const vb = String(src.getAttribute('viewBox') || '0 0 0 0').split(/[\s,]+/).map(Number)
  const w = Math.max(1, Math.round(vb[2] || 0))
  const h = Math.max(1, Math.round(vb[3] || 0))
  dst.setAttribute('xmlns', SVG_NS)
  dst.setAttribute('width', String(w))
  dst.setAttribute('height', String(h))
  dst.removeAttribute('class')
  const bg = document.createElementNS(SVG_NS, 'rect')
  bg.setAttribute('x', '0')
  bg.setAttribute('y', '0')
  bg.setAttribute('width', String(w))
  bg.setAttribute('height', String(h))
  bg.setAttribute('fill', opaqueBackground(holder))
  dst.insertBefore(bg, dst.firstChild)
  return { markup: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(dst), w: w, h: h }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function saveSvg() {
  const snap = snapshotSvg()
  if (!snap) {
    say('Nothing to export yet — press Run first.')
    return
  }
  download(new Blob([snap.markup], { type: 'image/svg+xml;charset=utf-8' }), exportName('svg'))
  say('Saved the chart as ' + exportName('svg') + '.')
}

function savePng() {
  const snap = snapshotSvg()
  if (!snap) {
    say('Nothing to export yet — press Run first.')
    return
  }
  const k = 2
  const blob = new Blob([snap.markup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.onload = function () {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(snap.w * k)
    canvas.height = Math.round(snap.h * k)
    const g = canvas.getContext('2d')
    g.scale(k, k)
    g.drawImage(img, 0, 0)
    URL.revokeObjectURL(url)
    canvas.toBlob(function (out) {
      if (out) download(out, exportName('png'))
      say(out ? 'Saved the chart as ' + exportName('png') + '.' : 'The browser refused to encode a PNG.')
    }, 'image/png')
  }
  img.onerror = function () {
    URL.revokeObjectURL(url)
    say('This browser could not rasterize the chart — use SVG instead.')
  }
  img.src = url
}

function exportName(ext) {
  const entry = (index && index.entry) || 'main'
  return stemOf(entry).replace(/[^\w.-]+/g, '_') + '.flowchart.' + ext
}
