# FMA Changelog — 变更记录

> 记录每次变更的内容、原因和受影响文件，用于回滚和审计。
> Records changes, reasons, and affected files for rollback and auditing.

---

## [Unreleased] — CLI 健壮性增强 / CLI Robustness Improvements (Heartbeat + Retry + Process Cleanup + stderr Guard)

**日期 / Date**: 2026-03-05
**目标 / Goal**: 参考 `robust-invoke-hw2.js` 的设计，为 CLI subprocess 调用层添加四项关键健壮性改进：心跳超时检测、优雅进程清理、自动重试、stderr 内存保护。

### 问题背景 / Problem Context
- CLI 子进程可能挂住（hang），无输出无退出，SSE 连接无限等待
- 主进程退出时子进程变成孤儿进程（orphan），持续消耗 API 费用
- CLI 偶发的瞬态失败（transient failure）直接暴露给用户，无重试机制
- stderr 无限累积可能导致内存泄漏（verbose CLI 会大量输出到 stderr）

### 变更清单 / Change List

#### 1. `src/chat/cli-runner.ts` — 核心改动（745 行 → 1027 行）

**新增 — 心跳超时机制 / Heartbeat Timeout**:
- 每 10 秒检查 stdout/stderr 最后活动时间
- 超过 `CLI_HEARTBEAT_TIMEOUT`（默认 120s）无输出 → SIGTERM → 5s → SIGKILL 终止子进程
- 超时错误消息包含 stderr tail，便于诊断
- stdout 和 stderr 的 `data` 事件都更新心跳（参考 robust-invoke-hw2.js 设计）

**新增 — 优雅进程清理 / Graceful Process Cleanup**:
- `activeChildren` Set 追踪所有活跃子进程
- `SIGTERM`/`SIGINT` 信号处理器：主进程退出前清理所有子进程
- `killChild()` 使用 `WeakSet` 保证幂等（同一进程不会重复创建 SIGKILL timer）
- 给子进程 6 秒时间退出后强制 `process.exit(1)`

**新增 — 重试机制 / Retry with Backoff**:
- `runCliStreamWithRetry()` 包装函数，替代原 `runCliStream()` 在 server 中的调用
- 仅在**尚未产出任何文本**时才安全重试（避免重复输出）
- 线性退避：attempt × 2 秒
- 智能判断可重试错误（排除 API key 无效、认证失败、rate limit 等）
- 客户端实时收到 `[Retrying... attempt N/M]` 通知
- 可通过 `CLI_MAX_RETRIES` 环境变量配置（默认 3 次）

**修改 — stderr 滑动窗口 / stderr Sliding Window**:
- `stderrOutput` 无限累积 → `stderrTail` 只保留最后 2000 字符
- 防止 verbose CLI 输出导致内存无限增长

**新增 — 导出函数**:
- `runCliStreamWithRetry()` — 带重试的流式 CLI 调用（替代 `runCliStream` 在 server 中的使用）
- `getActiveChildrenCount()` — 获取活跃子进程数量（监控/测试用）

**回滚方式**: 用变更前的 cli-runner.ts 替换，server.ts 中 `runCliStreamWithRetry` 改回 `runCliStream`

#### 2. `src/chat/server.ts` — 小改动（1 行）
- **修改**: `import { runCliStream }` → `import { runCliStreamWithRetry }`
- **修改**: `handleChat()` 中 `runCliStream()` → `runCliStreamWithRetry()`
- **效果**: 所有 chat 请求自动获得重试能力
- **回滚方式**: 改回 `runCliStream` 即可

#### 3. 未修改的文件 / Unchanged Files
- 其他所有文件 — 无需改动

