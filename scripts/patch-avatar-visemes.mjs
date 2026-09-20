#!/usr/bin/env node
/**
 * 把头像 GLB 的口型 blendshape 名改成 TalkingHead / HeadAudio 认的 Oculus 命名。
 *
 * 为什么需要它：TalkingHead 与 HeadAudio 都按 `viseme_*` 查 morph target
 * （talkinghead.mjs 里是 morphTargetDictionary['viseme'+x]），而免费头像资产常用
 * 不带前缀的写法，且元音用 ih/oh/ou 而不是 I/O/U。ARKit 的那套名字两边是一致的，
 * 原样保留。
 *
 * 用法：node scripts/patch-avatar-visemes.mjs <in.glb> <out.glb>
 *
 * 来源：public/avatar/nova.glb 派生自 VTubeMe 免费头像（CC BY 4.0，需署名）。
 * 本脚本对资产做了修改（改名），按 CC BY 4.0 需注明「已修改」——见 public/avatar/CREDITS.txt。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const RENAME = {
  sil: 'viseme_sil',
  PP: 'viseme_PP',
  FF: 'viseme_FF',
  TH: 'viseme_TH',
  DD: 'viseme_DD',
  kk: 'viseme_kk',
  CH: 'viseme_CH',
  SS: 'viseme_SS',
  nn: 'viseme_nn',
  RR: 'viseme_RR',
  aa: 'viseme_aa',
  E: 'viseme_E',
  ih: 'viseme_I',
  oh: 'viseme_O',
  ou: 'viseme_U'
}

const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const GLB_MAGIC = 0x46546c67

function readGlb(buf) {
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('不是 GLB（magic 不匹配）')
  const total = buf.readUInt32LE(8)
  const chunks = []
  let off = 12
  while (off + 8 <= total) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) })
    off += 8 + len + ((4 - (len % 4)) % 4)
  }
  return chunks
}

function padTo4(buf, fill) {
  const rem = buf.length % 4
  if (!rem) return buf
  return Buffer.concat([buf, Buffer.alloc(4 - rem, fill)])
}

function writeGlb(json, bin) {
  const jsonBuf = padTo4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20)
  const binBuf = bin ? padTo4(bin, 0) : null
  const parts = []
  const header = Buffer.alloc(12)
  header.writeUInt32LE(GLB_MAGIC, 0)
  header.writeUInt32LE(2, 4)
  const jsonHead = Buffer.alloc(8)
  jsonHead.writeUInt32LE(jsonBuf.length, 0)
  jsonHead.writeUInt32LE(JSON_CHUNK, 4)
  parts.push(header, jsonHead, jsonBuf)
  if (binBuf) {
    const binHead = Buffer.alloc(8)
    binHead.writeUInt32LE(binBuf.length, 0)
    binHead.writeUInt32LE(BIN_CHUNK, 4)
    parts.push(binHead, binBuf)
  }
  const out = Buffer.concat(parts)
  out.writeUInt32LE(out.length, 8)
  return out
}

const [, , inFile, outFile] = process.argv
if (!inFile || !outFile) {
  console.error('用法：node scripts/patch-avatar-visemes.mjs <in.glb> <out.glb>')
  process.exit(1)
}

const chunks = readGlb(readFileSync(inFile))
const jsonChunk = chunks.find(c => c.type === JSON_CHUNK)
const binChunk = chunks.find(c => c.type === BIN_CHUNK)
if (!jsonChunk) throw new Error('缺少 JSON chunk')
const gltf = JSON.parse(jsonChunk.data.toString('utf8'))

const renamed = []
for (const mesh of gltf.meshes || []) {
  const names = mesh.extras?.targetNames
  if (!Array.isArray(names)) continue
  mesh.extras.targetNames = names.map((n) => {
    const to = RENAME[n]
    if (to) renamed.push(`${n}→${to}`)
    return to || n
  })
}

/* TalkingHead 用 getObjectByName(opt.modelRoot) 找骨架，默认名就是 "Armature"；
   免费资产的根节点常叫别的（nova 是 "AvatarRoot"）。这里统一改名，页面就不用为
   每个资产写一个 modelRoot。 */
let rootRenamed = ''
const scene = gltf.scenes?.[gltf.scene ?? 0]
const rootIdx = scene?.nodes?.[0]
if (rootIdx !== undefined && gltf.nodes?.[rootIdx] && gltf.nodes[rootIdx].name !== 'Armature') {
  rootRenamed = `${gltf.nodes[rootIdx].name}→Armature`
  gltf.nodes[rootIdx].name = 'Armature'
}

/* 注：头一直「往下看」不是这个文件能解决的 —— TalkingHead 加载后会用
   poseBase 覆盖头骨旋转，改 GLB 里的骨头旋转不生效。抬头是在页面侧
   levelAvatarPose() 里做的（同时压掉随机站姿模板里的低头）。 */

writeFileSync(outFile, writeGlb(gltf, binChunk?.data))
console.log(`[patch-avatar-visemes] ${inFile} → ${outFile}`)
console.log(`  改名 ${renamed.length} 个：${renamed.join(', ')}`)
if (rootRenamed) console.log(`  骨架根节点：${rootRenamed}`)
