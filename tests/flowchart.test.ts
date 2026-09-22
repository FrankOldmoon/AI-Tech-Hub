import { describe, expect, it } from 'vitest'
import { buildCallIndex, buildFlowLayout, labelAnchor } from '../app/program-world/flowchart'

/**
 * 流程图布局的纯函数测试。
 *
 * 结构树由 pyworker.js 里的 FLOW_PY 解析 Python 源码产出，形状就是下面这些字面量。
 * 这里盯三件事：
 * 1. 分层布局正确 —— 顺序纵排、分支左右分叉再汇合、循环回边绕到左侧；
 * 2. 节点框不重叠（图能看）；
 * 3. **每条边都带端点的源码行号** —— 「逐步执行联动」就是靠它把走到的边点亮。
 */
type Tree = Record<string, unknown>

const stmt = (text: string, line: number): Tree => ({ kind: 'stmt', text, line })
const io = (text: string, line: number, dir: string): Tree => ({ kind: 'io', text, line, dir })
const iff = (test: string, line: number, body: Tree[], orelse?: Tree[]): Tree =>
  ({ kind: 'if', line, branches: [{ test, line, body }], ...(orelse ? { orelse } : {}) })
const loop = (test: string, line: number, body: Tree[]): Tree => ({ kind: 'while', line, test, body })

describe('buildFlowLayout', () => {
  it('首尾是 Start/End，中间顺序纵排且同列居中', () => {
    const m = buildFlowLayout([stmt('a = 1', 1), stmt('b = 2', 2)])
    const kinds = m.nodes.map(n => n.kind)
    expect(kinds[0]).toBe('start')
    expect(kinds[kinds.length - 1]).toBe('end')

    const a = m.nodes.find(n => n.line === 1)!
    const b = m.nodes.find(n => n.line === 2)!
    expect(b.y).toBeGreaterThan(a.y)
    expect(a.cx).toBe(b.cx)
    expect(m.height).toBeGreaterThan(0)
  })

  it('if/else 左右分叉再汇合，真分支在左、假分支在右', () => {
    const m = buildFlowLayout([iff('x > 0', 1, [stmt('yes()', 2)], [stmt('no()', 4)])])
    const yes = m.nodes.find(n => n.line === 2)!
    const no = m.nodes.find(n => n.line === 4)!
    expect(yes.y).toBe(no.y)
    expect(yes.cx).toBeLessThan(no.cx)

    const kinds = m.edges.map(e => e.kind)
    expect(kinds).toContain('true')
    expect(kinds).toContain('false')
    expect(kinds.filter(k => k === 'merge').length).toBe(2)
  })

  it('循环的回边绕到条件左侧，并标成 loop（流动虚线用它上色）', () => {
    const m = buildFlowLayout([loop('i < 3', 1, [stmt('i += 1', 2)])])
    const back = m.edges.find(e => e.kind === 'loop')!
    expect(back).toBeTruthy()

    const dia = m.nodes.find(n => n.kind === 'while')!
    const xs = back.points.map(p => p[0])
    expect(Math.min(...xs)).toBeLessThan(dia.x)
    expect(back.points[back.points.length - 1][0]).toBeCloseTo(dia.x, 0)
  })

  it('节点框互不重叠（frame 除外，它本来就包住子节点）', () => {
    const m = buildFlowLayout([
      stmt('a = 1', 1),
      iff('a', 2, [loop('a < 3', 3, [stmt('a += 1', 4)])], [io('print(a)', 5, 'out')]),
      { kind: 'func', sub: 'def', line: 6, name: 'f', args: 'x', body: [stmt('return x', 7)] }
    ])
    const boxes = m.nodes.filter(n => n.kind !== 'frame')
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
        expect(apart, `${a.kind}@line${a.line} 与 ${b.kind}@line${b.line} 重叠`).toBe(true)
      }
    }
  })

  it('每条边都带端点源码行号，能对上「行→行」的跃迁', () => {
    const m = buildFlowLayout([stmt('a = 1', 1), iff('a', 2, [stmt('b = 2', 3)])])
    for (const e of m.edges) {
      expect(typeof e.fromLine, `${e.kind} 缺 fromLine`).toBe('number')
      expect(typeof e.toLine, `${e.kind} 缺 toLine`).toBe('number')
    }
    // 顺序边：第 1 行 → 第 2 行（逐步执行的相邻两步就是这个跃迁）
    const pair = m.edges.find(e => e.fromLine === 1 && e.toLine === 2)
    expect(pair, '找不到 1→2 的顺序边').toBeTruthy()
  })

  it('每个坐标都是有限数（NaN 会让 SVG 路径直接画不出来）', () => {
    const m = buildFlowLayout([
      { kind: 'func', sub: 'def', line: 1, name: 'total', args: 'n', body: [
        stmt('s = 0', 2),
        { kind: 'for', line: 3, target: 'i', iter: 'range(1, n + 1)', body: [stmt('s = s + i', 4)] },
        { kind: 'return', line: 5, text: 'return s' }
      ] },
      stmt('x = int(input())', 7),
      iff('x > 0', 8, [io('print(total(x))', 9, 'out')], [io('print("nope")', 11, 'out')])
    ])
    for (const n of m.nodes) {
      for (const k of ['x', 'y', 'w', 'h', 'cx', 'cy'] as const) {
        expect(Number.isFinite(n[k]), `节点 ${n.kind}@${n.line} 的 ${k} 不是有限数：${n[k]}`).toBe(true)
      }
    }
    for (const e of m.edges) {
      expect(Array.isArray(e.points), `边 ${e.kind} 的 points 不是数组`).toBe(true)
      e.points.forEach((p, i) => {
        expect(Array.isArray(p) && p.length === 2, `边 ${e.kind} 的第 ${i} 个点不是 [x, y]：${JSON.stringify(p)}`).toBe(true)
        expect(Number.isFinite(p[0]) && Number.isFinite(p[1]), `边 ${e.kind} 的第 ${i} 个点：${p}`).toBe(true)
      })
    }
  })

  it('空程序也能出图（只有 Start/End）', () => {
    const m = buildFlowLayout([])
    expect(m.nodes.map(n => n.kind)).toEqual(['start', 'end'])
    expect(m.edges.length).toBe(1)
  })

  it('把来源文件盖到节点上（点击才开得对文件）', () => {
    const m = buildFlowLayout([stmt('a = 1', 1)], { file: 'main.py' })
    expect(m.nodes.every(n => n.file === 'main.py')).toBe(true)
    expect(m.nodes.every(n => n.cross === false)).toBe(true)
  })

  it('边也带 file:line 键，跨文件步骤才对得上', () => {
    const m = buildFlowLayout([stmt('a = 1', 1), stmt('b = 2', 2)], { file: 'main.py' })
    for (const e of m.edges) {
      expect(e.fromKey).toMatch(/^(main\.py:\d+|0:0)$/)
      expect(e.toKey).toMatch(/^(main\.py:\d+|0:0)$/)
    }
  })

  it('标签锚点是节点自己坐标系里的中心（组已经 translate 过，不能再加一次偏移）', () => {
    const m = buildFlowLayout([
      stmt('a = 1', 1),
      iff('a', 2, [loop('a < 3', 3, [stmt('a += 1', 4)])]),
      { kind: 'func', sub: 'def', line: 6, name: 'f', args: 'x', body: [stmt('return x', 7)] }
    ], { file: 'main.py' })
    expect(m.nodes.length).toBeGreaterThan(8)
    for (const n of m.nodes) {
      const a = labelAnchor(n)
      expect(a.x, `${n.kind}@line${n.line} 的标签 x 不是本地中心`).toBeCloseTo(n.w / 2, 6)
      expect(a.y, `${n.kind}@line${n.line} 的标签 y 不是本地中心`).toBeCloseTo((n.shapeH || n.h) / 2, 6)
    }
  })
})