### 新增环境变量 / New Environment Variables
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CLI_HEARTBEAT_TIMEOUT` | `120000` | 心跳超时（毫秒），最小 30000 |
| `CLI_MAX_RETRIES` | `3` | CLI 调用最大重试次数 |

### 技术决策 / Technical Decisions
- **心跳同时检测 stdout+stderr**: 参考 robust-invoke-hw2.js，stderr 输出也算活跃（CLI 打印进度信息到 stderr）
- **重试仅在无文本输出时**: 流式场景下，一旦有文本已发送给客户端，重试会导致重复输出，不安全
- **killChild 幂等性**: 使用 WeakSet 跟踪已触发 kill 的子进程，防止同一进程被多次 kill 产生多个 SIGKILL timer
- **信号处理器只注册一次**: `ensureSignalHandlers()` 使用 flag 防止重复注册
- **不可重试错误白名单**: API key / authentication / forbidden / quota / rate limit 等错误直接抛出，不浪费重试次数

### 参考来源 / References
- `robust-invoke-hw2.js` — 心跳超时、进程清理、重试退避、stderr tail 截断的设计参考

---

## [Unreleased] — Bug 修复 — IME 输入法导致发送后输入框残留文字 / Bug Fix — IME Composition Causes Input Not Cleared After Send

**日期 / Date**: 2026-03-04
**目标 / Goal**: 修复使用中文输入法（或其他 CJK IME）时，发送消息后输入框残留已发送文字的 bug。

### 问题背景 / Problem Context
- 用户使用中文输入法时，即使输入英文字母也会经过 IME 组合（composition）过程
- 按 Enter 键触发 `keydown` 事件 → `sendMessage()` 清空输入框 → 但紧接着 IME 的 `compositionend` 事件把文字重新写回输入框
- 结果：输入框在发送后仍残留已发送的文字

### 变更清单 / Change List

#### 1. `src/public/index.html` — keydown 事件修复
- **新增**: `compositionstart` / `compositionend` 事件监听，跟踪 IME 组合状态（`isComposing` 变量）
- **修改**: `keydown` Enter 判断增加 `!isComposing && !e.isComposing` 双重检查
  - `isComposing`：手动跟踪的变量，兼容旧浏览器
  - `e.isComposing`：浏览器原生属性（KeyboardEvent.isComposing）
- **效果**: IME 组合期间按 Enter 仅确认组合，不触发发送；组合结束后按 Enter 才发送消息
- **回滚方式**: 移除 `compositionstart/end` 监听和 `isComposing` 变量，将 keydown 判断恢复为 `e.key === 'Enter' && !e.shiftKey`

#### 2. `AGENTS.md` — 新增陷阱记录
- **新增**: Pitfall #8 — IME composition & keydown 注意事项
- **版本**: v1.1 → v1.2

#### 3. 未修改的文件 / Unchanged Files
- 其他所有文件 — 无需改动

### 技术决策 / Technical Decisions
- **双重检查策略**: 同时使用手动跟踪变量和原生 `e.isComposing` 属性，确保跨浏览器兼容性
- **最小侵入**: 仅修改 keydown 事件处理逻辑，不影响其他功能

---

## [Unreleased] — 历史消息截断优化 / History Truncation for Token Optimization

**日期 / Date**: 2026-03-04
**目标 / Goal**: 解决 Codex/Gemini 等不支持 session resume 的 provider 在多轮对话中 token 线性膨胀的问题。通过双重截断策略（轮数限制 + 单条字符截断）控制历史拼接长度。

### 问题背景 / Problem Context
- Codex/Gemini 不支持 `--resume`，每次请求需将完整历史拼入 prompt
- 一个简单的 "hi" 在 Codex 上消耗 10,306 input tokens（其中 ~9,700 为 CLI 内部 system prompt，不可控）
- 随着对话增长，历史拼接导致 token 线性膨胀，成本不可控

### 变更清单 / Change List

#### 1. `src/chat/cli-runner.ts` — `buildPromptWithHistory()` 增强
- **修改**: 新增双重截断策略
  - 轮数限制：默认保留最近 10 条消息（环境变量 `MAX_HISTORY_MESSAGES`）
  - 单条截断：每条历史消息超过 2000 字符时截断（环境变量 `MAX_MESSAGE_CHARS`）
- **新增**: 截断提示标记（`[truncated / 已截断]`、`N earlier messages omitted`）
- **新增**: 环境变量安全解析（非法值 fallback 到默认值，含最小值保护）
- **不变**: 函数签名和 export 不变，Claude provider（使用 `--resume`）不受影响
- **回滚方式**: 将 `buildPromptWithHistory()` 恢复为原始的直接拼接版本

#### 2. 未修改的文件 / Unchanged Files
- 其他所有文件 — 无需改动

### 环境变量配置 / Environment Variables
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAX_HISTORY_MESSAGES` | `10` | 历史消息最大条数（最小 2）|
| `MAX_MESSAGE_CHARS` | `2000` | 单条消息最大字符数（最小 100）|

---

## [Unreleased] — Chat 结构化日志 / Chat Structured Logging

**日期 / Date**: 2026-03-04
**目标 / Goal**: 为 Chat 模块添加可检索、可关联、可控级别的结构化日志，解决“问题发生但无法定位”的排障痛点。

