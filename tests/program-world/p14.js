console.log('===== PART 29: value provenance (increment 14) =====')
/* b = a + a 不该凭空出现：两枚带着 a 的值的小圆点从 a 飞进 b。
   d = c 则是引用：一枚标记「🔗」的点飞过去，两张卡片之间再连一条常驻的线。
   来源、对象身份这些都从 trace 的 x（右值变量名）和 v 的第三个字段（objid）
   一路流到 analysis，再流到 render。 */
var MOD = 9001
setSource('a = 1\nb = a + a\nc = [1, 2]\nd = c\nd.append(3)\npass\n')
buildTimeline({
  steps: [
    { e: 'line', l: 1, f: '<module>', i: MOD, d: 0, v: {} },
    { e: 'line', l: 2, f: '<module>', i: MOD, d: 0, v: { a: ['int', '1'] }, x: ['a', 'a'] },
    { e: 'line', l: 3, f: '<module>', i: MOD, d: 0, v: { a: ['int', '1'], b: ['int', '2'] } },
    { e: 'line', l: 4, f: '<module>', i: MOD, d: 0, v: { a: ['int', '1'], b: ['int', '2'], c: ['list', '[1, 2]', 'o1'] }, x: ['c'] },
    { e: 'line', l: 5, f: '<module>', i: MOD, d: 0, v: { a: ['int', '1'], b: ['int', '2'], c: ['list', '[1, 2]', 'o1'], d: ['list', '[1, 2]', 'o1'] } },
    { e: 'line', l: 6, f: '<module>', i: MOD, d: 0, v: { a: ['int', '1'], b: ['int', '2'], c: ['list', '[1, 2, 3]', 'o1'], d: ['list', '[1, 2, 3]', 'o1'] } }
  ],
  chunks: [], error: null, truncated: false
})
function chIn(i, nm) { for (const c of scenes[i].chars) if (c.name === nm) return c; return null }

var bCh = chIn(2, 'b')
eq(bCh && bCh.sources ? bCh.sources.join(',') : 'none', 'a,a', 'FL1. b = a + a records both reads as its source')
var dCh = chIn(4, 'd')
var cCh = chIn(4, 'c')
eq(dCh && dCh.sources ? dCh.sources.join(',') : 'none', 'c', 'FL2. d = c records c as its source')
eq(dCh && cCh && dCh.objTok && dCh.objTok === cCh.objTok ? 'shared' : 'apart', 'shared', 'FL3. d and c carry the same object token')
eq(cCh && cCh.shares && cCh.shares.indexOf('d') >= 0 ? 'yes' : 'no', 'yes', 'FL4. c knows it shares with d')
eq(dCh && dCh.shares && dCh.shares.indexOf('c') >= 0 ? 'yes' : 'no', 'yes', 'FL5. d knows it shares with c')

if (!soundEnabled()) toggleSound()
resetWorld()
syncArena(scenes[1], null, 'tween')
clearTones()
syncArena(scenes[2], scenes[1], 'tween')
var pips = flowLayerEl.querySelectorAll('.flow-pip')
eq(pips.length, 2, 'FL6. b = a + a draws two source pips')
eq(pips[0].getAttribute('data-from') + '>' + pips[0].getAttribute('data-to'), 'f1:a>f1:b', 'FL7. the source pips run a -> b')
eq(pips[0].getAttribute('data-kind'), 'copy', 'FL8. an immutable value is copied, not aliased')
eq(tones.indexOf(TONES.flow[0]) >= 0 ? 'flow' : 'silent', 'flow', 'FL9. the merge plays the flow tone')

syncArena(scenes[3], scenes[2], 'tween')
clearTones()
syncArena(scenes[4], scenes[3], 'tween')
var refs = flowLayerEl.querySelectorAll('.flow-pip[data-kind="ref"]')
eq(refs.length, 1, 'FL10. d = c draws one reference pip')
eq(refs[0].getAttribute('data-from') + '>' + refs[0].getAttribute('data-to'), 'f1:c>f1:d', 'FL11. the reference pip runs c -> d')
eq(flowLayerEl.querySelectorAll('.flow-link').length, 1, 'FL12. a permanent link joins the two names')
var chip = flowLayerEl.querySelector('.flow-link-chip')
eq(chip && chip.textContent.indexOf('\uD83D\uDD17') >= 0 ? 'link' : (chip ? chip.textContent : 'none'), 'link', 'FL13. the link is labelled as a shared object')
eq(actorNodes.get('f1:d').el._cls.has('shared') ? 'shared' : 'plain', 'shared', 'FL14. the target actor is marked shared')
eq(tones.indexOf(TONES.ref[0]) >= 0 ? 'ref' : 'silent', 'ref', 'FL15. the reference plays its own tone')

