console.log("===== PART 1-6: node reuse / FLIP / revive (regression) =====");
var MOD = 1001, FB = 1002;
buildTimeline({
  steps: [
    { e: "line",   l: 1,  f: "<module>", i: MOD, d: 0, v: { n: ["int", "1"] } },
    { e: "call",   l: 9,  f: "f",        i: FB,  d: 1, v: { x: ["int", "5"] } },
    { e: "line",   l: 10, f: "f",        i: FB,  d: 1, v: { x: ["int", "6"] } },
    { e: "return", l: 10, f: "f",        i: FB,  d: 1, v: { x: ["int", "6"] }, r: "6" },
    { e: "call",   l: 9,  f: "g",        i: FB,  d: 1, v: { x: ["int", "5"] } },
    { e: "line",   l: 10, f: "g",        i: FB,  d: 1, v: { x: ["int", "7"] } },
    { e: "line",   l: 11, f: "g",        i: FB,  d: 1, v: { x: ["int", "8"] } }
  ],
  chunks: [], error: null, truncated: false
});
function idsAt(i) { var m = {}; scenes[i].chars.forEach(function (c) { m[c.name] = c.id; }); return m; }
eq(idsAt(0).n, "f1:n", "P0. module entity id (frame token f1)");
eq(idsAt(1).x, "f2:x", "P1. first activation token");
eq(idsAt(5).x, "f3:x", "P2. reused python frame id gets a new token");

syncArena(scenes[0], null);
var n0 = actorNodes.get("f1:n");
eq(inFlow(), 1, "A. one in-flow node");
eq(n0.el.className, "actor created", "B. fresh entity class");
eq(n0.el.attrs["data-char"], "n", "B2. data-char present");
syncArena(scenes[1], scenes[0]);
var x1 = actorNodes.get("f2:x");
var barAt1 = x1.fill.style.width;
eq(n0.dying === true ? "dying" : "alive", "alive", "C. entering a function KEEPS the module entity alive");
eq(n0.el._cls.has("outer") ? "outer" : "plain", "outer", "C2. and flags it as an outer-scope actor");
eq(actorNodes.has("f2:x") ? "present" : "gone", "present", "C3. the function-local entity is created");
eq(inFlow(), 2, "C4. both scopes now occupy the flow");
eq(n0.scope.textContent, "module", "C5. outer actor shows its scope badge");
syncArena(scenes[2], scenes[1]);
var x2 = actorNodes.get("f2:x");
eq(x2 === x1 ? "same" : "different", "same", "E. same entity reuses the SAME node");
eq(x2.el.className, "actor changed", "F. value change -> exactly .changed");
eq(parseFloat(barAt1), 83.3, "G0. bar = value / own peak (5 of 6), sampled at step 1");
eq(parseFloat(x2.fill.style.width), 100, "G. bar = value / own peak (6 of 6)");
var xScope = scenes[2].chars.filter(function (c) { return c.id === "f2:x"; })[0].scope;
var xRoomIdx = scenes[2].chars.filter(function (c) { return c.scope === xScope; }).findIndex(function (c) { return c.id === "f2:x"; });
eq(x2.el.style.order, String(xRoomIdx), "H. style.order follows the room-local scene index");
eq(x2.value.textContent, "5", "H2. text not yet updated (count-up in flight)");
eq(pendingFrames(), 1, "H3. count-up scheduled one frame");
tick(400);
eq(x2.value.textContent, "6", "H4. count-up lands on the target text");
eq(pendingFrames(), 0, "H5. no frame left");

