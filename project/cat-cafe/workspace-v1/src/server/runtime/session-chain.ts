/**
 * Session Chain — automatic session sealing, context summarization, and handoff.
 * 会话链 — 自动 session 封存、上下文摘要和交接。
 *
 * When a session accumulates too many messages or tokens, it is automatically
 * sealed and a new continuation session is created with a context summary.
 * 当 session 积累了过多消息或 token 时，自动封存并创建带上下文摘要的新延续 session。
 *
 * Two summary strategies are supported:
 *   - rule-based (default): extract key messages, zero LLM cost
 *   - llm-generated: call the same agent's CLI runner for a high-quality summary
 * 支持两种摘要策略：规则提取（默认）和 LLM 生成。
 */

import type {
  AgentSession,
  AgentProfile,
  SessionHandoff,
  SummaryStrategy,
  HandoffTrigger,
  Message,
} from '../../shared/types.js';
import { generateId } from '../../shared/id.js';
import {
  agentSessionStore,
  messageStore,
  sessionHandoffStore,
} from '../persistence/index.js';
import { emitEvent } from './event-emitter.js';
import { routeToRunner } from './provider-router.js';

// ---------------------------------------------------------------------------
// Configuration / 配置
// ---------------------------------------------------------------------------

/** Messages per session before auto-seal. / 自动封存前每 session 的消息数。 */
const SESSION_SEAL_MESSAGE_THRESHOLD = Math.max(
  5,
  parseInt(process.env.SESSION_SEAL_MESSAGE_THRESHOLD ?? '30', 10) || 30,
);

/** Approximate token threshold (chars × 0.25). / 近似 token 阈值。 */
const SESSION_SEAL_TOKEN_THRESHOLD = Math.max(
  2000,
  parseInt(process.env.SESSION_SEAL_TOKEN_THRESHOLD ?? '20000', 10) || 20000,
);

/** Default summary strategy. / 默认摘要策略。 */
const SESSION_SUMMARY_STRATEGY: SummaryStrategy =
  (process.env.SESSION_SUMMARY_STRATEGY as SummaryStrategy) || 'rule-based';

/** Max chars for the context summary. / 上下文摘要的最大字符数。 */
const SESSION_SUMMARY_MAX_CHARS = Math.max(
  200,
  parseInt(process.env.SESSION_SUMMARY_MAX_CHARS ?? '1000', 10) || 1000,
);

/** Number of tail messages for rule-based summary. / 规则提取的尾部消息数。 */
const RULE_BASED_TAIL_COUNT = 5;

// ---------------------------------------------------------------------------
// shouldSealSession / 判断是否需要封存
// ---------------------------------------------------------------------------

export interface SealCheck {
  seal: boolean;
  reason: HandoffTrigger;
}

/**
 * Determine if the current session should be sealed.
 * 判断当前 session 是否应该被封存。
 *
 * Counts messages in the thread that were created after the session started,
 * then checks against message-count and token-estimate thresholds.
 * 统计 session 开始后该线程中的消息数，然后检查消息数和 token 估算阈值。
 */
export async function shouldSealSession(
  threadId: string,
  _agentId: string,
  session: AgentSession,
): Promise<SealCheck> {
  const sessionStart = new Date(session.createdAt).getTime();

  // Load messages in this thread created during this session.
  // 加载此 session 期间该线程中的消息。
  const messages = await messageStore.findBy(
    (m) =>
      m.threadId === threadId &&
      (m.visibility === 'public' || m.visibility === 'system-summary') &&
      new Date(m.createdAt).getTime() >= sessionStart,
  );

  // Check message count threshold. / 检查消息数阈值。
  if (messages.length >= SESSION_SEAL_MESSAGE_THRESHOLD) {
    return { seal: true, reason: 'message-count' };
  }

  // Check token estimate threshold (chars × 0.25).
  // 检查 token 估算阈值。
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedTokens = totalChars * 0.25;
  if (estimatedTokens >= SESSION_SEAL_TOKEN_THRESHOLD) {
    return { seal: true, reason: 'token-estimate' };
  }

  return { seal: false, reason: 'message-count' };
}

// ---------------------------------------------------------------------------
// sealSession / 封存 session
// ---------------------------------------------------------------------------

/**
 * Mark a session as sealed.
 * 将 session 标记为已封存。
 */
export async function sealSession(
  session: AgentSession,
): Promise<AgentSession> {
  const now = new Date().toISOString();
  return agentSessionStore.update(session.id, {
    status: 'sealed',
    sealedAt: now,
  });
}

// ---------------------------------------------------------------------------
// generateContextSummary / 生成上下文摘要
// ---------------------------------------------------------------------------

