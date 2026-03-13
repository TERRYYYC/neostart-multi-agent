/**
 * Runtime API routes — §11 Runtime APIs.
 * 运行时 API 路由。
 *
 * GET /api/threads/:threadId/runtime  — current invocation snapshot
 * GET /api/threads/:threadId/stream   — SSE event stream
 * GET /api/threads/:threadId/agents/:agentId/session-chain — session chain
 * GET /api/threads/:threadId/session-handoffs — handoff records
 * POST /api/threads/:threadId/agents/:agentId/seal — manual session seal
 */

import { Router } from 'express';
import { invocationStore, agentSessionStore, sessionHandoffStore, messageStore, eventLogStore, workspaceBindingStore } from '../persistence/index.js';
import { sseHandler } from '../streaming/sse-handler.js';
import { getSessionChain, executeHandoff, SESSION_CHAIN_CONFIG } from '../runtime/session-chain.js';
import { agentRegistry } from '../registry/agent-registry.js';
import type { SummaryStrategy, EventType } from '../../shared/types.js';
import { generateId } from '../../shared/id.js';

export const runtimeRouter = Router({ mergeParams: true });

/**
 * GET /api/threads/:threadId/runtime
 * Return the most recent invocation for this thread.
 * 返回此线程最近的调用。
 */
