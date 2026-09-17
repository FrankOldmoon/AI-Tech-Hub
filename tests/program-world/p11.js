console.log("===== PART 26: rooms + camera (option B) =====");
resetWorld();

function rmScene(chars, rooms) { return { chars: chars, rooms: rooms, output: "" }; }
function withScope(c, scope) { c.scope = scope; c.scopeName = scope === "f1" ? "<module>" : "f"; return c; }

var ROOMS = [
  { scope: "f1", name: "<module>", isOuter: true, depth: 0 },
  { scope: "f2", name: "f", isOuter: false, depth: 1 }
];

syncArena(rmScene([], ROOMS), null, "instant");
eq(roomEls().length, 2, "RM1. one room per frame");
var byOrder = {};
for (const r of roomEls()) byOrder[r.style.order] = r;
eq(byOrder["0"] ? byOrder["0"].className : "missing", "room outer empty", "RM2. the outer room is flagged outer and collapsed while empty");
eq(byOrder["1"] ? byOrder["1"].className : "missing", "room active empty", "RM3. the innermost room is flagged active");
eq(roomNodes.get("f1").rname.textContent, "module", "RM4. the module room is labelled `module`");
eq(roomNodes.get("f2").rname.textContent, "f", "RM5. a frame room is labelled with the function name");
eq(roomNodes.get("f1").rdepth.textContent, "global scope", "RM6. depth label for the global frame");
eq(roomNodes.get("f2").rdepth.textContent, "depth 1", "RM7. depth label for nested frame 1");
eq(roomNodes.get("f1").el.style.marginLeft, "", "RM8. the global room sits flush left");
eq(roomNodes.get("f2").el.style.marginLeft, "16px", "RM9. a nested room is indented so containment reads visually");

eq(arenaEl.style.transform, "", "RM10. a stack that fits its viewport is shown 1:1");

var tallRooms = [], tallChars = [];
for (var z = 0; z < 4; z++) {
  tallRooms.push({ scope: "f" + z, name: "f" + z, isOuter: z < 3, depth: z });
  var zc = mk("f" + z + ":v" + z, "v" + z, "1");
  zc.scope = "f" + z; zc.scopeName = "f" + z;
  tallChars.push(zc);
}
var savedArenaFlex = arenaEl.style.flex;
arenaEl.style.flex = "0 0 300px";
syncArena(rmScene(tallChars, tallRooms), null, "instant");
var zoom = /scale\(([0-9.]+)\)/.exec(arenaEl.style.transform);
eq(zoom && parseFloat(zoom[1]) > 0 && parseFloat(zoom[1]) < 0.97 ? "zoomed-out" : "transform=" + arenaEl.style.transform, "zoomed-out", "RM11. a stack taller than its viewport is scaled down to fit");
eq(zoom && parseFloat(zoom[1]) >= 0.6 ? "above-floor" : "transform=" + arenaEl.style.transform, "above-floor", "RM11b. and it never zooms out past the CAMERA_MIN floor");
arenaEl.style.flex = savedArenaFlex;
syncArena(rmScene([], ROOMS), null, "instant");
eq(arenaEl.style.transform, "", "RM12. and it returns to 1:1 once the stack fits again");

var RA = rmScene([withScope(mk("f1:a", "a", "1"), "f1"), withScope(mk("f2:b", "b", "2"), "f2")], ROOMS);
__focusCalls.length = 0;
syncArena(RA, null, "instant");
eq(roomNodes.get("f1").el.className.indexOf("empty") < 0 ? "filled" : "still-empty", "filled", "RM13. a room that gains a variable expands again");
var lastFocus = __focusCalls.length ? __focusCalls[__focusCalls.length - 1] : null;
eq(lastFocus && lastFocus.el === roomNodes.get("f2").el ? "focused" : "not-focused", "focused", "RM13b. the active room is scrolled into view");
eq(lastFocus ? lastFocus.opts.block : "-", "center", "RM13c. and centred vertically");
eq(lastFocus ? lastFocus.opts.behavior : "-", "auto", "RM13d. scrubbing pans instantly, never smoothly");
eq(__focusCalls.filter(function (c) { return c.el === roomNodes.get("f1").el; }).length, 0, "RM13e. outer rooms are never the focus target");
eq(roomNodes.get("f1").body.children.length, 1, "RM14. the module actor lives inside the module room");
eq(roomNodes.get("f2").body.children.length, 1, "RM15. the local actor lives inside the frame room");
eq(actorNodes.get("f2:b").el.parentNode === roomNodes.get("f2").body ? "in-room" : "elsewhere", "in-room", "RM16. and it is the right element");
eq(inFlow(), 2, "RM17. both actors are counted in the flow");
eq(actorNodes.get("f1:a").el.style.order, "0", "RM18. order is room-local (module)");
eq(actorNodes.get("f2:b").el.style.order, "0", "RM19. order is room-local (frame)");

__focusCalls.length = 0;
syncArena(rmScene([withScope(mk("f1:a", "a", "1"), "f1"), withScope(mk("f2:b", "b", "2"), "f2")], ROOMS), RA, "tween");
eq(__focusCalls.length && __focusCalls[__focusCalls.length - 1].opts.behavior, "smooth", "RM19f. playing pans smoothly instead");

var RB = rmScene([withScope(mk("f1:a", "a", "1"), "f1")], [ROOMS[0]]);
syncArena(RB, RA, "instant");
eq(roomNodes.size, 1, "RM20. the popped frame's room is gone");
eq(actorNodes.has("f2:b"), false, "RM21. the popped frame's actor is retired");
eq(actorEls().length, 1, "RM22. only the surviving actor remains");
eq(arenaEl.children.length, 1, "RM23. no orphan element is left in the arena");

syncArena(rmScene([withScope(mk("f1:a", "a", "1"), "f1"), withScope(mk("f2:c", "c", "3"), "f2")], ROOMS), RB, "instant");
eq(roomNodes.get("f2").body.children[0] === actorNodes.get("f2:c").el ? "yes" : "no", "yes", "RM24. a re-entered frame reuses its room");
eq(roomNodes.get("f1").body.children[0] === actorNodes.get("f1:a").el ? "yes" : "no", "yes", "RM25. the module actor never left its room");
resetWorld();
eq(roomEls().length, 0, "RM26. resetWorld removes the rooms too");
eq(arenaEl.children.length, 0, "RM27. and leaves the arena completely empty");

/* a retiring actor must keep its on-screen position even though the room it
   lived in is about to disappear */
document.querySelector(".stage-wrap").scrollTop = 0;
var RG = rmScene([withScope(mk("f1:a", "a", "1"), "f1"), withScope(mk("f2:b", "b", "2"), "f2")], ROOMS);
syncArena(RG, null, "instant");
var ghostNode = actorNodes.get("f2:b");
var ghostBefore = rectOf(ghostNode.el);
syncArena(rmScene([withScope(mk("f1:a", "a", "1"), "f1")], [ROOMS[0]]), RG, "tween");
eq(ghostNode.dying ? "dying" : "alive", "dying", "RM28. the popped frame's actor becomes a ghost");
var ghostAfter = rectOf(ghostNode.el);
eq(Math.abs(ghostAfter.x - ghostBefore.x) < 2 && Math.abs(ghostAfter.y - ghostBefore.y) < 2, true, "RM29. the ghost keeps its on-screen position instead of jumping to the arena origin");
resetWorld();
