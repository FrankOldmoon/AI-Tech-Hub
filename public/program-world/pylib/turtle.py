"""turtle — the parts a beginner uses, recorded instead of drawn.

There is no Tk in the browser, so this keeps the usual API and records the
strokes; the page replays them one at a time.  Everything a lesson normally
does is here: forward/backward/left/right, goto/setheading, penup/pendown,
pensize/color, circle, dot, begin_fill/end_fill, write, clear, speed, done.
What is not here is anything event-driven (onkey, onscreenclick, listen) —
there is no window and no event loop to attach to.
"""
import math

import pwviews

DEFAULT_SIZE = (480, 360)
_bg = "white"
_canvas_size = DEFAULT_SIZE
_ops = []
_current = None
_turtle = None


class _Pen:
    def __init__(self):
        self.reset()

    def reset(self):
        self.x = 0.0
        self.y = 0.0
        self.angle = 90.0
        self.down = True
        self.pen = "black"
        self.fill = "black"
        self.width = 1.0
        self.filling = False
        self.fill_start = None
        self.visible = True
        self.path = []

    # ---- movement ----
    def _flush(self):
        if len(self.path) > 1:
            _ops.append({
                "t": "line",
                "pts": [[round(px, 2), round(py, 2)] for px, py in self.path],
                "color": self.pen,
                "w": self.width,
            })
        self.path = []

    def _arc(self, radius, extent, steps):
        if radius == 0:
            return
        if steps is None or steps < 1:
            steps = max(8, int(abs(extent) / 6) + 4)
        if self.down:
            self.path.append((self.x, self.y))
        # the centre sits 90 degrees to the left of the heading
        rad = math.radians(self.angle)
        cx = self.x - radius * math.sin(rad)
        cy = self.y + radius * math.cos(rad)
        for _ in range(steps):
            step = extent / steps
            self.angle = (self.angle + step) % 360
            a = math.radians(self.angle)
            self.x = cx + radius * math.cos(a)
            self.y = cy + radius * math.sin(a)
            if self.down:
                self.path.append((self.x, self.y))
        if not self.down:
            self._flush()

    def _move(self, distance):
        rad = math.radians(self.angle)
        if self.down:
            self.path.append((self.x, self.y))
        self.x += distance * math.cos(rad)
        self.y += distance * math.sin(rad)
        if self.down:
            self.path.append((self.x, self.y))
        # one stroke per movement, so the page can draw them one at a time
        self._flush()


class _Turtle(_Pen):
    def forward(self, distance):
        self._move(distance)

    def backward(self, distance):
        self._move(-distance)

    def right(self, angle):
        self.angle = (self.angle - angle) % 360

    def left(self, angle):
        self.angle = (self.angle + angle) % 360

    def goto(self, x, y=None):
        if y is None:
            if isinstance(x, (tuple, list)):
                x, y = x[0], x[1]
            else:
                y = 0
        if self.down:
            self.path.append((self.x, self.y))
            self.path.append((x, y))
            self._flush()
        else:
            self._flush()
        self.x, self.y = float(x), float(y)

    def setpos(self, x, y=None):
        self.goto(x, y)

    def setposition(self, x, y=None):
        self.goto(x, y)

    def setx(self, x):
        self.goto(x, self.y)

    def sety(self, y):
        self.goto(self.x, y)

    def setheading(self, angle):
        self.angle = float(angle) % 360

    def seth(self, angle):
        self.setheading(angle)

    def home(self):
        self.goto(0, 0)
        self.setheading(90)

    def circle(self, radius, extent=360, steps=None):
        self._arc(float(radius), float(extent), steps)
        self._flush()

    def dot(self, size=None, *color):
        if color:
            self.color(*color)
        _ops.append({
            "t": "dot",
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "r": (float(size) / 2 if size else max(2.0, self.width * 2)),
            "color": self.pen,
        })

    # ---- pen ----
    def penup(self):
        self._flush()
        self.down = False

    def pendown(self):
        self.down = True

    def isdown(self):
        return self.down

    def pensize(self, width=None):
        if width is None:
            return self.width
        self._flush()
        self.width = float(width)

    def width(self, width=None):
        return self.pensize(width)

    def color(self, *args):
        if not args:
            return (self.pen, self.fill)
        c = args[0] if len(args) == 1 else args
        self._flush()
        self.pen = c
        if len(args) == 1:
            self.fill = c
        elif len(args) >= 2:
            self.fill = args[1]
        return None

    def pencolor(self, *args):
        if not args:
            return self.pen
        self._flush()
        self.pen = args[0] if len(args) == 1 else args
        return None

    def fillcolor(self, *args):
        if not args:
            return self.fill
        self.fill = args[0] if len(args) == 1 else args
        return None

    def begin_fill(self):
        self.filling = True
        self.fill_start = len(_ops)
        self.pen_path_start = (self.x, self.y)

    def end_fill(self):
        if not self.filling:
            return
        self.filling = False
        self._flush()
        pts = self._points_since(self.fill_start)
        if len(pts) > 2:
            _ops.append({"t": "fill", "pts": pts, "color": self.fill})

    def _points_since(self, start):
        pts = []
        for op in _ops[start:]:
            if op["t"] == "line":
                for p in op["pts"]:
                    pts.append(p)
            elif op["t"] == "fill":
                for p in op["pts"]:
                    pts.append(p)
        return pts

    def begin_poly(self):
        pass

    def end_poly(self):
        pass

    def get_poly(self):
        return None

    # ---- looks ----
    def hideturtle(self):
        self.visible = False

    def showturtle(self):
        self.visible = True

    def isvisible(self):
        return self.visible

    def shape(self, *a):
        return None

    def stamp(self):
        return None

    def speed(self, *a):
        return None

    def write(self, arg, move=False, align="left", font=("Arial", 12, "normal")):
        size = font[1] if len(font) > 1 else 12
        _ops.append({
            "t": "text",
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "s": str(arg),
            "size": size,
            "align": align,
            "color": self.pen,
        })

    def clear(self):
        self.reset()
        _ops.append({"t": "clear"})

    def reset(self):
        _Pen.reset(self)

    def pos(self):
        return (self.x, self.y)

    def position(self):
        return self.pos()

    def xcor(self):
        return self.x

    def ycor(self):
        return self.y

    def heading(self):
        return self.angle

    def towards(self, x, y=None):
        if y is None:
            x, y = x[0], x[1]
        return math.degrees(math.atan2(y - self.y, x - self.x)) % 360

    def distance(self, x, y=None):
        if y is None:
            x, y = x[0], x[1]
        return math.hypot(x - self.x, y - self.y)

    def clone(self):
        return _Turtle()

