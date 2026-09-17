/* @deps: config.js, editor.js, state.js */
import { fileLines } from "./editor.js";
import { publishTrace } from "./state.js";
/* =====================================================================
   STEP 1 · timeline (unchanged)
   ===================================================================== */
export function buildTimeline(data) {
  const steps = data.steps || [];
  const error = data.error || null;
  const truncated = !!data.truncated;
  const limit = data.limit || null;

  const chunkMap = {};
  (data.chunks || []).forEach(c => {
    (chunkMap[c[0]] = chunkMap[c[0]] || []).push(c[1]);
  });

  const outputs = new Array(steps.length);
  let acc = "";
  for (let i = 0; i < steps.length; i++) {
    acc += (chunkMap[i] || []).join("");
    outputs[i] = acc;
  }

  const stacks = new Array(steps.length);
  const stack = [{ f: "<module>", l: 1 }];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.e === "call") stack.push({ f: s.f, l: s.l });
    stacks[i] = stack.map(x => ({ f: x.f, l: x.l }));
    if (s.e === "return") stack.pop();
  }

  const framesAt = new Array(steps.length);
  const live = [];
  const state = {};
  const tokens = new Map();
  let frameSeq = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!(s.i in state)) {
      live.push(s.i);
      tokens.set(s.i, "f" + (++frameSeq));
    }
    state[s.i] = { id: s.i, name: s.f, vars: s.v, line: s.l };
    framesAt[i] = live.map(id => ({ id, name: state[id].name, vars: state[id].vars, token: tokens.get(id), line: state[id].line }));
    if (s.e === "return") {
      const k = live.indexOf(s.i);
      if (k >= 0) live.splice(k, 1);
      delete state[s.i];
      tokens.delete(s.i);
    }
  }

  /* a step may come from any file in the project, so line text is resolved
     per step rather than from one buffer */
  const linesFor = (step) => fileLines(step ? step.F : null);

  const events = analyzeEvents(steps, chunkMap, linesFor);
  const scenes = buildScenes(steps, events, outputs, framesAt, linesFor);

  publishTrace({ steps, chunkMap, outputs, stacks, framesAt, events, scenes, error, truncated, limit });
}

/* =====================================================================
   STEP 2 · semantic event layer
   ===================================================================== */
function classifyLine(text) {
  const t = (text || "").trim();
  if (/^if\s+/.test(t)) return "if";
  if (/^elif\s+/.test(t)) return "elif";
  if (/^else\s*:/.test(t)) return "else";
  if (/^for\s+/.test(t)) return "for";
  if (/^while\s+/.test(t)) return "while";
  if (/^def\s+/.test(t)) return "def";
  if (/^return\b/.test(t)) return "return";
  if (/^break\b/.test(t)) return "break";
  if (/^continue\b/.test(t)) return "continue";
  return null;
}

/* ============ FIX #1 — proper TRUE/FALSE branch detection ============
   Find the matching `else:` / `elif` on the same indent level as the
   given `if` line. Returns 1-indexed line number, or -1 if none. */
function findElseLine(lines, ifLine) {
  const src = lines[ifLine - 1] || "";
  const ifIndent = (src.match(/^\s*/) || [""])[0].length;
  for (let i = ifLine; i < lines.length; i++) {
    const line = lines[i] || "";
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = (line.match(/^\s*/) || [""])[0].length;
    if (indent < ifIndent) return -1;
    if (indent === ifIndent) {
      if (/^else\s*:/.test(trimmed) || /^elif\s+/.test(trimmed)) return i + 1;
      return -1; // same indent, not an else — if-block ended without else
    }
  }
  return -1;
}

/* Given the line number of the if, and the line number that
   actually executed next, decide which branch was taken. */
