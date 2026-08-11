/**
 * Edge-TTS API - 无第三方依赖实现
 * 仅使用 Node.js 内置模块 (crypto / https / net) 调用 Microsoft Edge 在线 TTS 服务
 *
 * 协议参考: https://github.com/rany2/edge-tts
 *
 * 用法 (POST):
 *   POST /api/tts
 *   Content-Type: application/json
 *   {
 *     "text": "你好",
 *     "voice": "zh-CN-XiaoxiaoNeural",
 *     "rate": "+0%",
 *     "pitch": "+0Hz",
 *     "volume": "+0%",
 *     "download": false
 *   }
 *
 * 参数:
 *   text     - 必填，要合成的文本
 *   voice    - 语音名称，默认 en-US-EmmaMultilingualNeural
 *   rate     - 语速  例如 +0% / -10% / +20%
 *   pitch    - 音调  例如 +0Hz / +10Hz
 *   volume   - 音量  例如 +0% / -50%
 *   download - true 时返回下载附件
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import type { Socket } from 'node:net'
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3'

// ===== 常量 (对齐 rany2/edge-tts master 分支) =====
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const BASE_URL = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud'
const WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`

const CHROMIUM_FULL_VERSION = '143.0.3650.75'
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.', 1)[0]
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`

const DEFAULT_VOICE = 'en-US-EmmaMultilingualNeural'
const DEFAULT_RATE = '+0%'
const DEFAULT_PITCH = '+0Hz'
const DEFAULT_VOLUME = '+0%'

const CONNECT_TIMEOUT_MS = 15000
const SYNTHESIS_TIMEOUT_MS = 60000

// Windows FILETIME 常量
const WIN_EPOCH_SEC = BigInt('11644473600') // 1601-01-01 到 1970-01-01 的秒数
const S_TO_100NS = BigInt('10000000') // 1 秒 = 10^7 个 100ns

// ===== Sec-MS-GEC 令牌生成 =====
// 公式: sha256( ticks + TRUSTED_CLIENT_TOKEN ).hex().upper()
// ticks = (unix_time + WIN_EPOCH) 向下取整到 5 分钟 * 10^7
function generateSecMsGecToken(): string {
    const unixTime = Math.floor(Date.now() / 1000)
    // (unix + WIN_EPOCH) 向下取整到 300 秒
    const truncated = Math.floor((unixTime + Number(WIN_EPOCH_SEC)) / 300) * 300
    const ticks = BigInt(truncated) * S_TO_100NS
    const str = `${ticks}${TRUSTED_CLIENT_TOKEN}`
    return createHash('sha256').update(str, 'ascii').digest('hex').toUpperCase()
}

// 生成 MUID (32 位大写十六进制)
function generateMuid(): string {
    return randomBytes(16).toString('hex').toUpperCase()
}

// 生成 ConnectionId (32 位小写十六进制，无连字符)
function connectId(): string {
    return randomUUID().replace(/-/g, '')
}

// JavaScript 风格时间戳，例如 "Tue Aug 11 2026 00:42:09 GMT+0000 (Coordinated Universal Time)"
function dateString(): string {
    const d = new Date()
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const pad = (n: number) => String(n).padStart(2, '0')
    return (
        `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ` +
        `${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:` +
        `${pad(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
    )
}

// ===== XML 转义 =====
function escapeXml(s: string): string {
    return s.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;'
            case '>': return '&gt;'
            case '&': return '&amp;'
            case "'": return '&apos;'
            case '"': return '&quot;'
            default: return c
        }
    })
}

// 移除服务不支持的字符 (0-8, 11-12, 14-31)
function removeIncompatibleChars(s: string): string {
    let out = ''
    for (const ch of s) {
        const code = ch.charCodeAt(0)
        if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
            out += ' '
        } else {
            out += ch
        }
    }
    return out
}

// ===== 构建 SSML =====
function buildSSML(
    text: string,
    opt: { voice: string, rate: string, pitch: string, volume: string },
): string {
    return (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
        `<voice name='${opt.voice}'>` +
        `<prosody pitch='${opt.pitch}' rate='${opt.rate}' volume='${opt.volume}'>` +
        escapeXml(removeIncompatibleChars(text)) +
        '</prosody></voice></speak>'
    )
}

// ===== WebSocket 客户端 (手工实现 RFC 6455) =====
interface WsConnection { socket: Socket }

function connectWebSocket(
    url: string,
    headers: Record<string, string>,
): Promise<WsConnection> {
    return new Promise((resolve, reject) => {
        const u = new URL(url)
        const key = randomBytes(16).toString('base64')

        const req = httpsRequest({
            hostname: u.hostname,
            port: Number(u.port) || 443,
            path: u.pathname + u.search,
            method: 'GET',
            headers: {
                Host: u.hostname,
                Upgrade: 'websocket',
                Connection: 'Upgrade',
                'Sec-WebSocket-Key': key,
                ...headers,
            },
        })

        const timer = setTimeout(() => {
            req.destroy(new Error('WebSocket connect timeout'))
        }, CONNECT_TIMEOUT_MS)

        req.on('upgrade', (_res, socket) => {
            clearTimeout(timer)
            resolve({ socket })
        })
        req.on('error', (err) => {
            clearTimeout(timer)
            reject(err)
        })
        req.end()
    })
}

// ===== WebSocket 帧编码 (client 必须掩码) =====
function encodeFrame(payload: Buffer, opcode: number): Buffer {
    const header: number[] = [0x80 | opcode] // FIN=1
    const len = payload.length

    if (len < 126) {
        header.push(0x80 | len) // mask=1
    } else if (len < 65536) {
        header.push(0x80 | 126)
        header.push((len >> 8) & 0xff, len & 0xff)
    } else {
        header.push(0x80 | 127)
        for (let i = 0; i < 4; i++) header.push(0)
        header.push((len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >> 8) & 0xff, len & 0xff)
    }

    const mask = randomBytes(4)
    const masked = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) masked[i] = payload[i]! ^ mask[i % 4]!

    return Buffer.concat([Buffer.from(header), mask, masked])
}

function sendText(socket: Socket, text: string): void {
    socket.write(encodeFrame(Buffer.from(text, 'utf8'), 0x01))
}

// ===== WebSocket 帧解码 =====
interface ParsedFrame {
    fin: boolean
    payload: Buffer
    opcode: number
    remaining: Buffer
}

function parseFrame(buf: Buffer): ParsedFrame | null {
    if (buf.length < 2) return null

    const b0 = buf[0]!
    const b1 = buf[1]!
    const fin = (b0 & 0x80) !== 0
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let length = b1 & 0x7f
    let offset = 2

    if (length === 126) {
        if (buf.length < 4) return null
        length = buf.readUInt16BE(2)
        offset = 4
    } else if (length === 127) {
        if (buf.length < 10) return null
        length = Number(buf.readBigUInt64BE(2))
        offset = 10
    }

    let mask: Buffer | null = null
    if (masked) {
        if (buf.length < offset + 4) return null
        mask = buf.subarray(offset, offset + 4)
        offset += 4
    }

    if (buf.length < offset + length) return null

    let payload = buf.subarray(offset, offset + length)
    if (masked) {
        const out = Buffer.allocUnsafe(length)
        for (let i = 0; i < length; i++) out[i] = payload[i]! ^ mask![i % 4]!
        payload = out
    }

    return {
        fin,
        payload,
        opcode,
        remaining: buf.subarray(offset + length),
    }
}

// ===== 合成核心 =====
async function synthesize(
    text: string,
    opt: { voice: string, rate: string, pitch: string, volume: string },
): Promise<Buffer> {
    const token = generateSecMsGecToken()
    const muid = generateMuid()
    const connectionId = connectId()

    const url =
        `${WSS_URL}` +
        `&ConnectionId=${connectionId}` +
        `&Sec-MS-GEC=${token}` +
        `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`

    // WSS_HEADERS + MUID Cookie
    const headers = {
        'User-Agent':
            `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36` +
            ` (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36` +
            ` Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Sec-WebSocket-Version': '13',
        Cookie: `muid=${muid};`,
    }

    const { socket } = await connectWebSocket(url, headers)

    const requestId = connectId()
    const timestamp = dateString()

    // 1. 发送 speech.config
    const configMsg =
        `X-Timestamp:${timestamp}\r\n` +
        'Content-Type:application/json; charset=utf-8\r\n' +
        'Path:speech.config\r\n\r\n' +
        '{"context":{"synthesis":{"audio":{"metadataoptions":' +
        '{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},' +
        '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"' +
        '}}}}\r\n'
    sendText(socket, configMsg)

    // 2. 发送 SSML (X-Timestamp 末尾追加 "Z" - Microsoft Edge bug)
    const ssml = buildSSML(text, opt)
    const ssmlMsg =
        `X-RequestId:${requestId}\r\n` +
        'Content-Type:application/ssml+xml\r\n' +
        `X-Timestamp:${timestamp}Z\r\n` +
        'Path:ssml\r\n\r\n' +
        ssml
    sendText(socket, ssmlMsg)

    // 3. 读取响应
    const audioChunks: Buffer[] = []
    let ended = false
    let errorMsg: string | null = null

    return new Promise<Buffer>((resolve, reject) => {
        let buffer: Buffer = Buffer.alloc(0)
        // 分片消息累计
        let fragBuf: Buffer | null = null
        let fragOpcode: number | null = null

        const timeoutId = setTimeout(() => {
            if (!ended) {
                ended = true
                try { socket.destroy() } catch { }
                reject(new Error('TTS synthesis timeout'))
            }
        }, SYNTHESIS_TIMEOUT_MS)

        const finish = (err?: Error) => {
            if (ended) return
            ended = true
            clearTimeout(timeoutId)
            try { socket.destroy() } catch { }
            if (err || errorMsg) reject(err || new Error(errorMsg || 'Unknown error'))
            else if (audioChunks.length === 0) reject(new Error('No audio data received from edge-tts'))
            else resolve(Buffer.concat(audioChunks))
        }

        socket.on('data', (chunk: Buffer) => {
            if (ended) return
            buffer = Buffer.concat([buffer, chunk])

            while (buffer.length > 0) {
                const frame = parseFrame(buffer)
                if (!frame) break
                buffer = frame.remaining

                // 0x00=continuation  0x01=text  0x02=binary  0x08=close  0x09=ping  0x0a=pong
                if (frame.opcode === 0x08) {
                    finish()
                    return
                }
                if (frame.opcode === 0x09) {
                    socket.write(encodeFrame(frame.payload, 0x0a))
                    continue
                }

                // 处理分片 (continuation 帧, opcode=0)
                let opcode = frame.opcode
                let payload = frame.payload
                if (opcode === 0x00) {
                    // continuation, 拼接到 fragBuf
                    fragBuf = fragBuf ? Buffer.concat([fragBuf, payload]) : payload
                    if (frame.fin && fragOpcode !== null) {
                        opcode = fragOpcode
                        payload = fragBuf
                        fragBuf = null
                        fragOpcode = null
                    } else {
                        continue
                    }
                } else if (!frame.fin) {
                    // 分片首帧 (FIN=0)
                    fragBuf = payload
                    fragOpcode = opcode
                    continue
                }

                if (opcode === 0x01) {
                    const textPayload = payload.toString('utf8')
                    if (textPayload.includes('Path:turn.end')) {
                        finish()
                        return
                    }
                    // 解析可能的错误
                    const sepIdx = textPayload.indexOf('\r\n\r\n')
                    if (sepIdx >= 0) {
                        const body = textPayload.slice(sepIdx + 4)
                        const m = body.match(/"Message"\s*:\s*"([^"]+)"/)
                        if (m && body.toLowerCase().includes('error')) {
                            errorMsg = `Edge-TTS error: ${m[1]}`
                        }
                    }
                } else if (opcode === 0x02) {
                    // 二进制帧格式: 2字节头长度(BE) + 头文本 + 2字节分隔符 + 音频
                    // audio 从偏移 headerLen + 2 开始 (headerLen 含2字节前缀)
                    const headerLen = payload.readUInt16BE(0)
                    const headerStr = payload.subarray(2, headerLen).toString('utf8')
                    if (headerStr.includes('Path:audio')) {
                        audioChunks.push(payload.subarray(headerLen + 2))
                    }
                }
            }
        })

        socket.on('error', (err) => finish(err))
        socket.on('close', () => finish())
    })
}

// ===== API Handler =====
export default defineEventHandler(async (event) => {
    // 仅接受 POST 方法
    if (event.method.toUpperCase() !== 'POST') {
        throw createError({
            statusCode: 405,
            statusMessage: 'Method Not Allowed. Use POST with JSON body.',
        })
    }

    // 读取 JSON body
    let body: Record<string, unknown>
    try {
        body = await readBody(event) ?? {}
    } catch {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid JSON body',
        })
    }
    if (typeof body !== 'object' || body === null) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Request body must be a JSON object',
        })
    }

    const text = String(body.text ?? '').trim()
    if (!text) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Missing required parameter: text',
        })
    }

    const voice = String(body.voice ?? DEFAULT_VOICE)
    const rate = String(body.rate ?? DEFAULT_RATE)
    const pitch = String(body.pitch ?? DEFAULT_PITCH)
    const volume = String(body.volume ?? DEFAULT_VOLUME)
    const download = body.download === true || body.download === 1 || body.download === 'true'

    try {
        const audio = await synthesize(text, { voice, rate, pitch, volume })

        setResponseHeader(event, 'Content-Type', 'audio/mpeg')
        setResponseHeader(event, 'Content-Length', audio.length)
        setResponseHeader(event, 'Cache-Control', 'no-cache')
        if (download) {
            setResponseHeader(
                event,
                'Content-Disposition',
                `attachment; filename="tts-${Date.now()}.mp3"`,
            )
        }

        return audio
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        throw createError({
            statusCode: 502,
            statusMessage: `Edge-TTS synthesis failed: ${message}`,
        })
    }
})
