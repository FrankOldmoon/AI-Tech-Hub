console.log('===== PART 21: code= URL parameter (increment 10) =====')
eq(normalizeB64('aGVsbG8='), 'aGVsbG8=', 'UC1. plain base64 untouched')
eq(normalizeB64('aGVsbG8'), 'aGVsbG8=', 'UC2. missing padding restored')
eq(normalizeB64('a-b_c'), 'a+b/c===', 'UC3. url-safe alphabet converted back and padded')
eq(normalizeB64('data:text/plain;base64,aGVsbG8='), 'aGVsbG8=', 'UC4. data: prefix stripped')
eq(normalizeB64('aGVs\r\nbG8='), 'aGVsbG8=', 'UC5. wrapped base64 joined')
eq(normalizeB64(''), '', 'UC6. empty stays empty')
eq(decodeCodeParam('aGVsbG8='), 'hello', 'UC7. decodes ascii')
eq(decodeCodeParam(encB64('x = 1\nprint(\'你好\')\n')), 'x = 1\nprint(\'你好\')\n', 'UC8. utf-8 multibyte survives')
eq(decodeCodeParam(encB64('a = 1\n', true)), 'a = 1\n', 'UC9. base64url payload accepted')
eq(decodeCodeParam('!!!not base64!!!'), '', 'UC10. invalid input yields empty string')
eq(decodeCodeParam(''), '', 'UC11. empty input yields empty string')

var plusBytes = null, plusB64 = ''
for (var n = 32; n < 127 && !plusBytes; n++) {
  for (var m = 32; m < 127 && !plusBytes; m++) {
    var cand = 'ab' + String.fromCharCode(n) + String.fromCharCode(m)
    var b = encB64(cand)
    if (b.indexOf('+') >= 0) { plusBytes = cand; plusB64 = b }
  }
}
eq(plusBytes ? 'found' : 'missing', 'found', 'UC12. found a payload whose base64 contains +')
eq(normalizeB64(plusB64.replace('+', ' ')), plusB64, 'UC13. a space coming from a mangled + is restored')
eq(decodeCodeParam(plusB64.replace('+', ' ')), plusBytes, 'UC14. ...and the bytes round-trip through the mangled form')
var mangled = new URLSearchParams('code=' + plusB64).get('code')
eq(mangled.indexOf(' ') >= 0 ? 'mangled' : 'clean', 'mangled', 'UC15. URLSearchParams really does turn + into a space')
eq(decodeCodeParam(mangled) === plusBytes ? 'roundtrip-ok' : 'mismatch', 'roundtrip-ok', 'UC16. ...and we still recover the original bytes')
eq(codeFromSearch('?code=' + encB64('print(\'hi\')\n')), 'print(\'hi\')\n', 'UC17. reads code from a query string')
eq(codeFromSearch('?foo=1&code=' + encB64('n=1\n') + '&bar=2'), 'n=1\n', 'UC18. works among other parameters')
eq(codeFromSearch('?foo=1'), '', 'UC19. no code parameter -> empty')
eq(codeFromSearch('?code='), '', 'UC20. empty code parameter -> empty')
eq(codeFromSearch(''), '', 'UC21. no search -> empty')
eq(codeFromSearch('code=' + encB64('z=9\n')), 'z=9\n', 'UC22. tolerates a missing leading question mark')
console.log(fails === 0 ? 'INCREMENT-10 TESTS PASSED' : ('INCREMENT-10 FAILURES: ' + fails))
