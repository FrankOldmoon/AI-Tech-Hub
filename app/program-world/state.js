/* =====================================================================
   Shared application state.

   ES modules cannot rebind an imported binding, so every module that needs to
   CHANGE one of these goes through a named setter.  Reads use the live binding
   directly.  That keeps each mutation explicit and greppable, and makes the
   import graph the single source of load order.
   ===================================================================== */

export let editor = null;
export let deco = null;

export let steps = [];
export let chunkMap = {};
export let outputs = [];
export let stacks = [];
export let framesAt = [];
export let events = [];
export let scenes = [];

export let error = null;
export let truncated = false;
export let limit = null;

export let cur = -1;
export let stale = false;
export let running = false;

export function setEditor(v) { editor = v; }
export function setDeco(v) { deco = v; }
export function setCur(v) { cur = v; }
export function setStale(v) { stale = v; }
export function setRunning(v) { running = v; }

/* buildTimeline computes the whole analysis locally and publishes it in one
   go, so a half-updated trace can never be observed. */
export function publishTrace(t) {
  steps = t.steps;
  chunkMap = t.chunkMap;
  outputs = t.outputs;
  stacks = t.stacks;
  framesAt = t.framesAt;
  events = t.events;
  scenes = t.scenes;
  error = t.error;
  truncated = t.truncated;
  limit = t.limit || null;
}

export function resetTrace() {
  steps = [];
  chunkMap = {};
  outputs = [];
  stacks = [];
  framesAt = [];
  events = [];
  scenes = [];
  error = null;
  truncated = false;
  limit = null;
}