class _Screen:
    def bgcolor(self, *args):
        global _bg
        if args:
            _bg = args[0]
        return _bg

    def setup(self, width=DEFAULT_SIZE[0], height=DEFAULT_SIZE[1], *a, **k):
        global _canvas_size
        _canvas_size = (int(width), int(height))

    def screensize(self, canvwidth=None, canvheight=None, bg=None):
        global _canvas_size, _bg
        if canvwidth:
            _canvas_size = (int(canvwidth), int(canvheight or _canvas_size[1]))
        if bg:
            _bg = bg
        return _canvas_size

    def title(self, *a):
        return None

    def tracer(self, *a):
        return None

    def update(self):
        return None

    def delay(self, *a):
        return None

    def listen(self):
        return None

    def onkey(self, *a, **k):
        return None

    def onkeypress(self, *a, **k):
        return None

    def onclick(self, *a, **k):
        return None

    def onscreenclick(self, *a, **k):
        return None

    def ontimer(self, *a, **k):
        return None

    def mainloop(self):
        return None

    def bye(self):
        return None

    def exitonclick(self):
        return None

    def colormode(self, *a):
        return None

    def mode(self, *a):
        return None

    def getcanvas(self):
        return None

    def window_width(self):
        return _canvas_size[0]

    def window_height(self):
        return _canvas_size[1]

    def numinput(self, *a, **k):
        return 0

    def textinput(self, *a, **k):
        return ""


def _default():
    global _turtle
    if _turtle is None:
        _turtle = _Turtle()
    return _turtle


def _flush():
    """Hand the recorded strokes over; called by the runner when the program ends."""
    t = _default()
    t._flush()
    if not _ops:
        return
    pwviews.add_view({
        "kind": "turtle",
        "ops": _ops,
        "bg": _bg,
        "size": [int(_canvas_size[0]), int(_canvas_size[1])],
    })


# --------------------------- module level API ---------------------------
def _wrap(name):
    def call(*a, **k):
        return getattr(_default(), name)(*a, **k)
    return call


for _n in ("forward", "fd", "backward", "back", "bk", "right", "rt", "left", "lt",
           "goto", "setpos", "setposition", "setx", "sety", "setheading", "seth",
           "home", "circle", "dot", "penup", "pu", "up", "pendown", "pd", "down",
           "isdown", "pensize", "width", "color", "pencolor", "fillcolor",
           "begin_fill", "end_fill", "hideturtle", "ht", "showturtle", "st",
           "isvisible", "shape", "stamp", "speed", "write", "clear", "reset",
           "pos", "position", "xcor", "ycor", "heading", "towards", "distance"):
    if not hasattr(_Turtle, _n):
        continue
    globals()[_n] = _wrap(_n)

fd = forward
back = backward
bk = backward
rt = right
lt = left
pu = penup
up = penup
pd = pendown
down = pendown
ht = hideturtle
st = showturtle


def done():
    return None


def mainloop():
    return None


def bye():
    return None


def exitonclick():
    return None


def Turtle():
    return _Turtle()


def Screen():
    return _Screen()


def getscreen():
    return _Screen()


def getturtle():
    return _default()


def bgcolor(*a):
    return _Screen().bgcolor(*a)


def setup(*a, **k):
    return _Screen().setup(*a, **k)


def screensize(*a, **k):
    return _Screen().screensize(*a, **k)


def title(*a):
    return None


def tracer(*a):
    return None


def update():
    return None


def delay(*a):
    return None


def listen():
    return None


def onkey(*a, **k):
    return None


def onkeypress(*a, **k):
    return None


def onclick(*a, **k):
    return None


def onscreenclick(*a, **k):
    return None


def ontimer(*a, **k):
    return None


def textinput(*a, **k):
    return ""


def numinput(*a, **k):
    return 0


def colormode(*a):
    return None


def mode(*a):
    return None
