/**
 * In-process event bus — bridges runtime events to SSE connections.
 * 进程内事件总线 — 将运行时事件桥接到 SSE 连接。
 *
 * The runtime (via event-emitter.ts) publishes EventLog records here.
 * SSE handlers subscribe to specific threadIds.
 * 运行时通过 event-emitter.ts 将 EventLog 记录发布到这里。
 * SSE 处理器订阅特定的 threadId。
 */

import { EventEmitter } from 'node:events';
import type { EventLog } from '../../shared/types.js';

class RuntimeEventBus extends EventEmitter {
  /**
   * Publish a persisted event to all subscribers of its thread.
   * 将已持久化的事件发布给其线程的所有订阅者。
   */
  publish(event: EventLog): void {
    this.emit(`thread:${event.threadId}`, event);
  }

  /**
   * Subscribe to events for a specific thread.
   * 订阅特定线程的事件。
   *
   * Returns an unsubscribe function.
   * 返回取消订阅函数。
   */
  subscribe(
    threadId: string,
    listener: (event: EventLog) => void,
  ): () => void {
    const channel = `thread:${threadId}`;
    this.on(channel, listener);
    return () => this.off(channel, listener);
  }
}

/** Singleton event bus instance. / 单例事件总线实例。 */
export const eventBus = new RuntimeEventBus();