var writes = 0;
Object.defineProperty(x2.value, "textContent", {
  get: function () { return this._t; },
  set: function (v) { writes++; this._t = v; }
});
x2.value._t = "6";
syncArena(scenes[3], scenes[2]);
eq(writes, 0, "I. unchanged value -> ZERO text writes");
eq(x2.el.className, "actor", "J. no state class when nothing changed");
syncArena(scenes[4], scenes[3]);
var x3 = actorNodes.get("f3:x");
eq(x3 && x3 !== x2 ? "new node" : "reused", "new node", "K. new activation gets a NEW node");
eq(x2.dying === true ? "dying" : "alive", "dying", "K2. old activation retired");
eq(x3.el.className, "actor created", "L. new activation is .created");
var log = [];
var rm = x3.el.classList.remove, ad = x3.el.classList.add;
x3.el.classList.remove = function () { log.push("remove:" + Array.from(arguments).join(",")); return rm.apply(this, arguments); };
x3.el.classList.add = function () { log.push("add:" + Array.from(arguments).join(",")); return ad.apply(this, arguments); };
syncArena(scenes[5], scenes[4]);
eq(log.join("|"), "remove:created|add:changed", "O. created -> changed swaps classes");
log.length = 0;
syncArena(scenes[6], scenes[5]);
eq(log.indexOf("remove:changed") >= 0 && log.indexOf("add:changed") >= 0 ? "rearmed" : log.join("|"), "rearmed", "P. consecutive .changed re-arms");
eq(log.indexOf("remove:changed") < log.indexOf("add:changed") ? "remove-first" : log.join("|"), "remove-first", "Q. remove before add");
eq(x3.el.className, "actor changed", "R. class after re-arm");
resetWorld();
eq(inFlow() + "/" + actorEls().length + "/" + actorNodes.size + "/" + roomNodes.size + "/" + arenaEl.children.length, "0/0/0/0/0", "N. resetWorld clears everything (no orphan elements, no orphan rooms)");

/* Pin the arena. The real one centres its content and grows with it, so every
   change slides the whole group and a FLIP delta stops being well defined.
   A top aligned box is the classic FLIP case these assertions describe. */
var __savedJustify = arenaEl.style.justifyContent;
arenaEl.style.justifyContent = "flex-start";
var S3 = scene([mk("f1:a", "a", "1"), mk("f1:b", "b", "2"), mk("f1:c", "c", "3")]);
var S2 = scene([mk("f1:a", "a", "1"), mk("f1:c", "c", "3")]);
var S4 = scene([mk("f1:a", "a", "1"), mk("f1:b", "b", "2"), mk("f1:c", "c", "3"), mk("f1:d", "d", "4")]);
var S4b = scene([mk("f1:a", "a", "1"), mk("f1:d", "d", "4")]);
syncArena(S3, null, "tween");
clearAnims();
var beforeC = rectOf(actorNodes.get("f1:c").el);
syncArena(S2, S3, "tween");
var gb = null;
for (const n of actorNodes.values()) if (n.id === "f1:b") gb = n;
eq(gb ? "dying" : "missing", "dying", "S1. removed middle entity becomes a ghost");
eq(gb.el.style.position, "absolute", "S2. ghost absolutely positioned");
eq(exitOf(gb.el) ? "has-exit-anim" : "none", "has-exit-anim", "S3. ghost runs exit animation");
eq(flipOf(gb.el), null, "S4. ghost not part of FLIP");
var cNode = actorNodes.get("f1:c");
eq(movedMatches(flipOf(cNode.el), movedBy(beforeC, cNode.el)) ? "matches" : "flip=" + flipOf(cNode.el) + " moved=" + JSON.stringify(movedBy(beforeC, cNode.el)), "matches", "S5. the shifted sibling FLIPs by exactly the distance it moved");
eq(flipOf(actorNodes.get("f1:a").el), null, "S6. unmoved sibling gets no animation");
eq(inFlow(), 2, "S7. flow count drops immediately");
clearAnims();
syncArena(S3, S2, "tween");
eq(actorNodes.get("f1:b") === gb ? "same node" : "new node", "same node", "S8. revive reuses the SAME node");
eq(gb.dying === false ? "alive" : "still dying", "alive", "S9. dying flag cleared");
eq(gb.el.style.position, "", "S10. absolute positioning cleared");
eq(inFlow(), 3, "S11. revived node back in flow");
eq(actorEls().length, 3, "S12. no duplicate element");
resetWorld();
syncArena(S3, null, "tween");
clearAnims();
syncArena(S2, S3, "instant");
eq(actorNodes.size, 2, "S13. instant mode drops retired entity");
eq(actorEls().length, 2, "S14. instant mode removes node immediately");
eq(totalAnims(), 0, "S15. instant mode creates ZERO animations");
/* S16 (reduced motion) lives in p12: it needs real media emulation. */
resetWorld();
syncArena(S3, null, "tween");
clearAnims();
syncArena(S3, S3, "tween");
eq(totalAnims(), 0, "S17. unchanged layout -> no FLIP work");
resetWorld();
syncArena(S4, null, "tween");
clearAnims();
var beforeD = rectOf(actorNodes.get("f1:d").el);
syncArena(S4b, S4, "tween");
eq(movedMatches(flipOf(actorNodes.get("f1:d").el), movedBy(beforeD, actorNodes.get("f1:d").el)) ? "matches" : "flip=" + flipOf(actorNodes.get("f1:d").el) + " moved=" + JSON.stringify(movedBy(beforeD, actorNodes.get("f1:d").el)), "matches", "S18. two slots removed -> the FLIP equals the distance moved");
eq(inFlow(), 2, "S19. flow count = 2");
eq(actorEls().filter(function (e) { return e.style.position === "absolute"; }).length, 2, "S20. two ghosts in flight");
arenaEl.style.justifyContent = __savedJustify;

