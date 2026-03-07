/**
 * SSE handler — streams filtered runtime events to the frontend.
 * SSE 处理器 — 将过滤后的运行时事件流式传输到前端。
 *
 * §6.3 hard rule: NEVER push raw private logs into the public stream.
 * §6.3 硬性规则：绝不将原始私有日志推送到公共流中。
 *
 * Strategy:
 *   - invocation lifecycle events (created/started/completed/failed) →
 *     forwarded with safe, minimal payloads (no internal details)
 *   - invocation.text.delta → forwarded as "text.delta" with only the
 *     text chunk (allows frontend to render streaming text)
 *   - session events → forwarded with safe payloads
 *   - all other private events → dropped
 */

import type { Request, Response } from 'express';
import type { EventLog } from '../../shared/types.js';
import { eventBus } from './event-bus.js';

/**
 * Shape of an SSE payload sent to the client.
 * 发送给客户端的 SSE 有效载荷格式。
 */
interface SsePayload {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Transform an internal EventLog into a safe SSE payload.
 * 将内部 EventLog 转换为安全的 SSE 有效载荷。
 *
 * Returns null if the event should NOT be forwarded.
 * 如果事件不应被转发则返回 null。
 */
function toSsePayload(event: EventLog): SsePayload | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  switch (event.eventType) {
    case 'invocation.created':
      return {
        event: 'invocation.created',
        data: {
          invocationId: event.invocationId,
          threadId: event.threadId,
          targetAgentId: payload['targetAgentId'] ?? null,
        },
      };

    case 'invocation.started':
      return {
        event: 'invocation.started',
        data: {
          invocationId: event.invocationId,
          agentName: payload['agentName'] ?? null,
          state: 'running',
        },
      };

    case 'invocation.text.delta':
      // Forward text chunk only — no raw log details.
      // 仅转发文本块 — 无原始日志细节。
      return {
        event: 'text.delta',
        data: {
          invocationId: event.invocationId,
          chunk: payload['chunk'] ?? '',
        },
      };

    case 'invocation.completed':
      return {
        event: 'invocation.completed',
        data: {
          invocationId: event.invocationId,
          state: 'completed',
          replyMessageId: payload['replyMessageId'] ?? null,
        },
      };

    case 'invocation.failed':
      return {
        event: 'invocation.failed',
        data: {
          invocationId: event.invocationId,
          state: 'failed',
          errorCode: payload['errorCode'] ?? null,
        },
      };

    case 'session.created':
      return {
        event: 'session.created',
        data: {
          sessionId: payload['sessionId'] ?? event.sessionId,
          agentId: payload['agentId'] ?? null,
        },
      };

    case 'session.selected':
      return {
        event: 'session.selected',
        data: {
          sessionId: payload['sessionId'] ?? event.sessionId,
        },
      };

    default:
      // Unknown or raw private event → drop.
      // 未知或原始私有事件 → 丢弃。
      return null;
  }
}

/**
 * Express handler for SSE streaming on a thread.
 * 线程 SSE 流式传输的 Express 处理器。
 *
 * Usage: `router.get('/api/threads/:threadId/stream', sseHandler);`
 */
export function sseHandler(req: Request, res: Response): void {
  const threadId = req.params['threadId'] as string | undefined;
  if (!threadId) {
    res.status(400).json({ error: 'Missing threadId' });
    return;
  }

  // Set SSE headers. / 设置 SSE 头。
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering
  });

  // Send initial comment to establish connection.
  // 发送初始注释以建立连接。
  res.write(':connected\n\n');

  // Subscribe to thread events. / 订阅线程事件。
  const unsubscribe = eventBus.subscribe(threadId, (event: EventLog) => {
    const payload = toSsePayload(event);
    if (!payload) return; // filtered out / 已过滤

    res.write(`event: ${payload.event}\n`);
    res.write(`data: ${JSON.stringify(payload.data)}\n\n`);
  });

  // Clean up on client disconnect. / 客户端断开时清理。
  req.on('close', () => {
    unsubscribe();
  });
}
