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

## 通用建议 / General Advice

1. **在目标机器上安装依赖** — `node_modules` 不能跨平台共享
2. **CLI 子进程集成，先手动测试** — `node minimal-claude.js "hi"` 确认 CLI 可用后再集成到服务器
3. **stream-json 格式以实际为准** — 用 `tee` 保存原始输出：
   ```bash
   claude -p "hi" --output-format stream-json --verbose 2>/dev/null | tee output.jsonl
   ```
4. **保留调试日志** — 上线前可以移除，但开发阶段 `[cli-runner:stdout]` 日志极有价值
