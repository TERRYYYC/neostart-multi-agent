/**
 * Session manager — find or create AgentSession for (thread, agent).
 * 会话管理器 — 为 (thread, agent) 查找或创建 AgentSession。
 *
 * Implements §7.1 Step 3.
 * v1 rule: one active session per cat per thread.
 * v1 规则：每个猫在每个线程中只有一个活跃会话。
 */

import type { AgentSession } from '../../shared/types.js';
import { generateId } from '../../shared/id.js';
import { agentSessionStore } from '../persistence/index.js';
import { emitEvent } from './event-emitter.js';

/**
 * Find an existing active session or create a new one.
 * 查找已有的活跃会话或创建新会话。
 *
 * Emits `session.selected` or `session.created` event accordingly.
 * 相应地发射 `session.selected` 或 `session.created` 事件。
 */
export async function findOrCreateSession(
  threadId: string,
  agentId: string,
  invocationId: string,
): Promise<AgentSession> {
  const now = new Date().toISOString();

  // Look for an existing active session for this (thread, agent) pair.
  // 查找此 (thread, agent) 对的已有活跃会话。
  const existing = await agentSessionStore.findBy(
    (s) =>
      s.threadId === threadId &&
      s.agentId === agentId &&
      s.status === 'active',
  );

  if (existing.length > 0) {
    const session = existing[0];
    // Update lastActiveAt.
    const updated = await agentSessionStore.update(session.id, {
      lastActiveAt: now,
    });

    await emitEvent({
      threadId,
      invocationId,
      sessionId: session.id,
      eventType: 'session.selected',
      payload: { sessionId: session.id },
    });

    return updated;
  }

  // Create new session. / 创建新会话。
  const session: AgentSession = {
    id: generateId(),
    threadId,
    agentId,
    status: 'active',
    createdAt: now,
    lastActiveAt: now,
  };

  await agentSessionStore.create(session);

  await emitEvent({
    threadId,
    invocationId,
    sessionId: session.id,
    eventType: 'session.created',
    payload: { sessionId: session.id, agentId },
  });

  return session;
}
