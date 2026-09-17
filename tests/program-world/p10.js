console.log('===== PART 24: particles (increment 12b) =====')
function mkC(id, value) { return { id: id, name: 'x', value: value, type: 'int', avatar: 'X', numeric: parseFloat(value), bar: 50, items: null, itemsTruncated: false } }
function scN(v) { return { chars: [mkC('p1', v)], output: '' } }
function partCount(n) { return n.parts ? n.parts.length : 0 }
function lastParticle(n) {
  var ps = Array.from(n.el.children).filter(function (c) { return c._cls.has('particle') })
  return ps[ps.length - 1]
}
resetWorld()
syncArena(scN('1'), null, 'tween')
var n = actorNodes.get('p1')
eq(partCount(n), 5, 'PT1. creation spawns a 5-particle burst')
eq(lastParticle(n)._cls.has('created') ? 'created' : '?', 'created', 'PT2. burst particles carry the created kind')
syncArena(scN('2'), scN('1'), 'tween')
eq(partCount(n), 8, 'PT3. a value change adds a 3-particle spark')
eq(lastParticle(n)._cls.has('changed') ? 'changed' : '?', 'changed', 'PT4. spark particles carry the changed kind')
for (var i = 0; i < 40 && partCount(n) > 0; i++) n.parts[0].animations[0].settle()
eq(partCount(n), 0, 'PT5. particles clean themselves up when finished')
resetWorld()
syncArena(scN('1'), null, 'tween')
var n2 = actorNodes.get('p1')
for (var k = 0; k < 8; k++) syncArena(scN(String(k + 2)), scN(String(k + 1)), 'tween')
eq(partCount(n2) <= 10 ? 'capped' : 'over:' + partCount(n2), 'capped', 'PT6. particle count is capped while animations pile up')
resetWorld()
syncArena(scN('1'), null, 'instant')
var n3 = actorNodes.get('p1')
syncArena(scN('2'), scN('1'), 'instant')
eq(partCount(n3), 0, 'PT7. instant mode (scrub) spawns no particles')
resetWorld()
syncArena(scN('1'), null, 'instant')
var n4 = actorNodes.get('p1')
syncArena({ chars: [], output: '' }, scN('1'), 'tween')
eq(lastParticle(n4) && lastParticle(n4)._cls.has('retire') ? 'retire' : '?', 'retire', 'PT8. retiring an entity spawns a puff')

console.log('===== PART 25: sound (increment 12b) =====')
eq(soundEnabled(), false, 'SD1. sound is OFF by default')
eq(beep('create'), false, 'SD2. beeping while off does nothing')
eq(toggleSound(), true, 'SD3. toggle turns sound on')
eq(soundEnabled(), true, 'SD4. state reflects the toggle')
/* SD5 used to run under Node, where WebAudio simply does not exist.  Simulate
   that environment for a pristine copy of the module rather than relying on the
   runtime lacking it. */
var __ac = window.AudioContext, __wac = window.webkitAudioContext
delete window.AudioContext; delete window.webkitAudioContext
var freshSound = await import('../../app/program-world/sound.js?no-webaudio')
freshSound.toggleSound()
eq(freshSound.beep('create'), false, 'SD5. with no AudioContext it degrades gracefully instead of throwing')
window.AudioContext = __ac; window.webkitAudioContext = __wac
eq(beep('nope'), false, 'SD6. an unknown tone kind is ignored')
eq(toggleSound(), false, 'SD7. toggle turns it back off')
eq(beep('retire'), false, 'SD8. silent again after turning off')
eq(['create', 'change', 'retire', 'combat', 'output', 'error'].every(function (k) { return !!TONES[k] }) ? 'all' : 'missing', 'all', 'SD9. every wired kind has a tone defined')
eq(String(toggleSound()) === 'true' ? 'on' : 'off', 'on', 'SD10. can be re-enabled')
toggleSound()
console.log(fails === 0 ? 'INCREMENT-12B TESTS PASSED' : ('INCREMENT-12B FAILURES: ' + fails))
