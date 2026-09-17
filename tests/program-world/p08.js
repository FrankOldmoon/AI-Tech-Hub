console.log('===== PART 22: share link + auto-run (increment 11) =====')
eq(encodeCodeParam('hello'), 'aGVsbG8', 'SL1. encoded without padding')
eq(encodeCodeParam('ab> '), 'YWI-IA', 'SL2. url-safe alphabet (no + / =)')
eq(/[+/=]/.test(encodeCodeParam('ab> ')) ? 'unsafe' : 'safe', 'safe', 'SL3. never emits +, / or =')
eq(encodeCodeParam(''), '', 'SL4. empty code -> empty param')
var probes = ['a = 1\n', 'print(\'你好世界\')\n', 'x = \'\u{1F600}\'', 'tab\there', 'line1\nline2\n', '']
var rt = probes.every(function (s) { return decodeCodeParam(encodeCodeParam(s)) === s })
eq(rt ? 'all-roundtrip' : 'mismatch', 'all-roundtrip', 'SL5. encode -> decode round-trips ascii, chinese, emoji, tabs and newlines')
var big = ''
for (var k = 0; k < 400; k++) big += 'v' + k + ' = ' + k + '\n'
eq(decodeCodeParam(encodeCodeParam(big)) === big ? 'big-ok' : 'big-fail', 'big-ok', 'SL6. a 400-line program round-trips')

eq(flagFromSearch('?run=1', 'run'), true, 'SL7. run=1 is truthy')
eq(flagFromSearch('?run', 'run'), true, 'SL8. bare run flag is truthy')
eq(flagFromSearch('?code=x&run=true', 'run'), true, 'SL9. run=true is truthy')
eq(flagFromSearch('?run=0', 'run'), false, 'SL10. run=0 is falsy')
eq(flagFromSearch('?run=no', 'run'), false, 'SL11. run=no is falsy')
eq(flagFromSearch('?code=x', 'run'), false, 'SL12. absent flag is falsy')
eq(flagFromSearch('', 'run'), false, 'SL13. empty search is falsy')

var u1 = shareUrlFor('http://h:3010/apps/codeflow/', 'a = 1\n', true)
eq(u1, 'http://h:3010/apps/codeflow/?code=' + encodeCodeParam('a = 1\n') + '&run=1', 'SL14. share url shape')
eq(decodeCodeParam(new URLSearchParams(u1.split('?')[1]).get('code')), 'a = 1\n', 'SL15. share url decodes back to the same code')
var u2 = shareUrlFor('http://h/p/?foo=1', 'z=2\n', false)
eq(u2.indexOf('foo') < 0 ? 'clean' : 'stale-query', 'clean', 'SL16. existing query is dropped')
eq(u2.indexOf('&run=1') < 0 ? 'no-autorun' : 'autorun', 'no-autorun', 'SL17. autoRun=false omits the flag')
eq(decodeCodeParam(new URLSearchParams(u2.split('?')[1]).get('code')), 'z=2\n', 'SL18. still decodes without the flag')
console.log(fails === 0 ? 'INCREMENT-11 TESTS PASSED' : ('INCREMENT-11 FAILURES: ' + fails))
