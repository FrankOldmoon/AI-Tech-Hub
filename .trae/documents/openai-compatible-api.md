# OpenAI 兼容 API（/v1/*）

## Context

站内已有云端 LLM 代理 `server/api/aigc/llm-chat.post.ts`（前端专用、自定义请求协议、无鉴权），不适合直接暴露给外部工具。目标：新增一套类 OpenAI 的 API（`/v1/chat/completions` + `/v1/models`），让外部可用 OpenAI SDK / 任意兼容客户端（`baseURL: 'https://host/v1'`）调用站内已配置的 Kimi（Moonshot）与 DeepSeek。

设计要点：
- 复用 `server/utils/llm-providers.ts` 的 provider 注册表（模型清单、baseUrl、keyEnv），不新增第二份模型事实来源。
- 鉴权：Bearer Key 白名单，读环境变量 `OPENAI_COMPAT_API_KEYS`（逗号分隔，调用方任意自定义的 key，与上游供应商 key 无关）。**未配置该变量时接口返回 503 disabled**——安全默认，避免上游付费额度被公网白嫖。
- 模型名直接用裸模型 id（`kimi-k3`、`deepseek-v4-pro`…），跨 provider 唯一，`/v1/models` 提供发现。
- 上游两家本身即 OpenAI 兼容协议，body 原样透传（仅替换 model、强制 thinking 模型 temperature=1 的既有约束）。
- 流式沿用 llm-chat 的透明 SSE 转发；非流式直接返回上游 JSON（天然 OpenAI 格式）。
- 加 CORS（`/v1/**` 中间件），支持浏览器直连。

## 改动文件

### 1. `server/utils/openai-compat.ts`（新增）
- `resolveModel(model: string)`：遍历 `llmProviders` 找到 `{ provider, model }`，找不到返回 undefined。
- `verifyAccessKey(event)`：读 `Authorization: Bearer <key>`，与 `process.env.OPENAI_COMPAT_API_KEYS`（逗号分隔）比对；返回 `'ok' | 'missing-config' | 'invalid-key'`。
- `openAiError(statusCode, message, code)`：`createError` + `data: { error: { message, type, code } }`，统一 OpenAI 错误格式。

### 2. `server/routes/v1/models.get.ts`（新增）
- 鉴权（同上）。
- 返回 `{ object: 'list', data: [{ id, object: 'model', created, owned_by: provider.id }] }`。

### 3. `server/routes/v1/chat/completions.post.ts`（新增）
- 鉴权 → 校验 `model`/`messages` → `resolveModel`。
- 上游 key 缺失：`OPENAI_COMPAT_API_KEYS` 已配置说明管理员有意开放，返回 500 提示补 `${keyEnv}`（与 llm-chat 一致）。
- 构造上游请求：转发原 body（messages/stream/temperature/top_p/max_tokens/stop 等 OpenAI 字段天然兼容），强制：thinking 模型 `temperature: 1`；缺省 `stream: false`（OpenAI 默认非流式，与 llm-chat 的默认流式相反）。
- `stream=true`：同 llm-chat 的 SSE 头 + `sendStream` 透传；非流式：直接 `await upstream.json()` 返回。
- 上游错误：透传状态码与摘要文本（OpenAI 错误 JSON 包装）。
- 超时 180s，与 llm-chat 一致。

### 4. `server/middleware/v1-cors.ts`（新增）
- 仅匹配 `/v1/**`：设置 `Access-Control-Allow-Origin: *`、`Allow-Headers: Authorization, Content-Type`、`Allow-Methods: GET, POST, OPTIONS`。
- OPTIONS 预检直接 204 结束。

### 5. `.env.example`（编辑）
- 追加 `OPENAI_COMPAT_API_KEYS=` 及一行中文注释（外部 /v1 API 的调用方 key 白名单，逗号分隔；留空 = 对外关闭）。

## 验证

1. `pnpm eslint --fix`（新文件零报错）、`pnpm typecheck`、`pnpm build`。
2. 单测：新增 `tests/openai-compat.test.ts`（沿用电 direct-import 风格，参照 `tests/model-sources.test.ts`）：
   - `resolveModel` 能命中 moonshot/deepseek 各模型、未知模型返回 undefined；
   - key 校验逻辑（未配置 / 命中 / 未命中，用临时 env）。
3. dev server 手工验证（`.env` 临时设 `OPENAI_COMPAT_API_KEYS=testkey`）：
   - `curl -s localhost:3000/v1/models -H 'Authorization: Bearer testkey'` → 模型列表；
   - 非流式 + `stream: true` 各一次 chat/completions（SSE 分片正常）；
   - 无 key → 401；`OPENAI_COMPAT_API_KEYS` 未配置 → 503；
   - OpenAI SDK 冒烟：`baseURL: 'http://localhost:3000/v1'` + `apiKey: 'testkey'` 跑一条对话。
4. 部署提示（不阻塞）：生产 nginx 需放行 `/v1/*` 转发到 node；Node 24 下维持既有 `NODE_USE_ENV_PROXY=1` 约定。
