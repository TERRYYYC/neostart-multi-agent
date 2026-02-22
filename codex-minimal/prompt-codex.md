我想写一个 Node.js 脚本，用 child_process.spawn() 调用 Codex CLI（或兼容 OpenAI 的 CLI），并解析它的流式输出。

背景知识
该 CLI 支持以下调用方式：

codex -p "你的问题" — 发送提示词

--stream — 开启流式输出

--json — 输出 NDJSON（每行一个 JSON 对象）

输出格式示例（标准 OpenAI Chunk 格式）：

JSON
{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}
{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}
{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
要求
创建一个 minimal-codex.js 文件

使用 Node.js 原生的 child_process.spawn() 调用命令

使用 readline 模块逐行解析 stdout

核心逻辑：解析每一行 JSON，提取 choices[0].delta.content 字段中的文本（注意：有些行可能没有 content 字段，需要做空值检查）

实时打印出回复内容（不要换行，模拟打字机效果）

处理进程退出

运行方式
node minimal-codex.js "请介绍自己"

不需要
不需要 TypeScript

不需要任何 npm 依赖（纯原生 Node.js）

不需要复杂的错误重试

请帮我写这个脚本，并解释 JSON 解析部分的逻辑。