# FMA Changelog — 变更记录

> 记录每次变更的内容、原因和受影响文件，用于回滚和审计。
> Records changes, reasons, and affected files for rollback and auditing.

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
