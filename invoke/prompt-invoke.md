我想写一个 Node.js 脚本，将 Claude 和 Codex 这两款 CLI AI 工具的调用逻辑封装成一个统一的接口。

## 背景知识

### Claude CLI
- 调用方式：`claude -p "你的问题" --output-format stream-json --verbose`
- 环境变量：需要从 `process.env` 中特殊剔除这几个容易导致异常或污染输出的变量：`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES`, `CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL`, `CLAUDE_AGENT_SDK_VERSION`, `__CFBundleIdentifier`。
- 输出格式示例：
  `{"type":"assistant","message":{"content":[{"type":"text","text":"Hello!"}]}}`

### Codex CLI
- 调用方式：`codex exec --json "你的问题"`
- 输出格式示例：
  `{"type":"item.completed","item":{"type":"agent_message","text":"Hello!"}}`

## 要求

1. 创建一个 `invoke.js` 文件，使用 Node.js 原生的 `child_process.spawn()`。
2. 导出一个统一函数：`function invoke(cli, prompt)`，必须返回一个 `Promise`。
   - `cli` 参数支持入参 `'claude'` 和 `'codex'`。
   - 内部通过判断 `cli` 值，传入对应的命令和清理后的环境变量来启动子进程。
3. 统一使用 `readline` 模块逐行解析 stdout，遇到无法解析格式的内容直接 `try...catch` 忽略：
   - 如果是 `claude`：解析提取 JSON 并寻找 `assistant` 事件中的文本输出到终端 (`process.stdout.write`)。
   - 如果是 `codex`：解析提取 JSON 并寻找 `event.type === 'item.completed'` 且 `event.item.type === 'agent_message'` 中的文本输出到终端。
4. 任何时候都需要把子进程的 stderr 数据输出直接透传给当前工程的 `process.stderr`。
5. 进程结束处理逻辑：由于通过流的方式输出没有换行符，请在触发 `close` 事件时，先打印一个 `\n`，然后再调用 Promise 的 `resolve()` 或 `reject()` 退离逻辑。
6. 使其既可以作为模块被 `require`，也要支持直接在 CLI 独立运行：通过判断 `require.main === module` 的方式，提取 `process.argv` 中的 `cli` 和 `prompt` 来调用自身。

## 运行方式（必须同时支持这两种）

- 作为模块调用：`await invoke('claude', '你好');`
- 命令行直接调用：`node invoke.js codex "请用一句话介绍自己"`

## 不需要

- 不需要 TypeScript
- 不需要任何 npm 第三方依赖（纯原生 Node.js）
- 不需要对 JSON 流过分严格的验证和超时处理（保证基本捕获但不冗余）

请帮我写出包含以上所有逻辑的 `invoke.js` 代码，并简单介绍各功能块是干嘛的。
