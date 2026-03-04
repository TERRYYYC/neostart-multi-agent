# FMA — First Multi-Agent

> **第一个多 Agent 项目 / First Multi-Agent Project**
> 一个以「代码助手团队」为主题的 Multi-Agent 工程，从极简 MVP 出发，向生产级架构逐步演进。
> A multi-agent project themed as a "code assistant team", starting from a minimal MVP and evolving toward production-grade architecture.

---

## 设计思路 / Design Philosophy

本项目核心思路源自 `p006-cat-cafe` 的学习积累，并综合了 p003 / p004 的架构模式：
*Core thinking is derived from lessons in `p006-cat-cafe`, combined with architectural patterns from p003 / p004:*

| 原则 | 来源 | 实现方式 |
|------|------|----------|
| Agent 各司其职，边界清晰 | p006 meta-rules | 每个 Agent 独立 system prompt，职责不重叠 |
| 上下文传递必须含 WHY | p006 lesson-03 | Coder 收到完整 plan，Reviewer 收到 plan + code |
| 审查客观，P1/P2/P3 分级 | p006 lesson-03 | Reviewer 使用结构化分级输出格式，禁止表演性赞同 |
| 数据不可变追加 | p006 lesson-06 | TaskContext 每层只能添加字段，禁止修改前人输出 |
| 基础层可插拔替换 | p006 ADR-001 | `core/agent.ts` 独立封装，Phase 2 直接换 CLI runner |

---

## 架构 / Architecture

### 整体结构 / Overall Structure

```
用户 CLI 输入
      │
      ▼
┌─────────────────────────────────────────────┐
│              Orchestrator                   │
│           (src/index.ts)                    │
│                                             │
│  TaskContext（不可变追加 / Immutable Append）│
│  { task → plan → code → review }           │
└──────────────┬──────────────────────────────┘
               │  顺序流水线 / Sequential Pipeline
       ┌───────▼────────┐
       │  🧠 Planner    │  角色：架构师 / Role: Architect
       │  planner.ts    │  输入：task
       │                │  输出：结构化计划（严禁写代码）
       └───────┬────────┘
               │ plan
       ┌───────▼────────┐
       │  💻 Coder      │  角色：工程师 / Role: Engineer
       │  coder.ts      │  输入：task + plan
       │                │  输出：TypeScript 代码
       └───────┬────────┘
               │ plan + code
       ┌───────▼────────┐
       │  🔍 Reviewer   │  角色：审查员 / Role: Reviewer
       │  reviewer.ts   │  输入：task + plan + code
       │                │  输出：P1/P2/P3 分级审查 + 最终代码
       └────────────────┘
```

### 文件结构 / File Structure

```
fma/
├── src/
│   ├── core/
│   │   ├── types.ts          # 共享类型：TaskContext / AgentResult
│   │   └── agent.ts          # 底层 Runner（可插拔层）— 当前：Anthropic SDK
│   ├── agents/
│   │   ├── planner.ts        # Planner Agent
│   │   ├── coder.ts          # Coder Agent
│   │   └── reviewer.ts       # Reviewer Agent
│   ├── chat/                  # Chat Mode（Web 聊天模块）
│   │   ├── cli-runner.ts     # CLI subprocess 抽象层（claude/codex/gemini）
│   │   ├── conversation.ts   # 对话管理器（JSON 文件持久化 + 内存缓存）
│   │   ├── server.ts         # HTTP 服务器 + SSE 流式响应
│   │   ├── types.ts          # 聊天模块类型定义
│   │   └── index.ts          # Chat Mode 入口
│   ├── public/
│   │   └── index.html        # Web UI（侧边栏 Session 管理 + 聊天界面）
│   └── index.ts              # Orchestrator + CLI 入口（Agent Pipeline）
├── .data/                     # 运行时数据（自动生成，已 gitignore）
│   └── conversations/        # 对话持久化 JSON 文件
├── .env.example
├── package.json
├── tsconfig.json
├── README.md                  # 本文件（对外：项目介绍）
├── AGENTS.md                  # AI Agent 快速上下文（对内：agent onboarding）
├── CHANGELOG.md               # 变更记录（回滚参考）
├── TROUBLESHOOTING.md         # 踩坑记录
├── future-structure.md        # 演进架构方案（对内：施工图）
├── xiaoming-experience.md     # 经验手册（对内：判断框架）
└── meiyong-plan.md            # 文档关系索引（对内：元文档）
```