### 变更清单 / Change List

#### 1. `src/chat/logger.ts` — 新增
- **新增**: 零依赖 JSON line 日志工具（`debug/info/warn/error`）
- **新增**: `LOG_LEVEL` 环境变量控制日志级别（默认 `info`）
- **新增**: 上下文字段支持（`requestId` / `conversationId` / `provider`）
- **新增**: 错误标准化与长文本截断工具（避免日志过长）
- **回滚方式**: 删除该文件，并将其他文件中的 logger 调用恢复为 `console.*`

#### 2. `src/chat/server.ts` — 接入请求级日志
- **修改**: `POST /api/chat` 每次请求生成 `requestId`，贯穿到 CLI runner
- **新增**: 关键事件日志：请求开始/结束、usage、流错误、路由 404、删除会话命中/未命中
- **修改**: 服务器异常返回增加 `errorId`（便于反查日志）
- **修改**: 启动日志改为结构化 `server.started`
- **回滚方式**: 用变更前的 `server.ts` 替换

#### 3. `src/chat/cli-runner.ts` — 接入子进程与解析日志
- **修改**: `runCliStream()` 增加可选 `logContext` 参数（`requestId`/`conversationId`）
- **新增**: 子进程事件日志：spawn、stdout/stderr chunk（debug 级）、exit、non-zero exit
- **新增**: parser 非 JSON 行日志（debug 级，带 provider + 截断 line）
- **新增**: Gemini telemetry stderr 噪音识别，避免误报
- **回滚方式**: 用变更前的 `cli-runner.ts` 替换

#### 4. `src/chat/conversation.ts` — 接入持久化日志
- **修改**: 磁盘读写、损坏文件跳过、会话 CRUD 全部改为结构化日志
- **回滚方式**: 用变更前的 `conversation.ts` 替换

#### 5. 未修改的文件 / Unchanged Files
- `src/chat/types.ts` — 无需改动
- `src/chat/index.ts` — 无需改动
- `src/public/index.html` — 无需改动
- `src/core/*` — 无需改动

### 技术决策 / Technical Decisions
- **最小依赖策略**: 不引入 pino/winston，先用内建 logger 达成 80% 排障收益
- **默认输出策略**: 默认 `info`，避免开发时刷屏；需要深挖时用 `LOG_LEVEL=debug`
- **关联性优先**: 通过 `requestId + conversationId + provider` 串起一次完整链路

---

## [Unreleased] — Token 用量 + 响应计时显示 / Token Usage + Response Timing Display

**日期 / Date**: 2026-03-03
**目标 / Goal**: 每条 assistant 消息下方显示 token 消耗（输入/输出/缓存）和响应耗时，帮助用户了解成本和性能。

### 变更清单 / Change List

#### 1. `src/chat/types.ts` — 类型扩展
- **修改**: `StreamEvent.type` — 新增 `'usage' | 'timing'` 事件类型
- **新增**: `StreamEvent.usage` — 扩展字段：`cachedTokens`（缓存命中）、`totalTokens`（总量）
- **新增**: `StreamEvent.durationMs` — 响应耗时（毫秒，服务端计算）
- **回滚方式**: 移除新增的类型字段，`type` 恢复为 `'text' | 'error' | 'done'`

#### 2. `src/chat/cli-runner.ts` — 用量提取
- **修改**: `parseClaudeLine()` — 从 `result` 事件的 `usage` 字段提取 input/output/cached tokens
- **修改**: `parseCodexLine()` — 从 `turn.completed` 事件的 `usage` 字段提取 tokens
- **修改**: `parseGeminiLine()` — 从 `result` 事件的 `stats` 字段提取 tokens
- **修改**: `ClaudeStreamMessage` — 新增 `usage`、`total_cost_usd` 字段
- **修改**: `CodexStreamMessage` — 新增 `usage` 字段
- **修改**: `GeminiStreamMessage` — 新增 `stats` 字段
- **回滚方式**: 用变更前的 cli-runner.ts 替换

#### 3. `src/chat/server.ts` — 服务端计时
- **新增**: `handleChat()` 中记录 `startMs`，在 `done` 事件前发送 `timing` 事件
- **回滚方式**: 移除 `startMs` 和 timing 事件发送代码

