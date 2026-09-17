<script setup lang="ts">
import '~/program-world/css/base.css'
import '~/program-world/css/play.css'

definePageMeta({ layout: 'bare' })

const { t } = useI18n()

useSeoMeta({
  title: () => `Program World · Game · ${t('site.title')}`,
  description: () => 'Program World — run your project as a real pygame game'
})

/* Same island as /ide: bind the elements, then boot.  The project is shared
   with the visualizer through the same localStorage/IndexedDB, so a game
   written there shows up here. */
const root = ref<HTMLElement | null>(null)
let dom: { unbindAll: () => void } | null = null

onMounted(async () => {
  const [d, play] = await Promise.all([
    import('~/program-world/dom.js'),
    import('~/program-world/play.js')
  ])
  dom = d
  d.bindDom(root.value)
  play.boot()
})

onBeforeUnmount(() => {
  if (dom) dom.unbindAll()
  dom = null
})
</script>

<template>
  <div ref="root" class="program-world">
    <div class="wrap">
      <div class="head">
        <h1>Program World</h1>
        <span class="tag">Game mode · pygame-ce</span>
        <span id="status" class="status">Loading…</span>
        <div class="row" style="margin-left:auto">
          <select id="filePick" title="Which file is the game" />
          <button id="btnPlay" class="btn primary">Run game</button>
          <button id="btnStop" class="btn" disabled title="Stops at the end of the current frame — the runtime stays loaded, so you can run again">Stop</button>
          <NuxtLink class="btn ghost" to="/ide" title="Back to the step-by-step visualizer">Visualizer</NuxtLink>
        </div>
      </div>

      <div class="stage">
        <canvas id="screen" width="480" height="360" tabindex="0" />
      </div>

      <p class="hint">
        Click the picture, then use the keyboard — keys go straight to <code>pygame.event.get()</code>.
        The loop must be <b>async</b> and give the browser a turn every frame:
        <code>await asyncio.sleep(1 / 60)</code>. This page already runs your file inside an event
        loop, so finish with <code>await main()</code> — <b>not</b> <code>asyncio.run(main())</code>.
        Write the game as <code>main.py</code> in the visualizer and it shows up here.
      </p>

      <pre id="out" class="out">Ready. Pick a file and press Run game.</pre>

      <details class="example">
        <summary>A complete game that works here (copy into main.py)</summary>
        <pre>import asyncio
import pygame

pygame.init()
screen = pygame.display.set_mode((480, 360))
pygame.display.set_caption("catch")
clock = pygame.time.Clock()

x, y = 240, 180
size = 16
speed = 5
hits = 0


async def main():
    global x, y, hits
    while True:
        for e in pygame.event.get():
            if e.type == pygame.QUIT:
                return
            if e.type == pygame.KEYDOWN and e.key == pygame.K_ESCAPE:
                return

        keys = pygame.key.get_pressed()
        if keys[pygame.K_LEFT]:
            x -= speed
        if keys[pygame.K_RIGHT]:
            x += speed
        if keys[pygame.K_UP]:
            y -= speed
        if keys[pygame.K_DOWN]:
            y += speed

        screen.fill((12, 18, 40))
        pygame.draw.circle(screen, (255, 200, 60), (x, y), size)
        hits += 1
        pygame.display.flip()
        await asyncio.sleep(1 / 60)


await main()
        </pre>
      </details>
    </div>
  </div>
</template>
