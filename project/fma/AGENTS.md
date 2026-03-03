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
│   │   ├── server.ts         HTTP server + SSE streaming + REST API + timing
│   │   └── index.ts          Chat Mode entry point
│   ├── public/
│   │   └── index.html        Web UI (sidebar + chat + model selector + usage stats)
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

**⚠️ Known Issues / 已知问题**:
- Multi-model support still has bugs that need further investigation and fixing. Codex and Gemini parsers have been corrected for known issues (see Pitfalls #5–#7), but edge cases likely remain. Next session should do thorough end-to-end testing with all three providers.
- 多模型支持仍有 bug 待完善。Codex 和 Gemini 解析器已修复已知问题（见陷阱 #5–#7），但可能还存在边缘情况。下次开发应对三个 provider 进行全面端到端测试。

**Next up / 下一步** (see `future-structure.md` for details):
- **Priority**: Fix remaining multi-model bugs (end-to-end test all 3 providers, verify token usage accuracy)
- Phase 2 remaining: Retry with exponential backoff, timeout protection, cost comparison logging
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

- **Why SDK not CLI for Agent Pipeline?** MVP simplicity. `core/agent.ts` is pluggable — Phase 2 swaps to CLI with zero upstream changes. (ADR-001)
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

*Version: v1.1 | Updated: 2026-03-03 | Created: 2026-03-03*
*v1.1: Added multi-model support, token usage display, Codex/Gemini pitfalls*
