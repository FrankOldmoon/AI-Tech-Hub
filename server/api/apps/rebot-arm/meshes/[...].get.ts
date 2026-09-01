/**
 * ReBot Arm B601-RS：兼容 /meshes/ 路径（URDF 解析出的另一种网格 URL 形式）。
 */
import { createError, defineEventHandler, getRouterParam, sendStream, setResponseHeader } from 'h3'
import { createReadStream, existsSync } from 'node:fs'
import { basename, join } from 'node:path'

const MESH_DIR = join(process.cwd(), 'server', 'assets', 'apps', 'rebot-arm', 'description', 'meshes_rs')

export default defineEventHandler((event) => {
  const file = basename(getRouterParam(event, '_') ?? '')
  const p = join(MESH_DIR, file)
  if (!file || !existsSync(p)) {
    throw createError({ statusCode: 404, statusMessage: `mesh not found: ${file}` })
  }
  setResponseHeader(event, 'Content-Type', 'model/stl')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  return sendStream(event, createReadStream(p))
})