/* =====================================================================
   跨文件：`helper.total(...)` 要连到 helper.py 里那个 `total`。
   ===================================================================== */

type ParsedFile = {
  error: { line: number, message: string } | null
  imports: Tree[]
  tree: Tree[]
}
type Parsed = {
  entry: string
  files: Record<string, ParsedFile>
}

function makeProject(): Parsed {
  return {
    entry: 'main.py',
    files: {
      'main.py': {
        error: null,
        imports: [{ module: 'helper', alias: 'helper', names: [] }],
        tree: [
          { kind: 'stmt', line: 1, text: 'import helper', calls: [] },
          { kind: 'stmt', line: 3, text: 'marks = helper.read("data.txt")', calls: ['helper.read'] },
          { kind: 'io', line: 4, dir: 'out', text: 'print(helper.total(marks))', calls: ['print', 'helper.total'] }
        ]
      },
      'helper.py': {
        error: null,
        imports: [],
        tree: [
          { kind: 'func', sub: 'def', line: 1, name: 'total', args: 'marks', body: [
            { kind: 'stmt', line: 2, text: 'got = 0', calls: [] },
            { kind: 'return', line: 3, text: 'return got', calls: [] }
          ] },
          { kind: 'func', sub: 'def', line: 6, name: 'read', args: 'path', body: [
            { kind: 'return', line: 7, text: 'return []', calls: [] }
          ] }
        ]
      }
    }
  }
}

function entryTree(idx: Parsed) {
  return idx.files[idx.entry].tree
}

