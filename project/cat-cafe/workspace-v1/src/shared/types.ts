/**
 * cat-cafe v1 — Shared Domain Types
 * 共享领域类型定义
 *
 * Source of truth: docs/cat-cafe-v1-architecture.md §5–§8
 * All runtime code must import types from this module.
 * 所有运行时代码必须从此模块导入类型。
 */

// ---------------------------------------------------------------------------
// Scalar unions / 标量联合类型
// ---------------------------------------------------------------------------

/** Visibility levels — §6.1. Only these three values are allowed in v1. */
/** 可见性级别 — §6.1。v1 中只允许这三个值。 */
export type Visibility = 'public' | 'private' | 'system-summary';

/** Thread lifecycle states — §5.2 Thread. */
/** 线程生命周期状态。 */
export type ThreadStatus = 'created' | 'active' | 'archived';

/** Invocation state machine — §7.2. */
/** 调用状态机。 */
export type InvocationState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Agent session status — §5.2 AgentSession. */
/** Agent 会话状态。 */
export type SessionStatus = 'active' | 'sealed';

/** Message role in the stream. */
/** 消息流中的角色。 */
export type MessageRole = 'user' | 'assistant' | 'system';

/** Who authored a message. */
/** 消息的作者类型。 */
export type AuthorType = 'user' | 'agent' | 'system';

/** Runtime event types — §8.1. */
/** 运行时事件类型。 */
export type EventType =
  | 'invocation.created'
  | 'invocation.started'
  | 'invocation.text.delta'
  | 'invocation.completed'
  | 'invocation.failed'
  | 'session.created'
  | 'session.selected'
  | 'session.sealed'
  | 'session.handoff'
  | 'memory.extracted';     // auto-extracted memory from agent output / 从 agent 输出中自动提取的记忆

/** Summary generation strategy for session handoff. */
/** Session handoff 的摘要生成策略。 */
export type SummaryStrategy = 'rule-based' | 'llm-generated';

/** Memory scope — three-level hierarchy for long-term memory. */
/** 记忆范围 — 长期记忆的三级层次结构。 */
export type MemoryScope = 'global' | 'thread' | 'agent';

/** Memory category — semantic classification. */
/** 记忆类别 — 语义分类。 */
export type MemoryCategory =
  | 'fact'             // objective facts / 客观事实
  | 'preference'       // user preferences / 用户偏好
  | 'context'          // project/domain context / 项目/领域上下文
  | 'user-profile'     // user identity info / 用户身份信息
  | 'session-insight'  // learned from conversation patterns / 从对话模式中学习
  | 'agent-state';     // agent-specific learned behavior / Agent 特有的习得行为

/** Memory creation source. */
/** 记忆创建来源。 */
export type MemorySource = 'explicit' | 'auto-extracted';

/** Trigger reason for automatic session sealing. */
/** 自动 session 封存的触发原因。 */
export type HandoffTrigger = 'message-count' | 'token-estimate' | 'manual';

// ---------------------------------------------------------------------------
// Core entities / 核心实体
// ---------------------------------------------------------------------------

/**
 * Thread — the top-level workspace boundary (§5.2 Thread).
 * 线程 — 顶级工作空间边界。
 *
 * Relationships:
 *   one Thread → many Message
 *   one Thread → many AgentInvocation
 *   one Thread → many AgentSession
 *   one Thread → one optional WorkspaceBinding
 */
export interface Thread {
  id: string;
  title: string;
  workspacePath?: string;
  selectedAgentIds?: string[];  // cats chosen at thread creation / 创建时选择的猫
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
  archivedAt?: string; // ISO 8601
  status: ThreadStatus;
}

/**
 * Message — user-visible content in the main stream (§5.2 Message).
 * 消息 — 主流中用户可见的内容。
 *
 * Append-only; never mutated in normal flow.
 * 仅追加；正常流程中不可变。
 */
export interface Message {
  id: string;
  threadId: string;
  role: MessageRole;
  authorType: AuthorType;
  authorId: string;
  visibility: Visibility;
  content: string;
  mentions: string[];           // e.g. ['maine', 'siamese']
  sourceInvocationId?: string;  // set when this message is produced by an invocation
  createdAt: string;            // ISO 8601
}

/**
 * AgentProfile — a cat identity available for routing (§5.2 AgentProfile).
 * Agent 档案 — 可路由的猫身份。
 *
 * Predefined for v1; editable in later phases.
 * v1 中预定义；后续阶段可编辑。
 */
export interface AgentProfile {
  id: string;
  name: string;
  provider: string;      // e.g. 'anthropic', 'openai', 'google'
  model: string;         // e.g. 'claude-sonnet-4-6'
  persona: string;       // system prompt / personality description
  enabled: boolean;
  family?: string;       // grouping key, e.g. 'maine', 'siamese' / 分组键
  displayName?: string;  // variant label, e.g. 'Sonnet', 'Opus' / 变体标签
}

