/* @deps: none */
export const PY_TRACE = `
import sys, os, io, json, types, time, traceback, builtins

DIR = __PROJECT_DIR__
ENTRY = __PROJECT_ENTRY__
FILENAME = ENTRY
MAX_STEPS = 8000
MAX_SECONDS = 6.0
MAX_REPR = 60
MAX_CHUNKS = 4000

steps = []
chunks = []
depth = 0
started = time.time()
# 等用户输入累积的秒数：学生在思考，不该算成程序跑超了
paused = 0.0
limit = None          # 'steps' | 'seconds' when the demo budget stops the run

# Every run starts from the project directory with a clean import cache: a cached
# module or a stale .pyc would otherwise hide an edit to an imported file.
os.chdir(DIR)
if DIR not in sys.path:
    sys.path.insert(0, DIR)
if '/pwlib' not in sys.path:
    sys.path.insert(0, '/pwlib')
try:
    import pwviews
    pwviews.install()
except BaseException:
    pwviews = None
sys.dont_write_bytecode = True
for _name in list(sys.modules):
    try:
        if (getattr(sys.modules[_name], '__file__', '') or '').startswith(DIR):
            del sys.modules[_name]
    except BaseException:
        pass

class Capture(io.TextIOBase):
    def __init__(self):
        self.step = 0
    def write(self, s):
        s = str(s)
        if s and len(chunks) < MAX_CHUNKS:
            chunks.append([self.step, s])
        return len(s)
    def flush(self):
        return None

cap = Capture()
real_stdout = sys.stdout

def brief(v):
    try:
        r = repr(v)
    except BaseException:
        r = '<unrepresentable>'
    r = ' '.join(r.split())
    if len(r) > MAX_REPR:
        r = r[:MAX_REPR - 3] + '...'
    return r

def brief_msg(e):
    # an exception message is prose for a human, not a value: str(), not repr(),
    # otherwise the UI reads "ZeroDivisionError: ZeroDivisionError('...')"
    s = ' '.join(str(e).split())
    return s if len(s) <= 200 else s[:197] + '...'

def keep(v):
    if isinstance(v, types.ModuleType):
        return False
    return not callable(v)

def snapshot(frame):
    out = {}
    for k, v in list(frame.f_locals.items()):
        if k.startswith('__') and k.endswith('__'):
            continue
        if not keep(v):
            continue
        out[k] = [type(v).__name__, brief(v)]
    return out

def trace(frame, event, arg):
    global depth, limit
    if not frame.f_code.co_filename.startswith(DIR):
        return trace
    if event == 'call':
        depth += 1
    if len(steps) >= MAX_STEPS:
        limit = 'steps'
        raise RuntimeError('Execution limit reached (%d steps)' % MAX_STEPS)
    # every event, not every 128th: a short program may never reach a multiple
    if time.time() - started - paused > MAX_SECONDS:
        limit = 'seconds'
        raise RuntimeError('Execution limit reached (%.0fs)' % MAX_SECONDS)
    if event in ('call', 'line', 'return') and frame.f_lineno >= 1:
        cap.step = len(steps)
        rec = {
            'e': event,
            'l': frame.f_lineno,
            'F': os.path.basename(frame.f_code.co_filename),
            'f': frame.f_code.co_name,
            'i': id(frame),
            'd': depth,
            'v': snapshot(frame),
        }
        if event == 'return':
            rec['r'] = brief(arg)
        steps.append(rec)
    if event == 'return':
        depth -= 1
    return trace

error = None

# input() 得走主线程的输入框：worker 里没有 prompt，pyodide 的默认 stdin 会直接
# 抛 "ReferenceError: prompt is not defined"。这里只负责把提示语照常写进输出
# （与内置 input 一致），取值交给 __pw_read_line__（见 pyworker.js 的 SAB 桥）。
_read_line = globals().get('__pw_read_line__')
_real_input = builtins.input

def _pw_input(prompt=''):
    global paused
    if _read_line is None:
        raise RuntimeError('input() is unavailable: this page is not cross-origin '
                           'isolated, so the worker cannot wait for your answer')
    if prompt:
        sys.stdout.write(str(prompt))
    t0 = time.time()
    try:
        line = _read_line(str(prompt))
    finally:
        paused += time.time() - t0
    if line is None:
        raise EOFError('EOF when reading a line')
    return str(line)

builtins.input = _pw_input

sys.stdout = cap
sys.settrace(trace)
try:
    exec(compile(open(ENTRY).read(), ENTRY, 'exec'), {'__name__': '__main__', '__file__': ENTRY})
except BaseException as exc:
    tb = traceback.format_exception(type(exc), exc, exc.__traceback__)
    keep_lines = []
    for chunk in tb:
        for ln in chunk.splitlines():
            if 'File "<' in ln:
                continue
            ln = ln.replace(DIR + '/', '')
            keep_lines.append(ln)
    error = {
        'type': type(exc).__name__,
        'msg': brief_msg(exc),
        'tb': '\\n'.join(keep_lines)[-1200:],
    }
    if limit:
        error = None      # running out of demo budget is not a program error
finally:
    sys.settrace(None)
    sys.stdout = real_stdout
    builtins.input = _real_input

views = []
try:
    if pwviews is not None:
        views = pwviews.collect()
except BaseException:
    views = []

RESULT = json.dumps({
    'views': views,
    'steps': steps,
    'chunks': chunks,
    'error': error,
    'limit': None if not limit else {
        'kind': limit,
        'steps': len(steps),
        'seconds': round(time.time() - started - paused, 1),
    },
    'truncated': len(steps) >= MAX_STEPS or len(chunks) >= MAX_CHUNKS,
})
`