describe('buildCallIndex', () => {
  it('把每个节点盖上所属文件名', () => {
    const idx = buildCallIndex(makeProject())
    expect(entryTree(idx)[0].file).toBe('main.py')
    expect(idx.files['helper.py'].tree[0].file).toBe('helper.py')
  })

  it('helper.total 解析到 helper.py 里的定义', () => {
    const idx = buildCallIndex(makeProject())
    const rec = idx.resolve('main.py', ['helper.total'])
    expect(rec).toBeTruthy()
    expect(rec.file).toBe('helper.py')
    expect(rec.name).toBe('total')
    expect(rec.line).toBe(1)
  })

  it('from-import 的名字也能解析到那个文件', () => {
    const p = makeProject()
    p.files['main.py'].imports = [{ module: 'helper', alias: '', names: ['total'] }]
    const idx = buildCallIndex(p)
    const rec = idx.resolve('main.py', ['total'])
    expect(rec).toBeTruthy()
    expect(rec.file).toBe('helper.py')
  })

  it('解析不到的（内建、第三方）和同文件内的调用都不连', () => {
    const idx = buildCallIndex(makeProject())
    expect(idx.resolve('main.py', ['print', 'range'])).toBe(null)
    const p = makeProject()
    p.files['main.py'].tree.push({ kind: 'func', sub: 'def', line: 9, name: 'local', args: '', body: [] })
    p.files['main.py'].tree.push({ kind: 'stmt', line: 12, text: 'local()', calls: ['local'] })
    const idx2 = buildCallIndex(p)
    expect(idx2.resolve('main.py', ['local'])).toBe(null)
  })
})

describe('buildFlowLayout 跨文件联动', () => {
  it('跨文件调用让节点长出一行链接，形状本身不改高', () => {
    const idx = buildCallIndex(makeProject())
    const m = buildFlowLayout(entryTree(idx), { file: 'main.py', resolve: idx.resolve })
    const linked = m.nodes.filter(n => n.link)
    expect(linked.length).toBe(2)
    for (const n of linked) {
      expect(n.shapeH).toBeLessThan(n.h)
      expect(n.link.file).toBe('helper.py')
      expect(n.expandKey).toBe('helper.py:' + n.link.line)
    }
  })

  it('展开后把被调函数的图内联进来，别的文件的节点标成 cross', () => {
    const idx = buildCallIndex(makeProject())
    const collapsed = buildFlowLayout(entryTree(idx), { file: 'main.py', resolve: idx.resolve })
    const key = collapsed.nodes.find(n => n.expandKey).expandKey
    const opened = buildFlowLayout(entryTree(idx), {
      file: 'main.py',
      resolve: idx.resolve,
      expanded: new Set([key])
    })
    expect(opened.nodes.length).toBeGreaterThan(collapsed.nodes.length)
    const cross = opened.nodes.filter(n => n.cross)
    expect(cross.length).toBeGreaterThan(0)
    for (const n of cross) expect(n.file).toBe('helper.py')
    expect(opened.nodes.some(n => n.kind === 'func' && n.file === 'helper.py')).toBe(true)
    for (const n of opened.nodes) {
      for (const k of ['x', 'y', 'w', 'h', 'cx', 'cy']) {
        expect(Number.isFinite(n[k]), `${n.kind}@${n.file}:${n.line} 的 ${k} 不是有限数`).toBe(true)
      }
    }
    // 内联进来的子图也不能和外面的节点叠在一起（frame 本来就包住子节点）
    const boxes = opened.nodes.filter(n => n.kind !== 'frame')
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
        expect(apart, `${a.kind}@${a.file}:${a.line} 与 ${b.kind}@${b.file}:${b.line} 重叠`).toBe(true)
      }
    }
  })

  it('带 ↳ 徽标的节点，标签仍然居中在形状里（而不是整个加高后的框）', () => {
    const idx = buildCallIndex(makeProject())
    const m = buildFlowLayout(entryTree(idx), { file: 'main.py', resolve: idx.resolve })
    const linked = m.nodes.filter(n => n.link)
    expect(linked.length).toBeGreaterThan(0)
    for (const n of linked) {
      const a = labelAnchor(n)
      expect(a.y).toBeCloseTo(n.shapeH / 2, 6)
      expect(a.y).toBeLessThan(n.h / 2)
    }
  })

  it('两个文件互相调用时展开会停下来（不会无限递归）', () => {
    const p: Parsed = {
      entry: 'a.py',
      files: {
        'a.py': { error: null, imports: [{ module: 'b', alias: 'b', names: [] }], tree: [
          { kind: 'func', sub: 'def', line: 1, name: 'f', args: '', body: [{ kind: 'stmt', line: 2, text: 'b.g()', calls: ['b.g'] }] }
        ] },
        'b.py': { error: null, imports: [{ module: 'a', alias: 'a', names: [] }], tree: [
          { kind: 'func', sub: 'def', line: 1, name: 'g', args: '', body: [{ kind: 'stmt', line: 2, text: 'a.f()', calls: ['a.f'] }] }
        ] }
      }
    }
    const idx = buildCallIndex(p)
    const m = buildFlowLayout(entryTree(idx), {
      file: 'a.py',
      resolve: idx.resolve,
      expanded: new Set(['a.py:1', 'b.py:1'])
    })
    expect(m.nodes.length).toBeLessThan(60)
    for (const n of m.nodes) expect(Number.isFinite(n.y)).toBe(true)
  })
})
