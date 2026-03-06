# FMA Future Structure — 演进架构方案

> **作者视角声明**：本文以持怀疑态度的架构师身份撰写。方案经过与业界最优秀实践（LangGraph、AutoGen、CrewAI、MetaGPT、Swarm）的比对验证，也不断从 p006-cat-cafe、p004-swarm-ide 等一手学习经验中汲取。计划会错，现实会变，但思考框架不会白费。

---

## 本次设计亮点 / Design Highlights

> 先说结论，再讲过程。

**① 图结构替代线性流水线（核心升级）**
当前 Planner → Coder → Reviewer 是单向链。真实工程需要「Reviewer 发现 P1 问题 → 返回 Coder 重试」的反馈循环。不引入图结构，这个循环永远实现不了。对标：LangGraph 的节点-边-状态机模型。

**② 三层演进里程碑，每层独立可交付**
- 里程碑 A（v0.x）：本地 CLI 工具，工程师可用
- 里程碑 B（v1.x）：本地全栈应用，非工程师可用
- 里程碑 C（v2.x）：跨平台桌面 + 移动端联动，随时随地可用

**③「可插拔层」贯穿始终**
`core/agent.ts` 从 SDK → CLI → 多模型路由，上层 Agent 代码零修改。这不是口号，是每个 Phase 都被严格约束的设计原则。

**④ 成本分层（从 Phase 2 开始）**
不同任务用不同模型：Planner 用 Opus（需深度推理）、Coder 用 Sonnet（平衡）、Reviewer 用 Haiku（结构化审查，省钱）。业界测算，合理分层可降低 60-70% API 成本。

**⑤ 从 p006 学到的「观测先行」**
p006 的 28 秒数据丢失事故，根本原因是没有可观测性——不知道 Agent 在做什么。本方案从 Phase 3 开始强制加入结构化日志 + 事件流，Phase 5 后变成可视化。

**⑥ 三层数据安全（不重蹈 p006 覆辙）**
物理隔离（dev/prod 端口分离）+ 结构防火墙（目录大小校验）+ 正确性证明（property testing），在 Phase 5 引入 Redis 时同步落地。

**⑦ 跨平台策略务实**
macOS 优先（开发者主平台）→ Linux（服务器部署）→ 移动端用 PWA（不另开 RN 工程，维护成本决定生死）。

---

## 当前状态 / Current Baseline

```
v0.1.0 — Sequential Pipeline CLI（2026-03-01）

User Input (CLI)
      │
      ▼  await
  Planner ──plan──► Coder ──code──► Reviewer ──► stdout

技术栈：TypeScript + Anthropic SDK + tsx
限制：单模型、无持久化、无反馈循环、无 UI
```

```
⚠️ 实际进展（2026-03-03 更新）：

在 Phase 2 之前，已额外完成 Chat Mode 模块：

  Browser ──POST /api/chat──► HTTP Server (Node.js built-in)
      ▲                            │
      │ SSE stream                 ▼  spawn()
      │                     CLI Runner (claude/codex/gemini)
      │                            │
      └────────────────────────────┘

新增能力（计划外，但为后续 Phase 铺路）：
  ✅ Web UI（Chat 界面 + 侧边栏 Session 管理）
  ✅ CLI subprocess 抽象层（多模型 spawn，含 session resume）
  ✅ SSE 流式响应（非轮询）
  ✅ HTTP API（POST /api/chat, GET/DELETE /api/conversations）
  ✅ 对话持久化（JSON 文件，write-through cache）
  ✅ Session 管理（创建/切换/删除/历史列表）

已额外完成（v1.1，2026-03-03）：
  ✅ 多模型实际切换（Codex: codex exec --json, Gemini: gemini -p --output-format stream-json）
  ✅ Token 用量 + 响应计时（每条 assistant 消息显示 input/output/cached tokens + 耗时）
  ✅ Bug 修复：Codex item.completed 解析 + Gemini 用户回显过滤

已额外完成（v1.3，2026-03-05）：
  ✅ 重试 + 超时保护（心跳超时 120s，自动重试 3 次，线性退避）
  ✅ 优雅进程清理（SIGTERM/SIGINT 信号处理，防孤儿进程）
  ✅ stderr 滑动窗口（2000 字符，防内存泄漏）

已额外完成（v1.4，2026-03-05 — Phase 2）：
  ✅ Agent Pipeline 多模型 CLI Runner（core/agent.ts SDK → CLI subprocess）
  ✅ 成本分层配置（Planner=opus, Coder=sonnet, Reviewer=haiku）
  ✅ 环境变量覆盖（PLANNER_PROVIDER/MODEL, CODER_PROVIDER/MODEL, REVIEWER_PROVIDER/MODEL）

仍然缺少：
  ⏳ 反馈循环（Reviewer → Coder）
  ⏳ 持久化迁移到 Redis（当前 JSON 文件为过渡方案）
  ✅ Web UI 中触发 Pipeline 模式（Phase 2.5 已完成）
```

