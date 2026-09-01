/**
 * ReBot Arm B601-RS：返回机械臂 URDF（用于 Three.js URDFLoader）。
 * 资源目录：server/assets/apps/rebot-arm/（gitignore，部署时上传）
 */
import { createError, defineEventHandler, setResponseHeader, sendStream } from 'h3'
import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS = join(process.cwd(), 'server', 'assets', 'apps', 'rebot-arm')
const URDF_FILE = join(ASSETS, 'description', 'urdf', 'ReBot_Arm_RS.urdf')

export default defineEventHandler((event) => {
  if (!existsSync(URDF_FILE)) {
    throw createError({ statusCode: 404, statusMessage: 'URDF not found (模型未上传？)' })
  }
  setResponseHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  return sendStream(event, createReadStream(URDF_FILE))
})
