# -*- coding: utf-8 -*-
"""重建后注入「AI Hub 全屏按钮 v2 醒目版」到独立应用 index.html。

用途：microduck / g1-cartpole / g1-motion-tracking 等是构建产物，从源项目重建后
index.html 会被覆盖、丢掉平台统一注入的全屏按钮。本脚本把同款按钮片段（与
neural-sandbox 一致：iframe 内 fixed 右上角青绿渐变悬浮按钮）幂等补回。

用法（在 nuxt_AI 根目录）：
    py -3 scripts/inject-fullscreen-btn.py            # 补全部 robot 应用
    py -3 scripts/inject-fullscreen-btn.py --slug microduck   # 只补指定 slug

幂等：index.html 已含 pt-fs-btn 则跳过。
"""

import argparse
import io
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SLUGS = ["rebot-arm", "microduck", "g1-cartpole", "g1-motion-tracking"]

# [AI Hub] 全屏按钮：进入/退出全屏（2026-09-03 v2 醒目版）
# 与 public/apps/neural-sandbox/demos/*/index.html 尾部完全一致，勿单独改样式。
FRAGMENT = r"""<!-- [AI Hub] 全屏按钮：进入/退出全屏（2026-09-03 v2 醒目版） -->
<button id="pt-fs-btn" type="button"
  style="position:fixed;top:16px;right:16px;z-index:99999;display:inline-flex;align-items:center;gap:7px;
  padding:10px 18px 10px 14px;border:none;border-radius:12px;cursor:pointer;font-size:15px;font-weight:600;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#fff;
  background:linear-gradient(135deg,#5eead0,#8b7bf0);box-shadow:0 4px 18px rgba(0,0,0,0.45),0 0 0 1px rgba(255,255,255,0.18) inset;
  transition:transform .12s, box-shadow .15s, filter .15s;letter-spacing:0.2px;user-select:none;">
  <svg id="pt-fs-max" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
  <svg id="pt-fs-min" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
  <span id="pt-fs-label">全屏</span>
</button>
<style>
  #pt-fs-btn:hover { transform: translateY(-2px) scale(1.05); filter: brightness(1.12); box-shadow:0 8px 26px rgba(0,0,0,0.5); }
  #pt-fs-btn:active { transform: scale(0.96); }
</style>
<script>
(function () {
  var btn = document.getElementById('pt-fs-btn');
  if (!btn) return;
  var maxIc = document.getElementById('pt-fs-max');
  var minIc = document.getElementById('pt-fs-min');
  var label = document.getElementById('pt-fs-label');
  var zh = (navigator.language || '').toLowerCase().indexOf('zh') !== -1;
  function isFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function sync() {
    var fs = isFs();
    maxIc.style.display = fs ? 'none' : '';
    minIc.style.display = fs ? '' : 'none';
    label.textContent = fs ? (zh ? '退出全屏' : 'Exit') : (zh ? '全屏' : 'Fullscreen');
    btn.setAttribute('aria-label', label.textContent);
  }
  function toggle() {
    try {
      if (!isFs()) {
        var el = document.documentElement;
        (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      }
    } catch (e) {}
  }
  btn.addEventListener('click', function (ev) { ev.stopPropagation(); toggle(); });
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();
})();
</script>
"""


def inject(index_html: Path) -> str:
    html = index_html.read_text(encoding="utf-8")
    if "pt-fs-btn" in html:
        return "SKIP(已有)"
    if "</body>" in html:
        html = html.replace("</body>", FRAGMENT + "\n</body>", 1)
    else:
        html = html.rstrip() + "\n" + FRAGMENT + "\n"
    index_html.write_text(html, encoding="utf-8")
    return "注入 ✓"


def main() -> None:
    ap = argparse.ArgumentParser(description="注入 AI Hub 全屏按钮 v2 醒目版到独立应用 index.html")
    ap.add_argument("--slug", nargs="*", default=DEFAULT_SLUGS,
                    help=f"要注入的应用 slug（默认全部: {', '.join(DEFAULT_SLUGS)}）")
    args = ap.parse_args()
    for slug in args.slug:
        p = ROOT / "public" / "apps" / slug / "index.html"
        if not p.exists():
            print(f"[{slug}] 不存在 {p.relative_to(ROOT)}，跳过")
            continue
        print(f"[{slug}] {inject(p)}")


if __name__ == "__main__":
    main()
