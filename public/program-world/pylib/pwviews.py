"""Collect what a program drew, so the page can show it in a window.

The runner imports this before the user's code and calls `collect()` afterwards.
Nothing here is part of the user's project and nothing writes to disk.

matplotlib figures are captured when `plt.show()` runs and again at the end, so
a program that forgets to save anything still shows its pictures.  pygame draws
to an offscreen surface (there is no window to draw into) and every flip is kept
as a frame, which the page can replay.
"""
import base64
import builtins
import io
import sys

views = []

MAX_VIEWS = 8
MAX_FRAMES = 240
MAX_FRAME_BYTES = 250000
MAX_TOTAL_B64 = 1600000

_state = {"frames": [], "surface": None, "bytes": 0, "pygame": None}


def _b64(data):
    return base64.b64encode(data).decode("ascii")


def _room():
    return len(views) < MAX_VIEWS and _state["bytes"] < MAX_TOTAL_B64


def add_view(view):
    if not _room():
        return
    if view.get("frames"):
        cost = sum(len(f) for f in view["frames"])
    else:
        cost = len(view.get("png") or "")
    if _state["bytes"] + cost > MAX_TOTAL_B64:
        return
    _state["bytes"] += cost
    views.append(view)


# ------------------------------- matplotlib -----------------------------
def _figure_png(fig, dpi=90):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
    return buf.getvalue()


def capture_figures():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    try:
        numbers = list(plt.get_fignums())
    except BaseException:
        return
    for n in numbers:
        try:
            fig = plt.figure(n)
            title = ""
            if getattr(fig, "_suptitle", None) is not None:
                title = fig._suptitle.get_text() or ""
            add_view({"kind": "figure", "png": _b64(_figure_png(fig)), "title": title, "index": n})
            plt.close(fig)
        except BaseException:
            pass


def _install_matplotlib(plt):
    if getattr(plt, "_pw_patched", False):
        return
    def show(*a, **k):
        try:
            capture_figures()
        except BaseException:
            pass
        return None
    try:
        plt.show = show
        plt._pw_patched = True
    except BaseException:
        pass


# --------------------------------- pygame -------------------------------
def _install_pygame(pg):
    if getattr(pg, "_pw_patched", False):
        return
    try:
        display = pg.display

        def set_mode(size, *a, **k):
            surf = _state.get("surface")
            if surf is None or surf.get_size() != tuple(size):
                surf = pg.Surface(tuple(size))
                _state["surface"] = surf
            return surf

        def get_surface():
            return _state.get("surface")

        def flip(*a, **k):
            surf = _state.get("surface")
            if surf is None or len(_state["frames"]) >= MAX_FRAMES:
                return
            try:
                buf = io.BytesIO()
                pg.image.save(surf, buf, "frame.png")
                data = buf.getvalue()
            except BaseException:
                return
            if len(data) > MAX_FRAME_BYTES:
                return
            _state["frames"].append(_b64(data))

        # The video subsystem wants a real canvas (there is none in a worker) and
        # raises from inside SDL when it looks for one.  Nothing here needs it:
        # drawing goes to an offscreen surface and frames are captured on flip.
        def _noop(*a, **k):
            return None

        display.init = _noop
        display.quit = _noop
        display.set_caption = _noop
        display.set_icon = _noop
        display.iconify = _noop
        display.toggle_fullscreen = _noop
        display.get_init = lambda *a, **k: True
        display.is_init = lambda *a, **k: True
        display.get_driver = lambda *a, **k: "offscreen"
        display.set_mode = set_mode
        display.get_surface = get_surface
        display.flip = flip
        display.update = flip
        pg._pw_patched = True
    except BaseException:
        pass


def capture_pygame():
    frames = _state.get("frames") or []
    if not frames:
        return
    surface = _state.get("surface")
    size = list(surface.get_size()) if surface is not None else [0, 0]
    add_view({"kind": "frames", "frames": frames, "size": size, "label": "pygame"})
    _state["frames"] = []


# ------------------------------ import hook -----------------------------
def maybe_install():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is not None:
        _install_matplotlib(plt)
    pg = sys.modules.get("pygame")
    if pg is not None and _state["pygame"] is not pg:
        _state["pygame"] = pg
        _install_pygame(pg)


def install():
    """Patch imports once, so `import matplotlib.pyplot as plt` is enough."""
    if getattr(builtins, "_pw_hooked", False):
        return
    real = builtins.__import__

    def hooked(name, *a, **k):
        mod = real(name, *a, **k)
        try:
            maybe_install()
        except BaseException:
            pass
        return mod

    builtins.__import__ = hooked
    builtins._pw_hooked = True


def collect():
    """Everything drawn, in the order it was drawn."""
    try:
        maybe_install()
    except BaseException:
        pass
    try:
        capture_figures()
    except BaseException:
        pass
    try:
        capture_pygame()
    except BaseException:
        pass
    try:
        import turtle as _t
        _t._flush()
    except BaseException:
        pass
    return views
