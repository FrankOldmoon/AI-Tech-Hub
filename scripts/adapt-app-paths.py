#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
独立应用路径适配工具（APP-INTEGRATION-GUIDE 第 3 步）。

把放入 public/apps/<slug>/ 的独立应用前端里的绝对路径，
改为带前缀的形式，避免与 nuxt_AI 自身路由冲突：
  /lib/ /js/ /css/ /favicon /manifest /service-worker  ->  /apps/<slug>/...
  /api/...                                              ->  /api/apps/<slug>/...
  origin}/api                                           ->  origin}/api/apps/<slug>

用法：py -3 scripts/adapt-app-paths.py --slug rebot-arm [--dir public/apps/rebot-arm]
"""
import argparse
import os


def adapt(slug: str, root: str) -> int:
    prefix = f"/apps/{slug}"
    api = f"/api/apps/{slug}"
    replaces = [
        (f"/lib/", f"{prefix}/lib/"),
        (f"/js/", f"{prefix}/js/"),
        (f"/css/", f"{prefix}/css/"),
        (f"/favicon.png", f"{prefix}/favicon.png"),
        (f"/manifest.webmanifest", f"{prefix}/manifest.webmanifest"),
        (f"/service-worker.js", f"{prefix}/service-worker.js"),
        # 注意：/api/ 带尾斜杠，不会误伤 `origin}/api`（后面是反引号）
        (f"/api/", f"{api}/"),
        (f"origin}}/api", f"origin}}{api}"),
    ]
    changed = 0
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if not name.endswith((".html", ".js", ".css", ".json", ".webmanifest")):
                continue
            p = os.path.join(dirpath, name)
            try:
                s = open(p, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            orig = s
            for old, new in replaces:
                s = s.replace(old, new)
            if s != orig:
                open(p, "w", encoding="utf-8").write(s)
                changed += 1
    return changed


def main() -> None:
    ap = argparse.ArgumentParser(description="Adapt standalone app absolute paths to nuxt_AI prefixes")
    ap.add_argument("--slug", required=True, help="app slug, e.g. rebot-arm")
    ap.add_argument("--dir", default=None, help="app front-end dir (default: public/apps/<slug>)")
    args = ap.parse_args()
    root = args.dir or os.path.join("public", "apps", args.slug)
    if not os.path.isdir(root):
        print(f"dir not found: {root}")
        raise SystemExit(1)
    n = adapt(args.slug, root)
    print(f"adapted {n} files in {root}")


if __name__ == "__main__":
    main()
