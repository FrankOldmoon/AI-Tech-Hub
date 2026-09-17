console.log('===== PART 15: condition expression model (increment 7) =====')
function tree(expr) { return parseCondition(expr) }
function partsOf(expr) { const t = tree(expr); return t ? collectCompares(t).map(function (p) { return p.left + ' ' + p.op + ' ' + p.right }).join(' | ') : 'null' }
eq(tree('a > 1').kind, 'compare', 'W1. single comparison')
eq(tree('a > 1 and b < 2').kind, 'and', 'W2. and tree')
eq(tree('a > 1 or b < 2').kind, 'or', 'W3. or tree')
eq(tree('a > 1 and b < 2 or c == 3').kind, 'or', 'W4. or binds looser than and')
eq(tree('not (a > 1)').kind, 'not', 'W5. not tree')
eq(tree('flag') === null ? 'null' : 'tree', 'null', 'W6. bare truthiness stays unvisualised (as before)')
eq(partsOf('a > 1 and b < 2'), 'a > 1 | b < 2', 'W7. two compare parts')
eq(partsOf('a < b < c'), 'a < b | b < c', 'W8. chained comparison desugars into two compares sharing the middle operand')
eq(partsOf('x in nums'), 'x in nums', 'W9. membership operator parsed')
eq(partsOf('x not in nums'), 'x not in nums', 'W10. not-in operator parsed')
eq(partsOf('len(nums) > 0'), 'len(nums) > 0', 'W11. len() call as an operand')
eq(partsOf('(a + 1) > b'), '(a + 1) > b', 'W12. parenthesised arithmetic operand survives')
eq(partsOf('name == \'a and b\''), 'name == \'a and b\'', 'W13. keyword inside a string is not split')
eq(partsOf('a > 1 and b > 2 and c > 3'), 'a > 1 | b > 2 | c > 3', 'W14. three-way and')

buildTimeline({
  steps: [
    { e: 'line', l: 1, f: '<module>', i: 5001, d: 0, v: { hp: ['int', '30'], mp: ['int', '5'], flag: ['bool', 'True'] } },
    { e: 'line', l: 2, f: '<module>', i: 5001, d: 0, v: { hp: ['int', '30'], mp: ['int', '5'], flag: ['bool', 'True'] } },
    { e: 'line', l: 5, f: '<module>', i: 5001, d: 0, v: { hp: ['int', '30'], mp: ['int', '5'], flag: ['bool', 'True'] } }
  ],
  chunks: [], error: null, truncated: false
})
setSource('hp = 30\nif hp > 50 and mp < 10:\n    pass\nelse:\n    hp = 1\n')
var MOD7 = 5002
buildTimeline({
  steps: [
    { e: 'line', l: 1, f: '<module>', i: MOD7, d: 0, v: { hp: ['int', '30'], mp: ['int', '5'] } },
    { e: 'line', l: 2, f: '<module>', i: MOD7, d: 0, v: { hp: ['int', '30'], mp: ['int', '5'] } },
    { e: 'line', l: 3, f: '<module>', i: MOD7, d: 0, v: { hp: ['int', '30'], mp: ['int', '5'] } }
  ],
  chunks: [], error: null, truncated: false
})
var cb = scenes[1].combat
eq(cb ? cb.parts.length : -1, 2, 'X1. multi-condition produces two VS parts')
eq(cb && cb.parts[0].expr, 'hp > 50', 'X2. first part expression')
eq(cb && cb.parts[0].ok, false, 'X3. sub-condition truth computed (30 > 50 is false)')
eq(cb && cb.parts[1].ok, true, 'X4. sub-condition truth computed (5 < 10 is true)')
eq(cb && cb.parts[0].left.id, 'f1:hp', 'X5. operand resolved to a real entity')
eq(cb && cb.parts[0].right.isChar, false, 'X6. literal operand stays a ghost/literal')
eq(cb && cb.op, '>', 'X7. backward-compatible op (first part)')
eq(cb && cb.branch, 'true', 'X8. branch comes from real control flow (if-body executed), not from re-evaluating the expression')
eq(vsOpLabel(cb), 'AND', 'X9. multi-part joins show AND')
eq(vsChainHTML(cb).indexOf('vs-chip ok') >= 0 ? 'ok-lamp' : 'missing', 'ok-lamp', 'X10. true sub-condition lights green')
eq(vsChainHTML(cb).indexOf('vs-chip bad') >= 0 ? 'bad-lamp' : 'missing', 'bad-lamp', 'X11. false sub-condition lights red')
var single = scenes[0].combat
if (!single) {
  single = { tree: { kind: 'compare' }, parts: [{ left: { name: 'a' }, right: { name: 'b' }, op: '>', ok: true, expr: 'a > b' }], op: '>', left: { name: 'a' }, right: { name: 'b' } }
}
eq(vsChainHTML({ parts: [single.parts[0]] }), '', 'X12. single condition renders no chain strip')
eq(vsOpLabel({ parts: [single.parts[0]], op: '>' }), '>', 'X13. single condition keeps the raw operator')
eq(vsOpLabel({ parts: [1, 2], tree: { kind: 'or' }, op: '>' }), 'OR', 'X14. or tree labelled OR')
eq(vsOpLabel({ parts: [1], tree: { kind: 'not' }, op: '>' }), 'NOT', 'X15. not tree labelled NOT')
eq(bannerText(scenes[1]).kind, 'Combat', 'X16. multi-condition banner stays a Combat event')
eq(bannerText(scenes[1]).text.indexOf('hp > 50 and mp < 10') >= 0 ? 'has-expr' : bannerText(scenes[1]).text, 'has-expr', 'X17. banner shows the full expression')
console.log(fails === 0 ? 'INCREMENT-7 TESTS PASSED' : ('INCREMENT-7 FAILURES: ' + fails))
