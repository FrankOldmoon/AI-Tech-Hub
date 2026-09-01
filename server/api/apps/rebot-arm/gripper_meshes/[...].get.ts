/**
 * ReBot Arm B601-RS：返回夹爪 STL 网格。
 * URL: /api/apps/rebot-arm/gripper_meshes/<file>
 */
import { createError, defineEventHandler, getRouterParam, sendStream, setResponseHeader } from 'h3'
import { createReadStream, existsSync } from 'node:fs'
import { basename, join } from 'node:path'

const GRIPPER_DIR = join(process.cwd(), 'server', 'assets', 'apps', 'rebot-arm', 'split_meshes', 'grouped_gripper')

export default defineEventHandler((event) => {
  const file = basename(getRouterParam(event, '_') ?? '')
  const p = join(GRIPPER_DIR, file)
  if (!file || !existsSync(p)) {
    throw createError({ statusCode: 404, statusMessage: `gripper mesh not found: ${file}` })
  }
  setResponseHeader(event, 'Content-Type', 'model/stl')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  return sendStream(event, createReadStream(p))
})