#### 4. `src/public/index.html` — UI 统计展示
- **新增**: `renderUsageStats()` — 渲染 token 用量和耗时到 `.message-stats` 元素
- **新增**: SSE handler 收集 `usage` 和 `timing` 事件数据
- **新增**: `.message-stats` CSS 样式（浅色背景、小字体、圆角）
- **回滚方式**: 用变更前的 index.html 替换

#### 5. 未修改的文件 / Unchanged Files
- `src/chat/conversation.ts` — 无需改动
- `src/chat/index.ts` — 无需改动
- `src/core/*` — 无需改动

### 技术决策 / Technical Decisions
- **计时方式**: 服务端 `Date.now()` 差值，比客户端计时更准确（排除网络延迟）
- **用量解析**: 每个 provider 独立提取，因为各 CLI 的 usage 字段格式完全不同
- **显示位置**: 每条 assistant 消息底部，不影响消息正文阅读

---

## [Unreleased] — Bug 修复 — Codex/Gemini 解析器 / Bug Fixes — Codex/Gemini Parsers

**日期 / Date**: 2026-03-03
**目标 / Goal**: 根据真实 CLI 日志修复 Codex 和 Gemini 解析器的输出格式匹配错误。

### Bug 清单 / Bug List

#### Bug 1: Codex 解析器未匹配 `item.completed` 格式
- **现象**: Codex 消息无输出，解析器找不到文本内容
- **原因**: 解析器期望顶层 `text`/`content`，但真实 Codex 输出为 `{"type":"item.completed","item":{"type":"agent_message","text":"..."}}`
- **修复**: `parseCodexLine()` 新增 `item.completed` 事件处理，检查 `item.type === 'agent_message'`，跳过 `reasoning` 类型

#### Bug 2: Gemini 用户回显导致消息污染
- **现象**: Gemini 回复前缀包含用户输入（如 "hiHello!" 而非 "Hello!"）
- **原因**: Gemini CLI 在 assistant 回复前先回显 `{"type":"message","role":"user","content":"hi"}`，解析器未过滤 role
- **修复**: `parseGeminiLine()` 新增 `if (raw.role !== 'assistant') return null` 过滤

#### Bug 3: 历史滚雪球（Bug 2 的连锁后果）
- **现象**: 每轮对话 Gemini 回复越来越长，包含所有历史用户输入
- **原因**: 被污染的 assistant 消息存入历史，下轮作为上下文发回 CLI，形成累积
- **修复**: Bug 2 修复后自动解决

### 变更清单 / Change List

#### 1. `src/chat/cli-runner.ts` — 解析器修复
- **修改**: `parseCodexLine()` — 新增 `item.completed` 事件处理分支
- **修改**: `CodexStreamMessage` 接口 — 新增 `item` 嵌套结构类型
- **修改**: `parseGeminiLine()` — 新增 `role` 过滤（仅处理 `assistant` 消息）
- **修改**: `GeminiStreamMessage` 接口 — 新增 `role` 和 `delta` 字段
- **回滚方式**: 用变更前的 cli-runner.ts 替换（不建议，会恢复 bug）

#### 2. 未修改的文件 / Unchanged Files
- 其他所有文件 — 无需改动

### 教训 / Lessons Learned
- CLI 文档与实际输出可能不一致，务必用真实日志验证解析器
- Gemini CLI 会回显用户消息，必须按 `role` 字段过滤
- Codex 使用嵌套事件结构（`item.completed` → `item.text`），不是顶层字段

---

## [Unreleased] — 多模型支持 / Multi-Model Support (Codex + Gemini CLI)

**日期 / Date**: 2026-03-03
**目标 / Goal**: 实现 Chat Mode 的真正多模型支持，用户可在 Web UI 中自由切换 Claude / Codex / Gemini。将 Codex 和 Gemini 从 stub 升级为基于实际 CLI 接口的真实实现。

### 变更清单 / Change List

#### 1. `src/chat/cli-runner.ts` — 核心改动
- **修改**: `buildCodexCommand()` — 从 stub 改为真实实现，使用 `codex exec --json` 获取 JSONL 流式输出
- **修改**: `buildGeminiCommand()` — 从 stub 改为真实实现，使用 `gemini -p --output-format stream-json`
- **新增**: `parseCodexLine()` — Codex JSONL 专用解析器，替换旧的 `parseGenericLine`
- **新增**: `parseGeminiLine()` — Gemini stream-json 专用解析器，替换旧的 `parseGenericLine`
- **删除**: `parseGenericLine()` — 被两个专用解析器替代
- **新增**: `CodexStreamMessage` 和 `GeminiStreamMessage` 接口
- **修改**: `parseLine()` switch — 每个 provider 使用独立解析器
- **新增**: 支持 `CODEX_MODEL`、`GEMINI_MODEL`、`CODEX_PATH`、`GEMINI_PATH` 环境变量
- **回滚方式**: 用变更前的 cli-runner.ts 替换