console.log('===== PART 30: every step animation has a voice (increment 14) =====')
/* 只有角色变化的步骤才会响 create/change，其余步骤（判断、循环、函数进出、
   break、容器变化）过去全程静音。这里逐类验证它们各自有声音。 */
eq(['create', 'change', 'retire', 'combat', 'output', 'error', 'cond', 'loop', 'call', 'ret', 'ctl', 'bag', 'flow', 'ref'].every(function (k) { return !!TONES[k] }) ? 'all' : 'missing', 'all', 'SD1. every step kind maps to a tone')

setSource('ready = True\nif ready:\n    n = 1\n')
buildTimeline({
  steps: [
    { e: 'line', l: 1, f: '<module>', i: 9100, d: 0, v: {} },
    { e: 'line', l: 2, f: '<module>', i: 9100, d: 0, v: { ready: ['bool', 'True'] } },
    { e: 'line', l: 3, f: '<module>', i: 9100, d: 0, v: { ready: ['bool', 'True'], n: ['int', '1'] } }
  ],
  chunks: [], error: null, truncated: false
})
resetWorld(); clearTones(); renderStage(1, 0, 'tween')
eq(tones.indexOf(TONES.cond[0]) >= 0 ? 'cond' : 'silent', 'cond', 'SD2. an if-condition makes a sound')

setSource('for k in range(2):\n    pass\n')
buildTimeline({
  steps: [
    { e: 'line', l: 1, f: '<module>', i: 9200, d: 0, v: {} },
    { e: 'line', l: 2, f: '<module>', i: 9200, d: 0, v: { k: ['int', '0'] } },
    { e: 'line', l: 1, f: '<module>', i: 9200, d: 0, v: { k: ['int', '0'] } }
  ],
  chunks: [], error: null, truncated: false
})
resetWorld(); clearTones(); renderStage(0, -1, 'tween')
eq(tones.indexOf(TONES.loop[0]) >= 0 ? 'loop' : 'silent', 'loop', 'SD3. a loop round makes a sound')

setSource('def f():\n    return 7\nf()\n')
buildTimeline({
  steps: [
    { e: 'line', l: 1, f: '<module>', i: 9300, d: 0, v: {} },
    { e: 'call', l: 3, f: 'f', i: 9301, d: 1, v: {} },
    { e: 'line', l: 2, f: 'f', i: 9301, d: 1, v: {} },
    { e: 'return', l: 2, f: 'f', i: 9301, d: 1, v: {}, r: '7' }
  ],
  chunks: [], error: null, truncated: false
})
resetWorld(); clearTones(); renderStage(1, 0, 'tween')
eq(tones.indexOf(TONES.call[0]) >= 0 ? 'call' : 'silent', 'call', 'SD4. entering a function makes a sound')
resetWorld(); clearTones(); renderStage(3, 2, 'tween')
eq(tones.indexOf(TONES.ret[0]) >= 0 ? 'ret' : 'silent', 'ret', 'SD5. returning from a function makes a sound')

setSource('break\n')
buildTimeline({
  steps: [{ e: 'line', l: 1, f: '<module>', i: 9400, d: 0, v: {} }],
  chunks: [], error: null, truncated: false
})
resetWorld(); clearTones(); renderStage(0, -1, 'tween')
eq(tones.indexOf(TONES.ctl[0]) >= 0 ? 'ctl' : 'silent', 'ctl', 'SD6. break / continue makes a sound')

setSource('items = [1, 2]\nitems.append(3)\nx = 1\n')
buildTimeline({
  steps: [
    { e: 'line', l: 1, f: '<module>', i: 9500, d: 0, v: {} },
    { e: 'line', l: 2, f: '<module>', i: 9500, d: 0, v: { items: ['list', '[1, 2]'] } },
    { e: 'line', l: 3, f: '<module>', i: 9500, d: 0, v: { items: ['list', '[1, 2, 3]'], x: ['int', '1'] } }
  ],
  chunks: [], error: null, truncated: false
})
resetWorld(); clearTones(); renderStage(2, 1, 'tween')
eq(tones.indexOf(TONES.bag[0]) >= 0 ? 'bag' : 'silent', 'bag', 'SD7. a container mutation makes a sound')
if (soundEnabled()) toggleSound()
console.log(fails === 0 ? 'INCREMENT-14 TESTS PASSED' : ('INCREMENT-14 FAILURES: ' + fails))