/**
 * AgentSession — one cat's active runtime context within one Thread
 * (§5.2 AgentSession).
 * Agent 会话 — 一个猫在一个线程中的活跃运行时上下文。
 *
 * v1 rule: one active session per cat per thread.
 * v1 规则：每个猫在每个线程中只有一个活跃会话。
 */
export interface AgentSession {
  id: string;
  threadId: string;
  agentId: string;       // → AgentProfile.id
  status: SessionStatus;
  createdAt: string;     // ISO 8601
  lastActiveAt: string;  // ISO 8601
  sealedAt?: string;     // ISO 8601 — set when session is sealed / 封存时设置
  contextSummary?: string; // summary of conversation when sealed / 封存时的对话摘要
  predecessorSessionId?: string;  // → AgentSession.id of sealed predecessor / 前任封存 session
  handoffId?: string;             // → SessionHandoff.id if created via handoff / 通过 handoff 创建时的关联 ID
}

/**
 * AgentInvocation — one explicit agent execution request (§5.2 AgentInvocation).
 * Agent 调用 — 一次显式的 Agent 执行请求。
 *
 * This is the center of runtime tracking.
 * 这是运行时跟踪的核心。
 *
 * State machine (§7.2):
 *   queued → running → completed
 *   queued → running → failed
 *   queued → cancelled
 */
export interface AgentInvocation {
  id: string;
  threadId: string;
  sourceMessageId: string;     // the user message that triggered this
  targetAgentId: string;       // → AgentProfile.id
  sessionId: string;           // → AgentSession.id
  parentInvocationId?: string; // reserved for future multi-hop
  state: InvocationState;
  phase?: string;              // optional free-text phase label
  visibility: Visibility;
  startedAt: string;           // ISO 8601
  finishedAt?: string;         // ISO 8601
  errorCode?: string;
}

/**
 * EventLog — runtime events not equivalent to public messages (§5.2 EventLog).
 * 事件日志 — 不等同于公共消息的运行时事件。
 *
 * Append-only. Belongs to one AgentInvocation.
 * 仅追加。属于一个 AgentInvocation。
 */
export interface EventLog {
  id: string;
  threadId: string;
  invocationId: string;   // → AgentInvocation.id
  sessionId?: string;     // → AgentSession.id
  eventType: EventType;
  visibility: Visibility;
  payload: unknown;       // event-specific data
  createdAt: string;      // ISO 8601
}

/**
 * SessionHandoff — records one session sealing + continuation event.
 * 会话交接 — 记录一次 session 封存和延续事件。
 *
 * Created when a session is sealed and a new continuation session is created.
 * 当一个 session 被封存并创建新的延续 session 时创建。
 */
export interface SessionHandoff {
  id: string;
  threadId: string;
  agentId: string;              // → AgentProfile.id
  sealedSessionId: string;      // → AgentSession.id (the sealed predecessor / 被封存的前任)
  newSessionId: string;         // → AgentSession.id (the new continuation / 新的延续)
  summaryStrategy: SummaryStrategy;
  triggerReason: HandoffTrigger;
  createdAt: string;            // ISO 8601
}

/**
 * WorkspaceBinding — binds one Thread to one project path (§5.2 WorkspaceBinding).
 * 工作空间绑定 — 将一个线程绑定到一个项目路径。
 */
export interface WorkspaceBinding {
  id: string;
  threadId: string;
  path: string;
  createdAt: string;  // ISO 8601
}

/**
 * Memory — persistent cross-thread knowledge (Phase 4).
 * 记忆 — 跨线程持久化知识（Phase 4）。
 *
 * Three-level scope hierarchy:
 * 三级范围层次结构：
 *   global  — visible to all agents in all threads / 所有 agent 在所有线程中可见
 *   thread  — visible to all agents in one thread / 所有 agent 在一个线程中可见
 *   agent   — visible to one agent across all threads / 一个 agent 在所有线程中可见
 */
export interface Memory {
  id: string;
  scope: MemoryScope;
  threadId?: string;          // required when scope='thread' / scope='thread' 时必填
  agentId?: string;           // required when scope='agent' / scope='agent' 时必填
  category: MemoryCategory;
  key: string;                // semantic key for dedup, e.g. "user_name" / 语义键用于去重
  value: string;              // the actual memory content / 实际记忆内容
  source: MemorySource;       // how this memory was created / 创建方式
  confidence: number;         // 0.0–1.0, higher = more reliable / 置信度
  visibility: Visibility;
  tags: string[];
  createdAt: string;          // ISO 8601
  updatedAt: string;          // ISO 8601
  lastAccessedAt: string;     // ISO 8601 — updated when used in prompt / 被注入 prompt 时更新
  accessCount: number;        // incremented when used in prompt / 被注入 prompt 时递增
}