function detectBranch(lines, ifLine, nextLine) {
  if (nextLine <= ifLine) return null;
  const src = lines[ifLine - 1] || "";
  const ifIndent = (src.match(/^\s*/) || [""])[0].length;
  const elseLine = findElseLine(lines, ifLine);
  if (elseLine > 0) {
    return nextLine >= elseLine ? "false" : "true";
  }
  // no else: fall back to indentation comparison
  const nextSrc = lines[nextLine - 1] || "";
  const nextIndent = (nextSrc.match(/^\s*/) || [""])[0].length;
  return nextIndent > ifIndent ? "true" : "false";
}

function diffVars(before, after) {
  const changes = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    const a = before && before[k];
    const b = after && after[k];
    if (!a && b) changes.push({ name: k, action: "create", after: b[1], afterType: b[0] });
    else if (a && !b) changes.push({ name: k, action: "delete", before: a[1], beforeType: a[0] });
    else if (a && b && (a[0] !== b[0] || a[1] !== b[1])) {
      changes.push({
        name: k, action: "update",
        before: a[1], after: b[1],
        beforeType: a[0], afterType: b[0]
      });
    }
  }
  return changes;
}

function analyzeEvents(steps, chunkMap, lines) {
  const evs = new Array(steps.length);
  for (let i = 0; i < steps.length; i++) evs[i] = analyzeStep(i, steps, chunkMap, lines);
  return evs;
}

function analyzeStep(i, steps, chunkMap, linesFor) {
  const s = steps[i];
  const prev = i > 0 ? steps[i - 1] : null;
  const lines = linesFor(s);
  const text = lines[s.l - 1] || "";
  const kind = classifyLine(text);
  const delta = (chunkMap[i] || []).join("");

  if (delta && delta.trim().length) {
    return { type: "output", line: s.l, text: delta.trim(), sourceKind: kind };
  }
  if (s.e === "call") {
    return { type: "function_call", line: s.l, name: s.f, args: s.v || {} };
  }
  if (s.e === "return") {
    return { type: "function_return", line: s.l, name: s.f, value: s.r, locals: s.v || {} };
  }
  if (kind === "if" || kind === "elif") {
    const expr = text.trim().replace(/^(if|elif)\s+/, "").replace(/:\s*$/, "");
    return { type: "condition", line: s.l, expr };
  }
  if (kind === "for" || kind === "while") {
    return { type: "loop_iteration", line: s.l, text: text.trim(), sourceKind: kind };
  }
  if (kind === "break") return { type: "break", line: s.l };
  if (kind === "continue") return { type: "continue", line: s.l };

  if (prev && prev.i === s.i && prev.v) {
    const changes = diffVars(prev.v, s.v);
    if (changes.length) {
      const isCollection = changes.some(c =>
        /^(list|dict|set|tuple)$/i.test(c.afterType || c.beforeType || ""));
      return {
        type: isCollection ? "collection_mutation" : "assignment",
        line: s.l,
        changes
      };
    }
  }
  return { type: "expression", line: s.l };
}

/* =====================================================================
   STEP 3 · character avatar resolution
   ===================================================================== */