runtimeRouter.get('/runtime', async (req, res) => {
  try {
    const threadId = (req.params as Record<string, string>)['threadId'];
    const invocations = await invocationStore.findBy(
      (i) => i.threadId === threadId,
    );

    if (invocations.length === 0) {
      res.json({ current: null });
      return;
    }

    // Sort by startedAt descending, return most recent.
    // 按 startedAt 降序排列，返回最近的。
    invocations.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
    res.json({ current: invocations[0] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /api/threads/:threadId/stream
 * SSE endpoint — delegates to sse-handler with visibility filtering.
 * SSE 端点 — 委托给带有可见性过滤的 sse-handler。
 */
runtimeRouter.get('/stream', sseHandler);

// ---------------------------------------------------------------------------
// Session Chain endpoints / Session 链端点
// ---------------------------------------------------------------------------

/**
 * GET /api/threads/:threadId/agents/:agentId/session-chain
 * Return ordered session chain for one agent in one thread.
 * 返回一个 agent 在一个线程中的有序 session 链。
 */
runtimeRouter.get('/agents/:agentId/session-chain', async (req, res) => {
  try {
    const threadId = (req.params as Record<string, string>)['threadId'];
    const agentId = (req.params as Record<string, string>)['agentId'];

    const chain = await getSessionChain(threadId, agentId);

    // Enrich with message count per session.
    // 为每个 session 添加消息计数。
    const enriched = await Promise.all(
      chain.map(async (session) => {
        const sessionStart = new Date(session.createdAt).getTime();
        const sessionEnd = session.sealedAt
          ? new Date(session.sealedAt).getTime()
          : Date.now();
        const messages = await messageStore.findBy(
          (m) =>
            m.threadId === threadId &&
            (m.visibility === 'public' || m.visibility === 'system-summary') &&
            new Date(m.createdAt).getTime() >= sessionStart &&
            new Date(m.createdAt).getTime() <= sessionEnd,
        );
        return {
          id: session.id,
          status: session.status,
          createdAt: session.createdAt,
          sealedAt: session.sealedAt ?? null,
          predecessorSessionId: session.predecessorSessionId ?? null,
          summaryPreview: session.contextSummary
            ? session.contextSummary.slice(0, 200) + (session.contextSummary.length > 200 ? '...' : '')
            : null,
          messageCount: messages.length,
        };
      }),
    );

    res.json({ agentId, chain: enriched });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /api/threads/:threadId/session-handoffs
 * Return all handoff records for a thread.
 * 返回线程的所有 handoff 记录。
 */
runtimeRouter.get('/session-handoffs', async (req, res) => {
  try {
    const threadId = (req.params as Record<string, string>)['threadId'];
    const handoffs = await sessionHandoffStore.findBy(
      (h) => h.threadId === threadId,
    );
    handoffs.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    res.json({ handoffs });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /api/threads/:threadId/agents/:agentId/seal
 * Manually seal the active session for an agent in a thread.
 * 手动封存一个 agent 在一个线程中的活跃 session。
 *
 * Body: { summaryStrategy?: 'rule-based' | 'llm-generated' }
 */
runtimeRouter.post('/agents/:agentId/seal', async (req, res) => {
  try {
    const threadId = (req.params as Record<string, string>)['threadId'];
    const agentId = (req.params as Record<string, string>)['agentId'];
    const body = req.body as Record<string, unknown>;
    const summaryStrategy = (body.summaryStrategy as SummaryStrategy) || undefined;

    // Find active session. / 查找活跃 session。
    const sessions = await agentSessionStore.findBy(
      (s) =>
        s.threadId === threadId &&
        s.agentId === agentId &&
        s.status === 'active',
    );

    if (sessions.length === 0) {
      res.status(404).json({ error: 'No active session found for this agent in this thread' });
      return;
    }

    const activeSession = sessions[0];

    // Resolve agent profile. / 解析 agent 配置。
    const resolution = await agentRegistry.resolve(agentId);
    let profile;
    if (resolution.ok) {
      profile = resolution.profile;
    } else {
      // Fallback: try to find by ID directly.
      // 回退：尝试直接按 ID 查找。
      const allProfiles = agentRegistry.allProfiles();
      profile = allProfiles.find((p) => p.id === agentId);
      if (!profile) {
        res.status(404).json({ error: 'Agent profile not found' });
        return;
      }
    }

    // Use a synthetic invocation ID for the seal event emission.
    // 使用合成 invocationId 用于封存事件发射。
    const { newSession, handoff } = await executeHandoff(
      threadId,
      agentId,
      activeSession,
      `manual-seal-${Date.now()}`,
      profile,
      'manual',
      summaryStrategy,
    );

    res.json({
      sealed: true,
      sealedSessionId: activeSession.id,
      newSessionId: newSession.id,
      handoffId: handoff.id,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /api/session-chain/config
 * Return current session chain configuration.
 * 返回当前 session 链配置。
 */
runtimeRouter.get('/session-chain/config', (_req, res) => {
  res.json(SESSION_CHAIN_CONFIG);
});

// ---------------------------------------------------------------------------
// Audit Tools endpoints / 审计工具端点
// Phase 3 — Activity log with filtering
// ---------------------------------------------------------------------------

/**
 * GET /api/threads/:threadId/audit-logs
 * Return event logs for a thread with optional filters.
 * 返回线程的事件日志，支持可选过滤。
 *
 * Query params:
 *   eventType  — filter by event type (e.g. 'invocation.completed')
 *   agentId    — filter by target agent (matches invocation's targetAgentId)
 *   limit      — max results (default 100)
 *   offset     — pagination offset (default 0)
 *   since      — ISO 8601 timestamp, only events after this time
 *   until      — ISO 8601 timestamp, only events before this time
 */
runtimeRouter.get('/audit-logs', async (req, res) => {
  try {
    const threadId = (req.params as Record<string, string>)['threadId'];
    const query = req.query as Record<string, string | undefined>;
    const eventTypeFilter = query['eventType'] as EventType | undefined;
    const agentIdFilter = query['agentId'];
    const limit = Math.min(parseInt(query['limit'] || '100', 10), 500);
    const offset = parseInt(query['offset'] || '0', 10);
    const since = query['since'];
    const until = query['until'];

    // Build invocation agent map for agentId filtering.
    // 为 agentId 过滤构建 invocation → agent 映射。
    let invocationAgentMap: Map<string, string> | null = null;
    if (agentIdFilter) {
      const invocations = await invocationStore.findBy(
        (i) => i.threadId === threadId && i.targetAgentId === agentIdFilter,
      );
      invocationAgentMap = new Map(
        invocations.map((i) => [i.id, i.targetAgentId]),
      );
    }

    let events = await eventLogStore.findBy((e) => {
      if (e.threadId !== threadId) return false;
      if (eventTypeFilter && e.eventType !== eventTypeFilter) return false;
      if (invocationAgentMap && !invocationAgentMap.has(e.invocationId)) return false;
      if (since && new Date(e.createdAt).getTime() < new Date(since).getTime()) return false;
      if (until && new Date(e.createdAt).getTime() > new Date(until).getTime()) return false;
      return true;
    });

    // Sort by createdAt descending (most recent first). / 按 createdAt 降序。
    events.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = events.length;
    events = events.slice(offset, offset + limit);

    res.json({ total, offset, limit, events });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /api/threads/:threadId/audit-stats
 * Return aggregate statistics for audit display.
 * 返回审计显示的聚合统计。
 */
runtimeRouter.get('/audit-stats', async (req, res) => {
  try {
    const threadId = (req.params as Record<string, string>)['threadId'];

    const allEvents = await eventLogStore.findBy(
      (e) => e.threadId === threadId,
    );
    const invocations = await invocationStore.findBy(
      (i) => i.threadId === threadId,
    );

    // Count by event type. / 按事件类型计数。
    const eventTypeCounts: Record<string, number> = {};
    for (const e of allEvents) {
      eventTypeCounts[e.eventType] = (eventTypeCounts[e.eventType] || 0) + 1;
    }

    // Count by invocation state. / 按调用状态计数。
    const invocationStateCounts: Record<string, number> = {};
    for (const i of invocations) {
      invocationStateCounts[i.state] = (invocationStateCounts[i.state] || 0) + 1;
    }

    // Invocations per agent. / 每个 agent 的调用数。
    const invocationsPerAgent: Record<string, number> = {};
    for (const i of invocations) {
      invocationsPerAgent[i.targetAgentId] = (invocationsPerAgent[i.targetAgentId] || 0) + 1;
    }

    // Average duration for completed invocations. / 已完成调用的平均耗时。
    const durations = invocations
      .filter((i) => i.state === 'completed' && i.finishedAt && i.startedAt)
      .map((i) => new Date(i.finishedAt!).getTime() - new Date(i.startedAt).getTime());
    const avgDurationMs = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    res.json({
      totalEvents: allEvents.length,
      totalInvocations: invocations.length,
      eventTypeCounts,
      invocationStateCounts,
      invocationsPerAgent,
      avgDurationMs,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Project Directory Binding endpoints / 项目目录绑定端点
// Phase 3 — Enhanced workspace path management
// ---------------------------------------------------------------------------

/**
 * GET /api/threads/:threadId/workspace-binding
 * Get the workspace binding for a thread.
 * 获取线程的工作空间绑定。
 */
runtimeRouter.get('/workspace-binding', async (req, res) => {
  try {
    const threadId = (req.params as Record<string, string>)['threadId'];
    const bindings = await workspaceBindingStore.findBy(
      (b) => b.threadId === threadId,
    );
    if (bindings.length === 0) {
      res.json({ binding: null });
      return;
    }
    // Return most recent binding. / 返回最新的绑定。
    bindings.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    res.json({ binding: bindings[0] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * PUT /api/threads/:threadId/workspace-binding
 * Create or update the workspace binding for a thread.
 * 创建或更新线程的工作空间绑定。
 *
 * Body: { path: string }
 */
runtimeRouter.put('/workspace-binding', async (req, res) => {
  try {
    const threadId = (req.params as Record<string, string>)['threadId'];
    const body = req.body as Record<string, unknown>;
    const path = body['path'] as string | undefined;

    if (!path || typeof path !== 'string' || !path.trim()) {
      res.status(400).json({ error: 'path is required / path 是必填项' });
      return;
    }

    // Check if binding already exists. / 检查绑定是否已存在。
    const existing = await workspaceBindingStore.findBy(
      (b) => b.threadId === threadId,
    );

    let binding;
    if (existing.length > 0) {
      // Update existing binding. / 更新现有绑定。
      binding = await workspaceBindingStore.update(existing[0].id, {
        path: path.trim(),
      });
    } else {
      // Create new binding. / 创建新绑定。
      binding = await workspaceBindingStore.create({
        id: generateId(),
        threadId,
        path: path.trim(),
        createdAt: new Date().toISOString(),
      });
    }

    // Also update thread.workspacePath for convenience. / 同时更新 thread.workspacePath。
    const { threadStore } = await import('../persistence/index.js');
    await threadStore.update(threadId, { workspacePath: path.trim() });

    res.json({ binding });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * DELETE /api/threads/:threadId/workspace-binding
 * Remove the workspace binding for a thread.
 * 移除线程的工作空间绑定。
 */
runtimeRouter.delete('/workspace-binding', async (req, res) => {
  try {
    const threadId = (req.params as Record<string, string>)['threadId'];

    const existing = await workspaceBindingStore.findBy(
      (b) => b.threadId === threadId,
    );

    if (existing.length === 0) {
      res.status(404).json({ error: 'No workspace binding found' });
      return;
    }

    await workspaceBindingStore.delete(existing[0].id);

    // Also clear thread.workspacePath. / 同时清除 thread.workspacePath。
    const { threadStore } = await import('../persistence/index.js');
    await threadStore.update(threadId, { workspacePath: undefined });

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
