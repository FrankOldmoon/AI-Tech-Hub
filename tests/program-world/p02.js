console.log('===== PART 14: multi-frame scopes (increment 6) =====')
setSource('hp = 100\nif hp > 50:\n    n = 1\ndef f():\n    y = 2\n    z = 3\n')
buildTimeline({
  steps: [
    { e: 'line', l: 1, f: '<module>', i: 4001, d: 0, v: { hp: ['int', '100'] } },
    { e: 'call', l: 4, f: 'f', i: 4002, d: 1, v: { hp: ['int', '30'] } },
    { e: 'line', l: 2, f: 'f', i: 4002, d: 1, v: { hp: ['int', '30'] } },
    { e: 'line', l: 5, f: 'f', i: 4002, d: 1, v: { hp: ['int', '30'] } }
  ],
  chunks: [], error: null, truncated: false
})
function charIn(i, id) { for (const c of scenes[i].chars) if (c.id === id) return c; return null }
function namesAt(i) { return scenes[i].chars.map(function (c) { return c.id + (c.isOuter ? '*' : '') }).join(',') }
eq(namesAt(0), 'f1:hp', 'V1. single frame: one entity, nothing flagged outer')
eq(namesAt(2), 'f1:hp*,f2:hp', 'V2. inner frame still shows the module entity (it no longer vanishes)')
eq(charIn(2, 'f1:hp').isOuter, true, 'V3. outer frame entity flagged')
eq(charIn(2, 'f2:hp').isOuter, false, 'V4. inner frame entity not flagged')
eq(charIn(2, 'f1:hp').scopeName, '<module>', 'V5. outer carries its frame name')
eq(charIn(2, 'f2:hp').scopeName, 'f', 'V6. inner carries its frame name')
eq(charIn(2, 'f1:hp').bar, 100, 'V7. peak-relative bar computed per scope-qualified entity')
eq(scenes[2].combat && scenes[2].combat.left.id, 'f2:hp', 'V8. combat resolves the INNERMOST (shadowing) entity')
eq(charIn(2, 'f2:hp').id === charIn(2, 'f1:hp').id ? 'collide' : 'distinct', 'distinct', 'V9. same name in two scopes -> distinct entity ids')
eq(charIn(2, 'f1:hp').id === 'f1:hp' && charIn(2, 'f2:hp').id === 'f2:hp' ? true : false, true, 'V10. scope-qualified ids')

resetWorld()
syncArena({ chars: scenes[2].chars, output: '' }, null, 'instant')
var nOuter = actorNodes.get('f1:hp'), nInner = actorNodes.get('f2:hp')
eq(nOuter.el._cls.has('outer') ? 'outer' : 'plain', 'outer', 'V11. outer actor gets .outer')
eq(nInner.el._cls.has('outer') ? 'outer' : 'plain', 'plain', 'V12. inner actor stays plain')
eq(nOuter.scope.textContent, 'module', 'V13. outer actor shows a scope badge')
eq(nInner.scope.style.display, 'none', 'V14. inner actor has no badge')
eq(nOuter.el.attrs['data-entity'], 'f1:hp', 'V15. data-entity attribute present')
applyCombatOutcome(scenes[2])
eq(nInner.el._cls.has('winner') || nInner.el._cls.has('loser') ? 'flagged' : 'clean', 'flagged', 'V16. combat outcome flags the inner entity')
eq(nOuter.el._cls.has('winner') || nOuter.el._cls.has('loser') ? 'flagged' : 'clean', 'clean', 'V17. outer entity untouched (precise targeting)')

resetWorld()
syncArena({ chars: scenes[0].chars, output: '' }, null, 'instant')
var nSingle = actorNodes.get('f1:hp')
eq(nSingle.el._cls.has('outer') ? 'outer' : 'plain', 'plain', 'V18. single-frame program: no dimming, unchanged look')
eq(nSingle.scope.style.display, 'none', 'V19. single-frame program: no scope badge')
console.log(fails === 0 ? 'INCREMENT-6 TESTS PASSED' : ('INCREMENT-6 FAILURES: ' + fails))
