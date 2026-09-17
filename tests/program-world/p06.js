console.log("===== PART 19: last-assign line tracking (increment 9) =====");
buildTimeline({
  steps: [
    { e: "line", l: 1, f: "<module>", i: 7001, d: 0, v: {} },
    { e: "line", l: 2, f: "<module>", i: 7001, d: 0, v: { a: ["int", "1"] } },
    { e: "line", l: 7, f: "<module>", i: 7001, d: 0, v: { a: ["int", "1"] } },
    { e: "line", l: 8, f: "<module>", i: 7001, d: 0, v: { a: ["int", "9"] } },
    { e: "line", l: 9, f: "<module>", i: 7001, d: 0, v: { a: ["int", "9"] } }
  ],
  chunks: [], error: null, truncated: false
});
function chId(i, id) { for (const c of scenes[i].chars) if (c.id === id) return c; return null; }
eq(chId(1, "f1:a").lastLine, 1, "AL1. a appears after line 1 -> attributed to line 1, not the observing line");
eq(chId(2, "f1:a").lastLine, 1, "AL2. unrelated later steps do not move the marker");
eq(chId(3, "f1:a").lastLine, 7, "AL3. change observed at line 8 is attributed to the line that caused it");
eq(chId(4, "f1:a").lastLine, 7, "AL4. an unchanged step keeps the marker");
buildTimeline({
  steps: [
    { e: "line",   l: 1, f: "<module>", i: 7002, d: 0, v: {} },
    { e: "line",   l: 5, f: "<module>", i: 7002, d: 0, v: { a: ["int", "1"] } },
    { e: "call",   l: 3, f: "f",        i: 7003, d: 1, v: { a: ["int", "1"], v: ["int", "8"] } },
    { e: "line",   l: 4, f: "f",        i: 7003, d: 1, v: { a: ["int", "1"], v: ["int", "8"] } },
    { e: "return", l: 4, f: "f",        i: 7003, d: 1, v: { a: ["int", "1"], v: ["int", "8"] }, r: "13" },
    { e: "line",   l: 6, f: "<module>", i: 7002, d: 0, v: { a: ["int", "1"], b: ["int", "13"] } }
  ],
  chunks: [], error: null, truncated: false
});
eq(chId(1, "f1:a").lastLine, 1, "AL5. module value attributed to its own line");
eq(chId(2, "f2:v").lastLine, 5, "AL6. function argument attributed to the CALL SITE line");
eq(chId(2, "f1:a").lastLine, 1, "AL7. outer entity keeps its own marker (no cross-scope bleed)");
eq(chId(4, "f2:v").lastLine, 5, "AL8. local keeps its marker while the function runs");
eq(chId(5, "f1:b").lastLine, 5, "AL9. value returned from a call is attributed to the CALL SITE, not the callee return line");

console.log("===== PART 20: hover linkage (increment 9) =====");
/* the real setHoverLine, driving the collection the real attachEditor created
   from the Monaco stand-in — no hand-rolled replacement */
var decoSet = decoCalls.hover;
setHoverLine(0);
eq(decoSet.length, 0, "HV1. clearing empties the decoration set");
setHoverLine(3);
eq(decoSet.length, 1, "HV2. hovering sets one whole-line decoration");
eq(decoSet[0].range.parts.join(","), "3,1,3,1", "HV3. decoration spans the line");
eq(decoSet[0].options.className, "hover-line", "HV4. uses the hover-line class");
setHoverLine(0);
eq(decoSet.length, 0, "HV5. moving away clears it");

resetWorld();
syncArena({ chars: scenes[4].chars, output: "" }, null, "instant");
var nA = actorNodes.get("f1:a");
eq(nA.el.attrs["data-line"], "1", "HV6. actor element carries its last-assign line");
eq(nA.last.line, 1, "HV7. node state mirrors the line");
showHoverLine(1);
eq(nA.el._cls.has("same-src") ? "highlighted" : "plain", "highlighted", "HV8. hovering line 1 lights the actor sourced from line 1");
eq(decoSet.length, 1, "HV9. and highlights that line in the editor");
showHoverLine(99);
eq(nA.el._cls.has("same-src") ? "highlighted" : "plain", "plain", "HV10. hovering a different line leaves it plain");
showHoverLine(0);
eq(nA.el._cls.has("same-src") ? "highlighted" : "plain", "plain", "HV11. clearing the hover removes the highlight");
eq(decoSet.length, 0, "HV12. and clears the editor decoration");
console.log(fails === 0 ? "INCREMENT-9 TESTS PASSED" : ("INCREMENT-9 FAILURES: " + fails));