/**
 * Generate a context summary for a sealed session.
 * 为封存的 session 生成上下文摘要。
 *
 * @param strategy - 'rule-based' or 'llm-generated'
 */
export async function generateContextSummary(
  threadId: string,
  session: AgentSession,
  profile: AgentProfile,
  strategy?: SummaryStrategy,
): Promise<string> {
  const effectiveStrategy = strategy ?? SESSION_SUMMARY_STRATEGY;

  const sessionStart = new Date(session.createdAt).getTime();
  const messages = await loadSessionMessages(threadId, sessionStart);

  let summary: string;

  if (effectiveStrategy === 'llm-generated') {
    summary = await generateLlmSummary(messages, profile);
  } else {
    summary = generateRuleBasedSummary(messages);
  }

  // Truncate to max chars. / 截断到最大字符数。
  if (summary.length > SESSION_SUMMARY_MAX_CHARS) {
    summary = summary.slice(0, SESSION_SUMMARY_MAX_CHARS) + '... [truncated]';
  }

  // Persist summary on the session. / 将摘要持久化到 session。
  await agentSessionStore.update(session.id, { contextSummary: summary });

  return summary;
}

/**
 * Load messages from a thread that belong to a specific session time range.
 * 加载属于特定 session 时间范围的线程消息。
 */
async function loadSessionMessages(
  threadId: string,
  sessionStartMs: number,
): Promise<Message[]> {
  const messages = await messageStore.findBy(
    (m) =>
      m.threadId === threadId &&
      (m.visibility === 'public' || m.visibility === 'system-summary') &&
      new Date(m.createdAt).getTime() >= sessionStartMs,
  );
  messages.sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  return messages;
}

/**
 * Rule-based summary: first user message + last N messages.
 * 规则提取摘要：第一条用户消息 + 最后 N 条消息。
 */
function generateRuleBasedSummary(messages: Message[]): string {
  if (messages.length === 0) return '(no messages in session)';

  const parts: string[] = [];

  // Find first user message (establishes the topic).
  // 找到第一条用户消息（确立主题）。
  const firstUser = messages.find((m) => m.role === 'user');
  if (firstUser) {
    const content =
      firstUser.content.length > 300
        ? firstUser.content.slice(0, 300) + '...'
        : firstUser.content;
    parts.push(`[Session topic]: ${content}`);
  }

  // Last N messages for recent context. / 最后 N 条消息用于近期上下文。
  const tail = messages.slice(-RULE_BASED_TAIL_COUNT);
  if (tail.length > 0) {
    parts.push('[Recent conversation]:');
    for (const msg of tail) {
      const content =
        msg.content.length > 200
          ? msg.content.slice(0, 200) + '...'
          : msg.content;
      parts.push(`[${msg.role}]: ${content}`);
    }
  }

  parts.push(`[Total messages in session]: ${messages.length}`);

  return parts.join('\n');
}

/**
 * LLM-generated summary: call the same agent's runner with a summarization prompt.
 * LLM 生成摘要：调用同一 agent 的 runner 执行摘要 prompt。
 */
async function generateLlmSummary(
  messages: Message[],
  profile: AgentProfile,
): Promise<string> {
  if (messages.length === 0) return '(no messages in session)';

  // Build conversation text for summarization.
  // 构建用于摘要的对话文本。
  const conversationText = messages
    .slice(-20) // limit to last 20 messages for summarization input
    .map((m) => {
      const content =
        m.content.length > 500
          ? m.content.slice(0, 500) + '... [truncated]'
          : m.content;
      return `[${m.role}]: ${content}`;
    })
    .join('\n');

  const summarizePrompt =
    `Please provide a concise summary of the following conversation. ` +
    `Focus on: (1) the main topic/task, (2) key decisions made, ` +
    `(3) important context for continuing the conversation. ` +
    `Keep the summary under ${SESSION_SUMMARY_MAX_CHARS} characters.\n\n` +
    `Conversation:\n${conversationText}`;

  try {
    const runner = routeToRunner(profile);
    const chunks: string[] = [];
    const result = await runner.run({
      invocationId: `summary-${generateId(8)}`, // synthetic invocation ID
      threadId: '', // not associated with a thread
      profile,
      taskText: summarizePrompt,
      onTextDelta: async (chunk: string) => {
        chunks.push(chunk);
      },
    });

    if (result.ok && result.text) {
      return result.text;
    }

    // Fallback to rule-based if LLM fails.
    // LLM 失败时回退到规则提取。
    console.warn(
      '[session-chain] LLM summary failed, falling back to rule-based:',
      result.errorMessage,
    );
    return generateRuleBasedSummary(messages);
  } catch (err) {
    console.warn(
      '[session-chain] LLM summary error, falling back to rule-based:',
      err,
    );
    return generateRuleBasedSummary(messages);
  }
}

