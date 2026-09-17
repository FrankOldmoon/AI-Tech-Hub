/* @deps: none */
export function normalizeB64(raw) {
  let s = String(raw || "").replace(/[\r\n\t]/g, "");
  const marker = s.indexOf("base64,");
  if (marker >= 0) s = s.slice(marker + 7);
  s = s.replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return s;
}

export function decodeCodeParam(raw) {
  const b64 = normalizeB64(raw);
  if (!b64) return "";
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch (e) {
    return "";
  }
}

export function flagFromSearch(search, name) {
  try {
    const q = String(search || "");
    if (!q) return false;
    const query = q.charAt(0) === "?" ? q.slice(1) : q;
    const v = new URLSearchParams(query).get(name);
    if (v === null) return false;
    return v === "" || v === "1" || v === "true" || v === "yes";
  } catch (e) {
    return false;
  }
}

export function encodeCodeParam(code) {
  const bytes = new TextEncoder().encode(String(code || ""));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function shareUrlFor(base, code, autoRun) {
  const u = String(base || "").replace(/[?#].*$/, "");
  return u + "?code=" + encodeCodeParam(code) + (autoRun ? "&run=1" : "");
}

export function encodeProjectParam(files, active) {
  return encodeCodeParam(JSON.stringify({
    v: 2,
    active: active || "",
    files: (files || []).map(f => ({ n: f.name, c: f.content }))
  }));
}

export function decodeProjectParam(raw) {
  const text = decodeCodeParam(raw);
  if (!text) return null;
  try {
    const p = JSON.parse(text);
    if (!p || !Array.isArray(p.files)) return null;
    const files = p.files
      .filter(f => f && typeof f.n === "string" && typeof f.c === "string")
      .map(f => ({ name: f.n, content: f.c }));
    if (!files.length) return null;
    const active = typeof p.active === "string" && p.active ? p.active : files[0].name;
    return { files, active };
  } catch (e) {
    return null;
  }
}

/* ?files=<bundle> for a whole project, ?code=<source> for one buffer */
export function projectFromSearch(search) {
  try {
    const q = String(search || "");
    const query = q.charAt(0) === "?" ? q.slice(1) : q;
    const params = new URLSearchParams(query);
    const bundle = params.get("files");
    if (bundle) {
      const p = decodeProjectParam(bundle);
      if (p) return { files: p.files, active: p.active, treeOpen: true, from: "link" };
    }
    const single = params.get("code");
    if (single) {
      const code = decodeCodeParam(single);
      if (code) {
        return { files: [{ name: "main.py", content: code }], active: "main.py", treeOpen: true, from: "link" };
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

export function shareUrlForProject(base, project, autoRun) {
  const u = String(base || "").replace(/[?#].*$/, "");
  const files = (project && project.files) || [];
  const single = files.length === 1 && files[0].name === "main.py";
  const q = single
    ? "code=" + encodeCodeParam(files[0].content)
    : "files=" + encodeProjectParam(files, project.active);
  return u + "?" + q + (autoRun ? "&run=1" : "");
}

export function codeFromSearch(search) {
  try {
    const q = String(search || "");
    if (!q) return "";
    const query = q.charAt(0) === "?" ? q.slice(1) : q;
    const v = new URLSearchParams(query).get("code");
    return v ? decodeCodeParam(v) : "";
  } catch (e) {
    return "";
  }
}