export const SAMPLE = `hp = 100
enemy = 80

if enemy > hp:
    print('die')
else:
    print('win')
print("hp =", hp, " enemy =", enemy)
`

/* =====================================================================
   Ready-made projects.

   Every entry is a whole project, not just a file, so an example can also
   teach importing a sibling module or reading a data file.  `files[0]` is what
   the editor opens, and the entry has to be called main.py for Run to use it.

   They are ordered simplest first; the first one is the cold-start sample, so
   `isPristine` and "drop the draft" keep meaning the same thing.  Only the
   packages vendored on this server may be imported: numpy, pillow, matplotlib,
   pandas and scipy, plus the turtle/pwviews shims in /pwlib.
   ===================================================================== */
export const EXAMPLES = [
  {
    id: 'basics',
    name: 'Basics — variables & if/else',
    files: [{ name: 'main.py', content: SAMPLE }]
  },
  {
    id: 'loops',
    name: 'Loops — accumulator',
    files: [{
      name: 'main.py',
      content: `total = 0
for i in range(1, 6):
    total = total + i
    print("added", i, "->", total)
print("sum 1..5 =", total)
`
    }]
  },
  {
    id: 'functions',
    name: 'Functions — recursion & call stack',
    files: [{
      name: 'main.py',
      content: `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

for k in range(1, 6):
    print(k, "! =", factorial(k))
`
    }]
  },
  {
    id: 'collections',
    name: 'Collections — list, dict, set',
    files: [{
      name: 'main.py',
      content: `scores = {"ann": 91, "bo": 78, "cy": 85}
print("names:", list(scores))

top = max(scores, key=scores.get)
print("top:", top, scores[top])

doubled = [v * 2 for v in scores.values()]
print("doubled:", doubled)

letters = set("banana")
print("unique letters:", sorted(letters))
`
    }]
  },
  {
    id: 'classes',
    name: 'Classes — objects with methods',
    files: [{
      name: 'main.py',
      content: `class Counter:
    def __init__(self, start=0):
        self.value = start

    def add(self, n):
        self.value += n
        return self.value

c = Counter(10)
c.add(5)
print("value:", c.value)
print("made a", type(c).__name__)
`
    }]
  },
  {
    id: 'exceptions',
    name: 'Exceptions — try / except',
    files: [{
      name: 'main.py',
      content: `def parse(text):
    try:
        return int(text)
    except ValueError:
        return None

for raw in ["12", "abc", "7"]:
    print(raw, "->", parse(raw))

try:
    print(1 / 0)
except ZeroDivisionError as exc:
    print("caught:", exc)
`
    }]
  },
  {
    id: 'textfile',
    name: 'Text file — write then read a .txt',
    files: [{
      name: 'main.py',
      content: `rows = [("ann", 91), ("bo", 78), ("cy", 85)]

with open("scores.txt", "w") as fh:
    for name, mark in rows:
        fh.write(name + " " + str(mark) + "\\n")

with open("scores.txt") as fh:
    text = fh.read()

print("--- scores.txt ---")
print(text)
print("lines:", len(text.strip().splitlines()))
`
    }]
  },
  {
    id: 'multifile',
    name: 'Multi-file — import helper.py, read data.txt',
    files: [
      {
        name: 'main.py',
        content: `import helper

rows = helper.read_rows("data.txt")
marks = [row["mark"] for row in rows]

print("rows:", len(rows))
print("total:", helper.total(marks))
print("average:", round(helper.total(marks) / len(rows), 1))
for row in rows:
    print(row["name"], row["mark"])
`
      },
      {
        name: 'helper.py',
        content: `def read_rows(path):
    rows = []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            name, mark = line.split()
            rows.append({"name": name, "mark": int(mark)})
    return rows


def total(marks):
    got = 0
    for m in marks:
        got = got + m
    return got
`
      },
      { name: 'data.txt', content: 'ann 91\nbo 78\ncy 85\n' }
    ]
  },
  {
    id: 'turtle',
    name: 'Turtle — draw a spiral',
    files: [{
      name: 'main.py',
      content: `import turtle

turtle.pensize(2)
turtle.color("teal")
for i in range(24):
    turtle.forward(6 + i * 2)
    turtle.left(45)
turtle.done()
`
    }]
  },
  {
    id: 'matplotlib',
    name: 'Matplotlib — plot a curve',
    files: [{
      name: 'main.py',
      content: `import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt

xs = list(range(0, 21))
ys = [x * x for x in xs]
plt.plot(xs, ys, marker="o")
plt.title("squares")
plt.xlabel("x")
plt.ylabel("x squared")
plt.grid(True)
plt.show()
`
    }]
  },
  {
    id: 'numpy',
    name: 'NumPy — array maths',
    files: [{
      name: 'main.py',
      content: `import numpy as np

xs = np.array([2, 4, 6, 8, 10])
print("values:", xs)
print("mean:", xs.mean())
print("doubled:", xs * 2)
print("squares:", xs ** 2)
`
    }]
  },
  {
    id: 'pillow',
    name: 'Pillow — build an image',
    files: [{
      name: 'main.py',
      content: `from PIL import Image, ImageDraw

im = Image.new("RGB", (160, 120), (20, 24, 48))
draw = ImageDraw.Draw(im)

for i in range(6):
    x = 10 + i * 24
    draw.rectangle([x, 20, x + 16, 100], fill=(90, 140, 255))
    print("bar", i + 1, "at x =", x)

im.save("bars.png")
print("wrote bars.png", im.size)
`
    }]
  }
]

export function exampleById(id) {
  return EXAMPLES.filter(e => e.id === id)[0] || null
}
