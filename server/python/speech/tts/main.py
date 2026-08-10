"""TTS 演示后端：基于 edge-tts 合成语音。

约定（与 server/api/python/run.post.ts 对齐）：
- 从 stdin 读取 JSON: { "input": str, "params": { "voice": str, "rate": int } }
- 向 stdout 输出 JSON: { "audio": <base64 mp3>, "format": "mp3" }
- 出错时输出 { "error": str } 并以非零状态退出

使用前请在当前目录创建虚拟环境并安装依赖：
    python -m venv .venv
    .venv/bin/pip install -r requirements.txt
"""

import asyncio
import base64
import json
import sys

import edge_tts


async def synthesize(text: str, voice: str, rate: int, volume: int, pitch: int) -> bytes:
    """调用 edge-tts 合成，返回 mp3 字节。rate/volume/pitch 均为整数百分比偏移。"""
    communicate = edge_tts.Communicate(
        text,
        voice,
        rate=f"{rate:+d}%",
        volume=f"{volume:+d}%",
        pitch=f"{pitch:+d}Hz",
    )
    chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])
    return b"".join(chunks)


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.write("\n")


def main() -> None:
    # 优先从 argv[1] 读取 JSON 载荷，回退到 stdin
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
    try:
        req = json.loads(raw or "{}")
    except json.JSONDecodeError:
        emit({"error": "invalid json input"})
        sys.exit(1)

    text = (req.get("input") or "").strip()
    params = req.get("params") or {}
    voice = params.get("voice") or "zh-CN-XiaoxiaoNeural"
    try:
        rate = int(params.get("rate") or 0)
        volume = int(params.get("volume") or 0)
        pitch = int(params.get("pitch") or 0)
    except (TypeError, ValueError):
        rate = 0
        volume = 0
        pitch = 0

    if not text:
        emit({"error": "empty input"})
        sys.exit(1)

    try:
        audio = asyncio.run(synthesize(text, voice, rate, volume, pitch))
    except Exception as e:  # noqa: BLE001
        emit({"error": str(e)})
        sys.exit(1)

    encoded = base64.b64encode(audio).decode("ascii")
    emit({"audio": encoded, "format": "mp3"})


if __name__ == "__main__":
    main()
