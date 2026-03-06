# AGENTS.md — AI Agent Quick Context / AI Agent 快速上下文

> **Purpose**: This file gives any AI agent (Claude, GPT, Gemini, etc.) the minimum context needed to understand and continue developing this project. Read this first, then dive into source files.
> **目的**：让任何 AI agent 用 2 分钟了解项目全貌，然后直接开始编码。先读这个文件，再看源码。

---

## One-Line Description / 一句话描述

FMA (First Multi-Agent) is a TypeScript multi-agent code assistant that runs a sequential pipeline (Planner → Coder → Reviewer) with a Web Chat UI, evolving toward graph orchestration.

FMA 是一个 TypeScript 多 Agent 代码助手，当前为顺序流水线 + Web 聊天界面，逐步演进到图编排架构。

---

## Architecture at a Glance / 架构速览

```
Two modes of operation / 两种运行模式：

1. Agent Pipeline (npm start "task")
   User CLI → Orchestrator → Planner → Coder → Reviewer → stdout
   Data: TaskContext (immutable-append) { task → plan → code → review }

2. Chat Mode (npm run chat → http://localhost:3000)
   Web UI ←→ HTTP Server (SSE streaming) ←→ CLI subprocess (claude/codex/gemini)
   Data: Conversation (JSON file persistence, write-through cache)
   Features: Multi-model selector, per-request provider, token usage + timing display
```

---

## File Map / 文件地图

**Read order for agents / Agent 阅读顺序**: starred (★) files first.

```
fma/
├── src/
│   ├── core/
│   │   ├── types.ts        ★ Shared types: TaskContext, AgentResult
│   │   │                     共享类型定义，理解数据流的起点
│   │   └── agent.ts        ★ Pluggable AI runner (currently: Anthropic SDK)
│   │                         可插拔 AI 调用层（当前用 SDK，Phase 2 换 CLI）
│   ├── agents/
│   │   ├── planner.ts        Planner Agent — outputs structured plan, NO code
│   │   ├── coder.ts          Coder Agent — outputs TypeScript from plan
│   │   └── reviewer.ts       Reviewer Agent — P1/P2/P3 review + final code
│   ├── chat/
│   │   ├── types.ts        ★ Chat types: Message, Conversation
│   │   ├── conversation.ts ★ Persistence layer (JSON files + in-memory Map)
│   │   │                     [Phase 5] Replace internals with Redis, exports unchanged
│   │   ├── cli-runner.ts   ★ CLI subprocess abstraction (claude/codex/gemini)
│   │   │                     Multi-model: build commands + parse output per provider
│   │   │                     多模型：每个 provider 独立的命令构建和输出解析
│   │   ├── server.ts         HTTP server + Chat SSE + Pipeline SSE + REST API
│   │   └── index.ts          Chat Mode entry point
│   ├── public/
│   │   └── index.html        Web UI (Chat Mode + Pipeline Mode + sidebar)
│   └── index.ts              Orchestrator + CLI entry (Agent Pipeline mode)
├── .data/                    Runtime data (auto-generated, gitignored)
│   └── conversations/       JSON files, one per conversation
├── .env.example              API key template
├── package.json              Dependencies: @anthropic-ai/sdk only
├── tsconfig.json             TypeScript strict mode config
│
├── README.md                 Project intro, architecture, quick start
├── AGENTS.md                 THIS FILE — AI agent quick context
├── future-structure.md       Evolution roadmap (Phase 2–6 details)
├── xiaoming-experience.md    Design principles & judgment frameworks
├── meiyong-plan.md           Document relationship index (meta-doc)
├── CHANGELOG.md              Change log with rollback instructions
└── TROUBLESHOOTING.md        Known issues and solutions
```

---

## Coding Conventions / 编码规范