#### 2. `src/chat/server.ts` — 中等改动
- **修改**: `handleChat()` — 接受请求体中的 `provider` 字段，支持前端按需选择模型
- **新增**: Provider 校验逻辑（仅允许 claude/codex/gemini）
- **新增**: 已有对话延续其存储的 `modelProvider`（一致性保证）
- **修改**: CORS 预检增加 DELETE 方法
- **回滚方式**: 用变更前的 server.ts 替换

#### 3. `src/public/index.html` — UI 改动
- **新增**: 模型选择器下拉菜单（替换静态 model badge）
- **新增**: Provider 颜色指示器（Claude=蓝, Codex=绿, Gemini=紫）
- **新增**: `onProviderChange()` — 切换模型自动开启新对话
- **修改**: `sendMessage()` — 请求体增加 `provider` 字段
- **修改**: `loadSession()` — 加载 session 后同步模型选择器
- **修改**: Session 列表显示每个 session 的 provider 标记
- **回滚方式**: 用变更前的 index.html 替换

#### 4. `.env.example` — 小改动
- **新增**: `CODEX_MODEL`、`CODEX_PATH` 配置项
- **新增**: `GEMINI_MODEL`、`GEMINI_PATH` 配置项
- **新增**: `CLAUDE_PATH` 配置项
- **回滚方式**: 用变更前的 .env.example 替换

#### 5. 未修改的文件 / Unchanged Files
- `src/core/agent.ts` — Agent Pipeline 模式，本次不涉及
- `src/core/types.ts` — 不涉及
- `src/chat/types.ts` — `ModelProvider` 类型已包含 codex/gemini，无需改动
- `src/chat/conversation.ts` — CRUD 已完备，`modelProvider` 已存储，无需改动
- `src/chat/index.ts` — 入口文件无需改动

### 技术决策 / Technical Decisions
- **Codex CLI 接口**: `codex exec --json "prompt"` — 官方非交互模式，JSONL 输出
- **Gemini CLI 接口**: `gemini -p "prompt" --output-format stream-json` — 官方 headless 模式
- **多轮上下文**: Codex/Gemini 不支持 session resume，采用历史拼接方案（同变更前设计）
- **每请求选模型 vs 全局配置**: 采用每请求选模型，已有对话锁定其创建时的 provider

---

## [Unreleased] — AGENTS.md — AI Agent 快速上下文文件

**日期 / Date**: 2026-03-03
**目标 / Goal**: 创建专门给 AI agent 阅读的入口文件，让任何 agent 在 2 分钟内了解项目全貌并开始编码。解决「新 agent 需要读 6+ 文件才能开始工作」的问题。

### 变更清单 / Change List

#### 1. `AGENTS.md` — 新增
- **内容**: 项目一句话描述、架构速览、文件地图（含阅读优先级）、编码规范、当前进度、编码前检查清单、关键设计决策、常见陷阱、文档导航
- **原因**: 审计发现新 agent 缺少单一入口点，上下文分散在多个文件中
- **回滚方式**: 删除 `AGENTS.md` 文件即可

#### 2. `meiyong-plan.md` — 小更新
- **新增**: AGENTS.md 到文档全景图
- **新增**: AI Agent 阅读顺序建议
- **新增**: AI Agent onboarding 到优先级矩阵
- **版本**: v1.1 → v1.2
- **回滚方式**: 移除新增的三处内容，版本号改回 v1.1

#### 3. 未修改的文件 / Unchanged Files
- 其他所有文件 — 无需改动

---

## [Unreleased] — Session 持久化 / Session Persistence (JSON Files)

**日期 / Date**: 2026-03-03
**目标 / Goal**: Session 数据持久化到磁盘，服务器重启后不丢失。采用 JSON 文件方案（方案 A），未来 Phase 5 迁移到 Redis（方案 C）。

### 变更清单 / Change List