---

## 演进路线图 / Evolution Roadmap

### ─────────────────────────────────────────
### 里程碑 A：本地 CLI 工具（工程师自用）
### ─────────────────────────────────────────

#### Phase 2 — v0.2：多模型 + CLI Runner + 韧性 ✅ 已完成
**目标**：把 SDK 换成 CLI subprocess，同时支持 Claude / GPT-Codex / Gemini；加入重试和超时。
**预估工作量**：2-3 天
**✅ 完成日期**：2026-03-05

**实际完成内容：**
- ✅ `core/agent.ts` 从 Anthropic SDK 替换为 CLI subprocess（复用 `cli-runner.ts`）
- ✅ 每个 Agent 独立 provider + model 配置（Planner=opus, Coder=sonnet, Reviewer=haiku）
- ✅ 环境变量覆盖（`PLANNER_PROVIDER`/`PLANNER_MODEL` 等 6 个新变量）
- ✅ 自动重试 + 心跳超时（继承自 cli-runner.ts）
- ✅ stderr 滑动窗口 + 优雅进程清理（继承自 cli-runner.ts）
- ✅ Token 用量日志（agent.usage 事件）
- ✅ System prompt 通过 `<system>` XML 标签前置拼接

**核心改动：**
```
src/core/agent.ts（主要改动文件）
  before：client.messages.create(...)       ← Anthropic SDK
  after： runCliStreamWithRetry(provider, prompt, [], sessionId)  ← CLI subprocess
          collectStreamOutput() 将流式输出收集为 Promise<string>
```

**剩余工作（Phase 2.5 可选）：**
- ⏳ 多模型成本对比日志（已有 token 用量，待加价格计算）
- ⏳ Web UI 中触发 Pipeline 模式（当前仅 CLI 入口）

**参考**：p006 ADR-001（CLI > SDK）、p006 lesson-02（生产级 CLI 工程）

**已知技术债**：
- TD-09: `core/agent.ts` 依赖 `chat/cli-runner.ts`（core → chat 方向），Phase 3 应提取 shared subprocess 层

---

#### Phase 2.5 — v0.2.5：Web UI Pipeline 模式 ✅ 已完成
**目标**：在现有 Chat Mode Web UI 中增加 Pipeline 模式入口，让用户可以通过浏览器触发 Planner → Coder → Reviewer 流水线，实时查看每个 Agent 的进度和输出。
**预估工作量**：1-2 天
**✅ 完成日期**：2026-03-05

