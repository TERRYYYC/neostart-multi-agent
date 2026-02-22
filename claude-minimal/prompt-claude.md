我想写一个 Node.js 脚本，   

## 背景知识

Claude CLI 支持以下调用方式：
- `claude -p "你的问题"` — 非交互模式
- `--output-format stream-json` — 输出 NDJSON（每行一个 JSON）
- `--verbose` — 必须和 stream-json 一起用

    输出格式示例：
    {"type":"system","subtype":"init","session_id":"abc123"}
    {"type":"assistant","message":{"content":[{"type":"text","text":"Hello!"}]}}
    {"type":"result","subtype":"success","session_id":"abc123"}

## 要求

1. 创建一个 `minimal-claude.js` 文件
2. 使用 Node.js 原生的 `child_process.spawn()`
3. 使用 `readline` 模块逐行解析 stdout
4. 解析 JSON，提取 `assistant` 类型事件中的文本内容
5. 打印出 Claude 的回复
6. 处理进程退出

## 运行方式

node minimal-claude.js "你好，请用一句话介绍自己"

## 不需要

- 不需要 TypeScript
- 不需要任何 npm 依赖（纯原生 Node.js）
- 不需要错误重试、超时处理（保持简单）

请帮我写这个脚本，并解释关键部分的代码。
