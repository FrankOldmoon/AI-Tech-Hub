<script setup lang="ts">
import { generateData, type DatasetKind, type TrainSample } from '~/utils/ml-playground'

const { t } = useI18n()
const { getDemo } = useDemos()
const demo = computed(() => getDemo('ml', 'decision-tree')!)

const canvasRef = ref<HTMLCanvasElement>()
const dataset = ref<DatasetKind>('circle')
const maxDepth = ref(4)
const built = ref(false)
const stats = ref({ depth: 0, leaves: 0, accuracy: 0 })

const datasetOptions = computed(() => [
  { label: t('ml.decisionTree.datasetCircle'), value: 'circle' },
  { label: t('ml.decisionTree.datasetXor'), value: 'xor' },
  { label: t('ml.decisionTree.datasetGaussian'), value: 'gaussian' }
])

const SIZE = 400
const RANGE = 6

interface TreeNode {
  feature: 0 | 1
  threshold: number
  left: TreeNode | null
  right: TreeNode | null
  label: number | null
  depth: number
  samples: number
  gini: number
}

let data: TrainSample[] = []
let root: TreeNode | null = null

function gini(labels: number[]): number {
  if (!labels.length) return 0
  const c0 = labels.filter(l => l === 0).length / labels.length
  return 1 - c0 * c0 - (1 - c0) * (1 - c0)
}

function buildNode(pts: TrainSample[], depth: number): TreeNode {
  const labels = pts.map(p => p.y)
  const node: TreeNode = {
    feature: 0,
    threshold: 0,
    left: null,
    right: null,
    label: null,
    depth,
    samples: pts.length,
    gini: gini(labels)
  }
  const unique = new Set(labels)
  if (depth >= maxDepth.value || unique.size <= 1 || pts.length < 4) {
    // 叶子：多数类
    const c0 = labels.filter(l => l === 0).length
    node.label = c0 >= labels.length - c0 ? 0 : 1
    return node
  }
  // 找最佳分裂（Gini 加权最小）
  let bestFeature: 0 | 1 = 0
  let bestThreshold = 0
  let bestGini = Infinity
  for (const feature of [0, 1] as const) {
    const sorted = [...pts].sort((a, b) => a.x[feature] - b.x[feature])
    const candidates = 24
    for (let c = 1; c <= candidates; c++) {
      const threshold = sorted[0].x[feature] + (sorted[sorted.length - 1].x[feature] - sorted[0].x[feature]) * c / (candidates + 1)
      const left = pts.filter(p => p.x[feature] < threshold)
      const right = pts.filter(p => p.x[feature] >= threshold)
      if (!left.length || !right.length) continue
      const wg = (gini(left.map(p => p.y)) * left.length + gini(right.map(p => p.y)) * right.length) / pts.length
      if (wg < bestGini) {
        bestGini = wg
        bestFeature = feature
        bestThreshold = threshold
      }
    }
  }
  if (bestGini >= node.gini - 1e-9) {
    const c0 = labels.filter(l => l === 0).length
    node.label = c0 >= labels.length - c0 ? 0 : 1
    return node
  }
  node.feature = bestFeature
  node.threshold = bestThreshold
  node.left = buildNode(pts.filter(p => p.x[bestFeature] < bestThreshold), depth + 1)
  node.right = buildNode(pts.filter(p => p.x[bestFeature] >= bestThreshold), depth + 1)
  return node
}

function classify(n: TreeNode, x: number, y: number): number {
  if (n.label !== null) return n.label
  const v = n.feature === 0 ? x : y
  return classify(v < n.threshold ? n.left! : n.right!, x, y)
}

function build() {
  data = generateData(dataset.value, 240, 0.1)
  root = buildNode(data, 0)
  built.value = true
  // 统计
  let leaves = 0
  let maxD = 0
  const walk = (n: TreeNode) => {
    maxD = Math.max(maxD, n.depth)
    if (n.label !== null) { leaves++; return }
    if (n.left) walk(n.left)
    if (n.right) walk(n.right)
  }
  walk(root)
  let correct = 0
  for (const p of data) {
    if (classify(root, p.x[0], p.x[1]) === p.y) correct++
  }
  stats.value = { depth: maxD, leaves, accuracy: correct / data.length }
  draw()
}

function reset() {
  built.value = false
  root = null
  stats.value = { depth: 0, leaves: 0, accuracy: 0 }
  draw()
}

function toCanvas(v: number): number {
  return ((v + RANGE) / (RANGE * 2)) * SIZE
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)
  if (root) {
    // 决策边界网格
    const GRID = 50
    const cell = SIZE / GRID
    for (let gx = 0; gx < GRID; gx++) {
      for (let gy = 0; gy < GRID; gy++) {
        const px = ((gx + 0.5) / GRID) * RANGE * 2 - RANGE
        const py = ((gy + 0.5) / GRID) * RANGE * 2 - RANGE
        const label = classify(root, px, py)
        ctx.fillStyle = label === 1 ? 'rgba(59,130,246,0.25)' : 'rgba(249,115,22,0.25)'
        ctx.fillRect(gx * cell, gy * cell, cell + 1, cell + 1)
      }
    }
  }
  for (const p of data) {
    ctx.beginPath()
    ctx.arc(toCanvas(p.x[0]), toCanvas(p.x[1]), 4, 0, Math.PI * 2)
    ctx.fillStyle = p.y === 1 ? '#3B82F6' : '#F97316'
    ctx.fill()
  }
}

watch([dataset, maxDepth], () => {
  if (built.value) build()
})

onMounted(() => {
  build()
})

