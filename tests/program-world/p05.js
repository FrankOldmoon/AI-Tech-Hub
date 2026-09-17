console.log('===== PART 18: timeline ticks (increment 8b) =====')
eq(tickClass('assignment'), 'assign', 'TL1. assignment -> assign')
eq(tickClass('collection_mutation'), 'assign', 'TL2. mutation -> assign')
eq(tickClass('function_call'), 'call', 'TL3. call -> call')
eq(tickClass('function_return'), 'ret', 'TL4. return -> ret')
eq(tickClass('condition'), 'cond', 'TL5. condition -> cond')
eq(tickClass('loop_iteration'), 'loop', 'TL6. loop -> loop')
eq(tickClass('output'), 'out', 'TL7. output -> out')
eq(tickClass('break'), 'ctl', 'TL8. break -> ctl')
eq(tickClass('expression'), 'expr', 'TL9. expression -> expr')
eq(buildTicks(null, 10).length, 0, 'TL10. null scenes -> no ticks')
eq(buildTicks([], 10).length, 0, 'TL11. empty scenes -> no ticks')

function sc(type) { return { event: { type: type } } }
var few = [sc('assignment'), sc('condition'), sc('output')]
var t1 = buildTicks(few, 300)
eq(t1.length + '/' + t1[0].start + '-' + t1[0].end, '3/0-0', 'TL12. small trace -> one tick per step')
eq(t1.map(function (t) { return t.cls }).join(','), 'assign,cond,out', 'TL13. tick classes follow the event types')

var many = []
for (var k = 0; k < 1000; k++) many.push(sc(k === 500 ? 'function_call' : 'expression'))
var t2 = buildTicks(many, 250)
eq(t2.length <= 250 && t2.length >= 249 ? 'capped' : t2.length, 'capped', 'TL14. long trace is bucketed under the budget')
eq(t2[0].cls, 'expr', 'TL15. bucket with only expressions -> expr')
eq(t2[125].cls, 'call', 'TL16. bucket containing a function_call is coloured as call (highest rank wins)')
eq(t2[124].cls, 'expr', 'TL16b. neighbouring buckets stay plain')
eq(t2[t2.length - 1].end, 999, 'TL17. last bucket reaches the final step')
eq(t2[0].start === 0 && t2[1].start === t2[0].end + 1 ? 'contiguous' : 'gap', 'contiguous', 'TL18. buckets are contiguous and cover the whole trace')

resetWorld()
buildTimeline({
  steps: [
    { e: 'line', l: 1, f: '<module>', i: 6001, d: 0, v: { a: ['int', '1'] } },
    { e: 'line', l: 2, f: '<module>', i: 6001, d: 0, v: { a: ['int', '2'] } },
    { e: 'line', l: 3, f: '<module>', i: 6001, d: 0, v: { a: ['int', '3'] } },
    { e: 'line', l: 4, f: '<module>', i: 6001, d: 0, v: { a: ['int', '4'] } }
  ],
  chunks: [], error: null, truncated: false
})
renderTimeline()
eq(tlTicks ? tlTicks.length : -1, 4, 'TL19. renderTimeline builds one tick per step')
eq(tlCursor ? 'cursor' : 'none', 'cursor', 'TL20. cursor element created')
eq(tlProgress ? 'progress' : 'none', 'progress', 'TL21. progress element created')
eq(timelineEl.children.length, 6, 'TL22. DOM = progress + 4 ticks + cursor')
eq(timelineEl.style.display, '', 'TL23. timeline visible when a trace exists')
syncTimelineCursor(0)
eq(parseFloat(tlCursor.style.left) + '/' + parseFloat(tlProgress.style.width), '0/0', 'TL24. cursor at the first step')
syncTimelineCursor(3)
eq(parseFloat(tlCursor.style.left) + '/' + parseFloat(tlProgress.style.width), '100/100', 'TL25. cursor at the last step')
syncTimelineCursor(1)
eq(tlCursor.style.left, '33.333%', 'TL26. cursor interpolates linearly')
eq(timelineEl.children[1] && timelineEl.children[1].attrs['data-start'], '0', 'TL27. ticks carry their step range for click mapping')
resetWorld()
eq(timelineEl.innerHTML === '' && tlTicks === null && tlCursor === null ? 'cleared' : 'stale', 'cleared', 'TL28. resetWorld clears the timeline')
eq(timelineEl.style.display, 'none', 'TL29. timeline hidden after reset')
console.log(fails === 0 ? 'INCREMENT-8B TESTS PASSED' : ('INCREMENT-8B FAILURES: ' + fails))
