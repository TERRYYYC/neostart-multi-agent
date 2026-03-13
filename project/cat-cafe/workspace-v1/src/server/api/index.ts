/**
 * API route aggregator — mounts all routes.
 * API 路由聚合器 — 挂载所有路由。
 */

import { Router } from 'express';
import { threadRouter } from './threads.js';
import { messageRouter } from './messages.js';
import { runtimeRouter } from './runtime.js';
import { agentRouter } from './agents.js';
import { memoryRouter } from './memories.js';

export const apiRouter = Router();

// Agent profile CRUD — Phase 3 Config Center / Agent 配置管理
apiRouter.use('/agents', agentRouter);

// Memory CRUD — Phase 4 Long-term Memory / 记忆管理
apiRouter.use('/memories', memoryRouter);

// Thread CRUD
apiRouter.use('/threads', threadRouter);

// Messages (nested under thread)
apiRouter.use('/threads/:threadId/messages', messageRouter);

// Runtime status + SSE stream (nested under thread)
apiRouter.use('/threads/:threadId', runtimeRouter);