### 数据流 / Data Flow

```typescript
// TaskContext 在流水线中逐步填充（不可变追加）
// TaskContext is progressively filled (immutable append only)
const ctx: TaskContext = { task }            // 初始 / Initial
ctx.plan   = planResult.output               // Planner 追加 / Planner appends
ctx.code   = codeResult.output               // Coder 追加 / Coder appends
ctx.review = reviewResult.output             // Reviewer 追加 / Reviewer appends
```

---

## 当前版本 / Current Version

### v1.3 — MVP + Chat Mode + 多模型 + Token 统计 + CLI 健壮性（2026-03-01 ~ 03-05）

**Agent Pipeline 能力 / Agent Pipeline Capabilities**

- ✅ 接收自然语言编程任务（CLI 参数输入）
- ✅ **Planner Agent**：将任务拆解为结构化执行计划，严格不写代码
- ✅ **Coder Agent**：根据计划生成带注释的 TypeScript 代码
- ✅ **Reviewer Agent**：P1/P2/P3 分级审查 + 输出最终修正代码
- ✅ TaskContext 不可变追加（完整可审计历史）
- ✅ 每个 Agent 独立 system prompt（人格隔离，防止角色越界）
- ✅ 错误处理（API Key 缺失、API 错误、响应类型异常）
- ✅ TypeScript strict mode，零 `any`，零类型错误

**Chat Mode 能力 / Chat Mode Capabilities**（2026-03-02 ~ 03-03 新增）

- ✅ Web UI 聊天界面（暗色主题，SSE 流式打字效果）
- ✅ 侧边栏 Session 管理（创建/切换/删除/历史列表）
- ✅ CLI subprocess 抽象层（支持 claude/codex/gemini，含 session resume）
- ✅ 对话持久化（JSON 文件，write-through cache，重启不丢失）
- ✅ HTTP API（POST /api/chat, GET/DELETE /api/conversations）
- ✅ 移动端响应式布局（侧边栏可折叠）
- ✅ **多模型实时切换**（Claude / Codex / Gemini，UI 下拉选择，每请求选模型）
- ✅ **Token 用量 + 响应计时**（每条 assistant 消息显示 input/output/cached tokens + 耗时）

**CLI 健壮性 / CLI Robustness**（2026-03-05 新增）

- ✅ **心跳超时检测**（默认 120s 无输出则强制终止子进程，防挂住）
- ✅ **优雅进程清理**（SIGTERM/SIGINT 信号处理，防孤儿进程）
- ✅ **自动重试 + 线性退避**（可重试错误自动重试，最多 3 次）
- ✅ **stderr 滑动窗口**（只保留最后 2000 字符，防内存泄漏）

**当前限制 / Known Limitations**

- ⏳ Agent Pipeline 顺序执行，无并行（受依赖链约束，当前合理）
- ⏳ 无反馈循环（Reviewer → Coder）
- ⏳ 持久化为 JSON 文件，未来迁移到 Redis（Phase 5）
- ⏳ 无异步任务队列

**技术栈 / Tech Stack**

| 层 | 选型 | 理由 |
|----|------|------|
| 语言 | TypeScript 5.8 + ES2022 | 与 p004/p006 一致，类型即文档 |
| 运行时 | Node.js + tsx（无编译步骤） | 开发体验最简 |
| AI 调用 | Anthropic SDK `^0.37.0` | MVP 阶段代码最少；Phase 2 换 CLI |
| 类型检查 | TypeScript strict mode | 错误在编译时暴露，不在运行时爆 |
| Runtime 依赖数 | 1 个 (`@anthropic-ai/sdk`) | 保持极简，无隐性风险 |