function pickAvatar(name, type, _value) {
  const n = (name || "").toLowerCase();
  if (/enemy|monster|boss|demon|dragon|orc/.test(n)) return "👹";
  if (/player|hero|knight|warrior/.test(n)) return "🦸";
  if (/hp|health|life|blood/.test(n)) return "❤️";
  if (/mana|mp|energy|magic/.test(n)) return "🔷";
  if (/score|point|credit|xp/.test(n)) return "⭐";
  if (/damage|power|attack|atk/.test(n)) return "⚔️";
  if (/shield|armor|defense|def/.test(n)) return "🛡️";
  if (/speed|vel/.test(n)) return "💨";
  if (/pos|location|coord/.test(n)) return "🚶";
  if (/^x$|_x$|x_pos/.test(n)) return "🚶";
  if (/^y$|_y$|y_pos/.test(n)) return "🧗";
  if (/name|str|text|word|label/.test(n)) return "💬";
  if (/list|items|bag|inventory|arr/.test(n)) return "🎒";
  if (/dict|map|record/.test(n)) return "📦";
  if (/ready|flag|ok|done|finish/.test(n)) return "💡";
  if (/count|num|total|sum|amount/.test(n)) return "🔢";
  if (/result|output|answer/.test(n)) return "🎯";
  if (/temp|degree/.test(n)) return "🌡️";
  if (/money|cash|coin|gold/.test(n)) return "💰";
  if (/level|stage|round/.test(n)) return "🎚️";
  if (/time|elapsed/.test(n)) return "⏱️";
  if (type === "list" || type === "tuple" || type === "set") return "🎒";
  if (type === "dict") return "📦";
  if (type === "str") return "💬";
  if (type === "bool") return "💡";
  if (type === "int" || type === "float") return "🤖";
  if (type === "NoneType") return "👻";
  return "🤖";
}

function numericOf(pair) {
  if (!pair) return null;
  const [t, v] = pair;
  if (t !== "int" && t !== "float") return null;
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}

/* =====================================================================
   STEP 4 · scene model
   ===================================================================== */
const ITEM_OPEN = { list: "[", tuple: "(", set: "{", dict: "{" };

export function parseItems(repr, type) {
  try {
    const open = ITEM_OPEN[type];
    if (!open || repr[0] !== open) return [];
    let body = repr.slice(1);
    const last = body.charAt(body.length - 1);
    if (last === "]" || last === ")" || last === "}") body = body.slice(0, -1);
    return body.split(/,\s*/).map(x => x.trim()).filter(Boolean);
  } catch (e) {}
  return [];
}

