# FMA Chat — 踩坑记录 / Troubleshooting Log

> 记录开发过程中遇到的问题及解决方案，供未来迭代参考。
> Issues encountered during development with solutions, for future reference.

---

## Issue #1: esbuild 平台不匹配 / esbuild Platform Mismatch

**日期 / Date**: 2026-03-02
**阶段 / Phase**: Chat Mode 首次启动

**现象 / Symptom**:
```
Error [TransformError]:
You installed esbuild for another platform than the one you're currently using.
Specifically the "@esbuild/aix-ppc64" package is present but this platform
needs the "@esbuild/darwin-arm64" package instead.
```

**原因 / Cause**:
`node_modules` 在不同平台（Linux VM）下安装，然后在 macOS ARM64 上运行。esbuild 包含平台特定的 native 二进制文件，不能跨平台复用。`tsx` 依赖 esbuild，因此 TypeScript 执行直接失败。

**解决 / Solution**:
```bash
rm -rf node_modules package-lock.json
npm install
```
在目标平台上重新安装依赖，确保 esbuild 下载正确的 native 二进制。

**教训 / Lesson**:
- 不要跨平台复制 `node_modules`（Linux ↔ macOS ↔ Windows）
- CI/CD 中应始终 `npm ci` 而非缓存 `node_modules`
- 可考虑 `.gitignore` 中确保 `node_modules/` 不被意外提交

---

## Issue #2: Claude CLI subprocess 无输出 / No Output from Claude CLI Subprocess

**日期 / Date**: 2026-03-02
**阶段 / Phase**: Chat Mode — CLI Runner 集成

**现象 / Symptom**:
Web UI 显示 `(No response received / 未收到响应)`。服务器端无 stdout/stderr 日志。

**原因 / Cause — 三个问题叠加**:

### 2a. 环境变量清理不完整

仅删除 `CLAUDECODE` 不够。Claude CLI 检测多个环境变量来判断是否在嵌套环境中运行：

```javascript
// ❌ 错误：只清理了一个变量
const cleanEnv = { ...process.env };
delete cleanEnv.CLAUDECODE;

// ✅ 正确：清理所有嵌套检测变量
const REMOVE_ENV_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES',
  'CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL',
  'CLAUDE_AGENT_SDK_VERSION',
  '__CFBundleIdentifier',
];
const cleanEnv = { ...process.env };
for (const key of REMOVE_ENV_VARS) {
  delete cleanEnv[key];
}
```

### 2b. stream-json 事件格式与文档不符

官方文档和社区 wiki 描述的格式：
```json
{"type":"message","role":"assistant","content":[{"type":"text","text":"..."}]}
```

实际 CLI 输出格式（通过 `minimal-claude.js` 验证）：
```json
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
```

关键差异：
- 事件类型是 `"assistant"` 而非 `"message"`
- 文本内容嵌套在 `event.message.content` 下，不是 `event.content`

### 2c. stdin 设置错误

```javascript
// ❌ 错误：stdin 设为 'pipe' 然后 end()，可能导致进程挂起
stdio: ['pipe', 'pipe', 'pipe']
child.stdin.end();

// ✅ 正确：stdin 直接设为 'ignore'
stdio: ['ignore', 'pipe', 'pipe']
```

**解决 / Solution**:
参考已验证可用的 `claude-minimal/minimal-claude.js`，修正上述三个问题。

**教训 / Lesson**:
- **先验证实际输出格式，再写 parser** — 文档可能滞后于实际行为
- **已有可工作的参考实现时，直接对齐** — 不要凭文档重新猜测
- **子进程的 env 清理必须完整** — 遗漏任何一个检测变量都会导致静默失败
- 开发 CLI 集成时，始终添加 `console.log` 日志打印原始 stdout/stderr，方便快速定位

---

## Issue #3: Codex CLI 解析器未匹配 `item.completed` 格式 / Codex Parser Missed `item.completed` Format

**日期 / Date**: 2026-03-03
**阶段 / Phase**: Chat Mode — 多模型支持

**现象 / Symptom**:
切换到 Codex 模型后，Web UI 显示空白回复，无任何文本输出。