**设计思路：**
```
┌─────────────────────────────────────────────────────┐
│  Web UI — Pipeline Mode                             │
│                                                     │
│  ┌─ Mode Selector ───────────────────────────────┐  │
│  │  [💬 Chat Mode]  [🚀 Pipeline Mode]           │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌─ Pipeline Input ──────────────────────────────┐  │
│  │  [textarea: 编程任务描述]                       │  │
│  │  [model config: Planner/Coder/Reviewer 模型]   │  │
│  │  [▶ Start Pipeline]                           │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌─ Pipeline Progress ───────────────────────────┐  │
│  │  🧠 Planner   [██████████] ✅ Done (12.3s)    │  │
│  │  💻 Coder     [████░░░░░░] Running...          │  │
│  │  🔍 Reviewer  [░░░░░░░░░░] Waiting             │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌─ Agent Output Tabs ───────────────────────────┐  │
│  │  [Plan] [Code] [Review]                        │  │
│  │  （每个 Tab 显示对应 Agent 的实时流式输出）       │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**核心改动：**

1. **新增 API**：`POST /api/pipeline` — 接收任务描述 + 模型配置，返回 SSE 流
   - SSE 事件类型：`agent-start`、`agent-text`、`agent-done`、`pipeline-done`
   - 复用现有 `runAgent()`，包装为 SSE 流式输出

2. **修改 `src/chat/server.ts`**：新增 `/api/pipeline` 路由

3. **修改 `src/public/index.html`**：
   - 顶部 Mode 切换器（Chat / Pipeline）
   - Pipeline 模式：任务输入框 + 进度条 + Agent 输出 Tab

4. **不修改**：`core/agent.ts`、`agents/*.ts`、`cli-runner.ts`

**参考**：Chat Mode SSE 流式实现（server.ts）、Phase 6 Artifact Panel 设计预演

**实际完成内容：**
- ✅ `POST /api/pipeline` SSE 路由 — 接收任务 + Agent 配置，流式推送进度
- ✅ SSE 事件类型：`pipeline-init`, `agent-start`, `agent-text`, `agent-done`, `agent-error`, `agent-usage`, `pipeline-done`, `pipeline-error`
- ✅ Mode Switcher — Chat / Pipeline 顶部切换
- ✅ Pipeline 任务输入区 — textarea + 每个 Agent 可选 provider + model
- ✅ Pipeline 进度条 — Waiting → Running（脉冲动画）→ Done（绿色）/ Error（红色）
- ✅ Pipeline 输出 Tabs — Plan / Code / Review 实时流式显示，自动切换
- ✅ 快捷键 — Ctrl/Cmd+Enter 启动 Pipeline
- ✅ 零缓冲流式 — `runCliStreamWithRetry` → `emitter.on('data')` → `res.write(SSE)` 直达浏览器

**已知技术债：**
- TD-10: System prompt 在 `server.ts`（内联）和 `agents/*.ts` 中重复，Phase 4 提取共享配置

---

#### Phase 3 — v0.3：异步队列 + 持久化 + 首个并行
**目标**：引入 Filesystem Queue 解耦 Agent 调用；保存任务历史；Reviewer 与 Tester 并行。
**预估工作量**：3-5 天

**架构变化：**
```
before（Phase 2）：Orchestrator 直接 await agent()

after（Phase 3）：
  Orchestrator
      │ 写入
      ▼
  .queue/tasks/{taskId}.json
      │ 消费
      ├──► Planner Worker（读 task，写 plan）
      ├──► Coder Worker（读 plan，写 code）
      └──► [Reviewer Worker ‖ Tester Worker]（并行，都只读 code）
              │             │
              └─────────────┘
              写入 .queue/results/{taskId}.json
```

**新增 Agent：Tester**
- 角色：根据代码写单元测试（TypeScript + vitest）
- 输入：task + plan + code
- 输出：测试文件（可直接运行）
- 与 Reviewer 并行，互不依赖

**新增能力：**
- 任务队列（Filesystem，参考 p003 lesson 核心原语）
- TaskContext 持久化（JSON 文件，进程崩溃可续跑）
- 断点恢复（已完成的 Agent 不重跑）
- 结构化日志（每个 Agent 输出带 timestamp + taskId + agentName）
- `npm run status` 查看当前队列状态

**参考**：p003 agent-teams-reverse（filesystem queue primitive）、p004 AgentRunner（并行激活）

---

#### Phase 4 — v0.4：图编排 + 反馈循环 + Human-in-Loop + MCP 工具
**目标**：从线性流水线升级为 DAG（有向无环图）+ 条件边；加入 Agent 间反馈机制；引入 MCP 工具调用。
**预估工作量**：5-7 天

**这是 FMA 最重要的架构升级。**

**图结构设计（参考 LangGraph 核心理念）：**
```
                    ┌───────────┐
                    │  START    │
                    └─────┬─────┘
                          │
                    ┌─────▼─────┐
                    │  Planner  │
                    └─────┬─────┘
                          │ plan
                    ┌─────▼─────┐
              ┌────►│   Coder   │◄──────────────┐
              │     └─────┬─────┘               │
              │           │ code                │ 重试（有限次）
              │     ┌─────▼──────┐              │ retry (bounded)
              │     │  Reviewer  ├──P1 found────┘
              │     └──────┬─────┘
              │            │ P2/P3 only or no issues
              │     ┌──────▼──────┐
              │     │   Tester    │
              │     └──────┬──────┘
              │            │ test failures?
              └────────────┘ （测试失败回 Coder）

              ┌──────────────────────────────────┐
              │     Human Checkpoint（可选）       │
              │  每个关键节点后可暂停等待人工确认    │
              └──────────────────────────────────┘
```

**条件边逻辑（Conditional Edges）：**
```typescript
// 简化示意
function routeAfterReview(ctx: TaskContext): NextNode {
  const p1Count = countIssues(ctx.review, 'P1');
  if (p1Count > 0 && ctx.retryCount < MAX_RETRY) return 'coder'; // 返工
  if (ctx.retryCount >= MAX_RETRY) return 'human_checkpoint';    // 升级人工
  return 'tester'; // 继续
}
```

**MCP 工具集成（参考 p006 lesson-05）：**
- `file_write`：直接把代码写入文件系统
- `shell_exec`：运行测试（vitest），返回结果
- `search`：代码库搜索（不用全量上下文）
- Agent 调用 MCP 工具与调用其他 Agent 同等地位

**Human-in-Loop 策略（参考 AutoGen HumanProxyAgent）：**
- P1 问题超过阈值后暂停，CLI 显示问题摘要，等待 y/n
- 可配置：`--auto-approve` 跳过所有 human check（CI 环境用）
- 人工意见作为新的 Context 注入下一轮

**参考**：LangGraph（图结构编排）、AutoGen（Human proxy）、p006 lesson-05（MCP 双路径）

---

### ─────────────────────────────────────────
### 里程碑 B：本地全栈应用（非工程师可用）
### ─────────────────────────────────────────

#### Phase 5 — v0.5：本地后端服务
**目标**：从 CLI 工具升级为常驻服务，提供 REST API + WebSocket/SSE；引入 Redis 持久化与三层数据安全。
**预估工作量**：5-7 天

**服务架构：**
```
┌─────────────────────────────────────────┐
│          FMA Local Server               │
│          (Fastify, port 3001)           │
│                                         │
│  REST API:                              │
│    POST /tasks          — 提交任务       │
│    GET  /tasks/:id      — 查询状态       │
│    GET  /tasks          — 历史列表       │
│    GET  /tasks/:id/ctx  — 完整 Context  │
│                                         │
│  SSE:                                   │
│    GET  /tasks/:id/stream  — 实时进度   │
│    （每个 Agent 开始/结束时推事件）        │
│                                         │
│  WebSocket（可选）：                     │
│    ws://localhost:3001  — 双向通信       │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐   ┌──────────────────────┐
│  Redis (port 6399)  │   │  Graph Engine         │
│  任务 + Context 持久化│   │  （Phase 4 的图编排）  │
│  dev: 6398          │   └──────────────────────┘
│  prod: 6399         │
└─────────────────────┘
```

**三层数据安全（从 p006 lesson-06 直接迁移）：**
```
Layer 1: 物理隔离
  - dev Redis: port 6398 (.env.local)
  - prod Redis: port 6399 (.env)
  - 进程无法越界写入

Layer 2: 结构防火墙
  - 任务写入前校验 schema（zod）
  - 目录大小上限（防止 Agent 乱写文件）
  - 禁止删除 key 的 Redis 命令白名单

Layer 3: 正确性证明
  - 状态机 spec + fast-check property testing
  - 500 轮随机测试（参考 p006 F25 fix）
  - CI 必须通过才能部署
```

**⚠️ 实际进展备注（2026-03-03）**：
Chat Mode 已提前实现了部分 Phase 5 的内容：HTTP 服务器（Node.js 内置 http，非 Fastify）、REST API、SSE 流式响应。对话持久化已用 JSON 文件作为过渡方案（`.data/conversations/*.json`），`conversation.ts` 中所有磁盘操作函数已标注 `[Phase 5 升级点]`，届时只需将 `saveToDisk → Redis SET`、`removeFromDisk → Redis DEL`、`initStore → Redis SCAN`，导出函数签名不变。

**参考**：p006 lesson-06（三层防御）、p004（AgentRuntime 全局单例设计）

---

#### Phase 6 — v1.0：本地 Web 前端（里程碑 B 完成）
**目标**：Next.js 前端，实时可视化 Agent DAG 执行过程；Artifact Panel 展示代码输出。
**预估工作量**：7-10 天

**前端架构（参考 p005 DeerFlow + p004 Swarm-IDE）：**
```
┌──────────────────────────────────────────────────────┐
│                   FMA Web UI                         │
│   Next.js 15 App Router + React 19 + Tailwind CSS    │
│                                                      │
│  ┌─────────────────────┐  ┌─────────────────────┐   │
│  │   Task Input Panel   │  │   Agent DAG Panel   │   │
│  │                      │  │                     │   │
│  │  [textarea: task]    │  │  🧠 Planner ──►     │   │
│  │  [model config]      │  │    💻 Coder  ──►    │   │
│  │  [submit button]     │  │      🔍 Reviewer    │   │
│  │                      │  │  （XY Flow 可视化）  │   │
│  └─────────────────────┘  └─────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │              Artifact Panel                   │   │
│  │  Plan │ Code │ Review │ Tests                 │   │
│  │  （参考 p005 Artifact Panel + CodeMirror）    │   │
│  │  Tab 切换，代码可直接编辑                       │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │              Task History                     │   │
│  │  （TanStack Query 缓存，SSE 实时更新状态）      │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

**技术选型理由：**
- **Next.js App Router**：与 p005 保持一致，App Router 成熟
- **XY Flow**：Agent DAG 可视化，参考 p005 的选型
- **TanStack Query v5**：任务历史缓存 + 乐观更新，参考 p005
- **CodeMirror 6**：代码输出内联编辑，参考 p005
- **SSE（不用 WebSocket）**：服务端推客户端单向即可，实现最简

**Context Cleaner（参考 p006 lesson-07）：**
- 用户看到：Rich Blocks（格式化的计划/代码/审查）
- AI 接收：精简 JSON 摘要（不含 UI 渲染信息）
- 这条原则从 Phase 6 开始强制落地

---

### ─────────────────────────────────────────
### 里程碑 C：跨平台 + 移动端联动
### ─────────────────────────────────────────

#### Phase 7 — v1.5：桌面应用（macOS + Linux）
**目标**：用 Tauri（Rust + WebView）打包 Phase 6 的 Web UI 为原生桌面应用。
**预估工作量**：5-7 天（Tauri 打包 + 系统集成）

**选型：Tauri vs Electron**
| 维度 | Tauri | Electron |
|------|-------|----------|
| 包体积 | ~10MB | ~150MB |
| 内存占用 | 低（Rust 后端） | 高（Node.js 进程） |
| 安全性 | 高（Rust，无 Node API 暴露） | 中 |
| 生态 | 较新，成长中 | 成熟 |
| **结论** | **推荐** | 备选 |

**平台策略：**
- **macOS**：优先，开发者主力平台。原生 `.dmg` 分发
- **Linux**：次之，开发者服务器场景。`.AppImage` 分发（无需 root）
- **Windows**：暂缓。受 p006 cat-café 原始教训，多平台并行是精力杀手

**桌面特性：**
- 系统托盘（Tray）：任务完成时发通知
- 快捷键：全局唤起任务输入框
- 本地文件拖拽：直接把代码文件拖入作为上下文
- 自动更新（Tauri updater）

---

#### Phase 8 — v2.0：移动端联动
**目标**：手机端可提交任务、查看结果；任务完成后推送通知。
**预估工作量**：5-7 天

**策略：PWA（Progressive Web App），不开独立 RN 工程**

**理由**：
- React Native 需要独立代码库，维护成本翻倍
- PWA 复用 Phase 6 的 Next.js 前端，改造成本极低
- iOS Safari + Android Chrome 均支持 PWA 安装
- Push API 支持任务完成通知（Android 完整支持，iOS 16.4+ 支持）

**移动端功能：**
- 任务提交（简化版输入框）
- 任务列表 + 状态查看
- Artifact 只读浏览（代码高亮）
- 推送通知：「你的任务完成了，Reviewer 发现 2 个 P2 问题」

**网络策略：**
- 局域网直连（手机与电脑在同一 WiFi）
- 可选：Tailscale/ngrok 穿透（远程访问桌面服务）
- **不做云端服务**（降低成本，保护隐私）

---

## 技术债务清单 / Technical Debt Register

> 每个 Phase 都可能留下债务，这里提前登记，避免「惊喜」。

| 编号 | 债务描述 | 引入于 | 偿还于 | 风险 |
|------|----------|--------|--------|------|
| ~~TD-01~~ | ~~Anthropic SDK 锁定，换模型成本高~~ | ~~v0.1~~ | ~~Phase 2~~ ✅ 已还清 | ~~高~~ |
| TD-02 | TaskContext 是 TypeScript interface，无运行时校验 | v0.1 | Phase 3 | 中 |
| TD-03 | 无结构化日志，调试依赖 console.log | v0.1 | Phase 3 | 中 |
| TD-04 | Filesystem Queue 无事务，进程崩溃可能丢任务 | Phase 3 | Phase 5 | 高 |
| TD-05 | 图结构使用自研实现，长期需要评估是否迁移 LangGraph SDK | Phase 4 | 评估中 | 中 |
| TD-06 | 无 API 鉴权（本地服务假设可信网络） | Phase 5 | Phase 7 | 低→中 |
| TD-07 | 对话持久化用 JSON 文件，无事务保证，大量数据时性能下降 | v0.1 Chat Mode | Phase 5 | 低（单用户本地工具，短期够用） |
| TD-08 | Chat Mode HTTP 服务器用 Node.js 内置 http，无中间件框架 | v0.1 Chat Mode | Phase 5 | 低（Phase 5 迁移到 Fastify） |
| TD-09 | `core/agent.ts` 依赖 `chat/cli-runner.ts`（core → chat 依赖方向） | Phase 2 | Phase 3 | 低（提取 shared subprocess 层） |

---

## 竞品对比 / Competitive Analysis

| 项目 | 优势 | 劣势 | FMA 借鉴 |
|------|------|------|----------|
| **LangGraph** | 图编排成熟，checkpointing 完善 | Python 生态，TypeScript SDK 还在追赶 | 图结构设计（Phase 4） |
| **CrewAI** | Role-based 设计直觉，入门快 | 过度抽象，调试困难 | Role 人格设计（已实现） |
| **AutoGen** | GroupChat 模式灵活，HumanProxy 成熟 | 对话驱动，状态管理复杂 | Human-in-loop 策略（Phase 4） |
| **MetaGPT** | 结构化输出，软件公司角色体系 | 重度，不适合轻量场景 | Reviewer P1/P2/P3 分级（已实现） |
| **Swarm (OpenAI)** | 极简，handoff 清晰 | 无持久化，无 UI | 可插拔 handoff 设计 |
| **Dify** | 无代码，可视化强 | 黑箱，定制性差 | Artifact Panel UI（Phase 6） |
| **p006 cat-café** | 多模型异构，MCP 回调，三层安全 | CLI 冷启动 500ms | 全部核心设计 |

**FMA 的差异化定位**：
> 开发者自用的本地 multi-agent 代码助手，TypeScript 全栈，从 CLI 到桌面 App 的完整演进路径，每个阶段都是真实可用的工具，不是 Demo。

---

## 风险评估 / Risk Register

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| Anthropic API 价格变化 | 高 | 高 | Phase 2 开始支持多模型 |
| 图编排自研复杂度超预期 | 中 | 高 | Phase 4 先用最简条件边，不上完整 DSL |
| Tauri macOS 签名问题 | 中 | 中 | 预留 1 周处理 Apple 证书流程 |
| PWA iOS 推送支持不完整 | 高 | 低 | 降级为轮询或邮件通知 |
| Redis 数据安全（历史教训） | 中 | 极高 | Phase 5 必须三层防御同步落地 |

---

*版本：v1.3 | 日期：2026-03-05 | 作者：架构师视角（怀疑一切，验证一切）*
*v1.3 更新：Phase 2 完成标记，新增 TD-09（core→chat 依赖），更新当前状态反映 CLI 健壮性和 Pipeline 多模型*
*v1.2 更新：反映多模型实际切换 + Token 用量 + Bug 修复的进展，Phase 2 补充实际进展备注*
*v1.1 更新：反映 Chat Mode + JSON 持久化的实际进展，补充 TD-07/TD-08 技术债务*
