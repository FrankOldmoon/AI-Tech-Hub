/**
 * neural-sandbox 演示名清单（iframe 同源嵌入 public/apps/neural-sandbox/demos/<name>/）。
 *
 * 为什么有这份清单：这 15 个入口此前各占一个 `.vue`（每个 11 行、唯一差别是传给
 * `NeuralDemoShell` 的 `name`），合计 165 行只为了把 slug 映射成一个字符串。
 * 现在由 `ml/[slug].vue` 按 `neural-` 前缀统一分发（15 个文件删除），本清单是
 * **合法 name 的唯一事实来源**，同时决定 iframe 目录名是否有效。
 *
 * 注意：`name` 必须与 `public/apps/neural-sandbox/demos/<name>/` 的目录名逐字一致。
 */
export const neuralDemoNames: string[] = [
  'attractor',
  'automata',
  'boids',
  'diffusion',
  'foragers',
  'fourier',
  'genetic-tsp',
  'kmeans',
  'optimizers',
  'pathfinding',
  'playground',
  'reaction-diffusion',
  'rl-gridworld',
  'slime-mold',
  'wave-collapse'
]

/** `neural-foragers` → `foragers`；非 `neural-*` 或 name 不在清单里返回 null */
export function neuralNameFromSlug(slug: string): string | null {
  const name = slug.startsWith('neural-') ? slug.slice('neural-'.length) : ''
  return neuralDemoNames.includes(name) ? name : null
}