// ---------------------------------------------------------------------------
// executeHandoff / 执行 handoff
// ---------------------------------------------------------------------------

export interface HandoffResult {
  newSession: AgentSession;
  handoff: SessionHandoff;
}

/**
 * Execute a full session handoff: seal → summarize → create continuation.
 * 执行完整的 session 交接：封存 → 摘要 → 创建延续 session。
 */
export async function executeHandoff(
  threadId: string,
  agentId: string,
  currentSession: AgentSession,
  invocationId: string,
  profile: AgentProfile,
  triggerReason: HandoffTrigger,
  summaryStrategy?: SummaryStrategy,
): Promise<HandoffResult> {
  const now = new Date().toISOString();

  // 1. Seal current session. / 封存当前 session。
  const sealedSession = await sealSession(currentSession);

  // 2. Generate context summary. / 生成上下文摘要。
  const summary = await generateContextSummary(
    threadId,
    sealedSession,
    profile,
    summaryStrategy,
  );

  // 3. Create new continuation session. / 创建新的延续 session。
  const newSession: AgentSession = {
    id: generateId(),
    threadId,
    agentId,
    status: 'active',
    createdAt: now,
    lastActiveAt: now,
    predecessorSessionId: sealedSession.id,
  };

  // 4. Create handoff record. / 创建 handoff 记录。
  const handoff: SessionHandoff = {
    id: generateId(),
    threadId,
    agentId,
    sealedSessionId: sealedSession.id,
    newSessionId: newSession.id,
    summaryStrategy: summaryStrategy ?? SESSION_SUMMARY_STRATEGY,
    triggerReason,
    createdAt: now,
  };

  // Link handoff to new session. / 将 handoff 关联到新 session。
  newSession.handoffId = handoff.id;

  await agentSessionStore.create(newSession);
  await sessionHandoffStore.create(handoff);

  // 5. Emit events (private visibility). / 发射事件（private 可见性）。
  await emitEvent({
    threadId,
    invocationId,
    sessionId: sealedSession.id,
    eventType: 'session.sealed',
    payload: {
      sessionId: sealedSession.id,
      sealedAt: sealedSession.sealedAt,
      contextSummaryLength: summary.length,
    },
  });

  await emitEvent({
    threadId,
    invocationId,
    sessionId: newSession.id,
    eventType: 'session.handoff',
    payload: {
      sealedSessionId: sealedSession.id,
      newSessionId: newSession.id,
      triggerReason,
      summaryStrategy: handoff.summaryStrategy,
    },
  });

  console.log(
    `[session-chain] Handoff: ${sealedSession.id.slice(0, 8)} → ${newSession.id.slice(0, 8)} ` +
      `(${triggerReason}, ${handoff.summaryStrategy}, summary ${summary.length} chars)`,
  );

  return { newSession, handoff };
}

// ---------------------------------------------------------------------------
// getSessionChain / 获取 session 链
// ---------------------------------------------------------------------------

/**
 * Get the full session chain for one agent in one thread, oldest first.
 * 获取一个 agent 在一个线程中的完整 session 链，最旧的在前。
 */
export async function getSessionChain(
  threadId: string,
  agentId: string,
): Promise<AgentSession[]> {
  const sessions = await agentSessionStore.findBy(
    (s) => s.threadId === threadId && s.agentId === agentId,
  );
  sessions.sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  return sessions;
}

/**
 * Get predecessor session's context summary, if any.
 * 获取前任 session 的上下文摘要（如有）。
 *
 * Used by runners to prepend context from sealed sessions.
 * 由 runner 使用，将封存 session 的上下文前置。
 */
export async function getPredecessorSummary(
  sessionId: string,
): Promise<string | null> {
  const session = await agentSessionStore.getById(sessionId);
  if (!session || !session.predecessorSessionId) return null;

  const predecessor = await agentSessionStore.getById(
    session.predecessorSessionId,
  );
  if (!predecessor || !predecessor.contextSummary) return null;

  return predecessor.contextSummary;
}

// ---------------------------------------------------------------------------
// Exports for configuration inspection / 配置检查导出
// ---------------------------------------------------------------------------

export const SESSION_CHAIN_CONFIG = {
  sealMessageThreshold: SESSION_SEAL_MESSAGE_THRESHOLD,
  sealTokenThreshold: SESSION_SEAL_TOKEN_THRESHOLD,
  summaryStrategy: SESSION_SUMMARY_STRATEGY,
  summaryMaxChars: SESSION_SUMMARY_MAX_CHARS,
} as const;