**原因 / Cause**:
`parseCodexLine()` 期望顶层 `text`/`content` 字段，但真实 Codex CLI（`codex exec --json`）的输出格式为嵌套结构：
```json
{"type":"item.completed","item":{"type":"agent_message","text":"actual response here"}}
```
解析器未处理 `item.completed` 事件类型，导致所有有效内容被跳过。

**解决 / Solution**:
在 `parseCodexLine()` 中新增 `item.completed` 事件处理分支：
- 检查 `raw.type === 'item.completed'`
- 验证 `raw.item?.type === 'agent_message'`（跳过 `reasoning` 类型）
- 从 `raw.item.text` 提取文本内容

**教训 / Lesson**:
- Codex CLI 使用嵌套事件结构（`item.completed` → `item.text`），不是顶层字段
- CLI 文档与实际输出可能不一致，务必用真实日志验证解析器
- 先跑一次 `codex exec --json "hi" | tee codex-output.jsonl` 确认真实格式

---

## Issue #4: Gemini CLI 用户回显导致消息污染 / Gemini CLI User Echo Causes Message Pollution

**日期 / Date**: 2026-03-03
**阶段 / Phase**: Chat Mode — 多模型支持

**现象 / Symptom**:
Gemini 回复前缀包含用户输入，例如用户发 "hi"，回复显示为 "hiHello!" 而非 "Hello!"。多轮对话后越来越严重（历史滚雪球效应）。

**原因 / Cause**:
Gemini CLI（`gemini -p --output-format stream-json`）在输出 assistant 回复之前，会先回显用户消息：
```json
{"type":"message","role":"user","content":"hi"}
{"type":"message","role":"assistant","content":"Hello!"}
```
`parseGeminiLine()` 未按 `role` 字段过滤，导致 user 回显也被当作 assistant 文本拼接。被污染的 assistant 消息存入历史后，下轮作为上下文发回 CLI，形成累积。

**解决 / Solution**:
在 `parseGeminiLine()` 中新增 role 过滤：
```typescript
if (raw.role && raw.role !== 'assistant') return null;
```

**教训 / Lesson**:
- Gemini CLI 会回显用户消息，必须按 `role` 字段过滤
- 多轮对话中，解析器的 bug 会通过历史上下文产生滚雪球效应
- 测试多模型支持时，至少进行 3 轮对话才能暴露累积性问题

---

## Issue #5: Gemini CLI stderr ECONNRESET 错误 / Gemini CLI stderr ECONNRESET Error

**日期 / Date**: 2026-03-03
**阶段 / Phase**: Chat Mode — 多模型支持

**现象 / Symptom**:
Gemini 正常回复后，服务端 stderr 出现如下错误：
```
Error: read ECONNRESET
    at TLSWrap.onStreamRead (node:internal/stream_base_commons:217:20)
    ... Gemini internal stack trace ...
```

**原因 / Cause**:
这是 Gemini CLI 内部的遥测（telemetry）模块在上报使用数据时遇到的网络连接重置错误。与用户的对话内容和功能完全无关。Gemini CLI 进程在主要任务（回复用户）完成后，尝试向 Google 遥测服务器发送数据，此时网络连接被重置。

**解决 / Solution**:
**无需修复**。这是 Gemini CLI 的已知行为，不影响功能。可以在 `cli-runner.ts` 的 stderr 处理中忽略此类错误，或仅在 debug 模式下打印。

**教训 / Lesson**:
- CLI 工具的 stderr 不一定代表致命错误，也可能是内部遥测 / 诊断信息
- 已记录在 AGENTS.md 常见陷阱 #7

---

## 通用建议 / General Advice

1. **在目标机器上安装依赖** — `node_modules` 不能跨平台共享
2. **CLI 子进程集成，先手动测试** — `node minimal-claude.js "hi"` 确认 CLI 可用后再集成到服务器
3. **stream-json 格式以实际为准** — 用 `tee` 保存原始输出：
   ```bash
   claude -p "hi" --output-format stream-json --verbose 2>/dev/null | tee output.jsonl
   ```
4. **保留调试日志** — 上线前可以移除，但开发阶段 `[cli-runner:stdout]` 日志极有价值
