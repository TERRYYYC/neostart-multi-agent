/**
 * Event emitter — persists runtime events to the EventLog store.
 * 事件发射器 — 将运行时事件持久化到 EventLog 存储。
 *
 * Thin wrapper around eventLogStore that handles ID generation,
 * timestamps, and default visibility.
 * eventLogStore 的薄封装，处理 ID 生成、时间戳和默认可见性。
 */

import type { EventLog, EventType, Visibility } from '../../shared/types.js';
import { generateId } from '../../shared/id.js';
import { eventLogStore } from '../persistence/index.js';
import { eventBus } from '../streaming/event-bus.js';

export interface EmitEventParams {
  threadId: string;
  invocationId: string;
  sessionId?: string;
  eventType: EventType;
  /** Defaults to 'private' per §7.1 Step 5. / 默认 'private'。 */
  visibility?: Visibility;
  payload?: unknown;
}

/**
 * Emit and persist one runtime event.
 * 发射并持久化一条运行时事件。
 *
 * Raw runtime events default to `visibility = 'private'`.
 * 原始运行时事件默认 `visibility = 'private'`。
 */
export async function emitEvent(params: EmitEventParams): Promise<EventLog> {
  const event: EventLog = {
    id: generateId(),
    threadId: params.threadId,
    invocationId: params.invocationId,
    sessionId: params.sessionId,
    eventType: params.eventType,
    visibility: params.visibility ?? 'private',
    payload: params.payload ?? null,
    createdAt: new Date().toISOString(),
  };
  const persisted = await eventLogStore.create(event);
  // Publish to event bus for SSE streaming.
  // 发布到事件总线用于 SSE 流式传输。
  eventBus.publish(persisted);
  return persisted;
}