console.log("===== PART 7-10: collection items (regression) =====");
eq(JSON.stringify(parseItems("[1, 2, 3, 4, ...", "list")), JSON.stringify(["1", "2", "3", "4", "..."]), "T1. truncated repr yields items");
eq(JSON.stringify(parseItems("{'a': 1}", "dict")), JSON.stringify(["'a': 1"]), "T2. dict parsed");
eq(JSON.stringify(parseItems("[1]", "int")), JSON.stringify([]), "T3. wrong type -> empty");
var truncatedList = "[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...";
buildTimeline({
  steps: [{ e: "line", l: 1, f: "<module>", i: 2001, d: 0,
            v: { bag: ["list", "[1, 2, 3]"], box: ["dict", "{'a': 1, 'b': 2}"],
                 long: ["list", truncatedList], n: ["int", "7"] } }],
  chunks: [], error: null, truncated: false
});
function charByName(i, nm) { for (const ch of scenes[i].chars) if (ch.name === nm) return ch; return null; }
var cBag = charByName(0, "bag"), cBox = charByName(0, "box"), cLong = charByName(0, "long"), cN = charByName(0, "n");
eq(JSON.stringify(cBag.items), JSON.stringify(["1", "2", "3"]), "T4. scene carries list items");
eq(cLong.items.length + "/" + cLong.itemsTruncated, "10/true", "T5. truncated list keeps items and flags it");
eq(cLong.items.indexOf("...") >= 0 ? "present" : "gone", "gone", "T6. trailing ... stripped");
eq(cN.items === null ? "null" : "not-null", "null", "T7. scalar has no items");
resetWorld();
var SC = { chars: [cBag, cBox, cLong, cN], output: "" };
syncArena(SC, null, "instant");
var nBag = actorNodes.get(cBag.id), nBox = actorNodes.get(cBox.id), nLong = actorNodes.get(cLong.id), nN = actorNodes.get(cN.id);
eq(nBag.bagOn, true, "U1. collection actor shows the bag");
eq(nBag.chips.length, 3, "U2. one chip per element");
eq([nBag.chips[0]._t, nBag.chips[1]._t, nBag.chips[2]._t].join(","), "1,2,3", "U3. chip texts");
eq(nBox.chips[0]._t, "'a': 1", "U4. dict entry text");
eq(nLong.chips.length, 7, "U5. pool capped at 6 + overflow");
eq(nLong.chips[6]._t, "+4\u2026", "U6. truncated overflow label");
eq(nLong.chips[6]._more, true, "U7. overflow chip flagged .more");
eq(nN.bagOn, false, "U8. scalar keeps bag hidden");
eq(nBag.el.children[5] === nBag.bag ? "bag-at-5" : "?", "bag-at-5", "U9. bag is the 6th child");
function clearChips(n) { for (const ch of n.chips) ch.animations = []; }
clearChips(nBag);
var SC2 = { chars: [{ id: cBag.id, name: "bag", value: "[1, 2, 9]", type: "list",
                      avatar: "X", numeric: null, bar: 100, items: ["1", "2", "9"], itemsTruncated: false }], output: "" };
syncArena(SC2, SC, "tween");
eq(nBag.chips[2]._t, "9", "U10. chip text updated in place");
eq(nBag.chips[2].animations.length > 0 ? "popped" : "no-anim", "popped", "U11. changed chip pops");
eq(nBag.chips[0].animations.length, 0, "U12. unchanged chip quiet");
var before = nBag.chips[2].animations.length;
syncArena(SC2, SC2, "instant");
eq(nBag.chips[2].animations.length, before, "U13. unchanged value -> syncBag skipped");
var SC3 = { chars: [{ id: cBag.id, name: "bag", value: "7", type: "int",
                      avatar: "Y", numeric: 7, bar: 7, items: null, itemsTruncated: false }], output: "" };
syncArena(SC3, SC2, "instant");
eq(nBag.bagOn, false, "U14. bag hidden when value becomes scalar");