function buildScenes(steps, events, outputs, framesAt, linesFor) {
  const out = new Array(steps.length);
  const visitAt = new Array(steps.length);
  const counter = new Map();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const key = s.l + ":" + s.i;
    counter.set(key, (counter.get(key) || 0) + 1);
    visitAt[i] = counter.get(key);
  }

  const peak = new Map();
  for (let i = 0; i < steps.length; i++) {
    const frames = framesAt[i] || [];
    for (const f of frames) {
      for (const n of Object.keys(f.vars || {})) {
        const num = numericOf(f.vars[n]);
        if (num === null) continue;
        const id = (f.token || "p" + f.id) + ":" + n;
        const abs = Math.abs(num);
        if (!(peak.has(id)) || abs > peak.get(id)) peak.set(id, abs);
      }
    }
  }

  const lastSeen = new Map();
  const lastLineById = new Map();

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const ev = events[i];
    const frames = framesAt[i] || [];
    const current = frames[frames.length - 1] || null;
    const output = outputs[i] || "";

    const chars = [];
    const innerScope = current ? (current.token || "p" + current.id) : null;
    for (const f of frames) {
      const scope = f.token || "p" + f.id;
      const names = Object.keys(f.vars || {}).sort();
      for (const n of names) {
        const pair = f.vars[n];
        const type = pair[0], value = pair[1];
        const num = numericOf(pair);
        const rawItems = /^(list|tuple|set|dict)$/.test(type) ? parseItems(value, type) : null;
        const items = rawItems && rawItems[rawItems.length - 1] === "..." ? rawItems.slice(0, -1) : rawItems;
        const id = scope + ":" + n;
        const top = Math.max(peak.get(id) || 0, 1);
        const seen = lastSeen.get(id);
        if (!seen || seen.value !== value || seen.type !== type) {
          lastSeen.set(id, { value: value, type: type });
          lastLineById.set(id, assignLineOf(i, s.l, steps, framesAt));
        }
        chars.push({
          id,
          name: n,
          value, type,
          avatar: pickAvatar(n, type, value),
          numeric: num,
          bar: num !== null ? Math.max(4, Math.min(100, Math.abs(num) / top * 100)) : 100,
          items,
          itemsTruncated: !!rawItems && rawItems.length !== items.length,
          scope,
          scopeName: f.name,
          isOuter: scope !== innerScope,
          lastLine: lastLineById.get(id) || 0,
          frameId: f.id,
          frameName: f.name
        });
      }
    }

    let funcSpace = null;
    if (ev.type === "function_call" && ev.name !== "<module>") {
      const args = [];
      for (const k of Object.keys(ev.args || {})) {
        if (k.startsWith("__")) continue;
        args.push({ name: k, value: ev.args[k][1] });
      }
      funcSpace = { name: ev.name, args, mode: "calling" };
    } else if (ev.type === "function_return" && ev.name !== "<module>") {
      funcSpace = { name: ev.name, value: ev.value, mode: "returning" };
    }

    let round = null;
    if (ev.type === "loop_iteration") {
      let total = null;
      const m = ev.text.match(/range\s*\(\s*(\d+)\s*\)/);
      if (m) total = parseInt(m[1], 10);
      round = {
        text: ev.text,
        index: visitAt[i],
        total,
        isWhile: /^while\b/.test(ev.text),
        cond: /^while\b/.test(ev.text) ? ev.text.replace(/^while\b/, "").replace(/:\s*$/, "").trim() : ""
      };
    }

    /* ---- combat inference ---- */
    const combatFrom = function (expr, wantBranch) {
      const tree = parseCondition(expr);
      const parts = tree ? collectCompares(tree).map(p => buildCombatPart(chars, p)) : [];
      if (!parts.length) return null;
      let branch = null;
      if (wantBranch && i + 1 < steps.length) {
        const nx = steps[i + 1];
        if (nx.i === s.i && nx.l !== s.l) {
          branch = detectBranch(linesFor(s), s.l, nx.l);
        }
      }
      return {
        tree,
        parts,
        left: parts[0].left,
        right: parts[0].right,
        op: parts[0].op,
        branch,
        expr
      };
    };

    let combat = null;
    if (ev.type === "condition") {
      combat = combatFrom(ev.expr, true);
    } else if (round && round.isWhile && round.cond) {
      /* a while condition is evaluated like an if, so it gets the same battle;
         the LOOP badge and the round counter are untouched */
      combat = combatFrom(round.cond, false);
    }

    out[i] = {
      chars,
      rooms: frames.map(function (f, k) {
        const sc = f.token || "p" + f.id;
        return { scope: sc, name: f.name, isOuter: sc !== innerScope, depth: k };
      }),
      funcSpace,
      round,
      combat,
      output,
      event: ev,
      stepIndex: i
    };
  }
  return out;
}

function assignLineOf(i, fallback, steps, framesAt) {
  if (i <= 0) return fallback;
  const prev = steps[i - 1];
  if (prev.e === "return") {
    const fr = framesAt[i - 1] || [];
    if (fr.length >= 2) return fr[fr.length - 2].line;
  }
  return prev.l;
}

function findChar(chars, name) {
  for (let i = chars.length - 1; i >= 0; i--) if (chars[i].name === name) return chars[i];
  return null;
}

const CMP_OPS = ["==", "!=", "<=", ">=", "<", ">", "not in", "in"];

function isWordChar(ch) { return !!ch && /[A-Za-z0-9_]/.test(ch); }

function splitTopLevel(expr, kw) {
  const parts = [];
  let depth = 0, quote = "", start = 0, i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (quote) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === quote) quote = "";
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; i++; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; i++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; i++; continue; }
    if (depth === 0 && expr.startsWith(kw, i) && !isWordChar(expr[i - 1]) && !isWordChar(expr[i + kw.length])) {
      parts.push(expr.slice(start, i).trim());
      i += kw.length;
      start = i;
      continue;
    }
    i++;
  }
  parts.push(expr.slice(start).trim());
  return parts;
}