| Rule / 规则 | Detail / 详情 |
|---|---|
| Language | TypeScript 5.8, ES2022 target, strict mode |
| Zero `any` | All types explicit. No `any`, no `as` casts unless justified |
| Bilingual comments | Chinese + English in all source files (中英双语注释) |
| Immutable-append | TaskContext fields can only be added, never modified |
| Pluggable layers | `core/agent.ts` and `chat/conversation.ts` are replacement boundaries. Export signatures must never change |
| Error handling | try/catch at I/O boundaries, never crash the server |
| Dependencies | Minimize. Currently 1 runtime dep (`@anthropic-ai/sdk`). Justify any addition |
| No build step | Use `tsx` for direct TS execution. No `tsc` compilation |
| Explain before code | Before generating any code, explain exactly what you plan to do. Include affected files, components, and edge cases. Wait for confirmation before proceeding. 生成代码前必须先解释计划：列出受影响的文件、组件和边缘情况，等待确认后再动手。 |

---

## Current Progress / 当前进度

**Completed / 已完成**:
- ✅ v0.1.0 — 3-Agent sequential pipeline (Planner → Coder → Reviewer)
- ✅ Chat Mode — Web UI + CLI runner + SSE streaming
- ✅ Session management — Sidebar UI (create/switch/delete sessions)
- ✅ Session persistence — JSON files with write-through cache
- ✅ AbortController for safe stream switching between sessions
- ✅ Multi-model support — Claude / Codex / Gemini CLI real integration (UI selector + per-request provider)
- ✅ Token usage + timing display — each assistant message shows input/output tokens, cached tokens, response duration
- ✅ CLI robustness — heartbeat timeout (120s), graceful process cleanup (SIGTERM→SIGKILL), auto-retry with backoff (max 3), stderr sliding window (2000 chars)
- ✅ CLI 健壮性 — 心跳超时（120s）、优雅进程清理、自动重试退避（最多 3 次）、stderr 滑动窗口（2000 字符）
- ✅ **Phase 2**: Agent Pipeline multi-model CLI Runner — replaced Anthropic SDK with CLI subprocess in `core/agent.ts`
- ✅ **Phase 2**: Cost-tier model assignment — Planner=opus, Coder=sonnet, Reviewer=haiku (env var overridable)
- ✅ **Phase 2**: Agent Pipeline 多模型 CLI Runner — `core/agent.ts` 从 SDK 替换为 CLI subprocess，成本分层
- ✅ **Phase 2.5**: Web UI Pipeline mode — `POST /api/pipeline` SSE route, mode switcher, progress bars, output tabs
- ✅ **Phase 2.5**: Web UI Pipeline 模式 — 浏览器触发流水线、实时进度条、Agent 输出 Tab、Agent 模型配置