#### 1. `src/chat/conversation.ts` — 重构
- **新增**: `saveToDisk(conv)` — 将 Conversation 写入 `.data/conversations/{id}.json`
- **新增**: `removeFromDisk(id)` — 删除对应 JSON 文件
- **新增**: `initStore()` — 启动时从磁盘扫描加载所有 JSON 到内存 Map
- **修改**: `createConversation()` — 末尾加 `saveToDisk()`
- **修改**: `addMessage()` — 末尾加 `saveToDisk()`
- **修改**: `deleteConversation()` — 加 `removeFromDisk()`
- **不变**: 所有导出函数签名不变，上层代码零修改
- **原因**: Session 重启后丢失是核心体验问题
- **策略**: write-through cache（内存读 + 同步写磁盘）
- **回滚方式**: 用变更前的 conversation.ts 替换，删除 `.data/` 目录
- **未来迁移**: 所有磁盘操作函数已标注 `[Phase 5 升级点]`，届时替换为 Redis 命令

#### 2. 未修改的文件 / Unchanged Files
- `src/chat/server.ts` — 无需改动（导出接口不变）
- `src/public/index.html` — 无需改动（API 不变）
- `src/chat/cli-runner.ts` — 无需改动
- `src/chat/types.ts` — 无需改动
- 其他所有文件 — 无需改动

### 边缘情况处理 / Edge Case Handling
- JSON 文件损坏 → `initStore()` 跳过该文件，打印警告，不中断启动
- 磁盘写入失败 → `saveToDisk()` 打印错误，不中断服务（内存中数据仍可用）
- `.data/` 目录不存在 → `mkdirSync({ recursive: true })` 自动创建
- 文件删除失败 → `removeFromDisk()` 打印错误，不中断

---

## [Unreleased] — Session 管理功能 / Session Management Feature

**日期 / Date**: 2026-03-03
**目标 / Goal**: 在 Chat Mode 中添加 Session 管理功能 — 侧边栏展示历史 Session，支持切换、创建新 Session、删除 Session。

### 变更清单 / Change List

#### 1. `src/chat/server.ts` — 小改动
- **新增**: `DELETE /api/conversations/:id` 路由
- **原因**: 前端需要删除 Session 的能力，后端 `conversation.ts` 已有 `deleteConversation()` 方法但没有 HTTP 路由
- **影响范围**: 仅新增路由，不修改现有路由逻辑
- **回滚方式**: 删除新增的 DELETE 路由代码块即可

#### 2. `src/public/index.html` — 重大改动
- **新增**: 侧边栏 (sidebar) 布局，包含 Session 列表
- **新增**: 页面加载时调用 `GET /api/conversations` 渲染 Session 列表
- **新增**: 点击 Session 调用 `GET /api/conversations/:id` 加载历史消息
- **新增**: 删除 Session 功能（调用 `DELETE /api/conversations/:id`）
- **修改**: 布局从纯纵向 (header+messages+input) 变为 sidebar + main area
- **修改**: `newChat()` 函数增加侧边栏高亮状态重置
- **修改**: `sendMessage()` 函数在发送后刷新侧边栏列表
- **新增**: 流式响应中切换 Session 时中止旧请求 (AbortController)
- **新增**: 侧边栏折叠/展开按钮（移动端适配）
- **原因**: 核心需求 — 用户需要查看历史对话并继续聊天
- **影响范围**: 纯前端变更，不影响后端逻辑和 Agent pipeline
- **回滚方式**: 用变更前的 index.html 替换即可

#### 3. 未修改的文件 / Unchanged Files
- `src/chat/cli-runner.ts` — 无需改动
- `src/chat/conversation.ts` — 无需改动（CRUD 已完备）
- `src/chat/types.ts` — 无需改动
- `src/chat/index.ts` — 无需改动
- `src/core/*` — 无需改动
- `src/agents/*` — 无需改动
- `src/index.ts` — 无需改动

### 已知限制 / Known Limitations
- Session 数据存储在内存中，服务器重启后丢失（Phase 5 将加入 Redis 持久化）
- 侧边栏不分页，大量 Session 时依赖滚动（内存存储天然有限，暂时够用）

### 边缘情况处理 / Edge Case Handling
- 流式响应中切换 Session → AbortController 中止旧请求
- 删除当前正在使用的 Session → 重置为新对话状态
- 空 Session（无消息）→ 不会出现在列表中（由服务端创建时机决定）
- 页面刷新 → Session 列表重新从服务端加载

---

*格式说明：每次变更占一个 `## [version/tag]` 区块，新变更追加在最前面。*