console.log("===== PART 11: bar scale = own peak =====");
buildTimeline({
  steps: [
    { e: "line", l: 1, f: "<module>", i: 3001, d: 0, v: { hp: ["int", "100"], dmg: ["int", "10"] } },
    { e: "line", l: 2, f: "<module>", i: 3001, d: 0, v: { hp: ["int", "80"], dmg: ["int", "20"] } },
    { e: "line", l: 3, f: "<module>", i: 3001, d: 0, v: { hp: ["int", "80"], dmg: ["int", "20"], big: ["int", "100000"] } }
  ],
  chunks: [], error: null, truncated: false
});
function barOf(st, nm) { for (const ch of scenes[st].chars) if (ch.name === nm) return ch.bar; return null; }
eq(barOf(0, "hp"), 100, "B1. hp at its peak -> full bar");
eq(barOf(1, "hp"), 80, "B2. hp 80 of peak 100 -> 80%");
eq(barOf(0, "dmg"), 50, "B3. dmg 10 of its own peak 20 -> 50%");
eq(barOf(1, "dmg"), 100, "B4. dmg at its peak -> full");
eq(barOf(2, "hp"), 80, "B5. hp bar UNAFFECTED by a huge new variable");
eq(barOf(2, "big"), 100, "B6. new variable measured against its own peak");

console.log("===== PART 12: numeric count-up =====");
function numChar(id, name, value) {
  return { id: id, name: name, value: value, type: "int", avatar: "A",
           numeric: parseFloat(value), bar: 100, items: null, itemsTruncated: false };
}
resetWorld();
var sA = { chars: [numChar("e1", "hp", "100")], output: "" };
var sB = { chars: [numChar("e1", "hp", "70")], output: "" };
var sC = { chars: [numChar("e1", "hp", "40")], output: "" };
syncArena(sA, null, "instant");
var nHp = actorNodes.get("e1");
eq(nHp.value.textContent, "100", "C1. first paint sets text directly");
syncArena(sB, sA, "tween");
eq(nHp.value.textContent, "100", "C2. text held until tween frames run");
eq(pendingFrames(), 1, "C3. exactly one frame scheduled");
tick(130);
eq(nHp.value.textContent, "85", "C4. midpoint frame shows 100 -> 70 halfway");
tick(200);
eq(nHp.value.textContent, "70", "C5. final frame lands on target");
eq(pendingFrames(), 0, "C6. nothing left scheduled");
syncArena(sC, sB, "instant");
eq(nHp.value.textContent, "40", "C7. instant mode sets text directly");
eq(pendingFrames(), 0, "C8. instant mode schedules nothing");

console.log("===== PART 13: floating delta =====");
resetWorld();
syncArena(sA, null, "tween");
var nHp2 = actorNodes.get("e1");
eq(deltaOf(nHp2.el) === null ? "none" : "present", "none", "D1. first paint spawns no delta");
syncArena(sB, sA, "tween");
var d1 = deltaOf(nHp2.el);
eq(d1 ? d1.textContent : "?", "-30", "D2. drop of 30 -> -30");
eq(d1 && d1._cls.has("down") ? "down" : "?", "down", "D3. negative delta uses .down");
eq(d1 && d1.animations.length > 0 ? "animated" : "none", "animated", "D4. delta is animated");
d1.animations[0].settle();
eq(deltaOf(nHp2.el) === null ? "none" : "present", "none", "D5. delta removes itself when done");
var sUp = { chars: [numChar("e1", "hp", "78")], output: "" };
syncArena(sUp, sB, "tween");
var d2 = deltaOf(nHp2.el);
eq(d2 ? d2.textContent : "?", "+8", "D6. rise of 8 -> +8");
eq(d2 && d2._cls.has("up") ? "up" : "?", "up", "D7. positive delta uses .up");
var sTiny = { chars: [numChar("e1", "hp", "79")], output: "" };
syncArena(sTiny, sUp, "instant");
eq(deltaOf(nHp2.el) === d2 ? "no-new" : "new", "no-new", "D8. instant mode spawns no new delta");
var sSmall = { chars: [numChar("e1", "hp", "80")], output: "" };
syncArena(sSmall, sTiny, "tween");
eq(deltaOf(nHp2.el) === d2 ? "no-new" : "new", "no-new", "D9. change below 2 spawns no delta");

console.log(fails === 0 ? "ALL SUITE TESTS PASSED" : ("FAILURES: " + fails));