**⚠️ Known Issues / 已知问题**:
- Multi-model support still has bugs that need further investigation and fixing. Codex and Gemini parsers have been corrected for known issues (see Pitfalls #5–#7), but edge cases likely remain. Next session should do thorough end-to-end testing with all three providers.
- 多模型支持仍有 bug 待完善。Codex 和 Gemini 解析器已修复已知问题（见陷阱 #5–#7），但可能还存在边缘情况。下次开发应对三个 provider 进行全面端到端测试。
- `core/agent.ts` now depends on `chat/cli-runner.ts` (core → chat direction). This is acceptable short-term debt; Phase 3 should extract shared subprocess layer.
- `core/agent.ts` 现在依赖 `chat/cli-runner.ts`（core → chat 方向）。这是可接受的短期技术债，Phase 3 应提取共享 subprocess 层。

**⚠️ Known Tech Debt / 已知技术债**:
- TD-10: Pipeline mode system prompts are duplicated in `server.ts` (inlined) and `agents/*.ts`. If prompts change frequently, Phase 4 should extract them into a shared config.
- TD-10: Pipeline 模式的 system prompt 在 `server.ts`（内联）和 `agents/*.ts` 中重复。如果 prompt 频繁变更，Phase 4 应提取为共享配置。

**Next up / 下一步** (see `future-structure.md` for details):
- **Priority**: End-to-end test Agent Pipeline with all 3 providers (both CLI and Web UI)
- Phase 3: Filesystem queue, async agents, checkpoint/resume
- Phase 4: Graph orchestration + feedback loops + Tester Agent

---

## Before You Code — Checklist / 编码前检查清单

1. **Read `core/types.ts`** — understand TaskContext and AgentResult shapes
2. **Read `chat/types.ts`** — understand Message and Conversation shapes
3. **Check `CHANGELOG.md`** — see what changed recently and why
4. **Check `future-structure.md`** — confirm which Phase you're implementing
5. **Check `xiaoming-experience.md`** relevant chapter — if making design decisions
6. **Run `npm install && npm run chat`** — verify the project works before changing it
7. **After changes**: update `CHANGELOG.md` with rollback instructions

---

## Key Design Decisions / 关键设计决策

- **Why CLI not SDK for Agent Pipeline?** Phase 2 completed: `core/agent.ts` now uses CLI subprocess via `chat/cli-runner.ts`. Supports Claude/Codex/Gemini with per-agent model selection. (ADR-001, Phase 2)
- **Why sequential not parallel pipeline?** Data dependency chain: Coder needs plan, Reviewer needs code. Parallel adds complexity with no benefit at this stage. (ADR-002)
- **Why JSON files not SQLite/Redis?** Zero dependencies. `conversation.ts` internals swap to Redis in Phase 5, all exports stay the same. (ADR in CHANGELOG)
- **Why Node.js built-in `http` not Express?** One runtime dependency policy. Phase 5+ may migrate to a framework. (TD-08)

---

## Common Pitfalls / 常见陷阱

1. **Claude CLI env vars**: When spawning `claude` as subprocess, must clean env vars (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, etc.) or it silently fails. See `TROUBLESHOOTING.md` Issue #2.
2. **stream-json format**: Claude CLI actual output format differs from docs. Event type is `"assistant"` not `"message"`, content nests under `event.message.content`. Always verify actual output.
3. **Cross-platform node_modules**: Don't copy `node_modules` between platforms (esbuild has native binaries). Always `npm install` on target. See `TROUBLESHOOTING.md` Issue #1.
4. **Pluggable layer contracts**: Never change export signatures of `core/agent.ts` or `chat/conversation.ts`. Add new exports if needed, but existing ones are frozen.
5. **Codex output format**: Codex `exec --json` uses `item.completed` events with text nested in `item.text`, NOT top-level `text`/`content`. Must check `item.type === "agent_message"` (skip `"reasoning"`).
6. **Gemini user echo**: Gemini CLI echoes user messages as `{"type":"message","role":"user"}` before assistant reply. Parser MUST filter `role !== "assistant"` or responses get polluted (e.g., "hiHello!" bug).
7. **Gemini stderr noise**: Gemini CLI emits telemetry errors to stderr (`ECONNRESET` to googleapis.com). These are harmless — don't treat as fatal errors.
8. **IME composition & keydown**: When using CJK input methods (中文/日文/韩文), `keydown` Enter can fire BEFORE `compositionend`. Always check `e.isComposing` or track `compositionstart/end` to prevent premature sends. See fix in `index.html` keydown handler.
9. **CLI subprocess can hang silently**: A spawned CLI process may stop producing output without exiting (network stall, deadlock, etc.). Without heartbeat monitoring, the SSE connection hangs indefinitely. The `cli-runner.ts` heartbeat timer checks every 10s and kills after `CLI_HEARTBEAT_TIMEOUT` (default 120s).
10. **Orphan CLI processes on exit**: If the Node.js server process is killed (SIGTERM/SIGINT), spawned CLI children become orphan processes that continue running and consuming API credits. The `cli-runner.ts` signal handlers clean up all active children on exit. Always use `activeChildren` Set to track spawned processes.

---

## Document Navigation / 文档导航

| I want to... / 我想... | Read / 阅读 |
|---|---|
| Understand project overview | `README.md` |
| Know what to build next | `future-structure.md` |
| Make a design decision | `xiaoming-experience.md` |
| See recent changes | `CHANGELOG.md` |
| Debug a known issue | `TROUBLESHOOTING.md` |
| Understand doc relationships | `meiyong-plan.md` |

---

*Version: v1.5 | Updated: 2026-03-05 | Created: 2026-03-03*
*v1.5: Phase 2.5 complete — Web UI Pipeline mode (POST /api/pipeline SSE, mode switcher, progress bars, output tabs)*
*v1.4: Phase 2 complete — Agent Pipeline multi-model CLI Runner, cost-tier model assignment*
*v1.3: Added CLI robustness (heartbeat, retry, process cleanup), Pitfalls #9–#10*
*v1.2: Added IME composition pitfall (Pitfall #8)*
*v1.1: Added multi-model support, token usage display, Codex/Gemini pitfalls*
