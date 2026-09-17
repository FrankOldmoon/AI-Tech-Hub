/* Reduced-motion harness: the runner emulates the media feature for real, then
   this page runs the handful of assertions that depend on it. */
import { bindDom } from "../../app/program-world/dom.js";

bindDom(document.querySelector(".program-world"));

const { summary } = await import("./adapter.js");

try {
  await import("./p12.js");
} catch (e) {
  summary.fail++;
  summary.fails.push("harness aborted: " + (e && e.message ? e.message : e));
  console.log("FAIL harness aborted: " + (e && e.stack ? e.stack : e));
}

window.__summary = { ok: summary.ok, fail: summary.fail, fails: summary.fails };
console.log("SUMMARY ok=" + summary.ok + " fail=" + summary.fail);
document.documentElement.setAttribute("data-tests", "done");
