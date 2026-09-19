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

# 输出一边写一边发回主线程（见 pyworker.js 的 __pw_emit__）：页面因此能像真终端
# 一样边跑边显示。chunks 照旧收着，逐步回放仍用它。
_emit = globals().get('__pw_emit__')

class Capture(io.TextIOBase):
    def __init__(self):
        self.step = 0
    def write(self, s):
        s = str(s)
        if s and len(chunks) < MAX_CHUNKS:
            chunks.append([self.step, s])
            if _emit is not None:
                try:
                    _emit(s)
                except BaseException:
                    pass
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
    if time.time() - started > MAX_SECONDS:
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

# input() 的行由外面给。两种喂法：
#   · 普通 Run：编辑器下方输入框里的行整段进来，按顺序取，取完就是真正的 EOFError；
#   · Run terminal（交互式）：先给空，读不到行就抛 NeedLine 中止这一次执行，主线程
#     在终端里问到一行后再带着累积的输入重跑一遍。
_NL = chr(10)
_stdin_text = str(globals().get('__pw_stdin__') or '')
if _stdin_text and not _stdin_text.endswith(_NL):
    _stdin_text += _NL
_stdin = io.StringIO(_stdin_text)
_interactive = bool(globals().get('__pw_interactive__'))
_needs_input = None

class NeedLine(BaseException):
    # worker 里没法同步等用户，所以交互式终端用「读不到就中止、拿到答案带更长
    # 输入重跑」来实现：主线程按已显示的字符数对齐，因此看不到重复的输出。
    # 用 BaseException 是有意的 —— 用户代码里的 except Exception 不能吞掉它。
    def __init__(self, prompt):
        self.prompt = str(prompt)

def _pw_input(prompt=''):
    global _needs_input
    if prompt:
        sys.stdout.write(str(prompt))
    line = _stdin.readline()
    if line == '':
        if _interactive:
            _needs_input = {'prompt': str(prompt)}
            raise NeedLine(str(prompt))
        raise EOFError('EOF when reading a line')
    if line.endswith(_NL):
        line = line[:-1]
    return line

_real_input = builtins.input
builtins.input = _pw_input

sys.stdout = cap
sys.stdin = _stdin
sys.settrace(trace)
try:
    exec(compile(open(ENTRY).read(), ENTRY, 'exec'), {'__name__': '__main__', '__file__': ENTRY})
except NeedLine:
    error = None          # 交互式终端：等主线程问到下一行再重跑
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
    'needsInput': _needs_input,
    'limit': None if not limit else {
        'kind': limit,
        'steps': len(steps),
        'seconds': round(time.time() - started, 1),
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
   A prompt you can hand to any AI assistant so the pygame program it writes
   runs here unchanged.

   The two rules an assistant never guesses on its own are the async loop and
   the trailing `await main()`: the game runs on the main thread inside a page
   that already owns an event loop, so a synchronous loop freezes the tab with
   no way to stop it, and asyncio.run() dies on the first frame.  Everything
   else in the list is here because it was measured, not assumed.

   ⚠️ This is a template literal: no backticks and no ${ inside.
   ===================================================================== */
export const LLM_PROMPT = `Write the game I describe below in Python 3.12 with pygame-ce, as a single file named main.py. It has to run unchanged in a browser-based runner, so follow these rules exactly:

1. Put the whole game loop in "async def main():" and end every frame with "await asyncio.sleep(1 / 60)" so the browser gets a turn.
2. The last line of the file must be "await main()". Never use "asyncio.run(main())".
3. Do not use a synchronous "while True" loop, and do not pace frames with pygame.time.delay(), pygame.time.wait() or clock.tick(); use "await asyncio.sleep(...)" instead. A blocking loop freezes the page and the Stop button cannot be reached.
4. Leave the loop with "return". Do not call sys.exit(), quit() or pygame.quit().
5. Load no files at all: no images, no sounds, no fonts. Draw everything with pygame.draw, and use pygame.font.Font(None, size) if you want text. pygame.mixer is fine for sounds you generate in code.
6. Read input with pygame.event.get() (QUIT, KEYDOWN) and pygame.key.get_pressed(). The canvas is 480x360 unless you pick another size with pygame.display.set_mode().
7. print() output shows up in the page, so use it for scores or debug values.

Here is what I want:
<describe your game here>`

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
  },
  {
    id: 'game',
    name: 'Game — move a dot with arrow keys',
    files: [{
      name: 'main.py',
      content: `import asyncio
import pygame

W, H = 480, 360
SPEED = 4

pygame.init()
screen = pygame.display.set_mode((W, H))
pygame.display.set_caption("arrow keys move the dot")

x, y = W // 2, H // 2


async def main():
    global x, y
    while True:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return
            if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                return

        keys = pygame.key.get_pressed()
        x += (keys[pygame.K_RIGHT] - keys[pygame.K_LEFT]) * SPEED
        y += (keys[pygame.K_DOWN] - keys[pygame.K_UP]) * SPEED
        x = max(14, min(W - 14, x))
        y = max(14, min(H - 14, y))

        screen.fill((14, 18, 34))
        pygame.draw.circle(screen, (255, 209, 102), (x, y), 14)
        pygame.display.flip()
        await asyncio.sleep(1 / 60)


await main()
`
    }]
  }
]

export function exampleById(id) {
  return EXAMPLES.filter(e => e.id === id)[0] || null
}