// SVG 树布局
const tree = computed(() => {
  if (!root) return null
  const leaves: Array<{ node: TreeNode, leafIndex: number }> = []
  const walkLeaves = (n: TreeNode) => {
    if (n.label !== null) { leaves.push({ node: n, leafIndex: leaves.length }); return }
    if (n.left) walkLeaves(n.left)
    if (n.right) walkLeaves(n.right)
  }
  walkLeaves(root)
  const positions = new Map<TreeNode, { x: number, y: number }>()
  const layout = (n: TreeNode): { min: number, max: number } => {
    if (n.label !== null) {
      const idx = leaves.findIndex(l => l.node === n)
      positions.set(n, { x: 60 + idx * 80, y: 30 + n.depth * 70 })
      return { min: idx, max: idx }
    }
    const l = layout(n.left!)
    const r = layout(n.right!)
    positions.set(n, { x: (l.min + r.max) / 2 * 80 + 60, y: 30 + n.depth * 70 })
    return { min: l.min, max: r.max }
  }
  layout(root)
  const W = Math.max(200, leaves.length * 80 + 40)
  const H = (stats.value.depth + 2) * 70
  return { W, H, positions, root }
})

const treeNodes = computed(() => {
  if (!tree.value?.root) return []
  const out: Array<{ node: TreeNode }> = []
  const walk = (n: TreeNode) => {
    out.push({ node: n })
    if (n.left) walk(n.left)
    if (n.right) walk(n.right)
  }
  walk(tree.value.root)
  return out
})
</script>

<template>
  <MediaDemoShell :demo="demo">
    <UCard>
      <div class="grid sm:grid-cols-3 gap-4 items-end">
        <div class="space-y-1">
          <p class="text-xs text-muted">{{ t('ml.decisionTree.dataset') }}</p>
          <USelect v-model="dataset" :items="datasetOptions" class="w-full" />
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted">{{ t('ml.decisionTree.maxDepth') }}: {{ maxDepth }}</p>
          <USlider v-model="maxDepth" :min="1" :max="6" :step="1" />
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            icon="i-lucide-git-branch"
            :label="t('ml.decisionTree.build')"
            color="primary"
            @click="build"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            :label="t('ml.decisionTree.reset')"
            color="neutral"
            variant="subtle"
            @click="reset"
          />
        </div>
      </div>
    </UCard>

    <div class="grid lg:grid-cols-2 gap-6 items-start">
      <div class="space-y-2">
        <canvas
          ref="canvasRef"
          :width="SIZE"
          :height="SIZE"
          class="rounded-xl border border-default bg-elevated/40 max-w-full"
        />
        <div v-if="built" class="grid grid-cols-3 gap-4">
          <div class="rounded-lg border border-default p-2 text-center">
            <p class="text-xs text-muted">{{ t('ml.decisionTree.depth') }}</p>
            <p class="text-xl font-bold text-highlighted tabular-nums">{{ stats.depth }}</p>
          </div>
          <div class="rounded-lg border border-default p-2 text-center">
            <p class="text-xs text-muted">{{ t('ml.decisionTree.leaves') }}</p>
            <p class="text-xl font-bold text-highlighted tabular-nums">{{ stats.leaves }}</p>
          </div>
          <div class="rounded-lg border border-default p-2 text-center">
            <p class="text-xs text-muted">{{ t('ml.decisionTree.accuracy') }}</p>
            <p class="text-xl font-bold text-highlighted tabular-nums">{{ (stats.accuracy * 100).toFixed(1) }}%</p>
          </div>
        </div>
      </div>

      <UCard v-if="tree">
        <template #header>
          <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-workflow" class="size-4" />
            {{ t('ml.decisionTree.tree') }}
          </div>
        </template>
        <svg :viewBox="`0 0 ${tree.W} ${tree.H}`" class="w-full">
          <!-- 连线 -->
          <g
            v-for="(n, key) in treeNodes"
            :key="key"
          >
            <line
              v-if="n.node.left"
              :x1="tree.positions.get(n.node)!.x" :y1="tree.positions.get(n.node)!.y + 15"
              :x2="tree.positions.get(n.node.left)!.x" :y2="tree.positions.get(n.node.left)!.y - 15"
              stroke="#888" stroke-width="1.5"
            />
            <line
              v-if="n.node.right"
              :x1="tree.positions.get(n.node)!.x" :y1="tree.positions.get(n.node)!.y + 15"
              :x2="tree.positions.get(n.node.right)!.x" :y2="tree.positions.get(n.node.right)!.y - 15"
              stroke="#888" stroke-width="1.5"
            />
          </g>
          <!-- 节点 -->
          <g
            v-for="(n, key) in treeNodes"
            :key="'n' + key"
          >
            <rect
              :x="tree.positions.get(n.node)!.x - 45" :y="tree.positions.get(n.node)!.y - 15"
              width="90" height="30" rx="6"
              :fill="n.node.label !== null ? (n.node.label === 1 ? '#3B82F6' : '#F97316') : '#1E293B'"
            />
            <text
              :x="tree.positions.get(n.node)!.x" :y="tree.positions.get(n.node)!.y + 4"
              text-anchor="middle" fill="#fff" font-size="11"
            >
              {{ n.node.label !== null
                ? (n.node.label === 1 ? 'Class A' : 'Class B')
                : (n.node.feature === 0 ? 'x < ' : 'y < ') + n.node.threshold.toFixed(2) }}
            </text>
          </g>
        </svg>
      </UCard>
    </div>
  </MediaDemoShell>
</template>
