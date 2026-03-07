/**
 * Persistence layer — concrete store instances.
 * 持久化层 — 具体存储实例。
 *
 * Each entity type gets its own JSON file, enforcing the architecture rule
 * that resources are stored separately for later migration.
 * 每种实体类型各自一个 JSON 文件，遵循架构规则：资源独立存储以便后续迁移。
 */

import { join } from 'node:path';
import { JsonFileStore } from './json-file-store.js';
import type {
  Thread,
  Message,
  AgentProfile,
  AgentSession,
  AgentInvocation,
  EventLog,
  WorkspaceBinding,
} from '../../shared/types.js';

// ---------------------------------------------------------------------------
// Data directory / 数据目录
// ---------------------------------------------------------------------------

/** Resolve data directory. Defaults to ./data relative to project root. */
/** 解析数据目录。默认为项目根目录下的 ./data。 */
const DATA_DIR = process.env['DATA_DIR'] ?? join(process.cwd(), 'data');

function dataFile(name: string): string {
  return join(DATA_DIR, name);
}

// ---------------------------------------------------------------------------
// Store instances / 存储实例
// ---------------------------------------------------------------------------

export const threadStore = new JsonFileStore<Thread>(
  dataFile('threads.json'),
);

export const messageStore = new JsonFileStore<Message>(
  dataFile('messages.json'),
);

export const agentProfileStore = new JsonFileStore<AgentProfile>(
  dataFile('agent-profiles.json'),
);

export const agentSessionStore = new JsonFileStore<AgentSession>(
  dataFile('agent-sessions.json'),
);

export const invocationStore = new JsonFileStore<AgentInvocation>(
  dataFile('invocations.json'),
);

export const eventLogStore = new JsonFileStore<EventLog>(
  dataFile('event-logs.json'),
);

export const workspaceBindingStore = new JsonFileStore<WorkspaceBinding>(
  dataFile('workspace-bindings.json'),
);

// Re-export the generic interface for callers that need it.
// 重新导出通用接口。
export type { Store } from './json-file-store.js';