function splitComparisons(expr) {
  const operands = [];
  const ops = [];
  let depth = 0, quote = "", start = 0, i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (quote) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === quote) quote = "";
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; i++; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; i++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; i++; continue; }
    if (depth === 0) {
      let found = null;
      for (const op of CMP_OPS) {
        if (!expr.startsWith(op, i)) continue;
        if (/^[a-z]/.test(op) && (isWordChar(expr[i - 1]) || isWordChar(expr[i + op.length]))) continue;
        found = op;
        break;
      }
      if (found) {
        operands.push(expr.slice(start, i).trim());
        ops.push(found);
        i += found.length;
        start = i;
        continue;
      }
    }
    i++;
  }
  operands.push(expr.slice(start).trim());
  if (!ops.length) return null;
  return { operands, ops };
}

function encloses(e) {
  let depth = 0, quote = "";
  for (let i = 0; i < e.length; i++) {
    const ch = e[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0 && i < e.length - 1) return false;
    }
  }
  return depth === 0;
}

export function parseCondition(expr) {
  const e = String(expr || "").trim();
  if (!e) return null;

  const orParts = splitTopLevel(e, "or");
  if (orParts.length > 1) {
    const parts = orParts.map(parseCondition).filter(Boolean);
    return parts.length ? { kind: "or", parts } : null;
  }
  const andParts = splitTopLevel(e, "and");
  if (andParts.length > 1) {
    const parts = andParts.map(parseCondition).filter(Boolean);
    return parts.length ? { kind: "and", parts } : null;
  }
  if (/^not\b/.test(e)) {
    const inner = parseCondition(e.slice(3));
    return inner ? { kind: "not", parts: [inner] } : null;
  }
  if (e.charAt(0) === "(" && e.charAt(e.length - 1) === ")" && encloses(e)) {
    return parseCondition(e.slice(1, -1));
  }
  const chain = splitComparisons(e);
  if (!chain) return null;
  const parts = [];
  for (let i = 0; i < chain.ops.length; i++) {
    const left = chain.operands[i], right = chain.operands[i + 1];
    if (!left || !right) return null;
    parts.push({ kind: "compare", left, right, op: chain.ops[i] });
  }
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : { kind: "and", parts };
}

export function collectCompares(tree, out) {
  const list = out || [];
  if (!tree) return list;
  if (tree.kind === "compare") list.push(tree);
  else if (tree.parts) for (const p of tree.parts) collectCompares(p, list);
  return list;
}

function numLiteral(text) {
  const t = String(text).trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
}

function compareOk(a, b, op) {
  if (a === null || b === null) return null;
  if (op === "==") return a === b;
  if (op === "!=") return a !== b;
  if (op === "<") return a < b;
  if (op === ">") return a > b;
  if (op === "<=") return a <= b;
  if (op === ">=") return a >= b;
  return null;
}

function buildCombatPart(chars, node) {
  const leftChar = findChar(chars, node.left);
  const rightChar = findChar(chars, node.right);
  const leftNum = leftChar ? leftChar.numeric : numLiteral(node.left);
  const rightNum = rightChar ? rightChar.numeric : numLiteral(node.right);
  return {
    left: {
      name: node.left,
      value: leftChar ? leftChar.value : node.left,
      avatar: leftChar ? leftChar.avatar : "👤",
      isChar: !!leftChar,
      id: leftChar ? leftChar.id : null
    },
    right: {
      name: node.right,
      value: rightChar ? rightChar.value : node.right,
      avatar: rightChar ? rightChar.avatar : pickGhost(node.right),
      isChar: !!rightChar,
      id: rightChar ? rightChar.id : null
    },
    op: node.op,
    ok: compareOk(leftNum, rightNum, node.op),
    expr: node.left + " " + node.op + " " + node.right
  };
}

function pickGhost(literal) {
  if (/^['"]/.test(literal)) return "💬";
  return "👻";
}
