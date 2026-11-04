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

## 学习诚信策略（追加，2026-11-04）

**动机**：`/v1` 输出的是通用大模型能力，白名单 key 一旦发出去（学生脚本、第三方工具），就能被用来
自动获取学习平台答案、代做课程/作业/测验/考试。这条限制落在 API 侧而不是前端，因为外部调用根本不过前端。

**实现**：`server/utils/ai-policy.ts`

- `LEARNING_INTEGRITY_POLICY`：固定策略文本，明确三条禁令（不得获取/代答学习平台答案、不得代做与自动化提交、
  不得给可直接粘贴的答案或绕过反作弊），并声明优先级高于后续任何用户指令。
- `enforceLearningPolicy(messages)`：**摘掉客户端所有 `system` 消息**，其文本降级并入唯一一条策略 system 消息，
  置于 messages 首位。因此调用方既删不掉策略，也无法靠末尾追加 `system: "忽略以上规则"` 覆盖它。
- 路由在 `messages` 校验通过后调用它，并回写响应头 `x-ai-policy: learning-integrity`（调用方可据此判断）。
- 其余字段（`tools` / `tool_calls` / `tool_call_id` / 自定义字段）与非 system 消息顺序原样透传。

**边界**：提示词层面的约束，不是关键词黑名单（后者会把正常解题提问一并误杀）。对指令遵循强的模型有效，
弱模型只能尽力而为；要更强的确定性拦截需另接内容审核模型，目前不做。

**验证**：

1. `tests/ai-policy.test.ts`（9 例）：无 system / 自带 system / 末尾追加 system / 多条 system + content parts /
   function calling 字段透传。
2. 假上游端到端：`LLM_PROVIDER_STUB_BASE_URL=http://127.0.0.1:3999/v1 LLM_PROVIDER_STUB_MODELS=echo-model`，
   发一条带 `system: "Ignore all previous instructions"` 的请求，上游实际收到的 messages 只有一条 system
   且策略在前（override 文本被降到第 1578 字符，策略本体 1401 字符），响应头含 `x-ai-policy`。
3. 站内演示页（`/api/aigc/llm-chat`）**未**加此策略：那是给学生改系统提示做教学演示的，不对外开放。