---

## 快速开始 / Quick Start

```bash
# 1. 安装依赖 / Install dependencies
npm install

# 2. 配置 API Key（仅首次 / First time only）
cp .env.example .env
# 编辑 .env，填入：ANTHROPIC_API_KEY=sk-ant-xxxxx
# 获取地址：https://console.anthropic.com

# 3a. Agent Pipeline 模式（CLI 一次性任务）
npm start "write a function that validates email addresses"
npm start "create a debounce utility with TypeScript generics"

# 3b. Chat Mode（Web 聊天界面，支持多轮对话 + Session 管理）
npm run chat
# 打开浏览器访问 http://localhost:3000
# 支持环境变量配置：
#   PORT=8080 npm run chat          # 自定义端口
#   MODEL_PROVIDER=gemini npm run chat  # 切换模型（需要对应 CLI 已安装）
```

---

## 架构决策记录 / Architecture Decision Records

### ADR-001：MVP 用 SDK 而非 CLI
**决定**：`src/core/agent.ts` 使用 Anthropic SDK。
**背景**：p006 的 ADR-001 推荐 CLI，原因是 OAuth + 多模型支持。
**本项目判断**：MVP 单模型（Claude only）+ API Key 可用，SDK 代码量减少 60%，对新手友好。
**影响**：`core/agent.ts` 设计为可插拔层，Phase 2 直接替换，上层 Agent 代码零修改。

### ADR-002：顺序流水线而非并行
**决定**：Planner → Coder → Reviewer 严格串行。
**理由**：存在明确数据依赖链（Coder 需要 plan，Reviewer 需要 code），强行并行需复杂同步原语，无收益。
**未来**：Reviewer + Tester 可以并行（Phase 4），因为二者都只读 code，互不依赖。

### ADR-003：TaskContext 不可变追加
**决定**：每个 Agent 只能向 TaskContext 添加字段，禁止修改前一 Agent 的输出。
**理由**：保证完整可审计历史；防止 Agent 之间隐式状态污染。
**参考**：p006 lesson-06 thread affinity 教训——所有有状态对象必须明确绑定归属。

---

## 迭代路线图 / Iteration Roadmap

> 原则：每个 Phase 向后兼容，替换可插拔层，不推倒重来。
> *Principle: Each phase stays backward-compatible; replace pluggable layers, never full rewrites.*

| Phase | 目标 | 核心改动 | 参考来源 |
|-------|------|----------|----------|
| ✅ **v0.1 MVP** | 顺序流水线，3 Agent，< 200 行 | — | 当前 |
| ✅ **Chat Mode** | Web UI + CLI Runner + Session 管理 + JSON 持久化 | 新增 `chat/` 模块 | 计划外（为后续 Phase 铺路） |
| ✅ **多模型 + Token** | Chat Mode 真实多模型切换 + Token 用量显示 | `cli-runner.ts` 重写 | 提前实现 Phase 2 部分目标 |
| **Phase 2** | CLI runner，多模型（Claude + Gemini + GPT） | 替换 `core/agent.ts` | p006 ADR-001 |
| **Phase 3** | Filesystem Queue，Agent 异步解耦，断点续跑 | 替换 Orchestrator 调用方式 | p003 filesystem primitive |
| **Phase 4** | 图编排 + 反馈循环 + Tester Agent | DAG + 条件边 | LangGraph + p004 |
| **Phase 5** | Redis 持久化（替换 JSON），本地后端服务 | JSON → Redis 迁移 | p006 lesson-06 三层防御 |
| **Phase 6** | 正式 Web 前端，Agent DAG 可视化 | Next.js + XY Flow | p004 UIBus + p005 DeerFlow |

> 详细演进方案见 `future-structure.md`，设计原则见 `xiaoming-experience.md`

---

*Built on lessons from: p003 · p004 · p006 · robust-invoke-hw2.js*
*Created: 2026-03-01 | Updated: 2026-03-05 | Version: 1.3 | Language: TypeScript*
