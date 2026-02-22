# minimal-claude

用 Node.js 原生模块通过 `child_process.spawn()` 调用 Claude CLI，并解析流式 JSON 输出。

## 依赖

- Node.js（原生模块，无任何 npm 依赖）
- Claude Desktop 已安装并登录

## 运行方式

```bash
node minimal-claude.js "你好，请用一句话介绍自己"
```

自定义 Claude CLI 路径：

```bash
CLAUDE_PATH=/path/to/claude node minimal-claude.js "hello"
```

## 工作原理

调用 Claude CLI 的 `--output-format stream-json` 模式，每行输出一个 JSON 事件（NDJSON），过滤出 `type === "assistant"` 的事件并打印文本内容。

```
{"type":"system","subtype":"init","session_id":"..."}
{"type":"assistant","message":{"content":[{"type":"text","text":"Hello!"}]}}
{"type":"result","subtype":"success","session_id":"..."}
```

## 调试记录：三个坑

### 坑 1：`claude` 不在 PATH 里

**现象**：`spawn('claude', [...])` 直接报错 `command not found`。

**原因**：Claude Desktop 安装的 CLI 二进制不在系统 PATH 中。

**位置**：
```
~/Library/Application Support/Claude/claude-code/<version>/claude
```

**解决方案**：用完整路径，支持通过环境变量覆盖：

```js
const CLAUDE = process.env.CLAUDE_PATH
  || '/Users/terry/Library/Application Support/Claude/claude-code/2.1.41/claude';
```

---

### 坑 2：嵌套会话被拒绝

**现象**：在 Claude Code 终端里运行时，子进程立即退出并报错：

```
Error: Claude Code cannot be launched inside another Claude Code session.
```

**原因**：Claude Desktop 设置了 `CLAUDECODE=1` 等环境变量，CLI 检测到后拒绝启动嵌套会话。

**解决方案**：spawn 时传入清理过的 `env`，删除会触发嵌套检测的变量，但保留认证 token：

```js
const env = { ...process.env };
const REMOVE_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES',
  'CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL',
  'CLAUDE_AGENT_SDK_VERSION',
  '__CFBundleIdentifier',
];
REMOVE_VARS.forEach((key) => delete env[key]);
// CLAUDE_CODE_OAUTH_TOKEN 必须保留，否则认证失败
```

---

### 坑 3：进程启动成功但永远无输出

**现象**：`spawn` 成功，pid 存在，但 stdout/stderr 没有任何数据，进程挂起不退出。

**原因**：CLI 即使在 `-p` 非交互模式下，仍会检测 stdin 是否开放。父进程的 stdin 被继承后，CLI 等待 stdin 关闭才开始处理。

**解决方案**：显式关闭 stdin：

```js
const child = spawn(CLAUDE, [...], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],  // stdin 关闭，stdout/stderr 走 pipe
});
```

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `CLAUDE_PATH` | 覆盖 Claude CLI 二进制路径，用于多版本切换 |
